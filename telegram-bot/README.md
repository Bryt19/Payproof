# PayProof Telegram Bot (`telegram-bot`)

Standalone grammY bot for PayProof Notify. It talks to Supabase and the Solana
RPC directly and does not call the Next.js website at runtime. Long polling is
used, so the process never opens an HTTP port.

The bot is an independent npm package with its own lockfile. Build and run it
from this directory; it does not rely on the repository root's `node_modules`.

## Local development

Requirements: Node.js 20+ (Node 22 recommended; it matches the current
development environment).

```bash
cd telegram-bot
npm install
cp .env.example .env   # fill in real values; never commit .env
npm test
npm run build
npm run dev            # tsx watch src/bot.ts
```

Production start:

```bash
npm start              # node dist/bot.js
```

## Render configuration

Create the service as a **Background Worker** (not a Web Service):

| Setting | Value |
|---|---|
| Service type | Background Worker |
| Root directory | `telegram-bot` |
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Instance count | `1` |
| HTTP port / health check | Not required (long polling, no HTTP server) |

Node version: set `NODE_VERSION=22` (or use a Node 22 service image). The
package declares `engines.node >= 20`.

`@supabase/supabase-js`, `typescript`, and `@types/node` are production
dependencies so the build works even when dev dependencies are skipped.

## Environment variables

Set these on the Render service. Values are never logged by the bot.

| Variable | Required | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot API token from @BotFather. Also used by the website's notification sender, so keep both environments in sync. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL. Must be the same project the website uses. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side service-role key. Never expose it to a browser or Telegram chat. |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | No | RPC endpoint for `/balance`. Defaults to the public Devnet endpoint when unset or invalid. |

`telegram-bot/.env.example` contains placeholders for all four variables.

## Runtime behaviour

- **Commands:** `/start`, `/menu`, `/help`, `/status`, `/summary`, `/balance`,
  `/transactions`, `/pending`, `/receipt`, `/unlink`, `/settings`,
  `/notifications`, plus the dashboard and preference buttons.
- **Private chats only:** commands and buttons are rejected in groups and
  supergroups, and merchant data is only served from the private chat stored on
  the active `telegram_links` row.
- **Lifecycle:** startup failures are logged without secrets and exit non-zero;
  `SIGTERM`/`SIGINT` stop long polling once via `bot.stop()`.
- **Single instance:** Telegram allows only one long-polling consumer per bot
  token. Running a second worker (or a local `npm run dev` with the same token)
  produces `409 Conflict`.

## Scope note

Real payment notifications are still created and sent by the website
(`src/lib/notifications/*`) when it verifies events. This package currently
sends preference test messages only; independent notification delivery is a
separate stage.
