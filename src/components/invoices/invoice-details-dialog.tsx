"use client";

import { useCallback, useRef, useState } from "react";
import type { Invoice, InvoiceStatus } from "@/lib/invoices/types";

import { formatSolExact } from "@/lib/solana/units";
import ModalShell from "@/components/payment-requests/modal-shell";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "@/components/dashboard/icons";

type InvoiceDetailsDialogProps = {
  invoice: Invoice | null;
  open: boolean;
  onClose: () => void;
};

type CopyState = "idle" | "copied" | "failed";

const STATUS: Record<InvoiceStatus, { label: string; className: string }> = {
  pending: {
    label: "Pending",
    className: "bg-amber-400/10 text-amber-300 border-amber-400/25",
  },
  paid: {
    label: "Paid",
    className: "bg-[#14F195]/10 text-[#14F195] border-[#14F195]/25",
  },
  expired: {
    label: "Expired",
    className: "bg-white/[0.06] text-white/60 border-white/[0.1]",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-white/[0.04] text-white/50 border-white/[0.08]",
  },
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

function formatAmount(lamports: string): string {
  try {
    return `${formatSolExact(BigInt(lamports))} SOL`;
  } catch {
    return "—";
  }
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  const display = value && value.trim().length > 0 ? value : "—";
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-white/40">{label}</dt>
      <dd
        className={`mt-1 break-all text-sm text-white/90 ${mono ? "font-mono text-xs" : ""}`}
      >
        {display}
      </dd>
    </div>
  );
}

export function InvoiceDetailsDialog({ invoice, open, onClose }: InvoiceDetailsDialogProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copySignature = useCallback(async (sig: string) => {
    try {
      await navigator.clipboard.writeText(sig);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState("idle"), 3000);
  }, []);

  if (!open || !invoice) return null;

  const status = STATUS[invoice.status] ?? STATUS.pending;
  const explorerUrl =
    invoice.transactionSignature && invoice.transactionSignature.trim().length > 0
      ? `https://explorer.solana.com/tx/${encodeURIComponent(invoice.transactionSignature)}?cluster=devnet`
      : null;

  return (
    <ModalShell
      onClose={onClose}
      title="Invoice details"
      description="Payment request record from the database. Status reflects server-verified on-chain state."
    >
      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-sm font-semibold text-white">{invoice.reference}</p>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${status.className}`}
          >
            {invoice.status === "paid" ? <CheckIcon className="size-3" /> : null}
            {status.label}
          </span>
        </div>

        <dl className="grid gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 sm:grid-cols-2">
          <Field label="Description" value={invoice.description} />
          <Field label="Amount" value={formatAmount(invoice.amountLamports)} mono />
          <Field label="Customer name" value={invoice.customerName} />
          <Field label="Customer email" value={invoice.customerEmail} />
          <Field label="Merchant wallet" value={invoice.merchantAddress} mono />
          <Field label="Payer wallet" value={invoice.payerAddress} mono />
          <Field label="Created" value={formatDate(invoice.createdAt)} />
          <Field label="Verified" value={formatDate(invoice.verifiedAt)} />
        </dl>

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <dt className="text-[11px] uppercase tracking-wider text-white/40">
            Transaction signature
          </dt>
          {invoice.transactionSignature ? (
            <dd className="mt-2 min-w-0">
              <div className="overflow-x-auto rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2">
                <code className="block whitespace-nowrap font-mono text-xs text-white/90 sm:whitespace-normal sm:break-all">
                  {invoice.transactionSignature}
                </code>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void copySignature(invoice.transactionSignature!)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-white/80 hover:bg-white/[0.08]"
                >
                  <CopyIcon className="size-3.5" />
                  {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
                </button>
                {explorerUrl ? (
                  <a
                    href={explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#14F195]/25 bg-[#14F195]/10 px-2.5 py-1.5 text-[11px] font-medium text-[#14F195] hover:bg-[#14F195]/15"
                  >
                    <ExternalLinkIcon className="size-3.5" />
                    View on Solana Explorer (Devnet)
                  </a>
                ) : null}
              </div>
            </dd>
          ) : (
            <dd className="mt-1 text-sm text-white/50">—</dd>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
