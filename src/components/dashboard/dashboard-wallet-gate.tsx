"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMerchantSession } from "@/lib/auth/use-merchant-session";
import { shortenAddress } from "@/lib/solana/address";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";

const LOGIN_PATH = "/login";

/**
 * Client-side gate for merchant console routes.
 *
 * The server has already confirmed the merchant session (see DashboardGate), so
 * this gate reconciles the two client-side identities:
 *
 * - the session cookie decides which merchant is signed in and owns the data;
 * - the connected browser wallet only matters for wallet-dependent operations
 *   (payment signing) and for confirming the console is acting as that merchant.
 *
 * When `requireWallet` is false (for example the notifications page), a missing
 * wallet does not block session-authenticated data.
 */
export default function DashboardWalletGate({
  children,
  requireWallet = true,
}: {
  children: React.ReactNode;
  requireWallet?: boolean;
}) {
  const { status, address, disconnect } = useWalletAuth();
  const session = useMerchantSession();
  const router = useRouter();

  const connectedAddress = typeof address === "string" && address.length > 0 ? address : null;
  const sessionWallet =
    session.status === "authenticated" && typeof session.walletAddress === "string"
      ? session.walletAddress
      : null;

  const mustSignIn = session.status === "unauthenticated" || (requireWallet && status === "disconnected");

  useEffect(() => {
    if (mustSignIn) {
      router.replace(LOGIN_PATH);
    }
  }, [mustSignIn, router]);

  if (session.status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div
          role="alert"
          className="w-full max-w-md rounded-2xl border border-red-400/25 bg-red-950/20 p-6 text-center"
        >
          <h1 className="text-base font-semibold text-red-100">Could not confirm your session</h1>
          <p className="mt-2 text-xs leading-relaxed text-red-200/75">
            {session.failure?.message ?? "The merchant session could not be checked."}
          </p>
          <button
            type="button"
            onClick={() => session.refresh()}
            className="mt-3 rounded-xl border border-red-400/30 px-3.5 py-2 text-xs text-red-100 transition-colors hover:bg-red-400/10"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (mustSignIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4" role="status" aria-live="polite">
        <p className="text-xs text-white/55">
          {session.status === "unauthenticated" ? "No active merchant session." : "No wallet connected."}{" "}
          Taking you to{" "}
          <Link
            href={LOGIN_PATH}
            className="font-medium text-[#14F195] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#9945FF]"
          >
            sign in
          </Link>
          …
        </p>
      </div>
    );
  }

  const walletSatisfied =
    status === "connected" || (!requireWallet && status === "disconnected");

  // Connected — render the page normally.
  if (walletSatisfied) {
    return <>{children}</>;
  }

  const message =
    session.status === "checking"
      ? "Confirming your merchant session…"
      : status === "connecting"
        ? "Connecting your wallet…"
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
      </div>
    </div>
  );
}
