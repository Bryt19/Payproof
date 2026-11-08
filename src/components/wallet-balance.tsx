"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppClient } from "@/lib/solana/client";
import { fetchSolBalance } from "@/lib/solana/balance";
import { formatSol } from "@/lib/solana/units";

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

  if (error instanceof TypeError) {
    return "The Solana RPC endpoint could not be reached.";
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
    <div aria-busy={isLoading} className="mt-4 border-t border-line pt-4">
      <p className="text-[11px] uppercase tracking-wide text-muted">
        Devnet balance
      </p>

      <p
        role="status"
        className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink"
      >
        {isLoading && <span className="text-sm text-muted">Loading balance…</span>}

        {status === "ready" && lamports !== null && (
          <>
            {formatSol(lamports)}{" "}
            <span className="text-xs font-normal text-muted">SOL</span>
          </>
        )}

        {status === "error" && (
          <span className="text-sm font-normal text-muted">Unavailable</span>
        )}
      </p>

      {status === "ready" && lamports === 0n && (
        <p className="mt-1 text-xs text-muted">This wallet has no SOL on Devnet.</p>
      )}

      {status === "ready" && updatedAt !== null && (
        <p className="mt-1 text-[11px] text-muted">
          Updated at {updatedAtFormatter.format(updatedAt)}
        </p>
      )}

      {status === "error" && error && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          Could not load balance: {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleRefresh}
        disabled={isLoading}
        className="mt-3 rounded-md border border-line px-2.5 py-1 text-[11px] font-medium text-neutral-300 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        Refresh balance
      </button>
    </div>
  );
}
