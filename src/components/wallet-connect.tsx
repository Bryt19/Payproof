"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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

const noSubscription = () => () => {};

/**
 * `false` while server rendering and during the hydration render, `true` once
 * the browser has taken over.
 *
 * The wallet hooks use the live client store as their server snapshot too, so a
 * wallet registered before hydration (an extension injects at document start)
 * would otherwise render different text than the server HTML.
 */
function useIsHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function describeWalletError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "The request was cancelled because a newer one started.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "The wallet did not complete the request. Please try again.";
}

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
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-gray-700 dark:hover:bg-gray-900"
      >
        Copy address
      </button>

      <span role="status" className="text-xs text-gray-600 dark:text-gray-400">
        {copyState === "copied" && "Full address copied to clipboard."}
        {copyState === "failed" &&
          "Copying is unavailable in this browser. Show the full address and copy it manually."}
      </span>
    </div>
  );
}

function ConnectedWalletDetails({
  walletName,
  address,
}: {
  walletName: string;
  address: string;
}) {
  return (
    <div className="mt-4">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-gray-600 dark:text-gray-400">Wallet</dt>
        <dd className="font-medium">{walletName}</dd>

        <dt className="text-gray-600 dark:text-gray-400">Address</dt>
        <dd className="font-mono" title={address}>
          {shortenAddress(address)}
        </dd>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <CopyAddressButton address={address} />

        <details className="text-xs">
          <summary className="cursor-pointer text-gray-600 dark:text-gray-400">
            Show full address
          </summary>
          <code className="mt-2 block break-all font-mono text-gray-700 dark:text-gray-300">
            {address}
          </code>
        </details>
      </div>
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

  function handleConnect() {
    const wallet = wallets.find((candidate) => candidate.name === selectedWalletName);

    if (wallet) connect.dispatch(wallet);
  }

  return (
    <section
      aria-labelledby="wallet-heading"
      aria-busy={isHydrated && (isConnecting || isDisconnecting)}
      className="rounded-xl border border-gray-200 p-6 dark:border-gray-800"
    >
      <h2 id="wallet-heading" className="text-lg font-semibold">
        Wallet
      </h2>

      <p role="status" className="mt-3 text-sm font-medium">
        {statusText}
      </p>

      {!isHydrated || !isReady ? null : connectedWallet && !isConnecting ? (
        <>
          <ConnectedWalletDetails
            walletName={connectedWallet.wallet.name}
            address={connectedWallet.account.address}
          />

          <WalletBalance
            key={connectedWallet.account.address}
            client={client}
            address={connectedWallet.account.address}
          />

          <button
            type="button"
            onClick={() => disconnect.dispatch()}
            disabled={isDisconnecting}
            className="mt-5 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            {isDisconnecting ? "Disconnecting…" : "Disconnect Wallet"}
          </button>

          {disconnectError && (
            <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
              Could not disconnect: {disconnectError}
            </p>
          )}
        </>
      ) : wallets.length === 0 ? (
        <>
          <p className="mt-4 text-sm">
            No compatible Solana wallet was detected in this browser.
          </p>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Install Phantom or another Wallet Standard wallet for Solana Devnet,
            then reload this page.
          </p>
        </>
      ) : (
        <>
          <fieldset className="mt-4" disabled={isConnecting}>
            <legend className="text-sm font-medium">Available wallets</legend>

            <ul className="mt-2 space-y-2">
              {wallets.map((wallet, index) => (
                <li key={`${wallet.name}-${index}`}>
                  <label
                    htmlFor={`wallet-option-${index}`}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-gray-200 p-3 text-sm hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900"
                  >
                    <input
                      type="radio"
                      id={`wallet-option-${index}`}
                      name="wallet"
                      value={wallet.name}
                      checked={selectedWalletName === wallet.name}
                      onChange={() => setPreferredWallet(wallet.name)}
                      className="size-4 accent-blue-600"
                    />
                    <span className="font-medium">{wallet.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          {hasPhantom && (
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              Phantom is available in this browser.
            </p>
          )}

          <button
            type="button"
            onClick={handleConnect}
            disabled={isConnecting || !selectedWalletName}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            {isConnecting ? "Connecting…" : "Connect Wallet"}
          </button>

          {connectError && (
            <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
              Could not connect: {connectError}
            </p>
          )}
        </>
      )}
    </section>
  );
}
