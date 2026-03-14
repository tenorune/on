// tests/status.test.js
jest.mock('../js/firebase-config.js', () => ({ db: {} }));
jest.mock('firebase/database', () => ({}));

const { isExpired, timeRemainingMs, formatTimeRemaining, formatTimeRemainingFuzzy } = require('../js/db');

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

test('formatTimeRemainingFuzzy returns empty string for 0', () => {
  expect(formatTimeRemainingFuzzy(0)).toBe('');
});

test('formatTimeRemainingFuzzy returns "Just a few minutes left" under 5 minutes', () => {
  expect(formatTimeRemainingFuzzy(2 * 60000)).toBe('Just a few minutes left');
});

test('formatTimeRemainingFuzzy returns "About 15 minutes left" for 5–20 minutes', () => {
  expect(formatTimeRemainingFuzzy(10 * 60000)).toBe('About 15 minutes left');
});

test('formatTimeRemainingFuzzy returns "About half an hour left" for 20–45 minutes', () => {
  expect(formatTimeRemainingFuzzy(30 * 60000)).toBe('About half an hour left');
});

test('formatTimeRemainingFuzzy returns "About an hour left" for 45–75 minutes', () => {
  expect(formatTimeRemainingFuzzy(60 * 60000)).toBe('About an hour left');
});

test('formatTimeRemainingFuzzy returns "A little more than an hour left" for 75–120 minutes', () => {
  expect(formatTimeRemainingFuzzy(90 * 60000)).toBe('A little more than an hour left');
});

test('formatTimeRemainingFuzzy returns "Just over N hours left" when close above a whole hour', () => {
  expect(formatTimeRemainingFuzzy(2.1 * 3600000)).toBe('Just over 2 hours left');
});

test('formatTimeRemainingFuzzy returns "About N hours left" for the middle of an hour band', () => {
  expect(formatTimeRemainingFuzzy(2.4 * 3600000)).toBe('About 2 hours left');
});

test('formatTimeRemainingFuzzy returns "Nearly N hours left" when close below a whole hour', () => {
  expect(formatTimeRemainingFuzzy(2.8 * 3600000)).toBe('Nearly 3 hours left');
});

// formatLastSeen
const { formatLastSeen } = require('../js/db');

test('formatLastSeen returns null for null input', () => {
  expect(formatLastSeen(null)).toBeNull();
});

test('formatLastSeen returns null for undefined input', () => {
  expect(formatLastSeen(undefined)).toBeNull();
});

test('formatLastSeen returns null when last seen less than 7 days ago', () => {
  const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;
  expect(formatLastSeen(sixDaysAgo)).toBeNull();
});

test('formatLastSeen returns null for exactly 0ms elapsed (just now)', () => {
  expect(formatLastSeen(Date.now())).toBeNull();
});

test('formatLastSeen returns "over a week ago" when last seen 7–13 days ago', () => {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000 - 1;
  expect(formatLastSeen(sevenDaysAgo)).toBe('over a week ago');
});

test('formatLastSeen returns "over a week ago" when last seen 13 days ago', () => {
  const thirteenDaysAgo = Date.now() - 13 * 24 * 60 * 60 * 1000;
  expect(formatLastSeen(thirteenDaysAgo)).toBe('over a week ago');
});

test('formatLastSeen returns "over two weeks ago" when last seen 14–27 days ago', () => {
  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000 - 1;
  expect(formatLastSeen(fourteenDaysAgo)).toBe('over two weeks ago');
});

test('formatLastSeen returns "over a month ago" when last seen 28+ days ago', () => {
  const twentyEightDaysAgo = Date.now() - 28 * 24 * 60 * 60 * 1000 - 1;
  expect(formatLastSeen(twentyEightDaysAgo)).toBe('over a month ago');
});
