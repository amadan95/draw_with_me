type PencilProps = { color: string }

export function PencilArtwork({ color }: PencilProps) {
  return (
    <svg viewBox="0 0 50 72" aria-hidden="true" className="tool-art pencil-art">
      <defs>
        <linearGradient id="pencilWood" x1="0" x2="1">
          <stop offset="0" stopColor="#d6ad72" />
          <stop offset=".5" stopColor="#f3d29b" />
          <stop offset="1" stopColor="#c79559" />
        </linearGradient>
        <linearGradient id="pencilBody" x1="0" x2="1">
          <stop offset="0" stopColor="#f5d166" />
          <stop offset=".52" stopColor="#f2b84b" />
          <stop offset="1" stopColor="#c58c2d" />
        </linearGradient>
      </defs>
      <path d="M25 2 34 19 16 19Z" fill="url(#pencilWood)" stroke="#493d34" strokeWidth="1.3" />
      <path d="M25 2 28.4 8.6 21.6 8.6Z" fill={color} />
      <path d="M16 19h18v42.5c0 4.2-3.4 7.5-7.5 7.5h-3c-4.1 0-7.5-3.3-7.5-7.5Z" fill="url(#pencilBody)" stroke="#493d34" strokeWidth="1.3" />
      <path d="M21 20v43M29 20v43" stroke="rgba(255,255,255,.48)" strokeWidth="1.5" />
      <path d="M16.5 55.5h17" stroke="#9f7541" strokeWidth="1.2" />
      <path d="M16 59h18v4.5c0 3.1-2.5 5.5-5.5 5.5h-7c-3 0-5.5-2.4-5.5-5.5Z" fill="#d9a5a0" />
    </svg>
  )
}

export function EraserArtwork() {
  return (
    <svg viewBox="0 0 64 48" aria-hidden="true" className="tool-art eraser-art">
      <defs>
        <linearGradient id="eraserPink" x1="0" x2="1">
          <stop offset="0" stopColor="#e7aaa1" />
          <stop offset=".55" stopColor="#f2c4bb" />
          <stop offset="1" stopColor="#ce877d" />
        </linearGradient>
        <linearGradient id="eraserSleeve" x1="0" x2="1">
          <stop offset="0" stopColor="#718c91" />
          <stop offset="1" stopColor="#a8c0bc" />
        </linearGradient>
      </defs>
      <g transform="rotate(-8 32 24)">
        <path d="M10 7h40c6 0 10 4 10 10v14c0 6-4 10-10 10H10c-4 0-7-3-7-7V14c0-4 3-7 7-7Z" fill="url(#eraserPink)" stroke="#493d34" strokeWidth="1.4" />
        <path d="M28 7h19v34H28Z" fill="url(#eraserSleeve)" stroke="#493d34" strokeWidth="1.2" />
        <path d="M33 13h9M33 18h9" stroke="rgba(255,255,255,.52)" strokeWidth="1.5" strokeLinecap="round" />
      </g>
    </svg>
  )
}
