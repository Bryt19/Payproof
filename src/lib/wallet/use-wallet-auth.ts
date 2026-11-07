"use client";

import { useCallback, useState } from "react";
import { useClient } from "@solana/react";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useIsWalletReady,
  useReconnectingAccount,
  useWalletStatus,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import type { AppClient } from "@/lib/solana/client";
import { useIsHydrated } from "@/lib/use-is-hydrated";
import { describeWalletError } from "./wallet-errors";

/**
 * `checking` covers the window where the browser wallets are still being
 * discovered and the last session is being restored. Callers must render a
 * skeleton during that window instead of guessing whether a wallet is
 * connected.
 */
export type WalletAuthStatus =
  | "checking"
  | "disconnected"
  | "connecting"
  | "connected";

export type WalletAuth = {
  status: WalletAuthStatus;
  isChecking: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  wallets: ReturnType<typeof useWallets>;
  walletName: string | null;
  address: string | null;
  reconnectingTo: string | null;
  error: string | null;
  connect: (walletName?: string) => void;
  retry: () => void;
  disconnect: () => void;
};

/**
 * Single source of truth for the wallet session.
 *
 * The hero CTA and any other wallet-aware button read the same wallet store
 * through this hook, so labels cannot drift out of sync.
 */
export function useWalletAuth(): WalletAuth {
  const client = useClient<AppClient>();
  const isHydrated = useIsHydrated();

  const wallets = useWallets(client);
  const walletStatus = useWalletStatus(client);
  const connectedWallet = useConnectedWallet(client);
  const reconnectingTo = useReconnectingAccount(client);
  const isWalletReady = useIsWalletReady(client);

  const connect = useConnect(client);
  const disconnect = useDisconnect(client);

  const [lastWalletName, setLastWalletName] = useState<string | null>(null);

  const isConnecting = walletStatus === "connecting" || connect.isRunning;
  const isChecking =
    !isHydrated || !isWalletReady || walletStatus === "reconnecting";
  const isConnected = !isChecking && Boolean(connectedWallet);

  const status: WalletAuthStatus = isChecking
    ? "checking"
    : isConnecting
      ? "connecting"
      : isConnected
        ? "connected"
        : "disconnected";

  const error =
    connect.isError && !isConnecting ? describeWalletError(connect.error) : null;

  const connectTo = useCallback(
    (walletName?: string) => {
      const target =
        (walletName
          ? wallets.find((candidate) => candidate.name === walletName)
          : undefined) ?? wallets[0];

      if (!target) return;

      setLastWalletName(target.name);
      connect.dispatch(target);
    },
    [connect, wallets],
  );

  const retry = useCallback(() => {
    connectTo(lastWalletName ?? undefined);
  }, [connectTo, lastWalletName]);

  const disconnectWallet = useCallback(() => {
    disconnect.dispatch();
  }, [disconnect]);

  return {
    status,
    isChecking,
    isConnecting,
    isConnected,
    wallets,
    walletName: isHydrated
      ? (connectedWallet?.wallet.name ?? null)
      : null,
    address: isHydrated
      ? (connectedWallet?.account.address ?? null)
      : null,
    reconnectingTo: reconnectingTo?.address ?? null,
    error,
    connect: connectTo,
    retry,
    disconnect: disconnectWallet,
  };
}
