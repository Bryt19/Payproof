"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PayproofLogo } from "@/components/landing/brand-logo";
import {
  applyDraftEdits,
  DRAFT_APPROVAL_NOT_CONNECTED,
  buildDraftCardModel,
  toEditableDraft,
  type DraftEditableFields,
  type DraftReview,
} from "@/lib/ai/draft-review";
import {
  TERMINAL_APPROVAL_CODES,
  type DraftApprovalFailure,
  type DraftApprovalResult,
  type DraftApprovalSuccess,
  type DraftCancelResult,
} from "@/lib/ai/draft-execution";
import type { PaymentRequestDraft } from "@/lib/ai/payment-draft";
import type { PaymentRequestFieldErrors } from "@/lib/payment-requests/validation";
import { useCopyFeedback } from "@/lib/use-copy-feedback";

const fieldClassName =
  "mt-1.5 min-h-11 w-full rounded-lg border border-white/[0.1] bg-black/40 px-3 py-2 text-base text-white placeholder:text-white/30 transition-colors focus:border-emerald-400/60 focus:outline-none focus:ring-1 focus:ring-emerald-400/30 sm:min-h-10 sm:text-sm";

const labelClassName =
  "text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45";

const statusPillClass: Record<string, string> = {
  pending: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  warning: "border-amber-400/25 bg-amber-400/10 text-amber-300",
  expired: "border-red-400/25 bg-red-400/10 text-red-300",
  muted: "border-white/10 bg-white/[0.04] text-white/50",
};

export type PaymentDraftApprovalInput = {
  draft: PaymentRequestDraft;
  draftToken: string;
};

export type PaymentDraftCardProps = {
  review: DraftReview;
  merchantWallet: string | null;
  onUpdate: (review: DraftReview) => void;
  /**
   * Revokes the draft authorization server-side. The card only shows the
   * cancelled state after this resolves with `ok: true`.
   */
  onCancel: () => Promise<DraftCancelResult>;
  /**
   * Performs server-side re-authorization (when edited) and execution. The
   * card only shows a created state from a successful server response.
   */
  onApprove?: (input: PaymentDraftApprovalInput) => Promise<DraftApprovalResult>;
};

function ExpiryLabel({ expiresAt }: { expiresAt: string }) {
  const formatted = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(expiresAt));

  return (
    <time dateTime={expiresAt} title={expiresAt}>
      {formatted}
    </time>
  );
}

export default function PaymentDraftCard({
  review,
  merchantWallet,
  onUpdate,
  onCancel,
  onApprove,
}: PaymentDraftCardProps) {
  const headingId = useId();
  const [now, setNow] = useState(() => Date.now());
  const [isEditing, setIsEditing] = useState(false);
  const [values, setValues] = useState<DraftEditableFields>(() =>
    toEditableDraft(review.draft),
  );
  const [errors, setErrors] = useState<PaymentRequestFieldErrors>({});
  const [approvalState, setApprovalState] = useState<
    "idle" | "loading" | "error" | "success"
  >("idle");
  const [approvalError, setApprovalError] =
    useState<DraftApprovalFailure | null>(null);
  const [approvalResult, setApprovalResult] =
    useState<DraftApprovalSuccess | null>(null);
  const [cancelState, setCancelState] = useState<"idle" | "loading">("idle");
  const [cancelError, setCancelError] = useState<DraftApprovalFailure | null>(
    null,
  );
  const { state: copyState, copy } = useCopyFeedback();
  // Guards against a second approval while the first request is in flight, even
  // if a click lands before React re-renders the disabled button. The database
  // remains the authoritative single-use guard.
  const approvalInFlight = useRef(false);
  // Same guard for cancellation: a second click must never issue a second
  // revoke request while the first is still resolving.
  const cancelInFlight = useRef(false);

  // The expiry is derived from the server-issued `expiresAt`; it is never
  // extended locally.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const model = buildDraftCardModel(review, merchantWallet, now);
  const { draft } = model;
  const isLoading = approvalState === "loading";
  const isCancelling = cancelState === "loading";
  const isBusy = isLoading || isCancelling;
  const approvalBlocked =
    approvalState === "error" &&
    approvalError !== null &&
    TERMINAL_APPROVAL_CODES.has(approvalError.code);

  if (review.cancelled) {
    return (
      <section
        aria-label="Cancelled payment request draft"
        className="w-full max-w-2xl rounded-xl border border-white/[0.08] bg-[#0E0E12] px-4 py-3"
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <PayproofLogo wordmarkClass="text-sm" />
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/50">
            Cancelled
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-white/55">
          Draft cancelled. Nothing was saved and no payment request was created.
        </p>
      </section>
    );
  }

  if (approvalState === "success" && approvalResult) {
    const { request } = approvalResult;

    return (
      <section
        aria-labelledby={`${headingId}-created`}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-emerald-400/20 bg-[#0E0E12] shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
      >
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] bg-emerald-400/[0.03] px-4 py-3">
          <PayproofLogo wordmarkClass="text-sm" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400" />
            Created
          </span>
        </header>

        <div className="space-y-4 px-4 py-4">
          <div>
            <h3
              id={`${headingId}-created`}
              className="text-sm font-semibold text-white"
            >
              Payment Request Created
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-white/45">
              {approvalResult.alreadyCreated
                ? "This approval was already completed. Showing the original payment request — no duplicate was created."
                : "The request is pending until a matching Solana Devnet payment is verified on-chain."}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/[0.07] bg-black/30 px-3.5 py-3">
              <p className={labelClassName}>Amount</p>
              <p className="mt-1 flex items-baseline gap-1.5 tabular-nums">
                <span className="text-xl font-semibold text-white">
                  {request.amountSol}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/80">
                  SOL
                </span>
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-black/30 px-3.5 py-3">
              <p className={labelClassName}>Request ID</p>
              <p className="mt-1 font-mono text-xs text-white/80">
                {request.id}
              </p>
            </div>
          </div>

          <dl className="space-y-3 text-xs">
            <div>
              <dt className={labelClassName}>Description</dt>
              <dd className="mt-1 break-words leading-relaxed text-white/85">
                {request.description}
              </dd>
            </div>
            <div>
              <dt className={labelClassName}>Reference</dt>
              <dd className="mt-1 break-all rounded-lg border border-white/[0.06] bg-black/40 p-2 font-mono text-[11px] text-emerald-200/80">
                {request.reference}
              </dd>
            </div>
          </dl>

          <div className="border-t border-white/[0.06] pt-3.5">
            <label htmlFor={`${headingId}-checkout`} className={labelClassName}>
              Checkout link
            </label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <input
                id={`${headingId}-checkout`}
                readOnly
                value={approvalResult.checkoutUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="min-h-11 w-full rounded-lg border border-white/[0.1] bg-black/40 px-3 font-mono text-xs text-white/90 focus:border-emerald-400/60 focus:outline-none"
              />
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => void copy(approvalResult.checkoutUrl)}
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 text-xs font-semibold text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white sm:flex-none"
                >
                  {copyState === "copied" ? "Copied" : "Copy link"}
                </button>
                <a
                  href={approvalResult.checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#14F195] px-3 text-xs font-semibold text-black transition-colors hover:bg-[#3AF0A9]"
                >
                  Open checkout
                </a>
              </div>
            </div>
            {copyState === "failed" && (
              <p role="status" className="mt-1 text-[11px] text-red-300">
                Copying is blocked by your browser — select the link and copy it
                manually.
              </p>
            )}
          </div>
        </div>
      </section>
    );
  }

  function beginEditing() {
    setValues(toEditableDraft(review.draft));
    setErrors({});
    setIsEditing(true);
  }

  function stopEditing() {
    setValues(toEditableDraft(review.draft));
    setErrors({});
    setIsEditing(false);
  }

  function saveEdits() {
    const result = applyDraftEdits(review, values);

    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    setErrors({});
    setIsEditing(false);
    onUpdate(result.review);
  }

  async function approve() {
    if (
      approvalInFlight.current ||
      !onApprove ||
      !model.canApprove ||
      isLoading ||
      isCancelling ||
      approvalBlocked
    ) {
      return;
    }

    approvalInFlight.current = true;
    setApprovalState("loading");
    setApprovalError(null);

    try {
      const result = await onApprove({
        draft: review.draft,
        draftToken: review.draftToken,
      });

      if (!result.ok) {
        setApprovalError(result);
        setApprovalState("error");
        return;
      }

      setApprovalResult(result);
      setApprovalState("success");
    } catch {
      setApprovalError({
        ok: false,
        code: "network_error",
        message:
          "The approval request could not be completed. Check your connection and try again.",
      });
      setApprovalState("error");
    } finally {
      approvalInFlight.current = false;
    }
  }

  async function cancel() {
    if (cancelInFlight.current || isLoading) {
      return;
    }

    cancelInFlight.current = true;
    setCancelState("loading");
    setCancelError(null);

    try {
      const result = await onCancel();

      if (!result.ok) {
        // The draft stays visible and actionable so the merchant can retry.
        setCancelError(result);
        return;
      }
      // On success the parent marks the review cancelled and this component
      // renders the cancelled summary.
    } catch {
      setCancelError({
        ok: false,
        code: "network_error",
        message:
          "The cancellation request could not be completed. Check your connection and try again.",
      });
    } finally {
      cancelInFlight.current = false;
      setCancelState("idle");
    }
  }

  const approveDisabled =
    !model.canApprove ||
    !onApprove ||
    isBusy ||
    approvalBlocked ||
    model.statusLabel !== "Pending Approval";

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={isBusy}
      className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0E0E12] shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] bg-white/[0.015] px-4 py-3">
        <PayproofLogo wordmarkClass="text-sm" />
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${statusPillClass[model.statusTone]}`}
        >
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${
              model.statusTone === "pending"
                ? "bg-emerald-400"
                : model.statusTone === "warning"
                  ? "bg-amber-400"
                  : model.statusTone === "expired"
                    ? "bg-red-400"
                    : "bg-white/40"
            }`}
          />
          {model.statusLabel}
        </span>
      </header>

      <div className="space-y-4 px-4 py-4">
        <div>
          <h3 id={headingId} className="text-sm font-semibold text-white">
            {model.heading}
          </h3>
          <p className="mt-1 text-xs text-white/45">
            Prepared by PayProof AI. Nothing has been created yet.
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-black/30 px-3.5 py-3">
          <p className={labelClassName}>Amount</p>
          <p className="mt-1 flex items-baseline gap-1.5 tabular-nums">
            <span className="text-2xl font-semibold tracking-tight text-white">
              {draft.amountSol}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300/80">
              SOL
            </span>
          </p>
        </div>

        {isEditing ? (
          <div className="space-y-3">
            <div>
              <label htmlFor={`${headingId}-amount`} className={labelClassName}>
                Amount (SOL)
              </label>
              <input
                id={`${headingId}-amount`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={values.amount}
                onChange={(event) =>
                  setValues((previous) => ({ ...previous, amount: event.target.value }))
                }
                aria-invalid={Boolean(errors.amount)}
                className={fieldClassName}
              />
              {errors.amount && (
                <p role="alert" className="mt-1 text-[11px] text-red-300">
                  {errors.amount}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={`${headingId}-description`} className={labelClassName}>
                Description
              </label>
              <textarea
                id={`${headingId}-description`}
                rows={2}
                value={values.description}
                onChange={(event) =>
                  setValues((previous) => ({
                    ...previous,
                    description: event.target.value,
                  }))
                }
                aria-invalid={Boolean(errors.description)}
                className={`${fieldClassName} resize-none`}
              />
              {errors.description && (
                <p role="alert" className="mt-1 text-[11px] text-red-300">
                  {errors.description}
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${headingId}-customer-name`} className={labelClassName}>
                  Customer name
                </label>
                <input
                  id={`${headingId}-customer-name`}
                  type="text"
                  autoComplete="off"
                  value={values.customerName}
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      customerName: event.target.value,
                    }))
                  }
                  aria-invalid={Boolean(errors.customerName)}
                  className={fieldClassName}
                />
                {errors.customerName && (
                  <p role="alert" className="mt-1 text-[11px] text-red-300">
                    {errors.customerName}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor={`${headingId}-customer-email`} className={labelClassName}>
                  Customer email
                </label>
                <input
                  id={`${headingId}-customer-email`}
                  type="email"
                  autoComplete="off"
                  value={values.customerEmail}
                  onChange={(event) =>
                    setValues((previous) => ({
                      ...previous,
                      customerEmail: event.target.value,
                    }))
                  }
                  aria-invalid={Boolean(errors.customerEmail)}
                  className={fieldClassName}
                />
                {errors.customerEmail && (
                  <p role="alert" className="mt-1 text-[11px] text-red-300">
                    {errors.customerEmail}
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <dl className="grid gap-x-5 gap-y-3 text-xs sm:grid-cols-2">
            <div className="min-w-0 sm:col-span-2">
              <dt className={labelClassName}>Description</dt>
              <dd className="mt-1 break-words leading-relaxed text-white/85">
                {draft.description}
              </dd>
            </div>

            {draft.customerName && (
              <div className="min-w-0">
                <dt className={labelClassName}>Customer</dt>
                <dd className="mt-1 break-words text-white/80">{draft.customerName}</dd>
              </div>
            )}

            {draft.customerEmail && (
              <div className="min-w-0">
                <dt className={labelClassName}>Customer email</dt>
                <dd className="mt-1 break-all text-white/80">{draft.customerEmail}</dd>
              </div>
            )}

            <div className="min-w-0 sm:col-span-2">
              <dt className={labelClassName}>Receiving wallet</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="break-all font-mono text-[11px] leading-relaxed text-white/65">
                  {model.merchantWallet ?? "Merchant session unavailable"}
                </span>
                <span className="rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white/40">
                  Read-only
                </span>
              </dd>
            </div>

            <div className="min-w-0">
              <dt className={labelClassName}>Expires</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-white/75">
                <span className="tabular-nums">{model.countdownLabel}</span>
                <span className="text-[11px] text-white/40">
                  at <ExpiryLabel expiresAt={review.expiresAt} />
                </span>
              </dd>
            </div>
          </dl>
        )}

        <p
          className={`rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
            model.statusTone === "pending"
              ? "border-emerald-400/15 bg-emerald-400/[0.04] text-emerald-100/70"
              : model.statusTone === "warning"
                ? "border-amber-400/20 bg-amber-400/[0.05] text-amber-100/80"
                : model.statusTone === "expired"
                  ? "border-red-400/20 bg-red-400/[0.05] text-red-100/80"
                  : "border-white/[0.08] bg-white/[0.02] text-white/55"
          }`}
        >
          {model.notice}
        </p>

        {approvalError && (
          <p
            role="alert"
            className="rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[11px] leading-relaxed text-red-100/85"
          >
            {approvalError.message}
          </p>
        )}

        {cancelError && (
          <p
            role="alert"
            className="rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[11px] leading-relaxed text-red-100/85"
          >
            {cancelError.message}
          </p>
        )}

        <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-3.5 sm:flex-row sm:items-center sm:justify-end">
          {isEditing ? (
            <>
              <button
                type="button"
                onClick={stopEditing}
                disabled={isBusy}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.03] px-4 text-xs font-semibold text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
              >
                Cancel editing
              </button>
              <button
                type="button"
                onClick={saveEdits}
                disabled={!model.canEdit || isBusy}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/15 px-4 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
              >
                Save changes
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void cancel()}
                disabled={isBusy}
                className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-xs font-semibold text-red-300/80 transition-colors hover:bg-red-400/[0.08] hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
              >
                {isCancelling ? "Cancelling…" : "Cancel draft"}
              </button>
              <button
                type="button"
                onClick={beginEditing}
                disabled={!model.canEdit || isBusy}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.03] px-4 text-xs font-semibold text-white/75 transition-colors hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
              >
                Edit draft
              </button>
              <button
                type="button"
                onClick={() => void approve()}
                disabled={approveDisabled}
                title={
                  approvalBlocked
                    ? approvalError?.message
                    : approveDisabled
                      ? model.statusTone === "expired"
                        ? "This draft has expired. Ask PayProof AI to prepare it again."
                        : model.statusTone === "warning"
                          ? "Edited drafts require a new server authorization."
                          : DRAFT_APPROVAL_NOT_CONNECTED
                      : undefined
                }
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#14F195] px-4 text-xs font-semibold text-black transition-colors hover:bg-[#3AF0A9] disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-white/35 sm:min-h-9"
              >
                {isLoading && (
                  <span
                    aria-hidden="true"
                    className="size-3 animate-spin rounded-full border-2 border-black/25 border-t-black"
                  />
                )}
                {isLoading ? "Approving…" : "Approve payment request"}
              </button>
            </>
          )}
        </div>

        {!onApprove && !isEditing && (
          <p className="text-[10px] leading-relaxed text-white/35">
            {DRAFT_APPROVAL_NOT_CONNECTED}
          </p>
        )}
      </div>
    </section>
  );
}
