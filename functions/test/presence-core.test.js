import {
  withinCooldown, isFutureMs, availabilityTurnedOn,
  wantsKnock, wantsCall, wantsAvailability, buildMessage,
} from '../presence-core.js';

const NOW = 1_000_000;

describe('availability transition (narrowed: availableUntil + status)', () => {
  test('isFutureMs: true only for a numeric ms strictly in the future', () => {
    expect(isFutureMs(NOW + 5, NOW)).toBe(true);
    expect(isFutureMs(NOW - 5, NOW)).toBe(false);
    expect(isFutureMs(NOW, NOW)).toBe(false);
    expect(isFutureMs(null, NOW)).toBe(false);
    expect(isFutureMs(undefined, NOW)).toBe(false);
  });
  test('availabilityTurnedOn: fires only on invalid→future availableUntil with available status', () => {
    // going available: availableUntil absent/null → future, status available
    expect(availabilityTurnedOn(null, NOW + 5, 'available', NOW)).toBe(true);
    // re-up: future → future (already was available) → no
    expect(availabilityTurnedOn(NOW + 1, NOW + 5, 'available', NOW)).toBe(false);
    // going offline: → null → no
    expect(availabilityTurnedOn(NOW + 5, null, 'available', NOW)).toBe(false);
    // status not available → no
    expect(availabilityTurnedOn(null, NOW + 5, 'unavailable', NOW)).toBe(false);
    // renew after lazy expiry: expired(past) → future, status available → yes
    expect(availabilityTurnedOn(NOW - 100, NOW + 5, 'available', NOW)).toBe(true);
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
