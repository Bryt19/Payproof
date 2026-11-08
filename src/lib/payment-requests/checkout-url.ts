import { getCheckoutPath } from "./types";

/**
 * Absolute checkout URL for a request. Resolves against the current origin on
 * the client; during server rendering it degrades to the relative path.
 */
export function getCheckoutUrl(reference: string): string {
  const path = getCheckoutPath(reference);

  if (typeof window === "undefined") {
    return path;
  }

  return `${window.location.origin}${path}`;
}
