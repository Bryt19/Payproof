import { address } from "@solana/kit";
import type { AppClient } from "./client";

/** Upper bound for a single balance request so the UI cannot hang. */
const BALANCE_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Reads the confirmed SOL balance of an address on the configured cluster
 * (Devnet). Returns lamports as a bigint so no precision is lost.
 */
export async function fetchSolBalance(
  client: AppClient,
  accountAddress: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<bigint> {
  const timeout = AbortSignal.timeout(BALANCE_REQUEST_TIMEOUT_MS);
  const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  // Wallet Standard account addresses are plain strings; `address()` validates
  // the base58 encoding that the RPC method requires.
  const { value } = await client.rpc
    .getBalance(address(accountAddress), { commitment: "confirmed" })
    .send({ abortSignal });

  return value;
}
