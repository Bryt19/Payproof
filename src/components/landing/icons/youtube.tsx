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

export default function YoutubeIcon({ className = "size-4", ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.945-2.017C18.88 4 12 4 12 4s-6.88 0-8.595.454A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 4.58 2.78 2.78 0 0 0 1.945 2.017C5.12 20 12 20 12 20s6.88 0 8.595-.454a2.78 2.78 0 0 0 1.945-2.017 29 29 0 0 0 .46-4.58 29 29 0 0 0-.46-4.58z" />
      <path d="M9.75 15.02l5.75-3.27a.75.75 0 0 1 1.18.99v6.02a.75.75 0 0 1-1.18.99l-5.75-3.27a.75.75 0 0 1 0-1.24z" />
    </svg>
  );
}
