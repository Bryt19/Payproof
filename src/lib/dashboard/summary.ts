import type {
  PaymentRequest,
  PaymentRequestStatus,
} from "../payment-requests/types";
import { formatSolExact } from "../solana/units";
import {
  isVerifiedPayment,
  summarizePayments,
} from "../../../telegram-bot/src/lib/payment-summary";

/**
 * Pure dashboard calculations.
 *
 * Financial totals are summed as bigint lamports and only converted to SOL
 * when a display string is produced, so no cent/lamport is lost to float math.
 * Expired and cancelled requests never count as pending or successful.
 */

export type DashboardStatId =
  | "total-received"
  | "successful-payments"
  | "pending-payments"
  | "payment-requests"
  | "total-verified-payments"
  | "total-sol-received"
  | "successful-transactions"
  | "pending-transactions"
  | "failed-transactions";

export type DashboardStat = {
  id: DashboardStatId;
  label: string;
  value: string;
  unit?: string;
  hint: string;
};

export type DashboardActivityRow = {
  id: string;
  reference: string;
  description: string;
  /** Exact SOL amount for display, derived from integer lamports. */
  amountSol: string;
  customerName: string | null;
  status: PaymentRequestStatus;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  transactionSignature: string | null;
  /** Wallet that paid, when the request has been verified. */
  payerAddress: string | null;
};

export type DashboardSummary = {
  stats: readonly DashboardStat[];
  activity: readonly DashboardActivityRow[];
};

/** Number of most recent requests shown in the activity table. */
export const DASHBOARD_ACTIVITY_LIMIT = 8;

/**
 * A paid request only contributes revenue when the Task 09 verifier recorded
 * the signature and verification timestamp. Status `paid` alone is not proof.
 */
export function isVerifiedPaidPayment(request: PaymentRequest): boolean {
  return isVerifiedPayment(request);
}

function parseLamports(value: string): bigint {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    throw new Error("A stored payment amount is not a whole number of lamports.");
  }

  return BigInt(trimmed);
}

export function buildDashboardSummary(
  requests: readonly PaymentRequest[],
): DashboardSummary {
  // The same shared aggregation backs Telegram `/summary`, so both surfaces
  // report identical confirmed, pending, closed and revenue figures.
  const totals = summarizePayments(requests);
  const totalReceivedLamports = totals.verifiedLamports;
  const successfulPayments = totals.verifiedCount;
  const pendingPayments = totals.pendingCount;

  // Pending requests are open work, so they must be visible even when older
  // than the newest rows. Fill the activity list with pending first, then the
  // most recent remaining requests; failed/expired/cancelled keep their own
  // status and are never presented as pending.
  const activityRequests = [
    ...requests.filter((request) => request.status === "pending"),
    ...requests.filter((request) => request.status !== "pending"),
  ].slice(0, DASHBOARD_ACTIVITY_LIMIT);

  return {
    stats: [
      {
        id: "total-received",
        label: "Total received",
        value: formatSolExact(totalReceivedLamports),
        unit: "SOL",
        hint: "Independently verified payments",
      },
      {
        id: "successful-payments",
        label: "Confirmed payments",
        value: successfulPayments.toLocaleString("en-US"),
        hint: "Independently verified",
      },
      {
        id: "pending-payments",
        label: "Pending payments",
        value: pendingPayments.toLocaleString("en-US"),
        hint: "Awaiting payment",
      },
      {
        id: "payment-requests",
        label: "Payment requests",
        value: requests.length.toLocaleString("en-US"),
        hint: "All requests",
      },
    ],
    activity: activityRequests.map((request) => ({
      id: request.id,
      reference: request.reference,
      description: request.description,
      amountSol: formatSolExact(parseLamports(request.amountLamports)),
      customerName: request.customerName,
      status: request.status,
      createdAt: request.createdAt,
      transactionSignature: request.transactionSignature,
      payerAddress: request.payerAddress,
    })),
  };
}
