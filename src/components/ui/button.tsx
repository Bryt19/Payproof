import Link from "next/link";
import React, { ButtonHTMLAttributes, forwardRef } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "ghost" | "secondary";
  size?: "sm" | "md" | "lg";
  href?: string;
  isExternal?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      href,
      isExternal = false,
      className = "",
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium transition-all duration-200 select-none cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";

    const sizeStyles = {
      sm: "h-9 px-4 text-xs tracking-wider uppercase font-semibold",
      md: "min-h-[44px] px-6 text-sm tracking-wide font-semibold",
      lg: "min-h-[48px] px-8 text-base tracking-wide font-semibold",
    }[size];

    const variantStyles = {
      primary:
        "btn-brand-gradient text-white shadow-[0_0_20px_rgba(153,69,255,0.35)] hover:shadow-[0_0_28px_rgba(193,75,240,0.55)]",
      outline:
        "border border-white/20 bg-white/[0.03] text-white hover:border-white/40 hover:bg-white/[0.08]",
      secondary:
        "bg-[#16161B] text-white/90 border border-white/10 hover:border-white/25 hover:text-white",
      ghost:
        "text-white/70 hover:text-white hover:bg-white/[0.06]",
    }[variant];

    const combinedClasses = `${baseStyles} ${sizeStyles} ${variantStyles} ${className}`;

    if (href) {
      if (isExternal) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={combinedClasses}
          >
            {children}
          </a>
        );
      }
      return (
        <Link href={href} className={combinedClasses}>
          {children}
        </Link>
      );
    }

    return (
      <button ref={ref} className={combinedClasses} {...props}>
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

