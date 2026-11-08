import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function baseProps({ className = "size-4", ...props }: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    className,
    ...props,
  };
}

export default function SmileIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <circle cx="12" cy="9" r="3.4" />
      <path d="M6 21c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M9 10.5c.4.5 1 .8 1.6.8" />
      <path d="M15 10.5c.4.5 1 .8 1.6.8" />
    </svg>
  );
}
