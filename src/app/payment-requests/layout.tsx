import DashboardGate from "@/components/dashboard/dashboard-gate";

export default function PaymentRequestsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <DashboardGate>{children}</DashboardGate>;
}
