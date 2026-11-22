import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  expirationCutoff,
  expiresAtFor,
  isRequestExpired,
} from "../src/lib/payment-requests/expiration";
import {
  canCancelStatus,
  cancelPaymentRequest,
} from "../src/lib/payment-requests/cancel";
import {
  bucketForStatus,
  matchesStatusBucket,
} from "../src/lib/payment-requests/status-bucket";
import { statusesForPaymentFilter } from "../src/lib/payments/repository";
import { buildDashboardSummary } from "../src/lib/dashboard/summary";
import {
  recordWalletRejection,
  requestPaymentAttempt,
  shouldRecordWalletRejection,
} from "../src/lib/payment-requests/attempt-client";
import type { PaymentRequest } from "../src/lib/payment-requests/types";

// ---------------------------------------------------------------------------
// Wallet rejection tracking (client contract)
// ---------------------------------------------------------------------------

test("only a genuine wallet rejection is recorded", () => {
  assert.equal(shouldRecordWalletRejection("rejected"), true);
  assert.equal(shouldRecordWalletRejection("failed"), false);
  assert.equal(shouldRecordWalletRejection("insufficient"), false);
});

test("attempt issuance posts to the per-reference endpoint", async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify({
        success: true,
        attempt: { token: "dG9rZW4=", expiresAt: "2026-11-21T12:15:00.000Z" },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const result = await requestPaymentAttempt("RefABC", fetchImpl);

  assert.deepEqual(result, {
    token: "dG9rZW4=",
    expiresAt: "2026-11-21T12:15:00.000Z",
  });
  assert.equal(calls[0], "/api/payment-requests/RefABC/attempt");
});

test("attempt issuance failures never break payment", async () => {
  const rejectedStatus = (async () =>
    new Response(JSON.stringify({ error: "nope" }), {
      status: 429,
    })) as unknown as typeof fetch;
  const networkError = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  const malformed = (async () =>
    new Response("not json", { status: 200 })) as unknown as typeof fetch;

  assert.equal(await requestPaymentAttempt("RefABC", rejectedStatus), null);
  assert.equal(await requestPaymentAttempt("RefABC", networkError), null);
  assert.equal(await requestPaymentAttempt("RefABC", malformed), null);
});

test("rejection recording returns the authoritative server count", async () => {
  let sentBody = "";
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    sentBody = String(init?.body ?? "");
    return new Response(
      JSON.stringify({
        success: true,
        recorded: true,
        paymentRequest: { status: "failed", rejectionCount: 3 },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  const outcome = await recordWalletRejection("RefABC", "dG9rZW4=", fetchImpl);

  assert.deepEqual(outcome, {
    recorded: true,
    status: "failed",
    rejectionCount: 3,
  });
  assert.deepEqual(JSON.parse(sentBody), { token: "dG9rZW4=" });
});

test("a replayed/refused rejection result is not reported as recorded", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ success: false }), {
      status: 409,
    })) as unknown as typeof fetch;

  assert.equal(
    await recordWalletRejection("RefABC", "dG9rZW4=", fetchImpl),
    null,
  );
});

// ---------------------------------------------------------------------------
// Expiration
// ---------------------------------------------------------------------------

const CREATED = "2026-11-20T12:00:00.000Z";
const CREATED_MS = new Date(CREATED).getTime();
const TEST_TTL_MS = 24 * 60 * 60 * 1000;

test("a pending request expires after the configured lifetime", () => {
  assert.equal(
    isRequestExpired(
      { status: "pending", createdAt: CREATED },
      CREATED_MS + TEST_TTL_MS - 1,
      TEST_TTL_MS,
    ),
    false,
  );
  assert.equal(
    isRequestExpired(
      { status: "pending", createdAt: CREATED },
      CREATED_MS + TEST_TTL_MS,
      TEST_TTL_MS,
    ),
    true,
  );
});

test("automatic expiry is disabled unless a lifetime is configured", () => {
  const longAfter = CREATED_MS + TEST_TTL_MS * 30;

  assert.equal(
    isRequestExpired({ status: "pending", createdAt: CREATED }, longAfter, 0),
    false,
  );
  assert.equal(expiresAtFor(CREATED, 0), null);
  assert.equal(expirationCutoff(longAfter, 0), null);
});

test("terminal statuses are never expired", () => {
  const now = CREATED_MS + TEST_TTL_MS * 10;

  for (const status of ["paid", "failed", "cancelled", "expired"] as const) {
    assert.equal(
      isRequestExpired({ status, createdAt: CREATED }, now, TEST_TTL_MS),
      false,
    );
  }
});

test("invalid timestamps are not treated as expired", () => {
  assert.equal(
    isRequestExpired({ status: "pending", createdAt: "not-a-date" }),
    false,
  );
});

test("expiry timestamp and cutoff match the lifetime", () => {
  assert.equal(
    expiresAtFor(CREATED, TEST_TTL_MS),
    new Date(CREATED_MS + TEST_TTL_MS).toISOString(),
  );
  assert.equal(
    expirationCutoff(CREATED_MS, TEST_TTL_MS),
    new Date(CREATED_MS - TEST_TTL_MS).toISOString(),
  );
});

// ---------------------------------------------------------------------------
// Cancellation policy
// ---------------------------------------------------------------------------

test("only pending and failed requests are cancellable", () => {
  assert.equal(canCancelStatus("pending"), true);
  assert.equal(canCancelStatus("failed"), true);
  assert.equal(canCancelStatus("paid"), false);
  assert.equal(canCancelStatus("expired"), false);
  assert.equal(canCancelStatus("cancelled"), false);
});

type Row = {
  id: string;
  reference: string;
  status: string;
  merchant_address: string | null;
};

/**
 * Minimal PostgREST chain used by cancelPaymentRequest:
 *   select(...).eq(...).maybeSingle()
 *   update(...).eq(...).in(...).is(...).select("id")
 */
function createCancelSupabase(
  initial: Row | null,
  options: {
    updateMatches?: boolean;
    statusAfterFailedUpdate?: string;
    selectError?: { code?: string; message: string } | null;
  } = {},
) {
  let current = initial;
  const updates: Record<string, unknown>[] = [];

  const supabase = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: current,
                  error: options.selectError ?? null,
                }),
              };
            },
          };
        },
        update(values: Record<string, unknown>) {
          updates.push(values);
          return {
            eq() {
              return {
                in() {
                  return {
                    is() {
                      return {
                        select: async () => {
                          const matches = options.updateMatches !== false;
                          if (matches) {
                            if (current) {
                              current = {
                                ...current,
                                status: String(values.status ?? current.status),
                              };
                            }
                            return { data: [{ id: current?.id ?? "id" }], error: null };
                          }

                          if (current && options.statusAfterFailedUpdate) {
                            current = {
                              ...current,
                              status: options.statusAfterFailedUpdate,
                            };
                          }
                          return { data: [], error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    updates,
  };

  return supabase as unknown as SupabaseClient & {
    updates: Record<string, unknown>[];
  };
}

const PENDING_ROW: Row = {
  id: "PR-1",
  reference: "RefOne",
  status: "pending",
  merchant_address: "MerchantWallet111",
};

test("the owning merchant can cancel a pending request", async () => {
  const db = createCancelSupabase(PENDING_ROW);

  const result = await cancelPaymentRequest({
    reference: "RefOne",
    merchantAddress: "MerchantWallet111",
    supabase: db,
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.alreadyCancelled, false);
  assert.equal(db.updates.length, 1);
  assert.equal(db.updates[0].status, "cancelled");
});

test("a failed request can be explicitly cancelled", async () => {
  const db = createCancelSupabase({ ...PENDING_ROW, status: "failed" });

  const result = await cancelPaymentRequest({
    reference: "RefOne",
    merchantAddress: "MerchantWallet111",
    supabase: db,
  });

  assert.equal(result.ok, true);
});

test("another merchant cannot cancel the request", async () => {
  const db = createCancelSupabase(PENDING_ROW);

  const result = await cancelPaymentRequest({
    reference: "RefOne",
    merchantAddress: "SomeoneElse",
    supabase: db,
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, 403);
  assert.equal(db.updates.length, 0);
});

test("paid and expired requests are refused", async () => {
  for (const status of ["paid", "expired"] as const) {
    const db = createCancelSupabase({ ...PENDING_ROW, status });
    const result = await cancelPaymentRequest({
      reference: "RefOne",
      merchantAddress: "MerchantWallet111",
      supabase: db,
    });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, 409);
    assert.equal(db.updates.length, 0);
  }
});

test("cancelling an already cancelled request is idempotent", async () => {
  const db = createCancelSupabase({ ...PENDING_ROW, status: "cancelled" });

  const result = await cancelPaymentRequest({
    reference: "RefOne",
    merchantAddress: "MerchantWallet111",
    supabase: db,
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.alreadyCancelled, true);
});

test("a method has no ownership check bypass when the row lacks a wallet", async () => {
  const db = createCancelSupabase({ ...PENDING_ROW, merchant_address: null });

  const result = await cancelPaymentRequest({
    reference: "RefOne",
    merchantAddress: "",
    supabase: db,
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, 403);
});

test("verification winning the race blocks cancellation", async () => {
  const db = createCancelSupabase(PENDING_ROW, {
    updateMatches: false,
    statusAfterFailedUpdate: "paid",
  });

  const result = await cancelPaymentRequest({
    reference: "RefOne",
    merchantAddress: "MerchantWallet111",
    supabase: db,
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, 409);
  assert.equal(!result.ok && result.message, "A verified payment cannot be cancelled.");
});

// ---------------------------------------------------------------------------
// Dashboard / filter consistency
// ---------------------------------------------------------------------------

test("the failed bucket includes failed, expired and cancelled", () => {
  for (const status of ["failed", "expired", "cancelled"] as const) {
    assert.equal(matchesStatusBucket(status, "failed"), true);
    assert.equal(bucketForStatus(status), "failed");
  }

  assert.equal(matchesStatusBucket("paid", "failed"), false);
  assert.equal(matchesStatusBucket("pending", "pending"), true);
  assert.equal(matchesStatusBucket("failed", "all"), true);
});

test("the payments API failed filter maps to all three closed statuses", () => {
  assert.deepEqual(statusesForPaymentFilter("failed"), [
    "failed",
    "expired",
    "cancelled",
  ]);
  assert.deepEqual(statusesForPaymentFilter("paid"), ["paid"]);
  assert.deepEqual(statusesForPaymentFilter("pending"), ["pending"]);
  assert.equal(statusesForPaymentFilter("all"), null);
});

function request(overrides: Partial<PaymentRequest>): PaymentRequest {
  return {
    id: "PR",
    reference: "Ref",
    amountLamports: "1000000000",
    description: "Payment",
    customerName: null,
    customerEmail: null,
    merchantAddress: "MerchantWallet111",
    status: "pending",
    transactionSignature: null,
    payerAddress: null,
    verifiedAt: null,
    createdAt: CREATED,
    ...overrides,
  };
}

test("dashboard counts pending/paid and excludes closed requests from revenue", () => {
  const requests = [
    request({ id: "p1", status: "pending" }),
    request({
      id: "paid-1",
      status: "paid",
      transactionSignature: "sig",
      payerAddress: "payer",
      verifiedAt: "2026-11-20T13:00:00.000Z",
    }),
    request({ id: "failed-1", status: "failed" }),
    request({ id: "cancelled-1", status: "cancelled" }),
    request({ id: "expired-1", status: "expired" }),
  ];

  const summary = buildDashboardSummary(requests);
  const byId = Object.fromEntries(summary.stats.map((stat) => [stat.id, stat]));

  assert.equal(byId["pending-payments"].value, "1");
  assert.equal(byId["successful-payments"].value, "1");
  assert.equal(byId["total-received"].value, "1");
  assert.equal(byId["payment-requests"].value, "5");

  // Every status remains visible in recent activity with its real value.
  assert.deepEqual(
    summary.activity.map((row) => row.status),
    ["pending", "paid", "failed", "cancelled", "expired"],
  );
});
