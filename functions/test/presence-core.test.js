import {
  withinCooldown, isFutureMs, availabilityTurnedOn,
  wantsKnock, wantsCall, wantsAvailability, buildMessage,
  overrideAvailable, effectiveAvailable, primaryAvailable, clampName,
  formatTimeRemaining, formatTimeRemainingFuzzy,
} from '../presence-core.js';
import vectors from '../../test-fixtures/time-format-vectors.json' with { type: 'json' };

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
    expect(buildMessage('followRequest', 'Cara')).toEqual({ title: 'Cara wants to follow you', body: '' });
  });

  test('buildMessage clamps over-long names and group labels (FCM title hygiene)', () => {
    const long = 'x'.repeat(200);
    const cap = 'x'.repeat(40);
    expect(buildMessage('knock', long)).toEqual({ title: `${cap} knocked`, body: '' });
    expect(buildMessage('knock', long, { group: long })).toEqual({ title: `${cap} knocked in ${cap}`, body: '' });
  });
});

describe('overrideAvailable', () => {
  const NOW2 = 1000;
  test('true only when enabled + status available + future availableUntil', () => {
    expect(overrideAvailable({ enabled: true, status: 'available', availableUntil: 2000 }, NOW2)).toBe(true);
    expect(overrideAvailable({ enabled: true, status: 'available', availableUntil: 500 }, NOW2)).toBe(false); // expired
    expect(overrideAvailable({ enabled: true, status: 'unavailable', availableUntil: 2000 }, NOW2)).toBe(false);
    expect(overrideAvailable({ enabled: false, status: 'available', availableUntil: 2000 }, NOW2)).toBe(false);
    expect(overrideAvailable(null, NOW2)).toBe(false);
    expect(overrideAvailable(undefined, NOW2)).toBe(false);
  });
});

describe('effectiveAvailable', () => {
  const NOW2 = 1000;
  test('uses the override when enabled', () => {
    expect(effectiveAvailable({ enabled: true, status: 'available', availableUntil: 2000 }, 'unavailable', null, NOW2)).toBe(true);
    expect(effectiveAvailable({ enabled: true, status: 'unavailable', availableUntil: null }, 'available', 2000, NOW2)).toBe(false);
  });
  test('falls back to primary when override absent or disabled', () => {
    expect(effectiveAvailable(null, 'available', 2000, NOW2)).toBe(true);
    expect(effectiveAvailable({ enabled: false }, 'available', 2000, NOW2)).toBe(true);
    expect(effectiveAvailable({ enabled: false }, 'available', 500, NOW2)).toBe(false); // primary expired
    expect(effectiveAvailable(undefined, 'unavailable', 2000, NOW2)).toBe(false);
  });
});

describe('buildMessage group titles', () => {
  test('no group → existing titles unchanged', () => {
    expect(buildMessage('knock', 'Bea')).toEqual({ title: 'Bea knocked', body: '' });
    expect(buildMessage('availability', 'Bea')).toEqual({ title: 'Bea is available', body: '' });
  });
  test('with group → "... in {group}"', () => {
    expect(buildMessage('knock', 'Bea', { group: 'Divers' })).toEqual({ title: 'Bea knocked in Divers', body: '' });
    expect(buildMessage('availability', 'Bea', { group: 'Divers' })).toEqual({ title: 'Bea is available in Divers', body: '' });
  });
  test('falsy group → no suffix', () => {
    expect(buildMessage('knock', 'Bea', { group: undefined })).toEqual({ title: 'Bea knocked', body: '' });
    expect(buildMessage('availability', 'Bea', { group: null })).toEqual({ title: 'Bea is available', body: '' });
  });
});

describe('primaryAvailable', () => {
  const NOW2 = 1000;
  test('true only for status available with a future availableUntil', () => {
    expect(primaryAvailable({ status: 'available', availableUntil: 2000 }, NOW2)).toBe(true);
    expect(primaryAvailable({ status: 'available', availableUntil: 500 }, NOW2)).toBe(false); // expired
    expect(primaryAvailable({ status: 'available', availableUntil: null }, NOW2)).toBe(false);
    expect(primaryAvailable({ status: 'unavailable', availableUntil: 2000 }, NOW2)).toBe(false);
    expect(primaryAvailable(null, NOW2)).toBe(false);
    expect(primaryAvailable(undefined, NOW2)).toBe(false);
  });
});

describe('clampName', () => {
  test('clamps to LABEL_MAX then trims (stored display names)', () => {
    expect(clampName('  Ada  ')).toBe('Ada');
    expect(clampName('x'.repeat(200))).toBe('x'.repeat(40));
    // Trailing space landing on the cut point is trimmed AFTER the slice.
    expect(clampName(`${'x'.repeat(39)} y`)).toBe('x'.repeat(39));
    expect(clampName(null)).toBe('');
    expect(clampName(undefined)).toBe('');
    expect(clampName(7)).toBe('7');
  });
});

describe('buildMessage invite titles', () => {
  test('invite with group → "{name} invited you to {group}"', () => {
    expect(buildMessage('invite', 'Bobby', { group: 'Divers' }))
      .toEqual({ title: 'Bobby invited you to Divers', body: '' });
  });
  test('invite without group → generic', () => {
    expect(buildMessage('invite', 'Bobby')).toEqual({ title: 'Bobby invited you to a group', body: '' });
  });
});

describe('time formatters (fixture-pinned, shared with js/utils.js)', () => {
  test.each(vectors)('presence-core time vectors: %j', ({ ms, precise, fuzzy }) => {
    expect(formatTimeRemaining(ms)).toBe(precise);
    expect(formatTimeRemainingFuzzy(ms)).toBe(fuzzy);
  });
});
