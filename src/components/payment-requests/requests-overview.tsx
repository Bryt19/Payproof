"use client";

import type { PaymentRequest } from "@/lib/payment-requests/types";
import { formatSolExact } from "@/lib/solana/units";
import { RequestsIcon, PaymentsIcon, CheckIcon } from "@/components/dashboard/icons";

export default function RequestsOverview({
  requests,
  status,
}: {
  requests: readonly PaymentRequest[];
  status: "idle" | "loading" | "loaded" | "error";
}) {
  const totalRequests = requests.length;
  const totalRequested = requests.reduce(
    (acc, request) => acc + BigInt(request.amountLamports),
    0n,
  );
  const pending = requests.filter((request) => request.status === "pending");
  const paid = requests.filter((request) => request.status === "paid");

  const pendingSol = pending.reduce(
    (acc, request) => acc + BigInt(request.amountLamports),
    0n,
  );
  const paidSol = paid.reduce(
    (acc, request) => acc + BigInt(request.amountLamports),
    0n,
  );

  const cards = [
    {
      label: "Total Requests",
      value: totalRequests.toString(),
      unit: "",
      hint: `${paid.length} paid · ${pending.length} pending`,
      icon: <RequestsIcon className="size-4 text-[#9945FF]" />,
      badge: "Devnet",
      badgeColor: "bg-white/[0.06] text-white/60 border-white/[0.1]",
      valColor: "text-white",
    },
    {
      label: "Pending Volume",
      value: pendingSol === 0n ? "0" : formatSolExact(pendingSol),
      unit: "SOL",
      hint: "Awaiting on-chain verification",
      icon: (
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex size-2.5 rounded-full bg-amber-400" />
        </span>
      ),
      badge: `${pending.length} awaiting`,
      badgeColor: "bg-amber-400/10 text-amber-300 border-amber-400/25",
      valColor: "text-amber-300",
    },
    {
      label: "Verified Paid",
      value: paidSol === 0n ? "0" : formatSolExact(paidSol),
      unit: "SOL",
      hint: "Confirmed against Solana Devnet",
      icon: <CheckIcon className="size-4 text-[#14F195]" />,
      badge: `${paid.length} confirmed`,
      badgeColor: "bg-[#14F195]/10 text-[#14F195] border-[#14F195]/25",
      valColor: "text-[#14F195]",
    },
    {
      label: "Total Requested",
      value: totalRequested === 0n ? "0" : formatSolExact(totalRequested),
      unit: "SOL",
      hint: "Lifetime request volume",
      icon: <PaymentsIcon className="size-4 text-[#C14BF0]" />,
      badge: "Cumulative",
      badgeColor: "bg-white/[0.06] text-white/60 border-white/[0.1]",
      isGradient: true,
    },
  ];

  if (status === "loading") {
    return (
      <div className="kpi-grid grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-2xl border border-white/[0.08] bg-[#0E0E12] p-4 sm:p-5"
          />
        ))}
      </div>
    );
  }

  return (
    <section aria-label="Payment request overview" className="space-y-3">
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
                {card.badge && (
                  <span
                    className={`hidden rounded-full border px-2 py-0.5 text-[10px] font-medium sm:inline-flex ${card.badgeColor}`}
                  >
                    {card.badge}
                  </span>
                )}
                <span className="shrink-0">{card.icon}</span>
              </div>
            </div>

            <div className="mt-3 sm:mt-4">
              <p
                className={`break-words font-mono font-bold tracking-tight tabular-nums ${
                  card.isGradient ? "text-gradient-brand" : card.valColor
                }`}
                style={{ fontSize: "clamp(1.0625rem, 4.8vw, 1.5rem)", lineHeight: 1.15 }}
              >
                {card.value}
                {card.unit && (
                  <span className="ml-1 text-[11px] font-normal text-white/40">
                    {card.unit}
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

      {status === "error" && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-xs text-red-200">
          Unable to refresh overview metrics. Your payment requests are still available below.
        </div>
      )}
    </section>
  );
}
