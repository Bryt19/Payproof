import React from "react";
import { Card } from "../ui/card";
import { useCases } from "@content/payproof";

export function CaseStudiesSection() {
  const secondaryStudies = useCases.items;
  const featured = useCases.featured;

  return (
    <section id="use-cases" className="relative py-20 sm:py-28 overflow-hidden scroll-mt-28 sm:scroll-mt-32">
      {/* Background Radial Atmosphere */}
      <div className="absolute top-1/2 left-1/3 w-[500px] h-[500px] bg-[#9945FF]/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-12 sm:mb-16 gap-4">
          <div>
            <p className="eyebrow-label text-[#14F195] mb-2">
              {useCases.eyebrow}
            </p>
            <h2 className="section-headline text-white">
              {useCases.heading}
            </h2>
          </div>
          <p className="text-sm sm:text-base text-white/60 max-w-md">
            {useCases.description}
          </p>
        </div>

        {/* Featured use case (Full Width) */}
        <div className="mb-8">
          <Card className="p-8 sm:p-12 relative overflow-hidden group cursor-pointer border border-white/[0.08] hover:border-[#9945FF]/50 transition-all duration-300">
            {/* Ambient Background Glow */}
            <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-bl from-[#9945FF]/25 via-[#C14BF0]/15 to-transparent rounded-full blur-3xl pointer-events-none" />

            <div className="max-w-3xl relative z-10">
              <div className="flex items-center gap-3 mb-4">
                <span className="eyebrow-label text-white/50">
                  {featured.eyebrow}
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#14F195]" />
                <span className="text-xs font-bold text-[#14F195] uppercase tracking-wider">
                  {featured.badge}
                </span>
              </div>

              {/* Use case name */}
              <h3 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight mb-4">
                {featured.name}
              </h3>

              <p className="text-xl sm:text-2xl font-semibold text-white/90 leading-snug tracking-tight mb-8">
                {featured.headline}
              </p>

              <div className="inline-flex items-center gap-2 text-sm font-semibold text-white group-hover:text-[#14F195] transition-colors">
                <span>{featured.linkLabel}</span>
                <svg className="w-4 h-4 transform group-hover:translate-x-1.5 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Card>
        </div>

        {/* 3 Secondary use cases (Stacked on mobile, 3-up on desktop) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {secondaryStudies.map((study) => (
            <Card
              key={study.headline}
              className="p-7 flex flex-col justify-between group cursor-pointer border border-white/[0.08] hover:border-[#9945FF]/40 relative overflow-hidden"
            >
              <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br ${study.gradient} rounded-full blur-2xl pointer-events-none`} />

              <div>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-4">
                  <span className="eyebrow-label text-white/40">
                    {study.tag}
                  </span>
                  <span className="text-base font-bold text-white tracking-tight">
                    {study.brand}
                  </span>
                </div>

                <h4 className="text-lg font-semibold text-white/90 leading-snug group-hover:text-white transition-colors">
                  {study.headline}
                </h4>
              </div>

              <div className="mt-8 pt-4 border-t border-white/[0.06] flex items-center justify-between text-xs font-semibold text-white/50 group-hover:text-[#14F195] transition-colors">
                <span>{study.linkLabel}</span>
                <svg className="w-4 h-4 transform group-hover:translate-x-1 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
