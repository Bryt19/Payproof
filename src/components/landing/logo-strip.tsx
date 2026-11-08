"use client";

import React, { useEffect, useRef, useState } from "react";
import { PartnerLogos } from "./brand-logo";
import { logoStrip } from "@content/payproof";const logoComponents = {
  solana: PartnerLogos.Solana,
  jupiter: PartnerLogos.Jupiter,
  usdc: PartnerLogos.USDC,
  raydium: PartnerLogos.Raydium,
  phantom: PartnerLogos.Phantom,
  kamino: PartnerLogos.Kamino,
  solflare: PartnerLogos.Solflare,
} as const;

type LogoId = (typeof logoStrip.logos)[number]["id"];

function LogoMark({ id, name }: { id: LogoId; name: string }) {
  const Component = logoComponents[id];

  return (
    <div
      className="logo-strip-item flex items-center justify-center gap-2 rounded-lg p-2 focus-within:outline-2 focus-within:outline-[#9945FF] focus-within:outline-offset-2 transition-all duration-200"
      aria-label={name}
      tabIndex={0}
    >
      {Component ? (
        <Component />
      ) : (
        <span className="text-[11px] font-mono tracking-wide">{name}</span>
      )}
    </div>
  );
}

/** Duplicate the logos array so the marquee can loop seamlessly. */
function duplicateLogos<T>(items: readonly T[]): T[] {
  return [...items, ...items];
}

/**
 * Detect whether the user has requested reduced motion.
 * Static grid fallback when motion is reduced.
 */
function useReducedMotion(): boolean {
  const getPref = () => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  };

  const [reduced, setReduced] = useState(getPref);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return reduced;
}

export function LogoStrip() {
  const items = logoStrip.logos;
  const duplicated = duplicateLogos(items);
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return (
      <section className="relative -mt-6 sm:-mt-8 md:-mt-10 py-6 sm:py-6 md:py-6 border-y border-white/[0.06] bg-black/60 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="mb-6 sm:mb-6 md:mb-6 text-center text-xs font-semibold uppercase tracking-[0.22em] text-white/50">
            {logoStrip.label}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
            {items.map((logo) => (
              <LogoMark key={logo.id} id={logo.id} name={logo.name} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative -mt-6 sm:-mt-8 md:-mt-10 py-6 sm:py-6 md:py-6 border-y border-white/[0.06] bg-black/60 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <p className="mb-6 sm:mb-6 md:mb-6 text-center text-xs font-semibold uppercase tracking-[0.22em] text-white/50">
          {logoStrip.label}
        </p>
      </div>

      {/* Soft fade masks on left/right edges */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#0E0E12] to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#0E0E12] to-transparent"
      />

      <div className="relative">
        {/* The animated track. Duplicate the logos so the loop is seamless.
            It runs continuously — hovering or focusing a logo never pauses it. */}
        <div className="relative overflow-hidden">
          <div className="marquee-track flex w-[200%] items-center justify-center gap-12 sm:gap-14 lg:gap-16 will-change-transform">
            {duplicated.map((logo, index) => (
              <LogoMark key={`${logo.id}-${index}`} id={logo.id} name={logo.name} />
            ))}
          </div>

          <style>{`
            .marquee-track {
              animation: marquee 35s linear infinite;
            }

            @keyframes marquee {
              from { transform: translateX(0); }
              to   { transform: translateX(-50%); }
            }
          `}</style>
        </div>
      </div>

      <style>{`
        .logo-strip-item {
          opacity: 0.6;
          filter: grayscale(100%);
          transition: opacity 220ms ease, filter 220ms ease;
        }

        .logo-strip-item:hover,
        .logo-strip-item:focus-visible {
          opacity: 1;
          filter: grayscale(0%);
        }
      `}</style>
    </section>
  );
}
