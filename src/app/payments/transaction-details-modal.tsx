"use client";

import { useEffect, useRef, useState } from "react";
import type { PaymentRequest } from "@/lib/payment-requests/types";
import { formatSolExact } from "@/lib/solana/units";
import { getDevnetTransactionExplorerUrl } from "@/lib/solana/payment";
import { shortenAddress } from "@/lib/solana/address";
import {
  CloseIcon,
  ExternalLinkIcon,
  CopyIcon,
  CheckIcon,
} from "@/components/dashboard/icons";

type TransactionDetailsModalProps = {
  payment: PaymentRequest;
  onClose: () => void;
};

const statusStyles: Record<
  PaymentRequest["status"],
  { label: string; bg: string; text: string; dot: string }
> = {
  paid: {
    label: "Verified payment",
    bg: "rgba(20,241,149,0.08)",
    text: "#14F195",
    dot: "#14F195",
  },
  pending: {
    label: "Pending",
    bg: "rgba(251,191,36,0.08)",
    text: "#fbbf24",
    dot: "#fbbf24",
  },
  expired: {
    label: "Expired",
    bg: "rgba(255,255,255,0.03)",
    text: "rgba(255,255,255,0.4)",
    dot: "#737373",
  },
  cancelled: {
    label: "Cancelled",
    bg: "rgba(255,255,255,0.03)",
    text: "rgba(255,255,255,0.4)",
    dot: "#737373",
  },
};

const createdAtFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeStyle: "long",
  timeZone: "UTC",
});

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : createdAtFormatter.format(date);
}

function formatVerifiedAt(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : createdAtFormatter.format(date);
}

function isVerified(payment: PaymentRequest): boolean {
  return (
    payment.status === "paid" &&
    payment.transactionSignature !== null &&
    payment.payerAddress !== null &&
    payment.verifiedAt !== null
  );
}

export default function TransactionDetailsModal({
  payment,
  onClose,
}: TransactionDetailsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement;
    modalRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [onClose]);

  const status = statusStyles[payment.status];
  const explorerUrl = payment.transactionSignature
    ? getDevnetTransactionExplorerUrl(payment.transactionSignature)
    : undefined;
  const verified = isVerified(payment);

  async function copyToClipboard(text: string, setter: (state: "idle" | "copied" | "error") => void) {
    try {
      await navigator.clipboard.writeText(text);
      setter("copied");
      setTimeout(() => setter("idle"), 2000);
    } catch {
      setter("error");
    }
  }

  const [signatureCopyState, setSignatureCopyState] =
    useState<"idle" | "copied" | "error">("idle");
  const [addressCopyState, setAddressCopyState] =
    useState<"idle" | "copied" | "error">("idle");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        tabIndex={-1}
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl border shadow-2xl"
        style={{
          background: "#0E0E12",
          borderColor: "rgba(255,255,255,0.08)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 48px rgba(153,69,255,0.08)",
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2
              id="modal-title"
              className="text-base font-semibold text-white"
              style={{ fontFamily: "'DM Sans', sans-serif" }}
            >
              Transaction Details
            </h2>
            <p className="mt-0.5 font-mono text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
              {payment.id} &middot; {payment.reference}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 sm:size-9"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            <CloseIcon className="size-5" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[70vh] overflow-y-auto px-5 py-5 space-y-6">
          {/* Status badge */}
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
              style={{
                background: status.bg,
                color: status.text,
                borderColor: `${status.text}33`,
              }}
            >
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{ background: status.dot }}
              />
              {status.label}
            </span>
            {verified && (
              <span
                className="rounded-full border px-2.5 py-1 text-[11px] font-medium"
                style={{
                  background: "rgba(20,241,149,0.08)",
                  color: "#14F195",
                  borderColor: "rgba(20,241,149,0.2)",
                }}
              >
                On-chain verified
              </span>
            )}
          </div>

          {/* Main details grid */}
          <div className="grid gap-5 sm:grid-cols-2">
            {/* Transaction Signature */}
            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
                Transaction Signature
              </label>
              <div className="flex items-start gap-2">
                <p className="flex-1 font-mono text-xs text-neutral-100 break-all leading-relaxed">
                  {payment.transactionSignature || "No signature recorded"}
                </p>
                {payment.transactionSignature != null && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          payment.transactionSignature!,
                          setSignatureCopyState,
                        )
                      }
                      className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2"
                      style={{ color: signatureCopyState === "copied" ? "#14F195" : "rgba(255,255,255,0.4)" }}
                      title="Copy signature"
                      aria-label="Copy transaction signature"
                    >
                      {signatureCopyState === "copied" ? (
                        <CheckIcon className="size-4" />
                      ) : (
                        <CopyIcon className="size-4" />
                      )}
                    </button>
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2"
                      style={{ color: "rgba(255,255,255,0.4)" }}
                      title="View on Solana Explorer"
                      aria-label="View on Solana Explorer"
                    >
                      <ExternalLinkIcon className="size-4" />
                    </a>
                  </>
                )}
              </div>
              {signatureCopyState !== "idle" && (
                <p
                  className="text-xs"
                  style={{ color: signatureCopyState === "copied" ? "#14F195" : "#f87171" }}
                >
                  {signatureCopyState === "copied" ? "Signature copied" : "Failed to copy"}
                </p>
              )}
            </div>

            {/* Explorer link (full width) */}
            {explorerUrl && (
              <div className="space-y-2 sm:col-span-2">
                <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Solana Explorer
                </label>
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{
                    borderColor: "rgba(255,255,255,0.08)",
                    background: "#16161B",
                    color: "#9945FF",
                  }}
                >
                  View transaction on Solana Explorer
                  <ExternalLinkIcon className="size-4" />
                </a>
              </div>
            )}
          </div>

          {/* Addresses section */}
          <div className="grid gap-5 sm:grid-cols-2">
            {/* Sender */}
            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
                Sender (Payer)
              </label>
              <div className="flex items-start gap-2">
                <p className="flex-1 font-mono text-xs text-neutral-100 break-all">
                  {payment.payerAddress || "Not recorded"}
                </p>
                {payment.payerAddress && (
                  <button
                    type="button"
                    onClick={() =>
                      copyToClipboard(payment.payerAddress!, setAddressCopyState)
                    }
                    className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ color: addressCopyState === "copied" ? "#14F195" : "rgba(255,255,255,0.4)" }}
                    title="Copy address"
                    aria-label="Copy sender address"
                  >
                    {addressCopyState === "copied" ? (
                      <CheckIcon className="size-4" />
                    ) : (
                      <CopyIcon className="size-4" />
                    )}
                  </button>
                )}
              </div>
              {addressCopyState !== "idle" && (
                <p
                  className="text-xs"
                  style={{ color: addressCopyState === "copied" ? "#14F195" : "#f87171" }}
                >
                  {addressCopyState === "copied" ? "Address copied" : "Failed to copy"}
                </p>
              )}
              {payment.payerAddress && (
                <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {shortenAddress(payment.payerAddress)}
                </p>
              )}
            </div>

            {/* Recipient */}
            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
                Recipient (Merchant)
              </label>
              <div className="flex items-start gap-2">
                <p className="flex-1 font-mono text-xs text-neutral-100 break-all">
                  {payment.merchantAddress || "No merchant wallet"}
                </p>
              </div>
              {payment.merchantAddress && (
                <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {shortenAddress(payment.merchantAddress)}
                </p>
              )}
            </div>
          </div>

          {/* Amount & Network */}
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
                Amount
              </label>
              <p
                className="font-mono text-lg font-semibold tabular-nums"
                style={{
                  background: "linear-gradient(135deg,#9945FF 0%,#C14BF0 50%,#14F195 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {formatSolExact(BigInt(payment.amountLamports))}{" "}
                <span
                  className="text-sm font-normal"
                  style={{ background: "none", WebkitTextFillColor: "rgba(255,255,255,0.4)" }}
                >
                  SOL
                </span>
              </p>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                {BigInt(payment.amountLamports).toLocaleString("en-US")} lamports
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
                Network
              </label>
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: "#14F195" }} />
                <p className="text-sm font-medium text-neutral-200">Solana Devnet</p>
              </div>
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                Test network - no real value
              </p>
            </div>
          </div>

          {/* Description & Metadata */}
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
                Description
              </label>
              <p className="text-sm text-neutral-100">
                {payment.description || "No description"}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
                Customer
              </label>
              <p className="text-sm text-neutral-100">
                {payment.customerName || "Not provided"}
                {payment.customerEmail && (
                  <>
                    <br />
                    <span style={{ color: "rgba(255,255,255,0.4)" }}>{payment.customerEmail}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Timestamps */}
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
                Created
              </label>
              <p className="text-sm text-neutral-200">
                {formatCreatedAt(payment.createdAt)}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.35)" }}>
                {verified ? "Verified at" : "Verification status"}
              </label>
              <p className="text-sm text-neutral-200">
                {verified
                  ? formatVerifiedAt(payment.verifiedAt)
                  : payment.status === "pending"
                    ? "Awaiting on-chain verification"
                    : "Not verified"}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 border-t border-line px-5 py-3"
          style={{ background: "#16161B" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-line px-4 py-2 text-sm font-medium text-neutral-200 transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Close
          </button>
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-brand-gradient inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              View on Explorer
              <ExternalLinkIcon className="size-4" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
