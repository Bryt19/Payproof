"use client";

import { QRCodeSVG } from "qrcode.react";
import Link from "next/link";
import type { PaymentRequest } from "@/lib/payment-requests/types";
import { getCheckoutPath } from "@/lib/payment-requests/types";
import { getCheckoutUrl } from "@/lib/payment-requests/checkout-url";
import { formatSolExact } from "@/lib/solana/units";
import { useCopyFeedback } from "@/lib/use-copy-feedback";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
} from "@/components/dashboard/icons";
import ModalShell from "./modal-shell";

/**
 * Shareable checkout link + QR for one payment request.
 */
export default function ShareRequestDialog({
  request,
  onClose,
}: {
  request: PaymentRequest;
  onClose: () => void;
}) {
  const { state: copyState, copy } = useCopyFeedback();

  const checkoutPath = getCheckoutPath(request.reference);
  const checkoutUrl = getCheckoutUrl(request.reference);

  return (
    <ModalShell
      title="Share payment request"
      description={request.description}
      onClose={onClose}
    >
      <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface-raised px-4 py-5">
        <div className="rounded-lg bg-white p-3">
          <QRCodeSVG
            value={checkoutUrl}
            size={148}
            level="M"
            bgColor="#ffffff"
            fgColor="#000000"
            marginSize={0}
            title={`QR code for payment request ${request.id}`}
          />
        </div>
        <p className="font-mono text-sm tabular-nums text-ink">
          {formatSolExact(BigInt(request.amountLamports))}{" "}
          <span className="text-xs text-muted">SOL</span>
        </p>
        <p className="text-center font-mono text-[11px] text-muted">
          {request.id} · {request.reference.slice(0, 8)}…
        </p>
      </div>

      <div className="mt-4">
        <label
          htmlFor="share-checkout-url"
          className="text-[11px] font-medium uppercase tracking-wider text-muted"
        >
          Checkout link
        </label>

        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <input
            id="share-checkout-url"
            readOnly
            value={checkoutUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="min-h-11 w-full rounded-lg border border-line bg-canvas px-3 font-mono text-xs text-neutral-300 focus-visible:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
          />

          <button
            type="button"
            onClick={() => void copy(checkoutUrl)}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-ink transition-colors hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {copyState === "copied" ? (
              <CheckIcon className="size-4" />
            ) : (
              <CopyIcon className="size-4" />
            )}
            {copyState === "copied" ? "Copied" : "Copy link"}
          </button>
        </div>

        <p role="status" aria-live="polite" className="mt-1.5 min-h-4 text-[11px]">
          {copyState === "copied" && (
            <span className="text-accent-bright">
              Checkout link copied to clipboard.
            </span>
          )}
          {copyState === "failed" && (
            <span className="text-red-300">
              Copying is blocked by your browser — select the link and copy it
              manually.
            </span>
          )}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href={checkoutPath}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-accent transition-colors hover:text-accent/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Open checkout page
            <ExternalLinkIcon className="size-3.5" />
          </Link>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-1 py-0.5 text-xs font-medium text-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Done
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
