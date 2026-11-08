import type { Metadata } from "next";
import DashboardShell from "@/components/dashboard/dashboard-shell";
import PaymentRequestsView from "@/components/payment-requests/payment-requests-view";

export const metadata: Metadata = {
  title: "Payment Requests",
  description:
    "Create Solana payment requests with a reference and shareable checkout link on PayProof.",
};

export default function PaymentRequestsPage() {
  return (
    <DashboardShell
      title="Payment Requests"
      description="Create and share Solana payment requests for your customers."
    >
      <PaymentRequestsView />
    </DashboardShell>
  );
}
