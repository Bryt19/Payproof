import type { Metadata } from "next";
import PaymentsView from "./payments-view";

export const metadata: Metadata = {
  title: "Payments",
  description:
    "View and manage all verified Solana payments received through Payproof.",
};

export const dynamic = "force-dynamic";

export default function PaymentsPage() {
  return (
    <PaymentsView />
  );
}
