import {
  validatePaymentRequestForm,
  type PaymentRequestFieldErrors,
} from "@/lib/payment-requests/validation";
import { formatSolExact } from "@/lib/solana/units";
import type { PaymentRequestDraft } from "./payment-draft";

/**
 * Client-side state and parsing for AI-prepared payment-request drafts.
 *
 * This module never signs, verifies, alters or persists a draft token. It only
 * interprets the Stage 1 response, keeps local review state, and makes it
 * explicit when edited values no longer match the server-signed authorization.
 */

export type DraftEditableFields = {
  amount: string;
  description: string;
  customerName: string;
  customerEmail: string;
};

export type DraftReview = {
  /** Current values shown in the review card. */
  draft: PaymentRequestDraft;
  /** Server-prepared values the token is cryptographically bound to. */
  originalDraft: PaymentRequestDraft;
  /** Opaque Stage 1 token. Never modified in the browser. */
  draftToken: string;
  expiresAt: string;
  cancelled: boolean;
};

export type DraftReviewStatus = "active" | "edited" | "expired" | "cancelled";

export type DraftStatusTone = "pending" | "warning" | "expired" | "muted";

export type DraftCardModel = {
  heading: string;
  draft: PaymentRequestDraft;
  merchantWallet: string | null;
  statusLabel: "Pending Approval" | "Needs re-authorization" | "Expired" | "Cancelled";
  statusTone: DraftStatusTone;
  countdownLabel: string;
  notice: string;
  canApprove: boolean;
  canEdit: boolean;
};

export type ParsedDraftResponse =
  | { kind: "draft"; review: DraftReview }
  | { kind: "clarification"; message: string; missing: string[] }
  | { kind: "unsupported_currency"; message: string; currency: string }
  | { kind: "invalid"; message: string; errors: Array<{ field: string; message: string }> }
  | { kind: "error"; message: string }
  | { kind: "malformed" };

export const DRAFT_CARD_HEADING = "Payment Request Preview";

export const DRAFT_APPROVAL_NOT_CONNECTED =
  "Approval is not enabled yet. No payment request will be created until server-side authorization is connected.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function parseDraft(value: unknown): PaymentRequestDraft | null {
  if (!isRecord(value)) return null;

  const amountLamports = value.amountLamports;
  const amountSol = value.amountSol;
  const description = value.description;
  const customerName = value.customerName;
  const customerEmail = value.customerEmail;

  if (typeof amountLamports !== "string" || !/^\d+$/.test(amountLamports)) {
    return null;
  }

  if (BigInt(amountLamports) <= 0n) return null;

  if (typeof amountSol !== "string" || amountSol.length === 0) return null;

  // The displayed amount must agree with the exact lamport value. A mismatch
  // would make the review card misleading, so treat it as malformed.
  if (amountSol !== formatSolExact(BigInt(amountLamports))) return null;

  if (typeof description !== "string" || description.trim().length === 0) {
    return null;
  }

  if (customerName !== null && typeof customerName !== "string") return null;
  if (customerEmail !== null && typeof customerEmail !== "string") return null;

  return {
    amountLamports,
    amountSol,
    description,
    customerName,
    customerEmail,
  };
}

/**
 * Validates the envelope of an `awaiting_confirmation` response. A missing or
 * malformed token/expiry/draft produces no review state at all.
 */
export function parseDraftReview(payload: unknown): DraftReview | null {
  if (!isRecord(payload)) return null;
  if (payload.status !== "awaiting_confirmation") return null;

  const draft = parseDraft(payload.draft);
  const draftToken = readText(payload.draftToken);
  const expiresAt = readText(payload.expiresAt);

  if (!draft || !draftToken || !expiresAt) return null;

  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isNaN(expiresAtMs)) return null;

  // Expiry is never extended in the browser; a token that is already expired
  // still parses so the card can show an explicit Expired state.
  return {
    draft: { ...draft },
    originalDraft: { ...draft },
    draftToken,
    expiresAt: new Date(expiresAtMs).toISOString(),
    cancelled: false,
  };
}

function defaultClarificationMessage(): string {
  return "Could you share the missing payment request details?";
}

/**
 * Parses any structured Stage 1 response. Ordinary clarification and error
 * responses are surfaced as normal assistant text, never as a review card.
 */
export function parseDraftPreparationResponse(
  payload: unknown,
): ParsedDraftResponse {
  if (!isRecord(payload)) return { kind: "malformed" };

  const status = payload.status;

  if (status === "awaiting_confirmation") {
    const review = parseDraftReview(payload);
    return review ? { kind: "draft", review } : { kind: "malformed" };
  }

  if (status === "clarification") {
    return {
      kind: "clarification",
      message: readText(payload.message) ?? defaultClarificationMessage(),
      missing: Array.isArray(payload.missing)
        ? payload.missing.filter((item): item is string => typeof item === "string")
        : [],
    };
  }

  if (status === "unsupported_currency") {
    return {
      kind: "unsupported_currency",
      currency:
        typeof payload.currency === "string" ? payload.currency.toUpperCase() : "SOL",
      message:
        readText(payload.message) ??
        "PayProof payment requests currently support SOL only. Please provide the amount in SOL.",
    };
  }

  if (status === "invalid") {
    return {
      kind: "invalid",
      message:
        readText(payload.message) ??
        "The payment request draft could not be validated.",
      errors: Array.isArray(payload.errors)
        ? payload.errors.flatMap((entry) => {
            if (!isRecord(entry)) return [];
            const message = readText(entry.message);
            if (!message) return [];
            return [
              {
                field: typeof entry.field === "string" ? entry.field : "draft",
                message,
              },
            ];
          })
        : [],
    };
  }

  if (status === "error") {
    return {
      kind: "error",
      message:
        readText(payload.error) ??
        readText(payload.message) ??
        "The AI assistant could not prepare a draft.",
    };
  }

  return { kind: "malformed" };
}

export function toEditableDraft(draft: PaymentRequestDraft): DraftEditableFields {
  return {
    amount: draft.amountSol,
    description: draft.description,
    customerName: draft.customerName ?? "",
    customerEmail: draft.customerEmail ?? "",
  };
}

export function isDraftEdited(review: DraftReview): boolean {
  return (
    review.draft.amountLamports !== review.originalDraft.amountLamports ||
    review.draft.description !== review.originalDraft.description ||
    (review.draft.customerName ?? null) !==
      (review.originalDraft.customerName ?? null) ||
    (review.draft.customerEmail ?? null) !==
      (review.originalDraft.customerEmail ?? null)
  );
}

export function applyDraftEdits(
  review: DraftReview,
  values: DraftEditableFields,
):
  | { ok: true; review: DraftReview }
  | { ok: false; errors: PaymentRequestFieldErrors } {
  const validated = validatePaymentRequestForm({
    amount: values.amount,
    description: values.description,
    customerName: values.customerName,
    customerEmail: values.customerEmail,
  });

  if (!validated.ok) {
    return { ok: false, errors: validated.errors };
  }

  const nextDraft: PaymentRequestDraft = {
    amountLamports: validated.value.amountLamports,
    amountSol: formatSolExact(BigInt(validated.value.amountLamports)),
    description: validated.value.description,
    customerName: validated.value.customerName,
    customerEmail: validated.value.customerEmail,
  };

  // The token is deliberately untouched. If the values differ from the ones
  // the server signed, the token simply stops being usable for approval.
  return {
    ok: true,
    review: { ...review, draft: nextDraft },
  };
}

export function cancelDraftReview(review: DraftReview): DraftReview {
  return { ...review, cancelled: true };
}

export function getDraftReviewStatus(
  review: DraftReview,
  now: number,
): DraftReviewStatus {
  if (review.cancelled) return "cancelled";
  if (Date.parse(review.expiresAt) <= now) return "expired";
  if (isDraftEdited(review)) return "edited";
  return "active";
}

export function getDraftRemainingMs(review: DraftReview, now: number): number {
  return Math.max(0, Date.parse(review.expiresAt) - now);
}

export function formatDraftCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function canApproveDraft(review: DraftReview, now: number): boolean {
  return getDraftReviewStatus(review, now) === "active";
}

export function canEditDraft(review: DraftReview, now: number): boolean {
  const status = getDraftReviewStatus(review, now);
  return status === "active" || status === "edited";
}

export function buildDraftCardModel(
  review: DraftReview,
  merchantWallet: string | null,
  now: number,
): DraftCardModel {
  const status = getDraftReviewStatus(review, now);
  const remainingMs = getDraftRemainingMs(review, now);

  const statusLabel: DraftCardModel["statusLabel"] =
    status === "expired"
      ? "Expired"
      : status === "edited"
        ? "Needs re-authorization"
        : status === "cancelled"
          ? "Cancelled"
          : "Pending Approval";

  const statusTone: DraftStatusTone =
    status === "expired"
      ? "expired"
      : status === "edited"
        ? "warning"
        : status === "cancelled"
          ? "muted"
          : "pending";

  const notice =
    status === "expired"
      ? "This draft has expired. Ask PayProof AI to prepare it again — expiration cannot be extended here."
      : status === "edited"
        ? "These values were edited locally. The original server authorization no longer covers them, so this draft must be re-signed before approval."
        : status === "cancelled"
          ? "Draft cancelled. Nothing was saved."
          : "Nothing has been created yet. Review the details before approving.";

  return {
    heading: DRAFT_CARD_HEADING,
    draft: review.draft,
    merchantWallet,
    statusLabel,
    statusTone,
    countdownLabel:
      status === "expired" ? "Expired" : `Expires in ${formatDraftCountdown(remainingMs)}`,
    notice,
    canApprove: status === "active",
    canEdit: status === "active" || status === "edited",
  };
}

function isExplanationOrQuestion(text: string): boolean {
  return (
    /\bhow (do|can|should|would) i\b/.test(text) ||
    /\bhow to\b/.test(text) ||
    /\bexplain\b/.test(text) ||
    /^(tell me how|show me how|walk me through|describe how)\b/.test(text) ||
    /\bwhat (is|are)\b/.test(text) ||
    /\bdifference between\b/.test(text)
  );
}

/**
 * Routes only clear action requests to the draft endpoint. Questions about how
 * to create a request, general chat and explanations stay on the normal chat
 * path.
 */
export function looksLikePaymentRequestAction(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text) return false;
  if (isExplanationOrQuestion(text)) return false;

  const action = /\b(create|make|prepare|draft|raise|generate|send)\b/.test(text);
  const target = /\b(payment request|payment requests|payment link)\b/.test(text);

  return action && target;
}

/**
 * Decides which endpoint the next message belongs to. A previous draft
 * clarification may be answered with just "0.5" or a description, so those
 * replies continue the draft flow — but greetings and questions still go to
 * normal chat.
 */
export function shouldPreparePaymentDraft(
  message: string,
  pendingMissingFields: readonly string[] = [],
): boolean {
  if (looksLikePaymentRequestAction(message)) return true;
  if (pendingMissingFields.length === 0) return false;

  const text = message.trim().toLowerCase();
  if (!text) return false;
  if (isExplanationOrQuestion(text)) return false;
  if (/^(hi|hello|hey|thanks|thank you)\b/.test(text)) return false;

  const hasDetailSignal = /\d|\bsol\b|@|\bfor\b/.test(text);
  if (text.endsWith("?") && !hasDetailSignal) return false;

  return true;
}
