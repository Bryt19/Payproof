import {
  MOCK_DATA_NOTICE,
  mockActivity,
  mockOverviewStats,
  type DemoPaymentRecord,
  type OverviewStat,
} from "./mock-data";

export type { DemoPaymentRecord, OverviewStat, PaymentStatus } from "./mock-data";

export type DashboardMode = "demo" | "live";

export type DashboardData = {
  mode: DashboardMode;
  notice: string;
  stats: readonly OverviewStat[];
  activity: readonly DemoPaymentRecord[];
};

/**
 * Single data-access point for the dashboard.
 *
 * The page only depends on this function, so replacing demo records with a
 * Supabase (or other backend) query means changing the body here — the stat
 * cards, table and shell stay untouched.
 *
 * When real records arrive they must not reuse {@link DemoPaymentRecord}: a
 * verified payment should expose its own type with the transaction signature
 * and slot, so demo rows and verified on-chain results can never be mixed or
 * mistaken for each other.
 */
export async function getDashboardData(): Promise<DashboardData> {
  return {
    mode: "demo",
    notice: MOCK_DATA_NOTICE,
    stats: mockOverviewStats,
    activity: mockActivity,
  };
}
