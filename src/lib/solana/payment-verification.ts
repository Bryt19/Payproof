import {
  getBase58Decoder,
  getBase58Encoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  isAddress,
  type Address,
  type ReadonlyUint8Array,
} from "@solana/kit";
import { createPublicKey, verify as verifyEd25519 } from "node:crypto";

/**
 * Independent, server-side verification of a PayProof SOL payment.
 *
 * The browser only supplies a reference and a transaction signature. Every
 * fact used to decide whether the request is paid — recipient, amount,
 * reference account, signer, execution result, commitment — is read from the
 * configured Solana Devnet RPC by this module.
 *
 * This module must only run on the server.
 */

const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";
const SOL_TRANSFER_DISCRIMINATOR = 2;
const TRANSFER_INSTRUCTION_DATA_LENGTH = 12;
const ED25519_SIGNATURE_LENGTH = 64;

/** DER prefix that wraps a raw 32-byte Ed25519 public key as an SPKI key. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type ExpectedPayment = {
  reference: string;
  merchantAddress: string;
  amountLamports: string;
};

export type LoadedAddresses = {
  writable: readonly string[];
  readonly: readonly string[];
};

export type TransactionCheckFailure =
  | "invalid-transaction"
  | "invalid-signature"
  | "signature-mismatch"
  | "unexpected-signers"
  | "wrong-source"
  | "wrong-merchant"
  | "wrong-amount"
  | "missing-transfer"
  | "missing-reference"
  | "wrong-reference"
  | "invalid-account-roles";

export type TransactionCheckResult =
  | { ok: true; payerAddress: Address }
  | { ok: false; reason: TransactionCheckFailure; message: string };

type CompiledInstruction = {
  accountIndices?: number[];
  data?: ReadonlyUint8Array;
  programAddressIndex: number;
};

type AccountKeyRole = { signer: boolean; writable: boolean };

/** Reads the System program `Transfer` amount from instruction data. */
function decodeTransferAmount(data: ReadonlyUint8Array): bigint | null {
  if (data.length !== TRANSFER_INSTRUCTION_DATA_LENGTH) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (view.getUint32(0, true) !== SOL_TRANSFER_DISCRIMINATOR) return null;

  return view.getBigUint64(4, true);
}

/**
 * Resolves the signer/writable privilege of an account index from a compiled
 * message header. The account list is ordered: writable signers, read-only
 * signers, writable non-signers, read-only non-signers.
 */
function getAccountKeyRole(
  index: number,
  header: {
    numSignerAccounts: number;
    numReadonlySignerAccounts: number;
    numReadonlyNonSignerAccounts: number;
  },
  totalAccounts: number,
): AccountKeyRole {
  if (index < 0 || index >= totalAccounts) {
    return { signer: false, writable: false };
  }

  if (index < header.numSignerAccounts) {
    const writableSignerCount =
      header.numSignerAccounts - header.numReadonlySignerAccounts;
    return { signer: true, writable: index < writableSignerCount };
  }

  const writableNonSignerCount =
    totalAccounts - header.numSignerAccounts - header.numReadonlyNonSignerAccounts;
  return {
    signer: false,
    writable: index - header.numSignerAccounts < writableNonSignerCount,
  };
}

function verifyTransactionSignature({
  messageBytes,
  signatureBytes,
  publicKeyBytes,
}: {
  messageBytes: ReadonlyUint8Array;
  signatureBytes: ReadonlyUint8Array;
  publicKeyBytes: ReadonlyUint8Array;
}): boolean {
  if (
    signatureBytes.length !== ED25519_SIGNATURE_LENGTH ||
    publicKeyBytes.length !== 32
  ) {
    return false;
  }

  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyBytes)]),
      format: "der",
      type: "spki",
    });

    return verifyEd25519(
      null,
      Buffer.from(messageBytes),
      publicKey,
      Buffer.from(signatureBytes),
    );
  } catch {
    return false;
  }
}

/**
 * Checks a wire transaction retrieved from RPC against the stored request.
 *
 * This function never trusts the browser beyond the two values it supplies:
 * the reference used to find the request and the signature used to find the
 * transaction. The returned `payerAddress` is the transaction's fee payer.
 */
export function checkConfirmedTransaction({
  signature,
  transactionBase64,
  expected,
  loadedAddresses,
}: {
  signature: string;
  transactionBase64: string;
  expected: ExpectedPayment;
  loadedAddresses?: LoadedAddresses;
}): TransactionCheckResult {
  if (
    !isAddress(expected.merchantAddress) ||
    !isAddress(expected.reference) ||
    !/^\d+$/.test(expected.amountLamports)
  ) {
    return {
      ok: false,
      reason: "invalid-transaction",
      message: "The stored payment request cannot be verified on-chain.",
    };
  }

  let decodedTransaction;
  let compiledMessage;

  try {
    const wireBytes = getBase64Encoder().encode(transactionBase64);
    decodedTransaction = getTransactionDecoder().decode(wireBytes);
    compiledMessage = getCompiledTransactionMessageDecoder().decode(
      decodedTransaction.messageBytes,
    );
  } catch {
    return {
      ok: false,
      reason: "invalid-transaction",
      message: "The network returned a transaction PayProof could not decode.",
    };
  }

  if (compiledMessage.version === 1) {
    return {
      ok: false,
      reason: "invalid-transaction",
      message:
        "PayProof only verifies legacy and version 0 Devnet transactions.",
    };
  }

  const staticAccounts = compiledMessage.staticAccounts.map(String);
  const accountKeys = [
    ...staticAccounts,
    ...(loadedAddresses?.writable ?? []),
    ...(loadedAddresses?.readonly ?? []),
  ];

  const { header } = compiledMessage;

  if (header.numSignerAccounts < 1 || accountKeys.length === 0) {
    return {
      ok: false,
      reason: "unexpected-signers",
      message: "The transaction has no signer and cannot be a customer payment.",
    };
  }

  // The fee payer is always the first account key: the customer must pay the
  // network fee, never the merchant.
  const payerAddress = accountKeys[0];

  if (!isAddress(payerAddress)) {
    return {
      ok: false,
      reason: "invalid-transaction",
      message: "The transaction fee payer is not a valid wallet address.",
    };
  }

  const payerSignatureBytes = decodedTransaction.signatures[payerAddress];

  if (!payerSignatureBytes) {
    return {
      ok: false,
      reason: "signature-mismatch",
      message:
        "The transaction was not signed by its fee payer, so it does not prove this payment.",
    };
  }

  const payerSignature = getBase58Decoder().decode(payerSignatureBytes);

  if (payerSignature !== signature) {
    return {
      ok: false,
      reason: "signature-mismatch",
      message:
        "The submitted signature does not match the transaction retrieved from Devnet.",
    };
  }

  let payerPublicKeyBytes: ReadonlyUint8Array;

  try {
    payerPublicKeyBytes = getBase58Encoder().encode(payerAddress);
  } catch {
    return {
      ok: false,
      reason: "invalid-signature",
      message: "The transaction signer address could not be decoded.",
    };
  }

  if (
    !verifyTransactionSignature({
      messageBytes: decodedTransaction.messageBytes,
      signatureBytes: payerSignatureBytes,
      publicKeyBytes: payerPublicKeyBytes,
    })
  ) {
    return {
      ok: false,
      reason: "invalid-signature",
      message:
        "The transaction signature is not a valid signature by the payer wallet.",
    };
  }

  const instructions: CompiledInstruction[] = compiledMessage.instructions;
  const systemTransfers = instructions.flatMap((instruction) => {
    if (accountKeys[instruction.programAddressIndex] !== SYSTEM_PROGRAM_ADDRESS) {
      return [];
    }

    const amount = instruction.data
      ? decodeTransferAmount(instruction.data)
      : null;
    const indices = instruction.accountIndices ?? [];

    if (amount === null || indices.length < 2) return [];

    return [
      {
        amount,
        destination: accountKeys[indices[1]],
        destinationIndex: indices[1],
        indices,
        source: accountKeys[indices[0]],
        sourceIndex: indices[0],
      },
    ];
  });

  if (systemTransfers.length === 0) {
    return {
      ok: false,
      reason: "missing-transfer",
      message: "The transaction does not contain a SOL transfer.",
    };
  }

  const expectedAmount = BigInt(expected.amountLamports);

  // Find the transfer that pays this merchant, from this payer, for this
  // amount. If none matches, report which fact disagreed.
  let matchingTransfer: (typeof systemTransfers)[number] | null = null;

  for (const transfer of systemTransfers) {
    if (
      transfer.source === payerAddress &&
      transfer.destination === expected.merchantAddress &&
      transfer.amount === expectedAmount
    ) {
      matchingTransfer = transfer;
      break;
    }
  }

  if (!matchingTransfer) {
    const candidate = systemTransfers[0];

    if (candidate.source !== payerAddress) {
      return {
        ok: false,
        reason: "wrong-source",
        message:
          "The transaction was not sent from the wallet that signed it, so the payer cannot be proven.",
      };
    }

    if (candidate.destination !== expected.merchantAddress) {
      return {
        ok: false,
        reason: "wrong-merchant",
        message:
          "The transaction sends SOL to a different wallet than this request's merchant.",
      };
    }

    return {
      ok: false,
      reason: "wrong-amount",
      message:
        "The transferred SOL amount does not exactly match this payment request.",
    };
  }

  const sourceRole = getAccountKeyRole(
    matchingTransfer.sourceIndex,
    header,
    accountKeys.length,
  );
  const destinationRole = getAccountKeyRole(
    matchingTransfer.destinationIndex,
    header,
    accountKeys.length,
  );

  if (!sourceRole.signer) {
    return {
      ok: false,
      reason: "wrong-source",
      message: "The transfer source is not a signer of the transaction.",
    };
  }

  if (destinationRole.signer) {
    return {
      ok: false,
      reason: "invalid-account-roles",
      message: "The merchant wallet must not be a signer of the payment.",
    };
  }

  if (matchingTransfer.indices.length !== 3) {
    return {
      ok: false,
      reason: "missing-reference",
      message:
        "The transfer does not include the payment reference in its expected third account position.",
    };
  }

  const referenceIndex = matchingTransfer.indices[2];
  const referenceAccount = accountKeys[referenceIndex];

  if (referenceAccount !== expected.reference) {
    return {
      ok: false,
      reason: "wrong-reference",
      message:
        "The transaction includes a different payment reference than this request's reference.",
    };
  }

  const referenceRole = getAccountKeyRole(
    referenceIndex,
    header,
    accountKeys.length,
  );

  // The reference is an identity marker only: it must never sign or be writable.
  if (referenceRole.signer || referenceRole.writable) {
    return {
      ok: false,
      reason: "invalid-account-roles",
      message:
        "The payment reference must be a read-only, non-signer account in the transaction.",
    };
  }

  return { ok: true, payerAddress };
}

export type SignatureStatusResult = {
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
  err: unknown | null;
};

export type RetrievedTransaction = {
  transactionBase64: string;
  metaAvailable: boolean;
  err: unknown | null;
  loadedAddresses?: LoadedAddresses;
};

/** The small RPC surface verification needs; mocked in tests. */
export type OnChainLookup = {
  getSignatureStatus(signature: string): Promise<SignatureStatusResult | null>;
  getTransaction(signature: string): Promise<RetrievedTransaction | null>;
};

export type OnChainVerificationResult =
  | {
      status: "verified";
      payerAddress: Address;
      commitment: "confirmed" | "finalized";
    }
  | { status: "pending"; message: string }
  | { status: "rejected"; reason: string; message: string }
  | { status: "error"; message: string };

/**
 * Retrieves the transaction and enforces existence, success and confirmed
 * commitment before checking its contents.
 *
 * A missing or unconfirmed transaction is `pending`, never `rejected`: the
 * customer may retry once the network has processed it.
 */
export async function verifyOnChainPayment({
  expected,
  signature,
  lookup,
}: {
  expected: ExpectedPayment;
  signature: string;
  lookup: OnChainLookup;
}): Promise<OnChainVerificationResult> {
  const signatureStatus = await lookup.getSignatureStatus(signature);

  if (!signatureStatus) {
    return {
      status: "pending",
      message:
        "This transaction is not available on Solana Devnet yet. It may still be propagating.",
    };
  }

  if (signatureStatus.err !== null) {
    return {
      status: "rejected",
      reason: "transaction-failed",
      message: "This transaction failed on Solana Devnet, so it did not pay.",
    };
  }

  const commitment = signatureStatus.confirmationStatus;

  if (commitment !== "confirmed" && commitment !== "finalized") {
    return {
      status: "pending",
      message:
        "The transaction has been submitted but has not reached confirmed commitment yet.",
    };
  }

  const transaction = await lookup.getTransaction(signature);

  if (!transaction) {
    return {
      status: "pending",
      message:
        "The transaction is confirmed but its details are not available from the RPC yet.",
    };
  }

  if (!transaction.metaAvailable) {
    return {
      status: "error",
      message:
        "The Devnet RPC did not return transaction metadata, so execution could not be verified.",
    };
  }

  if (transaction.err !== null) {
    return {
      status: "rejected",
      reason: "transaction-failed",
      message: "This transaction failed on Solana Devnet, so it did not pay.",
    };
  }

  const check = checkConfirmedTransaction({
    signature,
    transactionBase64: transaction.transactionBase64,
    expected,
    loadedAddresses: transaction.loadedAddresses,
  });

  if (!check.ok) {
    return {
      status: "rejected",
      reason: check.reason,
      message: check.message,
    };
  }

  return {
    status: "verified",
    payerAddress: check.payerAddress,
    commitment,
  };
}
