"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";

const SETTINGS_PATH = "/settings";

/**
 * Protects the merchant console routes that need a wallet session.
 *
 * On refresh, the wallet may be restoring (warm-up/reconnect): we show a brief
 * restoring state instead of flashing "connect" or redirecting to Settings.
 * Only when the session is confirmed disconnected do we send the user to
 * Settings (which hosts the connect flow).
 */
export default function DashboardGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useWalletAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "disconnected") {
      router.replace(SETTINGS_PATH);
    }
  }, [status, router]);

  // Connected — render the page normally.
  if (status === "connected") {
    return <>{children}</>;
  }

  const message =
    status === "connecting"
      ? "Connecting your wallet…"
      : status === "disconnected"
        ? "No wallet connected."
        : "Restoring your wallet session…";

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-canvas px-4"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <span className="payproof-spinner" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-white/55">{message}</p>
        {status === "disconnected" ? (
          <p className="text-[11px] text-white/40">
            Taking you to{" "}
            <Link
              href={SETTINGS_PATH}
              className="font-medium text-[#14F195] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#9945FF]"
            >
              Settings
            </Link>
            …
          </p>
        ) : null}
      </div>
    </div>
  );
}
