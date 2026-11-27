import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NextRequest, NextResponse } from "next/server";
import {
  AI_SETTINGS_HREF,
} from "../src/lib/ai/assistant-capabilities.ts";
import { createIntentToken } from "../src/lib/ai/intent-token.ts";
import {
  createIntentApprovalPostHandler,
  INTENT_APPROVAL_BODY_BYTES,
  type IntentApprovalDependencies,
} from "../src/lib/ai/intent-approval-handler.ts";
import {
  createIntentPreparePostHandler,
  INTENT_PREPARE_BODY_BYTES,
  type IntentPrepareDependencies,
} from "../src/lib/ai/intent-prepare-handler.ts";
import {
  createIntentCancelPostHandler,
  type IntentCancelDependencies,
} from "../src/lib/ai/intent-cancel-handler.ts";
import type { AgentPaymentIntent } from "../src/lib/ai/intent-registry.ts";
import type { PaymentIntent } from "../src/lib/ai/payment-intent.ts";
import type { RateLimitOutcome } from "../src/lib/auth/rate-limit.ts";
import {
  checkWalletForIntent,
  isTerminalIntentFailure,
  parseIntentApprovalResponse,
  parseIntentCancelResponse,
  parseIntentPrepareResponse,
} from "../src/lib/ai/intent-approval.ts";
import type {
  PreparedAgentTransfer,
} from "../src/lib/solana/agent-payment.ts";
import { AgentPaymentPreparationError } from "../src/lib/solana/agent-payment.ts";

/**
 * Stage 4 Step 2: authenticated approval, cancellation and unsigned preparation.
 *
 * Everything here mocks the database, the capability store and the RPC. These
 * tests prove the request handling and the binding logic; they do NOT prove
 * Postgres row locking or real Devnet behaviour. The real concurrency suite lives
 * in tests/agent-intent-lifecycle.pg-concurrency.test.mjs, and real Devnet
 * preparation is exercised only when that environment exists.
 */

const SESSION = "So11111111111111111111111111111111111111112";
const ATTACKER = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RECIPIENT = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const REFERENCE = "Fk9Q1uZ8m2Fk9Q1uZ8m2Fk9Q1uZ8m2Fk9Q1uZ8m2";
const NONCE = "ab".repeat(16);
const SECRET = "intent-approval-test-secret-0123456789-abcdef";
const NOW = new Date("2026-11-26T10:00:00.000Z");
const EXPIRES_AT = new Date(NOW.getTime() + 10 * 60 * 1000).toISOString();
const APPROVED_AT = NOW.toISOString();
const APPROVAL_EXPIRES_AT = new Date(
  NOW.getTime() + 5 * 60 * 1000,
).toISOString();

const PAYMENT_INTENT: PaymentIntent = {
  amountLamports: "1500000000",
  amountSol: "1.5",
  recipientAddress: RECIPIENT,
  purpose: "Logo design",
  currency: "SOL",
  sourceKind: "address",
  sourcePaymentRequestReference: null,
};

const SIGNED = createIntentToken(PAYMENT_INTENT, SESSION, {
  secret: SECRET,
  now: NOW,
  nonce: NONCE,
});

function intent(overrides: Partial<AgentPaymentIntent> = {}): AgentPaymentIntent {
  return {
    id: "AI-12345678",
    merchantWallet: SESSION,
    status: "draft",
    recipientAddress: RECIPIENT,
    amountLamports: "1500000000",
    purpose: "Logo design",
    reference: REFERENCE,
    sourceKind: "address",
    sourcePaymentRequestReference: null,
    nonce: NONCE,
    intentFingerprint: SIGNED.fingerprint,
    transactionSignature: null,
    payerAddress: null,
    verifiedAt: null,
    expiresAt: EXPIRES_AT,
    createdAt: NOW.toISOString(),
    approvedAt: null,
    approvalExpiresAt: null,
    submittedAt: null,
    failureReason: null,
    ...overrides,
    transactionBase64: overrides.transactionBase64 ?? null,
  };
}

function approvedIntent(
  overrides: Partial<AgentPaymentIntent> = {},
): AgentPaymentIntent {
  return intent({
    status: "approved",
    approvedAt: APPROVED_AT,
    approvalExpiresAt: APPROVAL_EXPIRES_AT,
    ...overrides,
  });
}

function makeRequest(
  path: string,
  body: unknown,
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

const APPROVE_PATH = "/api/ai/payment-intents/approve";
const PREPARE_PATH = "/api/ai/payment-intents/prepare";
const CANCEL_PATH = "/api/ai/payment-intents/cancel";

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

function createApproval(
  overrides: Partial<IntentApprovalDependencies> = {},
) {
  const state = {
    loads: [] as { merchantWallet: string; nonce: string }[],
    approvals: [] as {
      nonce: string;
      merchantWallet: string;
      fingerprint: string;
    }[],
    capabilityCalls: 0,
    rateLimitCalls: 0,
  };

  const handler = createIntentApprovalPostHandler({
    resolveMerchant: async () => SESSION,
    checkRateLimit: async () => {
      state.rateLimitCalls += 1;
      return { ok: true };
    },
    checkCapability: async () => {
      state.capabilityCalls += 1;
      return { ok: true };
    },
    intentSecret: () => SECRET,
    loadIntent: async (input) => {
      state.loads.push(input);
      return { ok: true, intent: intent() };
    },
    approveIntent: async (input) => {
      state.approvals.push(input);
      return {
        ok: true,
        outcome: "approved",
        intent: approvedIntent(),
      };
    },
    now: () => NOW,
    ...overrides,
  });

  return { handler, state };
}

test("approval requires a valid merchant session", async () => {
  const { handler, state } = createApproval({
    resolveMerchant: async () =>
      NextResponse.json({ error: "Authentication required." }, { status: 401 }),
  });

  const response = await handler(makeRequest(APPROVE_PATH, {}));

  assert.equal(response.status, 401);
  assert.equal(state.rateLimitCalls, 0);
  assert.equal(state.loads.length, 0);
  assert.equal(state.approvals.length, 0);
});

test("a thrown session lookup fails closed", async () => {
  const { handler, state } = createApproval({
    resolveMerchant: async () => {
      throw new Error("auth store down");
    },
  });

  const response = await handler(makeRequest(APPROVE_PATH, {}));

  assert.equal(response.status, 503);
  assert.equal(state.loads.length, 0);
});

test("the session wallet is authoritative and body wallet fields are ignored", async () => {
  const { handler, state } = createApproval();

  const response = await handler(
    makeRequest(APPROVE_PATH, {
      intentAuthorization: SIGNED.token,
      merchantWallet: ATTACKER,
      wallet: ATTACKER,
      merchant_wallet: ATTACKER,
      amountLamports: "1",
      recipientAddress: ATTACKER,
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(state.loads, [{ merchantWallet: SESSION, nonce: NONCE }]);
  assert.deepEqual(state.approvals, [
    {
      nonce: NONCE,
      merchantWallet: SESSION,
      fingerprint: SIGNED.fingerprint,
    },
  ]);

  const body = await response.json();

  assert.equal(body.intentId, "AI-12345678");
  assert.equal(body.amountLamports, "1500000000");
  assert.equal(body.amountSol, "1.5");
  assert.equal(body.recipientAddress, RECIPIENT);
  assert.equal(body.merchantWallet, SESSION);
  assert.equal(body.status, "approved");
  assert.equal(body.outcome, "approved");
  assert.equal(body.approvedAt, APPROVED_AT);
  assert.equal(body.approvalExpiresAt, APPROVAL_EXPIRES_AT);
  assert.equal(body.cluster, "devnet");
  assert.doesNotMatch(JSON.stringify(body), /ppi1\./);
});

test("a capability that is disabled or unavailable blocks approval before any read", async () => {
  const disabled = createApproval({
    checkCapability: async () => ({ ok: false, reason: "disabled" }),
  });

  const disabledResponse = await disabled.handler(
    makeRequest(APPROVE_PATH, { intentAuthorization: SIGNED.token }),
  );
  const disabledBody = await disabledResponse.json();

  assert.equal(disabledResponse.status, 403);
  assert.equal(disabledBody.code, "capability_disabled");
  assert.equal(disabled.state.loads.length, 0);

  const unavailable = createApproval({
    checkCapability: async () => ({ ok: false, reason: "unavailable" }),
  });

  const unavailableResponse = await unavailable.handler(
    makeRequest(APPROVE_PATH, { intentAuthorization: SIGNED.token }),
  );

  assert.equal(unavailableResponse.status, 503);
  assert.equal(unavailable.state.loads.length, 0);
});

test("a thrown capability check is unavailable, not permission", async () => {
  const { handler, state } = createApproval({
    checkCapability: async () => {
      throw new Error("capability store down");
    },
  });

  const response = await handler(
    makeRequest(APPROVE_PATH, { intentAuthorization: SIGNED.token }),
  );

  assert.equal(response.status, 503);
  assert.equal(state.loads.length, 0);
});

test("approval applies client and wallet rate limits", async () => {
  const limited = createApproval({
    checkRateLimit: async (): Promise<RateLimitOutcome> => ({
      ok: false,
      kind: "limited",
      retryAfterSeconds: 17,
    }),
  });

  const limitedResponse = await limited.handler(
    makeRequest(APPROVE_PATH, { intentAuthorization: SIGNED.token }),
  );

  assert.equal(limitedResponse.status, 429);
  assert.equal(limitedResponse.headers.get("retry-after"), "17");
  assert.equal(limited.state.loads.length, 0);

  const unavailable = createApproval({
    checkRateLimit: async (): Promise<RateLimitOutcome> => ({
      ok: false,
      kind: "unavailable",
    }),
  });

  const unavailableResponse = await unavailable.handler(
    makeRequest(APPROVE_PATH, { intentAuthorization: SIGNED.token }),
  );

  assert.equal(unavailableResponse.status, 503);
  assert.equal(unavailable.state.loads.length, 0);

  const threw = createApproval({
    checkRateLimit: async () => {
      throw new Error("rate store down");
    },
  });

  const threwResponse = await threw.handler(
    makeRequest(APPROVE_PATH, { intentAuthorization: SIGNED.token }),
  );

  assert.equal(threwResponse.status, 503);
});

test("approval rejects non-JSON, cross-origin, oversized and token-less bodies", async () => {
  const { handler, state } = createApproval();

  const wrongType = await handler(
    makeRequest(APPROVE_PATH, {}, { "content-type": "text/plain" }),
  );
  assert.equal(wrongType.status, 415);

  const crossSite = await handler(
    makeRequest(APPROVE_PATH, {}, { "sec-fetch-site": "cross-site" }),
  );
  assert.equal(crossSite.status, 403);

  const foreignOrigin = await handler(
    makeRequest(APPROVE_PATH, {}, { origin: "https://evil.example" }),
  );
  assert.equal(foreignOrigin.status, 403);

  const oversized = await handler(
    makeRequest(APPROVE_PATH, {
      intentAuthorization: "a".repeat(INTENT_APPROVAL_BODY_BYTES + 1),
    }),
  );
  assert.equal(oversized.status, 413);

  for (const token of [undefined, "", "   ", 42, null]) {
    const response = await handler(
      makeRequest(APPROVE_PATH, { intentAuthorization: token }),
    );
    assert.equal(response.status, 400, String(token));
  }

  assert.equal(state.loads.length, 0);
  assert.equal(state.approvals.length, 0);
});

test("invalid, expired and other-merchant tokens never reach the database", async () => {
  const { handler, state } = createApproval();

  const [prefix, payload, signature] = SIGNED.token.split(".");
  const tampered = `${prefix}.${payload}.${signature.slice(0, -2)}AA`;

  const invalid = await handler(
    makeRequest(APPROVE_PATH, { intentAuthorization: tampered }),
  );
  assert.equal(invalid.status, 403);

  const otherMerchant = createIntentToken(PAYMENT_INTENT, ATTACKER, {
    secret: SECRET,
    now: NOW,
    nonce: NONCE,
  });
  const wrongMerchant = await handler(
    makeRequest(APPROVE_PATH, { intentAuthorization: otherMerchant.token }),
  );
  assert.equal(wrongMerchant.status, 403);

  const lateHandler = createApproval({
    now: () => new Date(NOW.getTime() + 11 * 60 * 1000),
  });
  const expired = await lateHandler.handler(
    makeRequest(APPROVE_PATH, { intentAuthorization: SIGNED.token }),
  );
  assert.equal(expired.status, 403);

  assert.equal(state.loads.length, 0);
  assert.equal(state.approvals.length, 0);
});

test("a missing signing secret fails closed", async () => {
  const { handler, state } = createApproval({ intentSecret: () => null });

  const response = await handler(
    makeRequest(APPROVE_PATH, { intentAuthorization: SIGNED.token }),
  );

  assert.equal(response.status, 503);
  assert.equal(state.loads.length, 0);
});

test("the intent is reloaded and must match the token binding", async () => {
  const notFound = createApproval({
    loadIntent: async () => ({
      ok: false,
      code: "not_found",
      message: "missing",
    }),
  });

  const notFoundResponse = await notFound.handler(
    makeRequest(APPROVE_PATH, { intentAuthorization: SIGNED.token }),
  );
  assert.equal(notFoundResponse.status, 404);

  const unavailable = createApproval({
    loadIntent: async () => ({
      ok: false,
      code: "unavailable",
      message: "db down",
    }),
  });

  const unavailableResponse = await unavailable.handler(
    makeRequest(APPROVE_PATH, { intentAuthorization: SIGNED.token }),
  );
  assert.equal(unavailableResponse.status, 503);

  for (const mismatched of [
    intent({ merchantWallet: ATTACKER }),
    intent({ nonce: "cd".repeat(16) }),
    intent({ intentFingerprint: "c".repeat(64) }),
  ]) {
    const { handler, state } = createApproval({
      loadIntent: async () => ({ ok: true, intent: mismatched }),
    });

    const response = await handler(
      makeRequest(APPROVE_PATH, { intentAuthorization: SIGNED.token }),
    );

    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "intent_binding_mismatch");
    assert.equal(state.approvals.length, 0);
  }
});

test("cancelled, expired, submitted and expired-draft intents cannot be approved", async () => {
  const cases: {
    candidate: AgentPaymentIntent;
    status: number;
    code: string;
  }[] = [
    {
      candidate: intent({ status: "cancelled" }),
      status: 409,
      code: "intent_cancelled",
    },
    {
      candidate: intent({ status: "expired" }),
      status: 409,
      code: "intent_expired",
    },
    {
      candidate: intent({ status: "submitted", transactionSignature: "1".repeat(64) }),
      status: 409,
      code: "intent_not_approvable",
    },
    {
      candidate: intent({ status: "verified" }),
      status: 409,
      code: "intent_not_approvable",
    },
    {
      candidate: intent({ expiresAt: new Date(NOW.getTime() - 1).toISOString() }),
      status: 409,
      code: "intent_expired",
    },
  ];

  for (const { candidate, status, code } of cases) {
    const { handler, state } = createApproval({
      loadIntent: async () => ({ ok: true, intent: candidate }),
    });

    const response = await handler(
      makeRequest(APPROVE_PATH, { intentAuthorization: SIGNED.token }),
    );

    assert.equal(response.status, status, code);
    assert.equal((await response.json()).code, code);
    assert.equal(state.approvals.length, 0);
  }
});

test("duplicate approval is an idempotent 200 on the same row", async () => {
  const { handler } = createApproval({
    approveIntent: async () => ({
      ok: true,
      outcome: "already_approved",
      intent: approvedIntent(),
    }),
  });

  const response = await handler(
    makeRequest(APPROVE_PATH, { intentAuthorization: SIGNED.token }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "approved");
  assert.equal(body.outcome, "already_approved");
  assert.equal(body.intentId, "AI-12345678");
  assert.equal(body.approvedAt, APPROVED_AT);
});

test("approval RPC rejections map to stable codes without leaking internals", async () => {
  const cases = [
    { result: { ok: false, code: "rejected", outcome: "unknown", message: "x" }, status: 404 },
    { result: { ok: false, code: "rejected", outcome: "wrong_merchant", message: "x" }, status: 404 },
    { result: { ok: false, code: "rejected", outcome: "revoked", message: "x" }, status: 409 },
    { result: { ok: false, code: "rejected", outcome: "expired", message: "x" }, status: 409 },
    { result: { ok: false, code: "rejected", outcome: "invalid_status", message: "x" }, status: 409 },
    { result: { ok: false, code: "rejected", outcome: "fingerprint_mismatch", message: "x" }, status: 409 },
    { result: { ok: false, code: "rejected", outcome: "invalid_request", message: "x" }, status: 400 },
    { result: { ok: false, code: "unavailable", message: "database exploded" }, status: 503 },
    { result: { ok: false, code: "invalid", message: "bad" }, status: 400 },
    { result: { ok: false, code: "conflict", message: "dup" }, status: 409 },
  ] as const;

  for (const { result, status } of cases) {
    const { handler } = createApproval({
      approveIntent: async () => result,
    });

    const response = await handler(
      makeRequest(APPROVE_PATH, { intentAuthorization: SIGNED.token }),
    );
    const body = await response.json();

    assert.equal(response.status, status, result.code);
    assert.doesNotMatch(JSON.stringify(body), /exploded|database/i);
  }

  const threw = createApproval({
    approveIntent: async () => {
      throw new Error("connection reset");
    },
  });

  const threwResponse = await threw.handler(
    makeRequest(APPROVE_PATH, { intentAuthorization: SIGNED.token }),
  );
  assert.equal(threwResponse.status, 503);
});

// ---------------------------------------------------------------------------
// Preparation
// ---------------------------------------------------------------------------

const PREPARED: PreparedAgentTransfer = {
  cluster: "devnet",
  transactionBase64: "AQIDBA==",
  transactionHash: "a".repeat(64),
  messageHash: "b".repeat(64),
  canonicalFingerprint: "c".repeat(64),
  blockhash: "11111111111111111111111111111111",
  lastValidBlockHeight: 300_000_000n,
  feePayer: SESSION,
  sender: SESSION,
  recipient: RECIPIENT,
  amountLamports: 1_500_000_000n,
  estimatedFeeLamports: 5_000n,
  instructionCount: 1,
};

function createPrepare(
  overrides: Partial<IntentPrepareDependencies> = {},
) {
  const state = {
    loads: [] as { merchantWallet: string; id: string }[],
    preparations: [] as {
      intent: {
        id: string;
        nonce: string;
        merchantWallet: string;
        recipientAddress: string;
        amountLamports: string;
      };
    }[],
    recorded: [] as {
      nonce: string;
      merchantWallet: string;
      messageHash: string;
      canonicalFingerprint: string;
      blockhash: string;
      lastValidBlockHeight: string;
    }[],
    capabilityCalls: 0,
  };

  const handler = createIntentPreparePostHandler({
    resolveMerchant: async () => SESSION,
    checkRateLimit: async () => ({ ok: true }),
    checkCapability: async () => {
      state.capabilityCalls += 1;
      return { ok: true };
    },
    loadIntent: async (input) => {
      state.loads.push(input);
      return { ok: true, intent: approvedIntent() };
    },
    prepareTransfer: async (input) => {
      state.preparations.push(input);
      return PREPARED;
    },
    recordPreparation: async (input) => {
      state.recorded.push(input);
      return { ok: true, outcome: "recorded" };
    },
    now: () => NOW,
    ...overrides,
  });

  return { handler, state };
}

test("preparation requires authentication and the capability", async () => {
  const unauthenticated = createPrepare({
    resolveMerchant: async () =>
      NextResponse.json({ error: "Authentication required." }, { status: 401 }),
  });

  assert.equal(
    (
      await unauthenticated.handler(
        makeRequest(PREPARE_PATH, { intentId: "AI-12345678" }),
      )
    ).status,
    401,
  );
  assert.equal(unauthenticated.state.loads.length, 0);

  const disabled = createPrepare({
    checkCapability: async () => ({ ok: false, reason: "disabled" }),
  });

  const disabledResponse = await disabled.handler(
    makeRequest(PREPARE_PATH, { intentId: "AI-12345678" }),
  );

  assert.equal(disabledResponse.status, 403);
  assert.equal(disabled.state.loads.length, 0);
  assert.equal(disabled.state.preparations.length, 0);
});

test("preparation accepts only a valid intent id", async () => {
  const { handler, state } = createPrepare();

  for (const body of [
    {},
    { intentId: "" },
    { intentId: "AI-123" },
    { intentId: "not-an-intent" },
    { intentId: 42 },
  ]) {
    const response = await handler(makeRequest(PREPARE_PATH, body));
    assert.equal(response.status, 400);
  }

  const oversized = await handler(
    makeRequest(PREPARE_PATH, {
      intentId: "AI-12345678",
      padding: "a".repeat(INTENT_PREPARE_BODY_BYTES),
    }),
  );
  assert.equal(oversized.status, 413);

  assert.equal(state.loads.length, 0);
});

test("preparation reloads by id scoped to the session wallet", async () => {
  const { handler, state } = createPrepare();

  const response = await handler(
    makeRequest(PREPARE_PATH, {
      intentId: "AI-12345678",
      amountLamports: "1",
      recipientAddress: ATTACKER,
      feePayer: ATTACKER,
      merchantWallet: ATTACKER,
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(state.loads, [
    { merchantWallet: SESSION, id: "AI-12345678" },
  ]);
  assert.deepEqual(state.preparations, [
    {
      intent: {
        id: "AI-12345678",
        nonce: NONCE,
        merchantWallet: SESSION,
        recipientAddress: RECIPIENT,
        amountLamports: "1500000000",
      },
    },
  ]);

  // The compiled message hash is persisted before the transaction is returned.
  assert.deepEqual(state.recorded, [
    {
      nonce: NONCE,
      merchantWallet: SESSION,
      messageHash: PREPARED.messageHash,
      canonicalFingerprint: PREPARED.canonicalFingerprint,
      blockhash: PREPARED.blockhash,
      lastValidBlockHeight: "300000000",
    },
  ]);

  const body = await response.json();

  assert.equal(body.status, "prepared");
  assert.equal(body.cluster, "devnet");
  assert.equal(body.feePayer, SESSION);
  assert.equal(body.sender, SESSION);
  assert.equal(body.recipientAddress, RECIPIENT);
  assert.equal(body.amountLamports, "1500000000");
  assert.equal(body.amountSol, "1.5");
  assert.equal(body.estimatedFeeLamports, "5000");
  assert.equal(body.estimatedTotalLamports, "1500005000");
  assert.equal(body.signed, false);
  assert.equal(body.submitted, false);
  assert.equal(body.transaction, PREPARED.transactionBase64);
  assert.equal(body.transactionHash, PREPARED.transactionHash);
  assert.doesNotMatch(JSON.stringify(body), /privateKey|secret/i);
});

test("a preparation that cannot be persisted is not returned to the wallet", async () => {
  const { handler } = createPrepare({
    recordPreparation: async () => ({
      ok: false,
      code: "unavailable",
      message: "db down",
    }),
  });

  const response = await handler(
    makeRequest(PREPARE_PATH, { intentId: "AI-12345678" }),
  );
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal("transaction" in body, false);
  assert.doesNotMatch(JSON.stringify(body), /db down/);
});

test("preparation refuses intents that are not approved or whose approval expired", async () => {
  const cases: { candidate: AgentPaymentIntent; status: number; code: string }[] = [
    { candidate: intent({ status: "draft" }), status: 409, code: "intent_not_approved" },
    { candidate: intent({ status: "cancelled" }), status: 409, code: "intent_cancelled" },
    { candidate: intent({ status: "expired" }), status: 409, code: "intent_expired" },
    {
      candidate: intent({ status: "submitted", transactionSignature: "1".repeat(64) }),
      status: 409,
      code: "intent_in_progress",
    },
    { candidate: intent({ status: "verified" }), status: 409, code: "intent_in_progress" },
    {
      candidate: approvedIntent({
        approvalExpiresAt: new Date(NOW.getTime() - 1).toISOString(),
      }),
      status: 409,
      code: "approval_expired",
    },
    {
      candidate: approvedIntent({ approvalExpiresAt: null }),
      status: 409,
      code: "approval_expired",
    },
  ];

  for (const { candidate, status, code } of cases) {
    const { handler, state } = createPrepare({
      loadIntent: async () => ({ ok: true, intent: candidate }),
    });

    const response = await handler(
      makeRequest(PREPARE_PATH, { intentId: "AI-12345678" }),
    );

    assert.equal(response.status, status, code);
    assert.equal((await response.json()).code, code);
    assert.equal(state.preparations.length, 0);
  }
});

test("preparation maps RPC and construction failures to fail-closed responses", async () => {
  const cases = [
    { error: new AgentPaymentPreparationError("wrong-network", "mainnet"), status: 502, code: "network_mismatch" },
    { error: new AgentPaymentPreparationError("rpc-unavailable", "down"), status: 503, code: "rpc_unavailable" },
    { error: new AgentPaymentPreparationError("construction-failed", "bad"), status: 502, code: "preparation_failed" },
    { error: new AgentPaymentPreparationError("invalid-intent", "bad row"), status: 422, code: "invalid_intent" },
    { error: new Error("unexpected"), status: 502, code: "preparation_failed" },
  ] as const;

  for (const { error, status, code } of cases) {
    const { handler } = createPrepare({
      prepareTransfer: async () => {
        throw error;
      },
    });

    const response = await handler(
      makeRequest(PREPARE_PATH, { intentId: "AI-12345678" }),
    );
    const body = await response.json();

    assert.equal(response.status, status, code);
    assert.equal(body.code, code);
    assert.doesNotMatch(JSON.stringify(body), /mainnet|unexpected/);
  }
});

test("a prepared transaction that does not match the intent is refused", async () => {
  const variants: Partial<PreparedAgentTransfer>[] = [
    { recipient: ATTACKER },
    { amountLamports: 1n },
    { feePayer: ATTACKER },
    { sender: ATTACKER },
    { cluster: "mainnet" as unknown as "devnet" },
    { instructionCount: 2 as unknown as 1 },
  ];

  for (const variant of variants) {
    const { handler } = createPrepare({
      prepareTransfer: async () => ({ ...PREPARED, ...variant }),
    });

    const response = await handler(
      makeRequest(PREPARE_PATH, { intentId: "AI-12345678" }),
    );

    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, "preparation_failed");
  }
});

test("preparation never calls a send or sign dependency", async () => {
  const { handler } = createPrepare();

  const response = await handler(
    makeRequest(PREPARE_PATH, { intentId: "AI-12345678" }),
  );
  const body = await response.json();

  for (const forbidden of [
    "signature",
    "signedTransaction",
    "serializedTransaction",
    "wireTransaction",
    "privateKey",
  ]) {
    assert.equal(forbidden in body, false, forbidden);
  }
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

function createCancel(
  overrides: Partial<IntentCancelDependencies> = {},
) {
  const state = {
    loads: [] as { merchantWallet: string; id: string }[],
    revokes: [] as { nonce: string; merchantWallet: string }[],
    capabilityCalls: 0,
  };

  const handler = createIntentCancelPostHandler({
    resolveMerchant: async () => SESSION,
    checkRateLimit: async () => ({ ok: true }),
    loadIntent: async (input) => {
      state.loads.push(input);
      return { ok: true, intent: approvedIntent() };
    },
    revokeIntent: async (input) => {
      state.revokes.push(input);
      return { ok: true, outcome: "revoked" };
    },
    ...overrides,
  });

  return { handler, state };
}

test("cancellation works without the Agentic Payments capability", async () => {
  const { handler, state } = createCancel();

  const response = await handler(
    makeRequest(CANCEL_PATH, { intentId: "AI-12345678" }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "cancelled");
  assert.deepEqual(state.revokes, [
    { nonce: NONCE, merchantWallet: SESSION },
  ]);
});

test("cancellation is idempotent for an already-cancelled intent", async () => {
  const { handler, state } = createCancel({
    loadIntent: async () => ({
      ok: true,
      intent: intent({ status: "cancelled" }),
    }),
  });

  const response = await handler(
    makeRequest(CANCEL_PATH, { intentId: "AI-12345678" }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.outcome, "already_cancelled");
  assert.equal(state.revokes.length, 0);
});

test("a submitted or verified payment cannot be cancelled", async () => {
  for (const candidate of [
    intent({ status: "submitted", transactionSignature: "1".repeat(64) }),
    intent({ status: "verified" }),
  ]) {
    const { handler, state } = createCancel({
      loadIntent: async () => ({ ok: true, intent: candidate }),
    });

    const response = await handler(
      makeRequest(CANCEL_PATH, { intentId: "AI-12345678" }),
    );

    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "intent_in_progress");
    assert.equal(state.revokes.length, 0);
  }
});

test("cancellation maps unknown, expired and database failures", async () => {
  const notFound = createCancel({
    loadIntent: async () => ({ ok: false, code: "not_found", message: "x" }),
  });
  assert.equal(
    (
      await notFound.handler(
        makeRequest(CANCEL_PATH, { intentId: "AI-12345678" }),
      )
    ).status,
    404,
  );

  const expired = createCancel({
    loadIntent: async () => ({
      ok: true,
      intent: intent({ status: "expired" }),
    }),
  });

  const expiredResponse = await expired.handler(
    makeRequest(CANCEL_PATH, { intentId: "AI-12345678" }),
  );
  assert.equal(expiredResponse.status, 409);
  assert.equal((await expiredResponse.json()).code, "intent_expired");

  const rejected = createCancel({
    revokeIntent: async () => ({
      ok: false,
      code: "rejected",
      outcome: "approved",
      message: "submitted",
    }),
  });

  const rejectedResponse = await rejected.handler(
    makeRequest(CANCEL_PATH, { intentId: "AI-12345678" }),
  );
  assert.equal(rejectedResponse.status, 409);
  assert.equal((await rejectedResponse.json()).code, "intent_in_progress");

  const unavailable = createCancel({
    revokeIntent: async () => ({
      ok: false,
      code: "unavailable",
      message: "db down",
    }),
  });

  const unavailableResponse = await unavailable.handler(
    makeRequest(CANCEL_PATH, { intentId: "AI-12345678" }),
  );
  assert.equal(unavailableResponse.status, 503);
});

// ---------------------------------------------------------------------------
// Client-side parsing and wallet hints
// ---------------------------------------------------------------------------

test("approval payloads parse strictly and never expose the token", () => {
  const valid = {
    status: "approved",
    outcome: "already_approved",
    intentId: "AI-12345678",
    merchantWallet: SESSION,
    amountLamports: "1500000000",
    amountSol: "1.5",
    recipientAddress: RECIPIENT,
    purpose: "Logo design",
    reference: REFERENCE,
    intentExpiresAt: EXPIRES_AT,
    approvedAt: APPROVED_AT,
    approvalExpiresAt: APPROVAL_EXPIRES_AT,
    cluster: "devnet",
  };

  const parsed = parseIntentApprovalResponse(valid);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.approval.outcome, "already_approved");
  assert.equal(parsed.approval.amountLamports, "1500000000");

  for (const variant of [
    { ...valid, status: "prepared" },
    { ...valid, cluster: "mainnet" },
    { ...valid, intentId: "AI-123" },
    { ...valid, amountLamports: "1.5" },
    { ...valid, amountLamports: "0" },
    { ...valid, approvalExpiresAt: valid.approvedAt },
    { ...valid, recipientAddress: "" },
    { ...valid, outcome: "maybe" },
  ]) {
    assert.equal(parseIntentApprovalResponse(variant).ok, false);
  }
});

test("prepare payloads must be unsigned, unsent and internally consistent", () => {
  const valid = {
    status: "prepared",
    intentId: "AI-12345678",
    cluster: "devnet",
    feePayer: SESSION,
    sender: SESSION,
    recipientAddress: RECIPIENT,
    amountLamports: "1500000000",
    amountSol: "1.5",
    estimatedFeeLamports: "5000",
    estimatedTotalLamports: "1500005000",
    transaction: "AQIDBA==",
    transactionHash: "a".repeat(64),
    blockhash: "11111111111111111111111111111111",
    lastValidBlockHeight: "300000000",
    approvalExpiresAt: APPROVAL_EXPIRES_AT,
    signed: false,
    submitted: false,
  };

  const parsed = parseIntentPrepareResponse(valid);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.prepared.signed, false);
  assert.equal(parsed.prepared.submitted, false);
  assert.equal(parsed.prepared.approvalExpiresAtEpochMs, Date.parse(APPROVAL_EXPIRES_AT));

  for (const variant of [
    { ...valid, signed: true },
    { ...valid, submitted: true },
    { ...valid, cluster: "mainnet" },
    { ...valid, transaction: "not base64!" },
    { ...valid, transactionHash: "abc" },
    { ...valid, feePayer: ATTACKER },
    { ...valid, amountLamports: "0" },
    { ...valid, estimatedTotalLamports: "0" },
    { ...valid, lastValidBlockHeight: "soon" },
  ]) {
    assert.equal(parseIntentPrepareResponse(variant).ok, false);
  }
});

test("cancel responses parse and failure messages are fixed", () => {
  const cancelled = parseIntentCancelResponse({
    status: "cancelled",
    outcome: "revoked",
  });
  assert.equal(cancelled.ok, true);

  const failed = parseIntentCancelResponse({
    status: "error",
    code: "intent_in_progress",
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.code, "intent_in_progress");
    assert.doesNotMatch(failed.message, /error|database/i);
  }
});

test("wallet mismatch is detected before any request leaves the browser", () => {
  assert.deepEqual(
    checkWalletForIntent({ sessionWallet: SESSION, connectedWallet: SESSION }),
    { ok: true },
  );

  const noSession = checkWalletForIntent({
    sessionWallet: null,
    connectedWallet: SESSION,
  });
  assert.equal(noSession.ok, false);
  if (!noSession.ok) assert.equal(noSession.code, "session_expired");

  const disconnected = checkWalletForIntent({
    sessionWallet: SESSION,
    connectedWallet: null,
  });
  assert.equal(disconnected.ok, false);
  if (!disconnected.ok) assert.equal(disconnected.code, "wallet_disconnected");

  const mismatch = checkWalletForIntent({
    sessionWallet: SESSION,
    connectedWallet: ATTACKER,
  });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.code, "wallet_mismatch");
});

test("terminal failures hide the approve action", () => {
  assert.equal(isTerminalIntentFailure("intent_expired"), true);
  assert.equal(isTerminalIntentFailure("approval_expired"), true);
  assert.equal(isTerminalIntentFailure("intent_cancelled"), true);
  assert.equal(isTerminalIntentFailure("capability_disabled"), true);
  assert.equal(isTerminalIntentFailure("rpc_unavailable"), false);
  assert.equal(isTerminalIntentFailure("network_error"), false);
});

// ---------------------------------------------------------------------------
// Source boundaries
// ---------------------------------------------------------------------------

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("the lifecycle endpoints reuse the shared auth, guards and rate limits", () => {
  const guard = source("../src/lib/ai/intent-route-guards.ts");

  assert.match(guard, /requireMerchant/);
  assert.match(guard, /checkClientRateLimit/);
  assert.match(guard, /checkWalletRateLimit/);
  assert.match(guard, /readJsonBody/);
  assert.match(guard, /hasJsonContentType/);
  assert.match(guard, /isSameOriginRequest/);
  assert.match(guard, /resolveCapabilityGate/);
  assert.match(guard, /"ai-payment-intent-write"/);

  const approval = source("../src/lib/ai/intent-approval-handler.ts");
  const prepare = source("../src/lib/ai/intent-prepare-handler.ts");
  const cancel = source("../src/lib/ai/intent-cancel-handler.ts");

  for (const [name, handler] of [
    ["approval", approval],
    ["prepare", prepare],
    ["cancel", cancel],
  ] as const) {
    assert.match(handler, /guardIntentRequest/, name);
    assert.doesNotMatch(handler, /request\.json\(\)/, name);
    assert.doesNotMatch(handler, /sendTransaction|signTransaction|Keypair/, name);
  }

  // Cancellation is not capability-gated.
  assert.doesNotMatch(cancel, /checkCapability|agenticPaymentsGate/);
});

test("approval and preparation never sign, send or mark the intent submitted", () => {
  const files = [
    "../src/lib/ai/intent-approval-handler.ts",
    "../src/lib/ai/intent-prepare-handler.ts",
    "../src/lib/ai/intent-cancel-handler.ts",
    "../src/lib/solana/agent-payment.ts",
    "../src/app/api/ai/payment-intents/approve/route.ts",
    "../src/app/api/ai/payment-intents/prepare/route.ts",
    "../src/app/api/ai/payment-intents/cancel/route.ts",
  ];

  for (const file of files) {
    const text = source(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    for (const forbidden of [
      "sendTransaction",
      "signTransaction",
      "Keypair",
      "privateKey",
      "localStorage",
      "submitAgentPaymentIntent",
      "verifyAgentPaymentIntent",
      "failAgentPaymentIntent",
    ]) {
      assert.equal(
        text.includes(forbidden),
        false,
        `${file} must not reference ${forbidden}`,
      );
    }
  }
});

test("the UI keeps tokens out of storage, URLs and rendered models", () => {
  const stripComments = (text: string) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  const card = stripComments(
    source("../src/components/ai-chat/payment-intent-card.tsx"),
  );
  const assistant = stripComments(
    source("../src/app/ai-assistant/ai-assistant-client.tsx"),
  );

  for (const [name, text] of [
    ["card", card],
    ["assistant", assistant],
  ] as const) {
    assert.doesNotMatch(text, /localStorage|sessionStorage/, name);
    assert.doesNotMatch(text, /location\.(href|search)|URLSearchParams/, name);
  }

  assert.doesNotMatch(card, /intentAuthorization/);
  assert.doesNotMatch(card, /ppi1\./);
  assert.doesNotMatch(card, /buildPaymentTransfer/);
  assert.match(assistant, /readIntentAuthorizationToken/);
  assert.match(
    assistant,
    /useRef<Map<string, string>>/,
    "authorizations live in a ref map",
  );
});

test("the customer checkout was not rewired", () => {
  const checkout = source("../src/components/checkout/checkout-payment.tsx");

  assert.doesNotMatch(
    checkout,
    /agent-payment|payment-intents\/approve|payment-intents\/prepare/,
  );
  assert.match(checkout, /buildPaymentTransfer/);
});

test("the settings link used by capability messages still exists", () => {
  assert.equal(AI_SETTINGS_HREF, "/settings?section=ai");
});
