import DashboardGate from "@/components/dashboard/dashboard-gate";

export default function SettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <DashboardGate>{children}</DashboardGate>;
}
