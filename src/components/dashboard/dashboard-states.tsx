import React from "react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* KPI Skeletons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 rounded-2xl bg-[#0E0E12] border border-white/[0.06] p-5">
            <div className="w-24 h-4 bg-white/10 rounded-full mb-4" />
            <div className="w-32 h-8 bg-white/15 rounded-md mb-3" />
            <div className="w-40 h-3 bg-white/5 rounded-full" />
          </div>
        ))}
      </div>

      {/* Chart Skeleton */}
      <div className="h-72 rounded-2xl bg-[#0E0E12] border border-white/[0.06] p-6 flex flex-col justify-between">
        <div className="w-36 h-5 bg-white/10 rounded-full" />
        <div className="w-full h-44 bg-white/5 rounded-xl" />
      </div>

      {/* Table Skeleton */}
      <div className="h-64 rounded-2xl bg-[#0E0E12] border border-white/[0.06] p-6">
        <div className="w-48 h-5 bg-white/10 rounded-full mb-6" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 w-full bg-white/5 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function DashboardEmptyState({ onAction }: { onAction?: () => void }) {
  return (
    <Card className="p-12 sm:p-16 text-center border border-white/[0.08] flex flex-col items-center justify-center max-w-xl mx-auto my-12">
      <div className="w-16 h-16 rounded-full bg-[#9945FF]/15 border border-[#9945FF]/30 flex items-center justify-center mb-6">
        <svg className="w-8 h-8 text-[#14F195]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      </div>

      <h3 className="text-xl font-bold text-white tracking-tight">
        No Payments Recorded Yet
      </h3>
      <p className="text-sm text-white/60 mt-2 max-w-md leading-relaxed">
        Your merchant console is connected and listening for Solana Devnet transactions. Create your first payment link to generate verified proofs.
      </p>

      <div className="mt-8">
        <Button href="/payment-requests" size="md" variant="primary" onClick={onAction}>
          Create First Payment Link
        </Button>
      </div>
    </Card>
  );
}

export function DashboardDisconnectedState({ onConnect }: { onConnect?: () => void }) {
  return (
    <Card className="p-12 sm:p-16 text-center border border-white/[0.08] flex flex-col items-center justify-center max-w-xl mx-auto my-12">
      <div className="w-16 h-16 rounded-full bg-[#C14BF0]/15 border border-[#C14BF0]/30 flex items-center justify-center mb-6">
        <svg className="w-8 h-8 text-[#C14BF0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M12 12h.01" />
          <path d="M17 12h.01" />
        </svg>
      </div>

      <h3 className="text-xl font-bold text-white tracking-tight">
        Merchant Wallet Disconnected
      </h3>
      <p className="text-sm text-white/60 mt-2 max-w-md leading-relaxed">
        Please connect your Phantom or Solana wallet to view private merchant balances, generate payment references, and sign proofs.
      </p>

      <div className="mt-8">
        <Button type="button" size="md" variant="primary" onClick={onConnect}>
          Connect Phantom / Solana Wallet
        </Button>
      </div>
    </Card>
  );
}

export function DashboardErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <Card className="p-12 sm:p-16 text-center border border-red-500/30 bg-red-950/20 flex flex-col items-center justify-center max-w-xl mx-auto my-12">
      <div className="w-16 h-16 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mb-6 text-red-400">
        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>

      <h3 className="text-xl font-bold text-red-100 tracking-tight">
        Solana RPC Cluster Unreachable
      </h3>
      <p className="text-sm text-red-200/70 mt-2 max-w-md leading-relaxed">
        Could not connect to the Solana Devnet node. This can happen during temporary RPC rate-limiting.
      </p>

      <div className="mt-8">
        <Button type="button" size="md" variant="secondary" onClick={onRetry}>
          Retry Connection
        </Button>
      </div>
    </Card>
  );
}

