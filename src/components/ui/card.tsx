import React, { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  glowOnHover?: boolean;
  surface?: "primary" | "secondary";
}

export function Card({
  className = "",
  glowOnHover = true,
  surface = "primary",
  children,
  ...props
}: CardProps) {
  const surfaceClass = surface === "primary" ? "bg-[#0E0E12]" : "bg-[#16161B]";
  const glowClass = glowOnHover
    ? "hover:border-[#9945FF]/50 hover:shadow-[0_8px_30px_rgba(153,69,255,0.12)] transition-all duration-300"
    : "";

  return (
    <div
      className={`rounded-2xl border border-white/[0.08] ${surfaceClass} ${glowClass} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

