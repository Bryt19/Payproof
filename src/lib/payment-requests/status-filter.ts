/**
 * Shared filter controls for request lists.
 *
 * `PaymentStatusFilter` is a payment-status bucket (All / Paid / Pending /
 * Failed-Expired). `failed` bundles expired and cancelled. Kept here so the
 * request list and the payments table both use one definition.
 */
export type PaymentStatusFilter = "all" | "paid" | "pending" | "failed";
export type StatusCounts = Record<PaymentStatusFilter, number | null>;
export const filterOptions: { value: PaymentStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed-Expired" },
];

export type StatusBadgeStatus = Exclude<import("./types").PaymentRequestStatus, "expired" | "cancelled"> | "failed";
