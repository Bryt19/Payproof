import { NextRequest, NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard/dashboard-data";
import {
  buildVolumeSeriesFromRequests,
  buildStatusBreakdownFromRequests,
  type TimeRange,
} from "@/lib/dashboard/charts";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rangeParam = request.nextUrl.searchParams.get("range");
  const merchantAddress = request.nextUrl.searchParams.get("merchantAddress");
  let range: TimeRange = "30d";

  if (rangeParam === "7d" || rangeParam === "30d" || rangeParam === "90d") {
    range = rangeParam;
  }

  // Scoped to the connected wallet (client-provided); missing/empty => no data.
  const dashboard = await getDashboardData(merchantAddress);

  if (!dashboard.ok) {
    console.error("[dashboard-charts] Dashboard data unavailable:", dashboard.message);

    return NextResponse.json(
      { ok: false, error: dashboard.message },
      { status: 502 },
    );
  }

  const series = buildVolumeSeriesFromRequests(dashboard.requests, range);
  const breakdown = buildStatusBreakdownFromRequests(dashboard.requests);

  return NextResponse.json(
    { ok: true, series, breakdown, range },
    {
      headers: {
        "cache-control": "no-cache, no-store, must-revalidate",
        "private": "true",
      },
    },
  );
}
