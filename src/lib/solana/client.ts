"use client";

import { createClient } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { walletSigner } from "@solana/kit-plugin-wallet";
import { SOLANA_RPC_URL } from "./config";

/**
 * Single application-wide Solana Kit client for the browser.
 *
 * `walletSigner` is installed because `solanaRpc` requires a payer on the
 * client; it does not connect to a wallet or prompt for signatures on its own.
 * It is SSR-safe, so the same client can be shared during server rendering.
 */
export const solanaClient = createClient()
  .use(walletSigner({ chain: "solana:devnet" }))
  .use(solanaRpc({ rpcUrl: SOLANA_RPC_URL }));

export type AppClient = typeof solanaClient;

/** How long a fetched slot is reused before another RPC call is made. */
export const SLOT_MAX_AGE_MS = 10_000;

/** Upper bound for a single `getSlot` request so the UI cannot hang. */
const SLOT_REQUEST_TIMEOUT_MS = 10_000;

let cachedSlot: { value: bigint; fetchedAt: number } | null = null;
let pendingSlot: Promise<bigint> | null = null;

/**
 * Reads the current Devnet slot.
 *
 * Concurrent callers — including React StrictMode's double-mounted effects and
 * re-renders — share one in-flight request, and results are reused for
 * {@link SLOT_MAX_AGE_MS}. Pass `maxAgeMs: 0` to force a fresh request for an
 * explicit user-initiated refresh.
 */
export function getCurrentSlot(
  client: AppClient,
  { maxAgeMs = SLOT_MAX_AGE_MS }: { maxAgeMs?: number } = {},
): Promise<bigint> {
  if (cachedSlot && Date.now() - cachedSlot.fetchedAt < maxAgeMs) {
    return Promise.resolve(cachedSlot.value);
  }

  if (pendingSlot) {
    return pendingSlot;
  }

  pendingSlot = client.rpc
    .getSlot({ commitment: "confirmed" })
    .send({ abortSignal: AbortSignal.timeout(SLOT_REQUEST_TIMEOUT_MS) })
    .then((slot) => {
      cachedSlot = { value: slot, fetchedAt: Date.now() };
      return slot;
    })
    .finally(() => {
      pendingSlot = null;
    });

  return pendingSlot;
}
