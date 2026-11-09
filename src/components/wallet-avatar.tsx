"use client";

import type { ReactNode } from "react";

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const GLYPH_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const PALETTES: ReadonlyArray<readonly [string, string, string]> = [
  ["#9945FF", "#14F195", "#08110d"],
  ["#F97316", "#F43F5E", "#140807"],
  ["#06B6D4", "#3B82F6", "#061018"],
  ["#22C55E", "#84CC16", "#071107"],
  ["#EC4899", "#8B5CF6", "#140714"],
  ["#EAB308", "#F97316", "#141007"],
  ["#14B8A6", "#22D3EE", "#061314"],
  ["#6366F1", "#A855F7", "#0b0718"],
  ["#EF4444", "#FB7185", "#180708"],
  ["#0EA5E9", "#14F195", "#051214"],
  ["#A3E635", "#10B981", "#081207"],
  ["#F59E0B", "#EF4444", "#160c06"],
];

function glyphInitials(address: string): string {
  const h = hashString(address);
  const a = GLYPH_ALPHABET[h % GLYPH_ALPHABET.length];
  const b = GLYPH_ALPHABET[Math.floor(h / GLYPH_ALPHABET.length) % GLYPH_ALPHABET.length];
  return `${a}${b}`;
}

export function getWalletAvatar(address: string): {
  initials: string;
  backgroundImage: string;
  color: string;
} {
  const h = hashString(address);
  const palette = PALETTES[h % PALETTES.length];
  return {
    initials: glyphInitials(address),
    backgroundImage: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`,
    color: palette[2],
  };
}

/**
 * Avatar used by wallet identity surfaces.
 *
 * Glyph color and initials are deterministic per wallet address so each
 * connected account gets a stable, distinct avatar.
 */
export function WalletAvatar({
  name,
  address,
  className,
  children,
}: {
  name?: string | null;
  address: string;
  className?: string;
  children?: ReactNode;
}) {
  const { initials, backgroundImage, color } = getWalletAvatar(address);
  const label = name && name.trim().length > 0 ? name : address;

  return (
    <div className={`relative inline-flex ${className ?? ""}`}>
      {children}
      <span
        aria-hidden="true"
        title={label}
        className="flex size-9.5 shrink-0 items-center justify-center rounded-full text-[13px] font-bold tracking-wide shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]"
        style={{ backgroundImage, color }}
      >
        {initials}
      </span>
    </div>
  );
}
