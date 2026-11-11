"use client";

import { useEffect, useMemo, useState } from "react";
import type { DashboardActivityRow } from "@/lib/dashboard/summary";
import type { PaymentRequestStatus } from "@/lib/payment-requests/types";
import { shortenAddress } from "@/lib/solana/address";
import { getDevnetTransactionExplorerUrl } from "@/lib/solana/payment";
import { SearchIcon, CloseIcon } from "@/components/dashboard/icons";

const statusStyles: Record<
  PaymentRequestStatus,
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
  dateStyle: "medium",
  timeZone: "UTC",
});

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : createdAtFormatter.format(date);
}

/** Fields a merchant can plausibly search by, joined into one lowercase haystack. */
function searchText(row: DashboardActivityRow): string {
  return [
    row.description,
    row.customerName ?? "",
    row.amountSol,
    "SOL",
    row.payerAddress ?? "",
    statusStyles[row.status].label,
    row.transactionSignature ?? "",
    row.reference,
    row.id,
    formatCreatedAt(row.createdAt),
  ]
    .join(" ")
    .toLowerCase();
}

const SEARCH_DEBOUNCE_MS = 250;

export default function ActivitySection({
  rows,
}: {
  rows: readonly DashboardActivityRow[];
}) {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");

  // Debounce the typing, but clear immediately so emptying the field feels instant.
  useEffect(() => {
    if (query.trim() === "") {
      setActiveQuery("");
      return;
    }

    const timer = setTimeout(() => setActiveQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const term = activeQuery.trim().toLowerCase();

  // Derived from the current rows, so fresh server data is filtered by the same term.
  const visibleRows = useMemo(() => {
    if (!term) return rows;
    return rows.filter((row) => searchText(row).includes(term));
  }, [rows, term]);

  const isSearching = term.length > 0;
  const noMatches = isSearching && visibleRows.length === 0;

  return (
    <section
      aria-labelledby="activity-heading"
      className="flex flex-col overflow-hidden rounded-2xl border border-line"
      style={{ background: "#0E0E12" }}
    >
      <header className="flex shrink-0 flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div>
          <h2
            id="activity-heading"
            className="text-sm font-semibold"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
          >
            Recent activity
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            Every payment request, with an on-chain proof for paid rows.
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <label htmlFor="activity-search" className="sr-only">
            Search recent activity
          </label>
          <SearchIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-500"
            aria-hidden="true"
          />
          <input
            id="activity-search"
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search activity"
            autoComplete="off"
            className="min-h-11 w-full rounded-3xl border border-line bg-white/[0.02] py-2 pl-9 pr-9 text-sm sm:min-h-9 text-neutral-100 placeholder:text-neutral-500 outline-none transition-colors focus-visible:border-[#9945FF]/60 focus-visible:ring-2 focus-visible:ring-[#9945FF]/25"
          />
          {query !== "" && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF]"
            >
              <CloseIcon className="size-3.5" />
            </button>
          )}
        </div>
      </header>

      {noMatches ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.65)" }}>
            No results for “{activeQuery.trim()}”
          </p>
          <p className="mt-1 text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
            Try an amount, wallet address, status, description or transaction
            signature.
          </p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="mt-4 rounded-full border border-line bg-white/[0.02] px-4 py-1.5 text-xs font-medium text-neutral-200 transition-colors hover:border-white/20 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF]"
          >
            Clear search
          </button>
        </div>
      ) : (
        <>
          {/* Stacked rows below md with internal scroll container */}
          <div className="max-h-[280px] overflow-y-auto overscroll-contain md:hidden">
            <ul className="divide-y divide-line">
            {visibleRows.length === 0 ? (
              <li className="px-4 py-10 text-center">
                <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
                  No payment requests yet
                </p>
                <p
                  className="mt-1 text-xs"
                  style={{ color: "rgba(255,255,255,0.35)" }}
                >
                  New requests will appear here as soon as they are created.
                </p>
              </li>
            ) : (
              visibleRows.map((row) => {
                const status = statusStyles[row.status];

                return (
                  <li key={row.id} className="px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm text-neutral-100">
                          {row.description}
                        </p>
                        <p
                          className="mt-0.5 truncate font-mono text-[11px]"
                          style={{ color: "rgba(255,255,255,0.3)" }}
                        >
                          {row.reference}
                        </p>
                      </div>
                      <p className="shrink-0 font-mono text-xs tabular-nums text-neutral-200">
                        {row.amountSol} SOL
                      </p>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
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
                      <span className="text-[11px] text-neutral-300">
                        {row.customerName ?? "No customer"}
                      </span>
                      <span
                        className="text-[11px]"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      >
                        {formatCreatedAt(row.createdAt)}
                      </span>
                    </div>

                    {row.status === "paid" && row.transactionSignature && (
                      <a
                        href={getDevnetTransactionExplorerUrl(
                          row.transactionSignature,
                        )}
                        target="_blank"
                        rel="noreferrer"
                        title={row.transactionSignature}
                        className="-mx-1 mt-1 inline-flex min-h-11 items-center px-1 font-mono text-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                        style={{ color: "#9945FF" }}
                      >
                        Proof: {shortenAddress(row.transactionSignature)}
                      </a>
                    )}
                  </li>
                );
              })
            )}
            </ul>
          </div>

          <div className="hidden max-h-[260px] overflow-x-auto overflow-y-auto overscroll-contain md:block xl:max-h-[300px]">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Recent Payproof payment requests, including amount, creation date,
              payment status and links to the on-chain proof.
            </caption>

            <thead className="sticky top-0 z-10 border-b border-line bg-[#0E0E12] text-[11px] uppercase tracking-wider shadow-sm">
              <tr
                className="text-[11px] uppercase tracking-wider"
                style={{ color: "rgba(255,255,255,0.35)" }}
              >
                <th scope="col" className="bg-[#0E0E12] px-5 py-3 font-medium">
                  Description
                </th>
                <th scope="col" className="bg-[#0E0E12] px-5 py-3 font-medium">
                  Customer
                </th>
                <th scope="col" className="bg-[#0E0E12] px-5 py-3 text-right font-medium">
                  Amount
                </th>
                <th scope="col" className="bg-[#0E0E12] px-5 py-3 font-medium">
                  Created
                </th>
                <th scope="col" className="bg-[#0E0E12] px-5 py-3 font-medium">
                  Status
                </th>
                <th scope="col" className="bg-[#0E0E12] px-5 py-3 font-medium">
                  Proof
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-line">
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center">
                    <p
                      className="text-sm"
                      style={{ color: "rgba(255,255,255,0.6)" }}
                    >
                      No payment requests yet
                    </p>
                    <p
                      className="mt-1 text-xs"
                      style={{ color: "rgba(255,255,255,0.35)" }}
                    >
                      New requests will appear here as soon as they are created.
                    </p>
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  const status = statusStyles[row.status];

                  return (
                    <tr
                      key={row.id}
                      className="transition-colors duration-100 hover:bg-white/[0.02]"
                    >
                      <td className="max-w-xs px-5 py-3.5">
                        <p className="break-words text-neutral-100">
                          {row.description}
                        </p>
                        <p
                          className="mt-0.5 font-mono text-[11px]"
                          style={{ color: "rgba(255,255,255,0.3)" }}
                        >
                          {row.reference}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-neutral-200">
                        {row.customerName ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right font-mono text-xs tabular-nums text-neutral-200">
                        {row.amountSol} SOL
                      </td>
                      <td
                        className="whitespace-nowrap px-5 py-3.5 text-xs"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      >
                        {formatCreatedAt(row.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
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
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        {row.status === "paid" && row.transactionSignature ? (
                          <a
                            href={getDevnetTransactionExplorerUrl(
                              row.transactionSignature,
                            )}
                            target="_blank"
                            rel="noreferrer"
                            title={row.transactionSignature}
                            className="font-mono text-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                            style={{ color: "#9945FF" }}
                          >
                            {shortenAddress(row.transactionSignature)}
                            <span className="sr-only">
                              {" "}
                              on Solana Explorer (opens in a new tab)
                            </span>
                          </a>
                        ) : (
                          <span
                            className="text-xs"
                            style={{ color: "rgba(255,255,255,0.3)" }}
                          >
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        </>
      )}

      {isSearching && !noMatches && (
        <p
          className="shrink-0 border-t border-line px-5 py-2.5 text-[11px]"
          style={{ color: "rgba(255,255,255,0.35)" }}
        >
          {visibleRows.length} of {rows.length} request
          {rows.length === 1 ? "" : "s"} match “{activeQuery.trim()}”
        </p>
      )}
    </section>
  );
}
