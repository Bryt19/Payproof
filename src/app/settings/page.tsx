import type { Metadata } from "next";
import DashboardShell from "@/components/dashboard/dashboard-shell";
import SettingsClient from "./settings-client";

export const metadata: Metadata = {
  title: "Settings",
  description:
    "Manage your Payproof wallet, notifications, and display preferences.",
};

export default function SettingsPage() {
  return (
    <DashboardShell
      title="Settings"
      description="Configure your merchant console preferences."
    >
      <SettingsClient />
    </DashboardShell>
  );
}
