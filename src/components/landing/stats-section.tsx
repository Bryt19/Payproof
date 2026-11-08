"use client";

import React, { useEffect, useRef, useState } from "react";
import { StatBadge } from "../ui/stat-badge";
import { stats } from "@content/payproof";

/**
 * Animate a value string up to its final form.
 *
 * Splits the value into a numeric core and a surrounding prefix/suffix
 * (e.g. "$312M" → prefix "$", core 312, suffix "M"), tweens the core,
 * and reassembles. Plain labels without a number (e.g. "Under 1s") fade in
 * without a tween.
 */
function useCountUp(raw: string, durationMs: number, startOnMount: boolean) {
  const [display, setDisplay] = useState(raw);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!startOnMount) return;

    // Strip thousands separators so "84,300" parses as one number.
    const strippedForMatch = raw.replace(/,/g, "");

    // Match an optional currency prefix, a numeric core, and an optional
    // suffix made of letters.
    const match = strippedForMatch.match(/^(\$?)([-+]?[0-9]*(?:\.[0-9]+)?)([A-Za-z]*)$/);
    if (!match) {
      setDisplay(raw);
      return;
    }

    const prefix = match[1];
    const coreRaw = match[2];
    const suffix = match[3];
    const numeric = parseFloat(coreRaw);

    if (isNaN(numeric) || coreRaw.trim() === "") {
      setDisplay(raw);
      return;
    }

    // Decimal places in the source value (e.g. "0.004" → 3).
    const decimals = (coreRaw.includes(".")
      ? coreRaw.slice(coreRaw.indexOf(".") + 1).length
      : 0);

    // For values whose core is <= 1 (e.g. "Under 1s", "$0.004"), round to
    // the source's decimal precision instead of defaulting to 2.
    const start = performance.now();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    function formatCurrent(current: number): string {
      if (decimals > 0) {
        return current.toFixed(decimals);
      }
      if (current >= 1000) {
        return Math.round(current).toLocaleString();
      }
      return Math.round(current).toString();
    }

    function frame(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = easeOut(progress);
      const current = numeric * eased;

      setDisplay(`${prefix}${formatCurrent(current)}${suffix}`);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(frame);
      } else {
        setDisplay(raw);
      }
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [raw, durationMs, startOnMount]);

  return display;
}

export function StatsSection() {
  const items = stats.items;
  const durationMs = 2200;
  const [started, setStarted] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);

  // Start the count-up when the section scrolls into view.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="community-stats"
      className="relative py-20 sm:py-28 overflow-hidden"
      ref={sectionRef}
    >
      {/* Subtle Purple-Teal Center Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[350px] bg-gradient-to-r from-[#9945FF]/10 via-[#C14BF0]/10 to-[#14F195]/10 rounded-full blur-[90px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 sm:mb-20">
          <p className="eyebrow-label text-[#14F195] mb-3">
            {stats.eyebrow}
          </p>
          <h2 className="section-headline text-white">
            {stats.heading}
          </h2>
          <p className="mt-4 text-base sm:text-lg text-white/65">
            {stats.description}
          </p>
        </div>          {/* 6 Metric Cards: 1 col on mobile, 2 on tablet, 3x2 on desktop */}
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 lg:gap-8"
          style={{ gridTemplateRows: "repeat(2, minmax(0, 1fr))" }}
          role="list"
          aria-label={`${stats.eyebrow} — ${items.length} metrics`}
        >
          {items.map((stat, idx) => {
            const displayValue = useCountUp(stat.value, durationMs, started);

            return (
              <div
                key={stat.label}
                className="relative group p-6 sm:p-8 rounded-2xl bg-[#0E0E12] border border-white/[0.08] hover:border-[#9945FF]/40 transition-all duration-300 flex flex-col justify-between h-full"
                style={{ animationDelay: `${idx * 120}ms` }}
                role="listitem"
              >
                {/* Card index badge */}
                <div className="absolute top-4 right-4 text-xs font-mono text-white/20">
                  {String(idx + 1).padStart(2, "0")}
                </div>

                <StatBadge
                  value={displayValue}
                  label={stat.label}
                  sublabel={stat.sublabel}
                  description={stat.description}
                  detail={stat.detail}
                  variant={stat.variant}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
