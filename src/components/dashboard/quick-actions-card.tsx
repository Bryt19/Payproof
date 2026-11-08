"use client";

import { LinkIcon, ChartBarIcon } from "@/components/dashboard/icons";

export function QuickActionsCard() {
  const actions = [
    {
      href: "/payment-requests",
      label: "Create payment request",
      icon: <LinkIcon className="size-4" />,
    },
    {
      href: "/payments",
      label: "View payments",
      icon: <ChartBarIcon className="size-4" />,
    },
  ] as const;

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="text-sm font-semibold" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        Quick actions
      </h3>
      <p className="mt-0.5 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
        Use the actions that already exist in Payproof.
      </p>

      <div className="mt-4 space-y-2">
        {actions.map((action) => (
          <a
            key={action.href}
            href={action.href}
            className="flex w-full items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-4 py-3 text-sm font-medium text-neutral-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF]"
          >
            <span className="shrink-0 text-neutral-400">{action.icon}</span>
            <span className="truncate">{action.label}</span>
            <span className="shrink-0 text-neutral-500">→</span>
          </a>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-neutral-500">
        Payment requests open a form on their own page. Paid amounts only count after on-chain verification.
      </p>
    </div>
  );
}
