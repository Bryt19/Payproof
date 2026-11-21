"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { NotificationRecord } from "./types";

/** Default refresh cadence. The API is polled because the table has no browser access. */
export const DEFAULT_POLL_INTERVAL_MS = 30_000;

const GENERIC_ERROR = "Could not load notifications.";

export type NotificationPayload = {
  notifications: readonly NotificationRecord[];
  unreadCount: number;
};

const EMPTY_PAYLOAD: NotificationPayload = Object.freeze({
  notifications: [] as readonly NotificationRecord[],
  unreadCount: 0,
});

function isNotificationRecord(value: unknown): value is NotificationRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.type === "string" &&
    typeof row.title === "string" &&
    typeof row.message === "string" &&
    typeof row.paymentRequestReference === "string" &&
    typeof row.isRead === "boolean" &&
    typeof row.createdAt === "string"
  );
}

/**
 * Validates a response body without trusting its shape. Returns `null` when the
 * payload is unusable so the caller can report an error instead of rendering
 * undefined values; individual malformed rows are dropped.
 */
function parsePayload(value: unknown): NotificationPayload | null {
  if (!value || typeof value !== "object") return null;

  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.notifications)) return null;

  const notifications = body.notifications.filter(isNotificationRecord);
  const unreadCount =
    typeof body.unreadCount === "number" && Number.isFinite(body.unreadCount)
      ? Math.max(0, body.unreadCount)
      : notifications.filter((notification) => !notification.isRead).length;

  return { notifications, unreadCount };
}

function errorMessageFromBody(value: unknown): string {
  if (value && typeof value === "object") {
    const message = (value as Record<string, unknown>).error;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  return GENERIC_ERROR;
}

export type UseNotificationPollingOptions = {
  /**
   * Authenticated request URL for the current filters, or `null` to stay idle.
   * It carries display filters only — the server derives merchant ownership
   * from the session cookie.
   */
  url: string | null;
  /**
   * Wallet address of the validated server session. Responses are cached per
   * identity, so a session change discards the previous merchant's rows before
   * the new merchant's data is requested.
   */
  identity: string | null;
  /** How often to poll while the document is visible. */
  intervalMs?: number;
};

export type UseNotificationPollingResult = {
  notifications: readonly NotificationRecord[];
  unreadCount: number;
  /** Message for a failed load of the *current* identity and URL. */
  error: string | null;
  /** True while the current identity and URL have no successful response yet. */
  isLoading: boolean;
  /** Fetches immediately; resolves when the request finishes or is skipped. */
  refresh: () => Promise<void>;
  /** Applies a local (optimistic) update to the loaded payload. */
  mutate: (updater: (current: NotificationPayload) => NotificationPayload) => void;
};

function buildRequestKey(identity: string | null, url: string | null): string | null {
  if (!identity || !url) return null;
  return `${identity}\u0000${url}`;
}

/**
 * Polls `GET /api/notifications` on behalf of the notification UI.
 *
 * Identity is the server session address, so a connected browser wallet cannot
 * change whose notifications are loaded. Only one request is ever in flight per
 * hook instance, scheduled polls pause while the tab is hidden, and every
 * cleanup path aborts the pending request and clears the interval.
 */
export function useNotificationPolling({
  url,
  identity,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseNotificationPollingOptions): UseNotificationPollingResult {
  const requestKey = buildRequestKey(identity, url);

  // Responses are tagged with the request they answer so an identity or filter
  // change shows a loading state instead of stale data from the previous query.
  const [payload, setPayload] = useState<{ key: string; data: NotificationPayload } | null>(
    null,
  );
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  const mountedRef = useRef(true);
  const inFlightRef = useRef<AbortController | null>(null);
  const inFlightKeyRef = useRef<string | null>(null);
  const currentRequestRef = useRef<{ url: string; key: string } | null>(null);

  useEffect(() => {
    currentRequestRef.current = requestKey ? { url: url as string, key: requestKey } : null;
  }, [requestKey, url]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      inFlightRef.current?.abort();
      inFlightRef.current = null;
      inFlightKeyRef.current = null;
    };
  }, []);

  const run = useCallback(async (targetUrl: string, key: string): Promise<void> => {
    if (!mountedRef.current) return;

    // Coalesce: the same request already running wins over a new one. A request
    // for a different key (identity or filter change) is superseded instead.
    if (inFlightRef.current) {
      if (inFlightKeyRef.current === key) return;
      inFlightRef.current.abort();
    }

    const controller = new AbortController();
    inFlightRef.current = controller;
    inFlightKeyRef.current = key;

    try {
      const response = await fetch(targetUrl, {
        cache: "no-store",
        signal: controller.signal,
      });

      const body: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        if (!mountedRef.current) return;
        setFailure({ key, message: errorMessageFromBody(body) });
        return;
      }

      const parsed = parsePayload(body);
      if (!parsed) {
        if (!mountedRef.current) return;
        setFailure({ key, message: GENERIC_ERROR });
        return;
      }

      if (!mountedRef.current) return;
      setPayload({ key, data: parsed });
      setFailure(null);
    } catch {
      // Aborted requests (unmount or superseded) are expected; a real network
      // failure keeps the previous data and only marks this request as errored.
      if (controller.signal.aborted || !mountedRef.current) return;
      setFailure({ key, message: GENERIC_ERROR });
    } finally {
      if (inFlightRef.current === controller) {
        inFlightRef.current = null;
        inFlightKeyRef.current = null;
      }
    }
  }, []);

  // Immediate fetch on mount and whenever the identity or request URL changes.
  // The call is deferred by one tick so it never runs inside the commit phase;
  // the interval uses the same `run` path on every poll.
  useEffect(() => {
    if (!requestKey || !url) return;
    const handle = window.setTimeout(() => {
      void run(url, requestKey);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [requestKey, url, run]);

  const enabled = requestKey !== null;

  // One interval per mounted hook. It is stopped while the tab is hidden and
  // restarted, with an immediate fetch, when the tab becomes visible again.
  useEffect(() => {
    if (!enabled) return;

    let intervalId: number | null = null;

    const stop = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };

    const start = () => {
      if (intervalId !== null) return;
      intervalId = window.setInterval(() => {
        if (document.visibilityState === "hidden") return;
        const pending = currentRequestRef.current;
        if (pending) void run(pending.url, pending.key);
      }, intervalMs);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stop();
        return;
      }
      start();
      const pending = currentRequestRef.current;
      if (pending) void run(pending.url, pending.key);
    };

    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, intervalMs, run]);

  const refresh = useCallback(async (): Promise<void> => {
    const pending = currentRequestRef.current;
    if (!pending) return;
    await run(pending.url, pending.key);
  }, [run]);

  const mutate = useCallback(
    (updater: (current: NotificationPayload) => NotificationPayload) => {
      setPayload((current) => {
        if (!current) return current;
        return { key: current.key, data: updater(current.data) };
      });
    },
    [],
  );

  const currentFailed = failure !== null && failure.key === requestKey;
  const data = payload?.key === requestKey ? payload.data : EMPTY_PAYLOAD;

  return {
    notifications: data.notifications,
    unreadCount: data.unreadCount,
    error: currentFailed ? failure.message : null,
    isLoading: requestKey !== null && payload?.key !== requestKey && !currentFailed,
    refresh,
    mutate,
  };
}
