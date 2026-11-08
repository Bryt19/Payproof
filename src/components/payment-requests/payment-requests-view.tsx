"use client";

import { useState } from "react";
import type { PaymentRequest } from "@/lib/payment-requests/types";
import { usePaymentRequests } from "@/lib/payment-requests/use-payment-requests";
import RequestsOverview from "./requests-overview";
import CreateRequestDialog from "./create-request-dialog";
import PaymentRequestList from "./payment-request-list";
import CreateFab from "@/components/ui/create-fab";

export default function PaymentRequestsView() {
  const {
    requests,
    status,
    error,
    refetch,
    repositoryNotice,
  } = usePaymentRequests();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [persistenceNotice, setPersistenceNotice] = useState<string | null>(null);

  return (
    <div className="space-y-6 pb-24 sm:pb-0">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl" style={{ fontFamily: "'DM Sans', sans-serif" }}>
            Payment Requests
          </h1>
          <p className="mt-1 text-sm text-white/50 max-w-xl">
            Issue on-chain payment requests, share checkout links, and track cryptographic proof of verification in real-time.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsCreateOpen(true)}
          className="btn-brand-gradient hidden min-h-11 items-center justify-center gap-2 self-start rounded-xl px-5 py-2.5 text-xs font-semibold text-white shadow-lg transition-transform hover:scale-[1.02] active:scale-[0.98] sm:inline-flex sm:self-auto"
        >
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Create Payment Request</span>
        </button>
      </div>

      {/* Persistence Notification if any */}
      {(persistenceNotice || repositoryNotice) && (
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-xs text-white/70">
          <span className="size-1.5 rounded-full bg-[#9945FF]" />
          <span>{persistenceNotice || repositoryNotice}</span>
        </div>
      )}

      {/* KPI Overview Cards */}
      <RequestsOverview requests={requests} status={status} />

      {/* Main Filterable Table of Payment Requests */}
      <PaymentRequestList
        requests={requests}
        status={status}
        error={error}
        onRetry={refetch}
        onCreate={() => setIsCreateOpen(true)}
      />

      <CreateFab
        label="Create payment request"
        onClick={() => setIsCreateOpen(true)}
      />

      {/* Create Dialog Modal */}
      {isCreateOpen && (
        <CreateRequestDialog
          onClose={() => setIsCreateOpen(false)}
          onCreated={() => {
            setIsCreateOpen(false);
            void refetch();
          }}
          onPersistenceNotice={setPersistenceNotice}
        />
      )}
    </div>
  );
}
