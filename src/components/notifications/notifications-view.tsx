"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardShell from "@/components/dashboard/dashboard-shell";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";
import { getBrowserSupabaseClient } from "@/lib/notifications/client";
import type { NotificationFilter, NotificationRecord, NotificationType } from "@/lib/notifications/types";
import {
  NotificationTypeIcon,
  formatRelativeTime,
  getNotificationHref,
  notificationTypeLabel,
} from "./notification-bell";

type LoadState = "loading" | "ready" | "error";

const TYPE_OPTIONS: Array<{ value: "all" | NotificationType; label: string }> = [
  { value: "all", label: "All types" },
  { value: "payment_request_created", label: "Requests created" },
  { value: "payment_received", label: "Payments received" },
  { value: "payment_request_expired", label: "Expired" },
  { value: "payment_request_cancelled", label: "Cancelled" },
];

export default function NotificationsView() {
  const router = useRouter();
  const { address } = useWalletAuth();
  const merchant = typeof address === "string" ? address.trim() : "";

  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<readonly NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | NotificationType>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [realtimeActive, setRealtimeActive] = useState(false);

  const fetchNotifications = useCallback(
    async (quiet?: boolean) => {
      if (!merchant) {
        setNotifications([]);
        setUnreadCount(0);
        setState("ready");
        return;
      }

      if (!quiet) setState("loading");
      setIsRefreshing(true);
      setError(null);

      try {
        const qs = new URLSearchParams({
          merchantAddress: merchant,
          filter,
          limit: "100",
        });
        if (typeFilter !== "all") qs.set("type", typeFilter);
        const res = await fetch(`/api/notifications?${qs.toString()}`, { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as {
          notifications?: NotificationRecord[];
          unreadCount?: number;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error || "Could not load notifications.");
        setNotifications(Array.isArray(json.notifications) ? json.notifications : []);
        setUnreadCount(typeof json.unreadCount === "number" ? json.unreadCount : 0);
        setState("ready");
      } catch (cause) {
        setState("error");
        setError(cause instanceof Error ? cause.message : "Could not load notifications.");
      } finally {
        setIsRefreshing(false);
      }
    },
    [merchant, filter, typeFilter],
  );

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!merchant) return;
    const supabase = getBrowserSupabaseClient();
    if (!supabase) return;

    const channel = supabase
      .channel(`notifications-page:${merchant}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `merchant_address=eq.${merchant}` },
        () => {
          void fetchNotifications(true);
        },
      )
      .subscribe((status) => {
        setRealtimeActive(status === "SUBSCRIBED");
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [merchant, fetchNotifications]);

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
        // reconcile on refetch
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
      // best effort
    }
  }, [merchant, unreadCount]);

  const onOpenNotification = useCallback(
    async (notification: NotificationRecord) => {
      if (!notification.isRead) await markRead(notification.id);
      router.push(getNotificationHref(notification));
    },
    [markRead, router],
  );

  const counts = useMemo(() => {
    const unread = notifications.filter((n) => !n.isRead).length;
    const read = notifications.length - unread;
    return { all: notifications.length, unread, read };
  }, [notifications]);

  return (
    <DashboardShell
      title="Notifications"
      description="Real payment request and verified-payment events for your merchant wallet."
      showRefresh
      onRefresh={() => void fetchNotifications()}
      isRefreshing={isRefreshing}
    >
      <div className="space-y-4 pb-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-white/70">
              {unreadCount} unread total{realtimeActive ? " · live updates active" : " · refresh to sync if live updates are unavailable"}
            </p>
            <p className="mt-1 text-xs text-white/40">
              Notifications are generated only from real application events and scoped to the connected wallet.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={unreadCount === 0}
            className="rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-2 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Mark all as read
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {([
            { value: "all", label: `All (${counts.all})` },
            { value: "unread", label: "Unread" },
            { value: "read", label: "Read" },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setFilter(opt.value)}
              className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === opt.value
                  ? "bg-[#9945FF] text-white shadow-[0_0_16px_rgba(153,69,255,0.3)]"
                  : "border border-white/[0.08] bg-white/[0.03] text-white/65 hover:bg-white/[0.06] hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "all" | NotificationType)}
            className="rounded-xl border border-white/[0.08] bg-[#0E0E12] px-3 py-1.5 text-xs text-white/80 focus:border-[#9945FF]/60 focus:outline-none"
            aria-label="Filter by notification type"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {state === "loading" ? (
          <div className="space-y-2" aria-busy="true">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.02]" />
            ))}
          </div>
        ) : state === "error" ? (
          <div role="alert" className="rounded-2xl border border-red-400/30 bg-red-400/10 p-5 text-sm text-red-100">
            <p className="font-medium">Notifications unavailable</p>
            <p className="mt-1 text-red-200/80">{error}</p>
            <button type="button" onClick={() => void fetchNotifications()} className="mt-3 rounded-xl border border-red-400/30 px-3.5 py-2 text-xs hover:bg-red-400/10">
              Retry
            </button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.08] bg-[#0E0E12] px-6 py-14 text-center">
            <p className="text-sm font-semibold text-white">No notifications to show</p>
            <p className="mt-1 text-xs text-white/45">
              {filter !== "all" || typeFilter !== "all"
                ? "Try adjusting your filters."
                : "When you create requests or receive verified payments, they will appear here."}
            </p>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0E0E12] divide-y divide-white/[0.06]">
            {notifications.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => void onOpenNotification(notification)}
                  className={`flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-white/[0.03] sm:px-5 ${
                    notification.isRead ? "" : "bg-[#9945FF]/[0.04]"
                  }`}
                >
                  <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
                    <NotificationTypeIcon type={notification.type} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className={`block text-sm ${notification.isRead ? "font-medium text-white/90" : "font-semibold text-white"}`}>
                          {notification.title}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-white/65">{notification.message}</span>
                      </span>
                      {!notification.isRead && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#14F195]/10 px-2 py-0.5 text-[10px] font-medium text-[#14F195]">
                          <span className="size-1.5 rounded-full bg-[#14F195]" /> Unread
                        </span>
                      )}
                    </span>
                    <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/40">
                      <span>{notificationTypeLabel(notification.type)}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={notification.createdAt}>{formatRelativeTime(notification.createdAt)}</time>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-white/35">{notification.paymentRequestReference.slice(0, 12)}…</span>
                      {notification.transactionSignature && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-white/35">Tx {notification.transactionSignature.slice(0, 8)}…</span>
                        </>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DashboardShell>
  );
}
