import {
  isExpired, isAvailable, becameAvailable, withinCooldown,
  wantsKnock, wantsCall, wantsAvailability, buildMessage,
} from '../presence-core.js';

const NOW = 1_000_000;

describe('availability', () => {
  test('isExpired: null is never expired; past ms is expired', () => {
    expect(isExpired(null, NOW)).toBe(false);
    expect(isExpired(NOW - 1, NOW)).toBe(true);
    expect(isExpired(NOW + 1, NOW)).toBe(false);
  });
  test('isAvailable requires status available and a non-expired window', () => {
    expect(isAvailable({ status: 'available', availableUntil: NOW + 5 }, NOW)).toBe(true);
    expect(isAvailable({ status: 'available', availableUntil: NOW - 5 }, NOW)).toBe(false);
    expect(isAvailable({ status: 'unavailable', availableUntil: NOW + 5 }, NOW)).toBe(false);
    expect(isAvailable(null, NOW)).toBe(false);
  });
  test('becameAvailable only on a false→true transition', () => {
    const off = { status: 'unavailable', availableUntil: null };
    const on = { status: 'available', availableUntil: NOW + 5 };
    expect(becameAvailable(off, on, NOW)).toBe(true);
    expect(becameAvailable(on, on, NOW)).toBe(false); // re-up
    expect(becameAvailable(on, off, NOW)).toBe(false); // going offline
  });
});

describe('cooldown', () => {
  test('withinCooldown true if last fire is recent', () => {
    expect(withinCooldown(NOW - 1000, NOW, 5000)).toBe(true);
    expect(withinCooldown(NOW - 6000, NOW, 5000)).toBe(false);
    expect(withinCooldown(null, NOW, 5000)).toBe(false);
  });
});

describe('gates', () => {
  test('per-type gates read the prefs object', () => {
    expect(wantsKnock({ knock: true })).toBe(true);
    expect(wantsKnock({ knock: false })).toBe(false);
    expect(wantsKnock(null)).toBe(false);
    expect(wantsCall({ call: true })).toBe(true);
    expect(wantsAvailability({ availability: true })).toBe(true);
  });
});

describe('messages', () => {
  test('buildMessage composes title/body per type', () => {
    expect(buildMessage('knock', 'Bea')).toEqual({ title: 'Bea knocked', body: '' });
    expect(buildMessage('call', 'Alex K.')).toEqual({ title: 'Alex K. is calling', body: '' });
    expect(buildMessage('availability', 'Bea')).toEqual({ title: 'Bea is available', body: '' });
  });
});
