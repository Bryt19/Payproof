import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function baseProps({ className = 'size-4', ...props }: IconProps) {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    className,
    ...props,
  };
}

export default function GaugeIcon({ className = 'size-4', ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M12 3v2m0 14v2M5 12h2m10 0h2" />
      <circle cx="12" cy="12" r="7.5" />
      <path d="m9.5 12 2.5 2.5 2.5-2.5" />
    </svg>
  );
}
