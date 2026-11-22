"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useClient } from "@solana/react";
import { useSignMessage } from "@solana/kit-plugin-wallet/react";

import { Button } from "@/components/ui/button";
import { WalletAvatar } from "@/components/wallet-avatar";
import {
  describeSignatureError,
  requestChallenge,
  signatureToBase64,
  submitSignature,
  type MerchantAuthFailure,
} from "@/lib/auth/client";
import { useMerchantSession } from "@/lib/auth/use-merchant-session";
import type { AppClient } from "@/lib/solana/client";
import { shortenAddress } from "@/lib/solana/address";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";

const CONSOLE_PATH = "/dashboard";
const CHALLENGE_TTL_MINUTES = 5;

type Phase = "idle" | "requesting" | "signing" | "verifying";

const PHASE_LABEL: Record<Exclude<Phase, "idle">, string> = {
  requesting: "Requesting a signing challenge…",
  signing: "Waiting for your wallet to sign…",
  verifying: "Verifying the signature…",
};

function FailureAlert({
  failure,
  onRetry,
}: {
  failure: MerchantAuthFailure;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="mt-4 rounded-xl border border-red-400/25 bg-red-400/[0.07] p-3"
    >
      <p className="text-xs leading-relaxed text-red-100/90">{failure.message}</p>
      {onRetry && failure.retryable ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-full border border-red-300/30 px-3 py-1 text-[11px] font-semibold text-red-100 transition-colors hover:bg-red-400/10 focus-visible:outline-2 focus-visible:outline-[#9945FF]"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export default function LoginClient() {
  const router = useRouter();
  const client = useClient<AppClient>();
  const signMessage = useSignMessage(client);
  const session = useMerchantSession();
  const {
    status: walletStatus,
    wallets,
    isConnecting,
    walletName,
    address,
    error: walletError,
    connect,
    retry: retryConnect,
    disconnect,
  } = useWalletAuth();

  const [phase, setPhase] = useState<Phase>("idle");
  const [failure, setFailure] = useState<MerchantAuthFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isBusy = phase !== "idle";

  // Already signed in with this wallet: go straight to the console. Requiring
  // the same connected wallet avoids a redirect loop with the console gate,
  // which sends a disconnected browser back here.
  const isSignedInWithThisWallet =
    session.status === "authenticated" &&
    typeof session.walletAddress === "string" &&
    walletStatus === "connected" &&
    address === session.walletAddress;

  useEffect(() => {
    if (!isSignedInWithThisWallet) return;
    router.replace(CONSOLE_PATH);
  }, [isSignedInWithThisWallet, router]);

  const handleSignIn = useCallback(async () => {
    if (!address || isBusy) return;

    setFailure(null);
    setNotice(null);
    setPhase("requesting");

    const challengeResult = await requestChallenge(address);

    if (!challengeResult.ok) {
      setFailure(challengeResult.failure);
      setPhase("idle");
      return;
    }

    const challenge = challengeResult.challenge;

    if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
      setFailure({
        kind: "expired-challenge",
        message:
          "That signing request expired before your wallet opened it. Try again to get a fresh one.",
        retryable: true,
      });
      setPhase("idle");
      return;
    }

    setPhase("signing");

    let signature: ArrayLike<number>;

    try {
      // Sign exactly the server-generated message. The server rebuilds the same
      // bytes from the stored nonce and domain; it never trusts a client copy.
      signature = await signMessage.dispatchAsync(
        new TextEncoder().encode(challenge.message),
      );
    } catch (error) {
      setFailure(describeSignatureError(error));
      setPhase("idle");
      return;
    }

    setPhase("verifying");

    const verifyResult = await submitSignature({
      nonce: challenge.nonce,
      domain: challenge.domain,
      walletAddress: address,
      signature: signatureToBase64(signature),
    });

    if (!verifyResult.ok) {
      setFailure(verifyResult.failure);
      setPhase("idle");
      return;
    }

    // The session now lives in an HttpOnly cookie; nothing is stored in
    // localStorage, and the token itself is never exposed to this page.
    setNotice("Signed in. Opening your merchant console…");
    router.replace(CONSOLE_PATH);
    router.refresh();
  }, [address, isBusy, router, signMessage]);

  const handleUseDifferentWallet = useCallback(() => {
    if (isBusy) return;
    setFailure(null);
    setNotice(null);
    disconnect();
  }, [disconnect, isBusy]);

  const isChecking = session.status === "checking" || walletStatus === "checking";

  return (
    <main className="min-h-dvh bg-canvas text-ink">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
        <header className="flex flex-col gap-3">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/payproof-icon.png"
              alt=""
              className="size-8 rounded-lg border border-white/10"
            />
            <span className="text-sm font-semibold tracking-tight text-white">
              Payproof
            </span>
          </Link>

          <div>
            <h1
              className="text-xl font-semibold tracking-tight text-white"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              Sign in to the merchant console
            </h1>
            <p className="mt-1.5 text-xs leading-relaxed text-white/50">
              Connect your Solana wallet and sign a message to prove you own it.
              Signing is free — no transaction is sent and no SOL is spent.
            </p>
          </div>
        </header>

        <section
          aria-labelledby="login-panel-title"
          className="rounded-2xl border border-white/[0.08] bg-[#0E0E12] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
        >
          <h2 id="login-panel-title" className="sr-only">
            Wallet sign-in
          </h2>

          {isChecking ? (
            <div role="status" aria-busy="true" aria-live="polite">
              <div className="h-11 animate-pulse rounded-xl bg-white/[0.05]" />
              <p className="mt-3 text-xs text-white/40">
                {session.status === "checking"
                  ? "Checking your session…"
                  : "Looking for your Solana wallet…"}
              </p>
            </div>
          ) : session.status === "error" && session.failure ? (
            <>
              <FailureAlert failure={session.failure} onRetry={session.refresh} />
              <button
                type="button"
                onClick={session.refresh}
                className="mt-3 rounded-full border border-white/15 px-3 py-1 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-[#9945FF]"
              >
                Check again
              </button>
            </>
          ) : walletStatus === "connected" && address ? (
            <>
              <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <WalletAvatar name={walletName} address={address} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {walletName ?? "Connected wallet"}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-white/45">
                    {shortenAddress(address)}
                  </p>
                </div>
              </div>

              <Button
                type="button"
                size="md"
                variant="primary"
                onClick={handleSignIn}
                disabled={isBusy}
                aria-busy={isBusy}
                className="mt-4 w-full"
              >
                {isBusy ? PHASE_LABEL[phase as Exclude<Phase, "idle">] : "Sign in with this wallet"}
              </Button>

              <button
                type="button"
                onClick={handleUseDifferentWallet}
                disabled={isBusy}
                className="mt-2 w-full rounded-full px-3 py-2 text-[11px] font-medium text-white/50 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-[#9945FF] disabled:opacity-50"
              >
                Use a different wallet
              </button>

              <p className="mt-3 text-center text-[11px] leading-relaxed text-white/35">
                The request is single-use and expires after {CHALLENGE_TTL_MINUTES}{" "}
                minutes. Your session lasts 15 minutes.
              </p>

              {session.status === "authenticated" &&
              session.walletAddress &&
              session.walletAddress !== address ? (
                <p className="mt-2 text-center text-[11px] leading-relaxed text-amber-200/70">
                  A different wallet is currently signed in. Signing here will
                  switch the console to this wallet.
                </p>
              ) : null}
            </>
          ) : wallets.length === 0 ? (
            <div role="status" className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <p className="text-sm font-medium text-white/85">
                No Solana wallet detected
              </p>
              <p className="mt-1 text-xs leading-relaxed text-white/45">
                Install a Solana wallet such as Phantom or Solflare in this
                browser, then reload this page to sign in.
              </p>
              <a
                href="https://phantom.app/download"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex rounded-full border border-white/15 px-3 py-1 text-[11px] font-semibold text-white/80 transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-[#9945FF]"
              >
                Get Phantom
              </a>
            </div>
          ) : (
            <>
              <p className="text-[11px] font-medium uppercase tracking-wider text-white/40">
                Choose a wallet
              </p>
              <ul className="mt-2 space-y-2">
                {wallets.map((option, index) => (
                  <li key={`${option.name}-${index}`}>
                    <button
                      type="button"
                      disabled={isConnecting}
                      onClick={() => {
                        setFailure(null);
                        setNotice(null);
                        connect(option.name);
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm font-medium text-white/85 transition-colors hover:border-[#9945FF]/40 hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-[#9945FF] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>{option.name}</span>
                      <span aria-hidden="true" className="text-white/30">
                        →
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {isConnecting ? (
                <p role="status" className="mt-3 text-xs text-[#14F195]">
                  Approve the connection in your wallet…
                </p>
              ) : null}
            </>
          )}

          {walletError ? (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-400/25 bg-red-400/[0.07] p-3"
            >
              <p className="text-xs leading-relaxed text-red-100/90">{walletError}</p>
              <button
                type="button"
                onClick={retryConnect}
                disabled={isConnecting || wallets.length === 0}
                className="mt-2 rounded-full border border-red-300/30 px-3 py-1 text-[11px] font-semibold text-red-100 transition-colors hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[#9945FF]"
              >
                Retry connection
              </button>
            </div>
          ) : null}

          {failure ? (
            <FailureAlert
              failure={failure}
              onRetry={walletStatus === "connected" ? handleSignIn : undefined}
            />
          ) : null}

          {notice ? (
            <p role="status" aria-live="polite" className="mt-4 text-xs text-[#14F195]">
              {notice}
            </p>
          ) : null}
        </section>

        <p className="text-[11px] leading-relaxed text-white/30">
          Payproof never asks for your recovery phrase or private key. Signing
          happens inside your wallet, and the session is kept in a secure,
          HttpOnly cookie that page scripts cannot read.
        </p>
      </div>
    </main>
  );
}
