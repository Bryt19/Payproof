import { formatSolExact } from "../solana/units";
import type { PaymentRequest } from "../payment-requests/types";
import { summarizePayments } from "../../../telegram-bot/src/lib/payment-summary";

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

export function buildPaymentsSummary(
  requests: readonly PaymentRequest[],
): PaymentsSummary {
  // Same aggregation as the dashboard, payments breakdown and Telegram
  // `/summary`, so failed requests are never reported as pending.
  const totals = summarizePayments(requests);
  const successfulCount = totals.verifiedCount;
  const pendingCount = totals.pendingCount;
  const failedCount = totals.failedCount;

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
        value: formatSolExact(totals.verifiedLamports),
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
        hint: "Failed, cancelled or expired",
      },
    ],
    totalCount: requests.length,
  };
}
