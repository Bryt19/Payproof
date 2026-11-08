import { useEffect, useState } from "react";
import { getPaymentRequestsSnapshot, setPaymentRequests } from "./store";
import type { PaymentRequest } from "./types";

/**
 * Live list of payment requests fetched from the server.
 *
 * The client never reads server environment variables. Persistence state
 * (`isPersistent` and the `repositoryNotice`) is returned by the server list
 * endpoint so the UI can tell the user whether requests are persisted or only
 * kept in this browser session.
 *
 * The list always comes from Supabase, read through the server API. When that
 * read fails, the API's error message is surfaced instead of an empty list that
 * looks like "no requests", so the UI never pretends persistence succeeded.
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

export function usePaymentRequests(): UsePaymentRequestsReturn {
  const [status, setStatus] = useState<UsePaymentRequestsReturn["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequestsState] = useState<readonly PaymentRequest[]>(EMPTY);
  const [repositoryNotice, setRepositoryNotice] = useState<string>("");
  const [isPersistent, setIsPersistent] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    setIsLoading(status !== "loaded");
  }, [status]);

  async function refetch(quiet?: boolean) {
    if (!quiet) {
      setStatus("loading");
      setError(null);
    }

    try {
      const res = await fetch("/api/payment-requests", {
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
  }

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
      refetch();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

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
