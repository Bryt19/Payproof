import { NextRequest, NextResponse } from "next/server";
import { markNotificationRead } from "@/lib/notifications/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const merchantAddress = request.nextUrl.searchParams.get("merchantAddress")?.trim() || "";

  if (!merchantAddress) {
    return NextResponse.json(
      { error: "merchantAddress is required." },
      { status: 400 },
    );
  }

  const result = await markNotificationRead({ id, merchantAddress });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.notFound ? 404 : 503 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
