"use client";

import { formatSol } from "@/lib/solana/units";
import {
  CheckedIcon,
  InvoicesIcon,
  PendingIcon,
} from "@/components/dashboard/icons";

export type InvoiceOverviewCounts = {
  total: number;
  paid: number;
  pending: number;
  /** Sum of `amountLamports` for paid records only, as an integer string. */
  totalPaidLamports: string;
};

/**
 * KPI strip for the Invoices page (payment requests viewed as invoices).
 * Values are calculated from fetched database records, never hardcoded.
 */
export default function InvoicesOverview({
  counts,
  isRefreshing,
}: {
  counts: InvoiceOverviewCounts;
  isRefreshing: boolean;
}) {
  const totalPaidSol = (() => {
    try {
      return formatSol(BigInt(counts.totalPaidLamports));
    } catch {
      return "0.000000";
    }
  })();

  const cards = [
    {
      label: "Total Invoices",
      value: counts.total.toLocaleString("en-US"),
      hint: `${counts.paid} paid · ${counts.pending} pending`,
      badge: "All time",
      badgeColor: "bg-white/[0.06] text-white/60 border-white/[0.1]",
      valueColor: "text-white",
      icon: <InvoicesIcon className="size-4 text-[#9945FF]" />,
    },
    {
      label: "Paid",
      value: counts.paid.toLocaleString("en-US"),
      hint: "Verified on Solana Devnet",
      badge: "Confirmed",
      badgeColor: "bg-[#14F195]/10 text-[#14F195] border-[#14F195]/25",
      valueColor: "text-[#14F195]",
      icon: <CheckedIcon className="size-4 text-[#14F195]" />,
    },
    {
      label: "Pending",
      value: counts.pending.toLocaleString("en-US"),
      hint: "Awaiting verification",
      badge: "Open",
      badgeColor: "bg-amber-400/10 text-amber-300 border-amber-400/25",
      valueColor: "text-amber-300",
      icon: <PendingIcon className="size-4 text-amber-300" />,
    },
    {
      label: "Total Paid",
      value: totalPaidSol,
      suffix: "SOL",
      hint: "Verified paid records only",
      badge: "Revenue",
      badgeColor: "bg-[#9945FF]/10 text-[#C14BF0] border-[#9945FF]/25",
      valueColor: "text-white",
      icon: (
        <svg
          className="size-4 text-[#C14BF0]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 2v20M17 7.5c0-1.93-2.24-3.5-5-3.5s-5 1.57-5 3.5 2.24 3.5 5 3.5 5 1.57 5 3.5-2.24 3.5-5 3.5-5-1.57-5-3.5" />
        </svg>
      ),
    },
  ];

  return (
    <section aria-label="Invoice overview">
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
                className={`break-words font-mono font-bold tracking-tight tabular-nums ${card.valueColor} ${
                  isRefreshing ? "opacity-60 transition-opacity" : ""
                }`}
                style={{ fontSize: "clamp(1.0625rem, 4.8vw, 1.5rem)", lineHeight: 1.15 }}
              >
                {card.value}
                {"suffix" in card && card.suffix ? (
                  <span className="ml-1 text-xs font-normal text-white/50">
                    {card.suffix}
                  </span>
                ) : null}
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
