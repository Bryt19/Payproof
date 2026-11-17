import "dotenv/config";
import { Bot, BotError, Context } from "grammy";
import { registerHandlers } from "./handlers.js";

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
// Commands and menu handlers
// ---------------------------------------------------------------------------
registerHandlers(bot);

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
