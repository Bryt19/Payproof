import { NextRequest, NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";
import {
  createSupabaseClient,
  mapPaymentRequestRow,
  SUPABASE_TABLE,
  SupabaseConfigurationError,
} from "@/lib/payment-requests/supabase";
import type { Invoice, InvoiceSortDirection, InvoiceSortField, InvoiceStatus } from "@/lib/invoices/types";

/**
 * GET /api/invoices
 *
 * Returns payment requests represented as invoices for the Invoices UI.
 * Data comes from the existing Supabase `payment_requests` table (server-side
 * service-role access). There is no mock/fallback data.
 *
 * Query parameters:
 * - search: reference or customer name (case-insensitive)
 * - status: all | pending | paid | expired | cancelled
 * - sortField: created_at | amount_lamports | reference
 * - sortDirection: asc | desc
 * - limit: default 50, max 100
 * - offset: default 0
 */
export const dynamic = "force-dynamic";

const VALID_STATUSES: readonly InvoiceStatus[] = [
  "pending",
  "paid",
  "expired",
  "cancelled",
];

const VALID_SORT_FIELDS: readonly InvoiceSortField[] = [
  "created_at",
  "amount_lamports",
  "reference",
];

function logFailure(operation: string, error: PostgrestError): void {
  console.error(
    `[invoices] Supabase ${operation} failed: code=${error.code ?? "unknown"} message=${error.message} hint=${error.hint ?? "none"}`,
  );
}

function parseStatus(raw: string | null): InvoiceStatus | "all" {
  if (!raw || raw === "all") return "all";
  return VALID_STATUSES.includes(raw as InvoiceStatus)
    ? (raw as InvoiceStatus)
    : "all";
}

function parseSortField(raw: string | null): InvoiceSortField {
  if (!raw) return "created_at";
  // Back-compat with older UI params.
  if (raw === "issued_at") return "created_at";
  if (raw === "number") return "reference";
  if (raw === "amount") return "amount_lamports";
  return VALID_SORT_FIELDS.includes(raw as InvoiceSortField)
    ? (raw as InvoiceSortField)
    : "created_at";
}

function parseSortDirection(raw: string | null): InvoiceSortDirection {
  return raw === "asc" ? "asc" : "desc";
}

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function parseNonNegativeInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function toInvoice(row: ReturnType<typeof mapPaymentRequestRow>): Invoice {
  return {
    id: row.id,
    reference: row.reference,
    amountLamports: row.amountLamports,
    description: row.description,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    merchantAddress: row.merchantAddress,
    status: row.status,
    transactionSignature: row.transactionSignature,
    payerAddress: row.payerAddress,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
  };
}

function addLamports(total: bigint, lamports: string): bigint {
  try {
    if (!/^\d+$/.test(lamports)) return total;
    return total + BigInt(lamports);
  } catch {
    return total;
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const merchantAddress = params.get("merchantAddress")?.trim() || "";
  const search = params.get("search")?.trim() || undefined;
  const status = parseStatus(params.get("status"));
  const sortField = parseSortField(params.get("sortField"));
  const sortDirection = parseSortDirection(params.get("sortDirection"));
  const limit = Math.min(parsePositiveInt(params.get("limit"), 50), 100);
  const offset = parseNonNegativeInt(params.get("offset"), 0);

  // Merchant console data is scoped to the connected wallet (client-provided).
  if (merchantAddress.length === 0) {
    return NextResponse.json(
      {
        invoices: [],
        total: 0,
        limit,
        offset,
        hasMore: false,
        summary: { total: 0, paid: 0, pending: 0, totalPaidLamports: "0" },
      },
      { status: 200 },
    );
  }

  let supabase;
  try {
    supabase = createSupabaseClient();
  } catch (cause) {
    const message =
      cause instanceof SupabaseConfigurationError
        ? "Invoices are unavailable because the server is missing its Supabase configuration."
        : "Invoices are temporarily unavailable.";
    return NextResponse.json(
      {
        invoices: [],
        total: 0,
        limit,
        offset,
        hasMore: false,
        summary: { total: 0, paid: 0, pending: 0, totalPaidLamports: "0" },
        error: message,
      },
      { status: 503 },
    );
  }

  try {
    // Summary is calculated from this merchant's payment_requests (real records).
    // Total paid amount uses only verified paid records.
    const { data: summaryRows, error: summaryError } = await supabase
      .from(SUPABASE_TABLE)
      .select("status,amount_lamports")
      .eq("merchant_address", merchantAddress);

    if (summaryError) {
      logFailure("select-invoice-summary", summaryError);
    }

    let summaryTotal = 0;
    let summaryPaid = 0;
    let summaryPending = 0;
    let totalPaidLamports = 0n;
    for (const row of summaryRows ?? []) {
      summaryTotal += 1;
      if (row.status === "paid") {
        summaryPaid += 1;
        totalPaidLamports = addLamports(totalPaidLamports, String(row.amount_lamports ?? "0"));
      } else if (row.status === "pending") {
        summaryPending += 1;
      }
    }

    let query = supabase
      .from(SUPABASE_TABLE)
      .select("*", { count: "exact" })
      .eq("merchant_address", merchantAddress);

    if (status !== "all") {
      query = query.eq("status", status);
    }

    if (search) {
      // PostgREST `.or()` filter string; values are trimmed user input.
      const escaped = search.replace(/[%_,().]/g, (ch) => `\\${ch}`);
      query = query.or(
        `reference.ilike.%${escaped}%,customer_name.ilike.%${escaped}%`,
      );
    }

    query = query.order(sortField, { ascending: sortDirection === "asc" });

    if (limit > 0) {
      query = query.range(offset, offset + limit - 1);
    }

    const { data, error, count } = await query;

    if (error) {
      logFailure("select-invoices", error);
      return NextResponse.json(
        {
          invoices: [],
          total: 0,
          limit,
          offset,
          hasMore: false,
          summary: {
            total: summaryTotal,
            paid: summaryPaid,
            pending: summaryPending,
            totalPaidLamports: totalPaidLamports.toString(),
          },
          error: "Could not load invoices. Please try again.",
        },
        { status: 503 },
      );
    }

    const invoices: Invoice[] = (data ?? []).map((row) => toInvoice(mapPaymentRequestRow(row)));
    const total = count ?? invoices.length;

    return NextResponse.json(
      {
        invoices,
        total,
        limit,
        offset,
        hasMore: offset + invoices.length < total,
        summary: {
          total: summaryTotal,
          paid: summaryPaid,
          pending: summaryPending,
          totalPaidLamports: totalPaidLamports.toString(),
        },
      },
      { status: 200 },
    );
  } catch (cause) {
    console.error(
      "[invoices] Unexpected error:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return NextResponse.json(
      {
        invoices: [],
        total: 0,
        limit,
        offset,
        hasMore: false,
        summary: { total: 0, paid: 0, pending: 0, totalPaidLamports: "0" },
        error: "An unexpected error occurred while loading invoices.",
      },
      { status: 503 },
    );
  }
}
