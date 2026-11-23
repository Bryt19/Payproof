import { formatSolExact } from "@/lib/solana/units";
import { parseDraftReview, type DraftReview } from "./draft-review";

/**
 * Client-safe parsing for execute/re-authorize responses.
 *
 * These helpers never create a success state on malformed or failed payloads.
 * They also never sign, verify or modify a draft token.
 */

export type CreatedPaymentRequestSummary = {
  id: string;
  reference: string;
  amountLamports: string;
  amountSol: string;
  description: string;
  merchantAddress: string | null;
  status: string;
  createdAt: string;
};

export type DraftApprovalSuccess = {
  ok: true;
  request: CreatedPaymentRequestSummary;
  checkoutUrl: string;
  alreadyCreated: boolean;
};

export type DraftApprovalFailure = {
  ok: false;
  code: string;
  message: string;
};

export type DraftApprovalResult = DraftApprovalSuccess | DraftApprovalFailure;

export type ReauthorizeResult =
  | { ok: true; review: DraftReview }
  | DraftApprovalFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function parseRequest(value: unknown): CreatedPaymentRequestSummary | null {
  if (!isRecord(value)) return null;

  const id = readText(value.id);
  const reference = readText(value.reference);
  const amountLamports = readText(value.amountLamports);
  const description = readText(value.description);
  const status = readText(value.status);
  const createdAt = readText(value.createdAt);

  if (
    !id ||
    !reference ||
    !amountLamports ||
    !/^\d+$/.test(amountLamports) ||
    !description ||
    !status ||
    !createdAt
  ) {
    return null;
  }

  const merchantAddress =
    typeof value.merchantAddress === "string" ? value.merchantAddress : null;

  return {
    id,
    reference,
    amountLamports,
    amountSol: formatSolExact(BigInt(amountLamports)),
    description,
    merchantAddress,
    status,
    createdAt,
  };
}

function readError(payload: unknown, fallback: string): DraftApprovalFailure {
  if (isRecord(payload)) {
    const message = readText(payload.error) ?? readText(payload.message);
    const code = readText(payload.code) ?? "request_failed";
    if (message) return { ok: false, code, message };
  }

  return { ok: false, code: "request_failed", message: fallback };
}

export function parseReauthorizeResponse(
  payload: unknown,
): ReauthorizeResult {
  if (!isRecord(payload)) {
    return {
      ok: false,
      code: "malformed_response",
      message: "The server returned an unexpected authorization response.",
    };
  }

  const review = parseDraftReview(payload);

  if (!review) {
    return readError(
      payload,
      "The server returned an unexpected authorization response.",
    );
  }

  return { ok: true, review };
}

export function parseExecutionResponse(
  payload: unknown,
): DraftApprovalResult {
  if (!isRecord(payload)) {
    return {
      ok: false,
      code: "malformed_response",
      message: "The server returned an unexpected creation response.",
    };
  }

  if (payload.status !== "created" && payload.status !== "already_created") {
    return readError(payload, "The payment request could not be created.");
  }

  const request = parseRequest(payload.request);
  const checkoutUrl = readText(payload.checkoutUrl);

  if (!request || !checkoutUrl) {
    return {
      ok: false,
      code: "malformed_response",
      message:
        "The payment request was created but the response was incomplete. Check the dashboard before retrying.",
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(checkoutUrl);
  } catch {
    return {
      ok: false,
      code: "malformed_response",
      message: "The server returned an invalid checkout link.",
    };
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return {
      ok: false,
      code: "malformed_response",
      message: "The server returned an invalid checkout link.",
    };
  }

  return {
    ok: true,
    request,
    checkoutUrl: parsedUrl.toString(),
    alreadyCreated: payload.alreadyCreated === true,
  };
}

/** Error codes after which retrying the same authorization cannot succeed. */
export const TERMINAL_APPROVAL_CODES: ReadonlySet<string> = new Set([
  "expired_authorization",
  "authorization_revoked",
  "unknown_authorization",
  "authorization_mismatch",
  "invalid_authorization",
]);

export type DraftCancelResult = { ok: true } | DraftApprovalFailure;

/**
 * Client-safe parsing for the cancellation response.
 *
 * Only an explicit `status: "cancelled"` counts as success, so a consumed or
 * in-flight authorization can never be shown as a successful cancellation.
 */
export function parseCancelResponse(payload: unknown): DraftCancelResult {
  if (isRecord(payload) && payload.status === "cancelled") {
    return { ok: true };
  }

  return readError(payload, "The draft could not be cancelled.");
}
