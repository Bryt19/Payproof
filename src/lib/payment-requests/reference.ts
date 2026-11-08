/**
 * Payment references are 32-byte random values encoded as base58, the same
 * shape as a Solana public key, so they can later be attached to a transfer as
 * a read-only account.
 *
 * A 32-byte value encodes to 43 or 44 base58 characters. The lower bound here
 * is slightly lenient so older references are never mistaken for invalid ones,
 * while clearly malformed input is rejected before it reaches the database.
 */
const REFERENCE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidPaymentReference(value: string): boolean {
  return REFERENCE_PATTERN.test(value);
}
