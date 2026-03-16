// js/palettes.js
import { getPaletteState, setPaletteState } from './store.js';
import { setStatusColor } from './db.js';

// SVG Icons (inlined)
// Heroicons bolt-solid (MIT) https://heroicons.com
export const ICON_BOLT = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-label="Switch to Electric palettes"><path d="M11.9834 1.90718C12.0546 1.57461 11.8932 1.23571 11.59 1.08152C11.2868 0.927338 10.9179 0.996463 10.6911 1.24994L2.19108 10.7499C1.99385 10.9704 1.9446 11.2861 2.06533 11.5562C2.18607 11.8262 2.45423 12 2.75001 12H9.32227L8.01666 18.0929C7.9454 18.4255 8.10685 18.7644 8.41002 18.9185C8.71318 19.0727 9.08215 19.0036 9.30894 18.7501L17.8089 9.25013C18.0062 9.0297 18.0554 8.71393 17.9347 8.4439C17.814 8.17388 17.5458 8.00003 17.25 8.00003H10.6778L11.9834 1.90718Z"/></svg>`;

// Bootstrap Icons tree (MIT) https://icons.getbootstrap.com
export const ICON_TREE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-label="Switch to Natural palettes"><path d="M8.416.223a.5.5 0 0 0-.832 0l-3 4.5A.5.5 0 0 0 5 5.5h.098L3.076 8.735A.5.5 0 0 0 3.5 9.5h.191l-1.638 3.276a.5.5 0 0 0 .447.724H7V16h2v-2.5h4.5a.5.5 0 0 0 .447-.724L12.31 9.5h.191a.5.5 0 0 0 .424-.765L10.902 5.5H11a.5.5 0 0 0 .416-.777zM6.437 4.758A.5.5 0 0 0 6 4.5h-.066L8 1.401 10.066 4.5H10a.5.5 0 0 0-.424.765L11.598 8.5H11.5a.5.5 0 0 0-.447.724L12.69 12.5H3.309l1.638-3.276A.5.5 0 0 0 4.5 8.5h-.098l2.022-3.235a.5.5 0 0 0 .013-.507"/></svg>`;

export const PALETTE_SETS = {
  1: [
    {
      key: 'forest', label: 'Forest',
      color: '#22c55e', glow: 'rgba(34,197,94,0.4)',
      theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226', text: '#ecfdf4', textMuted: '#5ea87a' },
      complements: ['#84cc16','#bef264','#a3e635','#fbbf24','#34d399','#4ade80','#86efac'],
    },
    {
      key: 'ocean', label: 'Ocean',
      color: '#3b82f6', glow: 'rgba(59,130,246,0.4)',
      theme: { bg: '#05101e', surface: '#0b1e38', surface2: '#102c52', text: '#eef4ff', textMuted: '#5f9acf' },
      complements: ['#06b6d4','#22d3ee','#38bdf8','#7dd3fc','#0ea5e9','#60a5fa','#a5f3fc'],
    },
    {
      key: 'iris', label: 'Iris',
      color: '#818cf8', glow: 'rgba(129,140,248,0.4)',
      theme: { bg: '#0c0c1e', surface: '#141432', surface2: '#1d1d47', text: '#eeeeff', textMuted: '#8080c0' },
      complements: ['#8b5cf6','#a78bfa','#c4b5fd','#ec4899','#6366f1','#e879f9','#f472b6'],
    },
    {
      key: 'ember', label: 'Ember',
      color: '#f97316', glow: 'rgba(249,115,22,0.4)',
      theme: { bg: '#180a02', surface: '#2b1505', surface2: '#3f1f08', text: '#fff1e8', textMuted: '#b06a30' },
      complements: ['#fbbf24','#f59e0b','#ef4444','#fb923c','#fcd34d','#dc2626','#d97706'],
    },
    {
      key: 'coral', label: 'Coral',
      color: '#f43f5e', glow: 'rgba(244,63,94,0.4)',
      theme: { bg: '#180507', surface: '#2b0a11', surface2: '#3f0e1a', text: '#ffe8ec', textMuted: '#a8406a' },
      complements: ['#fb7185','#fda4af','#ec4899','#f472b6','#e11d48','#ff6b9d','#fce7f3'],
    },
    {
      key: 'sky', label: 'Sky',
      color: '#06b6d4', glow: 'rgba(6,182,212,0.4)',
      theme: { bg: '#030f18', surface: '#071e30', surface2: '#0b2d47', text: '#e8fbff', textMuted: '#3a9ab8' },
      complements: ['#0ea5e9','#38bdf8','#7dd3fc','#10b981','#34d399','#3b82f6','#a5f3fc'],
    },
    {
      key: 'gold', label: 'Gold',
      color: '#eab308', glow: 'rgba(234,179,8,0.4)',
      theme: { bg: '#120d00', surface: '#221800', surface2: '#332400', text: '#fffbea', textMuted: '#9a7010' },
      complements: ['#f59e0b','#fb923c','#fbbf24','#fde68a','#f97316','#d97706','#fcd34d'],
    },
    {
      key: 'mint', label: 'Mint',
      color: '#10b981', glow: 'rgba(16,185,129,0.4)',
      theme: { bg: '#031210', surface: '#07221e', surface2: '#0b332c', text: '#e8fff9', textMuted: '#308870' },
      complements: ['#06b6d4','#14b8a6','#2dd4bf','#22c55e','#34d399','#6ee7b7','#67e8f9'],
    },
  ],
  2: [
    {
      key: 'volt', label: 'Volt',
      color: '#aaff00', glow: 'rgba(170,255,0,0.4)',
      theme: { bg: '#0e1700', surface: '#192500', surface2: '#243600', text: '#f4ffe6', textMuted: '#88cc33' },
      complements: ['#6633ff','#00ccee','#ff00aa','#1155ff','#bb00ff','#44ff00','#ffcc00'],
    },
    {
      key: 'plasma', label: 'Plasma',
      color: '#ff1aad', glow: 'rgba(255,26,173,0.4)',
      theme: { bg: '#180012', surface: '#260020', surface2: '#38002e', text: '#ffe8f8', textMuted: '#cc44aa' },
      complements: ['#22ff66','#aaff00','#00ccee','#44ff00','#00ffaa','#ff2244','#bb00ff'],
    },
    {
      key: 'arc', label: 'Arc',
      color: '#0055ff', glow: 'rgba(0,85,255,0.4)',
      theme: { bg: '#00050f', surface: '#000a1e', surface2: '#00102d', text: '#e8f0ff', textMuted: '#4488ee' },
      complements: ['#ff8800','#ff2244','#aaff00','#ff3300','#ffdd00','#7700ff','#00ddcc'],
    },
    {
      key: 'venom', label: 'Venom',
      color: '#00ff66', glow: 'rgba(0,255,102,0.4)',
      theme: { bg: '#001008', surface: '#001c10', surface2: '#002a18', text: '#e8fff2', textMuted: '#33aa66' },
      complements: ['#ff1aaa','#7733ff','#ff4400','#9900ff','#ff1133','#00ffdd','#77ff00'],
    },
    {
      key: 'inferno', label: 'Inferno',
      color: '#ff3300', glow: 'rgba(255,51,0,0.4)',
      theme: { bg: '#140400', surface: '#220700', surface2: '#320c00', text: '#fff0eb', textMuted: '#cc4422' },
      complements: ['#00ccdd','#33ee00','#0044ff','#00ddaa','#0055ff','#ffaa00','#ff0044'],
    },
    {
      key: 'aurora', label: 'Aurora',
      color: '#00e5ff', glow: 'rgba(0,229,255,0.4)',
      theme: { bg: '#00080f', surface: '#000f1a', surface2: '#001828', text: '#e8fcff', textMuted: '#22aacc' },
      complements: ['#ff3300','#ff11bb','#eeff00','#ff2266','#ff8800','#0055ff','#00ff88'],
    },
    {
      key: 'solar', label: 'Solar',
      color: '#ffdd00', glow: 'rgba(255,221,0,0.4)',
      theme: { bg: '#0f0c00', surface: '#1e1700', surface2: '#2d2300', text: '#fffde8', textMuted: '#ccaa00' },
      complements: ['#0044ff','#00ffcc','#aa00ff','#00aaff','#5500ff','#bbff00','#ff4400'],
    },
    {
      key: 'ultraviolet', label: 'Ultraviolet',
      color: '#8800ff', glow: 'rgba(136,0,255,0.4)',
      theme: { bg: '#070013', surface: '#0e0022', surface2: '#160033', text: '#f0e8ff', textMuted: '#9944dd' },
      complements: ['#bbff00','#ff7700','#00ff44','#ffee00','#00ee66','#ff00cc','#0055ff'],
    },
  ],
};

export function getPaletteByKey(key) {
  for (const set of [PALETTE_SETS[1], PALETTE_SETS[2]]) {
    const found = set.find(p => p.key === key);
    if (found) return found;
  }
  return PALETTE_SETS[1][0]; // forest fallback (changed to null in Increment 3)
}

export function getGlowForColor(hex) {
  for (const set of [PALETTE_SETS[1], PALETTE_SETS[2]]) {
    const p = set.find(p => p.color === hex);
    if (p) return p.glow;
  }
  return PALETTE_SETS[1][0].glow; // forest fallback
}

export function applyPaletteVars(key) {
  const p = getPaletteByKey(key);
  document.documentElement.style.setProperty('--my-status', p.color);
  document.documentElement.style.setProperty('--my-glow', p.glow);
}

function renderSwatchRow(userId) {
  const row = document.getElementById('swatch-row');
  row.innerHTML = '';
  const state = getPaletteState();
  const setNum = state.activeSet;
  const savedKey = state.sets[String(setNum)].selectedKey;

  // Toggle button — icon represents the OTHER set (what you'd switch to)
  const btn = document.createElement('button');
  btn.className = 'set-toggle-btn';
  btn.innerHTML = setNum === 1 ? ICON_BOLT : ICON_TREE;
  btn.addEventListener('click', () => switchSet(setNum === 1 ? 2 : 1, userId));
  row.appendChild(btn);

  // Swatches for active set (Increment 2 will extend this to handle palette mode)
  PALETTE_SETS[setNum].forEach(p => {
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.dataset.key = p.key;
    swatch.style.background = p.color;
    if (p.key === savedKey) swatch.classList.add('selected');
    swatch.addEventListener('click', () => tapSwatch(p.key, userId));
    row.appendChild(swatch);
  });
}

export function tapSwatch(key, userId) {
  const state = getPaletteState();
  const setKey = String(state.activeSet);
  state.sets[setKey].selectedKey = key;
  setPaletteState(state);
  const palette = getPaletteByKey(key);
  setStatusColor(userId, palette.color).catch(() => {});
  applyPaletteVars(key);
  // Update DOM selection
  const row = document.getElementById('swatch-row');
  row.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
  const target = row.querySelector(`[data-key="${key}"]`);
  if (target) target.classList.add('selected');
}

export function initSwatches(userId) {
  renderSwatchRow(userId);
}

export function switchSet(toSet, userId) {
  const state = getPaletteState();
  state.activeSet = toSet;
  setPaletteState(state);

  const selectedKey = state.sets[String(toSet)].selectedKey;
  const palette = getPaletteByKey(selectedKey);
  applyPaletteVars(selectedKey);
  setStatusColor(userId, palette.color).catch(() => {});

  renderSwatchRow(userId);
}
