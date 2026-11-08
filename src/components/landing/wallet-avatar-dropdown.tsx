"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";
import { shortenAddress } from "@/lib/solana/address";

/**
 * Simple deterministic string hash for generating stable 2-digit codes.
 */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function monogram(name: string, address: string): string {
  if (name) {
    const cleaned = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase();
    if (cleaned.length >= 2) return cleaned;
  }
  // Fall back to first two characters of the address.
  return address.slice(0, 2).toUpperCase();
}

export default function WalletAvatarDropdown() {
  const { isConnected, walletName, address, disconnect } = useWalletAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / escape.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!isConnected || !walletName || !address) return null;

  const initials = monogram(walletName, address);
  const displayName = walletName;
  const shortAddress = shortenAddress(address);

  // Generate a stable 2-digit fallback to use instead of initials.
  // Deterministic from the address so the same wallet always gets the same
  // number, but looks like a random int between 10 and 99.
  const code = ((hashString(address) % 90) + 10).toString();
  const label = initials || code;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`flex items-center gap-2 rounded-full px-1 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          open
            ? "border border-white/20 bg-white/10 text-white"
            : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white"
        }`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${displayName} — ${shortAddress}. Open menu.`}
      >
        {/* Avatar glyph: initials only, no name beside it */}
        <span
          aria-hidden="true"
          className="flex size-9.5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195] text-[14px] font-semibold text-black"
        >
          {label}
        </span>
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-white/10 bg-[#0e0e0e] p-2 shadow-xl shadow-black/40"
          role="menu"
        >
          {/* Account summary */}
          <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195] text-[11px] font-semibold text-black"
            >
              {label}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">
                {displayName}
              </p>
              <p className="truncate text-xs font-mono text-neutral-400">
                {shortAddress}
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="my-1 border-t border-white/5" />

          {/* Menu items */}
          <Link
            href="/dashboard"
            className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-neutral-200 hover:bg-white/5 hover:text-white"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <svg
              className="size-4 shrink-0 text-neutral-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
              <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
              <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
              <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
            </svg>
            Dashboard
          </Link>

          <Link
            href="/settings"
            className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-neutral-200 hover:bg-white/5 hover:text-white"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <svg
              className="size-4 shrink-0 text-neutral-400"
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
          </Link>

          {/* Divider */}
          <div className="my-1 border-t border-white/5" />

          {/* Disconnect */}
          <button
            type="button"
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-red-300 hover:bg-red-500/10 hover:text-red-200"
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
