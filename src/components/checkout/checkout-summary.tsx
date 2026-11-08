"use client";

import { useEffect, useState } from "react";
import { useClient } from "@solana/react";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import type {
  PaymentRequest,
  PaymentRequestStatus,
} from "@/lib/payment-requests/types";
import { shortenAddress } from "@/lib/solana/address";
import { fetchSolBalance } from "@/lib/solana/balance";
import type { AppClient } from "@/lib/solana/client";
import { SOLANA_NETWORK_NAME } from "@/lib/solana/config";
import { formatSol, formatSolExact } from "@/lib/solana/units";

const createdAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

// Status comes from the stored request, never from the URL or the customer.
const STATUS_META: Record<
  PaymentRequestStatus,
  { label: string; badgeClassName: string; dotClassName: string }
> = {
  pending: {
    label: "Pending",
    badgeClassName: "border-amber-400/25 bg-amber-400/10 text-amber-300",
    dotClassName: "bg-amber-300",
  },
  paid: {
    label: "Paid",
    badgeClassName: "border-accent/25 bg-accent-soft text-accent",
    dotClassName: "bg-accent",
  },
  expired: {
    label: "Expired",
    badgeClassName: "border-line bg-surface-raised text-muted",
    dotClassName: "bg-muted",
  },
  cancelled: {
    label: "Cancelled",
    badgeClassName: "border-red-400/25 bg-red-400/10 text-red-300",
    dotClassName: "bg-red-300",
  },
};

export default function CheckoutSummary({
  request,
  onCopyAddress,
  copied,
  onNext,
  onChangeWallet,
}: {
  request: PaymentRequest;
  onCopyAddress: () => void;
  copied: boolean;
  onNext?: () => void;
  onChangeWallet?: () => void;
}) {
  const client = useClient<AppClient>();
  const connectedWallet = useConnectedWallet(client);
  const payerAddress = connectedWallet?.account.address ?? null;

  const [balance, setBalance] = useState<bigint | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);

  const amountLamports = BigInt(request.amountLamports);
  // Devnet base fee estimate ~5000 lamports
  const requiredLamports = amountLamports + 5_000n;
  const hasSufficientBalance = balance !== null ? balance >= requiredLamports : null;

  useEffect(() => {
    if (!payerAddress) {
      setBalance(null);
      return;
    }

    let active = true;
    setIsLoadingBalance(true);

    fetchSolBalance(client, payerAddress)
      .then((b) => {
        if (active) setBalance(b);
      })
      .catch(() => {
        if (active) setBalance(null);
      })
      .finally(() => {
        if (active) setIsLoadingBalance(false);
      });

    return () => {
      active = false;
    };
  }, [client, payerAddress]);

  async function handleCopyReference() {
    try {
      await navigator.clipboard.writeText(request.reference);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 3000);
    } catch {
      // Clipboard unavailable
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface/90 p-6 shadow-xl space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft/40 px-2.5 py-1 text-[11px] font-medium text-accent">
            Step 2 of 3
          </div>
          <h2 className="mt-2 text-base font-semibold text-white">
            Review payment details
          </h2>
          <p className="mt-1 text-xs text-muted leading-relaxed">
            Verify the amount and recipient merchant details before proceeding to the payment signing stage.
          </p>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${STATUS_META[request.status].badgeClassName}`}
        >
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${STATUS_META[request.status].dotClassName}`}
          />
          {STATUS_META[request.status].label}
        </span>
      </div>

      {/* Amount Hero Banner */}
      <div className="rounded-xl border border-accent/20 bg-gradient-to-br from-accent/10 via-surface-raised to-accent-bright/5 p-5">
        <span className="text-xs font-medium text-neutral-400">Total Amount Due</span>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-3xl font-bold font-mono tracking-tight text-white">
            {formatSolExact(amountLamports)}
          </span>
          <span className="text-sm font-semibold text-accent">SOL</span>
          <span className="ml-auto rounded-md border border-line bg-black/40 px-2 py-0.5 text-[11px] font-mono text-neutral-300">
            {SOLANA_NETWORK_NAME}
          </span>
        </div>
      </div>

      {/* Key Details Grid */}
      <dl className="grid gap-4 rounded-xl border border-line/70 bg-surface-raised/40 p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">Merchant Recipient</dt>
          <dd className="mt-1">
            {request.merchantAddress ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onCopyAddress}
                  className="flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-2 py-1 text-xs font-mono text-neutral-300 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {copied ? (
                    <>
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
                      Copied
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
                        <rect x="9" y="9" width="11" height="11" rx="1.6" />
                        <path d="M5 15H4a1.6 1.6 0 0 1-1.6-1.6V4a1.6 1.6 0 0 1 1.6-1.6h1.2" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
                <span className="font-mono text-xs text-neutral-200">
                  {shortenAddress(request.merchantAddress)}
                </span>
              </div>
            ) : (
              <span className="font-sans text-muted">No merchant wallet recorded</span>
            )}
          </dd>
        </div>

        <div>
          <dt className="text-xs text-muted">Payment Reference</dt>
          <dd className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCopyReference()}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-2 py-1 text-xs font-mono text-neutral-300 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {copiedRef ? (
                <>
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
                  Copied
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
                    <rect x="9" y="9" width="11" height="11" rx="1.6" />
                    <path d="M5 15H4a1.6 1.6 0 0 1-1.6-1.6V4a1.6 1.6 0 0 1 1.6-1.6h1.2" />
                  </svg>
                  Copy
                </>
              )}
            </button>
            <span className="font-mono text-xs text-neutral-300 truncate max-w-[150px] sm:max-w-[180px]">
              {request.reference}
            </span>
          </dd>
        </div>

        <div className="sm:col-span-2">
          <dt className="text-xs text-muted">Description / Memo</dt>
          <dd className="mt-1 text-sm text-neutral-100 font-medium">
            {request.description || "No description provided"}
          </dd>
        </div>

        <div>
          <dt className="text-xs text-muted">Created</dt>
          <dd className="mt-0.5 text-xs text-neutral-300">
            {createdAtFormatter.format(new Date(request.createdAt))}
          </dd>
        </div>

        {request.customerName && (
          <div>
            <dt className="text-xs text-muted">Billed To</dt>
            <dd className="mt-0.5 text-xs text-neutral-200">
              {request.customerName}
              {request.customerEmail && (
                <span className="text-muted ml-1.5">({request.customerEmail})</span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {/* Connected Payer Wallet & Balance Check */}
      {payerAddress && (
        <div className="rounded-xl border border-line/80 bg-surface-raised/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-neutral-400">Paying from wallet</span>
            {onChangeWallet && (
              <button
                type="button"
                onClick={onChangeWallet}
                className="text-xs text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Change wallet
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-emerald-400" />
              <span className="font-mono text-neutral-200">
                {shortenAddress(payerAddress)}
              </span>
              <span className="text-muted">({connectedWallet?.wallet.name ?? "Wallet"})</span>
            </div>

            <div>
              {isLoadingBalance ? (
                <span className="text-muted animate-pulse">Checking Devnet balance…</span>
              ) : balance !== null ? (
                <span className="font-mono text-neutral-300">
                  Balance: <strong className="text-white">{formatSol(balance)} SOL</strong>
                </span>
              ) : (
                <span className="text-muted">Balance unavailable</span>
              )}
            </div>
          </div>

          {hasSufficientBalance === false && (
            <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-2.5 text-xs text-amber-300 flex items-start gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 shrink-0 mt-0.5" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div>
                <span>Your wallet balance is lower than the amount due plus transaction fee (~{formatSol(requiredLamports)} SOL). You may request free test SOL from a Solana Devnet faucet.</span>
              </div>
            </div>
          )}

          {hasSufficientBalance === true && (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Sufficient Devnet SOL balance for transfer and network fee</span>
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-line/60">
        {onChangeWallet ? (
          <button
            type="button"
            onClick={onChangeWallet}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-4 py-2.5 text-sm font-medium text-neutral-300 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span>Back to Wallet</span>
          </button>
        ) : <div />}

        {onNext && (
          <button
            type="button"
            onClick={onNext}
            className="inline-flex items-center justify-center gap-2 rounded-xl btn-brand-gradient px-6 py-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span>Next: Proceed to Payment</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
