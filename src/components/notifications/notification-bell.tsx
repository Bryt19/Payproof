"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";
import { getBrowserSupabaseClient } from "@/lib/notifications/client";
import type { NotificationRecord, NotificationType } from "@/lib/notifications/types";
import { getCheckoutPath } from "@/lib/payment-requests/types";

type LoadState = "idle" | "loading" | "ready" | "error";

const TYPE_META: Record<
  NotificationType,
  { label: string; icon: "request" | "received" | "expired" | "cancelled" }
> = {
  payment_request_created: { label: "Request created", icon: "request" },
  payment_received: { label: "Payment received", icon: "received" },
  payment_request_expired: { label: "Request expired", icon: "expired" },
  payment_request_cancelled: { label: "Request cancelled", icon: "cancelled" },
};

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  if (!Number.isFinite(diffMs)) return "";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function getNotificationHref(notification: NotificationRecord): string {
  if (notification.type === "payment_received") {
    return `/payments?search=${encodeURIComponent(notification.paymentRequestReference)}`;
  }
  return getCheckoutPath(notification.paymentRequestReference);
}

export function NotificationTypeIcon({ type }: { type: NotificationType }) {
  const meta = TYPE_META[type];
  const base = "size-4";
  if (meta.icon === "received") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`${base} text-[#14F195]`} aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="m8.5 12.2 2.3 2.3 4.7-4.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (meta.icon === "request") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`${base} text-[#9945FF]`} aria-hidden="true">
        <path d="M14 3.5H7a1.8 1.8 0 0 0-1.8 1.8v13.4A1.8 1.8 0 0 0 7 20.5h10a1.8 1.8 0 0 0 1.8-1.8V8.3Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14 3.5v4.8h4.8M9 13h6M9 16.5h4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (meta.icon === "expired") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`${base} text-amber-300`} aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l2.8 1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`${base} text-white/50`} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="m9 9 6 6m0-6-6 6" strokeLinecap="round" />
    </svg>
  );
}

export function notificationTypeLabel(type: NotificationType): string {
  return TYPE_META[type]?.label ?? type;
}

export { formatRelativeTime };

export default function NotificationBell() {
  const router = useRouter();
  const { address } = useWalletAuth();
  const merchant = typeof address === "string" ? address.trim() : "";

  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<LoadState>("idle");
  const [notifications, setNotifications] = useState<readonly NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<"idle" | "active" | "unavailable">("idle");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<number | null>(null);

  const fetchNotifications = useCallback(
    async (quiet?: boolean) => {
      if (!merchant) {
        setNotifications([]);
        setUnreadCount(0);
        setState("ready");
        setError(null);
        return;
      }

      if (!quiet) {
        setState((prev) => (prev === "ready" ? prev : "loading"));
        setError(null);
      }

      try {
        const qs = new URLSearchParams({ merchantAddress: merchant, limit: "20" });
        const res = await fetch(`/api/notifications?${qs.toString()}`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as {
          notifications?: NotificationRecord[];
          unreadCount?: number;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(json.error || "Could not load notifications.");
        }
        setNotifications(Array.isArray(json.notifications) ? json.notifications : []);
        setUnreadCount(typeof json.unreadCount === "number" ? json.unreadCount : 0);
        setState("ready");
        setError(null);
      } catch (cause) {
        if (!quiet) {
          setState("error");
          setError(cause instanceof Error ? cause.message : "Could not load notifications.");
        }
      }
    },
    [merchant],
  );

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!merchant) return;

    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      setRealtimeStatus("unavailable");
      pollRef.current = window.setInterval(() => void fetchNotifications(true), 30000);
      return () => {
        if (pollRef.current) window.clearInterval(pollRef.current);
      };
    }

    const channel = supabase
      .channel(`notifications:${merchant}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `merchant_address=eq.${merchant}`,
        },
        () => {
          void fetchNotifications(true);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setRealtimeStatus("active");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRealtimeStatus((prev) => (prev === "active" ? prev : "unavailable"));
        }
      });

    return () => {
      void supabase.removeChannel(channel);
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [merchant, fetchNotifications]);

  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const menu = rootRef.current?.querySelector<HTMLElement>("[data-notification-menu]");
    if (!menu) return;

    const positionMenu = () => {
      const isMobile = window.innerWidth < 640;
      if (isMobile) {
        menu.style.position = "fixed";
        menu.style.right = "0.5rem";
        menu.style.left = "auto";
        menu.style.top = "calc(env(safe-area-inset-top, 0px) + 3.75rem)";
        menu.style.width = "min(24rem, calc(100vw - 1rem))";
        menu.style.maxHeight = "calc(100vh - env(safe-area-inset-top, 0px) - 5rem)";
      } else {
        menu.style.position = "";
        menu.style.right = "";
        menu.style.left = "";
        menu.style.top = "";
        menu.style.width = "";
        menu.style.maxHeight = "";
      }
    };

    positionMenu();
    window.addEventListener("resize", positionMenu);
    return () => {
      window.removeEventListener("resize", positionMenu);
      menu.style.position = "";
      menu.style.right = "";
      menu.style.left = "";
      menu.style.top = "";
      menu.style.width = "";
      menu.style.maxHeight = "";
    };
  }, [isOpen]);

  const markRead = useCallback(
    async (id: string) => {
      if (!merchant) return;
      const wasUnread = notifications.some((n) => n.id === id && !n.isRead);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true, readAt: n.readAt ?? new Date().toISOString() } : n)),
      );
      if (wasUnread) setUnreadCount((prev) => Math.max(0, prev - 1));
      try {
        await fetch(`/api/notifications/${encodeURIComponent(id)}?merchantAddress=${encodeURIComponent(merchant)}`, {
          method: "PATCH",
        });
      } catch {
        // Refetch will reconcile.
      }
    },
    [merchant, notifications],
  );

  const markAllRead = useCallback(async () => {
    if (!merchant || unreadCount === 0) return;
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true, readAt: n.readAt ?? now })));
    setUnreadCount(0);
    try {
      await fetch("/api/notifications/mark-all-read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ merchantAddress: merchant }),
      });
    } catch {
      // Best-effort UI update.
    }
  }, [merchant, unreadCount]);

  const onSelectNotification = useCallback(
    async (notification: NotificationRecord) => {
      if (!notification.isRead) {
        await markRead(notification.id);
      }
      setIsOpen(false);
      router.push(getNotificationHref(notification));
    },
    [markRead, router],
  );

  const badgeText = useMemo(() => {
    if (unreadCount <= 0) return "";
    return unreadCount > 99 ? "99+" : String(unreadCount);
  }, [unreadCount]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          const next = !isOpen;
          setIsOpen(next);
          if (next) void fetchNotifications(true);
        }}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="relative flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-white/[0.03] text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:size-9"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="size-4" aria-hidden="true">
          <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .53-.21 1.04-.59 1.41L4 17h5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 17a3 3 0 0 0 6 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unreadCount > 0 && (
          <>
            <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-[#14F195] sm:hidden" aria-hidden="true" />
            <span className="absolute -right-0.5 -top-0.5 hidden min-h-4 min-w-4 items-center justify-center rounded-full bg-[#14F195] px-1 text-[10px] font-bold leading-none text-black shadow-[0_0_12px_rgba(20,241,149,0.45)] sm:inline-flex">
              {badgeText}
            </span>
          </>
        )}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Notifications"
          data-notification-menu
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0E0E12] shadow-[0_20px_60px_rgba(0,0,0,0.55)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-white">Notifications</p>
              <p className="text-[11px] text-white/45">
                {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
                {realtimeStatus === "active" ? " · live" : realtimeStatus === "unavailable" ? " · auto-refresh" : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void markAllRead()}
              disabled={unreadCount === 0}
              className="rounded-lg border border-white/[0.1] px-2.5 py-1.5 text-[11px] font-medium text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Mark all as read
            </button>
          </div>

          <div className="max-h-[22rem] overflow-y-auto">
            {state === "loading" ? (
              <div className="space-y-2 p-3" aria-busy="true">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-white/[0.04]" />
                ))}
              </div>
            ) : error ? (
              <div className="p-4 text-xs text-red-200">
                <p>{error}</p>
                <button type="button" onClick={() => void fetchNotifications()} className="mt-2 rounded-lg border border-red-400/30 px-2.5 py-1.5 text-red-100 hover:bg-red-400/10">
                  Retry
                </button>
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-medium text-white/80">No notifications yet</p>
                <p className="mt-1 text-xs text-white/45">New payment requests and verified payments will appear here.</p>
              </div>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => void onSelectNotification(notification)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04] ${
                        notification.isRead ? "opacity-70" : "bg-[#9945FF]/[0.04]"
                      }`}
                    >
                      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.03]">
                        <NotificationTypeIcon type={notification.type} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className={`text-xs ${notification.isRead ? "font-medium text-white/90" : "font-semibold text-white"}`}>
                            {notification.title}
                          </span>
                          {!notification.isRead && <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#14F195]" aria-label="Unread" />}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-white/65">{notification.message}</span>
                        <span className="mt-1 block text-[11px] text-white/40">
                          {notificationTypeLabel(notification.type)} · {formatRelativeTime(notification.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-white/[0.08] p-2">
            <Link
              href="/notifications"
              onClick={() => setIsOpen(false)}
              className="flex items-center justify-center rounded-xl px-3 py-2 text-xs font-medium text-[#14F195] transition-colors hover:bg-white/[0.04]"
            >
              View all notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
