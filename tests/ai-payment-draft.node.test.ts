import assert from "node:assert/strict";
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
  DRAFT_TOKEN_TTL_SECONDS,
} from "../src/lib/ai/draft-token.ts";
import { createPaymentDraftPostHandler } from "../src/lib/ai/payment-draft-handler.ts";
import type { GeminiDraftResult } from "../src/lib/ai/gemini-payment-draft.ts";
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
