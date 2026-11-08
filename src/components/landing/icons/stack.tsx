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

export default function StackIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M3 3h10a3 3 0 0 1 3 3v12" />
      <path d="M7 21h4a3 3 0 0 0 3-3V9" />
      <path d="M17 10h2a3 3 0 0 1 3 3v6" opacity="0.7" />
    </svg>
  );
}
