"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TimeRange, VolumePoint, StatusBreakdown } from "@/lib/dashboard/charts";
import { Button } from "@/components/ui/button";

type ChartStatus =
  | { kind: "loading" }
  | { kind: "loaded"; series: readonly VolumePoint[] }
  | { kind: "error"; message: string };

/** How often the status breakdown re-reads the API on its own. */
const BREAKDOWN_POLL_MS = 45_000;

const emptyBreakdown: StatusBreakdown = {
  confirmed: 0,
  pending: 0,
  failedExpired: 0,
  total: 0,
  confirmedPct: 0,
  pendingPct: 0,
  failedExpiredPct: 0,
};

function formatVolume(value: bigint): string {
  const whole = value / 1_000_000_000n;
  const fraction = value % 1_000_000_000n;

  if (fraction === 0n) return `${whole} SOL`;

  const digits = fraction
    .toString()
    .padStart(9, "0")
    .slice(0, 4)
    .replace(/0+$/, "");

  return digits ? `${whole}.${digits} SOL` : `${whole} SOL`;
}

function compactVolume(value: bigint): string {
  const whole = value / 1_000_000_000n;
  const fraction = value % 1_000_000_000n;

  if (fraction === 0n) return whole.toString();

  const digits = fraction
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "")
    .slice(0, 2);

  return `${whole}.${digits}`;
}

function ChartSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-4 h-4 w-24 animate-pulse rounded bg-white/10" />
      <div className="mt-2 flex h-32 items-end gap-2">
        {[60, 74, 52, 88, 66, 80, 58, 92].map((h, i) => (
          <div
            key={i}
            className="flex-1 animate-pulse rounded-xl bg-white/5"
            style={{ height: h + "%" }}
          />
        ))}
      </div>
    </div>
  );
}

function ChartError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-5">
      <h3 className="text-sm font-semibold text-red-100">Chart unavailable</h3>
      <p className="mt-1 text-xs text-red-200/80">{message}</p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-4 text-xs text-red-200 hover:text-red-100"
        onClick={onRetry}
      >
        Retry
      </Button>
    </div>
  );
}

function VolumeChart({
  series,
  onRetry,
  isLoading,
  error,
}: {
  series: readonly VolumePoint[] | null;
  onRetry: () => void;
  isLoading: boolean;
  error: string | null;
}) {
  if (isLoading) return <ChartSkeleton />;
  if (error) return <ChartError message={error} onRetry={onRetry} />;

  if (!series || series.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-5">
        <h3 className="text-sm font-semibold">Payment volume</h3>
        <p className="mt-1 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
          No verified payments in this range yet.
        </p>
      </div>
    );
  }

  const maxValue = Math.max(1, ...series.map((point) => Number(point.value)));
  const showValueLabels = series.length <= 14;

  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold">Payment volume</h3>
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
          <span
            className="inline-block size-2 rounded-full"
            style={{ background: "#9945FF" }}
          />
          <span>Verified SOL</span>
        </div>
      </div>
      <p className="mt-0.5 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
        {series.length} day{series.length === 1 ? "" : "s"} ·{" "}
        {formatVolume(BigInt(series[series.length - 1].value))} most recent
      </p>

      {/* Bars are percentage-based so the chart stays fluid at any width. */}
      <div className="mt-3 flex h-[135px] items-end gap-[2px] pt-3 sm:mt-3.5 sm:h-[150px] sm:gap-[3px]">
        {series.map((point) => {
          const ratio = Number(point.value) / maxValue;
          const pct = Number.isFinite(ratio) ? Math.max(1.5, ratio * 100) : 1.5;

          return (
            <div
              key={point.date}
              className="relative flex h-full min-w-0 flex-1 items-end"
              title={`${point.date}: ${formatVolume(BigInt(point.value))}`}
            >
              <div
                className="w-full rounded-t-md bg-gradient-to-t from-[#9945FF] via-[#5B45FF] to-[#14F195]"
                style={{ height: `${pct}%`, opacity: 0.85 + Math.min(ratio, 1) * 0.15 }}
                aria-hidden="true"
              />
              {showValueLabels && (
                <span className="pointer-events-none absolute inset-x-0 bottom-full mb-0.5 hidden truncate text-center text-[10px] font-medium tabular-nums text-neutral-400 sm:block">
                  {compactVolume(BigInt(point.value))}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex gap-[2px] sm:gap-[3px]">
        {series.map((point) => (
          <div
            key={point.date}
            className="min-w-0 flex-1 truncate text-center text-[9px] text-neutral-500 sm:text-[10px]"
          >
            {point.date.slice(5)}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBreakdownCard({
  breakdown,
  onRetry,
  isLoading,
  error,
}: {
  breakdown: StatusBreakdown | null;
  onRetry: () => void;
  isLoading: boolean;
  error: string | null;
}) {
  if (isLoading) {
    return (
      <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
        <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <div className="size-10 animate-pulse rounded-full bg-white/10" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-20 animate-pulse rounded bg-white/10" />
                <div className="h-2 w-full animate-pulse rounded bg-white/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-5">
        <h3 className="text-sm font-semibold text-red-100">
          Breakdown unavailable
        </h3>
        <p className="mt-1 text-xs text-red-200/80">{error}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-4 text-xs text-red-200 hover:text-red-100"
          onClick={onRetry}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!breakdown) return null;

  const items = [
    {
      key: "confirmed",
      label: "Confirmed",
      value: breakdown.confirmed,
      pct: breakdown.confirmedPct,
      color: "#14F195",
    },
    {
      key: "pending",
      label: "Pending",
      value: breakdown.pending,
      pct: breakdown.pendingPct,
      color: "#fbbf24",
    },
    {
      key: "failedExpired",
      label: "Failed / expired",
      value: breakdown.failedExpired,
      pct: breakdown.failedExpiredPct,
      color: "#737373",
    },
  ];

  const maxValue = Math.max(breakdown.total, 1);

  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5 sm:p-4">
      <h3 className="text-sm font-semibold">Payment status breakdown</h3>
      <p className="mt-0.5 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
        From all payment requests in this account.
      </p>

      <div className="mt-3 space-y-2.5">
        {items.map((item) => (
          <div key={item.key} className="flex items-center gap-3">
            <div
              className="flex size-8.5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums sm:size-9"
              style={{ background: `${item.color}22`, color: item.color }}
            >
              {item.value}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-neutral-200">{item.label}</span>
                <span className="text-xs tabular-nums text-neutral-400">
                  {item.pct}%
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{
                    width: `${Math.round((item.value / maxValue) * 100)}%`,
                    background: item.color,
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2.5 flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2">
        <span className="text-[11px] text-neutral-500">Total requests</span>
        <span className="font-mono text-sm tabular-nums text-neutral-100">
          {breakdown.total}
        </span>
      </div>
    </div>
  );
}

interface DashboardChartsProps {
  initialSeries: readonly VolumePoint[];
  initialBreakdown: StatusBreakdown;
  initialRange: TimeRange;
  merchantAddress?: string | null;
}

export default function DashboardCharts({
  initialSeries,
  initialBreakdown,
  initialRange,
  merchantAddress,
}: DashboardChartsProps) {
  const [range, setRange] = useState<TimeRange>(initialRange);
  const [series, setSeries] = useState<readonly VolumePoint[] | null>(initialSeries);
  const [breakdown, setBreakdown] = useState<StatusBreakdown | null>(initialBreakdown);
  const [chartStatus, setChartStatus] = useState<ChartStatus>({ kind: "loading" });
  const [chartError, setChartError] = useState<string | null>(null);
  const [breakdownError, setBreakdownError] = useState<string | null>(null);

  const merchant =
    typeof merchantAddress === "string" ? merchantAddress.trim() : "";

  const fetchData = useCallback(
    async (selectedRange: TimeRange) => {
      if (!merchant) {
        return {
          ok: true,
          series: [] as readonly VolumePoint[],
          breakdown: emptyBreakdown,
        };
      }
      const params = new URLSearchParams({
        range: selectedRange,
        merchantAddress: merchant,
      });
      const response = await fetch(
        `/api/dashboard-charts?${params.toString()}`,
        { headers: { Accept: "application/json" }, cache: "no-store" },
      );

      const data = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            series?: readonly VolumePoint[];
            breakdown?: StatusBreakdown;
            error?: string;
          }
        | null;

      if (!response.ok || data?.ok === false) {
        throw new Error(
          data?.error ?? `Chart data failed with status ${response.status}.`,
        );
      }

      return data;
    },
    [merchant],
  );

  const reload = useCallback(async () => {
    setChartStatus({ kind: "loading" });
    setChartError(null);
    setBreakdownError(null);

    try {
      const data = await fetchData(range);
      setSeries(data?.series ?? []);
      setBreakdown(data?.breakdown ?? emptyBreakdown);
      setChartStatus({ kind: "loaded", series: data?.series ?? [] });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not load chart data.";
      setChartError(message);
      setChartStatus({ kind: "error", message });
    }
  }, [fetchData, range]);

  useEffect(() => {
    if (!merchant) {
      setSeries([]);
      setBreakdown(emptyBreakdown);
      setChartStatus({ kind: "loaded", series: [] });
      setChartError(null);
      setBreakdownError(null);
      return;
    }
    void reload();
  }, [merchant, reload]);

  // The breakdown keeps itself current so a newly confirmed payment shows up
  // without a manual refresh.
  useEffect(() => {
    if (!merchant) return;
    const timer = setInterval(async () => {
      try {
        const data = await fetchData(range);
        setBreakdown(data?.breakdown ?? emptyBreakdown);
        setBreakdownError(null);
      } catch (error) {
        setBreakdownError(
          error instanceof Error
            ? error.message
            : "Could not refresh the breakdown.",
        );
      }
    }, BREAKDOWN_POLL_MS);

    return () => clearInterval(timer);
  }, [fetchData, merchant, range]);

  return (
    <section aria-labelledby="analytics-heading" className="space-y-3 sm:space-y-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="analytics-heading" className="text-sm font-semibold text-neutral-200">
            Analytics
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            Verified payment volume and request status breakdown.
          </p>
        </div>

        <div
          role="group"
          aria-label="Chart range"
          className="rounded-xl border border-line bg-surface p-1"
        >
          {(["7d", "30d", "90d"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              aria-pressed={range === option}
              className={`min-h-11 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF] sm:min-h-0 ${
                range === option
                  ? "text-white"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
              style={{
                background:
                  range === option ? "rgba(153,69,255,0.12)" : "transparent",
              }}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3.5 sm:gap-4 md:grid-cols-2">
        <VolumeChart
          series={series}
          onRetry={() => void reload()}
          isLoading={chartStatus.kind === "loading"}
          error={chartError}
        />
        <StatusBreakdownCard
          breakdown={breakdown}
          onRetry={() => void reload()}
          isLoading={chartStatus.kind === "loading"}
          error={breakdownError}
        />
      </div>
    </section>
  );
}
