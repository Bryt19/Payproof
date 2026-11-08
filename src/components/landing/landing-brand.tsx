import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function baseProps({ className = "size-4", ...props }: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    className,
    ...props,
  };
}

export function BrandMark({ className = "size-4" }: IconProps) {
  return (
    <svg viewBox="0 0 44 44" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="lndBrandBarTop" x1="12" y1="13" x2="30" y2="13" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#9945FF" />
          <stop offset="100%" stopColor="#C14BF0" />
        </linearGradient>
        <linearGradient id="lndBrandBarMid" x1="12" y1="19" x2="26" y2="19" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#9945FF" />
          <stop offset="60%" stopColor="#5B45FF" />
          <stop offset="100%" stopColor="#14F195" />
        </linearGradient>
        <linearGradient id="lndBrandCheck" x1="11" y1="27" x2="33" y2="15" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#C14BF0" />
          <stop offset="50%" stopColor="#9945FF" />
          <stop offset="100%" stopColor="#C14BF0" />
        </linearGradient>
      </defs>
      <line x1="12" y1="13" x2="30" y2="13" stroke="url(#lndBrandBarTop)" strokeWidth="3.2" strokeLinecap="round" />
      <line x1="12" y1="19" x2="25" y2="19" stroke="url(#lndBrandBarMid)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M12 27L18.5 33.5L32 17" stroke="url(#lndBrandCheck)" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BrandMarkSm({ className = "size-4" }: IconProps) {
  return <BrandMark className={className} />;
}

export function SolanaMark({ className = "size-4" }: IconProps) {
  return (
    <svg
      {...baseProps({ className })}
      strokeWidth={1.8}
      viewBox="0 0 24 24"
    >
      <path
        d="M12 2 2 9.5l1.5 10.5L12 22l8.5-2.5 1.5-10.5L12 2Z"
        stroke="currentColor"
      />
      <path
        d="M12 2v20"
        stroke="currentColor"
        opacity="0.55"
      />
      <path
        d="M4.5 9.5 12 14l7.5-4.5"
        stroke="currentColor"
        opacity="0.85"
      />
    </svg>
  );
}

export function SolanaMarkSquare({ className = "size-4" }: IconProps) {
  return (
    <svg
      {...baseProps({ className, viewBox: "0 0 28 28" })}
      strokeWidth={2}
      fill="none"
    >
      <rect x="3" y="3" width="22" height="22" rx="5" />
      <path
        d="M14 6 7 11.5l1.5 10 7-4.5L14 6Z"
        stroke="currentColor"
      />
      <path
        d="M14 6v16"
        stroke="currentColor"
        opacity="0.5"
      />
      <path
        d="M8 11.5L14 14l6-2.5"
        stroke="currentColor"
        opacity="0.85"
      />
    </svg>
  );
}

export function AvatarFallback({ className = "size-4", name = "?" }: IconProps & { name?: string }) {
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #2dd4bf, #0f766e)",
        color: "#020617",
        fontWeight: 700,
        fontSize: "clamp(10px, 1.2vw, 13px)",
        width: "100%",
        height: "100%",
        borderRadius: "50%",
        overflow: "hidden",
        letterSpacing: "0.02em",
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

export function CloseIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

export function MenuIcon({ className = "size-4" }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </svg>
  );
}
