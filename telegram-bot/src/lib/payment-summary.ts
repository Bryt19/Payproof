/**
 * Canonical payment summary aggregation.
 *
 * This module is deliberately dependency-free so the Next.js server and the
 * Telegram bot can both import it. The dashboard and `/summary` must never
 * implement their own status buckets: `failed` is not pending, and only a
 * verified `paid` request contributes revenue.
 */

export type PaymentSummaryStatus =
  | "pending"
  | "paid"
  | "expired"
  | "cancelled"
  | "failed";

export type SummaryPayment = {
  status: string;
  amountLamports: string;
  transactionSignature: string | null;
  payerAddress: string | null;
  verifiedAt: string | null;
};

export type PaymentSummary = {
  /** Independently verified `paid` requests only. */
  verifiedCount: number;
  /** Exact lamports from those verified requests. */
  verifiedLamports: bigint;
  /** Every request whose stored status is `pending`. */
  pendingCount: number;
  /** Combined `failed`, `cancelled` and `expired` requests. */
  failedCount: number;
};

const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * A payment is verified only when the server-side verifier recorded the
 * on-chain signature, payer wallet and verification timestamp. `paid` alone is
 * not proof and must not add revenue or a confirmed payment.
 */
export function isVerifiedPayment(payment: {
  status: string;
  transactionSignature: string | null;
  payerAddress: string | null;
  verifiedAt: string | null;
}): boolean {
  return (
    payment.status === "paid" &&
    payment.transactionSignature !== null &&
    payment.payerAddress !== null &&
    payment.verifiedAt !== null
  );
}

function toLamports(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

/** Exact SOL amount with trailing zeros trimmed (never float math). */
export function formatSolAmount(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = lamports % LAMPORTS_PER_SOL;

  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole}.${fraction.toString().padStart(9, "0").replace(/0+$/, "")}`;
}

export function summarizePayments<T extends SummaryPayment>(
  payments: readonly T[],
): PaymentSummary {
  let verifiedCount = 0;
  let verifiedLamports = 0n;
  let pendingCount = 0;
  let failedCount = 0;

  for (const payment of payments) {
    if (isVerifiedPayment(payment)) {
      verifiedCount += 1;
      verifiedLamports += toLamports(payment.amountLamports);
    } else if (payment.status === "pending") {
      pendingCount += 1;
    } else if (
      payment.status === "failed" ||
      payment.status === "cancelled" ||
      payment.status === "expired"
    ) {
      failedCount += 1;
    }
  }

  return { verifiedCount, verifiedLamports, pendingCount, failedCount };
}
