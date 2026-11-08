import type { PaymentRequest } from "./types";

/**
 * Thin client-side mirror of the payment request list.
 *
 * The source of truth is the server API (`/api/payment-requests`), which reads
 * and writes Supabase. This module only keeps a snapshot so UI components can
 * render the list the server returned. It deliberately does not import the
 * repository or the Supabase client, which are server-only.
 *
 * Nothing here verifies money movement. Every request starts as `pending`.
 */

const listeners = new Set<() => void>();

let snapshot: readonly PaymentRequest[] = [];

function publish(next: readonly PaymentRequest[]): void {
  snapshot = next;

  for (const listener of listeners) {
    listener();
  }
}

export function subscribeToPaymentRequests(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getPaymentRequestsSnapshot(): readonly PaymentRequest[] {
  return snapshot;
}

export function setPaymentRequests(next: readonly PaymentRequest[]): void {
  publish(next);
}
