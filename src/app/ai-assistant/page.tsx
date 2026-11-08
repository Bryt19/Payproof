import type { Metadata } from "next";
import AIAssistantClient from "./ai-assistant-client";

export const metadata: Metadata = {
  title: "AI Assistant",
  description:
    "Your intelligent payment and analytics assistant — ask about payments, invoices, and transactions.",
};

export default function AIAssistantPage() {
  return <AIAssistantClient />;
}

