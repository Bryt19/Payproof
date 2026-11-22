import DashboardWalletGate from "@/components/dashboard/dashboard-wallet-gate";

export default function NotificationsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Notifications are owned by the merchant session, so a disconnected browser
  // wallet must not hide them. A wallet that conflicts with the session is still
  // blocked by the client gate.
  return <DashboardWalletGate requireWallet={false}>{children}</DashboardWalletGate>;
}
