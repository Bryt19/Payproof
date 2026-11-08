"use client";

import React, { useEffect, useRef, useState } from "react";

const IDLE_HIDE_MS = 3500; // 3.5 seconds of inactivity
const BUTTON_SIZE = 42;
const RING_STROKE = 2.25;
// Ring fits exactly around the button — just 1px breathing room each side
const RING_OUTER = BUTTON_SIZE + RING_STROKE * 2 + 2;
const SAFE_AREA_BOTTOM = 24;
const SAFE_AREA_RIGHT = 16;
const Z_INDEX = 50;

interface ScrollToTopProps {
  className?: string;
}

export function ScrollToTop({ className = "" }: ScrollToTopProps) {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const rafScheduled = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const idleTimer = useRef<number | null>(null);
  const isHoveredRef = useRef(false);

  useEffect(() => {
    const clearIdleTimer = () => {
      if (idleTimer.current !== null) {
        window.clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
    };

    const update = () => {
      rafScheduled.current = false;

      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight;
      const scrolled =
        window.pageYOffset ||
        document.documentElement.scrollTop ||
        document.body.scrollTop ||
        0;
      setProgress(scrollable > 0 ? Math.min(1, scrolled / scrollable) : 0);

      // Hidden at the very top: there is nothing to scroll back to.
      if (scrolled <= 0) {
        clearIdleTimer();
        setVisible(false);
        return;
      }

      // Appears once the page scrolls, then fades away completely
      // after 3.5 seconds without any scroll activity.
      setVisible(true);
      clearIdleTimer();

      if (!isHoveredRef.current) {
        idleTimer.current = window.setTimeout(
          () => setVisible(false),
          IDLE_HIDE_MS,
        );
      }
    };

    const onScroll = () => {
      if (!rafScheduled.current) {
        rafScheduled.current = true;
        requestAnimationFrame(update);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    update();

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      clearIdleTimer();
    };
  }, []);

  const scrollToTop = () => {
    const root = document.documentElement;
    const prefersReduced =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.scrollTo({ top: 0, ...(prefersReduced ? {} : { behavior: "smooth" }) });
  };

  const circumference = 2 * Math.PI * ((RING_OUTER - RING_STROKE) / 2);

  const handleMouseEnter = () => {
    isHoveredRef.current = true;
    if (idleTimer.current !== null) {
      window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }
    setVisible(true);
  };

  const handleMouseLeave = () => {
    isHoveredRef.current = false;
    const scrolled =
      window.pageYOffset ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0;
    if (scrolled > 0) {
      if (idleTimer.current !== null) {
        window.clearTimeout(idleTimer.current);
      }
      idleTimer.current = window.setTimeout(
        () => setVisible(false),
        IDLE_HIDE_MS,
      );
    }
  };

  return (
    <div
      className={`pointer-events-none ${className}`}
      style={{
        bottom: SAFE_AREA_BOTTOM,
        right: SAFE_AREA_RIGHT,
        position: "fixed",
        zIndex: Z_INDEX,
      }}
    >
      {/* Wrapper: the ENTIRE circle (both SVG ring and button) fades & scales together */}
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`
          relative transition-all duration-300 ease-out
          ${visible ? "opacity-100 translate-y-0 scale-100 pointer-events-auto" : "opacity-0 translate-y-3 scale-90 pointer-events-none"}
        `}
        style={{ width: RING_OUTER, height: RING_OUTER }}
      >
        {/* Progress ring — fills the wrapper */}
        <svg
          width={RING_OUTER}
          height={RING_OUTER}
          viewBox={`0 0 ${RING_OUTER} ${RING_OUTER}`}
          aria-hidden="true"
          focusable="false"
          className="absolute inset-0 pointer-events-none"
          style={{ filter: "drop-shadow(0 0 6px rgba(153,69,255,0.35))" }}
        >
          <defs>
            <linearGradient id="scroll-ring-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#9945FF" />
              <stop offset="50%" stopColor="#C14BF0" />
              <stop offset="100%" stopColor="#14F195" />
            </linearGradient>
          </defs>
          {/* faint track */}
          <circle
            cx={RING_OUTER / 2}
            cy={RING_OUTER / 2}
            r={(RING_OUTER - RING_STROKE) / 2}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={RING_STROKE}
          />
          {/* progress arc */}
          <circle
            cx={RING_OUTER / 2}
            cy={RING_OUTER / 2}
            r={(RING_OUTER - RING_STROKE) / 2}
            fill="none"
            stroke="url(#scroll-ring-grad)"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={`${circumference * (1 - progress)}`}
            transform={`rotate(-90 ${RING_OUTER / 2} ${RING_OUTER / 2})`}
            style={{ transition: "stroke-dashoffset 0.12s linear" }}
          />
        </svg>

        {/* Button — absolutely centered inside the ring wrapper */}
        <button
          ref={buttonRef}
          type="button"
          onClick={scrollToTop}
          aria-label="Scroll to top"
          className="
            absolute inset-0 m-auto
            flex items-center justify-center
            rounded-full border border-white/10 bg-white/[0.04]
            text-white/80
            transition-all duration-200 ease-out
            hover:border-white/20 hover:text-white hover:scale-105
            focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9945FF]
            active:scale-[0.95]
          "
          style={{
            width: BUTTON_SIZE,
            height: BUTTON_SIZE,
            boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 8px 24px rgba(0,0,0,0.40)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow =
              "0 0 0 1px rgba(255,255,255,0.08), 0 0 18px rgba(153,69,255,0.45), 0 8px 24px rgba(0,0,0,0.40)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow =
              "0 0 0 1px rgba(255,255,255,0.06), 0 8px 24px rgba(0,0,0,0.40)";
          }}
          onFocus={(e) => {
            e.currentTarget.style.boxShadow =
              "0 0 0 2px rgba(153,69,255,0.55), 0 0 18px rgba(153,69,255,0.45), 0 8px 24px rgba(0,0,0,0.40)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.boxShadow =
              "0 0 0 1px rgba(255,255,255,0.06), 0 8px 24px rgba(0,0,0,0.40)";
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M12 18V6M7 11l5-5 5 5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default ScrollToTop;
