"use client";

import type { Invoice, InvoiceStatus } from "@/lib/invoices/types";
import { formatSolExact } from "@/lib/solana/units";
import { CheckIcon, ExternalLinkIcon } from "@/components/dashboard/icons";

type InvoiceTableProps = {
  invoices: readonly Invoice[];
  onView: (invoice: Invoice) => void;
};

type StatusStyle = {
  label: string;
  bg: string;
  text: string;
  dot: string;
};

const STATUS_STYLES: Record<InvoiceStatus, StatusStyle> = {
  pending: {
    label: "Pending",
    bg: "rgba(251,191,36,0.08)",
    text: "#fbbf24",
    dot: "#fbbf24",
  },
  paid: {
    label: "Paid",
    bg: "rgba(20,241,149,0.08)",
    text: "#14F195",
    dot: "#14F195",
  },
  expired: {
    label: "Expired",
    bg: "rgba(255,255,255,0.04)",
    text: "rgba(255,255,255,0.55)",
    dot: "#737373",
  },
  cancelled: {
    label: "Cancelled",
    bg: "rgba(255,255,255,0.03)",
    text: "rgba(255,255,255,0.45)",
    dot: "#737373",
  },
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

function formatAmount(lamports: string): string {
  try {
    return formatSolExact(BigInt(lamports));
  } catch {
    return "—";
  }
}

function StatusPill({ status }: { status: InvoiceStatus }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  const isPaid = status === "paid";
  const isPending = status === "pending";

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: style.bg, color: style.text }}
    >
      {isPaid ? <CheckIcon className="size-3" /> : null}
      {isPending ? (
        <span
          aria-hidden="true"
          className="size-1.5 animate-pulse rounded-full"
          style={{ background: style.dot }}
        />
      ) : !isPaid ? (
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full"
          style={{ background: style.dot }}
        />
      ) : null}
      {style.label}
    </span>
  );
}

export default function InvoiceTable({ invoices, onView }: InvoiceTableProps) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden xl:block">
        <table className="w-full min-w-[880px] text-left text-xs">
          <caption className="sr-only">
            Invoice listing (payment requests) with reference, customer, description,
            amount, date, status, and details.
          </caption>

          <thead className="border-b border-white/[0.06] bg-black/10 text-[11px] uppercase tracking-wider text-white/40">
            <tr>
              <th scope="col" className="py-3.5 pl-6 pr-3 font-medium">
                Reference
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
                Created
              </th>
              <th scope="col" className="px-3 py-3.5 font-medium">
                Status
              </th>
              <th scope="col" className="py-3.5 pl-3 pr-6 text-right font-medium">
                Details
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
                aria-label={`View invoice ${invoice.reference}`}
                className="group cursor-pointer transition-colors duration-150 hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
              >
                <td className="py-4 pl-6 pr-3 align-middle">
                  <p className="font-mono text-xs font-medium text-white transition-colors group-hover:text-[#C14BF0]">
                    {invoice.reference}
                  </p>
                </td>

                <td className="max-w-[180px] px-3 py-4 align-middle">
                  <p className="truncate font-medium text-white/90">
                    {invoice.customerName || "—"}
                  </p>
                  {invoice.customerEmail ? (
                    <p className="mt-0.5 truncate text-[11px] text-white/45">
                      {invoice.customerEmail}
                    </p>
                  ) : null}
                </td>

                <td className="max-w-[240px] px-3 py-4 align-middle">
                  <p className="truncate text-white/90">
                    {invoice.description || "—"}
                  </p>
                </td>

                <td className="whitespace-nowrap px-3 py-4 align-middle">
                  <div className="font-mono text-sm font-bold tracking-tight text-white">
                    {formatAmount(invoice.amountLamports)}
                    <span className="ml-1 text-xs font-normal text-white/50">SOL</span>
                  </div>
                  <span className="text-[10px] text-white/40">Devnet</span>
                </td>

                <td className="whitespace-nowrap px-3 py-4 align-middle text-white/50">
                  {formatDate(invoice.createdAt)}
                </td>

                <td className="whitespace-nowrap px-3 py-4 align-middle">
                  <StatusPill status={invoice.status} />
                </td>

                <td className="py-4 pl-3 pr-6 align-middle text-right">
                  <button
                    type="button"
                    title="View details"
                    onClick={(event) => {
                      event.stopPropagation();
                      onView(invoice);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <ExternalLinkIcon className="size-3.5" />
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="divide-y divide-white/[0.06] xl:hidden">
        {invoices.map((invoice) => (
          <button
            key={invoice.id}
            type="button"
            onClick={() => onView(invoice)}
            className="flex w-full cursor-pointer flex-col gap-3 p-5 text-left transition-colors hover:bg-white/[0.02]"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-mono text-xs font-semibold text-white">
                {invoice.reference}
              </p>
              <StatusPill status={invoice.status} />
            </div>

            <p className="line-clamp-2 text-xs font-medium text-white/90">
              {invoice.description || "—"}
            </p>

            <div className="flex items-center justify-between border-t border-white/[0.04] pt-1">
              <div>
                <p className="font-mono text-base font-bold text-white">
                  {formatAmount(invoice.amountLamports)}
                  <span className="ml-1 text-xs font-normal text-white/50">SOL</span>
                </p>
                <p className="text-[11px] text-white/50">
                  {invoice.customerName || "No customer"} · {formatDate(invoice.createdAt)}
                </p>
              </div>
              <span className="text-[11px] font-medium text-[#C14BF0]">View</span>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
