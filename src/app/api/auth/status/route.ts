import { NextRequest, NextResponse } from "next/server";
import { resolveMerchant } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await resolveMerchant(request);

  if (!result.ok) {
    return NextResponse.json(
      { authenticated: false, walletAddress: null, reason: result.message },
      { status: result.kind === "configuration-error" ? 503 : 200 },
    );
  }

  return NextResponse.json(
    { authenticated: true, walletAddress: result.walletAddress, reason: null },
    { status: 200 },
  );
}
