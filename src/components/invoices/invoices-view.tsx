"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardShell from "@/components/dashboard/dashboard-shell";
import type { Invoice, InvoiceStatus } from "@/lib/invoices/types";
import InvoicesOverview, {
  type InvoiceOverviewCounts,
} from "@/components/invoices/invoices-overview";
import InvoiceTable from "@/components/invoices/invoice-table";
import { InvoiceDetailsDialog } from "@/components/invoices/invoice-details-dialog";
import CreateFab from "@/components/ui/create-fab";
import { InvoicesIcon, PlusIcon, SearchIcon } from "@/components/dashboard/icons";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";

/**
 * Invoices UI backed by real `payment_requests` records from Supabase.
 * - Fetches via `/api/invoices` (server-side, service-role).
 * - Statuses reflect the database (paid only after server-side on-chain verification).
 * - Metrics are calculated from database records; no mock/fallback values.
 * - Search/filters/sort operate on real fetched records.
 */

type FilterStatus = "all" | InvoiceStatus;

const FILTER_OPTIONS: ReadonlyArray<{ value: FilterStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

const LIMIT = 50;

type SortOption = "newest" | "oldest";

const EMPTY_SUMMARY: InvoiceOverviewCounts = {
  total: 0,
  paid: 0,
  pending: 0,
  totalPaidLamports: "0",
};

function parseSummary(value: unknown): InvoiceOverviewCounts {
  if (!value || typeof value !== "object") return EMPTY_SUMMARY;
  const v = value as Record<string, unknown>;
  return {
    total: typeof v.total === "number" ? v.total : 0,
    paid: typeof v.paid === "number" ? v.paid : 0,
    pending: typeof v.pending === "number" ? v.pending : 0,
    totalPaidLamports:
      typeof v.totalPaidLamports === "string" ? v.totalPaidLamports : "0",
  };
}

function buildQuery(params: {
  search: string;
  status: FilterStatus;
  sort: SortOption;
}): string {
  const query = new URLSearchParams();
  if (params.search.trim()) query.set("search", params.search.trim());
  if (params.status !== "all") query.set("status", params.status);
  query.set("sortField", "created_at");
  query.set("sortDirection", params.sort === "newest" ? "desc" : "asc");
  query.set("limit", String(LIMIT));
  query.set("offset", "0");
  return query.toString();
}

export default function InvoicesView() {
  const router = useRouter();
  const { address } = useWalletAuth();

  const [invoices, setInvoices] = useState<readonly Invoice[]>([]);
  const [summary, setSummary] = useState<InvoiceOverviewCounts>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [sort, setSort] = useState<SortOption>("newest");
  const [selected, setSelected] = useState<Invoice | null>(null);

  const latestRequest = useRef(0);

  const fetchInvoices = useCallback(async () => {
    const merchant = typeof address === "string" ? address.trim() : "";
    if (!merchant) {
      setInvoices([]);
      setSummary(EMPTY_SUMMARY);
      setLoading(false);
      return;
    }

    const requestId = ++latestRequest.current;
    setLoading(true);
    setError(null);

    try {
      const qs = buildQuery({ search: searchQuery, status: statusFilter, sort });
      const query = new URLSearchParams(qs);
      query.set("merchantAddress", merchant);
      const response = await fetch(`/api/invoices?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as {
        invoices?: Invoice[];
        summary?: unknown;
        error?: string;
      };

      if (requestId !== latestRequest.current) return;

      if (!response.ok) {
        setInvoices([]);
        setSummary(parseSummary(data.summary));
        setError(
          typeof data.error === "string" && data.error.trim().length > 0
            ? data.error
            : "Could not load invoices.",
        );
        return;
      }

      setInvoices(Array.isArray(data.invoices) ? data.invoices : []);
      setSummary(parseSummary(data.summary));
    } catch {
      if (requestId !== latestRequest.current) return;
      setInvoices([]);
      setError("Could not load invoices. Check your connection and try again.");
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [address, searchQuery, statusFilter, sort]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchInvoices();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchInvoices]);

  const statusCounts = useMemo(() => {
    const counts: Record<FilterStatus, number> = {
      all: summary.total,
      pending: summary.pending,
      paid: summary.paid,
      expired: 0,
      cancelled: 0,
    };
    // Expired/cancelled counts aren't shown as primary cards but filters can show list totals.
    // Keep chips simple; list total is in the header from summary.
    return counts;
  }, [summary]);

  function goCreate() {
    router.push("/payment-requests");
  }

  return (
    <DashboardShell
      title="Invoices"
      description="Payment requests shown as invoices, with status from verified database records."
      showRefresh
      onRefresh={() => void fetchInvoices()}
      isRefreshing={loading}
    >
      <div className="flex flex-col gap-4 sm:gap-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight text-white sm:text-xl">
              Invoices
            </h2>
            <p className="mt-0.5 text-xs text-white/50">
              Payment requests shown as invoices, backed by real database records.
              Status reflects server-verified on-chain payments.
            </p>
          </div>

          <button
            type="button"
            onClick={goCreate}
            className="btn-brand-gradient hidden min-h-11 items-center justify-center gap-2 self-start rounded-3xl px-5 py-2.5 text-xs font-semibold text-white shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] sm:inline-flex sm:self-auto"
          >
            <PlusIcon className="size-4" />
            New payment request
          </button>
        </div>

        <InvoicesOverview counts={summary} isRefreshing={loading} />

        <section
          aria-labelledby="invoice-table-heading"
          className="rounded-2xl border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
          style={{ background: "#0E0E12" }}
        >
          <div className="flex flex-col gap-3 border-b border-white/[0.06] px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3
                id="invoice-table-heading"
                className="font-display text-sm font-semibold tracking-tight text-white"
              >
                All invoices
              </h3>
              <p className="mt-0.5 font-mono text-[11px] text-white/40">
                {summary.total} record{summary.total !== 1 ? "s" : ""}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 sm:w-60 sm:flex-initial">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search reference, customer…"
                  aria-label="Search invoices"
                  className="h-11 w-full rounded-3xl border border-white/[0.1] bg-white/[0.03] pl-9 pr-3 text-xs text-white placeholder:text-white/35 focus:border-[#9945FF]/60 focus:bg-white/[0.05] focus:outline-none focus:ring-1 focus:ring-[#9945FF] sm:h-10"
                />
              </div>

              <label htmlFor="invoice-sort" className="sr-only">
                Sort invoices
              </label>
              <select
                id="invoice-sort"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortOption)}
                className="h-10 rounded-3xl border border-white/[0.18] bg-white/[0.07] px-3 text-xs font-medium text-white focus:border-[#9945FF]/60 focus:bg-white/[0.1] focus:outline-none focus:ring-1 focus:ring-[#9945FF]"
              >
                <option value="newest" className="bg-[#0E0E12] text-white">
                  Newest first
                </option>
                <option value="oldest" className="bg-[#0E0E12] text-white">
                  Oldest first
                </option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto border-b border-white/[0.04] px-5 py-2.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div
              className="flex w-max min-w-full gap-1.5"
              role="group"
              aria-label="Filter by status"
            >
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatusFilter(opt.value)}
                  aria-pressed={statusFilter === opt.value}
                  className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-medium transition-all duration-150 sm:min-h-0 ${
                    statusFilter === opt.value
                      ? "bg-white text-black shadow-sm"
                      : "bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white"
                  }`}
                >
                  {opt.label}
                  {opt.value !== "all" && statusCounts[opt.value] > 0 ? (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                        statusFilter === opt.value
                          ? "bg-black/10 text-black/70"
                          : "bg-white/[0.08] text-white/50"
                      }`}
                    >
                      {statusCounts[opt.value]}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <div>
            {loading ? (
              <div className="space-y-2 p-5" aria-busy="true" aria-label="Loading invoices">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-xl border border-white/[0.04] bg-white/[0.02]"
                  />
                ))}
              </div>
            ) : error ? (
              <div className="flex flex-col items-center px-6 py-14 text-center">
                <p className="max-w-sm text-sm text-red-300">{error}</p>
                <button
                  type="button"
                  onClick={() => void fetchInvoices()}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/[0.05] px-4 py-2 text-xs font-medium text-white hover:bg-white/[0.1]"
                >
                  Try again
                </button>
              </div>
            ) : invoices.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-16 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl border border-white/[0.1] bg-white/[0.03] text-white/40 shadow-inner">
                  <InvoicesIcon className="size-7" />
                </div>
                <h4 className="mt-4 font-display text-sm font-semibold text-white">
                  {searchQuery || statusFilter !== "all"
                    ? "No matching invoices"
                    : "No invoices yet"}
                </h4>
                <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-white/45">
                  {searchQuery || statusFilter !== "all"
                    ? "Try adjusting your search or status filter."
                    : "Create a payment request to generate a real, verifiable invoice record."}
                </p>
                {!searchQuery && statusFilter === "all" ? (
                  <button
                    type="button"
                    onClick={goCreate}
                    className="btn-brand-gradient mt-5 inline-flex min-h-11 items-center gap-2 rounded-3xl px-5 py-2.5 text-xs font-semibold text-white shadow-lg sm:min-h-0"
                  >
                    <PlusIcon className="size-4" />
                    Create payment request
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setStatusFilter("all");
                    }}
                    className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-white hover:bg-white/[0.08]"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              <InvoiceTable invoices={invoices} onView={setSelected} />
            )}
          </div>
        </section>
      </div>

      <InvoiceDetailsDialog
        invoice={selected}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />

      <CreateFab onClick={goCreate} label="Create payment request" />
    </DashboardShell>
  );
}
