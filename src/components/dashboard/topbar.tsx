"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { WalletAvatarDropdown } from "@/components/wallet-avatar-dropdown";
import { MenuIcon, RefreshIcon } from "./icons";

export default function TopBar({
  title,
  description,
  isNavOpen,
  onOpenNav,
  showRefresh = false,
}: {
  title: string;
  description: string;
  isNavOpen: boolean;
  onOpenNav: () => void;
  /** Re-fetch server data from the current page. Overview page only. */
  showRefresh?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

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
            onClick={() => startTransition(() => router.refresh())}
            disabled={isPending}
            aria-busy={isPending}
            aria-label={isPending ? "Refreshing data" : "Refresh data"}
            title={isPending ? "Refreshing data…" : "Refresh data"}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-white/[0.03] text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60 sm:size-9"
          >
            <RefreshIcon
              className={`size-4 ${isPending ? "animate-spin text-[#9945FF]" : ""}`}
            />
          </button>
        )}

        <WalletAvatarDropdown />
      </div>
    </header>
  );
}
