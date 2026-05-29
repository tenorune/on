// js/prefs.js
//
// Centralizes the localStorage cache + Firebase sync for cross-device user
// preferences. Reads stay synchronous (localStorage). Writes go through here
// so they hit both localStorage (immediate, for same-tab reads) and the
// userPrefs/{uid}/ subtree (cross-device sync). The boot path subscribes
// watchUserPrefs and forwards each tick to syncFromServer, which repopulates
// the localStorage cache from server state.
//
// Modules other than this one + store.js generally read localStorage inline.
// To make a piece of state syncable: add a getter (defaults to localStorage),
// add a setter (writes both layers), handle it in syncFromServer.

import { mergeUserPrefs } from './db.js';
import {
  getPaletteState as storeGetPaletteState,
  setPaletteState as storeSetPaletteState,
  getFavorites as storeGetFavorites,
  setFavorites as storeSetFavorites,
  getLastTimeout as storeGetLastTimeout,
  setLastTimeout as storeSetLastTimeout,
  getGroupChipMinutes as storeGetGroupChipMinutes,
  setGroupChipMinutes as storeSetGroupChipMinutes,
} from './store.js';

let _myUserId = null;

export function initPrefs(userId) {
  _myUserId = userId;
}

// ── Hints ────────────────────────────────────────────────────────────────────
// Maps short hint name → localStorage key it currently lives under. New code
// should use the short name; the localStorage key shape is preserved so any
// inline `localStorage.getItem('statusapp_seen_*')` reads scattered through
// the codebase keep working without touching them.
const HINT_KEYS = {
  bolt:        'statusapp_seen_bolt',
  flower:      'statusapp_seen_flower',
  theme:       'statusapp_seen_theme',
  stripPeek:   'statusapp_seen_strip_peek_done',
  longpress:   'statusapp_seen_longpress',
  swipe:       'statusapp_seen_swipe',
  customAvail: 'statusapp_went_avail_custom',
};

export function isHintSeen(name) {
  const key = HINT_KEYS[name];
  return key ? localStorage.getItem(key) === '1' : false;
}

export function markHintSeen(name) {
  const key = HINT_KEYS[name];
  if (!key) return;
  if (localStorage.getItem(key) === '1') return; // idempotent — skip the write
  localStorage.setItem(key, '1');
  if (_myUserId) mergeUserPrefs(_myUserId, { [`hints/${name}`]: true }).catch(() => {});
}

// ── Call counters (drive the "(swipe right to answer)" hints in
//    following.js — both gate at 4) ─────────────────────────────────────────
const MADE_CALL_KEY = 'statusapp_made_call_count';
const ANSWERED_CALL_KEY = 'statusapp_answered_call_count';

export function getMadeCallCount() {
  return parseInt(localStorage.getItem(MADE_CALL_KEY) || '0', 10);
}

export function incrementMadeCallCount() {
  const next = getMadeCallCount() + 1;
  localStorage.setItem(MADE_CALL_KEY, String(next));
  if (_myUserId) mergeUserPrefs(_myUserId, { madeCallCount: next }).catch(() => {});
}

export function getAnsweredCallCount() {
  return parseInt(localStorage.getItem(ANSWERED_CALL_KEY) || '0', 10);
}

export function incrementAnsweredCallCount() {
  const next = getAnsweredCallCount() + 1;
  localStorage.setItem(ANSWERED_CALL_KEY, String(next));
  if (_myUserId) mergeUserPrefs(_myUserId, { answeredCallCount: next }).catch(() => {});
}

// ── Favorites strip collapsed/expanded ──────────────────────────────────────
const COLLAPSED_KEY = 'statusapp_favorites_collapsed';

export function isFavoritesCollapsed() {
  return localStorage.getItem(COLLAPSED_KEY) === '1';
}

export function setFavoritesCollapsed(value) {
  const want = value ? '1' : null;
  const have = localStorage.getItem(COLLAPSED_KEY);
  if (want === have) return; // no-op write
  if (value) localStorage.setItem(COLLAPSED_KEY, '1');
  else localStorage.removeItem(COLLAPSED_KEY);
  if (_myUserId) mergeUserPrefs(_myUserId, { favoritesCollapsed: !!value }).catch(() => {});
}

// ── Palette state ───────────────────────────────────────────────────────────
// Direct: re-exports the store.js getter for read paths that don't care about
// sync. setPaletteState writes localStorage AND fires a Firebase update so the
// other device's swatch row catches up.
export function getPaletteState() {
  return storeGetPaletteState();
}

export function setPaletteState(state) {
  storeSetPaletteState(state);
  if (_myUserId) mergeUserPrefs(_myUserId, { 'paletteState/direct': state }).catch(() => {});
}

// Per-group palette state (was inline in groupContext.js). Keyed shape:
//   userPrefs/{uid}/perGroup/{groupId}/paletteState
const GROUP_PALETTE_LS = (groupId) => `statusapp_group_palette_${groupId}`;
const DEFAULT_GROUP_PALETTE_STATE = {
  activeSet: 1,
  sets: {
    '1': { selectedKey: 'forest', selectedColor: '#22c55e', activePaletteKey: null },
    '2': { selectedKey: 'volt',   selectedColor: '#aaff00', activePaletteKey: null },
  },
};

export function getGroupPaletteState(groupId) {
  try {
    const raw = localStorage.getItem(GROUP_PALETTE_LS(groupId));
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        activeSet: parsed.activeSet || DEFAULT_GROUP_PALETTE_STATE.activeSet,
        sets: {
          '1': { ...DEFAULT_GROUP_PALETTE_STATE.sets['1'], ...(parsed.sets?.['1'] || {}) },
          '2': { ...DEFAULT_GROUP_PALETTE_STATE.sets['2'], ...(parsed.sets?.['2'] || {}) },
        },
      };
    }
  } catch { /* ignore parse errors */ }
  // Return a fresh copy so callers don't mutate the default object.
  return JSON.parse(JSON.stringify(DEFAULT_GROUP_PALETTE_STATE));
}

export function setGroupPaletteState(groupId, state) {
  try {
    localStorage.setItem(GROUP_PALETTE_LS(groupId), JSON.stringify(state));
  } catch { /* ignore quota errors */ }
  if (_myUserId) {
    mergeUserPrefs(_myUserId, { [`perGroup/${groupId}/paletteState`]: state }).catch(() => {});
  }
}

// ── Favorites (the user's history of saved palette combos) ──────────────────
// Source of truth for cross-device sync moved from users/{uid}/favorites to
// userPrefs/{uid}/favorites in this migration. Wipe-friendly: any pre-
// existing favorites on the old path are abandoned, not migrated.
export function getFavorites() {
  return storeGetFavorites();
}

export function setFavorites(arr) {
  storeSetFavorites(arr);
  if (_myUserId) mergeUserPrefs(_myUserId, { favorites: arr }).catch(() => {});
}

// ── lastTimeoutMinutes (Direct chip default + per-group chip default) ──────
// The user's preferred default for the "go available for N" chip. Direct's
// value used to live at users/{uid}/lastTimeoutMinutes; per-group was
// localStorage-only until this migration. Both now sync via userPrefs/.
export function getLastTimeout() {
  return storeGetLastTimeout();
}

export function setLastTimeout(n) {
  storeSetLastTimeout(n);
  if (_myUserId) mergeUserPrefs(_myUserId, { lastTimeoutMinutes: n }).catch(() => {});
}

export function getGroupChipMinutes(groupId) {
  return storeGetGroupChipMinutes(groupId);
}

export function setGroupChipMinutes(groupId, minutes) {
  storeSetGroupChipMinutes(groupId, minutes);
  if (_myUserId) {
    mergeUserPrefs(_myUserId, { [`perGroup/${groupId}/lastTimeoutMinutes`]: minutes }).catch(() => {});
  }
}

// ── currentContext ('direct' | 'group:{groupId}') ──────────────────────────
// Moved from users/{uid}/currentContext to userPrefs/{uid}/currentContext.
// Localstorage cache key is kept so any inline fallback reads keep working.
const CURRENT_CONTEXT_KEY = 'statusapp_current_context';

export function getCurrentContextCached() {
  return localStorage.getItem(CURRENT_CONTEXT_KEY) || 'direct';
}

export function setCurrentContext(value) {
  const v = value || 'direct';
  if (localStorage.getItem(CURRENT_CONTEXT_KEY) !== v) {
    localStorage.setItem(CURRENT_CONTEXT_KEY, v);
  }
  if (_myUserId) mergeUserPrefs(_myUserId, { currentContext: v }).catch(() => {});
}

// ── Watch reconciliation ─────────────────────────────────────────────────────
// Called by app.js's watchUserPrefs subscription each time the server snapshot
// changes. Populates the localStorage cache so subsequent synchronous reads
// see the synced state. Server wins on conflict; the wipe-friendly migration
// means there's no first-time push-up of pre-existing local state.
export function syncFromServer(serverPrefs) {
  if (!serverPrefs) return;
  // Hints
  if (serverPrefs.hints) {
    for (const [name, seen] of Object.entries(serverPrefs.hints)) {
      const key = HINT_KEYS[name];
      if (key && seen) localStorage.setItem(key, '1');
    }
  }
  // Counters (server's larger value wins — both devices may have incremented)
  if (typeof serverPrefs.madeCallCount === 'number') {
    const local = getMadeCallCount();
    if (serverPrefs.madeCallCount > local) {
      localStorage.setItem(MADE_CALL_KEY, String(serverPrefs.madeCallCount));
    }
  }
  if (typeof serverPrefs.answeredCallCount === 'number') {
    const local = getAnsweredCallCount();
    if (serverPrefs.answeredCallCount > local) {
      localStorage.setItem(ANSWERED_CALL_KEY, String(serverPrefs.answeredCallCount));
    }
  }
  // Favorites strip collapsed/expanded
  if (typeof serverPrefs.favoritesCollapsed === 'boolean') {
    if (serverPrefs.favoritesCollapsed) localStorage.setItem(COLLAPSED_KEY, '1');
    else localStorage.removeItem(COLLAPSED_KEY);
  }
  // Direct palette state
  if (serverPrefs.paletteState?.direct) {
    storeSetPaletteState(serverPrefs.paletteState.direct);
    document.dispatchEvent(new CustomEvent('palette-state-synced'));
  }
  // Favorites (array of palette combos). RTDB may return the array as a
  // keyed object if any entries are missing or non-sequential; normalize.
  if (serverPrefs.favorites != null) {
    const favs = Array.isArray(serverPrefs.favorites)
      ? serverPrefs.favorites
      : Object.values(serverPrefs.favorites);
    storeSetFavorites(favs);
    document.dispatchEvent(new CustomEvent('favorites-synced'));
  }
  // currentContext
  if (typeof serverPrefs.currentContext === 'string') {
    localStorage.setItem(CURRENT_CONTEXT_KEY, serverPrefs.currentContext);
    document.dispatchEvent(new CustomEvent('current-context-synced', {
      detail: { currentContext: serverPrefs.currentContext },
    }));
  }
  // Direct chip default
  if (typeof serverPrefs.lastTimeoutMinutes === 'number') {
    storeSetLastTimeout(serverPrefs.lastTimeoutMinutes);
    document.dispatchEvent(new CustomEvent('last-timeout-synced', {
      detail: { minutes: serverPrefs.lastTimeoutMinutes },
    }));
  }
  // Per-group state (palette state + per-group chip default)
  if (serverPrefs.perGroup) {
    for (const [groupId, groupBundle] of Object.entries(serverPrefs.perGroup)) {
      if (groupBundle?.paletteState) {
        try {
          localStorage.setItem(GROUP_PALETTE_LS(groupId), JSON.stringify(groupBundle.paletteState));
        } catch { /* ignore quota */ }
        document.dispatchEvent(new CustomEvent('group-palette-state-synced', {
          detail: { groupId },
        }));
      }
      if (typeof groupBundle?.lastTimeoutMinutes === 'number') {
        storeSetGroupChipMinutes(groupId, groupBundle.lastTimeoutMinutes);
        document.dispatchEvent(new CustomEvent('group-chip-minutes-synced', {
          detail: { groupId, minutes: groupBundle.lastTimeoutMinutes },
        }));
      }
    }
  }
}
