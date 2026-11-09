"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useClient } from "@solana/react";
import {
  useConnectedWallet,
  useIsWalletReady,
} from "@solana/kit-plugin-wallet/react";
import { BrandMark } from "@/components/dashboard/icons";
import { SOLANA_NETWORK_NAME } from "@/lib/solana/config";
import type { PaymentRequest } from "@/lib/payment-requests/types";
import { shortenAddress } from "@/lib/solana/address";
import { useIsHydrated } from "@/lib/use-is-hydrated";
import type { AppClient } from "@/lib/solana/client";
import CheckoutPayment from "./checkout-payment";
import CheckoutSummary from "./checkout-summary";
import CheckoutWalletConnect from "./checkout-wallet-connect";

type CheckoutStep = 1 | 2 | 3;

interface StepMeta {
  number: CheckoutStep;
  title: string;
  shortLabel: string;
}

const STEPS: StepMeta[] = [
  { number: 1, title: "Connect Wallet", shortLabel: "Wallet" },
  { number: 2, title: "Review Details", shortLabel: "Details" },
  { number: 3, title: "Make Payment", shortLabel: "Payment" },
];

export default function CheckoutShell({
  request,
  isLoading,
  error,
}: {
  request: PaymentRequest | null;
  isLoading: boolean;
  error: string | null;
}) {
  const client = useClient<AppClient>();
  const isHydrated = useIsHydrated();
  const isWalletReady = useIsWalletReady(client);
  const connectedWallet = useConnectedWallet(client);

  const isConnected =
    isHydrated && isWalletReady && Boolean(connectedWallet);

  // Default to Step 1. When connected, auto-advance to Step 2.
  const [currentStep, setCurrentStep] = useState<CheckoutStep>(1);
  const [copied, setCopied] = useState(false);
  const [hasAutoAdvanced, setHasAutoAdvanced] = useState(false);

  // If wallet connects or is already connected, advance to Step 2
  useEffect(() => {
    if (isConnected && !hasAutoAdvanced) {
      setCurrentStep(2);
      setHasAutoAdvanced(true);
    }
  }, [isConnected, hasAutoAdvanced]);

  // If wallet disconnects while on step 2 or 3, fall back to step 1
  useEffect(() => {
    if (isHydrated && isWalletReady && !connectedWallet && currentStep > 1) {
      setCurrentStep(1);
    }
  }, [isHydrated, isWalletReady, connectedWallet, currentStep]);

  async function copyAddress() {
    if (!request?.merchantAddress) return;
    try {
      await navigator.clipboard.writeText(request.merchantAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 3500);
    } catch {
      // Clipboard unavailable.
    }
  }

  const isRequestPaid = request?.status === "paid";
  const isRequestClosed =
    request?.status === "expired" || request?.status === "cancelled";

  return (
    <div className="min-h-screen bg-canvas text-ink selection:bg-[#9945FF]/40 selection:text-white">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur-md px-4 py-3.5 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="Payproof home"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] shadow-sm">
              <BrandMark className="size-5" />
            </span>
            <span className="text-sm font-bold tracking-tight text-white">Payproof</span>
          </Link>

          <div className="flex items-center gap-3">
            {connectedWallet && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-raised px-2.5 py-1 text-xs font-mono text-neutral-300">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {shortenAddress(connectedWallet.account.address)}
              </span>
            )}

            <div className="flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft/30 px-2.5 py-1 text-xs font-medium text-accent">
              <span className="size-1.5 rounded-full bg-accent animate-pulse" />
              {SOLANA_NETWORK_NAME}
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        {isLoading ? (
          <section aria-labelledby="checkout-loading-heading" className="space-y-4 pt-10">
            <div className="flex items-center gap-3 text-sm font-medium text-neutral-300">
              <div className="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <p id="checkout-loading-heading">Loading payment request…</p>
            </div>
            <div className="flex gap-2">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="h-2 w-full rounded-full bg-surface-raised animate-pulse"
                  style={{ animationDelay: `${index * 80}ms` }}
                />
              ))}
            </div>
          </section>
        ) : error ? (
          <section aria-labelledby="checkout-error-heading" className="space-y-4 pt-6">
            <h2
              id="checkout-error-heading"
              className="text-base font-semibold text-red-300"
            >
              Could not load this payment request
            </h2>
            <p className="text-sm text-muted">{error}</p>
            <div className="rounded-2xl border border-line bg-surface p-6 shadow-xl">
              <p className="text-xs text-muted leading-relaxed">
                This can happen if the reference link is invalid, the request was
                never generated, or the network is temporarily unreachable.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-white/5"
                >
                  Back to dashboard
                </Link>
              </div>
            </div>
          </section>
        ) : request ? (
          <div className="space-y-8">
            {/* Page Header */}
            <div className="text-center sm:text-left">
              <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {isRequestPaid
                  ? "Payment Receipt"
                  : isRequestClosed
                    ? "Payment Request Closed"
                    : "Complete Payment"}
              </h1>
              <p className="mt-1.5 text-xs sm:text-sm text-muted">
                {isRequestPaid
                  ? "This request has been paid and independently verified on Solana Devnet."
                  : isRequestClosed
                    ? "This payment request is closed and can no longer receive transfers."
                    : "Follow the steps below to connect your wallet, review details, and sign."}
              </p>
            </div>

            {/* Multi-step progress bar (shown only for active pending requests) */}
            {!isRequestPaid && !isRequestClosed && (
              <nav aria-label="Checkout Progress" className="w-full">
                <ol className="grid grid-cols-3 gap-2 sm:gap-4">
                  {STEPS.map((step) => {
                    const isCompleted = currentStep > step.number || (step.number === 1 && isConnected);
                    const isCurrent = currentStep === step.number;
                    const isUpcoming = currentStep < step.number;

                    const canNavigateBack = isCompleted && !isCurrent;

                    return (
                      <li key={step.number} className="relative">
                        <button
                          type="button"
                          disabled={!canNavigateBack}
                          onClick={() => {
                            if (canNavigateBack) {
                              setCurrentStep(step.number);
                            }
                          }}
                          className={`w-full flex flex-col items-center gap-1.5 rounded-xl border p-2.5 text-center transition-all ${
                            isCurrent
                              ? "border-accent bg-accent/10 shadow-[0_0_15px_rgba(153,69,255,0.2)]"
                              : isCompleted
                                ? "border-emerald-500/30 bg-emerald-500/[0.04] hover:bg-emerald-500/10 cursor-pointer"
                                : "border-line bg-surface-raised/30 opacity-60 cursor-not-allowed"
                          }`}
                        >
                          <div className="flex items-center justify-center">
                            {isCompleted ? (
                              <span className="grid size-6 place-items-center rounded-full bg-emerald-500/20 text-emerald-400">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              </span>
                            ) : (
                              <span
                                className={`grid size-6 place-items-center rounded-full text-xs font-semibold ${
                                  isCurrent
                                    ? "bg-accent text-accent-ink"
                                    : "bg-surface-raised text-muted border border-line"
                                }`}
                              >
                                {step.number}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-col items-center">
                            <span
                              className={`text-xs font-medium ${
                                isCurrent
                                  ? "text-white font-semibold"
                                  : isCompleted
                                    ? "text-neutral-200"
                                    : "text-muted"
                              }`}
                            >
                              <span className="hidden sm:inline">{step.title}</span>
                              <span className="sm:hidden">{step.shortLabel}</span>
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </nav>
            )}

            {/* Step Content */}
            {isRequestPaid || isRequestClosed ? (
              <CheckoutPayment request={request} />
            ) : (
              <>
                {/* Step 1: Connect Wallet */}
                {currentStep === 1 && (
                  <CheckoutWalletConnect
                    merchantAddress={request.merchantAddress}
                    onConnected={() => setCurrentStep(2)}
                  />
                )}

                {/* Step 2: Payment Details with Next Button */}
                {currentStep === 2 && (
                  <CheckoutSummary
                    request={request}
                    onCopyAddress={copyAddress}
                    copied={copied}
                    onChangeWallet={() => setCurrentStep(1)}
                    onNext={() => setCurrentStep(3)}
                  />
                )}

                {/* Step 3: Payment Making Stage */}
                {currentStep === 3 && (
                  <CheckoutPayment
                    request={request}
                    onBack={() => setCurrentStep(2)}
                  />
                )}
              </>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}
