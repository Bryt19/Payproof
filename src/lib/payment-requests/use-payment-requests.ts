import { useCallback, useEffect, useState } from "react";
import { getPaymentRequestsSnapshot, setPaymentRequests } from "./store";
import type { PaymentRequest } from "./types";

/**
 * Live list of payment requests fetched from the server.
 *
 * Scoped to `merchantAddress` (the connected wallet) so each account sees only
 * its own data. The address is client-provided, not verified server-side
 * ownership.
 */
export type UsePaymentRequestsReturn = {
  requests: readonly PaymentRequest[];
  status: "idle" | "loading" | "loaded" | "error";
  error: string | null;
  refetch: (quiet?: boolean) => void;
  repositoryNotice: string;
  isPersistent: boolean;
  isLoading: boolean;
};

const EMPTY: readonly PaymentRequest[] = [];

export function usePaymentRequests(merchantAddress?: string | null): UsePaymentRequestsReturn {
  const merchant =
    typeof merchantAddress === "string" && merchantAddress.trim().length > 0
      ? merchantAddress.trim()
      : null;
  const [status, setStatus] = useState<UsePaymentRequestsReturn["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequestsState] = useState<readonly PaymentRequest[]>(EMPTY);
  const [repositoryNotice, setRepositoryNotice] = useState<string>("");
  const [isPersistent, setIsPersistent] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    setIsLoading(status !== "loaded");
  }, [status]);

  const refetch = useCallback(
    async (quiet?: boolean) => {
      if (!merchant) {
        setRequestsState(EMPTY);
        setError(null);
        setRepositoryNotice("");
        setIsPersistent(true);
        if (!quiet) setStatus("loaded");
        return;
      }

      if (!quiet) {
        setStatus("loading");
        setError(null);
      }

      try {
        const qs = new URLSearchParams({ merchantAddress: merchant });
        const res = await fetch(`/api/payment-requests?${qs.toString()}`, {
          cache: "no-store",
        });

        if (!res.ok) {
          const failure = (await res.json().catch(() => null)) as {
            error?: string;
            notice?: string;
          } | null;

          setStatus("error");
          setError(failure?.error ?? "Could not load payment requests.");
          setRepositoryNotice(failure?.notice ?? "");
          setRequestsState(EMPTY);
          return;
        }

        const data = (await res.json()) as {
          requests: readonly PaymentRequest[];
          notice: string;
          persistent: boolean;
        };

        setRequestsState(data.requests);
        setPaymentRequests(data.requests);
        setRepositoryNotice(data.notice);
        setIsPersistent(data.persistent);
        if (!quiet) setStatus("loaded");
      } catch (cause) {
        if (!quiet) {
          setStatus("error");
          setError(
            cause instanceof Error ? cause.message : "Could not load payment requests.",
          );
        }
        setRequestsState(EMPTY);
      }
    },
    [merchant],
  );

  // Seed the initial snapshot from the store so the UI is not blank while
  // the first server fetch completes.
  useEffect(() => {
    const timer = setTimeout(() => {
      setRequestsState(getPaymentRequestsSnapshot());
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void refetch();
    }, 0);
    return () => clearTimeout(timer);
  }, [refetch]);

  return {
    requests,
    status,
    error,
    refetch,
    repositoryNotice,
    isPersistent,
    isLoading,
  };
}
