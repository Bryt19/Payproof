import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { getDashboardData } from "@/lib/dashboard/dashboard-data";
import {
  buildVolumeSeriesFromRequests,
  buildStatusBreakdownFromRequests,
  type TimeRange,
  type VolumePoint,
} from "@/lib/dashboard/charts";
import DashboardShell from "@/components/dashboard/dashboard-shell";
import StatCard from "@/components/dashboard/stat-card";
import ActivitySection from "@/components/dashboard/activity-section";
import DashboardCharts from "@/components/dashboard/dashboard-charts";
import { QuickActionsCard } from "@/components/dashboard/quick-actions-card";
import CreateFab from "@/components/ui/create-fab";
import {
  ReceivedIcon,
  CheckedIcon,
  PendingIcon,
  RequestsStatIcon,
} from "@/components/dashboard/icons";
import type { DashboardStatId } from "@/lib/dashboard/summary";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const statIconMap: Record<DashboardStatId, ReactNode> = {
  "total-received": <ReceivedIcon className="size-4" />,
  "successful-payments": <CheckedIcon className="size-4" />,
  "pending-payments": <PendingIcon className="size-4" />,
  "payment-requests": <RequestsStatIcon className="size-4" />,
  "total-verified-payments": <CheckedIcon className="size-4" />,
  "total-sol-received": <ReceivedIcon className="size-4" />,
  "successful-transactions": <CheckedIcon className="size-4" />,
  "pending-transactions": <PendingIcon className="size-4" />,
  "failed-transactions": <PendingIcon className="size-4" />,
};

const DEFAULT_RANGE: TimeRange = "30d";

export default async function DashboardPage() {
  const result = await getDashboardData();

  const requests = result.ok ? result.requests : [];
  const initialSeries: readonly VolumePoint[] =
    buildVolumeSeriesFromRequests(requests, DEFAULT_RANGE);
  const initialBreakdown = buildStatusBreakdownFromRequests(requests);

  return (
    <DashboardShell
      title="Overview"
      description="Your Payproof merchant dashboard — live Solana payment data."
      showRefresh
    >
      <div className="space-y-6 pb-24 sm:pb-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-neutral-200">
              Dashboard overview
            </h2>
            <p className="mt-1 max-w-xl text-xs text-muted">
              Paid amounts only count after independent on-chain verification on
              Solana Devnet.
            </p>
          </div>
          <Link
            href="/payment-requests"
            className="btn-brand-gradient hidden min-h-11 items-center justify-center gap-2 rounded-3xl px-5 py-2.5 text-xs font-semibold text-white shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:inline-flex"
          >
            <svg
              className="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>New payment</span>
          </Link>
        </div>

        <CreateFab label="New payment" href="/payment-requests" />

        {!result.ok && (
          <div
            role="alert"
            className="rounded-xl border border-red-400/30 bg-red-400/10 px-5 py-6"
          >
            <h2 className="text-sm font-semibold text-red-100">
              Dashboard unavailable
            </h2>
            <p className="mt-1 max-w-xl text-sm text-red-200/80">
              {result.message}
            </p>
            <p className="mt-2 text-xs text-red-200/60">
              Check the server connection, then refresh.
            </p>
          </div>
        )}

        {result.ok && (
          <>
            <section aria-labelledby="stats-heading" className="space-y-4">
              <h2 id="stats-heading" className="sr-only">
                Key metrics
              </h2>
              <div className="kpi-grid grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
                {result.data.stats.map((stat) => (
                  <StatCard
                    key={stat.id}
                    stat={stat}
                    icon={statIconMap[stat.id]}
                  />
                ))}
              </div>
            </section>

            <DashboardCharts
              initialSeries={initialSeries}
              initialBreakdown={initialBreakdown}
              initialRange={DEFAULT_RANGE}
            />

            <div className="grid gap-6 xl:grid-cols-[1fr_280px]">
              <ActivitySection rows={result.data.activity} />
              <QuickActionsCard />
            </div>

            <p className="text-[11px] text-neutral-500">
              Payment volume reflects verified on-chain payments only. Pending,
              expired and cancelled requests are not included in the totals.
            </p>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
