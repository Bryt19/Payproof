import Link from "next/link";
import { BrandMark } from "./landing-brand";
import styles from "../../styles/landing.module.css";

function MaterialIcon({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <span className={`${styles.materialIcon} ${className ?? ""}`} aria-hidden="true">
      {children}
    </span>
  );
}

const steps = [
  {
    icon: "receipt_long",
    title: "Create a request",
    description:
      "Set the amount and share a payment link with your customer.",
  },
  {
    icon: "account_balance_wallet",
    title: "Pay from a wallet",
    description:
      "Your customer reviews the details and approves the payment in their wallet.",
  },
  {
    icon: "fact_check",
    title: "Verify on Solana",
    description:
      "PayProof checks the transaction on-chain before showing a confirmed status.",
  },
];

const features = [
  {
    icon: "link",
    title: "One link to share",
    description:
      "Give customers a dedicated payment page with the amount and merchant details.",
  },
  {
    icon: "travel_explore",
    title: "A status you can check",
    description:
      "Payment states are based on transaction verification—not a browser-side success message.",
  },
  {
    icon: "receipt",
    title: "A record for both sides",
    description:
      "Keep payment requests and their verification details together in one place.",
  },
];

export function HeroSection() {
  return (
    <section className={styles.hero} id="home">
      <div className={styles.heroInner}>
        <div className={styles.heroContent}>
          <div className={styles.heroEyebrow}>
            <MaterialIcon>account_balance</MaterialIcon>
            Solana payment requests
          </div>
          <h1 className={styles.heroHeadline}>
            A receipt should be <em>proof.</em>
          </h1>
          <p className={styles.heroSubhead}>
            Create a payment request, share one clear link, and verify the
            transaction against Solana. No guesswork about whether it landed.
          </p>
          <div className={styles.heroActions}>
            <Link href="/payment-requests" className={styles.buttonPrimary}>
              Create a payment request
              <MaterialIcon>arrow_forward</MaterialIcon>
            </Link>
            <Link href="/dashboard" className={styles.buttonSecondary}>
              View dashboard
            </Link>
          </div>
          <p className={styles.heroNote}>
            <MaterialIcon>info</MaterialIcon>
            Developer preview on Solana Devnet. No real funds.
          </p>
        </div>

        <div className={styles.heroVisual}>
          <div className={styles.paymentCard}>
            <div className={styles.paymentCardTop}>
              <span className={styles.paymentCardLabel}>Payment request</span>
              <span className={styles.paymentCardSample}>Example</span>
            </div>

            <div className={styles.paymentCardMerchant}>
              <div className={styles.merchantMark}>
                <BrandMark aria-hidden="true" />
              </div>
              <div>
                <p className={styles.merchantName}>PayProof Coffee</p>
                <p className={styles.merchantCaption}>Merchant</p>
              </div>
            </div>

            <div className={styles.paymentAmountRow}>
              <div>
                <span className={styles.paymentAmountLabel}>Amount due</span>
                <p className={styles.paymentAmount}>
                  0.012 <span className={styles.paymentCurrency}>SOL</span>
                </p>
              </div>
              <div className={styles.receiptStatus}>
                <MaterialIcon>schedule</MaterialIcon>
                Awaiting payment
              </div>
            </div>

            <div className={styles.paymentCardMeta}>
              <span>Request reference</span>
              <code>pp_demo_042</code>
            </div>

            <div className={styles.paymentCardFooter}>
              <MaterialIcon>verified_user</MaterialIcon>
              A payment is marked complete only after on-chain verification.
            </div>
          </div>
          <span className={styles.heroIndex}>REQUEST 01 / DEVNET</span>
        </div>
      </div>
    </section>
  );
}

export function HowItWorksSection() {
  return (
    <section className={styles.section} id="how-it-works">
      <div className={styles.sectionInner}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionEyebrow}>How it works</span>
            <h2 className={styles.sectionTitle}>
              From request to verified payment.
            </h2>
          </div>
          <p className={styles.sectionIntro}>
            A straightforward flow for customers and merchants, with
            confirmation tied to the transaction on Solana.
          </p>
        </div>
        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <li className={styles.step} key={step.title}>
              <span className={styles.stepNumber}>
                0{index + 1}
              </span>
              <MaterialIcon className={styles.stepIcon}>{step.icon}</MaterialIcon>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepDescription}>{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function FeaturesSection() {
  return (
    <section className={styles.section} id="features">
      <div className={styles.sectionInner}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionEyebrow}>Made for clarity</span>
            <h2 className={styles.sectionTitle}>
              Less chasing. Better payment records.
            </h2>
          </div>
          <p className={styles.sectionIntro}>
            PayProof connects the request, the customer&apos;s payment, and
            on-chain verification in one useful workflow.
          </p>
        </div>
        <div className={styles.featureGrid}>
          {features.map((feature) => (
            <article className={styles.feature} key={feature.title}>
              <span className={styles.featureIcon}>
                <MaterialIcon>{feature.icon}</MaterialIcon>
              </span>
              <h3 className={styles.featureTitle}>{feature.title}</h3>
              <p className={styles.featureDescription}>
                {feature.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function SecuritySection() {
  return (
    <section className={styles.securitySection} id="security">
      <div className={`${styles.sectionInner} ${styles.securityInner}`}>
        <div>
          <span className={styles.sectionEyebrow}>Built around verification</span>
          <h2 className={styles.sectionTitle}>Trust the transaction, not the screen.</h2>
          <p className={styles.sectionIntro}>
            A payment status should mean something. PayProof checks the chain
            instead of relying on what the browser says.
          </p>
        </div>
        <div className={styles.securityPoints}>
          <div className={styles.securityPoint}>
            <MaterialIcon>travel_explore</MaterialIcon>
            <div>
              <h3 className={styles.securityPointTitle}>Check the transaction on-chain</h3>
              <p className={styles.securityPointDescription}>
                The status follows independent Solana verification, not a
                client-side claim.
              </p>
            </div>
          </div>
          <div className={styles.securityPoint}>
            <MaterialIcon>key</MaterialIcon>
            <div>
              <h3 className={styles.securityPointTitle}>Signing stays in the wallet</h3>
              <p className={styles.securityPointDescription}>
                Customers approve payments in their wallet. PayProof never
                needs a recovery phrase.
              </p>
            </div>
          </div>
          <div className={styles.securityPoint}>
            <MaterialIcon>science</MaterialIcon>
            <div>
              <h3 className={styles.securityPointTitle}>A Devnet preview</h3>
              <p className={styles.securityPointDescription}>
                This demo is for testing and does not process real-value
                payments.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FinalCtaSection() {
  return (
    <section className={styles.cta} id="contact">
      <div className={styles.sectionInner}>
        <span className={styles.sectionEyebrow}>Start with a request</span>
        <h2 className={styles.sectionTitle}>
          Make the next payment easier to verify.
        </h2>
        <p className={styles.sectionIntro}>
          Create a Devnet payment request and see how the verification flow
          works.
        </p>
        <div className={styles.ctaActions}>
          <Link href="/payment-requests" className={styles.buttonPrimary}>
            Open payment requests
            <MaterialIcon>arrow_forward</MaterialIcon>
          </Link>
          <Link href="/dashboard" className={styles.buttonSecondary}>
            Go to dashboard
          </Link>
        </div>
      </div>
    </section>
  );
}
