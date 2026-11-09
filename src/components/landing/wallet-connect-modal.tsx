"use client";

import { useEffect, useRef } from "react";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";
import { wallet } from "@content/payproof";

export function WalletConnectModal({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}) {
  const { status, wallets, isConnecting, error, connect, retry } =
    useWalletAuth();

  const awaitingConnect = useRef(false);
  const hasCompleted = useRef(false);

  // Reset the guards each time the dialog opens so a later session can also
  // continue into the payment flow.
  useEffect(() => {
    if (!open) return;
    awaitingConnect.current = false;
    hasCompleted.current = false;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (status !== "connected" || !awaitingConnect.current) return;
    if (hasCompleted.current) return;

    hasCompleted.current = true;
    onConnected();
  }, [open, status, onConnected]);

  const handleSelectWallet = (walletName: string) => {
    awaitingConnect.current = true;
    connect(walletName);
  };

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-connect-title"
    >
      <button
        type="button"
        aria-label={wallet.modal.close}
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />

      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0E0E12] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.8)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="wallet-connect-title"
              className="text-lg font-bold tracking-tight text-white"
            >
              {wallet.modal.title}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-white/55">
              {wallet.modal.description}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-[#9945FF]"
          >
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
            <span className="sr-only">{wallet.modal.close}</span>
          </button>
        </div>

        <div className="mt-5">
          {status === "checking" ? (
            <div className="space-y-2" aria-live="polite">
              <div className="h-11 animate-pulse rounded-xl bg-white/[0.05]" />
              <div className="h-11 animate-pulse rounded-xl bg-white/[0.04]" />
              <p className="pt-1 text-[11px] text-white/40">
                {wallet.modal.checking}
              </p>
            </div>
          ) : wallets.length === 0 ? (
            <div role="status" className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <p className="text-sm font-medium text-white/85">
                {wallet.modal.noWalletsTitle}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-white/45">
                {wallet.modal.noWalletsDescription}
              </p>
            </div>
          ) : (
            <>
              <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">
                {wallet.modal.availableWallets}
              </p>
              <ul className="mt-2 space-y-2">
                {wallets.map((option, index) => (
                  <li key={`${option.name}-${index}`}>
                    <button
                      type="button"
                      autoFocus={index === 0}
                      disabled={isConnecting}
                      onClick={() => handleSelectWallet(option.name)}
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
              {wallet.modal.connecting}
            </p>
          )}

          {error && (
            <div role="alert" className="mt-3 rounded-xl border border-red-400/25 bg-red-400/[0.06] p-3">
              <p className="text-xs leading-relaxed text-red-200/90">
                {wallet.errorPrefix} {error}
              </p>
              <button
                type="button"
                onClick={retry}
                disabled={isConnecting || wallets.length === 0}
                className="mt-2 rounded-full border border-red-300/30 px-3 py-1 text-[11px] font-semibold text-red-100 transition-colors hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {wallet.retry}
              </button>
            </div>
          )}
        </div>

        <p className="mt-5 border-t border-white/[0.06] pt-4 text-[11px] leading-relaxed text-white/35">
          {wallet.modal.footnote}
        </p>
      </div>
    </div>
  );
}
