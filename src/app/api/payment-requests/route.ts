import { NextRequest, NextResponse } from "next/server";
import {
  createPaymentRequestRepository,
  describeRepositoryInitializationFailure,
  type PaymentRequestRepository,
} from "@/lib/payment-requests/repository";
import type { NewPaymentRequestInput } from "@/lib/payment-requests/types";

async function parseBody(
  request: NextRequest,
): Promise<NewPaymentRequestInput | { error: string }> {
  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return { error: "The request body must be valid JSON." };
  }

  const amountLamports = body.amountLamports;
  const description = body.description;

  if (typeof amountLamports !== "string" || typeof description !== "string") {
    return { error: "amountLamports and description are required strings." };
  }

  return {
    amountLamports,
    description,
    customerName:
      typeof body.customerName === "string" ? body.customerName : null,
    customerEmail:
      typeof body.customerEmail === "string" ? body.customerEmail : null,
    merchantAddress:
      typeof body.merchantAddress === "string" &&
      body.merchantAddress.trim().length > 0
        ? body.merchantAddress.trim()
        : null,
  };
}

function openRepository():
  | { ok: true; repo: PaymentRequestRepository }
  | { ok: false; message: string } {
  try {
    return { ok: true, repo: createPaymentRequestRepository() };
  } catch (cause) {
    return { ok: false, message: describeRepositoryInitializationFailure(cause) };
  }
}

export async function POST(request: NextRequest) {
  const opened = openRepository();

  if (!opened.ok) {
    return NextResponse.json({ error: opened.message }, { status: 503 });
  }

  const parsed = await parseBody(request);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 422 });
  }

  const input = parsed as NewPaymentRequestInput;

  // The merchant address is only ever set here, on the server, from the value
  // the merchant's browser sent. It is not verified as wallet ownership — that
  // is a future task — so it is treated as "reported by the connected client"
  // and displayed as such.
  const merchantAddress: string | null =
    typeof input.merchantAddress === "string" &&
    input.merchantAddress.trim().length > 0
      ? input.merchantAddress.trim()
      : null;

  const result = await opened.repo.create(input, merchantAddress);

  if ("type" in result) {
    const status: Record<string, number> = {
      invalid: 422,
      conflict: 409,
      unauthorized: 401,
      unavailable: 503,
    };

    return NextResponse.json(
      { error: result.message },
      { status: status[result.type] ?? 500 },
    );
  }

  return NextResponse.json(result, { status: 201 });
}

export async function GET(request: NextRequest) {
  const merchantAddress =
    request.nextUrl.searchParams.get("merchantAddress")?.trim() || "";

  // Merchant console data is scoped to the connected wallet (client-provided).
  if (merchantAddress.length === 0) {
    return NextResponse.json(
      { requests: [], notice: "", persistent: true },
      { status: 200 },
    );
  }

  const opened = openRepository();

  if (!opened.ok) {
    return NextResponse.json(
      { requests: [], notice: "", persistent: false, error: opened.message },
      { status: 503 },
    );
  }

  const result = await opened.repo.list(merchantAddress);

  if ("type" in result) {
    return NextResponse.json(
      { requests: [], notice: "", persistent: false, error: result.message },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { requests: result, notice: "", persistent: true },
    { status: 200 },
  );
}
