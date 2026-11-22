import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEFAULT_NOTIFICATION_PREFERENCES } from "../src/lib/notifications/server.ts";
import { shouldNotifyPaymentFailed } from "../src/lib/notifications/payment-failed.ts";
import { buildTelegramNotificationText } from "../src/lib/notifications/telegram.ts";
import { isNotificationType } from "../src/lib/notifications/types.ts";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261121180000_payment_failed_notifications.sql",
    import.meta.url,
  ),
  "utf8",
);

// ---------------------------------------------------------------------------
// Transition guard
// ---------------------------------------------------------------------------

test("only the third recorded rejection that flips pending to failed notifies", () => {
  // First and second rejections leave the request pending.
  assert.equal(
    shouldNotifyPaymentFailed({
      previousStatus: "pending",
      updatedStatus: "pending",
      rejectionRecorded: true,
    }),
    false,
  );

  // The third rejection is the transition.
  assert.equal(
    shouldNotifyPaymentFailed({
      previousStatus: "pending",
      updatedStatus: "failed",
      rejectionRecorded: true,
    }),
    true,
  );
});

test("replayed callbacks and non-transitions never notify", () => {
  for (const input of [
    // Duplicate callback: RPC refuses to count an already-consumed attempt.
    { previousStatus: "pending", updatedStatus: "failed", rejectionRecorded: false },
    // Rejection arriving after the request already closed.
    { previousStatus: "failed", updatedStatus: "failed", rejectionRecorded: false },
    { previousStatus: "paid", updatedStatus: "paid", rejectionRecorded: false },
    { previousStatus: "cancelled", updatedStatus: "cancelled", rejectionRecorded: true },
    { previousStatus: "expired", updatedStatus: "expired", rejectionRecorded: true },
  ]) {
    assert.equal(shouldNotifyPaymentFailed(input), false);
  }
});

// ---------------------------------------------------------------------------
// Preference + message
// ---------------------------------------------------------------------------

test("payment failed is a notification type enabled by default", () => {
  assert.equal(isNotificationType("payment_failed"), true);
  assert.equal(DEFAULT_NOTIFICATION_PREFERENCES.payment_failed, true);
});

test("failed message carries reference, amount, status and non-completion", () => {
  const text = buildTelegramNotificationText("payment_failed", {
    reference: "PP-FAILED123",
    amountLamports: "1500000000",
    status: "Failed",
  });

  assert.match(text, /Payment failed/);
  assert.match(text, /PP\\\-FAILED123/);
  assert.match(text, /1\\\.5 SOL/);
  assert.match(text, /Status:\* Failed/);
  assert.match(text, /not completed/i);
  assert.doesNotMatch(text, /Payment verified/);
});

// ---------------------------------------------------------------------------
// Database support
// ---------------------------------------------------------------------------

test("the migration allows payment_failed for every notification table", () => {
  assert.match(
    migration,
    /notifications_type_check[\s\S]*?'payment_failed'/,
  );
  assert.match(
    migration,
    /notification_preferences_event_type_check[\s\S]*?'payment_failed'/,
  );
  assert.match(
    migration,
    /notification_deliveries_event_type_check[\s\S]*?'payment_failed'/,
  );
});

test("the migration dedupes failed notifications per payment request", () => {
  assert.match(
    migration,
    /create unique index if not exists notifications_unique_payment_failed\s+on notifications \(payment_request_id, type\)\s+where type = 'payment_failed'/i,
  );
});
