import {
  AccountRole,
  address,
  isAddress,
  type AccountMeta,
  type Address,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  getTransferSolInstruction,
  parseTransferSolInstruction,
} from "@solana-program/system";

/**
 * Builds the native SOL transfer for a PayProof payment request.
 *
 * Everything that determines where money goes comes from the server-retrieved
 * payment request: the merchant address, the lamport amount and the reference.
 * Nothing here reads from user-editable input. The customer's connected wallet
 * signer is used as the transfer source and as the transaction fee payer, so
 * the customer — not the merchant — signs and pays the network fee.
 *
 * The reference is attached the way Solana Pay expects for a plain transfer: as
 * an extra read-only, non-signer account on the System program transfer. That
 * makes it part of the transaction's account keys so a future server-side
 * verifier can find the payment with `getSignaturesForAddress(reference)`.
 */

/** Largest value a u64 lamport amount can hold. */
const MAX_U64 = 2n ** 64n - 1n;

/** Base Solana fee for a single-signature transaction, in lamports. */
export const BASE_TRANSACTION_FEE_LAMPORTS = 5_000n;

export type PaymentTransferErrorCode =
  | "invalid-amount"
  | "invalid-merchant-address"
  | "invalid-reference";

/** A payload problem that must block the transfer (never a wallet error). */
export class PaymentTransferError extends Error {
  readonly code: PaymentTransferErrorCode;

  constructor(code: PaymentTransferErrorCode, message: string) {
    super(message);
    this.name = "PaymentTransferError";
    this.code = code;
  }
}

/**
 * Parses the stored integer lamport string.
 *
 * Strict digits-only parsing keeps lamport precision exact; a float, a decimal
 * SOL string or a negative value is rejected rather than silently rounded.
 */
export function parsePaymentLamports(amountLamports: string): bigint {
  const trimmed = amountLamports.trim();

  if (!/^\d+$/.test(trimmed)) {
    throw new PaymentTransferError(
      "invalid-amount",
      "The payment amount is not a whole number of lamports.",
    );
  }

  const lamports = BigInt(trimmed);

  if (lamports <= 0n) {
    throw new PaymentTransferError(
      "invalid-amount",
      "The payment amount must be greater than zero.",
    );
  }

  if (lamports > MAX_U64) {
    throw new PaymentTransferError(
      "invalid-amount",
      "The payment amount is larger than Solana can transfer.",
    );
  }

  return lamports;
}

/** Asserts a stored base58 value is usable as an on-chain account key. */
function requireAddress(
  value: string | null,
  code: PaymentTransferErrorCode,
  message: string,
): Address {
  if (!value || !isAddress(value)) {
    throw new PaymentTransferError(code, message);
  }

  return address(value);
}

export type PaymentTransfer = Readonly<{
  /** System program transfer with the Solana Pay reference account attached. */
  instruction: Instruction;
  /** Exact amount in lamports, taken from the stored request. */
  amountLamports: bigint;
  /** Merchant wallet that receives the SOL. */
  merchantAddress: Address;
  /** Solana Pay reference account included in the transaction. */
  reference: Address;
  /** Connected customer wallet; the transaction's signer and fee payer. */
  source: Address;
}>;

export function buildPaymentTransfer({
  source,
  merchantAddress,
  amountLamports,
  reference,
}: {
  source: TransactionSigner;
  merchantAddress: string | null;
  amountLamports: string;
  reference: string;
}): PaymentTransfer {
  const amount = parsePaymentLamports(amountLamports);
  const destination = requireAddress(
    merchantAddress,
    "invalid-merchant-address",
    "This payment request has no valid merchant wallet address.",
  );
  const referenceAddress = requireAddress(
    reference,
    "invalid-reference",
    "This payment request has no valid on-chain reference.",
  );

  const transfer = getTransferSolInstruction({
    source,
    destination,
    amount,
  });

  // Extra account metas on the System transfer are allowed by the runtime.
  // This one is read-only and never signs, so it cannot alter the transfer.
  const referenceAccount: AccountMeta = Object.freeze({
    address: referenceAddress,
    role: AccountRole.READONLY,
  });

  return Object.freeze({
    instruction: Object.freeze({
      ...transfer,
      accounts: Object.freeze([...transfer.accounts, referenceAccount]),
    }),
    amountLamports: amount,
    merchantAddress: destination,
    reference: referenceAddress,
    source: source.address,
  });
}

/**
 * Reads the transfer back out of the built instruction for review and testing.
 * Throws if the instruction is not a System transfer with the expected shape.
 */
export function inspectPaymentTransfer(instruction: Instruction): {
  source: Address;
  destination: Address;
  reference: Address | null;
  amountLamports: bigint;
} {
  // The built instruction always has the System transfer's accounts and data;
  // this cast restores the generated parser's narrowed instruction shape.
  const parsed = parseTransferSolInstruction(
    instruction as Parameters<typeof parseTransferSolInstruction>[0],
  );
  const extraAccounts = instruction.accounts?.slice(2) ?? [];

  return {
    source: parsed.accounts.source.address,
    destination: parsed.accounts.destination.address,
    reference: extraAccounts[0]?.address ?? null,
    amountLamports: parsed.data.amount,
  };
}

export type PaymentFailureKind = "rejected" | "insufficient" | "failed";

const rejectedPattern =
  /user rejected|rejected the request|request rejected|rejected by (the )?user|user declined|declined by (the )?user|approval denied|user denied|transaction cancelled|transaction canceled|cancelled by user|canceled by user/i;

const insufficientPattern =
  /insufficient (funds|lamports|sol)|insufficient funds for (fee|rent)|no record of a prior credit/i;

const expiredPattern =
  /blockhash not found|blockhashnotfound|block height exceeded|transaction expired|blockhash expired/i;

/**
 * Converts a thrown wallet/RPC failure into a UI-safe state.
 *
 * The wallet's own rejection must never look like a success, and an RPC error
 * must never be presented as a confirmed payment.
 */
export function describePaymentFailure(cause: unknown): {
  kind: PaymentFailureKind;
  message: string;
} {
  const rawMessage =
    cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? (cause as { code?: unknown }).code
      : undefined;

  if (code === 4001 || code === "4001" || rejectedPattern.test(rawMessage)) {
    return {
      kind: "rejected",
      message: "The transaction was rejected in your wallet. Nothing was sent.",
    };
  }

  if (insufficientPattern.test(rawMessage)) {
    return {
      kind: "insufficient",
      message:
        "Your wallet does not have enough Devnet SOL for this payment plus the network fee.",
    };
  }

  if (expiredPattern.test(rawMessage)) {
    return {
      kind: "failed",
      message:
        "The transaction expired before the network accepted it. Nothing was paid; please try again.",
    };
  }

  return {
    kind: "failed",
    message: rawMessage
      ? `The transaction could not be completed: ${rawMessage}`
      : "The transaction could not be completed. Please try again.",
  };
}

/** Explorer URL for a submitted transaction on Solana Devnet. */
export function getDevnetTransactionExplorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
}
