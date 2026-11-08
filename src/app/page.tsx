import Navbar from "@/components/landing/navbar";
import { HeroSection } from "@/components/landing/hero-section";
import { LogoStrip } from "@/components/landing/logo-strip";
import { NewsCarousel } from "@/components/landing/news-carousel";
import { StatsSection } from "@/components/landing/stats-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { CaseStudiesSection } from "@/components/landing/case-studies";
import { BuildForGrowthSection } from "@/components/landing/build-tabs";
import { CommunityMosaicSection } from "@/components/landing/community-mosaic";
import { FinalCtaSection } from "@/components/landing/final-cta";
import Footer from "@/components/landing/footer";
import { ScrollToTop } from "@/components/ui/scroll-to-top";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black text-white selection:bg-[#9945FF]/40 selection:text-white">
      {/* Primary Sticky Glass Navbar */}
      <Navbar />

      <ScrollToTop />

      <main>
        {/* Hero Section with 3D Glass Orb */}
        <HeroSection />

        {/* Global Logo Strip */}
        <LogoStrip />

        {/* Latest news carousel */}
        <NewsCarousel />

        {/* Adoption stats */}
        <StatsSection />

        {/* Trust features */}
        <FeaturesSection />

        {/* Use cases */}
        <CaseStudiesSection />

        {/* Product tabs */}
        <BuildForGrowthSection />

        {/* Community mosaic */}
        <CommunityMosaicSection />

        {/* Final High-Glow CTA */}
        <FinalCtaSection />
      </main>

      {/* Payproof Footer */}
      <Footer />
    </div>
  );
}
