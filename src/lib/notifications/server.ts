import { randomUUID } from "node:crypto";
import { after } from "next/server";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient } from "../payment-requests/supabase";
import type { PaymentRequest } from "../payment-requests/types";
import { formatSolExact } from "../solana/units";
import {
  readTelegramBotToken,
  sendTelegramNotificationWithRetry,
  type TelegramMessagePayload,
  type TelegramSendOptions,
} from "./telegram";
import {
  isNotificationType,
  type NotificationRecord,
  type NotificationType,
} from "./types";

export const NOTIFICATIONS_TABLE = "notifications";
export const DELIVERIES_TABLE = "notification_deliveries";
export const PREFERENCES_TABLE = "notification_preferences";

/** Shared retry budget for a single logical Telegram delivery. */
export const MAX_DELIVERY_ATTEMPTS = 3;

/** How long one worker owns a delivery row before another may reclaim it. */
const DELIVERY_LEASE_MS = 60_000;

/**
 * Defaults applied when a merchant has never saved a preference.
 * Mirrors the product contract: creation, verified payments and failed
 * payments are on; expiry and cancellation are off until explicitly enabled.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: Record<
  NotificationType,
  boolean
> = {
  payment_request_created: true,
  payment_received: true,
  payment_failed: true,
  payment_request_expired: false,
  payment_request_cancelled: false,
};

function logFailure(operation: string, error: PostgrestError): void {
  console.error(
    `[notifications] Supabase ${operation} failed: code=${error.code ?? "unknown"} message=${error.message} hint=${error.hint ?? "none"}`,
  );
}

function isUniqueViolation(error: PostgrestError): boolean {
  return error.code === "23505";
}

function mapRow(row: {
  id: string;
  merchant_address: string;
  type: string;
  title: string;
  message: string;
  payment_request_id: string | null;
  payment_request_reference: string;
  transaction_signature: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}): NotificationRecord {
  return {
    id: row.id,
    merchantAddress: row.merchant_address,
    type: row.type as NotificationType,
    title: row.title,
    message: row.message,
    paymentRequestId: row.payment_request_id,
    paymentRequestReference: row.payment_request_reference,
    transactionSignature: row.transaction_signature,
    isRead: row.is_read,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

function getClient(): SupabaseClient {
  return createSupabaseClient();
}

function amountSol(amountLamports: string): string {
  try {
    return formatSolExact(BigInt(amountLamports));
  } catch {
    return "0";
  }
}

// ---------------------------------------------------------------------------
// Preferences (database-backed, shared by the Settings page and the bot)
// ---------------------------------------------------------------------------

/** All preferences for a merchant, with documented defaults filled in. */
export async function readNotificationPreferences(
  db: SupabaseClient,
  merchantAddress: string,
): Promise<Record<NotificationType, boolean>> {
  const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };

  try {
    const { data, error } = await db
      .from(PREFERENCES_TABLE)
      .select("event_type, enabled")
      .eq("merchant_address", merchantAddress);

    if (error) {
      logFailure("read-preferences", error);
      return preferences;
    }

    for (const row of data ?? []) {
      const type = (row as { event_type?: unknown }).event_type;
      if (isNotificationType(type)) {
        preferences[type] = (row as { enabled?: unknown }).enabled === true;
      }
    }

    return preferences;
  } catch (cause) {
    console.error(
      "[notifications] read preferences threw:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return preferences;
  }
}

/** Persists one preference for one merchant. Returns false on failure. */
export async function setNotificationPreference(
  db: SupabaseClient,
  merchantAddress: string,
  eventType: NotificationType,
  enabled: boolean,
): Promise<boolean> {
  try {
    const { error } = await db.from(PREFERENCES_TABLE).upsert(
      {
        merchant_address: merchantAddress,
        event_type: eventType,
        enabled,
      },
      { onConflict: "merchant_address,event_type" },
    );

    if (error) {
      logFailure(`write-preference-${eventType}`, error);
      return false;
    }

    return true;
  } catch (cause) {
    console.error(
      "[notifications] write preference threw:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return false;
  }
}

export async function checkNotificationPreference(
  db: SupabaseClient,
  merchantAddress: string,
  eventType: NotificationType,
): Promise<boolean> {
  try {
    const { data, error } = await db
      .from(PREFERENCES_TABLE)
      .select("enabled")
      .eq("merchant_address", merchantAddress)
      .eq("event_type", eventType)
      .maybeSingle();

    if (error) {
      logFailure("check-preference", error);
      // A failed read must never be treated as consent to send.
      return false;
    }

    return data
      ? Boolean(data.enabled)
      : DEFAULT_NOTIFICATION_PREFERENCES[eventType];
  } catch {
    return false;
  }
}

export async function resolveActiveTelegramLink(
  db: SupabaseClient,
  merchantAddress: string,
): Promise<{
  id: string;
  telegram_chat_id: number;
  telegram_username: string | null;
} | null> {
  try {
    const { data, error } = await db
      .from("telegram_links")
      .select("id, telegram_chat_id, telegram_username")
      .eq("merchant_wallet_address", merchantAddress)
      .is("unlinked_at", null)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Notification insertion + delivery queuing
// ---------------------------------------------------------------------------

type NotificationInsertPayload = {
  merchant_address: string;
  type: NotificationType;
  title: string;
  message: string;
  payment_request_id: string | null;
  payment_request_reference: string;
  transaction_signature?: string | null;
};

type InsertOutcome = {
  status: "created" | "duplicate" | "error";
  id: string | null;
};

/**
 * Finds the row that caused a unique violation, so a retried payment event can
 * reuse the original notification instead of creating a second one.
 */
async function findExistingNotificationId(
  supabase: SupabaseClient,
  payload: NotificationInsertPayload,
): Promise<string | null> {
  let query = supabase
    .from(NOTIFICATIONS_TABLE)
    .select("id")
    .eq("merchant_address", payload.merchant_address)
    .eq("type", payload.type)
    .eq("payment_request_id", payload.payment_request_id);

  if (payload.transaction_signature) {
    query = query.eq("transaction_signature", payload.transaction_signature);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.id;
}

async function insertNotification(
  supabase: SupabaseClient,
  payload: NotificationInsertPayload,
): Promise<InsertOutcome> {
  const { data, error } = await supabase
    .from(NOTIFICATIONS_TABLE)
    .insert({
      merchant_address: payload.merchant_address,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      payment_request_id: payload.payment_request_id,
      payment_request_reference: payload.payment_request_reference,
      transaction_signature: payload.transaction_signature ?? null,
      is_read: false,
      read_at: null,
    })
    .select("id")
    .maybeSingle();

  if (!error) {
    return { status: "created", id: data?.id ?? null };
  }

  if (isUniqueViolation(error)) {
    return {
      status: "duplicate",
      id: await findExistingNotificationId(supabase, payload),
    };
  }

  logFailure(`insert-${payload.type}`, error);
  return { status: "error", id: null };
}

/**
 * Ensures exactly one delivery row exists for a notification.
 *
 * `notification_deliveries.notification_id` is a unique key, so a repeated
 * event (webhook retry, duplicate verification) cannot create a second
 * delivery and therefore cannot produce a second Telegram message.
 */
async function queueTelegramDelivery(
  supabase: SupabaseClient,
  input: {
    notificationId: string;
    merchantAddress: string;
    eventType: NotificationType;
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from(DELIVERIES_TABLE)
    .insert({
      notification_id: input.notificationId,
      merchant_address: input.merchantAddress,
      event_type: input.eventType,
      status: "pending",
      // The table default is 1, but budget accounting starts from zero sent
      // requests so `attempt` always equals "requests already made".
      attempt: 0,
      max_attempts: MAX_DELIVERY_ATTEMPTS,
    })
    .select("id")
    .maybeSingle();

  if (!error) {
    return data?.id ?? null;
  }

  if (isUniqueViolation(error)) {
    const { data: existing } = await supabase
      .from(DELIVERIES_TABLE)
      .select("id")
      .eq("notification_id", input.notificationId)
      .maybeSingle();
    return existing?.id ?? null;
  }

  logFailure("queue-delivery", error);
  return null;
}

type DeliveryRow = {
  notification_id: string;
  merchant_address: string;
  event_type: string;
  status: string;
  attempt: number;
  max_attempts: number;
  claim_id: string | null;
  lease_expires_at: string | null;
};

async function loadDelivery(
  db: SupabaseClient,
  notificationId: string,
): Promise<DeliveryRow | null> {
  const { data, error } = await db
    .from(DELIVERIES_TABLE)
    .select(
      "notification_id, merchant_address, event_type, status, attempt, max_attempts, claim_id, lease_expires_at",
    )
    .eq("notification_id", notificationId)
    .maybeSingle();

  if (error || !data) return null;
  return data as DeliveryRow;
}

async function loadNotificationPayload(
  db: SupabaseClient,
  notificationId: string,
): Promise<TelegramMessagePayload> {
  const { data } = await db
    .from(NOTIFICATIONS_TABLE)
    .select("payment_request_reference, transaction_signature")
    .eq("id", notificationId)
    .maybeSingle();

  return {
    reference: data?.payment_request_reference ?? "PayProof",
    transactionSignature: data?.transaction_signature ?? undefined,
  };
}

/**
 * Claims a delivery for this worker.
 *
 * Only one caller can win: the UPDATE also matches the claim the row had when
 * it was read, and a live lease held by somebody else is never stolen.
 */
async function claimDelivery(
  db: SupabaseClient,
  delivery: DeliveryRow,
  claimId: string,
): Promise<boolean> {
  if (
    delivery.lease_expires_at &&
    new Date(delivery.lease_expires_at).getTime() > Date.now()
  ) {
    return false;
  }

  const leaseExpiresAt = new Date(Date.now() + DELIVERY_LEASE_MS).toISOString();

  let query = db
    .from(DELIVERIES_TABLE)
    .update({ claim_id: claimId, lease_expires_at: leaseExpiresAt })
    .eq("notification_id", delivery.notification_id)
    .in("status", ["pending", "failed"]);

  query = delivery.claim_id
    ? query.eq("claim_id", delivery.claim_id)
    : query.is("claim_id", null);

  const { data, error } = await query.select("id");

  if (error) {
    logFailure("claim-delivery", error);
    return false;
  }

  return Boolean(data && data.length > 0);
}

/**
 * Records the outcome of a send attempt and releases the claim.
 *
 * The attempt counter is cumulative across the initial send and scheduled
 * retries, capped at the shared budget. The UPDATE is filtered by both
 * `notification_id` and `claim_id`, so a worker that lost its lease cannot
 * overwrite the result of the worker that owns the row.
 */
async function recordDeliveryOutcome(
  db: SupabaseClient,
  input: {
    notificationId: string;
    claimId: string;
    result: { attempts: number };
    outcome: {
      status: "delivered" | "failed" | "uncertain";
      telegramMessageId?: string | null;
      errorMessage?: string | null;
    };
  },
): Promise<boolean> {
  const { data: current } = await db
    .from(DELIVERIES_TABLE)
    .select("attempt, max_attempts, status")
    .eq("notification_id", input.notificationId)
    .maybeSingle();

  const newAttempt = Math.min(
    (current?.attempt ?? 0) + input.result.attempts,
    MAX_DELIVERY_ATTEMPTS
  );

  const now = new Date().toISOString();

  const update: Record<string, unknown> = {
    attempt: newAttempt,
    status: input.outcome.status,
    sent_at: now,
    claim_id: null,
    lease_expires_at: null,
    error_message: input.outcome.errorMessage ?? null,
  };

  if (input.outcome.status === "delivered") {
    update.delivered_at = now;
    update.telegram_message_id = input.outcome.telegramMessageId ?? null;
  }

  const { data: updatedRows, error } = await db
    .from(DELIVERIES_TABLE)
    .update(update)
    .eq("notification_id", input.notificationId)
    .eq("claim_id", input.claimId)
    .select("id");

  if (error) {
    logFailure("record-delivery", error);
    return false;
  }

  if (!updatedRows || updatedRows.length === 0) {
    // Another worker reclaimed the row after our lease expired.
    return false;
  }

  return true;
}

/**
 * Sends one queued Telegram notification.
 *
 * Safe by construction:
 * - re-checks the merchant preference and active link before sending,
 * - claims a lease so concurrent cron invocations cannot double-send,
 * - spends only the remaining retry budget,
 * - records delivered / failed / uncertain outcomes.
 *
 * It never throws; payment processing must not depend on Telegram.
 */
export async function deliverNotificationToTelegram(
  db: SupabaseClient,
  input: {
    notificationId: string;
    merchantAddress: string;
    eventType: NotificationType;
    payload?: TelegramMessagePayload;
    sendOptions?: TelegramSendOptions;
    /** Leave unset for the scheduled worker to spend the full budget. */
    maxAttemptsThisRun?: number;
  },
): Promise<{ performed: boolean; reason?: string }> {
  try {
    const delivery = await loadDelivery(db, input.notificationId);

    if (!delivery) {
      return { performed: false, reason: "delivery row missing" };
    }

    if (delivery.status === "delivered") {
      return { performed: false, reason: "already delivered" };
    }

    if (delivery.status === "uncertain") {
      return { performed: false, reason: "delivery outcome uncertain" };
    }

    const enabled = await checkNotificationPreference(
      db,
      input.merchantAddress,
      input.eventType,
    );

    if (!enabled) {
      await db
        .from(DELIVERIES_TABLE)
        .update({
          status: "failed",
          error_message: "notification preference disabled",
        })
        .eq("notification_id", input.notificationId)
        .neq("status", "delivered");
      return { performed: false, reason: "preference disabled" };
    }

    const link = await resolveActiveTelegramLink(db, input.merchantAddress);

    if (!link) {
      // No attempt is spent: a restored link may still deliver within budget.
      await db
        .from(DELIVERIES_TABLE)
        .update({
          status: "failed",
          error_message: "no active Telegram link",
        })
        .eq("notification_id", input.notificationId)
        .neq("status", "delivered");
      return { performed: false, reason: "no active Telegram link" };
    }

    const botToken = readTelegramBotToken();

    if (!botToken) {
      // Queued work for the scheduled worker; never consume budget.
      return { performed: false, reason: "telegram bot token unavailable" };
    }

    const remaining =
      Math.min(delivery.max_attempts, MAX_DELIVERY_ATTEMPTS) -
      (delivery.attempt ?? 0);

    if (remaining <= 0) {
      return { performed: false, reason: "retry budget exhausted" };
    }

    const claimId = randomUUID();

    if (!(await claimDelivery(db, delivery, claimId))) {
      return { performed: false, reason: "lost claim ownership" };
    }

    const payload =
      input.payload ?? (await loadNotificationPayload(db, input.notificationId));

    const maxAttempts = Math.max(
      1,
      Math.min(remaining, input.maxAttemptsThisRun ?? remaining),
    );

    const sent = await sendTelegramNotificationWithRetry({
      botToken,
      chatId: link.telegram_chat_id,
      eventType: input.eventType,
      payload,
      options: input.sendOptions,
      maxAttempts,
    });

    const outcome =
      sent.status === "delivered"
        ? {
            status: "delivered" as const,
            telegramMessageId: sent.telegramMessageId,
          }
        : sent.deliveryUncertain
          ? {
              status: "uncertain" as const,
              errorMessage: `delivery uncertain: ${sent.errorMessage}`,
            }
          : {
              status: "failed" as const,
              errorMessage: sent.errorMessage,
            };

    const recorded = await recordDeliveryOutcome(db, {
      notificationId: input.notificationId,
      claimId,
      result: { attempts: sent.attempts },
      outcome,
    });

    return recorded
      ? { performed: sent.status === "delivered" }
      : { performed: false, reason: "lost claim ownership" };
  } catch (err: unknown) {
    return {
      performed: false,
      reason: err instanceof Error ? err.message : "unknown error",
    };
  }
}

/**
 * Creates the in-app notification, then queues and (when possible) sends the
 * matching Telegram message. Every step is best-effort: payment processing
 * never fails because of notifications or Telegram.
 */
async function dispatchNotification(
  supabase: SupabaseClient,
  payload: NotificationInsertPayload,
  telegramPayload: TelegramMessagePayload,
): Promise<void> {
  const inserted = await insertNotification(supabase, payload);

  if (inserted.status === "error" || !inserted.id) {
    return;
  }

  const enabled = await checkNotificationPreference(
    supabase,
    payload.merchant_address,
    payload.type,
  );

  if (!enabled) {
    return;
  }

  await queueTelegramDelivery(supabase, {
    notificationId: inserted.id,
    merchantAddress: payload.merchant_address,
    eventType: payload.type,
  });

  // When the bot token is missing the row stays queued; the scheduled retry
  // endpoint delivers it once configuration is restored.
  if (!readTelegramBotToken()) {
    return;
  }

  const notificationId = inserted.id;

  const send = async () => {
    await deliverNotificationToTelegram(supabase, {
      notificationId,
      merchantAddress: payload.merchant_address,
      eventType: payload.type,
      payload: telegramPayload,
      // One immediate attempt only: the remaining budget belongs to the
      // scheduled worker, so payments are never held up by Telegram retries.
      maxAttemptsThisRun: 1,
    });
  };

  // The delivery row is already durable, so the payment response must not wait
  // on Telegram. `after` runs the send once the response is flushed; in a
  // non-request context (worker, script) it is not available and the send is
  // performed directly.
  try {
    after(send);
  } catch {
    await send();
  }
}

export async function createPaymentRequestCreatedNotification(
  request: PaymentRequest,
): Promise<void> {
  const merchant = request.merchantAddress?.trim();
  if (!merchant) return;

  try {
    const supabase = getClient();
    await dispatchNotification(
      supabase,
      {
        merchant_address: merchant,
        type: "payment_request_created",
        title: "Payment request created",
        message: `Request ${request.id} for ${amountSol(request.amountLamports)} SOL is ready to share.`,
        payment_request_id: request.id,
        payment_request_reference: request.reference,
      },
      {
        reference: request.reference,
        amountLamports: request.amountLamports,
      },
    );
  } catch (cause) {
    console.error(
      "[notifications] Could not create payment_request_created notification:",
      cause instanceof Error ? cause.message : "unknown error",
    );
  }
}

export async function createPaymentReceivedNotification(input: {
  merchantAddress: string;
  paymentRequestId: string;
  paymentRequestReference: string;
  amountLamports: string;
  transactionSignature: string;
}): Promise<void> {
  const merchant = input.merchantAddress.trim();
  if (!merchant) return;

  try {
    const supabase = getClient();
    await dispatchNotification(
      supabase,
      {
        merchant_address: merchant,
        type: "payment_received",
        title: "Payment received",
        message: `Verified ${amountSol(input.amountLamports)} SOL for request ${input.paymentRequestId}.`,
        payment_request_id: input.paymentRequestId,
        payment_request_reference: input.paymentRequestReference,
        transaction_signature: input.transactionSignature,
      },
      {
        reference: input.paymentRequestReference,
        amountLamports: input.amountLamports,
        transactionSignature: input.transactionSignature,
      },
    );
  } catch (cause) {
    console.error(
      "[notifications] Could not create payment_received notification:",
      cause instanceof Error ? cause.message : "unknown error",
    );
  }
}

export async function createPaymentFailedNotification(input: {
  merchantAddress: string;
  paymentRequestId: string;
  paymentRequestReference: string;
  amountLamports: string;
}): Promise<void> {
  const merchant = input.merchantAddress.trim();
  if (!merchant) return;

  try {
    const supabase = getClient();
    await dispatchNotification(
      supabase,
      {
        merchant_address: merchant,
        type: "payment_failed",
        title: "Payment failed",
        message: `Request ${input.paymentRequestReference} for ${amountSol(input.amountLamports)} SOL failed after repeated wallet rejections. The payment was not completed.`,
        payment_request_id: input.paymentRequestId,
        payment_request_reference: input.paymentRequestReference,
      },
      {
        reference: input.paymentRequestReference,
        amountLamports: input.amountLamports,
        status: "Failed",
      },
    );
  } catch (cause) {
    console.error(
      "[notifications] Could not create payment_failed notification:",
      cause instanceof Error ? cause.message : "unknown error",
    );
  }
}

export async function createPaymentRequestStatusNotification(input: {
  merchantAddress: string;
  paymentRequestId: string;
  paymentRequestReference: string;
  status: "expired" | "cancelled";
}): Promise<void> {
  const merchant = input.merchantAddress.trim();
  if (!merchant) return;

  const type: NotificationType =
    input.status === "expired"
      ? "payment_request_expired"
      : "payment_request_cancelled";
  const title =
    input.status === "expired"
      ? "Payment request expired"
      : "Payment request cancelled";
  const message =
    input.status === "expired"
      ? `Request ${input.paymentRequestId} expired before payment was verified.`
      : `Request ${input.paymentRequestId} was cancelled.`;

  try {
    const supabase = getClient();
    await dispatchNotification(
      supabase,
      {
        merchant_address: merchant,
        type,
        title,
        message,
        payment_request_id: input.paymentRequestId,
        payment_request_reference: input.paymentRequestReference,
      },
      { reference: input.paymentRequestReference },
    );
  } catch (cause) {
    console.error(
      `[notifications] Could not create ${type} notification:`,
      cause instanceof Error ? cause.message : "unknown error",
    );
  }
}

// ---------------------------------------------------------------------------
// In-app notification reads
// ---------------------------------------------------------------------------

export type ListNotificationsResult =
  | { ok: true; notifications: readonly NotificationRecord[]; unreadCount: number }
  | { ok: false; message: string };

export async function listNotificationsForMerchant(input: {
  merchantAddress: string;
  filter?: "all" | "unread" | "read";
  type?: NotificationType | null;
  limit?: number;
}): Promise<ListNotificationsResult> {
  const merchant = input.merchantAddress.trim();
  if (!merchant) {
    return { ok: true, notifications: [], unreadCount: 0 };
  }

  try {
    const supabase = getClient();
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);

    let query = supabase
      .from(NOTIFICATIONS_TABLE)
      .select("*")
      .eq("merchant_address", merchant)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (input.filter === "unread") query = query.eq("is_read", false);
    if (input.filter === "read") query = query.eq("is_read", true);
    if (input.type) query = query.eq("type", input.type);

    const { data, error } = await query;
    if (error) {
      logFailure("list", error);
      return { ok: false, message: "Could not load notifications." };
    }

    const { count, error: countError } = await supabase
      .from(NOTIFICATIONS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("merchant_address", merchant)
      .eq("is_read", false);

    if (countError) {
      logFailure("count-unread", countError);
    }

    return {
      ok: true,
      notifications: (data ?? []).map(mapRow),
      unreadCount: count ?? (data ?? []).filter((row) => !row.is_read).length,
    };
  } catch (cause) {
    console.error(
      "[notifications] Unexpected list failure:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return { ok: false, message: "Could not load notifications." };
  }
}

export async function markNotificationRead(input: {
  id: string;
  merchantAddress: string;
}): Promise<{ ok: true } | { ok: false; message: string; notFound?: boolean }> {
  const merchant = input.merchantAddress.trim();
  if (!merchant) return { ok: false, message: "Merchant address is required." };

  try {
    const supabase = getClient();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from(NOTIFICATIONS_TABLE)
      .update({ is_read: true, read_at: now })
      .eq("id", input.id)
      .eq("merchant_address", merchant)
      .select("id")
      .maybeSingle();

    if (error) {
      logFailure("mark-read", error);
      return { ok: false, message: "Could not update the notification." };
    }

    if (!data) {
      return { ok: false, message: "Notification not found.", notFound: true };
    }

    return { ok: true };
  } catch (cause) {
    console.error(
      "[notifications] Unexpected mark-read failure:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return { ok: false, message: "Could not update the notification." };
  }
}

export async function markAllNotificationsRead(input: {
  merchantAddress: string;
}): Promise<{ ok: true; updated: number } | { ok: false; message: string }> {
  const merchant = input.merchantAddress.trim();
  if (!merchant) return { ok: false, message: "Merchant address is required." };

  try {
    const supabase = getClient();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from(NOTIFICATIONS_TABLE)
      .update({ is_read: true, read_at: now })
      .eq("merchant_address", merchant)
      .eq("is_read", false)
      .select("id");

    if (error) {
      logFailure("mark-all-read", error);
      return { ok: false, message: "Could not update notifications." };
    }

    return { ok: true, updated: (data ?? []).length };
  } catch (cause) {
    console.error(
      "[notifications] Unexpected mark-all-read failure:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return { ok: false, message: "Could not update notifications." };
  }
}
