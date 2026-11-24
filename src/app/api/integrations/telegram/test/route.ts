import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/payment-requests/supabase";
import { requireMerchant } from "@/lib/auth";
import { resolveActiveTelegramLink } from "@/lib/notifications/server";
import {
  readTelegramBotToken,
  sendTelegramTestMessage,
} from "@/lib/notifications/telegram";

// ---------------------------------------------------------------------------
// POST /api/integrations/telegram/test
//
// Sends an explicit test message to the merchant's linked Telegram chat.
//
// A test send is not a notification: it creates no in-app notification and no
// `notification_deliveries` row, and it never depends on a preference being
// enabled. The chat is resolved from the session's merchant wallet, never from
// the request body, and the bot token stays server-side.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(request: NextRequest) {
  const merchantAddress = await requireMerchant(request);
  if (typeof merchantAddress !== "string") {
    return merchantAddress;
  }

  let supabase;
  try {
    supabase = createSupabaseClient();
  } catch (error) {
    console.error(
      "[telegram/test] Supabase unavailable:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json(
      { error: "Telegram is not configured on this server." },
      { status: 503, headers: NO_STORE },
    );
  }

  const link = await resolveActiveTelegramLink(supabase, merchantAddress);

  if (!link) {
    return NextResponse.json(
      { error: "Connect Telegram before sending a test message." },
      { status: 409, headers: NO_STORE },
    );
  }

  const botToken = readTelegramBotToken();

  if (!botToken) {
    return NextResponse.json(
      { error: "Telegram delivery is not configured on this server." },
      { status: 503, headers: NO_STORE },
    );
  }

  const result = await sendTelegramTestMessage({
    botToken,
    chatId: link.telegram_chat_id,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: 502, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    { sent: true, message: "Test message sent to your linked Telegram chat." },
    { status: 200, headers: NO_STORE },
  );
}
