# PayProof Telegram Bot (`telegram-bot`)

Standalone grammY bot for PayProof Notify. It talks to Supabase and the Solana
RPC directly and does not call the Next.js website at runtime. Updates are
received with long polling, so the process never opens an HTTP port or needs a
public URL.

The bot is an independent npm package with its own lockfile. Build and run it
from this directory; it does not rely on the repository root's `node_modules`.

## Requirements

Node.js 20+ (Node 22 recommended; it matches the current development
environment).

## Local development

```bash
cd telegram-bot
npm install
cp .env.example .env   # fill in real values; never commit .env
npm run dev            # tsx watch src/bot.ts
```

`npm run dev` starts the bot with long polling and restarts it when files
change. Stop it with `Ctrl+C` (the bot stops polling before exiting).

## Test and build

```bash
npm test               # 121 tests (handlers, balance, notification preferences)
npm run build          # tsc -> dist/
npx tsc --noEmit       # typecheck without emitting
```

Compiled start (after `npm run build`):

```bash
npm start              # node dist/bot.js
```

`npm start` also uses long polling. It is not a web server and exposes no port.

## Environment variables

Copy `telegram-bot/.env.example` to `telegram-bot/.env` and fill in the values.
The bot loads that file through `dotenv`; variables exported in your shell also
work and take precedence.

| Variable | Required | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot API token from @BotFather. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL. Must be the same project the website uses. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side service-role key. Never expose it to a browser or Telegram chat. |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | No | RPC endpoint for `/balance`. Defaults to the public Devnet endpoint when unset or invalid. |

Values are never logged by the bot. Missing required variables stop startup with
a message naming the variable.

## Runtime behaviour

- **Commands:** `/start`, `/menu`, `/help`, `/status`, `/summary`, `/balance`,
  `/transactions`, `/pending`, `/receipt`, `/unlink`, `/settings`,
  `/notifications`, plus the dashboard and preference buttons.
- **Private chats only:** commands and buttons are rejected in groups and
  supergroups, and merchant data is only served from the private chat stored on
  the active `telegram_links` row.
- **One instance per token:** Telegram allows a single long-polling consumer per
  bot token. Running a second copy (for example `npm run dev` while `npm start`
  is already running) produces `409 Conflict`.
- **Lifecycle:** handler errors are caught and logged without secrets; invalid
  tokens and polling conflicts exit with a clear message; `SIGTERM`/`SIGINT`
  stop long polling once via `bot.stop()`.

## Scope note

Real payment notifications are still created and sent by the website
(`src/lib/notifications/*`) when it verifies events. This package currently
sends preference test messages only; independent notification delivery is a
separate stage.

Hosting is not configured in this repository. The bot runs only through local
long polling.
