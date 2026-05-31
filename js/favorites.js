// js/favorites.js
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED } from './features.js';
import { getPaletteState, setPaletteState } from './store.js';
import { getPaletteByKey, switchSet, enterPaletteMode, exitPaletteMode, getGlowForColor, PALETTE_SETS } from './palettes.js';
import { setStatusColor } from './db.js';
import { getFavorites, setFavorites, markHintSeen, isFavoritesCollapsed, setFavoritesCollapsed } from './prefs.js';
import { safeCssColor } from './utils.js';
import { getCurrentContext, onContextChange } from './groupNav.js';
import { applyAdoptedComboInGroup } from './groupContext.js';

const MAX_FAVORITES = 8;
const DEFAULT_STATUS_COLOR = '#22c55e';  // default green (forest primary)
const DEFAULT_SURFACE  = '#1e293b';      // default slate card bg (--surface)
const DEFAULT_SURFACE2 = '#334155';      // default slate pill bg (--surface2)
// Favorites-strip collapsed/expanded state now lives in prefs.js
// (statusapp_favorites_collapsed in localStorage + userPrefs/{uid}/
// favoritesCollapsed in Firebase).

let _myUserId = null;
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

function pillsLookSame(a, b) {
  return a.statusColor === b.statusColor && a.surface2 === b.surface2;
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
  return getFavorites();
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

// Drop duplicates from a combo array, preserving the first occurrence of
// each (statusColor, surface2) pair. Used by saveCombo to clean up legacy
// data that pre-dates the dedupe logic, and by prefs.syncFromServer for
// the same reason on server-sourced arrays.
export function dedupeCombos(arr) {
  const seen = [];
  const out = [];
  for (const c of arr || []) {
    if (!c) continue;
    if (seen.some(s => pillsLookSame(s, c))) continue;
    seen.push(c);
    out.push(c);
  }
  return out;
}

// Single writer. Pushes a caller-supplied combo to the head of the favorites
// strip, with whole-array dedupe and cap-at-8. Used by going-active (Direct +
// group) and by long-press adoption (Direct + group).
export function saveCombo(combo) {
  // eslint-disable-next-line no-console
  console.log('[FAV] saveCombo entry — combo sc=', combo?.statusColor, 's2=', combo?.surface2);
  // eslint-disable-next-line no-console
  console.trace('[FAV] saveCombo call site');
  if (!PALETTES_ENABLED || !PALETTE_INTERACTIONS_ENABLED) return;
  if (!combo) return;
  const history = getFavorites();
  // eslint-disable-next-line no-console
  console.log('[FAV] saveCombo before write — history', history.length, 'colors:',
    history.map(c => c?.statusColor).join(','));
  // Fast path: incoming matches the existing head AND history has no
  // deeper duplicates → no write needed.
  const headMatches = history.length && pillsLookSame(history[0], combo);
  const cleanHistory = dedupeCombos(history);
  if (headMatches && cleanHistory.length === history.length) {
    // eslint-disable-next-line no-console
    console.log('[FAV] saveCombo fast-path skip — head matches, history is clean');
    return;
  }
  // Otherwise prepend the incoming combo (or its already-deduped equivalent
  // from cleanHistory's head) and rewrite the array cleanly.
  const withoutMatch = cleanHistory.filter(h => !pillsLookSame(h, combo));
  writeFavorites([combo, ...withoutMatch].slice(0, MAX_FAVORITES));
  renderStrip();
}

export function initFavoritesStrip(myUserId) {
  _myUserId = myUserId;
  // Re-render on context change so the now-active context's strip is
  // populated and any peek animation re-attaches to the visible container.
  // Also tears down any in-flight peek belonging to the previous context
  // (renderCollapsed's MutationObserver cleans up its own listeners).
  onContextChange(() => {
    document.querySelectorAll('.fav-peek-wrapper').forEach((el) => {
      el.style.transition = '';
      el.style.maxHeight = '0';
      el.style.opacity = '0';
    });
    renderStrip();
  });
  renderStrip();
}

// ─── Rendering ───────────────────────────────────────────────────────────────

// The strip lives in two DOM locations — `#favorites-strip` inside
// #main-ui-direct and `#group-favorites-strip` inside #group-context-root.
// Both render the same content; only the one in the active context is
// visible (the other's parent has the .hidden class). Pills installed in
// each container get their own click handlers; the handler dispatches by
// whichever context is active at click time.
const STRIP_CONTAINERS = [
  { id: 'favorites-strip',       homeContext: 'direct' },
  { id: 'group-favorites-strip', homeContext: 'group'  },
];

function renderStrip() {
  const history = getFavorites();
  for (const { id, homeContext } of STRIP_CONTAINERS) {
    const container = document.getElementById(id);
    if (!container) continue;
    container.style.display = 'block';
    if (history.length === 0 || !localStorage.getItem('statusapp_seen_theme')) {
      const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0f172a';
      container.innerHTML =
        `<div class="fav-collapsed"><div class="fav-collapsed-line" style="background:${bgColor}"></div></div>`;
      continue;
    }
    const isFtu = !localStorage.getItem('statusapp_seen_strip_peek_done');
    const collapsed = isFtu || isFavoritesCollapsed();
    if (collapsed) {
      renderCollapsed(container, history, homeContext);
    } else {
      renderExpanded(container, history);
    }
  }
}

function renderCollapsed(container, history, homeContext = 'direct') {
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

  // Peek hint: repeats every 6s until user opens the strip. Only attach
  // the peek to the container whose home context matches the active
  // context — otherwise the body-level peek wrapper would float over
  // the wrong view.
  if (!localStorage.getItem('statusapp_seen_strip_peek_done') &&
      getCurrentContext().context === homeContext) {
    peekStrip(container, history, homeContext);
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

  // History pill click handlers
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



function peekStrip(container, history, homeContext = 'direct') {
  const historyPills = history.map((c, i) => renderPill(c, 'history', 'history', i)).join('');

  // Build peek strip with fixed positioning — no layout impact
  const strip = document.createElement('div');
  strip.className = 'fav-strip';
  strip.style.cssText = 'pointer-events:none; border-bottom:none; margin:0;';
  strip.innerHTML = historyPills;

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
    // Suppress the hint when the active context doesn't match this
    // peek's home context — the peek wrapper is body-level so it'd
    // otherwise float over the wrong view. Force-collapse and
    // reschedule; the next tick fires normally when context matches.
    if (getCurrentContext().context !== homeContext) {
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

// ─── Interaction handlers ────────────────────────────────────────────────────

function handleHistoryTap(idx) {
  const combo = getFavorites()[idx];
  if (!combo) return;

  // Dispatch by active context. In group context, the equivalent of
  // "restore the picker to this combo" is "apply this combo to the
  // group's statusOverride + per-group paletteState" — the same code
  // path as long-press group adoption from a roster member, sourced
  // from the pill instead. In Direct, restore the live picker state.
  if (getCurrentContext().context === 'group') {
    applyAdoptedComboInGroup(combo.statusColor, combo.paletteKey ?? null);
    return;
  }

  // Direct: restore picker state to reflect this combo.
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
  // eslint-disable-next-line no-console
  console.log('[MS] favorites.handleHistoryTap →', combo.statusColor);
  document.documentElement.style.setProperty('--my-status', combo.statusColor);
  document.documentElement.style.setProperty('--my-glow', getGlowForColor(combo.statusColor));

  // No history mutation.
}
