import { createHash, randomBytes } from "node:crypto";
import { createSupabaseClient } from "@/lib/payment-requests/supabase";
import { DRAFT_TOKEN_TTL_SECONDS } from "./draft-token";
import type { PaymentRequestDraft } from "./payment-draft";

/**
 * Server-only registry for AI payment-draft authorizations.
 *
 * The registry is the durable source of truth for whether a signed draft token
 * may still be executed. It is never imported by client components, never
 * exposed through RLS, and all writes go through the service-role Supabase
 * client or the service-role-only RPCs in
 * 20261122120000_ai_payment_draft_authorizations.sql.
 */

export const AI_DRAFT_AUTHORIZATION_TABLE = "ai_payment_draft_authorizations";

export type AuthorizationRegistryFailure = {
  ok: false;
  code: "unavailable" | "conflict";
  message: string;
};

export type RegisterAuthorizationResult =
  | { ok: true }
  | AuthorizationRegistryFailure;

export type ReauthorizeOutcome =
  | "reauthorized"
  | "unknown"
  | "wrong_merchant"
  | "revoked"
  | "consumed"
  | "processing"
  | "expired"
  | "invalid_request";

export type ReauthorizeAuthorizationResult =
  | { ok: true; outcome: ReauthorizeOutcome }
  | AuthorizationRegistryFailure;

/**
 * Outcomes of a cancellation. `revoked` and `unknown` are both safe terminal
 * results for the caller (the nonce cannot be executed either way); `consumed`
 * and `processing` mean an approval already owns the authorization.
 */
export type RevokeOutcome =
  | "revoked"
  | "unknown"
  | "wrong_merchant"
  | "consumed"
  | "processing"
  | "invalid_request";

export type RevokeAuthorizationResult =
  | { ok: true; outcome: RevokeOutcome }
  | { ok: false; outcome: RevokeOutcome }
  | AuthorizationRegistryFailure;

const REVOKE_OUTCOMES: readonly RevokeOutcome[] = [
  "revoked",
  "unknown",
  "wrong_merchant",
  "consumed",
  "processing",
  "invalid_request",
];

export function generateDraftNonce(): string {
  return randomBytes(16).toString("hex");
}

export function getDraftAuthorizationExpiry(now: Date): string {
  return new Date(now.getTime() + DRAFT_TOKEN_TTL_SECONDS * 1000).toISOString();
}

function stableDraft(draft: PaymentRequestDraft) {
  return {
    amountLamports: draft.amountLamports,
    description: draft.description,
    customerName: draft.customerName,
    customerEmail: draft.customerEmail,
  };
}

/**
 * Fingerprint binding one nonce, one merchant and exactly one draft payload.
 * Stored at registration and checked again at execution, so a valid signature
 * cannot be combined with a different registry record.
 */
export function draftAuthorizationFingerprint(
  draft: PaymentRequestDraft,
  merchantWallet: string,
  nonce: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        v: 1,
        nonce,
        merchantWallet,
        draft: stableDraft(draft),
      }),
      "utf8",
    )
    .digest("hex");
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function readOutcome(value: Record<string, unknown> | null): string | null {
  return typeof value?.outcome === "string" ? value.outcome : null;
}

/**
 * Registers a freshly signed draft nonce as active. Callers must not return a
 * token if this fails.
 */
export async function registerDraftAuthorization(input: {
  nonce: string;
  merchantWallet: string;
  expiresAt: string;
  fingerprint: string;
}): Promise<RegisterAuthorizationResult> {
  try {
    const supabase = createSupabaseClient();
    const { error } = await supabase.from(AI_DRAFT_AUTHORIZATION_TABLE).insert({
      nonce: input.nonce,
      merchant_wallet: input.merchantWallet,
      status: "active",
      draft_fingerprint: input.fingerprint,
      expires_at: input.expiresAt,
    });

    if (error) {
      console.error(
        `[ai/payment-drafts] authorization registration failed: code=${error.code ?? "unknown"}`,
      );

      return {
        ok: false,
        code: error.code === "23505" ? "conflict" : "unavailable",
        message: "Could not register the draft authorization.",
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      code: "unavailable",
      message: "Could not register the draft authorization.",
    };
  }
}

/**
 * Atomically revokes the old nonce and registers the new one. Both changes are
 * in one SQL transaction.
 */
export async function reauthorizeDraftAuthorization(input: {
  oldNonce: string;
  newNonce: string;
  merchantWallet: string;
  newExpiresAt: string;
  newFingerprint: string;
}): Promise<ReauthorizeAuthorizationResult> {
  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase.rpc(
      "reauthorize_ai_payment_draft_authorization",
      {
        p_old_nonce: input.oldNonce,
        p_new_nonce: input.newNonce,
        p_merchant_wallet: input.merchantWallet,
        p_new_expires_at: input.newExpiresAt,
        p_new_fingerprint: input.newFingerprint,
      },
    );

    if (error) {
      console.error(
        `[ai/payment-drafts] reauthorization failed: code=${error.code ?? "unknown"}`,
      );
      return {
        ok: false,
        code: "unavailable",
        message: "Could not re-authorize the draft.",
      };
    }

    const outcome = readOutcome(parseJsonObject(data)) as ReauthorizeOutcome | null;

    if (
      !outcome ||
      ![
        "reauthorized",
        "unknown",
        "wrong_merchant",
        "revoked",
        "consumed",
        "processing",
        "expired",
        "invalid_request",
      ].includes(outcome)
    ) {
      return {
        ok: false,
        code: "unavailable",
        message: "The authorization service returned an unexpected result.",
      };
    }

    return { ok: true, outcome };
  } catch {
    return {
      ok: false,
      code: "unavailable",
      message: "Could not re-authorize the draft.",
    };
  }
}

/**
 * Revokes one authorization so its signed token can no longer be executed.
 *
 * The merchant wallet must come from the authenticated session. The RPC locks
 * the nonce row, so this is race-safe against a simultaneous execution: either
 * the execution wins (this returns `consumed`) or this wins (the execution
 * returns `revoked`). Repeating the call is safe and idempotent.
 *
 * Logs carry the PostgREST error code only — never the nonce, the draft token
 * or any signing secret.
 */
export async function revokeDraftAuthorization(input: {
  nonce: string;
  merchantWallet: string;
}): Promise<RevokeAuthorizationResult> {
  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase.rpc(
      "revoke_ai_payment_draft_authorization",
      {
        p_nonce: input.nonce,
        p_merchant_wallet: input.merchantWallet,
      },
    );

    if (error) {
      console.error(
        `[ai/payment-drafts] cancellation failed: code=${error.code ?? "unknown"}`,
      );
      return {
        ok: false,
        code: "unavailable",
        message: "Could not cancel the draft.",
      };
    }

    const outcome = readOutcome(parseJsonObject(data)) as RevokeOutcome | null;

    if (!outcome || !REVOKE_OUTCOMES.includes(outcome)) {
      return {
        ok: false,
        code: "unavailable",
        message: "The authorization service returned an unexpected result.",
      };
    }

    return { ok: true, outcome };
  } catch {
    return {
      ok: false,
      code: "unavailable",
      message: "Could not cancel the draft.",
    };
  }
}
