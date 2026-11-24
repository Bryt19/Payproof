"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CheckIcon,
  ExternalLinkIcon,
  RefreshIcon,
} from "@/components/dashboard/icons";
import { Toggle } from "@/components/settings/settings-controls";

// ---------------------------------------------------------------------------
// Settings → Telegram
//
// Everything shown here comes from the protected API routes:
//   GET  /api/integrations/telegram/status
//   POST /api/integrations/telegram/link-token
//   POST /api/integrations/telegram/unlink
//   GET/PUT /api/integrations/telegram/preferences
//   POST /api/integrations/telegram/test
//
// No wallet signature is requested here: linking is independent of wallet
// authentication, and the merchant wallet always comes from the session.
// ---------------------------------------------------------------------------

type TelegramStatus = {
  linked: boolean;
  telegram: { username: string | null; linkedAt: string | null } | null;
};

type NotificationEventType =
  | "payment_request_created"
  | "payment_received"
  | "payment_failed"
  | "payment_request_expired"
  | "payment_request_cancelled";

type Preferences = Record<NotificationEventType, boolean>;

const EVENT_ORDER: readonly NotificationEventType[] = [
  "payment_request_created",
  "payment_received",
  "payment_failed",
  "payment_request_expired",
  "payment_request_cancelled",
];

const EVENT_COPY: Record<
  NotificationEventType,
  { label: string; description: string }
> = {
  payment_request_created: {
    label: "Request created",
    description: "Sent when a new payment request is saved to your account.",
  },
  payment_received: {
    label: "Payment received",
    description: "Sent only after a payment is verified on Solana.",
  },
  payment_failed: {
    label: "Payment failed",
    description:
      "Sent when a customer's payment attempt reaches failed after repeated wallet rejections.",
  },
  payment_request_expired: {
    label: "Payment request expired",
    description: "Sent when a request closes unpaid.",
  },
  payment_request_cancelled: {
    label: "Payment request cancelled",
    description: "Sent when you cancel a request.",
  },
};

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.length > 0) {
      return body.error;
    }
  } catch {
    // Fall through to the generic message.
  }

  return "Something went wrong. Please try again.";
}

function formatLinkedAt(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toLocaleString();
}

export function TelegramIntegration() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const loadStatus = useCallback(async (): Promise<TelegramStatus | null> => {
    const response = await fetch("/api/integrations/telegram/status", {
      cache: "no-store",
    });

    if (response.status === 401) {
      throw new Error(
        "Sign in with your merchant wallet to manage Telegram notifications.",
      );
    }

    if (!response.ok) {
      throw new Error(await readError(response));
    }

    const data = (await response.json()) as TelegramStatus;
    setStatus(data);
    return data;
  }, []);

  const loadPreferences = useCallback(async () => {
    const response = await fetch(
      "/api/integrations/telegram/preferences",
      { cache: "no-store" },
    );

    if (!response.ok) return;

    const data = (await response.json()) as { preferences?: Preferences };
    if (data.preferences) {
      setPreferences(data.preferences);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initialise() {
      try {
        await loadStatus();
        if (!cancelled) await loadPreferences();
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load Telegram settings.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void initialise();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [loadStatus, loadPreferences, stopPolling]);

  const refresh = useCallback(async () => {
    setError(null);
    setBusy("refresh");

    try {
      const next = await loadStatus();
      if (next?.linked) {
        setDeepLink(null);
        setExpiresAt(null);
        stopPolling();
      }
      await loadPreferences();
      setNotice("Connection status refreshed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh status.");
    } finally {
      setBusy(null);
    }
  }, [loadStatus, loadPreferences, stopPolling]);

  const connect = useCallback(async () => {
    setError(null);
    setNotice(null);
    setBusy("connect");

    try {
      const response = await fetch(
        "/api/integrations/telegram/link-token",
        { method: "POST" },
      );

      if (response.status === 401) {
        throw new Error(
          "Sign in with your merchant wallet before connecting Telegram.",
        );
      }

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const data = (await response.json()) as {
        telegramLink?: string;
        expiresAt?: string;
      };

      if (!data.telegramLink) {
        throw new Error("The server did not return a Telegram link.");
      }

      setDeepLink(data.telegramLink);
      setExpiresAt(data.expiresAt ?? null);
      setNotice(
        "Linking token generated. Open Telegram and press Start to finish linking.",
      );

      window.open(data.telegramLink, "_blank", "noopener,noreferrer");

      stopPolling();
      pollTimer.current = window.setInterval(() => {
        void loadStatus()
          .then((next) => {
            if (next?.linked) {
              stopPolling();
              setDeepLink(null);
              setExpiresAt(null);
              setNotice("Telegram linked successfully.");
            }
          })
          .catch(() => {
            // Transient polling failures are ignored; the merchant can refresh.
          });
      }, 5000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start linking.");
    } finally {
      setBusy(null);
    }
  }, [loadStatus, stopPolling]);

  const unlink = useCallback(async () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Unlink Telegram? Payment notifications to this chat will stop. Your payment history is kept.",
      )
    ) {
      return;
    }

    setError(null);
    setNotice(null);
    setBusy("unlink");
    stopPolling();
    setDeepLink(null);
    setExpiresAt(null);

    try {
      const response = await fetch("/api/integrations/telegram/unlink", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      setStatus({ linked: false, telegram: null });
      setNotice("Telegram unlinked. Future notifications will not be sent.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not unlink Telegram.");
    } finally {
      setBusy(null);
    }
  }, [stopPolling]);

  const updatePreference = useCallback(
    async (eventType: NotificationEventType, enabled: boolean) => {
      const previous = preferences;
      setPreferences((current) =>
        current ? { ...current, [eventType]: enabled } : current,
      );
      setError(null);
      setBusy(`pref:${eventType}`);

      try {
        const response = await fetch(
          "/api/integrations/telegram/preferences",
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ preferences: { [eventType]: enabled } }),
          },
        );

        if (!response.ok) {
          throw new Error(await readError(response));
        }

        const data = (await response.json()) as { preferences?: Preferences };
        if (data.preferences) {
          setPreferences(data.preferences);
        }
      } catch (cause) {
        setPreferences(previous);
        setError(
          cause instanceof Error ? cause.message : "Could not save that preference.",
        );
      } finally {
        setBusy(null);
      }
    },
    [preferences],
  );

  const sendTest = useCallback(async () => {
    setError(null);
    setNotice(null);
    setBusy("test");

    try {
      const response = await fetch("/api/integrations/telegram/test", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(await readError(response));
      }

      const data = (await response.json()) as { message?: string };
      setNotice(data.message ?? "Test message sent.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send a test message.");
    } finally {
      setBusy(null);
    }
  }, []);

  const linked = status?.linked === true;
  const linkedAt = formatLinkedAt(status?.telegram?.linkedAt ?? null);
  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleTimeString()
    : null;

  return (
    <div className="space-y-5">
      {loading ? (
        <p className="text-xs text-white/50">Checking your Telegram connection…</p>
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
                  linked ? "bg-[#14F195]" : "bg-white/25"
                }`}
              />
              <div>
                <p className="text-sm font-semibold text-white">
                  {linked ? "Telegram connected" : "Telegram not connected"}
                </p>
                <p className="mt-0.5 text-xs text-white/50">
                  {linked
                    ? [
                        status?.telegram?.username
                          ? `@${status.telegram.username}`
                          : "Linked Telegram account",
                        linkedAt ? `since ${linkedAt}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "Link @PayProofNotifyBot to receive verified payment alerts."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-xs font-medium text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshIcon className="size-3.5" />
                Refresh
              </button>

              {linked ? (
                <button
                  type="button"
                  onClick={() => void unlink()}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Unlink Telegram
                </button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={() => void connect()}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 text-xs"
                >
                  <ExternalLinkIcon className="size-3.5" />
                  {busy === "connect" ? "Generating link…" : "Connect Telegram"}
                </Button>
              )}
            </div>
          </div>

          {deepLink ? (
            <div className="rounded-xl border border-[#14F195]/25 bg-[#14F195]/[0.05] p-4">
              <p className="text-sm font-medium text-white">
                Finish linking in Telegram
              </p>
              <p className="mt-1 text-xs text-white/60">
                Open the bot and press Start. The link is single-use and expires
                {expiryLabel ? ` at ${expiryLabel}` : " in 15 minutes"}.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a
                  href={deepLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#14F195] px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-[#14F195]/90"
                >
                  <ExternalLinkIcon className="size-3.5" />
                  Open @PayProofNotifyBot
                </a>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  disabled={busy !== null}
                  className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-xs font-medium text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
                >
                  I&apos;ve pressed Start
                </button>
              </div>
            </div>
          ) : null}

          {linked ? (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-white/45">
                  Notification events
                </p>
                <p className="mt-1 text-xs text-white/50">
                  These settings are stored server-side and match what
                  @PayProofNotifyBot shows in /notifications.
                </p>
              </div>

              <div className="space-y-3">
                {EVENT_ORDER.map((eventType) => (
                  <Toggle
                    key={eventType}
                    label={EVENT_COPY[eventType].label}
                    description={EVENT_COPY[eventType].description}
                    checked={preferences?.[eventType] ?? false}
                    onChange={(checked) =>
                      void updatePreference(eventType, checked)
                    }
                  />
                ))}
              </div>

              <div className="flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Delivery check</p>
                  <p className="mt-0.5 text-xs text-white/50">
                    Sends a test message marked as a test. No payment is created.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void sendTest()}
                  disabled={busy !== null}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <CheckIcon className="size-3.5" />
                  {busy === "test" ? "Sending…" : "Send test message"}
                </button>
              </div>
            </>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-xs text-red-200"
            >
              {error}
            </p>
          ) : null}

          {notice ? (
            <p className="inline-flex items-center gap-1.5 rounded-xl border border-[#14F195]/25 bg-[#14F195]/[0.06] px-3 py-2 text-xs text-[#14F195]">
              <CheckIcon className="size-3.5" />
              {notice}
            </p>
          ) : null}

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-xs text-white/50">
            <p className="font-medium text-white/70">How linking works</p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>PayProof issues a single-use token for your merchant wallet.</li>
              <li>You press Start in @PayProofNotifyBot from the deep link.</li>
              <li>The bot redeems the token and links this chat to your account.</li>
            </ol>
            <p className="mt-2">
              Logging out of PayProof does not unlink Telegram. Unlinking here
              stops future notifications but keeps your payment history.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
