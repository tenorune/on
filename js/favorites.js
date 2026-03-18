// js/favorites.js
import { PALETTES_ENABLED } from './features.js';
import { getPaletteState, setPaletteState, getFavorites, setFavorites } from './store.js';
import { getPaletteByKey, switchSet, enterPaletteMode, exitPaletteMode, getGlowForColor } from './palettes.js';
import { setStatusColor } from './db.js';

const MAX_HISTORY = 14;
const DEFAULT_THEME_BG = '#0f172a';
const COLLAPSED_KEY = 'statusapp_favorites_collapsed';

let _myUserId = null;

// ─── Combo building ──────────────────────────────────────────────────────────

function buildCombo() {
  const ps = getPaletteState();
  const activeSetKey = String(ps.activeSet);
  const { selectedKey, activePaletteKey } = ps.sets[activeSetKey];
  const palette = activePaletteKey ? getPaletteByKey(activePaletteKey) : null;
  const statusColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--my-status').trim();
  return {
    statusColor,
    themeBg: palette?.theme.bg ?? DEFAULT_THEME_BG,
    paletteKey: activePaletteKey,
    selectedKey,
    activeSet: ps.activeSet,
  };
}

function slotCombo(setNum) {
  const ps = getPaletteState();
  const setKey = String(setNum);
  const { selectedKey } = ps.sets[setKey];
  const statusPalette = getPaletteByKey(selectedKey);
  return {
    statusColor: statusPalette?.color ?? DEFAULT_THEME_BG,
    themeBg: DEFAULT_THEME_BG,
    paletteKey: null,
    selectedKey,
    activeSet: setNum,
  };
}

function combosMatch(a, b) {
  return a.statusColor === b.statusColor
    && a.paletteKey === b.paletteKey
    && a.selectedKey === b.selectedKey
    && a.activeSet   === b.activeSet;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function saveFavorite() {
  if (!PALETTES_ENABLED) return;
  const combo = buildCombo();
  if (combosMatch(combo, slotCombo(1)) || combosMatch(combo, slotCombo(2))) return;
  const history = getFavorites();
  setFavorites([combo, ...history].slice(0, MAX_HISTORY));
  renderStrip();
}

export function initFavoritesStrip(myUserId) {
  _myUserId = myUserId;
  renderStrip();
}

// ─── Rendering (stubs — filled in Task 4) ───────────────────────────────────

function renderStrip() {
  // filled in Task 4
}
