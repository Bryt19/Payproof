"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/button";
import { WalletConnectModal } from "./wallet-connect-modal";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";
import { finalCta } from "@content/payproof";

export function FinalCtaSection() {
  const router = useRouter();
  const { status, isConnected, isConnecting, error, retry } = useWalletAuth();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const intentRef = useRef<"dashboard" | "payment">("dashboard");

  // Label that changes with wallet state, matching the hero CTA behavior.
  const ctaLabel = isConnected ? "View Dashboard" : "Connect Wallet";

  const openModal = () => {
    intentRef.current = "dashboard";
    setIsModalOpen(true);
  };

  const closeModal = useCallback(() => setIsModalOpen(false), []);

  const handleConnected = useCallback(() => {
    setIsModalOpen(false);
    router.push(finalCta.cta.href);
  }, [router]);

  const handleGetStarted = () => {
    if (isConnected) {
      router.push(finalCta.cta.href);
      return;
    }

    openModal();
  };

  // Render a skeleton label while wallets are still being discovered so the
  // button text never flashes the wrong state.
  if (status === "checking") {
    return (
      <section className="relative py-24 sm:py-32 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[350px] bg-gradient-to-r from-[#9945FF]/25 via-[#C14BF0]/20 to-[#14F195]/20 rounded-full blur-[110px] pointer-events-none" />

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <div className="p-8 sm:p-14 rounded-3xl bg-[#0E0E12]/80 border border-white/[0.1] backdrop-blur-xl shadow-[0_20px_60px_rgba(153,69,255,0.15)] flex flex-col items-center">
            <div className="h-5 w-40 animate-pulse rounded-lg bg-white/[0.05] mb-4" />
            <div className="h-10 w-64 animate-pulse rounded-lg bg-white/[0.05] mb-6" />
            <div className="h-5 w-80 animate-pulse rounded-lg bg-white/[0.05] mb-10" />
            <div className="h-12 w-44 animate-pulse rounded-full border border-white/10 bg-white/[0.06]" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="relative py-24 sm:py-32 overflow-hidden">
      {/* Background Multi-stop Aura */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[350px] bg-gradient-to-r from-[#9945FF]/25 via-[#C14BF0]/20 to-[#14F195]/20 rounded-full blur-[110px] pointer-events-none" />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
        {/* Subtle decorative glowing capsule frame */}
        <div className="p-8 sm:p-14 rounded-3xl bg-[#0E0E12]/80 border border-white/[0.1] backdrop-blur-xl shadow-[0_20px_60px_rgba(153,69,255,0.15)] flex flex-col items-center">
          <span className="eyebrow-label text-[#14F195] mb-4">
            {finalCta.eyebrow}
          </span>

          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black text-white tracking-tight leading-tight max-w-2xl">
            {finalCta.heading}
          </h2>

          <p className="mt-6 text-sm sm:text-base text-white/70 max-w-lg leading-relaxed">
            {finalCta.subtext}
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-4 w-full sm:w-auto">
            {isConnected ? (
              <Button
                href={finalCta.cta.href}
                size="lg"
                variant="primary"
                className="px-10 text-sm font-bold tracking-wider"
              >
                {ctaLabel}
              </Button>
            ) : (
              <Button
                type="button"
                size="lg"
                variant="primary"
                className="px-10 text-sm font-bold tracking-wider"
                onClick={handleGetStarted}
                disabled={isConnecting}
                aria-busy={isConnecting}
              >
                {isConnecting ? "Connecting…" : ctaLabel}
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 flex flex-col items-center gap-2 px-4 text-center text-xs text-red-300"
        >
          <p>Could not connect. {error}</p>
          <button
            type="button"
            onClick={retry}
            disabled={isConnecting}
            className="rounded-full border border-red-300/30 px-3 py-1 font-semibold text-red-100 transition-colors hover:bg-red-400/10 focus-visible:outline-2 focus-visible:outline-[#9945FF] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Try again
          </button>
        </div>
      )}

      <WalletConnectModal
        open={isModalOpen}
        onClose={closeModal}
        onConnected={handleConnected}
      />
    </section>
  );
}
