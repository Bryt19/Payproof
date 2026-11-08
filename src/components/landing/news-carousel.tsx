"use client";

import React, { useState } from "react";
import { Button } from "../ui/button";
import { news } from "@content/payproof";

const newsItems = news.items;

export function NewsCarousel() {
  const [currentIndex, setCurrentIndex] = useState(0);

  const prevSlide = () => {
    setCurrentIndex((prev) => (prev === 0 ? newsItems.length - 1 : prev - 1));
  };

  const nextSlide = () => {
    setCurrentIndex((prev) => (prev === newsItems.length - 1 ? 0 : prev + 1));
  };

  const active = newsItems[currentIndex];

  return (
    <section id="news" className="relative py-16 md:py-24 overflow-hidden">
      {/* Background Soft Glow */}
      <div className="absolute top-1/2 left-1/4 -translate-y-1/2 w-96 h-96 bg-[#9945FF]/10 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12 sm:mb-16">
          <p className="eyebrow-label text-[#14F195] mb-2">
            {news.eyebrow}
          </p>
          <h2 className="section-headline text-white">{news.heading}</h2>
          <p className="mt-4 text-sm sm:text-base text-white/65">
            {news.description}
          </p>
        </div>

        <div className="relative group">
          {/* Main Card */}
          <div className="rounded-3xl bg-[#0E0E12] border border-white/[0.08] overflow-hidden p-6 sm:p-8 lg:p-10 transition-all duration-300 hover:border-[#9945FF]/40 shadow-2xl">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              {/* Media Column (Image top on mobile, left on desktop) */}
              <div className="lg:col-span-6 relative aspect-[16/10] sm:aspect-[16/9] lg:aspect-[4/3] rounded-2xl overflow-hidden bg-[#16161B]">
                <img
                  src={active.imageUrl}
                  alt={active.imageAlt}
                  className="w-full h-full object-cover transition-transform duration-700 hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0E0E12]/80 via-transparent to-transparent pointer-events-none" />
              </div>

              {/* Text Column */}
              <div className="lg:col-span-6 flex flex-col items-start justify-center">
                {/* Pill Tag */}
                <div className="inline-flex items-center px-3 py-1 rounded-full bg-[#14F195]/10 border border-[#14F195]/30 text-[#14F195] text-xs font-semibold uppercase tracking-wider mb-4">
                  {active.tag}
                </div>

                {/* Title */}
                <h3 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white tracking-tight leading-snug">
                  {active.title}
                </h3>

                {/* Description */}
                <p className="mt-4 text-sm sm:text-base text-white/65 leading-relaxed font-normal">
                  {active.description}
                </p>

                {/* Action CTA */}
                <div className="mt-6 sm:mt-8">
                  <Button
                    href={active.ctaHref}
                    isExternal={active.ctaHref.startsWith("http")}
                    variant="outline"
                    size="md"
                    className="rounded-full px-6 font-semibold tracking-wider text-xs uppercase"
                  >
                    {active.ctaText}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Desktop Left / Right Navigation Arrows */}
          <button
            type="button"
            onClick={prevSlide}
            className="hidden sm:flex absolute -left-5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-[#16161B] border border-white/15 text-white/80 hover:text-white hover:border-[#9945FF] hover:bg-[#9945FF]/20 items-center justify-center transition-all shadow-xl"
            aria-label="Previous slide"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>

          <button
            type="button"
            onClick={nextSlide}
            className="hidden sm:flex absolute -right-5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-[#16161B] border border-white/15 text-white/80 hover:text-white hover:border-[#9945FF] hover:bg-[#9945FF]/20 items-center justify-center transition-all shadow-xl"
            aria-label="Next slide"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        {/* Carousel Dots */}
        <div className="flex items-center justify-center gap-2.5 mt-6">
          {newsItems.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCurrentIndex(idx)}
              className={`h-2 rounded-full transition-all duration-300 ${
                currentIndex === idx
                  ? "w-8 bg-gradient-to-r from-[#9945FF] to-[#14F195]"
                  : "w-2 bg-white/20 hover:bg-white/40"
              }`}
              aria-label={`Go to slide ${idx + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

