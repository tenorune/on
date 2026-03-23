// js/favorites.js
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED } from './features.js';
import { getPaletteState, setPaletteState, getFavorites, setFavorites } from './store.js';
import { getPaletteByKey, switchSet, enterPaletteMode, exitPaletteMode, getGlowForColor } from './palettes.js';
import { setStatusColor } from './db.js';
import { safeCssColor } from './utils.js';

const MAX_HISTORY = 6;
const DEFAULT_STATUS_COLOR = '#22c55e';  // default green (forest primary)
const DEFAULT_SURFACE  = '#1e293b';      // default slate card bg (--surface)
const DEFAULT_SURFACE2 = '#334155';      // default slate pill bg (--surface2)
const COLLAPSED_KEY = 'statusapp_favorites_collapsed';

let _myUserId = null;
let _lastCommittedCombo = null;
let _prevPillCount = 0;

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
    surface:  palette?.theme.surface  ?? DEFAULT_SURFACE,
    surface2: palette?.theme.surface2 ?? DEFAULT_SURFACE2,
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
  const isActiveSet = ps.activeSet === setNum;
  const statusColor = isActiveSet
    ? getComputedStyle(document.documentElement).getPropertyValue('--my-status').trim()
    : (ps.sets[setKey].selectedColor || statusPalette?.color || DEFAULT_STATUS_COLOR);
  return {
    statusColor,
    surface:  themePalette?.theme.surface  ?? DEFAULT_SURFACE,
    surface2: themePalette?.theme.surface2 ?? DEFAULT_SURFACE2,
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

function pillsLookSame(a, b) {
  return a.statusColor === b.statusColor && a.surface2 === b.surface2;
}

function slotVisuallyMatches(combo, setNum) {
  const s = slotCombo(setNum);
  return combo.statusColor === s.statusColor
    && combo.paletteKey   === s.paletteKey
    && combo.selectedKey  === s.selectedKey;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getAllCombos() {
  return [slotCombo(1), slotCombo(2), ...getFavorites()];
}

export function getCanvasColors() {
  const combos = getAllCombos();
  const penColors = [...new Set(combos.map(c => c.statusColor))];
  const bgColors  = [...new Set(combos.map(c => c.surface))];
  return { penColors, bgColors };
}

export function removeHistoryDuplicatesOfSlots() {
  if (!PALETTES_ENABLED || !PALETTE_INTERACTIONS_ENABLED) return;
  const history = getFavorites();
  const slot1 = slotCombo(1);
  const slot2 = slotCombo(2);
  const cleaned = history.filter(h => !pillsLookSame(h, slot1) && !pillsLookSame(h, slot2));
  if (cleaned.length !== history.length) {
    setFavorites(cleaned);
    renderStrip();
  }
}

export function saveFavorite(force = false) {
  if (!PALETTES_ENABLED || !PALETTE_INTERACTIONS_ENABLED) return;
  const currentCombo = buildCombo();
  if (force) {
    _lastCommittedCombo = currentCombo;
    const history = getFavorites();
    if (!history.some(h => pillsLookSame(currentCombo, h))) {
      setFavorites([currentCombo, ...history].slice(0, MAX_HISTORY));
      renderStrip();
    }
    return;
  }
  // Non-forced (going available): push the PREVIOUS combo to history, not the current one.
  // The current combo is already visible in a slot; what needs saving is what it replaced.
  const ps = getPaletteState();
  const activeSetKey = String(ps.activeSet);
  if (!ps.sets[activeSetKey].selectedColor) return; // no explicit color choice made
  const previousCombo = _lastCommittedCombo;
  _lastCommittedCombo = currentCombo;
  if (!previousCombo) return; // no prior committed state to push
  if (combosMatch(currentCombo, previousCombo)) return; // nothing changed
  const history = getFavorites();
  if (slotVisuallyMatches(previousCombo, 1) || slotVisuallyMatches(previousCombo, 2)) return;
  if (history.some(h => pillsLookSame(previousCombo, h))) return;
  setFavorites([previousCombo, ...history].slice(0, MAX_HISTORY));
  renderStrip();
}

function onPaletteStateChanged() {
  // When the active set changes (via Bolt/Flower toggle), update the committed
  // baseline to the new set so saveFavorite saves the correct "previous" combo.
  if (_lastCommittedCombo) {
    const ps = getPaletteState();
    if (ps.activeSet !== _lastCommittedCombo.activeSet) {
      _lastCommittedCombo = slotCombo(ps.activeSet);
    }
  }
  renderStrip();
}

export function initFavoritesStrip(myUserId) {
  _myUserId = myUserId;
  _lastCommittedCombo = buildCombo();
  document.addEventListener('palette-state-changed', onPaletteStateChanged);
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
  container.style.display = 'block';
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
  const bg = n <= 1
    ? (allColors[0] ?? 'transparent')
    : `linear-gradient(to right,${allColors.map((c, i) => `${c} ${Math.round((i / (n - 1)) * 100)}%`).join(', ')})`;
  container.innerHTML =
    `<div class="fav-collapsed"><div class="fav-collapsed-line" style="background:${bg}"></div></div>`;
  container.querySelector('.fav-collapsed').addEventListener('click', () => {
    localStorage.removeItem(COLLAPSED_KEY);
    renderStrip();
  });

  // Swipe down from strip area or gap below it to expand
  let _swipeDownStart = null;
  function onSwipeDownStart(e) {
    const touch = e.touches[0];
    const stripBottom = container.getBoundingClientRect().bottom + 44; // include margin overlap
    if (touch.clientY <= stripBottom) _swipeDownStart = touch.clientY;
  }
  function onSwipeDownEnd(e) {
    if (_swipeDownStart === null) return;
    const endY = e.changedTouches[0].clientY;
    if (endY - _swipeDownStart > 30) {
      localStorage.removeItem(COLLAPSED_KEY);
      renderStrip();
    }
    _swipeDownStart = null;
  }
  document.addEventListener('touchstart', onSwipeDownStart, { passive: true });
  document.addEventListener('touchend', onSwipeDownEnd, { passive: true });

  // Clean up listeners when strip is re-rendered
  const observer = new MutationObserver(() => {
    if (!container.querySelector('.fav-collapsed')) {
      document.removeEventListener('touchstart', onSwipeDownStart);
      document.removeEventListener('touchend', onSwipeDownEnd);
      observer.disconnect();
    }
  });
  observer.observe(container, { childList: true });
}

function renderExpanded(container, history) {
  const ps = getPaletteState();
  const slot1 = slotCombo(1);
  const slot2 = slotCombo(2);

  const slotPills = [
    renderPill(slot1, ps.activeSet === 1 ? 'inactive' : 'active', 'slot', 1),
    renderPill(slot2, ps.activeSet === 2 ? 'inactive' : 'active', 'slot', 2),
  ].join('');
  const historyPills = history
    .map((c, i) => renderPill(c, 'history', 'history', i))
    .join('');

  container.innerHTML =
    `<div class="fav-strip">${slotPills}${historyPills}` +
    `<button class="fav-collapse-btn" aria-label="Collapse">▲</button></div>`;

  // Animate pill width when pill count changes
  const strip = container.querySelector('.fav-strip');
  const pills = container.querySelectorAll('.fav-pill');
  const pillCount = pills.length;
  const collapseBtn = container.querySelector('.fav-collapse-btn');
  const gap = 6; // matches CSS gap
  const padding = 24; // matches CSS padding (12px each side)
  const btnWidth = collapseBtn ? collapseBtn.offsetWidth + gap : 0;
  const availableWidth = strip.clientWidth - padding - btnWidth;
  const targetWidth = Math.floor((availableWidth - gap * (pillCount - 1)) / pillCount);

  if (_prevPillCount > 0 && pillCount > _prevPillCount) {
    // Animate from old size to new size
    const oldWidth = Math.floor((availableWidth - gap * (_prevPillCount - 1)) / _prevPillCount);
    pills.forEach(el => { el.style.width = oldWidth + 'px'; });
    requestAnimationFrame(() => {
      pills.forEach(el => { el.style.width = targetWidth + 'px'; });
    });
  } else {
    pills.forEach(el => { el.style.width = targetWidth + 'px'; });
  }
  _prevPillCount = pillCount;

  container.querySelectorAll('.fav-pill[data-type="slot"]').forEach(el => {
    if (parseInt(el.dataset.index) !== ps.activeSet) {
      el.addEventListener('click', () => handleSlotTap(parseInt(el.dataset.index)));
    }
  });
  container.querySelectorAll('.fav-pill[data-type="history"]').forEach(el => {
    el.addEventListener('click', () => handleHistoryTap(parseInt(el.dataset.index)));
  });
  container.querySelector('.fav-collapse-btn').addEventListener('click', () => {
    localStorage.setItem(COLLAPSED_KEY, 'true');
    renderStrip();
  });

  // Swipe up from below the strip to collapse
  let _swipeTouchStart = null;
  function onSwipeTouchStart(e) {
    const touch = e.touches[0];
    const bottom = container.getBoundingClientRect().bottom;
    if (touch.clientY >= bottom) _swipeTouchStart = touch.clientY;
  }
  function onSwipeTouchEnd(e) {
    if (_swipeTouchStart === null) return;
    const endY = e.changedTouches[0].clientY;
    if (_swipeTouchStart - endY > 30) {
      localStorage.setItem(COLLAPSED_KEY, 'true');
      renderStrip();
    }
    _swipeTouchStart = null;
  }
  document.addEventListener('touchstart', onSwipeTouchStart, { passive: true });
  document.addEventListener('touchend', onSwipeTouchEnd, { passive: true });

  // Clean up listeners when strip is re-rendered
  const observer = new MutationObserver(() => {
    if (!container.querySelector('.fav-strip')) {
      document.removeEventListener('touchstart', onSwipeTouchStart);
      document.removeEventListener('touchend', onSwipeTouchEnd);
      observer.disconnect();
    }
  });
  observer.observe(container, { childList: true });
}


function renderPill(combo, state, type, index) {
  return `<div class="fav-pill fav-pill--${state}" data-type="${type}" data-index="${index}">` +
    `<div class="fav-pill-left" style="background:${safeCssColor(combo.statusColor)}"></div>` +
    `<div class="fav-pill-right" style="background:${safeCssColor(combo.surface2)}"></div></div>`;
}

// ─── Interaction handlers (filled in Task 5) ────────────────────────────────

function handleSlotTap(slotNum) {
  const ps = getPaletteState();
  if (ps.activeSet === slotNum) return;
  _lastCommittedCombo = slotCombo(slotNum); // new active slot's baseline before any edits
  switchSet(slotNum, _myUserId);
  renderStrip();
}

function handleHistoryTap(idx) {
  const history = getFavorites();
  const combo = history[idx];
  if (!combo) return;

  // Snapshot the slot being overwritten BEFORE mutating state.
  // When the pill targets a different set, the TARGET set is what changes — capture it.
  const ps = getPaletteState();
  const oldSlot = slotCombo(combo.activeSet);

  // Step 0: restore selectedKey + selectedColor so switchSet highlights the right
  // swatch and slotCombo reads the correct color when this set becomes inactive.
  const state = JSON.parse(JSON.stringify(ps));
  state.sets[String(combo.activeSet)].selectedKey = combo.selectedKey;
  state.sets[String(combo.activeSet)].selectedColor = combo.statusColor;
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
  _lastCommittedCombo = combo; // restored combo is the new baseline
  renderStrip();
}
