import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NextRequest, NextResponse } from "next/server";

import {
  detectUnsupportedCurrency,
  preparePaymentDraft,
  UNSUPPORTED_CURRENCY_MESSAGE,
} from "../src/lib/ai/payment-draft.ts";
import {
  createDraftToken,
  verifyDraftToken,
  DRAFT_TOKEN_PREFIX,
  DRAFT_TOKEN_TTL_SECONDS,
} from "../src/lib/ai/draft-token.ts";
import {
  DRAFT_BODY_TOO_LARGE_MESSAGE,
  MAX_DRAFT_PREPARE_BODY_BYTES,
} from "../src/lib/ai/draft-http.ts";
import { createPaymentDraftPostHandler } from "../src/lib/ai/payment-draft-handler.ts";
import {
  classifyDraftFailure,
  DRAFT_REQUEST_TIMEOUT_MS,
  DRAFT_SDK_REQUEST_OPTIONS,
  DRAFT_SDK_TIMEOUT_MS,
  type GeminiDraftFailureCode,
  type GeminiDraftResult,
} from "../src/lib/ai/gemini-payment-draft.ts";
import type { RateLimitOutcome } from "../src/lib/auth/rate-limit.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const ATTACKER_WALLET = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const SECRET = "test-draft-token-secret-0123456789abcdef";
const NOW = new Date("2026-11-22T10:00:00.000Z");

const VALID_ARGS = {
  amount: "0.5",
  description: "website development",
};

function request(
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/ai/payment-drafts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

type HandlerState = {
  proposeCalls: number;
  rateLimitCalls: number;
  resolveCalls: number;
  registerCalls: number;
};

function createHandler(overrides: {
  resolveMerchant?: () => Promise<string | NextResponse>;
  checkRateLimit?: () => Promise<RateLimitOutcome>;
  proposeDraft?: () => Promise<GeminiDraftResult>;
  registerAuthorization?: () => Promise<{ ok: true } | { ok: false; code: "unavailable" | "conflict"; message: string }>;
  draftSecret?: () => string | null;
  now?: () => Date;
} = {}) {
  const state: HandlerState = {
    proposeCalls: 0,
    rateLimitCalls: 0,
    resolveCalls: 0,
    registerCalls: 0,
  };

  const handler = createPaymentDraftPostHandler({
    resolveMerchant: async () => {
      state.resolveCalls += 1;
      return overrides.resolveMerchant
        ? overrides.resolveMerchant()
        : SESSION_WALLET;
    },
    checkRateLimit: async () => {
      state.rateLimitCalls += 1;
      return overrides.checkRateLimit
        ? overrides.checkRateLimit()
        : { ok: true };
    },
    checkCapability: async () => ({ ok: true }),
    proposeDraft: async () => {
      state.proposeCalls += 1;
      return overrides.proposeDraft
        ? overrides.proposeDraft()
        : {
            ok: true,
            proposal: { kind: "tool_call", arguments: VALID_ARGS },
          };
    },
    createToken: (draft, wallet, options) =>
      createDraftToken(draft, wallet, options),
    registerAuthorization: async () => {
      state.registerCalls += 1;
      return overrides.registerAuthorization
        ? overrides.registerAuthorization()
        : { ok: true };
    },
    draftSecret: overrides.draftSecret ?? (() => SECRET),
    now: overrides.now ?? (() => NOW),
  });

  return { handler, state };
}

const VALID_MESSAGE =
  "Create a payment request for 0.5 SOL for website development.";

// ---------------------------------------------------------------------------
// 1-6: Draft validation and currency handling
// ---------------------------------------------------------------------------

test("valid SOL arguments produce a validated draft only", () => {
  const result = preparePaymentDraft(VALID_ARGS);

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;

  assert.equal(result.draft.amountLamports, "500000000");
  assert.equal(result.draft.amountSol, "0.5");
  assert.equal(result.draft.description, "website development");
  assert.equal(result.draft.customerName, null);
  assert.equal(result.draft.customerEmail, null);
});

test("a missing amount asks for the amount", () => {
  const result = preparePaymentDraft({ description: "website development" });

  assert.equal(result.status, "clarification");
  if (result.status !== "clarification") return;

  assert.deepEqual(result.missing, ["amount"]);
  assert.match(result.message, /amount in SOL/i);
});

test("a missing description asks for the description", () => {
  const result = preparePaymentDraft({ amount: "0.5" });

  assert.equal(result.status, "clarification");
  if (result.status !== "clarification") return;

  assert.deepEqual(result.missing, ["description"]);
  assert.match(result.message, /what is this payment request for/i);
});

test("an invalid decimal amount is rejected with a structured error", () => {
  const result = preparePaymentDraft({
    amount: "0.5.5",
    description: "website development",
  });

  assert.equal(result.status, "invalid");
  if (result.status !== "invalid") return;

  assert.equal(result.errors[0].field, "amount");
  assert.equal(result.errors[0].code, "invalid_amount");
});

test("an amount above the 10 SOL limit is rejected", () => {
  const result = preparePaymentDraft({
    amount: "12",
    description: "website development",
  });

  assert.equal(result.status, "invalid");
  if (result.status !== "invalid") return;

  assert.equal(result.errors[0].field, "amount");
  assert.equal(result.errors[0].code, "amount_above_limit");
});

test("GHS is rejected as unsupported and never converted", () => {
  assert.equal(
    detectUnsupportedCurrency("Create a payment request for GHS 500 for website development."),
    "GHS",
  );

  const direct = preparePaymentDraft({
    amount: "GHS 500",
    description: "website development",
  });

  assert.equal(direct.status, "unsupported_currency");
  if (direct.status !== "unsupported_currency") return;

  assert.equal(direct.currency, "GHS");
  assert.equal(direct.message, UNSUPPORTED_CURRENCY_MESSAGE);
  assert.match(direct.message, /support SOL only/i);
});

test("a currency word in a description does not block a valid SOL draft", () => {
  const result = preparePaymentDraft({
    amount: "0.5",
    description: "GHS compliance training materials",
  });

  assert.equal(result.status, "ready");
});

// ---------------------------------------------------------------------------
// 7-8: Session ownership and authentication
// ---------------------------------------------------------------------------

test("a forged wallet in the body is ignored and the draft is bound to the session wallet", async () => {
  const { handler } = createHandler();

  const response = await handler(
    request({
      message: VALID_MESSAGE,
      merchantAddress: ATTACKER_WALLET,
      wallet: ATTACKER_WALLET,
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.status, "awaiting_confirmation");
  assert.equal(body.draft.amountLamports, "500000000");

  const verified = verifyDraftToken(body.draftToken, {
    secret: SECRET,
    now: NOW,
    wallet: SESSION_WALLET,
  });
  assert.equal(verified.ok, true);

  const forged = verifyDraftToken(body.draftToken, {
    secret: SECRET,
    now: NOW,
    wallet: ATTACKER_WALLET,
  });
  assert.equal(forged.ok, false);
  if (!forged.ok) assert.equal(forged.reason, "wrong_merchant");
});

test("a wallet supplied in Gemini tool arguments is ignored", async () => {
  const { handler } = createHandler({
    proposeDraft: async () => ({
      ok: true,
      proposal: {
        kind: "tool_call",
        arguments: {
          ...VALID_ARGS,
          merchantAddress: ATTACKER_WALLET,
          wallet: ATTACKER_WALLET,
        },
      },
    }),
  });

  const response = await handler(request({ message: VALID_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "awaiting_confirmation");

  const verified = verifyDraftToken(body.draftToken, {
    secret: SECRET,
    now: NOW,
    wallet: SESSION_WALLET,
  });
  assert.equal(verified.ok, true);
  if (!verified.ok) return;
  assert.equal(verified.payload.wallet, SESSION_WALLET);
  assert.notEqual(verified.payload.wallet, ATTACKER_WALLET);
});

test("an explicit SOL amount is not blocked by a currency word in the description", async () => {
  const { handler, state } = createHandler();

  const response = await handler(
    request({
      message:
        "Create a payment request for 0.5 SOL for the $5 discount campaign.",
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "awaiting_confirmation");
  assert.equal(state.proposeCalls, 1);
});

test("a missing merchant session is rejected before Gemini or the body is used", async () => {
  const { handler, state } = createHandler({
    resolveMerchant: async () =>
      NextResponse.json({ error: "Authentication required." }, { status: 401 }),
  });

  const response = await handler(
    request({ message: VALID_MESSAGE, merchantAddress: ATTACKER_WALLET }),
  );

  assert.equal(response.status, 401);
  assert.equal(state.resolveCalls, 1);
  assert.equal(state.rateLimitCalls, 0);
  assert.equal(state.proposeCalls, 0);
});

// ---------------------------------------------------------------------------
// 9-11: Draft token integrity
// ---------------------------------------------------------------------------

test("a tampered draft token is rejected", () => {
  const signed = createDraftToken(
    {
      amountLamports: "500000000",
      amountSol: "0.5",
      description: "website development",
      customerName: null,
      customerEmail: null,
    },
    SESSION_WALLET,
    { secret: SECRET, now: NOW },
  );

  const [prefix, payload, signature] = signed.token.split(".");
  const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
  const tamperedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;

  const badSignature = verifyDraftToken(
    `${prefix}.${payload}.${tamperedSignature}`,
    { secret: SECRET, now: NOW },
  );
  assert.equal(badSignature.ok, false);
  if (!badSignature.ok) assert.equal(badSignature.reason, "invalid_signature");

  const badPayload = verifyDraftToken(
    `${prefix}.${tamperedPayload}.${signature}`,
    { secret: SECRET, now: NOW },
  );
  assert.equal(badPayload.ok, false);
  if (!badPayload.ok) assert.equal(badPayload.reason, "invalid_signature");
});

test("an expired draft token is rejected", () => {
  const signed = createDraftToken(
    {
      amountLamports: "500000000",
      amountSol: "0.5",
      description: "website development",
      customerName: null,
      customerEmail: null,
    },
    SESSION_WALLET,
    { secret: SECRET, now: NOW },
  );

  const stillValid = verifyDraftToken(signed.token, {
    secret: SECRET,
    now: new Date(NOW.getTime() + (DRAFT_TOKEN_TTL_SECONDS - 1) * 1000),
  });
  assert.equal(stillValid.ok, true);

  const expired = verifyDraftToken(signed.token, {
    secret: SECRET,
    now: new Date(NOW.getTime() + (DRAFT_TOKEN_TTL_SECONDS + 1) * 1000),
  });
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.reason, "expired");
});

test("a token signed for one merchant cannot be used by another", () => {
  const signed = createDraftToken(
    {
      amountLamports: "500000000",
      amountSol: "0.5",
      description: "website development",
      customerName: null,
      customerEmail: null,
    },
    SESSION_WALLET,
    { secret: SECRET, now: NOW },
  );

  const wrongMerchant = verifyDraftToken(signed.token, {
    secret: SECRET,
    now: NOW,
    wallet: ATTACKER_WALLET,
  });

  assert.equal(wrongMerchant.ok, false);
  if (!wrongMerchant.ok) assert.equal(wrongMerchant.reason, "wrong_merchant");
});

// ---------------------------------------------------------------------------
// 12: No persistence during preparation
// ---------------------------------------------------------------------------

const HANDLER_SOURCE = readFileSync(
  new URL("../src/lib/ai/payment-draft-handler.ts", import.meta.url),
  "utf8",
);
const DRAFT_SOURCE = readFileSync(
  new URL("../src/lib/ai/payment-draft.ts", import.meta.url),
  "utf8",
);
const GEMINI_SOURCE = readFileSync(
  new URL("../src/lib/ai/gemini-payment-draft.ts", import.meta.url),
  "utf8",
);
const ROUTE_SOURCE = readFileSync(
  new URL("../src/app/api/ai/payment-drafts/route.ts", import.meta.url),
  "utf8",
);

test("preparation imports no repository, server action or creation function", () => {
  const sources = [HANDLER_SOURCE, DRAFT_SOURCE, GEMINI_SOURCE, ROUTE_SOURCE];

  for (const source of sources) {
    assert.doesNotMatch(
      source,
      /from\s+["']@\/lib\/payment-requests\/(repository|actions|create-for-session)["']/,
      "AI draft preparation must not import a payment-request write path",
    );
    assert.doesNotMatch(
      source,
      /\bcreatePaymentRequest(?:ForSession|Action)?\s*\(/,
      "AI draft preparation must not call a creation function",
    );
    assert.doesNotMatch(
      source,
      /\.insert\s*\(/,
      "AI draft preparation must not insert database rows",
    );
    assert.doesNotMatch(
      source,
      /createSupabaseClient/,
      "AI draft preparation must not open a Supabase client",
    );
  }
});

test("a successful preparation responds with a draft and never records a payment request", async () => {
  const { handler, state } = createHandler();

  const response = await handler(request({ message: VALID_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "awaiting_confirmation");
  assert.equal(state.proposeCalls, 1);
  assert.equal(state.rateLimitCalls, 1);

  // The only persistence-shaped value in the response is the signed token.
  assert.deepEqual(Object.keys(body).sort(), [
    "draft",
    "draftToken",
    "expiresAt",
    "status",
  ]);
});

// ---------------------------------------------------------------------------
// Route hardening
// ---------------------------------------------------------------------------

test("non-JSON content types are rejected", async () => {
  const { handler, state } = createHandler();

  const response = await handler(
    request(
      { message: VALID_MESSAGE },
      { "content-type": "text/plain" },
    ),
  );

  assert.equal(response.status, 415);
  assert.equal(state.proposeCalls, 0);
});

test("cross-origin requests are rejected", async () => {
  const { handler, state } = createHandler();

  const response = await handler(
    request({ message: VALID_MESSAGE }, { origin: "https://evil.example" }),
  );

  assert.equal(response.status, 403);
  assert.equal(state.proposeCalls, 0);
});

test("rate-limited merchants get 429 without calling Gemini", async () => {
  const { handler, state } = createHandler({
    checkRateLimit: async () => ({
      ok: false,
      kind: "limited",
      retryAfterSeconds: 42,
    }),
  });

  const response = await handler(request({ message: VALID_MESSAGE }));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "42");
  assert.equal(state.proposeCalls, 0);
});

test("an unsupported currency is answered without calling Gemini", async () => {
  const { handler, state } = createHandler();

  const response = await handler(
    request({
      message: "Create a payment request for GHS 500 for website development.",
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "unsupported_currency");
  assert.equal(body.currency, "GHS");
  assert.match(body.message, /support SOL only/i);
  assert.equal(state.proposeCalls, 0);
});

test("invalid model arguments return structured validation errors", async () => {
  const { handler } = createHandler({
    proposeDraft: async () => ({
      ok: true,
      proposal: {
        kind: "tool_call",
        arguments: { amount: "0", description: "website development" },
      },
    }),
  });

  const response = await handler(request({ message: VALID_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.status, "invalid");
  assert.equal(body.errors[0].field, "amount");
  assert.equal(body.errors[0].code, "amount_not_positive");
});

test("Gemini clarification replies are passed through as clarifications", async () => {
  const { handler } = createHandler({
    proposeDraft: async () => ({
      ok: true,
      proposal: {
        kind: "message",
        text: "What amount in SOL should this payment request be for?",
      },
    }),
  });

  const response = await handler(
    request({ message: "Create a payment request for website development." }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "clarification");
  assert.deepEqual(body.missing, []);
  assert.equal(body.draftToken, undefined);
});

test("a missing signing secret fails closed", async () => {
  const { handler, state } = createHandler({ draftSecret: () => null });

  const response = await handler(request({ message: VALID_MESSAGE }));

  assert.equal(response.status, 503);
  assert.equal(state.proposeCalls, 0);
});

test("a token is never returned when authorization registration fails", async () => {
  const { handler, state } = createHandler({
    registerAuthorization: async () => ({
      ok: false,
      code: "unavailable",
      message: "registry down",
    }),
  });

  const response = await handler(request({ message: VALID_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.status, "error");
  assert.equal(body.code, "authorization_unavailable");
  assert.equal(body.draftToken, undefined);
  assert.equal(state.registerCalls, 1);
});

test("successful preparation registers exactly one active authorization", async () => {
  const { handler, state } = createHandler();

  const response = await handler(request({ message: VALID_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "awaiting_confirmation");
  assert.equal(state.registerCalls, 1);
});

test("a draft token expires about ten minutes after it is issued", async () => {
  const { handler } = createHandler();

  const response = await handler(request({ message: VALID_MESSAGE }));
  const body = await response.json();

  const expiresAt = new Date(body.expiresAt).getTime();
  assert.equal(expiresAt - NOW.getTime(), DRAFT_TOKEN_TTL_SECONDS * 1000);
  assert.equal(body.draftToken.split(".").length, 3);
  assert.equal(body.draftToken.startsWith("ppd1."), true);
});

// ---------------------------------------------------------------------------
// 12: Gemini upstream failure classification
// ---------------------------------------------------------------------------

test("a Gemini 503 is classified as upstream_unavailable", () => {
  const failure = classifyDraftFailure({
    status: 503,
    message:
      "503 gemini-3.1-flash-lite is currently experiencing high demand, spikes in demand are usually temporary.",
  });

  assert.equal(failure.code, "upstream_unavailable");
  assert.equal(failure.upstreamStatus, 503);
});

test("Gemini 500, 502 and 504 are classified consistently", () => {
  for (const status of [500, 502, 503, 504]) {
    const failure = classifyDraftFailure({ status, message: "upstream failure" });
    assert.equal(failure.code, "upstream_unavailable", `status ${status}`);
    assert.equal(failure.upstreamStatus, status);
  }
});

test("a 5xx status wins over the model-not-found message heuristic", () => {
  const failure = classifyDraftFailure({
    status: 503,
    message: "The model is currently overloaded.",
  });

  assert.equal(failure.code, "upstream_unavailable");
});

test("the application timeout stays upstream_timeout", () => {
  const failure = classifyDraftFailure(
    Object.assign(new Error("Gemini did not respond in time."), {
      code: "ai_timeout",
    }),
  );

  assert.equal(failure.code, "upstream_timeout");
  assert.equal(failure.upstreamStatus, undefined);
});

test("the SDK per-attempt request timeout stays upstream_timeout", () => {
  for (const name of ["APIConnectionTimeoutError", "RequestTimeoutError"]) {
    const failure = classifyDraftFailure(
      Object.assign(new Error("The request timed out."), { name }),
    );

    assert.equal(failure.code, "upstream_timeout", `error name ${name}`);
    assert.equal(failure.upstreamStatus, undefined);
  }
});

test("existing authentication, quota and model classifications are preserved", () => {
  assert.equal(classifyDraftFailure({ status: 401, message: "no" }).code, "invalid_api_key");
  assert.equal(classifyDraftFailure({ status: 403, message: "no" }).code, "invalid_api_key");
  assert.equal(classifyDraftFailure({ status: 429, message: "slow down" }).code, "quota_exceeded");
  assert.equal(classifyDraftFailure({ status: 404, message: "gone" }).code, "model_unavailable");
  assert.equal(classifyDraftFailure({ message: "socket hang up" }).code, "upstream_error");
});

// ---------------------------------------------------------------------------
// 13: Bounded SDK timeout and retry budget
// ---------------------------------------------------------------------------

test("the SDK call is bounded by an explicit timeout and retry budget", () => {
  assert.equal(DRAFT_SDK_REQUEST_OPTIONS.timeout_ms, 12_000);
  assert.equal(DRAFT_SDK_TIMEOUT_MS, 12_000);
  assert.ok(
    DRAFT_SDK_TIMEOUT_MS < DRAFT_REQUEST_TIMEOUT_MS,
    "the per-attempt SDK timeout must sit inside the application boundary",
  );

  const retries = DRAFT_SDK_REQUEST_OPTIONS.retries;
  assert.ok(retries);
  assert.equal(retries.strategy, "attempt-count-backoff");
  if (retries.strategy !== "attempt-count-backoff") return;

  assert.equal(retries.maxRetries, 1);
  assert.equal(retries.backoff?.initialInterval, 250);
  assert.equal(retries.backoff?.maxInterval, 750);
  assert.equal(retries.backoff?.exponent, 2);
});

// ---------------------------------------------------------------------------
// 14: Handler status mapping for upstream failures
// ---------------------------------------------------------------------------

test("the handler returns HTTP 503 for upstream_unavailable", async () => {
  const { handler } = createHandler({
    proposeDraft: async () => ({
      ok: false,
      code: "upstream_unavailable",
      message: "503 high demand",
      upstreamStatus: 503,
    }),
  });

  const response = await handler(request({ message: VALID_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.status, "error");
  assert.equal(body.code, "upstream_unavailable");
  assert.equal(
    body.error,
    "The AI assistant is busy right now. Please try again shortly.",
  );
  assert.equal(body.draftToken, undefined);
  assert.doesNotMatch(JSON.stringify(body), /high demand/);
});

test("the handler returns HTTP 504 for upstream_timeout", async () => {
  const { handler } = createHandler({
    proposeDraft: async () => ({
      ok: false,
      code: "upstream_timeout",
      message: "Gemini did not respond in time.",
    }),
  });

  const response = await handler(request({ message: VALID_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 504);
  assert.equal(body.code, "upstream_timeout");
  assert.match(body.error, /too long/i);
  assert.equal(body.draftToken, undefined);
});

test("every Gemini failure code maps to its documented HTTP status", async () => {
  const expected: Array<[GeminiDraftFailureCode, number]> = [
    ["missing_api_key", 503],
    ["invalid_api_key", 502],
    ["quota_exceeded", 503],
    ["model_unavailable", 502],
    ["invalid_model_response", 502],
    ["upstream_error", 502],
    ["upstream_unavailable", 503],
    ["upstream_timeout", 504],
  ];

  for (const [code, status] of expected) {
    const { handler } = createHandler({
      proposeDraft: async () => ({ ok: false, code, message: "upstream detail" }),
    });

    const response = await handler(request({ message: VALID_MESSAGE }));
    const body = await response.json();

    assert.equal(response.status, status, `code ${code} must map to ${status}`);
    assert.equal(body.code, code);
    // Regression: a timeout must never be reported with a gateway-error status,
    // and an upstream 5xx must never be reported as a timeout.
    if (code === "upstream_timeout") assert.notEqual(response.status, 502);
    if (code === "upstream_unavailable") assert.notEqual(response.status, 504);
  }
});

test("a Gemini failure is logged once with a safe prefix and no message text", async () => {
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };

  try {
    const { handler } = createHandler({
      proposeDraft: async () => ({
        ok: false,
        code: "upstream_unavailable",
        message: "merchant supplied draft text",
        upstreamStatus: 503,
      }),
    });

    const response = await handler(request({ message: VALID_MESSAGE }));
    assert.equal(response.status, 503);
  } finally {
    console.error = originalError;
  }

  const failures = logged.filter(
    (args) =>
      typeof args[0] === "string" &&
      args[0].includes("[ai/payment-drafts] gemini failure"),
  );

  assert.equal(failures.length, 1);
  const serialized = JSON.stringify(failures[0]);
  assert.match(serialized, /upstream_unavailable/);
  assert.match(serialized, /503/);
  assert.doesNotMatch(serialized, /merchant supplied draft text/);
});

test("a rate-limited request never reaches Gemini", async () => {
  const { handler, state } = createHandler({
    checkRateLimit: async () => ({
      ok: false,
      kind: "limited",
      retryAfterSeconds: 30,
    }),
  });

  const response = await handler(request({ message: VALID_MESSAGE }));

  assert.equal(response.status, 429);
  assert.equal(state.proposeCalls, 0);
});

// ---------------------------------------------------------------------------
// 15: Preparation request-body bound
// ---------------------------------------------------------------------------

test("an oversized preparation body is rejected with 413 before Gemini", async () => {
  const { handler, state } = createHandler();

  const response = await handler(
    request({
      message: VALID_MESSAGE,
      padding: "x".repeat(MAX_DRAFT_PREPARE_BODY_BYTES + 1024),
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 413);
  assert.equal(body.error, DRAFT_BODY_TOO_LARGE_MESSAGE);
  assert.equal(state.proposeCalls, 0);
  assert.equal(state.registerCalls, 0);
});

// ---------------------------------------------------------------------------
// 16: Draft token verification edges
// ---------------------------------------------------------------------------

const TOKEN_DRAFT = {
  amountLamports: "500000000",
  amountSol: "0.5",
  description: "website development",
  customerName: null,
  customerEmail: null,
};

test("a token signed with a different secret is rejected", () => {
  const signed = createDraftToken(TOKEN_DRAFT, SESSION_WALLET, {
    secret: SECRET,
    now: NOW,
  });

  const verified = verifyDraftToken(signed.token, {
    secret: "a-completely-different-secret-0123456789",
    now: NOW,
  });

  assert.equal(verified.ok, false);
  if (!verified.ok) assert.equal(verified.reason, "invalid_signature");
});

test("a token with the wrong version prefix is treated as malformed", () => {
  const signed = createDraftToken(TOKEN_DRAFT, SESSION_WALLET, {
    secret: SECRET,
    now: NOW,
  });
  const [prefix, payload, signature] = signed.token.split(".");

  assert.equal(prefix, DRAFT_TOKEN_PREFIX);

  const verified = verifyDraftToken(`ppd2.${payload}.${signature}`, {
    secret: SECRET,
    now: NOW,
  });

  assert.equal(verified.ok, false);
  if (!verified.ok) assert.equal(verified.reason, "malformed");
});

test("a correctly signed token with a structurally invalid payload is rejected", () => {
  const iat = Math.floor(NOW.getTime() / 1000);
  const base = {
    v: 1,
    wallet: SESSION_WALLET,
    nonce: "a".repeat(32),
    iat,
    exp: iat + DRAFT_TOKEN_TTL_SECONDS,
    draft: TOKEN_DRAFT,
  };

  const variants: Array<Record<string, unknown>> = [
    { ...base, nonce: "not-hex" },
    { ...base, exp: iat },
    { ...base, v: 2 },
    { ...base, draft: { ...TOKEN_DRAFT, amountLamports: "-1" } },
    { ...base, wallet: "   " },
  ];

  for (const payload of variants) {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    const signature = createHmac("sha256", SECRET)
      .update(`${DRAFT_TOKEN_PREFIX}.${encoded}`, "utf8")
      .digest("base64url");

    const verified = verifyDraftToken(
      `${DRAFT_TOKEN_PREFIX}.${encoded}.${signature}`,
      { secret: SECRET, now: NOW },
    );

    assert.equal(
      verified.ok,
      false,
      `payload should be rejected: ${JSON.stringify(payload)}`,
    );
    if (!verified.ok) assert.equal(verified.reason, "invalid_payload");
  }
});
