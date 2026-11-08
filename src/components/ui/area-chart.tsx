"use client";

import React, { useState, useId } from "react";

export interface DataPoint {
  date: string;
  value: number; // Volume in USDC or SOL
  formattedValue: string;
}

interface AreaChartProps {
  data: DataPoint[];
  height?: number;
  className?: string;
  metricLabel?: string;
}

export function AreaChart({
  data,
  height = 240,
  className = "",
  metricLabel = "Volume",
}: AreaChartProps) {
  const chartId = useId().replace(/:/g, "");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-sm text-white/40"
      >
        No chart data available
      </div>
    );
  }

  const padding = { top: 20, right: 20, bottom: 35, left: 20 };
  const width = 800; // SVG internal coordinate width
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const values = data.map((d) => d.value);
  const minVal = Math.min(...values) * 0.95;
  const maxVal = Math.max(...values) * 1.05 || 1;

  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartWidth;
    const y =
      padding.top + chartHeight - ((d.value - minVal) / (maxVal - minVal)) * chartHeight;
    return { x, y, ...d };
  });

  // Construct SVG Path
  const linePath = points.reduce((acc, p, i) => {
    return `${acc} ${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }, "");

  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${
    height - padding.bottom
  } L ${points[0].x.toFixed(1)} ${height - padding.bottom} Z`;

  const activePoint = hoverIndex !== null ? points[hoverIndex] : points[points.length - 1];

  return (
    <div className={`relative w-full ${className}`}>
      {/* Chart top summary pill */}
      <div className="flex items-center justify-between pb-3 px-1">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#14F195] shadow-[0_0_8px_#14F195]" />
          <span className="text-xs font-medium uppercase tracking-wider text-white/60">
            {metricLabel}:
          </span>
          <span className="text-sm font-bold text-white">
            {activePoint?.formattedValue ?? "$0.00"}
          </span>
        </div>
        <span className="text-xs text-white/40 font-mono">
          {activePoint?.date ?? ""}
        </span>
      </div>

      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
          preserveAspectRatio="none"
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            {/* Purple to Green Gradient Fill */}
            <linearGradient id={`areaGrad-${chartId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9945FF" stopOpacity="0.38" />
              <stop offset="50%" stopColor="#C14BF0" stopOpacity="0.18" />
              <stop offset="90%" stopColor="#14F195" stopOpacity="0.04" />
              <stop offset="100%" stopColor="#14F195" stopOpacity="0.0" />
            </linearGradient>

            {/* Stroke Gradient */}
            <linearGradient id={`strokeGrad-${chartId}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#9945FF" />
              <stop offset="50%" stopColor="#C14BF0" />
              <stop offset="100%" stopColor="#14F195" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0.25, 0.5, 0.75, 1].map((pct, idx) => {
            const y = padding.top + chartHeight * (1 - pct);
            return (
              <line
                key={idx}
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray="4 4"
              />
            );
          })}

          {/* Area Fill */}
          <path d={areaPath} fill={`url(#areaGrad-${chartId})`} />

          {/* Gradient Line Stroke */}
          <path
            d={linePath}
            fill="none"
            stroke={`url(#strokeGrad-${chartId})`}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Vertical Crosshair Line when hovered */}
          {hoverIndex !== null && (
            <line
              x1={points[hoverIndex].x}
              y1={padding.top}
              x2={points[hoverIndex].x}
              y2={height - padding.bottom}
              stroke="rgba(255,255,255,0.25)"
              strokeDasharray="3 3"
            />
          )}

          {/* Interactive Hit Areas & Dots */}
          {points.map((p, i) => {
            const isHovered = hoverIndex === i;
            return (
              <g key={i}>
                {/* Invisible hover zone */}
                <rect
                  x={p.x - chartWidth / (points.length * 2)}
                  y={0}
                  width={chartWidth / points.length}
                  height={height}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoverIndex(i)}
                  onTouchStart={() => setHoverIndex(i)}
                />

                {/* Point dot on hover */}
                {isHovered && (
                  <>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="7"
                      fill="#9945FF"
                      opacity="0.4"
                    />
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="4"
                      fill="#14F195"
                      stroke="#FFFFFF"
                      strokeWidth="1.5"
                    />
                  </>
                )}
              </g>
            );
          })}

          {/* X-axis labels */}
          {points
            .filter((_, i) => i % Math.ceil(points.length / 5) === 0 || i === points.length - 1)
            .map((p, i) => (
              <text
                key={i}
                x={p.x}
                y={height - 10}
                fill="rgba(255,255,255,0.4)"
                fontSize="11"
                textAnchor="middle"
                fontFamily="inherit"
              >
                {p.date}
              </text>
            ))}
        </svg>
      </div>
    </div>
  );
}

