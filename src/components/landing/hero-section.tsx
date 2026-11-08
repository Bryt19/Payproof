import React from "react";
import { GlassOrb } from "../ui/glass-orb";
import { HeroWalletActions } from "./hero-actions";
import { hero } from "@content/payproof";

export function HeroSection() {
  return (
    <section
      id="home"
      className="relative min-h-[90vh] flex items-center pt-28 pb-20 md:pt-36 md:pb-28 overflow-hidden"
    >
      <div className="absolute inset-0 pointer-events-none select-none z-0 overflow-hidden">
        {/* Atmospheric Radial Aura shifted subtly to provide backdrop for text and orb */}
        <div
          className="absolute top-1/2 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-tr from-[#9945FF]/20 via-[#C14BF0]/12 to-[#14F195]/10 rounded-full blur-[120px] pointer-events-none"
          suppressHydrationWarning
        />

        {/* Static SVG 3D Dark Glass Orb on the right */}
        <div className="absolute -right-12 sm:right-0 lg:right-6 xl:right-16 top-1/2 -translate-y-1/2 w-[320px] sm:w-[380px] md:w-[460px] lg:w-[540px] opacity-35 sm:opacity-70 lg:opacity-95 transition-opacity duration-300 pointer-events-none">
          <GlassOrb />
        </div>
      </div>

      {/* Foreground Hero Content - max-w-7xl container with tasteful left offset */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl lg:max-w-3xl text-left sm:pl-6 md:pl-10 lg:pl-12 xl:pl-16">
          {/* Primary Headline with Fluid Clamp */}
          <h1 className="hero-headline text-white text-left tracking-tight">
            {hero.headline}
            <br />
            <span className="text-gradient-brand">{hero.headlineAccent}</span>
          </h1>

          {/* Subtext */}
          <p className="mt-6 text-base sm:text-lg md:text-xl text-white/70 text-left max-w-xl lg:max-w-2xl leading-relaxed font-normal">
            {hero.subtext}
          </p>

          {/* Hero CTAs: wallet-aware, stacked on mobile, row on tablet/desktop */}
          <HeroWalletActions />
        </div>
      </div>
    </section>
  );
}
