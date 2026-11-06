/** 1 SOL = 1,000,000,000 lamports. */
export const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Converts lamports to a display SOL string without floating point math.
 *
 * Shows up to four decimal places; when the balance is smaller than that, the
 * exact (trailing-zero-trimmed) fraction is shown instead so tiny balances are
 * never presented as zero.
 */
export function formatSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = lamports % LAMPORTS_PER_SOL;

  if (fraction === 0n) {
    return whole.toString();
  }

  const digits = fraction.toString().padStart(9, "0");
  const shortened = digits.slice(0, 4).replace(/0+$/, "");

  if (shortened) {
    return `${whole}.${shortened}`;
  }

  return `${whole}.${digits.replace(/0+$/, "")}`;
}

/**
 * Renders an exact SOL amount (up to 9 decimals) with trailing zeros trimmed.
 * Used for payment request amounts, where the entered value must round-trip.
 */
export function formatSolExact(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = lamports % LAMPORTS_PER_SOL;

  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole}.${fraction.toString().padStart(9, "0").replace(/0+$/, "")}`;
}
