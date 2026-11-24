import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/payment-requests/supabase";
import { requireMerchant } from "@/lib/auth";
import {
  readNotificationPreferences,
  setNotificationPreference,
} from "@/lib/notifications/server";
import { isNotificationType, type NotificationType } from "@/lib/notifications/types";

// ---------------------------------------------------------------------------
// GET  /api/integrations/telegram/preferences
// PUT  /api/integrations/telegram/preferences
//
// Reads and writes the same `notification_preferences` rows the Telegram bot
// uses, so the Settings page and the bot always show the same values.
//
// The merchant wallet is taken from the session only. Unsupported event names
// are ignored rather than written, and defaults are filled in for rows that do
// not exist yet.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(request: NextRequest) {
  const merchantAddress = await requireMerchant(request);
  if (typeof merchantAddress !== "string") {
    return merchantAddress;
  }

  try {
    const supabase = createSupabaseClient();
    const preferences = await readNotificationPreferences(
      supabase,
      merchantAddress,
    );

    return NextResponse.json(
      { preferences },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    console.error(
      "[telegram/preferences] read failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json(
      { error: "Could not load notification preferences." },
      { status: 503, headers: NO_STORE },
    );
  }
}

export async function PUT(request: NextRequest) {
  const merchantAddress = await requireMerchant(request);
  if (typeof merchantAddress !== "string") {
    return merchantAddress;
  }

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "The request body must be valid JSON." },
      { status: 400, headers: NO_STORE },
    );
  }

  const raw = body.preferences;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json(
      { error: "preferences must be an object of event types to booleans." },
      { status: 400, headers: NO_STORE },
    );
  }

  const updates: Array<{ eventType: NotificationType; enabled: boolean }> = [];

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isNotificationType(key) || typeof value !== "boolean") {
      return NextResponse.json(
        { error: "Unknown notification preference or non-boolean value." },
        { status: 400, headers: NO_STORE },
      );
    }
    updates.push({ eventType: key, enabled: value });
  }

  if (updates.length === 0) {
    return NextResponse.json(
      { error: "No preferences were provided." },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const supabase = createSupabaseClient();

    for (const update of updates) {
      const saved = await setNotificationPreference(
        supabase,
        merchantAddress,
        update.eventType,
        update.enabled,
      );

      if (!saved) {
        return NextResponse.json(
          { error: "Could not save notification preferences." },
          { status: 503, headers: NO_STORE },
        );
      }
    }

    const preferences = await readNotificationPreferences(
      supabase,
      merchantAddress,
    );

    return NextResponse.json(
      { preferences },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    console.error(
      "[telegram/preferences] write failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json(
      { error: "Could not save notification preferences." },
      { status: 503, headers: NO_STORE },
    );
  }
}
