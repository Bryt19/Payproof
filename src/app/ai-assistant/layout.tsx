import DashboardGate from "@/components/dashboard/dashboard-gate";

export default function AIAssistantLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <DashboardGate>{children}</DashboardGate>;
}
