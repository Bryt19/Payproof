"use client";

import { useCallback, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/landing/landing-brand";
import { useWalletAuth } from "@/lib/wallet/use-wallet-auth";
import { WalletConnectModal } from "./wallet-connect-modal";
import styles from "@/styles/landing-footer.module.css";

const PROTECTED_PATHS = new Set([
  "/dashboard",
  "/payments",
  "/invoices",
  "/payment-requests",
  "/ai-assistant",
]);

export function Footer() {
  const router = useRouter();
  const { status } = useWalletAuth();
  const [connectOpen, setConnectOpen] = useState(false);
  const pendingHref = useRef<string | null>(null);

  const handleProtectedClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, href: string) => {
      if (!PROTECTED_PATHS.has(href)) return;
      if (status === "connected") return;
      event.preventDefault();
      pendingHref.current = href;
      setConnectOpen(true);
    },
    [status],
  );

  const handleConnected = useCallback(() => {
    setConnectOpen(false);
    const href = pendingHref.current;
    pendingHref.current = null;
    if (href) router.push(href);
  }, [router]);

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <BrandMark className={styles.brandMark} aria-hidden="true" />
          <span className={styles.brandWordmark}>Payproof</span>
          <p className={styles.tagline}>
            Verifiable Solana payments for merchants and the people who pay them.
          </p>
        </div>

        <nav className={styles.links} aria-label="Footer">
          <div className={styles.linkGroup}>
            <span className={styles.linkGroupLabel}>Product</span>
            <Link href="/" className={styles.link}>
              Overview
            </Link>
            <Link href="#features" className={styles.link}>
              Features
            </Link>
            <Link href="#how-it-works" className={styles.link}>
              How it works
            </Link>
            <Link href="#security" className={styles.link}>
              Security
            </Link>
          </div>

          <div className={styles.linkGroup}>
            <span className={styles.linkGroupLabel}>Merchant console</span>
            <Link
              href="/dashboard"
              className={styles.link}
              onClick={(e) => handleProtectedClick(e, "/dashboard")}
            >
              Dashboard
            </Link>
            <Link
              href="/payment-requests"
              className={styles.link}
              onClick={(e) => handleProtectedClick(e, "/payment-requests")}
            >
              Payment requests
            </Link>
            <Link href="/pay" className={styles.link}>
              Pay a request
            </Link>
          </div>
        </nav>

        <div className={styles.meta}>
          <p className={styles.network}>
            <span className={styles.networkDot} aria-hidden="true" />
            Solana Devnet
          </p>
          <p className={styles.copyright}>
            PayProof is a developer preview. No real value moves.
          </p>
        </div>
      </div>

      <div className={styles.bottom}>
        <div className={styles.bottomInner}>
          <span className={styles.bottomText}>
            Built on Solana. Verified on-chain.
          </span>
          <span className={styles.bottomSeparator} aria-hidden="true" />
          <span className={styles.bottomText}>Developer preview</span>
        </div>
      </div>

      <WalletConnectModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnected={handleConnected}
      />
    </footer>
  );
}
