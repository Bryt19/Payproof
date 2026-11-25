"use client";

import { useCallback, useState } from "react";
import { useClient } from "@solana/react";
import { useSignMessage } from "@solana/kit-plugin-wallet/react";

import type { AppClient } from "@/lib/solana/client";
import type { MerchantAuthFailure } from "./client";
import {
  performMerchantSignIn,
  type MerchantSignInPhase,
  type MerchantSignInResult,
} from "./merchant-sign-in";

/**
 * Runs the one-time merchant sign-in for a connected wallet.
 *
 * The connected wallet's signer is only used to sign the server challenge; no
 * transaction is built, sent, or paid for. The resulting session lives in the
 * existing HttpOnly cookie set by `/api/auth/verify`.
 */
export function useMerchantSignIn() {
  const client = useClient<AppClient>();
  const signMessage = useSignMessage(client);

  const [phase, setPhase] = useState<MerchantSignInPhase | null>(null);
  const [failure, setFailure] = useState<MerchantAuthFailure | null>(null);

  const signIn = useCallback(
    async (address: string): Promise<MerchantSignInResult> => {
      setFailure(null);
      setPhase("requesting");

      const result = await performMerchantSignIn({
        address,
        signMessage: (message) => signMessage.dispatchAsync(message),
        onPhase: setPhase,
      });

      setPhase(null);

      if (!result.ok) {
        setFailure(result.failure);
      }

      return result;
    },
    [signMessage],
  );

  const reset = useCallback(() => {
    setPhase(null);
    setFailure(null);
  }, []);

  return {
    signIn,
    phase,
    isSigningIn: phase !== null,
    failure,
    reset,
  };
}
