type TwinkleClusterIconProps = {
  className?: string;
};

export function TwinkleClusterIcon({ className }: TwinkleClusterIconProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="twinkleMain" x1="7" y1="5" x2="23" y2="25" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#B7B7FF" />
          <stop offset="0.58" stopColor="#C6A4F3" />
          <stop offset="1" stopColor="#F6B4D5" />
        </linearGradient>
        <linearGradient id="twinklePeach" x1="21" y1="4" x2="26" y2="11" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFE1AF" />
          <stop offset="1" stopColor="#FFB98D" />
        </linearGradient>
        <linearGradient id="twinklePink" x1="20" y1="17" x2="24.5" y2="25" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#E8C1FF" />
          <stop offset="1" stopColor="#C58BEA" />
        </linearGradient>
        <filter id="twinkleShadow" x="2" y="2" width="28" height="28" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="3" stdDeviation="2.5" floodColor="#D6B8C2" floodOpacity="0.22" />
        </filter>
      </defs>

      <g filter="url(#twinkleShadow)">
        <path
          d="M14.75 4.75C15.6 9.9 18.1 12.4 23.25 13.25C18.1 14.1 15.6 16.6 14.75 21.75C13.9 16.6 11.4 14.1 6.25 13.25C11.4 12.4 13.9 9.9 14.75 4.75Z"
          fill="url(#twinkleMain)"
          stroke="rgba(255,255,255,0.42)"
          strokeWidth="0.7"
          strokeLinejoin="round"
        />
        <path
          d="M22.35 5.2C22.8 7.9 24.1 9.2 26.8 9.65C24.1 10.1 22.8 11.4 22.35 14.1C21.9 11.4 20.6 10.1 17.9 9.65C20.6 9.2 21.9 7.9 22.35 5.2Z"
          fill="url(#twinklePeach)"
          stroke="rgba(255,255,255,0.46)"
          strokeWidth="0.55"
          strokeLinejoin="round"
        />
        <path
          d="M22.05 18.6C22.45 20.95 23.55 22.05 25.9 22.45C23.55 22.85 22.45 23.95 22.05 26.3C21.65 23.95 20.55 22.85 18.2 22.45C20.55 22.05 21.65 20.95 22.05 18.6Z"
          fill="url(#twinklePink)"
          stroke="rgba(255,255,255,0.44)"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
