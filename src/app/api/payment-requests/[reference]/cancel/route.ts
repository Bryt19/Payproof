import { NextRequest, NextResponse } from "next/server";
import { requireMerchant } from "@/lib/auth";
import { isValidPaymentReference } from "@/lib/payment-requests/reference";
import { cancelPaymentRequest } from "@/lib/payment-requests/cancel";

/**
 * POST /api/payment-requests/[reference]/cancel
 *
 * Merchant-scoped cancellation. The wallet comes from the merchant session and
 * must match the wallet recorded on the request; the browser never supplies an
 * owner or a target status.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> },
) {
  const merchantAddress = await requireMerchant(request);
  if (typeof merchantAddress !== "string") {
    return merchantAddress;
  }

  const { reference } = await params;
  const trimmed = typeof reference === "string" ? reference.trim() : "";

  if (!isValidPaymentReference(trimmed)) {
    return NextResponse.json(
      { error: "Invalid payment reference." },
      { status: 400, headers: NO_STORE },
    );
  }

  const result = await cancelPaymentRequest({
    reference: trimmed,
    merchantAddress,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.code, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      success: true,
      reference: trimmed,
      status: result.status,
      alreadyCancelled: result.alreadyCancelled,
    },
    { status: 200, headers: NO_STORE },
  );
}
