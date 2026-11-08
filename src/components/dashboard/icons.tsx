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
        <linearGradient id="dbBrandBarTop" x1="12" y1="13" x2="30" y2="13" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#9945FF" />
          <stop offset="100%" stopColor="#C14BF0" />
        </linearGradient>
        <linearGradient id="dbBrandBarMid" x1="12" y1="19" x2="26" y2="19" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#9945FF" />
          <stop offset="60%" stopColor="#5B45FF" />
          <stop offset="100%" stopColor="#14F195" />
        </linearGradient>
        <linearGradient id="dbBrandCheck" x1="11" y1="27" x2="33" y2="15" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#C14BF0" />
          <stop offset="50%" stopColor="#9945FF" />
          <stop offset="100%" stopColor="#C14BF0" />
        </linearGradient>
      </defs>
      <line x1="12" y1="13" x2="30" y2="13" stroke="url(#dbBrandBarTop)" strokeWidth="3.2" strokeLinecap="round" />
      <line x1="12" y1="19" x2="25" y2="19" stroke="url(#dbBrandBarMid)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M12 27L18.5 33.5L32 17" stroke="url(#dbBrandCheck)" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function OverviewIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </svg>
  );
}

export function PaymentsIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="M4 8h14l-3-3" />
      <path d="M20 16H6l3 3" />
    </svg>
  );
}

export function RequestsIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="M14 3.5H7a1.8 1.8 0 0 0-1.8 1.8v13.4A1.8 1.8 0 0 0 7 20.5h10a1.8 1.8 0 0 0 1.8-1.8V8.3Z" />
      <path d="M14 3.5v4.8h4.8" />
      <path d="M8.8 13h6.4M8.8 16.4h4" />
    </svg>
  );
}

export function InvoicesIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="M6 3.5h12v17l-2.4-1.6-2.1 1.6-1.5-1.6-1.5 1.6-2.1-1.6L6 20.5Z" />
      <path d="M9.2 8.2h5.6M9.2 11.8h5.6" />
    </svg>
  );
}

export function AssistantIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="M12 3.8 13.5 8l4.2 1.5-4.2 1.5L12 15.2 10.5 11 6.3 9.5 10.5 8Z" />
      <path d="M17.6 15.2 18.4 17.4l2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8Z" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <circle cx="12" cy="12" r="2.8" />
      <path d="M19.4 14.2a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1.1-1.5 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H4a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.5-1.1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3H10a1.6 1.6 0 0 0 1-1.5V4a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </svg>
  );
}

export function MenuIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="M4 6.5h16M4 12h16M4 17.5h16" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

export function ExternalLinkIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function QrIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.4" />
      <path d="M14 14h2.8v2.8H14zM20.5 14v2.8M14 20.5h2.8M20.5 20.5h-1.2" />
    </svg>
  );
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
    </svg>
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return <ChevronDownIcon className={className} />;
}

export function ReceivedIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="M17.5 6.5 7 17" />
      <path d="M15.4 17H7v-8.4" />
    </svg>
  );
}

export function CheckedIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <circle cx="12" cy="12" r="8.3" />
      <path d="m8.4 12.2 2.4 2.4 4.8-5" />
    </svg>
  );
}

export function PendingIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <circle cx="12" cy="12" r="8.3" />
      <path d="M12 7.8V12l2.8 1.8" />
    </svg>
  );
}

export function RequestsStatIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="M5 5.5h14v13H5z" />
      <path d="M8.4 9.2h7.2M8.4 12.7h5" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export function ChartBarIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="M3.5 20V10" />
      <path d="M9.5 20V4" />
      <path d="M15.5 20V12" />
      <path d="M21.5 20V7" />
    </svg>
  );
}

export function ChartLineIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <polyline points="4 19 8 12 12 15 18 7 20 10" />
    </svg>
  );
}

export function ChartPieIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="M20.5 5.5c0-1.2-1-2.2-2.2-2.2H6.7C5.5 3.3 4.5 4.3 4.5 5.5v13c0 1.2 1 2.2 2.2 2.2h11.6c1.2 0 2.2-1 2.2-2.2z" />
      <path d="M19.8 10.2 12 13l-1.3-9.5a1.5 1.5 0 0 0-2.7 0L6.2 10.2a1.5 1.5 0 0 0 0 2.3l6.7 3.1a1.5 1.5 0 0 0 2.5 0L22.3 10.8a1.5 1.5 0 0 0-.5-2.6z" />
    </svg>
  );
}

export function LinkIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="M10 13a7 7 0 0 0 7-7 7 7 0 0 0-7-7" />
      <path d="M14 13a7 7 0 0 0-7 7 7 7 0 0 0 7 7" />
      <line x1="4" x2="20" y1="17" y2="7" />
    </svg>
  );
}

export function SendPlaneIcon({ className }: IconProps) {
  return (
    <svg {...baseProps({ className })}>
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22L11 13L2 9L22 2Z" />
    </svg>
  );
}

