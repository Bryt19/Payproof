"use client";

import type { ReactNode } from "react";

function hashString(s: string): number {
  let h = 0;

  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }

  return Math.abs(h);
}

function monogram(name: string | null, address: string): string {
  if (name) {
    const cleaned = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase();

    if (cleaned.length >= 2) return cleaned;
  }

  return address.slice(0, 2).toUpperCase();
}

/**
 * Avatar used by the landing navbar and the dashboard topbar.
 *
 * Same size, gradient ring, and glass behavior on both surfaces so the wallet
 * identity feels like one app, not two separately styled dropdowns.
 */
export function WalletAvatar({
  name,
  address,
  className,
  children,
}: {
  name: string | null;
  address: string;
  className?: string;
  children?: ReactNode;
}) {
  const initials = monogram(name, address);
  const fallback = ((hashString(address) % 90) + 10).toString();
  const label = initials || fallback;

  return (
    <div className={`relative inline-flex ${className ?? ""}`}>
      {children}
      <span
        aria-hidden="true"
        className="flex size-9.5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#9945FF] to-[#14F195] text-[14px] font-semibold text-black"
      >
        {label}
      </span>
    </div>
  );
}
