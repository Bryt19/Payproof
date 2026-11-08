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

export default function BoxIcon({ className = 'size-4', ...props }: IconProps) {
  return (
    <svg {...baseProps({ className, ...props })}>
      <path d="M3 7l9-4 9 4v12l-9 4-9-4V7z" />
      <path d="M12 7v12M7 11h10" />
    </svg>
  );
}
