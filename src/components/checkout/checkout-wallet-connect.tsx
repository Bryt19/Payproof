"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useClient } from "@solana/react";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useIsWalletReady,
  useWallets,
  useWalletStatus,
} from "@solana/kit-plugin-wallet/react";
import { shortenAddress } from "@/lib/solana/address";
import { useIsHydrated } from "@/lib/use-is-hydrated";
import type { AppClient } from "@/lib/solana/client";

type CopyState = "idle" | "copied" | "failed";

function CopyAddressButton({ address }: { address: string }) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }

    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyState("idle"), 4000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy address"}
    </button>
  );
}

export default function CheckoutWalletConnect({
  merchantAddress,
  onConnected,
}: {
  merchantAddress: string | null;
  onConnected?: () => void;
}) {
  const client = useClient<AppClient>();
  const isHydrated = useIsHydrated();

  const wallets = useWallets(client);
  const walletStatus = useWalletStatus(client);
  const connectedWallet = useConnectedWallet(client);
  const isReady = useIsWalletReady(client);

  const connect = useConnect(client);
  const disconnect = useDisconnect(client);

  const isConnecting =
    walletStatus === "connecting" || connect.isRunning;
  const isDisconnecting =
    walletStatus === "disconnecting" || disconnect.isRunning;
  const isConnected =
    isHydrated && isReady && Boolean(connectedWallet) && !isConnecting;

  const [selectedWallet, setSelectedWallet] = useState<string | null>(
    wallets[0]?.name ?? null,
  );

  const error = connect.isError && !isConnecting
    ? (connect.error instanceof Error ? connect.error.message : "Could not connect to the wallet.")
    : null;

  const prevConnectedRef = useRef(isConnected);

  // Auto-advance to next step when connection transitions from false -> true
  useEffect(() => {
    if (!prevConnectedRef.current && isConnected && onConnected) {
      onConnected();
    }
    prevConnectedRef.current = isConnected;
  }, [isConnected, onConnected]);

  const handleConnectWallet = useCallback(
    (walletName: string) => {
      setSelectedWallet(walletName);
      const wallet = wallets.find((w) => w.name === walletName);
      if (wallet) {
        connect.dispatch(wallet);
      }
    },
    [connect, wallets],
  );

  const reconnect = useCallback(() => {
    if (!selectedWallet) return;
    const wallet = wallets.find((w) => w.name === selectedWallet);
    if (wallet) connect.dispatch(wallet);
  }, [connect, selectedWallet, wallets]);

  // When the connected wallet disconnects unexpectedly, offer a reconnect.
  useEffect(() => {
    if (isHydrated && isReady && !connectedWallet) {
      const timer = setTimeout(() => {
        setSelectedWallet(wallets[0]?.name ?? null);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isHydrated, isReady, connectedWallet, wallets]);

  return (
    <div className="rounded-2xl border border-line bg-surface/90 p-6 shadow-xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft/40 px-2.5 py-1 text-[11px] font-medium text-accent">
            Step 1 of 3
          </div>
          <h2 className="mt-2 text-base font-semibold text-white">
            Connect your wallet
          </h2>
          <p className="mt-1 text-xs text-muted leading-relaxed">
            Connect your Solana wallet to proceed. Connecting only shares your public address;
            no transfer or signature occurs until you review and confirm in the final step.
          </p>
        </div>

        {isConnected && connectedWallet ? (
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-400">
            <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-medium">Connected</span>
          </div>
        ) : null}
      </div>

      {!isHydrated || !isReady ? (
        <div className="flex items-center gap-3 py-6 text-sm text-muted">
          <div className="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          <span>
            {isHydrated
              ? walletStatus === "reconnecting"
                ? "Reconnecting to your wallet…"
                : "Detecting installed Solana wallets…"
              : "Checking browser wallet extensions…"}
          </span>
        </div>
      ) : connectedWallet && !isConnecting ? (
        <div className="space-y-5 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-9 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-medium text-neutral-400">Connected as</p>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">
                    {connectedWallet.wallet.name}
                  </span>
                  <span className="font-mono text-xs text-neutral-300">
                    ({shortenAddress(connectedWallet.account.address)})
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <CopyAddressButton address={connectedWallet.account.address} />
              <button
                type="button"
                onClick={() => disconnect.dispatch()}
                disabled={isDisconnecting}
                className="rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDisconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          </div>

          {onConnected && (
            <div className="pt-2 border-t border-line/60">
              <button
                type="button"
                onClick={onConnected}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl btn-brand-gradient px-5 py-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span>Continue to Payment Details</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )}
        </div>
      ) : wallets.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface-raised/40 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-400/10 text-amber-300">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-neutral-200">
                No Solana wallet detected
              </h3>
              <p className="text-xs text-muted leading-relaxed">
                We couldn&apos;t detect a compatible Solana browser extension. Install Phantom, Solflare, or any Wallet Standard compatible wallet, switch to Solana Devnet, and refresh this page.
              </p>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap gap-2.5">
            <a
              href="https://phantom.app/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-white/5 hover:text-white"
            >
              Get Phantom
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
            <a
              href="https://solflare.com/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-white/5 hover:text-white"
            >
              Get Solflare
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted">
            Detected Wallets
          </p>

          <div className="grid gap-2.5 sm:grid-cols-2">
            {wallets.map((wallet) => {
              const isSelected = selectedWallet === wallet.name;
              return (
                <button
                  key={wallet.name}
                  type="button"
                  disabled={isConnecting}
                  onClick={() => handleConnectWallet(wallet.name)}
                  className={`group relative flex items-center justify-between gap-3 rounded-xl border p-3.5 text-left transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    isSelected
                      ? "border-accent bg-accent/10 shadow-sm"
                      : "border-line bg-surface-raised/60 hover:border-line-strong hover:bg-surface-raised"
                  } ${isConnecting ? "cursor-wait opacity-70" : "cursor-pointer"}`}
                >
                  <div className="flex items-center gap-3">
                    {wallet.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={wallet.icon}
                        alt=""
                        className="size-7 rounded-lg object-contain"
                      />
                    ) : (
                      <div className="grid size-7 place-items-center rounded-lg bg-white/10 text-neutral-300">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
                          <rect x="2" y="4" width="20" height="16" rx="2" />
                          <circle cx="16" cy="12" r="2" />
                        </svg>
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold text-neutral-100 group-hover:text-white">
                        {wallet.name}
                      </p>
                      <p className="text-[11px] text-muted">Click to connect</p>
                    </div>
                  </div>

                  {isConnecting && isSelected ? (
                    <div className="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                  ) : (
                    <div className="grid size-6 place-items-center rounded-full border border-line bg-white/[0.03] text-muted group-hover:text-white group-hover:border-line-strong">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {error && (
            <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={reconnect}
              disabled={isConnecting || !selectedWallet}
              className="rounded-xl btn-brand-gradient px-5 py-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isConnecting ? "Connecting…" : `Connect ${selectedWallet ?? "Wallet"}`}
            </button>
          </div>
        </div>
      )}

      {merchantAddress && (
        <p className="text-xs text-muted border-t border-line/60 pt-4">
          Merchant recipient: <span className="font-mono text-neutral-300">{shortenAddress(merchantAddress)}</span>
        </p>
      )}
    </div>
  );
}
