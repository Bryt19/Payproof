import type { SupabaseClient } from "@supabase/supabase-js";
import { createPaymentRequestStatusNotification } from "../notifications/server";
import { createSupabaseClient, SUPABASE_TABLE } from "./supabase";
import type { PaymentRequestStatus } from "./types";

/**
 * Payment request expiration.
 *
 * Automatic expiration is **opt-in**: set `PAYMENT_REQUEST_TTL_HOURS` to a
 * positive number of hours to enable it. With no setting (the default) a
 * pending request never expires on its own, because a merchant invoice can
 * legitimately stay open for more than a day and silently closing it hides
 * live pending payments.
 *
 * When enabled, the schema has no `expires_at` column, so expiry is derived
 * from `created_at` and persisted lazily whenever a request is read or an
 * attempt is issued. There is no cron infrastructure in this project; lazy
 * processing is intentional and idempotent.
 *
 * Operational limitation: a request becomes `expired` in the database on the
 * first read at or after the cutoff, not exactly at the cutoff instant. Once a
 * read has occurred, every consumer (checkout, dashboard, payments, invoices,
 * attempts, verification) sees the persisted `expired` status.
 *
 * Only `pending` rows are expired. `paid`, `cancelled`, `failed` and an already
 * `expired` row are never touched, and the conditional update races safely with
 * on-chain verification (which also requires an unverified signature).
 */

/**
 * Configured lifetime in milliseconds. `0` disables automatic expiry.
 *
 * Read once at module load on the server. `PAYMENT_REQUEST_TTL_HOURS` is the
 * only switch; an absent or invalid value disables the feature.
 */
export const PAYMENT_REQUEST_TTL_MS = (() => {
  const raw = process.env.PAYMENT_REQUEST_TTL_HOURS?.trim();
  if (!raw) return 0;

  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) return 0;

  return Math.round(hours * 60 * 60 * 1000);
})();

function parseDate(value: string | Date | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

/** ISO timestamp at which a request created at `createdAt` expires. */
export function expiresAtFor(
  createdAt: string | Date | null | undefined,
  ttlMs: number = PAYMENT_REQUEST_TTL_MS,
): string | null {
  if (!(ttlMs > 0)) return null;

  const created = parseDate(createdAt);
  if (!created) return null;
  return new Date(created.getTime() + ttlMs).toISOString();
}

/** True only for a still-pending request that is past its lifetime. */
export function isRequestExpired(
  request: {
    status: PaymentRequestStatus | string | null | undefined;
    createdAt: string | Date | null | undefined;
  },
  now: number = Date.now(),
  ttlMs: number = PAYMENT_REQUEST_TTL_MS,
): boolean {
  if (!(ttlMs > 0)) return false;
  if (request.status !== "pending") return false;

  const created = parseDate(request.createdAt);
  if (!created) return false;

  return now - created.getTime() >= ttlMs;
}

/**
 * Values older than this cutoff are eligible for expiration, or `null` when
 * automatic expiry is disabled.
 */
export function expirationCutoff(
  now: number = Date.now(),
  ttlMs: number = PAYMENT_REQUEST_TTL_MS,
): string | null {
  if (!(ttlMs > 0)) return null;
  return new Date(now - ttlMs).toISOString();
}

type ExpiredRow = {
  id: string;
  reference: string;
  merchant_address: string | null;
};

/**
 * Persists `expired` for stale pending requests and emits the existing
 * expiration notification. Returns the number of rows transitioned.
 *
 * Safe to call repeatedly: the status predicate means a second call matches
 * nothing, and notification uniqueness is enforced by the notifications table.
 */
export async function expireStalePaymentRequests(options: {
  supabase?: SupabaseClient;
  merchantAddress?: string | null;
  reference?: string | null;
  now?: number;
} = {}): Promise<number> {
  let supabase: SupabaseClient;

  try {
    supabase = options.supabase ?? createSupabaseClient();
  } catch {
    return 0;
  }

  // Opt-in: with no configured lifetime, pending requests stay pending.
  const cutoff = expirationCutoff(options.now);
  if (cutoff === null) return 0;

  try {
    let query = supabase
      .from(SUPABASE_TABLE)
      .update({ status: "expired" })
      .eq("status", "pending")
      .is("transaction_signature", null)
      .lt("created_at", cutoff)
      .select("id, reference, merchant_address");

    const merchant =
      typeof options.merchantAddress === "string"
        ? options.merchantAddress.trim()
        : "";
    if (merchant.length > 0) {
      query = query.eq("merchant_address", merchant);
    }

    const reference =
      typeof options.reference === "string" ? options.reference.trim() : "";
    if (reference.length > 0) {
      query = query.eq("reference", reference);
    }

    const { data, error } = await query;

    if (error) {
      console.error(
        "[expiration] update failed:",
        error.message,
        "code:",
        error.code,
      );
      return 0;
    }

    const rows = (data ?? []) as ExpiredRow[];

    for (const row of rows) {
      const merchantAddress =
        typeof row.merchant_address === "string"
          ? row.merchant_address.trim()
          : "";
      if (!merchantAddress) continue;

      // Best-effort and preference-aware; never affects the status transition.
      await createPaymentRequestStatusNotification({
        merchantAddress,
        paymentRequestId: row.id,
        paymentRequestReference: row.reference,
        status: "expired",
      });
    }

    return rows.length;
  } catch (cause) {
    console.error(
      "[expiration] unexpected failure:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return 0;
  }
}
