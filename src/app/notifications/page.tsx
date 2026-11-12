import type { Metadata } from "next";
import NotificationsView from "@/components/notifications/notifications-view";

export const metadata: Metadata = {
  title: "Notifications",
  description: "View payment request and verification notifications for your merchant wallet.",
};

export default function NotificationsPage() {
  return <NotificationsView />;
}
