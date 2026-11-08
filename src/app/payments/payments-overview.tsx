"use client";

import {
  CheckedIcon,
  CloseIcon,
  PendingIcon,
  ReceivedIcon,
} from "@/components/dashboard/icons";

export type PaymentsSummary = {
  verifiedCount: number;
  totalVerifiedSol: string;
  pendingCount: number;
  failedCount: number;
  totalSolHint: string;
};

/**
 * KPI strip for the payments page. Same card anatomy as the payment request
 * and invoice overviews: label, badge + icon, mono value, short hint.
 */
export default function PaymentsOverview({
  summary,
  isRefreshing,
}: {
  summary: PaymentsSummary;
  isRefreshing: boolean;
}) {
  const cards = [
    {
      label: "Verified Payments",
      value: summary.verifiedCount.toLocaleString("en-US"),
      hint: "Independently verified on Solana",
      badge: "Confirmed",
      badgeColor: "bg-[#14F195]/10 text-[#14F195] border-[#14F195]/25",
      valueColor: "text-[#14F195]",
      gradient: false,
      icon: <CheckedIcon className="size-4 text-[#14F195]" />,
    },
    {
      label: "Total SOL Received",
      value: summary.totalVerifiedSol,
      hint: summary.totalSolHint,
      badge: "Lifetime",
      badgeColor: "bg-white/[0.06] text-white/60 border-white/[0.1]",
      valueColor: "text-white",
      gradient: true,
      icon: <ReceivedIcon className="size-4 text-[#C14BF0]" />,
    },
    {
      label: "Pending",
      value: summary.pendingCount.toLocaleString("en-US"),
      hint: "Awaiting on-chain payment",
      badge: "Awaiting",
      badgeColor: "bg-amber-400/10 text-amber-300 border-amber-400/25",
      valueColor: "text-amber-300",
      gradient: false,
      icon: <PendingIcon className="size-4 text-amber-300" />,
    },
    {
      label: "Failed",
      value: summary.failedCount.toLocaleString("en-US"),
      hint: "Expired or cancelled requests",
      badge: "Closed",
      badgeColor: "bg-red-400/10 text-red-300 border-red-400/25",
      valueColor: "text-red-300",
      gradient: false,
      icon: <CloseIcon className="size-4 text-red-300" />,
    },
  ];

  return (
    <section aria-label="Payment overview">
      <div className="kpi-grid grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="group relative flex h-full min-w-0 flex-col justify-between rounded-2xl border border-white/[0.08] p-4 transition-all duration-200 hover:border-[#9945FF]/40 hover:shadow-[0_8px_24px_rgba(153,69,255,0.12)] sm:p-5"
            style={{ background: "#0E0E12" }}
          >
            <div className="flex items-start justify-between gap-1.5">
              <span className="min-w-0 text-[10px] font-semibold uppercase leading-tight tracking-wider text-white/45 sm:text-[11px]">
                {card.label}
              </span>
              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  className={`hidden rounded-full border px-2 py-0.5 text-[10px] font-medium sm:inline-flex ${card.badgeColor}`}
                >
                  {card.badge}
                </span>
                <span className="shrink-0">{card.icon}</span>
              </div>
            </div>

            <div className="mt-3 sm:mt-4">
              <p
                className={`break-words font-mono font-bold tracking-tight tabular-nums ${
                  card.gradient ? "text-gradient-brand" : card.valueColor
                } ${isRefreshing ? "opacity-60 transition-opacity" : ""}`}
                style={{ fontSize: "clamp(1.0625rem, 4.8vw, 1.5rem)", lineHeight: 1.15 }}
              >
                {card.value}
                {card.gradient && (
                  <span className="ml-1 text-[11px] font-normal text-white/40">
                    SOL
                  </span>
                )}
              </p>
              <p className="mt-1 text-[10px] leading-snug text-white/40 sm:text-[11px]">
                {card.hint}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
