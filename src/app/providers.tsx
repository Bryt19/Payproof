"use client";

import React from "react";
import { ClientProvider } from "@solana/react";
import { solanaClient } from "@/lib/solana/client";

export default function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ClientProvider client={solanaClient}>{children}</ClientProvider>;
}
