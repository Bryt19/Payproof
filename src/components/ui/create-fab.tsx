"use client";

import Link from "next/link";

const baseClasses =
  "fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 inline-flex size-14 items-center justify-center rounded-full btn-brand-gradient text-white shadow-[0_10px_30px_rgba(153,69,255,0.45)] transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF] sm:hidden";

function PlusIcon() {
  return (
    <svg
      className="size-6"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/**
 * Mobile-only floating create action. Shown as a small circular "+" pinned to
 * the bottom-right so the page header stays uncluttered on phones.
 */
export default function CreateFab({
  label,
  href,
  onClick,
}: {
  label: string;
  href?: string;
  onClick?: () => void;
}) {
  if (href) {
    return (
      <Link href={href} aria-label={label} title={label} className={baseClasses}>
        <PlusIcon />
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={baseClasses}
    >
      <PlusIcon />
    </button>
  );
}
