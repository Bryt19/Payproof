"use client";

import { useEffect, useRef, useState } from "react";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";
import { wallet } from "@content/payproof";

export default function DashboardGate({ children }: { children: React.ReactNode }) {
  const { status, isConnected, isConnecting, wallets, connect, error, retry } =
    useWalletAuth();
  const [showPrompt, setShowPrompt] = useState(false);
  const promptRef = useRef<HTMLDivElement>(null);
  const hasCompleted = useRef(false);

  // Determine whether to show the connect prompt.
  // - While wallets are still being checked, show a skeleton instead.
  // - Once checks are done and no wallet is connected, show the prompt.
  useEffect(() => {
    if (status === "checking") {
      setShowPrompt(false);
      return;
    }

    if (status === "connected") {
      setShowPrompt(false);
      hasCompleted.current = false;
      return;
    }

    // disconnected (or connecting) — show the prompt once.
    if (!showPrompt) setShowPrompt(true);
  }, [status, showPrompt]);

  // Reset completion guard each time the prompt opens so a later session
  // can also flow back into the dashboard.
  useEffect(() => {
    if (!showPrompt) return;
    hasCompleted.current = false;
  }, [showPrompt]);

  // Wire up connection completion: when the user connects through the
  // prompt, dismiss it and let the dashboard render.
  useEffect(() => {
    if (!showPrompt) return;
    if (status !== "connected" || hasCompleted.current) return;

    hasCompleted.current = true;
    setShowPrompt(false);
  }, [showPrompt, status]);

  // Close the prompt on outside click or Escape when not connecting.
  useEffect(() => {
    if (!showPrompt) return;

    function handlePointerDown(e: MouseEvent) {
      if (promptRef.current && !promptRef.current.contains(e.target as Node)) {
        // Don't dismiss while connecting — the user is mid-flow.
        if (!isConnecting) setShowPrompt(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isConnecting) setShowPrompt(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showPrompt, isConnecting]);

  // Block body scroll while the prompt is open.
  useEffect(() => {
    if (!showPrompt) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [showPrompt]);

  // Still checking for wallets — render a skeleton so the page never
  // looks broken while the wallet store initialises.
  if (status === "checking") {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-canvas"
        aria-busy="true"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-64 animate-pulse rounded-xl border border-white/10 bg-white/[0.05]" />
          <div className="h-4 w-96 animate-pulse rounded-lg border border-white/5 bg-white/[0.03]" />
          <div className="h-10 w-full max-w-xs animate-pulse rounded-full border border-white/10 bg-white/[0.06]" />
        </div>
      </div>
    );
  }

  // Wallet is connected — render the dashboard normally.
  if (isConnected) {
    return <>{children}</>;
  }

  // Not connected — show the connect prompt as an overlay.
  if (!showPrompt) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-prompt-title"
      ref={promptRef}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 cursor-default"
        aria-hidden="true"
      />

      {/* Card */}
      <div
        className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0E0E12] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.8)]"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="connect-prompt-title"
              className="text-lg font-bold tracking-tight text-white"
            >
              Connect your wallet
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-white/55">
              You need to connect a Solana wallet to view the merchant dashboard.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowPrompt(false)}
            disabled={isConnecting}
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-[#9945FF] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close"
          >
            <svg
              className="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Wallet picker */}
        <div className="mt-5">
          {wallets.length === 0 ? (
            <div
              role="status"
              className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"
            >
              <p className="text-sm font-medium text-white/85">
                No Solana wallet detected
              </p>
              <p className="mt-1 text-xs leading-relaxed text-white/45">
                Install Phantom or another Wallet Standard wallet for Solana
                Devnet, then reload this page.
              </p>
            </div>
          ) : (
            <>
              <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">
                Available wallets
              </p>
              <ul className="mt-2 space-y-2">
                {wallets.map((option, index) => (
                  <li key={`${option.name}-${index}`}>
                    <button
                      type="button"
                      autoFocus={index === 0}
                      disabled={isConnecting}
                      onClick={() => connect(option.name)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm font-medium text-white/85 transition-colors hover:border-[#9945FF]/40 hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-[#9945FF] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>{option.name}</span>
                      <span aria-hidden="true" className="text-white/30">
                        →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {isConnecting && (
            <p role="status" className="mt-3 text-xs text-[#14F195]">
              Waiting for your wallet…
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="mt-3 rounded-xl border border-red-400/25 bg-red-400/[0.06] p-3"
            >
              <p className="text-xs leading-relaxed text-red-200/90">
                Could not connect. {error}
              </p>
              <button
                type="button"
                onClick={retry}
                disabled={isConnecting || wallets.length === 0}
                className="mt-2 rounded-full border border-red-300/30 px-3 py-1 text-[11px] font-semibold text-red-100 transition-colors hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Try again
              </button>
            </div>
          )}
        </div>

        {/* Footnote */}
        <p className="mt-5 border-t border-white/[0.06] pt-4 text-[11px] leading-relaxed text-white/35">
          Your wallet signs every payment. Payproof never holds your keys or funds.
        </p>
      </div>
    </div>
  );
}
