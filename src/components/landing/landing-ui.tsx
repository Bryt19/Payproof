import type { ReactNode } from "react";
import Image from "next/image";
import { BrandMark } from "./landing-brand";
import styles from "../../styles/landing-ui.module.css";

export function SectionContainer({
  children,
}: {
  children: ReactNode;
}) {
  return <div className={styles.sectionContainer}>{children}</div>;
}

export function Eyebrow({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <span className={styles.eyebrow} role="status">
      {children}
    </span>
  );
}

export function Badge({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <span className={styles.badge} role="status">
      {children}
    </span>
  );
}

export function Button({
  children,
  href,
  variant = "primary",
  size = "md",
  childrenLeft,
  icon,
}: {
  children: ReactNode;
  href?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
  childrenLeft?: ReactNode;
  icon?: ReactNode;
}) {
  const sizeClass = size === "sm" ? styles.btnSmall : "";
  const variantClass =
    variant === "primary"
      ? styles.btnPrimary
      : styles.btnSecondary;

  const cls = [
    styles.btn,
    sizeClass,
    variantClass,
    href ? undefined : "cursor-pointer",
  ]
    .filter(Boolean)
    .join(" ");

  const node = (
    <>
      {childrenLeft}
      {icon}
      {children}
    </>
  );

  if (href) {
    return (
      <a href={href} className={cls}>
        {node}
      </a>
    );
  }

  return (
    <button type="button" className={cls}>
      {node}
    </button>
  );
}

export function StatCard({
  icon,
  label,
  value,
  trend,
  trendUp = true,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  trend?: string;
  trendUp?: boolean;
}) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statCardIcon} aria-hidden="true">
        {icon}
      </div>
      <div className={styles.statCardLabel}>{label}</div>
      <div className={styles.statCardValue}>{value}</div>
      {trend && (
        <span
          className={`${styles.statCardTrend} ${
            trendUp ? styles.statCardTrendUp : styles.statCardTrendDown
          }`}
        >
          {trendUp ? "+" : ""}
          {trend}
        </span>
      )}
    </div>
  );
}

export function StepCard({
  number,
  title,
  description,
  icon,
}: {
  number: string;
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <li className={styles.stepCard}>
      <div className={styles.stepNumber}>{number}</div>
      <div className={styles.stepIcon} aria-hidden="true">
        {icon}
      </div>
      <h3 className={styles.stepTitle}>{title}</h3>
      <p className={styles.stepDescription}>{description}</p>
    </li>
  );
}

export function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <article className={styles.featureCard}>
      <div className={styles.featureIcon} aria-hidden="true">
        {icon}
      </div>
      <h3 className={styles.featureTitle}>{title}</h3>
      <p className={styles.featureDescription}>{description}</p>
    </article>
  );
}

export function CodeLine({
  children,
  mono = true,
}: {
  children: ReactNode;
  mono?: boolean;
}) {
  const cls = mono ? styles.codeMono : styles.codeText;
  return <code className={cls}>{children}</code>;
}

export function DashboardShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.glassPanel}>
      <div className={styles.glassPanelHeader}>
        <div className={styles.dashboardBrand}>
          <BrandMark className={styles.dashboardBrandMark} aria-hidden="true" />
          <span className={styles.dashboardBrandWordmark}>PayProof</span>
        </div>
        <div className={styles.dashboardNetwork}>
          <span className={styles.dashboardNetworkDot} aria-hidden="true" />
          Solana Devnet
        </div>
      </div>
      <div className={styles.dashboardTitle}>
        <h3 className={styles.dashboardTitleText}>{title}</h3>
        <p className={styles.dashboardTitleSub}>{description}</p>
      </div>
      <div className={styles.dashboardBody}>{children}</div>
    </div>
  );
}

export function InvoiceCard({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className={styles.invoiceCard}>
      <div className={styles.invoiceCardLabel}>{label}</div>
      <div className={styles.invoiceCardValue}>{value}</div>
      <div className={styles.invoiceCardDescription}>{description}</div>
    </div>
  );
}

export function VerificationRelay({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className={styles.verificationRelay}>
      <div className={styles.verificationRelayIcon} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-5">
          <path d="M12 3.5 18.5 6v5.2c0 4-2.7 7.7-6.5 8.8-3.8-1.1-6.5-4.8-6.5-8.8V6L12 3.5Z" />
          <path d="m9.2 11.8 1.9 1.9 3.7-3.7" />
        </svg>
      </div>
      <div className={styles.verificationRelayBody}>{children}</div>
    </div>
  );
}

export function SecurityPillar({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className={styles.securityPillar}>
      <div className={styles.securityPillarIcon} aria-hidden="true">
        {icon}
      </div>
      <div>
        <h3 className={styles.securityPillarTitle}>{title}</h3>
        <p className={styles.securityPillarDescription}>{description}</p>
      </div>
    </div>
  );
}

export function NetworkPill() {
  return (
    <span className={styles.networkPill}>
      <span className={styles.networkPillDot} aria-hidden="true" />
      Solana Devnet
    </span>
  );
}

export function Avatar({
  name,
  src,
  size = "md",
}: {
  name: string;
  src?: string;
  size?: "sm" | "md";
}) {
  const sizeClass = size === "sm" ? "size-8" : "size-10";
  if (src) {
    return (
      <Image
        src={src}
        alt={name}
        width={40}
        height={40}
        className={`${sizeClass} rounded-full border-2 border-[#020617]`}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center bg-gradient-to-br from-teal-400 to-teal-900 text-[#020617] font-bold border-2 border-[#020617]`}
      aria-hidden="true"
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

export { BrandMark as DashboardBrandMark } from "./landing-brand";
