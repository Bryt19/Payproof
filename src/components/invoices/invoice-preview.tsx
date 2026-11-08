"use client";

import { useRef, useEffect, useState } from "react";
import type { Invoice } from "@/lib/invoices/types";
import { formatUsdAmount, formatLamportUrlParam } from "@/lib/invoices/currency";
import { formatSolExact } from "@/lib/solana/units";
import { LAMPORTS_PER_SOL } from "@/lib/solana/units";
import { Button } from "@/components/ui/button";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "@/components/dashboard/icons";

type CopyState = "idle" | "copied" | "failed";

type InvoicePreviewProps = {
  invoice: Invoice;
  onCreateAnother: () => void;
  onBack: () => void;
  onEdit?: () => void;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
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

  return `${formatSolExact(BigInt(invoice.amountLamports))} SOL`;
}

function formatDueDate(invoice: Invoice): string {
  return formatDate(invoice.dueDate);
}

function formatStatus(invoice: Invoice): string {
  const lower = invoice.status;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export default function InvoicePreview({
  invoice,
  onCreateAnother,
  onBack,
  onEdit,
}: InvoicePreviewProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const origin =
    typeof window === "undefined" ? "" : window.location.origin;
  const sharePath = `/invoice/${invoice.number}`;
  const shareUrl = `${origin}${sharePath}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }

    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), 4000);
  }

  async function handleOpen() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }

    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), 4000);

    window.open(shareUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <section
      aria-labelledby="invoice-preview-heading"
      className="rounded-xl border border-accent/25 bg-surface p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="invoice-preview-heading"
            className="text-sm font-semibold text-neutral-200"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            Invoice created
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Review the invoice details before sharing it with your customer.
          </p>
        </div>

        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-300"
        >
          <span aria-hidden="true" className="size-1.5 rounded-full bg-amber-300" />
          {formatStatus(invoice)}
        </span>
      </div>

      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">Invoice number</dt>
          <dd className="mt-0.5 font-mono text-xs text-neutral-200">
            {invoice.number}
          </dd>
        </div>

        <div>
          <dt className="text-xs text-muted">Status</dt>
          <dd className="mt-0.5 text-xs text-neutral-300">
            {formatStatus(invoice)}
          </dd>
        </div>

        <div>
          <dt className="text-xs text-muted">Customer</dt>
          <dd className="mt-0.5 text-neutral-200">
            {invoice.customerName || "—"}
          </dd>
        </div>

        <div>
          <dt className="text-xs text-muted">Customer email</dt>
          <dd className="mt-0.5 text-neutral-300">
            {invoice.customerEmail || "—"}
          </dd>
        </div>

        <div className="sm:col-span-2">
          <dt className="text-xs text-muted">Description</dt>
          <dd className="mt-0.5 text-neutral-100">
            {invoice.description || "—"}
          </dd>
        </div>

        <div>
          <dt className="text-xs text-muted">Issue date</dt>
          <dd className="mt-0.5 text-xs text-neutral-300">
            {formatDate(invoice.issueDate)}
          </dd>
        </div>

        <div>
          <dt className="text-xs text-muted">Due date</dt>
          <dd className="mt-0.5 text-xs text-neutral-300">
            {formatDueDate(invoice)}
          </dd>
        </div>

        <div>
          <dt className="text-xs text-muted">Currency</dt>
          <dd className="mt-0.5 text-xs text-neutral-300">
            {invoice.currency}
          </dd>
        </div>

        <div>
          <dt className="text-xs text-muted">Total</dt>
          <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-neutral-100">
            {formatAmount(invoice)}
          </dd>
        </div>

        {invoice.notes && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted">Notes</dt>
            <dd className="mt-0.5 text-neutral-200">{invoice.notes}</dd>
          </div>
        )}
      </dl>

      {/* Customer-facing share section */}
      <div className="mt-5 border-t border-line pt-4">
        <h3 className="text-xs font-medium text-neutral-200">
          Share with customer
        </h3>

        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input
            readOnly
            value={shareUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs text-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />

          <div className="shrink-0 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={handleOpen}
              className="border border-line text-neutral-200 hover:bg-white/5 hover:text-white"
            >
              <ExternalLinkIcon className="size-4" />
              <span className="ml-1.5">Open preview</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => void handleCopy()}
              className="border border-line text-neutral-200 hover:bg-white/5 hover:text-white"
            >
              {copyState === "copied" ? (
                <>
                  <CheckIcon className="size-4" />
                  <span className="ml-1.5">Copied</span>
                </>
              ) : (
                <>
                  <CopyIcon className="size-4" />
                  <span className="ml-1.5">Copy link</span>
                </>
              )}
            </Button>
          </div>
        </div>

        <p role="status" className="mt-1 min-h-4 text-xs text-muted">
          {copyState === "copied" && "Link copied to clipboard."}
          {copyState === "failed" &&
            "Copy unavailable — select the link and copy it manually."}
        </p>

        <p className="mt-2 text-[11px] text-muted">
          The customer-facing invoice page is not implemented yet. This preview is
          a UI-only placeholder until the public invoice route is wired up.
        </p>
      </div>

      {/* Line items summary */}
      {invoice.lineItems.length > 0 && (
        <div className="mt-4 rounded-lg border border-line bg-surface-raised p-4">
          <h4 className="text-xs font-medium text-neutral-200">Line items</h4>
          <ul className="mt-2 space-y-1.5 text-xs">
            {invoice.lineItems.map((item, index) => (
              <li
                key={index}
                className="flex flex-wrap items-baseline justify-between gap-2 text-neutral-200"
              >
                <span>
                  {item.description || `Line item ${index + 1}`}
                  {item.quantity !== 1 && (
                    <> × {item.quantity}</>
                  )}
                </span>
                <span className="font-mono text-neutral-300">
                  {invoice.currency === "USD"
                    ? formatUsdAmount(LAMPORTS_PER_SOL, BigInt(Math.round(lineTotal(item) * 100)))
                    : `${lineTotal(item).toFixed(6)} SOL`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        {onEdit && (
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onEdit}
            className="border border-line text-neutral-200 hover:bg-white/5 hover:text-white"
          >
            Edit invoice
          </Button>
        )}

        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={onBack}
          className="border border-line text-neutral-200 hover:bg-white/5 hover:text-white"
        >
          Back to invoices
        </Button>

        <Button
          type="button"
          size="md"
          variant="primary"
          onClick={onCreateAnother}
        >
          Create another invoice
        </Button>
      </div>
    </section>
  );
}

function lineTotal(item: { quantity: number; unitPrice: number }): number {
  return Math.round((item.quantity * item.unitPrice + Number.EPSILON) * 100) / 100;
}
