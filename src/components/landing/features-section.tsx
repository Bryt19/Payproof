import React from "react";
import { Card } from "../ui/card";
import { features } from "@content/payproof";

export function FeaturesSection() {
  const items = features.items;

  return (
    <section id="trust" className="relative py-20 sm:py-28 overflow-hidden bg-black/60 scroll-mt-28 sm:scroll-mt-32">
      {/* Background Soft Purple Glow */}
      <div className="absolute top-1/3 right-10 w-96 h-96 bg-[#9945FF]/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="flex flex-col items-center text-center mb-16 sm:mb-20">
          <h2 className="section-headline text-white">
            {features.heading}
          </h2>
          <p className="mt-4 text-base sm:text-lg text-white/65 max-w-2xl">
            {features.description}
          </p>
        </div>

        {/* Feature Cards Grid: 1 col on mobile, 2x2 on tablet, 4-col on desktop */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {items.map((item) => (
            <Card
              key={item.title}
              className="p-6 sm:p-7 flex flex-col justify-between h-full group relative overflow-hidden"
            >
              {/* Top ambient card glow */}
              <div
                className={`absolute -top-16 -right-16 w-32 h-32 bg-gradient-to-br ${item.glowColor} rounded-full blur-2xl group-hover:scale-150 transition-transform duration-500`}
              />

              <div>
                {/* Eyebrow sublabel */}
                <span className="eyebrow-label text-white/50 block mb-2">
                  {item.sublabel}
                </span>

                {/* Card Title */}
                <h3 className="text-2xl font-bold text-white tracking-tight">
                  {item.title}
                </h3>

                {/* Highlighted live metric */}
                <div className="my-4 text-lg font-mono font-bold text-gradient-brand">
                  {item.metric}
                </div>

                {/* Description */}
                <p className="text-sm text-white/65 leading-relaxed">
                  {item.description}
                </p>
              </div>

              {/* Bottom Subtle Indicator */}
              <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center justify-between text-xs text-white/40 group-hover:text-white/80 transition-colors">
                <span>{features.cardCta}</span>
                <svg className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
