"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Re-fetches the server-rendered dashboard data without exposing any database
 * access to the browser. The page itself always reads Supabase on the server.
 */
export default function RefreshButton({ label = "Refresh" }: { label?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
      aria-busy={isPending}
      className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60"
    >
      {isPending ? "Refreshing…" : label}
    </button>
  );
}
