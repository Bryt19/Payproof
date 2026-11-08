import Link from "next/link";
import { BrandMark } from "@/components/landing/landing-brand";
import styles from "@/styles/landing-footer.module.css";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <BrandMark className={styles.brandMark} aria-hidden="true" />
          <span className={styles.brandWordmark}>PayProof</span>
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
            <Link href="/dashboard" className={styles.link}>
              Dashboard
            </Link>
            <Link href="/payment-requests" className={styles.link}>
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
    </footer>
  );
}
