import { NextRequest, NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard/dashboard-data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const merchantAddress =
    request.nextUrl.searchParams.get("merchantAddress")?.trim() || "";

  // Merchant console data is scoped to the connected wallet (client-provided).
  if (!merchantAddress) {
    return NextResponse.json(
      { ok: true, data: null, requests: [] },
      { status: 200 },
    );
  }

  const result = await getDashboardData(merchantAddress);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.message },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { ok: true, data: result.data, requests: result.requests },
    {
      headers: {
        "cache-control": "no-cache, no-store, must-revalidate",
        private: "true",
      },
    },
  );
}
