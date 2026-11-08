"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/button";
import { WalletConnectModal } from "./wallet-connect-modal";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";
import { wallet } from "@content/payproof";

type Intent = "connect" | "payment";

export function HeroWalletActions() {
  const router = useRouter();
  const { status, isConnected, isConnecting, error, retry } = useWalletAuth();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [intent, setIntent] = useState<Intent>("connect");
  // Keep the latest intent in a ref so the modal's onConnected callback
  // always sees the intent that was set when the user opened the modal,
  // even if the callback capture is stale.
  const intentRef = useRef<Intent>("connect");

  useEffect(() => {
    intentRef.current = intent;
  }, [intent]);

  const openModal = (nextIntent: Intent) => {
    setIntent(nextIntent);
    setIsModalOpen(true);
  };

  const closeModal = useCallback(() => setIsModalOpen(false), []);

  const handleConnected = useCallback(() => {
    setIsModalOpen(false);
    if (intentRef.current === "payment") router.push(wallet.paymentHref);
  }, [router]);

  const handleMakePayment = () => {
    if (isConnected) {
      router.push(wallet.paymentHref);
      return;
    }

    openModal("payment");
  };

  // The wallet store restores the last session asynchronously. Render a
  // skeleton until that finishes so the label never flashes the wrong state.
  if (status === "checking") {
    return (
      <>
        <p role="status" className="sr-only">
          {wallet.checking}
        </p>
        <div
          aria-hidden="true"
          className="mt-10 flex flex-col sm:flex-row items-stretch sm:items-center justify-start gap-4 w-full sm:w-auto"
        >
          <div className="h-12 w-full sm:w-48 animate-pulse rounded-full border border-white/10 bg-white/[0.06]" />
          <div className="h-12 w-full sm:w-40 animate-pulse rounded-full border border-white/10 bg-white/[0.04]" />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="mt-10 flex flex-col sm:flex-row items-stretch sm:items-center justify-start gap-4 w-full sm:w-auto">
        {isConnected ? (
          <Button
            href={wallet.dashboardHref}
            size="lg"
            variant="primary"
            className="w-full sm:w-auto px-8"
          >
            {wallet.connected}
          </Button>
        ) : (
          <Button
            type="button"
            size="lg"
            variant="primary"
            className="w-full sm:w-auto px-8"
            onClick={() => openModal("connect")}
            disabled={isConnecting}
            aria-busy={isConnecting}
          >
            {isConnecting ? wallet.connecting : wallet.connect}
          </Button>
        )}

        <Button
          type="button"
          size="lg"
          variant="outline"
          className="w-full sm:w-auto px-8"
          onClick={handleMakePayment}
          disabled={isConnecting}
        >
          {wallet.makePayment}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 flex flex-col sm:flex-row items-start sm:items-center gap-2 text-left text-xs text-red-300"
        >
          <p>
            {wallet.errorPrefix} {error}
          </p>
          <button
            type="button"
            onClick={retry}
            disabled={isConnecting}
            className="rounded-full border border-red-300/30 px-3 py-1 font-semibold text-red-100 transition-colors hover:bg-red-400/10 focus-visible:outline-2 focus-visible:outline-[#9945FF] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {wallet.retry}
          </button>
        </div>
      )}

      <WalletConnectModal
        open={isModalOpen}
        onClose={closeModal}
        onConnected={handleConnected}
      />
    </>
  );
}
