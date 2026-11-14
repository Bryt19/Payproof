import DashboardShell from "@/components/dashboard/dashboard-shell";

/** Route-level loading UI while the server reads Supabase. */
export default function Loading() {
  return (
    <DashboardShell
      title="Overview"
      description="Payment activity and settlement health on Solana Devnet."
    >
      <div
        className="flex flex-col items-center justify-center gap-4 py-24"
        aria-busy="true"
        aria-label="Loading dashboard data"
      >
        <span className="payproof-spinner" aria-hidden="true" />
        <p className="text-xs text-muted">Loading dashboard data…</p>
      </div>
    </DashboardShell>
  );
}
