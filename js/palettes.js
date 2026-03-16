// js/palettes.js
import { getPalette, setPalette } from './store.js';
import { setStatusColor } from './db.js';

export const PALETTES = [
  { key: 'forest', color: '#22c55e', glow: 'rgba(34, 197, 94, 0.4)'   },
  { key: 'ocean',  color: '#06b6d4', glow: 'rgba(6, 182, 212, 0.4)'   },
  { key: 'iris',   color: '#a855f7', glow: 'rgba(168, 85, 247, 0.4)'  },
  { key: 'ember',  color: '#f97316', glow: 'rgba(249, 115, 22, 0.4)'  },
  { key: 'coral',  color: '#f43f5e', glow: 'rgba(244, 63, 94, 0.4)'   },
  { key: 'sky',    color: '#60a5fa', glow: 'rgba(96, 165, 250, 0.4)'  },
  { key: 'gold',   color: '#eab308', glow: 'rgba(234, 179, 8, 0.4)'   },
  { key: 'mint',   color: '#2dd4bf', glow: 'rgba(45, 212, 191, 0.4)'  },
];

export function getPaletteByKey(key) {
  return PALETTES.find(p => p.key === key) || PALETTES[0];
}

export function getGlowForColor(hex) {
  const p = PALETTES.find(p => p.color === hex);
  return p ? p.glow : PALETTES[0].glow;  // fallback to forest glow
}
