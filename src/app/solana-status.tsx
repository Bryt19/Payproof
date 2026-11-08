"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useClient } from "@solana/react";
import {
  getCurrentSlot,
  SLOT_MAX_AGE_MS,
  type AppClient,
} from "@/lib/solana/client";
import { SOLANA_NETWORK_NAME, SOLANA_RPC_URL } from "@/lib/solana/config";

type ConnectionStatus = "connecting" | "connected" | "unavailable";

type SlotResult =
  | { ok: true; slot: bigint }
  | { ok: false; error: string };

const slotFormatter = new Intl.NumberFormat("en-US");

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "The RPC request timed out.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "The RPC request failed for an unknown reason.";
}

export default function SolanaStatus() {
  const client = useClient<AppClient>();

  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [slot, setSlot] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isMounted = useRef(true);

  // Resolves to a value rather than setting state, so the mount effect never
  // calls setState synchronously inside the effect body.
  const fetchSlot = useCallback(
    async (maxAgeMs: number): Promise<SlotResult> => {
      try {
        const currentSlot = await getCurrentSlot(client, { maxAgeMs });
        return { ok: true, slot: currentSlot };
      } catch (cause) {
        return { ok: false, error: describeError(cause) };
      }
    },
    [client],
  );

  const applyResult = useCallback((result: SlotResult) => {
    if (!isMounted.current) return;

    if (result.ok) {
      setSlot(result.slot);
      setError(null);
      setStatus("connected");
    } else {
      setError(result.error);
      setStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    void fetchSlot(SLOT_MAX_AGE_MS).then(applyResult);

    return () => {
      isMounted.current = false;
    };
  }, [fetchSlot, applyResult]);

  function handleRefresh() {
    setStatus("connecting");
    setError(null);
    void fetchSlot(0).then(applyResult);
  }

  const isLoading = status === "connecting";
  const statusLabel =
    status === "connected"
      ? "Connected"
      : status === "connecting"
        ? "Connecting…"
        : "Unavailable";

  const statusColor =
    status === "connected"
      ? "text-accent"
      : status === "connecting"
        ? "text-muted"
        : "text-red-300";

  return (
    <section
      aria-labelledby="solana-status-heading"
      aria-busy={isLoading}
      className="rounded-xl border border-line bg-surface p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="solana-status-heading" className="text-sm font-semibold">
            Network
          </h2>
          <p className="mt-0.5 text-xs text-muted">RPC diagnostics</p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isLoading}
          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-neutral-300 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <dl className="mt-4 space-y-2.5 text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Network</dt>
          <dd className="font-medium text-neutral-200">{SOLANA_NETWORK_NAME}</dd>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Connection</dt>
          <dd>
            <span role="status" className={`font-medium ${statusColor}`}>
              {statusLabel}
            </span>
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Current slot</dt>
          <dd className="font-mono tabular-nums text-neutral-200">
            {slot === null ? "—" : slotFormatter.format(slot)}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">RPC</dt>
          <dd
            className="max-w-[14rem] truncate font-mono text-[11px] text-neutral-400"
            title={SOLANA_RPC_URL}
          >
            {SOLANA_RPC_URL}
          </dd>
        </div>
      </dl>

      {error && (
        <p role="alert" className="mt-3 text-xs text-red-300">
          Could not read the current slot from {SOLANA_NETWORK_NAME}: {error}
        </p>
      )}
    </section>
  );
}
