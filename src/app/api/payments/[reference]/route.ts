import { NextRequest, NextResponse } from "next/server";
import { getPaymentByReference } from "@/lib/payments/repository";
import { isValidPaymentReference } from "@/lib/payment-requests/reference";

export const dynamic = "force-dynamic";

/**
 * GET /api/payments/[reference]
 *
 * Returns full details for a single payment transaction.
 */
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

  const trimmedReference = reference.trim();

  if (!isValidPaymentReference(trimmedReference)) {
    return NextResponse.json(
      { error: "The reference is not a valid payment reference." },
      { status: 400 },
    );
  }

  const result = await getPaymentByReference(trimmedReference);

  if (result === null) {
    return NextResponse.json(
      { error: "No payment found for that reference." },
      { status: 404 },
    );
  }

  if (typeof result === "object" && "error" in result) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  // Return the full payment record (it's already in the public shape)
  return NextResponse.json({ payment: result }, { status: 200 });
}
