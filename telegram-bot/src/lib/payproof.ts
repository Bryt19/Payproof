import type { PostgrestError } from "@supabase/supabase-js";
import {
  createSupabaseClient,
  type ServerSupabaseClient,
} from "./payment-requests/supabase.js";

/**
 * Server-side PayProof data access for the Telegram bot.
 *
 * Every query is scoped to the merchant wallet resolved from the Telegram
 * account (`telegram_links`), never to a value supplied in a Telegram message.
 * Only the existing `payment_requests` table is used — there is no receipt
 * table, so a receipt is a payment request whose on-chain verification was
 * recorded by PayProof's server-side verifier.
 */

const PAYMENT_REQUESTS_TABLE = "payment_requests";
const DEFAULT_LIST_LIMIT = 5;
const MAX_LIST_LIMIT = 10;

const PAYMENT_COLUMNS = [
  "id",
  "reference",
  "amount_lamports",
  "description",
  "customer_name",
  "status",
  "transaction_signature",
  "payer_address",
  "verified_at",
  "created_at",
].join(",");

export type StoredPaymentStatus = "pending" | "paid" | "expired" | "cancelled";

export type StoredPayment = {
  id: string;
  reference: string;
  amountLamports: string;
  description: string;
  customerName: string | null;
  status: StoredPaymentStatus;
  transactionSignature: string | null;
  payerAddress: string | null;
  verifiedAt: string | null;
  createdAt: string;
};

export type PaymentSummary = {
  verifiedCount: number;
  verifiedLamports: bigint;
  pendingCount: number;
  failedCount: number;
};

export type DataResult<T> = { ok: true; data: T } | { ok: false };

export type UnlinkResult = DataResult<boolean>;

export type PayProofData = {
  getSummary(merchantAddress: string): Promise<DataResult<PaymentSummary>>;
  getRecentVerified(
    merchantAddress: string,
    limit?: number
  ): Promise<DataResult<readonly StoredPayment[]>>;
  getPending(
    merchantAddress: string,
    limit?: number
  ): Promise<DataResult<readonly StoredPayment[]>>;
  getVerifiedReceipt(
    merchantAddress: string,
    reference: string
  ): Promise<DataResult<StoredPayment | null>>;
};

const LAMPORTS_PER_SOL = 1_000_000_000n;
const PAYMENT_REFERENCE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidPaymentReference(value: string): boolean {
  return PAYMENT_REFERENCE_PATTERN.test(value);
}

/**
 * A payment is verified only when PayProof's server-side verifier recorded the
 * on-chain signature, the payer wallet and the verification timestamp. A `paid`
 * status alone is not enough evidence for revenue or a receipt.
 */
export function isVerifiedPayment(payment: {
  status: StoredPaymentStatus;
  transactionSignature: string | null;
  payerAddress: string | null;
  verifiedAt: string | null;
}): boolean {
  return (
    payment.status === "paid" &&
    payment.transactionSignature !== null &&
    payment.payerAddress !== null &&
    payment.verifiedAt !== null
  );
}

function toLamports(value: string): bigint {
  return /^\d+$/.test(value) ? BigInt(value) : 0n;
}

/** Exact SOL amount with trailing zeros trimmed (never float math). */
export function formatSolAmount(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = lamports % LAMPORTS_PER_SOL;

  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole}.${fraction.toString().padStart(9, "0").replace(/0+$/, "")}`;
}

export function summarizePayments(
  payments: readonly StoredPayment[]
): PaymentSummary {
  let verifiedCount = 0;
  let verifiedLamports = 0n;
  let pendingCount = 0;
  let failedCount = 0;

  for (const payment of payments) {
    if (isVerifiedPayment(payment)) {
      verifiedCount += 1;
      verifiedLamports += toLamports(payment.amountLamports);
    } else if (payment.status === "pending") {
      pendingCount += 1;
    } else if (
      payment.status === "expired" ||
      payment.status === "cancelled"
    ) {
      failedCount += 1;
    }
  }

  return { verifiedCount, verifiedLamports, pendingCount, failedCount };
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Unknown";
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString().slice(0, 10)
    : "Unknown";
}

function shorten(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function paymentAmountSol(payment: StoredPayment): string {
  return `${formatSolAmount(toLamports(payment.amountLamports))} SOL`;
}

export function buildSummaryText(
  merchantAddress: string,
  summary: PaymentSummary
): string {
  return `📊 Payment summary

Merchant wallet: ${merchantAddress}
Verified payments: ${summary.verifiedCount}
Verified revenue: ${formatSolAmount(summary.verifiedLamports)} SOL
Pending requests: ${summary.pendingCount}
Expired or cancelled: ${summary.failedCount}

Only payments independently verified on Solana are counted.`;
}

export function buildRecentTransactionsText(
  payments: readonly StoredPayment[]
): string {
  if (payments.length === 0) {
    return `🧾 Recent transactions

No verified payments yet. A payment appears here only after PayProof verifies it on Solana.`;
  }

  const lines = payments.map(
    (payment) =>
      `• ${paymentAmountSol(payment)} — ${shorten(payment.description, 60)}\n  Reference: ${payment.reference}\n  Verified: ${formatDate(payment.verifiedAt)}`
  );

  return `🧾 Recent transactions

${lines.join("\n\n")}`;
}

export function buildPendingPaymentsText(
  payments: readonly StoredPayment[]
): string {
  if (payments.length === 0) {
    return `⏳ Pending payments

No pending payment requests. New requests created in PayProof will appear here.`;
  }

  const lines = payments.map(
    (payment) =>
      `• ${paymentAmountSol(payment)} — ${shorten(payment.description, 60)}\n  Reference: ${payment.reference}\n  Created: ${formatDate(payment.createdAt)}`
  );

  return `⏳ Pending payments

${lines.join("\n\n")}`;
}

export function buildReceiptText(payment: StoredPayment): string {
  return `🧾 Payment receipt

Reference: ${payment.reference}
Amount: ${paymentAmountSol(payment)}
Description: ${shorten(payment.description, 120)}
Payer wallet: ${payment.payerAddress ?? "Unknown"}
Transaction signature: ${payment.transactionSignature ?? "Unknown"}
Verified at: ${payment.verifiedAt ?? "Unknown"}

Verified on Solana by PayProof.`;
}

function logFailure(operation: string, error: PostgrestError): void {
  console.error(
    `[payproof] Supabase ${operation} failed: code=${error.code ?? "unknown"} message=${error.message}`
  );
}

function normalizeStatus(raw: string): StoredPaymentStatus {
  return raw === "paid" ||
    raw === "expired" ||
    raw === "cancelled" ||
    raw === "pending"
    ? raw
    : "pending";
}

function mapRow(row: Record<string, unknown>): StoredPayment {
  return {
    id: String(row.id ?? ""),
    reference: String(row.reference ?? ""),
    amountLamports: String(row.amount_lamports ?? "0"),
    description: String(row.description ?? ""),
    customerName:
      typeof row.customer_name === "string" ? row.customer_name : null,
    status: normalizeStatus(String(row.status ?? "pending")),
    transactionSignature:
      typeof row.transaction_signature === "string"
        ? row.transaction_signature
        : null,
    payerAddress:
      typeof row.payer_address === "string" ? row.payer_address : null,
    verifiedAt:
      typeof row.verified_at === "string" ? row.verified_at : null,
    createdAt: String(row.created_at ?? ""),
  };
}

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 1) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(Math.floor(limit), MAX_LIST_LIMIT);
}

async function withClient<T>(
  operation: string,
  run: (supabase: ServerSupabaseClient) => Promise<DataResult<T>>
): Promise<DataResult<T>> {
  try {
    return await run(createSupabaseClient());
  } catch (cause) {
    console.error(
      `[payproof] ${operation} failed:`,
      cause instanceof Error ? cause.message : "unknown error"
    );
    return { ok: false };
  }
}

/**
 * Marks the active `telegram_links` row for a Telegram user as unlinked.
 *
 * This is a soft disconnect: `unlinked_at` is set, so merchant resolution and
 * every merchant-scoped query stop matching this chat. Payment requests and
 * merchant records are never touched. Returns whether an active row matched.
 */
export async function unlinkTelegramAccount(
  telegramUserId: number
): Promise<UnlinkResult> {
  return withClient("unlink", async (supabase): Promise<DataResult<boolean>> => {
    const { data, error } = await supabase
      .from("telegram_links")
      .update({ unlinked_at: new Date().toISOString() })
      .eq("telegram_user_id", telegramUserId)
      .is("unlinked_at", null)
      .select("id");

    if (error) {
      logFailure("unlink", error);
      return { ok: false };
    }

    const rows = (data as unknown as unknown[] | null) ?? [];
    return { ok: true, data: rows.length > 0 };
  });
}

export function createPayProofData(): PayProofData {
  return {
    async getSummary(merchantAddress) {
      return withClient(
        "summary",
        async (supabase): Promise<DataResult<PaymentSummary>> => {
        const { data, error } = await supabase
          .from(PAYMENT_REQUESTS_TABLE)
          .select(PAYMENT_COLUMNS)
          .eq("merchant_address", merchantAddress);

        if (error) {
          logFailure("select-summary", error);
          return { ok: false };
        }

        const rows =
          (data as unknown as Record<string, unknown>[] | null) ?? [];
        return {
          ok: true,
          data: summarizePayments(rows.map(mapRow)),
        };
      });
    },

    async getRecentVerified(merchantAddress, limit) {
      return withClient(
        "recent-transactions",
        async (supabase): Promise<DataResult<readonly StoredPayment[]>> => {
        const { data, error } = await supabase
          .from(PAYMENT_REQUESTS_TABLE)
          .select(PAYMENT_COLUMNS)
          .eq("merchant_address", merchantAddress)
          .eq("status", "paid")
          .not("transaction_signature", "is", null)
          .not("payer_address", "is", null)
          .not("verified_at", "is", null)
          .order("verified_at", { ascending: false })
          .limit(clampLimit(limit));

        if (error) {
          logFailure("select-recent", error);
          return { ok: false };
        }

        const rows =
          (data as unknown as Record<string, unknown>[] | null) ?? [];
        return { ok: true, data: rows.map(mapRow) };
      });
    },

    async getPending(merchantAddress, limit) {
      return withClient(
        "pending-payments",
        async (supabase): Promise<DataResult<readonly StoredPayment[]>> => {
        const { data, error } = await supabase
          .from(PAYMENT_REQUESTS_TABLE)
          .select(PAYMENT_COLUMNS)
          .eq("merchant_address", merchantAddress)
          .eq("status", "pending")
          .order("created_at", { ascending: true })
          .limit(clampLimit(limit));

        if (error) {
          logFailure("select-pending", error);
          return { ok: false };
        }

        const rows =
          (data as unknown as Record<string, unknown>[] | null) ?? [];
        return { ok: true, data: rows.map(mapRow) };
      });
    },

    async getVerifiedReceipt(merchantAddress, reference) {
      return withClient(
        "receipt",
        async (supabase): Promise<DataResult<StoredPayment | null>> => {
        // Scoped to both the reference and the linked merchant wallet, so a
        // receipt can never be read from another merchant's account.
        const { data, error } = await supabase
          .from(PAYMENT_REQUESTS_TABLE)
          .select(PAYMENT_COLUMNS)
          .eq("merchant_address", merchantAddress)
          .eq("reference", reference)
          .maybeSingle();

        if (error) {
          logFailure("select-receipt", error);
          return { ok: false };
        }

        if (!data) {
          return { ok: true, data: null };
        }

        const payment = mapRow(data as unknown as Record<string, unknown>);
        return { ok: true, data: isVerifiedPayment(payment) ? payment : null };
      });
    },
  };
}
