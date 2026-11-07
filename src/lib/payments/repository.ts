import type { PostgrestError } from "@supabase/supabase-js";
import {
  createSupabaseClient,
  mapPaymentRequestRow,
  SUPABASE_TABLE,
} from "../payment-requests/supabase";
import type { PaymentRequest } from "../payment-requests/types";

/**
 * Server-side data access for payments.
 *
 * Provides filtered, searched, and sorted views of payment records from
 * Supabase. All operations use the service-role key on the server and never
 * trust frontend-supplied status values.
 */

/**
 * `failed` groups the expired and cancelled statuses into the single bucket the
 * payments filter exposes.
 */
export type PaymentFilterStatus =
  | "all"
  | "pending"
  | "paid"
  | "expired"
  | "cancelled"
  | "failed";

export type PaymentSortField = "created_at" | "amount_lamports" | "reference";
export type PaymentSortDirection = "asc" | "desc";

export type PaymentQueryParams = {
  search?: string;
  status?: PaymentFilterStatus;
  startDate?: string;
  endDate?: string;
  sortField?: PaymentSortField;
  sortDirection?: PaymentSortDirection;
  limit?: number;
  offset?: number;
};

export type PaymentsResult =
  | { ok: true; payments: readonly PaymentRequest[]; total: number }
  | { ok: false; message: string };

/**
 * Logs a database failure without exposing customer data or credentials.
 */
function logDatabaseFailure(operation: string, error: PostgrestError): void {
  console.error(
    `[payments] Supabase ${operation} failed: code=${error.code ?? "unknown"} message=${error.message} hint=${error.hint ?? "none"}`,
  );
}

export async function fetchPayments(
  params: PaymentQueryParams = {},
): Promise<PaymentsResult> {
  let supabase;
  try {
    supabase = createSupabaseClient();
  } catch (cause) {
    return {
      ok: false,
      message:
        "Payments are unavailable because the server is missing its Supabase configuration.",
    };
  }

  try {
    // Build the base query
    let query = supabase.from(SUPABASE_TABLE).select("*", { count: "exact" });

    // Apply status filter (default: all)
    if (params.status === "failed") {
      query = query.in("status", ["expired", "cancelled"]);
    } else if (params.status && params.status !== "all") {
      query = query.eq("status", params.status);
    }

    // Apply date filters
    if (params.startDate) {
      query = query.gte("created_at", params.startDate);
    }
    if (params.endDate) {
      query = query.lte("created_at", params.endDate);
    }

    // Apply search filter (reference or wallet address)
    if (params.search && params.search.trim().length > 0) {
      const searchTerm = params.search.trim();
      // Search by reference or wallet addresses
      query = query.or(`reference.ilike.%${searchTerm},merchant_address.ilike.%${searchTerm},payer_address.ilike.%${searchTerm}`);
    }

    // Apply sorting
    const sortField = params.sortField || "created_at";
    const sortDirection = params.sortDirection || "desc";
    query = query.order(sortField, { ascending: sortDirection === "asc" });

    // Apply pagination
    if (params.limit && params.limit > 0) {
      query = query.limit(params.limit);
    }
    if (params.offset && params.offset > 0) {
      query = query.range(params.offset, params.offset + (params.limit ?? 50) - 1);
    }

    const { data, error, count } = await query;

    if (error) {
      logDatabaseFailure("select", error);
      return {
        ok: false,
        message: "Could not load payments. Please try again.",
      };
    }

    const payments = (data ?? []).map(mapPaymentRequestRow);

    return {
      ok: true,
      payments,
      total: count ?? payments.length,
    };
  } catch (cause) {
    console.error(
      "[payments] Unexpected error fetching payments:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return {
      ok: false,
      message: "An unexpected error occurred while loading payments.",
    };
  }
}

export async function getPaymentByReference(
  reference: string,
): Promise<PaymentRequest | null | { error: string }> {
  let supabase;
  try {
    supabase = createSupabaseClient();
  } catch (cause) {
    return { error: "Payments are unavailable due to missing Supabase configuration." };
  }

  try {
    const { data, error } = await supabase
      .from(SUPABASE_TABLE)
      .select("*")
      .eq("reference", reference)
      .maybeSingle();

    if (error) {
      logDatabaseFailure("select-by-reference", error);
      return { error: "Could not load the payment details." };
    }

    if (!data) return null;

    return mapPaymentRequestRow(data);
  } catch (cause) {
    console.error(
      "[payments] Unexpected error fetching payment:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return { error: "An unexpected error occurred." };
  }
}
