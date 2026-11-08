"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Invoice, InvoiceStatus } from "@/lib/invoices/types";
import { formatSolExact, LAMPORTS_PER_SOL } from "@/lib/solana/units";
import { formatUsdAmount } from "@/lib/invoices/currency";
import Dialog from "@/components/dashboard/dialog";
import { Button } from "@/components/ui/button";
import {
  CloseIcon,
  InvoicesIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/dashboard/icons";
import InvoiceTable from "./invoice-table";
import InvoicesOverview from "./invoices-overview";
import CreateInvoiceForm from "./create-invoice-form";
import InvoicePreview from "./invoice-preview";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; invoices: readonly Invoice[] }
  | { status: "error"; message: string };

type DialogKind =
  | { kind: "create" }
  | { kind: "edit"; invoice: Invoice }
  | { kind: "preview"; invoice: Invoice }
  | { kind: "delete"; invoice: Invoice };

type InvoiceFilter = "all" | "draft" | "open" | "paid" | "overdue" | "closed";

const FILTERS: readonly { value: InvoiceFilter; label: string }[] = [
  { value: "all", label: "All invoices" },
  { value: "draft", label: "Draft" },
  { value: "open", label: "Open" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "closed", label: "Closed" },
];

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
  void: "Void",
};

function matchesFilter(status: InvoiceStatus, filter: InvoiceFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "draft":
      return status === "draft";
    case "open":
      return status === "sent" || status === "viewed";
    case "paid":
      return status === "paid";
    case "overdue":
      return status === "overdue";
    case "closed":
      return status === "cancelled" || status === "void";
  }
}

function deleteInvoiceAction(invoice: Invoice, onDeleted: () => void) {
  // Pure-UI deletion path. No fake DB mutation: this only removes the row from
  // the current UI list and leaves storage untouched. Backed billing flows will
  // replace this with a real API/worker call later.
  onDeleted();
}

export function InvoicesView() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<InvoiceFilter>("all");
  const [sortField, setSortField] = useState("issued_at");
  const [sortDirection, setSortDirection] = useState("desc");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    setIsRefreshing(true);
    setLoadState((previous) =>
      previous.status === "loaded" ? previous : { status: "loading" },
    );

    try {
      const params = new URLSearchParams();
      if (sortField !== "issued_at") params.set("sortField", sortField);
      if (sortDirection !== "desc") params.set("sortDirection", sortDirection);

      const res = await fetch(`/api/invoices?${params.toString()}`, {
        cache: "no-store",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Could not load invoices.");
      }

      const data = await res.json();
      setLoadState({ status: "loaded", invoices: data.invoices });
    } catch (error) {
      setLoadState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Could not load invoices.",
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [sortField, sortDirection]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const invoices = loadState.status === "loaded" ? loadState.invoices : [];

  const counts = useMemo(() => {
    let paid = 0;
    let open = 0;
    let overdue = 0;

    for (const invoice of invoices) {
      if (invoice.status === "paid") paid += 1;
      else if (invoice.status === "sent" || invoice.status === "viewed") open += 1;
      else if (invoice.status === "overdue") overdue += 1;
    }

    const filterCounts: Record<InvoiceFilter, number> = {
      all: invoices.length,
      draft: 0,
      open,
      paid,
      overdue,
      closed: 0,
    };

    for (const invoice of invoices) {
      if (invoice.status === "draft") filterCounts.draft += 1;
      if (invoice.status === "cancelled" || invoice.status === "void") {
        filterCounts.closed += 1;
      }
    }

    return { total: invoices.length, paid, open, overdue, filterCounts };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return invoices.filter((invoice) => {
      if (!matchesFilter(invoice.status, activeFilter)) return false;
      if (!query) return true;

      const haystack = [
        invoice.number,
        invoice.customerName,
        invoice.customerEmail,
        invoice.description,
        invoice.status,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [invoices, activeFilter, searchQuery]);

  const hasActiveFilters =
    searchQuery.trim() !== "" || activeFilter !== "all";

  function clearFilters() {
    setSearchQuery("");
    setActiveFilter("all");
  }

  function handleSortChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const [field, direction] = event.target.value.split("_") as [
      string,
      string,
    ];
    setSortField(field);
    setSortDirection(direction);
  }

  function closeDialog() {
    setDialog(null);
  }

  function openCreate() {
    setDialog({ kind: "create" });
  }

  function openEdit(invoice: Invoice) {
    setDialog({ kind: "edit", invoice });
  }

  function openPreview(invoice: Invoice) {
    setDialog({ kind: "preview", invoice });
  }

  function openDelete(invoice: Invoice) {
    setDialog({ kind: "delete", invoice });
  }

  function handleCreated(invoice: Invoice) {
    setDialog({ kind: "preview", invoice });
  }

  function handleDeleted(invoice: Invoice) {
    deleteInvoiceAction(invoice, () => {
      setDialog(null);
      setLoadState((previous) => {
        if (previous.status !== "loaded") return previous;
        return {
          ...previous,
          invoices: previous.invoices.filter(
            (current) => current.id !== invoice.id,
          ),
        };
      });
    });
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1
            className="text-xl font-bold tracking-tight text-white sm:text-2xl"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            Invoices
          </h1>
          <p className="mt-1 max-w-xl text-sm text-white/50">
            Bill in SOL or USD, share a checkout link, and track settlement
            against Solana Devnet.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="btn-brand-gradient inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-xl px-5 py-2.5 text-xs font-semibold text-white shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] sm:min-h-0 sm:self-auto"
        >
          <svg
            className="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Create Invoice</span>
        </button>
      </div>

      {/* Records notice */}
      <div className="flex items-start gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-xs text-white/70">
        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#9945FF]" />
        <span>
          Invoice figures come from your Payproof records. Only invoices settled
          on-chain count as paid.
        </span>
      </div>

      {/* Overview */}
      <InvoicesOverview
        counts={counts}
        isRefreshing={isRefreshing}
      />

      {/* Invoices list */}
      <section
        aria-label="Invoice list"
        className="rounded-2xl border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
        style={{ background: "#0E0E12" }}
      >
        <div className="flex flex-col gap-4 border-b border-white/[0.08] p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white">
                All Invoices
              </h2>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.06] px-2 py-0.5 text-xs text-white/60">
                {invoices.length} total
              </span>
            </div>
            <p className="mt-1 text-xs text-white/50">
              Billing records with Solana checkout links and on-chain settlement
              proof.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 sm:w-60 sm:flex-initial">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search number, customer…"
                aria-label="Search invoices"
                className="h-11 w-full rounded-xl border border-white/[0.1] sm:h-10 bg-white/[0.03] pl-9 pr-8 text-xs text-white placeholder:text-white/35 focus:border-[#9945FF]/60 focus:bg-white/[0.05] focus:outline-none focus:ring-1 focus:ring-[#9945FF]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 transition-colors hover:text-white"
                >
                  <CloseIcon className="size-3.5" />
                </button>
              )}
            </div>

            <label htmlFor="invoice-sort-select" className="sr-only">
              Sort invoices
            </label>
            <select
              id="invoice-sort-select"
              value={`${sortField}_${sortDirection}`}
              onChange={handleSortChange}
              className="h-10 rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 text-xs text-white/70 focus:border-[#9945FF]/60 focus:bg-white/[0.05] focus:outline-none focus:ring-1 focus:ring-[#9945FF]"
            >
              <option value="issued_at_desc">Newest first</option>
              <option value="issued_at_asc">Oldest first</option>
              <option value="due_at_desc">Due date (latest)</option>
              <option value="due_at_asc">Due date (earliest)</option>
              <option value="amount_desc">Highest amount</option>
              <option value="amount_asc">Lowest amount</option>
              <option value="number_asc">Invoice (A-Z)</option>
              <option value="number_desc">Invoice (Z-A)</option>
            </select>

            <button
              type="button"
              onClick={() => void fetchData()}
              disabled={isRefreshing}
              className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-white/[0.1] sm:h-10 bg-white/[0.03] px-3.5 text-xs font-medium text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
            >
              <svg
                className={`size-3.5 ${isRefreshing ? "animate-spin text-[#9945FF]" : ""}`}
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
              <span>{isRefreshing ? "Refreshing…" : "Refresh"}</span>
            </button>
          </div>
        </div>

        {/* Status filter tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-black/20 px-5 py-3 sm:px-6">
          {FILTERS.map((option) => {
            const isActive = activeFilter === option.value;
            const count = counts.filterCounts[option.value];

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setActiveFilter(option.value)}
                aria-pressed={isActive}
                className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-medium transition-all duration-150 sm:min-h-0 ${
                  isActive
                    ? "bg-[#9945FF] text-white shadow-[0_0_16px_rgba(153,69,255,0.4)]"
                    : "text-white/60 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                <span>{option.label}</span>
                <span
                  className={`rounded-full px-1.5 text-[10px] font-mono ${
                    isActive
                      ? "bg-black/30 text-white"
                      : "bg-white/[0.08] text-white/50"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* States */}
        {loadState.status === "idle" || loadState.status === "loading" ? (
          <div className="space-y-3 p-6">
            {[1, 2, 3, 4, 5].map((row) => (
              <div
                key={row}
                className="h-16 animate-pulse rounded-xl border border-white/[0.04] bg-white/[0.02]"
              />
            ))}
          </div>
        ) : loadState.status === "error" ? (
          <div className="p-10 text-center">
            <p className="text-sm text-red-300">{loadState.message}</p>
            <button
              type="button"
              onClick={() => void fetchData()}
              className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/[0.05] px-4 py-2 text-xs font-medium text-white hover:bg-white/[0.1]"
            >
              Retry loading
            </button>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-white/[0.1] bg-white/[0.03] text-white/40 shadow-inner">
              <InvoicesIcon className="size-6 text-[#9945FF]" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-white">
              {hasActiveFilters ? "No matching invoices" : "No invoices yet"}
            </h3>
            <p className="mt-1 max-w-sm text-xs text-white/50">
              {hasActiveFilters
                ? "Try adjusting your search keywords or switching filters to view your invoices."
                : "Create your first invoice to bill customers with verifiable Solana payment proof."}
            </p>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-white hover:bg-white/[0.08]"
              >
                Reset filters
              </button>
            ) : (
              <button
                type="button"
                onClick={openCreate}
                className="btn-brand-gradient mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold text-white shadow-lg sm:min-h-0"
              >
                <span>+ Create Invoice</span>
              </button>
            )}
          </div>
        ) : (
          <>
            <InvoiceTable
              invoices={filteredInvoices}
              onView={openPreview}
              onEdit={openEdit}
              onDelete={openDelete}
            />

            <div className="border-t border-white/[0.06] px-5 py-3 sm:px-6">
              <p className="text-[11px] text-white/35">
                Showing {filteredInvoices.length} of {invoices.length} invoice
                {invoices.length !== 1 ? "s" : ""}. Deleting an invoice removes it
                from this browser view only.
              </p>
            </div>
          </>
        )}
      </section>

      {/* Dialogs */}
      {dialog && (
        <Dialog
          open={true}
          onClose={closeDialog}
          size="lg"
          title={dialogTitle(dialog)}
          description={dialogDescription(dialog)}
        >
          {dialog.kind === "create" && (
            <CreateInvoiceForm
              onCreated={handleCreated}
              onCancel={closeDialog}
            />
          )}

          {dialog.kind === "edit" && (
            <CreateInvoiceForm
              invoice={dialog.invoice}
              onCreated={handleCreated}
              onCancel={closeDialog}
            />
          )}

          {dialog.kind === "preview" && (
            <InvoicePreview
              invoice={dialog.invoice}
              onCreateAnother={() => setDialog({ kind: "create" })}
              onBack={closeDialog}
              onEdit={() => openEdit(dialog.invoice)}
            />
          )}

          {dialog.kind === "delete" && (
            <DeleteInvoiceConfirmation
              invoice={dialog.invoice}
              onConfirm={() => handleDeleted(dialog.invoice)}
              onCancel={closeDialog}
            />
          )}
        </Dialog>
      )}
    </div>
  );
}

function dialogTitle(dialog: DialogKind): string {
  switch (dialog.kind) {
    case "create":
      return "Create invoice";
    case "edit":
      return `Edit invoice ${dialog.invoice.number}`;
    case "preview":
      return `Invoice ${dialog.invoice.number}`;
    case "delete":
      return `Delete invoice ${dialog.invoice.number}`;
  }
}

function dialogDescription(dialog: DialogKind): string {
  switch (dialog.kind) {
    case "create":
      return "Create a professional invoice denominated in SOL or USD.";
    case "edit":
      return "Update invoice details. This is a UI-only preview until billing is connected.";
    case "preview":
      return "Review the invoice details before sharing it with your customer.";
    case "delete":
      return "This removes the invoice from this browser view only.";
  }
}

function formatAmountForDelete(invoice: Invoice): string {
  if (invoice.currency === "USD") {
    return formatUsdAmount(
      LAMPORTS_PER_SOL,
      BigInt(invoice.amountCents),
    );
  }

  return `${formatSolExact(BigInt(invoice.amountLamports))} SOL`;
}

function DeleteInvoiceConfirmation({
  invoice,
  onConfirm,
  onCancel,
}: {
  invoice: Invoice;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-4">
        <p className="text-sm font-medium text-red-100">
          Are you sure you want to delete this invoice?
        </p>
        <p className="mt-1 text-xs text-red-200/80">
          This action cannot be undone. The invoice will be removed from this
          browser view immediately.
        </p>
      </div>

      <div
        className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"
        aria-label="Invoice summary"
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[11px] uppercase tracking-wider text-white/40">
              Invoice number
            </dt>
            <dd className="mt-0.5 font-mono text-xs text-white/80">
              {invoice.number}
            </dd>
          </div>

          <div>
            <dt className="text-[11px] uppercase tracking-wider text-white/40">
              Customer
            </dt>
            <dd className="mt-0.5 text-xs text-white/80">
              {invoice.customerName || "—"}
            </dd>
          </div>

          <div className="sm:col-span-2">
            <dt className="text-[11px] uppercase tracking-wider text-white/40">
              Description
            </dt>
            <dd className="mt-0.5 text-xs text-white/80">
              {invoice.description || "—"}
            </dd>
          </div>

          <div>
            <dt className="text-[11px] uppercase tracking-wider text-white/40">
              Amount
            </dt>
            <dd className="mt-0.5 font-mono text-xs text-white/80">
              {formatAmountForDelete(invoice)}
            </dd>
          </div>

          <div>
            <dt className="text-[11px] uppercase tracking-wider text-white/40">
              Status
            </dt>
            <dd className="mt-0.5 text-xs text-white/80">
              {STATUS_LABELS[invoice.status]}
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={onCancel}
          className="border border-white/[0.1] text-neutral-200 hover:bg-white/5 hover:text-white"
        >
          Cancel
        </Button>

        <Button
          type="button"
          size="md"
          variant="ghost"
          onClick={onConfirm}
          className="border border-red-400/40 text-red-200 hover:bg-red-400/10 hover:text-red-100"
        >
          <TrashIcon className="size-4" />
          <span className="ml-1.5">Delete invoice</span>
        </Button>
      </div>

      <p className="text-[11px] text-white/35">
        Deleting a paid invoice does not affect any on-chain payment record. If
        the invoice was already settled on Solana, keep a copy of the transaction
        proof.
      </p>
    </div>
  );
}
