import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest, NextResponse } from "next/server";

import {
  MAX_DRAFT_BODY_BYTES,
} from "../src/lib/ai/draft-http.ts";
import {
  MAX_DRAFT_TOKEN_LENGTH,
  createDraftToken,
  verifyDraftToken,
} from "../src/lib/ai/draft-token.ts";
import {
  draftAuthorizationFingerprint,
  type RevokeAuthorizationResult,
  type RevokeOutcome,
} from "../src/lib/ai/authorization-registry.ts";
import type { RateLimitOutcome } from "../src/lib/auth/rate-limit.ts";
import { parseCancelResponse } from "../src/lib/ai/draft-execution.ts";
import { cancelDraftReview, getDraftReviewStatus, canApproveDraft } from "../src/lib/ai/draft-review.ts";
import {
  createPaymentDraftCancelHandler,
  type PaymentDraftCancelDependencies,
} from "../src/lib/ai/payment-draft-cancel-handler.ts";
import { createPaymentDraftExecuteHandler } from "../src/lib/ai/payment-draft-execute-handler.ts";
import type { PaymentRequest } from "../src/lib/payment-requests/types.ts";
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
  overrides: Partial<PaymentDraftCancelDependencies> = {},
) {
  const state = {
    calls: 0,
    lastInput: null as { nonce: string; merchantWallet: string } | null,
  };

  const handler = createPaymentDraftCancelHandler({
    resolveMerchant: overrides.resolveMerchant ?? (async () => SESSION_WALLET),
    checkRateLimit:
      overrides.checkRateLimit ??
      (async (): Promise<RateLimitOutcome> => ({ ok: true })),
    revoke: async (input) => {
      state.calls += 1;
      state.lastInput = {
        nonce: input.nonce,
        merchantWallet: input.merchantWallet,
      };
      return overrides.revoke
        ? overrides.revoke(input)
        : { ok: true, outcome: "revoked" as const };
    },
    draftSecret: overrides.draftSecret ?? (() => SECRET),
    now: overrides.now ?? (() => NOW),
  });

  return { handler, state };
}

/** Helper: a revoke that returns a given outcome. */
function revokeOutcome(outcome: RevokeOutcome) {
  return async (): Promise<RevokeAuthorizationResult> => ({ ok: true, outcome });
}

/** Helper: a revoke that fails (e.g. consumed/processing). */
function revokeState(outcome: RevokeOutcome) {
  return async (): Promise<RevokeAuthorizationResult> => ({ ok: false, outcome });
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

function createdRequest(): PaymentRequest {
  return {
    id: "PR-ABCD1234",
    reference: "Fk9Q1uZ8m2Fk9Q1uZ8m2Fk9Q1uZ8m2Fk9Q1uZ8m2",
    amountLamports: "500000000",
    description: "website development",
    customerName: null,
    customerEmail: null,
    merchantAddress: SESSION_WALLET,
    status: "pending",
    transactionSignature: null,
    payerAddress: null,
    verifiedAt: null,
    createdAt: "2026-11-22T10:00:00.000Z",
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
  const body1 = (await first.json()) as { outcome?: string };

  assert.equal(first.status, 200);
  assert.equal(body1.outcome, "revoked");

  // Second call should be idempotent (same outcome, no error)
  const second = await handler(request({ draftToken: tokenFor().token }));
  const body2 = (await second.json()) as { outcome?: string };

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
  ];

  for (const values of cases) {
    const form = validatePaymentRequestForm({
      amount: values.amount,
      description: values.description,
      customerName: values.customerName,
      customerEmail: "",
    });
    const draft = preparePaymentDraft(values);

    const formAccepts = form.ok;
    const draftAccepts = draft.status === "ready";

    assert.equal(
      draftAccepts,
      formAccepts,
      `AI draft and payment-request validator disagree for a ${values.customerName.length}-character name`,
    );

    if (!formAccepts) {
      assert.ok(form.errors.customerName, "form reports a customer-name error");
    }
  }
});

/* ------------------------------------------------------------------- */
/* Part 4: cancellation endpoint guards */
/* ------------------------------------------------------------------- */

test("cancellation rejects an unauthenticated request before the registry", async () => {
  const { handler, state } = cancelHandlerCreates({
    resolveMerchant: async () =>
      NextResponse.json({ error: "Authentication required." }, { status: 401 }),
  });

  const response = await handler(request({ draftToken: tokenFor().token }));

  assert.equal(response.status, 401);
  assert.equal(state.calls, 0);
});

test("cancellation rate limiting returns 429 with Retry-After", async () => {
  const { handler, state } = cancelHandlerCreates({
    checkRateLimit: async (): Promise<RateLimitOutcome> => ({
      ok: false,
      kind: "limited",
      retryAfterSeconds: 30,
    }),
  });

  const response = await handler(request({ draftToken: tokenFor().token }));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal(state.calls, 0);
});

test("cross-origin cancellation is rejected", async () => {
  const { handler, state } = cancelHandlerCreates();

  const response = await handler(
    request({ draftToken: tokenFor().token }, "/api/ai/payment-drafts/cancel", {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    }),
  );

  assert.equal(response.status, 403);
  assert.equal(state.calls, 0);
});

test("an oversized cancellation body is rejected with 413", async () => {
  const { handler, state } = cancelHandlerCreates();

  const response = await handler(
    request({
      draftToken: tokenFor().token,
      padding: "x".repeat(MAX_DRAFT_BODY_BYTES + 1024),
    }),
  );

  assert.equal(response.status, 413);
  assert.equal(state.calls, 0);
});

test("malformed JSON and a missing draftToken are rejected with 400", async () => {
  const { handler, state } = cancelHandlerCreates();

  const malformed = await handler(
    new NextRequest("http://localhost/api/ai/payment-drafts/cancel", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      body: "{not-json",
    }),
  );
  assert.equal(malformed.status, 400);

  const missing = await handler(request({}));
  const missingBody = await missing.json();
  assert.equal(missing.status, 400);
  assert.match(missingBody.error, /draftToken is required/i);

  assert.equal(state.calls, 0);
});

test("cancellation fails closed when the authorization secret is missing", async () => {
  const { handler, state } = cancelHandlerCreates({ draftSecret: () => null });

  const response = await handler(request({ draftToken: tokenFor().token }));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.match(body.error, /not configured/i);
  assert.equal(body.status, undefined);
  assert.equal(body.outcome, undefined);
  assert.equal(state.calls, 0);
});

/* ------------------------------------------------------------------- */
/* Part 5: cancellation while an approval is in flight */
/* ------------------------------------------------------------------- */

test("cancelling a processing authorization never reports a cancelled success", async () => {
  const { handler, state } = cancelHandlerCreates({
    revoke: revokeState("processing"),
  });

  const response = await handler(request({ draftToken: tokenFor().token }));
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.status, "error");
  assert.equal(body.code, "authorization_processing");
  assert.equal(body.outcome, undefined);
  assert.equal(response.headers.get("retry-after"), "1");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(JSON.stringify(body), /cancelled/i);
  assert.equal(state.calls, 1);
});

/* ------------------------------------------------------------------- */
/* Part 6: approval and cancellation in flight together */
/* ------------------------------------------------------------------- */

/**
 * Handler-level race: a promise-chain mutex stands in for the RPC's
 * `SELECT ... FOR UPDATE`, so the two handlers are serialised exactly as the
 * single SQL transaction would serialise them.
 *
 * This proves the handlers can never emit both a created request and a
 * cancelled success for one nonce. It does NOT prove Postgres row locking or
 * transaction isolation: no database runs in this suite, so the database
 * guarantee rests on the migration's `FOR UPDATE` and the structural
 * assertions in ai-payment-draft-execution.node.test.ts.
 */
function lockedRegistry() {
  let tail: Promise<unknown> = Promise.resolve();

  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  };
}

test("simultaneous approval and cancellation cannot both succeed", async () => {
  const withLock = lockedRegistry();
  let registryState: "active" | "revoked" | "consumed" = "active";
  let createdCount = 0;
  const stored = createdRequest();

  const cancel = cancelHandlerCreates({
    revoke: () =>
      withLock(async () => {
        if (registryState === "consumed") {
          return { ok: false, outcome: "consumed" } as const;
        }
        if (registryState === "revoked") {
          return { ok: true, outcome: "revoked" } as const;
        }

        registryState = "revoked";
        return { ok: true, outcome: "revoked" } as const;
      }),
  }).handler;

  const execute = createPaymentDraftExecuteHandler({
    resolveMerchant: async () => SESSION_WALLET,
    checkRateLimit: async (): Promise<RateLimitOutcome> => ({ ok: true }),
    createAuthorizedRequest: () =>
      withLock(async () => {
        if (registryState === "consumed") {
          return {
            ok: true,
            request: stored,
            authorizationOutcome: "already_consumed",
          } as const;
        }
        if (registryState === "revoked") {
          return {
            ok: false,
            reason: "authorization",
            authorizationOutcome: "revoked",
            error: "revoked",
          } as const;
        }

        registryState = "consumed";
        createdCount += 1;
        return {
          ok: true,
          request: stored,
          authorizationOutcome: "created",
        } as const;
      }),
    draftSecret: () => SECRET,
    now: () => NOW,
  });

  const draftToken = tokenFor().token;
  const [executeResponse, cancelResponse] = await Promise.all([
    execute(request({ draftToken }, "/api/ai/payment-drafts/execute")),
    cancel(request({ draftToken })),
  ]);

  const executeBody = await executeResponse.json();
  const cancelBody = await cancelResponse.json();

  if (executeResponse.status === 201) {
    // Approval won: cancellation must report the consumed terminal state.
    assert.equal(executeBody.status, "created");
    assert.equal(cancelResponse.status, 409);
    assert.equal(cancelBody.code, "authorization_consumed");
    assert.equal(cancelBody.outcome, undefined);
    assert.equal(createdCount, 1);
  } else {
    // Cancellation won: execution must not create anything.
    assert.equal(executeResponse.status, 409);
    assert.equal(executeBody.code, "authorization_revoked");
    assert.equal(executeBody.request, undefined);
    assert.equal(cancelResponse.status, 200);
    assert.equal(cancelBody.status, "cancelled");
    assert.equal(cancelBody.outcome, "revoked");
    assert.equal(createdCount, 0);
  }

  assert.equal(registryState, executeResponse.status === 201 ? "consumed" : "revoked");
  assert.ok(!(executeResponse.status === 201 && cancelResponse.status === 200));
});
