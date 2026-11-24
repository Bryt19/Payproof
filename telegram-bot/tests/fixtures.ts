import type { PayProofData, StoredPayment } from "../src/lib/payproof.js";

/** Shared, deterministic fixtures for bot handler tests. No network, no DB. */

export const CHAT_ID = 42;
export const CALLBACK_ID = "cb-1";
export const FROM = { id: 42, is_bot: false, first_name: "Merchant" };

export const LINKED_AT = "2026-11-18T09:30:00.000Z";
export const MERCHANT_WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
export const OTHER_MERCHANT_WALLET = "8h7YwLrTQAg8PtEPibhRZfKgWgXKjYFtiys5yqNg8fXW";

export const ACTIVE_LINK = {
  merchantAddress: MERCHANT_WALLET,
  telegramUserId: FROM.id,
  telegramChatId: CHAT_ID,
  linkedAt: LINKED_AT,
};

const VERIFIED_PAYMENT: StoredPayment = {
  id: "PR-11111111",
  reference: "7h7YwLrTQAg8PtEPibhRZfKgWgXKjYFtiys5yqNg8fXW",
  amountLamports: "2500000000",
  description: "Invoice 1042",
  customerName: null,
  status: "paid",
  transactionSignature: "5Xk9nYq3vBd1mWf7Rp2sLu8Ga4tHc6Je0Ny1Qb3Vd5Zx",
  payerAddress: OTHER_MERCHANT_WALLET,
  verifiedAt: "2026-11-18T10:00:00.000Z",
  createdAt: "2026-11-18T09:00:00.000Z",
};

const PENDING_PAYMENT: StoredPayment = {
  id: "PR-22222222",
  reference: "3xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFi",
  amountLamports: "1500000000",
  description: "Invoice 1043",
  customerName: null,
  status: "pending",
  transactionSignature: null,
  payerAddress: null,
  verifiedAt: null,
  createdAt: "2026-11-18T11:00:00.000Z",
};

/** A PayProofData stub that never touches the network. */
export function fakeData(overrides: Partial<PayProofData> = {}): PayProofData {
  return {
    getSummary: async () => ({
      ok: true,
      data: {
        verifiedCount: 1,
        verifiedLamports: 2_500_000_000n,
        pendingCount: 1,
        failedCount: 0,
      },
    }),
    getRecentVerified: async () => ({ ok: true, data: [VERIFIED_PAYMENT] }),
    getRecentTransactions: async () => ({ ok: true, data: [VERIFIED_PAYMENT] }),
    getPending: async () => ({ ok: true, data: [PENDING_PAYMENT] }),
    getVerifiedReceipt: async (_merchant, reference) => ({
      ok: true,
      data: reference === VERIFIED_PAYMENT.reference ? VERIFIED_PAYMENT : null,
    }),
    ...overrides,
  };
}
