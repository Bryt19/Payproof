/**
 * Parsers for the JSONB returned by the payment-attempt RPCs.
 *
 * The RPCs are the only source of truth for whether an attempt was actually
 * inserted or a rejection actually recorded. These helpers never infer
 * success from a truthy object: both RPCs return a JSONB error payload
 * (instead of a PostgreSQL error) for refusals, so `success === true` is the
 * only accepted signal.
 *
 * Shapes:
 *   record_attempt_issuance -> {
 *     success: true,
 *     attempt: { ... },
 *     rejection_count: number,
 *     status: string
 *   }
 *
 *   record_attempt_rejection -> {
 *     success: true,
 *     recorded: boolean,
 *     attempt: { ... },
 *     payment_request: { status: string, rejection_count: number, ... },
 *     rejection_count: number
 *   }
 */

/** Attempt tokens are valid for 15 minutes from issuance. */
export const ATTEMPT_TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * A request may receive a new payment attempt while pending, and again after
 * it has been marked failed so the customer can explicitly retry. Paid,
 * expired and cancelled requests stay closed.
 */
export function isAttemptIssuableStatus(
  status: string | null | undefined,
): boolean {
  return status === "pending" || status === "failed";
}

export type AttemptIssuanceResult =
  | {
      ok: true;
      /** Payment request status reported by the RPC (e.g. pending or failed). */
      status: string | null;
      rejectionCount: number | null;
      /** Stored attempt, present only when the insert committed. */
      attempt: Record<string, unknown>;
    }
  | { ok: false; reason: "refused" };

export type AttemptRejectionResult =
  | {
      ok: true;
      /**
       * False when the request was no longer pending: the attempt was
       * invalidated and no rejection was counted.
       */
      recorded: boolean;
      status: string | null;
      rejectionCount: number | null;
      attemptResult: string | null;
    }
  | { ok: false; reason: "refused" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

export function mapAttemptIssuanceResponse(
  data: unknown,
): AttemptIssuanceResult {
  if (!isRecord(data) || data.success !== true) {
    return { ok: false, reason: "refused" };
  }

  // Never hand out a token for an attempt the database did not persist.
  if (!isRecord(data.attempt)) {
    return { ok: false, reason: "refused" };
  }

  return {
    ok: true,
    status: asString(data.status),
    rejectionCount: asCount(data.rejection_count),
    attempt: data.attempt,
  };
}

export function mapAttemptRejectionResponse(
  data: unknown,
): AttemptRejectionResult {
  if (!isRecord(data) || data.success !== true) {
    return { ok: false, reason: "refused" };
  }

  const attempt = isRecord(data.attempt) ? data.attempt : null;
  const paymentRequest = isRecord(data.payment_request)
    ? data.payment_request
    : null;

  return {
    ok: true,
    // Older RPC versions do not send `recorded`; a success response from
    // them always recorded the rejection.
    recorded: data.recorded !== false,
    status:
      asString(paymentRequest?.status) ?? asString(data.status),
    rejectionCount:
      asCount(paymentRequest?.rejection_count) ??
      asCount(data.rejection_count),
    attemptResult:
      asString(attempt?.result) ?? asString(data.result),
  };
}
