import "dotenv/config";
import { Bot, BotError, Context, GrammyError } from "grammy";
import { registerHandlers } from "./handlers.js";

/**
 * Reads a required environment variable.
 *
 * The message names the variable and where to configure it, so a failed Render
 * deploy is actionable without ever printing the value.
 */
function readRequiredEnv(name: string, description: string): string {
  const value = process.env[name];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `${name} is not set (${description}). ` +
        "Configure it in the Render service environment variables, " +
        "or in telegram-bot/.env when running locally."
    );
  }

  return value.trim();
}

function logInfo(message: string): void {
  console.log(`[telegram-bot] ${message}`);
}

function logError(message: string): void {
  console.error(`[telegram-bot] ${message}`);
}

/** Never logs the bot token or request payloads. */
function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Turns a startup failure into an actionable, secret-free message. */
function describeStartupError(error: unknown): string {
  if (error instanceof GrammyError) {
    if (error.error_code === 401) {
      return (
        "Telegram rejected the bot token (401 Unauthorized). " +
        "Check TELEGRAM_BOT_TOKEN in the service environment."
      );
    }

    if (error.error_code === 409) {
      return (
        "Telegram reported a polling conflict (409 Conflict). " +
        "Another bot instance is polling this token. Run exactly one worker " +
        "and stop any local `npm run dev` bot using the same token."
      );
    }

    return `Telegram Bot API error ${error.error_code}: ${error.description}`;
  }

  return safeErrorMessage(error);
}

const telegramBotToken = readRequiredEnv(
  "TELEGRAM_BOT_TOKEN",
  "Telegram Bot API token from @BotFather"
);
readRequiredEnv(
  "NEXT_PUBLIC_SUPABASE_URL",
  "Supabase project URL shared with the website"
);
readRequiredEnv(
  "SUPABASE_SERVICE_ROLE_KEY",
  "server-side Supabase service-role key"
);

const bot = new Bot(telegramBotToken);

/** How long shutdown may take before the process exits anyway. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

let isShuttingDown = false;

// ---------------------------------------------------------------------------
// Centralized error handler
// ---------------------------------------------------------------------------
bot.catch((error: BotError<Context>) => {
  // Never log secrets/tokens. Keep the report actionable but safe.
  const safeError = safeErrorMessage(error.error);
  const update = error.ctx.update;
  const peer =
    update?.message?.from
      ? `user #${update.message.from.id}`
      : update?.callback_query?.from
        ? `user #${update.callback_query.from.id}`
        : "unknown peer";
  logError(`[PayProof Notify error] ${peer}: ${safeError}`);
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
      command: "balance",
      description: "View your wallet SOL balance.",
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
    logInfo("Telegram commands list registered.");
  })
  .catch((error) => {
    logError(
      `Could not register Telegram commands: ${describeStartupError(error)}`
    );
  });

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    logInfo(`Received ${signal} while already shutting down; ignoring.`);
    return;
  }

  isShuttingDown = true;
  logInfo(`Received ${signal}. Stopping long polling…`);

  // Do not let a stuck getUpdates call hold the worker open until the platform
  // force-kills it.
  const forceExit = setTimeout(() => {
    logError("Shutdown timed out; exiting so the worker can restart.");
    process.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);

  forceExit.unref();

  try {
    await bot.stop();
    clearTimeout(forceExit);
    logInfo("Long polling stopped. Shutting down.");
    process.exit(0);
  } catch (error) {
    clearTimeout(forceExit);
    logError(`Error while stopping long polling: ${safeErrorMessage(error)}`);
    process.exit(1);
  }
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

// ---------------------------------------------------------------------------
// Start bot (long polling)
// ---------------------------------------------------------------------------
logInfo("Bot initialized; starting long polling…");

bot
  .start({
    onStart: (botInfo) => {
      logInfo(
        `Bot started successfully as @${botInfo.username}; long polling active.`
      );
    },
  })
  .catch((error) => {
    logError(`Failed to start long polling: ${describeStartupError(error)}`);
    process.exit(1);
  });
