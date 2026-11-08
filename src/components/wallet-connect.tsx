"use client";

import { useEffect, useRef, useState } from "react";
import { useClient } from "@solana/react";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useIsWalletReady,
  useReconnectingAccount,
  useWallets,
  useWalletStatus,
} from "@solana/kit-plugin-wallet/react";
import type { AppClient } from "@/lib/solana/client";
import WalletBalance from "@/components/wallet-balance";
import { ChevronDownIcon } from "@/components/dashboard/icons";
import { shortenAddress } from "@/lib/solana/address";
import { useIsHydrated } from "@/lib/use-is-hydrated";
import { describeWalletError } from "@/lib/wallet/wallet-errors";

type CopyState = "idle" | "copied" | "failed";

function CopyAddressButton({ address }: { address: string }) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

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
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="rounded-md border border-line px-2 py-1 text-[11px] font-medium text-neutral-300 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {copyState === "copied" ? "Copied" : "Copy address"}
      </button>

      <span role="status" className="text-[11px] text-muted">
        {copyState === "copied" && "Address copied."}
        {copyState === "failed" && "Copy unavailable — select the address."}
      </span>
    </div>
  );
}

export default function WalletConnect() {
  const client = useClient<AppClient>();
  const isHydrated = useIsHydrated();

  const wallets = useWallets(client);
  const walletStatus = useWalletStatus(client);
  const connectedWallet = useConnectedWallet(client);
  const reconnectingTo = useReconnectingAccount(client);
  const isReady = useIsWalletReady(client);

  const connect = useConnect(client);
  const disconnect = useDisconnect(client);

  const [preferredWallet, setPreferredWallet] = useState<string | null>(null);
  const panelRef = useRef<HTMLDetailsElement>(null);

  const selectedWalletName =
    (preferredWallet && wallets.some((wallet) => wallet.name === preferredWallet)
      ? preferredWallet
      : null) ??
    wallets[0]?.name ??
    null;

  const hasPhantom = wallets.some((wallet) => wallet.name === "Phantom");

  const isConnecting = walletStatus === "connecting" || connect.isRunning;
  const isDisconnecting = walletStatus === "disconnecting" || disconnect.isRunning;

  const connectError =
    connect.isError && !isConnecting ? describeWalletError(connect.error) : null;
  const disconnectError =
    disconnect.isError && !isDisconnecting
      ? describeWalletError(disconnect.error)
      : null;

  const statusText = !isHydrated
    ? "Checking for browser wallets…"
    : !isReady
      ? walletStatus === "reconnecting"
        ? reconnectingTo
          ? `Reconnecting to ${shortenAddress(reconnectingTo.address)}…`
          : "Reconnecting to your last wallet…"
        : "Checking for browser wallets…"
      : isConnecting
        ? "Connecting to wallet…"
        : isDisconnecting
          ? "Disconnecting wallet…"
          : connectedWallet
            ? "Connected"
            : "Not connected";

  // Close the menu once a wallet is connected; the summary then shows the
  // connected account instead of the picker.
  useEffect(() => {
    if (connectedWallet) panelRef.current?.removeAttribute("open");
  }, [connectedWallet]);

  const isConnectedView =
    isHydrated && isReady && Boolean(connectedWallet) && !isConnecting;

  function handleConnect() {
    const wallet = wallets.find((candidate) => candidate.name === selectedWalletName);

    if (wallet) connect.dispatch(wallet);
  }

  function handleDisconnect() {
    panelRef.current?.removeAttribute("open");
    disconnect.dispatch();
  }

  return (
    <div className="relative">
      <p role="status" className="sr-only">
        {statusText}
      </p>

      <details ref={panelRef} className="group">
        <summary
          aria-busy={isHydrated && (isConnecting || isDisconnecting)}
          className={`flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden ${
            isConnectedView
              ? "border border-line bg-surface text-neutral-200 hover:border-line-strong"
              : "border border-accent/30 bg-accent font-medium text-accent-ink hover:bg-accent/90"
          }`}
        >
          {isConnectedView && connectedWallet ? (
            <>
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full bg-accent"
              />
              <span className="hidden max-w-[7rem] truncate font-medium sm:inline">
                {connectedWallet.wallet.name}
              </span>
              <span className="font-mono text-xs text-muted">
                {shortenAddress(connectedWallet.account.address)}
              </span>
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted transition-transform group-open:rotate-180" />
            </>
          ) : (
            <span>{isConnecting ? "Connecting…" : "Connect wallet"}</span>
          )}
        </summary>

        <div className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface-raised p-4 shadow-lg shadow-black/40">
          {!isHydrated || !isReady ? (
            <p className="text-xs text-muted">{statusText}</p>
          ) : connectedWallet && !isConnecting ? (
            <>
              <p className="text-[11px] uppercase tracking-wide text-muted">
                Connected wallet
              </p>
              <p className="mt-1 text-sm font-medium text-neutral-100">
                {connectedWallet.wallet.name}
              </p>
              <p className="mt-1 break-all font-mono text-[11px] text-neutral-400">
                {connectedWallet.account.address}
              </p>

              <CopyAddressButton address={connectedWallet.account.address} />

              <WalletBalance
                key={connectedWallet.account.address}
                client={client}
                address={connectedWallet.account.address}
              />

              <button
                type="button"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="mt-4 w-full rounded-lg border border-line px-3 py-2 text-sm font-medium text-neutral-200 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDisconnecting ? "Disconnecting…" : "Disconnect wallet"}
              </button>

              {disconnectError && (
                <p role="alert" className="mt-3 text-xs text-red-300">
                  Could not disconnect: {disconnectError}
                </p>
              )}
            </>
          ) : wallets.length === 0 ? (
            <>
              <p className="text-sm text-neutral-200">
                No compatible Solana wallet detected.
              </p>
              <p className="mt-1 text-xs text-muted">
                Install Phantom or another Wallet Standard wallet for Solana
                Devnet, then reload this page.
              </p>
            </>
          ) : (
            <>
              <fieldset disabled={isConnecting}>
                <legend className="text-[11px] uppercase tracking-wide text-muted">
                  Available wallets
                </legend>

                <ul className="mt-2 space-y-1.5">
                  {wallets.map((wallet, index) => (
                    <li key={`${wallet.name}-${index}`}>
                      <label
                        htmlFor={`wallet-option-${index}`}
                        className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm hover:bg-white/[0.04]"
                      >
                        <input
                          type="radio"
                          id={`wallet-option-${index}`}
                          name="wallet"
                          value={wallet.name}
                          checked={selectedWalletName === wallet.name}
                          onChange={() => setPreferredWallet(wallet.name)}
                          className="size-3.5 accent-[#34d399]"
                        />
                        <span className="font-medium text-neutral-200">
                          {wallet.name}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>

              {hasPhantom && (
                <p className="mt-2 text-[11px] text-muted">
                  Phantom is available in this browser.
                </p>
              )}

              <button
                type="button"
                onClick={handleConnect}
                disabled={isConnecting || !selectedWalletName}
                className="mt-3 w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isConnecting ? "Connecting…" : "Connect wallet"}
              </button>

              {connectError && (
                <p role="alert" className="mt-3 text-xs text-red-300">
                  Could not connect: {connectError}
                </p>
              )}
            </>
          )}
        </div>
      </details>
    </div>
  );
}
