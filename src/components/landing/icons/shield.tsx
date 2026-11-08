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

export default function ShieldIcon({ className = 'size-4', ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M12 3a9 9 0 0 1 3 16.16l-2.54-2.54A6 6 0 0 0 12 15a6 6 0 0 0-4.46-1.77L9 19.16A9 9 0 0 1 12 3Z" />
      <path d="M12 9v4M12 15h.01" />
    </svg>
  );
}
