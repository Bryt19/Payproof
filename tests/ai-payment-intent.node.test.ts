import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isAddress } from "@solana/kit";

import {
  extractUserSuppliedBase58Tokens,
  INTENT_AMOUNT_MAX_LAMPORTS,
  isPaymentIntentExecutable,
  isUserSuppliedAddress,
  preparePaymentIntent,
  SUPPORTED_INTENT_CURRENCY,
  UNSUPPORTED_INTENT_CURRENCY_MESSAGE,
} from "../src/lib/ai/payment-intent.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Well-known 32-byte Devnet/mainnet account keys, used only as addresses. */
const RECIPIENT = "So11111111111111111111111111111111111111112";
const OTHER_RECIPIENT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** 32-byte base58 value with the same shape as a payment reference. */
const REFERENCE = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

function userMessage(amount = "2"): string {
  return `Send ${amount} SOL to ${RECIPIENT} for the website development deposit.`;
}

function validProposal(overrides: Record<string, unknown> = {}) {
  return {
    amount: "2",
    purpose: "website development deposit",
    recipientAddress: RECIPIENT,
    sourceKind: "address",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 0: Fixture sanity and exported constants
// ---------------------------------------------------------------------------

test("address fixtures are valid Solana addresses", () => {
  assert.equal(isAddress(RECIPIENT), true);
  assert.equal(isAddress(OTHER_RECIPIENT), true);
  assert.equal(isAddress("not-a-valid-solana-address"), false);
});

test("the intent uses the existing 10 SOL cap and SOL-only currency", () => {
  assert.equal(SUPPORTED_INTENT_CURRENCY, "SOL");
  assert.equal(INTENT_AMOUNT_MAX_LAMPORTS, 10_000_000_000n);
});

// ---------------------------------------------------------------------------
// 1-2: Valid intent and recipient
// ---------------------------------------------------------------------------

test("a valid SOL payment intent is normalized", () => {
  const result = preparePaymentIntent(
    {
      amount: "2",
      purpose: "  website   development deposit ",
      recipientAddress: RECIPIENT,
      sourceKind: "address",
    },
    { userMessage: userMessage() },
  );

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;

  assert.equal(result.intent.amountLamports, "2000000000");
  assert.equal(result.intent.amountSol, "2");
  assert.equal(result.intent.recipientAddress, RECIPIENT);
  assert.equal(result.intent.purpose, "website development deposit");
  assert.equal(result.intent.currency, "SOL");
  assert.equal(result.intent.sourceKind, "address");
  assert.equal(result.intent.sourcePaymentRequestReference, null);
  assert.equal(isPaymentIntentExecutable(result.intent), true);
});

test("a valid recipient address present in the message is accepted", () => {
  const result = preparePaymentIntent(
    { amount: "0.25", purpose: "design work", recipientAddress: RECIPIENT },
    { userMessage: userMessage("0.25") },
  );

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;

  // sourceKind is inferred from the supplied recipient.
  assert.equal(result.intent.sourceKind, "address");
  assert.equal(result.intent.recipientAddress, RECIPIENT);
  assert.equal(result.intent.amountLamports, "250000000");
});

test("an address is matched as a standalone token, not a substring", () => {
  assert.equal(isUserSuppliedAddress(userMessage(), RECIPIENT), true);
  assert.equal(
    isUserSuppliedAddress(`x${RECIPIENT}`, RECIPIENT),
    false,
    "an address embedded in a longer base58 token is not user-supplied as-is",
  );
  assert.deepEqual(
    extractUserSuppliedBase58Tokens(userMessage()),
    [RECIPIENT],
  );
});

// ---------------------------------------------------------------------------
// 3-4: Recipient required / invalid
// ---------------------------------------------------------------------------

test("a missing recipient returns recipient_required and builds no intent", () => {
  const result = preparePaymentIntent(
    { amount: "2", purpose: "website development deposit" },
    { userMessage: "Send 2 SOL for the website development deposit." },
  );

  assert.equal(result.status, "recipient_required");
  if (result.status !== "recipient_required") return;

  assert.equal(result.reason, "missing");
  assert.match(result.message, /recipient address/i);
  assert.equal("intent" in result, false);
});

test("an invalid recipient address is rejected", () => {
  for (const candidate of [
    "not-a-valid-solana-address",
    "abc",
    "0OIl",
    `${RECIPIENT}0`,
  ]) {
    const result = preparePaymentIntent(
      validProposal({ recipientAddress: candidate }),
      { userMessage: `Send 2 SOL to ${candidate} for the website development deposit.` },
    );

    assert.equal(result.status, "recipient_required", candidate);
    if (result.status !== "recipient_required") return;

    assert.equal(result.reason, "invalid_address", candidate);
    assert.equal("intent" in result, false);
  }
});

// ---------------------------------------------------------------------------
// 5-8: Amount rules and exact lamport conversion
// ---------------------------------------------------------------------------

test("a zero amount is rejected", () => {
  const result = preparePaymentIntent(validProposal({ amount: "0" }), {
    userMessage: userMessage("0"),
  });

  assert.equal(result.status, "invalid");
  if (result.status !== "invalid") return;

  assert.equal(result.errors[0].field, "amount");
  assert.equal(result.errors[0].code, "amount_not_positive");
});

test("a negative amount is rejected", () => {
  const result = preparePaymentIntent(validProposal({ amount: "-1" }), {
    userMessage: userMessage("-1"),
  });

  assert.equal(result.status, "invalid");
  if (result.status !== "invalid") return;

  assert.equal(result.errors[0].field, "amount");
  assert.equal(result.errors[0].code, "invalid_amount");
});

test("an amount above the 10 SOL limit is rejected", () => {
  for (const amount of ["10.000000001", "11", "100"]) {
    const result = preparePaymentIntent(validProposal({ amount }), {
      userMessage: userMessage(amount),
    });

    assert.equal(result.status, "invalid", amount);
    if (result.status !== "invalid") return;

    assert.equal(result.errors[0].field, "amount", amount);
    assert.equal(result.errors[0].code, "amount_above_limit", amount);
  }
});

test("exactly 10 SOL is allowed", () => {
  const result = preparePaymentIntent(validProposal({ amount: "10" }), {
    userMessage: userMessage("10"),
  });

  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;

  assert.equal(result.intent.amountLamports, "10000000000");
  assert.equal(result.intent.amountSol, "10");
});

test("decimal amounts convert to exact integer lamports", () => {
  const cases: Array<[string, string, string]> = [
    ["0.000000001", "1", "0.000000001"],
    ["0.1", "100000000", "0.1"],
    ["0.5", "500000000", "0.5"],
    ["1.234567891", "1234567891", "1.234567891"],
    ["2.000000000", "2000000000", "2"],
  ];

  for (const [amount, lamports, display] of cases) {
    const result = preparePaymentIntent(validProposal({ amount }), {
      userMessage: userMessage(amount),
    });

    assert.equal(result.status, "ready", amount);
    if (result.status !== "ready") continue;

    assert.equal(result.intent.amountLamports, lamports, amount);
    assert.equal(result.intent.amountSol, display, amount);
    assert.equal(
      BigInt(result.intent.amountLamports),
      BigInt(lamports),
      `${amount} must round-trip exactly`,
    );
  }
});

test("a malformed decimal amount is rejected", () => {
  for (const amount of ["0.5.5", "1,5", "1e3", "abc", ".5", "5."]) {
    const result = preparePaymentIntent(validProposal({ amount }), {
      userMessage: userMessage(amount),
    });

    assert.equal(result.status, "invalid", amount);
    if (result.status !== "invalid") continue;

    assert.equal(result.errors[0].field, "amount", amount);
    assert.equal(result.errors[0].code, "invalid_amount", amount);
  }
});

// ---------------------------------------------------------------------------
// 9: Currency
// ---------------------------------------------------------------------------

test("an unsupported currency field is rejected and never converted", () => {
  const result = preparePaymentIntent(validProposal({ currency: "GHS" }), {
    userMessage: userMessage(),
  });

  assert.equal(result.status, "unsupported_currency");
  if (result.status !== "unsupported_currency") return;

  assert.equal(result.currency, "GHS");
  assert.equal(result.message, UNSUPPORTED_INTENT_CURRENCY_MESSAGE);
  assert.match(result.message, /support SOL only/i);
});

test("a currency embedded in the amount is rejected", () => {
  const result = preparePaymentIntent(validProposal({ amount: "GHS 500" }), {
    userMessage: "Send GHS 500 to the website developer for the deposit.",
  });

  assert.equal(result.status, "unsupported_currency");
  if (result.status !== "unsupported_currency") return;

  assert.equal(result.currency, "GHS");
});

test("a currency in the instruction is rejected when no SOL amount is given", () => {
  const result = preparePaymentIntent(validProposal({ amount: "500" }), {
    userMessage: `Send 500 GHS to ${RECIPIENT} for the website development deposit.`,
  });

  assert.equal(result.status, "unsupported_currency");
  if (result.status !== "unsupported_currency") return;

  assert.equal(result.currency, "GHS");
});

test("an explicit SOL amount is not blocked by a currency symbol in the purpose", () => {
  const result = preparePaymentIntent(
    {
      amount: "2",
      purpose: "the $5 discount campaign",
      recipientAddress: RECIPIENT,
      sourceKind: "address",
    },
    {
      userMessage: `Send 2 SOL to ${RECIPIENT} for the $5 discount campaign.`,
    },
  );

  assert.equal(result.status, "ready");
});

// ---------------------------------------------------------------------------
// 10-11: Purpose
// ---------------------------------------------------------------------------

test("an empty purpose asks for the purpose", () => {
  const result = preparePaymentIntent(validProposal({ purpose: "   " }), {
    userMessage: userMessage(),
  });

  assert.equal(result.status, "clarification");
  if (result.status !== "clarification") return;

  assert.deepEqual(result.missing, ["purpose"]);
  assert.equal("intent" in result, false);
});

test("a missing amount asks for the amount", () => {
  const result = preparePaymentIntent(
    { purpose: "website development deposit", recipientAddress: RECIPIENT },
    { userMessage: userMessage() },
  );

  assert.equal(result.status, "clarification");
  if (result.status !== "clarification") return;

  assert.deepEqual(result.missing, ["amount"]);
});

test("an excessively long purpose is rejected", () => {
  const result = preparePaymentIntent(
    validProposal({ purpose: "x".repeat(201) }),
    { userMessage: userMessage() },
  );

  assert.equal(result.status, "invalid");
  if (result.status !== "invalid") return;

  assert.equal(result.errors[0].field, "purpose");
  assert.equal(result.errors[0].code, "purpose_too_long");
});

// ---------------------------------------------------------------------------
// 12: Strict schema
// ---------------------------------------------------------------------------

test("unexpected input fields are rejected without echoing their values", () => {
  const result = preparePaymentIntent(
    validProposal({ merchantWallet: OTHER_RECIPIENT }),
    { userMessage: userMessage() },
  );

  assert.equal(result.status, "invalid");
  if (result.status !== "invalid") return;

  assert.equal(result.errors[0].field, "intent");
  assert.equal(result.errors[0].code, "unexpected_field");
  assert.match(result.errors[0].message, /merchantWallet/);
  assert.doesNotMatch(
    JSON.stringify(result),
    new RegExp(OTHER_RECIPIENT),
    "the rejected value must never be echoed back",
  );
});

test("an unexpected secret-shaped field is rejected without echoing its value", () => {
  const result = preparePaymentIntent(
    validProposal({ apiKey: "sk-live-should-never-appear" }),
    { userMessage: userMessage() },
  );

  assert.equal(result.status, "invalid");
  if (result.status !== "invalid") return;

  assert.equal(result.errors[0].code, "unexpected_field");
  assert.doesNotMatch(JSON.stringify(result), /sk-live-should-never-appear/);
});

test("a non-object proposal is rejected", () => {
  for (const proposal of [null, undefined, [] as unknown] as const) {
    const result = preparePaymentIntent(
      proposal as Record<string, unknown> | null | undefined,
      { userMessage: userMessage() },
    );

    assert.equal(result.status, "invalid");
    if (result.status !== "invalid") continue;
    assert.equal(result.errors[0].code, "invalid_input");
  }
});

// ---------------------------------------------------------------------------
// 13: Recipient provenance
// ---------------------------------------------------------------------------

test("an AI-proposed address absent from the user instruction is rejected", () => {
  const result = preparePaymentIntent(
    validProposal({ recipientAddress: OTHER_RECIPIENT }),
    { userMessage: userMessage() },
  );

  assert.equal(result.status, "recipient_required");
  if (result.status !== "recipient_required") return;

  assert.equal(result.reason, "not_user_supplied");
  assert.equal("intent" in result, false);
});

test("a valid address is rejected when the user message is empty", () => {
  const result = preparePaymentIntent(validProposal(), { userMessage: "" });

  assert.equal(result.status, "recipient_required");
  if (result.status !== "recipient_required") return;

  assert.equal(result.reason, "not_user_supplied");
});

// ---------------------------------------------------------------------------
// 14: Payment request reference as resolution input
// ---------------------------------------------------------------------------

test("a valid payment request reference is accepted as resolution input", () => {
  const result = preparePaymentIntent(
    {
      amount: "2",
      purpose: "website development deposit",
      sourceKind: "payment_request",
      sourcePaymentRequestReference: REFERENCE,
    },
    { userMessage: `Pay ${REFERENCE} for the website development deposit of 2 SOL.` },
  );

  assert.equal(result.status, "recipient_required");
  if (result.status !== "recipient_required") return;

  assert.equal(result.reason, "payment_request_lookup_required");
  assert.equal(result.sourcePaymentRequestReference, REFERENCE);
  assert.equal("intent" in result, false);
});

test("an invalid payment request reference is rejected", () => {
  for (const reference of ["not-a-reference", "0OIl", "short"]) {
    const result = preparePaymentIntent(
      {
        amount: "2",
        purpose: "website development deposit",
        sourceKind: "payment_request",
        sourcePaymentRequestReference: reference,
      },
      { userMessage: `Pay ${REFERENCE} for the website development deposit of 2 SOL.` },
    );

    assert.equal(result.status, "invalid", reference);
    if (result.status !== "invalid") continue;

    assert.equal(result.errors[0].field, "sourcePaymentRequestReference");
    assert.equal(result.errors[0].code, "invalid_reference");
  }
});

test("supplying both a recipient and a reference is ambiguous", () => {
  const result = preparePaymentIntent(
    {
      amount: "2",
      purpose: "website development deposit",
      sourceKind: "address",
      recipientAddress: RECIPIENT,
      sourcePaymentRequestReference: REFERENCE,
    },
    { userMessage: userMessage() },
  );

  assert.equal(result.status, "recipient_required");
  if (result.status !== "recipient_required") return;

  assert.equal(result.reason, "ambiguous_source");
});

test("an invalid sourceKind is rejected", () => {
  const result = preparePaymentIntent(
    validProposal({ sourceKind: "invoice" }),
    { userMessage: userMessage() },
  );

  assert.equal(result.status, "invalid");
  if (result.status !== "invalid") return;

  assert.equal(result.errors[0].field, "sourceKind");
  assert.equal(result.errors[0].code, "invalid_source_kind");
});

// ---------------------------------------------------------------------------
// Purity: no I/O, no AI SDK, no persistence
// ---------------------------------------------------------------------------

const INTENT_SOURCE = readFileSync(
  new URL("../src/lib/ai/payment-intent.ts", import.meta.url),
  "utf8",
);

test("the intent module performs no network, database, AI or wallet work", () => {
  for (const forbidden of [
    /\bfetch\s*\(/,
    /createSupabaseClient/,
    /@supabase\/supabase-js/,
    /next\/server/,
    /next\/headers/,
    /@google\/genai/,
    /openrouter/i,
    /payment-requests\/(repository|actions|create-for-session)/,
    /\binsert\s*\(/,
    /\bsignTransaction\b/,
    /\bsendTransaction\b/,
    /\bwindow\./,
    /\bdocument\./,
  ]) {
    assert.doesNotMatch(INTENT_SOURCE, forbidden, String(forbidden));
  }
});

test("the intent module builds no transaction and no signature", () => {
  assert.doesNotMatch(INTENT_SOURCE, /createTransactionMessage/);
  assert.doesNotMatch(INTENT_SOURCE, /getTransferSolInstruction/);
  assert.doesNotMatch(INTENT_SOURCE, /buildPaymentTransfer/);
  assert.doesNotMatch(INTENT_SOURCE, /sendTransaction/);
});
