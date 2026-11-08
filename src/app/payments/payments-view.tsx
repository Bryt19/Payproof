"use client";

import { useEffect, useState, useCallback } from "react";
import type { PaymentRequest } from "@/lib/payment-requests/types";
import { formatSolExact } from "@/lib/solana/units";
import DashboardShell from "@/components/dashboard/dashboard-shell";
import TransactionTable, {
  type PaymentStatusFilter,
  type StatusCounts,
} from "./transaction-table";
import TransactionDetailsModal from "./transaction-details-modal";
import PaymentsOverview, { type PaymentsSummary } from "./payments-overview";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "loaded";
      payments: readonly PaymentRequest[];
      total: number;
      summary: PaymentsSummary;
    }
  | { status: "error"; message: string };

const SEARCH_DEBOUNCE_MS = 250;

const EMPTY_SUMMARY: PaymentsSummary = {
  verifiedCount: 0,
  totalVerifiedSol: "0",
  pendingCount: 0,
  failedCount: 0,
  totalSolHint: "Verified revenue",
};

export default function PaymentsView() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [selectedPayment, setSelectedPayment] =
    useState<PaymentRequest | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PaymentStatusFilter>("all");
  const [counts, setCounts] = useState<StatusCounts | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  // Debounce typing so the server is not queried on every keystroke.
  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearch(searchQuery.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchCounts = useCallback(async (search: string) => {
    const buckets: PaymentStatusFilter[] = [
      "all",
      "paid",
      "pending",
      "failed",
    ];

    try {
      const entries = await Promise.all(
        buckets.map(async (bucket) => {
          const params = new URLSearchParams({ status: bucket, limit: "1" });
          if (search) params.set("search", search);

          const response = await fetch(`/api/payments?${params.toString()}`, {
            cache: "no-store",
          });
          if (!response.ok) return [bucket, null] as const;

          const payload = await response.json();
          return [
            bucket,
            typeof payload.total === "number" ? payload.total : null,
          ] as const;
        }),
      );

      setCounts(Object.fromEntries(entries) as StatusCounts);
    } catch {
      // Counts are a nicety; the filter still works without them.
      setCounts(null);
    }
  }, []);

  const fetchData = useCallback(async () => {
    // Keep the table mounted on re-queries so typing in search never flashes a
    // skeleton or loses input focus.
    setLoadState((current) =>
      current.status === "loaded" ? current : { status: "loading" },
    );
    setIsFetching(true);

    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(`/api/payments?${params.toString()}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Could not load payments.");
      }

      const data = await res.json();

      let totalVerifiedLamports = 0n;
      let successfulCount = 0;
      let pendingCount = 0;
      let failedCount = 0;

      for (const payment of data.payments as PaymentRequest[]) {
        if (payment.status === "paid") {
          successfulCount += 1;
          if (
            payment.transactionSignature !== null &&
            payment.payerAddress !== null &&
            payment.verifiedAt !== null
          ) {
            totalVerifiedLamports += BigInt(payment.amountLamports);
          }
        } else if (payment.status === "pending") {
          pendingCount += 1;
        } else if (
          payment.status === "expired" ||
          payment.status === "cancelled"
        ) {
          failedCount += 1;
        }
      }

      setLoadState({
        status: "loaded",
        payments: data.payments,
        total: data.total,
        summary: {
          verifiedCount: successfulCount,
          totalVerifiedSol: formatSolExact(totalVerifiedLamports),
          pendingCount,
          failedCount,
          totalSolHint:
            totalVerifiedLamports === 0n
              ? "No verified revenue yet"
              : "Verified revenue",
        },
      });

      void fetchCounts(debouncedSearch);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not load payments.";

      setLoadState((current) =>
        current.status === "loaded" ? current : { status: "error", message },
      );
    } finally {
      setIsFetching(false);
    }
  }, [debouncedSearch, statusFilter, fetchCounts]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const clearFilters = () => {
    setSearchQuery("");
    setDebouncedSearch("");
    setStatusFilter("all");
  };

  const summary =
    loadState.status === "loaded" ? loadState.summary : EMPTY_SUMMARY;

  return (
    <DashboardShell
      title="Payments"
      description="Verified Solana payments received through Payproof."
    >
      <div className="space-y-6">
        {/* Page header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1
              className="text-xl font-bold tracking-tight text-white sm:text-2xl"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              Payments
            </h1>
            <p className="mt-1 max-w-xl text-sm text-white/50">
              Every payment here is matched to a request and verified against
              Solana Devnet before it counts as received.
            </p>
          </div>
        </div>

        {/* Verification notice */}
        <div className="flex items-start gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-xs text-white/70">
          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#9945FF]" />
          <span>
            Paid amounts only count after independent on-chain verification.
            Pending, expired and cancelled requests are excluded from totals.
          </span>
        </div>

        {/* Error state */}
        {loadState.status === "error" && (
          <div
            role="alert"
            className="rounded-xl border border-red-400/30 bg-red-400/10 px-5 py-6"
          >
            <h2 className="text-sm font-semibold text-red-100">
              Payments unavailable
            </h2>
            <p className="mt-1 max-w-xl text-sm text-red-200/80">
              {loadState.message}
            </p>
            <button
              type="button"
              onClick={() => void fetchData()}
              className="mt-4 rounded-xl border border-red-400/30 px-3.5 py-2 text-xs font-medium text-red-100 hover:bg-red-400/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Retry
            </button>
          </div>
        )}

        {/* Overview */}
        {loadState.status === "idle" || loadState.status === "loading" ? (
          <div className="kpi-grid grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            {[1, 2, 3, 4].map((card) => (
              <div
                key={card}
                className="h-32 animate-pulse rounded-2xl border border-white/[0.08] p-5"
                style={{ background: "#0E0E12" }}
              />
            ))}
          </div>
        ) : loadState.status === "loaded" ? (
          <PaymentsOverview summary={summary} isRefreshing={isFetching} />
        ) : null}

        {/* Transaction list */}
        {loadState.status === "idle" || loadState.status === "loading" ? (
          <div
            className="space-y-3 rounded-2xl border border-white/[0.08] p-6"
            style={{ background: "#0E0E12" }}
          >
            {[1, 2, 3, 4, 5].map((row) => (
              <div
                key={row}
                className="h-16 animate-pulse rounded-xl border border-white/[0.04] bg-white/[0.02]"
              />
            ))}
          </div>
        ) : loadState.status === "loaded" ? (
          <TransactionTable
            payments={loadState.payments}
            onSelectPayment={setSelectedPayment}
            filters={{
              status: statusFilter,
              counts,
              search: searchQuery,
              onStatusChange: setStatusFilter,
              onSearchChange: setSearchQuery,
              onRefresh: () => void fetchData(),
              onClearFilters: clearFilters,
              isFetching,
            }}
          />
        ) : null}
      </div>

      {/* Transaction details modal */}
      {selectedPayment && (
        <TransactionDetailsModal
          payment={selectedPayment}
          onClose={() => setSelectedPayment(null)}
        />
      )}
    </DashboardShell>
  );
}
