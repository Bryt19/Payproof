import { Bot, InlineKeyboard } from "grammy";

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
  "settings",
  "help",
  "main_menu",
] as const;

export type MenuAction = (typeof MENU_ACTIONS)[number];

/** Actions that need a linked merchant account before any data can be shown. */
type AccountScopedAction = "payment_summary" | "transactions" | "pending";

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📊 Payment Summary", "payment_summary")
    .text("🧾 Recent Transactions", "transactions")
    .row()
    .text("⏳ Pending Payments", "pending")
    .text("⚙️ Settings", "settings")
    .row()
    .text("❓ Help", "help");
}

function backToMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🔙 Back to Menu", "main_menu");
}

export const MAIN_MENU_TEXT = `Welcome to PayProof Notify 👋

You are using the Telegram companion for PayProof merchants.

What you can do from this menu:
• Receive payment notifications
• Monitor transaction status
• View payment summaries

Before you can see payment information, connect your PayProof merchant account inside the PayProof app. Account linking is not available in this chat yet.

Choose an option below to get started.`;

const LINKING_REQUIRED_TEXT: Record<AccountScopedAction, string> = {
  payment_summary: `📊 Payment summary

No PayProof merchant account is linked to this chat, so there is no payment data to show. No totals, balances or transactions are generated here — only your verified PayProof account can provide them.

Account linking will be available in a future update.`,
  transactions: `🧾 Recent transactions

No PayProof merchant account is linked to this chat, so there are no verified payments to list. A receipt is only issued for a payment that exists in your PayProof account; nothing is created here.

Account linking will be available in a future update.`,
  pending: `⏳ Pending payments

No PayProof merchant account is linked to this chat, so there are no pending payment requests to show. Requests are scoped to the merchant the chat is linked to, and this chat is not linked to any merchant yet.

Account linking will be available in a future update.`,
};

export function accountLinkingRequiredText(action: AccountScopedAction): string {
  return LINKING_REQUIRED_TEXT[action];
}

export const SETTINGS_TEXT = `⚙️ Settings

Account
• Merchant account: Not linked
• Merchant wallet: None
• Active PayProof session: None

Notifications
• Payment notifications: Not configured
• Saved preferences: None

This chat never displays wallet secrets, session tokens or server keys. Account linking, the linked wallet and saved notification preferences will be managed here once linking is available.`;

export const HELP_TEXT = `PayProof Notify — Help

Commands
/start — Open the main menu
/help — Show this message
/status — Check bot and account status

Menu options
• 📊 Payment Summary — totals for your linked merchant account
• 🧾 Recent Transactions — verified payments and their receipts
• ⏳ Pending Payments — outstanding payment requests
• ⚙️ Settings — account and notification status
• ❓ Help — this message

No PayProof merchant account is linked to this chat yet, so payment data is not shown. Account linking will be available in a future update.`;

export const STATUS_TEXT = `PayProof Notify — Status

Bot: Online
Merchant account: Not linked
Merchant wallet: None
Payment notifications: Not configured

No merchant account is connected to this chat, so no payment data can be shown. Linking will be available in a future update.`;

export const UNKNOWN_COMMAND_TEXT = `Sorry, I don't recognize that command yet.

Available commands: /start, /help, /status.`;

export const FALLBACK_TEXT = `PayProof Notify is waiting for your next command.

Use /start to open the main menu, /help for available commands, or /status to check your connection status.`;

export const NON_TEXT_MESSAGE_TEXT = `I can only handle text messages and menu buttons. Use /start to open the main menu or /help for available commands.`;

export const UNKNOWN_CALLBACK_TEXT = "This option is not available yet.";

export const STALE_CALLBACK_TEXT = "That menu option is out of date. Use /start to reopen the menu.";

/**
 * Registers every bot handler.
 *
 * grammY runs middleware in registration order and stops at the first handler
 * that does not call `next()`. The specific button handlers therefore have to be
 * registered *before* the `callback_query` fallback — a catch-all placed first
 * consumes every button and the menu appears dead.
 */
export function registerHandlers(bot: Bot): void {
  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------
  bot.command("start", async (ctx) => {
    await ctx.reply(MAIN_MENU_TEXT, { reply_markup: mainMenuKeyboard() });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT, { reply_markup: mainMenuKeyboard() });
  });

  bot.command("status", async (ctx) => {
    await ctx.reply(STATUS_TEXT);
  });

  // -------------------------------------------------------------------------
  // Menu buttons — one handler per action, each answering the callback query
  // -------------------------------------------------------------------------
  bot.callbackQuery("payment_summary", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(accountLinkingRequiredText("payment_summary"), {
      reply_markup: backToMenuKeyboard(),
    });
  });

  bot.callbackQuery("transactions", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(accountLinkingRequiredText("transactions"), {
      reply_markup: backToMenuKeyboard(),
    });
  });

  bot.callbackQuery("pending", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(accountLinkingRequiredText("pending"), {
      reply_markup: backToMenuKeyboard(),
    });
  });

  bot.callbackQuery("settings", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(SETTINGS_TEXT, { reply_markup: backToMenuKeyboard() });
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
    const data = ctx.callbackQuery?.data;

    // Always answer, otherwise Telegram shows a loading spinner on the button
    // until it times out.
    await ctx.answerCallbackQuery({
      text: data ? UNKNOWN_CALLBACK_TEXT : STALE_CALLBACK_TEXT,
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
