"use client";

import { useEffect, useState, type ReactNode } from "react";
import SidebarNav from "./sidebar-nav";
import TopBar from "./topbar";

const STORAGE_KEY = "payproof_sidebar_collapsed";

export default function DashboardShell({
  title,
  description,
  children,
  showRefresh = false,
  onRefresh,
  isRefreshing,
}: {
  title: string;
  description: string;
  children: ReactNode;
  /** Show a refresh control in the top bar. */
  showRefresh?: boolean;
  /** Custom refresh handler for client-fetched pages. */
  onRefresh?: () => void;
  /** External refreshing state for custom refresh handlers. */
  isRefreshing?: boolean;
}) {
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const handleToggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      // Notify charts and responsive layouts after transition finishes
      setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 230);
      return next;
    });
  };

  useEffect(() => {
    if (!isNavOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsNavOpen(false);
    }

    // Lock page scroll behind the mobile drawer.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isNavOpen]);

  return (
    <div className="min-h-dvh bg-canvas text-ink lg:h-dvh lg:overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden border-r border-[rgba(255,255,255,0.08)] bg-surface transition-[width] duration-200 ease-in-out lg:flex lg:flex-col ${
          isCollapsed ? "w-[72px] overflow-visible" : "w-[260px]"
        }`}
      >
        <SidebarNav
          isCollapsed={isCollapsed}
          onToggleCollapse={handleToggleCollapse}
        />
      </aside>

      {/* Mobile slide-over drawer (always standard width) */}
      {isNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setIsNavOpen(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          {/* Drawer */}
          <div
            id="mobile-navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-2xl"
            style={{ boxShadow: "4px 0 32px rgba(153,69,255,0.15)" }}
          >
            <SidebarNav onClose={() => setIsNavOpen(false)} isCollapsed={false} />
          </div>
        </div>
      )}

      {/* Main content - smoothly animates padding with sidebar width */}
      <div
        className={`flex min-h-dvh flex-col transition-[padding-left] duration-200 ease-in-out lg:h-dvh ${
          isCollapsed ? "lg:pl-[72px]" : "lg:pl-[260px]"
        }`}
      >
        <TopBar
          title={title}
          description={description}
          isNavOpen={isNavOpen}
          onOpenNav={() => setIsNavOpen(true)}
          showRefresh={showRefresh}
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
        />

        <main className="flex-1 px-4 py-4 sm:px-6 sm:py-6 lg:overflow-y-auto lg:px-9 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
