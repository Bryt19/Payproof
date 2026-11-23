import { createHash } from "node:crypto";
import { createSupabaseClient } from "@/lib/payment-requests/supabase";
import {
  AI_DRAFT_IP_RULES,
  AI_DRAFT_UNKNOWN_IP_RULES,
  AI_DRAFT_WALLET_RULES,
  AI_DRAFT_WRITE_IP_RULES,
  AI_DRAFT_WRITE_UNKNOWN_IP_RULES,
  AI_DRAFT_WRITE_WALLET_RULES,
  CHALLENGE_GLOBAL_RULES,
  CHALLENGE_IP_RULES,
  CHALLENGE_UNKNOWN_IP_RULES,
  CHALLENGE_WALLET_RULES,
  VERIFY_IP_RULES,
  VERIFY_UNKNOWN_IP_RULES,
  VERIFY_WALLET_RULES,
  type RateLimitRule,
} from "./rate-limit-policy";

export const UNKNOWN_CLIENT_KEY = "unknown-ip";

export const TELEGRAM_LINK_RATE_LIMIT_MESSAGE =
  "Too many requests. Please try again later.";
export const TELEGRAM_LINK_RATE_LIMIT_UNAVAILABLE_MESSAGE =
  "Service temporarily unavailable. Please try again later.";
export const AUTH_RATE_LIMIT_MESSAGE =
  "Too many authentication requests. Please try again later.";

export type RateLimitOutcome =
  | { ok: true }
  | { ok: false; kind: "limited"; retryAfterSeconds: number }
  | { ok: false; kind: "unavailable" };

export type RateLimitStore = {
  consume: (input: {
    bucket: string;
    keyHash: string;
    limit: number;
    windowSeconds: number;
  }) => Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
};

function isValidIp(ip: string): boolean {
  // IPv4 check
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  if (ipv4Regex.test(ip)) return true;

  // IPv6 check
  const ipv6Regex =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]+|::(ffff(:0{1,4})?:)?((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1?[0-9])?[0-9])\.){3}(25[0-5]|(2[0-4]|1?[0-9])?[0-9]))$/;
  return ipv6Regex.test(ip);
}

export function resolveClientIp(
  headers: Headers | { get(name: string): string | null },
): string | null {
  if (process.env.VERCEL !== "1") {
    return null;
  }

  const vercelForwarded = headers.get("x-vercel-forwarded-for");
  const candidateRaw = vercelForwarded || headers.get("x-forwarded-for");
  if (!candidateRaw) return null;

  const first = candidateRaw.split(",")[0]?.trim();
  if (!first) return null;

  if (isValidIp(first)) {
    return first.toLowerCase();
  }

  return null;
}

export function hashRateLimitKey(bucket: string, identity: string): string {
  const pepper = process.env.AUTH_RATE_LIMIT_PEPPER;
  if (!pepper) {
    throw new Error("AUTH_RATE_LIMIT_PEPPER is missing");
  }

  return createHash("sha256")
    .update(`${bucket}:${identity}:${pepper}`, "utf8")
    .digest("hex");
}

function getDefaultStore(): RateLimitStore {
  return {
    consume: async ({ bucket, keyHash, limit, windowSeconds }) => {
      const supabase = createSupabaseClient();
      const { data, error } = await supabase.rpc("consume_auth_rate_limit", {
        p_bucket: bucket,
        p_key_hash: keyHash,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (!data) {
        return { allowed: true };
      }

      const row = Array.isArray(data) ? data[0] : data;
      return {
        allowed: Boolean(row?.allowed ?? row?.hits <= limit),
        retryAfterSeconds: row?.retry_after_seconds ?? undefined,
      };
    },
  };
}

async function applyRules(
  rules: readonly RateLimitRule[],
  identity: string,
  store: RateLimitStore,
): Promise<RateLimitOutcome> {
  let maxRetryAfter = 0;
  let isLimited = false;

  for (const rule of rules) {
    const keyHash = hashRateLimitKey(rule.bucket, identity);
    const result = await store.consume({
      bucket: rule.bucket,
      keyHash,
      limit: rule.limit,
      windowSeconds: rule.windowSeconds,
    });

    if (!result.allowed) {
      isLimited = true;
      const retryAfter = result.retryAfterSeconds ?? rule.windowSeconds;
      if (retryAfter > maxRetryAfter) {
        maxRetryAfter = retryAfter;
      }
    }
  }

  if (isLimited) {
    return { ok: false, kind: "limited", retryAfterSeconds: maxRetryAfter };
  }

  return { ok: true };
}

export type RateLimitAction =
  | "challenge"
  | "verify"
  | "telegram-link-token"
  | "ai-payment-draft"
  | "ai-payment-draft-write";

export async function checkClientRateLimit(
  action: RateLimitAction,
  headers: Headers | { get(name: string): string | null },
  store?: RateLimitStore,
): Promise<RateLimitOutcome> {
  try {
    const activeStore = store ?? getDefaultStore();
    const clientIp = resolveClientIp(headers);

    if (action === "challenge") {
      const globalKey = "global";
      const globalOutcome = await applyRules(
        CHALLENGE_GLOBAL_RULES,
        globalKey,
        activeStore,
      );
      if (!globalOutcome.ok) return globalOutcome;

      if (clientIp) {
        return await applyRules(
          CHALLENGE_IP_RULES,
          `ip:${clientIp}`,
          activeStore,
        );
      } else {
        return await applyRules(
          CHALLENGE_UNKNOWN_IP_RULES,
          UNKNOWN_CLIENT_KEY,
          activeStore,
        );
      }
    }

    if (action === "verify") {
      if (clientIp) {
        return await applyRules(VERIFY_IP_RULES, `ip:${clientIp}`, activeStore);
      } else {
        return await applyRules(
          VERIFY_UNKNOWN_IP_RULES,
          UNKNOWN_CLIENT_KEY,
          activeStore,
        );
      }
    }

    if (action === "telegram-link-token") {
      if (clientIp) {
        return await applyRules(
          CHALLENGE_IP_RULES,
          `ip:${clientIp}`,
          activeStore,
        );
      } else {
        return await applyRules(
          CHALLENGE_UNKNOWN_IP_RULES,
          UNKNOWN_CLIENT_KEY,
          activeStore,
        );
      }
    }

    if (action === "ai-payment-draft") {
      if (clientIp) {
        return await applyRules(AI_DRAFT_IP_RULES, `ip:${clientIp}`, activeStore);
      } else {
        return await applyRules(
          AI_DRAFT_UNKNOWN_IP_RULES,
          UNKNOWN_CLIENT_KEY,
          activeStore,
        );
      }
    }

    if (action === "ai-payment-draft-write") {
      if (clientIp) {
        return await applyRules(
          AI_DRAFT_WRITE_IP_RULES,
          `ip:${clientIp}`,
          activeStore,
        );
      } else {
        return await applyRules(
          AI_DRAFT_WRITE_UNKNOWN_IP_RULES,
          UNKNOWN_CLIENT_KEY,
          activeStore,
        );
      }
    }

    return { ok: true };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export async function checkWalletRateLimit(
  action: RateLimitAction,
  walletAddress: string,
  store?: RateLimitStore,
): Promise<RateLimitOutcome> {
  try {
    const activeStore = store ?? getDefaultStore();
    const identity = `wallet:${walletAddress}`;

    if (action === "challenge" || action === "telegram-link-token") {
      return await applyRules(CHALLENGE_WALLET_RULES, identity, activeStore);
    }

    if (action === "verify") {
      return await applyRules(VERIFY_WALLET_RULES, identity, activeStore);
    }

    if (action === "ai-payment-draft") {
      return await applyRules(AI_DRAFT_WALLET_RULES, identity, activeStore);
    }

    if (action === "ai-payment-draft-write") {
      return await applyRules(AI_DRAFT_WRITE_WALLET_RULES, identity, activeStore);
    }

    return { ok: true };
  } catch {
    return { ok: false, kind: "unavailable" };
  }
}

export function rateLimitResponseInit(outcome: RateLimitOutcome): {
  status: number;
  headers: Record<string, string>;
  body: { error: string };
} {
  if (!outcome.ok && outcome.kind === "limited") {
    return {
      status: 429,
      headers: {
        "retry-after": String(outcome.retryAfterSeconds),
        "cache-control": "no-store",
      },
      body: { error: AUTH_RATE_LIMIT_MESSAGE },
    };
  }

  return {
    status: 503,
    headers: { "cache-control": "no-store" },
    body: { error: "Authentication is temporarily unavailable." },
  };
}
