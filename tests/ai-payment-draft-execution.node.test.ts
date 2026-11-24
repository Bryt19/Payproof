import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NextRequest, NextResponse } from "next/server";

import {
  createDraftToken,
  verifyDraftToken,
  DRAFT_TOKEN_PREFIX,
  MAX_DRAFT_TOKEN_LENGTH,
} from "../src/lib/ai/draft-token.ts";
import {
  draftAuthorizationFingerprint,
  generateDraftNonce,
} from "../src/lib/ai/authorization-registry.ts";
import { createPaymentDraftReauthorizeHandler } from "../src/lib/ai/payment-draft-reauthorize-handler.ts";
import { createPaymentDraftExecuteHandler } from "../src/lib/ai/payment-draft-execute-handler.ts";
import {
  parseExecutionResponse,
  parseReauthorizeResponse,
} from "../src/lib/ai/draft-execution.ts";
import type { ReauthorizeAuthorizationResult } from "../src/lib/ai/authorization-registry.ts";
import type { CreatePaymentRequestResult } from "../src/lib/payment-requests/create-for-session.ts";
import type { RateLimitOutcome } from "../src/lib/auth/rate-limit.ts";
import type { PaymentRequest } from "../src/lib/payment-requests/types.ts";
import type { PaymentRequestDraft } from "../src/lib/ai/payment-draft.ts";

const SECRET = "stage-2b-test-secret-0123456789abcdef";
const SESSION_WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const MERCHANT_B = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const NOW = new Date("2026-11-22T10:00:00.000Z");
const NONCE = "a".repeat(32);
const EXPIRES_AT = new Date(NOW.getTime() + 10 * 60 * 1000).toISOString();

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
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/ai/payment-drafts/execute", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...headers,
    },
    body: JSON.stringify(body),
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

function executeHandler(overrides: {
  resolveMerchant?: () => Promise<string | NextResponse>;
  checkRateLimit?: () => Promise<RateLimitOutcome>;
  createAuthorizedRequest?: (input: {
    wallet: string;
    draft: PaymentRequestDraft;
    nonce: string;
    fingerprint: string;
  }) => Promise<CreatePaymentRequestResult>;
  draftSecret?: () => string | null;
  now?: () => Date;
} = {}) {
  const state = { executeCalls: 0, lastInput: null as null | {
    wallet: string;
    draft: PaymentRequestDraft;
    nonce: string;
    fingerprint: string;
  } };

  const handler = createPaymentDraftExecuteHandler({
    resolveMerchant: async () =>
      overrides.resolveMerchant ? overrides.resolveMerchant() : SESSION_WALLET,
    checkRateLimit: async () =>
      overrides.checkRateLimit ? overrides.checkRateLimit() : { ok: true },
    createAuthorizedRequest: async (input) => {
      state.executeCalls += 1;
      state.lastInput = input;
      return overrides.createAuthorizedRequest
        ? overrides.createAuthorizedRequest(input)
        : {
            ok: true,
            request: createdRequest(),
            authorizationOutcome: "created",
          };
    },
    draftSecret: overrides.draftSecret ?? (() => SECRET),
    now: overrides.now ?? (() => NOW),
  });

  return { handler, state };
}

function reauthorizeHandler(overrides: {
  resolveMerchant?: () => Promise<string | NextResponse>;
  checkRateLimit?: () => Promise<RateLimitOutcome>;
  reauthorize?: (input: {
    oldNonce: string;
    newNonce: string;
    merchantWallet: string;
    newExpiresAt: string;
    newFingerprint: string;
  }) => Promise<ReauthorizeAuthorizationResult>;
  draftSecret?: () => string | null;
  now?: () => Date;
} = {}) {
  const state = { calls: 0, lastInput: null as null | {
    oldNonce: string;
    newNonce: string;
    merchantWallet: string;
    newExpiresAt: string;
    newFingerprint: string;
  } };

  const handler = createPaymentDraftReauthorizeHandler({
    resolveMerchant: async () =>
      overrides.resolveMerchant ? overrides.resolveMerchant() : SESSION_WALLET,
    checkRateLimit: async () =>
      overrides.checkRateLimit ? overrides.checkRateLimit() : { ok: true },
    reauthorize: async (input) => {
      state.calls += 1;
      state.lastInput = input;
      return overrides.reauthorize
        ? overrides.reauthorize(input)
        : { ok: true, outcome: "reauthorized" };
    },
    createToken: (draft, wallet, options) =>
      createDraftToken(draft, wallet, options),
    draftSecret: overrides.draftSecret ?? (() => SECRET),
    now: overrides.now ?? (() => NOW),
  });

  return { handler, state };
}

function editedBody(draftToken: string) {
  return {
    draftToken,
    draft: {
      amount: "0.75",
      description: "Website redesign",
      customerName: "Ama Mensah",
      customerEmail: "ama@example.com",
    },
  };
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test("execution rejects an unauthenticated request before touching the registry", async () => {
  const { handler, state } = executeHandler({
    resolveMerchant: async () =>
      NextResponse.json({ error: "Authentication required." }, { status: 401 }),
  });

  const response = await handler(request({ draftToken: tokenFor().token }));

  assert.equal(response.status, 401);
  assert.equal(state.executeCalls, 0);
});

test("re-authorization rejects an unauthenticated request", async () => {
  const { handler, state } = reauthorizeHandler({
    resolveMerchant: async () =>
      NextResponse.json({ error: "Authentication required." }, { status: 401 }),
  });

  const response = await handler(request(editedBody(tokenFor().token)));

  assert.equal(response.status, 401);
  assert.equal(state.calls, 0);
});

test("merchant B cannot execute merchant A's token", async () => {
  const { handler, state } = executeHandler({
    resolveMerchant: async () => MERCHANT_B,
  });

  const response = await handler(request({ draftToken: tokenFor().token }));
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.code, "wrong_merchant");
  assert.equal(state.executeCalls, 0);
});

test("forged wallet and draft fields in the execute body are ignored", async () => {
  const { handler, state } = executeHandler();

  const response = await handler(
    request({
      draftToken: tokenFor().token,
      merchantAddress: MERCHANT_B,
      wallet: MERCHANT_B,
      draft: {
        amount: "9.5",
        amountLamports: "9500000000",
        description: "attacker description",
      },
    }),
  );

  assert.equal(response.status, 201);
  assert.equal(state.lastInput?.wallet, SESSION_WALLET);
  assert.equal(state.lastInput?.draft.amountLamports, "500000000");
  assert.equal(state.lastInput?.draft.description, "website development");
});

// ---------------------------------------------------------------------------
// Token security
// ---------------------------------------------------------------------------

test("tampered, malformed and expired tokens are rejected before the registry", async () => {
  const { handler, state } = executeHandler();
  const valid = tokenFor().token;
  const [prefix, payload, signature] = valid.split(".");
  const tamperedPayload = `${payload.slice(0, -2)}${
    payload.endsWith("A") ? "B" : "A"
  }`;

  const cases: Array<{ token: string; status: number; code: string }> = [
    {
      token: `${prefix}.${tamperedPayload}.${signature}`,
      status: 400,
      code: "invalid_authorization",
    },
    { token: "not-a-token", status: 400, code: "invalid_authorization" },
    {
      token: tokenFor({ now: new Date(NOW.getTime() - 11 * 60 * 1000) }).token,
      status: 410,
      code: "expired_authorization",
    },
  ];

  for (const testCase of cases) {
    const response = await handler(request({ draftToken: testCase.token }));
    const body = await response.json();

    assert.equal(response.status, testCase.status);
    assert.equal(body.code, testCase.code);
  }

  assert.equal(state.executeCalls, 0);
});

test("a token whose amount or description was altered fails signature verification", async () => {
  const { handler, state } = executeHandler();
  const valid = tokenFor().token;
  const [prefix, payload, signature] = valid.split(".");

  for (const replacement of ["0.6", "different description"]) {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (replacement === "0.6") {
      decoded.draft.amountSol = "0.6";
      decoded.draft.amountLamports = "600000000";
    } else {
      decoded.draft.description = replacement;
    }

    const tampered = `${prefix}.${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;
    const response = await handler(request({ draftToken: tampered }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "invalid_authorization");
  }

  assert.equal(state.executeCalls, 0);
});

test("revoked and unknown authorizations are rejected without creating anything", async () => {
  for (const outcome of ["revoked", "unknown"] as const) {
    const { handler } = executeHandler({
      createAuthorizedRequest: async () => ({
        ok: false,
        reason: "authorization",
        error: "authorization rejected",
        authorizationOutcome: outcome,
      }),
    });

    const response = await handler(request({ draftToken: tokenFor().token }));
    const body = await response.json();

    assert.equal(response.status, outcome === "unknown" ? 404 : 409);
    assert.equal(
      body.code,
      outcome === "unknown" ? "unknown_authorization" : "authorization_revoked",
    );
  }
});

test("a consumed authorization retry returns the original request", async () => {
  const original = createdRequest();
  const { handler } = executeHandler({
    createAuthorizedRequest: async () => ({
      ok: true,
      request: original,
      authorizationOutcome: "already_consumed",
    }),
  });

  const response = await handler(request({ draftToken: tokenFor().token }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "already_created");
  assert.equal(body.request.id, original.id);
  assert.equal(body.request.reference, original.reference);
  assert.equal(body.alreadyCreated, true);
});

// ---------------------------------------------------------------------------
// Re-authorization
// ---------------------------------------------------------------------------

test("successful re-authorization returns a new token bound to the edited values", async () => {
  const original = tokenFor();
  const { handler, state } = reauthorizeHandler();

  const response = await handler(request(editedBody(original.token)));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "awaiting_confirmation");
  assert.equal(body.draft.amountSol, "0.75");
  assert.equal(body.draft.amountLamports, "750000000");
  assert.equal(body.draft.description, "Website redesign");
  assert.notEqual(body.draftToken, original.token);

  const verified = verifyDraftToken(body.draftToken, {
    secret: SECRET,
    now: NOW,
    wallet: SESSION_WALLET,
  });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.notEqual(verified.payload.nonce, NONCE);
  assert.equal(verified.payload.draft.amountLamports, "750000000");

  // The registry call must revoke the old nonce and register the new one.
  assert.equal(state.lastInput?.oldNonce, NONCE);
  assert.equal(state.lastInput?.newNonce, verified.payload.nonce);
  assert.equal(state.lastInput?.merchantWallet, SESSION_WALLET);
  assert.equal(
    state.lastInput?.newFingerprint,
    draftAuthorizationFingerprint(
      verified.payload.draft,
      SESSION_WALLET,
      verified.payload.nonce,
    ),
  );
});

test("invalid edited fields are rejected before any registry transaction", async () => {
  const { handler, state } = reauthorizeHandler();

  const response = await handler(
    request({
      draftToken: tokenFor().token,
      draft: {
        amount: "0.5.5",
        description: "x",
        customerName: "",
        customerEmail: "not-an-email",
      },
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.status, "invalid");
  assert.ok(Array.isArray(body.errors));
  assert.equal(state.calls, 0);
});

test("a failed registry transaction returns no new token", async () => {
  const { handler } = reauthorizeHandler({
    reauthorize: async () => ({ ok: true, outcome: "revoked" }),
  });

  const response = await handler(request(editedBody(tokenFor().token)));
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, "authorization_revoked");
  assert.equal(body.draftToken, undefined);
});

test("cross-merchant re-authorization is rejected", async () => {
  const { handler, state } = reauthorizeHandler({
    resolveMerchant: async () => MERCHANT_B,
  });

  const response = await handler(request(editedBody(tokenFor().token)));

  assert.equal(response.status, 403);
  assert.equal(state.calls, 0);
});

test("an expired original token cannot be re-authorized", async () => {
  const expired = tokenFor({ now: new Date(NOW.getTime() - 11 * 60 * 1000) });
  const { handler, state } = reauthorizeHandler();

  const response = await handler(request(editedBody(expired.token)));
  const body = await response.json();

  assert.equal(response.status, 410);
  assert.equal(body.code, "expired_authorization");
  assert.equal(state.calls, 0);
});

test("after re-authorization the old token is revoked and the new token executes", async () => {
  const status = new Map<string, string>([[NONCE, "active"]]);
  const oldToken = tokenFor().token;
  const newRequest = createdRequest({ amountLamports: "750000000" });

  const reauth = reauthorizeHandler({
    reauthorize: async (input) => {
      status.set(input.oldNonce, "revoked");
      status.set(input.newNonce, "active");
      return { ok: true, outcome: "reauthorized" };
    },
  });

  const execute = executeHandler({
    createAuthorizedRequest: async (input) => {
      const current = status.get(input.nonce);

      if (current === "revoked") {
        return {
          ok: false,
          reason: "authorization",
          authorizationOutcome: "revoked",
          error: "revoked",
        };
      }
      if (current === "consumed") {
        return {
          ok: true,
          request: newRequest,
          authorizationOutcome: "already_consumed",
        };
      }
      if (current !== "active") {
        return {
          ok: false,
          reason: "authorization",
          authorizationOutcome: "unknown",
          error: "unknown",
        };
      }

      status.set(input.nonce, "consumed");
      return {
        ok: true,
        request: newRequest,
        authorizationOutcome: "created",
      };
    },
  });

  const reauthorized = await reauth.handler(request(editedBody(oldToken)));
  const reauthorizedBody = await reauthorized.json();

  const oldAttempt = await execute.handler(
    request({ draftToken: oldToken }),
  );
  assert.equal(oldAttempt.status, 409);
  assert.equal((await oldAttempt.json()).code, "authorization_revoked");

  const newAttempt = await execute.handler(
    request({ draftToken: reauthorizedBody.draftToken }),
  );
  assert.equal(newAttempt.status, 201);

  const replay = await execute.handler(
    request({ draftToken: reauthorizedBody.draftToken }),
  );
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).status, "already_created");
});

// ---------------------------------------------------------------------------
// Execution correctness and idempotency
// ---------------------------------------------------------------------------

test("successful execution returns the real request and checkout URL", async () => {
  const { handler, state } = executeHandler();

  const response = await handler(request({ draftToken: tokenFor().token }));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.status, "created");
  assert.equal(body.request.amountLamports, "500000000");
  assert.equal(body.request.merchantAddress, SESSION_WALLET);
  assert.match(body.checkoutUrl, /^http:\/\/localhost\/pay\//);
  assert.equal(state.executeCalls, 1);
});

test("execution preserves the exact lamports and token merchant recipient", async () => {
  const { handler, state } = executeHandler({
    createAuthorizedRequest: async (input) => ({
      ok: true,
      authorizationOutcome: "created",
      request: createdRequest({
        amountLamports: input.draft.amountLamports,
        merchantAddress: input.wallet,
      }),
    }),
  });

  const draft = {
    ...DRAFT,
    amountLamports: "123456789",
    amountSol: "0.123456789",
  };

  const response = await handler(
    request({ draftToken: tokenFor({ draft }).token }),
  );

  assert.equal(response.status, 201);
  assert.equal(state.lastInput?.draft.amountLamports, "123456789");
  assert.equal(state.lastInput?.wallet, SESSION_WALLET);
});

test("concurrent execution returns a retryable conflict", async () => {
  const { handler } = executeHandler({
    createAuthorizedRequest: async () => ({
      ok: false,
      reason: "authorization",
      authorizationOutcome: "processing",
      error: "processing",
    }),
  });

  const response = await handler(request({ draftToken: tokenFor().token }));
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, "authorization_processing");
  assert.equal(response.headers.get("retry-after"), "1");
});

test("creation and database failures fail closed without a success payload", async () => {
  const { handler } = executeHandler({
    createAuthorizedRequest: async () => ({
      ok: false,
      reason: "unavailable",
      error: "database unavailable",
    }),
  });

  const response = await handler(request({ draftToken: tokenFor().token }));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.status, "error");
  assert.equal(body.request, undefined);
});

test("rate limiting blocks execution before the registry", async () => {
  const { handler, state } = executeHandler({
    checkRateLimit: async () => ({
      ok: false,
      kind: "limited",
      retryAfterSeconds: 30,
    }),
  });

  const response = await handler(request({ draftToken: tokenFor().token }));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal(state.executeCalls, 0);
});

// ---------------------------------------------------------------------------
// Frontend parsing and no premature success
// ---------------------------------------------------------------------------

test("execution responses parse a real created request and checkout link", () => {
  const parsed = parseExecutionResponse({
    status: "created",
    request: createdRequest(),
    checkoutUrl: "https://payproof.example/pay/abc",
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.request.amountSol, "0.5");
  assert.equal(parsed.checkoutUrl, "https://payproof.example/pay/abc");
  assert.equal(parsed.alreadyCreated, false);
});

test("failed or malformed execution responses never become success", () => {
  const malformed = [
    null,
    {},
    { status: "created" },
    { status: "created", request: createdRequest() },
    {
      status: "created",
      request: createdRequest(),
      checkoutUrl: "javascript:alert(1)",
    },
    { status: "created", request: { ...createdRequest(), amountLamports: "x" }, checkoutUrl: "https://example.com" },
  ];

  for (const payload of malformed) {
    const parsed = parseExecutionResponse(payload);
    assert.equal(parsed.ok, false);
  }

  const error = parseExecutionResponse({
    status: "error",
    code: "authorization_processing",
    error: "Already being processed.",
  });
  assert.equal(error.ok, false);
  if (!error.ok) assert.equal(error.code, "authorization_processing");
});

test("re-authorization responses parse into a fresh review state", () => {
  const signed = tokenFor();
  const parsed = parseReauthorizeResponse({
    status: "awaiting_confirmation",
    draft: DRAFT,
    draftToken: signed.token,
    expiresAt: EXPIRES_AT,
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.review.draftToken, signed.token);
  assert.equal(parsed.review.draft.amountSol, "0.5");
});

test("the card shows success only from a successful approval result and renders the checkout link", () => {
  const card = readFileSync(
    new URL("../src/components/ai-chat/payment-draft-card.tsx", import.meta.url),
    "utf8",
  );

  assert.match(card, /const result = await onApprove/);
  assert.match(card, /if \(!result\.ok\)/);
  assert.match(card, /setApprovalResult\(result\)/);
  assert.match(card, /approvalState === "success"/);
  assert.match(card, /approvalResult\.checkoutUrl/);
  assert.match(card, /Copy link/);
  assert.match(card, /Open checkout/);
  assert.match(card, /Approving…/);
});

test("Gemini and the review client have no execution capability", () => {
  const gemini = readFileSync(
    new URL("../src/lib/ai/gemini-payment-draft.ts", import.meta.url),
    "utf8",
  );
  const client = readFileSync(
    new URL("../src/app/ai-assistant/ai-assistant-client.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(gemini, /payment-drafts\/execute|payment-drafts\/reauthorize/);
  assert.doesNotMatch(gemini, /authorization-registry|AI_DRAFT_TOKEN_SECRET/);
  assert.doesNotMatch(client, /authorization-registry|supabase/i);
  assert.doesNotMatch(client, /merchantAddress:\s*(review|message)/);
});

test("the client re-authorizes edited drafts before execution and never signs tokens", () => {
  const client = readFileSync(
    new URL("../src/app/ai-assistant/ai-assistant-client.tsx", import.meta.url),
    "utf8",
  );

  assert.match(client, /if \(isDraftEdited\(review\)\)/);
  assert.match(client, /\/api\/ai\/payment-drafts\/reauthorize/);
  assert.match(client, /\/api\/ai\/payment-drafts\/execute/);
  assert.match(client, /updateDraft\(messageId, authorized\)/);
  assert.doesNotMatch(client, /createDraftToken|createHmac|AI_DRAFT_TOKEN_SECRET/);
  assert.match(client, /body: JSON.stringify\(\{ draftToken: review\.draftToken \}\)/);
});

// ---------------------------------------------------------------------------
// Migration and registry static guarantees
// ---------------------------------------------------------------------------

const MIGRATION = readFileSync(
  new URL(
    "../supabase/migrations/20261122120000_ai_payment_draft_authorizations.sql",
    import.meta.url,
  ),
  "utf8",
);

test("the registry migration enforces states, ownership, expiry and idempotency", () => {
  assert.match(MIGRATION, /create table if not exists public\.ai_payment_draft_authorizations/i);
  assert.match(MIGRATION, /nonce\s+text primary key/i);
  assert.match(MIGRATION, /merchant_wallet\s+text not null/i);
  assert.match(MIGRATION, /status in \('active', 'revoked', 'processing', 'consumed'\)/i);
  assert.match(MIGRATION, /payment_request_id\s+text references public\.payment_requests/i);
  assert.match(MIGRATION, /ai_draft_auth_request_unique/i);
  assert.match(MIGRATION, /where payment_request_id is not null/i);
  assert.match(MIGRATION, /ai_draft_auth_consumed_consistency/i);
});

test("the registry is service-role only with no client access", () => {
  assert.match(MIGRATION, /enable row level security/i);
  assert.match(MIGRATION, /revoke all on table public\.ai_payment_draft_authorizations from public/i);
  assert.match(MIGRATION, /revoke all on table public\.ai_payment_draft_authorizations from anon/i);
  assert.match(MIGRATION, /revoke all on table public\.ai_payment_draft_authorizations from authenticated/i);
  assert.match(MIGRATION, /grant select, insert, update, delete[\s\S]*to service_role/i);
  assert.match(MIGRATION, /create policy "no client access to ai draft authorizations"/i);
  assert.doesNotMatch(MIGRATION, /grant\s+.*\s+to\s+anon/i);
});

test("execution is one row-locked transaction that inserts, consumes and links", () => {
  const executeFunction = MIGRATION.slice(
    MIGRATION.toLowerCase().indexOf(
      "create or replace function public.execute_ai_payment_draft_authorization",
    ),
  );

  assert.match(executeFunction, /for update/i);
  assert.match(executeFunction, /insert into public\.payment_requests/i);
  assert.match(executeFunction, /status = 'consumed'/i);
  assert.match(executeFunction, /payment_request_id = p_request_id/i);
  assert.match(executeFunction, /'already_consumed'/i);
  assert.match(executeFunction, /v_auth\.draft_fingerprint <> p_draft_fingerprint/i);
  assert.match(executeFunction, /revoke all on function public\.execute_ai_payment_draft_authorization[\s\S]*from anon/i);
  assert.match(executeFunction, /grant execute on function public\.execute_ai_payment_draft_authorization[\s\S]*to service_role/i);
});

test("re-authorization revokes and registers in one function", () => {
  const lower = MIGRATION.toLowerCase();
  const reauthFunction = MIGRATION.slice(
    lower.indexOf(
      "create or replace function public.reauthorize_ai_payment_draft_authorization",
    ),
    lower.indexOf(
      "create or replace function public.execute_ai_payment_draft_authorization",
    ),
  );

  assert.match(reauthFunction, /for update/i);
  assert.match(reauthFunction, /set status = 'revoked'/i);
  assert.match(reauthFunction, /insert into public\.ai_payment_draft_authorizations/i);
  assert.match(reauthFunction, /'reauthorized'/i);
});

test("fingerprints are nonce-, wallet- and draft-bound", () => {
  const base = draftAuthorizationFingerprint(DRAFT, SESSION_WALLET, NONCE);

  assert.equal(base.length, 64);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.notEqual(
    base,
    draftAuthorizationFingerprint(DRAFT, MERCHANT_B, NONCE),
  );
  assert.notEqual(
    base,
    draftAuthorizationFingerprint(DRAFT, SESSION_WALLET, "b".repeat(32)),
  );
  assert.notEqual(
    base,
    draftAuthorizationFingerprint(
      { ...DRAFT, description: "different" },
      SESSION_WALLET,
      NONCE,
    ),
  );
});

test("generated nonces are 32 lowercase hex characters", () => {
  const nonce = generateDraftNonce();
  assert.match(nonce, /^[0-9a-f]{32}$/);
  assert.notEqual(nonce, generateDraftNonce());
});

// ---------------------------------------------------------------------------
// Registry ownership and token size
// ---------------------------------------------------------------------------

test("a registry-level wrong_merchant outcome is rejected with 403", async () => {
  const { handler } = executeHandler({
    createAuthorizedRequest: async () => ({
      ok: false,
      reason: "authorization",
      authorizationOutcome: "wrong_merchant",
      error: "wrong merchant",
    }),
  });

  const response = await handler(request({ draftToken: tokenFor().token }));
  const body = await response.json();

  assert.equal(response.status, 403);
  assert.equal(body.code, "wrong_merchant");
  assert.equal(body.request, undefined);
  assert.equal(body.checkoutUrl, undefined);
  assert.equal(body.alreadyCreated, undefined);
});

test("an oversized draft token is rejected at the endpoint before the registry", async () => {
  const { handler, state } = executeHandler();

  const oversized = `${DRAFT_TOKEN_PREFIX}.${"a".repeat(
    MAX_DRAFT_TOKEN_LENGTH,
  )}.signature`;
  assert.ok(oversized.length > MAX_DRAFT_TOKEN_LENGTH);

  const response = await handler(request({ draftToken: oversized }));
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.code, "invalid_authorization");
  assert.equal(state.executeCalls, 0);
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

/**
 * Handler-level concurrency: a promise-chain mutex plays the part of the RPC's
 * `SELECT ... FOR UPDATE`, so overlapping handler calls are serialised exactly
 * as the single SQL transaction would serialise them.
 *
 * This proves the handlers map interleaved outcomes without duplication. It does
 * NOT prove Postgres row locking or transaction isolation: no database runs in
 * this suite, and that guarantee remains covered only structurally by the
 * migration assertions above.
 */
function lockedRegistry() {
  let tail: Promise<unknown> = Promise.resolve();

  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  };
}

test("ten simultaneous approvals create exactly one payment request", async () => {
  const withLock = lockedRegistry();
  let stored: PaymentRequest | null = null;
  let inserts = 0;

  const { handler } = executeHandler({
    createAuthorizedRequest: () =>
      withLock(async () => {
        if (stored) {
          return {
            ok: true,
            request: stored,
            authorizationOutcome: "already_consumed",
          } as const;
        }

        inserts += 1;
        stored = createdRequest();

        return {
          ok: true,
          request: stored,
          authorizationOutcome: "created",
        } as const;
      }),
  });

  const draftToken = tokenFor().token;
  const responses = await Promise.all(
    Array.from({ length: 10 }, () => handler(request({ draftToken }))),
  );
  const bodies = await Promise.all(responses.map((response) => response.json()));

  const statuses = responses.map((response) => response.status).sort();
  const created = bodies.filter((body) => body.status === "created");
  const replays = bodies.filter((body) => body.status === "already_created");

  assert.equal(statuses.filter((status) => status === 201).length, 1);
  assert.equal(statuses.filter((status) => status === 200).length, 9);
  assert.equal(inserts, 1);
  assert.equal(created.length, 1);
  assert.equal(replays.length, 9);
  assert.ok(replays.every((body) => body.alreadyCreated === true));
  assert.equal(new Set(bodies.map((body) => body.request.id)).size, 1);
});
