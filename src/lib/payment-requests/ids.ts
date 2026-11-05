/** Base58 alphabet used by Solana public keys (Bitcoin alphabet, no 0/O/I/l). */
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function toBase58(bytes: Uint8Array): string {
  let value = 0n;

  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }

  let encoded = "";

  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = BASE58_ALPHABET[remainder] + encoded;
    value /= 58n;
  }

  // Preserve leading zero bytes, which base58 represents as leading "1"s.
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = "1" + encoded;
  }

  return encoded || "1";
}

let cachedCrypto: Crypto | null = null;

function getCrypto(): Crypto {
  if (!cachedCrypto) {
    if (typeof globalThis.crypto?.getRandomValues !== "function") {
      throw new Error("Secure random generation is unavailable in this browser.");
    }

    cachedCrypto = globalThis.crypto;
  }

  return cachedCrypto;
}

/**
 * Generates a random 32-byte reference encoded as base58.
 *
 * The length and encoding match a Solana public key, which is what makes a
 * reference useful later: it can be attached to a transfer as a read-only
 * account and looked up with `findReference`/`getSignaturesForAddress`.
 */
export function generatePaymentReference(): string {
  const bytes = new Uint8Array(32);
  getCrypto().getRandomValues(bytes);

  return toBase58(bytes);
}

/** Generates a short, unique request identifier such as `PR-4F9A2C71`. */
export function generatePaymentRequestId(): string {
  const bytes = new Uint8Array(4);
  getCrypto().getRandomValues(bytes);

  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

  return `PR-${suffix}`;
}
