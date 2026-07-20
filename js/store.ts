// js/store.ts
const FOLLOWING_KEY = 'statusapp_following';
const TIMEOUT_KEY = 'statusapp_last_timeout';
const PALETTE_STATE_KEY = 'statusapp_palette_state';
const PALETTE_LEGACY_KEY = 'statusapp_palette';
const MADE_CALL_COUNT_KEY = 'statusapp_made_call_count';
const ANSWERED_CALL_COUNT_KEY = 'statusapp_answered_call_count';
const FOLLOWER_NAMES_KEY = 'statusapp_follower_names';

export type FollowingEntry = { userId: string; code: string; label?: string };
// Palette state is genuinely loose localStorage JSON — consumers (js/palettes.ts,
// js/prefs.js) cast at use-sites, so the set shape stays `any` rather than a
// narrow type this module would impose on them.
export type PaletteState = { activeSet: number; sets: Record<string, any> };

const DEFAULT_PALETTE_STATE = {
  activeSet: 1,
  sets: {
    '1': { selectedKey: 'forest', activePaletteKey: null },
    '2': { selectedKey: 'volt',   activePaletteKey: null },
  },
};

// Raw-string memo: getFollowing is called from render loops and the 60s label
// refresh; parsing the same string every call is pure waste. The raw value is
// still read (and compared) every call, so direct/cross-tab writes are seen.
let _followingRaw: string | null = null;
let _followingParsed: FollowingEntry[] = [];

function getFollowing(): FollowingEntry[] {
  const raw = localStorage.getItem(FOLLOWING_KEY);
  if (raw !== null && raw === _followingRaw) return _followingParsed.slice();
  let parsed: FollowingEntry[] = [];
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) {
        parsed = p.filter(e => e && typeof e.userId === 'string' && typeof e.code === 'string');
      }
    } catch { /* malformed → [] */ }
  }
  _followingRaw = raw;
  _followingParsed = parsed;
  return parsed.slice();
}

function saveFollowing(list: FollowingEntry[]) {
  localStorage.setItem(FOLLOWING_KEY, JSON.stringify(list));
}

// Public bulk-replace, used by the cross-device sync path. Local mutation
// helpers (addFollowing, removeFollowing, etc.) continue to use saveFollowing.
function setFollowing(list: FollowingEntry[]) {
  saveFollowing(list);
}

function addFollowing(entry: FollowingEntry) {
  const list = getFollowing();
  list.push(entry);
  saveFollowing(list);
}

function removeFollowing(userId: string) {
  saveFollowing(getFollowing().filter((e) => e.userId !== userId));
}

function isFollowing(userId: string): boolean {
  return getFollowing().some((e) => e.userId === userId);
}

function getLastTimeout(): number {
  const raw = localStorage.getItem(TIMEOUT_KEY);
  return raw ? parseInt(raw, 10) : 2;
}

function setLastTimeout(n: number) {
  localStorage.setItem(TIMEOUT_KEY, String(n));
}

// Per-group chip default (the time chip's "go available for N" pick). Stored
// locally per device — no Firebase sync yet; that lands with the userPrefs
// migration. Returns null when the user hasn't picked a per-group default;
// callers fall through to getLastTimeout() (Direct's default).
function getGroupChipMinutes(groupId: string): number | null {
  const raw = localStorage.getItem(`statusapp_group_chip_${groupId}`);
  return raw ? parseInt(raw, 10) : null;
}

function setGroupChipMinutes(groupId: string, minutes: number) {
  localStorage.setItem(`statusapp_group_chip_${groupId}`, String(minutes));
}

function renameFollowing(userId: string, newLabel: string) {
  const list = getFollowing().map((e) =>
    e.userId === userId ? { ...e, label: newLabel } : e
  );
  saveFollowing(list);
}

function updateFollowingCode(userId: string, newCode: string) {
  saveFollowing(getFollowing().map((e) =>
    e.userId === userId ? { ...e, code: newCode } : e
  ));
}

let _paletteRaw: string | null = null;
let _paletteParsed: PaletteState | null = null;

function getPaletteState(): PaletteState {
  const raw = localStorage.getItem(PALETTE_STATE_KEY);
  if (raw !== null && raw === _paletteRaw && _paletteParsed) {
    return structuredClone(_paletteParsed);
  }
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.activeSet === 'number' && parsed.sets && parsed.sets['1'] && parsed.sets['2']) {
        _paletteRaw = raw;
        _paletteParsed = parsed;
        return structuredClone(parsed);
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
  _paletteRaw = localStorage.getItem(PALETTE_STATE_KEY);
  _paletteParsed = state;
  return structuredClone(state);
}

function setPaletteState(state: unknown) {
  localStorage.setItem(PALETTE_STATE_KEY, JSON.stringify(state));
}

const FAVORITES_KEY = 'statusapp_favorites';

// Raw-string memo (same shape as getFollowing above): parsing the same string
// every call is pure waste. The raw value is still read (and compared) every
// call, so direct/cross-tab writes are still seen.
let _favoritesRaw: string | null = null;
let _favoritesParsed: any[] = [];

function getFavorites(): any[] {
  const raw = localStorage.getItem(FAVORITES_KEY);
  if (raw !== null && raw === _favoritesRaw) return _favoritesParsed.slice();
  let parsed: any[] = [];
  try {
    const p = JSON.parse(raw || '[]');
    if (Array.isArray(p)) parsed = p;
  } catch { /* malformed → [] */ }
  _favoritesRaw = raw;
  _favoritesParsed = parsed;
  return parsed.slice();
}

function setFavorites(arr: unknown[]) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(arr));
}

function getPalette(): string {
  const state = getPaletteState();
  return state.sets[String(state.activeSet)].selectedKey;
}

// Roster display names remembered for follower-only cards (uid → name).
// Written when approving a follow request (inbox.js), read by the follower
// card render + follow-back prefill (following.js). Device-local, like the
// requester-side "Requested" state.
function getFollowerName(userId: string): string | null {
  try { return JSON.parse(localStorage.getItem(FOLLOWER_NAMES_KEY) || '{}')[userId] || null; }
  catch { return null; }
}

function setFollowerName(userId: string, name: string) {
  try {
    const map = JSON.parse(localStorage.getItem(FOLLOWER_NAMES_KEY) || '{}');
    map[userId] = name;
    localStorage.setItem(FOLLOWER_NAMES_KEY, JSON.stringify(map));
  } catch { /* quota */ }
}

// Call-counter helpers moved to js/prefs.js — they now sync via userPrefs/
// instead of staying device-local.

export { getFollowing, setFollowing, addFollowing, removeFollowing, isFollowing, getLastTimeout, setLastTimeout, getGroupChipMinutes, setGroupChipMinutes, renameFollowing, updateFollowingCode, getPalette, getPaletteState, setPaletteState, getFavorites, setFavorites, getFollowerName, setFollowerName };
