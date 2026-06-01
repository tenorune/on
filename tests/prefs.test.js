// tests/prefs.test.js
jest.mock('../js/db.js', () => ({
  mergeUserPrefs: jest.fn().mockResolvedValue(undefined),
  watchPendingInvites: jest.fn(() => () => {}),
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readPendingInviteesForGroup: jest.fn().mockResolvedValue([]),
}));

const { mergeUserPrefs } = require('../js/db.js');
const {
  initPrefs,
  isHintSeen, markHintSeen,
  getMadeCallCount, incrementMadeCallCount,
  getAnsweredCallCount, incrementAnsweredCallCount,
  syncFromServer,
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
