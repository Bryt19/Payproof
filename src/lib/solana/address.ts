/** Shortens a base58 address for compact display, e.g. `9WzD…AWWM`. */
export function shortenAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
