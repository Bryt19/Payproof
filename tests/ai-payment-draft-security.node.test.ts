import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NextRequest } from "next/server";

import {
  MAX_DRAFT_TOKEN_LENGTH,
  createDraftToken,
  verifyDraftToken,
} from "../src/lib/ai/draft-token.ts";
import { draftAuthorizationFingerprint } from "../src/lib/ai/authorization-registry.ts";
import { createPaymentDraftExecuteHandler } from "../src/lib/ai/payment-draft-execute-handler.ts";
import { createPaymentDraftReauthorizeHandler } from "../src/lib/ai/payment-draft-reauthorize-handler.ts";
import {
  parseExecutionResponse,
  parseReauthorizeResponse,
} from "../src/lib/ai/draft-execution.ts";
import {
  applyDraftEdits,
  buildDraftCardModel,
  canApproveDraft,
  cancelDraftReview,
  getDraftReviewStatus,
  parseDraftPreparationResponse,
  toEditableDraft,
  type DraftReview,
} from "../src/lib/ai/draft-review.ts";
import {
  preparePaymentDraft,
  type PaymentRequestDraft,
} from "../src/lib/ai/payment-draft.ts";
import {
  MAX_DRAFT_BODY_BYTES,
} from "../src/lib/ai/draft-http.ts";
import { validatePaymentRequestForm } from "../src/lib/payment-requests/validation.ts";
import type { CreatePaymentRequestResult } from "../src/lib/payment-requests/create-for-session.ts";
import type { RateLimitOutcome } from "../src/lib/auth/rate-limit.ts";
import type { PaymentRequest } from "../src/lib/payment-requests/types.ts";
import type { ReauthorizeAuthorizationResult } from "../src/lib/ai/authorization-registry.ts";

/**
 * Stage 3: security, reliability and edge-case coverage for the AI
 * payment-request workflow.
 *
 * These are handler-, validator- and source-level tests. They do not execute
 * SQL: the single-use guarantee itself lives in the row-locked
 * `execute_ai_payment_draft_authorization` function and is asserted structurally
 * in ai-payment-draft-execution.node.test.ts.
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
  path = "/api/ai/payment-drafts/execute",
  headers: Record<string, string> = {},
): NextRequest {
  return rawRequest(JSON.stringify(body), path, headers);
}

function rawRequest(
  body: string,
  path = "/api/ai/payment-drafts/execute",
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...headers,
    },
    body,
  });
}

function createdRequest(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
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
    ...overrides,
  };
}

type ExecuteInput = {
  wallet: string;
  draft: PaymentRequestDraft;
  nonce: string;
  fingerprint: string;
};

function executeHandler(overrides: {
  createAuthorizedRequest?: (input: ExecuteInput) => Promise<CreatePaymentRequestResult>;
} = {}) {
  const state = {
    calls: 0,
    lastInput: null as null | ExecuteInput,
  };

  const handler = createPaymentDraftExecuteHandler({
    resolveMerchant: async () => SESSION_WALLET,
    checkRateLimit: async (): Promise<RateLimitOutcome> => ({ ok: true }),
    createAuthorizedRequest: async (input) => {
      state.calls += 1;
      state.lastInput = input;

      return overrides.createAuthorizedRequest
        ? overrides.createAuthorizedRequest(input)
        : {
            ok: true,
            request: createdRequest(),
            authorizationOutcome: "created",
          };
    },
    draftSecret: () => SECRET,
    now: () => NOW,
  });

  return { handler, state };
}

function reauthorizeHandler(overrides: {
  reauthorize?: (input: {
    oldNonce: string;
    newNonce: string;
    merchantWallet: string;
  }) => Promise<ReauthorizeAuthorizationResult>;
} = {}) {
  const state = {
    calls: 0,
    lastInput: null as null | { oldNonce: string; newNonce: string; merchantWallet: string },
  };

  const handler = createPaymentDraftReauthorizeHandler({
    resolveMerchant: async () => SESSION_WALLET,
    checkRateLimit: async (): Promise<RateLimitOutcome> => ({ ok: true }),
    reauthorize: async (input) => {
      state.calls += 1;
      state.lastInput = input;
      return overrides.reauthorize
        ? overrides.reauthorize(input)
        : { ok: true, outcome: "reauthorized" };
    },
    createToken: (draft, wallet, options) => createDraftToken(draft, wallet, options),
    draftSecret: () => SECRET,
    now: () => NOW,
  });

  return { handler, state };
}

function reviewFrom(payload: unknown): DraftReview {
  const parsed = parseDraftPreparationResponse(payload);
  assert.equal(parsed.kind, "draft");
  if (parsed.kind !== "draft") throw new Error("expected a draft");
  return parsed.review;
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

// ---------------------------------------------------------------------------
// Part 5/6: request body hardening
// ---------------------------------------------------------------------------

test("an oversized execute body is rejected before the registry", async () => {
  const { handler, state } = executeHandler();

  const response = await handler(
    request({
      draftToken: tokenFor().token,
      padding: "x".repeat(MAX_DRAFT_BODY_BYTES + 1024),
    }),
  );

  assert.equal(response.status, 413);
  assert.equal(state.calls, 0);
});

test("an oversized re-authorize body is rejected before the registry", async () => {
  const { handler, state } = reauthorizeHandler();

  const response = await handler(
    request(
      {
        draftToken: tokenFor().token,
        draft: { amount: "0.75", description: "Website redesign" },
        padding: "x".repeat(MAX_DRAFT_BODY_BYTES + 1024),
      },
      "/api/ai/payment-drafts/reauthorize",
    ),
  );

  assert.equal(response.status, 413);
  assert.equal(state.calls, 0);
});

test("malformed JSON, non-JSON and non-object bodies are rejected", async () => {
  const { handler, state } = executeHandler();

  const malformed = await handler(rawRequest("{not-json"));
  assert.equal(malformed.status, 400);

  const wrongType = await handler(
    request({ draftToken: tokenFor().token }, undefined, {
      "content-type": "text/plain",
    }),
  );
  assert.equal(wrongType.status, 415);

  const arrayBody = await handler(rawRequest(JSON.stringify([tokenFor().token])));
  assert.equal(arrayBody.status, 400);

  assert.equal(state.calls, 0);
});

test("cross-origin execution is rejected", async () => {
  const { handler, state } = executeHandler();

  const response = await handler(
    request({ draftToken: tokenFor().token }, undefined, {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    }),
  );

  assert.equal(response.status, 403);
  assert.equal(state.calls, 0);
});

test("execute and re-authorize reject requests with missing required fields", async () => {
  const execute = executeHandler();
  const emptyExecute = await execute.handler(request({}));
  assert.equal(emptyExecute.status, 400);
  assert.equal(execute.state.calls, 0);

  const reauthorize = reauthorizeHandler();
  const emptyReauthorize = await reauthorize.handler(
    request({}, "/api/ai/payment-drafts/reauthorize"),
  );
  assert.equal(emptyReauthorize.status, 400);

  const noDraft = await reauthorize.handler(
    request({ draftToken: tokenFor().token }, "/api/ai/payment-drafts/reauthorize"),
  );
  assert.equal(noDraft.status, 400);
  assert.equal(reauthorize.state.calls, 0);
});

test("wallet fields in a re-authorize body are ignored in favour of the session", async () => {
  const { handler, state } = reauthorizeHandler();

  const response = await handler(
    request(
      {
        draftToken: tokenFor().token,
        draft: { amount: "0.75", description: "Website redesign" },
        merchantAddress: MERCHANT_B,
        merchantWallet: MERCHANT_B,
        wallet: MERCHANT_B,
      },
      "/api/ai/payment-drafts/reauthorize",
    ),
  );

  assert.equal(response.status, 200);
  assert.equal(state.lastInput?.merchantWallet, SESSION_WALLET);
});

test("an over-long draft token is treated as malformed", () => {
  const verified = verifyDraftToken(`ppd1.${"a".repeat(MAX_DRAFT_TOKEN_LENGTH)}.sig`, {
    secret: SECRET,
    now: NOW,
    wallet: SESSION_WALLET,
  });

  assert.equal(verified.ok, false);
  if (!verified.ok) assert.equal(verified.reason, "malformed");
});

// ---------------------------------------------------------------------------
// Part 1: duplicate approval
// ---------------------------------------------------------------------------

test("a retried approval returns the original request and never a second one", async () => {
  const original = createdRequest();
  const requestedIds = new Set<string>();
  let created = false;

  const { handler, state } = executeHandler({
    createAuthorizedRequest: async () => {
      // Mirrors the RPC contract: the first call creates, later calls report
      // already_consumed with the linked request.
      if (!created) {
        created = true;
        requestedIds.add(original.id);
        return { ok: true, request: original, authorizationOutcome: "created" };
      }

      return { ok: true, request: original, authorizationOutcome: "already_consumed" };
    },
  });

  const first = await handler(request({ draftToken: tokenFor().token }));
  const second = await handler(request({ draftToken: tokenFor().token }));

  const firstBody = await first.json();
  const secondBody = await second.json();

  assert.equal(first.status, 201);
  assert.equal(firstBody.status, "created");
  assert.equal(second.status, 200);
  assert.equal(secondBody.status, "already_created");
  assert.equal(secondBody.alreadyCreated, true);
  assert.equal(firstBody.request.id, secondBody.request.id);
  assert.equal(requestedIds.size, 1);
  assert.equal(state.calls, 2);
});

test("a registry fingerprint mismatch is rejected without a request", async () => {
  const { handler } = executeHandler({
    createAuthorizedRequest: async () => ({
      ok: false,
      reason: "authorization",
      authorizationOutcome: "fingerprint_mismatch",
      error: "fingerprint mismatch",
    }),
  });

  const response = await handler(request({ draftToken: tokenFor().token }));
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, "authorization_mismatch");
  assert.equal(body.request, undefined);
  assert.equal(body.checkoutUrl, undefined);
});

test("an unknown authorization is rejected without a request", async () => {
  const { handler } = executeHandler({
    createAuthorizedRequest: async () => ({
      ok: false,
      reason: "authorization",
      authorizationOutcome: "unknown",
      error: "unknown",
    }),
  });

  const response = await handler(request({ draftToken: tokenFor().token }));
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.code, "unknown_authorization");
  assert.equal(body.request, undefined);
});

// ---------------------------------------------------------------------------
// Part 2: expiry
// ---------------------------------------------------------------------------

test("an authorization the registry reports as expired creates nothing", async () => {
  const { handler } = executeHandler({
    createAuthorizedRequest: async () => ({
      ok: false,
      reason: "authorization",
      authorizationOutcome: "expired",
      error: "expired",
    }),
  });

  const response = await handler(request({ draftToken: tokenFor().token }));
  const body = await response.json();

  assert.equal(response.status, 410);
  assert.equal(body.code, "expired_authorization");
  assert.equal(body.request, undefined);
  assert.equal(body.checkoutUrl, undefined);
});

test("a token past its server-issued expiry is rejected before the registry", async () => {
  const signed = tokenFor();
  const { handler, state } = executeHandler();
  const afterExpiry = createPaymentDraftExecuteHandler({
    resolveMerchant: async () => SESSION_WALLET,
    checkRateLimit: async (): Promise<RateLimitOutcome> => ({ ok: true }),
    createAuthorizedRequest: async () => {
      throw new Error("registry must not be reached for an expired token");
    },
    draftSecret: () => SECRET,
    now: () => new Date(Date.parse(signed.expiresAt) + 1000),
  });

  const response = await afterExpiry(request({ draftToken: signed.token }));
  const body = await response.json();

  assert.equal(response.status, 410);
  assert.equal(body.code, "expired_authorization");

  // The same token is still usable inside its window.
  const valid = await handler(request({ draftToken: signed.token }));
  assert.equal(valid.status, 201);
  assert.equal(state.calls, 1);
});

test("an expired original token cannot be re-authorized", async () => {
  const { handler, state } = reauthorizeHandler();

  const expired = createDraftToken(DRAFT, SESSION_WALLET, {
    secret: SECRET,
    now: new Date(NOW.getTime() - 60 * 60 * 1000),
    nonce: NONCE,
  });

  const response = await handler(
    request(
      {
        draftToken: expired.token,
        draft: { amount: "0.75", description: "Website redesign" },
      },
      "/api/ai/payment-drafts/reauthorize",
    ),
  );
  const body = await response.json();

  assert.equal(response.status, 410);
  assert.equal(body.code, "expired_authorization");
  assert.equal(body.draftToken, undefined);
  assert.equal(state.calls, 0);
});

// ---------------------------------------------------------------------------
// Part 3: draft editing and fingerprint integrity
// ---------------------------------------------------------------------------

test("each edited field invalidates approval on its own", () => {
  const review = reviewFrom(draftEnvelope());

  const changes: Array<Record<string, string>> = [
    { amount: "0.75" },
    { description: "Website redesign" },
    { customerName: "Ama Mensah" },
    { customerEmail: "ama@example.com" },
  ];

  for (const change of changes) {
    const edited = applyDraftEdits(review, {
      ...toEditableDraft(review.draft),
      ...change,
    });

    assert.equal(edited.ok, true, `edit should validate: ${JSON.stringify(change)}`);
    if (!edited.ok) continue;

    assert.equal(canApproveDraft(edited.review, NOW.getTime()), false);
    assert.equal(
      buildDraftCardModel(edited.review, SESSION_WALLET, NOW.getTime()).statusLabel,
      "Needs re-authorization",
    );

    const restored = applyDraftEdits(edited.review, toEditableDraft(review.originalDraft));
    assert.equal(restored.ok, true);
    if (!restored.ok) continue;
    assert.equal(canApproveDraft(restored.review, NOW.getTime()), true);
  }
});

test("the fingerprint changes when any draft field changes", () => {
  const base = draftAuthorizationFingerprint(DRAFT, SESSION_WALLET, NONCE);

  const variants: PaymentRequestDraft[] = [
    { ...DRAFT, amountLamports: "750000000", amountSol: "0.75" },
    { ...DRAFT, description: "different description" },
    { ...DRAFT, customerName: "Ama Mensah" },
    { ...DRAFT, customerEmail: "ama@example.com" },
  ];

  for (const variant of variants) {
    assert.notEqual(draftAuthorizationFingerprint(variant, SESSION_WALLET, NONCE), base);
  }
});

test("the execution input carries exactly the reviewed draft values", async () => {
  const draft: PaymentRequestDraft = {
    amountLamports: "750000000",
    amountSol: "0.75",
    description: "Website redesign",
    customerName: "Ama Mensah",
    customerEmail: "ama@example.com",
  };

  const { handler, state } = executeHandler();
  const response = await handler(request({ draftToken: tokenFor({ draft }).token }));

  assert.equal(response.status, 201);
  assert.deepEqual(state.lastInput?.draft, draft);
  assert.equal(state.lastInput?.wallet, SESSION_WALLET);
});

test("re-authorized values are what the new token approves", async () => {
  const { handler, state } = reauthorizeHandler();

  const response = await handler(
    request(
      {
        draftToken: tokenFor().token,
        draft: {
          amount: "0.75",
          description: "Website redesign",
          customerName: "Ama Mensah",
          customerEmail: "ama@example.com",
        },
      },
      "/api/ai/payment-drafts/reauthorize",
    ),
  );

  const payload = await response.json();
  const parsed = parseReauthorizeResponse(payload);

  assert.equal(response.status, 200);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;

  assert.equal(parsed.review.draft.amountLamports, "750000000");
  assert.equal(parsed.review.draft.description, "Website redesign");
  assert.equal(parsed.review.draft.customerName, "Ama Mensah");
  assert.equal(parsed.review.draft.customerEmail, "ama@example.com");
  assert.equal(parsed.review.draftToken, payload.draftToken);
  assert.notEqual(parsed.review.draftToken, tokenFor().token);
  assert.notEqual(state.lastInput?.oldNonce, state.lastInput?.newNonce);
});

// ---------------------------------------------------------------------------
// Part 4: cancellation and declined approval
// ---------------------------------------------------------------------------

test("a cancelled review cannot be approved and changes no token", () => {
  const review = reviewFrom(draftEnvelope());
  const cancelled = cancelDraftReview(review);

  assert.equal(cancelled.draftToken, review.draftToken);
  assert.equal(getDraftReviewStatus(cancelled, NOW.getTime()), "cancelled");
  assert.equal(canApproveDraft(cancelled, NOW.getTime()), false);

  const model = buildDraftCardModel(cancelled, SESSION_WALLET, NOW.getTime());
  assert.equal(model.statusLabel, "Cancelled");
  assert.equal(model.canApprove, false);
  assert.equal(model.canEdit, false);
  assert.match(model.notice, /nothing was saved/i);
});

test("a failed approval surfaces a message and never a created request", () => {
  const failed = parseExecutionResponse({
    status: "error",
    code: "creation_unavailable",
    error:
      "Payment request creation is temporarily unavailable. Please try again shortly.",
  });

  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.equal(failed.code, "creation_unavailable");
  assert.match(failed.message, /temporarily unavailable/i);
});

test("a network failure has no success payload to render", () => {
  const failed = parseExecutionResponse(null);

  assert.equal(failed.ok, false);
  if (failed.ok) return;
  assert.match(failed.message, /unexpected creation response/i);
});

// ---------------------------------------------------------------------------
// Part 6: validation matrix, shared with normal creation
// ---------------------------------------------------------------------------

test("zero, negative and malformed amounts are rejected", () => {
  for (const amount of ["0", "0.0", "-1", "-0.5", "abc", "1e3", "0.5.5", "0.0000000001"]) {
    const prepared = preparePaymentDraft({ amount, description: "website development" });
    assert.notEqual(prepared.status, "ready", `amount should be rejected: ${amount}`);
  }
});

test("amounts above the 10 SOL limit are rejected and boundaries accepted", () => {
  for (const amount of ["10.000000001", "11", "100"]) {
    const prepared = preparePaymentDraft({ amount, description: "website development" });
    assert.equal(prepared.status, "invalid", `amount should exceed the limit: ${amount}`);
    if (prepared.status === "invalid") {
      assert.equal(prepared.errors[0]?.code, "amount_above_limit");
    }
  }

  const accepted: Array<[string, string]> = [
    ["10", "10000000000"],
    ["0.000000001", "1"],
    ["0.5", "500000000"],
  ];

  for (const [amount, lamports] of accepted) {
    const prepared = preparePaymentDraft({ amount, description: "website development" });
    assert.equal(prepared.status, "ready", `amount should be accepted: ${amount}`);
    if (prepared.status === "ready") {
      assert.equal(prepared.draft.amountLamports, lamports);
    }
  }
});

test("description rules match the normal creation form", () => {
  const missing = preparePaymentDraft({ amount: "0.5", description: "   " });
  assert.equal(missing.status, "clarification");

  const tooShort = preparePaymentDraft({ amount: "0.5", description: "ab" });
  assert.equal(tooShort.status, "invalid");
  if (tooShort.status === "invalid") {
    assert.equal(tooShort.errors[0]?.code, "description_too_short");
  }

  const tooLong = preparePaymentDraft({
    amount: "0.5",
    description: "a".repeat(201),
  });
  assert.equal(tooLong.status, "invalid");
  if (tooLong.status === "invalid") {
    assert.equal(tooLong.errors[0]?.code, "description_too_long");
  }

  const boundary = preparePaymentDraft({
    amount: "0.5",
    description: "a".repeat(200),
  });
  assert.equal(boundary.status, "ready");
});

test("invalid customer email addresses are rejected", () => {
  for (const customerEmail of ["not-an-email", "ama@", "ama@example", "ama @example.com"]) {
    const prepared = preparePaymentDraft({
      amount: "0.5",
      description: "website development",
      customerEmail,
    });
    assert.equal(prepared.status, "invalid", `email should be rejected: ${customerEmail}`);
    if (prepared.status === "invalid") {
      assert.equal(prepared.errors[0]?.field, "customerEmail");
    }
  }

  const valid = preparePaymentDraft({
    amount: "0.5",
    description: "website development",
    customerEmail: "ama@example.com",
  });
  assert.equal(valid.status, "ready");
});

test("customer names over 80 characters are rejected", () => {
  const boundary = preparePaymentDraft({
    amount: "0.5",
    description: "website development",
    customerName: "a".repeat(80),
  });
  assert.equal(boundary.status, "ready");

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

test("AI draft validation agrees with the normal payment-request validator", () => {
  const cases = [
    { amount: "0.5", description: "website development" },
    { amount: "10", description: "website development" },
    { amount: "10.000000001", description: "website development" },
    { amount: "0", description: "website development" },
    { amount: "-1", description: "website development" },
    { amount: "0.5", description: "" },
    { amount: "0.5", description: "ab" },
    { amount: "0.5", description: "a".repeat(201) },
    { amount: "0.5", description: "website development", customerEmail: "not-an-email" },
    { amount: "0.5", description: "website development", customerEmail: "ama@example.com" },
    { amount: "0.5", description: "website development", customerName: "a".repeat(81) },
  ];

  for (const values of cases) {
    const form = validatePaymentRequestForm({
      amount: values.amount,
      description: values.description,
      customerName: values.customerName ?? "",
      customerEmail: values.customerEmail ?? "",
    });

    const prepared = preparePaymentDraft({
      amount: values.amount,
      description: values.description,
      customerName: values.customerName,
      customerEmail: values.customerEmail,
    });

    assert.equal(
      prepared.status === "ready",
      form.ok,
      `validator disagreement for ${JSON.stringify(values)}`,
    );

    if (prepared.status === "ready" && form.ok) {
      assert.equal(prepared.draft.amountLamports, form.value.amountLamports);
      assert.equal(prepared.draft.description, form.value.description);
      assert.equal(prepared.draft.customerName, form.value.customerName);
      assert.equal(prepared.draft.customerEmail, form.value.customerEmail);
    }
  }
});

// ---------------------------------------------------------------------------
// Client boundary and double-submit hardening
// ---------------------------------------------------------------------------

test("the review client cannot reach the registry or Supabase", () => {
  const card = readFileSync(
    new URL("../src/components/ai-chat/payment-draft-card.tsx", import.meta.url),
    "utf8",
  );
  const execution = readFileSync(
    new URL("../src/lib/ai/draft-execution.ts", import.meta.url),
    "utf8",
  );

  for (const source of [card, execution]) {
    assert.doesNotMatch(source, /authorization-registry/);
    assert.doesNotMatch(source, /@supabase/);
  }

  assert.doesNotMatch(execution, /createPaymentRequest|createSupabaseClient/);
});

test("the approve action is guarded in flight and shows loading state", () => {
  const card = readFileSync(
    new URL("../src/components/ai-chat/payment-draft-card.tsx", import.meta.url),
    "utf8",
  );

  assert.match(card, /approvalInFlight\.current/);
  assert.match(card, /setApprovalState\("loading"\)/);
  assert.match(card, /isLoading \? "Approving…" : "Approve payment request"/);
  assert.match(card, /disabled=\{approveDisabled\}/);
});
