"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppClient } from "@/lib/solana/client";
import { fetchSolBalance, formatSol } from "@/lib/solana/balance";

type BalanceStatus = "loading" | "ready" | "error";

type BalanceResult =
  | { kind: "stale" }
  | { kind: "ok"; lamports: bigint }
  | { kind: "error"; error: string };

const updatedAtFormatter = new Intl.DateTimeFormat(undefined, {
  timeStyle: "medium",
});

function describeBalanceError(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "The balance request timed out.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "The balance request failed for an unknown reason.";
}

/**
 * Read-only Devnet SOL balance for one wallet address.
 *
 * Mount this with `key={address}`: switching accounts then remounts the view,
 * so a previous wallet's balance can never be shown for the new one.
 */
export default function WalletBalance({
  client,
  address,
}: {
  client: AppClient;
  address: string;
}) {
  const [status, setStatus] = useState<BalanceStatus>("loading");
  const [lamports, setLamports] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const requestRef = useRef<AbortController | null>(null);
  const isMounted = useRef(true);

  // Resolves to a result instead of setting state, so the mount effect never
  // calls setState synchronously while its body is running.
  const requestBalance = useCallback(async (): Promise<BalanceResult> => {
    requestRef.current?.abort();

    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const value = await fetchSolBalance(client, address, {
        signal: controller.signal,
      });

      return controller.signal.aborted
        ? { kind: "stale" }
        : { kind: "ok", lamports: value };
    } catch (cause) {
      return controller.signal.aborted
        ? { kind: "stale" }
        : { kind: "error", error: describeBalanceError(cause) };
    }
  }, [client, address]);

  const applyResult = useCallback((result: BalanceResult) => {
    if (result.kind === "stale" || !isMounted.current) return;

    if (result.kind === "ok") {
      setLamports(result.lamports);
      setUpdatedAt(new Date());
      setError(null);
      setStatus("ready");
      return;
    }

    setLamports(null);
    setUpdatedAt(null);
    setError(result.error);
    setStatus("error");
  }, []);

  useEffect(() => {
    isMounted.current = true;
    void requestBalance().then(applyResult);

    return () => {
      isMounted.current = false;
      requestRef.current?.abort();
    };
  }, [requestBalance, applyResult]);

  function handleRefresh() {
    if (status === "loading") return;

    setStatus("loading");
    setError(null);
    void requestBalance().then(applyResult);
  }

  const isLoading = status === "loading";

  return (
    <div
      aria-busy={isLoading}
      className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800"
    >
      <p className="text-sm text-gray-600 dark:text-gray-400">Devnet balance</p>

      <p
        role="status"
        className="mt-1 font-mono text-lg font-semibold tabular-nums"
      >
        {isLoading && "Loading balance…"}

        {status === "ready" && lamports !== null && (
          <>
            {formatSol(lamports)}{" "}
            <span className="text-sm font-normal">SOL</span>
          </>
        )}

        {status === "error" && "Unavailable"}
      </p>

      {status === "ready" && lamports === 0n && (
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          This wallet has no SOL on Devnet.
        </p>
      )}

      {status === "ready" && updatedAt !== null && (
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          Updated at {updatedAtFormatter.format(updatedAt)}
        </p>
      )}

      {status === "error" && error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          Could not load balance: {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleRefresh}
        disabled={isLoading}
        className="mt-3 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:hover:bg-gray-900"
      >
        Refresh balance
      </button>
    </div>
  );
}
