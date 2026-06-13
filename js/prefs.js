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

import { mergeUserPrefs, readPushTokens } from './db.js';
import {
  getPaletteState as storeGetPaletteState,
  setPaletteState as storeSetPaletteState,
  getFavorites as storeGetFavorites,
  setFavorites as storeSetFavorites,
  getLastTimeout as storeGetLastTimeout,
  setLastTimeout as storeSetLastTimeout,
  getGroupChipMinutes as storeGetGroupChipMinutes,
  setGroupChipMinutes as storeSetGroupChipMinutes,
  getFollowing as storeGetFollowing,
} from './store.js';

// Re-export for modules (e.g. inbox.js) that import following data via prefs.
export function getFollowing() {
  return storeGetFollowing();
}

let _myUserId = null;

export function initPrefs(userId) {
  _myUserId = userId;
}

// ── Hints ────────────────────────────────────────────────────────────────────
// Maps short hint name → localStorage key it lives under. Always read/write
// via isHintSeen/markHintSeen; do not access these keys directly. The legacy
// localStorage shape is preserved so existing stored flags carry forward.
const HINT_KEYS = {
  bolt:        'statusapp_seen_bolt',
  flower:      'statusapp_seen_flower',
  theme:       'statusapp_seen_theme',
  stripPeek:   'statusapp_seen_strip_peek_done',
  longpress:   'statusapp_seen_longpress',
  swipe:       'statusapp_seen_swipe',
  customAvail: 'statusapp_went_avail_custom',
  notifyPromo: 'statusapp_seen_notify_promo',
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

// Drop the per-group palette selection (local + synced) so the next read
// returns DEFAULT_GROUP_PALETTE_STATE. Called on a fresh (re)join: a member's
// stale selection must not survive a leave, or it gets seeded into the new
// color-less override as an impossible color+theme combo (#group rejoin).
export function clearGroupPaletteState(groupId) {
  try {
    localStorage.removeItem(GROUP_PALETTE_LS(groupId));
  } catch { /* ignore */ }
  if (_myUserId) {
    mergeUserPrefs(_myUserId, { [`perGroup/${groupId}/paletteState`]: null }).catch(() => {});
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

export function setCurrentContext(value) {
  const v = value || 'direct';
  if (localStorage.getItem(CURRENT_CONTEXT_KEY) !== v) {
    localStorage.setItem(CURRENT_CONTEXT_KEY, v);
  }
  if (_myUserId) mergeUserPrefs(_myUserId, { currentContext: v }).catch(() => {});
}

// Dedupe a favorites array by visual identity (statusColor + surface2)
// before persisting. Inlined here (rather than imported from favorites.js)
// to keep prefs.js free of the favorites.js → prefs.js → favorites.js
// import cycle. The favorites.js dedupe path (saveCombo + dedupeCombos)
// uses the same key — they must stay in sync.
function dedupeServerFavorites(arr) {
  const seen = [];
  const out = [];
  for (const c of arr || []) {
    if (!c) continue;
    if (seen.some(s => s.statusColor === c.statusColor && s.surface2 === c.surface2)) continue;
    seen.push(c);
    out.push(c);
  }
  return out;
}

// ── Per-person notification preferences ──────────────────────────────────────
// Cached as a single JSON map in localStorage so reads stay synchronous.
// Writes hit userPrefs/{uid}/notify/{targetUid}/{type} via mergeUserPrefs.
const NOTIFY_KEY = 'statusapp_notify_prefs';

function readNotifyCache() {
  try { return JSON.parse(localStorage.getItem(NOTIFY_KEY)) || {}; }
  catch { return {}; }
}
function writeNotifyCache(map) {
  try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(map)); } catch { /* quota */ }
}

export function getNotifyPrefs(targetUid) {
  const t = readNotifyCache()[targetUid] || {};
  return { knock: !!t.knock, call: !!t.call, availability: !!t.availability };
}

export function setNotifyPref(targetUid, type, on) {
  const map = readNotifyCache();
  map[targetUid] = { ...getNotifyPrefs(targetUid), [type]: !!on };
  writeNotifyCache(map);
  if (_myUserId) mergeUserPrefs(_myUserId, { [`notify/${targetUid}/${type}`]: !!on }).catch(() => {});
}

// True if the user has at least one per-contact notify pref enabled. Used to
// detect the "enabled bells but this device can't deliver" state (e.g. a
// restored account on a new device with no OS permission/token yet).
export function hasAnyNotifyPrefEnabled() {
  for (const t of Object.values(readNotifyCache())) {
    if (t && (t.knock || t.call || t.availability)) return true;
  }
  return false;
}

// ── Push-token registry ──────────────────────────────────────────────────────
const PUSH_TOKEN_KEY = 'statusapp_push_token';

export function getRegisteredPushToken() {
  return localStorage.getItem(PUSH_TOKEN_KEY) || null;
}

// 90 days. A device that's opened within this window re-stamps its token's
// lastSeen (refreshPushToken → touchPushToken), so only genuinely dormant
// tokens age out. Generous so a rarely-used second device isn't culled.
const PUSH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function addPushToken(token) {
  if (!token) return;
  try { localStorage.setItem(PUSH_TOKEN_KEY, token); } catch { /* quota */ }
  if (_myUserId) {
    const now = Date.now();
    mergeUserPrefs(_myUserId, {
      [`pushTokens/${token}`]: { createdAt: now, lastSeen: now, ua: navigator.userAgent || '' },
    }).catch(() => {});
  }
}

// Bump lastSeen on an already-registered token (every load while permission is
// granted), preserving createdAt/ua. Drives the stale-token TTL cull below.
export function touchPushToken(token) {
  if (!token || !_myUserId) return;
  mergeUserPrefs(_myUserId, { [`pushTokens/${token}/lastSeen`]: Date.now() }).catch(() => {});
}

// Prune the user's own tokens not seen within the TTL — orphans left by deleted
// installs / browser-profile churn that the owning device never reloads to
// clean. Self-cull from the active device (its own token is excluded and was
// just touched, so it's never removed). Reactive `registration-token-not-
// registered` pruning in the sender remains the second safety net. See #157.
export async function cullStalePushTokens() {
  if (!_myUserId) return;
  let map;
  try { map = await readPushTokens(_myUserId); } catch { return; }
  const stale = selectStalePushTokens(map, {
    activeToken: getRegisteredPushToken(), now: Date.now(), maxAgeMs: PUSH_TOKEN_TTL_MS,
  });
  if (!stale.length) return;
  const updates = {};
  for (const token of stale) updates[`pushTokens/${token}`] = null;
  await mergeUserPrefs(_myUserId, updates).catch(() => {});
}

export function removePushToken(token) {
  if (!token) return;
  if (localStorage.getItem(PUSH_TOKEN_KEY) === token) localStorage.removeItem(PUSH_TOKEN_KEY);
  if (_myUserId) mergeUserPrefs(_myUserId, { [`pushTokens/${token}`]: null }).catch(() => {});
}

// Pure: which tokens in `map` are stale (last seen beyond maxAgeMs), excluding
// the active token. Falls back to createdAt for legacy records without lastSeen.
// Repeated installs (deleted PWAs, browser-profile churn) orphan tokens that the
// owning device never reloads to clean — this is the freshness signal that lets
// an active device prune them. See #157.
export function selectStalePushTokens(map, { activeToken, now, maxAgeMs }) {
  const stale = [];
  for (const [token, rec] of Object.entries(map || {})) {
    if (token === activeToken) continue;
    const ts = (rec && (typeof rec.lastSeen === 'number' ? rec.lastSeen : rec.createdAt)) || 0;
    if (now - ts > maxAgeMs) stale.push(token);
  }
  return stale;
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
  // Also dedupe — legacy data from before saveCombo's dedupe logic
  // shipped (or sibling-device writes that raced) may contain duplicates
  // by (statusColor, surface2).
  if (serverPrefs.favorites != null) {
    const raw = Array.isArray(serverPrefs.favorites)
      ? serverPrefs.favorites
      : Object.values(serverPrefs.favorites);
    const serverDeduped = dedupeServerFavorites(raw);
    // Merge instead of overwrite. Any local entry not present in the
    // server payload is a pending saveCombo write that hasn't been
    // committed to Firebase yet — preserve it at the head so a stale
    // watchUserPrefs echo (e.g. triggered by an unrelated madeCallCount
    // write that fires before our favorites write is committed) doesn't
    // wipe the user's most-recent commit.
    const local = storeGetFavorites();
    const localOnly = local.filter(l => !serverDeduped.some(s =>
      s && l && s.statusColor === l.statusColor && s.surface2 === l.surface2));
    const merged = [...localOnly, ...serverDeduped].slice(0, 8);
    storeSetFavorites(merged);
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
  // Notification preferences (per-person knock/call/availability)
  if (serverPrefs.notify && typeof serverPrefs.notify === 'object') {
    const map = readNotifyCache();
    for (const [targetUid, prefs] of Object.entries(serverPrefs.notify)) {
      map[targetUid] = {
        knock: !!prefs?.knock, call: !!prefs?.call, availability: !!prefs?.availability,
      };
    }
    writeNotifyCache(map);
    document.dispatchEvent(new CustomEvent('notify-prefs-synced'));
  }
}
