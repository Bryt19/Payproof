import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NextRequest, NextResponse } from "next/server";
import {
  AI_INTENT_NOT_CONFIGURED_MESSAGE,
  createPaymentIntentPostHandler,
  MAX_INTENT_PREPARE_BODY_BYTES,
  type PaymentIntentHandlerDependencies,
} from "../src/lib/ai/payment-intent-handler.ts";
import {
  preparePaymentIntent,
  isUserSuppliedBase58Token,
} from "../src/lib/ai/payment-intent.ts";
import {
  createIntentToken,
  verifyIntentToken,
} from "../src/lib/ai/intent-token.ts";
import {
  normalizePaymentIntentArguments,
  parseToolArguments,
  PREPARE_SOL_PAYMENT_TOOL,
} from "../src/lib/ai/gemini-payment-intent.ts";
import {
  parseIntentReply,
  buildOpenRouterIntentRequestBody,
  OPENROUTER_PAYMENT_INTENT_TITLE,
} from "../src/lib/ai/openrouter-payment-intent.ts";
import { proposePaymentIntent } from "../src/lib/ai/payment-intent-provider.ts";
import type { AgentPaymentIntent } from "../src/lib/ai/intent-registry.ts";
import type { RateLimitOutcome } from "../src/lib/auth/rate-limit.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_WALLET = "So11111111111111111111111111111111111111112";
const ATTACKER_WALLET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RECIPIENT = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const INVENTED_RECIPIENT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const INVENTED_REFERENCE = "Fk9Q1uZ8m2Fk9Q1uZ8m2Fk9Q1uZ8m2Fk9Q1uZ8m2";
const REFERENCE = "Fk9Q1uZ8m2Fk9Q1uZ8m2Fk9Q1uZ8m2Fk9Q1uZ8m2";

const TOKEN_SECRET = "intent-test-secret-0123456789-abcdefghijklmnop";
const NOW = new Date("2026-11-25T10:00:00.000Z");

const VALID_MESSAGE = `Send 1.5 SOL to ${RECIPIENT} for the logo design project.`;
const NO_RECIPIENT_MESSAGE = "Send 1.5 SOL for the logo design project.";

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("http://localhost/api/ai/payment-intents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function toolCall(arguments_: Record<string, unknown>) {
  return {
    ok: true as const,
    proposal: { kind: "tool_call" as const, arguments: arguments_ },
  };
}

function agentIntent(
  intent: Parameters<typeof createIntentToken>[0],
  merchantWallet: string,
  nonce: string,
  fingerprint: string,
  expiresAt: string,
): AgentPaymentIntent {
  return {
    id: "AI-TEST0001",
    merchantWallet,
    status: "draft",
    recipientAddress: intent.recipientAddress ?? "",
    amountLamports: intent.amountLamports,
    purpose: intent.purpose,
    reference: REFERENCE,
    sourceKind: intent.sourceKind,
    sourcePaymentRequestReference: intent.sourcePaymentRequestReference,
    nonce,
    intentFingerprint: fingerprint,
    transactionSignature: null,
    transactionBase64: null,
    payerAddress: null,
    verifiedAt: null,
    expiresAt,
    createdAt: NOW.toISOString(),
    approvedAt: null,
    approvalExpiresAt: null,
    submittedAt: null,
    failureReason: null,
  };
}

type HandlerState = {
  proposeCalls: number;
  rateLimitCalls: number;
  authorizeCalls: number;
  walletsSeen: string[];
};

/**
 * Builds the handler with every external dependency replaced. The default
 * authorizer signs a real token with the test secret, so token binding can be
 * verified end to end without a database.
 */
function createHandler(overrides: Partial<PaymentIntentHandlerDependencies> = {}) {
  const state: HandlerState = {
    proposeCalls: 0,
    rateLimitCalls: 0,
    authorizeCalls: 0,
    walletsSeen: [],
  };

  const handler = createPaymentIntentPostHandler({
    resolveMerchant: async () => SESSION_WALLET,
    checkRateLimit: async () => {
      state.rateLimitCalls += 1;
      return { ok: true };
    },
    checkCapability: async () => ({ ok: true }),
    proposeIntent: async () => {
      state.proposeCalls += 1;
      return toolCall({
        amount: "1.5",
        recipientAddress: RECIPIENT,
        purpose: "Logo design project",
        currency: "SOL",
      });
    },
    authorizeIntent: async ({ intent, merchantWallet, now }) => {
      state.authorizeCalls += 1;
      state.walletsSeen.push(merchantWallet);

      const nonce = "ab".repeat(16);
      const signed = createIntentToken(intent, merchantWallet, {
        secret: TOKEN_SECRET,
        now,
        nonce,
      });

      return {
        ok: true,
        token: signed.token,
        expiresAt: signed.expiresAt,
        intent: agentIntent(
          intent,
          merchantWallet,
          nonce,
          signed.fingerprint,
          signed.expiresAt,
        ),
      };
    },
    intentSecret: () => TOKEN_SECRET,
    now: () => NOW,
    ...overrides,
  });

  return { handler, state };
}

// ---------------------------------------------------------------------------
// 1. Authentication
// ---------------------------------------------------------------------------

test("unauthenticated requests are rejected before any AI call", async () => {
  const { handler, state } = createHandler({
    resolveMerchant: async () =>
      NextResponse.json({ error: "Authentication required." }, { status: 401 }),
  });

  const response = await handler(makeRequest({ message: VALID_MESSAGE }));

  assert.equal(response.status, 401);
  assert.equal(state.proposeCalls, 0);
  assert.equal(state.authorizeCalls, 0);
  assert.equal(state.rateLimitCalls, 0);
});

test("a session resolution failure is a 503, not an anonymous success", async () => {
  const { handler, state } = createHandler({
    resolveMerchant: async () => {
      throw new Error("auth store down");
    },
  });

  const response = await handler(makeRequest({ message: VALID_MESSAGE }));

  assert.equal(response.status, 503);
  assert.equal(state.proposeCalls, 0);
});

// ---------------------------------------------------------------------------
// 2. Session ownership
// ---------------------------------------------------------------------------

test("the merchant wallet comes from the session, never the body", async () => {
  const { handler, state } = createHandler();

  const response = await handler(
    makeRequest({
      message: VALID_MESSAGE,
      merchantWallet: ATTACKER_WALLET,
      wallet: ATTACKER_WALLET,
      merchant_wallet: ATTACKER_WALLET,
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(state.walletsSeen, [SESSION_WALLET]);

  const body = await response.json();

  const sessionCheck = verifyIntentToken(body.intentToken, {
    secret: TOKEN_SECRET,
    wallet: SESSION_WALLET,
    now: NOW,
  });
  assert.equal(sessionCheck.ok, true);

  const attackerCheck = verifyIntentToken(body.intentToken, {
    secret: TOKEN_SECRET,
    wallet: ATTACKER_WALLET,
    now: NOW,
  });
  assert.equal(attackerCheck.ok, false);
  if (!attackerCheck.ok) assert.equal(attackerCheck.reason, "wrong_merchant");
});

// ---------------------------------------------------------------------------
// 3. Transport guards
// ---------------------------------------------------------------------------

test("a non-JSON content type is rejected", async () => {
  const { handler, state } = createHandler();

  const response = await handler(
    makeRequest({ message: VALID_MESSAGE }, { "content-type": "text/plain" }),
  );

  assert.equal(response.status, 415);
  assert.equal(state.proposeCalls, 0);
});

test("cross-site and foreign-origin requests are rejected", async () => {
  const { handler } = createHandler();

  const crossSite = await handler(
    makeRequest({ message: VALID_MESSAGE }, { "sec-fetch-site": "cross-site" }),
  );
  assert.equal(crossSite.status, 403);

  const foreignOrigin = await handler(
    makeRequest({ message: VALID_MESSAGE }, { origin: "https://evil.example" }),
  );
  assert.equal(foreignOrigin.status, 403);
});

test("a body above the byte limit is rejected before the AI call", async () => {
  const { handler, state } = createHandler();

  const response = await handler(
    makeRequest({ message: "a".repeat(MAX_INTENT_PREPARE_BODY_BYTES + 1) }),
  );

  assert.equal(response.status, 413);
  assert.equal(state.proposeCalls, 0);
});

test("a missing or blank message is rejected", async () => {
  const { handler, state } = createHandler();

  for (const message of [undefined, "", "   "]) {
    const response = await handler(makeRequest({ message }));
    assert.equal(response.status, 400);
  }

  assert.equal(state.proposeCalls, 0);
});

test("malformed conversation history is rejected", async () => {
  const { handler, state } = createHandler();

  for (const history of [
    "not-an-array",
    [{ role: "system", text: "hi" }],
    [{ role: "user", text: 5 }],
    new Array(21).fill({ role: "user", text: "hi" }),
  ]) {
    const response = await handler(makeRequest({ message: VALID_MESSAGE, history }));
    assert.equal(response.status, 400);
  }

  assert.equal(state.proposeCalls, 0);
});

// ---------------------------------------------------------------------------
// 4. Rate limiting
// ---------------------------------------------------------------------------

test("a limited rate-limit outcome returns 429 with Retry-After and no AI call", async () => {
  const { handler, state } = createHandler({
    checkRateLimit: async (): Promise<RateLimitOutcome> => ({
      ok: false,
      kind: "limited",
      retryAfterSeconds: 42,
    }),
  });

  const response = await handler(makeRequest({ message: VALID_MESSAGE }));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "42");
  assert.equal(state.proposeCalls, 0);
});

test("an unavailable rate-limit store fails closed", async () => {
  const { handler, state } = createHandler({
    checkRateLimit: async (): Promise<RateLimitOutcome> => ({
      ok: false,
      kind: "unavailable",
    }),
  });

  const response = await handler(makeRequest({ message: VALID_MESSAGE }));

  assert.equal(response.status, 503);
  assert.equal(state.proposeCalls, 0);
});

// ---------------------------------------------------------------------------
// 5. Successful extraction
// ---------------------------------------------------------------------------

test("a valid instruction returns a ready intent and a verifiable token", async () => {
  const { handler, state } = createHandler();

  const response = await handler(makeRequest({ message: VALID_MESSAGE }));

  assert.equal(response.status, 200);
  assert.equal(state.proposeCalls, 1);
  assert.equal(state.authorizeCalls, 1);

  const body = await response.json();

  assert.equal(body.status, "ready");
  assert.equal(body.intentId, "AI-TEST0001");
  assert.equal(body.amountLamports, "1500000000");
  assert.equal(body.amountSol, "1.5");
  assert.equal(body.recipientAddress, RECIPIENT);
  assert.equal(body.purpose, "Logo design project");
  assert.equal(body.currency, "SOL");
  assert.equal(body.sourceKind, "address");
  assert.equal(body.sourcePaymentRequestReference, null);
  assert.equal(typeof body.expiresAt, "string");
  assert.match(body.intentToken, /^ppi1\.[A-Za-z0-9_-]+\./);

  for (const forbidden of [
    "transaction",
    "serializedTransaction",
    "signedTransaction",
    "blockhash",
    "signature",
    "privateKey",
    "signingMaterial",
  ]) {
    assert.equal(forbidden in body, false, `${forbidden} must not be returned`);
  }

  const verified = verifyIntentToken(body.intentToken, {
    secret: TOKEN_SECRET,
    wallet: SESSION_WALLET,
    now: NOW,
  });
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.payload.intent.recipientAddress, RECIPIENT);
    assert.equal(verified.payload.intent.amountLamports, "1500000000");
  }
});

test("a plain model reply becomes a clarification with no token", async () => {
  const { handler, state } = createHandler({
    proposeIntent: async () => ({
      ok: true,
      proposal: {
        kind: "message",
        text: "Which Solana wallet should receive this payment?",
      },
    }),
  });

  const response = await handler(makeRequest({ message: "Pay the designer." }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "clarification");
  assert.equal("intentToken" in body, false);
  assert.equal(state.authorizeCalls, 0);
});

// ---------------------------------------------------------------------------
// 6. Missing detail handling
// ---------------------------------------------------------------------------

test("a missing recipient returns recipient_required and no token", async () => {
  const { handler, state } = createHandler({
    proposeIntent: async () =>
      toolCall({ amount: "1.5", purpose: "Logo design project" }),
  });

  const response = await handler(makeRequest({ message: NO_RECIPIENT_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "recipient_required");
  assert.equal(body.reason, "missing");
  assert.equal("intentToken" in body, false);
  assert.equal(state.authorizeCalls, 0);
});

test("a missing amount returns clarification and no token", async () => {
  const { handler, state } = createHandler({
    proposeIntent: async () =>
      toolCall({ recipientAddress: RECIPIENT, purpose: "Logo design project" }),
  });

  const response = await handler(makeRequest({ message: VALID_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "clarification");
  assert.deepEqual(body.missing, ["amount"]);
  assert.equal("intentToken" in body, false);
  assert.equal(state.authorizeCalls, 0);
});

test("an unsupported currency is refused without conversion or registration", async () => {
  const { handler, state } = createHandler({
    proposeIntent: async () =>
      toolCall({
        amount: "500",
        recipientAddress: RECIPIENT,
        purpose: "Logo design project",
        currency: "GHS",
      }),
  });

  const response = await handler(
    makeRequest({
      message: `Send 500 GHS to ${RECIPIENT} for the logo design project.`,
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "unsupported_currency");
  assert.equal(body.currency, "GHS");
  assert.equal("intentToken" in body, false);
  assert.equal(state.authorizeCalls, 0);
});

// ---------------------------------------------------------------------------
// 7. Recipient and reference provenance
// ---------------------------------------------------------------------------

test("an AI-invented recipient address is rejected as not user-supplied", async () => {
  const { handler, state } = createHandler({
    proposeIntent: async () =>
      toolCall({
        amount: "1.5",
        recipientAddress: INVENTED_RECIPIENT,
        purpose: "Logo design project",
      }),
  });

  const response = await handler(makeRequest({ message: NO_RECIPIENT_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "recipient_required");
  assert.equal(body.reason, "not_user_supplied");
  assert.equal("intentToken" in body, false);
  assert.equal(state.authorizeCalls, 0);
});

test("a recipient seen only in earlier conversation is not reusable", async () => {
  const { handler, state } = createHandler({
    proposeIntent: async () =>
      toolCall({
        amount: "1.5",
        recipientAddress: RECIPIENT,
        purpose: "Logo design project",
      }),
  });

  const response = await handler(
    makeRequest({
      message: NO_RECIPIENT_MESSAGE,
      history: [{ role: "user", text: `My wallet is ${RECIPIENT}` }],
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "recipient_required");
  assert.equal(body.reason, "not_user_supplied");
  assert.equal("intentToken" in body, false);
  assert.equal(state.authorizeCalls, 0);
});

test("an AI-invented payment reference is rejected as not user-supplied", async () => {
  const { handler, state } = createHandler({
    proposeIntent: async () =>
      toolCall({
        amount: "1.5",
        paymentReference: INVENTED_REFERENCE,
        purpose: "Logo design project",
      }),
  });

  const response = await handler(makeRequest({ message: NO_RECIPIENT_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "recipient_required");
  assert.equal(body.reason, "reference_not_user_supplied");
  assert.equal("intentToken" in body, false);
  assert.equal(state.authorizeCalls, 0);
});

test("an unresolved but user-supplied reference returns a clarification", async () => {
  const { handler, state } = createHandler({
    proposeIntent: async () =>
      toolCall({
        amount: "1.5",
        paymentReference: REFERENCE,
        purpose: "Logo design project",
      }),
  });

  const response = await handler(
    makeRequest({
      message: `Send 1.5 SOL for ${REFERENCE} (logo design project).`,
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "clarification");
  assert.deepEqual(body.missing, ["recipient"]);
  assert.equal(body.reason, "payment_request_lookup_required");
  assert.equal(body.sourcePaymentRequestReference, REFERENCE);
  assert.equal("intentToken" in body, false);
  assert.equal(state.authorizeCalls, 0);
});

test("Stage 1 provenance handles addresses and references with one rule", () => {
  assert.equal(isUserSuppliedBase58Token(VALID_MESSAGE, RECIPIENT), true);
  assert.equal(isUserSuppliedBase58Token(VALID_MESSAGE, INVENTED_RECIPIENT), false);

  const inventedReference = preparePaymentIntent(
    {
      amount: "1.5",
      purpose: "Logo design project",
      sourceKind: "payment_request",
      sourcePaymentRequestReference: INVENTED_REFERENCE,
    },
    { userMessage: NO_RECIPIENT_MESSAGE },
  );

  assert.equal(inventedReference.status, "recipient_required");
  if (inventedReference.status === "recipient_required") {
    assert.equal(inventedReference.reason, "reference_not_user_supplied");
  }

  const suppliedReference = preparePaymentIntent(
    {
      amount: "1.5",
      purpose: "Logo design project",
      sourceKind: "payment_request",
      sourcePaymentRequestReference: REFERENCE,
    },
    { userMessage: `Send 1.5 SOL for ${REFERENCE} (logo design project).` },
  );

  assert.equal(suppliedReference.status, "recipient_required");
  if (suppliedReference.status === "recipient_required") {
    assert.equal(suppliedReference.reason, "payment_request_lookup_required");
  }
});

// ---------------------------------------------------------------------------
// 8. Malformed model output
// ---------------------------------------------------------------------------

test("tool arguments with unexpected fields are rejected, not stripped", () => {
  const withWallet = normalizePaymentIntentArguments({
    amount: "1.5",
    purpose: "Logo design project",
    merchantWallet: ATTACKER_WALLET,
  });

  assert.equal(withWallet.ok, false);

  const clean = normalizePaymentIntentArguments({
    amount: "1.5",
    purpose: "Logo design project",
  });
  assert.equal(clean.ok, true);

  assert.equal(parseToolArguments("{not json").ok, false);
  assert.equal(parseToolArguments(42).ok, false);
  assert.equal(
    parseToolArguments(JSON.stringify({ amount: "1.5", purpose: "Logo design project" }))
      .ok,
    true,
  );
});

test("a malformed provider response returns 502 and no token", async () => {
  const { handler, state } = createHandler({
    proposeIntent: async () => ({
      ok: false,
      code: "invalid_model_response",
      message: "upstream details that must not be echoed",
    }),
  });

  const response = await handler(makeRequest({ message: VALID_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.status, "provider_unavailable");
  assert.equal(body.code, "invalid_model_response");
  assert.equal("intentToken" in body, false);
  assert.equal(state.authorizeCalls, 0);
  assert.doesNotMatch(JSON.stringify(body), /upstream details/);
});

test("the tool schema is strict and named prepare_sol_payment", () => {
  assert.equal(PREPARE_SOL_PAYMENT_TOOL, "prepare_sol_payment");

  const source = readFileSync(
    new URL("../src/lib/ai/gemini-payment-intent.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /additionalProperties: false/);
  assert.match(source, /required: \["amount", "purpose"\]/);
});

// ---------------------------------------------------------------------------
// 9. Provider chain
// ---------------------------------------------------------------------------

test("Gemini success does not consult OpenRouter", async () => {
  let openRouterCalls = 0;

  const result = await proposePaymentIntent(
    { message: VALID_MESSAGE },
    {
      askGemini: async () =>
        toolCall({
          amount: "1.5",
          recipientAddress: RECIPIENT,
          purpose: "Logo design project",
        }),
      askOpenRouter: async () => {
        openRouterCalls += 1;
        return { ok: false, code: "not_configured" };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(openRouterCalls, 0);
});

test("a retryable Gemini failure falls back to the free OpenRouter model", async () => {
  let openRouterCalls = 0;

  const result = await proposePaymentIntent(
    { message: VALID_MESSAGE },
    {
      askGemini: async () => ({
        ok: false,
        code: "upstream_unavailable",
        message: "Gemini is overloaded.",
        upstreamStatus: 503,
      }),
      askOpenRouter: async () => {
        openRouterCalls += 1;
        return {
          ok: true,
          proposal: {
            kind: "tool_call",
            arguments: {
              amount: "1.5",
              recipientAddress: RECIPIENT,
              purpose: "Logo design project",
            },
          },
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(openRouterCalls, 1);
  if (result.ok) assert.equal(result.proposal.kind, "tool_call");
});

test("a non-retryable Gemini failure never invokes the fallback", async () => {
  let openRouterCalls = 0;

  const result = await proposePaymentIntent(
    { message: VALID_MESSAGE },
    {
      askGemini: async () => ({
        ok: false,
        code: "invalid_api_key",
        message: "bad key",
        upstreamStatus: 401,
      }),
      askOpenRouter: async () => {
        openRouterCalls += 1;
        return { ok: false, code: "not_configured" };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(openRouterCalls, 0);
  if (!result.ok) assert.equal(result.code, "invalid_api_key");
});

test("both providers failing yields provider_unavailable", async () => {
  const result = await proposePaymentIntent(
    { message: VALID_MESSAGE },
    {
      askGemini: async () => ({
        ok: false,
        code: "upstream_timeout",
        message: "timeout",
      }),
      askOpenRouter: async () => ({ ok: false, code: "quota_exceeded" }),
    },
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "provider_unavailable");
});

test("the OpenRouter fallback asks for JSON and never sends tools", () => {
  const body = buildOpenRouterIntentRequestBody(
    { message: VALID_MESSAGE },
    "google/gemma-3-27b-it:free",
  );

  assert.equal(body.model, "google/gemma-3-27b-it:free");
  assert.equal("tools" in body, false);
  assert.match(body.messages[0].content, /Return ONLY a JSON object/);
  const last = body.messages[body.messages.length - 1];
  assert.equal(last.role, "user");
  assert.equal(last.content, VALID_MESSAGE);
  assert.equal(OPENROUTER_PAYMENT_INTENT_TITLE, "PayProof Payment Agent");
});

test("OpenRouter replies are parsed strictly", () => {
  const toolCallReply = parseIntentReply(
    JSON.stringify({
      kind: "tool_call",
      arguments: {
        amount: "1.5",
        recipientAddress: RECIPIENT,
        purpose: "Logo design project",
      },
    }),
  );
  assert.equal(toolCallReply.ok, true);
  if (toolCallReply.ok) assert.equal(toolCallReply.proposal.kind, "tool_call");

  const fenced = parseIntentReply(
    "```json\n" +
      JSON.stringify({
        kind: "message",
        text: "Which wallet should receive it?",
      }) +
      "\n```",
  );
  assert.equal(fenced.ok, true);
  if (fenced.ok) {
    assert.equal(fenced.proposal.kind, "message");
    assert.equal(fenced.proposal.text, "Which wallet should receive it?");
  }

  const prose = parseIntentReply("Which Solana wallet should receive this?");
  assert.equal(prose.ok, true);
  if (prose.ok) assert.equal(prose.proposal.kind, "message");

  assert.equal(
    parseIntentReply(
      JSON.stringify({
        kind: "tool_call",
        arguments: { amount: "1.5", purpose: "Logo", wallet: ATTACKER_WALLET },
      }),
    ).ok,
    false,
  );
  assert.equal(parseIntentReply("{broken json").ok, false);
});

// ---------------------------------------------------------------------------
// 10. Fail-closed authorization
// ---------------------------------------------------------------------------

test("a missing intent secret fails closed before the AI call", async () => {
  const { handler, state } = createHandler({ intentSecret: () => null });

  const response = await handler(makeRequest({ message: VALID_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.status, "provider_unavailable");
  assert.equal(body.code, "not_configured");
  assert.equal(body.error, AI_INTENT_NOT_CONFIGURED_MESSAGE);
  assert.equal("intentToken" in body, false);
  assert.equal(state.proposeCalls, 0);
  assert.equal(state.authorizeCalls, 0);
});

test("a database registration failure returns no token", async () => {
  const { handler } = createHandler({
    authorizeIntent: async () => ({
      ok: false,
      code: "unavailable",
      message: "insert failed",
    }),
  });

  const response = await handler(makeRequest({ message: VALID_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.status, "provider_unavailable");
  assert.equal(body.code, "authorization_unavailable");
  assert.equal("intentToken" in body, false);
  assert.doesNotMatch(JSON.stringify(body), /insert failed/);
});

test("a registration exception returns no token", async () => {
  const { handler } = createHandler({
    authorizeIntent: async () => {
      throw new Error("connection reset");
    },
  });

  const response = await handler(makeRequest({ message: VALID_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal("intentToken" in body, false);
});

// ---------------------------------------------------------------------------
// 11. No transaction construction or signing
// ---------------------------------------------------------------------------

test("the intent endpoint never builds, signs or submits a transaction", () => {
  const files = [
    "../src/lib/ai/gemini-payment-intent.ts",
    "../src/lib/ai/openrouter-payment-intent.ts",
    "../src/lib/ai/payment-intent-provider.ts",
    "../src/lib/ai/payment-intent-handler.ts",
    "../src/app/api/ai/payment-intents/route.ts",
  ];

  for (const file of files) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8")
      // Comments explain what is deliberately absent; only real code counts.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    for (const forbidden of [
      "@solana/web3.js",
      "@solana/spl-token",
      "VersionedTransaction",
      "TransactionInstruction",
      "sendTransaction",
      "signTransaction",
      "Keypair",
      "blockhash",
      "privateKey",
    ]) {
      assert.equal(
        source.includes(forbidden),
        false,
        `${file} must not reference ${forbidden}`,
      );
    }
  }
});

test("the endpoint reuses the shared auth, body and origin guards", () => {
  const source = readFileSync(
    new URL("../src/lib/ai/payment-intent-handler.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /requireMerchant/);
  assert.match(source, /readJsonBody/);
  assert.match(source, /hasJsonContentType/);
  assert.match(source, /isSameOriginRequest/);
  assert.match(source, /checkClientRateLimit/);
  assert.match(source, /checkWalletRateLimit/);

  // The wallet argument is only ever taken from the resolved session.
  assert.match(source, /merchantAddress = await deps\.resolveMerchant\(request\)/);
});
