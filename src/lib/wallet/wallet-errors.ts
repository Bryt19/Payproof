/**
 * Turns a wallet SDK failure into a message safe to show in the UI.
 */
export function describeWalletError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "The request was cancelled because a newer one started.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "The wallet did not complete the request. Please try again.";
}
