import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTEMPT_TOKEN_TTL_MS,
  isAttemptIssuableStatus,
  mapAttemptIssuanceResponse,
  mapAttemptRejectionResponse,
} from "../src/lib/payment-requests/attempt-responses.ts";

test("a third rejection maps to the failed request state", () => {
  const mapped = mapAttemptRejectionResponse({
    success: true,
    recorded: true,
    attempt: { result: "rejected" },
    payment_request: { status: "failed", rejection_count: 3 },
    rejection_count: 3,
  });

  assert.deepEqual(mapped, {
    ok: true,
    recorded: true,
    status: "failed",
    rejectionCount: 3,
    attemptResult: "rejected",
  });
});

test("a first or second rejection maps to the pending request state", () => {
  const mapped = mapAttemptRejectionResponse({
    success: true,
    recorded: true,
    attempt: { result: "rejected" },
    payment_request: { status: "pending", rejection_count: 2 },
    rejection_count: 2,
  });

  assert.equal(mapped.ok, true);
  if (!mapped.ok) return;
  assert.equal(mapped.status, "pending");
  assert.equal(mapped.rejectionCount, 2);
  assert.equal(mapped.attemptResult, "rejected");
});

test("a rejection on a non-pending request is reported as not recorded", () => {
  const mapped = mapAttemptRejectionResponse({
    success: true,
    recorded: false,
    reason: "request-not-pending",
    attempt: { result: "pending", invalidated_at: "2026-11-21T12:00:00.000Z" },
    payment_request: { status: "failed", rejection_count: 3 },
    rejection_count: 3,
  });

  assert.equal(mapped.ok, true);
  if (!mapped.ok) return;
  assert.equal(mapped.recorded, false);
  assert.equal(mapped.status, "failed");
  assert.equal(mapped.rejectionCount, 3);
});

test("RPC rejection error payloads are never reported as success", () => {
  const payloads: unknown[] = [
    {
      success: false,
      error: { message: "Attempt has already been consumed." },
    },
    { error: "Attempt has already been consumed." },
    { success: "true", attempt: { result: "rejected" } },
    null,
    undefined,
    [],
  ];

  for (const payload of payloads) {
    assert.deepEqual(mapAttemptRejectionResponse(payload), {
      ok: false,
      reason: "refused",
    });
  }
});

test("issuance succeeds only when the RPC stored an attempt", () => {
  const mapped = mapAttemptIssuanceResponse({
    success: true,
    attempt: { id: "attempt-1" },
    status: "failed",
    rejection_count: 3,
  });

  assert.equal(mapped.ok, true);
  if (!mapped.ok) return;
  assert.equal(mapped.status, "failed");
  assert.equal(mapped.rejectionCount, 3);
  assert.deepEqual(mapped.attempt, { id: "attempt-1" });
});

test("issuance error payloads never produce a token response", () => {
  const payloads: unknown[] = [
    {
      success: false,
      error: {
        message:
          "Attempt limit exceeded: maximum 5 attempts per 24 hours per payment request.",
      },
    },
    { success: true },
    { success: true, attempt: null },
    { success: true, attempt: [] },
    { success: true, attempt: "attempt-1" },
    null,
  ];

  for (const payload of payloads) {
    assert.deepEqual(mapAttemptIssuanceResponse(payload), {
      ok: false,
      reason: "refused",
    });
  }
});

test("pending and failed requests both accept attempt issuance", () => {
  for (const status of ["pending", "failed"] as const) {
    assert.equal(isAttemptIssuableStatus(status), true);

    const mapped = mapAttemptIssuanceResponse({
      success: true,
      attempt: { id: `attempt-${status}` },
      status,
      rejection_count: status === "failed" ? 3 : 0,
    });

    assert.equal(mapped.ok, true);
    if (!mapped.ok) continue;
    assert.equal(mapped.status, status);
    assert.equal(mapped.rejectionCount, status === "failed" ? 3 : 0);
  }
});

test("attempt tokens expire 15 minutes after issuance", () => {
  assert.equal(ATTEMPT_TOKEN_TTL_MS, 15 * 60 * 1000);
});

test("failed requests accept recovery attempts while closed requests do not", () => {
  assert.equal(isAttemptIssuableStatus("pending"), true);
  assert.equal(isAttemptIssuableStatus("failed"), true);
  assert.equal(isAttemptIssuableStatus("paid"), false);
  assert.equal(isAttemptIssuableStatus("expired"), false);
  assert.equal(isAttemptIssuableStatus("cancelled"), false);
  assert.equal(isAttemptIssuableStatus("unknown"), false);
  assert.equal(isAttemptIssuableStatus(null), false);
  assert.equal(isAttemptIssuableStatus(undefined), false);
});
