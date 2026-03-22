"use client";

import { useId, type CSSProperties } from "react";
import { GEMINI_GRADIENT_STOPS } from "@/lib/gemini-gradient";

type PenCursorIconProps = {
  className?: string;
  style?: CSSProperties;
  variant?: "solid" | "gemini";
};

export function PenCursorIcon({
  className,
  style,
  variant = "solid"
}: PenCursorIconProps) {
  const gradientId = useId();
  const pathData =
    "M84.4373,11.577a18.0012,18.0012,0,0,0-25.46,0L8.0639,62.4848A5.9955,5.9955,0,0,0,6.306,66.7271V83.6964a5.9968,5.9968,0,0,0,6,6H29.2813a5.9959,5.9959,0,0,0,4.2423-1.7579l50.92-50.9078A18.0419,18.0419,0,0,0,84.4373,11.577Zm-8.49,8.4847a6.014,6.014,0,0,1,.0058,8.4846l-4.243,4.243-8.4891-8.4861,4.2416-4.2415A5.998,5.998,0,0,1,75.9468,20.0617Zm-49.15,57.6345h-8.49V69.2116L54.7352,32.7871l8.489,8.4861Z";

  return (
    <svg
      viewBox="0 0 96 96"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {variant === "gemini" ? (
        <defs>
          <linearGradient
            id={gradientId}
            x1="14"
            y1="18"
            x2="78"
            y2="76"
            gradientUnits="userSpaceOnUse"
          >
            {GEMINI_GRADIENT_STOPS.map((stop) => (
              <stop
                key={stop.offset}
                offset={`${stop.offset * 100}%`}
                stopColor={stop.color}
              />
            ))}
          </linearGradient>
        </defs>
      ) : null}
      <path
        d={pathData}
        fill={variant === "gemini" ? `url(#${gradientId})` : "currentColor"}
      />
      {variant === "gemini" ? (
        <path
          d={pathData}
          fill="none"
          stroke="rgba(44, 36, 64, 0.52)"
          strokeWidth="3.1"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}
