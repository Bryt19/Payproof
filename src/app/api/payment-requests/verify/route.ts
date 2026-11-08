import { NextRequest, NextResponse } from "next/server";
import {
  createPaymentRequestRepository,
  describeRepositoryInitializationFailure,
} from "@/lib/payment-requests/repository";
import { createPaymentVerificationService } from "@/lib/payment-requests/verification-service";
import { createDevnetLookup } from "@/lib/solana/devnet-lookup";

/**
 * Server-side payment verification endpoint.
 *
 * The request body may only contain a payment reference and a transaction
 * signature. Amount, recipient and status are always loaded from Supabase and
 * checked against Devnet; none of them are accepted from the browser.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "The request body must be valid JSON." },
      { status: 400 },
    );
  }

  const reference = readString(body, "reference");
  const signature = readString(body, "signature");

  if (!reference || !signature) {
    return NextResponse.json(
      { error: "reference and signature are required strings." },
      { status: 400 },
    );
  }

  let repo;

  try {
    repo = createPaymentRequestRepository();
  } catch (cause) {
    return NextResponse.json(
      {
        status: "error",
        message: describeRepositoryInitializationFailure(cause),
        retryable: true,
      },
      { status: 503 },
    );
  }

  const service = createPaymentVerificationService({
    repo,
    lookup: createDevnetLookup(),
  });

  const result = await service.verify({ reference, signature });

  const httpStatus =
    result.status === "verified"
      ? 200
      : result.status === "pending"
        ? 202
        : result.status === "error"
          ? 503
          : result.reason === "request-not-found"
            ? 404
            : result.reason === "invalid-reference" ||
                result.reason === "invalid-signature"
              ? 400
              : 422;

  return NextResponse.json(result, { status: httpStatus });
}
