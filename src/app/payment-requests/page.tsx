import type { Metadata } from "next";
import PaymentRequestsView from "@/components/payment-requests/payment-requests-view";

export const metadata: Metadata = {
  title: "Payment Requests",
  description:
    "Create Solana payment requests with a reference and shareable checkout link on PayProof.",
};

export default function PaymentRequestsPage() {
  return <PaymentRequestsView />;
}
