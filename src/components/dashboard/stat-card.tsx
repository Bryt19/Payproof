import type { ReactNode } from "react";
import type { DashboardStat } from "@/lib/dashboard/summary";

export default function StatCard({
  stat,
  icon,
}: {
  stat: DashboardStat;
  icon: ReactNode;
}) {
  return (
    <div
      className="flex h-full min-w-0 flex-col rounded-2xl border border-line p-3 transition-all duration-200 hover:border-[#9945FF]/40 hover:shadow-[0_8px_24px_rgba(153,69,255,0.12)] sm:p-4"
      style={{ background: "#0E0E12" }}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className="min-w-0 flex-1 text-[10px] font-medium uppercase leading-tight tracking-wide sm:text-xs sm:tracking-wider"
          style={{ color: "rgba(255,255,255,0.4)" }}
        >
          {stat.label}
        </p>
        <span className="shrink-0" style={{ color: "rgba(255,255,255,0.3)" }}>
          {icon}
        </span>
      </div>

      <p
        className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-1 font-mono font-semibold tracking-tight tabular-nums"
        style={{
          fontSize: "clamp(0.9375rem, 4.2vw, 1.5rem)",
          lineHeight: 1.15,
          background:
            "linear-gradient(135deg,#9945FF 0%,#C14BF0 50%,#14F195 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        {/* The unit is its own flex item so it wraps whole instead of being
            split by word-breaking when the value is long. */}
        <span className="min-w-0 break-words">{stat.value}</span>
        {stat.unit && (
          <span
            className="shrink-0 whitespace-nowrap text-[10px] font-normal sm:text-[11px]"
            style={{
              background: "none",
              WebkitTextFillColor: "rgba(255,255,255,0.4)",
            }}
          >
            {stat.unit}
          </span>
        )}
      </p>

      <p
        className="mt-auto min-w-0 break-words pt-1 text-[10px] leading-snug sm:text-[11px]"
        style={{ color: "rgba(255,255,255,0.35)" }}
      >
        {stat.hint}
      </p>
    </div>
  );
}
