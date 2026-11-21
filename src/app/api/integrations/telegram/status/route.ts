import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/payment-requests/supabase";
import { requireMerchant } from "@/lib/auth";

// ---------------------------------------------------------------------------
// GET /api/integrations/telegram/status
//
// Returns the Telegram connection for the authenticated merchant.
//
//   * The merchant wallet comes from the session only — never from the query
//     string or body, so a caller cannot ask about another merchant.
//   * Only active links are considered (unlinked_at IS NULL).
//   * Telegram chat/user IDs and the row id stay server-side.
//   * Database failures are logged without details and reported generically.
//
//   Linked:      { linked: true,  telegram: { username, linkedAt } }
//   Not linked:  { linked: false, telegram: null }
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

/** Supabase returns timestamptz columns as strings; normalise defensively. */
function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }

  return null;
}

/** Telegram usernames are optional; never invent one. */
function normalizeUsername(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

export async function GET(request: NextRequest) {
  console.log("[telegram/status] requireMerchant starting");
  const merchantAddress = await requireMerchant(request);
  console.log("[telegram/status] requireMerchant result:", typeof merchantAddress, merchantAddress);
  if (typeof merchantAddress !== "string") {
    return merchantAddress;
  }

  let data: unknown;

  try {
    const supabase = createSupabaseClient();
    const { data: row, error } = await supabase
      .from("telegram_links")
      .select("telegram_username, linked_at")
      .eq("merchant_wallet_address", merchantAddress)
      .is("unlinked_at", null)
      .maybeSingle();

    if (error) {
      console.error("[telegram/status] query failed:", error.message, "code:", error.code);
      return NextResponse.json(
        { error: "Could not retrieve Telegram connection status." },
        { status: 503, headers: NO_STORE }
      );
    }

    data = row;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const code = error instanceof Error ? (error as any)?.code ?? "unknown" : "unknown";
    console.error("[telegram/status] query threw:", message, "code:", code);
    console.log("[telegram/status] returning 503 error response");
    return NextResponse.json(
      { error: "Could not retrieve Telegram connection status." },
      { status: 503, headers: NO_STORE }
    );
  }

  // maybeSingle() yields null when the merchant has no active link.
  if (!data || typeof data !== "object") {
    return NextResponse.json(
      { linked: false, telegram: null },
      { status: 200, headers: NO_STORE }
    );
  }

  const row = data as {
    telegram_username?: unknown;
    linked_at?: unknown;
  };

  return NextResponse.json(
    {
      linked: true,
      telegram: {
        username: normalizeUsername(row.telegram_username),
        linkedAt: toIsoTimestamp(row.linked_at),
      },
    },
    { status: 200, headers: NO_STORE }
  );
}
