import type { PaymentRequest } from "../payment-requests/types";

export type TimeRange = "7d" | "30d" | "90d";

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
  return (
    value.status === "paid" &&
    value.transactionSignature !== null &&
    value.payerAddress !== null &&
    value.verifiedAt !== null
  );
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
 * "Failed/Expired" groups expired and cancelled requests so the chart can show
 * the three statuses the dashboard UI already exposes: Confirmed, Pending,
 * Failed/Expired.
 */
export function buildStatusBreakdownFromRequests(
  requests: readonly PaymentRequest[],
): StatusBreakdown {
  return buildStatusBreakdownFromPayables(requests.map(asPaymentLike));
}

function buildStatusBreakdownFromPayables(items: readonly PaymentLike[]): StatusBreakdown {
  let pending = 0;
  let verified = 0;
  let failedExpired = 0;

  for (const item of items) {
    if (item.status === "pending") {
      pending += 1;
    } else if (isVerifiedPaidPaymentLike(item)) {
      verified += 1;
    } else {
      failedExpired += 1;
    }
  }

  const total = pending + verified + failedExpired;

  return {
    confirmed: verified,
    pending,
    failedExpired,
    total,
    confirmedPct: safePct(verified, total),
    pendingPct: safePct(pending, total),
    failedExpiredPct: safePct(failedExpired, total),
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
  failedExpired: number;
  total: number;
  confirmedPct: number;
  pendingPct: number;
  failedExpiredPct: number;
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

function isVerifiedPaid(request: PaymentRequest): boolean {
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

function safePct(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}
