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

export default function SolanaMarkIcon({ className = "size-4", ...props }: IconProps) {
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
