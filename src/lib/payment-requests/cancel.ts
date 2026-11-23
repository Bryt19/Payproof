import type { SupabaseClient } from "@supabase/supabase-js";
import { createPaymentRequestStatusNotification } from "../notifications/server";
import { createSupabaseClient, SUPABASE_TABLE } from "./supabase";
import type { PaymentRequestStatus } from "./types";

/**
 * Server-side payment request cancellation.
 *
 * Policy (deliberate and explicit — status is never silently overwritten):
 *   - pending  -> cancelled  : allowed
 *   - failed   -> cancelled  : allowed, because the merchant is explicitly
 *                              closing a request that already exhausted its
 *                              attempts. `rejection_count` is preserved.
 *   - paid                   : refused, money was verified on-chain.
 *   - expired                : refused; expired is not the same as cancelled.
 *   - cancelled              : idempotent success.
 *
 * Only the merchant wallet recorded on the request may cancel it, and the
 * transition is a conditional UPDATE so a concurrent on-chain verification
 * always wins over cancellation.
 */

export const CANCELLABLE_STATUSES: readonly PaymentRequestStatus[] = [
  "pending",
  "failed",
];

export function canCancelStatus(
  status: PaymentRequestStatus | string | null | undefined,
): boolean {
  return status === "pending" || status === "failed";
}

export type CancelPaymentRequestResult =
  | { ok: true; status: "cancelled"; alreadyCancelled: boolean }
  | {
      ok: false;
      code: 403 | 404 | 409 | 503;
      message: string;
    };

type RequestRow = {
  id: string;
  reference: string;
  status: string;
  merchant_address: string | null;
  amount_lamports?: string | null;
};

export async function cancelPaymentRequest(input: {
  reference: string;
  merchantAddress: string;
  supabase?: SupabaseClient;
}): Promise<CancelPaymentRequestResult> {
  let supabase: SupabaseClient;

  try {
    supabase = input.supabase ?? createSupabaseClient();
  } catch {
    return {
      ok: false,
      code: 503,
      message: "Cancellation is unavailable because the server is not configured.",
    };
  }

  try {
    const { data, error } = await supabase
      .from(SUPABASE_TABLE)
      .select("id, reference, status, merchant_address")
      .eq("reference", input.reference)
      .maybeSingle<RequestRow>();

    if (error) {
      console.error(
        "[cancel] lookup failed:",
        error.message,
        "code:",
        error.code,
      );
      return {
        ok: false,
        code: 503,
        message: "Could not read the payment request. Please try again.",
      };
    }

    if (!data) {
      return { ok: false, code: 404, message: "Payment request not found." };
    }

    // Ownership is checked against the session wallet, never client input.
    if (
      typeof data.merchant_address !== "string" ||
      data.merchant_address.trim() !== input.merchantAddress.trim()
    ) {
      return {
        ok: false,
        code: 403,
        message: "You can only cancel your own payment requests.",
      };
    }

    if (data.status === "cancelled") {
      return { ok: true, status: "cancelled", alreadyCancelled: true };
    }

    if (data.status === "paid") {
      return {
        ok: false,
        code: 409,
        message: "A verified payment cannot be cancelled.",
      };
    }

    if (data.status === "expired") {
      return {
        ok: false,
        code: 409,
        message: "This request has already expired and cannot be cancelled.",
      };
    }

    if (!canCancelStatus(data.status)) {
      return {
        ok: false,
        code: 409,
        message: `A ${data.status} request cannot be cancelled.`,
      };
    }

    // Conditional transition: only a still-cancellable row with no verified
    // signature can change. This is the race guard against verification.
    const { data: updated, error: updateError } = await supabase
      .from(SUPABASE_TABLE)
      .update({ status: "cancelled" })
      .eq("id", data.id)
      .in("status", CANCELLABLE_STATUSES)
      .is("transaction_signature", null)
      .select("id");

    if (updateError) {
      console.error(
        "[cancel] update failed:",
        updateError.message,
        "code:",
        updateError.code,
      );
      return {
        ok: false,
        code: 503,
        message: "Could not cancel the payment request. Please try again.",
      };
    }

    if (!updated || updated.length === 0) {
      // A verifier or another request changed the row between read and write.
      const { data: current } = await supabase
        .from(SUPABASE_TABLE)
        .select("status")
        .eq("id", data.id)
        .maybeSingle<{ status: string }>();

      if (current?.status === "cancelled") {
        return { ok: true, status: "cancelled", alreadyCancelled: true };
      }

      if (current?.status === "paid") {
        return {
          ok: false,
          code: 409,
          message: "A verified payment cannot be cancelled.",
        };
      }

      return {
        ok: false,
        code: 409,
        message: "The request changed while it was being cancelled. Please retry.",
      };
    }

    // Best-effort, preference-aware notification. It can never fail this call.
    await createPaymentRequestStatusNotification({
      merchantAddress: input.merchantAddress,
      paymentRequestId: data.id,
      paymentRequestReference: data.reference,
      status: "cancelled",
    });

    return { ok: true, status: "cancelled", alreadyCancelled: false };
  } catch (cause) {
    console.error(
      "[cancel] unexpected failure:",
      cause instanceof Error ? cause.message : "unknown error",
    );
    return {
      ok: false,
      code: 503,
      message: "Could not cancel the payment request. Please try again.",
    };
  }
}
