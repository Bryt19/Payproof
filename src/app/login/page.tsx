import type { Metadata } from "next";

import LoginClient from "./login-client";

export const metadata: Metadata = {
  title: "Merchant sign in",
  description:
    "Sign in to the Payproof merchant console by signing a message with your Solana wallet.",
};

export default function LoginPage() {
  return <LoginClient />;
}
