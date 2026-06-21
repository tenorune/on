// tests/prefs.test.js
jest.mock('../js/db.js', () => ({
  mergeUserPrefs: jest.fn().mockResolvedValue(undefined),
  watchPendingInvites: jest.fn(() => () => {}),
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readPendingInviteesForGroup: jest.fn().mockResolvedValue([]),
  readPushTokens: jest.fn().mockResolvedValue(null),
}));

const { mergeUserPrefs } = require('../js/db.js');
const {
  initPrefs,
  isHintSeen, markHintSeen,
  getMadeCallCount, incrementMadeCallCount,
  getAnsweredCallCount, incrementAnsweredCallCount,
  syncFromServer,
  getNotifyPrefs, setNotifyPref,
  hasAnyNotifyPrefEnabled,
  setPaletteState, setPaletteStateLocal, getPaletteState,
} = require('../js/prefs.js');

beforeEach(() => {
  localStorage.clear();
  mergeUserPrefs.mockClear();
});

// ── Hints ──

test('isHintSeen returns false when localStorage is empty', () => {
  expect(isHintSeen('bolt')).toBe(false);
});

test('markHintSeen populates localStorage with the legacy key shape', () => {
  markHintSeen('bolt');
  expect(localStorage.getItem('statusapp_seen_bolt')).toBe('1');
  expect(isHintSeen('bolt')).toBe(true);
});

test('markHintSeen fires mergeUserPrefs with userPrefs path when initialized', () => {
  initPrefs('uid1');
  markHintSeen('theme');
  expect(mergeUserPrefs).toHaveBeenCalledWith('uid1', { 'hints/theme': true });
});

test('markHintSeen is idempotent — second call skips the network write', () => {
  initPrefs('uid1');
  markHintSeen('bolt');
  markHintSeen('bolt');
  expect(mergeUserPrefs).toHaveBeenCalledTimes(1);
});

test('markHintSeen for an unknown name is a no-op (no crash, no write)', () => {
  initPrefs('uid1');
  markHintSeen('bogus');
  expect(mergeUserPrefs).not.toHaveBeenCalled();
});

// ── currentContext persistence ordering contract ──
// Regression guard: setCurrentContext only mirrors to userPrefs once initPrefs
// has told the module who's writing. app.js relies on this — it MUST call
// initPrefs before the invite-redemption navigation, or navigateToGroup's
// context write lands in localStorage only and the watchUserPrefs echo resets a
// just-joined invitee back out of the group.
test('setCurrentContext persists to userPrefs only after initPrefs knows the user', () => {
  jest.isolateModules(() => {
    const { mergeUserPrefs: mup } = require('../js/db.js');
    const prefs = require('../js/prefs.js');
    // Before initPrefs: localStorage updates, but nothing reaches Firebase.
    prefs.setCurrentContext('group:G1');
    expect(localStorage.getItem('statusapp_current_context')).toBe('group:G1');
    expect(mup).not.toHaveBeenCalled();
    // After initPrefs: the same call mirrors to userPrefs/{uid}/currentContext.
    prefs.initPrefs('uid1');
    prefs.setCurrentContext('group:G2');
    expect(mup).toHaveBeenCalledWith('uid1', { currentContext: 'group:G2' });
  });
});

// ── Call counters ──

test('getMadeCallCount returns 0 when nothing stored', () => {
  expect(getMadeCallCount()).toBe(0);
});

test('incrementMadeCallCount writes localStorage + fires Firebase with the new count', () => {
  initPrefs('uid1');
  incrementMadeCallCount();
  expect(getMadeCallCount()).toBe(1);
  expect(mergeUserPrefs).toHaveBeenCalledWith('uid1', { madeCallCount: 1 });
});

test('incrementMadeCallCount accumulates', () => {
  incrementMadeCallCount();
  incrementMadeCallCount();
  incrementMadeCallCount();
  expect(getMadeCallCount()).toBe(3);
});

test('getAnsweredCallCount returns 0 when nothing stored', () => {
  expect(getAnsweredCallCount()).toBe(0);
});

test('incrementAnsweredCallCount writes localStorage + fires Firebase', () => {
  initPrefs('uid1');
  incrementAnsweredCallCount();
  expect(getAnsweredCallCount()).toBe(1);
  expect(mergeUserPrefs).toHaveBeenCalledWith('uid1', { answeredCallCount: 1 });
});

// ── syncFromServer ──

test('syncFromServer populates hint cache from server snapshot', () => {
  syncFromServer({ hints: { bolt: true, theme: true } });
  expect(localStorage.getItem('statusapp_seen_bolt')).toBe('1');
  expect(localStorage.getItem('statusapp_seen_theme')).toBe('1');
});

test('syncFromServer raises local counter only when server is higher', () => {
  // local already 5 (this device has called more than the server snapshot).
  localStorage.setItem('statusapp_made_call_count', '5');
  syncFromServer({ madeCallCount: 3 });
  expect(getMadeCallCount()).toBe(5);
  // server higher — local catches up.
  syncFromServer({ madeCallCount: 7 });
  expect(getMadeCallCount()).toBe(7);
});

test('syncFromServer ignores null payload', () => {
  syncFromServer(null);
  expect(localStorage.getItem('statusapp_seen_bolt')).toBeNull();
});

test('syncFromServer dedupes favorites by (statusColor, surface2) before persisting', () => {
  const FAVS_KEY = 'statusapp_favorites';
  const a1 = { statusColor: '#ff00aa', surface2: '#222', paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 };
  const b  = { statusColor: '#000000', surface2: '#000', paletteKey: null,     selectedKey: 'forest', activeSet: 1 };
  const a2 = { statusColor: '#ff00aa', surface2: '#222', paletteKey: null,     selectedKey: 'volt',   activeSet: 2 };
  syncFromServer({ favorites: [a1, b, a2] });
  const stored = JSON.parse(localStorage.getItem(FAVS_KEY));
  expect(stored.length).toBe(2);
  expect(stored[0]).toEqual(a1);
  expect(stored[1]).toEqual(b);
});

test('syncFromServer dedupes keyed-object favorites payload (RTDB sparse-array case)', () => {
  const FAVS_KEY = 'statusapp_favorites';
  // RTDB sometimes returns arrays as objects keyed by index.
  const payload = {
    favorites: {
      '0': { statusColor: '#abc', surface2: '#111', paletteKey: null, selectedKey: 'forest', activeSet: 1 },
      '1': { statusColor: '#abc', surface2: '#111', paletteKey: 'iris', selectedKey: 'iris', activeSet: 1 },
    },
  };
  syncFromServer(payload);
  const stored = JSON.parse(localStorage.getItem(FAVS_KEY));
  expect(stored.length).toBe(1);
});

test('syncFromServer preserves local-only entries at the head (pending-write race)', () => {
  const FAVS_KEY = 'statusapp_favorites';
  const justWritten = { statusColor: '#f43f5e', surface2: '#334155',
                        paletteKey: null, selectedKey: 'forest', activeSet: 1 };
  const existing1 = { statusColor: '#22c55e', surface2: '#334155',
                      paletteKey: null, selectedKey: 'forest', activeSet: 1 };
  const existing2 = { statusColor: '#818cf8', surface2: '#334155',
                      paletteKey: null, selectedKey: 'forest', activeSet: 1 };
  // Local has the just-written entry (saveCombo just put it at the head)
  // plus two older entries.
  localStorage.setItem(FAVS_KEY, JSON.stringify([justWritten, existing1, existing2]));
  // Server snapshot still has only the two older entries (the just-written
  // mergeUserPrefs write hasn't been committed yet, but an UNRELATED write
  // — e.g. madeCallCount — triggered a watchUserPrefs echo).
  syncFromServer({ favorites: [existing1, existing2] });
  const stored = JSON.parse(localStorage.getItem(FAVS_KEY));
  expect(stored.length).toBe(3);
  expect(stored[0]).toEqual(justWritten);   // pending local write preserved
  expect(stored[1]).toEqual(existing1);
  expect(stored[2]).toEqual(existing2);
});

test('syncFromServer does NOT resurrect a cap-dropped tail entry (issue #253)', () => {
  const FAVS_KEY = 'statusapp_favorites';
  // Both devices held a full 8-entry list. On the OTHER device a new combo
  // was saved (going active / adopting a color in a group), which prepended
  // it and dropped the oldest (f8) off the 8-cap tail. The server snapshot
  // is now [G, f1..f7] — f8 is gone.
  const mk = (c) => ({ statusColor: c, surface2: '#334155',
                       paletteKey: null, selectedKey: 'forest', activeSet: 1 });
  const f = i => mk(`#00000${i}`);
  const G = mk('#abcdef');
  const localFull = [f(1), f(2), f(3), f(4), f(5), f(6), f(7), f(8)];
  // This device still has the full pre-save list including the dropped f8.
  localStorage.setItem(FAVS_KEY, JSON.stringify(localFull));
  const serverAfterSave = [G, f(1), f(2), f(3), f(4), f(5), f(6), f(7)];
  syncFromServer({ favorites: serverAfterSave });
  const stored = JSON.parse(localStorage.getItem(FAVS_KEY));
  // The new combo G must be at the head, NOT shoved to slot 2 by a
  // resurrected f8. f8 is a stale tail drop, not a pending local write.
  expect(stored[0]).toEqual(G);
  expect(stored).toEqual(serverAfterSave);
});

test('syncFromServer drops a stale local-only entry that sits after a server-known entry (issue #253)', () => {
  const FAVS_KEY = 'statusapp_favorites';
  // Well under the 8-cap. This device diverged from the canonical list during
  // an earlier raced sync and is left holding a stale entry wedged in the
  // middle. The server's current list is the source of truth. The stale entry
  // is NOT a pending write (it isn't at the head), so it must fall away rather
  // than be resurrected to slot 1.
  const mk = (c) => ({ statusColor: c, surface2: '#334155',
                       paletteKey: null, selectedKey: 'forest', activeSet: 1 });
  const s1 = mk('#111111'), s2 = mk('#222222'), s3 = mk('#333333');
  const stale = mk('#deadbe');
  localStorage.setItem(FAVS_KEY, JSON.stringify([s1, stale, s2, s3]));
  syncFromServer({ favorites: [s1, s2, s3] });
  const stored = JSON.parse(localStorage.getItem(FAVS_KEY));
  // Server list reproduced exactly — stale entry gone, nothing pinned ahead of it.
  expect(stored).toEqual([s1, s2, s3]);
});

describe('notify prefs', () => {
  beforeEach(() => { localStorage.clear(); mergeUserPrefs.mockClear(); initPrefs('me123'); });

  test('default is all-off for an unknown target', () => {
    expect(getNotifyPrefs('alex')).toEqual({ knock: false, call: false, availability: false });
  });

  test('setNotifyPref updates the local cache synchronously', () => {
    setNotifyPref('alex', 'knock', true);
    expect(getNotifyPrefs('alex')).toEqual({ knock: true, call: false, availability: false });
  });

  test('setNotifyPref writes the single field to userPrefs/notify/{target}/{type}', () => {
    setNotifyPref('alex', 'availability', true);
    expect(mergeUserPrefs).toHaveBeenCalledWith('me123', { 'notify/alex/availability': true });
  });

  test('syncFromServer repopulates the cache and dispatches notify-prefs-synced', () => {
    const handler = jest.fn();
    document.addEventListener('notify-prefs-synced', handler);
    syncFromServer({ notify: { bea: { knock: true, call: false, availability: true } } });
    expect(getNotifyPrefs('bea')).toEqual({ knock: true, call: false, availability: true });
    expect(handler).toHaveBeenCalled();
    document.removeEventListener('notify-prefs-synced', handler);
  });

  test('hasAnyNotifyPrefEnabled is false when no prefs are set', () => {
    expect(hasAnyNotifyPrefEnabled()).toBe(false);
  });

  test('hasAnyNotifyPrefEnabled is false when every pref is off', () => {
    setNotifyPref('alex', 'knock', true);
    setNotifyPref('alex', 'knock', false);
    expect(hasAnyNotifyPrefEnabled()).toBe(false);
  });

  test('hasAnyNotifyPrefEnabled is true when any contact has any type on', () => {
    setNotifyPref('alex', 'availability', true);
    expect(hasAnyNotifyPrefEnabled()).toBe(true);
  });
});

const { addPushToken, removePushToken, getRegisteredPushToken, touchPushToken, cullStalePushTokens } = require('../js/prefs.js');
const { readPushTokens } = require('../js/db.js');

describe('push tokens', () => {
  beforeEach(() => { localStorage.clear(); mergeUserPrefs.mockClear(); initPrefs('me123'); });

  test('addPushToken writes the token record (createdAt + lastSeen + ua) and records it locally', () => {
    addPushToken('tok-abc');
    expect(mergeUserPrefs).toHaveBeenCalledWith('me123',
      expect.objectContaining({ 'pushTokens/tok-abc': expect.objectContaining({ createdAt: expect.any(Number), lastSeen: expect.any(Number) }) }));
    expect(getRegisteredPushToken()).toBe('tok-abc');
  });

  test('touchPushToken bumps only the lastSeen leaf (preserving createdAt/ua)', () => {
    touchPushToken('tok-abc');
    expect(mergeUserPrefs).toHaveBeenCalledWith('me123', { 'pushTokens/tok-abc/lastSeen': expect.any(Number) });
  });

  test('removePushToken nulls the path and clears the local record', () => {
    addPushToken('tok-abc'); mergeUserPrefs.mockClear();
    removePushToken('tok-abc');
    expect(mergeUserPrefs).toHaveBeenCalledWith('me123', { 'pushTokens/tok-abc': null });
    expect(getRegisteredPushToken()).toBe(null);
  });
});

describe('cullStalePushTokens', () => {
  const DAY = 24 * 60 * 60 * 1000;
  beforeEach(() => { localStorage.clear(); mergeUserPrefs.mockClear(); readPushTokens.mockReset(); initPrefs('me123'); });

  test('deletes tokens past the TTL, keeping the active and fresh ones', async () => {
    addPushToken('active'); // localStorage active token = 'active'
    const now = Date.now();
    readPushTokens.mockResolvedValue({
      active: { lastSeen: now - 200 * DAY }, // active → never culled despite age
      fresh:  { lastSeen: now - 1 * DAY },
      stale1: { lastSeen: now - 100 * DAY },
      stale2: { createdAt: now - 120 * DAY }, // legacy record, no lastSeen
    });
    mergeUserPrefs.mockClear();
    await cullStalePushTokens();
    expect(mergeUserPrefs).toHaveBeenCalledWith('me123', { 'pushTokens/stale1': null, 'pushTokens/stale2': null });
  });

  test('no write when nothing is stale', async () => {
    readPushTokens.mockResolvedValue({ a: { lastSeen: Date.now() } });
    mergeUserPrefs.mockClear();
    await cullStalePushTokens();
    expect(mergeUserPrefs).not.toHaveBeenCalled();
  });
});

const { selectStalePushTokens } = require('../js/prefs.js');

describe('selectStalePushTokens (pure)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = 1_000_000_000_000;
  const ttl = 90 * DAY;

  test('flags tokens whose lastSeen is older than the TTL', () => {
    const map = {
      fresh: { lastSeen: now - 1 * DAY },
      stale: { lastSeen: now - 100 * DAY },
    };
    expect(selectStalePushTokens(map, { activeToken: null, now, maxAgeMs: ttl })).toEqual(['stale']);
  });

  test('never flags the active token, even if its lastSeen is old', () => {
    const map = { active: { lastSeen: now - 200 * DAY } };
    expect(selectStalePushTokens(map, { activeToken: 'active', now, maxAgeMs: ttl })).toEqual([]);
  });

  test('falls back to createdAt when lastSeen is missing (legacy records)', () => {
    const map = {
      legacyStale: { createdAt: now - 100 * DAY },
      legacyFresh: { createdAt: now - 2 * DAY },
    };
    expect(selectStalePushTokens(map, { activeToken: null, now, maxAgeMs: ttl })).toEqual(['legacyStale']);
  });

  test('tolerates an empty/missing map', () => {
    expect(selectStalePushTokens(null, { activeToken: null, now, maxAgeMs: ttl })).toEqual([]);
    expect(selectStalePushTokens({}, { activeToken: null, now, maxAgeMs: ttl })).toEqual([]);
  });
});

// ── Direct palette state: local-only vs synced setters ──
// syncPaletteStateFromServer (palettes.js) reconstructs the ACTIVE set from the
// broadcast presence and must NOT push the whole paletteState back to userPrefs,
// or it clobbers the INACTIVE set's selection with this device's not-yet-synced
// default (the cross-device regression).
const TWO_SET_STATE = {
  activeSet: 1,
  sets: {
    '1': { selectedKey: 'ember', selectedColor: '#f97316', activePaletteKey: null },
    '2': { selectedKey: 'venom', selectedColor: '#39ff14', activePaletteKey: 'venom' },
  },
};

test('setPaletteState writes localStorage AND userPrefs (full direct state)', () => {
  initPrefs('uid1');
  setPaletteState(TWO_SET_STATE);
  expect(mergeUserPrefs).toHaveBeenCalledWith('uid1', { 'paletteState/direct': TWO_SET_STATE });
  expect(getPaletteState().sets['2'].selectedKey).toBe('venom');
});

test('setPaletteStateLocal writes localStorage only — never userPrefs (no inactive-set clobber)', () => {
  initPrefs('uid1');
  setPaletteStateLocal(TWO_SET_STATE);
  expect(mergeUserPrefs).not.toHaveBeenCalled();
  expect(getPaletteState().sets['2'].selectedKey).toBe('venom'); // still applied locally
});
