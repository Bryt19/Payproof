import {
  describeSignatureError,
  requestChallenge,
  signatureToBase64,
  submitSignature,
  type MerchantAuthFailure,
} from "./client";

/**
 * One-time merchant sign-in for an already-connected wallet.
 *
 * Wallet connection and merchant authentication are separate states. The
 * landing page connects a wallet (public address only); this flow proves the
 * merchant owns that address by signing the server-issued challenge once, so
 * the console's existing server-side session gate recognises them afterwards.
 */
export type MerchantSignInPhase = "requesting" | "signing" | "verifying";

export type MerchantSessionStatus = {
  authenticated: boolean;
  walletAddress: string | null;
};

export type MerchantSignInResult =
  | { ok: true; walletAddress: string; alreadySignedIn: boolean }
  | { ok: false; failure: MerchantAuthFailure };

export type MerchantSignInDependencies = {
  address: string;
  /** Reads the current cookie-backed session; skipped when omitted in tests. */
  getSessionStatus?: () => Promise<MerchantSessionStatus>;
  requestChallenge?: typeof requestChallenge;
  signMessage: (message: Uint8Array) => Promise<ArrayLike<number>>;
  submitSignature?: typeof submitSignature;
  onPhase?: (phase: MerchantSignInPhase) => void;
  now?: () => number;
};

export async function fetchMerchantSessionStatus(): Promise<MerchantSessionStatus> {
  const res = await fetch("/api/auth/status", { cache: "no-store" });

  if (!res.ok) {
    return { authenticated: false, walletAddress: null };
  }

  const data = await res.json().catch(() => null);

  if (data?.authenticated && typeof data.walletAddress === "string") {
    return { authenticated: true, walletAddress: data.walletAddress };
  }

  return { authenticated: false, walletAddress: null };
}

export async function performMerchantSignIn({
  address,
  getSessionStatus = fetchMerchantSessionStatus,
  requestChallenge: request = requestChallenge,
  signMessage,
  submitSignature: submit = submitSignature,
  onPhase,
  now = () => Date.now(),
}: MerchantSignInDependencies): Promise<MerchantSignInResult> {
  // Reconnecting a wallet that already owns a valid session must not trigger a
  // second signature. A session for a different wallet still needs one, because
  // signing here is what switches the console to the newly connected wallet.
  try {
    const existing = await getSessionStatus();

    if (existing.authenticated && existing.walletAddress === address) {
      return { ok: true, walletAddress: address, alreadySignedIn: true };
    }
  } catch {
    // A failed status probe must not block sign-in; fall through to challenge.
  }

  onPhase?.("requesting");

  const challengeResult = await request(address);

  if (!challengeResult.ok) {
    return { ok: false, failure: challengeResult.failure };
  }

  const { challenge } = challengeResult;

  if (new Date(challenge.expiresAt).getTime() <= now()) {
    return {
      ok: false,
      failure: {
        kind: "expired-challenge",
        message:
          "That signing request expired before your wallet opened it. Try again to get a fresh one.",
        retryable: true,
      },
    };
  }

  onPhase?.("signing");

  let signature: ArrayLike<number>;

  try {
    // Sign exactly the server-generated message. The server rebuilds the same
    // bytes from the stored nonce and domain; it never trusts a client copy.
    signature = await signMessage(new TextEncoder().encode(challenge.message));
  } catch (error) {
    return { ok: false, failure: describeSignatureError(error) };
  }

  onPhase?.("verifying");

  const verifyResult = await submit({
    nonce: challenge.nonce,
    domain: challenge.domain,
    walletAddress: address,
    signature: signatureToBase64(signature),
  });

  if (!verifyResult.ok) {
    return { ok: false, failure: verifyResult.failure };
  }

  return {
    ok: true,
    walletAddress: verifyResult.walletAddress,
    alreadySignedIn: false,
  };
}
