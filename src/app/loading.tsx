import DashboardShell from "@/components/dashboard/dashboard-shell";

/** Route-level loading UI while the server reads Supabase. */
export default function Loading() {
  return (
    <DashboardShell
      title="Overview"
      description="Payment activity and settlement health on Solana Devnet."
    >
      <div
        className="space-y-6"
        aria-busy="true"
        aria-label="Loading dashboard data"
      >
        <section className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="h-4 w-32 animate-pulse rounded bg-surface-raised" />
              <div className="h-3 w-64 max-w-full animate-pulse rounded bg-surface-raised" />
            </div>
            <div className="h-8 w-20 animate-pulse rounded-lg bg-surface-raised" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="rounded-xl border border-line bg-surface p-5"
              >
                <div className="h-3 w-24 animate-pulse rounded bg-surface-raised" />
                <div
                  className="mt-4 h-7 w-28 animate-pulse rounded bg-surface-raised"
                  style={{ animationDelay: `${index * 80}ms` }}
                />
                <div className="mt-3 h-3 w-32 animate-pulse rounded bg-surface-raised" />
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="border-b border-line px-5 py-4">
                <div className="h-4 w-28 animate-pulse rounded bg-surface-raised" />
                <div className="mt-2 h-3 w-64 max-w-full animate-pulse rounded bg-surface-raised" />
              </div>
              <div className="divide-y divide-line">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-4 px-5 py-4"
                  >
                    <div className="h-3 flex-1 animate-pulse rounded bg-surface-raised" />
                    <div className="h-3 w-16 animate-pulse rounded bg-surface-raised" />
                    <div className="h-3 w-20 animate-pulse rounded bg-surface-raised" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="h-48 animate-pulse rounded-xl border border-line bg-surface" />
            <div className="h-40 animate-pulse rounded-xl border border-line bg-surface" />
          </div>
        </div>

        <p className="sr-only" role="status">
          Loading dashboard data
        </p>
      </div>
    </DashboardShell>
  );
}
