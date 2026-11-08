import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDashboardSummary,
  DASHBOARD_ACTIVITY_LIMIT,
} from "../src/lib/dashboard/summary.ts";
import type { PaymentRequest } from "../src/lib/payment-requests/types.ts";

function paymentRequest(
  overrides: Partial<PaymentRequest> & { id: string },
): PaymentRequest {
  return {
    reference: `reference-${overrides.id}`,
    amountLamports: "1000000000",
    description: `Request ${overrides.id}`,
    customerName: null,
    customerEmail: null,
    merchantAddress: null,
    status: "pending",
    transactionSignature: null,
    payerAddress: null,
    verifiedAt: null,
    createdAt: "2026-11-05T10:00:00.000Z",
    ...overrides,
  };
}

function statValue(
  summary: ReturnType<typeof buildDashboardSummary>,
  id: string,
): string {
  const stat = summary.stats.find((candidate) => candidate.id === id);
  assert.ok(stat, `expected stat ${id}`);
  return stat.value;
}

test("sums only verified paid requests and counts lifecycle statuses correctly", () => {
  const requests = [
    paymentRequest({
      id: "paid-1",
      status: "paid",
      amountLamports: "1000000001", // 1.000000001 SOL
      transactionSignature: "signature-1",
      payerAddress: "payer-1",
      verifiedAt: "2026-11-05T11:00:00.000Z",
    }),
    paymentRequest({
      id: "paid-2",
      status: "paid",
      amountLamports: "999999999", // 0.999999999 SOL
      transactionSignature: "signature-2",
      payerAddress: "payer-2",
      verifiedAt: "2026-11-05T11:05:00.000Z",
    }),
    paymentRequest({
      id: "pending-1",
      status: "pending",
      amountLamports: "2500000000",
    }),
    paymentRequest({
      id: "expired-1",
      status: "expired",
      amountLamports: "3000000000",
    }),
    paymentRequest({
      id: "cancelled-1",
      status: "cancelled",
      amountLamports: "4000000000",
    }),
  ];

  const summary = buildDashboardSummary(requests);

  // Exact integer lamports: 1.000000001 + 0.999999999 = 2 SOL.
  assert.equal(statValue(summary, "total-received"), "2");
  assert.equal(statValue(summary, "successful-payments"), "2");
  assert.equal(statValue(summary, "pending-payments"), "1");
  assert.equal(statValue(summary, "payment-requests"), "5");
  assert.equal(summary.activity.length, 5);
});

test("a paid row without verifier evidence is not counted as received", () => {
  const requests = [
    paymentRequest({
      id: "unverified-paid",
      status: "paid",
      amountLamports: "5000000000",
    }),
    paymentRequest({
      id: "missing-payer-evidence",
      status: "paid",
      amountLamports: "7000000000",
      transactionSignature: "signature-without-payer",
      verifiedAt: "2026-11-05T11:00:00.000Z",
    }),
  ];

  const summary = buildDashboardSummary(requests);

  assert.equal(statValue(summary, "total-received"), "0");
  assert.equal(statValue(summary, "successful-payments"), "2");
  assert.equal(statValue(summary, "pending-payments"), "0");
});

test("a paid row missing only the payer address is not counted as received", () => {
  const requests = [
    paymentRequest({
      id: "missing-payer",
      status: "paid",
      amountLamports: "5000000000",
      transactionSignature: "signature-1",
      verifiedAt: "2026-11-05T11:00:00.000Z",
    }),
  ];

  const summary = buildDashboardSummary(requests);

  assert.equal(statValue(summary, "total-received"), "0");
  assert.equal(statValue(summary, "successful-payments"), "1");
  assert.equal(statValue(summary, "pending-payments"), "0");
});

test("maps activity with exact amounts, customer name and transaction data", () => {
  const requests = [
    paymentRequest({
      id: "PR-1",
      description: "Design retainer",
      customerName: "Ada Nwosu",
      amountLamports: "1234567890",
      status: "paid",
      transactionSignature: "5".repeat(88),
      payerAddress: "payer-1",
      verifiedAt: "2026-11-05T11:00:00.000Z",
      createdAt: "2026-11-05T09:30:00.000Z",
    }),
  ];

  const [row] = buildDashboardSummary(requests).activity;

  assert.deepEqual(row, {
    id: "PR-1",
    reference: "reference-PR-1",
    description: "Design retainer",
    amountSol: "1.23456789",
    customerName: "Ada Nwosu",
    status: "paid",
    createdAt: "2026-11-05T09:30:00.000Z",
    transactionSignature: "5".repeat(88),
    payerAddress: "payer-1",
  });
});

test("shows at most the most recent activity rows in repository order", () => {
  const requests = Array.from(
    { length: DASHBOARD_ACTIVITY_LIMIT + 2 },
    (_, index) =>
      paymentRequest({
        id: `PR-${index}`,
        createdAt: `2026-11-05T10:00:0${index}.000Z`,
      }),
  );

  const summary = buildDashboardSummary(requests);

  assert.equal(summary.activity.length, DASHBOARD_ACTIVITY_LIMIT);
  assert.equal(summary.activity[0]?.id, "PR-0");
  assert.equal(summary.activity.at(-1)?.id, `PR-${DASHBOARD_ACTIVITY_LIMIT - 1}`);
  assert.equal(statValue(summary, "payment-requests"), String(requests.length));
});

test("an empty database produces zero figures and no activity", () => {
  const summary = buildDashboardSummary([]);

  assert.equal(statValue(summary, "total-received"), "0");
  assert.equal(statValue(summary, "successful-payments"), "0");
  assert.equal(statValue(summary, "pending-payments"), "0");
  assert.equal(statValue(summary, "payment-requests"), "0");
  assert.deepEqual(summary.activity, []);
});
