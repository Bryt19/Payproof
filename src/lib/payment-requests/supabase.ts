import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PaymentRequest } from "./types";

/**
 * Supabase data layer for payment requests.
 *
 * This module is imported only by server code (`src/app/api`, server actions,
 * server components and the repository). It must never be bundled for the
 * browser, because it reads the service-role key from server-only environment
 * variables.
 *
 * There is no fallback: when the configuration is missing, callers get a
 * {@link SupabaseConfigurationError} and must surface that as an error instead
 * of pretending the request was saved.
 */
export class SupabaseConfigurationError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      `Supabase is not configured: set ${missing.join(" and ")} on the server.`,
    );
    this.name = "SupabaseConfigurationError";
    this.missing = missing;
  }
}

export function createSupabaseClient(): SupabaseClient {
  // Read the environment on each call so a restarted or reconfigured server
  // process is never stuck with a stale value.
  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missing.length > 0 || !url || !serviceRoleKey) {
    throw new SupabaseConfigurationError(missing);
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

/**
 * Maps a Supabase row to the public {@link PaymentRequest} shape.
 *
 * `created_at` comes back as an ISO string from Supabase, so no conversion is
 * needed. Amounts are stored as integer strings on purpose.
 */
export function mapPaymentRequestRow(row: {
  id: string;
  reference: string;
  amount_lamports: string;
  description: string;
  customer_name: string | null;
  customer_email: string | null;
  merchant_address: string | null;
  status: string;
  transaction_signature: string | null;
  payer_address: string | null;
  verified_at: string | null;
  created_at: string;
}): PaymentRequest {
  return {
    id: row.id,
    reference: row.reference,
    amountLamports: row.amount_lamports,
    description: row.description,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    merchantAddress: row.merchant_address,
    status: row.status as PaymentRequest["status"],
    transactionSignature: row.transaction_signature ?? null,
    payerAddress: row.payer_address ?? null,
    verifiedAt: row.verified_at ?? null,
    createdAt: row.created_at,
  };
}

export const SUPABASE_TABLE = "payment_requests";
