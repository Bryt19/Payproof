"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";
import { shortenAddress } from "@/lib/solana/address";
import { WalletAvatar } from "@/components/wallet-avatar";
import { useClient } from "@solana/react";
import type { AppClient } from "@/lib/solana/client";
import { fetchSolBalance } from "@/lib/solana/balance";
import { useIsHydrated } from "@/lib/use-is-hydrated";

const REFRESH_INTERVAL_MS = 20_000;

type BalanceState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; sol: bigint }
  | { kind: "error"; message: string };

function BalanceDisplay({
  address,
}: {
  address: string;
}) {
  const client = useClient<AppClient>();
  const isHydrated = useIsHydrated();
  const [state, setState] = useState<BalanceState>({ kind: "idle" });

  const refresh = useCallback(
    (signal?: AbortSignal) => {
      setState({ kind: "loading" });

      fetchSolBalance(client, address, { signal })
        .then((lamports) => {
          if (signal?.aborted) return;
          setState({ kind: "loaded", sol: lamports });
        })
        .catch((error) => {
          if (signal?.aborted) return;
          setState({
            kind: "error",
            message:
              error instanceof Error
                ? error.message
                : "Could not read the balance.",
          });
        });
    },
    [client, address],
  );

  useEffect(() => {
    if (!isHydrated) return;

    const controller = new AbortController();
    const initial = setTimeout(() => {
      refresh(controller.signal);
    }, 0);

    const timer = setInterval(() => {
      if (!controller.signal.aborted) {
        refresh(controller.signal);
      }
    }, REFRESH_INTERVAL_MS);

    return () => {
      controller.abort();
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [isHydrated, refresh]);

  if (state.kind === "idle" || state.kind === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm tabular-nums">
        <span className="h-4 w-14 animate-pulse rounded bg-white/10" />
        <span className="text-neutral-400">SOL</span>
      </span>
    );
  }

  if (state.kind === "error") {
    return (
      <span
        className="text-[11px] text-red-300"
        title={state.message}
      >
        unavailable
      </span>
    );
  }

  const sol = state.sol;
  const whole = sol / 1_000_000_000n;
  const fraction = sol % 1_000_000_000n;
  const fractionText =
    fraction === 0n
      ? "00"
      : fraction.toString().padStart(9, "0").slice(0, 2);

  return (
    <span className="inline-flex items-center gap-1.5 text-sm tabular-nums">
      <span className="font-medium text-white">
        {whole}.{fractionText}
      </span>
      <span className="text-neutral-400">SOL</span>
    </span>
  );
}

type CopyState = "idle" | "copied";

function CopyButton({
  address,
}: {
  address: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setState("copied");
    } catch {
      // Keep the copy affordance quiet on failure.
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    const timer = setTimeout(() => setState("idle"), 2500);
    timerRef.current = timer;
  }, [address]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`shrink-0 rounded-md border border-white/10 px-2.5 py-1 text-[11px] font-medium text-neutral-300 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF] hover:bg-white/5 hover:text-white ${
        state === "copied"
          ? "border-[#14F195]/40 text-[#14F195] hover:bg-[#14F195]/10"
          : ""
      }`}
    >
      {state === "copied" ? "Copied" : "Copy address"}
    </button>
  );
}

export function WalletAvatarDropdown() {
  const { isConnected, walletName, address, disconnect } = useWalletAuth();
  const isHydrated = useIsHydrated();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        close();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;

    const handleResize = () => {
      const rect = ref.current?.getBoundingClientRect();
      const menu = ref.current?.querySelector<HTMLElement>("[data-avatar-menu]");

      if (!rect || !menu) return;

      if (rect.bottom > window.innerHeight) {
        menu.style.position = "fixed";
        menu.style.bottom = "8px";
        menu.style.left = "auto";
        menu.style.right = "8px";
        menu.style.top = "auto";
        menu.style.transform = "none";
        menu.style.maxHeight = `${window.innerHeight - 24}px`;
        menu.style.overflowY = "auto";
      } else {
        menu.style.position = "";
        menu.style.bottom = "";
        menu.style.left = "";
        menu.style.right = "";
        menu.style.top = "";
        menu.style.transform = "";
        menu.style.maxHeight = "";
        menu.style.overflowY = "";
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [open]);

  if (!isHydrated || !isConnected || !walletName || !address) {
    return null;
  }

  const displayName = walletName;
  const shortAddress = shortenAddress(address);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-1 py-1 text-sm transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF] sm:min-h-0 sm:min-w-0"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${displayName} — ${shortAddress}. Open menu.`}
      >
        <WalletAvatar name={displayName} address={address} />
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-[min(16rem,calc(100vw-2rem))] rounded-[16px] border border-white/10 bg-[#0b0b0f]/95 p-2 shadow-xl shadow-black/40 backdrop-blur-md"
          role="menu"
          data-avatar-menu
        >
          {/* Account summary */}
          <div className="flex items-start gap-3 rounded-[14px] border border-white/5 bg-white/[0.02] p-3">
            <WalletAvatar name={displayName} address={address} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {displayName}
              </p>
              <p className="mt-0.5 truncate text-xs font-mono text-neutral-400">
                {shortAddress}
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="my-1 border-t border-white/5" />

          {/* Wallet address */}
          <div className="flex items-center justify-between gap-3 px-1">
            <code className="truncate text-xs font-mono text-neutral-300">
              {address}
            </code>
            <CopyButton address={address} />
          </div>

          {/* Divider */}
          <div className="my-1 border-t border-white/5" />

          {/* Balance */}
          <div className="flex items-center justify-between gap-3 rounded-[12px] border border-white/5 bg-white/[0.02] px-3 py-2.5">
            <span className="text-sm text-neutral-400">Balance:</span>
            <BalanceDisplay address={address} />
          </div>

          {/* Divider */}
          <div className="my-1 border-t border-white/5" />

          {/* Settings */}
          <button
            type="button"
            onClick={close}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-neutral-300 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF]"
            role="menuitem"
          >
            <svg
              className="size-4 shrink-0 text-neutral-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="2.8" />
              <path d="M19.4 14.2a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1.1-1.5 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H4a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.5-1.1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3H10a1.6 1.6 0 0 0 1-1.5V4a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1Z" />
            </svg>
            Settings
          </button>

          {/* Divider */}
          <div className="my-1 border-t border-white/5" />

          {/* Disconnect */}
          <button
            type="button"
            onClick={() => {
              disconnect();
              close();
            }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-red-300 transition-colors hover:bg-red-500/8 hover:text-red-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
            role="menuitem"
          >
            <svg
              className="size-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Disconnect wallet
          </button>
        </div>
      )}
    </div>
  );
}


