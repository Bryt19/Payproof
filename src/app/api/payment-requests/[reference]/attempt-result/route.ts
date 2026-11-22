import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createSupabaseClient } from "@/lib/payment-requests/supabase";
import { mapAttemptRejectionResponse } from "@/lib/payment-requests/attempt-responses";
import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Safe development diagnostics for the attempt-result endpoint.
 * Logs structured error information without exposing sensitive data.
 * Client-facing responses remain generic; details appear only in development mode.
 * This function is fully null-safe: it handles null, undefined, primitives,
 * arrays, and unexpected values without throwing.
 */
function logAttemptResultDiagnostics(
  operation: string,
  error?: unknown,
  data?: unknown,
): void {
  const isDev = process.env.NODE_ENV !== "production";
  if (!isDev) return;

  // Safely extract error code/message details
  const safeError = error as { code?: string; message?: string; details?: string; hint?: string } | undefined;
  const errorInfo: string[] = [];

  if (safeError?.code) errorInfo.push(`code=${safeError.code}`);
  if (safeError?.message) {
    const msg = safeError.message.replace(/[\s\S]{0,80}/g, "$&\n");
    errorInfo.push(`message=${msg}`);
  }
  if (safeError?.details) {
    const d = safeError.details.replace(/[\s\S]{0,80}/g, "$&\n");
    errorInfo.push(`details=${d}`);
  }
  if (safeError?.hint) {
    const h = safeError.hint.replace(/[\s\S]{0,80}/g, "$&\n");
    errorInfo.push(`hint=${h}`);
  }

  // Safely extract data shape information without throwing
  let dataInfo = "";
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    // Data is a non-null, non-array object: log its keys (minus sensitive ones)
    const dataObj = data as Record<string, unknown>;
    const keys = Object.keys(dataObj).filter(
      k => !/^(attempt_hash|token|rawToken|secret|key|status|rejection_count|error)$/i.test(k),
    );
    if (keys.length > 0) {
      dataInfo = `dataKeys=${JSON.stringify(keys.slice(0, 5))}`;
    }
  } else if (data !== null && typeof data !== "object") {
    // Data is a primitive: log its type and string value (truncated)
    dataInfo = `type=${typeof data} value=${String(data).replace(/[\s\S]{0,40}/g, "$&\n")}`;
  } else if (Array.isArray(data)) {
    // Data is an array: log its length and first few indices
    dataInfo = `arrayLen=${data.length}`;
  }
  // else: data is null or undefined — no data info logged

  const combinedInfo = [...errorInfo, dataInfo].filter(Boolean).join(" | ");
  console.log(`[payproof] attempt-result ${operation} diagnostics: ${combinedInfo}`);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  const { reference } = await params;
  // 1. Parse the attempt token from the request body
  let body: { token: string };
  try {
    body = await request.json();
  } catch {
    // Development diagnostics: malformed JSON body
    logAttemptResultDiagnostics("malformed-json");
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body?.token || typeof body.token !== "string") {
    return NextResponse.json({ error: "Attempt token is required." }, { status: 400 });
  }

  const token = body.token.trim();

  // 2. Validate the token's format (base64 of 32 bytes = 44 chars with padding)
  if (token.length < 43 || token.length > 44) {
    return NextResponse.json({ error: "Invalid attempt token format." }, { status: 400 });
  }

  // 3. Decode the base64 token and validate it's 32 bytes
  let rawBytes: Uint8Array;
  try {
    rawBytes = Uint8Array.from(Buffer.from(token, "base64"));
  } catch {
    // Development diagnostics: invalid base64 encoding
    logAttemptResultDiagnostics("invalid-base64");
    return NextResponse.json({ error: "Invalid attempt token encoding." }, { status: 400 });
  }

  if (rawBytes.length !== 32) {
    return NextResponse.json({ error: "Attempt token must be 32 bytes." }, { status: 400 });
  }

  // 4. Calculate SHA-256 hex hash server-side (never trust client-provided hash)
  const attemptHash = createHash("sha256").update(Buffer.from(rawBytes)).digest("hex");

  // 5. Load the payment request
  const supabase = createSupabaseClient();
  const { data: requestByRef, error: qError } = await supabase
    .from("payment_requests")
    .select("status")
    .eq("reference", reference)
    .maybeSingle();

  // Development diagnostics: payment request lookup result
  logAttemptResultDiagnostics("request-lookup", qError, requestByRef);

  if (qError) {
    // Development diagnostics: include error code/message safely
    // Client-facing: generic message, no details revealed
    return NextResponse.json({ error: "Could not read payment request." }, { status: 503 });
  }

  if (!requestByRef) {
    // Development diagnostics: missing request
    logAttemptResultDiagnostics("request-not-found", undefined, requestByRef);
    return NextResponse.json({ error: "Payment request not found." }, { status: 404 });
  }

  // 6. Call record_attempt_rejection RPC
  const { data, error: rpcError } = await supabase.rpc("record_attempt_rejection", {
    p_reference: reference,
    p_attempt_hash: attemptHash,
  });

  // Development diagnostics: RPC call result
  logAttemptResultDiagnostics("rpc-call", rpcError, data);

  if (rpcError) {
    // Database RPC failure — fail closed, do not reveal details to client
    // Development diagnostics: include error code/message safely (no tokens/hashes)
    return NextResponse.json({ error: "Attempt recording failed. Please try again." }, { status: 503 });
  }

  if (!data) {
    // Development diagnostics: RPC returned no data
    logAttemptResultDiagnostics("rpc-no-data", undefined, data);
    return NextResponse.json({ error: "Attempt recording failed. Please try again." }, { status: 503 });
  }

  // 7. Return the updated rejection count and request status
  // `record_attempt_rejection` reports refusals as a JSONB error payload, so
  // `success === true` is the only accepted signal. Never report a rejection
  // as recorded when the database did not record it.
  const rejection = mapAttemptRejectionResponse(data);

  if (!rejection.ok) {
    logAttemptResultDiagnostics("rpc-refused", undefined, data);
    return NextResponse.json(
      { error: "Attempt could not be recorded." },
      { status: 409 },
    );
  }

  // Development diagnostics: successful response shape
  logAttemptResultDiagnostics("success", undefined, data);
  return NextResponse.json({
    success: true,
    recorded: rejection.recorded,
    attempt: {
      result: rejection.attemptResult,
    },
    paymentRequest: {
      status: rejection.status,
      rejectionCount: rejection.rejectionCount,
    },
  });
}