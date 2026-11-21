"use client";

import { useCallback, useEffect, useState } from "react";
import type { MerchantAuthFailure } from "./client";

export type ClientMerchantSession = {
  status: "checking" | "authenticated" | "unauthenticated" | "error";
  walletAddress: string | null;
  reason?: string | null;
  failure?: MerchantAuthFailure | null;
  refresh: () => void;
};

export function useMerchantSession(): ClientMerchantSession {
  const [session, setSession] = useState<Omit<ClientMerchantSession, "refresh">>({
    status: "checking",
    walletAddress: null,
  });
  const [refreshCount, setRefreshCount] = useState(0);

  const refresh = useCallback(() => {
    setRefreshCount((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      setSession((prev) => ({
        ...prev,
        status: "checking",
      }));

      try {
        const res = await fetch("/api/auth/status", {
          cache: "no-store",
        });

        if (cancelled) return;

        if (!res.ok && res.status >= 500) {
          setSession({
            status: "error",
            walletAddress: null,
            reason: "Server error",
            failure: {
              message: "The server encountered an error while verifying your session.",
              retryable: true,
            },
          });
          return;
        }

        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (data.authenticated && typeof data.walletAddress === "string") {
          setSession({
            status: "authenticated",
            walletAddress: data.walletAddress,
            failure: null,
          });
        } else {
          setSession({
            status: "unauthenticated",
            walletAddress: null,
            reason: data.reason ?? null,
            failure: null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setSession({
            status: "error",
            walletAddress: null,
            reason: "Network error",
            failure: {
              message: err instanceof Error ? err.message : "Network error checking session",
              retryable: true,
            },
          });
        }
      }
    }

    checkSession();

    return () => {
      cancelled = true;
    };
  }, [refreshCount]);

  return {
    ...session,
    refresh,
  };
}
