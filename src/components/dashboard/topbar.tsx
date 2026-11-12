"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { WalletAvatarDropdown } from "@/components/wallet-avatar-dropdown";
import NotificationBell from "@/components/notifications/notification-bell";
import { MenuIcon, RefreshIcon } from "./icons";

export default function TopBar({
  title,
  description,
  isNavOpen,
  onOpenNav,
  showRefresh = false,
  onRefresh,
  isRefreshing,
}: {
  title: string;
  description: string;
  isNavOpen: boolean;
  onOpenNav: () => void;
  /** Show a refresh control in the top bar. */
  showRefresh?: boolean;
  /** Custom refresh handler for client-fetched pages. Falls back to router.refresh(). */
  onRefresh?: () => void;
  /** External refreshing state for custom onRefresh handlers. */
  isRefreshing?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const refreshing = isRefreshing ?? isPending;

  const handleRefresh = () => {
    if (onRefresh) {
      onRefresh();
      return;
    }
    startTransition(() => router.refresh());
  };

  return (
    <header
      className="sticky top-0 z-30 border-b border-line backdrop-blur"
      style={{ background: "rgba(0,0,0,0.85)" }}
    >
      <div className="flex w-full items-center gap-2 px-4 py-2 sm:gap-3 sm:px-6 sm:py-3 lg:px-9">
        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={onOpenNav}
          aria-expanded={isNavOpen}
          aria-controls="mobile-navigation"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 lg:hidden"
          style={{ color: "rgba(255,255,255,0.65)" }}
        >
          <MenuIcon className="size-4" />
          <span className="sr-only">Open navigation</span>
        </button>

        {/* Page title */}
        <div className="min-w-0 flex-1">
          <h1
            className="truncate text-[15px] font-semibold tracking-tight sm:text-lg"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            {title}
          </h1>
          <p
            className="hidden truncate text-xs sm:block"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            {description}
          </p>
        </div>

        {showRefresh && (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-busy={refreshing}
            aria-label={refreshing ? "Refreshing data" : "Refresh data"}
            title={refreshing ? "Refreshing data…" : "Refresh data"}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-white/[0.03] text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60 sm:size-9"
          >
            <RefreshIcon
              className={`size-4 ${refreshing ? "animate-spin text-[#9945FF]" : ""}`}
            />
          </button>
        )}

        <NotificationBell />
        <WalletAvatarDropdown />
      </div>
    </header>
  );
}
