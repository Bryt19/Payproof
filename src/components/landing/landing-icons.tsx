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

export function ArrowRightIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

export function ChecksIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <circle cx="12" cy="12" r="8.3" />
      <path d="m8.4 12.2 2.4 2.4 4.8-5" />
    </svg>
  );
}

export function CloneIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M9 3H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4" />
      <path d="M9 3v6h6" />
      <path d="M5 15h4" />
    </svg>
  );
}

export function GaugeIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M12 3v2m0 14v2M5 12h2m10 0h2" />
      <circle cx="12" cy="12" r="7.5" />
      <path d="m9.5 12 2.5 2.5 2.5-2.5" />
    </svg>
  );
}

export function InfoIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <circle cx="12" cy="12" r="8.3" />
      <path d="M12 9v4M12 15.5v.5" />
    </svg>
  );
}

export function ReceiptIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M5 3h10l3 3v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h1Z" />
      <path d="M9 3h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4" />
      <path d="M8 12h8M8 14h6M8 7h.01" />
    </svg>
  );
}

export function ShieldIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M12 3a9 9 0 0 1 3 16.16l-2.54-2.54A6 6 0 0 0 12 15a6 6 0 0 0-4.46-1.77L9 19.16A9 9 0 0 1 12 3Z" />
      <path d="M12 9v4M12 15h.01" />
    </svg>
  );
}

export function SnapIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M12 3v2m0 14v2M5 12h2m10 0h2" />
      <circle cx="12" cy="12" r="6.5" />
      <path d="m8.5 12 3 3 3-3" />
    </svg>
  );
}

export function ZapIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M13 2 3 14h6l-1 8 10-12h-6l1-8z" />
    </svg>
  );
}

export function LayoutDashboardIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function FileTextIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M14 2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
      <path d="M14 2v6h6" />
      <path d="M8 16h8M8 12h8M8 8h5" />
    </svg>
  );
}

export function BoxIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M3 7l9-4 9 4v12l-9 4-9-4V7z" />
      <path d="M12 7v12M7 11h10" />
    </svg>
  );
}

export function LayersIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M12 2 2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  );
}

export function LockIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <rect x="3" y="11" width="18" height="9" rx="2" />
      <path d="M7 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function SeeIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M22 12c0 5.2-4.2 9.4-9 9.9V7.1C17.8 1.9 22 6.1 22 12z" opacity="0.4" />
    </svg>
  );
}

export function UserIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function CheckSquareIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  );
}

export function WalletIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <path d="M16 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
      <path d="M6 10a4 4 0 0 0 8 0" />
    </svg>
  );
}

export function GoogIeIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="12" cy="12" r="3.5" opacity="0.5" />
    </svg>
  );
}

export function ArrowLeftIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M19 12H5M9.33 7.33A9 9 0 1 0 12 21" />
    </svg>
  );
}

export function TrendingUpIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M2 12l8 8 4-4 4 4 8-10" />
      <path d="M18 12v6h-6" opacity="0.6" />
    </svg>
  );
}

export function StackIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M3 3h10a3 3 0 0 1 3 3v12" />
      <path d="M7 21h4a3 3 0 0 0 3-3V9" />
      <path d="M17 10h2a3 3 0 0 1 3 3v6" opacity="0.7" />
    </svg>
  );
}

export function SmileIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <circle cx="12" cy="9" r="3.4" />
      <path d="M6 21c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M9 10.5c.4.5 1 .8 1.6.8" />
      <path d="M15 10.5c.4.5 1 .8 1.6.8" />
    </svg>
  );
}

export function StarIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M12 2l2.4 6.4 6.8.8-5.2 4.6 1.6 6.6L12 17.2l-6.2 3.4 1.6-6.6L2.8 9.2l6.8-.8L12 2Z" />
    </svg>
  );
}

export function CheckIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <circle cx="12" cy="12" r="8.3" />
      <path d="m8.4 12.2 2.4 2.4 4.8-5" />
    </svg>
  );
}

export function GlobeIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M3.5 12h17" strokeDasharray="2 3" />
      <path d="M12 3.5c3.5 1.2 6.5 4 6.5 7.5S15.5 23.2 12 24.4 8.5 20.7 5 17.5 3.5 9.5 3.5 9.5Z" opacity="0.7" />
      <path d="M4 8.5h16" strokeDasharray="2 3" opacity="0.7" />
    </svg>
  );
}

export function PaperPlaneIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M3 12l6-6 4 4 8-8" />
      <path d="M21 3l-3 3" opacity="0.7" />
      <path d="M14 14l3 3" opacity="0.6" />
    </svg>
  );
}

export function SolanaMarkIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg
      {...baseProps({ className, ...props })}
      strokeWidth={2}
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

export function DiscordIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M10.5 2h3l-.5 3.5 3.5.7-1.5 1.5-1.6-1.6L8.5 7l-.7 1.5H3L5 4l-1-1.5L3 2h2l1.6 1.7L6 3.4l1-.7h1z" />
      <path d="M3 11.5v6.5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-6.5" />
      <path d="M20.5 10.5a4 4 0 0 1-4 4h-3.5a7 7 0 0 1-6.5-3.5 7 7 0 0 1 .5-4.5 7 7 0 0 1 9.5 5.3" />
    </svg>
  );
}

export function TwitterIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M18.244 2.25h3.308l-7.226 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function GithubIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.09.682-.217.682-.482 0-.237-.009-.866-.014-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.338c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
  );
}

export function YoutubeIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.945-2.017C18.88 4 12 4 12 4s-6.88 0-8.595.454A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 4.58 2.78 2.78 0 0 0 1.945 2.017C5.12 20 12 20 12 20s6.88 0 8.595-.454a2.78 2.78 0 0 0 1.945-2.017 29 29 0 0 0 .46-4.58 29 29 0 0 0-.46-4.58z" />
      <path d="M9.75 15.02l5.75-3.27a.75.75 0 0 1 1.18.99v6.02a.75.75 0 0 1-1.18.99l-5.75-3.27a.75.75 0 0 1 0-1.24z" />
    </svg>
  );
}

export function EyebrowDot({ className = "size-4" }: IconProps) {
  return (
    <span
      className={className}
      style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#14b8a6",
        boxShadow: "0 0 10px rgba(20,184,166,0.7)",
        display: "inline-block",
        flexShrink: 0,
      }}
      aria-hidden="true"
    />
  );
}
