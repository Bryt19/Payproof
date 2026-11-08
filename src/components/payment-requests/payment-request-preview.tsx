"use client";

import { useState } from "react";
import type { PaymentRequest } from "@/lib/payment-requests/types";
import { getCheckoutPath } from "@/lib/payment-requests/types";
import { getCheckoutUrl } from "@/lib/payment-requests/checkout-url";
import { shortenAddress } from "@/lib/solana/address";
import { formatSolExact } from "@/lib/solana/units";
import { useCopyFeedback } from "@/lib/use-copy-feedback";
import { CheckIcon, CopyIcon, ExternalLinkIcon, QrIcon } from "@/components/dashboard/icons";
import ShareRequestDialog from "./share-request-dialog";

const createdAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function PaymentRequestPreview({
  request,
  onCreateAnother,
  onBack,
}: {
  request: PaymentRequest;
  onCreateAnother: () => void;
  onBack: () => void;
}) {
  const { state: copyState, copy } = useCopyFeedback();
  const [isSharing, setIsSharing] = useState(false);

  const checkoutPath = getCheckoutPath(request.reference);
  const checkoutUrl = getCheckoutUrl(request.reference);

  return (
    <section
      aria-labelledby="request-preview-heading"
      className="rounded-2xl border border-white/[0.08] bg-[#0E0E12] p-5 sm:p-6 space-y-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-5 items-center justify-center rounded-full bg-[#14F195]/20 text-[#14F195]">
              <CheckIcon className="size-3" />
            </span>
            <h2
              id="request-preview-heading"
              className="text-base font-semibold text-white"
            >
              Payment Request Created
            </h2>
          </div>
          <p className="mt-1 text-xs text-white/50">
            Keep this reference safe. Any transaction matching this reference on Solana Devnet will automatically verify.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <p className="font-mono text-lg font-bold text-white">
            {formatSolExact(BigInt(request.amountLamports))}{" "}
            <span className="text-xs font-normal text-white/50">SOL</span>
          </p>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-amber-300 animate-pulse"
            />
            Pending Payment
          </span>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-3.5 text-xs sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wider text-white/40">
            Request ID
          </dt>
          <dd className="mt-0.5 font-mono text-white/90">{request.id}</dd>
        </div>

        <div className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wider text-white/40">
            Created
          </dt>
          <dd className="mt-0.5 text-white/70">
            {createdAtFormatter.format(new Date(request.createdAt))}
          </dd>
        </div>

        <div className="min-w-0 sm:col-span-2">
          <dt className="text-[10px] uppercase tracking-wider text-white/40">
            Description
          </dt>
          <dd className="mt-0.5 break-words font-medium text-white">
            {request.description}
          </dd>
        </div>

        <div className="min-w-0 sm:col-span-2">
          <dt className="text-[10px] uppercase tracking-wider text-white/40">
            Solana Payment Reference (PublicKey)
          </dt>
          <dd className="mt-1 break-all rounded-lg border border-white/[0.06] bg-black/40 p-2 font-mono text-xs text-[#C14BF0]">
            {request.reference}
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wider text-white/40">
            Receiving Wallet
          </dt>
          <dd className="mt-0.5 font-mono text-xs text-white/80">
            {request.merchantAddress ? (
              <span title={request.merchantAddress}>
                {shortenAddress(request.merchantAddress)}
              </span>
            ) : (
              <span className="text-white/40 italic">Open / Unassigned</span>
            )}
          </dd>
        </div>

        {(request.customerName || request.customerEmail) && (
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-wider text-white/40">
              Customer
            </dt>
            <dd className="mt-0.5 break-words text-white/80">
              {[request.customerName, request.customerEmail]
                .filter(Boolean)
                .join(" · ")}
            </dd>
          </div>
        )}
      </dl>

      {/* Shareable checkout link */}
      <div className="border-t border-white/[0.06] pt-4">
        <label
          htmlFor="checkout-url"
          className="text-[11px] font-semibold uppercase tracking-wider text-white/40"
        >
          Shareable Checkout Link
        </label>

        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <input
            id="checkout-url"
            readOnly
            value={checkoutUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="min-h-11 w-full rounded-xl border border-white/[0.1] bg-black/40 px-3.5 font-mono text-xs text-white/90 focus:border-[#9945FF] focus:outline-none"
          />

          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void copy(checkoutUrl)}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/[0.08] px-4 text-xs font-semibold text-white transition-colors hover:bg-white/[0.14] sm:flex-none"
            >
              {copyState === "copied" ? (
                <>
                  <CheckIcon className="size-4 text-[#14F195]" />
                  <span className="text-[#14F195]">Copied</span>
                </>
              ) : (
                <>
                  <CopyIcon className="size-4" />
                  <span>Copy Link</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsSharing(true)}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3.5 text-xs font-semibold text-white transition-colors hover:bg-white/[0.08]"
            >
              <QrIcon className="size-4" />
              <span>QR Code</span>
            </button>
          </div>
        </div>

        {copyState === "copied" && (
          <p className="mt-1 text-xs text-[#14F195] font-medium">
            Checkout link copied to clipboard.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCreateAnother}
            className="btn-brand-gradient inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-xs font-semibold text-white shadow-md"
          >
            Create Another
          </button>

          <button
            type="button"
            onClick={onBack}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 text-xs font-semibold text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            View in List
          </button>
        </div>

        <a
          href={checkoutPath}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#14F195] hover:underline"
        >
          <span>Open Checkout Page</span>
          <ExternalLinkIcon className="size-3.5" />
        </a>
      </div>

      {isSharing && (
        <ShareRequestDialog
          request={request}
          onClose={() => setIsSharing(false)}
        />
      )}
    </section>
  );
}
