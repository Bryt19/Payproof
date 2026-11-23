import type { PaymentFailureKind } from "@/lib/solana/payment";

/**
 * Browser-side client for the payment-attempt endpoints.
 *
 * The attempt token is issued by the server before a wallet prompt and is the
 * only thing that lets the server record a rejection for that specific attempt.
 * The raw token is held in memory for one attempt only: it is never persisted,
 * logged, or reused, and the database consumes it exactly once.
 *
 * Every function is failure-tolerant on purpose. A payment must still be
 * possible when attempt tracking is unavailable; the only consequence is that a
 * wallet rejection is not counted.
 */

export type PaymentAttemptToken = {
  token: string;
  expiresAt: string;
};

export type WalletRejectionOutcome = {
  /** False when the request was no longer pending (e.g. already cancelled). */
  recorded: boolean;
  status: string | null;
  rejectionCount: number | null;
};

/**
 * Only a genuine wallet rejection counts. Closing the page, an RPC failure, a
 * successful submission or insufficient funds must never increment the counter.
 */
export function shouldRecordWalletRejection(kind: PaymentFailureKind): boolean {
  return kind === "rejected";
}

function attemptUrl(reference: string): string {
  return `/api/payment-requests/${encodeURIComponent(reference)}/attempt`;
}

function resultUrl(reference: string): string {
  return `/api/payment-requests/${encodeURIComponent(reference)}/attempt-result`;
}

export async function requestPaymentAttempt(
  reference: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PaymentAttemptToken | null> {
  try {
    const response = await fetchImpl(attemptUrl(reference), {
      method: "POST",
      cache: "no-store",
    });

    if (!response.ok) return null;

    const body = (await response.json().catch(() => null)) as {
      success?: unknown;
      attempt?: { token?: unknown; expiresAt?: unknown };
    } | null;

    if (body?.success !== true) return null;

    const token = body.attempt?.token;
    const expiresAt = body.attempt?.expiresAt;

    if (typeof token !== "string" || token.length === 0) return null;

    return {
      token,
      expiresAt: typeof expiresAt === "string" ? expiresAt : "",
    };
  } catch {
    return null;
  }
}

export async function recordWalletRejection(
  reference: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WalletRejectionOutcome | null> {
  try {
    const response = await fetchImpl(resultUrl(reference), {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ token }),
    });

    if (!response.ok) return null;

    const body = (await response.json().catch(() => null)) as {
      success?: unknown;
      recorded?: unknown;
      paymentRequest?: {
        status?: unknown;
        rejectionCount?: unknown;
      };
    } | null;

    if (body?.success !== true) return null;

    const status =
      typeof body.paymentRequest?.status === "string"
        ? body.paymentRequest.status
        : null;
    const rejectionCount =
      typeof body.paymentRequest?.rejectionCount === "number"
        ? body.paymentRequest.rejectionCount
        : null;

    return {
      recorded: body.recorded !== false,
      status,
      rejectionCount,
    };
  } catch {
    return null;
  }
}
