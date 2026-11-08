"use client";

import type { PaymentRequest } from "@/lib/payment-requests/types";
import { shortenAddress } from "@/lib/solana/address";
import { formatSolExact } from "@/lib/solana/units";
import { getDevnetTransactionExplorerUrl } from "@/lib/solana/payment";
import {
  CheckIcon,
  CloseIcon,
  ExternalLinkIcon,
  PendingIcon,
  SearchIcon,
} from "@/components/dashboard/icons";

/** The four buckets the filter exposes; `failed` covers expired and cancelled. */
export type PaymentStatusFilter = "all" | "paid" | "pending" | "failed";

export type StatusCounts = Record<PaymentStatusFilter, number | null>;

export type TransactionFilters = {
  status: PaymentStatusFilter;
  counts: StatusCounts | null;
  search: string;
  onStatusChange: (value: PaymentStatusFilter) => void;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  onClearFilters: () => void;
  /** True while a background re-query runs; the table stays visible. */
  isFetching?: boolean;
};

type TransactionTableProps = {
  payments: readonly PaymentRequest[];
  onSelectPayment: (payment: PaymentRequest) => void;
  filters: TransactionFilters;
};

const FILTERS: readonly { value: PaymentStatusFilter; label: string }[] = [
  { value: "all", label: "All payments" },
  { value: "paid", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed / Expired" },
];

const statusStyles: Record<
  PaymentRequest["status"],
  { label: string; bg: string; text: string; dot: string }
> = {
  paid: {
    label: "Paid",
    bg: "rgba(20,241,149,0.08)",
    text: "#14F195",
    dot: "#14F195",
  },
  pending: {
    label: "Pending",
    bg: "rgba(251,191,36,0.08)",
    text: "#fbbf24",
    dot: "#fbbf24",
  },
  expired: {
    label: "Expired",
    bg: "rgba(255,255,255,0.03)",
    text: "rgba(255,255,255,0.4)",
    dot: "#737373",
  },
  cancelled: {
    label: "Cancelled",
    bg: "rgba(255,255,255,0.03)",
    text: "rgba(255,255,255,0.4)",
    dot: "#737373",
  },
};

const createdAtFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : createdAtFormatter.format(date);
}

function StatusPill({ status }: { status: PaymentRequest["status"] }) {
  const style = statusStyles[status];

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: style.bg, color: style.text }}
    >
      {status === "paid" && <CheckIcon className="size-3" />}
      {status === "pending" && (
        <span
          aria-hidden="true"
          className="size-1.5 animate-pulse rounded-full"
          style={{ background: style.dot }}
        />
      )}
      {status !== "paid" && status !== "pending" && (
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full"
          style={{ background: style.dot }}
        />
      )}
      {style.label}
    </span>
  );
}

function explorerUrlFor(payment: PaymentRequest): string | undefined {
  return payment.transactionSignature !== null
    ? getDevnetTransactionExplorerUrl(payment.transactionSignature)
    : undefined;
}

export default function TransactionTable({
  payments,
  onSelectPayment,
  filters,
}: TransactionTableProps) {
  const hasActiveFilters =
    filters.search.trim() !== "" || filters.status !== "all";

  return (
    <section
      aria-label="Payment transactions"
      className="rounded-2xl border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
      style={{ background: "#0E0E12" }}
    >
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-white/[0.08] p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-white">Transactions</h2>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.06] px-2 py-0.5 text-xs text-white/60">
              {payments.length} shown
            </span>
          </div>
          <p className="mt-1 text-xs text-white/50">
            Click a row to view full transaction details.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 sm:w-64 sm:flex-initial">
            <label htmlFor="payments-search" className="sr-only">
              Search payments
            </label>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
            <input
              id="payments-search"
              type="search"
              value={filters.search}
              onChange={(event) => filters.onSearchChange(event.target.value)}
              placeholder="Search reference, description…"
              autoComplete="off"
              className="h-11 w-full rounded-xl border border-white/[0.1] sm:h-10 bg-white/[0.03] pl-9 pr-8 text-xs text-white placeholder:text-white/35 focus:border-[#9945FF]/60 focus:bg-white/[0.05] focus:outline-none focus:ring-1 focus:ring-[#9945FF]"
            />
            {filters.search !== "" && (
              <button
                type="button"
                onClick={() => filters.onSearchChange("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 transition-colors hover:text-white"
              >
                <CloseIcon className="size-3.5" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={filters.onRefresh}
            disabled={filters.isFetching}
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-white/[0.1] sm:h-10 bg-white/[0.03] px-3.5 text-xs font-medium text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
          >
            <svg
              className={`size-3.5 ${filters.isFetching ? "animate-spin text-[#9945FF]" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            <span>{filters.isFetching ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-black/20 px-5 py-3 sm:px-6">
        {FILTERS.map((option) => {
          const isActive = filters.status === option.value;
          const count = filters.counts?.[option.value];

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => filters.onStatusChange(option.value)}
              aria-pressed={isActive}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-medium transition-all duration-150 sm:min-h-0 ${
                isActive
                  ? "bg-[#9945FF] text-white shadow-[0_0_16px_rgba(153,69,255,0.4)]"
                  : "text-white/60 hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              <span>{option.label}</span>
              {typeof count === "number" && (
                <span
                  className={`rounded-full px-1.5 text-[10px] font-mono ${
                    isActive
                      ? "bg-black/30 text-white"
                      : "bg-white/[0.08] text-white/50"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}

        {hasActiveFilters && (
          <button
            type="button"
            onClick={filters.onClearFilters}
            className="ml-auto rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
          >
            Clear filters
          </button>
        )}
      </div>

      {payments.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl border border-white/[0.1] bg-white/[0.03] text-white/40 shadow-inner">
            <PendingIcon className="size-6 text-[#9945FF]" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-white">
            {hasActiveFilters ? "No matching payments" : "No payments yet"}
          </h3>
          <p className="mt-1 max-w-sm text-xs text-white/50">
            {hasActiveFilters
              ? "Try adjusting your search keywords or switching filters to view your payments."
              : "Payments appear here once a payment request is settled on-chain."}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={filters.onClearFilters}
              className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-white hover:bg-white/[0.08]"
            >
              Reset filters
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden xl:block">
            <table className="w-full min-w-[880px] text-left text-xs">
              <caption className="sr-only">
                Payment transactions with reference, description, amount, payer,
                recipient, date, status and actions.
              </caption>

              <thead className="border-b border-white/[0.06] bg-black/10 text-[11px] uppercase tracking-wider text-white/40">
                <tr>
                  <th scope="col" className="py-3.5 pl-6 pr-3 font-medium">
                    Reference
                  </th>
                  <th scope="col" className="px-3 py-3.5 font-medium">
                    Description
                  </th>
                  <th scope="col" className="px-3 py-3.5 font-medium">
                    Amount
                  </th>
                  <th scope="col" className="px-3 py-3.5 font-medium">
                    Payer / Recipient
                  </th>
                  <th scope="col" className="px-3 py-3.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-3.5 font-medium">
                    Date
                  </th>
                  <th
                    scope="col"
                    className="py-3.5 pl-3 pr-6 text-right font-medium"
                  >
                    Actions
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/[0.04]">
                {payments.map((payment) => (
                  <tr
                    key={payment.id}
                    onClick={() => onSelectPayment(payment)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectPayment(payment);
                      }
                    }}
                    aria-label={`View details for ${payment.reference}`}
                    className="group cursor-pointer transition-colors duration-150 hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                  >
                    <td className="py-4 pl-6 pr-3 align-middle">
                      <p className="font-mono text-xs font-medium text-white transition-colors group-hover:text-[#C14BF0]">
                        {payment.reference.slice(0, 10)}…
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-white/40">
                        {payment.id}
                      </p>
                    </td>

                    <td className="max-w-[240px] px-3 py-4 align-middle">
                      <p className="truncate text-white/90">
                        {payment.description}
                      </p>
                      {payment.customerName && (
                        <p className="mt-0.5 truncate text-[11px] text-white/45">
                          {payment.customerName}
                          {payment.customerEmail
                            ? ` · ${payment.customerEmail}`
                            : ""}
                        </p>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-3 py-4 align-middle">
                      <div className="font-mono text-sm font-bold tracking-tight text-white">
                        {formatSolExact(BigInt(payment.amountLamports))}
                        <span className="ml-1 text-xs font-normal text-white/50">
                          SOL
                        </span>
                      </div>
                      <span className="text-[10px] text-white/40">Devnet</span>
                    </td>

                    <td className="whitespace-nowrap px-3 py-4 align-middle">
                      <p className="font-mono text-xs text-white/85">
                        {payment.payerAddress
                          ? shortenAddress(payment.payerAddress)
                          : "—"}
                      </p>
                      <p className="mt-0.5 font-mono text-[10px] text-white/35">
                        {payment.merchantAddress
                          ? shortenAddress(payment.merchantAddress)
                          : "—"}
                      </p>
                    </td>

                    <td className="whitespace-nowrap px-3 py-4 align-middle">
                      <StatusPill status={payment.status} />
                    </td>

                    <td className="whitespace-nowrap px-3 py-4 align-middle text-white/50">
                      {formatCreatedAt(payment.createdAt)}
                    </td>

                    <td className="py-4 pl-3 pr-6 align-middle text-right">
                      {payment.transactionSignature ? (
                        <a
                          href={explorerUrlFor(payment)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          title="View on Solana Explorer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-white/80 transition-colors hover:border-[#14F195]/40 hover:text-[#14F195] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        >
                          <ExternalLinkIcon className="size-3.5" />
                          View TX
                        </a>
                      ) : (
                        <span className="text-xs text-white/30">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="divide-y divide-white/[0.06] xl:hidden">
            {payments.map((payment) => (
              <div
                key={payment.id}
                onClick={() => onSelectPayment(payment)}
                className="flex cursor-pointer flex-col gap-3 p-5 transition-colors hover:bg-white/[0.02]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-white">
                      {payment.reference.slice(0, 12)}…
                    </p>
                    <p className="font-mono text-[10px] text-white/40">
                      {payment.id} · {formatCreatedAt(payment.createdAt)}
                    </p>
                  </div>
                  <StatusPill status={payment.status} />
                </div>

                <p className="line-clamp-2 text-xs font-medium text-white/90">
                  {payment.description}
                </p>

                <div className="flex items-center justify-between border-t border-white/[0.04] pt-1">
                  <div>
                    <p className="font-mono text-base font-bold text-white">
                      {formatSolExact(BigInt(payment.amountLamports))}
                      <span className="ml-1 text-xs font-normal text-white/50">
                        SOL
                      </span>
                    </p>
                    <p className="text-[11px] text-white/50">
                      {payment.customerName || "Direct request"}
                    </p>
                  </div>

                  {payment.transactionSignature && (
                    <a
                      href={explorerUrlFor(payment)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.08] sm:min-h-0"
                    >
                      <ExternalLinkIcon className="size-3.5" />
                      TX
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] px-5 py-3 sm:px-6">
            <p className="text-[11px] text-white/35">
              Showing {payments.length} payment{payments.length !== 1 ? "s" : ""}.
              Status reflects independent on-chain verification.
            </p>
            {filters.isFetching && (
              <span
                role="status"
                className="shrink-0 text-[11px] text-white/45"
              >
                Updating…
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
