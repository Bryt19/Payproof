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
  getTransactionDecoder,
  getU64Encoder,
  getBase64EncodedWireTransaction,
  signBytes,
  signTransactionWithSigners,
  type Address,
  type Blockhash,
  type KeyPairSigner,
  type Transaction,
  type TransactionSigner,
} from "@solana/kit";

import {
  createIntentSubmitPostHandler,
  type IntentSubmitDiagnostics,
  type IntentSubmitDependencies,
} from "../src/lib/ai/intent-submit-handler.ts";
import {
  canonicalAgentPaymentFingerprint,
  canonicalAgentPaymentInputFromInspection,
  prepareAgentTransfer,
  type AgentTransferIntent,
} from "../src/lib/solana/agent-payment.ts";
import {
  SYSTEM_PROGRAM_ADDRESS,
  inspectAgentTransferMessage,
} from "../src/lib/solana/agent-payment-canonical.ts";
import { inspectSignedAgentTransferTransaction } from "../src/lib/solana/agent-submission.ts";
import {
  buildAgentSigningDiagnostic,
  describeAgentSigningMessage,
  diffAgentSigningMessages,
  logAgentSigningDiagnostic,
} from "../src/lib/wallet/agent-signing-diagnostics.ts";
import {
  AGENT_WALLET_MODIFIED_TRANSACTION_CODE,
  AGENT_WALLET_MODIFIED_TRANSACTION_MESSAGE,
  AgentWalletModifiedTransactionError,
  isAgentWalletModifiedTransactionError,
  signPreparedAgentTransaction,
} from "../src/lib/wallet/agent-signing.ts";
import type {
  AgentPaymentIntent,
  AgentPaymentIntentPreparation,
} from "../src/lib/ai/intent-registry.ts";

/**
 * Stage 4: the wallet may not change the payment.
 *
 * Every fixture in this file uses a Wallet Standard-shaped signer: an object
 * with `address` and `modifyAndSignTransactions` and **no** `signTransactions`,
 * which is exactly what `@solana/kit-plugin-wallet` builds from a connected
 * Phantom account. Generated keypair signers cannot reproduce the real path
 * because they are partial signers, so the modifying branch would never run.
 *
 * No network call, database write or Devnet payment happens here.
 */

const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const BLOCKHASH = "11111111111111111111111111111111";
const OTHER_BLOCKHASH = getBase58Decoder().decode(
  new Uint8Array(32).fill(2),
) as string;
const LAST_VALID_BLOCK_HEIGHT = 300_000_000n;
const AMOUNT = 1_000_000_000n;
const NONCE = "ab".repeat(16);

const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

const NOW = new Date("2026-11-27T10:00:00.000Z");
const APPROVAL_EXPIRES_AT = new Date(NOW.getTime() + 5 * 60 * 1000).toISOString();

const SUBMIT_PATH = "/api/ai/payment-intents/submit";

/* -------------------------------------------------------------------------- */
/* Fake Devnet RPC (no network)                                               */
/* -------------------------------------------------------------------------- */

function fakeRpc() {
  return {
    getGenesisHash: async () => DEVNET_GENESIS_HASH,
    getLatestBlockhash: async () => ({
      blockhash: BLOCKHASH,
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
    }),
  };
}

/** Builds the same unsigned transfer the server issues for an approved intent. */
async function preparedFixture(overrides: { amount?: bigint } = {}) {
  const merchant = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();

  const intent: AgentTransferIntent = {
    id: "AI-12345678",
    nonce: NONCE,
    merchantWallet: merchant.address,
    recipientAddress: recipient.address,
    amountLamports: (overrides.amount ?? AMOUNT).toString(),
  };

  const prepared = await prepareAgentTransfer({ intent, rpc: fakeRpc() });

  return { merchant, recipient, intent, prepared };
}

/* -------------------------------------------------------------------------- */
/* Wallet Standard-shaped signer                                              */
/* -------------------------------------------------------------------------- */

/**
 * Binds a wallet-standard signer to one keypair, the way the plugin binds a
 * signer to the connected account. Only `modifyAndSignTransactions` is exposed:
 * that is exactly what `createSignerFromWalletAccount` installs.
 */
async function walletFor(
  keypair: KeyPairSigner,
  mutate?: (transaction: Transaction) => Transaction | Promise<Transaction>,
) {
  const raw = {
    address: keypair.address,
    modifyAndSignTransactions: async (transactions: readonly Transaction[]) =>
      Promise.all(
        transactions.map((transaction) =>
          mutate
            ? mutate(transaction)
            : // Default: a real partial signature over the exact message bytes.
              signTransactionWithSigners([keypair], transaction),
        ),
      ),
  };

  return { keypair, signer: raw as unknown as TransactionSigner, raw };
}

/* -------------------------------------------------------------------------- */
/* Hand-encoded legacy wire format                                            */
/* -------------------------------------------------------------------------- */

type WireInstruction = {
  programIndex: number;
  accountIndices: number[];
  data: Uint8Array;
};

const DUMMY_SIGNATURE = new Uint8Array(64).fill(7);

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
  return concat([
    Uint8Array.of(2, 0, 0, 0),
    Uint8Array.from(getU64Encoder().encode(amountLamports)),
  ]);
}

function encodeMessage(input: {
  version?: 0;
  numRequiredSignatures: number;
  numReadonlyUnsigned: number;
  accountKeys: string[];
  blockhash: string;
  instructions: WireInstruction[];
}): Uint8Array {
  const parts: Uint8Array[] = [];

  if (input.version === 0) parts.push(Uint8Array.of(0x80));

  parts.push(
    Uint8Array.of(input.numRequiredSignatures, 0, input.numReadonlyUnsigned),
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

  if (input.version === 0) parts.push(shortVec(0));

  return concat(parts);
}

/** A structurally signed transaction (dummy signatures, never broadcast). */
function wireTransaction(input: {
  version?: 0;
  numRequiredSignatures: number;
  numReadonlyUnsigned: number;
  accountKeys: string[];
  blockhash: string;
  instructions: WireInstruction[];
}): Transaction {
  const parts: Uint8Array[] = [shortVec(input.numRequiredSignatures)];

  for (let index = 0; index < input.numRequiredSignatures; index += 1) {
    parts.push(DUMMY_SIGNATURE);
  }

  parts.push(encodeMessage(input));

  return getTransactionDecoder().decode(concat(parts));
}

/** The prepared order the server emits, plus optional extra instruction. */
function standardTransaction(input: {
  payer: string;
  recipient: string;
  amount?: bigint;
  blockhash?: string;
  extra?: { programId: string; data: Uint8Array };
}): Transaction {
  const amount = input.amount ?? AMOUNT;
  const blockhash = input.blockhash ?? BLOCKHASH;

  if (input.extra) {
    return wireTransaction({
      numRequiredSignatures: 1,
      numReadonlyUnsigned: 2,
      accountKeys: [
        input.payer,
        input.recipient,
        SYSTEM_PROGRAM_ADDRESS,
        input.extra.programId,
      ],
      blockhash,
      instructions: [
        { programIndex: 2, accountIndices: [0, 1], data: transferData(amount) },
        {
          programIndex: 3,
          accountIndices: [],
          data: input.extra.data,
        },
      ],
    });
  }

  return wireTransaction({
    numRequiredSignatures: 1,
    numReadonlyUnsigned: 1,
    accountKeys: [input.payer, input.recipient, SYSTEM_PROGRAM_ADDRESS],
    blockhash,
    instructions: [
      { programIndex: 2, accountIndices: [0, 1], data: transferData(amount) },
    ],
  });
}

/** Wallet-reordered keys: [feePayer, System Program, recipient]. */
function reorderedTransaction(input: {
  payer: string;
  recipient: string;
  amount?: bigint;
}): Transaction {
  return wireTransaction({
    numRequiredSignatures: 1,
    numReadonlyUnsigned: 1,
    accountKeys: [input.payer, SYSTEM_PROGRAM_ADDRESS, input.recipient],
    blockhash: BLOCKHASH,
    instructions: [
      {
        programIndex: 1,
        accountIndices: [0, 2],
        data: transferData(input.amount ?? AMOUNT),
      },
    ],
  });
}

/**
 * The same reordered transaction, genuinely signed by the payer, so the server
 * inspector's Ed25519 check is exercised rather than a dummy signature.
 */
async function reorderedTransactionSignedBy(input: {
  payer: KeyPairSigner;
  recipient: string;
  amount?: bigint;
}): Promise<Transaction> {
  const message = encodeMessage({
    numRequiredSignatures: 1,
    numReadonlyUnsigned: 1,
    accountKeys: [input.payer.address, SYSTEM_PROGRAM_ADDRESS, input.recipient],
    blockhash: BLOCKHASH,
    instructions: [
      {
        programIndex: 1,
        accountIndices: [0, 2],
        data: transferData(input.amount ?? AMOUNT),
      },
    ],
  });
  const signature = await signBytes(input.payer.keyPair.privateKey, message);

  return getTransactionDecoder().decode(
    concat([shortVec(1), signature, message]),
  );
}

/* -------------------------------------------------------------------------- */
/* Client-side semantic validation                                            */
/* -------------------------------------------------------------------------- */

async function expectWalletModified(
  mutate: (transaction: Transaction, fixture: Awaited<ReturnType<typeof preparedFixture>>) => Transaction,
): Promise<void> {
  const fixture = await preparedFixture();
  const wallet = await walletFor(fixture.merchant, (transaction) =>
    mutate(transaction, fixture),
  );

  await assert.rejects(
    () =>
      signPreparedAgentTransaction(wallet.signer, fixture.prepared.transactionBase64),
    (cause: unknown) => {
      assert.ok(
        cause instanceof AgentWalletModifiedTransactionError,
        `expected AgentWalletModifiedTransactionError, got ${String(cause)}`,
      );
      assert.equal(cause.code, AGENT_WALLET_MODIFIED_TRANSACTION_CODE);
      return true;
    },
  );
}

test("the fixture signer is wallet-standard shaped (no partial-sign capability)", async () => {
  const wallet = await walletFor(await generateKeyPairSigner());

  assert.equal("modifyAndSignTransactions" in wallet.raw, true);
  assert.equal("signTransactions" in wallet.raw, false);
});

test("1. a byte-identical wallet result is accepted", async () => {
  const fixture = await preparedFixture();
  const wallet = await walletFor(fixture.merchant);

  const signed = await signPreparedAgentTransaction(
    wallet.signer,
    fixture.prepared.transactionBase64,
  );

  const inspection = inspectSignedAgentTransferTransaction(signed);
  assert.equal(inspection.payer, fixture.merchant.address);
  assert.equal(inspection.signature, getBase58Decoder().decode(
    getTransactionDecoder().decode(getBase64Encoder().encode(signed))
      .signatures[fixture.merchant.address] as Uint8Array,
  ));
  assert.equal(inspection.inspection.instructions.length, 1);
});

test("2. reordered account keys with identical semantics are accepted", async () => {
  const fixture = await preparedFixture();
  const wallet = await walletFor(fixture.merchant, () =>
    reorderedTransactionSignedBy({
      payer: fixture.merchant,
      recipient: fixture.recipient.address,
    }),
  );

  const signed = await signPreparedAgentTransaction(
    wallet.signer,
    fixture.prepared.transactionBase64,
  );

  const inspection = inspectSignedAgentTransferTransaction(signed).inspection;
  assert.deepEqual(inspection.accountKeys, [
    fixture.merchant.address,
    SYSTEM_PROGRAM_ADDRESS,
    fixture.recipient.address,
  ]);
  assert.equal(inspection.instructions.length, 1);
  assert.equal(inspection.instructions[0].destination, fixture.recipient.address);
  assert.equal(inspection.instructions[0].amountLamports, AMOUNT);
});

test("3. an added Compute Budget instruction is rejected", async () => {
  await expectWalletModified((_transaction, fixture) =>
    standardTransaction({
      payer: fixture.merchant.address,
      recipient: fixture.recipient.address,
      extra: {
        programId: COMPUTE_BUDGET_PROGRAM,
        data: Uint8Array.of(2, 0x40, 0x42, 0x0f, 0x00),
      },
    }),
  );
});

test("4. an added Memo instruction is rejected", async () => {
  await expectWalletModified((_transaction, fixture) =>
    standardTransaction({
      payer: fixture.merchant.address,
      recipient: fixture.recipient.address,
      extra: { programId: MEMO_PROGRAM, data: new TextEncoder().encode("hi") },
    }),
  );
});

test("5. a changed amount is rejected", async () => {
  await expectWalletModified((_transaction, fixture) =>
    standardTransaction({
      payer: fixture.merchant.address,
      recipient: fixture.recipient.address,
      amount: AMOUNT + 1n,
    }),
  );
});

test("6. a changed recipient is rejected", async () => {
  await expectWalletModified((_transaction, fixture) =>
    standardTransaction({
      payer: fixture.merchant.address,
      recipient: "So11111111111111111111111111111111111111112",
    }),
  );
});

test("7. a changed fee payer is rejected", async () => {
  await expectWalletModified((_transaction, fixture) =>
    standardTransaction({
      payer: "So11111111111111111111111111111111111111112",
      recipient: fixture.recipient.address,
    }),
  );
});

test("8. a changed blockhash is rejected", async () => {
  await expectWalletModified((_transaction, fixture) =>
    standardTransaction({
      payer: fixture.merchant.address,
      recipient: fixture.recipient.address,
      blockhash: OTHER_BLOCKHASH,
    }),
  );
});

test("9. a changed signer set is rejected", async () => {
  await expectWalletModified((_transaction, fixture) =>
    wireTransaction({
      numRequiredSignatures: 2,
      numReadonlyUnsigned: 1,
      accountKeys: [
        fixture.merchant.address,
        "So11111111111111111111111111111111111111112",
        fixture.recipient.address,
        SYSTEM_PROGRAM_ADDRESS,
      ],
      blockhash: BLOCKHASH,
      instructions: [
        { programIndex: 3, accountIndices: [0, 2], data: transferData(AMOUNT) },
      ],
    }),
  );
});

test("10. a versioned wallet result is rejected", async () => {
  await expectWalletModified((_transaction, fixture) =>
    wireTransaction({
      version: 0,
      numRequiredSignatures: 1,
      numReadonlyUnsigned: 1,
      accountKeys: [
        fixture.merchant.address,
        fixture.recipient.address,
        SYSTEM_PROGRAM_ADDRESS,
      ],
      blockhash: BLOCKHASH,
      instructions: [
        { programIndex: 2, accountIndices: [0, 1], data: transferData(AMOUNT) },
      ],
    }),
  );
});

test("11. a rejected modification produces no submittable transaction", async () => {
  const fixture = await preparedFixture();
  const submitted: string[] = [];
  const submit = async (body: { intentId: string; transaction: string }) => {
    submitted.push(body.transaction);
  };

  const wallet = await walletFor(fixture.merchant, () =>
    standardTransaction({
      payer: fixture.merchant.address,
      recipient: fixture.recipient.address,
      extra: {
        programId: COMPUTE_BUDGET_PROGRAM,
        data: Uint8Array.of(2, 0x40, 0x42, 0x0f, 0x00),
      },
    }),
  );

  let signed: string | null = null;

  try {
    signed = await signPreparedAgentTransaction(
      wallet.signer,
      fixture.prepared.transactionBase64,
    );
  } catch (cause) {
    assert.equal(isAgentWalletModifiedTransactionError(cause), true);
  }

  // Mirrors submitPreparedIntent(): the POST only happens on a signed result.
  if (signed !== null) {
    await submit({ intentId: fixture.intent.id, transaction: signed });
  }

  assert.equal(signed, null);
  assert.deepEqual(submitted, []);
});

test("12. an accepted result submits the wallet's own signed bytes", async () => {
  const fixture = await preparedFixture();
  const keypair = fixture.merchant;
  let returned: Transaction | null = null;

  const wallet = {
    address: keypair.address,
    modifyAndSignTransactions: async (transactions: readonly Transaction[]) => {
      const signed = await signTransactionWithSigners([keypair], transactions[0]);
      returned = signed;
      return [signed];
    },
  } as unknown as TransactionSigner;

  const signed = await signPreparedAgentTransaction(
    wallet,
    fixture.prepared.transactionBase64,
  );

  assert.ok(returned);
  assert.equal(signed, getBase64EncodedWireTransaction(returned));
  assert.notEqual(signed, fixture.prepared.transactionBase64);
});

/* -------------------------------------------------------------------------- */
/* Server diagnostics                                                         */
/* -------------------------------------------------------------------------- */

type SubmitState = { diagnostics: IntentSubmitDiagnostics[]; broadcasts: string[] };

async function submitWithTransaction(
  fixture: Awaited<ReturnType<typeof preparedFixture>>,
  transaction: string,
): Promise<{ state: SubmitState; status: number; body: Record<string, unknown> }> {
  const intent: AgentPaymentIntent = {
    id: fixture.intent.id,
    merchantWallet: fixture.merchant.address,
    status: "approved",
    recipientAddress: fixture.recipient.address,
    amountLamports: AMOUNT.toString(),
    purpose: "Logo design",
    reference: "11111111111111111111111111111111",
    sourceKind: "address",
    sourcePaymentRequestReference: null,
    nonce: NONCE,
    intentFingerprint: "c".repeat(64),
    transactionSignature: null,
    transactionBase64: null,
    payerAddress: null,
    verifiedAt: null,
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
    createdAt: NOW.toISOString(),
    approvedAt: NOW.toISOString(),
    approvalExpiresAt: APPROVAL_EXPIRES_AT,
    submittedAt: null,
    failureReason: null,
  };

  const preparation: AgentPaymentIntentPreparation = {
    intentId: intent.id,
    intentNonce: intent.nonce,
    merchantWallet: intent.merchantWallet,
    messageHash: "d".repeat(64),
    canonicalFingerprint: canonicalAgentPaymentFingerprint(
      canonicalAgentPaymentInputFromInspection({
        inspection: inspectAgentTransferMessage(
          getTransactionDecoder().decode(
            getBase64Encoder().encode(fixture.prepared.transactionBase64),
          ).messageBytes,
        ),
        intentId: intent.id,
        intentNonce: intent.nonce,
        merchantWallet: intent.merchantWallet,
        recipient: intent.recipientAddress,
        amountLamports: AMOUNT,
        lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
      }),
    ),
    blockhash: BLOCKHASH,
    lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT.toString(),
    approvalExpiresAt: APPROVAL_EXPIRES_AT,
    createdAt: NOW.toISOString(),
  };

  const state: SubmitState = { diagnostics: [], broadcasts: [] };

  const overrides: Partial<IntentSubmitDependencies> = {
    resolveMerchant: async () => fixture.merchant.address,
    checkRateLimit: async () => ({ ok: true }),
    checkCapability: async () => ({ ok: true }),
    checkNetwork: async () => true,
    checkBlockhash: async () => true,
    loadIntent: async () => ({ ok: true, intent }),
    loadPreparation: async () => ({ ok: true, preparation }),
    submitIntent: async () => ({
      ok: true,
      outcome: "submitted",
      intent,
    }),
    broadcast: async (bytes) => {
      state.broadcasts.push(bytes);
      return getBase58Decoder().decode(DUMMY_SIGNATURE);
    },
    logDiagnostic: (diagnostics) => state.diagnostics.push(diagnostics),
    now: () => NOW,
  };

  const handler = createIntentSubmitPostHandler(overrides);
  const request = new NextRequest(`http://localhost${SUBMIT_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify({ intentId: intent.id, transaction }),
  });

  const response = await handler(request);

  return {
    state,
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

test("13. server diagnostics name the offending instruction and program", async () => {
  const fixture = await preparedFixture();
  const extraData = Uint8Array.of(2, 0x40, 0x42, 0x0f, 0x00);

  const modified = standardTransaction({
    payer: fixture.merchant.address,
    recipient: fixture.recipient.address,
    extra: { programId: COMPUTE_BUDGET_PROGRAM, data: extraData },
  });

  const { state, status, body } = await submitWithTransaction(
    fixture,
    getBase64EncodedWireTransaction(modified),
  );

  assert.equal(status, 400);
  assert.equal(body.code, "unexpected_instruction");
  assert.equal(body.status, "invalid_request");
  // The user-facing message stays generic.
  assert.equal(
    body.error,
    "The signed transaction does not match the approved payment. Nothing was submitted.",
  );

  assert.equal(state.diagnostics.length, 1);
  const diagnostics = state.diagnostics[0];

  assert.equal(diagnostics.reason, "unexpected_instruction");
  assert.equal(diagnostics.intentId, fixture.intent.id);
  assert.equal(diagnostics.detail, "unexpected_program");
  assert.equal(diagnostics.programId, COMPUTE_BUDGET_PROGRAM);
  assert.equal(diagnostics.instructionIndex, 1);
  assert.equal(diagnostics.instructionCount, 2);
  assert.equal(diagnostics.accountCount, 4);
  assert.equal(diagnostics.dataLength, extraData.byteLength);
  assert.equal(diagnostics.blockhash, BLOCKHASH);
  // Nothing was recorded or broadcast.
  assert.deepEqual(state.broadcasts, []);
  assert.equal(body.signature, undefined);
});

test("14. the canonical fingerprint still ignores key order, not semantics", async () => {
  const fixture = await preparedFixture();

  const fingerprint = (transaction: Transaction, overrides: { amount?: bigint } = {}) =>
    canonicalAgentPaymentFingerprint(
      canonicalAgentPaymentInputFromInspection({
        inspection: inspectAgentTransferMessage(transaction.messageBytes),
        intentId: fixture.intent.id,
        intentNonce: NONCE,
        merchantWallet: fixture.merchant.address,
        recipient: fixture.recipient.address,
        amountLamports: overrides.amount ?? AMOUNT,
        lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
      }),
    );

  const baseline = fingerprint(
    getTransactionDecoder().decode(
      getBase64Encoder().encode(fixture.prepared.transactionBase64),
    ),
  );

  assert.match(baseline, /^[0-9a-f]{64}$/);
  assert.equal(
    fingerprint(
      reorderedTransaction({
        payer: fixture.merchant.address,
        recipient: fixture.recipient.address,
      }),
    ),
    baseline,
  );
  assert.notEqual(
    fingerprint(
      standardTransaction({
        payer: fixture.merchant.address,
        recipient: fixture.recipient.address,
        amount: AMOUNT + 1n,
      }),
    ),
    baseline,
  );
});

/* -------------------------------------------------------------------------- */
/* Development diagnostic: the structural diff is captured, not guessed       */
/* -------------------------------------------------------------------------- */

test("15. the client re-encode of the prepared transaction is lossless", async () => {
  const fixture = await preparedFixture();
  const decoded = getTransactionDecoder().decode(
    getBase64Encoder().encode(fixture.prepared.transactionBase64),
  );

  // The bytes the guard compares against are exactly the bytes the server
  // issued: decode -> encode is identity, so any reported difference is the
  // wallet's, never an artefact of re-serialisation.
  assert.equal(
    getBase64EncodedWireTransaction(decoded),
    fixture.prepared.transactionBase64,
  );
});

test("16. the diagnostic names an added Compute Budget instruction and nothing else", async () => {
  const fixture = await preparedFixture();

  const preparedShape = describeAgentSigningMessage(
    getTransactionDecoder().decode(
      getBase64Encoder().encode(fixture.prepared.transactionBase64),
    ).messageBytes,
    1,
  );
  const modified = standardTransaction({
    payer: fixture.merchant.address,
    recipient: fixture.recipient.address,
    extra: {
      programId: COMPUTE_BUDGET_PROGRAM,
      data: Uint8Array.of(2, 0x40, 0x42, 0x0f, 0x00),
    },
  });
  const returnedShape = describeAgentSigningMessage(modified.messageBytes, 1);

  assert.ok(preparedShape);
  assert.ok(returnedShape);

  assert.equal(preparedShape.accountCount, 3);
  assert.equal(preparedShape.instructions.length, 1);
  assert.equal(preparedShape.instructions[0].programName, "system.transfer");
  assert.equal(preparedShape.instructions[0].amountLamports, AMOUNT.toString());

  assert.equal(returnedShape.accountCount, 4);
  assert.equal(returnedShape.instructions.length, 2);
  assert.equal(returnedShape.instructions[1].index, 1);
  assert.equal(returnedShape.instructions[1].programId, COMPUTE_BUDGET_PROGRAM);
  assert.equal(
    returnedShape.instructions[1].programName,
    "compute-budget.set-compute-unit-limit",
  );
  assert.equal(returnedShape.instructions[1].dataLength, 5);

  const differences = diffAgentSigningMessages(preparedShape, returnedShape);
  assert.deepEqual(differences, [
    "account_count_changed",
    "account_added",
    "instruction_count_changed",
    "instruction_added_at_1",
  ]);
});

test("17. the diagnostic reports account reordering as harmless and amount changes as fatal", async () => {
  const fixture = await preparedFixture();
  const preparedShape = describeAgentSigningMessage(
    getTransactionDecoder().decode(
      getBase64Encoder().encode(fixture.prepared.transactionBase64),
    ).messageBytes,
    1,
  );
  assert.ok(preparedShape);

  const reordered = reorderedTransaction({
    payer: fixture.merchant.address,
    recipient: fixture.recipient.address,
  });
  assert.deepEqual(
    diffAgentSigningMessages(
      preparedShape,
      describeAgentSigningMessage(reordered.messageBytes, 1)!,
    ),
    ["account_order_changed"],
  );

  const tampered = standardTransaction({
    payer: fixture.merchant.address,
    recipient: fixture.recipient.address,
    amount: AMOUNT + 1n,
  });
  assert.deepEqual(
    diffAgentSigningMessages(
      preparedShape,
      describeAgentSigningMessage(tampered.messageBytes, 1)!,
    ),
    ["instruction_0_amount_changed"],
  );
});

test("18. the diagnostic payload never contains a serialized transaction", async () => {
  const fixture = await preparedFixture();
  const modified = standardTransaction({
    payer: fixture.merchant.address,
    recipient: fixture.recipient.address,
    extra: {
      programId: COMPUTE_BUDGET_PROGRAM,
      data: Uint8Array.of(2, 0x40, 0x42, 0x0f, 0x00),
    },
  });
  const prepared = getTransactionDecoder().decode(
    getBase64Encoder().encode(fixture.prepared.transactionBase64),
  );

  const diagnostic = buildAgentSigningDiagnostic({
    walletName: "Test Wallet",
    signerKind: "modifying",
    preparedMessageBytes: prepared.messageBytes,
    preparedSignatureSlots: 1,
    returnedMessageBytes: modified.messageBytes,
    returnedSignatureSlots: 1,
    rejection: {
      reason: "unexpected_instruction",
      detail: "unexpected_program",
      instructionIndex: 1,
      programId: COMPUTE_BUDGET_PROGRAM,
      dataLength: 5,
    },
  });

  const serialized = JSON.stringify(diagnostic);

  assert.equal(diagnostic.signerKind, "modifying");
  assert.equal(diagnostic.differences.includes("instruction_added_at_1"), true);
  assert.equal(
    diagnostic.rejection?.detail,
    "unexpected_program",
  );
  // No wire bytes, no signatures, no base64 of either transaction.
  assert.equal(serialized.includes(fixture.prepared.transactionBase64), false);
  assert.equal(
    serialized.includes(getBase64EncodedWireTransaction(modified)),
    false,
  );
  assert.equal(serialized.includes("transactionBase64"), false);
});

test("19. the signing boundary emits the diff once and still fails closed", async () => {
  const fixture = await preparedFixture();
  const wallet = await walletFor(fixture.merchant, () =>
    standardTransaction({
      payer: fixture.merchant.address,
      recipient: fixture.recipient.address,
      extra: {
        programId: COMPUTE_BUDGET_PROGRAM,
        data: Uint8Array.of(2, 0x40, 0x42, 0x0f, 0x00),
      },
    }),
  );

  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  try {
    await assert.rejects(
      () =>
        signPreparedAgentTransaction(
          wallet.signer,
          fixture.prepared.transactionBase64,
          { walletName: "Phantom" },
        ),
      (cause: unknown) => {
        assert.equal(isAgentWalletModifiedTransactionError(cause), true);
        assert.equal(
          (cause as AgentWalletModifiedTransactionError).message,
          AGENT_WALLET_MODIFIED_TRANSACTION_MESSAGE,
        );
        return true;
      },
    );
  } finally {
    console.warn = original;
  }

  assert.equal(warnings.length, 1);
  const diagnostic = warnings[0][1] as {
    event: string;
    walletName: string;
    signerKind: string;
    differences: string[];
    rejection: { reason: string; detail: string };
    prepared: { instructions: { programName: string }[] };
    returned: { instructions: { programName: string }[] };
  };

  assert.equal(diagnostic.event, "agent_wallet_modified_transaction");
  assert.equal(diagnostic.walletName, "Phantom");
  assert.equal(diagnostic.signerKind, "modifying");
  assert.equal(diagnostic.differences.includes("instruction_added_at_1"), true);
  assert.equal(diagnostic.rejection.reason, "unexpected_instruction");
  assert.equal(diagnostic.rejection.detail, "unexpected_program");
  assert.equal(diagnostic.prepared.instructions.length, 1);
  assert.equal(diagnostic.returned.instructions.length, 2);
  assert.equal(
    diagnostic.returned.instructions[1].programName,
    "compute-budget.set-compute-unit-limit",
  );
});

/* -------------------------------------------------------------------------- */
/* Development diagnostic: decoded Compute Budget values                      */
/* -------------------------------------------------------------------------- */

/** 9 bytes: discriminator 3 + little-endian u64, as Phantom injects it. */
function computeUnitPriceData(price: bigint): Uint8Array {
  return concat([
    Uint8Array.of(3),
    Uint8Array.from(getU64Encoder().encode(price)),
  ]);
}

/** 5 bytes: discriminator 2 + little-endian u32, as Phantom injects it. */
function computeUnitLimitData(limit: number): Uint8Array {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(
    1,
    limit,
    true,
  );
  return data;
}

/**
 * The observed Phantom shape: SetComputeUnitPrice at 0, SetComputeUnitLimit at
 * 1, the original System transfer at 2. Only the diagnostic shape is asserted;
 * the semantic guard still rejects this transaction.
 */
function phantomModifiedTransaction(input: {
  payer: string;
  recipient: string;
  amount?: bigint;
  priceData?: Uint8Array;
  limitData?: Uint8Array;
}): Transaction {
  return wireTransaction({
    numRequiredSignatures: 1,
    numReadonlyUnsigned: 2,
    accountKeys: [
      input.payer,
      input.recipient,
      SYSTEM_PROGRAM_ADDRESS,
      COMPUTE_BUDGET_PROGRAM,
    ],
    blockhash: BLOCKHASH,
    instructions: [
      {
        programIndex: 3,
        accountIndices: [],
        data: input.priceData ?? computeUnitPriceData(0n),
      },
      {
        programIndex: 3,
        accountIndices: [],
        data: input.limitData ?? computeUnitLimitData(1_400_000),
      },
      {
        programIndex: 2,
        accountIndices: [0, 1],
        data: transferData(input.amount ?? AMOUNT),
      },
    ],
  });
}

test("20. Compute Budget price is decoded as an exact little-endian u64", async () => {
  const fixture = await preparedFixture();
  const price = 0x0102030405060708n;

  const shape = describeAgentSigningMessage(
    phantomModifiedTransaction({
      payer: fixture.merchant.address,
      recipient: fixture.recipient.address,
      priceData: computeUnitPriceData(price),
    }).messageBytes,
    1,
  );

  assert.ok(shape);
  assert.equal(shape.instructions[0].index, 0);
  assert.equal(shape.instructions[0].programName, "compute-budget.set-compute-unit-price");
  assert.equal(shape.instructions[0].computeUnitPriceMicroLamports, price.toString());
  assert.equal(shape.instructions[0].computeUnitLimit, "");
});

test("21. Compute Budget limit is decoded as an exact little-endian u32", async () => {
  const fixture = await preparedFixture();
  const limit = 4_294_967_295;

  const shape = describeAgentSigningMessage(
    phantomModifiedTransaction({
      payer: fixture.merchant.address,
      recipient: fixture.recipient.address,
      limitData: computeUnitLimitData(limit),
    }).messageBytes,
    1,
  );

  assert.ok(shape);
  assert.equal(shape.instructions[1].index, 1);
  assert.equal(shape.instructions[1].programName, "compute-budget.set-compute-unit-limit");
  assert.equal(shape.instructions[1].computeUnitLimit, limit.toString());
  assert.equal(shape.instructions[1].dataLength, 5);
});

test("22. a zero price yields a zero priority fee", async () => {
  const fixture = await preparedFixture();

  const shape = describeAgentSigningMessage(
    phantomModifiedTransaction({
      payer: fixture.merchant.address,
      recipient: fixture.recipient.address,
      priceData: computeUnitPriceData(0n),
      limitData: computeUnitLimitData(200_000),
    }).messageBytes,
    1,
  );

  assert.ok(shape);
  assert.equal(shape.instructions[0].computeUnitPriceMicroLamports, "0");
  assert.equal(shape.estimatedPriorityFeeLamports, "0");
});

test("23. a non-zero price yields ceil(price * limit / 1_000_000)", async () => {
  const fixture = await preparedFixture();

  const shape = describeAgentSigningMessage(
    phantomModifiedTransaction({
      payer: fixture.merchant.address,
      recipient: fixture.recipient.address,
      priceData: computeUnitPriceData(1_000n),
      limitData: computeUnitLimitData(200_000),
    }).messageBytes,
    1,
  );

  assert.ok(shape);
  assert.equal(shape.estimatedPriorityFeeLamports, "200");
});

test("24. large u64/u32 values keep exact precision and round up", async () => {
  const fixture = await preparedFixture();
  const price = (1n << 64n) - 1n; // u64::MAX
  const limit = 4_294_967_295; // u32::MAX

  const shape = describeAgentSigningMessage(
    phantomModifiedTransaction({
      payer: fixture.merchant.address,
      recipient: fixture.recipient.address,
      priceData: computeUnitPriceData(price),
      limitData: computeUnitLimitData(limit),
    }).messageBytes,
    1,
  );

  assert.ok(shape);
  assert.equal(shape.instructions[0].computeUnitPriceMicroLamports, price.toString());

  // Independent BigInt ceil of the same formula.
  const numerator = price * BigInt(limit);
  const expected = (numerator + 999_999n) / 1_000_000n;
  assert.equal(shape.estimatedPriorityFeeLamports, expected.toString());

  // A Number round-trip would lose the last digits; the diagnostic did not.
  assert.notEqual(BigInt(Number(price.toString())), price);
});

test("25. malformed lengths, wrong discriminators and incomplete pairs decode to unknown", async () => {
  const fixture = await preparedFixture();

  const truncatedPrice = Uint8Array.of(3, 1, 0, 0, 0, 0, 0, 1); // 8 bytes
  const priceWithLimitDiscriminator = concat([
    Uint8Array.of(2),
    Uint8Array.from(getU64Encoder().encode(5n)),
  ]);
  const limitWithPriceDiscriminator = (() => {
    const data = computeUnitLimitData(200_000);
    data[0] = 3;
    return data;
  })();

  const truncatedShape = describeAgentSigningMessage(
    phantomModifiedTransaction({
      payer: fixture.merchant.address,
      recipient: fixture.recipient.address,
      priceData: truncatedPrice,
    }).messageBytes,
    1,
  );
  assert.ok(truncatedShape);
  assert.equal(truncatedShape.instructions[0].computeUnitPriceMicroLamports, "");
  assert.equal(truncatedShape.estimatedPriorityFeeLamports, "");

  const wrongPriceShape = describeAgentSigningMessage(
    phantomModifiedTransaction({
      payer: fixture.merchant.address,
      recipient: fixture.recipient.address,
      priceData: priceWithLimitDiscriminator,
    }).messageBytes,
    1,
  );
  assert.ok(wrongPriceShape);
  assert.equal(wrongPriceShape.instructions[0].computeUnitPriceMicroLamports, "");
  assert.equal(wrongPriceShape.estimatedPriorityFeeLamports, "");

  const wrongLimitShape = describeAgentSigningMessage(
    phantomModifiedTransaction({
      payer: fixture.merchant.address,
      recipient: fixture.recipient.address,
      limitData: limitWithPriceDiscriminator,
    }).messageBytes,
    1,
  );
  assert.ok(wrongLimitShape);
  assert.equal(wrongLimitShape.instructions[1].computeUnitLimit, "");
  assert.equal(wrongLimitShape.estimatedPriorityFeeLamports, "");
});

test("26. fee rounding is always ceiling, never truncation", async () => {
  const fixture = await preparedFixture();

  const feeFor = (price: bigint, limit: number) => {
    const shape = describeAgentSigningMessage(
      phantomModifiedTransaction({
        payer: fixture.merchant.address,
        recipient: fixture.recipient.address,
        priceData: computeUnitPriceData(price),
        limitData: computeUnitLimitData(limit),
      }).messageBytes,
      1,
    );
    assert.ok(shape);
    return shape.estimatedPriorityFeeLamports;
  };

  assert.equal(feeFor(1n, 1), "1"); // 0.000001 -> 1
  assert.equal(feeFor(1n, 999_999), "1");
  assert.equal(feeFor(1n, 1_000_000), "1");
  assert.equal(feeFor(1n, 1_000_001), "2");
  assert.equal(feeFor(3n, 1_000_000), "3");
});

test("27. diagnostics stay disabled in production", async () => {
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = env.NODE_ENV;
  const originalWarn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  env.NODE_ENV = "production";

  try {
    logAgentSigningDiagnostic({
      event: "agent_wallet_modified_transaction",
      walletName: "Phantom",
      signerKind: "modifying",
      prepared: null,
      returned: null,
      differences: [],
      rejection: null,
      messageBytesIdentical: false,
    });
  } finally {
    env.NODE_ENV = originalNodeEnv;
    console.warn = originalWarn;
  }

  assert.deepEqual(warnings, []);
});
