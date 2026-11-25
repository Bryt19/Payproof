import { formatSolAmount } from "./payment-summary.js";

/**
 * Read-only wallet balance for the Telegram bot.
 *
 * The wallet address is always the one resolved from the caller's active
 * `telegram_links` row. This module never accepts an address from a Telegram
 * message, never signs, and never writes to the database.
 *
 * Network identity comes from the RPC endpoint's genesis hash, not from an
 * environment label, so a misconfigured endpoint can never make Devnet SOL
 * appear to have monetary value.
 */

/** Public Devnet RPC used when no valid override is configured. */
export const DEFAULT_RPC_URL = "https://api.devnet.solana.com";

/** Known cluster genesis hashes. */
export const DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const TESTNET_GENESIS_HASH =
  "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
export const MAINNET_GENESIS_HASH =
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

/** No-key public spot price endpoint (USD per SOL). */
export const COINBASE_SOL_USD_URL =
  "https://api.coinbase.com/v2/prices/SOL-USD/spot";

const RPC_TIMEOUT_MS = 10_000;
const PRICE_TIMEOUT_MS = 5_000;

export type SolanaNetworkId =
  | "devnet"
  | "testnet"
  | "mainnet-beta"
  | "unknown";

export type SolanaNetwork = {
  id: SolanaNetworkId;
  /** Human-readable name shown in the reply. */
  label: string;
  /** True only for mainnet-beta: Devnet and Testnet SOL have no value. */
  usdAvailable: boolean;
  /** Line shown when USD must not be calculated. */
  estimateUnavailableText: string;
  /** Optional explanatory note appended to the reply. */
  note: string | null;
};

const NETWORKS: Record<Exclude<SolanaNetworkId, "unknown">, SolanaNetwork> = {
  devnet: {
    id: "devnet",
    label: "Solana Devnet",
    usdAvailable: false,
    estimateUnavailableText: "Not available on Devnet",
    note: "Devnet SOL has no monetary value and cannot be converted to USD.",
  },
  testnet: {
    id: "testnet",
    label: "Solana Testnet",
    usdAvailable: false,
    estimateUnavailableText: "Not available on Testnet",
    note: "Testnet SOL has no monetary value and cannot be converted to USD.",
  },
  "mainnet-beta": {
    id: "mainnet-beta",
    label: "Solana Mainnet",
    usdAvailable: true,
    estimateUnavailableText: "Unavailable right now",
    note: null,
  },
};

const UNKNOWN_NETWORK: SolanaNetwork = {
  id: "unknown",
  label: "Unknown network",
  usdAvailable: false,
  estimateUnavailableText: "Unavailable — network not recognised",
  note: "The configured RPC endpoint did not report a known Solana genesis hash, so no USD estimate is shown.",
};

export function parseNetworkFromGenesis(genesisHash: string): SolanaNetwork {
  switch (genesisHash.trim()) {
    case DEVNET_GENESIS_HASH:
      return NETWORKS.devnet;
    case TESTNET_GENESIS_HASH:
      return NETWORKS.testnet;
    case MAINNET_GENESIS_HASH:
      return NETWORKS["mainnet-beta"];
    default:
      return UNKNOWN_NETWORK;
  }
}

/** Reads the optional RPC override, falling back to Devnet when invalid. */
export function resolveRpcUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim();

  if (!configured) {
    return DEFAULT_RPC_URL;
  }

  try {
    const { protocol } = new URL(configured);
    if (protocol === "https:" || protocol === "http:") {
      return configured;
    }
  } catch {
    // Fall through to the public endpoint.
  }

  console.warn(
    "[wallet-balance] Ignoring NEXT_PUBLIC_SOLANA_RPC_URL because it is not a valid http(s) URL. Using Devnet.",
  );

  return DEFAULT_RPC_URL;
}

/** Base58 address shape used by Solana public keys. */
const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isLikelySolanaAddress(value: string): boolean {
  return SOLANA_ADDRESS_PATTERN.test(value.trim());
}

export function shortenAddress(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 12
    ? `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
    : trimmed;
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(value: number): string {
  return usdFormatter.format(value);
}

export type BalanceSnapshot = {
  merchantAddress: string;
  lamports: bigint;
  network: SolanaNetwork;
  /** Estimated value in USD; null when unavailable or not applicable. */
  usd: number | null;
  updatedAt: Date;
};

export type BalanceResult =
  | { ok: true; data: BalanceSnapshot }
  | { ok: false };

export type BalanceDependencies = {
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
  now?: () => Date;
};

type JsonRpcPayload = {
  result?: unknown;
  error?: { message?: unknown };
};

async function rpcRequest(
  fetchImpl: typeof fetch,
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<unknown> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!response.ok) {
    throw new Error(`RPC responded with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as JsonRpcPayload;

  if (payload.error) {
    const message =
      typeof payload.error.message === "string"
        ? payload.error.message
        : "unknown RPC error";
    throw new Error(`RPC error: ${message}`);
  }

  if (payload.result === undefined) {
    throw new Error("RPC response did not include a result");
  }

  return payload.result;
}

async function fetchGenesisHash(
  fetchImpl: typeof fetch,
  rpcUrl: string,
): Promise<string> {
  const result = await rpcRequest(
    fetchImpl,
    rpcUrl,
    "getGenesisHash",
    [],
    RPC_TIMEOUT_MS,
  );

  if (typeof result !== "string" || result.length === 0) {
    throw new Error("RPC returned an invalid genesis hash");
  }

  return result;
}

async function fetchLamports(
  fetchImpl: typeof fetch,
  rpcUrl: string,
  merchantAddress: string,
): Promise<bigint> {
  const result = (await rpcRequest(
    fetchImpl,
    rpcUrl,
    "getBalance",
    [merchantAddress, { commitment: "confirmed" }],
    RPC_TIMEOUT_MS,
  )) as { value?: unknown } | null;

  const value = result?.value;

  // JSON-RPC encodes uint64 as a JSON number. Refuse values that would lose
  // precision instead of displaying a wrong balance.
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error("RPC returned an invalid lamport balance");
  }

  return BigInt(value);
}

async function fetchSolUsdPrice(
  fetchImpl: typeof fetch,
): Promise<number | null> {
  try {
    const response = await fetchImpl(COINBASE_SOL_USD_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(PRICE_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      data?: { amount?: unknown };
    };
    const rawAmount = payload.data?.amount;

    if (typeof rawAmount !== "string") {
      return null;
    }

    const amount = Number(rawAmount);

    // A finite, positive, plausible price. Anything else is treated as an
    // outage rather than displayed.
    if (!Number.isFinite(amount) || amount <= 0 || amount >= 1_000_000) {
      return null;
    }

    return amount;
  } catch {
    return null;
  }
}

/**
 * Reads genesis hash and confirmed balance in parallel. The USD estimate is
 * fetched only for mainnet-beta; Devnet and Testnet always report null.
 */
export async function fetchBalanceSnapshot(
  merchantAddress: string,
  deps: BalanceDependencies = {},
): Promise<BalanceResult> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const rpcUrl = deps.rpcUrl ?? resolveRpcUrl();
  const now = deps.now ?? (() => new Date());

  if (typeof fetchImpl !== "function") {
    return { ok: false };
  }

  if (!isLikelySolanaAddress(merchantAddress)) {
    return { ok: false };
  }

  try {
    const [genesisHash, lamports] = await Promise.all([
      fetchGenesisHash(fetchImpl, rpcUrl),
      fetchLamports(fetchImpl, rpcUrl, merchantAddress),
    ]);

    const network = parseNetworkFromGenesis(genesisHash);
    let usd: number | null = null;

    if (network.usdAvailable) {
      const price = await fetchSolUsdPrice(fetchImpl);
      if (price !== null) {
        usd = (Number(lamports) / 1_000_000_000) * price;
      }
    }

    return {
      ok: true,
      data: { merchantAddress, lamports, network, usd, updatedAt: now() },
    };
  } catch (cause) {
    // Never log the merchant address or endpoint credentials.
    console.error(
      "[wallet-balance] balance lookup failed:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return { ok: false };
  }
}

export function buildBalanceText(snapshot: BalanceSnapshot): string {
  const estimatedValue =
    snapshot.network.usdAvailable && snapshot.usd !== null
      ? `≈ ${formatUsd(snapshot.usd)} USD`
      : snapshot.network.usdAvailable
        ? "Unavailable right now"
        : snapshot.network.estimateUnavailableText;

  const lines = [
    "PayProof Wallet Balance",
    "",
    `Balance: ${formatSolAmount(snapshot.lamports)} SOL`,
    `Estimated value: ${estimatedValue}`,
    `Wallet: ${shortenAddress(snapshot.merchantAddress)}`,
    `Network: ${snapshot.network.label}`,
    // The snapshot is read per command; there is no cached balance.
    "Updated: Just now",
  ];

  if (snapshot.network.usdAvailable && snapshot.usd === null) {
    lines.push(
      "",
      "Could not fetch a market price right now. Your SOL balance is unchanged.",
    );
  } else if (snapshot.network.note) {
    lines.push("", snapshot.network.note);
  }

  return lines.join("\n");
}
