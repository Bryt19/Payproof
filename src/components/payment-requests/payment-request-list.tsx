"use client";

import { useCallback, useMemo, useState } from "react";
import type { PaymentRequest } from "@/lib/payment-requests/types";
import { getCheckoutPath } from "@/lib/payment-requests/types";
import { getCheckoutUrl } from "@/lib/payment-requests/checkout-url";
import { shortenAddress } from "@/lib/solana/address";
import { formatSolExact } from "@/lib/solana/units";
import { getDevnetTransactionExplorerUrl } from "@/lib/solana/payment";
import { useCopyFeedback } from "@/lib/use-copy-feedback";
import {
  CheckIcon,
  CloseIcon,
  CopyIcon,
  ExternalLinkIcon,
  QrIcon,
  SearchIcon,
  RequestsIcon,
} from "@/components/dashboard/icons";
import ShareRequestDialog from "./share-request-dialog";
import ModalShell from "./modal-shell";

export type PaymentStatusFilter = "all" | "pending" | "paid" | "failed";

const filterOptions: readonly { label: string; value: PaymentStatusFilter }[] = [
  { label: "All requests", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Paid", value: "paid" },
  { label: "Failed / Expired", value: "failed" },
];

const statusStyles: Record<
  PaymentRequest["status"],
  { label: string; bg: string; text: string; dot: string }
> = {
  paid: {
    label: "Paid",
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
    bg: "rgba(255,255,255,0.04)",
    text: "rgba(255,255,255,0.45)",
    dot: "#737373",
  },
  cancelled: {
    label: "Cancelled",
    bg: "rgba(255,255,255,0.04)",
    text: "rgba(255,255,255,0.45)",
    dot: "#737373",
  },
};

function formatCreatedDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);

    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).format(date);
  } catch {
    return isoString;
  }
}

export default function PaymentRequestList({
  requests,
  status,
  error,
  onRetry,
  onCreate,
}: {
  requests: readonly PaymentRequest[];
  status: "idle" | "loading" | "loaded" | "error";
  error: string | null;
  onRetry: () => void;
  onCreate: () => void;
}) {
  const { copy } = useCopyFeedback();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<PaymentStatusFilter>("all");

  const [sharingRequest, setSharingRequest] = useState<PaymentRequest | null>(null);
  const [detailsRequest, setDetailsRequest] = useState<PaymentRequest | null>(null);

  const handleCopyLink = useCallback(
    (request: PaymentRequest) => {
      const url = getCheckoutUrl(request.reference);
      void copy(url).then(() => {
        setCopiedId(request.id);
        setTimeout(() => setCopiedId(null), 2000);
      });
    },
    [copy],
  );

  const handleCopyReference = useCallback(
    (request: PaymentRequest) => {
      void copy(request.reference).then(() => {
        setCopiedId(`ref-${request.id}`);
        setTimeout(() => setCopiedId(null), 2000);
      });
    },
    [copy],
  );

  const counts = useMemo(() => {
    const c = { all: requests.length, paid: 0, pending: 0, failed: 0 };
    for (const r of requests) {
      if (r.status === "paid") c.paid += 1;
      else if (r.status === "pending") c.pending += 1;
      else c.failed += 1;
    }
    return c;
  }, [requests]);

  const filteredRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter((r) => {
      // Filter by status bucket
      if (activeFilter === "paid" && r.status !== "paid") return false;
      if (activeFilter === "pending" && r.status !== "pending") return false;
      if (activeFilter === "failed" && r.status !== "expired" && r.status !== "cancelled") return false;

      // Filter by search query
      if (q) {
        const text = [
          r.id,
          r.reference,
          r.description,
          r.customerName ?? "",
          r.customerEmail ?? "",
          r.merchantAddress ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!text.includes(q)) return false;
      }

      return true;
    });
  }, [requests, activeFilter, search]);

  const isLoading = status === "loading";

  return (
    <section
      aria-label="Payment requests list"
      className="rounded-2xl border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
      style={{ background: "#0E0E12" }}
    >
      {/* Top Filter and Search Bar */}
      <div className="flex flex-col gap-4 border-b border-white/[0.08] p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-white">All Payment Requests</h2>
            <span className="rounded-full bg-white/[0.06] border border-white/[0.08] px-2 py-0.5 text-xs text-white/60">
              {requests.length} total
            </span>
          </div>
          <p className="mt-1 text-xs text-white/50">
            Shareable Solana checkout links with instant cryptographic proof of payment.
          </p>
        </div>

        {/* Search bar & Refresh */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 sm:w-64 sm:flex-initial">
            <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reference, description…"
              className="h-11 w-full rounded-xl border border-white/[0.1] sm:h-10 bg-white/[0.03] pl-9 pr-8 text-xs text-white placeholder:text-white/35 focus:border-[#9945FF]/60 focus:bg-white/[0.05] focus:outline-none focus:ring-1 focus:ring-[#9945FF]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
              >
                <CloseIcon className="size-3.5" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onRetry}
            disabled={isLoading}
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-white/[0.1] sm:h-10 bg-white/[0.03] px-3.5 text-xs font-medium text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
          >
            <svg
              className={`size-3.5 ${isLoading ? "animate-spin text-[#9945FF]" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            <span>{isLoading ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] bg-black/20 px-5 py-3 sm:px-6">
        {filterOptions.map((option) => {
          const isActive = activeFilter === option.value;
          const count = counts[option.value];
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setActiveFilter(option.value)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-medium transition-all duration-150 sm:min-h-0 ${
                isActive
                  ? "bg-[#9945FF] text-white shadow-[0_0_16px_rgba(153,69,255,0.4)]"
                  : "text-white/60 hover:bg-white/[0.05] hover:text-white"
              }`}
            >
              <span>{option.label}</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono ${
                  isActive
                    ? "bg-black/30 text-white"
                    : "bg-white/[0.08] text-white/50"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Content: Table or Loading/Empty States */}
      {isLoading ? (
        <div className="p-6 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-white/[0.04] bg-white/[0.02]"
            />
          ))}
        </div>
      ) : error ? (
        <div className="p-10 text-center">
          <p className="text-sm text-red-300">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/[0.05] px-4 py-2 text-xs font-medium text-white hover:bg-white/[0.1]"
          >
            Retry loading
          </button>
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl border border-white/[0.1] bg-white/[0.03] text-white/40 shadow-inner">
            <RequestsIcon className="size-6 text-[#9945FF]" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-white">
            {search || activeFilter !== "all"
              ? "No matching payment requests"
              : "No payment requests yet"}
          </h3>
          <p className="mt-1 max-w-sm text-xs text-white/50">
            {search || activeFilter !== "all"
              ? "Try adjusting your search keywords or switching filters to view your requests."
              : "Create your first Solana payment request to share with clients and receive verifiable on-chain payments."}
          </p>
          {search || activeFilter !== "all" ? (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setActiveFilter("all");
              }}
              className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-white hover:bg-white/[0.08]"
            >
              Reset filters
            </button>
          ) : (
            <button
              type="button"
              onClick={onCreate}
              className="mt-5 btn-brand-gradient inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold text-white shadow-lg"
            >
              <span>+ Create Payment Request</span>
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden xl:block">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/[0.06] bg-black/10 text-[11px] uppercase tracking-wider text-white/40">
                <tr>
                  <th scope="col" className="py-3.5 pl-6 pr-3 font-medium">
                    Reference / ID
                  </th>
                  <th scope="col" className="px-3 py-3.5 font-medium">
                    Description & Customer
                  </th>
                  <th scope="col" className="px-3 py-3.5 font-medium">
                    Amount
                  </th>
                  <th scope="col" className="px-3 py-3.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-3.5 font-medium">
                    Created
                  </th>
                  <th scope="col" className="py-3.5 pl-3 pr-6 text-right font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredRequests.map((request) => {
                  const style = statusStyles[request.status] ?? statusStyles.pending;
                  const isPending = request.status === "pending";
                  const isPaid = request.status === "paid";
                  const isRefCopied = copiedId === `ref-${request.id}`;
                  const isLinkCopied = copiedId === request.id;

                  return (
                    <tr
                      key={request.id}
                      onClick={() => setDetailsRequest(request)}
                      className="group cursor-pointer transition-colors duration-150 hover:bg-white/[0.03]"
                    >
                      {/* Reference / ID */}
                      <td className="py-4 pl-6 pr-3 align-middle">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-medium text-white group-hover:text-[#C14BF0] transition-colors">
                            {request.reference.slice(0, 10)}…
                          </span>
                          <button
                            type="button"
                            title="Copy reference key"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyReference(request);
                            }}
                            className="rounded p-1 text-white/30 hover:bg-white/[0.08] hover:text-white"
                          >
                            {isRefCopied ? (
                              <CheckIcon className="size-3.5 text-[#14F195]" />
                            ) : (
                              <CopyIcon className="size-3.5" />
                            )}
                          </button>
                        </div>
                        <p className="font-mono text-[10px] text-white/40">
                          {request.id}
                        </p>
                      </td>

                      {/* Description & Customer */}
                      <td className="px-3 py-4 align-middle max-w-[280px]">
                        <p className="truncate font-medium text-white/90">
                          {request.description}
                        </p>
                        <div className="flex items-center gap-2 text-[11px] text-white/50">
                          {request.customerName ? (
                            <span>{request.customerName}</span>
                          ) : request.customerEmail ? (
                            <span>{request.customerEmail}</span>
                          ) : (
                            <span className="italic text-white/30">Direct request</span>
                          )}
                          {request.merchantAddress && (
                            <>
                              <span>·</span>
                              <span className="font-mono text-[10px] text-white/35">
                                {shortenAddress(request.merchantAddress)}
                              </span>
                            </>
                          )}
                        </div>
                      </td>

                      {/* Amount */}
                      <td className="px-3 py-4 align-middle whitespace-nowrap">
                        <div className="font-mono text-sm font-bold tracking-tight text-white">
                          {formatSolExact(BigInt(request.amountLamports))}
                          <span className="ml-1 text-xs font-normal text-white/50">
                            SOL
                          </span>
                        </div>
                        <span className="text-[10px] text-white/40">Devnet</span>
                      </td>

                      {/* Status */}
                      <td className="px-3 py-4 align-middle whitespace-nowrap">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                          style={{
                            background: style.bg,
                            color: style.text,
                          }}
                        >
                          {isPending && (
                            <span
                              className="size-1.5 rounded-full animate-ping"
                              style={{ background: style.dot }}
                            />
                          )}
                          {isPaid && (
                            <CheckIcon className="size-3 text-[#14F195]" />
                          )}
                          {!isPending && !isPaid && (
                            <span
                              className="size-1.5 rounded-full"
                              style={{ background: style.dot }}
                            />
                          )}
                          {style.label}
                        </span>
                      </td>

                      {/* Created */}
                      <td className="px-3 py-4 align-middle whitespace-nowrap text-white/50">
                        {formatCreatedDate(request.createdAt)}
                      </td>

                      {/* Actions */}
                      <td className="py-4 pl-3 pr-6 align-middle text-right whitespace-nowrap">
                        <div
                          className="flex items-center justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Copy Link */}
                          <button
                            type="button"
                            title="Copy Checkout Link"
                            onClick={() => handleCopyLink(request)}
                            className="inline-flex items-center gap-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                          >
                            {isLinkCopied ? (
                              <>
                                <CheckIcon className="size-3.5 text-[#14F195]" />
                                <span className="text-[#14F195]">Copied</span>
                              </>
                            ) : (
                              <>
                                <CopyIcon className="size-3.5" />
                                <span>Copy Link</span>
                              </>
                            )}
                          </button>

                          {/* QR Code */}
                          <button
                            type="button"
                            title="Show QR Code"
                            onClick={() => setSharingRequest(request)}
                            className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-1.5 text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                          >
                            <QrIcon className="size-4" />
                          </button>

                          {/* Explorer link if signature */}
                          {request.transactionSignature && (
                            <a
                              href={getDevnetTransactionExplorerUrl(request.transactionSignature)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="View Transaction on Solana Explorer"
                              className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-1.5 text-white/70 transition-colors hover:border-[#14F195]/40 hover:text-[#14F195]"
                            >
                              <ExternalLinkIcon className="size-4" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="divide-y divide-white/[0.06] xl:hidden">
            {filteredRequests.map((request) => {
              const style = statusStyles[request.status] ?? statusStyles.pending;
              const isPending = request.status === "pending";
              const isPaid = request.status === "paid";
              const isLinkCopied = copiedId === request.id;

              return (
                <div
                  key={request.id}
                  onClick={() => setDetailsRequest(request)}
                  className="flex flex-col gap-3 p-5 transition-colors hover:bg-white/[0.02]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-mono text-xs font-semibold text-white">
                        {request.reference.slice(0, 12)}…
                      </span>
                      <p className="font-mono text-[10px] text-white/40">
                        {request.id} · {formatCreatedDate(request.createdAt)}
                      </p>
                    </div>

                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium shrink-0"
                      style={{
                        background: style.bg,
                        color: style.text,
                      }}
                    >
                      {isPending && (
                        <span
                          className="size-1.5 rounded-full animate-ping"
                          style={{ background: style.dot }}
                        />
                      )}
                      {isPaid && <CheckIcon className="size-3 text-[#14F195]" />}
                      {style.label}
                    </span>
                  </div>

                  <p className="text-xs font-medium text-white/90 line-clamp-2">
                    {request.description}
                  </p>

                  <div className="flex items-center justify-between pt-1 border-t border-white/[0.04]">
                    <div>
                      <span className="font-mono text-base font-bold text-white">
                        {formatSolExact(BigInt(request.amountLamports))}
                        <span className="ml-1 text-xs font-normal text-white/50">SOL</span>
                      </span>
                      {request.customerName && (
                        <p className="text-[11px] text-white/50">
                          {request.customerName}
                        </p>
                      )}
                    </div>

                    <div
                      className="flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => handleCopyLink(request)}
                        className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-white/[0.1] bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.08] sm:min-h-0"
                      >
                        {isLinkCopied ? (
                          <span className="text-[#14F195]">Copied</span>
                        ) : (
                          <>
                            <CopyIcon className="size-3.5" />
                            <span>Link</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setSharingRequest(request)}
                        className="inline-flex size-11 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.04] text-white/80 hover:bg-white/[0.08] sm:size-8"
                      >
                        <QrIcon className="size-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Share QR Dialog */}
      {sharingRequest && (
        <ShareRequestDialog
          request={sharingRequest}
          onClose={() => setSharingRequest(null)}
        />
      )}

      {/* Full Details Modal */}
      {detailsRequest && (
        <ModalShell
          title={`Payment Request ${detailsRequest.id}`}
          description="Detailed on-chain payment request metadata and verification."
          onClose={() => setDetailsRequest(null)}
          widthClassName="max-w-lg"
        >
          <div className="space-y-5 text-xs">
            {/* Amount & Status Card */}
            <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-white/45">
                  Requested Amount
                </p>
                <p className="mt-1 font-mono text-2xl font-bold text-white">
                  {formatSolExact(BigInt(detailsRequest.amountLamports))}{" "}
                  <span className="text-sm font-normal text-white/50">SOL</span>
                </p>
              </div>

              <div>
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
                  style={{
                    background:
                      statusStyles[detailsRequest.status]?.bg ??
                      statusStyles.pending.bg,
                    color:
                      statusStyles[detailsRequest.status]?.text ??
                      statusStyles.pending.text,
                  }}
                >
                  {detailsRequest.status === "paid" && (
                    <CheckIcon className="size-3.5" />
                  )}
                  {statusStyles[detailsRequest.status]?.label ?? "Pending"}
                </span>
              </div>
            </div>

            {/* Description */}
            <div>
              <p className="text-[11px] uppercase tracking-wider text-white/45">
                Description / Order Note
              </p>
              <p className="mt-1 rounded-xl border border-white/[0.06] bg-black/30 p-3 text-sm text-white">
                {detailsRequest.description}
              </p>
            </div>

            {/* Reference Key & Direct Checkout URL */}
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-wider text-white/45">
                    Solana Reference Public Key
                  </p>
                  <button
                    type="button"
                    onClick={() => handleCopyReference(detailsRequest)}
                    className="text-[11px] text-[#9945FF] hover:underline"
                  >
                    {copiedId === `ref-${detailsRequest.id}` ? "Copied!" : "Copy Reference"}
                  </button>
                </div>
                <div className="mt-1 break-all rounded-lg border border-white/[0.06] bg-black/40 p-2.5 font-mono text-xs text-white/90">
                  {detailsRequest.reference}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-wider text-white/45">
                    Shareable Checkout Link
                  </p>
                  <button
                    type="button"
                    onClick={() => handleCopyLink(detailsRequest)}
                    className="text-[11px] text-[#14F195] hover:underline"
                  >
                    {copiedId === detailsRequest.id ? "Copied!" : "Copy Link"}
                  </button>
                </div>
                <div className="mt-1 break-all rounded-lg border border-white/[0.06] bg-black/40 p-2.5 font-mono text-xs text-white/70">
                  {getCheckoutUrl(detailsRequest.reference)}
                </div>
              </div>
            </div>

            {/* Customer & Merchant Metadata */}
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-white/[0.06] bg-white/[0.01] p-3 text-xs">
              <div>
                <p className="text-[10px] uppercase text-white/40">Customer Name</p>
                <p className="mt-0.5 text-white font-medium">
                  {detailsRequest.customerName || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-white/40">Customer Email</p>
                <p className="mt-0.5 text-white font-medium truncate">
                  {detailsRequest.customerEmail || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-white/40">Merchant Address</p>
                <p className="mt-0.5 font-mono text-white/80">
                  {detailsRequest.merchantAddress
                    ? shortenAddress(detailsRequest.merchantAddress)
                    : "Unassigned"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-white/40">Created At</p>
                <p className="mt-0.5 text-white/80">
                  {formatCreatedDate(detailsRequest.createdAt)}
                </p>
              </div>
            </div>

            {/* On-Chain Transaction link if paid */}
            {detailsRequest.transactionSignature && (
              <div className="rounded-xl border border-[#14F195]/20 bg-[#14F195]/5 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-[#14F195]">
                    On-Chain Solana Verification
                  </span>
                  <a
                    href={getDevnetTransactionExplorerUrl(detailsRequest.transactionSignature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[#14F195] hover:underline"
                  >
                    Explorer <ExternalLinkIcon className="size-3" />
                  </a>
                </div>
                <p className="mt-1 font-mono text-[10px] text-white/60 truncate">
                  {detailsRequest.transactionSignature}
                </p>
              </div>
            )}

            {/* Modal Footer Actions */}
            <div className="flex items-center justify-between pt-2">
              <a
                href={getCheckoutPath(detailsRequest.reference)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-white/70 hover:text-white"
              >
                <span>Open Checkout View</span>
                <ExternalLinkIcon className="size-3" />
              </a>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const req = detailsRequest;
                    setDetailsRequest(null);
                    setSharingRequest(req);
                  }}
                  className="inline-flex items-center gap-1 rounded-xl border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-xs font-medium text-white hover:bg-white/[0.08]"
                >
                  <QrIcon className="size-3.5" />
                  <span>Show QR</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDetailsRequest(null)}
                  className="rounded-xl bg-white/[0.08] px-4 py-2 text-xs font-medium text-white hover:bg-white/[0.12]"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </ModalShell>
      )}
    </section>
  );
}
