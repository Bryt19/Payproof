/** @jsxImportSource react */

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

function mapStatus(status: import("./types").PaymentRequestStatus): StatusBadgeStatus {
  if (status === "expired" || status === "cancelled") {
    return "failed";
  }
  return status as StatusBadgeStatus;
}

type StatusBadgeProps = {
  status: import("./types").PaymentRequestStatus;
  abbreviate?: boolean;
};

function StatusBadge({ status, abbreviate }: StatusBadgeProps) {
  const mapped = mapStatus(status);
  const label = abbreviate
    ? mapped.charAt(0).toUpperCase()
    : mapped.charAt(0).toUpperCase() + mapped.slice(1);

  const borderColor =
    mapped === "paid"
      ? "border-accent/40"
      : mapped === "pending"
      ? "border-amber-400/25"
      : "border-red-400/25";
  const bg =
    mapped === "paid"
      ? "bg-accent/10"
      : mapped === "pending"
      ? "bg-amber-400/10"
      : "bg-red-400/10";
  const textColor =
    mapped === "paid" ? "text-accent" : mapped === "pending" ? "text-amber-300" : "text-red-300";
  const dotColor =
    mapped === "paid" ? "bg-accent" : mapped === "pending" ? "bg-amber-300" : "bg-red-300";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${borderColor} ${bg} ${textColor}`}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${dotColor}`}
      />
      {label}
    </span>
  );
}

export { StatusBadge };
