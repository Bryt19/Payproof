"use client";

import {
  LinkIcon,
  ChartBarIcon,
  InvoicesIcon,
  AssistantIcon,
} from "@/components/dashboard/icons";

export function QuickActionsCard({ className = "" }: { className?: string } = {}) {
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
    {
      href: "/invoices",
      label: "View invoices",
      icon: <InvoicesIcon className="size-4" />,
    },
    {
      href: "/ai-assistant",
      label: "AI assistant",
      icon: <AssistantIcon className="size-4" />,
    },
  ] as const;

  return (
    <div
      className={`rounded-2xl border border-line bg-surface p-4 sm:p-5 xl:p-4.5 h-fit xl:self-start ${className}`.trim()}
    >
      <h3 className="text-sm font-semibold" style={{ fontFamily: "'DM Sans', sans-serif" }}>
        Quick actions
      </h3>
      <p className="mt-0.5 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
        Use the actions that already exist in Payproof.
      </p>

      <div className="mt-3.5 space-y-2">
        {actions.map((action) => (
          <a
            key={action.href}
            href={action.href}
            className="flex w-full items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3.5 py-2.5 text-sm font-medium text-neutral-200 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF]"
          >
            <span className="shrink-0 text-neutral-400">{action.icon}</span>
            <span className="truncate">{action.label}</span>
            <span className="shrink-0 text-neutral-500">→</span>
          </a>
        ))}
      </div>

      <p className="mt-2.5 text-[11px] text-neutral-500">
        Payment requests open a form on their own page. Paid amounts only count after on-chain verification.
      </p>
    </div>
  );
}
