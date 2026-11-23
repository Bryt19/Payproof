import type { PaymentRequest } from "../payment-requests/types";
import {
  isVerifiedPayment,
  summarizePayments,
} from "../../../telegram-bot/src/lib/payment-summary";

export type TimeRange = "7d" | "30d" | "90d";

export type BreakdownCategory = "confirmed" | "pending" | "failedCancelled";

/**
 * Category colors for the dashboard breakdown, keyed by category so a row can
 * never inherit another row's color by position. Failed/Cancelled is red.
 */
export const BREAKDOWN_COLORS: Record<BreakdownCategory, string> = {
  confirmed: "#14F195",
  pending: "#fbbf24",
  failedCancelled: "#EF4444",
};

type PaymentLike = {
  status: PaymentRequest["status"];
  amountLamports: string;
  verifiedAt: string | null;
  transactionSignature: string | null;
  payerAddress: string | null;
};

function asPaymentLike(value: PaymentRequest): PaymentLike {
  return {
    status: value.status,
    amountLamports: value.amountLamports,
    verifiedAt: value.verifiedAt,
    transactionSignature: value.transactionSignature,
    payerAddress: value.payerAddress,
  };
}

function isVerifiedPaidPaymentLike(value: PaymentLike): boolean {
  return isVerifiedPayment(value);
}

/**
 * Payment volume broken into per-day buckets for a requested range.
 *
 * Only payments that have been independently verified on-chain contribute to the
 * volume series, matching the dashboard's verified-revenue semantics.
 */
export function buildVolumeSeriesFromRequests(
  requests: readonly PaymentRequest[],
  range: TimeRange,
): readonly VolumePoint[] {
  return buildVolumeSeriesFromPayables(requests.map(asPaymentLike), range);
}

function buildVolumeSeriesFromPayables(
  items: readonly PaymentLike[],
  range: TimeRange,
): readonly VolumePoint[] {
  const cutoff = nowUtc().getTime() - rangeMs(range);

  const byDay = new Map<number, bigint>();

  for (const item of items) {
    if (!isVerifiedPaidPaymentLike(item)) continue;
    if (!item.verifiedAt) continue;

    const ts = new Date(item.verifiedAt).getTime();
    if (ts < cutoff) continue;

    const day = utcDay(ts);
    const current = byDay.get(day) ?? 0n;
    byDay.set(day, current + parseLamports(item.amountLamports));
  }

  const sortedDays = [...byDay.keys()].sort((a, b) => a - b);
  const points: VolumePoint[] = [];

  for (const day of sortedDays) {
    const lamports = byDay.get(day) ?? 0n;
    const date = new Date(day);
    points.push({
      date: date.toISOString().slice(0, 10),
      // Strings, not bigints: the series crosses the RSC boundary and JSON,
      // neither of which can serialise BigInt.
      value: lamports.toString(),
      valueSol: (lamports / 1_000_000_000n).toString(),
    });
  }

  return points;
}

/**
 * Status breakdown for all payment requests in the merchant's account.
 *
 * Three categories only: Confirmed (verified paid), Pending, and
 * Failed/Cancelled (failed + cancelled + expired). Expired requests roll into
 * Failed/Cancelled instead of getting a fourth category; their individual
 * status is preserved everywhere else. The total and percentages cover exactly
 * these three categories so the rows always add up to the displayed total.
 */
export function buildStatusBreakdownFromRequests(
  requests: readonly PaymentRequest[],
): StatusBreakdown {
  return buildStatusBreakdownFromPayables(requests.map(asPaymentLike));
}

function buildStatusBreakdownFromPayables(
  items: readonly PaymentLike[],
): StatusBreakdown {
  // Shared with the Telegram summary so the dashboard breakdown and /summary
  // cannot disagree about confirmed, pending or closed requests.
  const totals = summarizePayments(items);
  const confirmed = totals.verifiedCount;
  const pending = totals.pendingCount;
  const failedCancelled = totals.failedCount;

  const total = confirmed + pending + failedCancelled;

  return {
    confirmed,
    pending,
    failedCancelled,
    total,
    confirmedPct: safePct(confirmed, total),
    pendingPct: safePct(pending, total),
    failedCancelledPct: safePct(failedCancelled, total),
  };
}

/** Legacy names kept for backwards compatibility with existing imports. */
export const buildVolumeSeries = buildVolumeSeriesFromRequests;
export const buildStatusBreakdown = buildStatusBreakdownFromRequests;

export type VolumePoint = {
  date: string;
  /** Verified volume for the day in lamports, as an integer string. */
  value: string;
  /** Verified volume for the day in whole SOL, as a string. */
  valueSol: string;
};

export type StatusBreakdown = {
  confirmed: number;
  pending: number;
  failedCancelled: number;
  total: number;
  confirmedPct: number;
  pendingPct: number;
  failedCancelledPct: number;
};

function rangeMs(range: TimeRange): number {
  const day = 24 * 60 * 60 * 1000;
  return day * (range === "7d" ? 7 : range === "30d" ? 30 : 90);
}

function nowUtc(): Date {
  return new Date();
}

function utcDay(ts: number): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function parseLamports(value: string): bigint {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    throw new Error("A stored payment amount is not a whole number of lamports.");
  }

  return BigInt(trimmed);
}

function safePct(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}
