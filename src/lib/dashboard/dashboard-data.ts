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
    const result = await repo.list(merchant);

    if ("type" in result) {
      return { ok: false, message: result.message };
    }

    return { ok: true, data: buildDashboardSummary(result), requests: result };
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
