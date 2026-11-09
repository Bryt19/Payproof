/**
 * Invoice view types for Payproof.
 *
 * For this version, each `payment_requests` row is represented as an invoice in
 * the Invoices UI. Data comes from the existing Supabase `payment_requests`
 * table via server-side API routes — never from mock/hardcoded records.
 *
 * IMPORTANT: status reflects the database record. A payment is only `paid`
 * after server-side on-chain verification updates the database; the frontend
 * must never mark an invoice paid on its own.
 */

import type { PaymentRequestStatus } from "@/lib/payment-requests/types";

export type InvoiceStatus = PaymentRequestStatus;

export type Invoice = {
  id: string;
  /** Payment request reference, displayed as the invoice identifier. */
  reference: string;
  /** Exact amount in lamports, as an integer string. */
  amountLamports: string;
  description: string;
  customerName: string | null;
  customerEmail: string | null;
  merchantAddress: string | null;
  status: InvoiceStatus;
  transactionSignature: string | null;
  payerAddress: string | null;
  verifiedAt: string | null;
  createdAt: string;
};

export type InvoiceSortField = "created_at" | "amount_lamports" | "reference";
export type InvoiceSortDirection = "asc" | "desc";
