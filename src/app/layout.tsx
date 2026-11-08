import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "./providers";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#000000",
};

export const metadata: Metadata = {
  title: {
    default: "Payproof | Built on Solana",
    template: "%s | Payproof",
  },
  description:
    "Payproof turns every Solana payment into a verifiable, shareable proof. Accept payments, issue receipts, and confirm transactions in seconds.",
  keywords: ["Payproof", "Solana", "Payments", "Verification", "Proof of Payment", "Web3", "Merchant"],
  authors: [{ name: "Payproof" }],
  openGraph: {
    title: "Payproof | Built on Solana",
    description:
      "Get paid. Prove it instantly. Verifiable payment receipts for businesses, creators, and developers.",
    type: "website",
    siteName: "Payproof",
  },
  twitter: {
    card: "summary_large_image",
    title: "Payproof | Built on Solana",
    description: "Get paid. Prove it instantly.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased font-sans">
      <head>
        <link rel="icon" type="image/png" href="/payproof-icon.png" />
        <link rel="apple-touch-icon" href="/payproof-icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400..800;1,9..40,400..800&family=Manrope:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full bg-black text-white selection:bg-[#9945FF]/40 selection:text-white overflow-x-hidden">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
