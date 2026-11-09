import type { Metadata } from "next";
import DashboardOverviewClient from "./dashboard-overview-client";

export const metadata: Metadata = { title: "Overview" };

export default function DashboardPage() {
  return <DashboardOverviewClient />;
}
