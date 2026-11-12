import { NextRequest, NextResponse } from "next/server";
import { markAllNotificationsRead } from "@/lib/notifications/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const merchantAddress =
    (typeof body.merchantAddress === "string" ? body.merchantAddress : "").trim() ||
    request.nextUrl.searchParams.get("merchantAddress")?.trim() ||
    "";

  if (!merchantAddress) {
    return NextResponse.json(
      { error: "merchantAddress is required." },
      { status: 400 },
    );
  }

  const result = await markAllNotificationsRead({ merchantAddress });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 503 });
  }

  return NextResponse.json({ ok: true, updated: result.updated }, { status: 200 });
}
