/**
 * Invoice domain types for Payproof.
 *
 * These shapes mirror the payment-request domain so the invoices page can share
 * validation, formatting, and status conventions. At this stage the types are
 * used by the UI only; real storage and payment linking will be added separately.
 */

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "viewed"
  | "paid"
  | "overdue"
  | "cancelled"
  | "void";

export type Currency = "SOL" | "USD";

export type InvoiceLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
};

export type Invoice = {
  id: string;
  number: string;
  customerName: string;
  customerEmail: string;
  description: string;
  lineItems: readonly InvoiceLineItem[];
  currency: Currency;
  amountCents: string;
  amountLamports: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  notes: string | null;
  createdAt: string;
};

export type InvoicePreview = {
  invoice: Invoice;
  shareUrl: string;
  totalAmountText: string;
  dueDateText: string;
  statusText: string;
};

/**
 * Build a deterministic demo invoice ID prefix for the UI.
 * This is used only to make previews readable; it does not create real records.
 */
export function makeInvoiceNumber(index: number): string {
  const hex = index
    .toString(16)
    .toUpperCase()
    .padStart(4, "0");
  return `INV-${hex}`;
}
