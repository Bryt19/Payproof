import { createHash, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Telegram link-token primitives (server-side only)
//
// This module is the single source of truth for how a Telegram linking token is
// generated, hashed, and turned into a deep link. It is deliberately free of
// Next.js and Supabase imports so it can be exercised directly by the test
// suite, and so the bot can reuse the exact same hashing rule when it redeems a
// token with public.redeem_telegram_token().
//
// Hashing contract: the hash is SHA-256 over the UTF-8 bytes of the base64url
// raw token string. The bot receives that exact string inside the `/start`
// payload (`link_<RAW_TOKEN>`), so it can reproduce the hash without
// reconstructing the original random buffer. Changing this rule would break
// every outstanding link token, so it lives in one place on purpose.
// ---------------------------------------------------------------------------

/** Number of cryptographically secure random bytes in a raw token. */
export const LINK_TOKEN_BYTES = 32;

/** Token lifetime in seconds, matching the SQL function's 15-minute expiry. */
export const LINK_TOKEN_EXPIRY_SECONDS = 900;

/** Telegram bot that receives the `/start link_<token>` deep link. */
export const TELEGRAM_BOT_USERNAME = "PayProofNotifyBot";

/** Prefix that marks a `/start` payload as a PayProof account link. */
export const LINK_START_PREFIX = "link_";

export type GeneratedLinkToken = {
  /** base64url token handed to the merchant only inside the deep link. */
  rawToken: string;
  /** SHA-256 hex digest stored in telegram_link_tokens.token_hash. */
  tokenHash: string;
};

/** SHA-256 of the raw token string, as lowercase hexadecimal (64 chars). */
export function hashLinkToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** Generates a fresh single-use token and the hash that is safe to store. */
export function generateLinkToken(): GeneratedLinkToken {
  const rawToken = randomBytes(LINK_TOKEN_BYTES).toString("base64url");

  return { rawToken, tokenHash: hashLinkToken(rawToken) };
}

/** True when `value` is exactly 64 lowercase hexadecimal characters. */
export function isTokenHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/** Builds the deep link that starts the bot with a linking payload. */
export function buildTelegramDeepLink(rawToken: string): string {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${LINK_START_PREFIX}${rawToken}`;
}

// ---------------------------------------------------------------------------
// RPC result mapping
//
// Kept here rather than inside the route handler so the status → HTTP response
// rules can be tested without a running Next.js server, Supabase, or Postgres.
// ---------------------------------------------------------------------------

// Statuses the SQL function can return, plus the older vocabulary kept for
// databases where the corrected function has not been applied yet.
export type LinkTokenRpcStatus =
  | "success"
  | "merchant_already_linked"
  | "active_link"
  | "hash_conflict"
  | "conflict"
  | "invalid_merchant"
  | "invalid_token_hash"
  | "invalid_request";

export type LinkTokenRpcResult =
  | {
      status?: string | null;
      detail?: string | null;
      expires_at?: string | Date | null;
      expires_in_seconds?: number | null;
    }
  | null
  | undefined;

export type LinkTokenOutcome =
  | {
      ok: true;
      status: 200;
      body: {
        success: true;
        telegramLink: string;
        expiresAt: string;
        expiresInSeconds: number;
      };
    }
  | {
      ok: false;
      status: 409 | 503;
      /** True when a fresh token may succeed (hash/unique collision). */
      retryable: boolean;
      body: { error: string };
    };

export const ACTIVE_LINK_MESSAGE =
  "Merchant already has an active Telegram link. Please unlink the existing Telegram account before linking another one.";

export const CONFLICT_MESSAGE =
  "Concurrent token generation detected. Please retry.";

export const HASH_CONFLICT_MESSAGE =
  "Token generation collided. Please retry.";

export const UNAVAILABLE_MESSAGE =
  "Could not generate a linking token. Please try again.";

function toIsoString(value: string | Date | null | undefined): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }

  return null;
}

/**
 * Maps an `atomic_generate_telegram_link_token` result to an HTTP outcome.
 *
 * The deep link is only built when the database reports `success`, so the raw
 * token is never echoed back for a rejected request. Error bodies never include
 * the raw token or the hash.
 */
export function resolveLinkTokenOutcome(
  result: LinkTokenRpcResult,
  rawToken: string
): LinkTokenOutcome {
  const status = result?.status;
  const detail = result?.detail?.trim();

  if (status === "success") {
    const expiresAt = toIsoString(result?.expires_at);

    if (!expiresAt) {
      return {
        ok: false,
        status: 503,
        retryable: false,
        body: { error: UNAVAILABLE_MESSAGE },
      };
    }

    const expiresInSeconds =
      typeof result?.expires_in_seconds === "number" &&
      Number.isFinite(result.expires_in_seconds) &&
      result.expires_in_seconds > 0
        ? Math.round(result.expires_in_seconds)
        : LINK_TOKEN_EXPIRY_SECONDS;

    return {
      ok: true,
      status: 200,
      body: {
        success: true,
        telegramLink: buildTelegramDeepLink(rawToken),
        expiresAt,
        expiresInSeconds,
      },
    };
  }

  // The SQL function returns `merchant_already_linked`; `active_link` is the
  // older spelling kept so a database that predates the current function still
  // maps to the same 409 the UI expects.
  if (status === "merchant_already_linked" || status === "active_link") {
    return {
      ok: false,
      status: 409,
      retryable: false,
      body: { error: detail || ACTIVE_LINK_MESSAGE },
    };
  }

  // A hash collision is retryable: the route regenerates a token and tries
  // once more, exactly as the SQL contract instructs.
  if (status === "hash_conflict") {
    return {
      ok: false,
      status: 409,
      retryable: true,
      body: { error: detail || HASH_CONFLICT_MESSAGE },
    };
  }

  if (status === "conflict") {
    return {
      ok: false,
      status: 409,
      retryable: true,
      body: { error: detail || CONFLICT_MESSAGE },
    };
  }

  // invalid_merchant / invalid_token_hash cannot occur from this route (the
  // wallet comes from the session and the hash is generated here), so they are
  // programming errors. Like unknown statuses and null results, they are
  // reported as unavailable without echoing database detail back to the client.
  return {
    ok: false,
    status: 503,
    retryable: false,
    body: { error: UNAVAILABLE_MESSAGE },
  };
}
