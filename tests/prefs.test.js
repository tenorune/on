// tests/prefs.test.js
jest.mock('../js/db.js', () => ({
  mergeUserPrefs: jest.fn().mockResolvedValue(undefined),
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
