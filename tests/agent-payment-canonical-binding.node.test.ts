import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import {
  generateKeyPairSigner,
  getAddressEncoder,
  getBase58Decoder,
  getBase64Decoder,
  getBase64Encoder,
  getBlockhashEncoder,
  getShortU16Encoder,
  getU64Encoder,
  signBytes,
  type Address,
  type Blockhash,
  type KeyPairSigner,
} from "@solana/kit";

import {
  createIntentSubmitPostHandler,
  type IntentSubmitDiagnostics,
  type IntentSubmitDependencies,
} from "../src/lib/ai/intent-submit-handler.ts";
import { inspectSignedAgentTransferTransaction } from "../src/lib/solana/agent-submission.ts";
import {
  SYSTEM_PROGRAM_ADDRESS,
  canonicalAgentPaymentFingerprint,
  canonicalAgentPaymentInputFromInspection,
} from "../src/lib/solana/agent-payment.ts";
import type {
  AgentPaymentIntent,
  AgentPaymentIntentPreparation,
} from "../src/lib/ai/intent-registry.ts";

/**
 * Stage 4 Step 3 regression: canonical semantic binding.
 *
 * The wire fixtures are hand-encoded rather than produced by the transaction
 * builder, because the bug only appears when a wallet reserializes the same
 * payment with account keys in a different order. The real keypairs sign the
 * real message bytes, so Ed25519 verification is genuinely exercised; no
 * network call, database or Devnet payment happens anywhere in this file.
 */

const BLOCKHASH = "11111111111111111111111111111111";
const OTHER_BLOCKHASH = getBase58Decoder().decode(
  new Uint8Array(32).fill(1),
) as string;
const LAST_VALID_BLOCK_HEIGHT = 300_000_000n;
const AMOUNT = 1_500_000_000n;
const NONCE = "ab".repeat(16);
const INTENT_FINGERPRINT = "c".repeat(64);
const REFERENCE = "11111111111111111111111111111111";
const NOW = new Date("2026-11-27T10:00:00.000Z");
const APPROVED_AT = NOW.toISOString();
const EXPIRES_AT = new Date(NOW.getTime() + 10 * 60 * 1000).toISOString();
const APPROVAL_EXPIRES_AT = new Date(
  NOW.getTime() + 5 * 60 * 1000,
).toISOString();

const SUBMIT_PATH = "/api/ai/payment-intents/submit";

/* -------------------------------------------------------------------------- */
/* Hand-encoded legacy wire format                                            */
/* -------------------------------------------------------------------------- */

type WireInstruction = {
  programIndex: number;
  accountIndices: number[];
  data: Uint8Array;
};

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

function shortVec(value: number): Uint8Array {
  return Uint8Array.from(getShortU16Encoder().encode(value));
}

function transferData(amountLamports: bigint): Uint8Array {
  // System Program `Transfer`: u32 instruction discriminator 2, u64 lamports.
  return concat([
    Uint8Array.of(2, 0, 0, 0),
    Uint8Array.from(getU64Encoder().encode(amountLamports)),
  ]);
}

/** Encodes a message exactly as it appears inside a signed transaction. */
function encodeMessage(input: {
  version?: 0;
  numRequiredSignatures: number;
  numReadonlyUnsigned: number;
  accountKeys: string[];
  blockhash: string;
  instructions: WireInstruction[];
  lookups?: { table: string; writable: number[]; readonly: number[] }[];
}): Uint8Array {
  const parts: Uint8Array[] = [];

  if (input.version === 0) parts.push(Uint8Array.of(0x80));

  parts.push(
    Uint8Array.of(
      input.numRequiredSignatures,
      0,
      input.numReadonlyUnsigned,
    ),
  );

  parts.push(shortVec(input.accountKeys.length));
  for (const key of input.accountKeys) {
    parts.push(Uint8Array.from(getAddressEncoder().encode(key as Address)));
  }

  parts.push(
    Uint8Array.from(
      getBlockhashEncoder().encode(input.blockhash as Blockhash),
    ),
  );

  parts.push(shortVec(input.instructions.length));
  for (const instruction of input.instructions) {
    parts.push(Uint8Array.of(instruction.programIndex));
    parts.push(shortVec(instruction.accountIndices.length));
    parts.push(Uint8Array.from(instruction.accountIndices));
    parts.push(shortVec(instruction.data.length));
    parts.push(instruction.data);
  }

  if (input.version === 0) {
    const lookups = input.lookups ?? [];
    parts.push(shortVec(lookups.length));

    for (const lookup of lookups) {
      parts.push(
        Uint8Array.from(getAddressEncoder().encode(lookup.table as Address)),
      );
      parts.push(shortVec(lookup.writable.length));
      parts.push(Uint8Array.from(lookup.writable));
      parts.push(shortVec(lookup.readonly.length));
      parts.push(Uint8Array.from(lookup.readonly));
    }
  }

  return concat(parts);
}

/** Signs a message with one or more keypair signers and encodes the envelope. */
async function signAndEncode(
  signers: KeyPairSigner[],
  message: Uint8Array,
): Promise<{ transactionBase64: string; signature: string }> {
  const signatures: Uint8Array[] = [];

  for (const signer of signers) {
    signatures.push(await signBytes(signer.keyPair.privateKey, message));
  }

  const transaction = concat([shortVec(signatures.length), ...signatures, message]);

  return {
    transactionBase64: getBase64Decoder().decode(transaction),
    signature: getBase58Decoder().decode(signatures[0]),
  };
}

type WireVariant =
  | "prepared"
  | "reordered"
  | "extra-instruction"
  | "foreign-instruction"
  | "extra-account"
  | "extra-signer"
  | "versioned"
  | "lookup-table";

/**
 * Builds one signed transfer. `prepared` is the order the server's builder
 * emits; `reordered` is what a wallet produced in the diagnostic report:
 * `[feePayer, System Program, recipient]` with the same instruction semantics.
 */
async function wireTransfer(input: {
  payer: KeyPairSigner;
  recipient: string;
  amount?: bigint;
  blockhash?: string;
  variant?: WireVariant;
  extraSigner?: KeyPairSigner;
  extraAccount?: string;
}): Promise<{ transactionBase64: string; signature: string }> {
  const variant = input.variant ?? "prepared";
  const amount = input.amount ?? AMOUNT;
  const blockhash = input.blockhash ?? BLOCKHASH;
  const extraAccount =
    input.extraAccount ?? "So11111111111111111111111111111111111111112";

  if (variant === "foreign-instruction") {
    // A second instruction whose program is not the System Program. It never
    // reaches the payment comparison: wire inspection names it as unexpected.
    const message = encodeMessage({
      numRequiredSignatures: 1,
      numReadonlyUnsigned: 1,
      accountKeys: [input.payer.address, input.recipient, SYSTEM_PROGRAM_ADDRESS],
      blockhash,
      instructions: [
        {
          programIndex: 2,
          accountIndices: [0, 1],
          data: transferData(amount),
        },
        { programIndex: 1, accountIndices: [], data: new Uint8Array() },
      ],
    });

    return signAndEncode([input.payer], message);
  }

  if (variant === "versioned" || variant === "lookup-table") {
    const message = encodeMessage({
      version: 0,
      numRequiredSignatures: 1,
      numReadonlyUnsigned: 1,
      accountKeys: [input.payer.address, input.recipient, SYSTEM_PROGRAM_ADDRESS],
      blockhash,
      instructions: [
        {
          programIndex: 2,
          accountIndices: [0, 1],
          data: transferData(amount),
        },
      ],
      lookups:
        variant === "lookup-table"
          ? [
              {
                table: "So11111111111111111111111111111111111111112",
                writable: [0],
                readonly: [],
              },
            ]
          : [],
    });

    return signAndEncode([input.payer], message);
  }

  if (variant === "extra-signer") {
    assert.ok(input.extraSigner);
    const message = encodeMessage({
      numRequiredSignatures: 2,
      numReadonlyUnsigned: 1,
      accountKeys: [
        input.payer.address,
        input.extraSigner.address,
        input.recipient,
        SYSTEM_PROGRAM_ADDRESS,
      ],
      blockhash,
      instructions: [
        {
          programIndex: 3,
          accountIndices: [0, 2],
          data: transferData(amount),
        },
      ],
    });

    return signAndEncode([input.payer, input.extraSigner], message);
  }

  if (variant === "extra-account") {
    const message = encodeMessage({
      numRequiredSignatures: 1,
      numReadonlyUnsigned: 1,
      accountKeys: [
        input.payer.address,
        input.recipient,
        extraAccount,
        SYSTEM_PROGRAM_ADDRESS,
      ],
      blockhash,
      instructions: [
        {
          programIndex: 3,
          accountIndices: [0, 1],
          data: transferData(amount),
        },
      ],
    });

    return signAndEncode([input.payer], message);
  }

  const reordered = variant === "reordered";
  const accountKeys = reordered
    ? [input.payer.address, SYSTEM_PROGRAM_ADDRESS, input.recipient]
    : [input.payer.address, input.recipient, SYSTEM_PROGRAM_ADDRESS];

  const instructions: WireInstruction[] = [
    {
      programIndex: reordered ? 1 : 2,
      accountIndices: reordered ? [0, 2] : [0, 1],
      data: transferData(amount),
    },
  ];

  if (variant === "extra-instruction") {
    instructions.push({
      programIndex: reordered ? 1 : 2,
      accountIndices: reordered ? [0, 2] : [0, 1],
      data: transferData(1n),
    });
  }

  const message = encodeMessage({
    numRequiredSignatures: 1,
    numReadonlyUnsigned: 1,
    accountKeys,
    blockhash,
    instructions,
  });

  return signAndEncode([input.payer], message);
}

/* -------------------------------------------------------------------------- */
/* Submit endpoint harness                                                    */
/* -------------------------------------------------------------------------- */

type Fixture = {
  merchant: KeyPairSigner;
  recipient: KeyPairSigner;
  attacker: KeyPairSigner;
  prepared: { transactionBase64: string; signature: string };
  transactionBase64: string;
  signature: string;
  intent: AgentPaymentIntent;
  preparation: AgentPaymentIntentPreparation;
  canonicalFingerprint: string;
};

async function fixture(): Promise<Fixture> {
  const merchant = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();
  const attacker = await generateKeyPairSigner();

  const prepared = await wireTransfer({
    payer: merchant,
    recipient: recipient.address,
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
    intentFingerprint: INTENT_FINGERPRINT,
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

  // The fingerprint persisted at preparation time, derived from the transaction
  // the server built and the authoritative intent.
  const canonicalFingerprint = canonicalAgentPaymentFingerprint(
    canonicalAgentPaymentInputFromInspection({
      inspection: inspectSignedAgentTransferTransaction(prepared.transactionBase64)
        .inspection,
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
    prepared,
    transactionBase64: prepared.transactionBase64,
    signature: prepared.signature,
    intent,
    canonicalFingerprint,
    preparation: {
      intentId: intent.id,
      intentNonce: intent.nonce,
      merchantWallet: merchant.address,
      messageHash: "d".repeat(64),
      canonicalFingerprint,
      blockhash: BLOCKHASH,
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT.toString(),
      approvalExpiresAt: APPROVAL_EXPIRES_AT,
      createdAt: NOW.toISOString(),
    },
  };
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(`http://localhost${SUBMIT_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

type SubmitState = {
  lookups: { intentId: string; blockhash: string }[];
  submissions: { signature: string; payerAddress: string }[];
  broadcasts: string[];
  diagnostics: IntentSubmitDiagnostics[];
};

async function submit(
  f: Fixture,
  input: {
    transaction?: string;
    overrides?: Partial<IntentSubmitDependencies>;
  } = {},
): Promise<{ state: SubmitState; status: number; body: Record<string, unknown> }> {
  const state: SubmitState = {
    lookups: [],
    submissions: [],
    broadcasts: [],
    diagnostics: [],
  };
  let submittedSignature: string | null = null;
  let submittedTransaction: string | null = null;
  const broadcastRecords: { outcome: "accepted" | "unknown" }[] = [];

  const handler = createIntentSubmitPostHandler({
    resolveMerchant: async () => f.merchant.address,
    checkRateLimit: async () => ({ ok: true }),
    checkCapability: async () => ({ ok: true }),
    checkNetwork: async () => true,
    checkBlockhash: async () => true,
    loadIntent: async () => ({ ok: true, intent: f.intent }),
    loadPreparation: async (lookup) => {
      state.lookups.push(lookup);

      // Mirrors the database: the preparation is keyed by intent + blockhash.
      return lookup.intentId === f.preparation.intentId &&
        lookup.blockhash === f.preparation.blockhash
        ? { ok: true, preparation: f.preparation }
        : {
            ok: false,
            code: "not_found",
            message: "not found",
          };
    },
    submitIntent: async (submission) => {
      state.submissions.push(submission);
      submittedSignature = submission.signature;
      submittedTransaction = submission.transactionBase64;

      return {
        ok: true,
        outcome: "submitted",
        intent: {
          ...f.intent,
          status: "submitted",
          transactionSignature: submission.signature,
          transactionBase64: submission.transactionBase64,
          payerAddress: f.merchant.address,
          submittedAt: NOW.toISOString(),
        },
      };
    },
    generateClaimToken: () => "claim-token",
    checkStoredSignature: async () => "not_found",
    claimBroadcast: async (claim) => ({
      outcome: "claimed",
      leaseToken: claim.claimToken,
      leaseExpiresAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
      storedSignature: submittedSignature ?? f.signature,
      storedTransactionBase64: submittedTransaction ?? f.prepared.transactionBase64,
    }),
    recordBroadcast: async (record) => {
      broadcastRecords.push({ outcome: record.outcome });
      return true;
    },
    markManualReview: async () => true,
    broadcast: async (transaction) => {
      state.broadcasts.push(transaction);
      return submittedSignature ?? f.signature;
    },
    logDiagnostic: (diagnostics) => state.diagnostics.push(diagnostics),
    now: () => NOW,
    ...input.overrides,
  });

  const response = await handler(
    makeRequest({
      intentId: f.intent.id,
      transaction: input.transaction ?? f.transactionBase64,
    }),
  );

  return {
    state,
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

/* -------------------------------------------------------------------------- */
/* 1. Byte-identical prepared and signed transaction                          */
/* -------------------------------------------------------------------------- */

test("1. bytes identical to the preparation are accepted and broadcast once", async () => {
  const f = await fixture();
  const { state, status, body } = await submit(f);

  assert.equal(status, 200);
  assert.equal(body.status, "submitted");
  assert.equal(body.broadcast, "accepted");
  assert.equal(body.signature, f.signature);
  assert.deepEqual(state.broadcasts, [f.prepared.transactionBase64]);
  assert.deepEqual(state.submissions, [
    {
      nonce: f.intent.nonce,
      merchantWallet: f.merchant.address,
      signature: f.signature,
      payerAddress: f.merchant.address,
      transactionBase64: f.prepared.transactionBase64,
    },
  ]);
  assert.deepEqual(state.lookups, [
    { intentId: f.intent.id, blockhash: BLOCKHASH },
  ]);
});

/* -------------------------------------------------------------------------- */
/* 2. Wallet reordering of account keys (the reported regression)              */
/* -------------------------------------------------------------------------- */

test("2. the same payment with wallet-reordered account keys is accepted", async () => {
  const f = await fixture();
  const reordered = await wireTransfer({
    payer: f.merchant,
    recipient: f.recipient.address,
  });

  // The wallet produced a different key order and therefore different bytes.
  const preparedInspection = inspectSignedAgentTransferTransaction(
    f.prepared.transactionBase64,
  ).inspection;
  // The exact fixture shape from the diagnostic report:
  // [feePayer, System Program, recipient].
  const reorderedSigned = await wireTransfer({
    payer: f.merchant,
    recipient: f.recipient.address,
    variant: "reordered",
  });
  const reorderedInspection = inspectSignedAgentTransferTransaction(
    reorderedSigned.transactionBase64,
  ).inspection;

  assert.deepEqual(preparedInspection.accountKeys, [
    f.merchant.address,
    f.recipient.address,
    SYSTEM_PROGRAM_ADDRESS,
  ]);
  assert.deepEqual(reorderedInspection.accountKeys, [
    f.merchant.address,
    SYSTEM_PROGRAM_ADDRESS,
    f.recipient.address,
  ]);
  assert.notEqual(f.prepared.transactionBase64, reorderedSigned.transactionBase64);
  assert.notEqual(
    preparedInspection.messageHash,
    reorderedInspection.messageHash,
  );
  // ... while the payment it describes is identical.
  assert.equal(reorderedInspection.instructions[0].source, f.merchant.address);
  assert.equal(
    reorderedInspection.instructions[0].destination,
    f.recipient.address,
  );
  assert.equal(reorderedInspection.instructions[0].amountLamports, AMOUNT);

  const { status, state, body } = await submit(f, {
    transaction: reorderedSigned.transactionBase64,
  });

  assert.equal(status, 200);
  assert.equal(body.status, "submitted");
  assert.equal(body.signature, reorderedSigned.signature);
  assert.equal(state.submissions.length, 1);
  assert.equal(state.broadcasts[0], reorderedSigned.transactionBase64);
  assert.equal(state.diagnostics.length, 0);
});

/* -------------------------------------------------------------------------- */
/* 3. Different blockhash                                                     */
/* -------------------------------------------------------------------------- */

test("3. a different blockhash does not match the preparation", async () => {
  const f = await fixture();
  const other = await wireTransfer({
    payer: f.merchant,
    recipient: f.recipient.address,
    blockhash: OTHER_BLOCKHASH,
  });

  const { status, state, body } = await submit(f, {
    transaction: other.transactionBase64,
  });

  assert.equal(status, 409);
  assert.equal(body.code, "preparation_mismatch");
  assert.deepEqual(state.lookups, [
    { intentId: f.intent.id, blockhash: OTHER_BLOCKHASH },
  ]);
  assert.equal(state.submissions.length, 0);
  assert.equal(state.broadcasts.length, 0);
  assert.equal(state.diagnostics.at(-1)?.reason, "preparation_mismatch");
});

/* -------------------------------------------------------------------------- */
/* 4-6. Changed payment semantics                                             */
/* -------------------------------------------------------------------------- */

test("4. a different recipient is rejected as recipient_mismatch", async () => {
  const f = await fixture();
  const tampered = await wireTransfer({
    payer: f.merchant,
    recipient: f.attacker.address,
  });

  const { status, state, body } = await submit(f, {
    transaction: tampered.transactionBase64,
  });

  assert.equal(status, 400);
  assert.equal(body.code, "recipient_mismatch");
  assert.equal(state.submissions.length, 0);
  assert.equal(state.broadcasts.length, 0);
  assert.equal(state.diagnostics.at(-1)?.reason, "recipient_mismatch");
});

test("5. a different amount is rejected as amount_mismatch", async () => {
  const f = await fixture();
  const tampered = await wireTransfer({
    payer: f.merchant,
    recipient: f.recipient.address,
    amount: AMOUNT + 1n,
  });

  const { status, state, body } = await submit(f, {
    transaction: tampered.transactionBase64,
  });

  assert.equal(status, 400);
  assert.equal(body.code, "amount_mismatch");
  assert.equal(state.submissions.length, 0);
  assert.equal(state.broadcasts.length, 0);
});

test("6. a different fee payer is rejected as fee_payer_mismatch", async () => {
  const f = await fixture();
  const tampered = await wireTransfer({
    payer: f.attacker,
    recipient: f.recipient.address,
  });

  const { status, state, body } = await submit(f, {
    transaction: tampered.transactionBase64,
  });

  assert.equal(status, 400);
  assert.equal(body.code, "fee_payer_mismatch");
  assert.equal(state.submissions.length, 0);
  assert.equal(state.broadcasts.length, 0);
});

/* -------------------------------------------------------------------------- */
/* 7-8. Extra instruction, account, signer                                    */
/* -------------------------------------------------------------------------- */

test("7. additional instructions are rejected as unexpected_instruction", async () => {
  const f = await fixture();

  for (const variant of ["extra-instruction", "foreign-instruction"] as const) {
    const tampered = await wireTransfer({
      payer: f.merchant,
      recipient: f.recipient.address,
      variant,
    });

    const { status, state, body } = await submit(f, {
      transaction: tampered.transactionBase64,
    });

    assert.equal(status, 400, variant);
    assert.equal(body.code, "unexpected_instruction", variant);
    assert.equal(state.submissions.length, 0, variant);
    assert.equal(state.broadcasts.length, 0, variant);
  }
});

test("8a. an additional account is rejected as unexpected_account", async () => {
  const f = await fixture();
  const tampered = await wireTransfer({
    payer: f.merchant,
    recipient: f.recipient.address,
    variant: "extra-account",
    extraAccount: f.attacker.address,
  });

  const inspection = inspectSignedAgentTransferTransaction(
    tampered.transactionBase64,
  ).inspection;
  assert.equal(inspection.accountKeys.length, 4);

  const { status, state, body } = await submit(f, {
    transaction: tampered.transactionBase64,
  });

  assert.equal(status, 400);
  assert.equal(body.code, "unexpected_account");
  assert.equal(state.submissions.length, 0);
  assert.equal(state.broadcasts.length, 0);
});

test("8b. an additional signer is rejected as signer_mismatch", async () => {
  const f = await fixture();
  const tampered = await wireTransfer({
    payer: f.merchant,
    recipient: f.recipient.address,
    variant: "extra-signer",
    extraSigner: f.attacker,
  });

  // Wire-level inspection refuses a two-signer envelope before the payment is
  // compared, so the diagnostic still names the signer set.
  assert.throws(
    () => inspectSignedAgentTransferTransaction(tampered.transactionBase64),
    /one signer/,
  );

  const { status, state, body } = await submit(f, {
    transaction: tampered.transactionBase64,
  });

  assert.equal(status, 400);
  assert.equal(body.code, "signer_mismatch");
  assert.equal(state.submissions.length, 0);
  assert.equal(state.broadcasts.length, 0);
});

/* -------------------------------------------------------------------------- */
/* 9-11. Signature and transaction shape                                      */
/* -------------------------------------------------------------------------- */

test("9. an invalid Ed25519 signature is rejected as invalid_signature", async () => {
  const f = await fixture();
  const tampered = await wireTransfer({
    payer: f.merchant,
    recipient: f.recipient.address,
  });

  // Flip one byte of the 64-byte signature, keeping the envelope well-formed.
  const bytes = getBase64Encoder().encode(tampered.transactionBase64);
  const copy = Uint8Array.from(bytes);
  copy[1] ^= 0xff;

  const { status, state, body } = await submit(f, {
    transaction: getBase64Decoder().decode(copy),
  });

  assert.equal(status, 400);
  assert.equal(body.code, "invalid_signature");
  assert.equal(
    body.error,
    "The transaction signature is not valid for the approved merchant wallet. Nothing was submitted.",
  );
  assert.equal(state.submissions.length, 0);
  assert.equal(state.broadcasts.length, 0);
  assert.equal(state.diagnostics.at(-1)?.reason, "invalid_signature");
});

test("10. a versioned transaction is rejected as invalid_transaction_encoding", async () => {
  const f = await fixture();
  const tampered = await wireTransfer({
    payer: f.merchant,
    recipient: f.recipient.address,
    variant: "versioned",
  });

  const { status, state, body } = await submit(f, {
    transaction: tampered.transactionBase64,
  });

  assert.equal(status, 400);
  assert.equal(body.code, "invalid_transaction_encoding");
  assert.equal(state.submissions.length, 0);
  assert.equal(state.broadcasts.length, 0);
});

test("11. a transaction using an address lookup table is rejected", async () => {
  const f = await fixture();
  const tampered = await wireTransfer({
    payer: f.merchant,
    recipient: f.recipient.address,
    variant: "lookup-table",
  });

  const { status, state, body } = await submit(f, {
    transaction: tampered.transactionBase64,
  });

  assert.equal(status, 400);
  assert.equal(body.code, "invalid_transaction_encoding");
  assert.equal(state.submissions.length, 0);
  assert.equal(state.broadcasts.length, 0);
});

/* -------------------------------------------------------------------------- */
/* 12-13. Lifetime and approval snapshot                                      */
/* -------------------------------------------------------------------------- */

test("12. an expired blockhash is rejected before submission and broadcast", async () => {
  const f = await fixture();
  let blockhashChecks = 0;

  const { status, state, body } = await submit(f, {
    overrides: {
      checkBlockhash: async ({ blockhash, lastValidBlockHeight }) => {
        blockhashChecks += 1;
        assert.equal(blockhash, BLOCKHASH);
        assert.equal(lastValidBlockHeight, LAST_VALID_BLOCK_HEIGHT);
        return false;
      },
    },
  });

  assert.equal(blockhashChecks, 1);
  assert.equal(status, 409);
  assert.equal(body.code, "blockhash_expired");
  assert.equal(
    body.error,
    "The prepared transaction's blockhash has expired. Prepare the payment again.",
  );
  // The approval was still live (5 minutes remaining): it never substitutes for
  // blockhash validity.
  assert.ok(Date.parse(APPROVAL_EXPIRES_AT) > NOW.getTime());
  assert.equal(state.submissions.length, 0);
  assert.equal(state.broadcasts.length, 0);
  assert.equal(state.diagnostics.at(-1)?.reason, "blockhash_expired");
});

test("13. a preparation from a different approval window is rejected", async () => {
  const f = await fixture();

  const { status, state, body } = await submit(f, {
    overrides: {
      loadPreparation: async () => ({
        ok: true,
        preparation: {
          ...f.preparation,
          approvalExpiresAt: new Date(
            NOW.getTime() + 9 * 60 * 1000,
          ).toISOString(),
        },
      }),
    },
  });

  assert.equal(status, 409);
  assert.equal(body.code, "approval_snapshot_mismatch");
  assert.equal(state.submissions.length, 0);
  assert.equal(state.broadcasts.length, 0);
  assert.equal(
    state.diagnostics.at(-1)?.reason,
    "approval_snapshot_mismatch",
  );
});

/* -------------------------------------------------------------------------- */
/* 14. Same recipient and amount, different instruction or signer role        */
/* -------------------------------------------------------------------------- */

test("14. matching recipient and amount are not enough on their own", async () => {
  const f = await fixture();
  const extra = await wireTransfer({
    payer: f.merchant,
    recipient: f.recipient.address,
    variant: "extra-instruction",
  });
  const extraSigner = await wireTransfer({
    payer: f.merchant,
    recipient: f.recipient.address,
    variant: "extra-signer",
    extraSigner: f.attacker,
  });

  for (const [transaction, code] of [
    [extra.transactionBase64, "unexpected_instruction"],
    [extraSigner.transactionBase64, "signer_mismatch"],
  ] as const) {
    const { status, state, body } = await submit(f, { transaction });

    assert.equal(status, 400, code);
    assert.equal(body.code, code);
    assert.equal(state.submissions.length, 0);
    assert.equal(state.broadcasts.length, 0);
  }
});

/* -------------------------------------------------------------------------- */
/* 15. Existing retry and idempotency behaviour                               */
/* -------------------------------------------------------------------------- */

test("15. the same signature stays idempotent and a conflict still fails", async () => {
  const f = await fixture();

  const already = await submit(f, {
    overrides: {
      loadIntent: async () => ({
        ok: true,
        intent: {
          ...f.intent,
          status: "submitted",
          transactionSignature: f.signature,
          transactionBase64: f.prepared.transactionBase64,
          payerAddress: f.merchant.address,
          submittedAt: NOW.toISOString(),
        },
      }),
    },
  });

  assert.equal(already.status, 200);
  assert.equal(already.body.outcome, "already_submitted");
  assert.deepEqual(already.state.broadcasts, [f.prepared.transactionBase64]);
  assert.equal(already.state.submissions.length, 0);

  const conflict = await submit(f, {
    overrides: {
      loadIntent: async () => ({
        ok: true,
        intent: {
          ...f.intent,
          status: "submitted",
          transactionSignature: "e".repeat(64),
          transactionBase64: f.prepared.transactionBase64,
          payerAddress: f.merchant.address,
          submittedAt: NOW.toISOString(),
        },
      }),
    },
  });

  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "signature_conflict");
  assert.equal(conflict.state.broadcasts.length, 0);

  // The preparation lookup is by blockhash and re-preparing the same payment
  // under the same blockhash is still accepted.
  const fresh = await submit(f);
  assert.equal(fresh.status, 200);
  assert.deepEqual(fresh.state.lookups, [
    { intentId: f.intent.id, blockhash: BLOCKHASH },
  ]);
});

/* -------------------------------------------------------------------------- */
/* Canonical fingerprint unit guarantees                                      */
/* -------------------------------------------------------------------------- */

test("the canonical fingerprint ignores key order but not payment semantics", async () => {
  const merchant = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();
  const attacker = await generateKeyPairSigner();

  const prepared = await wireTransfer({
    payer: merchant,
    recipient: recipient.address,
  });
  const reordered = await wireTransfer({
    payer: merchant,
    recipient: recipient.address,
    variant: "reordered",
  });
  const differentAmount = await wireTransfer({
    payer: merchant,
    recipient: recipient.address,
    amount: AMOUNT + 1n,
  });
  const differentBlockhash = await wireTransfer({
    payer: merchant,
    recipient: recipient.address,
    blockhash: OTHER_BLOCKHASH,
  });

  const fingerprint = (
    transactionBase64: string,
    overrides: { recipient?: string; amount?: bigint } = {},
  ) =>
    canonicalAgentPaymentFingerprint(
      canonicalAgentPaymentInputFromInspection({
        inspection: inspectSignedAgentTransferTransaction(transactionBase64)
          .inspection,
        intentId: "AI-12345678",
        intentNonce: NONCE,
        merchantWallet: merchant.address,
        recipient: overrides.recipient ?? recipient.address,
        amountLamports: overrides.amount ?? AMOUNT,
        lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
      }),
    );

  const baseline = fingerprint(prepared.transactionBase64);

  assert.match(baseline, /^[0-9a-f]{64}$/);
  assert.equal(fingerprint(reordered.transactionBase64), baseline);
  assert.notEqual(fingerprint(differentAmount.transactionBase64), baseline);
  assert.notEqual(
    fingerprint(prepared.transactionBase64, { recipient: attacker.address }),
    baseline,
  );
  assert.notEqual(
    fingerprint(prepared.transactionBase64, { amount: AMOUNT - 1n }),
    baseline,
  );
  assert.notEqual(fingerprint(differentBlockhash.transactionBase64), baseline);

  // Deterministic across calls, independent of intent id whitespace.
  assert.equal(fingerprint(prepared.transactionBase64), baseline);
});
