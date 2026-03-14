// tests/status.test.js
jest.mock('../js/firebase-config.js', () => ({ db: {} }));
jest.mock('firebase/database', () => ({}));

const { isExpired, timeRemainingMs, formatTimeRemaining } = require('../js/db');

test('isExpired returns false when availableUntil is null', () => {
  expect(isExpired(null)).toBe(false);
});

test('isExpired returns false when availableUntil is in the future', () => {
  expect(isExpired(Date.now() + 60000)).toBe(false);
});

test('isExpired returns true when availableUntil is in the past', () => {
  expect(isExpired(Date.now() - 1000)).toBe(true);
});

test('timeRemainingMs returns 0 when null', () => {
  expect(timeRemainingMs(null)).toBe(0);
});

test('timeRemainingMs returns positive ms for future timestamp', () => {
  const future = Date.now() + 3600000;
  const ms = timeRemainingMs(future);
  expect(ms).toBeGreaterThan(3500000);
  expect(ms).toBeLessThanOrEqual(3600000);
});

test('formatTimeRemaining returns empty string for 0', () => {
  expect(formatTimeRemaining(0)).toBe('');
});

test('formatTimeRemaining shows hours and minutes when > 60min', () => {
  expect(formatTimeRemaining(7320000)).toBe('2h 2m');
});

test('formatTimeRemaining shows only minutes when < 1 hour', () => {
  expect(formatTimeRemaining(2700000)).toBe('45m');
});

test('formatTimeRemaining shows "< 1m" when under a minute', () => {
  expect(formatTimeRemaining(30000)).toBe('< 1m');
});
