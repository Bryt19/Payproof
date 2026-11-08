import type { Metadata } from "next";
import Providers from "../providers";
import DashboardGate from "@/components/dashboard/dashboard-gate";

export const metadata: Metadata = {
  title: {
    default: "Merchant Dashboard | Payproof",
    template: "%s | Payproof",
  },
  description:
    "Real-time Solana payment verification, volume analytics, and cryptographic proof-of-payment with Payproof.",
};

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <Providers>
      <DashboardGate>{children}</DashboardGate>
    </Providers>
  );
}
