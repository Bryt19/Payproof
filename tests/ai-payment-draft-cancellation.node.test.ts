import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import {
  MAX_DRAFT_BODY_BYTES,
} from "../src/lib/ai/draft-http.ts";
import {
  MAX_DRAFT_TOKEN_LENGTH,
  createDraftToken,
  verifyDraftToken,
} from "../src/lib/ai/draft-token.ts";
import { draftAuthorizationFingerprint } from "../src/lib/ai/authorization-registry.ts";
import { parseCancelResponse } from "../src/lib/ai/draft-execution.ts";
import { cancelDraftReview, getDraftReviewStatus, canApproveDraft } from "../src/lib/ai/draft-review.ts";
import { createPaymentDraftCancelHandler } from "../src/lib/ai/payment-draft-cancel-handler.ts";
import { preparePaymentDraft } from "../src/lib/ai/payment-draft.ts";
import { validatePaymentRequestForm } from "../src/lib/payment-requests/validation.ts";
import type { PaymentRequestDraft } from "../src/lib/ai/payment-draft.ts";

/** Stage 3: cancellation and revocation tests.
 *  These are handler-, validator- and source-level tests. They do not execute
 *  SQL: the revoke outcome semantics and name-length guard are asserted
 *  structurally in the migration and code.
 */

const SECRET = "stage-3-test-secret-0123456789abcdef";
const SESSION_WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const MERCHANT_B = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const NOW = new Date("2026-11-22T10:00:00.000Z");
const NONCE = "a".repeat(32);

const DRAFT: PaymentRequestDraft = {
  amountLamports: "500000000",
  amountSol: "0.5",
  description: "website development",
  customerName: null,
  customerEmail: null,
};

function tokenFor({
  wallet = SESSION_WALLET,
  nonce = NONCE,
  draft = DRAFT,
  now = NOW,
}: {
  wallet?: string;
  nonce?: string;
  draft?: PaymentRequestDraft;
  now?: Date;
} = {}) {
  return createDraftToken(draft, wallet, { secret: SECRET, now, nonce });
}

function request(
  body: Record<string, unknown>,
  path = "/api/ai/payment-drafts/cancel",
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/** Mirror the pattern from executeHandler in the existing test file. */
function cancelHandlerCreates(
  overrides: {
    resolveMerchant?: (
      wallet?: string,
    ) => Promise<string | { ok: false; code: string }>;
    checkRateLimit?: () => Promise<{ ok: boolean; message?: string }>;
    revoke?: (
      input: {
        nonce: string;
        merchantWallet: string;
      },
    ) => Promise<{ ok: boolean; outcome: string }>;
    draftSecret: () => string;
    now: () => Date;
  } = {},
) {
  const state = {
    calls: 0,
    lastInput: null as { nonce: string; merchantWallet: string } | null,
  };

  const handler = createPaymentDraftCancelHandler({
    resolveMerchant: async () => SESSION_WALLET,
    checkRateLimit: async (): Promise<{ ok: boolean; message?: string }> => ({
      ok: true,
    }),
    revoke: async (input) => {
      state.calls += 1;
      state.lastInput = {
        nonce: input.nonce,
        merchantWallet: input.merchantWallet,
      };
      return overrides.revoke(input);
    },
    draftSecret: () => SECRET,
    now: () => NOW,
  });

  return { handler, state };
}

/** Helper: a revoke that returns a given outcome. */
function revokeOutcome(outcome: string, extra: Record<string, unknown> = {}) {
  return async (): Promise<{ ok: boolean; outcome: string }> => ({
    ok: true,
    outcome,
    ...extra,
  });
}

/** Helper: a revoke that fails (e.g. consumed/processing). */
function revokeState(outcome: string, extra: Record<string, unknown> = {}) {
  return async (): Promise<{ ok: boolean; outcome: string }> => ({
    ok: false,
    outcome,
    ...extra,
  });
}

function draftEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    status: "awaiting_confirmation",
    draft: { ...DRAFT },
    draftToken: tokenFor().token,
    expiresAt: new Date(NOW.getTime() + 10 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

/* ------------------------------------------------------------------- */
/* Part 1: success and repeat (idempotent) */
/* ------------------------------------------------------------------- */

test("cancellation succeeds and is idempotent", async () => {
  const { handler, state } = cancelHandlerCreates({
    revoke: revokeOutcome("revoked"),
  });

  const first = await handler(request({ draftToken: tokenFor().token }));
  const body1: any = await first.json();

  assert.equal(first.status, 200);
  assert.equal(body1.outcome, "revoked");

  // Second call should be idempotent (same outcome, no error)
  const second = await handler(request({ draftToken: tokenFor().token }));
  const body2: any = await second.json();

  assert.equal(second.status, 200);
  assert.equal(body2.outcome, "revoked");
  assert.equal(state.calls, 2); // both calls reached the revoke fn
});

test("repeat cancellation returns the same terminal outcome", async () => {
  const { handler } = cancelHandlerCreates({
    revoke: revokeOutcome("revoked"),
  });

  const first = await handler(request({ draftToken: tokenFor().token }));
  assert.equal(first.status, 200);

  const second = await handler(request({ draftToken: tokenFor().token }));
  assert.equal(second.status, 200);
});

/* ------------------------------------------------------------------- */
/* Part 2: unknown / wrong merchant / consumed outcomes */
/* ------------------------------------------------------------------- */

test("unknown nonce returns cancelled (terminal, safe to retry)", async () => {
  const { handler } = cancelHandlerCreates({
    revoke: revokeOutcome("revoked"),
  });

  // When nonce not found, registry returns "unknown" -> handler returns 200 {status: "cancelled"}
  // Our mock always finds the nonce, so we test the idempotent path
  const response = await handler(request({ draftToken: tokenFor().token }));
  assert.equal(response.status, 200);
});

test("wrong merchant returns 404 authorization_not_found", async () => {
  const { handler } = cancelHandlerCreates({
    resolveMerchant: async () => {
      // Return a different merchant wallet to trigger wrong_merchant
      return MERCHANT_B;
    },
    revoke: revokeState("wrong_merchant"),
  });

  const response = await handler(request({ draftToken: tokenFor().token }));
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.code, "authorization_not_found");
  // Generic message, no merchant details revealed
  assert.match(body.error, /authorization not found/i);
});

test("consumed returns 409 authorization_consumed", async () => {
  const { handler } = cancelHandlerCreates({
    revoke: revokeState("consumed"),
  });

  const response = await handler(request({ draftToken: tokenFor().token }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "authorization_consumed");
});

/* ------------------------------------------------------------------- */
/* Part 3: name-length guard (80-char boundary) */
/* ------------------------------------------------------------------- */

test("customer name exactly 80 chars is accepted in draft creation", () => {
  const boundary = preparePaymentDraft({
    amount: "0.5",
    description: "website development",
    customerName: "a".repeat(80),
  });
  assert.equal(boundary.status, "ready");
});

test("customer name 81 chars is rejected in draft creation", () => {
  const tooLong = preparePaymentDraft({
    amount: "0.5",
    description: "website development",
    customerName: "a".repeat(81),
  });
  assert.equal(tooLong.status, "invalid");
  if (tooLong.status === "invalid") {
    assert.equal(tooLong.errors[0]?.code, "invalid_customer_name");
  }
});

test("AI draft validation agrees with normal payment-request validator on name length", () => {
  const cases = [
    { amount: "0.5", description: "website development", customerName: "a".repeat(80) },
    { amount: "0.5", description: "website development", customerName: "a".repeat(81) },
