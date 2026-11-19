import { Bot, InlineKeyboard, type Context } from "grammy";
import { createHash } from "node:crypto";
import { createSupabaseClient } from "./lib/payment-requests/supabase.js";
import {
  EVENT_LABELS,
  NOTIF_TEST_ACTION,
  NOTIFICATION_EVENT_TYPES,
  buildNotificationPreferencesKeyboard,
  buildNotificationPreferencesText,
  createNotificationPreferenceStore,
  parseToggleCallbackData,
  type NotificationPreferenceStore,
} from "./lib/notification-preferences.js";
import {
  sendTestNotificationToMerchant,
  type TestNotificationResult,
} from "./lib/telegram-notify.js";
import {
  buildPendingPaymentsText,
  buildReceiptText,
  buildRecentTransactionsText,
  buildSummaryText,
  createPayProofData,
  formatSolAmount,
  isValidPaymentReference,
  unlinkTelegramAccount as unlinkTelegramAccountInDb,
  type PayProofData,
  type StoredPayment,
  type UnlinkResult,
} from "./lib/payproof.js";

/**
 * Menu actions carried in inline-keyboard `callback_data`.
 *
 * Each value has exactly one handler below. Keep this list and the keyboard in
 * sync: the fallback handler reports any value that is not registered here.
 */
export const MENU_ACTIONS = [
  "payment_summary",
  "transactions",
  "pending",
  "receipts",
  "notifications",
  "settings",
  "account_status",
  "unlink",
  "connect",
  "main_menu",
] as const;

export type MenuAction = (typeof MENU_ACTIONS)[number];

/** Actions that need a linked merchant account before any data can be shown. */
type AccountScopedAction =
  | "payment_summary"
  | "transactions"
  | "pending"
  | "receipts";

/** Matches `/start link_<rawToken>`; capture group 1 is the raw token. */
const LINK_PAYLOAD_PATTERN = /^\/start\s+link_([a-zA-Z0-9_-]+)$/;

/**
 * Extracts the raw linking token from a `/start` message text.
 *
 * Returns null unless the text is exactly a linking payload. The `link_`
 * prefix is never part of the result: PayProof hashes the raw token alone, so
 * hashing the prefixed string would produce a different SHA-256 and make
 * `redeem_telegram_token` report an unknown token.
 */
export function parseLinkToken(text: string | undefined): string | null {
  const match = text?.match(LINK_PAYLOAD_PATTERN);
  return match ? match[1] : null;
}

/** The active PayProof link attached to a Telegram account. */
export type ActiveTelegramLink = {
  merchantAddress: string;
  telegramUserId: number;
  telegramChatId: number;
  linkedAt: string | null;
};

export type TelegramLinkLookup =
  | { state: "linked"; link: ActiveTelegramLink }
  | { state: "not_linked" }
  | { state: "unavailable" };

/** Injectable dependencies so handlers can be tested without a database. */
export type HandlerDependencies = {
  lookupTelegramLink?: (telegramUserId: number) => Promise<TelegramLinkLookup>;
  data?: PayProofData;
  unlinkTelegramAccount?: (telegramUserId: number) => Promise<UnlinkResult>;
  /** Preference storage; defaults to the Supabase-backed store. */
  notificationPreferences?: NotificationPreferenceStore;
  /** Explicit test send; defaults to the Telegram Bot API. */
  sendTestNotification?: (
    merchantAddress: string
  ) => Promise<TestNotificationResult>;
};

type TelegramLinkRow = {
  merchant_wallet_address?: unknown;
  telegram_user_id?: unknown;
  telegram_chat_id?: unknown;
  linked_at?: unknown;
  unlinked_at?: unknown;
};

function toPositiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Normalises a `telegram_links` row into an active link.
 *
 * Returns null for a missing row, for a row with `unlinked_at` set (a
 * soft-deleted link) and for a row without a usable merchant wallet. This makes
 * it impossible to report an unlinked history row as a linked account, even if
 * the query filter were ever loosened.
 */
export function toActiveTelegramLink(
  row: TelegramLinkRow | null | undefined
): ActiveTelegramLink | null {
  if (!row) {
    return null;
  }

  if (row.unlinked_at !== null && row.unlinked_at !== undefined) {
    return null;
  }

  const merchantAddress =
    typeof row.merchant_wallet_address === "string"
      ? row.merchant_wallet_address.trim()
      : "";
  const telegramUserId = toPositiveInteger(row.telegram_user_id);
  const telegramChatId = toPositiveInteger(row.telegram_chat_id);

  if (!merchantAddress || telegramUserId === null || telegramChatId === null) {
    return null;
  }

  return {
    merchantAddress,
    telegramUserId,
    telegramChatId,
    linkedAt: typeof row.linked_at === "string" ? row.linked_at : null,
  };
}

/**
 * Shared server-side merchant resolution: maps a Telegram user to the active
 * PayProof merchant wallet in `telegram_links`.
 *
 * Only the columns needed to resolve the merchant are selected — no token
 * material is read, and neither the user ID nor the chat ID is ever logged.
 * Database failures are reported as `unavailable` so callers never claim an
 * account is unlinked when the lookup simply failed.
 */
export async function lookupActiveTelegramLink(
  telegramUserId: number
): Promise<TelegramLinkLookup> {
  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from("telegram_links")
      .select(
        "merchant_wallet_address, telegram_user_id, telegram_chat_id, linked_at, unlinked_at"
      )
      .eq("telegram_user_id", telegramUserId)
      .is("unlinked_at", null)
      .order("linked_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error(
        "[handlers] telegram_links lookup failed:",
        error.message,
        "code:",
        error.code
      );
      return { state: "unavailable" };
    }

    // `.limit(1)` returns an array; take the newest row if one exists.
    const link = toActiveTelegramLink(Array.isArray(data) ? data[0] : data);
    return link ? { state: "linked", link } : { state: "not_linked" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("[handlers] telegram_links lookup threw:", message);
    return { state: "unavailable" };
  }
}

/**
 * Telegram delivery exists for a linked merchant, but any single event type
 * still depends on that merchant's saved preference.
 */
export const PAYMENT_NOTIFICATIONS_STATUS = "Ready (per-event preferences)";

export const MERCHANT_LOOKUP_FAILED_TEXT =
  "Could not check your PayProof account right now. Please try again in a moment.";

export const DATA_UNAVAILABLE_TEXT =
  "Could not load your PayProof data right now. Please try again in a moment.";

export const RECEIPT_INVALID_TEXT =
  "That does not look like a PayProof payment reference. Check the reference and try again.";

export const RECEIPT_NOT_FOUND_TEXT =
  "No verified payment was found for that reference on your merchant account.";

export const RECEIPT_PICKER_TEXT = `🧾 Receipts

Select a verified payment to view its receipt, or use /receipt <reference>.`;

export const RECEIPT_PICKER_EMPTY_TEXT = `🧾 Receipts

No verified payments yet. A receipt is issued only for a payment PayProof verified on Solana.`;

export const UNLINK_CONFIRM_TEXT = `🔓 Unlink account

This disconnects your PayProof merchant account from this Telegram chat. Payment notifications to this chat stop and payment data will no longer be shown here.

Your payment history and merchant records are kept. You can link again at any time.

Unlink this account?`;

export const UNLINK_SUCCESS_TEXT = `✅ Telegram account unlinked

Your merchant wallet is no longer connected to this chat, and future payment notifications to this chat have stopped. Payment history and merchant records were not changed.`;

export const UNLINK_NONE_TEXT = `🔓 Unlink account

No active PayProof account is linked to this chat.`;

export const UNLINK_CANCELLED_TEXT =
  "Unlink cancelled. Your PayProof account is still connected.";

export const UNLINK_FAILED_TEXT =
  "Could not unlink your PayProof account right now. Please try again in a moment.";

export const NOTIFICATIONS_TEXT = `🔔 Notifications

PayProof Notify can deliver a Telegram message when one of these happens on your merchant account:

• A payment request is created
• A payment is verified on Solana
• A payment request expires
• A payment request is cancelled

Link your PayProof account from the app, then open /notifications again to choose which events are sent to this chat.

Alerts follow server-side verification and are never triggered by a browser request.`;

export const CONNECT_TEXT = `⌁ Connect PayProof

1. Open the PayProof app and sign in with your merchant wallet.
2. Go to Settings → Telegram.
3. Select Link Telegram Account and open the link that returns you to this bot.

The bot only accepts a short-lived token generated for your wallet and links it to your Telegram account.`;

export function buildLinkedStatusText(link: ActiveTelegramLink): string {
  return `PayProof Notify — Status

Bot: Online
Merchant account: Linked
Merchant wallet: ${link.merchantAddress}
Payment notifications: ${PAYMENT_NOTIFICATIONS_STATUS}

Notification events are sent only when enabled in /notifications.`;
}

export const STATUS_UNAVAILABLE_TEXT = `PayProof Notify — Status

Bot: Online
Merchant account: Unavailable
Merchant wallet: Unavailable
Payment notifications: Unavailable

Could not check your PayProof link right now. Please try again in a moment.`;

function amountLabel(payment: StoredPayment): string {
  try {
    return `${formatSolAmount(BigInt(payment.amountLamports))} SOL`;
  } catch {
    return "Payment";
  }
}

function verifiedDate(payment: StoredPayment): string {
  const value = payment.verifiedAt;
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
}

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 Payment Summary", "payment_summary")
    .text("🧾 Transactions", "transactions")
    .row()
    .text("⏳ Pending", "pending")
    .text("🧾 Receipts", "receipts")
    .row()
    .text("🔔 Notifications", "notifications")
    .text("⚙️ Settings", "settings")
    .row()
    .text("🛡 Account Status", "account_status")
    .text("🔓 Unlink", "unlink")
    .row()
    .text("⌁ Connect PayProof", "connect")
    .text("❓ Help", "help");
}

function navKeyboard(refresh?: MenuAction): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (refresh) {
    keyboard.text("🔄 Refresh", refresh).row();
  }

  return keyboard.text("🔙 Back to Menu", "main_menu");
}

function unlinkedKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("⌁ Connect PayProof", "connect")
    .row()
    .text("🔙 Back to Menu", "main_menu");
}

function unlinkKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Yes, unlink", "unlink_confirm")
    .text("Cancel", "unlink_cancel");
}

function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔔 Notifications", "notifications")
    .row()
    .text("🔄 Refresh", "settings")
    .row()
    .text("🔙 Back to Menu", "main_menu");
}

export const MAIN_MENU_TEXT = `Welcome to PayProof Notify 👋

Your merchant companion for verified PayProof payments.

Dashboard
• Payment summary — verified totals and counts
• Recent transactions — payments verified on Solana
• Pending payments — outstanding requests
• Receipts — proof for a verified payment

Commands: /summary /transactions /pending /receipt /status /settings /notifications /unlink /help

Choose an option below to get started.`;

const LINKING_REQUIRED_TEXT: Record<AccountScopedAction, string> = {
  payment_summary: `📊 Payment summary

No PayProof merchant account is linked to this chat, so there is no payment data to show. Only verified payments from a linked PayProof account can be summarised here.

Link your PayProof account from the app, then try again.`,
  transactions: `🧾 Recent transactions

No PayProof merchant account is linked to this chat, so there are no verified payments to list. A receipt is only issued for a payment that exists in your PayProof account; nothing is created here.

Link your PayProof account from the app, then try again.`,
  pending: `⏳ Pending payments

No PayProof merchant account is linked to this chat, so there are no pending payment requests to show. Requests are scoped to the merchant the chat is linked to, and this chat is not linked to any merchant yet.

Link your PayProof account from the app, then try again.`,
  receipts: `🧾 Receipts

No PayProof merchant account is linked to this chat, so no receipts can be looked up. A receipt is only issued for a verified payment in your PayProof account.

Link your PayProof account from the app, then try again.`,
};

export function accountLinkingRequiredText(action: AccountScopedAction): string {
  return LINKING_REQUIRED_TEXT[action];
}

export const SETTINGS_TEXT = `⚙️ Settings

Account
• Merchant account: Not linked
• Merchant wallet: None

Notifications
• Payment notifications: Not configured

This chat never displays wallet secrets, session tokens or server keys. Link your PayProof account from the app to see your merchant wallet and payment data here.`;

export function buildSettingsText(
  link: ActiveTelegramLink | null,
  preferences?: Record<string, boolean | null>
): string {
  if (!link) {
    return SETTINGS_TEXT;
  }

  const lines = [
    "⚙️ Settings",
    "",
    "Account",
    "• Merchant account: Linked",
    `• Merchant wallet: ${link.merchantAddress}`,
    "",
    "Notifications",
  ];

  if (preferences) {
    for (const eventType of NOTIFICATION_EVENT_TYPES) {
      const state = preferences[eventType];
      const label =
        state === true ? "Enabled" : state === false ? "Disabled" : "Not set";
      lines.push(`• ${EVENT_LABELS[eventType]}: ${label}`);
    }
    lines.push("");
    lines.push(
      "Change these in /notifications. Missing preferences count as disabled."
    );
  } else {
    lines.push(`• Payment notifications: ${PAYMENT_NOTIFICATIONS_STATUS}`);
    lines.push("");
    lines.push("Open /notifications to choose which events are delivered here.");
  }

  lines.push("");
  lines.push(
    "This chat never displays wallet secrets, session tokens or server keys."
  );

  return lines.join("\n");
}

export const HELP_TEXT = `PayProof Notify — Help

Commands
/start — Open the merchant dashboard
/menu — Open the merchant dashboard
/help — Show this message
/status — Merchant connection and bot status
/summary — Verified payment totals and counts
/transactions — Recent verified payments
/pending — Outstanding payment requests
/receipt — Pick a verified payment and view its receipt
/receipt <reference> — Receipt for a specific verified payment
/unlink — Disconnect your merchant account from this chat
/settings — Account and notification settings
/notifications — Choose which payment events are sent here

Payment data is always scoped to the merchant wallet linked to your Telegram account.`;

export const STATUS_TEXT = `PayProof Notify — Status

Bot: Online
Merchant account: Not linked
Merchant wallet: None
Payment notifications: Not configured

No PayProof merchant account is linked to this chat.`;

export const UNKNOWN_COMMAND_TEXT = `Sorry, I don't recognize that command yet.

Available commands: /start, /help, /status, /summary, /transactions, /pending, /receipt, /unlink, /settings, /notifications.`;

export const FALLBACK_TEXT = `PayProof Notify is waiting for your next command.

Use /start to open the merchant dashboard, /help for available commands, or /status to check your connection status.`;

export const NON_TEXT_MESSAGE_TEXT = `I can only handle text messages and menu buttons. Use /start to open the merchant dashboard or /help for available commands.`;

export const UNKNOWN_CALLBACK_TEXT = "This option is not available yet.";

export const STALE_CALLBACK_TEXT =
  "That menu option is out of date. Use /start to reopen the menu.";

export const PREFERENCE_SAVE_FAILED_TEXT =
  "Could not save that notification preference. Please try again in a moment.";

/**
 * Registers every bot handler.
 *
 * grammY runs middleware in registration order and stops at the first handler
 * that does not call `next()`. The specific button handlers therefore have to be
 * registered *before* the `callback_query` fallback — a catch-all placed first
 * consumes every button and the menu appears dead.
 */
export function registerHandlers(
  bot: Bot,
  deps: HandlerDependencies = {}
): void {
  const lookupTelegramLink =
    deps.lookupTelegramLink ?? lookupActiveTelegramLink;
  const data = deps.data ?? createPayProofData();
  const unlinkAccount = deps.unlinkTelegramAccount ?? unlinkTelegramAccountInDb;
  const preferenceStore =
    deps.notificationPreferences ?? createNotificationPreferenceStore();
  const sendTest = deps.sendTestNotification ?? sendTestNotificationToMerchant;

  /**
   * Resolves the merchant for the caller. Telegram user IDs are global per
   * account and are the identity redeem_telegram_token stores, so the lookup
   * never uses a chat-supplied wallet address.
   */
  async function resolveMerchant(
    from: { id?: number } | undefined
  ): Promise<TelegramLinkLookup> {
    const telegramUserId = from?.id;

    if (typeof telegramUserId !== "number" || telegramUserId <= 0) {
      return { state: "not_linked" };
    }

    return lookupTelegramLink(telegramUserId);
  }

  async function replyPaymentSummary(ctx: Context): Promise<void> {
    const merchant = await resolveMerchant(ctx.from);

    if (merchant.state === "not_linked") {
      await ctx.reply(accountLinkingRequiredText("payment_summary"), {
        reply_markup: unlinkedKeyboard(),
      });
      return;
    }

    if (merchant.state === "unavailable") {
      await ctx.reply(MERCHANT_LOOKUP_FAILED_TEXT, {
        reply_markup: navKeyboard("payment_summary"),
      });
      return;
    }

    const result = await data.getSummary(merchant.link.merchantAddress);

    if (!result.ok) {
      await ctx.reply(DATA_UNAVAILABLE_TEXT, {
        reply_markup: navKeyboard("payment_summary"),
      });
      return;
    }

    await ctx.reply(
      buildSummaryText(merchant.link.merchantAddress, result.data),
      { reply_markup: navKeyboard("payment_summary") }
    );
  }

  async function replyTransactions(ctx: Context): Promise<void> {
    const merchant = await resolveMerchant(ctx.from);

    if (merchant.state === "not_linked") {
      await ctx.reply(accountLinkingRequiredText("transactions"), {
        reply_markup: unlinkedKeyboard(),
      });
      return;
    }

    if (merchant.state === "unavailable") {
      await ctx.reply(MERCHANT_LOOKUP_FAILED_TEXT, {
        reply_markup: navKeyboard("transactions"),
      });
      return;
    }

    const result = await data.getRecentVerified(
      merchant.link.merchantAddress,
      5
    );

    if (!result.ok) {
      await ctx.reply(DATA_UNAVAILABLE_TEXT, {
        reply_markup: navKeyboard("transactions"),
      });
      return;
    }

    await ctx.reply(buildRecentTransactionsText(result.data), {
      reply_markup: navKeyboard("transactions"),
    });
  }

  async function replyPending(ctx: Context): Promise<void> {
    const merchant = await resolveMerchant(ctx.from);

    if (merchant.state === "not_linked") {
      await ctx.reply(accountLinkingRequiredText("pending"), {
        reply_markup: unlinkedKeyboard(),
      });
      return;
    }

    if (merchant.state === "unavailable") {
      await ctx.reply(MERCHANT_LOOKUP_FAILED_TEXT, {
        reply_markup: navKeyboard("pending"),
      });
      return;
    }

    const result = await data.getPending(merchant.link.merchantAddress, 5);

    if (!result.ok) {
      await ctx.reply(DATA_UNAVAILABLE_TEXT, {
        reply_markup: navKeyboard("pending"),
      });
      return;
    }

    await ctx.reply(buildPendingPaymentsText(result.data), {
      reply_markup: navKeyboard("pending"),
    });
  }

  async function replyReceiptPicker(ctx: Context): Promise<void> {
    const merchant = await resolveMerchant(ctx.from);

    if (merchant.state === "not_linked") {
      await ctx.reply(accountLinkingRequiredText("receipts"), {
        reply_markup: unlinkedKeyboard(),
      });
      return;
    }

    if (merchant.state === "unavailable") {
      await ctx.reply(MERCHANT_LOOKUP_FAILED_TEXT, {
        reply_markup: navKeyboard("receipts"),
      });
      return;
    }

    const result = await data.getRecentVerified(
      merchant.link.merchantAddress,
      5
    );

    if (!result.ok) {
      await ctx.reply(DATA_UNAVAILABLE_TEXT, {
        reply_markup: navKeyboard("receipts"),
      });
      return;
    }

    if (result.data.length === 0) {
      await ctx.reply(RECEIPT_PICKER_EMPTY_TEXT, {
        reply_markup: navKeyboard("receipts"),
      });
      return;
    }

    const keyboard = new InlineKeyboard();

    for (const payment of result.data) {
      const date = verifiedDate(payment);
      const label = date
        ? `${amountLabel(payment)} — ${date}`
        : amountLabel(payment);
      keyboard.text(label, `receipt:${payment.reference}`).row();
    }

    keyboard.text("🔙 Back to Menu", "main_menu");

    await ctx.reply(RECEIPT_PICKER_TEXT, { reply_markup: keyboard });
  }

  async function sendReceipt(
    ctx: Context,
    reference: string
  ): Promise<void> {
    if (!isValidPaymentReference(reference)) {
      await ctx.reply(RECEIPT_INVALID_TEXT);
      return;
    }

    const merchant = await resolveMerchant(ctx.from);

    if (merchant.state === "not_linked") {
      await ctx.reply(accountLinkingRequiredText("receipts"), {
        reply_markup: unlinkedKeyboard(),
      });
      return;
    }

    if (merchant.state === "unavailable") {
      await ctx.reply(MERCHANT_LOOKUP_FAILED_TEXT, {
        reply_markup: navKeyboard("receipts"),
      });
      return;
    }

    const result = await data.getVerifiedReceipt(
      merchant.link.merchantAddress,
      reference
    );

    if (!result.ok) {
      await ctx.reply(DATA_UNAVAILABLE_TEXT, {
        reply_markup: navKeyboard("receipts"),
      });
      return;
    }

    if (!result.data) {
      await ctx.reply(RECEIPT_NOT_FOUND_TEXT);
      return;
    }

    await ctx.reply(buildReceiptText(result.data), {
      reply_markup: navKeyboard("receipts"),
    });
  }

  /**
   * Notification preferences screen. The wallet comes from the caller's active
   * Telegram link, never from callback data, so one merchant can never read or
   * change another merchant's preferences.
   */
  async function replyNotifications(ctx: Context): Promise<void> {
    const merchant = await resolveMerchant(ctx.from);

    if (merchant.state === "unavailable") {
      await ctx.reply(MERCHANT_LOOKUP_FAILED_TEXT, {
        reply_markup: navKeyboard("notifications"),
      });
      return;
    }

    if (merchant.state === "not_linked") {
      await ctx.reply(NOTIFICATIONS_TEXT, {
        reply_markup: unlinkedKeyboard(),
      });
      return;
    }

    const preferences = await preferenceStore.getAll(
      merchant.link.merchantAddress
    );

    await ctx.reply(buildNotificationPreferencesText(preferences), {
      reply_markup: buildNotificationPreferencesKeyboard(preferences),
    });
  }

  async function replySettings(ctx: Context): Promise<void> {
    const merchant = await resolveMerchant(ctx.from);

    if (merchant.state === "unavailable") {
      await ctx.reply(MERCHANT_LOOKUP_FAILED_TEXT, {
        reply_markup: settingsKeyboard(),
      });
      return;
    }

    if (merchant.state !== "linked") {
      await ctx.reply(SETTINGS_TEXT, {
        reply_markup: unlinkedKeyboard(),
      });
      return;
    }

    const preferences = await preferenceStore.getAll(
      merchant.link.merchantAddress
    );

    await ctx.reply(buildSettingsText(merchant.link, preferences), {
      reply_markup: settingsKeyboard(),
    });
  }

  async function replyStatus(ctx: Context): Promise<void> {
    const merchant = await resolveMerchant(ctx.from);

    if (merchant.state === "linked") {
      await ctx.reply(buildLinkedStatusText(merchant.link), {
        reply_markup: navKeyboard("account_status"),
      });
      return;
    }

    // A failed lookup is not the same as "not linked": never misreport it.
    if (merchant.state === "unavailable") {
      await ctx.reply(STATUS_UNAVAILABLE_TEXT, {
        reply_markup: navKeyboard("account_status"),
      });
      return;
    }

    await ctx.reply(STATUS_TEXT, { reply_markup: unlinkedKeyboard() });
  }

  async function replyConnect(ctx: Context): Promise<void> {
    await ctx.reply(CONNECT_TEXT, {
      reply_markup: navKeyboard(),
    });
  }

  async function replyUnlinkPrompt(ctx: Context): Promise<void> {
    const merchant = await resolveMerchant(ctx.from);

    if (merchant.state === "unavailable") {
      await ctx.reply(MERCHANT_LOOKUP_FAILED_TEXT, {
        reply_markup: navKeyboard("unlink"),
      });
      return;
    }

    if (merchant.state === "not_linked") {
      await ctx.reply(UNLINK_NONE_TEXT, { reply_markup: unlinkedKeyboard() });
      return;
    }

    await ctx.reply(UNLINK_CONFIRM_TEXT, { reply_markup: unlinkKeyboard() });
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------
  bot.command("start", async (ctx) => {
    // Type assertion: the 'start' command is guaranteed to have a message
    // GrammY ensures message updates for the 'start' command have a message property
    const message = ctx.message!;

    // Check for linking payload: /start link_<rawToken>
    const text = message.text;

    const rawToken = parseLinkToken(text);

    if (rawToken) {
      // Validate raw token format (32 bytes base64url = 43 chars).
      if (rawToken.length < 10 || rawToken.length > 50) {
        await ctx.reply(
          "Invalid linking payload. Please try again or use /start without a payload."
        );
        return;
      }

      // Hash the raw token using SHA-256.
      const hash = createHash("sha256").update(rawToken, "utf8").digest("hex");

      // Get Telegram user and chat IDs from the actual Telegram update.
      const userId = message.from?.id;
      const chatId = message.chat?.id;
      const username = message.from?.username ?? null;

      // Validate that we have the required Telegram identities.
      if (!userId || !chatId) {
        await ctx.reply(
          "Could not identify your Telegram account. Please try again."
        );
        return;
      }

      // Validate Telegram IDs are positive (database constraint).
      if (userId <= 0 || chatId <= 0) {
        await ctx.reply(
          "Invalid Telegram user ID or chat ID. Please try again."
        );
        return;
      }

      // Redeem server-side with the service-role client.
      const supabase = createSupabaseClient();
      let rpcResult = await supabase.rpc("redeem_telegram_token", {
        p_token_hash: hash,
        p_telegram_user_id: userId,
        p_telegram_chat_id: chatId,
        p_telegram_username: username,
      });

      // Normalize RPC result: Supabase returns an array of rows (the SQL
      // function uses `return query select`), so take the first row.
      rpcResult = Array.isArray(rpcResult.data)
        ? rpcResult.data[0]
        : rpcResult.data;

      // Read status from the normalized result.
      const status: any = rpcResult?.status;
      console.log("[handlers] redeem_telegram_token status:", status);

      // If no status, return generic failure
      if (!status) {
        await ctx.reply(
          "Could not process the linking request. Please try again or generate a new token from the PayProof app.",
          { reply_markup: mainMenuKeyboard() }
        );
        return;
      }

      switch (status) {
        case "linked":
          // Show success message and switch to main menu
          await ctx.reply(
            `Your PayProof account has been linked successfully!` +
              `\n\nWelcome back, @${username ?? "Guest"}!`,
            { reply_markup: mainMenuKeyboard() }
          );
          break;

        case "already_redeemed":
          await ctx.reply(
            "This Telegram account has already been linked to a PayProof merchant account.",
            { reply_markup: mainMenuKeyboard() }
          );
          break;

        case "expired_token":
          await ctx.reply(
            "The linking token has expired. Please generate a new token from the PayProof app.",
            { reply_markup: mainMenuKeyboard() }
          );
          break;

        case "revoked_token":
          await ctx.reply(
            "The linking token has been revoked. Please generate a new token from the PayProof app.",
            { reply_markup: mainMenuKeyboard() }
          );
          break;

        case "merchant_already_linked":
          await ctx.reply(
            "This merchant already has an active Telegram link. Please unlink the existing link before connecting another.",
            { reply_markup: mainMenuKeyboard() }
          );
          break;

        case "telegram_already_linked":
          await ctx.reply(
            "This Telegram user is already linked to a different merchant account.",
            { reply_markup: mainMenuKeyboard() }
          );
          break;

        case "invalid_token":
        case "invalid_request":
          await ctx.reply(
            "The linking payload is invalid or has already been used. Please generate a new token from the PayProof app.",
            { reply_markup: mainMenuKeyboard() }
          );
          break;

        default:
          await ctx.reply(
            "Could not process the linking request. Please try again or generate a new token from the PayProof app.",
            { reply_markup: mainMenuKeyboard() }
          );
      }

      return; // Important: return early to avoid falling through to regular /start
    }

    // Regular /start without payload: show the merchant dashboard.
    await ctx.reply(MAIN_MENU_TEXT, { reply_markup: mainMenuKeyboard() });
  });

  bot.command("menu", async (ctx) => {
    await ctx.reply(MAIN_MENU_TEXT, { reply_markup: mainMenuKeyboard() });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT, { reply_markup: mainMenuKeyboard() });
  });

  bot.command("status", async (ctx) => {
    await replyStatus(ctx);
  });

  bot.command("summary", async (ctx) => {
    await replyPaymentSummary(ctx);
  });

  bot.command("transactions", async (ctx) => {
    await replyTransactions(ctx);
  });

  bot.command("pending", async (ctx) => {
    await replyPending(ctx);
  });

  bot.command("notifications", async (ctx) => {
    await replyNotifications(ctx);
  });

  bot.command("settings", async (ctx) => {
    await replySettings(ctx);
  });

  bot.command("unlink", async (ctx) => {
    await replyUnlinkPrompt(ctx);
  });

  bot.command("receipt", async (ctx) => {
    const reference = ctx.match.trim();

    if (reference) {
      await sendReceipt(ctx, reference);
      return;
    }

    await replyReceiptPicker(ctx);
  });

  // -------------------------------------------------------------------------
  // Dashboard buttons — one handler per action, each answering the callback
  // -------------------------------------------------------------------------
  bot.callbackQuery("payment_summary", async (ctx) => {
    await ctx.answerCallbackQuery();
    await replyPaymentSummary(ctx);
  });

  bot.callbackQuery("transactions", async (ctx) => {
    await ctx.answerCallbackQuery();
    await replyTransactions(ctx);
  });

  bot.callbackQuery("pending", async (ctx) => {
    await ctx.answerCallbackQuery();
    await replyPending(ctx);
  });

  bot.callbackQuery("receipts", async (ctx) => {
    await ctx.answerCallbackQuery();
    await replyReceiptPicker(ctx);
  });

  // Selecting a listed payment sends its verified receipt. References are
  // 43-44 base58 characters, so `receipt:<reference>` fits Telegram's 64-byte
  // callback_data limit.
  bot.callbackQuery(
    /^receipt:([1-9A-HJ-NP-Za-km-z]{32,44})$/,
    async (ctx) => {
      await ctx.answerCallbackQuery();
      await sendReceipt(ctx, ctx.match![1]);
    }
  );

  bot.callbackQuery("notifications", async (ctx) => {
    await ctx.answerCallbackQuery();
    await replyNotifications(ctx);
  });

  bot.callbackQuery("settings", async (ctx) => {
    await ctx.answerCallbackQuery();
    await replySettings(ctx);
  });

  bot.callbackQuery("account_status", async (ctx) => {
    await ctx.answerCallbackQuery();
    await replyStatus(ctx);
  });

  bot.callbackQuery("unlink", async (ctx) => {
    await ctx.answerCallbackQuery();
    await replyUnlinkPrompt(ctx);
  });

  // -------------------------------------------------------------------------
  // Notification preferences — toggles and the explicit test send
  // -------------------------------------------------------------------------

  /**
   * Toggle one saved preference and redraw the keyboard from the value that was
   * actually persisted. Forged or unknown callback data is rejected before any
   * read or write happens.
   */
  bot.callbackQuery(/^notif_toggle:[a-z_]+$/, async (ctx) => {
    const eventType = parseToggleCallbackData(ctx.callbackQuery?.data);

    if (!eventType) {
      await ctx.answerCallbackQuery({ text: STALE_CALLBACK_TEXT });
      return;
    }

    const merchant = await resolveMerchant(ctx.from);

    if (merchant.state === "unavailable") {
      await ctx.answerCallbackQuery({ text: MERCHANT_LOOKUP_FAILED_TEXT });
      return;
    }

    if (merchant.state === "not_linked") {
      await ctx.answerCallbackQuery({ text: "No linked merchant account." });
      await ctx.reply(NOTIFICATIONS_TEXT, {
        reply_markup: unlinkedKeyboard(),
      });
      return;
    }

    const address = merchant.link.merchantAddress;
    const before = await preferenceStore.getAll(address);
    const nextEnabled = before[eventType] !== true;

    const saved = await preferenceStore.set(address, eventType, nextEnabled);

    if (!saved) {
      await ctx.answerCallbackQuery({ text: PREFERENCE_SAVE_FAILED_TEXT });
      return;
    }

    const after = await preferenceStore.getAll(address);

    await ctx.answerCallbackQuery({
      text: `${EVENT_LABELS[eventType]}: ${
        after[eventType] === true ? "enabled" : "disabled"
      }`,
    });

    const text = buildNotificationPreferencesText(after);
    const keyboard = buildNotificationPreferencesKeyboard(after);

    try {
      await ctx.editMessageText(text, { reply_markup: keyboard });
    } catch {
      // The message may be too old to edit; send a fresh screen instead.
      await ctx.reply(text, { reply_markup: keyboard });
    }
  });

  /**
   * Explicit test send. Nothing is sent when a preference is enabled — this
   * button is the only path that produces a test message, and it does not
   * create a notification or a delivery record.
   */
  bot.callbackQuery(NOTIF_TEST_ACTION, async (ctx) => {
    const merchant = await resolveMerchant(ctx.from);

    if (merchant.state === "unavailable") {
      await ctx.answerCallbackQuery({ text: MERCHANT_LOOKUP_FAILED_TEXT });
      return;
    }

    if (merchant.state === "not_linked") {
      await ctx.answerCallbackQuery({ text: "No linked merchant account." });
      await ctx.reply(NOTIFICATIONS_TEXT, {
        reply_markup: unlinkedKeyboard(),
      });
      return;
    }

    const result = await sendTest(merchant.link.merchantAddress);

    if (result.ok) {
      await ctx.answerCallbackQuery({ text: "Test message sent." });
      await ctx.reply(
        "Test message sent to this chat. It is marked as a test and is not a payment record.",
        { reply_markup: navKeyboard("notifications") }
      );
      return;
    }

    await ctx.answerCallbackQuery({ text: "Test message failed." });
    await ctx.reply(`Test message was not sent: ${result.message}`, {
      reply_markup: navKeyboard("notifications"),
    });
  });

  bot.callbackQuery("unlink_confirm", async (ctx) => {
    await ctx.answerCallbackQuery();

    const merchant = await resolveMerchant(ctx.from);

    if (merchant.state === "unavailable") {
      await ctx.reply(MERCHANT_LOOKUP_FAILED_TEXT);
      return;
    }

    if (merchant.state === "not_linked") {
      await ctx.reply(UNLINK_NONE_TEXT, { reply_markup: unlinkedKeyboard() });
      return;
    }

    const result = await unlinkAccount(merchant.link.telegramUserId);

    if (!result.ok) {
      await ctx.reply(UNLINK_FAILED_TEXT);
      return;
    }

    if (!result.data) {
      await ctx.reply(UNLINK_NONE_TEXT, { reply_markup: unlinkedKeyboard() });
      return;
    }

    await ctx.reply(UNLINK_SUCCESS_TEXT, {
      reply_markup: unlinkedKeyboard(),
    });
  });

  bot.callbackQuery("unlink_cancel", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(UNLINK_CANCELLED_TEXT, {
      reply_markup: mainMenuKeyboard(),
    });
  });

  bot.callbackQuery("connect", async (ctx) => {
    await ctx.answerCallbackQuery();
    await replyConnect(ctx);
  });

  bot.callbackQuery("help", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(HELP_TEXT, { reply_markup: mainMenuKeyboard() });
  });

  bot.callbackQuery("main_menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(MAIN_MENU_TEXT, { reply_markup: mainMenuKeyboard() });
  });

  // -------------------------------------------------------------------------
  // Fallbacks — must stay last so they only see updates nothing above claimed.
  // -------------------------------------------------------------------------
  bot.on("callback_query", async (ctx) => {
    const callbackData = ctx.callbackQuery?.data;

    // Always answer, otherwise Telegram shows a loading spinner on the button
    // until it times out.
    await ctx.answerCallbackQuery({
      text: callbackData ? UNKNOWN_CALLBACK_TEXT : STALE_CALLBACK_TEXT,
    });
  });

  bot.on("message", async (ctx) => {
    const text = ctx.message.text?.trim();

    if (!text) {
      await ctx.reply(NON_TEXT_MESSAGE_TEXT);
      return;
    }

    if (text.startsWith("/")) {
      await ctx.reply(UNKNOWN_COMMAND_TEXT);
      return;
    }

    await ctx.reply(FALLBACK_TEXT);
  });
}
