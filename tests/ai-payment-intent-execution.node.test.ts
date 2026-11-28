import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NextRequest, NextResponse } from "next/server";
import {
  appendTransactionMessageInstruction,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionWithSigners,
  type KeyPairSigner,
  type TransactionMessage,
  type TransactionMessageWithBlockhashLifetime,
  type TransactionMessageWithFeePayer,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

import {
  createIntentSubmitPostHandler,
  type IntentSubmitDependencies,
} from "../src/lib/ai/intent-submit-handler.ts";
import {
  createIntentVerifyPostHandler,
  type IntentVerifyDependencies,
} from "../src/lib/ai/intent-verify-handler.ts";
import { inspectSignedAgentTransferTransaction } from "../src/lib/solana/agent-submission.ts";
import {
  canonicalAgentPaymentFingerprint,
  canonicalAgentPaymentInputFromInspection,
  hashAgentMessageBytes,
} from "../src/lib/solana/agent-payment.ts";
import {
  parseIntentSubmitResponse,
  parseIntentVerifyResponse,
} from "../src/lib/ai/intent-approval.ts";
import type {
  AgentPaymentIntent,
  AgentPaymentIntentPreparation,
} from "../src/lib/ai/intent-registry.ts";

/**
 * Stage 4 Step 3: submit and verify endpoint behaviour.
 *
 * Real keypairs sign real (local) transactions, so signed-byte inspection is
 * exercised for real. Database, capability, rate limit, RPC, broadcast and
 * on-chain lookup are all injected fakes: nothing is sent to a network and no
 * real payment is attempted.
 */

const BLOCKHASH = "11111111111111111111111111111111";
const LAST_VALID_BLOCK_HEIGHT = 300_000_000n;
const AMOUNT = 1_500_000_000n;
const NONCE = "ab".repeat(16);
const REFERENCE = "11111111111111111111111111111111";
const FINGERPRINT = "c".repeat(64);
const NOW = new Date("2026-11-27T10:00:00.000Z");
const APPROVED_AT = NOW.toISOString();
const EXPIRES_AT = new Date(NOW.getTime() + 10 * 60 * 1000).toISOString();
const APPROVAL_EXPIRES_AT = new Date(
  NOW.getTime() + 5 * 60 * 1000,
).toISOString();

const SUBMIT_PATH = "/api/ai/payment-intents/submit";
const VERIFY_PATH = "/api/ai/payment-intents/verify";

type Message = TransactionMessage &
  TransactionMessageWithFeePayer &
  TransactionMessageWithBlockhashLifetime;

async function buildSignedTransfer({
  payer,
  destination,
  amount = AMOUNT,
  extraInstruction = false,
  blockhash = BLOCKHASH,
}: {
  payer: KeyPairSigner;
  destination: string;
  amount?: bigint;
  extraInstruction?: boolean;
  blockhash?: string;
}) {
  let message = pipe(
    createTransactionMessage({ version: "legacy" }),
    (transactionMessage) =>
      setTransactionMessageFeePayerSigner(payer, transactionMessage),
    (transactionMessage) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash as Parameters<
            typeof setTransactionMessageLifetimeUsingBlockhash
          >[0]["blockhash"],
          lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
        },
        transactionMessage,
      ),
    (transactionMessage) =>
      appendTransactionMessageInstruction(
        getTransferSolInstruction({
          source: createNoopSigner(payer.address),
          destination: destination as Parameters<
            typeof getTransferSolInstruction
          >[0]["destination"],
          amount,
        }),
        transactionMessage,
      ),
  ) as Message;

  if (extraInstruction) {
    message = appendTransactionMessageInstruction(
      getTransferSolInstruction({
        source: createNoopSigner(payer.address),
        destination: destination as Parameters<
          typeof getTransferSolInstruction
        >[0]["destination"],
        amount: 1n,
      }),
      message,
    ) as Message;
  }

  const compiled = compileTransaction(message);
  const signed = await signTransactionWithSigners([payer], compiled);
  const transactionBase64 = getBase64EncodedWireTransaction(signed);
  const decoded = getTransactionDecoder().decode(
    getBase64Encoder().encode(transactionBase64),
  );
  const signatureBytes = decoded.signatures[payer.address];

  assert.ok(signatureBytes);

  return {
    transactionBase64,
    messageHash: hashAgentMessageBytes(compiled.messageBytes),
    signature: getBase58Decoder().decode(signatureBytes),
  };
}

type Fixture = {
  merchant: KeyPairSigner;
  recipient: KeyPairSigner;
  attacker: KeyPairSigner;
  transactionBase64: string;
  signature: string;
  messageHash: string;
  intent: AgentPaymentIntent;
  preparation: AgentPaymentIntentPreparation;
};

let fixturePromise: Promise<Fixture> | null = null;

async function fixture(): Promise<Fixture> {
  fixturePromise ??= (async () => {
    const merchant = await generateKeyPairSigner();
    const recipient = await generateKeyPairSigner();
    const attacker = await generateKeyPairSigner();
    const signed = await buildSignedTransfer({
      payer: merchant,
      destination: recipient.address,
    });

    const intent: AgentPaymentIntent = {
      id: "AI-12345678",
      merchantWallet: merchant.address,
      status: "approved",
      recipientAddress: recipient.address,
      amountLamports: AMOUNT.toString(),
      purpose: "Logo design",
      reference: REFERENCE,
      sourceKind: "address",
      sourcePaymentRequestReference: null,
      nonce: NONCE,
      intentFingerprint: FINGERPRINT,
      transactionSignature: null,
      transactionBase64: null,
      payerAddress: null,
      verifiedAt: null,
      expiresAt: EXPIRES_AT,
      createdAt: NOW.toISOString(),
      approvedAt: APPROVED_AT,
      approvalExpiresAt: APPROVAL_EXPIRES_AT,
      submittedAt: null,
      failureReason: null,
    };

    // The persisted binding is the canonical fingerprint, exactly as the
    // preparation endpoint would have written it.
    const canonicalFingerprint = canonicalAgentPaymentFingerprint(
      canonicalAgentPaymentInputFromInspection({
        inspection: inspectSignedAgentTransferTransaction(
          signed.transactionBase64,
        ).inspection,
        intentId: intent.id,
        intentNonce: intent.nonce,
        merchantWallet: merchant.address,
        recipient: recipient.address,
        amountLamports: AMOUNT,
        lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
      }),
    );

    return {
      merchant,
      recipient,
      attacker,
      transactionBase64: signed.transactionBase64,
      signature: signed.signature,
      messageHash: signed.messageHash,
      intent,
      preparation: {
        intentId: intent.id,
        intentNonce: intent.nonce,
        merchantWallet: merchant.address,
        messageHash: signed.messageHash,
        canonicalFingerprint,
        blockhash: BLOCKHASH,
        lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT.toString(),
        approvalExpiresAt: APPROVAL_EXPIRES_AT,
        createdAt: NOW.toISOString(),
      },
    };
  })();

  return fixturePromise;
}

function submittedIntent(
  base: AgentPaymentIntent,
  signature: string,
): AgentPaymentIntent {
  return {
    ...base,
    status: "submitted",
    transactionSignature: signature,
    payerAddress: base.merchantWallet,
    submittedAt: NOW.toISOString(),
  };
}

function makeRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

async function createSubmit(
  f: Fixture,
  overrides: Partial<IntentSubmitDependencies> = {},
) {
  let submittedSignature: string | null = null;
  let submittedTransaction: string | null = null;
  const state = {
    loads: [] as { merchantWallet: string; id: string }[],
    preparationLoads: [] as { intentId: string; blockhash: string }[],
    submissions: [] as {
      nonce: string;
      merchantWallet: string;
      signature: string;
      payerAddress: string;
    }[],
    broadcasts: [] as string[],
  };

  const handler = createIntentSubmitPostHandler({
    resolveMerchant: async () => f.merchant.address,
    checkRateLimit: async () => ({ ok: true }),
    checkCapability: async () => ({ ok: true }),
    checkNetwork: async () => true,
    checkBlockhash: async () => true,
    loadIntent: async (input) => {
      state.loads.push(input);
      return { ok: true, intent: f.intent };
    },
    loadPreparation: async (input) => {
      state.preparationLoads.push(input);
      return { ok: true, preparation: f.preparation };
    },
    submitIntent: async (input) => {
      state.submissions.push(input);
      submittedSignature = input.signature;
      submittedTransaction = input.transactionBase64;

      return {
        ok: true,
        outcome: "submitted",
        intent: submittedIntent(
          { ...f.intent, transactionBase64: input.transactionBase64 },
          input.signature,
        ),
      };
    },
    generateClaimToken: () => "claim-token",
    checkStoredSignature: async () => "not_found",
    claimBroadcast: async (claim) => ({
      outcome: "claimed",
      leaseToken: claim.claimToken,
      leaseExpiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
      storedSignature: submittedSignature ?? f.signature,
      storedTransactionBase64: submittedTransaction ?? f.transactionBase64,
    }),
    recordBroadcast: async () => true,
    markManualReview: async () => true,
    broadcast: async (transaction) => {
      state.broadcasts.push(transaction);
      return f.signature;
    },
    logDiagnostic: () => {},
    now: () => NOW,
    ...overrides,
  });

  return { handler, state };
}

test("a valid signed transfer is recorded and then broadcast", async () => {
  const f = await fixture();
  const { handler, state } = await createSubmit(f);

  const response = await handler(
    makeRequest(SUBMIT_PATH, {
      intentId: f.intent.id,
      transaction: f.transactionBase64,
      amountLamports: "1",
      recipientAddress: f.attacker.address,
      payerAddress: f.attacker.address,
      signature: "1".repeat(64),
      status: "verified",
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "submitted");
  assert.equal(body.outcome, "submitted");
  assert.equal(body.broadcast, "accepted");
  assert.equal(body.signature, f.signature);
  assert.equal(body.cluster, "devnet");
  assert.equal("verified" in body, false);

  assert.deepEqual(state.loads, [
    { merchantWallet: f.merchant.address, id: f.intent.id },
  ]);
  assert.deepEqual(state.submissions, [
    {
      nonce: f.intent.nonce,
      merchantWallet: f.merchant.address,
      signature: f.signature,
      payerAddress: f.merchant.address,
      transactionBase64: f.transactionBase64,
    },
  ]);
  assert.deepEqual(state.broadcasts, [f.transactionBase64]);
});

test("submission requires a session, the capability and a dedicated rate limit", async () => {
  const f = await fixture();

  const unauthenticated = await createSubmit(f, {
    resolveMerchant: async () =>
      NextResponse.json({ error: "Authentication required." }, { status: 401 }),
  });
  assert.equal(
    (
      await unauthenticated.handler(
        makeRequest(SUBMIT_PATH, {
          intentId: f.intent.id,
          transaction: f.transactionBase64,
        }),
      )
    ).status,
    401,
  );

  const disabled = await createSubmit(f, {
    checkCapability: async () => ({ ok: false, reason: "disabled" }),
  });
  assert.equal(
    (
      await disabled.handler(
        makeRequest(SUBMIT_PATH, {
          intentId: f.intent.id,
          transaction: f.transactionBase64,
        }),
      )
    ).status,
    403,
  );
  assert.equal(disabled.state.submissions.length, 0);

  const limited = await createSubmit(f, {
    checkRateLimit: async () => ({
      ok: false,
      kind: "limited",
      retryAfterSeconds: 9,
    }),
  });
  const limitedResponse = await limited.handler(
    makeRequest(SUBMIT_PATH, {
      intentId: f.intent.id,
      transaction: f.transactionBase64,
    }),
  );
  assert.equal(limitedResponse.status, 429);
  assert.equal(limitedResponse.headers.get("retry-after"), "9");
  assert.equal(limited.state.submissions.length, 0);
});

test("submission accepts only an intent id and base64 transaction", async () => {
  const f = await fixture();
  const { handler, state } = await createSubmit(f);

  for (const body of [
    {},
    { intentId: "AI-123", transaction: f.transactionBase64 },
    { intentId: f.intent.id, transaction: "" },
    { intentId: f.intent.id, transaction: "not base64!" },
    { intentId: f.intent.id, transaction: "A".repeat(4_000) },
  ]) {
    assert.equal((await handler(makeRequest(SUBMIT_PATH, body))).status, 400);
  }

  assert.equal(state.submissions.length, 0);
  assert.equal(state.broadcasts.length, 0);
});

test("a foreign or unknown intent is not found and never submitted", async () => {
  const f = await fixture();

  const missing = await createSubmit(f, {
    loadIntent: async () => ({
      ok: false,
      code: "not_found",
      message: "missing",
    }),
  });
  assert.equal(
    (
      await missing.handler(
        makeRequest(SUBMIT_PATH, {
          intentId: f.intent.id,
          transaction: f.transactionBase64,
        }),
      )
    ).status,
    404,
  );

  const foreign = await createSubmit(f, {
    loadIntent: async () => ({
      ok: true,
      intent: { ...f.intent, merchantWallet: f.attacker.address },
    }),
  });
  assert.equal(
    (
      await foreign.handler(
        makeRequest(SUBMIT_PATH, {
          intentId: f.intent.id,
          transaction: f.transactionBase64,
        }),
      )
    ).status,
    404,
  );

  assert.equal(foreign.state.submissions.length, 0);
});

test("only an approved intent with a live approval can be submitted", async () => {
  const f = await fixture();

  const cases: {
    candidate: AgentPaymentIntent;
    status: number;
    code: string;
  }[] = [
    { candidate: { ...f.intent, status: "draft" }, status: 409, code: "intent_not_approved" },
    { candidate: { ...f.intent, status: "cancelled" }, status: 409, code: "intent_cancelled" },
    { candidate: { ...f.intent, status: "expired" }, status: 409, code: "intent_expired" },
    { candidate: { ...f.intent, status: "failed", failureReason: "payment_mismatch" }, status: 409, code: "intent_in_progress" },
    {
      candidate: { ...f.intent, approvalExpiresAt: new Date(NOW.getTime() - 1).toISOString() },
      status: 409,
      code: "approval_expired",
    },
    {
      candidate: { ...f.intent, approvalExpiresAt: null },
      status: 409,
      code: "approval_expired",
    },
  ];

  for (const { candidate, status, code } of cases) {
    const run = await createSubmit(f, {
      loadIntent: async () => ({ ok: true, intent: candidate }),
    });
    const response = await run.handler(
      makeRequest(SUBMIT_PATH, {
        intentId: f.intent.id,
        transaction: f.transactionBase64,
      }),
    );

    assert.equal(response.status, status, code);
    assert.equal((await response.json()).code, code);
    assert.equal(run.state.submissions.length, 0);
    assert.equal(run.state.broadcasts.length, 0);
  }
});

test("tampered amount, recipient, fee payer and extra instructions are rejected", async () => {
  const f = await fixture();

  const wrongAmount = await buildSignedTransfer({
    payer: f.merchant,
    destination: f.recipient.address,
    amount: AMOUNT + 1n,
  });
  const wrongRecipient = await buildSignedTransfer({
    payer: f.merchant,
    destination: f.attacker.address,
  });
  const wrongPayer = await buildSignedTransfer({
    payer: f.recipient,
    destination: f.recipient.address,
  });
  const extra = await buildSignedTransfer({
    payer: f.merchant,
    destination: f.recipient.address,
    extraInstruction: true,
  });

  for (const transaction of [
    wrongAmount.transactionBase64,
    wrongRecipient.transactionBase64,
    wrongPayer.transactionBase64,
    extra.transactionBase64,
    // unsigned preparation bytes
    compileAndEncode(f),
  ]) {
    const run = await createSubmit(f);
    const response = await run.handler(
      makeRequest(SUBMIT_PATH, { intentId: f.intent.id, transaction }),
    );

    assert.equal(response.status, 400);
    assert.equal(run.state.submissions.length, 0);
    assert.equal(run.state.broadcasts.length, 0);
  }
});

function compileAndEncode(f: Fixture): string {
  const message = pipe(
    createTransactionMessage({ version: "legacy" }),
    (transactionMessage) =>
      setTransactionMessageFeePayerSigner(
        createNoopSigner(f.merchant.address),
        transactionMessage,
      ),
    (transactionMessage) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: BLOCKHASH as Parameters<
            typeof setTransactionMessageLifetimeUsingBlockhash
          >[0]["blockhash"],
          lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
        },
        transactionMessage,
      ),
    (transactionMessage) =>
      appendTransactionMessageInstruction(
        getTransferSolInstruction({
          source: createNoopSigner(f.merchant.address),
          destination: f.recipient.address,
          amount: AMOUNT,
        }),
        transactionMessage,
      ),
  );

  return getBase64EncodedWireTransaction(compileTransaction(message));
}

test("the preparation must match the canonical fingerprint, wallet and approval snapshot", async () => {
  const f = await fixture();

  const missing = await createSubmit(f, {
    loadPreparation: async () => ({
      ok: false,
      code: "not_found",
      message: "missing",
    }),
  });
  assert.equal(
    (
      await missing.handler(
        makeRequest(SUBMIT_PATH, {
          intentId: f.intent.id,
          transaction: f.transactionBase64,
        }),
      )
    ).status,
    409,
  );

  const variants: Partial<AgentPaymentIntentPreparation>[] = [
    { canonicalFingerprint: "d".repeat(64) },
    { blockhash: "So11111111111111111111111111111111111111112" },
    { merchantWallet: f.attacker.address },
    { intentNonce: "cd".repeat(16) },
    { lastValidBlockHeight: "300000001" },
    { approvalExpiresAt: new Date(NOW.getTime() + 9 * 60 * 1000).toISOString() },
  ];

  for (const variant of variants) {
    const run = await createSubmit(f, {
      loadPreparation: async () => ({
        ok: true,
        preparation: { ...f.preparation, ...variant },
      }),
    });
    const response = await run.handler(
      makeRequest(SUBMIT_PATH, {
        intentId: f.intent.id,
        transaction: f.transactionBase64,
      }),
    );

    assert.equal(response.status, 409, JSON.stringify(variant));
    assert.equal(run.state.submissions.length, 0);
  }

  // The raw compiled-message hash is audit evidence only: a different hash no
  // longer rejects an otherwise correct payment.
  const auditOnly = await createSubmit(f, {
    loadPreparation: async () => ({
      ok: true,
      preparation: { ...f.preparation, messageHash: "d".repeat(64) },
    }),
  });
  assert.equal(
    (
      await auditOnly.handler(
        makeRequest(SUBMIT_PATH, {
          intentId: f.intent.id,
          transaction: f.transactionBase64,
        }),
      )
    ).status,
    200,
  );

  // The lookup is keyed by the intent and the transaction's blockhash.
  const lookup = await createSubmit(f);
  await lookup.handler(
    makeRequest(SUBMIT_PATH, {
      intentId: f.intent.id,
      transaction: f.transactionBase64,
    }),
  );
  assert.deepEqual(lookup.state.preparationLoads, [
    { intentId: f.intent.id, blockhash: BLOCKHASH },
  ]);
});

test("an expired blockhash is refused before recording or broadcasting", async () => {
  const f = await fixture();
  const run = await createSubmit(f, {
    checkBlockhash: async () => false,
  });

  const response = await run.handler(
    makeRequest(SUBMIT_PATH, {
      intentId: f.intent.id,
      transaction: f.transactionBase64,
    }),
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "blockhash_expired");
  assert.equal(run.state.submissions.length, 0);
  assert.equal(run.state.broadcasts.length, 0);
});

test("a wrong network or unavailable RPC is refused before recording", async () => {
  const f = await fixture();

  const wrongNetwork = await createSubmit(f, {
    checkNetwork: async () => false,
  });
  assert.equal(
    (
      await wrongNetwork.handler(
        makeRequest(SUBMIT_PATH, {
          intentId: f.intent.id,
          transaction: f.transactionBase64,
        }),
      )
    ).status,
    502,
  );

  const lifetimeFailure = await createSubmit(f, {
    checkBlockhash: async () => {
      throw new Error("rpc down");
    },
  });
  assert.equal(
    (
      await lifetimeFailure.handler(
        makeRequest(SUBMIT_PATH, {
          intentId: f.intent.id,
          transaction: f.transactionBase64,
        }),
      )
    ).status,
    503,
  );

  assert.equal(wrongNetwork.state.submissions.length, 0);
  assert.equal(lifetimeFailure.state.submissions.length, 0);
});

test("a database failure before broadcast never reaches the broadcaster", async () => {
  const f = await fixture();
  const run = await createSubmit(f, {
    submitIntent: async () => ({
      ok: false,
      code: "unavailable",
      message: "db down",
    }),
  });

  const response = await run.handler(
    makeRequest(SUBMIT_PATH, {
      intentId: f.intent.id,
      transaction: f.transactionBase64,
    }),
  );

  assert.equal(response.status, 503);
  assert.equal(run.state.broadcasts.length, 0);
});

test("submit RPC rejections map to stable codes", async () => {
  const f = await fixture();

  const cases = [
    { outcome: "signature_conflict", status: 409 },
    { outcome: "approval_expired", status: 409 },
    { outcome: "already_verified", status: 409 },
    { outcome: "not_approved", status: 409 },
    { outcome: "unknown", status: 404 },
    { outcome: "wrong_merchant", status: 404 },
    { outcome: "invalid_status", status: 409 },
  ] as const;

  for (const { outcome, status } of cases) {
    const run = await createSubmit(f, {
      submitIntent: async () => ({
        ok: false,
        code: "rejected",
        outcome,
        message: "rejected",
      }),
    });

    const response = await run.handler(
      makeRequest(SUBMIT_PATH, {
        intentId: f.intent.id,
        transaction: f.transactionBase64,
      }),
    );

    assert.equal(response.status, status, outcome);
    assert.equal(run.state.broadcasts.length, 0);
  }
});

test("a broadcast timeout keeps the submitted state and suggests reconciliation", async () => {
  const f = await fixture();
  const run = await createSubmit(f, {
    broadcast: async () => {
      throw new Error("timeout");
    },
  });

  const response = await run.handler(
    makeRequest(SUBMIT_PATH, {
      intentId: f.intent.id,
      transaction: f.transactionBase64,
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "submitted");
  assert.equal(body.broadcast, "unknown");
  assert.match(body.message, /do not sign a new transaction/i);
  assert.equal(run.state.submissions.length, 1);
});

test("a broadcast signature mismatch is not reported as success", async () => {
  const f = await fixture();
  const run = await createSubmit(f, {
    broadcast: async () => `${"1".repeat(63)}2`,
  });

  const response = await run.handler(
    makeRequest(SUBMIT_PATH, {
      intentId: f.intent.id,
      transaction: f.transactionBase64,
    }),
  );
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.code, "broadcast_mismatch");
  assert.equal(body.status, "submitted");
  assert.equal(body.signature, f.signature);
});

test("resubmitting the same signature is idempotent and never replaces the transaction", async () => {
  const f = await fixture();
  const submitted = submittedIntent(
    { ...f.intent, transactionBase64: f.transactionBase64 },
    f.signature,
  );

  const same = await createSubmit(f, {
    loadIntent: async () => ({ ok: true, intent: submitted }),
  });
  const sameResponse = await same.handler(
    makeRequest(SUBMIT_PATH, {
      intentId: f.intent.id,
      transaction: f.transactionBase64,
    }),
  );
  const sameBody = await sameResponse.json();

  assert.equal(sameResponse.status, 200);
  assert.equal(sameBody.outcome, "already_submitted");
  assert.equal(same.state.submissions.length, 0);
  assert.deepEqual(same.state.broadcasts, [f.transactionBase64]);

  const other = await buildSignedTransfer({
    payer: f.merchant,
    destination: f.recipient.address,
    amount: AMOUNT,
    blockhash: "So11111111111111111111111111111111111111112",
  });

  assert.notEqual(other.signature, f.signature);

  const conflict = await createSubmit(f, {
    loadIntent: async () => ({ ok: true, intent: submitted }),
  });
  const conflictResponse = await conflict.handler(
    makeRequest(SUBMIT_PATH, {
      intentId: f.intent.id,
      transaction: other.transactionBase64,
    }),
  );

  assert.equal(conflictResponse.status, 409);
  assert.equal((await conflictResponse.json()).code, "signature_conflict");
  assert.equal(conflict.state.broadcasts.length, 0);
});

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

const VERIFIED_INTENT: AgentPaymentIntent = {
  id: "AI-12345678",
  merchantWallet: "11111111111111111111111111111111",
  status: "verified",
  recipientAddress: "11111111111111111111111111111111",
  amountLamports: "1500000000",
  purpose: "Logo design",
  reference: REFERENCE,
  sourceKind: "address",
  sourcePaymentRequestReference: null,
  nonce: NONCE,
  intentFingerprint: FINGERPRINT,
  transactionSignature: "1".repeat(64),
  transactionBase64: null,
  payerAddress: "11111111111111111111111111111111",
  verifiedAt: NOW.toISOString(),
  expiresAt: EXPIRES_AT,
  createdAt: NOW.toISOString(),
  approvedAt: APPROVED_AT,
  approvalExpiresAt: APPROVAL_EXPIRES_AT,
  submittedAt: NOW.toISOString(),
  failureReason: null,
};

async function createVerify(
  overrides: Partial<IntentVerifyDependencies> = {},
) {
  const f = await fixture();
  const submitted = submittedIntent(
    { ...f.intent, transactionBase64: f.transactionBase64 },
    f.signature,
  );
  const state = {
    verifies: [] as {
      nonce: string;
      merchantWallet: string;
      signature: string;
      payerAddress: string;
    }[],
    failures: [] as {
      nonce: string;
      merchantWallet: string;
      signature: string;
      reason: string;
    }[],
  };

  const handler = createIntentVerifyPostHandler({
    resolveMerchant: async () => f.merchant.address,
    checkRateLimit: async () => ({ ok: true }),
    checkNetwork: async () => true,
    loadIntent: async () => ({ ok: true, intent: submitted }),
    verifyOnChain: async () => ({ status: "pending", message: "waiting" }),
    verifyIntent: async (input) => {
      state.verifies.push(input);
      return {
        ok: true,
        outcome: "verified",
        intent: {
          ...submitted,
          status: "verified",
          verifiedAt: NOW.toISOString(),
        },
      };
    },
    failIntent: async (input) => {
      state.failures.push(input);
      return {
        ok: true,
        outcome: "failed",
        intent: {
          ...submitted,
          status: "failed",
          failureReason: input.reason,
        },
      };
    },
    now: () => NOW,
    ...overrides,
  });

  return { handler, state, f };
}

test("a pending on-chain result changes nothing", async () => {
  const run = await createVerify();
  const response = await run.handler(
    makeRequest(VERIFY_PATH, { intentId: "AI-12345678" }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "pending");
  assert.equal(body.signature, run.f.signature);
  assert.equal(run.state.verifies.length, 0);
  assert.equal(run.state.failures.length, 0);
});

test("only a successful on-chain match reaches the verify RPC", async () => {
  const run = await createVerify({
    verifyOnChain: async () => ({
      status: "verified",
      payerAddress: run.f.merchant.address,
      commitment: "confirmed",
    }),
  });

  const response = await run.handler(
    makeRequest(VERIFY_PATH, { intentId: "AI-12345678" }),
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, "verified");
  assert.equal(body.verifiedAt, NOW.toISOString());
  assert.deepEqual(run.state.verifies, [
    {
      nonce: run.f.intent.nonce,
      merchantWallet: run.f.merchant.address,
      signature: run.f.signature,
      payerAddress: run.f.merchant.address,
    },
  ]);
  assert.equal(run.state.failures.length, 0);
});

test("definitive on-chain failures use the permitted failure reasons", async () => {
  for (const [reason, expected] of [
    ["onchain_transaction_failed", "onchain_transaction_failed"],
    ["payment_mismatch", "payment_mismatch"],
  ] as const) {
    const run = await createVerify({
      verifyOnChain: async () => ({
        status: "failed",
        reason,
        message: "failed",
      }),
    });

    const response = await run.handler(
      makeRequest(VERIFY_PATH, { intentId: "AI-12345678" }),
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "failed");
    assert.equal(body.failureReason, expected);
    assert.deepEqual(run.state.failures, [
      {
        nonce: run.f.intent.nonce,
        merchantWallet: run.f.merchant.address,
        signature: run.f.signature,
        reason,
      },
    ]);
    assert.equal(run.state.verifies.length, 0);
  }
});

test("verification never fails a payment on RPC or network trouble", async () => {
  const f = await fixture();

  const unknown = await createVerify({
    verifyOnChain: async () => {
      throw new Error("rpc down");
    },
  });
  assert.equal(
    (
      await unknown.handler(
        makeRequest(VERIFY_PATH, { intentId: "AI-12345678" }),
      )
    ).status,
    503,
  );
  assert.equal(unknown.state.failures.length, 0);

  const offline = await createVerify({
    checkNetwork: async () => false,
  });
  assert.equal(
    (
      await offline.handler(
        makeRequest(VERIFY_PATH, { intentId: "AI-12345678" }),
      )
    ).status,
    502,
  );
  assert.equal(offline.state.failures.length, 0);

  const failedWrite = await createVerify({
    verifyOnChain: async () => ({
      status: "failed",
      reason: "onchain_transaction_failed",
      message: "failed",
    }),
    failIntent: async () => ({
      ok: false,
      code: "unavailable",
      message: "db down",
    }),
  });
  assert.equal(
    (
      await failedWrite.handler(
        makeRequest(VERIFY_PATH, { intentId: "AI-12345678" }),
      )
    ).status,
    503,
  );
  assert.equal(f.intent.status, "approved");
});

test("verified and failed intents are read idempotently without a chain call", async () => {
  const f = await fixture();

  let chainCalls = 0;

  const verified = await createVerify({
    loadIntent: async () => ({
      ok: true,
      intent: { ...VERIFIED_INTENT, merchantWallet: f.merchant.address },
    }),
    verifyOnChain: async () => {
      chainCalls += 1;
      return { status: "pending", message: "x" };
    },
  });

  const verifiedResponse = await verified.handler(
    makeRequest(VERIFY_PATH, { intentId: "AI-12345678" }),
  );
  const verifiedBody = await verifiedResponse.json();

  assert.equal(verifiedResponse.status, 200);
  assert.equal(verifiedBody.status, "verified");
  assert.equal(verified.state.verifies.length, 0);

  const failed = await createVerify({
    loadIntent: async () => ({
      ok: true,
      intent: {
        ...submittedIntent(
    { ...f.intent, transactionBase64: f.transactionBase64 },
    f.signature,
  ),
        status: "failed",
        failureReason: "onchain_transaction_failed",
      },
    }),
  });

  const failedResponse = await failed.handler(
    makeRequest(VERIFY_PATH, { intentId: "AI-12345678" }),
  );

  assert.equal(failedResponse.status, 200);
  assert.equal((await failedResponse.json()).status, "failed");
  assert.equal(chainCalls, 0);
});

test("verification requires a submitted intent", async () => {
  const f = await fixture();
  const run = await createVerify({
    loadIntent: async () => ({ ok: true, intent: f.intent }),
  });

  const response = await run.handler(
    makeRequest(VERIFY_PATH, { intentId: "AI-12345678" }),
  );

  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "intent_not_submitted");
  assert.equal(run.state.verifies.length, 0);
});

test("verification ignores client-supplied signatures and payers", async () => {
  const run = await createVerify({
    verifyOnChain: async (input) => {
      assert.deepEqual(input.expected, {
        signature: run.f.signature,
        merchantWallet: run.f.merchant.address,
        recipientAddress: run.f.recipient.address,
        amountLamports: "1500000000",
      });
      return { status: "pending", message: "waiting" };
    },
  });

  await run.handler(
    makeRequest(VERIFY_PATH, {
      intentId: "AI-12345678",
      signature: "1".repeat(64),
      payerAddress: run.f.attacker.address,
      status: "verified",
    }),
  );
});

test("client parsers never promote submission or pending to success", () => {
  const signature = "1".repeat(64);

  const submitted = parseIntentSubmitResponse({
    status: "submitted",
    outcome: "submitted",
    intentId: "AI-12345678",
    signature,
    cluster: "devnet",
    submittedAt: new Date().toISOString(),
    broadcast: "accepted",
  });

  assert.equal(submitted.ok, true);
  if (submitted.ok) {
    assert.equal(submitted.submission.status, "submitted");
    assert.equal(submitted.submission.outcome, "submitted");
  }

  for (const variant of [
    {
      status: "verified",
      intentId: "AI-12345678",
      signature,
      cluster: "devnet",
    },
    {
      status: "submitted",
      outcome: "submitted",
      intentId: "AI-12345678",
      signature: "not-a-signature",
      cluster: "devnet",
      submittedAt: null,
      broadcast: "accepted",
    },
    {
      status: "submitted",
      outcome: "submitted",
      intentId: "AI-12345678",
      signature,
      cluster: "mainnet",
      submittedAt: null,
      broadcast: "accepted",
    },
    {
      status: "submitted",
      outcome: "submitted",
      intentId: "AI-12345678",
      signature,
      cluster: "devnet",
      submittedAt: null,
      broadcast: "maybe",
    },
  ]) {
    assert.equal(parseIntentSubmitResponse(variant).ok, false);
  }

  const pending = parseIntentVerifyResponse({
    status: "pending",
    intentId: "AI-12345678",
    signature,
    cluster: "devnet",
    message: "waiting",
  });

  assert.equal(pending.ok, true);
  if (pending.ok) assert.equal(pending.verification.status, "pending");

  const verified = parseIntentVerifyResponse({
    status: "verified",
    intentId: "AI-12345678",
    signature,
    cluster: "devnet",
    verifiedAt: new Date().toISOString(),
    payerAddress: "So11111111111111111111111111111111111111112",
  });

  assert.equal(verified.ok, true);
  if (verified.ok) assert.equal(verified.verification.status, "verified");

  for (const variant of [
    {
      status: "verified",
      intentId: "AI-12345678",
      signature,
      cluster: "devnet",
      verifiedAt: null,
    },
    {
      status: "failed",
      intentId: "AI-12345678",
      signature,
      cluster: "devnet",
      failureReason: null,
    },
    {
      status: "submitted",
      intentId: "AI-12345678",
      signature,
      cluster: "devnet",
    },
  ]) {
    assert.equal(parseIntentVerifyResponse(variant).ok, false);
  }
});

test("the execution endpoints never sign and verification is not capability-gated", () => {
  const submit = readFileSync(
    new URL("../src/lib/ai/intent-submit-handler.ts", import.meta.url),
    "utf8",
  );
  const verify = readFileSync(
    new URL("../src/lib/ai/intent-verify-handler.ts", import.meta.url),
    "utf8",
  );
  const prepare = readFileSync(
    new URL("../src/lib/ai/intent-prepare-handler.ts", import.meta.url),
    "utf8",
  );

  for (const source of [submit, verify, prepare]) {
    assert.doesNotMatch(source, /signTransaction|Keypair|privateKey/);
  }

  assert.doesNotMatch(prepare, /sendTransaction|broadcast/);
  assert.doesNotMatch(verify, /sendTransaction|broadcast/);
  assert.match(submit, /broadcast/);
  assert.doesNotMatch(verify, /agenticPaymentsGate|checkCapability/);
});
