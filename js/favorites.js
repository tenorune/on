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
  const ps = getPaletteState();
  if (ps.activeSet === slotNum) return;
  switchSet(slotNum, _myUserId);
  renderStrip();
}

function handleHistoryTap(idx) {
  const history = getFavorites();
  const combo = history[idx];
  if (!combo) return;

  // Snapshot old active slot BEFORE mutating state
  const oldSlot = slotCombo(getPaletteState().activeSet);

  // Step 0: restore selectedKey so switchSet highlights the right swatch
  const state = getPaletteState();
  state.sets[String(combo.activeSet)].selectedKey = combo.selectedKey;
  setPaletteState(state);

  // Step 1: switchSet (also calls setStatusColor internally — step 3 overrides)
  switchSet(combo.activeSet, _myUserId);

  // Step 2: apply or clear palette theme
  if (combo.paletteKey) {
    enterPaletteMode(combo.paletteKey, _myUserId);
  } else {
    exitPaletteMode(_myUserId);
  }

  // Step 3: apply canonical status color (overrides what switchSet wrote)
  setStatusColor(_myUserId, combo.statusColor).catch(() => {});
  document.documentElement.style.setProperty('--my-status', combo.statusColor);
  document.documentElement.style.setProperty('--my-glow', getGlowForColor(combo.statusColor));

  // Step 4: remove pill from history
  const newHistory = history.filter((_, i) => i !== idx);

  // Step 5: prepend old slot — dedup against new slot state
  const newSlot1 = slotCombo(1);
  const newSlot2 = slotCombo(2);
  const shouldPrepend = !combosMatch(oldSlot, newSlot1) && !combosMatch(oldSlot, newSlot2);
  const finalHistory = shouldPrepend
    ? [oldSlot, ...newHistory].slice(0, MAX_HISTORY)
    : newHistory;

  setFavorites(finalHistory);
  renderStrip();
}
