"use client";

import { useClient } from "@solana/react";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import type { AppClient } from "@/lib/solana/client";
import { useIsHydrated } from "@/lib/use-is-hydrated";

/**
 * The connected merchant wallet address, or `null` when no wallet is connected.
 *
 * Reads the same wallet store as the header control; it does not connect,
 * sign or send anything. `isHydrated` is false during server rendering and the
 * hydration render, where the address is reported as `null` so markup matches.
 */
export function useMerchantWallet(): {
  address: string | null;
  walletName: string | null;
  isHydrated: boolean;
} {
  const client = useClient<AppClient>();
  const isHydrated = useIsHydrated();
  const connectedWallet = useConnectedWallet(client);

  return {
    address: isHydrated ? (connectedWallet?.account.address ?? null) : null,
    walletName: isHydrated ? (connectedWallet?.wallet.name ?? null) : null,
    isHydrated,
  };
}
