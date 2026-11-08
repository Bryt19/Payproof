import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function baseProps({ className = "size-4", ...props }: IconProps) {
  return {
    viewBox: "0 0 24 24",
    fill: "currentColor",
    stroke: "none",
    "aria-hidden": true,
    focusable: false,
    className,
    ...props,
  };
}

export default function DiscordIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M10.5 2h3l-.5 3.5 3.5.7-1.5 1.5-1.6-1.6L8.5 7l-.7 1.5H3L5 4l-1-1.5L3 2h2l1.6 1.7L6 3.4l1-.7h1z" />
      <path d="M3 11.5v6.5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-6.5" />
      <path d="M20.5 10.5a4 4 0 0 1-4 4h-3.5a7 7 0 0 1-6.5-3.5 7 7 0 0 1 .5-4.5 7 7 0 0 1 9.5 5.3" />
    </svg>
  );
}
