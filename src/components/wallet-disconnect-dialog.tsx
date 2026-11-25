"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useClient } from "@solana/react";
import Dialog from "@/components/dashboard/dialog";
import { Button } from "@/components/ui/button";
import type { AppClient } from "@/lib/solana/client";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";
import { describeWalletError } from "@/lib/wallet/wallet-errors";

const LANDING_PATH = "/";

type Phase = "confirm" | "working" | "failed";

/**
 * Confirmation step for ending the wallet session.
 *
 * The wallet store is the only thing that disconnects; this dialog just gates
 * the existing disconnect action behind an explicit confirmation and only
 * leaves the console once that action has settled successfully.
 */
export function DisconnectWalletDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const client = useClient<AppClient>();
  const { walletName, isDisconnecting, disconnectAsync } = useWalletAuth();
  const [phase, setPhase] = useState<Phase>("confirm");
  const [failure, setFailure] = useState<string | null>(null);
  const requestInFlight = useRef(false);

  const isWorking = phase === "working" || isDisconnecting;

  const handleClose = useCallback(() => {
    // A disconnect in flight cannot be cancelled, so keep the dialog up until
    // it settles instead of pretending the wallet is still connected.
    if (isWorking) return;

    // Every new confirmation starts clean, so an earlier failure never lingers.
    setPhase("confirm");
    setFailure(null);
    onClose();
  }, [isWorking, onClose]);

  const handleConfirm = useCallback(async () => {
    // Ignore repeat clicks before the disabled state has rendered.
    if (requestInFlight.current || isWorking) return;
    requestInFlight.current = true;

    setFailure(null);
    setPhase("working");

    let actionFailure: string | null = null;

    try {
      await disconnectAsync();
    } catch (error) {
      // Some extensions reject after they have already dropped the session, so
      // the settled store state decides the outcome rather than the throw.
      actionFailure = describeWalletError(error);
    }

    const walletState = client.wallet.getState();

    if (walletState.status !== "disconnected") {
      requestInFlight.current = false;
      setFailure(
        actionFailure ?? "Your wallet is still connected. Please try again.",
      );
      setPhase("failed");
      return;
    }

    // The store has cleared the connection. A document navigation guarantees no
    // console route (including its own disconnected redirect) can keep the user
    // in the console or render the old wallet for even a frame.
    window.location.replace(LANDING_PATH);
  }, [client, disconnectAsync, isWorking]);

  // The overlay is portalled to the document root: ancestors such as the top
  // bar use backdrop filters, which would otherwise constrain a fixed overlay.
  if (typeof document === "undefined") return null;

  return createPortal(
    <Dialog
      open={open}
      onClose={handleClose}
      title="Disconnect Wallet?"
      size="sm"
      closeOnBackdrop={!isWorking}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-red-400/25 bg-red-400/[0.06] p-3.5">
          <svg
            className="mt-0.5 size-4 shrink-0 text-red-300"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10.3 3.6 1.8 18a1.9 1.9 0 0 0 1.6 2.9h17.2a1.9 1.9 0 0 0 1.6-2.9L13.7 3.6a1.9 1.9 0 0 0-3.4 0Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p className="text-xs leading-relaxed text-red-100/85">
            This ends your wallet connection in this browser and returns you to
            the PayProof landing page. You will need to connect and sign in
            again to reach the merchant console. Your funds stay in your wallet.
          </p>
        </div>

        {walletName && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5">
            <span className="text-xs text-white/45">Connected wallet</span>
            <span className="truncate text-xs font-medium text-white/85">
              {walletName}
            </span>
          </div>
        )}

        {failure && (
          <div
            role="alert"
            className="rounded-xl border border-red-400/25 bg-red-400/[0.06] p-3"
          >
            <p className="text-xs font-medium text-red-100">
              The wallet could not be disconnected.
            </p>
            <p className="mt-1 text-xs leading-relaxed text-red-200/90">
              {failure}
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">
              You were not sent to the landing page. Try again, or reload the
              console if your wallet still appears connected.
            </p>
          </div>
        )}

        {isWorking && (
          <div className="flex items-center gap-2.5" role="status" aria-live="polite">
            <span className="payproof-spinner" aria-hidden="true" />
            <p className="text-xs text-white/60">
              Disconnecting wallet… Confirm in your wallet if prompted.
            </p>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={handleClose}
            disabled={isWorking}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={handleConfirm}
            disabled={isWorking}
            aria-busy={isWorking}
            className="w-full border border-red-500/40 bg-red-500/15 text-red-200 hover:border-red-500/60 hover:bg-red-500/25 hover:text-red-100 sm:w-auto"
          >
            {isWorking
              ? "Disconnecting…"
              : phase === "failed"
                ? "Try again"
                : "Disconnect Wallet"}
          </Button>
        </div>
      </div>
    </Dialog>,
    document.body,
  );
}
