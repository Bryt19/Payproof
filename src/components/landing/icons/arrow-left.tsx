import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function baseProps({ className = "size-4", ...props }: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    focusable: false,
    className,
    ...props,
  };
}

export default function ArrowLeftIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M19 12H5M9.33 7.33A9 9 0 1 0 12 21" />
    </svg>
  );
}
