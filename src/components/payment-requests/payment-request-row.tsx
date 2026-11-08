"use client";

import { useState } from "react";
import { formatSolExact } from "@/lib/solana/units";
import { shortenAddress } from "@/lib/solana/address";
import { useCopyFeedback } from "@/lib/use-copy-feedback";
import { QrIcon } from "@/components/dashboard/icons";
import { StatusBadge } from "@/lib/payment-requests/status-filter.tsx";
import ShareRequestDialog from "./share-request-dialog";

export default function PaymentRequestRow({
  request,
  onCopy,
}: {
  request: import("@/lib/payment-requests/types").PaymentRequest;
  onCopy: () => void;
}) {
  const { copy } = useCopyFeedback();
  const [isSharing, setIsSharing] = useState(false);

  return (
    <div className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:px-6 sm:py-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] text-muted">{request.id}</p>
          <p className="break-all font-mono text-sm text-ink">
            {request.reference.slice(0, 12)}…
          </p>
        </div>

        <StatusBadge status={request.status} abbreviate />
      </div>

      <p className="text-sm text-ink">{request.description}</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent-bright" />
          {formatSolExact(BigInt(request.amountLamports))} SOL
        </span>

        {request.customerName && (
          <span className="inline-flex items-center gap-1">
            <svg
              width="11"
              height="11"
              viewBox="0 0 11 11"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="3" cy="3" r="2" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M3 8L8 3"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            {request.customerName}
          </span>
        )}

        {request.merchantAddress && (
          <span className="font-mono text-[10px] text-muted/70">
            {shortenAddress(request.merchantAddress)}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 11 11"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="3"
              y="3"
              width="5"
              height="5"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <path
              d="M5 3v3l4 4"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Copy link
        </button>

        <button
          type="button"
          onClick={() => setIsSharing(true)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-neutral-300 transition-colors hover:bg-white/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <QrIcon className="size-3.5" />
          QR
        </button>

        <ShareRequestDialog
          request={request}
          onClose={() => setIsSharing(false)}
        />
      </div>
    </div>
  );
}
