/**
 * Shared filter controls for request lists.
 *
 * `PaymentStatusFilter` is a payment-status bucket (All / Paid / Pending /
 * Failed-Expired). `failed` bundles failed, expired and cancelled. The bucket
 * rules live in `status-bucket.ts` so both client components and server code
 * can import one definition without a `.ts`/`.tsx` module ambiguity.
 */
export type { PaymentStatusFilter } from "./status-bucket";
export {
  bucketForStatus,
  matchesStatusBucket,
} from "./status-bucket";

import type { PaymentStatusFilter } from "./status-bucket";

export type StatusCounts = Record<PaymentStatusFilter, number | null>;
export const filterOptions: { value: PaymentStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed-Expired" },
];

export type StatusBadgeStatus = Exclude<import("./types").PaymentRequestStatus, "expired" | "cancelled"> | "failed";
