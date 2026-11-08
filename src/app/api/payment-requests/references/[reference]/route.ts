import { NextRequest, NextResponse } from "next/server";
import {
  createPaymentRequestRepository,
  describeRepositoryInitializationFailure,
} from "@/lib/payment-requests/repository";
import { isValidPaymentReference } from "@/lib/payment-requests/reference";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> },
) {
  const { reference } = await params;

  if (typeof reference !== "string" || reference.trim().length === 0) {
    return NextResponse.json(
      { error: "A reference is required." },
      { status: 400 },
    );
  }

  if (!isValidPaymentReference(reference.trim())) {
    return NextResponse.json(
      { error: "The reference is not a valid payment reference." },
      { status: 400 },
    );
  }

  let repo;

  try {
    repo = createPaymentRequestRepository();
  } catch (cause) {
    return NextResponse.json(
      { error: describeRepositoryInitializationFailure(cause) },
      { status: 503 },
    );
  }

  const result = await repo.getByReference(reference.trim());

  if (result === null) {
    return NextResponse.json(
      { error: "No payment request found for that reference." },
      { status: 404 },
    );
  }

  if ("type" in result) {
    return NextResponse.json({ error: result.message }, { status: 503 });
  }

  // Return only the fields the checkout page needs. The record is already in
  // the public shape, so this is a deliberate narrow projection rather than the
  // full internal row.
  const checkoutPayload = {
    id: result.id,
    reference: result.reference,
    amountLamports: result.amountLamports,
    description: result.description,
    merchantAddress: result.merchantAddress,
    status: result.status,
    transactionSignature: result.transactionSignature,
    payerAddress: result.payerAddress,
    verifiedAt: result.verifiedAt,
    createdAt: result.createdAt,
  };

  return NextResponse.json(checkoutPayload);
}
