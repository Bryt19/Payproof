import assert from "node:assert/strict";
import test from "node:test";
import {
  BREAKDOWN_COLORS,
  buildStatusBreakdownFromRequests,
} from "../src/lib/dashboard/charts.ts";
import type { PaymentRequest } from "../src/lib/payment-requests/types.ts";

function request(
  overrides: Partial<PaymentRequest> & { id: string },
): PaymentRequest {
  return {
    reference: `reference-${overrides.id}`,
    amountLamports: "1000000000",
    description: `Request ${overrides.id}`,
    customerName: null,
    customerEmail: null,
    merchantAddress: "merchant",
    status: "pending",
    transactionSignature: null,
    payerAddress: null,
    verifiedAt: null,
    createdAt: "2026-11-20T10:00:00.000Z",
    ...overrides,
  };
}

function verifiedPaid(overrides: Partial<PaymentRequest> & { id: string }) {
  return request({
    status: "paid",
    transactionSignature: `signature-${overrides.id}`,
    payerAddress: "payer",
    verifiedAt: "2026-11-20T11:00:00.000Z",
    ...overrides,
  });
}

test("breakdown folds failed, cancelled and expired into failed/cancelled", () => {
  const breakdown = buildStatusBreakdownFromRequests([
    verifiedPaid({ id: "paid-1" }),
    verifiedPaid({ id: "paid-2" }),
    request({ id: "pending-1", status: "pending" }),
    request({ id: "failed-1", status: "failed" }),
    request({ id: "failed-2", status: "failed" }),
    request({ id: "cancelled-1", status: "cancelled" }),
    request({ id: "expired-1", status: "expired" }),
    request({ id: "expired-2", status: "expired" }),
  ]);

  assert.deepEqual(
    {
      confirmed: breakdown.confirmed,
      pending: breakdown.pending,
      failedCancelled: breakdown.failedCancelled,
      total: breakdown.total,
    },
    { confirmed: 2, pending: 1, failedCancelled: 5, total: 8 },
  );

  // Expired requests count inside failed/cancelled, not as a fourth category.
  assert.equal(breakdown.failedCancelledPct, 63);
  assert.equal(breakdown.pendingPct, 13);
  assert.equal(breakdown.confirmedPct, 25);
});

test("failed/cancelled uses red and the other categories keep their colors", () => {
  assert.equal(BREAKDOWN_COLORS.failedCancelled, "#EF4444");
  assert.equal(BREAKDOWN_COLORS.confirmed, "#14F195");
  assert.equal(BREAKDOWN_COLORS.pending, "#fbbf24");
});
