// js/palettes.js
import { setStatusColor, setPaletteKey } from './db.js';
import { safeCssColor } from './utils.js';
import { isHintSeen, markHintSeen, getPaletteState, setPaletteState } from './prefs.js';
import {
  shouldShowSwatchWave, shouldShowThemeHint, shouldShowDotGoHint,
  shouldShowSetTogglePulse,
} from './hints.js';

// Per-row wave timers. The wave needs to run independently on Direct's
// #swatch-row and a group context's #group-swatch-row — using a single
// module-global timer (the previous design) meant whichever row last called
// startSwatchHints would stopSwatchHints() the other row, stripping its
// .hint-wave class and freezing the wave. Symptom: navigate from Direct
// to a group, the Direct wave stops; navigate back, it doesn't restart
// because nothing re-renders Direct's row on a context switch.
const _hintTimersByRow = new Map();
// Timestamp (Date.now) of the most recent enterPaletteMode call, or null if
// the spin window has elapsed. Tracked as a timestamp rather than a bool
// because setPaletteState writes to userPrefs and Firebase echoes back ~100-
// 300ms later, re-rendering the swatch row and destroying the key swatch
// element. A boolean flag would be consumed on the first render and the
// re-render would create a fresh key swatch with no animation. The timestamp
// lets renderSwatchRow re-apply .key-spin to each new key swatch within the
// 5s animation window, with --key-spin-delay so the animation continues
// mid-flight rather than restarting from 0deg.
const KEY_SPIN_MS = 5000;
let _paletteEnterAt = null;

// SVG Icons (inlined)
// Heroicons bolt-solid (MIT) https://heroicons.com
export const ICON_BOLT = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-label="Switch to Electric palettes"><path d="M11.9834 1.90718C12.0546 1.57461 11.8932 1.23571 11.59 1.08152C11.2868 0.927338 10.9179 0.996463 10.6911 1.24994L2.19108 10.7499C1.99385 10.9704 1.9446 11.2861 2.06533 11.5562C2.18607 11.8262 2.45423 12 2.75001 12H9.32227L8.01666 18.0929C7.9454 18.4255 8.10685 18.7644 8.41002 18.9185C8.71318 19.0727 9.08215 19.0036 9.30894 18.7501L17.8089 9.25013C18.0062 9.0297 18.0554 8.71393 17.9347 8.4439C17.814 8.17388 17.5458 8.00003 17.25 8.00003H10.6778L11.9834 1.90718Z"/></svg>`;

// Bootstrap Icons flower3 (MIT) https://icons.getbootstrap.com
export const ICON_TREE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="1.5 1.5 13 13" fill="currentColor" aria-label="Switch to Natural palettes"><path d="M11.424 8c.437-.052.811-.136 1.04-.268a2 2 0 0 0-2-3.464c-.229.132-.489.414-.752.767C9.886 4.63 10 4.264 10 4a2 2 0 1 0-4 0c0 .264.114.63.288 1.035-.263-.353-.523-.635-.752-.767a2 2 0 0 0-2 3.464c.229.132.603.216 1.04.268-.437.052-.811.136-1.04.268a2 2 0 1 0 2 3.464c.229-.132.489-.414.752-.767C6.114 11.37 6 11.736 6 12a2 2 0 1 0 4 0c0-.264-.114-.63-.288-1.035.263.353.523.635.752.767a2 2 0 1 0 2-3.464c-.229-.132-.603-.216-1.04-.268M9 4a2 2 0 0 1-.045.205q-.059.2-.183.484a13 13 0 0 1-.637 1.223L8 6.142l-.135-.23a13 13 0 0 1-.637-1.223 4 4 0 0 1-.183-.484A2 2 0 0 1 7 4a1 1 0 1 1 2 0M3.67 5.5a1 1 0 0 1 1.366-.366 2 2 0 0 1 .156.142q.142.15.326.4c.245.333.502.747.742 1.163l.13.232-.265.002a13 13 0 0 1-1.379-.06 4 4 0 0 1-.51-.083 2 2 0 0 1-.2-.064A1 1 0 0 1 3.67 5.5m1.366 5.366a1 1 0 0 1-1-1.732l.047-.02q.055-.02.153-.044.202-.048.51-.083a13 13 0 0 1 1.379-.06q.135 0 .266.002l-.131.232c-.24.416-.497.83-.742 1.163a4 4 0 0 1-.327.4 2 2 0 0 1-.155.142M9 12a1 1 0 0 1-2 0 2 2 0 0 1 .045-.206q.058-.198.183-.483c.166-.378.396-.808.637-1.223L8 9.858l.135.23c.241.415.47.845.637 1.223q.124.285.183.484A1.3 1.3 0 0 1 9 12m3.33-6.5a1 1 0 0 1-.366 1.366 2 2 0 0 1-.2.064q-.202.048-.51.083c-.412.045-.898.061-1.379.06q-.135 0-.266-.002l.131-.232c.24-.416.497-.83.742-1.163a4 4 0 0 1 .327-.4q.07-.074.114-.11l.041-.032a1 1 0 0 1 1.366.366m-1.366 5.366a2 2 0 0 1-.155-.141 4 4 0 0 1-.327-.4A13 13 0 0 1 9.74 9.16l-.13-.232.265-.002c.48-.001.967.015 1.379.06q.308.035.51.083.098.024.153.044l.048.02a1 1 0 1 1-1 1.732zM8 9a1 1 0 1 1 0-2 1 1 0 0 1 0 2"/></svg>`;

export const PALETTE_SETS = {
  1: [
    {
      key: 'forest', label: 'Forest',
      color: '#22c55e', glow: 'rgba(34,197,94,0.4)',
      theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226', text: '#ecfdf4', textMuted: '#5ea87a', accent: '#22c55e', errorBg: '#2a1006', errorText: '#fca5a5' },
      complements: ['#84cc16','#bef264','#a3e635','#fbbf24','#34d399','#4ade80','#86efac'],
    },
    {
      key: 'ocean', label: 'Ocean',
      color: '#3b82f6', glow: 'rgba(59,130,246,0.4)',
      theme: { bg: '#05101e', surface: '#0b1e38', surface2: '#102c52', text: '#eef4ff', textMuted: '#5f9acf', accent: '#3b82f6', errorBg: '#240814', errorText: '#fca5a5' },
      complements: ['#06b6d4','#22d3ee','#38bdf8','#7dd3fc','#0ea5e9','#60a5fa','#a5f3fc'],
    },
    {
      key: 'iris', label: 'Iris',
      color: '#818cf8', glow: 'rgba(129,140,248,0.4)',
      theme: { bg: '#0c0c1e', surface: '#141432', surface2: '#1d1d47', text: '#eeeeff', textMuted: '#8080c0', accent: '#818cf8', errorBg: '#1e0818', errorText: '#fca5a5' },
      complements: ['#8b5cf6','#a78bfa','#c4b5fd','#ec4899','#6366f1','#e879f9','#f472b6'],
    },
    {
      key: 'ember', label: 'Ember',
      color: '#f97316', glow: 'rgba(249,115,22,0.4)',
      theme: { bg: '#180a02', surface: '#2b1505', surface2: '#3f1f08', text: '#fff1e8', textMuted: '#b06a30', accent: '#f97316', errorBg: '#280000', errorText: '#fca5a5' },
      complements: ['#fbbf24','#f59e0b','#ef4444','#fb923c','#fcd34d','#dc2626','#d97706'],
    },
    {
      key: 'coral', label: 'Coral',
      color: '#f43f5e', glow: 'rgba(244,63,94,0.4)',
      theme: { bg: '#180507', surface: '#2b0a11', surface2: '#3f0e1a', text: '#ffe8ec', textMuted: '#a8406a', accent: '#f43f5e', errorBg: '#0d0028', errorText: '#d4a0ff' },
      complements: ['#fb7185','#fda4af','#ec4899','#f472b6','#e11d48','#ff6b9d','#fce7f3'],
    },
    {
      key: 'sky', label: 'Sky',
      color: '#06b6d4', glow: 'rgba(6,182,212,0.4)',
      theme: { bg: '#030f18', surface: '#071e30', surface2: '#0b2d47', text: '#e8fbff', textMuted: '#3a9ab8', accent: '#06b6d4', errorBg: '#280000', errorText: '#fca5a5' },
      complements: ['#0ea5e9','#38bdf8','#7dd3fc','#10b981','#34d399','#3b82f6','#a5f3fc'],
    },
    {
      key: 'gold', label: 'Gold',
      color: '#eab308', glow: 'rgba(234,179,8,0.4)',
      theme: { bg: '#120d00', surface: '#221800', surface2: '#332400', text: '#fffbea', textMuted: '#9a7010', accent: '#eab308', errorBg: '#00050f', errorText: '#93c5fd' },
      complements: ['#f59e0b','#fb923c','#fbbf24','#fde68a','#f97316','#d97706','#fcd34d'],
    },
    {
      key: 'mint', label: 'Mint',
      color: '#10b981', glow: 'rgba(16,185,129,0.4)',
      theme: { bg: '#031210', surface: '#07221e', surface2: '#0b332c', text: '#e8fff9', textMuted: '#308870', accent: '#10b981', errorBg: '#280000', errorText: '#fca5a5' },
      complements: ['#06b6d4','#14b8a6','#2dd4bf','#22c55e','#34d399','#6ee7b7','#67e8f9'],
    },
  ],
  2: [
    {
      key: 'volt', label: 'Volt',
      color: '#aaff00', glow: 'rgba(170,255,0,0.4)',
      theme: { bg: '#0e1700', surface: '#192500', surface2: '#243600', text: '#f4ffe6', textMuted: '#88cc33', accent: '#aaff00', errorBg: '#0d0028', errorText: '#d4a0ff' },
      complements: ['#6633ff','#00ccee','#ff00aa','#1155ff','#bb00ff','#44ff00','#ffcc00'],
    },
    {
      key: 'plasma', label: 'Plasma',
      color: '#ff1aad', glow: 'rgba(255,26,173,0.4)',
      theme: { bg: '#180012', surface: '#260020', surface2: '#38002e', text: '#ffe8f8', textMuted: '#cc44aa', accent: '#ff1aad', errorBg: '#001a28', errorText: '#67e8f9' },
      complements: ['#22ff66','#aaff00','#00ccee','#44ff00','#00ffaa','#ff2244','#bb00ff'],
    },
    {
      key: 'arc', label: 'Arc',
      color: '#0055ff', glow: 'rgba(0,85,255,0.4)',
      theme: { bg: '#00050f', surface: '#000a1e', surface2: '#00102d', text: '#e8f0ff', textMuted: '#4488ee', accent: '#0055ff', errorBg: '#180500', errorText: '#fca5a5' },
      complements: ['#ff8800','#ff2244','#aaff00','#ff3300','#ffdd00','#7700ff','#00ddcc'],
    },
    {
      key: 'venom', label: 'Venom',
      color: '#00ff66', glow: 'rgba(0,255,102,0.4)',
      theme: { bg: '#001008', surface: '#001c10', surface2: '#002a18', text: '#e8fff2', textMuted: '#33aa66', accent: '#00ff66', errorBg: '#0f0028', errorText: '#c4b5fd' },
      complements: ['#ff1aaa','#7733ff','#ff4400','#9900ff','#ff1133','#00ffdd','#77ff00'],
    },
    {
      key: 'inferno', label: 'Inferno',
      color: '#ff3300', glow: 'rgba(255,51,0,0.4)',
      theme: { bg: '#140400', surface: '#220700', surface2: '#320c00', text: '#fff0eb', textMuted: '#cc4422', accent: '#ff3300', errorBg: '#001a28', errorText: '#67e8f9' },
      complements: ['#00ccdd','#33ee00','#0044ff','#00ddaa','#0055ff','#ffaa00','#ff0044'],
    },
    {
      key: 'aurora', label: 'Aurora',
      color: '#00e5ff', glow: 'rgba(0,229,255,0.4)',
      theme: { bg: '#00080f', surface: '#000f1a', surface2: '#001828', text: '#e8fcff', textMuted: '#22aacc', accent: '#00e5ff', errorBg: '#280000', errorText: '#fca5a5' },
      complements: ['#ff3300','#ff11bb','#eeff00','#ff2266','#ff8800','#0055ff','#00ff88'],
    },
    {
      key: 'solar', label: 'Solar',
      color: '#ffdd00', glow: 'rgba(255,221,0,0.4)',
      theme: { bg: '#0f0c00', surface: '#1e1700', surface2: '#2d2300', text: '#fffde8', textMuted: '#ccaa00', accent: '#ffdd00', errorBg: '#00050f', errorText: '#93c5fd' },
      complements: ['#0044ff','#00ffcc','#aa00ff','#00aaff','#5500ff','#bbff00','#ff4400'],
    },
    {
      key: 'ultraviolet', label: 'Ultraviolet',
      color: '#8800ff', glow: 'rgba(136,0,255,0.4)',
      theme: { bg: '#070013', surface: '#0e0022', surface2: '#160033', text: '#f0e8ff', textMuted: '#9944dd', accent: '#8800ff', errorBg: '#0a1a00', errorText: '#a3e635' },
      complements: ['#bbff00','#ff7700','#00ff44','#ffee00','#00ee66','#ff00cc','#0055ff'],
    },
  ],
};

export function getPaletteByKey(key) {
  for (const set of [PALETTE_SETS[1], PALETTE_SETS[2]]) {
    const found = set.find(p => p.key === key);
    if (found) return found;
  }
  return null; // callers that need a non-null default must handle this
}

export function getGlowForColor(hex) {
  for (const set of [PALETTE_SETS[1], PALETTE_SETS[2]]) {
    const p = set.find(p => p.color === hex);
    if (p) return p.glow;
  }
  return PALETTE_SETS[1][0].glow; // forest fallback
}

// Paint a peer's presence dot from their status color. Shared by the Direct list
// (following.js) and the group roster (groupContext.js) — the own dot (me.js) is
// styled via the global --my-status/--my-glow CSS vars instead, a separate path.
// Available + color + palettes → background + border + glow; available + color
// without palettes → background only; otherwise cleared.
export function paintStatusDot(dot, { color, available, palettesEnabled = true }) {
  if (!dot) return;
  dot.classList.toggle('available', available);
  if (available && color && palettesEnabled) {
    const safe = safeCssColor(color);
    dot.style.background = safe;
    dot.style.borderColor = safe;
    dot.style.boxShadow = `0 0 10px ${safeCssColor(getGlowForColor(color))}`;
  } else if (available && color) {
    dot.style.background = safeCssColor(color);
    dot.style.borderColor = '';
    dot.style.boxShadow = '';
  } else {
    dot.style.background = '';
    dot.style.borderColor = '';
    dot.style.boxShadow = '';
  }
}

export function applyPaletteVars(key) {
  const p = getPaletteByKey(key) || PALETTE_SETS[1][0]; // forest fallback
  document.documentElement.style.setProperty('--my-status', p.color);
  document.documentElement.style.setProperty('--my-glow', p.glow);
}

export function applyThemeVars(theme) {
  const r = document.documentElement;
  r.style.setProperty('--bg',         theme.bg);
  r.style.setProperty('--surface',    theme.surface);
  r.style.setProperty('--surface2',   theme.surface2);
  r.style.setProperty('--text',       theme.text);
  r.style.setProperty('--text-muted', theme.textMuted);
  r.style.setProperty('--accent',     theme.accent);
  r.style.setProperty('--error-bg',   theme.errorBg);
  r.style.setProperty('--error-text', theme.errorText);
  try { localStorage.setItem('statusapp_theme', JSON.stringify(theme)); } catch {}
}

export function resetThemeVars() {
  try { localStorage.removeItem('statusapp_theme'); } catch {}
  const r = document.documentElement;
  r.style.setProperty('--bg',         '#0f172a');
  r.style.setProperty('--surface',    '#1e293b');
  r.style.setProperty('--surface2',   '#334155');
  r.style.setProperty('--text',       '#f1f5f9');
  r.style.setProperty('--text-muted', '#94a3b8');
  r.style.setProperty('--accent',     '#6366f1');
  r.style.setProperty('--error-bg',   '#7f1d1d');
  r.style.setProperty('--error-text', '#fca5a5');
}

export function enterPaletteMode(key, userId) {
  _paletteEnterAt = Date.now();
  if (!isHintSeen('theme')) {
    markHintSeen('theme');
  }
  const state = getPaletteState();
  state.sets[String(state.activeSet)].activePaletteKey = key;
  setPaletteState(state);
  const palette = getPaletteByKey(key) || PALETTE_SETS[1][0];
  applyThemeVars(palette.theme);
  setPaletteKey(userId, key).catch(() => {});
  document.dispatchEvent(new Event('my-combo-changed'));
  renderSwatchRow(userId);
}

export function exitPaletteMode(userId) {
  const state = getPaletteState();
  state.sets[String(state.activeSet)].activePaletteKey = null;
  setPaletteState(state);
  resetThemeVars();
  setPaletteKey(userId, null).catch(() => {});
  document.dispatchEvent(new Event('my-combo-changed'));
  renderSwatchRow(userId);
}

// ─── Shared swatch-row building blocks ───────────────────────────────────────
// The Direct (#swatch-row) and group (#group-swatch-row) pickers build the same
// DOM structure; only where state lives and what a tap writes differ. These
// helpers own the structural pieces that historically drifted between the two
// (the set-toggle button, the per-swatch element, the theme-hint, the key-spin)
// so a future change can't silently desync one renderer from the other.
// (Mode-determination and tap behavior stay in each renderer — they're
// legitimately different, not duplication.)

// Set-toggle button (bolt = Set 1 / tree = Set 2) with its first-use pulse. The
// pulse clears once on first tap; the caller supplies the toggle action.
export function buildSetToggleButton(activeSet, onToggle) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'set-toggle-btn';
  btn.innerHTML = activeSet === 1 ? ICON_BOLT : ICON_TREE;
  const hintName = activeSet === 1 ? 'bolt' : 'flower';
  if (shouldShowSetTogglePulse(activeSet)) {
    btn.classList.add('first-use-pulse');
    btn.addEventListener('click', () => {
      btn.classList.remove('first-use-pulse');
      markHintSeen(hintName);
    }, { once: true });
  }
  btn.addEventListener('click', () => onToggle(activeSet === 1 ? 2 : 1));
  return btn;
}

// A single swatch <button>. `datasetAttr` is 'key' (Direct) or 'paletteKey'
// (group); `extraClass` adds 'group-swatch'; `keySwatch` adds the key-swatch
// class for palette mode.
export function buildSwatch({ color, key, datasetAttr, extraClass = '', selected = false, keySwatch = false, onTap }) {
  const swatch = document.createElement('button');
  swatch.type = 'button';
  swatch.className = 'swatch' + (keySwatch ? ' key-swatch' : '') + (extraClass ? ' ' + extraClass : '');
  swatch.style.background = color;
  if (key != null && datasetAttr) swatch.dataset[datasetAttr] = key;
  if (selected) swatch.classList.add('selected');
  swatch.addEventListener('click', onTap);
  return swatch;
}

// Theme hint: pulsing dotted ring on the selected swatch when the gate is open
// (seen both set icons + gone available with a custom color + never entered
// palette mode). Centralized so neither renderer can skip it (the original
// divergence bug — see hints.js).
export function applyThemeHintIfDue(row) {
  if (shouldShowThemeHint()) {
    const selectedSwatch = row.querySelector('.swatch.selected');
    if (selectedSwatch) selectedSwatch.classList.add('theme-hint');
  }
}

// Re-apply the key-spin animation to a freshly-built key swatch within the 5s
// window after entering palette mode (survives the userPrefs echo re-render via
// --key-spin-delay). Returns false once the window has elapsed so the caller can
// drop its enter timestamp.
export function applyKeySpin(swatch, enterAt) {
  if (enterAt == null) return false;
  const elapsed = Date.now() - enterAt;
  if (elapsed >= KEY_SPIN_MS) return false;
  swatch.classList.add('key-spin');
  // Resume the CSS animation mid-flight on re-renders triggered by the userPrefs
  // echo; without this the new element starts at 0deg.
  if (elapsed > 0) swatch.style.setProperty('--key-spin-delay', `-${elapsed}ms`);
  return true;
}

function renderSwatchRow(userId) {
  const row = document.getElementById('swatch-row');
  row.innerHTML = '';
  const state = getPaletteState();
  const setNum = state.activeSet;
  const setKey = String(setNum);
  const savedKey = state.sets[setKey].selectedKey;
  const activePaletteKey = state.sets[setKey].activePaletteKey;

  const btn = buildSetToggleButton(setNum, (nextSet) => switchSet(nextSet, userId));
  row.appendChild(btn);

  const keyIdx = activePaletteKey
    ? PALETTE_SETS[setNum].findIndex(p => p.key === activePaletteKey)
    : -1;

  if (!activePaletteKey || keyIdx < 0) {
    // Base mode (or activePaletteKey from the other set — clear it and render base mode)
    if (activePaletteKey && keyIdx < 0) {
      const cleanState = getPaletteState();
      cleanState.sets[setKey].activePaletteKey = null;
      setPaletteState(cleanState);
    }
    PALETTE_SETS[setNum].forEach(p => {
      row.appendChild(buildSwatch({
        color: p.color, key: p.key, datasetAttr: 'key',
        selected: p.key === savedKey,
        onTap: () => tapSwatch(p.key, userId),
      }));
    });
    applyThemeHintIfDue(row);
    // Dot go-hint: pulse status dot if current set is on a non-default swatch
    const dot = document.getElementById('my-dot');
    if (dot) {
      const defaultKey = setNum === 1 ? 'forest' : 'volt';
      if (shouldShowDotGoHint({
        isNonDefault: savedKey !== defaultKey,
        dotAvailable: dot.classList.contains('available'),
      })) {
        dot.classList.add('dot-go-hint');
        // Pause set-switch pulse while dot-go is active
        if (btn) btn.classList.remove('first-use-pulse');
      } else {
        dot.classList.remove('dot-go-hint');
      }
    }
    // Sequential hint animation if user hasn't changed colors yet
    startSwatchHints(row, state);
  } else {
    // Palette mode: Key Swatch at index K, complement swatches at other positions
    const keyPalette = getPaletteByKey(activePaletteKey);
    const complements = keyPalette.complements;
    const activeColor = state.sets[setKey].selectedColor;
    let ci = 0;

    for (let i = 0; i < 8; i++) {
      if (i === keyIdx) {
        // Direct selects the key swatch when no color is active yet, or when the
        // active color matches the key's base color.
        const keySelected = !activeColor || activeColor === keyPalette.color;
        const swatch = buildSwatch({
          color: keyPalette.color, keySwatch: true, selected: keySelected,
          onTap: () => {
            if (swatch.classList.contains('selected')) {
              // Tap KS while it is the active status color → exit palette mode
              exitPaletteMode(userId);
            } else {
              // Tap KS while a different swatch is active → KS becomes the status color
              row.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
              swatch.classList.add('selected');
              const st = getPaletteState();
              st.sets[String(st.activeSet)].selectedKey = activePaletteKey;
              setPaletteState(st);
              applyPaletteVars(activePaletteKey);
              setStatusColor(userId, keyPalette.color).catch(() => {});
              const st2 = getPaletteState();
              st2.sets[String(st2.activeSet)].selectedColor = keyPalette.color;
              setPaletteState(st2);
              document.dispatchEvent(new Event('my-combo-changed'));
              document.dispatchEvent(new CustomEvent('palette-state-changed'));
            }
          },
        });
        if (!applyKeySpin(swatch, _paletteEnterAt)) _paletteEnterAt = null;
        row.appendChild(swatch);
      } else {
        const color = complements[ci++];
        const swatch = buildSwatch({
          color, selected: activeColor === color,
          onTap: () => {
            // Change status color; keep palette mode and theme active
            row.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');
            document.documentElement.style.setProperty('--my-status', color);
            setStatusColor(userId, color).catch(() => {});
            const st = getPaletteState();
            st.sets[String(st.activeSet)].selectedColor = color;
            setPaletteState(st);
            document.dispatchEvent(new Event('my-combo-changed'));
            document.dispatchEvent(new CustomEvent('palette-state-changed'));
          },
        });
        row.appendChild(swatch);
      }
    }
  }
  document.dispatchEvent(new CustomEvent('palette-state-changed'));
}

export function startSwatchHints(row, state) {
  stopSwatchHintsFor(row);
  if (!shouldShowSwatchWave(state)) return;
  const swatches = Array.from(row.querySelectorAll('.swatch:not(.selected)'));
  if (swatches.length === 0) return;
  swatches.forEach(s => s.classList.add('hint-wave'));
  let head = 0;
  // Opacity curve based on distance from head: peak at 0, fading at ±1, ±2
  const opacities = [0.5, 0.3, 0.1, 0];
  function updateWave() {
    swatches.forEach((s, i) => {
      // Circular distance
      const dist = Math.min(
        Math.abs(i - head),
        swatches.length - Math.abs(i - head)
      );
      const opacity = dist < opacities.length ? opacities[dist] : 0;
      s.style.boxShadow = opacity > 0
        ? `0 0 0 3px rgba(255, 255, 255, ${opacity})`
        : 'none';
    });
    head = (head + 1) % swatches.length;
    _hintTimersByRow.set(row, setTimeout(updateWave, 250));
  }
  updateWave();
}

export function restoreSetSwitchPulse() {
  const row = document.getElementById('swatch-row');
  if (!row) return;
  const btn = row.querySelector('.set-toggle-btn');
  if (!btn) return;
  // Don't restore if dot-go-hint is active
  const dot = document.getElementById('my-dot');
  if (dot && dot.classList.contains('dot-go-hint')) return;
  const state = getPaletteState();
  if (shouldShowSetTogglePulse(state.activeSet) && !btn.classList.contains('first-use-pulse')) {
    btn.classList.add('first-use-pulse');
  }
}

export function applyThemeHint() {
  if (!shouldShowThemeHint()) return;
  const row = document.getElementById('swatch-row');
  if (!row) return;
  const selected = row.querySelector('.swatch.selected');
  if (selected && !selected.classList.contains('theme-hint')) {
    selected.classList.add('theme-hint');
  }
}

function stopSwatchHintsFor(row) {
  const t = _hintTimersByRow.get(row);
  if (t) clearTimeout(t);
  _hintTimersByRow.delete(row);
  row.querySelectorAll('.swatch.hint-wave').forEach(s => {
    s.classList.remove('hint-wave');
    s.style.boxShadow = '';
  });
}

function stopSwatchHints() {
  for (const row of [..._hintTimersByRow.keys()]) stopSwatchHintsFor(row);
  // Legacy safety net: also strip the class from any row we never registered
  // (e.g. rows that called the old global startSwatchHints before this fix).
  document.querySelectorAll('.swatch.hint-wave').forEach(s => {
    s.classList.remove('hint-wave');
    s.style.boxShadow = '';
  });
}

export function tapSwatch(key, userId) {
  stopSwatchHints();
  const state = getPaletteState();
  const setKey = String(state.activeSet);
  const currentlySelected = state.sets[setKey].selectedKey;

  if (key === currentlySelected) {
    // Second tap on already-selected swatch: enter palette mode
    enterPaletteMode(key, userId);
    return;
  }

  // First tap on unselected swatch: status color change only
  state.sets[setKey].selectedKey = key;
  const palette = getPaletteByKey(key);
  state.sets[setKey].selectedColor = palette.color;
  setPaletteState(state);
  setStatusColor(userId, palette.color).catch(() => {});
  document.dispatchEvent(new Event('my-combo-changed'));
  applyPaletteVars(key);
  const row = document.getElementById('swatch-row');
  row.querySelectorAll('.swatch').forEach(s => {
    s.classList.remove('selected');
    s.classList.remove('theme-hint');
  });
  const target = row.querySelector(`[data-key="${key}"]`);
  if (target) {
    target.classList.add('selected');
    // Theme hint: show pulsing dotted ring if user has seen bolt/flower,
    // selected a non-default color, and hasn't discovered themes yet
    if (shouldShowThemeHint()) {
      target.classList.add('theme-hint');
    }
  }
  // Coordinate hints based on whether this is a default or non-default swatch
  const defaultKey = state.activeSet === 1 ? 'forest' : 'volt';
  const isNonDefault = key !== defaultKey;
  const dot = document.getElementById('my-dot');
  const toggleBtn = row.querySelector('.set-toggle-btn');

  if (isNonDefault) {
    // Non-default selected: start dot hint, pause set-switch hint while dot-go is active
    if (dot && shouldShowDotGoHint({ isNonDefault: true, dotAvailable: dot.classList.contains('available') })) {
      dot.classList.add('dot-go-hint');
      if (toggleBtn) toggleBtn.classList.remove('first-use-pulse');
    }
  } else {
    // Default selected: stop dot hint, resume set-switch hint if not yet cleared,
    // and restart swatch wave
    if (dot) dot.classList.remove('dot-go-hint');
    if (toggleBtn && shouldShowSetTogglePulse(state.activeSet)) {
      toggleBtn.classList.add('first-use-pulse');
    }
    startSwatchHints(row, state);
  }

  document.dispatchEvent(new CustomEvent('palette-state-changed'));
}

export function initSwatches(userId) {
  renderSwatchRow(userId);
  // Re-render whenever userPrefs sync echoes a sibling-device pick.
  document.addEventListener('palette-state-synced', () => renderSwatchRow(userId));
}

// Reconcile local paletteState with what the server has. Used by the
// own-status (presence) subscription in app.js so a status color or palette change made
// on another device updates this device's picker selection as well.
//
// Resolution:
// - paletteKey set (palette mode): paletteKey determines activeSet and
//   selectedKey. selectedColor = statusColor (may be a complement, not a
//   base color).
// - paletteKey null (base mode): statusColor determines activeSet and
//   selectedKey via reverse lookup in PALETTE_SETS.
// - statusColor doesn't correspond to any known palette in base mode:
//   leave local state alone (could be legacy / future / corrupt data).
export function syncPaletteStateFromServer(userId, statusColor, paletteKey) {
  if (!statusColor) return;

  let foundSet = null;
  let foundKey = null;

  if (paletteKey) {
    for (const setNum of [1, 2]) {
      if (PALETTE_SETS[setNum].some(p => p.key === paletteKey)) {
        foundSet = setNum;
        foundKey = paletteKey;
        break;
      }
    }
  } else {
    for (const setNum of [1, 2]) {
      const palette = PALETTE_SETS[setNum].find(p => p.color === statusColor);
      if (palette) {
        foundSet = setNum;
        foundKey = palette.key;
        break;
      }
    }
  }

  if (foundSet === null) return;

  const state = getPaletteState();
  const setKey = String(foundSet);
  const incomingActivePaletteKey = paletteKey ?? null;
  const currentActivePaletteKey = state.sets[setKey].activePaletteKey ?? null;

  if (state.activeSet === foundSet
      && state.sets[setKey].selectedKey === foundKey
      && state.sets[setKey].selectedColor === statusColor
      && currentActivePaletteKey === incomingActivePaletteKey) {
    return;
  }

  state.activeSet = foundSet;
  state.sets[setKey].selectedKey = foundKey;
  state.sets[setKey].selectedColor = statusColor;
  state.sets[setKey].activePaletteKey = incomingActivePaletteKey;
  setPaletteState(state);
  renderSwatchRow(userId);
}

export function switchSet(toSet, userId) {
  const state = getPaletteState();
  state.activeSet = toSet;
  setPaletteState(state);

  const targetSetKey = String(toSet);
  const selectedKey = state.sets[targetSetKey].selectedKey;
  const activePaletteKey = state.sets[targetSetKey].activePaletteKey;
  const palette = getPaletteByKey(selectedKey) || PALETTE_SETS[1][0];

  const selectedColor = state.sets[targetSetKey].selectedColor || palette.color;
  document.documentElement.style.setProperty('--my-status', selectedColor);
  document.documentElement.style.setProperty('--my-glow', getGlowForColor(selectedColor));
  setStatusColor(userId, selectedColor).catch(() => {});
  document.dispatchEvent(new Event('my-combo-changed'));

  if (activePaletteKey) {
    applyThemeVars(getPaletteByKey(activePaletteKey).theme);
    setPaletteKey(userId, activePaletteKey).catch(() => {});
  } else {
    resetThemeVars();
    setPaletteKey(userId, null).catch(() => {});
  }

  renderSwatchRow(userId);
}
