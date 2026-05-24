// js/store.js
const FOLLOWING_KEY = 'statusapp_following';
const TIMEOUT_KEY = 'statusapp_last_timeout';
const PALETTE_STATE_KEY = 'statusapp_palette_state';
const PALETTE_LEGACY_KEY = 'statusapp_palette';
const MADE_CALL_COUNT_KEY = 'statusapp_made_call_count';
const ANSWERED_CALL_COUNT_KEY = 'statusapp_answered_call_count';

const DEFAULT_PALETTE_STATE = {
  activeSet: 1,
  sets: {
    '1': { selectedKey: 'forest', activePaletteKey: null },
    '2': { selectedKey: 'volt',   activePaletteKey: null },
  },
};

function getFollowing() {
  const raw = localStorage.getItem(FOLLOWING_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(e => e && typeof e.userId === 'string' && typeof e.code === 'string');
  } catch {
    return [];
  }
}

function saveFollowing(list) {
  localStorage.setItem(FOLLOWING_KEY, JSON.stringify(list));
}

// Public bulk-replace, used by the cross-device sync path. Local mutation
// helpers (addFollowing, removeFollowing, etc.) continue to use saveFollowing.
function setFollowing(list) {
  saveFollowing(list);
}

function addFollowing(entry) {
  const list = getFollowing();
  list.push(entry);
  saveFollowing(list);
}

function removeFollowing(userId) {
  saveFollowing(getFollowing().filter((e) => e.userId !== userId));
}

function isFollowing(userId) {
  return getFollowing().some((e) => e.userId === userId);
}

function getLastTimeout() {
  const raw = localStorage.getItem(TIMEOUT_KEY);
  return raw ? parseInt(raw, 10) : 2;
}

function setLastTimeout(n) {
  localStorage.setItem(TIMEOUT_KEY, String(n));
}

function renameFollowing(userId, newLabel) {
  const list = getFollowing().map((e) =>
    e.userId === userId ? { ...e, label: newLabel } : e
  );
  saveFollowing(list);
}

function updateFollowingCode(userId, newCode) {
  saveFollowing(getFollowing().map((e) =>
    e.userId === userId ? { ...e, code: newCode } : e
  ));
}

function getPaletteState() {
  const raw = localStorage.getItem(PALETTE_STATE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.activeSet === 'number' && parsed.sets && parsed.sets['1'] && parsed.sets['2']) {
        return parsed;
      }
    } catch { /* fall through to default */ }
  }
  // Write default first
  const state = JSON.parse(JSON.stringify(DEFAULT_PALETTE_STATE));
  localStorage.setItem(PALETTE_STATE_KEY, JSON.stringify(state));
  // Migrate legacy key
  const legacy = localStorage.getItem(PALETTE_LEGACY_KEY);
  if (legacy) {
    state.sets['1'].selectedKey = legacy;
    localStorage.setItem(PALETTE_STATE_KEY, JSON.stringify(state));
    localStorage.removeItem(PALETTE_LEGACY_KEY);
  }
  return state;
}

function setPaletteState(state) {
  localStorage.setItem(PALETTE_STATE_KEY, JSON.stringify(state));
}

const FAVORITES_KEY = 'statusapp_favorites';

function getFavorites() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (_) { return []; }
}

function setFavorites(arr) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(arr));
}

function getPalette() {
  const state = getPaletteState();
  return state.sets[String(state.activeSet)].selectedKey;
}

// @deprecated — writes to legacy key (statusapp_palette); no longer read by production code.
// Kept for export compatibility. Do not call.
function setPalette(key) {
  localStorage.setItem('statusapp_palette', key);
}

function getMadeCallCount() {
  return parseInt(localStorage.getItem(MADE_CALL_COUNT_KEY) || '0', 10);
}

function incrementMadeCallCount() {
  localStorage.setItem(MADE_CALL_COUNT_KEY, String(getMadeCallCount() + 1));
}

function getAnsweredCallCount() {
  return parseInt(localStorage.getItem(ANSWERED_CALL_COUNT_KEY) || '0', 10);
}

function incrementAnsweredCallCount() {
  localStorage.setItem(ANSWERED_CALL_COUNT_KEY, String(getAnsweredCallCount() + 1));
}

module.exports = { getFollowing, setFollowing, addFollowing, removeFollowing, isFollowing, getLastTimeout, setLastTimeout, renameFollowing, updateFollowingCode, getPalette, setPalette, getPaletteState, setPaletteState, getFavorites, setFavorites, getMadeCallCount, incrementMadeCallCount, getAnsweredCallCount, incrementAnsweredCallCount };
