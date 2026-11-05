/**
 * Browser-safe Solana configuration.
 *
 * Only `NEXT_PUBLIC_*` environment variables may be read in this module, since
 * anything here can end up in the client bundle. Server-only values (for
 * example an RPC provider key used for on-chain payment verification) must not
 * be added to this file.
 */

/** Human-readable network name shown in the UI. */
export const SOLANA_NETWORK_NAME = "Solana Devnet";

/** Official public Devnet RPC endpoint, used when no override is configured. */
export const SOLANA_DEVNET_RPC_URL = "https://api.devnet.solana.com";

function resolveRpcUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();

  if (!configured) {
    return SOLANA_DEVNET_RPC_URL;
  }

  try {
    const { protocol } = new URL(configured);

    if (protocol === "https:" || protocol === "http:") {
      return configured;
    }
  } catch {
    // Fall through to the public endpoint below.
  }

  // A malformed override should not crash the app on import, so fall back to
  // Devnet rather than handing an invalid URL to the RPC client.
  console.warn(
    `[solana] Ignoring NEXT_PUBLIC_SOLANA_RPC_URL because it is not a valid http(s) URL. Using ${SOLANA_DEVNET_RPC_URL}.`,
  );

  return SOLANA_DEVNET_RPC_URL;
}

/** RPC endpoint used by the browser-side Solana client. */
export const SOLANA_RPC_URL = resolveRpcUrl();
