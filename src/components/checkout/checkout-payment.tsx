"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useClient } from "@solana/react";
import {
  useConnectedWallet,
  useIsWalletReady,
} from "@solana/kit-plugin-wallet/react";
import {
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Decoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type TransactionMessage,
  type TransactionMessageBytesBase64,
  type TransactionMessageWithBlockhashLifetime,
  type TransactionMessageWithFeePayer,
} from "@solana/kit";
import type { PaymentRequest } from "@/lib/payment-requests/types";
import { shortenAddress } from "@/lib/solana/address";
import { fetchSolBalance } from "@/lib/solana/balance";
import type { AppClient } from "@/lib/solana/client";
import { SOLANA_NETWORK_NAME } from "@/lib/solana/config";
import {
  BASE_TRANSACTION_FEE_LAMPORTS,
  buildPaymentTransfer,
  describePaymentFailure,
  getDevnetTransactionExplorerUrl,
  PaymentTransferError,
} from "@/lib/solana/payment";
import { formatSol, formatSolExact } from "@/lib/solana/units";
import { useIsHydrated } from "@/lib/use-is-hydrated";

type PaymentPhase =
  | "idle"
  | "preparing"
  | "awaiting-approval"
  | "submitting"
  | "verifying"
  | "awaiting-confirmation"
  | "verification-error"
  | "verified"
  | "rejected"
  | "insufficient"
  | "failed";

type Shortfall = { balance: bigint; required: bigint };

type PaymentMessage = TransactionMessage &
  TransactionMessageWithFeePayer &
  TransactionMessageWithBlockhashLifetime;

type VerificationResponse = {
  status?: "pending" | "verified" | "rejected" | "error";
  message?: string;
  requestStatus?: PaymentRequest["status"];
  payerAddress?: string;
  retryable?: boolean;
};

const verifiedAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * Asks the configured Devnet RPC what this message costs.
 *
 * The wallet and the network preflight remain authoritative; this is only used
 * to catch an obviously underfunded wallet before showing a wallet prompt.
 */
async function estimateNetworkFee(
  client: AppClient,
  message: PaymentMessage,
): Promise<bigint> {
  try {
    const compiled = compileTransaction(message);
    const encodedMessage = getBase64Decoder().decode(
      compiled.messageBytes,
    ) as TransactionMessageBytesBase64;

    const { value } = await client.rpc
      .getFeeForMessage(encodedMessage, { commitment: "confirmed" })
      .send();

    if (typeof value === "bigint" && value > 0n) {
      return value;
    }
  } catch {
    // Fall back to the base fee; the wallet and preflight still enforce the
    // real fee, so a failed estimate is never treated as payment success.
  }

  return BASE_TRANSACTION_FEE_LAMPORTS;
}

function SignatureBlock({
  signature,
  label,
  tone,
}: {
  signature: string;
  label: string;
  tone: "success" | "neutral";
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(signature);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Clipboard unavailable
    }
  }

  return (
    <div
      role="status"
      className={
        tone === "success"
          ? "space-y-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4"
          : "space-y-2.5 rounded-xl border border-line bg-canvas p-4"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <p
          className={
            tone === "success"
              ? "text-xs font-semibold text-emerald-400"
              : "text-xs font-semibold text-neutral-200"
          }
        >
          {label}
        </p>

        <button
          type="button"
          onClick={() => void handleCopy()}
          className="rounded border border-line/60 bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-neutral-300 hover:text-white"
        >
          {copied ? "Copied" : "Copy signature"}
        </button>
      </div>

      <p className="break-all font-mono text-[11px] text-neutral-200 bg-black/40 p-2 rounded-lg border border-line/40">
        {signature}
      </p>

      <a
        href={getDevnetTransactionExplorerUrl(signature)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span>View on Solana Explorer (Devnet)</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5" aria-hidden="true">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </a>
    </div>
  );
}

function PaidPanel({ request }: { request: PaymentRequest }) {
  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-surface/90 p-6 shadow-xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-emerald-500/15 text-emerald-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-6" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-emerald-400">
              Payment confirmed
            </h2>
            <p className="text-xs text-muted">
              PayProof verified this transaction on Solana Devnet at confirmed commitment.
            </p>
          </div>
        </div>

        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
          <span aria-hidden="true" className="size-2 rounded-full bg-emerald-400" />
          Paid & Verified
        </span>
      </div>

      <dl className="grid gap-3 rounded-xl border border-line/60 bg-surface-raised/40 p-4 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-muted">Amount</dt>
          <dd className="mt-1 font-mono text-base font-bold text-white">
            {formatSolExact(BigInt(request.amountLamports))} SOL
          </dd>
        </div>

        <div>
          <dt className="text-muted">Paid by</dt>
          <dd className="mt-1 break-all font-mono text-neutral-300">
            {request.payerAddress ?? "Not recorded"}
          </dd>
        </div>

        <div>
          <dt className="text-muted">Merchant wallet</dt>
          <dd className="mt-1 break-all font-mono text-neutral-300">
            {request.merchantAddress ?? "Not recorded"}
          </dd>
        </div>

        {request.verifiedAt && (
          <div>
            <dt className="text-muted">Verified timestamp</dt>
            <dd className="mt-1 text-neutral-300">
              {verifiedAtFormatter.format(new Date(request.verifiedAt))}
            </dd>
          </div>
        )}
      </dl>

      {request.transactionSignature && (
        <SignatureBlock
          signature={request.transactionSignature}
          label="Verified Solana Transaction"
          tone="success"
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-line/60">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span>Return to Dashboard</span>
        </Link>

        <p className="text-[11px] text-muted">
          Verified on-chain. Proof stored on PayProof.
        </p>
      </div>
    </div>
  );
}

function ClosedPanel({ request }: { request: PaymentRequest }) {
  return (
    <div className="rounded-2xl border border-line bg-surface/90 p-6 shadow-xl space-y-4">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-red-500/10 text-red-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
        <div>
          <h2 className="text-base font-semibold text-neutral-200">
            This request is {request.status}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            No payment can be made against this request. Ask the merchant to create a new payment request.
          </p>
        </div>
      </div>

      <div className="pt-2">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-4 py-2 text-sm font-medium text-neutral-200 hover:bg-white/5"
        >
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}

export default function CheckoutPayment({
  request,
  onBack,
}: {
  request: PaymentRequest;
  onBack?: () => void;
}) {
  const client = useClient<AppClient>();
  const router = useRouter();
  const isHydrated = useIsHydrated();
  const isWalletReady = useIsWalletReady(client);
  const connectedWallet = useConnectedWallet(client);

  const [phase, setPhase] = useState<PaymentPhase>("idle");
  const [signature, setSignature] = useState<string | null>(null);
  const [payerAddress, setPayerAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shortfall, setShortfall] = useState<Shortfall | null>(null);

  // Guards against double-click in-flight
  const inFlight = useRef(false);
  const verificationInFlight = useRef(false);

  const isBusy =
    phase === "preparing" ||
    phase === "awaiting-approval" ||
    phase === "submitting" ||
    phase === "verifying";

  const signer = connectedWallet?.signer ?? null;
  const customerAddress = connectedWallet?.account.address ?? null;
  const isReady =
    isHydrated && isWalletReady && Boolean(connectedWallet) && Boolean(signer);

  // A submitted signature disables new payments until verification either
  // confirms it or definitively rejects the transaction.
  const canPay =
    isReady &&
    Boolean(request.merchantAddress) &&
    !isBusy &&
    signature === null &&
    phase !== "verified";

  const verifyPayment = useCallback(
    async (paymentSignature: string) => {
      if (verificationInFlight.current) return;

      verificationInFlight.current = true;
      setPhase("verifying");
      setError(null);

      try {
        const response = await fetch("/api/payment-requests/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reference: request.reference,
            signature: paymentSignature,
          }),
        });

        const data = (await response.json().catch(() => null)) as
          | VerificationResponse
          | null;

        if (!data?.status) {
          setPhase("verification-error");
          setError(
            "PayProof could not read the verification response. Please retry verification.",
          );
          return;
        }

        if (data.status === "verified") {
          setPhase("verified");
          setPayerAddress(data.payerAddress ?? null);
          router.refresh();
          return;
        }

        if (data.status === "pending") {
          setPhase("awaiting-confirmation");
          if (data.message) setError(data.message);
          return;
        }

        if (data.status === "rejected") {
          // The transaction cannot pay this request. Clear the signature so the
          // customer can pay again if they still need to.
          setSignature(null);
          setPayerAddress(null);
          setPhase("failed");
          setError(
            data.message ??
              "PayProof could not verify this transaction as payment for this request.",
          );
          router.refresh();
          return;
        }

        setPhase("verification-error");
        setError(
          data.message ??
            "PayProof could not complete verification. Please retry verification.",
        );
      } catch {
        setPhase("verification-error");
        setError(
          "Could not reach PayProof's verification service. The transaction may still be processing — retry verification.",
        );
      } finally {
        verificationInFlight.current = false;
      }
    },
    [request.reference, router],
  );

  const handlePay = useCallback(async () => {
    if (inFlight.current || signature !== null) return;
    if (!signer) return;

    const merchantAddress = request.merchantAddress;
    if (!merchantAddress) return;

    inFlight.current = true;
    setSignature(null);
    setPayerAddress(null);
    setError(null);
    setShortfall(null);
    setPhase("preparing");

    try {
      const transfer = buildPaymentTransfer({
        source: signer,
        merchantAddress,
        amountLamports: request.amountLamports,
        reference: request.reference,
      });

      const [latestBlockhash, balance] = await Promise.all([
        client.rpc.getLatestBlockhash({ commitment: "confirmed" }).send(),
        fetchSolBalance(client, signer.address),
      ]);

      const message = pipe(
        createTransactionMessage({ version: "legacy" }),
        (transactionMessage) =>
          setTransactionMessageFeePayerSigner(signer, transactionMessage),
        (transactionMessage) =>
          setTransactionMessageLifetimeUsingBlockhash(
            latestBlockhash.value,
            transactionMessage,
          ),
        (transactionMessage) =>
          appendTransactionMessageInstruction(
            transfer.instruction,
            transactionMessage,
          ),
      ) satisfies PaymentMessage;

      const fee = await estimateNetworkFee(client, message);
      const required = transfer.amountLamports + fee;

      if (balance < required) {
        setShortfall({ balance, required });
        setPhase("insufficient");
        return;
      }

      setPhase("awaiting-approval");
      const signedTransaction = await signTransactionMessageWithSigners(message);

      setPhase("submitting");
      const submittedSignature = await client.rpc
        .sendTransaction(getBase64EncodedWireTransaction(signedTransaction), {
          encoding: "base64",
          preflightCommitment: "confirmed",
        })
        .send();

      if (!submittedSignature) {
        throw new Error("The RPC did not return a transaction signature.");
      }

      const signatureString = String(submittedSignature);
      setSignature(signatureString);
      setPhase("verifying");

      await verifyPayment(signatureString);
    } catch (cause) {
      if (cause instanceof PaymentTransferError) {
        setError(cause.message);
        setPhase("failed");
        return;
      }

      const failure = describePaymentFailure(cause);

      if (failure.kind === "rejected") {
        setPhase("rejected");
        return;
      }

      if (failure.kind === "insufficient") {
        setShortfall(null);
        setError(failure.message);
        setPhase("insufficient");
        return;
      }

      setError(failure.message);
      setPhase("failed");
    } finally {
      inFlight.current = false;
    }
  }, [client, request, signature, signer, verifyPayment]);

  const handleRetryVerification = useCallback(() => {
    if (!signature || verificationInFlight.current) return;
    void verifyPayment(signature);
  }, [signature, verifyPayment]);

  if (request.status === "paid" || phase === "verified") {
    return (
      <PaidPanel
        request={{
          ...request,
          status: "paid",
          transactionSignature: signature ?? request.transactionSignature,
          payerAddress: payerAddress ?? request.payerAddress,
          verifiedAt: request.verifiedAt ?? new Date().toISOString(),
        }}
      />
    );
  }

  if (request.status === "expired" || request.status === "cancelled") {
    return <ClosedPanel request={request} />;
  }

  const amountSol = formatSolExact(BigInt(request.amountLamports));
  const hasSignature = signature !== null;

  return (
    <div className="rounded-2xl border border-line bg-surface/90 p-6 shadow-xl space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft/40 px-2.5 py-1 text-[11px] font-medium text-accent">
            Step 3 of 3
          </div>
          <h2 className="mt-2 text-base font-semibold text-white">
            Make payment
          </h2>
          <p className="mt-1 text-xs text-muted leading-relaxed">
            Click below to initiate the transfer. Your browser wallet will prompt you to approve and sign.
          </p>
        </div>

        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
          {SOLANA_NETWORK_NAME}
        </span>
      </div>

      {/* Transaction Recap Strip */}
      <div className="rounded-xl border border-line/80 bg-surface-raised/50 p-4">
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div className="flex items-baseline justify-between sm:flex-col sm:gap-1">
            <dt className="text-muted">Total Amount</dt>
            <dd className="font-mono text-lg font-bold text-white">
              {amountSol} SOL
            </dd>
          </div>

          <div className="flex items-baseline justify-between sm:flex-col sm:gap-1">
            <dt className="text-muted">Paying From</dt>
            <dd className="font-mono text-neutral-200">
              {customerAddress ? shortenAddress(customerAddress) : "Wallet not ready"}
            </dd>
          </div>

          <div className="sm:col-span-2 pt-2 border-t border-line/40 flex items-baseline justify-between gap-4">
            <dt className="shrink-0 text-muted">Merchant Address</dt>
            <dd className="break-all text-right font-mono text-neutral-300">
              {request.merchantAddress ? shortenAddress(request.merchantAddress) : "None"}
            </dd>
          </div>
        </dl>
      </div>

      {/* Wallet Signing Callout */}
      <div className="space-y-4">
        {!isHydrated || !isWalletReady ? (
          <p className="text-sm text-muted">Checking wallet readiness…</p>
        ) : !connectedWallet ? (
          <p className="text-sm text-muted">
            Connect a wallet in Step 1 to pay this request.
          </p>
        ) : !signer ? (
          <p className="text-sm text-red-300">
            This connected wallet cannot sign transactions. Please connect a standard Solana wallet.
          </p>
        ) : !request.merchantAddress ? (
          <p role="alert" className="text-sm text-red-300">
            This request has no merchant wallet recorded and cannot be paid.
          </p>
        ) : (
          <p className="text-xs text-muted leading-relaxed">
            Signing happens safely inside your wallet extension. PayProof never stores or accesses your private keys or seed phrase.
          </p>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          {onBack && !isBusy && (
            <button
              type="button"
              onClick={onBack}
              disabled={isBusy}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-raised px-4 py-2.5 text-sm font-medium text-neutral-300 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              <span>Back to Details</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void handlePay()}
            disabled={!canPay}
            aria-busy={isBusy}
            className="inline-flex items-center justify-center gap-2 rounded-xl btn-brand-gradient px-6 py-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy && (
              <div className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            )}
            <span>
              {phase === "preparing"
                ? "Preparing transaction…"
                : phase === "awaiting-approval"
                  ? "Approve in wallet…"
                  : phase === "submitting"
                    ? "Submitting to Devnet…"
                    : phase === "verifying"
                      ? "Verifying payment…"
                      : phase === "awaiting-confirmation"
                        ? "Awaiting confirmation…"
                        : phase === "verification-error"
                          ? "Verification incomplete"
                          : !isReady
                            ? "Connect wallet first"
                            : !request.merchantAddress
                              ? "Payment unavailable"
                              : phase === "rejected" || phase === "failed"
                                ? `Retry Pay ${amountSol} SOL`
                                : `Pay ${amountSol} SOL`}
            </span>
          </button>

          {(phase === "awaiting-confirmation" ||
            phase === "verification-error") && (
            <button
              type="button"
              onClick={handleRetryVerification}
              className="rounded-xl border border-line bg-surface-raised px-4 py-2.5 text-sm font-medium text-neutral-200 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {phase === "awaiting-confirmation"
                ? "Check verification again"
                : "Retry verification"}
            </button>
          )}
        </div>

        {/* Live Feedback Messages */}
        <div aria-live="polite" className="space-y-3 pt-2">
          {isBusy && (
            <div className="rounded-xl border border-accent/20 bg-accent-soft/20 p-3.5 text-xs text-neutral-200 flex items-center gap-3">
              <div className="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent shrink-0" />
              <span>
                {phase === "preparing"
                  ? "Building the Devnet transfer transaction with recent blockhash…"
                  : phase === "awaiting-approval"
                    ? "Check your wallet window to confirm and sign the transaction."
                    : phase === "submitting"
                      ? "Submitting the signed transaction to Solana Devnet RPC…"
                      : "Verifying transaction independently on Solana Devnet…"}
              </span>
            </div>
          )}

          {hasSignature && (
            <SignatureBlock
              signature={signature}
              label="Transaction submitted to Solana Devnet"
              tone="neutral"
            />
          )}

          {phase === "awaiting-confirmation" && (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-300">
              {error ?? "The transaction has not reached confirmed commitment yet."} This is not a failed payment; check again in a moment.
            </div>
          )}

          {phase === "verification-error" && error && (
            <div role="alert" className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-300">
              {error}
            </div>
          )}

          {phase === "rejected" && (
            <div role="alert" className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-300">
              Transaction rejected in your wallet. No SOL was moved. You can try again whenever you are ready.
            </div>
          )}

          {phase === "insufficient" && (
            <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300 space-y-2">
              <p>
                {shortfall
                  ? `Your wallet has ${formatSol(shortfall.balance)} SOL, but this payment needs ${formatSol(shortfall.required)} SOL (including network fee).`
                  : (error ?? "Your wallet does not have enough Devnet SOL for this payment.")}
              </p>
              <p className="text-[11px] text-neutral-400">
                You can get free Devnet SOL from the official Solana Devnet faucet.
              </p>
            </div>
          )}

          {phase === "failed" && error && (
            <div role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
