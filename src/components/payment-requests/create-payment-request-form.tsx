"use client";

import { useId, useRef, useState, useEffect, type FormEvent } from "react";
import { useClient } from "@solana/react";
import { createPaymentRequestAction } from "@/lib/payment-requests/actions";
import {
  AMOUNT_MAX_SOL,
  CUSTOMER_EMAIL_MAX_LENGTH,
  CUSTOMER_NAME_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  parseSolAmountToLamports,
  validatePaymentRequestForm,
  type PaymentRequestField,
  type PaymentRequestFieldErrors,
  type PaymentRequestFormValues,
} from "@/lib/payment-requests/validation";
import type { PaymentRequest } from "@/lib/payment-requests/types";
import { shortenAddress } from "@/lib/solana/address";
import { fetchSolBalance } from "@/lib/solana/balance";
import type { AppClient } from "@/lib/solana/client";
import { formatSolExact } from "@/lib/solana/units";
import { useMerchantWallet } from "@/lib/wallet/use-merchant-wallet";

const EMPTY_VALUES: PaymentRequestFormValues = {
  amount: "",
  description: "",
  customerName: "",
  customerEmail: "",
};

const FIELD_ORDER: readonly PaymentRequestField[] = [
  "amount",
  "description",
  "customerName",
  "customerEmail",
];

const inputClassName =
  "mt-1.5 min-h-11 w-full rounded-xl border border-white/[0.1] bg-black/40 px-3.5 py-2 text-sm text-white placeholder:text-white/35 transition-colors focus:border-[#9945FF] focus:bg-white/[0.04] focus:outline-none focus:ring-1 focus:ring-[#9945FF]";

/** The last successfully read balance, tagged with the address it belongs to. */
type WalletBalance = { address: string; lamports: bigint };

export default function CreatePaymentRequestForm({
  onCreated,
  onCancel,
  onPersistenceNotice,
}: {
  onCreated: (request: PaymentRequest) => void;
  onCancel: () => void;
  onPersistenceNotice?: (notice: string, isPersistent: boolean) => void;
}) {
  const formId = useId();

  const ids = {
    amount: `${formId}-amount`,
    amountError: `${formId}-amount-error`,
    amountBalanceWarning: `${formId}-amount-balance-warning`,
    description: `${formId}-description`,
    descriptionError: `${formId}-description-error`,
    customerName: `${formId}-customer-name`,
    customerNameError: `${formId}-customer-name-error`,
    customerEmail: `${formId}-customer-email`,
    customerEmailError: `${formId}-customer-email-error`,
    formError: `${formId}-form-error`,
    pending: `${formId}-pending`,
  };

  const [values, setValues] = useState<PaymentRequestFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<PaymentRequestFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const amountRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const customerNameRef = useRef<HTMLInputElement>(null);
  const customerEmailRef = useRef<HTMLInputElement>(null);

  const fieldRefs = {
    amount: amountRef,
    description: descriptionRef,
    customerName: customerNameRef,
    customerEmail: customerEmailRef,
  };

  const { address: merchantAddress, walletName, isHydrated } = useMerchantWallet();
  const client = useClient<AppClient>();

  const [walletBalance, setWalletBalance] = useState<WalletBalance | null>(null);

  // Read the connected merchant wallet balance from Solana Devnet. The balance
  // is only ever used for an advisory warning; it never blocks the request.
  useEffect(() => {
    if (!merchantAddress) {
      return;
    }

    let cancelled = false;
    const timeout = AbortSignal.timeout(10_000);

    fetchSolBalance(client, merchantAddress, { signal: timeout })
      .then((lamports) => {
        if (!cancelled) {
          setWalletBalance({ address: merchantAddress, lamports });
        }
      })
      .catch(() => {
        // A balance we cannot read is not an error the merchant must act on.
        // The request can still be created.
      });

    return () => {
      cancelled = true;
    };
  }, [client, merchantAddress]);

  const amountLamports = parseSolAmountToLamports(values.amount);
  // Only trust a balance read for the wallet that is currently connected, so a
  // previous wallet's balance is never shown for a new one.
  const currentBalance =
    merchantAddress && walletBalance?.address === merchantAddress
      ? walletBalance.lamports
      : null;

  const showInsufficientBalanceWarning =
    currentBalance !== null &&
    amountLamports !== null &&
    amountLamports > 0n &&
    currentBalance < amountLamports;

  function updateValue(field: PaymentRequestField, value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));

    if (errors[field]) {
      setErrors((previous) => {
        const next = { ...previous };
        delete next[field];
        return next;
      });
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const result = validatePaymentRequestForm(values);

    if (!result.ok) {
      setErrors(result.errors);

      const firstInvalidField = FIELD_ORDER.find(
        (field) => result.errors[field],
      );

      if (firstInvalidField) {
        fieldRefs[firstInvalidField].current?.focus();
      }

      return;
    }

    setErrors({});
    setIsPending(true);

    createPaymentRequestAction(
      { ...result.value, merchantAddress },
      merchantAddress,
    )
      .then((createResult) => {
        setIsPending(false);

        if (!createResult.ok) {
          setFormError(createResult.error);
          return;
        }

        const request = createResult.request;
        setValues(EMPTY_VALUES);
        setErrors({});
        onCreated(request);
        onPersistenceNotice?.(
          request.status === "pending" ? "Request saved." : "",
          true,
        );
      })
      .catch((cause) => {
        setIsPending(false);
        setFormError(
          cause instanceof Error && cause.message
            ? cause.message
            : "The payment request could not be saved. Please try again.",
        );
      });
  }

  const presets = ["0.1", "0.5", "1.0", "2.5", "5.0"];

  return (
    <section
      aria-labelledby="create-request-heading"
      className="rounded-2xl border border-white/[0.08] bg-[#0E0E12] p-5 sm:p-6"
    >
      <div className="space-y-1.5 border-b border-white/[0.06] pb-4">
        <h2
          id="create-request-heading"
          className="text-base font-semibold text-white"
        >
          New Payment Request
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
          <span
            aria-hidden="true"
            className={`size-2 shrink-0 rounded-full ${
              merchantAddress ? "bg-[#14F195] shadow-[0_0_8px_rgba(20,241,149,0.6)]" : "bg-white/30"
            }`}
          />
          {!isHydrated ? (
            <span>Checking wallet…</span>
          ) : merchantAddress ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span>Receiving Wallet:</span>
              <span className="font-mono text-white/90 bg-white/[0.05] border border-white/[0.08] px-2 py-0.5 rounded-md text-[11px]">
                {shortenAddress(merchantAddress)}
              </span>
              <span className="text-[#14F195] text-[11px]">· Devnet</span>
            </div>
          ) : (
            <span>No wallet connected — request will be saved with open recipient.</span>
          )}
        </div>
      </div>

      <form noValidate onSubmit={handleSubmit} className="mt-5 space-y-4">
        {/* Amount Input & Presets */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label
              htmlFor={ids.amount}
              className="text-[11px] font-semibold uppercase tracking-wider text-white/50"
            >
              Amount (SOL) <span className="text-red-400">*</span>
            </label>
            <span className="text-[11px] text-white/40 tabular-nums">
              Max {AMOUNT_MAX_SOL.toString()} SOL
            </span>
          </div>

          <div className="relative mt-1">
            <input
              ref={amountRef}
              id={ids.amount}
              name="amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              maxLength={24}
              placeholder="0.00"
              value={values.amount}
              onChange={(event) => updateValue("amount", event.target.value)}
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={
                [errors.amount ? ids.amountError : null, showInsufficientBalanceWarning ? ids.amountBalanceWarning : null]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              className={`${inputClassName} pr-14 font-mono text-base font-semibold tabular-nums ${
                errors.amount ? "border-red-400/60 focus:border-red-400" : ""
              }`}
            />
            <span
              aria-hidden="true"
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-white/40"
            >
              SOL
            </span>
          </div>

          {/* Quick preset buttons */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-white/40 mr-1">Presets:</span>
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => updateValue("amount", preset)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-mono transition-all ${
                  values.amount === preset
                    ? "border-[#9945FF] bg-[#9945FF]/20 text-white font-bold"
                    : "border-white/[0.08] bg-white/[0.03] text-white/70 hover:border-white/20 hover:text-white"
                }`}
              >
                {preset} SOL
              </button>
            ))}
          </div>

          {errors.amount && (
            <p
              id={ids.amountError}
              role="alert"
              className="mt-1.5 text-xs text-red-400 font-medium"
            >
              {errors.amount}
            </p>
          )}

          {showInsufficientBalanceWarning && currentBalance !== null && amountLamports !== null && (
            <div
              id={ids.amountBalanceWarning}
              className="mt-2.5 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-xs text-amber-200"
            >
              <p className="font-medium text-amber-300">Balance notice:</p>
              <p className="mt-0.5 text-white/70">
                Your wallet holds {formatSolExact(currentBalance)} SOL. You can still generate this request for your customer to pay.
              </p>
            </div>
          )}
        </div>

        {/* Description Input */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label
              htmlFor={ids.description}
              className="text-[11px] font-semibold uppercase tracking-wider text-white/50"
            >
              Description / Memo <span className="text-red-400">*</span>
            </label>
            <span className="text-[11px] text-white/40 tabular-nums">
              {values.description.length}/{DESCRIPTION_MAX_LENGTH}
            </span>
          </div>

          <textarea
            ref={descriptionRef}
            id={ids.description}
            name="description"
            rows={3}
            maxLength={DESCRIPTION_MAX_LENGTH}
            placeholder="e.g. Design consulting invoice #104"
            value={values.description}
            onChange={(event) => updateValue("description", event.target.value)}
            aria-invalid={Boolean(errors.description)}
            aria-describedby={
              errors.description ? ids.descriptionError : undefined
            }
            className={`${inputClassName} resize-none ${
              errors.description ? "border-red-400/60 focus:border-red-400" : ""
            }`}
          />

          {errors.description && (
            <p
              id={ids.descriptionError}
              role="alert"
              className="mt-1.5 text-xs text-red-400 font-medium"
            >
              {errors.description}
            </p>
          )}
        </div>

        {/* Customer Information (Optional) */}
        <div className="grid gap-3 sm:grid-cols-2 pt-1">
          <div>
            <label
              htmlFor={ids.customerName}
              className="text-[11px] font-semibold uppercase tracking-wider text-white/50"
            >
              Customer Name{" "}
              <span className="font-normal text-white/30 text-[10px]">(optional)</span>
            </label>

            <input
              ref={customerNameRef}
              id={ids.customerName}
              name="customerName"
              type="text"
              autoComplete="name"
              maxLength={CUSTOMER_NAME_MAX_LENGTH}
              placeholder="e.g. Sarah Connor"
              value={values.customerName}
              onChange={(event) =>
                updateValue("customerName", event.target.value)
              }
              aria-invalid={Boolean(errors.customerName)}
              className={inputClassName}
            />

            {errors.customerName && (
              <p
                id={ids.customerNameError}
                role="alert"
                className="mt-1 text-xs text-red-400"
              >
                {errors.customerName}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor={ids.customerEmail}
              className="text-[11px] font-semibold uppercase tracking-wider text-white/50"
            >
              Customer Email{" "}
              <span className="font-normal text-white/30 text-[10px]">(optional)</span>
            </label>

            <input
              ref={customerEmailRef}
              id={ids.customerEmail}
              name="customerEmail"
              type="email"
              autoComplete="email"
              maxLength={CUSTOMER_EMAIL_MAX_LENGTH}
              placeholder="e.g. sarah@example.com"
              value={values.customerEmail}
              onChange={(event) =>
                updateValue("customerEmail", event.target.value)
              }
              aria-invalid={Boolean(errors.customerEmail)}
              className={inputClassName}
            />

            {errors.customerEmail && (
              <p
                id={ids.customerEmailError}
                role="alert"
                className="mt-1 text-xs text-red-400"
              >
                {errors.customerEmail}
              </p>
            )}
          </div>
        </div>

        {formError && (
          <div
            id={ids.formError}
            role="alert"
            className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200"
          >
            {formError}
          </div>
        )}

        <div className="border-t border-white/[0.08] pt-4 mt-6">
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-4 py-2.5 text-xs font-semibold text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isPending}
              className="btn-brand-gradient inline-flex items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-xs font-semibold text-white shadow-lg disabled:opacity-50"
            >
              {isPending ? (
                <>
                  <svg
                    className="size-3.5 animate-spin text-white"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                  >
                    <circle cx="12" cy="12" r="10" strokeWidth="4" className="opacity-25" />
                    <path
                      d="M4 12a8 8 0 018-8v8H4z"
                      fill="currentColor"
                      className="opacity-75"
                    />
                  </svg>
                  <span>Generating Request…</span>
                </>
              ) : (
                <span>Generate Payment Request</span>
              )}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
