"use client";

import React from "react";

export function GlassOrb({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative flex items-center justify-center pointer-events-none select-none ${className}`}
      aria-hidden="true"
    >
      {/* Background celestial ambient glow - deep planetary atmosphere */}
      <div className="absolute w-[120%] h-[120%] rounded-full bg-gradient-to-br from-[#9945FF]/30 via-[#C14BF0]/18 to-[#14F195]/14 blur-3xl opacity-80" />

      {/* SVG 3D Celestial Planet with Planetary Rings */}
      <svg
        viewBox="0 0 600 600"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full max-w-[640px] max-h-[640px] drop-shadow-[0_28px_70px_rgba(0,0,0,0.75)]"
      >
        <defs>
          {/* Main obsidian glass planet body */}
          <radialGradient
            id="planetBodyGrad"
            cx="34%"
            cy="28%"
            r="68%"
            fx="32%"
            fy="24%"
          >
            <stop offset="0%" stopColor="#2D1B54" stopOpacity="0.98" />
            <stop offset="22%" stopColor="#1B0E36" stopOpacity="1" />
            <stop offset="50%" stopColor="#0D061A" stopOpacity="1" />
            <stop offset="78%" stopColor="#05020B" stopOpacity="1" />
            <stop offset="100%" stopColor="#010003" stopOpacity="1" />
          </radialGradient>

          {/* Planet internal glowing core (Solana gradient) */}
          <radialGradient
            id="planetCoreGlow"
            cx="40%"
            cy="42%"
            r="55%"
            fx="38%"
            fy="38%"
          >
            <stop offset="0%" stopColor="#C14BF0" stopOpacity="0.75" />
            <stop offset="35%" stopColor="#9945FF" stopOpacity="0.5" />
            <stop offset="70%" stopColor="#14F195" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#00C2FF" stopOpacity="0" />
          </radialGradient>

          {/* Lower hemisphere atmospheric emerald caustic bounce */}
          <radialGradient
            id="planetBottomCaustic"
            cx="58%"
            cy="80%"
            r="45%"
            fx="58%"
            fy="86%"
          >
            <stop offset="0%" stopColor="#14F195" stopOpacity="0.55" />
            <stop offset="35%" stopColor="#00C2FF" stopOpacity="0.3" />
            <stop offset="75%" stopColor="#9945FF" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>

          {/* Planetary Ring Main Linear Gradient (purple -> magenta -> emerald -> cyan) */}
          <linearGradient
            id="ringGrad1"
            x1="80"
            y1="250"
            x2="520"
            y2="350"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#9945FF" stopOpacity="0.9" />
            <stop offset="28%" stopColor="#C14BF0" stopOpacity="0.8" />
            <stop offset="70%" stopColor="#14F195" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#00C2FF" stopOpacity="0.75" />
          </linearGradient>

          {/* Specular Glint Ring Gradient */}
          <linearGradient
            id="ringSpecularGrad"
            x1="120"
            y1="180"
            x2="480"
            y2="420"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
            <stop offset="25%" stopColor="#C14BF0" stopOpacity="0.65" />
            <stop offset="65%" stopColor="#14F195" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#9945FF" stopOpacity="0.8" />
          </linearGradient>

          {/* Planet Edge Fresnel Rim Highlight */}
          <linearGradient
            id="planetFresnel"
            x1="160"
            y1="130"
            x2="440"
            y2="470"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
            <stop offset="25%" stopColor="#C14BF0" stopOpacity="0.7" />
            <stop offset="60%" stopColor="#9945FF" stopOpacity="0.25" />
            <stop offset="85%" stopColor="#14F195" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#00C2FF" stopOpacity="0.45" />
          </linearGradient>

          {/* Upper surface specular reflection on the sphere */}
          <linearGradient
            id="planetSheen"
            x1="220"
            y1="150"
            x2="320"
            y2="280"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.6" />
            <stop offset="30%" stopColor="#FFFFFF" stopOpacity="0.2" />
            <stop offset="70%" stopColor="#FFFFFF" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>

          {/* Sphere Clip Mask (r = 180) */}
          <clipPath id="sphereClip">
            <circle cx="300" cy="300" r="180" />
          </clipPath>

          {/* Planetary Ring Separation Clips (Back half: y <= 300, Front half: y >= 300) */}
          <clipPath id="ringBackClip">
            <rect x="0" y="0" width="600" height="301" />
          </clipPath>
          <clipPath id="ringFrontClip">
            <rect x="0" y="299" width="600" height="301" />
          </clipPath>

          {/* Blur Filters */}
          <filter id="ringGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="16" />
          </filter>
          <filter id="subtleGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" />
          </filter>

          {/* Reusable Planetary Ring Tracks System */}
          <g id="planetRingSystem">
            {/* Outer halo / atmospheric dust on ring edge */}
            <ellipse
              cx="300"
              cy="300"
              rx="286"
              ry="78"
              fill="none"
              stroke="url(#ringGrad1)"
              strokeWidth="10"
              filter="url(#ringGlow)"
              opacity="0.35"
            />

            {/* Faint Inner Crepe Ring (C-ring) */}
            <ellipse
              cx="300"
              cy="300"
              rx="204"
              ry="55"
              fill="none"
              stroke="url(#ringGrad1)"
              strokeWidth="18"
              strokeOpacity="0.3"
            />
            <ellipse
              cx="300"
              cy="300"
              rx="194"
              ry="52"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="0.8"
              strokeOpacity="0.3"
            />

            {/* Dense Main B-Ring */}
            <ellipse
              cx="300"
              cy="300"
              rx="236"
              ry="64"
              fill="none"
              stroke="url(#ringGrad1)"
              strokeWidth="34"
              strokeOpacity="0.9"
            />
            {/* Fine iridescent tracks inside B-ring */}
            <ellipse
              cx="300"
              cy="300"
              rx="230"
              ry="62"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="0.9"
              strokeOpacity="0.45"
              strokeDasharray="28 6 12 6"
            />
            <ellipse
              cx="300"
              cy="300"
              rx="244"
              ry="66"
              fill="none"
              stroke="#C14BF0"
              strokeWidth="1.2"
              strokeOpacity="0.65"
            />

            {/* Cassini Division Gap (dark negative space between B and A rings around rx=256) */}

            {/* Outer A-Ring */}
            <ellipse
              cx="300"
              cy="300"
              rx="270"
              ry="73"
              fill="none"
              stroke="url(#ringSpecularGrad)"
              strokeWidth="18"
              strokeOpacity="0.85"
            />
            {/* Outer boundary guides */}
            <ellipse
              cx="300"
              cy="300"
              rx="278"
              ry="75"
              fill="none"
              stroke="#14F195"
              strokeWidth="1"
              strokeOpacity="0.75"
              strokeDasharray="40 10"
            />
            <ellipse
              cx="300"
              cy="300"
              rx="286"
              ry="78"
              fill="none"
              stroke="url(#ringGrad1)"
              strokeWidth="1.4"
              strokeOpacity="0.6"
            />
          </g>
        </defs>

        {/* 1. BACK RING (Passes BEHIND the planet, tilted at -22deg) */}
        <g transform="rotate(-22 300 300)" clipPath="url(#ringBackClip)">
          <use href="#planetRingSystem" />
          {/* Shadow of the planet falling onto the back-right side of the ring */}
          <ellipse
            cx="340"
            cy="275"
            rx="130"
            ry="55"
            fill="#000000"
            opacity="0.75"
            filter="url(#softGlow)"
          />
        </g>

        {/* 2. PLANET SPHERE BODY (r = 180) */}
        <circle cx="300" cy="300" r="180" fill="url(#planetBodyGrad)" />

        {/* 3. INSIDE PLANET BODY (Glass Refraction & Core) */}
        <g clipPath="url(#sphereClip)">
          {/* Glowing internal core */}
          <circle
            cx="315"
            cy="310"
            r="150"
            fill="url(#planetCoreGlow)"
            filter="url(#softGlow)"
          />

          {/* Lower hemisphere emerald bounce */}
          <circle
            cx="325"
            cy="370"
            r="115"
            fill="url(#planetBottomCaustic)"
            filter="url(#softGlow)"
          />

          {/* Prismatic atmospheric bands across the planet body */}
          <path
            d="M170 360 Q 280 280 430 230"
            stroke="url(#ringGrad1)"
            strokeWidth="32"
            strokeLinecap="round"
            filter="url(#softGlow)"
            opacity="0.35"
          />
          <path
            d="M190 325 Q 295 285 410 255"
            stroke="#14F195"
            strokeWidth="5"
            strokeLinecap="round"
            filter="url(#subtleGlow)"
            opacity="0.45"
          />

          {/* Vignette for spherical optic depth */}
          <radialGradient
            id="planetVignette"
            cx="50%"
            cy="50%"
            r="50%"
            fx="46%"
            fy="44%"
          >
            <stop offset="65%" stopColor="#000000" stopOpacity="0" />
            <stop offset="88%" stopColor="#000000" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0.85" />
          </radialGradient>
          <circle cx="300" cy="300" r="180" fill="url(#planetVignette)" />

          {/* SHADOW CAST BY FRONT RING onto the planet surface */}
          <g transform="rotate(-22 300 300)">
            <ellipse
              cx="300"
              cy="316"
              rx="180"
              ry="38"
              fill="#000000"
              opacity="0.65"
              filter="url(#subtleGlow)"
            />
          </g>

          {/* Top specular studio reflection on the planet glass */}
          <path
            d="M200 245 C 215 185, 275 160, 355 165 C 330 195, 265 225, 200 245 Z"
            fill="url(#planetSheen)"
          />

          {/* Subtle bottom bounce crescent */}
          <path
            d="M235 435 C 280 455, 335 450, 375 425 C 350 438, 300 442, 235 435 Z"
            fill="#14F195"
            opacity="0.5"
            filter="url(#subtleGlow)"
          />
        </g>

        {/* 4. FRONT RING (Passes IN FRONT of the planet, tilted at -22deg) */}
        <g transform="rotate(-22 300 300)" clipPath="url(#ringFrontClip)">
          <use href="#planetRingSystem" />
        </g>

        {/* 5. CRISP FRESNEL EDGE RIM (Around the planet perimeter) */}
        <circle
          cx="300"
          cy="300"
          r="180"
          stroke="url(#planetFresnel)"
          strokeWidth="1.6"
          strokeOpacity="0.9"
        />

        {/* 6. PINPOINT CELESTIAL SPECULAR GLINT */}
        <circle cx="230" cy="195" r="2.5" fill="#FFFFFF" opacity="0.98" />
        <line
          x1="230"
          y1="187"
          x2="230"
          y2="203"
          stroke="#FFFFFF"
          strokeWidth="0.8"
          strokeOpacity="0.75"
        />
        <line
          x1="222"
          y1="195"
          x2="238"
          y2="195"
          stroke="#FFFFFF"
          strokeWidth="0.8"
          strokeOpacity="0.75"
        />
      </svg>
    </div>
  );
}



