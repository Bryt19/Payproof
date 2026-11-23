import type { PaymentRequestStatus } from "./types";

/**
 * Shared status-bucket rules for request lists.
 *
 * `failed` is a bucket, not just a status: it includes real `failed` requests
 * (attempt limit reached) plus `expired` and `cancelled` ones. A request that
 * exhausted its payment attempts must never disappear from a filtered list.
 */
export type PaymentStatusFilter = "all" | "paid" | "pending" | "failed";

export function matchesStatusBucket(
  status: PaymentRequestStatus,
  bucket: PaymentStatusFilter,
): boolean {
  if (bucket === "all") return true;
  if (bucket === "paid") return status === "paid";
  if (bucket === "pending") return status === "pending";
  return status === "failed" || status === "expired" || status === "cancelled";
}

/** The bucket a single status belongs to (never "all"). */
export function bucketForStatus(
  status: PaymentRequestStatus,
): Exclude<PaymentStatusFilter, "all"> {
  if (status === "paid") return "paid";
  if (status === "pending") return "pending";
  return "failed";
}
