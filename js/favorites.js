// js/favorites.js
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED } from './features.js';
import { getPaletteState, setPaletteState } from './store.js';
import { getPaletteByKey, switchSet, enterPaletteMode, exitPaletteMode, getGlowForColor, PALETTE_SETS } from './palettes.js';
import { setStatusColor } from './db.js';
import { getFavorites, setFavorites } from './prefs.js';
import { safeCssColor } from './utils.js';
import { getCurrentContext, onContextChange } from './groupNav.js';
import { markHintSeen, isFavoritesCollapsed, setFavoritesCollapsed } from './prefs.js';

const MAX_HISTORY = 6;
const MAX_FAVORITES = 8;
const DEFAULT_STATUS_COLOR = '#22c55e';  // default green (forest primary)
const DEFAULT_SURFACE  = '#1e293b';      // default slate card bg (--surface)
const DEFAULT_SURFACE2 = '#334155';      // default slate pill bg (--surface2)
// Favorites-strip collapsed/expanded state now lives in prefs.js
// (statusapp_favorites_collapsed in localStorage + userPrefs/{uid}/
// favoritesCollapsed in Firebase).

let _myUserId = null;
let _lastCommittedCombo = null;
let _prevPillCount = 0;

// ─── Combo building ──────────────────────────────────────────────────────────

// Build a combo from a (statusColor, paletteKey) pair — used by long-press
// adoption call sites in both Direct (following.js) and group context
// (groupContext.js). Mirrors buildDirectCombo's shape so saveCombo treats
// both kinds of pushes identically.
export function buildAdoptedCombo(statusColor, paletteKey) {
  const palette = paletteKey ? getPaletteByKey(paletteKey) : null;
  return {
    statusColor: statusColor || '#22c55e',
    surface:  palette?.theme?.surface  ?? '#1e293b',
    surface2: palette?.theme?.surface2 ?? '#334155',
    paletteKey: paletteKey ?? null,
    selectedKey: paletteKey ?? 'forest',
    activeSet: paletteKey && PALETTE_SETS[2].some(p => p.key === paletteKey) ? 2 : 1,
  };
}

export function buildDirectCombo() {
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
  const statusColor = ps.sets[setKey].selectedColor || statusPalette?.color || DEFAULT_STATUS_COLOR;
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

// Persist favorites. setFavorites (prefs.js) writes both localStorage and
// userPrefs/{uid}/favorites in Firebase.
function writeFavorites(arr) {
  setFavorites(arr);
}

// Re-render the strip when a sibling device's favorites sync echoes back
// through watchUserPrefs → prefs.syncFromServer.
if (typeof document !== 'undefined') {
  document.addEventListener('favorites-synced', () => renderStrip());
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getAllCombos() {
  return [slotCombo(1), slotCombo(2), ...getFavorites()];
}

// Default fallback colors used when the user has fewer than 4 pen colors
// available. Each entry is a palette key; the resolved hex comes from
// getPaletteByKey at call time. Used in priority order: forest first.
const CANVAS_DEFAULT_KEYS = ['forest', 'iris', 'coral', 'gold'];
const CANVAS_PEN_TARGET = 4;

export function getCanvasColors() {
  const combos = getAllCombos();
  const penColors = [...new Set(combos.map(c => c.statusColor))];
  const bgColors  = [...new Set(combos.map(c => c.surface))];

  // Pad penColors up to CANVAS_PEN_TARGET (row 1 of the toolbox) with
  // default palette colors that aren't already present.
  if (penColors.length < CANVAS_PEN_TARGET) {
    for (const key of CANVAS_DEFAULT_KEYS) {
      if (penColors.length >= CANVAS_PEN_TARGET) break;
      const palette = getPaletteByKey(key);
      if (palette && !penColors.includes(palette.color)) {
        penColors.push(palette.color);
      }
    }
  }

  return { penColors, bgColors };
}

export function removeHistoryDuplicatesOfSlots() {
  if (!PALETTES_ENABLED || !PALETTE_INTERACTIONS_ENABLED) return;
  const history = getFavorites();
  const slot1 = slotCombo(1);
  const slot2 = slotCombo(2);
  const cleaned = history.filter(h => !pillsLookSame(h, slot1) && !pillsLookSame(h, slot2));
  if (cleaned.length !== history.length) {
    writeFavorites(cleaned);
    renderStrip();
  }
}

export function saveFavorite(force = false) {
  if (!PALETTES_ENABLED || !PALETTE_INTERACTIONS_ENABLED) return;
  const currentCombo = buildDirectCombo();
  if (force) {
    _lastCommittedCombo = currentCombo;
    const history = getFavorites();
    if (!history.some(h => pillsLookSame(currentCombo, h))) {
      writeFavorites([currentCombo, ...history].slice(0, MAX_HISTORY));
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
  writeFavorites([previousCombo, ...history].slice(0, MAX_HISTORY));
  renderStrip();
}

// Force-push a caller-supplied combo to the favorites history. Used by
// group-context adoption, where the relevant "previous combo" is the
// group-effective combo (not Direct's paletteState that buildCombo reads).
// Same dedupe + cap semantics as the force branch of saveFavorite.
export function saveCustomCombo(combo) {
  if (!PALETTES_ENABLED || !PALETTE_INTERACTIONS_ENABLED) return;
  if (!combo) return;
  const history = getFavorites();
  if (history.some(h => pillsLookSame(combo, h))) return;
  writeFavorites([combo, ...history].slice(0, MAX_HISTORY));
  renderStrip();
}

// Single writer for the new model. Pushes a caller-supplied combo to the
// head of the favorites strip, with head-only dedupe and cap-at-8. Used
// by going-active (Direct + group) and by long-press adoption (Direct +
// group). Replaces saveFavorite and saveCustomCombo; both will be removed
// in a follow-up cleanup task once all callers are migrated.
export function saveCombo(combo) {
  if (!PALETTES_ENABLED || !PALETTE_INTERACTIONS_ENABLED) return;
  if (!combo) return;
  const history = getFavorites();
  if (history.length && pillsLookSame(history[0], combo)) return; // head-only dedupe
  writeFavorites([combo, ...history].slice(0, MAX_FAVORITES));
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
  _lastCommittedCombo = buildDirectCombo();
  document.addEventListener('palette-state-changed', onPaletteStateChanged);
  // Snap any in-flight peek-strip animation closed the moment the user
  // moves into a group context — doPeek's gate handles subsequent ticks,
  // but a wrapper already mid-animation would otherwise float over the
  // group view for up to ~1.3s.
  onContextChange((ctx) => {
    if (ctx.context !== 'direct') {
      document.querySelectorAll('.fav-peek-wrapper').forEach((el) => {
        el.style.transition = '';
        el.style.maxHeight = '0';
        el.style.opacity = '0';
      });
    }
  });
  renderStrip();
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderStrip() {
  const container = document.getElementById('favorites-strip');
  if (!container) return;
  const history = getFavorites();
  container.style.display = 'block';
  if (history.length === 0 || !localStorage.getItem('statusapp_seen_theme')) {
    const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0f172a';
    container.innerHTML =
      `<div class="fav-collapsed"><div class="fav-collapsed-line" style="background:${bgColor}"></div></div>`;
    return;
  }
  const isFtu = !localStorage.getItem('statusapp_seen_strip_peek_done');
  const collapsed = isFtu || isFavoritesCollapsed();
  if (collapsed) {
    renderCollapsed(container, history);
  } else {
    renderExpanded(container, history);
  }
}

function renderCollapsed(container, history) {
  const allColors = history.map(c => c.statusColor);
  const n = allColors.length;
  const bg = n <= 1
    ? (allColors[0] ?? 'transparent')
    : `linear-gradient(to right,${allColors.map((c, i) => `${c} ${Math.round((i / (n - 1)) * 100)}%`).join(', ')})`;
  container.innerHTML =
    `<div class="fav-collapsed"><div class="fav-collapsed-line" style="background:${bg}"></div></div>`;
  container.querySelector('.fav-collapsed').addEventListener('click', () => {
    setFavoritesCollapsed(false);
    markHintSeen('stripPeek');
    renderStrip();
  });

  // Peek hint: repeats every 6s until user opens the strip
  if (!localStorage.getItem('statusapp_seen_strip_peek_done')) {
    peekStrip(container, history);
  }

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
      setFavoritesCollapsed(false);
      markHintSeen('stripPeek');
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
  const pills = history
    .map((c, i) => renderPill(c, 'history', 'history', i))
    .join('');
  container.innerHTML =
    `<div class="fav-strip">${pills}` +
    `<button class="fav-collapse-btn" aria-label="Collapse">▲</button></div>`;

  // Animate pill width when pill count changes
  const strip = container.querySelector('.fav-strip');
  const pillEls = container.querySelectorAll('.fav-pill');
  const pillCount = pillEls.length;
  const collapseBtn = container.querySelector('.fav-collapse-btn');
  const gap = 6; // matches CSS gap
  const padding = 24; // matches CSS padding (12px each side)
  const btnWidth = collapseBtn ? collapseBtn.offsetWidth + gap : 0;
  const availableWidth = strip.clientWidth - padding - btnWidth;
  const targetWidth = Math.floor((availableWidth - gap * (pillCount - 1)) / pillCount);

  if (_prevPillCount > 0 && pillCount > _prevPillCount) {
    const oldWidth = Math.floor((availableWidth - gap * (_prevPillCount - 1)) / _prevPillCount);
    pillEls.forEach(el => { el.style.width = oldWidth + 'px'; });
    requestAnimationFrame(() => {
      pillEls.forEach(el => { el.style.width = targetWidth + 'px'; });
    });
  } else {
    pillEls.forEach(el => { el.style.width = targetWidth + 'px'; });
  }
  _prevPillCount = pillCount;

  // History pill click handlers — no more slot-pill loop, no more
  // ps/activeSet check.
  container.querySelectorAll('.fav-pill[data-type="history"]').forEach(el => {
    el.addEventListener('click', () => handleHistoryTap(parseInt(el.dataset.index)));
  });
  container.querySelector('.fav-collapse-btn').addEventListener('click', () => {
    setFavoritesCollapsed(true);
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
      setFavoritesCollapsed(true);
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



function peekStrip(container, history) {
  const ps = getPaletteState();
  const slot1 = slotCombo(1);
  const slot2 = slotCombo(2);
  const slotPills = [
    renderPill(slot1, ps.activeSet === 1 ? 'inactive' : 'active', 'slot', 1),
    renderPill(slot2, ps.activeSet === 2 ? 'inactive' : 'active', 'slot', 2),
  ].join('');
  const historyPills = history.map((c, i) => renderPill(c, 'history', 'history', i)).join('');

  // Build peek strip with fixed positioning — no layout impact
  const strip = document.createElement('div');
  strip.className = 'fav-strip';
  strip.style.cssText = 'pointer-events:none; border-bottom:none; margin:0;';
  strip.innerHTML = slotPills + historyPills;

  const rainbowLine = container.querySelector('.fav-collapsed-line');
  const lineRect = rainbowLine ? rainbowLine.getBoundingClientRect() : container.getBoundingClientRect();

  const wrapper = document.createElement('div');
  // Class lets a context-change listener find + collapse this wrapper
  // immediately when the user navigates from Direct into a group, so a
  // peek mid-animation doesn't bleed into the group view.
  wrapper.className = 'fav-peek-wrapper';
  wrapper.style.cssText = `position:fixed; left:${lineRect.left}px; width:${lineRect.width}px; top:${lineRect.bottom}px; overflow:hidden; max-height:0; pointer-events:none; z-index:50; -webkit-mask-image:linear-gradient(to bottom, black, transparent); mask-image:linear-gradient(to bottom, black, transparent);`;
  wrapper.appendChild(strip);
  document.body.appendChild(wrapper);

  // Set pill widths
  const pillEls = strip.querySelectorAll('.fav-pill');
  const pillCount = pillEls.length;
  const gap = 6;
  const padding = 24;
  const availableWidth = wrapper.clientWidth - padding;
  const targetWidth = Math.floor((availableWidth - gap * (pillCount - 1)) / pillCount);
  pillEls.forEach(el => { el.style.width = targetWidth + 'px'; });

  // Measure full height
  wrapper.style.maxHeight = '200px';
  const fullHeight = strip.offsetHeight;
  wrapper.style.maxHeight = '0';
  const halfHeight = Math.round(fullHeight * 0.7);
  void wrapper.offsetHeight;

  const collapsedEl = container.querySelector('.fav-collapsed');

  function doPeek() {
    // Stop if strip was opened (flag cleared means user opened it)
    if (localStorage.getItem('statusapp_seen_strip_peek_done') || !wrapper.parentNode) {
      if (wrapper.parentNode) wrapper.remove();
      if (collapsedEl) collapsedEl.style.opacity = '';
      const line = collapsedEl?.querySelector('.fav-collapsed-line');
      if (line) line.style.filter = '';
      return;
    }
    // Suppress the hint while the user is in group context — the
    // favorites strip itself lives inside #main-ui-direct and is hidden,
    // but the peek wrapper is body-level so it'd otherwise float over
    // the group view. Force-collapse the wrapper and reschedule; when
    // the user navigates back to Direct, the next tick fires normally.
    if (getCurrentContext().context !== 'direct') {
      wrapper.style.transition = '';
      wrapper.style.maxHeight = '0';
      wrapper.style.opacity = '0';
      setTimeout(doPeek, 6000);
      return;
    }
    // Snap open fast + fade in strip + fade rainbow line
    wrapper.style.transition = 'max-height 0.1s ease-out, opacity 0.1s ease-out';
    wrapper.style.opacity = '0.1';
    wrapper.style.maxHeight = halfHeight + 'px';
    requestAnimationFrame(() => {
      wrapper.style.opacity = '0.45';
    });
    const lineEl = collapsedEl?.querySelector('.fav-collapsed-line');
    if (collapsedEl) {
      collapsedEl.style.transition = 'opacity 0.1s ease-out';
      collapsedEl.style.opacity = '0.3';
    }
    if (lineEl) {
      lineEl.style.transition = 'filter 0.1s ease-out';
      lineEl.style.filter = 'brightness(1.6)';
    }
    setTimeout(() => {
      // Close slowly + restore rainbow
      wrapper.style.transition = 'max-height 1s ease-in, opacity 1s ease-in';
      wrapper.style.maxHeight = '0';
      wrapper.style.opacity = '0';
      if (collapsedEl) {
        collapsedEl.style.transition = 'opacity 1s ease-in';
        collapsedEl.style.opacity = '1';
      }
      if (lineEl) {
        lineEl.style.transition = 'filter 1s ease-in';
        lineEl.style.filter = 'brightness(1)';
      }
      // Repeat after 6s
      setTimeout(doPeek, 6000);
    }, 250);
  }

  setTimeout(doPeek, 3000);
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
  const combo = getFavorites()[idx];
  if (!combo) return;

  // Restore picker state to reflect this combo.
  const state = JSON.parse(JSON.stringify(getPaletteState()));
  state.sets[String(combo.activeSet)].selectedKey = combo.selectedKey;
  state.sets[String(combo.activeSet)].selectedColor = combo.statusColor;
  setPaletteState(state);

  // Switch set + apply palette/theme.
  switchSet(combo.activeSet, _myUserId);
  if (combo.paletteKey) {
    enterPaletteMode(combo.paletteKey, _myUserId);
  } else {
    exitPaletteMode(_myUserId);
  }

  // Apply canonical status color (overrides what switchSet wrote).
  setStatusColor(_myUserId, combo.statusColor).catch(() => {});
  document.documentElement.style.setProperty('--my-status', combo.statusColor);
  document.documentElement.style.setProperty('--my-glow', getGlowForColor(combo.statusColor));

  // No history mutation, no slot swap, no _lastCommittedCombo update.
}
