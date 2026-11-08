"use client";

import type { Invoice, InvoiceStatus } from "@/lib/invoices/types";
import { formatUsdAmount } from "@/lib/invoices/currency";
import { formatSolExact } from "@/lib/solana/units";
import { LAMPORTS_PER_SOL } from "@/lib/solana/units";
import { CheckIcon, ExternalLinkIcon, TrashIcon } from "@/components/dashboard/icons";

type InvoiceTableProps = {
  invoices: readonly Invoice[];
  onView: (invoice: Invoice) => void;
  onEdit: (invoice: Invoice) => void;
  onDelete: (invoice: Invoice) => void;
};

type StatusStyle = {
  label: string;
  bg: string;
  text: string;
  dot: string;
  border: string;
};

const STATUS_STYLES: Record<InvoiceStatus, StatusStyle> = {
  draft: {
    label: "Draft",
    bg: "rgba(255,255,255,0.03)",
    text: "rgba(255,255,255,0.5)",
    dot: "#737373",
    border: "rgba(255,255,255,0.08)",
  },
  sent: {
    label: "Sent",
    bg: "rgba(153,69,255,0.08)",
    text: "#C14BF0",
    dot: "#9945FF",
    border: "rgba(153,69,255,0.25)",
  },
  viewed: {
    label: "Viewed",
    bg: "rgba(153,69,255,0.08)",
    text: "#C14BF0",
    dot: "#9945FF",
    border: "rgba(153,69,255,0.25)",
  },
  paid: {
    label: "Paid",
    bg: "rgba(20,241,149,0.08)",
    text: "#14F195",
    dot: "#14F195",
    border: "rgba(20,241,149,0.25)",
  },
  overdue: {
    label: "Overdue",
    bg: "rgba(251,191,36,0.08)",
    text: "#fbbf24",
    dot: "#fbbf24",
    border: "rgba(251,191,36,0.25)",
  },
  cancelled: {
    label: "Cancelled",
    bg: "rgba(255,255,255,0.03)",
    text: "rgba(255,255,255,0.4)",
    dot: "#737373",
    border: "rgba(255,255,255,0.08)",
  },
  void: {
    label: "Void",
    bg: "rgba(255,255,255,0.03)",
    text: "rgba(255,255,255,0.4)",
    dot: "#737373",
    border: "rgba(255,255,255,0.08)",
  },
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

function formatAmount(invoice: Invoice): string {
  if (invoice.currency === "USD") {
    return formatUsdAmount(LAMPORTS_PER_SOL, BigInt(invoice.amountCents));
  }

  // Display SOL amounts unambiguously, including tiny fractions.
  return formatSolExact(BigInt(invoice.amountLamports));
}

function StatusPill({ status }: { status: InvoiceStatus }) {
  const style = STATUS_STYLES[status];
  const isPaid = status === "paid";
  const isOpen = status === "sent" || status === "viewed";

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: style.bg, color: style.text }}
    >
      {isPaid && <CheckIcon className="size-3" />}
      {isOpen && (
        <span
          aria-hidden="true"
          className="size-1.5 animate-pulse rounded-full"
          style={{ background: style.dot }}
        />
      )}
      {!isPaid && !isOpen && (
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

export default function InvoiceTable({
  invoices,
  onView,
  onEdit,
  onDelete,
}: InvoiceTableProps) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden xl:block">
        <table className="w-full min-w-[880px] text-left text-xs">
          <caption className="sr-only">
            Invoice listing with number, customer, description, amount, due date,
            status, and actions.
          </caption>

          <thead className="border-b border-white/[0.06] bg-black/10 text-[11px] uppercase tracking-wider text-white/40">
            <tr>
              <th scope="col" className="py-3.5 pl-6 pr-3 font-medium">
                Invoice
              </th>
              <th scope="col" className="px-3 py-3.5 font-medium">
                Customer
              </th>
              <th scope="col" className="px-3 py-3.5 font-medium">
                Description
              </th>
              <th scope="col" className="px-3 py-3.5 font-medium">
                Amount
              </th>
              <th scope="col" className="px-3 py-3.5 font-medium">
                Due
              </th>
              <th scope="col" className="px-3 py-3.5 font-medium">
                Status
              </th>
              <th scope="col" className="py-3.5 pl-3 pr-6 text-right font-medium">
                Actions
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/[0.04]">
            {invoices.map((invoice) => (
              <tr
                key={invoice.id}
                onClick={() => onView(invoice)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onView(invoice);
                  }
                }}
                aria-label={`View invoice ${invoice.number}`}
                className="group cursor-pointer transition-colors duration-150 hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
              >
                <td className="py-4 pl-6 pr-3 align-middle">
                  <p className="font-mono text-xs font-medium text-white transition-colors group-hover:text-[#C14BF0]">
                    {invoice.number}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-white/40">
                    {formatDate(invoice.issueDate)}
                  </p>
                </td>

                <td className="max-w-[180px] px-3 py-4 align-middle">
                  <p className="truncate font-medium text-white/90">
                    {invoice.customerName || "—"}
                  </p>
                  {invoice.customerEmail && (
                    <p className="mt-0.5 truncate text-[11px] text-white/45">
                      {invoice.customerEmail}
                    </p>
                  )}
                </td>

                <td className="max-w-[240px] px-3 py-4 align-middle">
                  <p className="truncate text-white/90">
                    {invoice.description || "—"}
                  </p>
                  {invoice.lineItems.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-white/40">
                      {invoice.lineItems.length} line item
                      {invoice.lineItems.length !== 1 ? "s" : ""}
                    </p>
                  )}
                </td>

                <td className="whitespace-nowrap px-3 py-4 align-middle">
                  <div className="font-mono text-sm font-bold tracking-tight text-white">
                    {formatAmount(invoice)}
                    {invoice.currency === "SOL" && (
                      <span className="ml-1 text-xs font-normal text-white/50">
                        SOL
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-white/40">
                    {invoice.currency === "USD" ? "Billed in USD" : "Devnet"}
                  </span>
                </td>

                <td className="whitespace-nowrap px-3 py-4 align-middle text-white/50">
                  {formatDate(invoice.dueDate)}
                </td>

                <td className="whitespace-nowrap px-3 py-4 align-middle">
                  <StatusPill status={invoice.status} />
                </td>

                <td className="py-4 pl-3 pr-6 align-middle text-right">
                  <div
                    className="flex items-center justify-end gap-1.5"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      title="Preview invoice"
                      onClick={() => onView(invoice)}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-1.5 text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      <ExternalLinkIcon className="size-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onEdit(invoice)}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      title="Delete invoice"
                      onClick={() => onDelete(invoice)}
                      className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-1.5 text-white/70 transition-colors hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      <TrashIcon className="size-4" />
                      <span className="sr-only">
                        Delete invoice {invoice.number}
                      </span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="divide-y divide-white/[0.06] xl:hidden">
        {invoices.map((invoice) => (
          <div
            key={invoice.id}
            onClick={() => onView(invoice)}
            className="flex cursor-pointer flex-col gap-3 p-5 transition-colors hover:bg-white/[0.02]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold text-white">
                  {invoice.number}
                </p>
                <p className="font-mono text-[10px] text-white/40">
                  Issued {formatDate(invoice.issueDate)}
                </p>
              </div>
              <StatusPill status={invoice.status} />
            </div>

            <p className="line-clamp-2 text-xs font-medium text-white/90">
              {invoice.description || "—"}
            </p>

            <div className="flex items-center justify-between border-t border-white/[0.04] pt-1">
              <div>
                <p className="font-mono text-base font-bold text-white">
                  {formatAmount(invoice)}
                  {invoice.currency === "SOL" && (
                    <span className="ml-1 text-xs font-normal text-white/50">
                      SOL
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-white/50">
                  {invoice.customerName || "No customer"} · Due{" "}
                  {formatDate(invoice.dueDate)}
                </p>
              </div>

              <div
                className="flex items-center gap-2"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => onEdit(invoice)}
                  className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-0"
                >
                  Edit
                </button>

                <button
                  type="button"
                  title="Delete invoice"
                  onClick={() => onDelete(invoice)}
                  className="inline-flex size-11 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.04] text-white/80 transition-colors hover:border-red-400/40 hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:size-8"
                >
                  <TrashIcon className="size-4" />
                  <span className="sr-only">
                    Delete invoice {invoice.number}
                  </span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
