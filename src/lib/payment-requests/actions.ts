"use server";

import { revalidatePath } from "next/cache";
import {
  createPaymentRequestRepository,
  describeRepositoryInitializationFailure,
  type PaymentRequestRepository,
} from "./repository";
import type { NewPaymentRequestInput, PaymentRequest } from "./types";

/**
 * Persists a new payment request in Supabase.
 *
 * Merchant address is accepted only from the merchant's own browser during
 * creation and is not verified as wallet ownership. Every failure — including
 * a missing server configuration — is returned as an error; the action never
 * reports a request as saved unless the insert succeeded.
 */
export async function createPaymentRequestAction(
  input: NewPaymentRequestInput,
  merchantAddress: string | null,
): Promise<{ ok: true; request: PaymentRequest } | { ok: false; error: string }> {
  let repo: PaymentRequestRepository;

  try {
    repo = createPaymentRequestRepository();
  } catch (cause) {
    return { ok: false, error: describeRepositoryInitializationFailure(cause) };
  }

  const persisted = await repo.create(input, merchantAddress);

  if ("type" in persisted) {
    return { ok: false, error: persisted.message };
  }

  // Refresh the server-rendered views that list persisted requests.
  revalidatePath("/payment-requests");

  return { ok: true, request: persisted };
}
