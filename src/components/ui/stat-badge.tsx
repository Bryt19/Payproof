"use client";

import React from "react";interface StatBadgeProps {
  value: string; // e.g. "21.9M", "11.5M+", "$0.00025", "48,000"
  label: string;
  sublabel?: string;
  description?: string;
  detail?: string; // small mono fact line, e.g. "Verified on Solana Devnet"
  variant?: "brand" | "cyan" | "purple";
  className?: string;
}
export function StatBadge({
  value,
  label,
  sublabel,
  description,
  detail,
  variant = "brand",
  className = "",
}: StatBadgeProps) {
  const gradientClass = {
    brand: "text-gradient-brand",
    cyan: "text-gradient-cyan",
    purple: "text-gradient-purple-pink",
  }[variant];

  // Placeholders are wider than real figures, so they get a smaller scale to
  // stay inside the card at every breakpoint.
  const isPlaceholder = value.includes("[REPLACE");
  const sizeClass = isPlaceholder
    ? "text-xl sm:text-2xl lg:text-3xl"
    : "text-4xl sm:text-5xl lg:text-6xl";

  return (
    <div className={`flex flex-col items-start gap-1.5 ${className}`}>
      <span
        className={`${sizeClass} font-extrabold tracking-tight select-none ${gradientClass}`}
      >
        {value}
      </span>
      <span className="text-xs sm:text-sm font-semibold uppercase tracking-wider text-white/90">
        {label}
      </span>
      {sublabel && (
        <span className="text-xs text-white/50 leading-relaxed">
          {sublabel}
        </span>
      )}
      {description && (
        <span className="mt-2 text-xs leading-relaxed text-white/40">
          {description}
        </span>
      )}
      {detail && (
        <span className="mt-2.5 flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-white/30">
          <span className="size-1 rounded-full bg-white/20" />
          {detail}
        </span>
      )}
    </div>
  );
}

