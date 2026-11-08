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

export default function GlobeIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M3.5 12h17" strokeDasharray="2 3" />
      <path d="M12 3.5c3.5 1.2 6.5 4 6.5 7.5S15.5 23.2 12 24.4 8.5 20.7 5 17.5 3.5 9.5 3.5 9.5Z" opacity="0.7" />
      <path d="M4 8.5h16" strokeDasharray="2 3" opacity="0.7" />
    </svg>
  );
}
