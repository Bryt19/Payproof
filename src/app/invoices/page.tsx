import type { Metadata } from "next";
import InvoicesView from "@/components/invoices/invoices-view";

export const metadata: Metadata = {
  title: "Invoices",
  description:
    "Create and manage professional Solana-powered invoices on Payproof.",
};

export default function InvoicesPage() {
  return <InvoicesView />;
}
