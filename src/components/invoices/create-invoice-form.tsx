"use client";

import { useId, useRef, useState, useEffect, type FormEvent } from "react";
import type { Currency, Invoice, InvoiceLineItem } from "@/lib/invoices/types";
import { formatLamportUrlParam, formatUsdAmount } from "@/lib/invoices/currency";
import { makeInvoiceNumber } from "@/lib/invoices/types";
import { LAMPORTS_PER_SOL } from "@/lib/solana/units";
import { Button } from "@/components/ui/button";
import { ChevronDownIcon as ChevronIcon, TrashIcon } from "@/components/dashboard/icons";

type EditModes = { mode: "create" } | { mode: "edit"; invoice: Invoice };

const inputBase =
  "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const LABEL_CLASS =
  "text-xs font-medium text-neutral-200";

type Props = {
  invoice?: Invoice;
  onCreated: (invoice: Invoice) => void;
  onCancel: () => void;
};

const MAX_DESCRIPTION = 200;
const MAX_CUSTOMER_NAME = 100;
const MAX_CUSTOMER_EMAIL = 160;
const MAX_NOTES = 600;
const MAX_LINE_ITEMS = 12;

function emptyLineItem(): InvoiceLineItem {
  return {
    description: "",
    quantity: 1,
    unitPrice: 0,
  };
}

function lineTotal(item: InvoiceLineItem): number {
  return Math.round((item.quantity * item.unitPrice + Number.EPSILON) * 100) / 100;
}

function formatCurrencyForInput(value: number, currency: Currency): string {
  if (currency === "SOL") {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 4,
      maximumFractionDigits: 9,
    });
  }

  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parsePositiveNumber(value: string): number {
  const trimmed = value.trim().replace(/[,\s]/g, "");
  if (trimmed === "") return 0;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function buildInvoiceFromForm(
  mode: EditModes,
  customerName: string,
  customerEmail: string,
  description: string,
  lineItems: readonly InvoiceLineItem[],
  currency: Currency,
  issueDate: string,
  dueDate: string,
  notes: string,
): Invoice {
  const idSuffix = Math.floor(Math.random() * 0x10000).toString(16).toUpperCase().padStart(4, "0");
  const id = `INV-UI-${idSuffix}`;

  const isEdit = mode.mode === "edit";
  const baseNumber = isEdit ? mode.invoice.number : makeInvoiceNumber(Math.floor(Math.random() * 9999));
  const number = isEdit ? baseNumber : `${baseNumber}-${idSuffix.slice(0, 4)}`;

  const amountCents = lineItems.reduce(
    (total, item) => total + Math.round(lineTotal(item) * 100),
    0,
  );

  // In a real integration this rate comes from a price feed and the SOL amount
  // is computed server-side. We keep a simple deterministic conversion here for
  // the UI preview only.
  const pricePerLamportUsd = 1n; // placeholder: real rate would be passed in
  const amountLamports =
    currency === "SOL"
      ? amountCents > 0
        ? String(Math.round(amountCents / 100 / 0.000000001))
        : "0"
      : String(Number(amountCents) * 1_000_000);

  return {
    id,
    number,
    customerName: customerName.trim(),
    customerEmail: customerEmail.trim(),
    description: description.trim(),
    lineItems,
    currency,
    amountCents: String(amountCents),
    amountLamports,
    issueDate,
    dueDate,
    notes: notes.trim() || null,
    status: isEdit ? mode.invoice.status : "draft",
    createdAt: new Date().toISOString(),
  };
}

function defaultFormValues(customerName: string, customerEmail: string): {
  customerName: string;
  customerEmail: string;
  description: string;
  lineItems: readonly InvoiceLineItem[];
  currency: Currency;
  issueDate: string;
  dueDate: string;
  notes: string;
} {
  const today = new Date();
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + 14);

  const fmt = (date: Date) =>
    date.toISOString().slice(0, 10);

  return {
    customerName,
    customerEmail,
    description: "",
    lineItems: [emptyLineItem()],
    currency: "USD",
    issueDate: fmt(today),
    dueDate: fmt(dueDate),
    notes: "",
  };
}

export default function CreateInvoiceForm({
  invoice,
  onCreated,
  onCancel,
}: Props) {
  const formId = useId();

  const ids = {
    form: `${formId}-form`,
    customerName: `${formId}-customer-name`,
    customerNameError: `${formId}-customer-name-error`,
    customerEmail: `${formId}-customer-email`,
    customerEmailError: `${formId}-customer-email-error`,
    description: `${formId}-description`,
    descriptionError: `${formId}-description-error`,
    lineItems: `${formId}-line-items`,
    issueDate: `${formId}-issue-date`,
    issueDateError: `${formId}-issue-date-error`,
    dueDate: `${formId}-due-date`,
    dueDateError: `${formId}-due-date-error`,
    notes: `${formId}-notes`,
    notesError: `${formId}-notes-error`,
    currency: `${formId}-currency`,
    amountDisplay: `${formId}-amount-display`,
    submit: `${formId}-submit`,
  };

  const isEdit = invoice != null;
  const title = isEdit ? `Edit invoice ${invoice.number}` : "New invoice";

  const initial = isEdit
    ? {
        customerName: invoice.customerName,
        customerEmail: invoice.customerEmail,
        description: invoice.description,
        lineItems: [...invoice.lineItems] as InvoiceLineItem[],
        currency: invoice.currency,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        notes: invoice.notes ?? "",
      }
    : defaultFormValues("", "");

  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState(false);

  const lineItemsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEdit && invoice) {
      setValues({
        customerName: invoice.customerName,
        customerEmail: invoice.customerEmail,
        description: invoice.description,
        lineItems: [...invoice.lineItems] as InvoiceLineItem[],
        currency: invoice.currency,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        notes: invoice.notes ?? "",
      });
      setErrors({});
      setFormError(null);
    }
  }, [invoice, isEdit]);

  function updateField<K extends keyof typeof values>(
    key: K,
    value: (typeof values)[K],
  ) {
    setValues((previous) => ({ ...previous, [key]: value }));
    if (errors[key]) {
      setErrors((previous) => {
        const next = { ...previous };
        delete next[key];
        return next;
      });
    }
  }

  function setLineItem(index: number, field: keyof InvoiceLineItem, value: string | number) {
    setValues((previous) => {
      const next = [...previous.lineItems] as InvoiceLineItem[];
      next[index] = { ...next[index], [field]: value };
      return { ...previous, lineItems: next };
    });

    // Clear field-level errors when the customer edits a line item.
    const fieldKey = `lineItems.${index}.${field}`;
    if (errors[fieldKey]) {
      setErrors((previous) => {
        const next = { ...previous };
        delete next[fieldKey];
        return next;
      });
    }
  }

  function addLineItem() {
    if (values.lineItems.length >= MAX_LINE_ITEMS) {
      setFormError(`A maximum of ${MAX_LINE_ITEMS} line items is allowed.`);
      return;
    }

    setValues((previous) => ({
      ...previous,
      lineItems: [...previous.lineItems, emptyLineItem()],
    }));
    setFormError(null);
  }

  function removeLineItem(index: number) {
    if (values.lineItems.length <= 1) {
      setFormError("At least one line item is required.");
      return;
    }

    setValues((previous) => ({
      ...previous,
      lineItems: previous.lineItems.filter((_, i) => i !== index),
    }));
    setFormError(null);
  }

  function computeTotals(): { subtotal: number; total: number; shownCurrency: Currency } {
    const total = values.lineItems.reduce((sum, item) => sum + lineTotal(item), 0);
    return { subtotal: total, total, shownCurrency: values.currency };
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setErrors({});

    if (!values.customerName.trim()) {
      setErrors((prev) => ({ ...prev, customerName: "Customer name is required." }));
      return;
    }

    if (values.customerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.customerEmail.trim())) {
      setErrors((prev) => ({ ...prev, customerEmail: "Enter a valid customer email address." }));
      return;
    }

    if (!values.description.trim()) {
      setErrors((prev) => ({ ...prev, description: "Description is required." }));
      return;
    }

    if (values.lineItems.length === 0 || values.lineItems.every((item) => !item.description.trim() && item.quantity === 0 && item.unitPrice === 0)) {
      setErrors((prev) => ({ ...prev, lineItems: "Add at least one line item." }));
      return;
    }

    if (!values.issueDate) {
      setErrors((prev) => ({ ...prev, issueDate: "Issue date is required." }));
      return;
    }

    if (!values.dueDate) {
      setErrors((prev) => ({ ...prev, dueDate: "Due date is required." }));
      return;
    }

    if (values.dueDate && values.issueDate && values.dueDate < values.issueDate) {
      setErrors((prev) => ({ ...prev, dueDate: "Due date must be on or after the issue date." }));
      return;
    }

    setIsPending(true);

    // Pure-UI creation path. No backend call, no fake persistence. The created
    // invoice is returned immediately so the preview can render.
    setTimeout(() => {
      setIsPending(false);
      const created = buildInvoiceFromForm(
        isEdit ? { mode: "edit", invoice } : { mode: "create" },
        values.customerName,
        values.customerEmail,
        values.description,
        values.lineItems,
        values.currency,
        values.issueDate,
        values.dueDate,
        values.notes,
      );
      onCreated(created);
    }, 0);
  }

  const { total, shownCurrency } = computeTotals();
  const amountLabel = shownCurrency === "USD" ? "Total (USD)" : "Total (SOL)";
  const amountValue =
    shownCurrency === "USD"
      ? formatUsdAmount(LAMPORTS_PER_SOL, BigInt(Math.round(total * 100)))
      : `${total.toFixed(6)} SOL`;

  return (
    <section
      aria-labelledby={`${formId}-heading`}
      className="rounded-xl border border-line bg-surface p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2
            id={`${formId}-heading`}
            className="text-sm font-semibold text-neutral-200"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            {title}
          </h2>
          <p className="mt-1 text-xs text-muted">
            {isEdit
              ? "Update invoice details. This is a UI-only preview until billing is connected."
              : "Create a professional invoice denominated in SOL or USD."}
          </p>
        </div>

        {isEdit && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-neutral-200"
            style={{ color: "rgba(255,255,255,0.6)" }}
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-[#9945FF]" />
            Editing draft
          </span>
        )}
      </div>

      <form
        noValidate
        onSubmit={handleSubmit}
        className="mt-4 space-y-4"
        aria-labelledby={`${formId}-heading`}
      >
        {/* Customer */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor={ids.customerName}
              className={LABEL_CLASS}
            >
              Customer name
            </label>
            <input
              id={ids.customerName}
              name="customerName"
              type="text"
              autoComplete="name"
              maxLength={MAX_CUSTOMER_NAME}
              placeholder="Ada Nwosu"
              value={values.customerName}
              onChange={(event) =>
                updateField("customerName", event.target.value)
              }
              aria-invalid={Boolean(errors.customerName)}
              aria-describedby={
                errors.customerName ? ids.customerNameError : undefined
              }
              className={`${inputBase} ${errors.customerName ? "border-red-400/60" : ""}`}
            />
            {errors.customerName && (
              <p id={ids.customerNameError} className="mt-1 text-xs text-red-300">
                {errors.customerName}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor={ids.customerEmail}
              className={LABEL_CLASS}
            >
              Customer email
              <span className="text-muted">(optional)</span>
            </label>
            <input
              id={ids.customerEmail}
              name="customerEmail"
              type="email"
              autoComplete="email"
              maxLength={MAX_CUSTOMER_EMAIL}
              placeholder="ada@example.com"
              value={values.customerEmail}
              onChange={(event) =>
                updateField("customerEmail", event.target.value)
              }
              aria-invalid={Boolean(errors.customerEmail)}
              aria-describedby={
                errors.customerEmail ? ids.customerEmailError : undefined
              }
              className={`${inputBase} ${errors.customerEmail ? "border-red-400/60" : ""}`}
            />
            {errors.customerEmail && (
              <p id={ids.customerEmailError} className="mt-1 text-xs text-red-300">
                {errors.customerEmail}
              </p>
            )}
          </div>
        </div>

        {/* Invoice description */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <label
              htmlFor={ids.description}
              className={LABEL_CLASS}
            >
              Invoice description
            </label>
            <span className="text-[11px] text-muted tabular-nums">
              {values.description.length}/{MAX_DESCRIPTION}
            </span>
          </div>
          <textarea
            id={ids.description}
            name="description"
            rows={3}
            maxLength={MAX_DESCRIPTION}
            placeholder="What is this invoice for?"
            value={values.description}
            onChange={(event) =>
              updateField("description", event.target.value)
            }
            aria-invalid={Boolean(errors.description)}
            aria-describedby={
              errors.description ? ids.descriptionError : undefined
            }
            className={`${inputBase} resize-y ${errors.description ? "border-red-400/60" : ""}`}
          />
          {errors.description && (
            <p id={ids.descriptionError} className="mt-1 text-xs text-red-300">
              {errors.description}
            </p>
          )}
        </div>

        {/* Currency + dates */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor={ids.currency} className={LABEL_CLASS}>
              Currency
            </label>
            <select
              id={ids.currency}
              name="currency"
              value={values.currency}
              onChange={(event) =>
                updateField("currency", event.target.value as Currency)
              }
              className={`${inputBase} appearance-none pr-8`}
            >
              <option value="USD">USD</option>
              <option value="SOL">SOL</option>
            </select>
          </div>

          <div>
            <label htmlFor={ids.issueDate} className={LABEL_CLASS}>
              Issue date
            </label>
            <input
              id={ids.issueDate}
              name="issueDate"
              type="date"
              value={values.issueDate}
              onChange={(event) =>
                updateField("issueDate", event.target.value)
              }
              aria-invalid={Boolean(errors.issueDate)}
              aria-describedby={
                errors.issueDate ? ids.issueDateError : undefined
              }
              className={`${inputBase} ${errors.issueDate ? "border-red-400/60" : ""}`}
            />
            {errors.issueDate && (
              <p id={ids.issueDateError} className="mt-1 text-xs text-red-300">
                {errors.issueDate}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={ids.dueDate} className={LABEL_CLASS}>
              Due date
            </label>
            <input
              id={ids.dueDate}
              name="dueDate"
              type="date"
              value={values.dueDate}
              onChange={(event) =>
                updateField("dueDate", event.target.value)
              }
              aria-invalid={Boolean(errors.dueDate)}
              aria-describedby={
                errors.dueDate ? ids.dueDateError : undefined
              }
              className={`${inputBase} ${errors.dueDate ? "border-red-400/60" : ""}`}
            />
            {errors.dueDate && (
              <p id={ids.dueDateError} className="mt-1 text-xs text-red-300">
                {errors.dueDate}
              </p>
            )}
          </div>
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-baseline justify-between">
            <span className={LABEL_CLASS}>Line items</span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted tabular-nums">
                {values.lineItems.length} item{values.lineItems.length !== 1 ? "s" : ""}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={addLineItem}
                className="text-neutral-200 hover:bg-white/5 hover:text-white border border-line"
              >
                Add line
              </Button>
            </div>
          </div>

          <div
            id={ids.lineItems}
            ref={lineItemsRef}
            className="mt-3 space-y-2"
            role="list"
            aria-label="Invoice line items"
          >
            {values.lineItems.map((item, index) => (
              <div
                key={index}
                className="flex flex-wrap gap-2 rounded-lg border border-line bg-surface-raised p-3"
                role="listitem"
              >
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor={`${ids.lineItems}-${index}-description`}
                    className="sr-only"
                  >
                    Description
                  </label>
                  <input
                    id={`${ids.lineItems}-${index}-description`}
                    name={`lineItems.${index}.description`}
                    type="text"
                    placeholder="Service or product"
                    value={item.description}
                    onChange={(event) =>
                      setLineItem(index, "description", event.target.value)
                    }
                    className={`${inputBase} ${errors[`lineItems.${index}.description`] ? "border-red-400/60" : ""}`}
                    aria-invalid={Boolean(errors[`lineItems.${index}.description`])}
                  />
                </div>

                <div className="w-20">
                  <label
                    htmlFor={`${ids.lineItems}-${index}-quantity`}
                    className="sr-only"
                  >
                    Quantity
                  </label>
                  <input
                    id={`${ids.lineItems}-${index}-quantity`}
                    name={`lineItems.${index}.quantity`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="1"
                    value={item.quantity}
                    onChange={(event) =>
                      setLineItem(index, "quantity", parsePositiveNumber(event.target.value))
                    }
                    className={`${inputBase} text-right ${errors[`lineItems.${index}.quantity`] ? "border-red-400/60" : ""}`}
                    aria-invalid={Boolean(errors[`lineItems.${index}.quantity`])}
                  />
                </div>

                <div className="w-28">
                  <label
                    htmlFor={`${ids.lineItems}-${index}-unitPrice`}
                    className="sr-only"
                  >
                    Unit price
                  </label>
                  <div className="relative">
                    <input
                      id={`${ids.lineItems}-${index}-unitPrice`}
                      name={`lineItems.${index}.unitPrice`}
                      type="text"
                      inputMode="decimal"
                      value={formatCurrencyForInput(item.unitPrice, values.currency)}
                      onChange={(event) =>
                        setLineItem(
                          index,
                          "unitPrice",
                          parsePositiveNumber(event.target.value),
                        )
                      }
                      className={`${inputBase} pr-7 font-mono tabular-nums ${errors[`lineItems.${index}.unitPrice`] ? "border-red-400/60" : ""}`}
                      aria-invalid={Boolean(errors[`lineItems.${index}.unitPrice`])}
                    />
                    <span
                      aria-hidden="true"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted"
                    >
                      {values.currency}
                    </span>
                  </div>
                </div>

                <div className="w-24 flex items-center">
                  <span className="mr-2 text-[11px] text-muted">Total</span>
                  <span
                    className="font-mono tabular-nums text-neutral-200"
                    aria-label={`Line total: ${formatCurrencyForInput(lineTotal(item), values.currency)}`}
                  >
                    {formatCurrencyForInput(lineTotal(item), values.currency)}
                  </span>
                </div>

                {values.lineItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLineItem(index)}
                    className="rounded-md border border-line p-1.5 text-neutral-400 hover:bg-white/5 hover:text-red-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    aria-label={`Remove line item ${index + 1}`}
                  >
                    <TrashIcon className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {errors.lineItems && (
            <p className="mt-2 text-xs text-red-300">{errors.lineItems}</p>
          )}
        </div>

        {/* Notes */}
        <div>
          <button
            type="button"
            onClick={() => setExpandedNotes(!expandedNotes)}
            className="flex items-baseline justify-between gap-2"
            aria-expanded={expandedNotes}
          >
            <label htmlFor={ids.notes} className={LABEL_CLASS}>
              Notes
              <span className="text-muted">(optional)</span>
            </label>
            <ChevronIcon
              className={`size-4 text-muted transition-transform ${expandedNotes ? "rotate-180" : ""}`}
              style={{ transform: expandedNotes ? "rotate(180deg)" : undefined }}
            />
          </button>

          <div
            className={`mt-1 transition-all duration-150 ${expandedNotes ? "block" : "hidden"}`}
          >
            <textarea
              id={ids.notes}
              name="notes"
              rows={expandedNotes ? 4 : 1}
              maxLength={MAX_NOTES}
              placeholder="Payment instructions, delivery details, or internal notes..."
              value={values.notes}
              onChange={(event) =>
                updateField("notes", event.target.value)
              }
              aria-invalid={Boolean(errors.notes)}
              aria-describedby={
                errors.notes ? ids.notesError : undefined
              }
              className={`${inputBase} resize-y ${errors.notes ? "border-red-400/60" : ""}`}
            />
            {errors.notes && (
              <p id={ids.notesError} className="mt-1 text-xs text-red-300">
                {errors.notes}
              </p>
            )}
            {values.notes.length > 0 && (
              <p className="mt-1 text-[11px] text-muted">
                {values.notes.length} / {MAX_NOTES}
              </p>
            )}
          </div>
        </div>

        {/* Live total */}
        <div className="rounded-lg border border-line bg-surface-raised p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted">{amountLabel}</span>
            <span
              id={ids.amountDisplay}
              className="font-mono text-lg font-semibold tabular-nums text-neutral-100"
              aria-live="polite"
            >
              {amountValue}
            </span>
          </div>
        </div>

        {/* Form-level error */}
        {formError && (
          <p
            role="alert"
            className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200"
          >
            {formError}
          </p>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button
            type="submit"
            disabled={isPending}
            size="md"
            variant="primary"
          >
            {isPending ? "Creating invoice..." : isEdit ? "Save changes" : "Create invoice"}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onCancel}
            className="border border-line text-neutral-200 hover:bg-white/5 hover:text-white"
          >
            Cancel
          </Button>

          <p className="text-[11px] text-muted">
            {isPending
              ? "Preparing preview..."
              : "Invoices are editable until sent. Sharing creates a customer-facing link."}
          </p>
        </div>
      </form>
    </section>
  );
}
