"use client";

import {
  CheckedIcon,
  InvoicesIcon,
  PendingIcon,
} from "@/components/dashboard/icons";

export type InvoiceOverviewCounts = {
  total: number;
  paid: number;
  open: number;
  overdue: number;
};

/**
 * KPI strip for the invoices page. Mirrors the payment request overview so both
 * list pages read the same way: label, count, short hint, accent colour.
 */
export default function InvoicesOverview({
  counts,
  isRefreshing,
}: {
  counts: InvoiceOverviewCounts;
  isRefreshing: boolean;
}) {
  const cards = [
    {
      label: "Total Invoices",
      value: counts.total,
      hint: `${counts.paid} paid · ${counts.open} open`,
      badge: "All time",
      badgeColor: "bg-white/[0.06] text-white/60 border-white/[0.1]",
      valueColor: "text-white",
      icon: <InvoicesIcon className="size-4 text-[#9945FF]" />,
    },
    {
      label: "Paid",
      value: counts.paid,
      hint: "Settled invoices",
      badge: "Confirmed",
      badgeColor: "bg-[#14F195]/10 text-[#14F195] border-[#14F195]/25",
      valueColor: "text-[#14F195]",
      icon: <CheckedIcon className="size-4 text-[#14F195]" />,
    },
    {
      label: "Open",
      value: counts.open,
      hint: "Sent or viewed, not yet paid",
      badge: "Awaiting",
      badgeColor: "bg-amber-400/10 text-amber-300 border-amber-400/25",
      valueColor: "text-amber-300",
      icon: <PendingIcon className="size-4 text-amber-300" />,
    },
    {
      label: "Overdue",
      value: counts.overdue,
      hint: "Past their due date",
      badge: "Action needed",
      badgeColor: "bg-red-400/10 text-red-300 border-red-400/25",
      valueColor: "text-red-300",
      icon: (
        <svg
          className="size-4 text-red-300"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 4.5 3.2 19.5h17.6L12 4.5Z" />
          <path d="M12 10v4" />
          <path d="M12 17h.01" />
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
                {card.value.toLocaleString("en-US")}
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
