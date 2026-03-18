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
  const { selectedKey, activePaletteKey } = ps.sets[setKey];
  const statusPalette = getPaletteByKey(selectedKey);
  const themePalette  = activePaletteKey ? getPaletteByKey(activePaletteKey) : null;
  return {
    statusColor: statusPalette?.color ?? DEFAULT_THEME_BG,
    themeBg: themePalette?.theme.bg ?? DEFAULT_THEME_BG,
    paletteKey: activePaletteKey,
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

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderStrip() {
  const container = document.getElementById('favorites-strip');
  if (!container) return;
  const history = getFavorites();
  if (history.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';
  const collapsed = localStorage.getItem(COLLAPSED_KEY) === 'true';
  if (collapsed) {
    renderCollapsed(container, history);
  } else {
    renderExpanded(container, history);
  }
}

function renderCollapsed(container, history) {
  const slot1 = slotCombo(1);
  const slot2 = slotCombo(2);
  const allColors = [slot1.statusColor, slot2.statusColor, ...history.map(c => c.statusColor)];
  const n = allColors.length;
  // n ≥ 3 in normal flow (renderStrip guards history.length ≥ 1, so n = 2 + history.length)
  if (n <= 1) {
    container.innerHTML =
      `<div class="fav-collapsed" style="background:${allColors[0] ?? 'transparent'}"></div>`;
    container.querySelector('.fav-collapsed').addEventListener('click', () => {
      localStorage.removeItem(COLLAPSED_KEY);
      renderStrip();
    });
    return;
  }
  const stops = allColors
    .map((c, i) => `${c} ${Math.round((i / (n - 1)) * 100)}%`)
    .join(', ');
  container.innerHTML =
    `<div class="fav-collapsed" style="background:linear-gradient(to right,${stops})"></div>`;
  container.querySelector('.fav-collapsed').addEventListener('click', () => {
    localStorage.removeItem(COLLAPSED_KEY);
    renderStrip();
  });
}

function renderExpanded(container, history) {
  const ps = getPaletteState();
  const slot1 = slotCombo(1);
  const slot2 = slotCombo(2);

  const slotPills = [
    renderPill(slot1, ps.activeSet === 1 ? 'active' : 'inactive', 'slot', 1),
    renderPill(slot2, ps.activeSet === 2 ? 'active' : 'inactive', 'slot', 2),
  ].join('');
  const historyPills = history
    .map((c, i) => renderPill(c, 'history', 'history', i))
    .join('');

  container.innerHTML =
    `<div class="fav-strip">${slotPills}${historyPills}` +
    `<button class="fav-collapse-btn" aria-label="Collapse">▲</button></div>`;

  container.querySelectorAll('.fav-pill[data-type="slot"]').forEach(el => {
    el.addEventListener('click', () => handleSlotTap(parseInt(el.dataset.index)));
  });
  container.querySelectorAll('.fav-pill[data-type="history"]').forEach(el => {
    el.addEventListener('click', () => handleHistoryTap(parseInt(el.dataset.index)));
  });
  container.querySelector('.fav-collapse-btn').addEventListener('click', () => {
    localStorage.setItem(COLLAPSED_KEY, 'true');
    renderStrip();
  });
}

function safeCssColor(v) {
  if (typeof v === 'string' && (/^#[0-9a-fA-F]{3,8}$/.test(v) || /^rgb/.test(v))) return v;
  return 'transparent';
}

function renderPill(combo, state, type, index) {
  return `<div class="fav-pill fav-pill--${state}" data-type="${type}" data-index="${index}">` +
    `<div class="fav-pill-left" style="background:${safeCssColor(combo.statusColor)}"></div>` +
    `<div class="fav-pill-right" style="background:${safeCssColor(combo.themeBg)}"></div></div>`;
}

// ─── Interaction handlers (filled in Task 5) ────────────────────────────────

function handleSlotTap(slotNum) {
  // filled in Task 5
}

function handleHistoryTap(idx) {
  // filled in Task 5
}
