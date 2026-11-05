/**
 * DEMO DATA ONLY.
 *
 * Nothing in this module comes from Solana, Supabase or any merchant backend.
 * These records never had an on-chain transaction, so they must not be shown as
 * verified payments or as real revenue.
 *
 * The real connected-wallet balance is fetched separately from the Devnet RPC
 * (`src/lib/solana/balance.ts`) and is not part of this data.
 */

export type PaymentStatus = "paid" | "pending" | "expired" | "failed";

/**
 * A demo payment row.
 *
 * `verifiedOnChain` is pinned to `false` so a mock record can never be rendered
 * as a verified on-chain payment. A future verified record needs its own type
 * with a transaction signature and slot instead of being modelled as this one.
 */
export type DemoPaymentRecord = {
  id: string;
  payer: string;
  amountSol: string;
  date: string;
  status: PaymentStatus;
  verifiedOnChain: false;
};

export type OverviewStat = {
  id: string;
  label: string;
  value: string;
  unit?: string;
  hint: string;
};

export const MOCK_DATA_NOTICE =
  "Demo data — these payment records are illustrative, were not sent to Solana, and are not verified on-chain.";

export const MOCK_DATA_BANNER_TITLE = "Demo data in use";

/** Kept next to the notice so the real/live boundary is stated in one place. */
export const REAL_DATA_BOUNDARY =
  "The wallet balance in the top bar is read live from Solana Devnet and is not merchant revenue.";

export const mockOverviewStats: readonly OverviewStat[] = [
  {
    id: "total-received",
    label: "Total received",
    value: "48.72",
    unit: "SOL",
    hint: "Demo · last 30 days",
  },
  {
    id: "successful-payments",
    label: "Successful payments",
    value: "126",
    hint: "Demo · completed requests",
  },
  {
    id: "pending-payments",
    label: "Pending payments",
    value: "3",
    hint: "Demo · awaiting confirmation",
  },
  {
    id: "payment-requests",
    label: "Payment requests",
    value: "18",
    hint: "Demo · open requests",
  },
];

export const mockActivity: readonly DemoPaymentRecord[] = [
  {
    id: "PP-8421",
    payer: "Ada Nwosu",
    amountSol: "2.50",
    date: "Nov 4, 2026",
    status: "paid",
    verifiedOnChain: false,
  },
  {
    id: "PP-8420",
    payer: "Kwame Osei",
    amountSol: "0.75",
    date: "Nov 4, 2026",
    status: "pending",
    verifiedOnChain: false,
  },
  {
    id: "PP-8419",
    payer: "Lerato Mokoena",
    amountSol: "12.00",
    date: "Nov 3, 2026",
    status: "paid",
    verifiedOnChain: false,
  },
  {
    id: "PP-8418",
    payer: "Chidi Eze",
    amountSol: "4.20",
    date: "Nov 3, 2026",
    status: "expired",
    verifiedOnChain: false,
  },
  {
    id: "PP-8417",
    payer: "Fatima Sule",
    amountSol: "1.00",
    date: "Nov 2, 2026",
    status: "paid",
    verifiedOnChain: false,
  },
  {
    id: "PP-8416",
    payer: "Thabo Dlamini",
    amountSol: "0.20",
    date: "Nov 2, 2026",
    status: "failed",
    verifiedOnChain: false,
  },
  {
    id: "PP-8415",
    payer: "Amina Yusuf",
    amountSol: "6.40",
    date: "Nov 1, 2026",
    status: "paid",
    verifiedOnChain: false,
  },
  {
    id: "PP-8414",
    payer: "Nomsa Banda",
    amountSol: "3.15",
    date: "Oct 31, 2026",
    status: "paid",
    verifiedOnChain: false,
  },
];
