import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  appendTransactionMessageInstruction,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionWithSigners,
  type TransactionMessage,
  type TransactionMessageWithBlockhashLifetime,
  type TransactionMessageWithFeePayer,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

import {
  AGENT_TRANSFER_FEE_LAMPORTS,
  AgentPaymentPreparationError,
  DEVNET_GENESIS_HASH,
  SYSTEM_PROGRAM_ADDRESS,
  assertPreparedAgentTransfer,
  inspectAgentTransferTransaction,
  prepareAgentTransfer,
  type AgentPaymentRpc,
} from "../src/lib/solana/agent-payment.ts";

/**
 * Stage 4 Step 2: unsigned Devnet transaction construction.
 *
 * These tests never touch the network. The RPC surface is replaced with a fake
 * that returns a fixed Devnet genesis hash and blockhash, and every assertion
 * reads the *compiled* transaction bytes rather than the builder's inputs.
 */

const BLOCKHASH = "11111111111111111111111111111111";
const LAST_VALID_BLOCK_HEIGHT = 300_000_000n;

async function fixture({
  genesis = DEVNET_GENESIS_HASH,
  blockhash = BLOCKHASH,
  lastValidBlockHeight = LAST_VALID_BLOCK_HEIGHT,
  amountLamports = "1500000000",
}: {
  genesis?: string;
  blockhash?: string;
  lastValidBlockHeight?: bigint;
  amountLamports?: string;
} = {}) {
  const merchant = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();

  const rpc: AgentPaymentRpc = {
    getGenesisHash: async () => genesis,
    getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight }),
  };

  return {
    merchant,
    recipient,
    rpc,
    intent: {
      id: "AI-1234ABCD",
      nonce: "ab".repeat(16),
      merchantWallet: merchant.address,
      recipientAddress: recipient.address,
      amountLamports,
    },
  };
}

function errorCode(error: unknown): string | null {
  return error instanceof AgentPaymentPreparationError ? error.code : null;
}

test("preparation builds exactly one System transfer with the exact lamports", async () => {
  const { rpc, intent, merchant } = await fixture();

  const prepared = await prepareAgentTransfer({ intent, rpc });
  const inspection = inspectAgentTransferTransaction(
    prepared.transactionBase64,
  );

  assert.equal(prepared.cluster, "devnet");
  assert.equal(prepared.feePayer, merchant.address);
  assert.equal(prepared.sender, merchant.address);
  assert.equal(prepared.recipient, intent.recipientAddress);
  assert.equal(prepared.amountLamports, 1_500_000_000n);
  assert.equal(prepared.estimatedFeeLamports, AGENT_TRANSFER_FEE_LAMPORTS);
  assert.equal(prepared.instructionCount, 1);
  assert.equal(prepared.blockhash, BLOCKHASH);
  assert.equal(prepared.lastValidBlockHeight, LAST_VALID_BLOCK_HEIGHT);
  assert.match(prepared.transactionHash, /^[0-9a-f]{64}$/);

  assert.equal(inspection.version, "legacy");
  assert.deepEqual(inspection.signers, [merchant.address]);
  assert.equal(inspection.feePayer, merchant.address);
  assert.equal(inspection.blockhash, BLOCKHASH);
  assert.deepEqual(inspection.accountKeys, [
    merchant.address,
    intent.recipientAddress,
    SYSTEM_PROGRAM_ADDRESS,
  ]);
  assert.equal(inspection.instructions.length, 1);

  const [transfer] = inspection.instructions;

  assert.equal(transfer.programId, SYSTEM_PROGRAM_ADDRESS);
  assert.equal(transfer.source, merchant.address);
  assert.equal(transfer.destination, intent.recipientAddress);
  assert.equal(transfer.amountLamports, 1_500_000_000n);
  assert.deepEqual(transfer.accountIndices, [0, 1]);
});

test("the prepared message is unchanged by the existing wallet signer", async () => {
  const { rpc, intent, merchant } = await fixture();
  const prepared = await prepareAgentTransfer({ intent, rpc });

  const unsigned = getTransactionDecoder().decode(
    getBase64Encoder().encode(prepared.transactionBase64),
  );

  // The compiled wire transaction carries an empty signature slot for the
  // merchant. Signing fills that slot and must not alter the message bytes.
  assert.deepEqual(Object.keys(unsigned.signatures), [merchant.address]);
  assert.equal(unsigned.signatures[merchant.address], null);

  const signed = await signTransactionWithSigners([merchant], unsigned);
  const signedWire = getTransactionDecoder().decode(
    getBase64Encoder().encode(getBase64EncodedWireTransaction(signed)),
  );

  assert.ok(signedWire.signatures[merchant.address]);
  assert.deepEqual(
    Buffer.from(signedWire.messageBytes),
    Buffer.from(unsigned.messageBytes),
    "wallet signing must not change the prepared message",
  );
});

test("a non-Devnet RPC is refused before any transaction is built", async () => {
  const { rpc, intent } = await fixture({
    genesis: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  });

  await assert.rejects(
    () => prepareAgentTransfer({ intent, rpc }),
    (error) => errorCode(error) === "wrong-network",
  );
});

test("an RPC failure is a typed unavailable error, not a transaction", async () => {
  const { intent } = await fixture();

  for (const rpc of [
    {
      getGenesisHash: async () => DEVNET_GENESIS_HASH,
      getLatestBlockhash: async () => {
        throw new Error("blockhash RPC down");
      },
    },
    {
      getGenesisHash: async () => {
        throw new Error("genesis RPC down");
      },
      getLatestBlockhash: async () => ({
        blockhash: BLOCKHASH,
        lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
      }),
    },
  ] satisfies AgentPaymentRpc[]) {
    await assert.rejects(
      () => prepareAgentTransfer({ intent, rpc }),
      (error) => errorCode(error) === "rpc-unavailable",
    );
  }
});

test("authoritative fields are validated without floating point", async () => {
  const { rpc, intent } = await fixture();

  const cases = [
    { ...intent, amountLamports: "1.5" },
    { ...intent, amountLamports: "0" },
    { ...intent, amountLamports: "abc" },
    { ...intent, recipientAddress: "not-an-address" },
    { ...intent, merchantWallet: "not-an-address" },
    { ...intent, id: "" },
  ];

  for (const candidate of cases) {
    await assert.rejects(
      () => prepareAgentTransfer({ intent: candidate, rpc }),
      (error) => errorCode(error) === "invalid-intent",
    );
  }
});

test("a returned blockhash must be well-formed", async () => {
  const { rpc, intent } = await fixture({ blockhash: "not-a-blockhash" });

  await assert.rejects(
    () => prepareAgentTransfer({ intent, rpc }),
    (error) => errorCode(error) === "construction-failed",
  );
});

test("tampered transactions fail the integrity assertions", async () => {
  const merchant = await generateKeyPairSigner();
  const recipient = await generateKeyPairSigner();
  const attacker = await generateKeyPairSigner();

  type TestMessage = TransactionMessage &
    TransactionMessageWithFeePayer &
    TransactionMessageWithBlockhashLifetime;

  async function encode(
    instructions: ReturnType<typeof getTransferSolInstruction>[],
  ) {
    const payer = createNoopSigner(merchant.address);
    let message: TestMessage = pipe(
      createTransactionMessage({ version: "legacy" }),
      (transactionMessage) =>
        setTransactionMessageFeePayerSigner(payer, transactionMessage),
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
    ) as TestMessage;

    for (const instruction of instructions) {
      message = appendTransactionMessageInstruction(
        instruction,
        message,
      ) as TestMessage;
    }

    return getBase64EncodedWireTransaction(compileTransaction(message));
  }

  const expected = {
    feePayer: merchant.address,
    recipient: recipient.address,
    amountLamports: 1_000n,
    blockhash: BLOCKHASH,
  };

  const valid = await encode([
    getTransferSolInstruction({
      source: createNoopSigner(merchant.address),
      destination: recipient.address,
      amount: 1_000n,
    }),
  ]);

  assertPreparedAgentTransfer({
    inspection: inspectAgentTransferTransaction(valid),
    expected,
  });

  const twoInstructions = await encode([
    getTransferSolInstruction({
      source: createNoopSigner(merchant.address),
      destination: recipient.address,
      amount: 1_000n,
    }),
    getTransferSolInstruction({
      source: createNoopSigner(merchant.address),
      destination: attacker.address,
      amount: 1_000n,
    }),
  ]);

  assert.throws(
    () =>
      assertPreparedAgentTransfer({
        inspection: inspectAgentTransferTransaction(twoInstructions),
        expected,
      }),
    (error) => errorCode(error) === "construction-failed",
  );

  const wrongAmount = await encode([
    getTransferSolInstruction({
      source: createNoopSigner(merchant.address),
      destination: recipient.address,
      amount: 999n,
    }),
  ]);

  assert.throws(
    () =>
      assertPreparedAgentTransfer({
        inspection: inspectAgentTransferTransaction(wrongAmount),
        expected,
      }),
    (error) => errorCode(error) === "construction-failed",
  );

  const wrongRecipient = await encode([
    getTransferSolInstruction({
      source: createNoopSigner(merchant.address),
      destination: attacker.address,
      amount: 1_000n,
    }),
  ]);

  assert.throws(
    () =>
      assertPreparedAgentTransfer({
        inspection: inspectAgentTransferTransaction(wrongRecipient),
        expected,
      }),
    (error) => errorCode(error) === "construction-failed",
  );

  assert.throws(
    () => inspectAgentTransferTransaction("not base64 at all!"),
    (error) => errorCode(error) === "construction-failed",
  );
});

test("the preparation hash is stable and bound to intent, amount and blockhash", async () => {
  const { rpc, intent } = await fixture();

  const first = await prepareAgentTransfer({ intent, rpc });
  const second = await prepareAgentTransfer({ intent, rpc });

  assert.equal(first.transactionHash, second.transactionHash);
  assert.equal(first.transactionBase64, second.transactionBase64);

  const otherAmount = await prepareAgentTransfer({
    intent: { ...intent, amountLamports: "2000000000" },
    rpc,
  });
  assert.notEqual(otherAmount.transactionHash, first.transactionHash);

  const otherBlockhash = await prepareAgentTransfer({
    intent,
    rpc: {
      ...rpc,
      getLatestBlockhash: async () => ({
        blockhash: "So11111111111111111111111111111111111111112",
        lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
      }),
    },
  });
  assert.notEqual(otherBlockhash.transactionHash, first.transactionHash);
});

test("the preparation module never signs, sends or touches a key", () => {
  const source = readFileSync(
    new URL("../src/lib/solana/agent-payment.ts", import.meta.url),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  for (const forbidden of [
    "sendTransaction",
    "sendRawTransaction",
    "signTransaction",
    "signTransactionMessageWithSigners",
    "Keypair",
    "privateKey",
    "localStorage",
    "buildPaymentTransfer",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `agent-payment.ts must not reference ${forbidden}`,
    );
  }
});
