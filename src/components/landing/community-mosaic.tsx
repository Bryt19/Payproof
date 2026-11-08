import React from "react";
import { Card } from "../ui/card";
import { community } from "@content/payproof";

const [merchantCard, developerCard] = community.cards;
const visual = community.visual;

// Placeholder values are wider than the real figures they stand in for.
const valueSizeClass = (value: string) =>
  value.includes("[REPLACE")
    ? "text-2xl sm:text-3xl"
    : "text-4xl sm:text-5xl";

export function CommunityMosaicSection() {
  return (
    <section id="community" className="relative py-20 sm:py-28 overflow-hidden">
      {/* Background Atmosphere */}
      <div className="absolute top-1/2 right-1/4 w-96 h-96 bg-[#9945FF]/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <p className="eyebrow-label text-[#14F195] mb-2">
            {community.eyebrow}
          </p>
          <h2 className="section-headline text-white">
            {community.heading}
          </h2>
          <p className="mt-4 text-base sm:text-lg text-white/65">
            {community.description}
          </p>
        </div>

        {/* Community Mosaic Grid: simplified 2-column on mobile, responsive 3-col on desktop */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Card 1: Merchant stat */}
          <Card className="p-8 flex flex-col justify-between border border-white/[0.08] relative overflow-hidden group">
            <div className="absolute -top-12 -right-12 w-32 h-32 bg-[#9945FF]/20 rounded-full blur-2xl" />
            <div>
              <span className={`${valueSizeClass(merchantCard.value)} font-black ${merchantCard.gradient}`}>
                {merchantCard.value}
              </span>
              <h3 className="mt-3 text-lg font-bold text-white tracking-tight">
                {merchantCard.heading}
              </h3>
              <p className="mt-2 text-sm text-white/60 leading-relaxed">
                {merchantCard.description}
              </p>
            </div>
            <div className={`mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${merchantCard.accent}`}>
              <span>{merchantCard.linkLabel}</span>
              <span>→</span>
            </div>
          </Card>

          {/* Card 2: Product visual */}
          <div className="relative rounded-2xl overflow-hidden border border-white/[0.08] min-h-[240px] group bg-[#16161B] flex flex-col justify-between p-6">
            <div className="absolute -top-16 -right-16 w-40 h-40 bg-gradient-to-br from-[#9945FF]/25 via-[#C14BF0]/10 to-transparent rounded-full blur-2xl pointer-events-none" />

            <div className="relative">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#14F195]">
                {visual.receiptLabel}
              </span>

              <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/40 p-4">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/40">Amount</span>
                  <span className="font-mono text-white">{visual.amount}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/40">Reference</span>
                  <span className="font-mono text-white/80">{visual.reference}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/40">Proof hash</span>
                  <span className="font-mono text-white/80">{visual.proofHash}</span>
                </div>
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[#14F195]/25 bg-[#14F195]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#14F195]">
                  <span className="size-1.5 rounded-full bg-[#14F195]" aria-hidden="true" />
                  {visual.status}
                </span>
              </div>
            </div>

            <div className="relative mt-4">
              <span className="text-xs font-mono uppercase text-[#00C2FF]">
                {visual.tag}
              </span>
              <p className="text-sm font-semibold text-white mt-1">
                {visual.title}
              </p>
            </div>
          </div>

          {/* Card 3: Developer stat */}
          <Card className="p-8 flex flex-col justify-between border border-white/[0.08] relative overflow-hidden group sm:col-span-2 lg:col-span-1">
            <div className="absolute -top-12 -right-12 w-32 h-32 bg-[#14F195]/20 rounded-full blur-2xl" />
            <div>
              <span className={`${valueSizeClass(developerCard.value)} font-black ${developerCard.gradient}`}>
                {developerCard.value}
              </span>
              <h3 className="mt-3 text-lg font-bold text-white tracking-tight">
                {developerCard.heading}
              </h3>
              <p className="mt-2 text-sm text-white/60 leading-relaxed">
                {developerCard.description}
              </p>
            </div>
            <div className={`mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider ${developerCard.accent}`}>
              <span>{developerCard.linkLabel}</span>
              <span>→</span>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
