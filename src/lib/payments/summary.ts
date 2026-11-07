import { formatSolExact } from "../solana/units";
import type { PaymentRequest } from "../payment-requests/types";

/**
 * Pure payment statistics calculations.
 *
 * Financial totals are summed as bigint lamports and only converted to SOL
 * when a display string is produced, so no cent/lamport is lost to float math.
 *
 * Only independently verified payments (with transaction signature, payer
 * address, and verified timestamp) count as successful revenue.
 */

export type PaymentStatId =
  | "total-verified-payments"
  | "total-sol-received"
  | "successful-transactions"
  | "pending-transactions"
  | "failed-transactions";

export type PaymentStat = {
  id: PaymentStatId;
  label: string;
  value: string;
  unit?: string;
  hint: string;
};

export type PaymentsSummary = {
  stats: readonly PaymentStat[];
  totalCount: number;
};

/**
 * A payment only counts as verified revenue when the server-side verifier
 * recorded the signature, payer address, and verification timestamp.
 */
function isVerifiedPayment(request: PaymentRequest): boolean {
  return (
    request.status === "paid" &&
    request.transactionSignature !== null &&
    request.payerAddress !== null &&
    request.verifiedAt !== null
  );
}

function parseLamports(value: string): bigint {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    throw new Error("A stored payment amount is not a whole number of lamports.");
  }

  return BigInt(trimmed);
}

export function buildPaymentsSummary(
  requests: readonly PaymentRequest[],
): PaymentsSummary {
  let totalVerifiedLamports = 0n;
  let successfulCount = 0;
  let pendingCount = 0;
  let failedCount = 0;

  for (const request of requests) {
    if (request.status === "paid") {
      successfulCount += 1;

      if (isVerifiedPayment(request)) {
        totalVerifiedLamports += parseLamports(request.amountLamports);
      }
    } else if (request.status === "pending") {
      pendingCount += 1;
    } else if (request.status === "expired" || request.status === "cancelled") {
      failedCount += 1;
    }
  }

  return {
    stats: [
      {
        id: "total-verified-payments",
        label: "Total verified payments",
        value: successfulCount.toLocaleString("en-US"),
        hint: "Payments verified on Solana",
      },
      {
        id: "total-sol-received",
        label: "Total SOL received",
        value: formatSolExact(totalVerifiedLamports),
        unit: "SOL",
        hint: "Independently verified revenue",
      },
      {
        id: "successful-transactions",
        label: "Successful transactions",
        value: successfulCount.toLocaleString("en-US"),
        hint: "Requests marked as paid",
      },
      {
        id: "pending-transactions",
        label: "Pending transactions",
        value: pendingCount.toLocaleString("en-US"),
        hint: "Awaiting payment",
      },
      {
        id: "failed-transactions",
        label: "Failed transactions",
        value: failedCount.toLocaleString("en-US"),
        hint: "Expired or cancelled",
      },
    ],
    totalCount: requests.length,
  };
}
