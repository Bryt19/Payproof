export type MerchantAuthFailure = {
  kind?: string;
  message: string;
  retryable: boolean;
};

export type ChallengeResponse = {
  nonce: string;
  expiresAt: string;
  domain: string;
  message: string;
};

export function signatureToBase64(signature: Uint8Array | ArrayLike<number>): string {
  let binary = "";
  for (let i = 0; i < signature.length; i++) {
    binary += String.fromCharCode(signature[i]);
  }
  return btoa(binary);
}

export function describeSignatureError(error: unknown): MerchantAuthFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.toLowerCase().includes("reject") ||
    message.toLowerCase().includes("cancel") ||
    message.toLowerCase().includes("user")
  ) {
    return {
      message: "Signature request was rejected by your wallet.",
      retryable: true,
    };
  }
  return {
    message: "Wallet signing failed. Please try again.",
    retryable: true,
  };
}

export async function requestChallenge(
  walletAddress: string,
): Promise<
  | { ok: true; challenge: ChallengeResponse }
  | { ok: false; failure: MerchantAuthFailure }
> {
  try {
    const res = await fetch("/api/auth/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ walletAddress }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        failure: {
          message: data?.error ?? "Could not request an authentication challenge.",
          retryable: Boolean(data?.retryable ?? res.status >= 500),
        },
      };
    }

    return {
      ok: true,
      challenge: {
        nonce: data.nonce,
        expiresAt: data.expiresAt,
        domain: data.domain,
        message: data.message,
      },
    };
  } catch (error) {
    return {
      ok: false,
      failure: {
        message: "Network error while requesting challenge.",
        retryable: true,
      },
    };
  }
}

export async function submitSignature(payload: {
  nonce: string;
  domain: string;
  walletAddress: string;
  signature: string;
}): Promise<
  | { ok: true; walletAddress: string }
  | { ok: false; failure: MerchantAuthFailure }
> {
  try {
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        failure: {
          message: data?.error ?? "Signature verification failed.",
          retryable: res.status >= 500 || res.status === 429,
        },
      };
    }

    return {
      ok: true,
      walletAddress: data.walletAddress ?? payload.walletAddress,
    };
  } catch (error) {
    return {
      ok: false,
      failure: {
        message: "Network error while verifying signature.",
        retryable: true,
      },
    };
  }
}
