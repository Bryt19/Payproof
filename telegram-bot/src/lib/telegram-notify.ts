import { createSupabaseClient } from "./payment-requests/supabase.js";

/**
 * Explicit test-message delivery for a linked merchant.
 *
 * A test send is deliberately separate from real delivery:
 * - it never creates an in-app notification,
 * - it never writes a `notification_deliveries` row,
 * - its text is marked TEST so it cannot be mistaken for a verified event.
 *
 * It also does not depend on preferences being enabled: the button is an
 * explicit merchant action, and enabling a preference must never send anything
 * by itself.
 */

export const TEST_NOTIFICATION_TEXT =
  "*PayProof test message*\n\n" +
  "Telegram delivery is working for this chat\\.\n" +
  "No payment was verified and no receipt was issued\\.";

export type TestNotificationResult =
  | { ok: true }
  | { ok: false; message: string };

export type TestNotificationDependencies = {
  /** Resolve the merchant's active chat id. */
  resolveChatId?: (merchantAddress: string) => Promise<string | null>;
  /** Server environment only. */
  readBotToken?: () => string | null;
  fetchImpl?: typeof fetch;
};

async function defaultResolveChatId(
  merchantAddress: string,
): Promise<string | null> {
  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("telegram_links")
      .select("telegram_chat_id, linked_at")
      .eq("merchant_wallet_address", merchantAddress)
      .is("unlinked_at", null)
      .order("linked_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error(
        "[telegram-notify] telegram_links lookup failed:",
        error.message,
        "code:",
        error.code,
      );
      return null;
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.telegram_chat_id === null || row.telegram_chat_id === undefined) {
      return null;
    }

    return String(row.telegram_chat_id);
  } catch (cause) {
    console.error(
      "[telegram-notify] telegram_links lookup threw:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return null;
  }
}

function defaultReadBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function sendTestNotificationToMerchant(
  merchantAddress: string,
  deps: TestNotificationDependencies = {},
): Promise<TestNotificationResult> {
  const token = (deps.readBotToken ?? defaultReadBotToken)();
  if (!token) {
    return {
      ok: false,
      message: "Telegram delivery is not configured on this server (missing bot token).",
    };
  }

  const chatId = await (deps.resolveChatId ?? defaultResolveChatId)(merchantAddress);
  if (!chatId) {
    return {
      ok: false,
      message: "This merchant account has no active Telegram link.",
    };
  }

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { ok: false, message: "Outbound HTTP is not available in this runtime." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetchImpl(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          chat_id: chatId,
          text: TEST_NOTIFICATION_TEXT,
          parse_mode: "MarkdownV2",
        }),
      },
    );

    if (response.ok) {
      return { ok: true };
    }

    let description = `Telegram rejected the message (HTTP ${response.status}).`;
    try {
      const body = (await response.json()) as { description?: unknown };
      if (typeof body.description === "string" && body.description.length > 0) {
        description = body.description.slice(0, 200);
      }
    } catch {
      // Keep the status-based message.
    }

    return { ok: false, message: description };
  } catch (cause) {
    const message =
      cause instanceof Error && /abort/i.test(cause.message)
        ? "Telegram did not answer in time."
        : "Could not reach Telegram.";
    return { ok: false, message };
  } finally {
    clearTimeout(timer);
  }
}
