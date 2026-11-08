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
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0c4a6e"/>
        <stop offset="100%" stop-color="#0284c7"/>
      </linearGradient>
      <linearGradient id="wing" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#e0f2fe"/>
        <stop offset="100%" stop-color="#38bdf8"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="26" fill="url(#bg)"/>
    <circle cx="64" cy="64" r="46" fill="#0369a1" stroke="#fdba74" stroke-width="4"/>
    <circle cx="92" cy="38" r="10" fill="#fde047" opacity="0.92"/>
    <path d="M26 88c10-9 24-9 34 0 10-8 24-8 34 0 5 4 8 8 8 12H22c0-5 2-9 4-12z" fill="#bae6fd" opacity="0.45"/>
    <path d="M64 56C54 36 32 32 30 48c-2 13 13 20 26 15-8 8-6 20 4 18 6-1 8-10 4-18 4 8 6 17 12 18 10 2 12-10 4-18 13 5 28-2 26-15-2-16-24-12-36 8z" fill="url(#wing)"/>
    <rect x="62" y="45" width="4" height="30" rx="2" fill="#082f49"/>
  </svg>`,

  'ach-play-10': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#082f49"/>
        <stop offset="100%" stop-color="#0369a1"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="26" fill="url(#bg)"/>
    <circle cx="64" cy="64" r="46" fill="#0284c7" stroke="#fdba74" stroke-width="4"/>
    <path d="M26 54l16-8v10l-16 8zm76 0l-16-8v10l16 8z" fill="#7dd3fc"/>
    <path d="M64 34c-6-11-19-13-20-4-1 7 7 11 15 8-4 5-3 11 2 10 3 0 4-5 3-9 1 4 2 9 5 9 5 1 6-5 2-10 8 3 16-1 15-8-1-9-14-7-22 4z" fill="#ffffff"/>
    <rect x="34" y="64" width="60" height="30" rx="15" fill="#0c4a6e" stroke="#fed7aa" stroke-width="2.5"/>
    <text x="64" y="86" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="900" fill="#ffedd5">10</text>
  </svg>`,

  'ach-play-50': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1e3a8a"/>
        <stop offset="100%" stop-color="#2563eb"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="26" fill="url(#bg)"/>
    <circle cx="64" cy="64" r="46" fill="#1d4ed8" stroke="#e2e8f0" stroke-width="4.5"/>
    <path d="M22 48h26l-6 10H26zm84 0H80l6 10h16z" fill="#e2e8f0"/>
    <path d="M28 62h22l-5 9H33zm72 0H78l5 9h12z" fill="#cbd5e1"/>
    <path d="M64 34c-6-11-19-13-20-4-1 7 7 11 15 8-4 5-3 11 2 10 3 0 4-5 3-9 1 4 2 9 5 9 5 1 6-5 2-10 8 3 16-1 15-8-1-9-14-7-22 4z" fill="#f8fafc"/>
    <rect x="34" y="66" width="60" height="30" rx="15" fill="#0f172a" stroke="#e2e8f0" stroke-width="2.5"/>
    <text x="64" y="88" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="900" fill="#f8fafc">50</text>
  </svg>`,

  'ach-play-100': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#451a03"/>
        <stop offset="100%" stop-color="#b45309"/>
      </linearGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#fef08a"/>
        <stop offset="100%" stop-color="#f59e0b"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="26" fill="url(#bg)"/>
    <circle cx="64" cy="64" r="46" fill="#92400e" stroke="#fde047" stroke-width="4.5"/>
    <path d="M30 78c-4-18 4-36 18-44M98 78c4-18-4-36-18-44" stroke="#fde047" stroke-width="5" stroke-linecap="round" fill="none"/>
    <path d="M64 42c-7-12-21-14-22-4-1 8 8 12 17 9-5 5-4 12 2 11 3 0 4-5 3-10 1 5 2 10 5 10 6 1 7-6 2-11 9 3 18-1 17-9-1-10-15-8-24 4z" fill="url(#gold)"/>
    <rect x="31" y="67" width="66" height="29" rx="14.5" fill="#451a03" stroke="#fde047" stroke-width="2.5"/>
    <text x="64" y="88" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="900" fill="#fef9c3">100</text>
  </svg>`,

  'ach-score-50': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#431407"/>
    <circle cx="64" cy="64" r="46" fill="#9a3412" stroke="#fdba74" stroke-width="4"/>
    <rect x="26" y="26" width="14" height="32" rx="5" fill="#38bdf8"/>
    <rect x="88" y="70" width="14" height="32" rx="5" fill="#38bdf8"/>
    <path d="M64 24l9 19 21 3-15 14 4 20-19-10-19 10 4-20-15-14 21-3z" fill="#fed7aa"/>
    <rect x="35" y="74" width="58" height="26" rx="13" fill="#431407" stroke="#fdba74" stroke-width="2.2"/>
    <text x="64" y="93" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="900" fill="#ffedd5">50+</text>
  </svg>`,

  'ach-score-100': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#0f172a"/>
    <circle cx="64" cy="64" r="46" fill="#334155" stroke="#e2e8f0" stroke-width="4.5"/>
    <rect x="25" y="28" width="13" height="34" rx="5" fill="#38bdf8"/>
    <rect x="90" y="28" width="13" height="34" rx="5" fill="#38bdf8"/>
    <polygon points="69,22 45,58 62,58 56,82 83,46 66,46" fill="#7dd3fc" stroke="#f8fafc" stroke-width="2" stroke-linejoin="round"/>
    <rect x="31" y="76" width="66" height="26" rx="13" fill="#0f172a" stroke="#cbd5e1" stroke-width="2.2"/>
    <text x="64" y="95" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="17" font-weight="900" fill="#f8fafc">100+</text>
  </svg>`,

  'ach-score-250': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="plat" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#06b6d4"/>
        <stop offset="50%" stop-color="#6366f1"/>
        <stop offset="100%" stop-color="#ec4899"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="26" fill="#1e1b4b"/>
    <polygon points="64,14 107,39 107,89 64,114 21,89 21,39" fill="url(#plat)" stroke="#e0f2fe" stroke-width="4"/>
    <path d="M42 54l7-18 15 11 15-11 7 18z" fill="#ffffff"/>
    <polygon points="64,46 77,64 64,82 51,64" fill="#e0f2fe"/>
    <rect x="31" y="75" width="66" height="25" rx="12.5" fill="#1e1b4b" stroke="#bae6fd" stroke-width="2.2"/>
    <text x="64" y="93" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="17" font-weight="900" fill="#f0f9ff">250+</text>
  </svg>`,

  'ach-likes-50': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#4c0519"/>
    <circle cx="64" cy="64" r="46" fill="#be123c" stroke="#fdba74" stroke-width="4"/>
    <path d="M64 78S40 62 40 45c0-8 7-14 14-14 5 0 10 3 10 7 0-4 5-7 10-7 7 0 14 6 14 14 0 17-24 33-24 33z" fill="#ffe4e6"/>
    <rect x="36" y="74" width="56" height="26" rx="13" fill="#4c0519" stroke="#fda4af" stroke-width="2.2"/>
    <text x="64" y="93" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="900" fill="#ffe4e6">50</text>
  </svg>`,

  'ach-likes-100': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#500724"/>
    <circle cx="64" cy="64" r="46" fill="#e11d48" stroke="#e2e8f0" stroke-width="4.5"/>
    <path d="M24 50l14-6v10l-14 6zm80 0l-14-6v10l14 6z" fill="#f8fafc"/>
    <path d="M64 76S40 60 40 44c0-8 7-14 14-14 5 0 10 3 10 7 0-4 5-7 10-7 7 0 14 6 14 14 0 16-24 32-24 32z" fill="#ffffff"/>
    <rect x="33" y="74" width="62" height="26" rx="13" fill="#500724" stroke="#e2e8f0" stroke-width="2.2"/>
    <text x="64" y="93" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="900" fill="#f8fafc">100</text>
  </svg>`,

  'ach-likes-250': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#450a0a"/>
    <circle cx="64" cy="64" r="46" fill="#dc2626" stroke="#fde047" stroke-width="4.5"/>
    <path d="M46 34l5-12 13 9 13-9 5 12z" fill="#fde047"/>
    <path d="M64 78S41 62 41 46c0-8 7-14 14-14 5 0 9 3 9 7 0-4 4-7 9-7 7 0 14 6 14 14 0 16-23 32-23 32z" fill="#fef08a"/>
    <rect x="32" y="74" width="64" height="26" rx="13" fill="#450a0a" stroke="#fde047" stroke-width="2.2"/>
    <text x="64" y="93" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="900" fill="#fef9c3">250</text>
  </svg>`,

  'ach-play-desktop': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#082f49"/>
    <circle cx="64" cy="64" r="46" fill="#0369a1" stroke="#fdba74" stroke-width="4"/>
    <rect x="30" y="32" width="68" height="44" rx="7" fill="#0c4a6e" stroke="#e0f2fe" stroke-width="3.5"/>
    <path d="M64 52c-5-8-15-9-16-3-1 5 6 8 12 6-3 3-3 8 1 7 2 0 3-3 3-6 0 3 1 6 3 6 4 1 4-4 1-7 6 2 13-1 12-6-1-6-11-5-16 3z" fill="#7dd3fc"/>
    <rect x="57" y="76" width="14" height="7" fill="#bae6fd"/>
    <rect x="36" y="85" width="56" height="11" rx="5" fill="#fde68a"/>
  </svg>`,

  'ach-play-mobile': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#172554"/>
    <circle cx="64" cy="64" r="46" fill="#1d4ed8" stroke="#fdba74" stroke-width="4"/>
    <rect x="26" y="40" width="76" height="48" rx="10" fill="#0f172a" stroke="#e0f2fe" stroke-width="3.5"/>
    <rect x="33" y="45" width="57" height="38" rx="5" fill="#0284c7"/>
    <circle cx="95.5" cy="64" r="2.8" fill="#bae6fd"/>
    <path d="M61 62c-5-8-14-9-15-3-1 5 5 8 11 6-3 3-2 8 2 7 2 0 2-3 2-6 0 3 1 6 3 6 4 1 4-4 1-7 6 2 12-1 11-6-1-6-10-5-15 3z" fill="#ffffff"/>
  </svg>`,

  'ach-ratioed-by-love': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#3b0764"/>
        <stop offset="100%" stop-color="#9d174d"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="26" fill="url(#bg)"/>
    <circle cx="64" cy="64" r="46" fill="#701a75" stroke="#fde047" stroke-width="4.5"/>
    <rect x="61" y="34" width="6" height="58" rx="3" fill="#fde047"/>
    <rect x="46" y="90" width="36" height="7" rx="3.5" fill="#fde047"/>
    <line x1="34" y1="54" x2="94" y2="42" stroke="#fef08a" stroke-width="5" stroke-linecap="round"/>
    <path d="M40 80c0 0-14-10-14-20 0-5 4-9 9-9 3 0 5 2 5 4 0-2 2-4 5-4 5 0 9 4 9 9 0 10-14 20-14 20z" fill="#fb7185" stroke="#ffe4e6" stroke-width="2"/>
    <rect x="83" y="46" width="16" height="24" rx="4" fill="#38bdf8" stroke="#e0f2fe" stroke-width="2"/>
  </svg>`,

  'ach-touch-grass': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="26" fill="#052e16"/>
    <circle cx="64" cy="64" r="44" fill="#15803d" stroke="#86efac" stroke-width="4"/>
    <path d="M38 86c2-18 10-32 18-38-2 14 0 26 4 38m4-38c6-8 14-14 22-16-6 14-8 30-6 54m10-34c6-6 12-10 18-10-6 12-8 26-6 44" stroke="#dcfce7" stroke-width="6" stroke-linecap="round" fill="none"/>
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
