/**
 * Payment request domain types.
 *
 * These shapes are deliberately flat and JSON-serialisable so the Supabase
 * row mapping and the UI share one representation. Amounts are stored as
 * integer lamports in a decimal string (never a float, never a JS bigint)
 * because JSON/SQL numerics should not lose precision.
 *
 * IMPORTANT: creating a request does not move funds and does not prove payment.
 * A request starts as `pending` and only becomes `paid` when the server-side
 * verifier confirms a matching Solana Devnet transaction. The frontend status
 * is never trustworthy on its own.
 */

export type PaymentRequestStatus = "pending" | "paid" | "expired" | "cancelled";

export type PaymentRequest = {
  /** Populated server-side from the checkout path. Frontend never writes it. */
  /** Human-facing identifier, e.g. `PR-4F9A2C71`. */
  id: string;
  /** 32-byte base58 public-key style reference that can later be used to find the payment on-chain. */
  reference: string;
  /** Exact amount in lamports, as an integer string. */
  amountLamports: string;
  description: string;
  customerName: string | null;
  customerEmail: string | null;
  /** Merchant wallet that created the request, when a wallet was connected. */
  merchantAddress: string | null;
  status: PaymentRequestStatus;
  /** Signature written only by the server-side verifier after on-chain checks pass. */
  transactionSignature: string | null;
  /** Wallet that signed the verified transaction. */
  payerAddress: string | null;
  /** ISO 8601 timestamp of the successful server verification. */
  verifiedAt: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
};

export type NewPaymentRequestInput = {
  amountLamports: string;
  description: string;
  customerName: string | null;
  customerEmail: string | null;
  /** Set server-side from the merchant's connected wallet. Not verified as ownership. */
  merchantAddress: string | null;
};

/** Checkout links are addressed by reference, not by the random request ID. */
export function getCheckoutPath(reference: string): string {
  return `/pay/${reference}`;
}
