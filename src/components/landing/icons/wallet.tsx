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

export default function WalletIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M16 12a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
      <path d="M6 10a3 3 0 0 0 6 0" />
      <path d="M22 10.5H22.1" opacity="0.5" />
    </svg>
  );
}
