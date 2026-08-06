// tests/store.test.js
const {
  getFollowing, addFollowing, removeFollowing, isFollowing,
  getLastTimeout, setLastTimeout, renameFollowing, updateFollowingCode,
  getPalette, getPaletteState, setPaletteState,
  getFavorites, setFavorites,
  hasSeenServerFollowing, markServerFollowingSeen,
} = require('../js/store');

beforeEach(() => {
  localStorage.clear();
});

test('getFollowing returns empty array when nothing stored', () => {
  expect(getFollowing()).toEqual([]);
});

test('addFollowing persists an entry', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  expect(getFollowing()).toEqual([{ code: 'AB3K9X', label: 'Partner', userId: 'user-1' }]);
});

test('addFollowing accumulates multiple entries', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  addFollowing({ code: 'ZZ91TL', label: 'Mom', userId: 'user-2' });
  expect(getFollowing()).toHaveLength(2);
});

test('removeFollowing removes entry by userId', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  addFollowing({ code: 'ZZ91TL', label: 'Mom', userId: 'user-2' });
  removeFollowing('user-1');
  const list = getFollowing();
  expect(list).toHaveLength(1);
  expect(list[0].userId).toBe('user-2');
});

test('removeFollowing is a no-op for unknown userId', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  removeFollowing('unknown');
  expect(getFollowing()).toHaveLength(1);
});

test('isFollowing returns true when userId present', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  expect(isFollowing('user-1')).toBe(true);
});

test('isFollowing returns false when userId absent', () => {
  expect(isFollowing('user-1')).toBe(false);
});

test('getLastTimeout returns 2 by default', () => {
  expect(getLastTimeout()).toBe(2);
});

test('setLastTimeout persists and getLastTimeout retrieves it', () => {
  setLastTimeout(7);
  expect(getLastTimeout()).toBe(7);
});

test('renameFollowing updates label for matching userId, other fields unchanged', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  renameFollowing('user-1', 'Alice');
  const list = getFollowing();
  expect(list[0]).toEqual({ code: 'AB3K9X', label: 'Alice', userId: 'user-1' });
});

test('renameFollowing leaves other entries unchanged', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  addFollowing({ code: 'ZZ91TL', label: 'Mom', userId: 'user-2' });
  renameFollowing('user-1', 'Alice');
  const list = getFollowing();
  expect(list[1]).toEqual({ code: 'ZZ91TL', label: 'Mom', userId: 'user-2' });
});

test('renameFollowing does nothing if userId not found', () => {
  addFollowing({ code: 'AB3K9X', label: 'Partner', userId: 'user-1' });
  renameFollowing('unknown', 'Alice');
  expect(getFollowing()).toEqual([{ code: 'AB3K9X', label: 'Partner', userId: 'user-1' }]);
});

test('updateFollowingCode updates code for matching userId, leaves other fields unchanged', () => {
  addFollowing({ code: 'OLD123', label: 'Alice', userId: 'user-1' });
  updateFollowingCode('user-1', 'NEW456');
  const list = getFollowing();
  expect(list[0]).toEqual({ code: 'NEW456', label: 'Alice', userId: 'user-1' });
});

test('updateFollowingCode does not modify non-matching entries', () => {
  addFollowing({ code: 'OLD123', label: 'Alice', userId: 'user-1' });
  addFollowing({ code: 'ZZ91TL', label: 'Bob', userId: 'user-2' });
  updateFollowingCode('user-1', 'NEW456');
  const list = getFollowing();
  expect(list[1]).toEqual({ code: 'ZZ91TL', label: 'Bob', userId: 'user-2' });
});

test('getPalette returns "forest" when nothing stored', () => {
  expect(getPalette()).toBe('forest');
});

test('getPalette returns activeSet selectedKey from palette state', () => {
  const state = getPaletteState();
  state.sets['1'].selectedKey = 'iris';
  setPaletteState(state);
  expect(getPalette()).toBe('iris');
});

// --- getPaletteState / setPaletteState ---

test('getPaletteState returns default state when nothing stored', () => {
  const state = getPaletteState();
  expect(state.activeSet).toBe(1);
  expect(state.sets['1'].selectedKey).toBe('forest');
  expect(state.sets['1'].activePaletteKey).toBeNull();
  expect(state.sets['2'].selectedKey).toBe('volt');
  expect(state.sets['2'].activePaletteKey).toBeNull();
});

test('getPaletteState writes default to localStorage on first call', () => {
  getPaletteState();
  const raw = localStorage.getItem('statusapp_palette_state');
  expect(raw).not.toBeNull();
  const saved = JSON.parse(raw);
  expect(saved.activeSet).toBe(1);
});

test('getPaletteState migrates legacy statusapp_palette key into Set 1 selectedKey', () => {
  localStorage.setItem('statusapp_palette', 'ember');
  const state = getPaletteState();
  expect(state.sets['1'].selectedKey).toBe('ember');
  expect(localStorage.getItem('statusapp_palette')).toBeNull();
});

test('getPaletteState migration writes new state before deleting old key', () => {
  localStorage.setItem('statusapp_palette', 'coral');
  getPaletteState();
  const raw = localStorage.getItem('statusapp_palette_state');
  expect(JSON.parse(raw).sets['1'].selectedKey).toBe('coral');
});

test('setPaletteState round-trips via getPaletteState', () => {
  const state = getPaletteState();
  state.sets['1'].selectedKey = 'gold';
  setPaletteState(state);
  const loaded = getPaletteState();
  expect(loaded.sets['1'].selectedKey).toBe('gold');
});

describe('parse memoization', () => {
  test('unchanged raw skips re-parse but still returns a fresh array', () => {
    localStorage.setItem('statusapp_following', JSON.stringify([{ userId: 'u1', code: 'C1' }]));
    const spy = jest.spyOn(JSON, 'parse');
    const a = getFollowing();
    const callsAfterFirst = spy.mock.calls.length;
    const b = getFollowing();
    expect(spy.mock.calls.length).toBe(callsAfterFirst); // second call: no parse
    expect(b).toEqual(a);
    expect(b).not.toBe(a); // fresh copy — callers mutate their list
    spy.mockRestore();
  });

  test('a direct localStorage write between calls is honored (cross-tab safety)', () => {
    localStorage.setItem('statusapp_following', JSON.stringify([{ userId: 'u1', code: 'C1' }]));
    getFollowing();
    localStorage.setItem('statusapp_following', JSON.stringify([{ userId: 'u2', code: 'C2' }]));
    expect(getFollowing()).toEqual([{ userId: 'u2', code: 'C2' }]);
  });

  test('getFavorites: unchanged raw skips re-parse but still returns a fresh array', () => {
    localStorage.setItem('statusapp_favorites', JSON.stringify([{ statusColor: 'green' }]));
    const spy = jest.spyOn(JSON, 'parse');
    const a = getFavorites();
    const callsAfterFirst = spy.mock.calls.length;
    const b = getFavorites();
    expect(spy.mock.calls.length).toBe(callsAfterFirst); // second call: no parse
    expect(b).toEqual(a);
    expect(b).not.toBe(a); // fresh copy — callers mutate their list
    spy.mockRestore();
  });

  test('getFavorites: a direct localStorage write between calls is honored (cross-tab safety)', () => {
    localStorage.setItem('statusapp_favorites', JSON.stringify([{ statusColor: 'green' }]));
    getFavorites();
    localStorage.setItem('statusapp_favorites', JSON.stringify([{ statusColor: 'red' }]));
    expect(getFavorites()).toEqual([{ statusColor: 'red' }]);
  });

  test('getFavorites: setFavorites write is reflected on the next read (no stale memo)', () => {
    getFavorites(); // prime the memo on empty store
    setFavorites([{ statusColor: 'blue' }]);
    expect(getFavorites()).toEqual([{ statusColor: 'blue' }]);
  });

  test('getFavorites: malformed JSON still falls back to []', () => {
    localStorage.setItem('statusapp_favorites', 'not json');
    expect(getFavorites()).toEqual([]);
  });

  test('getFavorites: non-array JSON still falls back to []', () => {
    localStorage.setItem('statusapp_favorites', JSON.stringify({ not: 'an array' }));
    expect(getFavorites()).toEqual([]);
  });
});

// --- G6: has this device ever seen a server-side following list? ---

test('hasSeenServerFollowing is false before any server list has been seen', () => {
  expect(hasSeenServerFollowing('me')).toBe(false);
});

test('markServerFollowingSeen makes it true for that uid only', () => {
  markServerFollowingSeen('me');
  expect(hasSeenServerFollowing('me')).toBe(true);
  expect(hasSeenServerFollowing('someone-else')).toBe(false);
});

test('a later uid replaces the stored one — an identity switch re-arms the push-up', () => {
  markServerFollowingSeen('me');
  markServerFollowingSeen('other');
  expect(hasSeenServerFollowing('other')).toBe(true);
  expect(hasSeenServerFollowing('me')).toBe(false);
});

// Call-counter tests moved to tests/prefs.test.js — counters now sync via
// userPrefs/{uid}/madeCallCount + answeredCallCount.
