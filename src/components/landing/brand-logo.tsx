import React from "react";

export function PayproofLogo({
  className = "",
  showWordmark = true,
  wordmarkClass = "",
}: {
  className?: string;
  showWordmark?: boolean;
  wordmarkClass?: string;
}) {
  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      {/* Payproof Mark Icon */}
      <div className="relative size-8 sm:size-9 shrink-0 rounded-xl overflow-hidden shadow-[0_0_20px_rgba(153,69,255,0.35)] border border-white/[0.1] bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/payproof-icon.png"
          alt="Payproof Logo"
          className="w-full h-full object-cover"
        />
      </div>

      {showWordmark && (
        <span
          className={`font-black tracking-tight text-white text-lg sm:text-xl ${wordmarkClass}`}
          style={{ letterSpacing: "-0.03em", fontFamily: "'DM Sans', sans-serif" }}
        >
          Payproof
        </span>
      )}
    </div>
  );
}

// Partner / integration marks
export const PartnerLogos = {
  Solana: () => (
    <div className="flex items-center gap-2">
      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="ppSolanaMark" x1="3" y1="20" x2="21" y2="4" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#9945FF" />
            <stop offset="100%" stopColor="#14F195" />
          </linearGradient>
        </defs>
        <path d="M6.2 4.2c.2-.2.4-.3.7-.3h14.3c.4 0 .6.5.3.8l-3.3 3.3c-.2.2-.4.3-.7.3H3.2c-.4 0-.6-.5-.3-.8l3.3-3.3Z" fill="url(#ppSolanaMark)" />
        <path d="M6.2 15.8c.2-.2.4-.3.7-.3h14.3c.4 0 .6.5.3.8l-3.3 3.3c-.2.2-.4.3-.7.3H3.2c-.4 0-.6-.5-.3-.8l3.3-3.3Z" fill="url(#ppSolanaMark)" />
        <path d="M17.8 10c-.2-.2-.4-.3-.7-.3H2.8c-.4 0-.6.5-.3.8l3.3 3.3c.2.2.4.3.7.3h14.3c.4 0 .6-.5.3-.8L17.8 10Z" fill="url(#ppSolanaMark)" />
      </svg>
      <span className="font-bold text-sm tracking-wide text-white/50 group-hover:text-white transition-colors">
        Solana
      </span>
    </div>
  ),
  USDC: () => (
    <div className="flex items-center gap-2">
      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10.5" fill="#2775CA" />
        <path d="M12 5.6v12.8" stroke="#ffffff" strokeWidth="1.3" strokeLinecap="round" />
        <path
          d="M15 8.7c-.6-1-1.6-1.6-3-1.6-1.9 0-3.2 1-3.2 2.5 0 3.2 6.4 1.6 6.4 4.9 0 1.5-1.4 2.6-3.3 2.6-1.5 0-2.6-.7-3.2-1.8"
          stroke="#ffffff"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span className="font-extrabold text-sm tracking-wider uppercase text-white/50 group-hover:text-white transition-colors">
        USDC
      </span>
    </div>
  ),
  Phantom: () => (
    <div className="flex items-center gap-2">
      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="ppPhantomMark" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#AB9FF2" />
            <stop offset="100%" stopColor="#551BF9" />
          </linearGradient>
        </defs>
        <rect width="24" height="24" rx="7" fill="url(#ppPhantomMark)" />
        <path
          d="M7 20V11.4C7 8.4 9.2 6 12 6s5 2.4 5 5.4V20l-1.6-1.3-1.4 1.3-1.5-1.3-1.5 1.3-1.4-1.3L7 20Z"
          fill="#ffffff"
        />
        <circle cx="10.2" cy="11.2" r="1.1" fill="#551BF9" />
        <circle cx="13.8" cy="11.2" r="1.1" fill="#551BF9" />
      </svg>
      <span className="font-bold text-sm tracking-wide text-white/50 group-hover:text-white transition-colors">
        Phantom
      </span>
    </div>
  ),
  Jupiter: () => (
    <div className="flex items-center gap-2">
      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2L20 7.5V16.5L12 22L4 16.5V7.5L12 2Z" fill="#806CFF" />
        <path d="M12 6L17 9.5V14.5L12 18L7 14.5V9.5L12 6Z" fill="#9945FF" />
        <circle cx="12" cy="12" r="2.5" fill="#C14BF0" />
      </svg>
      <span className="font-bold text-sm tracking-wide text-white/50 group-hover:text-white transition-colors">
        Jupiter
      </span>
    </div>
  ),
  Raydium: () => (
    <div className="flex items-center gap-2">
      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 12C3 11 3.5 7 6 5.5C8.5 4 13 4.5 15 7C17 9.5 17 13 14.5 15.5C12 18 9 18 6.5 17L4 17C3 17 3 15 3 12Z" fill="#00C2FF" />
        <path d="M14 19H21V21H3V19" fill="#5B45FF" />
        <path d="M3 14H21" stroke="#9945FF" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="font-bold text-sm tracking-wide text-white/50 group-hover:text-white transition-colors">
        Raydium
      </span>
    </div>
  ),
  Kamino: () => (
    <div className="flex items-center gap-2">
      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="#9945FF" />
        <path d="M12 6C12 6 9 9 9 12C9 15 12 18 12 18" stroke="#14F195" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 18C12 18 15 15 15 12C15 9 12 6 12 6" stroke="#C14BF0" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="12" r="2" fill="#ffffff" />
      </svg>
      <span className="font-bold text-sm tracking-wide text-white/50 group-hover:text-white transition-colors">
        Kamino
      </span>
    </div>
  ),
  Solflare: () => (
    <div className="flex items-center gap-2">
      <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="ppSolflareMark" x1="3" y1="21" x2="21" y2="3" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FF6B00" />
            <stop offset="100%" stopColor="#FFC10B" />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="4.6" fill="url(#ppSolflareMark)" />
        <g stroke="url(#ppSolflareMark)" strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 2.4v3" />
          <path d="M12 18.6v3" />
          <path d="M2.4 12h3" />
          <path d="M18.6 12h3" />
          <path d="M5.2 5.2l2.1 2.1" />
          <path d="M16.7 16.7l2.1 2.1" />
          <path d="M18.8 5.2l-2.1 2.1" />
          <path d="M7.3 16.7l-2.1 2.1" />
        </g>
      </svg>
      <span className="font-bold text-sm tracking-wide text-white/50 group-hover:text-white transition-colors">
        Solflare
      </span>
    </div>
  ),
};
