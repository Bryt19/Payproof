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

export default function ChecksIcon({ className = 'size-4', ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <circle cx="12" cy="12" r="8.3" />
      <path d="m8.4 12.2 2.4 2.4 4.8-5" />
    </svg>
  );
}
