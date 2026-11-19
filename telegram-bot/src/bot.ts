import "dotenv/config";
import { Bot, BotError, Context } from "grammy";
import { registerHandlers } from "./handlers.js";

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!telegramBotToken) {
  throw new Error(
    "TELEGRAM_BOT_TOKEN is missing. Check your .env file."
  );
}

if (!supabaseUrl) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL is missing. Check your .env file."
  );
}

if (!supabaseServiceRoleKey) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is missing. Check your .env file."
  );
};
const bot = new Bot(telegramBotToken);


// ---------------------------------------------------------------------------// Bot initialization complete// ---------------------------------------------------------------------------
console.log("[telegram-bot] Bot initialized, token present");
// ---------------------------------------------------------------------------// Centralized error handler// ---------------------------------------------------------------------------
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
// ---------------------------------------------------------------------------// Commands and menu handlers// ---------------------------------------------------------------------------
registerHandlers(bot);


// ---------------------------------------------------------------------------
// Register Telegram commands
// ---------------------------------------------------------------------------
bot.api
  .setMyCommands([
    {
      command: "start",
      description: "Start PayProof Notify and link your merchant account.",
    },
    { command: "help", description: "View available commands." },
    {
      command: "status",
      description: "Check merchant connection and bot status.",
    },
    {
      command: "summary",
      description: "View payment statistics and verified payment totals.",
    },
    {
      command: "transactions",
      description: "View recent verified transactions.",
    },
    { command: "pending", description: "View outstanding payment requests." },
    { command: "receipt", description: "Retrieve a verified payment receipt." },
    { command: "unlink", description: "Securely disconnect your merchant account." },
    {
      command: "settings",
      description: "Manage account and notification preferences.",
    },
    {
      command: "notifications",
      description: "Manage payment notification preferences.",
    },
    { command: "menu", description: "Open the merchant dashboard." },
  ])
  .then(() => {
    console.log("[telegram-bot] Telegram commands list registered.");
  })
  .catch((err) => {
    console.warn(
      "[telegram-bot] Could not register Telegram commands:",
      err instanceof Error ? err.message : String(err)
    );
  });

// ---------------------------------------------------------------------------
// Start bot
// ---------------------------------------------------------------------------
bot.start({
  onStart: (botInfo) => {
    console.log(
      `[telegram-bot] Bot started successfully as @${botInfo.username}, long polling active`
    );
  },
});

// Graceful shutdown
process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());