import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { isValidPaymentReference } from "@/lib/payment-requests/reference";
import { createSupabaseClient } from "@/lib/payment-requests/supabase";
import { expireStalePaymentRequests } from "@/lib/payment-requests/expiration";
import { resolveClientIp } from "@/lib/auth/rate-limit";
import {
  ATTEMPT_TOKEN_TTL_MS,
  isAttemptIssuableStatus,
  mapAttemptIssuanceResponse,
} from "@/lib/payment-requests/attempt-responses";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  const { reference } = await params;
  // 1. Validate the payment reference
  if (!isValidPaymentReference(reference)) {
    return NextResponse.json({ error: "Invalid payment reference." }, { status: 400 });
  }

  // 2. Resolve the trusted client IP (never trust client-supplied IP)
  const ipAddress = resolveClientIp(request.headers);

  // 3. Load the payment request and check its status
  const supabase = createSupabaseClient();

  // Expired requests must not accept new attempts. Persist expiry first so the
  // status check below sees the terminal state.
  await expireStalePaymentRequests({ supabase, reference });

  const { data: requestByRef, error: qError } = await supabase
    .from("payment_requests")
    .select("status")
    .eq("reference", reference)
    .maybeSingle();

  if (qError) {
    return NextResponse.json({ error: "Could not read payment request." }, { status: 503 });
  }

  if (!requestByRef) {
    return NextResponse.json({ error: "Payment request not found." }, { status: 404 });
  }

  // A request marked failed after three recorded rejections can still be
  // retried. Issuance never resets rejection_count, so the failure history is
  // preserved; only server-side on-chain verification can move it to paid.
  if (!isAttemptIssuableStatus(requestByRef.status)) {
    return NextResponse.json({ error: `Cannot issue attempt: request is ${requestByRef.status}.` }, { status: 400 });
  }

  // 4. Generate a SHA-256 hash of a cryptographically random 32-byte token
  const rawBytes = new Uint8Array(32);
  crypto.getRandomValues(rawBytes);
  const attemptHash = createHash("sha256").update(Buffer.from(rawBytes)).digest("hex");
  const rawTokenBase64 = Buffer.from(rawBytes).toString("base64");
  const expiry = new Date(Date.now() + ATTEMPT_TOKEN_TTL_MS).toISOString();

  // 5. Call record_attempt_issuance RPC
  const { data, error: rpcError } = await supabase.rpc("record_attempt_issuance", {
    p_reference: reference,
    p_attempt_hash: attemptHash,
    p_expires_at: expiry,
    p_ip_address: ipAddress ?? null,
    p_wallet_address: null,
  });

  if (rpcError) {
    return NextResponse.json({ error: "Attempt issuance failed. Please try again." }, { status: 503 });
  }

  // `record_attempt_issuance` reports refusals (attempt limit, closed request,
  // etc.) as a JSONB error payload with HTTP 200 at the RPC level. Never return
  // a token unless the RPC explicitly confirmed that the attempt was inserted.
  const issuance = mapAttemptIssuanceResponse(data);

  if (!issuance.ok) {
    return NextResponse.json(
      { error: "Attempt issuance was refused. Please try again." },
      { status: 409 },
    );
  }

  // Return the raw token only to the customer, along with its expiry
  // Never store or log the raw token
  return NextResponse.json({
    success: true,
    attempt: {
      token: rawTokenBase64,
      expiresAt: expiry,
      attemptHash,
      status: issuance.status,
      rejectionCount: issuance.rejectionCount,
    },
  });
}