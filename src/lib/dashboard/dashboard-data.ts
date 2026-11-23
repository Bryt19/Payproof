import {
  createPaymentRequestRepository,
  describeRepositoryInitializationFailure,
} from "../payment-requests/repository";
import type { PaymentRequest } from "../payment-requests/types";
import { buildDashboardSummary, type DashboardSummary } from "./summary";

/**
 * Server-only dashboard data access.
 *
 * Reads through the existing Supabase repository, which uses the service-role
 * key on the server. There is deliberately no mock or empty-data fallback: a
 * failure is returned as an explicit error so the UI never presents fake
 * activity as merchant revenue.
 */

export type DashboardResult =
  | {
      ok: true;
      data: DashboardSummary;
      /** Full rows behind the summary, used to build chart series. */
      requests: readonly PaymentRequest[];
    }
  | { ok: false; message: string };

export async function getDashboardData(
  merchantAddress?: string | null,
): Promise<DashboardResult> {
  let repo;

  try {
    repo = createPaymentRequestRepository();
  } catch (cause) {
    return {
      ok: false,
      message: describeRepositoryInitializationFailure(cause),
    };
  }

  const merchant =
    typeof merchantAddress === "string" ? merchantAddress.trim() : "";

  // Merchant console data is scoped to the connected wallet (client-provided;
  // not verified server-side ownership). Never return all merchants' data.
  if (merchant.length === 0) {
    return { ok: true, data: buildDashboardSummary([]), requests: [] };
  }

  try {
    // Read the full list and an explicit `status = 'pending'` query in
    // parallel. The pending query guarantees open requests are included even
    // if a future filter, limit or ordering on the broad list would drop them.
    const [allResult, pendingResult] = await Promise.all([
      repo.list(merchant),
      repo.listPending(merchant),
    ]);

    if ("type" in allResult) {
      return { ok: false, message: allResult.message };
    }

    if ("type" in pendingResult) {
      return { ok: false, message: pendingResult.message };
    }

    const knownIds = new Set(allResult.map((request) => request.id));
    const requests = [
      ...pendingResult.filter((request) => !knownIds.has(request.id)),
      ...allResult,
    ];

    return { ok: true, data: buildDashboardSummary(requests), requests };
  } catch (cause) {
    // Never log row data or credentials, only the failure message.
    console.error(
      "[dashboard] Could not load payment requests from Supabase:",
      cause instanceof Error ? cause.message : "unknown error",
    );

    return {
      ok: false,
      message: "Could not load dashboard data. Please try again.",
    };
  }
}
