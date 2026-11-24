import { NextRequest, NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/payment-requests/supabase";
import { requireMerchant } from "@/lib/auth";

// ---------------------------------------------------------------------------
// POST /api/integrations/telegram/unlink
//
// Soft-disconnects the authenticated merchant's Telegram account.
//
//   * The merchant wallet comes from the session, never the request body, so a
//     caller cannot unlink another merchant's chat.
//   * `unlinked_at` is set instead of deleting the row: Telegram linking is
//     independent of wallet authentication, and payment history is untouched.
//   * Once unlinked, merchant resolution and notification delivery both treat
//     the account as disconnected.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(request: NextRequest) {
  const merchantAddress = await requireMerchant(request);
  if (typeof merchantAddress !== "string") {
    return merchantAddress;
  }

  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("telegram_links")
      .update({ unlinked_at: new Date().toISOString() })
      .eq("merchant_wallet_address", merchantAddress)
      .is("unlinked_at", null)
      .select("id");

    if (error) {
      console.error(
        "[telegram/unlink] update failed:",
        error.message,
        "code:",
        error.code,
      );
      return NextResponse.json(
        { error: "Could not unlink Telegram right now. Please try again." },
        { status: 503, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      { linked: false, telegram: null, unlinked: (data ?? []).length > 0 },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    console.error(
      "[telegram/unlink] update threw:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json(
      { error: "Could not unlink Telegram right now. Please try again." },
      { status: 503, headers: NO_STORE },
    );
  }
}
