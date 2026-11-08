const ICON_SVGS: Record<string, string> = {
  'game-flappysky': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0284c7"/>
        <stop offset="100%" stop-color="#1d4ed8"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="28" fill="url(#sky)"/>
    <circle cx="98" cy="30" r="14" fill="#fde047" opacity="0.9"/>
    <path d="M24 94c14-12 34-12 48 0 14-12 30-10 40 2v14H16V98z" fill="#bae6fd" opacity="0.35"/>
    <path d="M64 58C52 34 26 30 24 50c-2 16 16 24 32 18-10 10-8 24 4 22 8-1 10-12 4-22 6 10 8 21 16 22 12 2 14-12 4-22 16 6 34-2 32-18-2-20-28-16-40 8z" fill="#ffffff"/>
  </svg>`,

  'game-neondrift': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="neon" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#4c1d95"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="28" fill="url(#neon)"/>
    <path d="M16 96L64 48l48 48" stroke="#22d3ee" stroke-width="5" fill="none" opacity="0.5"/>
    <path d="M26 84h76l-12-22H38z" fill="#f43f5e"/>
    <rect x="42" y="66" width="44" height="10" rx="4" fill="#38bdf8"/>
    <circle cx="40" cy="86" r="9" fill="#f8fafc"/>
    <circle cx="88" cy="86" r="9" fill="#f8fafc"/>
  </svg>`,

  'ach-first-flight': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#0c4a6e"/>
    <circle cx="64" cy="64" r="44" fill="#0284c7" stroke="#7dd3fc" stroke-width="4"/>
    <path d="M64 42l12 24 26 4-19 18 4 26-23-12-23 12 4-26-19-18 26-4z" fill="#fef08a"/>
  </svg>`,

  'ach-sky-ace': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#422006"/>
    <circle cx="64" cy="64" r="44" fill="#ca8a04" stroke="#fef08a" stroke-width="4"/>
    <path d="M36 78l10-32 18 16 18-16 10 32H36z" fill="#fef9c3"/>
    <rect x="36" y="82" width="56" height="8" rx="4" fill="#fde047"/>
  </svg>`,

  'ach-banger-collector': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#500724"/>
    <circle cx="64" cy="64" r="44" fill="#be123c" stroke="#fda4af" stroke-width="4"/>
    <path d="M64 92S36 74 36 53c0-10 8-17 17-17 6 0 11 4 11 8 0-4 5-8 11-8 9 0 17 7 17 17 0 21-28 39-28 39z" fill="#ffe4e6"/>
  </svg>`,

  'ach-touch-grass': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#052e16"/>
    <circle cx="64" cy="64" r="44" fill="#15803d" stroke="#86efac" stroke-width="4"/>
    <path d="M38 86c2-18 10-32 18-38-2 14 0 26 4 38m4-38c6-8 14-14 22-16-6 14-8 30-6 54m10-34c6-6 12-10 18-10-6 12-8 26-6 44" stroke="#dcfce7" stroke-width="6" stroke-linecap="round" fill="none"/>
  </svg>`,

  'ach-atmosphere-legend': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="plat" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#06b6d4"/>
        <stop offset="100%" stop-color="#8b5cf6"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="26" fill="#1e1b4b"/>
    <polygon points="64,16 106,42 106,86 64,112 22,86 22,42" fill="url(#plat)" stroke="#e0e7ff" stroke-width="4"/>
    <polygon points="64,34 80,64 64,94 48,64" fill="#ffffff"/>
  </svg>`,

  'ach-sub-minute': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#172554"/>
    <circle cx="64" cy="68" r="38" fill="#1d4ed8" stroke="#93c5fd" stroke-width="5"/>
    <rect x="54" y="18" width="20" height="8" rx="4" fill="#93c5fd"/>
    <path d="M64 68L82 52M64 42v26" stroke="#ffffff" stroke-width="6" stroke-linecap="round"/>
  </svg>`,

  'ach-drift-king': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#3b0764"/>
    <circle cx="64" cy="64" r="44" fill="#7e22ce" stroke="#e9d5ff" stroke-width="4"/>
    <path d="M40 88c12-28 36-28 48-48M36 96c24-12 40-20 56-36" stroke="#f0abfc" stroke-width="7" stroke-linecap="round" fill="none"/>
  </svg>`,

  'lb-high-score': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#1e293b"/>
    <rect x="24" y="68" width="22" height="36" rx="4" fill="#94a3b8"/>
    <rect x="53" y="42" width="22" height="62" rx="4" fill="#facc15"/>
    <rect x="82" y="56" width="22" height="48" rx="4" fill="#fb923c"/>
    <circle cx="64" cy="26" r="8" fill="#fde047"/>
  </svg>`,

  'lb-speedrun': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#0f172a"/>
    <path d="M24 64h28M18 46h22M30 82h20" stroke="#38bdf8" stroke-width="6" stroke-linecap="round"/>
    <circle cx="78" cy="64" r="32" fill="#0284c7" stroke="#bae6fd" stroke-width="5"/>
    <path d="M78 46v18l12 10" stroke="#ffffff" stroke-width="6" stroke-linecap="round" fill="none"/>
  </svg>`,

  locked: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#1e293b"/>
    <rect x="38" y="58" width="52" height="42" rx="10" fill="#475569"/>
    <path d="M48 58V46a16 16 0 0132 0v12" stroke="#94a3b8" stroke-width="8" fill="none"/>
    <circle cx="64" cy="79" r="6" fill="#cbd5e1"/>
  </svg>`,
};

export function getBuiltInIconSvg(name: string): string | null {
  const clean = name.replace(/\.svg$/i, '');
  return ICON_SVGS[clean] ?? null;
}
