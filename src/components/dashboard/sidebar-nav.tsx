"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";
import {
  AssistantIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  InvoicesIcon,
  OverviewIcon,
  PaymentsIcon,
  RequestsIcon,
  SettingsIcon,
} from "./icons";

type NavItem = {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  href: string;
  soon?: boolean;
};

const navItems: readonly NavItem[] = [
  { label: "Overview", icon: OverviewIcon, href: "/dashboard" },
  { label: "Payments", icon: PaymentsIcon, href: "/payments" },
  { label: "Payment Requests", icon: RequestsIcon, href: "/payment-requests" },
  { label: "Invoices", icon: InvoicesIcon, href: "/invoices" },
  { label: "AI Assistant", icon: AssistantIcon, href: "/ai-assistant" },
  { label: "Settings", icon: SettingsIcon, href: "/settings" },
];

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SidebarNav({
  onClose,
  isCollapsed = false,
  onToggleCollapse,
}: {
  onClose?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const { status, isConnected } = useWalletAuth();

  // Settings stays open without a wallet because it hosts the connect flow.
  // Every other console route requires a connected wallet.
  const isSessionKnown = status === "connected" || status === "disconnected";
  const lockConsoleLinks = isSessionKnown && !isConnected;

  return (
    <div className={`flex h-full flex-col ${isCollapsed ? "overflow-visible" : ""}`}>
      {/* Logo / Brand Header */}
      <div
        className={`flex items-center border-b border-white/[0.06] transition-all duration-200 ${
          isCollapsed
            ? "flex-col gap-3 px-2 py-4 overflow-visible"
            : "gap-3 px-5 py-4"
        }`}
      >
        <Link
          href="/"
          aria-label="Payproof — back to the landing page"
          title="Back to landing page"
          className="relative size-9 shrink-0 overflow-hidden rounded-xl border border-white/[0.1] shadow-[0_0_16px_rgba(153,69,255,0.35)] bg-black transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/payproof-icon.png"
            alt="Payproof"
            className="h-full w-full object-cover"
          />
        </Link>

        {!isCollapsed && (
          <div className="min-w-0 flex-1">
            <p
              className="text-sm font-semibold tracking-tight text-white truncate"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              Payproof
            </p>
            <p className="text-[11px] truncate" style={{ color: "rgba(255,255,255,0.4)" }}>
              Merchant console
            </p>
          </div>
        )}

        {/* Mobile close button */}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="ml-auto flex size-11 items-center justify-center rounded-lg transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 lg:hidden"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            <CloseIcon className="size-4" />
            <span className="sr-only">Close navigation</span>
          </button>
        )}

        {/* Desktop Collapse / Expand toggle button */}
        {onToggleCollapse && (
          <div className="relative group">
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="hidden lg:flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-white/50 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-[#9945FF]"
            >
              {isCollapsed ? (
                <ChevronRightIcon className="size-4" />
              ) : (
                <ChevronLeftIcon className="size-4" />
              )}
            </button>

            {/* Tooltip for toggle button */}
            <div
              role="tooltip"
              className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 z-[100] hidden group-hover:flex items-center whitespace-nowrap rounded-lg border border-white/[0.16] bg-[#16161B] px-2.5 py-1 text-[11px] font-medium text-white shadow-xl backdrop-blur-md"
            >
              <span className="absolute -left-1 top-1/2 -translate-y-1/2 size-2 rotate-45 border-b border-l border-white/[0.16] bg-[#16161B]" />
              <span className="relative z-10">{isCollapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Section */}
      <nav
        aria-label="Primary"
        className={`flex-1 px-2 py-3 ${isCollapsed ? "overflow-visible" : "overflow-y-auto"}`}
      >
        {!isCollapsed ? (
          <p
            className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-widest text-white/30"
          >
            Workspace
          </p>
        ) : (
          <div className="my-1.5 h-px w-6 bg-white/[0.08] mx-auto" />
        )}

        <ul className="space-y-1">
          {navItems.map(({ label, icon: Icon, href, soon }) => {
            const active = isActivePath(pathname, href);
            const locked = lockConsoleLinks && href !== "/settings";

            return (
              <li key={label} className="relative group">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  aria-disabled={locked || undefined}
                  tabIndex={locked ? -1 : undefined}
                  title={
                    locked
                      ? "Connect your wallet to access this page"
                      : isCollapsed
                        ? label
                        : undefined
                  }
                  onClick={(event) => {
                    if (locked) {
                      event.preventDefault();
                      return;
                    }
                    onClose?.();
                  }}
                  className={`relative flex items-center rounded-xl transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF] ${
                    isCollapsed
                      ? "size-11 mx-auto justify-center p-0"
                      : "gap-3 px-3 py-2.5 text-sm"
                  } ${locked ? "cursor-not-allowed opacity-40" : ""}`}
                  style={
                    active
                      ? {
                          background: "rgba(153,69,255,0.14)",
                          color: "#ffffff",
                          fontWeight: 500,
                          border: "1px solid rgba(153,69,255,0.3)",
                          boxShadow: "0 0 14px rgba(153,69,255,0.2)",
                        }
                      : {
                          color: soon ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.55)",
                          border: "1px solid transparent",
                        }
                  }
                >
                  {/* Active accent bar (expanded mode) */}
                  {active && !isCollapsed && (
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full"
                      style={{
                        background:
                          "linear-gradient(180deg,#9945FF 0%,#C14BF0 100%)",
                      }}
                    />
                  )}

                  <div className="relative shrink-0 flex items-center justify-center">
                    <Icon
                      className="size-4"
                      style={{ color: active ? "#9945FF" : undefined }}
                    />
                    {/* Collapsed Soon indicator: small dot */}
                    {isCollapsed && soon && (
                      <span
                        aria-hidden="true"
                        className="absolute -top-1 -right-1 size-1.5 rounded-full bg-[#C14BF0] shadow-[0_0_6px_#C14BF0]"
                      />
                    )}
                  </div>

                  {/* Label (expanded mode) */}
                  {!isCollapsed && (
                    <span className="truncate">{label}</span>
                  )}

                  {/* Soon badge (expanded mode) */}
                  {!isCollapsed && soon && (
                    <span
                      className="ml-auto rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-white shrink-0"
                      style={{
                        background:
                          "linear-gradient(135deg,#9945FF 0%,#C14BF0 100%)",
                        opacity: 0.85,
                      }}
                    >
                      Soon
                    </span>
                  )}
                </Link>

                {/* Collapsed Tooltip on hover & keyboard focus */}
                {isCollapsed && (
                  <div
                    role="tooltip"
                    className="pointer-events-none absolute left-full ml-3.5 top-1/2 -translate-y-1/2 z-[100] hidden group-hover:flex group-focus-within:flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-white/[0.16] bg-[#16161B] px-3 py-1.5 text-xs font-semibold text-white shadow-[0_4px_24px_rgba(0,0,0,0.8)] backdrop-blur-md"
                  >
                    <span className="absolute -left-1 top-1/2 -translate-y-1/2 size-2 rotate-45 border-b border-l border-white/[0.16] bg-[#16161B]" />
                    <span className="relative z-10">{label}</span>
                    {soon && (
                      <span className="relative z-10 rounded-full bg-gradient-to-r from-[#9945FF] to-[#C14BF0] px-1.5 py-0.2 text-[9px] font-semibold uppercase tracking-wider text-white">
                        Soon
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      {!isCollapsed && (
        <div className="border-t border-line p-4 transition-opacity duration-200">
          <p className="text-center text-[10px]" style={{ color: "rgba(255,255,255,0.25)" }}>
            © 2026 Payproof
          </p>
        </div>
      )}
    </div>
  );
}
