import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient } from "../payment-requests/supabase";
import type { PaymentRequest } from "../payment-requests/types";
import { formatSolExact } from "../solana/units";
import type { NotificationRecord, NotificationType } from "./types";

export const NOTIFICATIONS_TABLE = "notifications";

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

async function insertNotification(
  supabase: SupabaseClient,
  payload: {
    merchant_address: string;
    type: NotificationType;
    title: string;
    message: string;
    payment_request_id: string | null;
    payment_request_reference: string;
    transaction_signature?: string | null;
  },
): Promise<"created" | "duplicate" | "error"> {
  const { error } = await supabase.from(NOTIFICATIONS_TABLE).insert({
    merchant_address: payload.merchant_address,
    type: payload.type,
    title: payload.title,
    message: payload.message,
    payment_request_id: payload.payment_request_id,
    payment_request_reference: payload.payment_request_reference,
    transaction_signature: payload.transaction_signature ?? null,
    is_read: false,
    read_at: null,
  });

  if (!error) return "created";
  if (isUniqueViolation(error)) return "duplicate";

  logFailure(`insert-${payload.type}`, error);
  return "error";
}

export async function createPaymentRequestCreatedNotification(
  request: PaymentRequest,
): Promise<void> {
  const merchant = request.merchantAddress?.trim();
  if (!merchant) return;

  try {
    const supabase = getClient();
    await insertNotification(supabase, {
      merchant_address: merchant,
      type: "payment_request_created",
      title: "Payment request created",
      message: `Request ${request.id} for ${amountSol(request.amountLamports)} SOL is ready to share.`,
      payment_request_id: request.id,
      payment_request_reference: request.reference,
    });
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
    await insertNotification(supabase, {
      merchant_address: merchant,
      type: "payment_received",
      title: "Payment received",
      message: `Verified ${amountSol(input.amountLamports)} SOL for request ${input.paymentRequestId}.`,
      payment_request_id: input.paymentRequestId,
      payment_request_reference: input.paymentRequestReference,
      transaction_signature: input.transactionSignature,
    });
  } catch (cause) {
    console.error(
      "[notifications] Could not create payment_received notification:",
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
    await insertNotification(supabase, {
      merchant_address: merchant,
      type,
      title,
      message,
      payment_request_id: input.paymentRequestId,
      payment_request_reference: input.paymentRequestReference,
    });
  } catch (cause) {
    console.error(
      `[notifications] Could not create ${type} notification:`,
      cause instanceof Error ? cause.message : "unknown error",
    );
  }
}

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
