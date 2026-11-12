import { NextRequest, NextResponse } from "next/server";
import {
  listNotificationsForMerchant,
} from "@/lib/notifications/server";
import { isNotificationType, type NotificationFilter, type NotificationType } from "@/lib/notifications/types";

export const dynamic = "force-dynamic";

function parseFilter(value: string | null): NotificationFilter {
  if (value === "unread" || value === "read") return value;
  return "all";
}

export async function GET(request: NextRequest) {
  const merchantAddress = request.nextUrl.searchParams.get("merchantAddress")?.trim() || "";
  if (!merchantAddress) {
    return NextResponse.json(
      { notifications: [], unreadCount: 0 },
      { status: 200 },
    );
  }

  const filter = parseFilter(request.nextUrl.searchParams.get("filter"));
  const typeParam = request.nextUrl.searchParams.get("type");
  const type: NotificationType | null = isNotificationType(typeParam) ? typeParam : null;
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number.parseInt(limitParam, 10) : 50;

  const result = await listNotificationsForMerchant({
    merchantAddress,
    filter,
    type,
    limit: Number.isFinite(limit) ? limit : 50,
  });

  if (!result.ok) {
    return NextResponse.json(
      { notifications: [], unreadCount: 0, error: result.message },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { notifications: result.notifications, unreadCount: result.unreadCount },
    { status: 200 },
  );
}
