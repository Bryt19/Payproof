"use client";

import React, { useState } from "react";
import { Card } from "../ui/card";
import { build, type BuildMock, type BuildTabKey } from "@content/payproof";

function MockUI({ mock }: { mock: BuildMock }) {
  const positive = mock.tone === "positive";

  return (
    <div className="w-full max-w-xs text-left">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-white/40">
          {mock.label}
        </span>
        <span
          className="rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider"
          style={{
            color: positive ? "#14F195" : "#fbbf24",
            borderColor: positive
              ? "rgba(20,241,149,0.25)"
              : "rgba(251,191,36,0.25)",
            background: positive
              ? "rgba(20,241,149,0.08)"
              : "rgba(251,191,36,0.08)",
          }}
        >
          {mock.status}
        </span>
      </div>

      {mock.code ? (
        <pre className="overflow-x-auto rounded-xl border border-white/[0.06] bg-black/40 p-3 text-[11px] leading-relaxed font-mono text-white/70">
          {mock.code.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </pre>
      ) : (
        <div className="divide-y divide-white/[0.05] rounded-xl border border-white/[0.06] bg-black/40">
          {mock.rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <span className="text-[11px] text-white/40">{row.label}</span>
              <span
                className={`break-all text-right text-xs text-white/80 ${
                  row.mono ? "font-mono" : ""
                }`}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BuildForGrowthSection() {
  const [activeTab, setActiveTab] = useState<BuildTabKey>("Payments");

  const tabs = build.tabs;
  const current = build.panels[activeTab];

  return (
    <section id="product" className="relative py-20 sm:py-28 overflow-hidden bg-black/40 scroll-mt-28 sm:scroll-mt-32">
      {/* Background Soft Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-[#C14BF0]/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12 sm:mb-16">
          <p className="eyebrow-label text-[#14F195] mb-2">
            {build.eyebrow}
          </p>
          <h2 className="section-headline text-white">
            {build.heading}
          </h2>
          <p className="mt-4 text-sm sm:text-base text-white/65">
            {build.description}
          </p>
        </div>

        {/* Horizontally Scrollable Pill Tabs on Mobile / Centered on Desktop */}
        <div className="flex items-center justify-start sm:justify-center overflow-x-auto pb-4 mb-8 no-scrollbar gap-2 sm:gap-3 px-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`min-h-[44px] px-6 py-2 rounded-full text-xs sm:text-sm font-semibold tracking-wide transition-all duration-200 whitespace-nowrap cursor-pointer select-none focus-visible:outline-2 focus-visible:outline-[#9945FF] ${
                activeTab === tab
                  ? "bg-gradient-to-r from-[#9945FF] to-[#C14BF0] text-white shadow-[0_0_20px_rgba(153,69,255,0.4)]"
                  : "bg-white/[0.05] text-white/60 hover:text-white hover:bg-white/[0.09] border border-white/[0.06]"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content Display Card */}
        <Card className="p-8 sm:p-12 relative overflow-hidden border border-white/[0.08]">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            {/* Left Column: Mock product UI */}
            <div className="lg:col-span-5 p-8 rounded-2xl bg-[#16161B] border border-white/[0.06] flex flex-col items-center justify-center text-center">
              <MockUI mock={current.mock} />
            </div>

            {/* Right Column: Copy & Actions */}
            <div className="lg:col-span-7 flex flex-col items-start justify-center">
              <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-snug">
                {current.headline}
              </h3>

              <p className="mt-4 text-sm sm:text-base text-white/65 leading-relaxed">
                {current.description}
              </p>

              <a
                href={current.learnHref}
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#14F195] hover:underline"
              >
                <span>{current.learnLabel}</span>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </a>
            </div>
          </div>

          {/* Partner Badges Strip */}
          <div className="mt-10 pt-6 border-t border-white/[0.06]">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40 mb-4">
              {build.partnersLabel} {activeTab}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-center">
              {build.partners.map((partner, index) => (
                <div
                  key={`${partner}-${index}`}
                  className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.04] text-center text-sm font-bold text-white/70 hover:text-white transition-colors"
                >
                  {partner}
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
