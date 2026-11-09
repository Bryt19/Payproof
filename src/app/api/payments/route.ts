import { NextRequest, NextResponse } from "next/server";
import { fetchPayments, type PaymentFilterStatus, type PaymentSortField } from "@/lib/payments/repository";

export const dynamic = "force-dynamic";

/**
 * GET /api/payments
 *
 * Query parameters:
 * - search: Search by reference or wallet address
 * - status: Filter by status (all, pending, paid, expired, cancelled, failed)
 * - startDate: Filter from date (ISO 8601)
 * - endDate: Filter to date (ISO 8601)
 * - sortField: Field to sort by (created_at, amount_lamports, reference)
 * - sortDirection: Sort direction (asc, desc)
 * - limit: Maximum number of results (default 50, max 100)
 * - offset: Pagination offset (default 0)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const merchantAddress = searchParams.get("merchantAddress")?.trim() || undefined;
  const search = searchParams.get("search") || undefined;
  const statusParam = searchParams.get("status") || "all";
  const startDate = searchParams.get("startDate") || undefined;
  const endDate = searchParams.get("endDate") || undefined;
  const sortFieldParam = searchParams.get("sortField") || "created_at";
  const sortDirectionParam = searchParams.get("sortDirection") || "desc";
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");

  // Merchant console data is scoped to the connected wallet (client-provided).
  if (!merchantAddress) {
    return NextResponse.json(
      { payments: [], total: 0, limit: 50, offset: 0, hasMore: false },
      { status: 200 },
    );
  }

  // Validate status
  const validStatuses: PaymentFilterStatus[] = [
    "all",
    "pending",
    "paid",
    "expired",
    "cancelled",
    "failed",
  ];
  const status: PaymentFilterStatus =
    validStatuses.includes(statusParam as PaymentFilterStatus)
      ? (statusParam as PaymentFilterStatus)
      : "all";

  // Validate sort field
  const validSortFields: PaymentSortField[] = [
    "created_at",
    "amount_lamports",
    "reference",
  ];
  const sortField: PaymentSortField =
    validSortFields.includes(sortFieldParam as PaymentSortField)
      ? (sortFieldParam as PaymentSortField)
      : "created_at";

  // Validate sort direction
  const sortDirection = sortDirectionParam === "asc" ? "asc" : "desc";

  // Parse and validate pagination
  const limit =
    limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 100) : 50;
  const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;

  const result = await fetchPayments({
    merchantAddress,
    search: search || undefined,
    status,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    sortField,
    sortDirection,
    limit,
    offset,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, payments: [], total: 0 },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      payments: result.payments,
      total: result.total,
      limit,
      offset,
      hasMore: offset + result.payments.length < result.total,
    },
    { status: 200 },
  );
}
