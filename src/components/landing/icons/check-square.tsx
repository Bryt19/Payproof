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

export default function CheckSquareIcon({ className = 'size-4', ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  );
}
