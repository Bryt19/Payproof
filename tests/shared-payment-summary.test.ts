import assert from "node:assert/strict";
import test from "node:test";
import {
  formatSolAmount,
  summarizePayments,
} from "../telegram-bot/src/lib/payment-summary.ts";
import { buildDashboardSummary } from "../src/lib/dashboard/summary.ts";
import { buildStatusBreakdownFromRequests } from "../src/lib/dashboard/charts.ts";
import type { PaymentRequest } from "../src/lib/payment-requests/types.ts";

function request(
  id: string,
  status: PaymentRequest["status"],
  overrides: Partial<PaymentRequest> = {},
): PaymentRequest {
  return {
    id,
    reference: `reference-${id}`,
    amountLamports: "1000000000",
    description: `Request ${id}`,
    customerName: null,
    customerEmail: null,
    merchantAddress: "merchant-1",
    status,
    transactionSignature: null,
    payerAddress: null,
    verifiedAt: null,
    createdAt: "2026-11-21T10:00:00.000Z",
    ...overrides,
  };
}

const paid = (id: string, amountLamports: string) =>
  request(id, "paid", {
    amountLamports,
    transactionSignature: `signature-${id}`,
    payerAddress: "payer-1",
    verifiedAt: "2026-11-21T11:00:00.000Z",
  });

test("shared summary groups failed, cancelled and expired without inflating pending", () => {
  const requests = [
    paid("paid-1", "10000000000"),
    paid("paid-2", "7600000000"),
    request("paid-unverified", "paid", { amountLamports: "9000000000" }),
    request("pending-1", "pending"),
    request("failed-1", "failed"),
    request("cancelled-1", "cancelled"),
    request("expired-1", "expired"),
  ];

  const totals = summarizePayments(requests);

  assert.equal(totals.verifiedCount, 2);
  assert.equal(totals.verifiedLamports, 17_600_000_000n);
  assert.equal(formatSolAmount(totals.verifiedLamports), "17.6");
  assert.equal(totals.pendingCount, 1);
  assert.equal(totals.failedCount, 3);
});

test("dashboard stats and breakdown consume the same shared totals", () => {
  const requests = [
    paid("paid-1", "10000000000"),
    paid("paid-2", "7600000000"),
    request("pending-1", "pending"),
    request("failed-1", "failed"),
    request("cancelled-1", "cancelled"),
    request("expired-1", "expired"),
  ];

  const totals = summarizePayments(requests);
  const stats = Object.fromEntries(
    buildDashboardSummary(requests).stats.map((stat) => [stat.id, stat.value]),
  );
  const breakdown = buildStatusBreakdownFromRequests(requests);

  assert.equal(stats["successful-payments"], String(totals.verifiedCount));
  assert.equal(stats["pending-payments"], String(totals.pendingCount));
  assert.equal(stats["total-received"], formatSolAmount(totals.verifiedLamports));
  assert.equal(breakdown.confirmed, totals.verifiedCount);
  assert.equal(breakdown.pending, totals.pendingCount);
  assert.equal(breakdown.failedCancelled, totals.failedCount);
  assert.equal(breakdown.total, 6);
});

test("paid without verifier evidence is never confirmed or revenue", () => {
  const totals = summarizePayments([
    request("paid-no-signature", "paid"),
    request("paid-no-payer", "paid", {
      transactionSignature: "signature",
      verifiedAt: "2026-11-21T11:00:00.000Z",
    }),
  ]);

  assert.equal(totals.verifiedCount, 0);
  assert.equal(totals.verifiedLamports, 0n);
});
