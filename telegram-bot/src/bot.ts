import "dotenv/config";
import { Bot, InlineKeyboard, Context, BotError } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN is missing. Check your .env file."
  );
}

const bot = new Bot(token);

// ---------------------------------------------------------------------------
// Centralized error handler
// ---------------------------------------------------------------------------
bot.catch((error: BotError<Context>) => {
  // Never log secrets/tokens. Keep the report actionable but safe.
  const safeError =
    error.error instanceof Error ? error.error.message : String(error.error);
  const update = error.ctx.update;
  const peer =
    update?.message?.from
      ? `user #${update.message.from.id}`
      : update?.callback_query?.from
        ? `user #${update.callback_query.from.id}`
        : "unknown peer";
  console.error(`[PayProof Notify error] ${peer}: ${safeError}`);
});

// ---------------------------------------------------------------------------
// Inline keyboard builders
// ---------------------------------------------------------------------------
const MAIN_MENU_KEYBOARD = new InlineKeyboard()
  .text("📊 Payment Summary", "menu:summary")
  .text("🧾 Recent Transactions", "menu:transactions")
  .text("⏳ Pending Payments", "menu:pending")
  .text("⚙️ Settings", "menu:settings")
  .text("❓ Help", "menu:help");

const BACK_TO_MENU_KEYBOARD = new InlineKeyboard()
  .text("🔙 Back to Menu", "menu:main");

// ---------------------------------------------------------------------------
// Shared reply helpers
// ---------------------------------------------------------------------------
async function sendMainMenu(ctx: Context) {
  await ctx.reply(
    `Welcome to PayProof Notify 👋

You are using the Telegram companion for PayProof merchants.

What you can do from this menu:
• Receive payment notifications
• Monitor transaction status
• View payment summaries

Before you can see payment information, connect your PayProof merchant account inside the PayProof app. Account linking is not available in this chat yet.

Choose an option below to get started.`,
    {
      reply_markup: MAIN_MENU_KEYBOARD,
    }
  );
}

async function sendAccountLinkingRequired(ctx: Context) {
  await ctx.reply(
    `This feature is coming soon.

To use Payment Summary, Recent Transactions, or Pending Payments, you will need to connect your PayProof merchant account first.

Account linking will be available in a future update. No payment information is shown here until your account is connected.`,
    { reply_markup: BACK_TO_MENU_KEYBOARD }
  );
}

async function sendSettingsPlaceholder(ctx: Context) {
  await ctx.reply(
    `⚙️ Settings

This is a placeholder settings screen.

Right now you can:
• Use /start to return to the main menu
• Use /help to see available commands
• Use /status to check bot and account status

Account and notification settings will be available after merchant account linking is enabled.`,
    { reply_markup: BACK_TO_MENU_KEYBOARD }
  );
}

async function sendHelpMessage(ctx: Context) {
  await ctx.reply(
    `PayProof Notify — Help

Available commands:
/start — Start PayProof Notify and open the main menu
/help — View this help message
/status — Check bot and account status

How this bot works:
• PayProof Notify is a Telegram companion for PayProof merchants.
• It will send payment notifications and let you check transaction status and payment summaries from Telegram.
• Payment information is not shown until your PayProof merchant account is connected.

Choose a menu option or type a command.`,
    { reply_markup: MAIN_MENU_KEYBOARD }
  );
}

async function sendStatusMessage(ctx: Context) {
  await ctx.reply(
    `PayProof Notify — Status

Bot: Online
Merchant account: Not connected
Payment notifications: Not configured

This reflects the current implementation. No merchant account is connected and payment notifications are not configured yet.`
  );
}

// ---------------------------------------------------------------------------
// /start
// ---------------------------------------------------------------------------
bot.command("start", async (ctx) => {
  await sendMainMenu(ctx);
});

// ---------------------------------------------------------------------------
// /help
// ---------------------------------------------------------------------------
bot.command("help", async (ctx) => {
  await sendHelpMessage(ctx);
});

// ---------------------------------------------------------------------------
// /status
// ---------------------------------------------------------------------------
bot.command("status", async (ctx) => {
  await sendStatusMessage(ctx);
});

// ---------------------------------------------------------------------------
// Callback query handler (inline keyboard)
// ---------------------------------------------------------------------------
bot.on("callback_query", async (ctx) => {
  const query = ctx.callbackQuery;
  if (!query) return;

  const data = query.data;
  if (!data) {
    await ctx.answerCallbackQuery();
    return;
  }

  try {
    if (data === "menu:main") {
      await ctx.answerCallbackQuery();
      await sendMainMenu(ctx);
    } else if (data === "menu:summary") {
      await ctx.answerCallbackQuery();
      await sendAccountLinkingRequired(ctx);
    } else if (data === "menu:transactions") {
      await ctx.answerCallbackQuery();
      await sendAccountLinkingRequired(ctx);
    } else if (data === "menu:pending") {
      await ctx.answerCallbackQuery();
      await sendAccountLinkingRequired(ctx);
    } else if (data === "menu:settings") {
      await ctx.answerCallbackQuery();
      await sendSettingsPlaceholder(ctx);
    } else if (data === "menu:help") {
      await ctx.answerCallbackQuery();
      await sendHelpMessage(ctx);
    } else {
      // Unknown callback: acknowledge gracefully
      await ctx.answerCallbackQuery({ text: "This option is not available yet." });
    }
  } catch (err) {
    // Ack the query so Telegram stops showing the loading spinner.
    await ctx.answerCallbackQuery().catch(() => {});
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Catch-all for unexpected text / messages (graceful handling)
// ---------------------------------------------------------------------------
bot.on("message", async (ctx) => {
  const text = ctx.message.text;
  if (!text) return;

  if (
    text === "/start" ||
    text === "/help" ||
    text === "/status"
  ) {
    // Handled by command handlers above; nothing extra needed.
    return;
  }

  if (text?.startsWith("/")) {
    await ctx.reply(
      `Sorry, I don't recognize that command yet.

Available commands: /start, /help, /status.`
    );
    return;
  }

  await ctx.reply(
    `PayProof Notify is waiting for your next command.

Use /start to open the main menu, /help for available commands, or /status to check your connection status.`
  );
});

// ---------------------------------------------------------------------------
// Register Telegram commands
// ---------------------------------------------------------------------------
bot.api
  .setMyCommands([
    { command: "start", description: "Start PayProof Notify" },
    { command: "help", description: "View help information" },
    { command: "status", description: "Check bot and account status" },
  ])
  .then(() => {
    console.log("Telegram command list registered.");
  })
  .catch((err) => {
    console.warn(
      "Could not register Telegram commands:",
      err instanceof Error ? err.message : String(err)
    );
  });

// ---------------------------------------------------------------------------
// Start bot
// ---------------------------------------------------------------------------
bot.start({
  onStart: (botInfo) => {
    console.log(`PayProof Notify is running as @${botInfo.username}`);
  },
});

// Graceful shutdown
process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
