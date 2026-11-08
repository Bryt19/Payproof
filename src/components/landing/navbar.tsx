"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { PayproofLogo } from "./brand-logo";
import { Button } from "../ui/button";
import { WalletAvatarDropdown } from "@/components/wallet-avatar-dropdown";

const navItems = [
  { label: "Trust", id: "trust" },
  { label: "Use Cases", id: "use-cases" },
  { label: "Product", id: "product" },
];

export default function Navbar() {
  const [activeSection, setActiveSection] = useState<string>("");
  const [isCapsule, setIsCapsule] = useState(false);

  // Collapse into a sleek, transparent capsule when scrolling
  useEffect(() => {
    let capsule = false;
    let frame = 0;

    const update = () => {
      frame = 0;
      const y = window.scrollY;

      if (!capsule && y >= 20) {
        capsule = true;
        setIsCapsule(true);
      } else if (capsule && y <= 6) {
        capsule = false;
        setIsCapsule(false);
      }
    };

    const handleScroll = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  // Robust scroll spy for active section (clears when not in any nav section)
  useEffect(() => {
    const sectionIds = ["trust", "use-cases", "product"];

    const handleScrollSpy = () => {
      const navbarHeight = 70;

      // If at top of page (hero), clear active section
      const firstSection = document.getElementById(sectionIds[0]);
      if (!firstSection || firstSection.getBoundingClientRect().top > 250) {
        setActiveSection("");
        return;
      }

      // Find section in active view zone
      let current = "";
      for (const id of sectionIds) {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (
            rect.top <= window.innerHeight * 0.45 &&
            rect.bottom >= navbarHeight + 40
          ) {
            current = id;
          }
        }
      }

      setActiveSection(current);
    };

    handleScrollSpy();
    window.addEventListener("scroll", handleScrollSpy, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScrollSpy);
    };
  }, []);

  // Smooth scroll handler with offset for sticky navbar
  const scrollToSection = (e: React.MouseEvent, id: string) => {
    e.preventDefault();

    const target = document.getElementById(id);
    if (!target) return;

    const navbarOffset = isCapsule ? 76 : 88;
    const targetPosition =
      target.getBoundingClientRect().top + window.scrollY - navbarOffset;

    window.scrollTo({
      top: targetPosition,
      behavior: "smooth",
    });
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <div
        className={`relative mx-auto flex items-center justify-between gap-4 transition-[height,width,max-width,transform,padding] duration-300 ease-out motion-reduce:transition-none ${
          isCapsule
            ? "h-14 w-[94%] max-w-[1140px] translate-y-2.5 rounded-full px-5 sm:px-8"
            : "h-16 sm:h-20 w-full max-w-7xl translate-y-0 rounded-none px-4 sm:px-6 lg:px-8"
        }`}
      >
        {/* Transparent glass capsule surface */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 -z-10 rounded-full border border-white/[0.12] bg-white/[0.02] backdrop-blur-md transition-opacity duration-300 motion-reduce:transition-none ${
            isCapsule ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* Brand Logo (Left) */}
        <Link
          href="/"
          className="focus-visible:outline-2 focus-visible:outline-[#9945FF] rounded-lg p-1 -m-1 z-10"
          aria-label="Payproof Home"
        >
          <PayproofLogo />
        </Link>

        {/* Desktop Navigation Links (Centered in the middle, Clean, Seamless) */}
        <nav
          className="hidden md:flex items-center gap-8 lg:gap-10 absolute left-1/2 -translate-x-1/2 z-10"
          aria-label="Desktop Navigation"
        >
          {navItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => scrollToSection(e, item.id)}
                className={`relative py-1 text-sm tracking-wide transition-colors duration-200 focus-visible:outline-none focus-visible:text-white ${
                  isActive
                    ? "text-white font-medium"
                    : "text-white/60 hover:text-white font-normal"
                }`}
              >
                <span>{item.label}</span>
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-1 left-0 right-0 h-[2px] rounded-full"
                    style={{
                      background:
                        "linear-gradient(90deg, #9945FF 0%, #C14BF0 50%, #14F195 100%)",
                    }}
                  />
                )}
              </a>
            );
          })}
        </nav>

        {/* Right side: connected wallet avatar on desktop + mobile (no hamburger) */}
        <WalletAvatarDropdown />
      </div>
    </header>
  );
}
