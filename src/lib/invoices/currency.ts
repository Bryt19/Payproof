"use client";

/**
 * Currency formatting helpers for Payproof invoices.
 *
 * This module only formats values already present in the invoice domain model.
 * It does not add any storage or payment logic.
 */

export function formatUsdAmount(lamportUsdRate: bigint, amountCents: bigint): string {
  // Conservatively scale to whole cents for display; this is a UI helper only.
  const dollars = amountCents / 100n;
  const cents = amountCents % 100n;
  const centDigits = cents.toString().padStart(2, "0");
  return `$${dollars}.${centDigits}`;
}

export function formatLamportUrlParam(value: string): string {
  // Display-safe wrapper around raw lamports so they never read like floats.
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return "—";
  return trimmed;
}
