import type { Metadata } from "next";
import DashboardShell from "@/components/dashboard/dashboard-shell";
import { InvoicesView } from "@/components/invoices/invoices-view";

export const metadata: Metadata = {
  title: "Invoices",
  description:
    "Create and manage professional Solana-powered invoices on Payproof.",
};

export default function InvoicesPage() {
  return (
    <DashboardShell
      title="Invoices"
      description="Create and manage professional Solana-powered invoices."
    >
      <InvoicesView />
    </DashboardShell>
  );
}
