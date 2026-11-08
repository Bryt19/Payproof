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
      className="flex h-full flex-col rounded-2xl border border-line p-4 transition-all duration-200 hover:border-[#9945FF]/40 hover:shadow-[0_8px_24px_rgba(153,69,255,0.12)] sm:p-5"
      style={{ background: "#0E0E12" }}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className="min-w-0 text-[10px] font-medium uppercase leading-tight tracking-wider sm:text-xs"
          style={{ color: "rgba(255,255,255,0.4)" }}
        >
          {stat.label}
        </p>
        <span className="shrink-0" style={{ color: "rgba(255,255,255,0.3)" }}>
          {icon}
        </span>
      </div>

      <p
        className="mt-3 break-words font-mono font-semibold tracking-tight tabular-nums"
        style={{
          fontSize: "clamp(1.0625rem, 4.8vw, 1.5rem)",
          lineHeight: 1.15,
          background:
            "linear-gradient(135deg,#9945FF 0%,#C14BF0 50%,#14F195 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        {stat.value}
        {stat.unit && (
          <span
            className="ml-1 text-[11px] font-normal"
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
        className="mt-auto pt-1 text-[11px] leading-snug"
        style={{ color: "rgba(255,255,255,0.35)" }}
      >
        {stat.hint}
      </p>
    </div>
  );
}
