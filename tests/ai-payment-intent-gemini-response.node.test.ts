import assert from "node:assert/strict";
import { test } from "node:test";

import { NextRequest } from "next/server";

import {
  PREPARE_SOL_PAYMENT_TOOL,
  proposeSolPayment,
  type PaymentIntentProposalResult,
  type SolPaymentProposalInput,
} from "../src/lib/ai/gemini-payment-intent.ts";
import { createPaymentIntentPostHandler } from "../src/lib/ai/payment-intent-handler.ts";
import { proposePaymentIntent } from "../src/lib/ai/payment-intent-provider.ts";

/**
 * The Gemini client is never called live in these tests: every case supplies a
 * raw interaction payload in the shape the Google GenAI SDK actually returns.
 * That shape is `output_text` plus `model_output` steps containing content
 * blocks, verified against @google/genai's Interaction and Step types.
 *
 * A dummy key is set unconditionally so a real exported key can never turn a
 * seam-based test into a live provider request.
 */
process.env.GEMINI_API_KEY = "test-gemini-key-not-real";

const SESSION_WALLET = "So11111111111111111111111111111111111111112";
const TOKEN_SECRET = "intent-test-secret-0123456789-abcdefghijklmnop";
const NOW = new Date("2026-11-25T10:00:00.000Z");

const MERCHANT_MESSAGE = "Pay the designer 2 SOL.";
const CLARIFICATION = "Which Solana wallet should receive this payment?";

function textContent(text: string) {
  return { type: "text", text };
}

function modelOutput(text: string) {
  return { type: "model_output", content: [textContent(text)] };
}

function toolCallInteraction(arguments_: unknown) {
  return {
    steps: [
      {
        type: "function_call",
        name: PREPARE_SOL_PAYMENT_TOOL,
        arguments: arguments_,
      },
    ],
  };
}

/** Runs proposeSolPayment against a fixed SDK response. */
async function proposeFromInteraction(
  interaction: unknown,
): Promise<PaymentIntentProposalResult> {
  return proposeSolPayment(
    { message: MERCHANT_MESSAGE },
    { createInteraction: async () => interaction },
  );
}

function geminiAs(
  interaction: unknown,
): (input: SolPaymentProposalInput) => Promise<PaymentIntentProposalResult> {
  return (input) =>
    proposeSolPayment(input, { createInteraction: async () => interaction });
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/ai/payment-intents", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

/** Handler wired to the real provider chain and a counting authorizer. */
function createHandler(interaction: unknown) {
  let authorizeCalls = 0;

  const handler = createPaymentIntentPostHandler({
    resolveMerchant: async () => SESSION_WALLET,
    checkRateLimit: async () => ({ ok: true }),
    checkCapability: async () => ({ ok: true }),
    proposeIntent: (input) =>
      proposePaymentIntent(input, { askGemini: geminiAs(interaction) }),
    authorizeIntent: async () => {
      authorizeCalls += 1;
      throw new Error("authorization must not run for a clarification");
    },
    intentSecret: () => TOKEN_SECRET,
    now: () => NOW,
  });

  return { handler, authorizeCalls: () => authorizeCalls };
}

// ---------------------------------------------------------------------------
// A. Plain-text clarification, both SDK representations present
// ---------------------------------------------------------------------------

test("a plain-text Gemini reply becomes a message proposal", async () => {
  const result = await proposeFromInteraction({
    output_text: CLARIFICATION,
    steps: [modelOutput(CLARIFICATION)],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.proposal.kind, "message");
  if (result.proposal.kind !== "message") return;
  assert.equal(result.proposal.text, CLARIFICATION);
});

test("a clarification reaches the handler as 200 and creates no intent or token", async () => {
  const { handler, authorizeCalls } = createHandler({
    output_text: CLARIFICATION,
    steps: [modelOutput(CLARIFICATION)],
  });

  const response = await handler(makeRequest({ message: MERCHANT_MESSAGE }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "clarification");
  assert.equal(body.message, CLARIFICATION);
  assert.equal("intentToken" in body, false);
  assert.equal("intentId" in body, false);
  assert.equal(authorizeCalls(), 0);
});

// ---------------------------------------------------------------------------
// B. model_output fallback when output_text is absent or empty
// ---------------------------------------------------------------------------

test("text is extracted from model_output when output_text is absent", async () => {
  const result = await proposeFromInteraction({
    steps: [modelOutput(`  ${CLARIFICATION}  `)],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.proposal.kind, "message");
  if (result.proposal.kind !== "message") return;
  assert.equal(result.proposal.text, CLARIFICATION);
});

test("text is extracted from model_output when output_text is blank", async () => {
  const result = await proposeFromInteraction({
    output_text: "   ",
    steps: [modelOutput(CLARIFICATION)],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.proposal.kind, "message");
  if (result.proposal.kind !== "message") return;
  assert.equal(result.proposal.text, CLARIFICATION);
});

// ---------------------------------------------------------------------------
// C. Partial tool-call arguments keep the clarification branch
// ---------------------------------------------------------------------------

test("a tool call with missing fields still returns a clarification", async () => {
  const result = await proposeFromInteraction(
    toolCallInteraction({ amount: "2" }),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.proposal.kind, "message");
  if (result.proposal.kind !== "message") return;

  assert.match(result.proposal.text, /purpose/);
  assert.match(result.proposal.text, /recipient/);
  assert.doesNotMatch(result.proposal.text, /amount/);
});

// ---------------------------------------------------------------------------
// D. Strict argument parsing is unchanged
// ---------------------------------------------------------------------------

test("malformed or schema-breaking tool arguments are still rejected", async () => {
  const rejected: unknown[] = [
    "{not json",
    42,
    null,
    { amount: "2", purpose: "Logo design project", merchantWallet: SESSION_WALLET },
  ];

  for (const arguments_ of rejected) {
    const result = await proposeFromInteraction(
      toolCallInteraction(arguments_),
    );

    assert.equal(result.ok, false, JSON.stringify(arguments_));
    if (result.ok) continue;
    assert.equal(result.code, "invalid_model_response");
  }
});

// ---------------------------------------------------------------------------
// E. Empty response stays fail-closed
// ---------------------------------------------------------------------------

test("an interaction with no usable text or tool call stays invalid", async () => {
  const empty: unknown[] = [
    {},
    { output_text: "", steps: [] },
    { output_text: "   " },
    { steps: [{ type: "thought" }] },
    { steps: [{ type: "model_output", content: [{ type: "image" }] }] },
  ];

  for (const interaction of empty) {
    const result = await proposeFromInteraction(interaction);

    assert.equal(result.ok, false, JSON.stringify(interaction));
    if (result.ok) continue;
    assert.equal(result.code, "invalid_model_response");

    // Still Gemini-only: this code must not be laundered through OpenRouter.
    const provider = await proposePaymentIntent(
      { message: MERCHANT_MESSAGE },
      { askGemini: geminiAs(interaction) },
    );
    assert.equal(provider.ok, false);
    if (provider.ok) continue;
    assert.equal(provider.code, "invalid_model_response");
  }
});
