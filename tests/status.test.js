// tests/status.test.js
jest.mock('../js/firebase-config.js', () => ({ db: {} }));
jest.mock('firebase/database', () => ({}));

const { isExpired, isAvailable, timeRemainingMs, formatTimeRemaining, formatTimeRemainingFuzzy, formatLastSeen } = require('../js/db');
const { availableForText } = require('../js/utils');

describe('availableForText', () => {
  test('open-ended (null availableUntil) → "Available"', () => {
    expect(availableForText(null)).toBe('Available');
  });
  test('timed window → "Available for <fuzzy>"', () => {
    expect(availableForText(Date.now() + 2 * 3600000)).toMatch(/^Available for .+/);
  });
  test('lapsed window → "Available for just a few minutes" floors to bare "Available"', () => {
    // timeRemainingMs clamps to 0 for a past timestamp → fuzzy '' → bare "Available"
    expect(availableForText(Date.now() - 1000)).toBe('Available');
  });
});

describe('isAvailable', () => {
  test('available + no expiry (null) → true', () => { expect(isAvailable('available', null)).toBe(true); });
  test('available + future window → true', () => { expect(isAvailable('available', Date.now() + 60000)).toBe(true); });
  test('available + lapsed window → false', () => { expect(isAvailable('available', Date.now() - 60000)).toBe(false); });
  test('unavailable status → false even with a future window', () => { expect(isAvailable('unavailable', Date.now() + 60000)).toBe(false); });
  test('missing status → false', () => { expect(isAvailable(undefined, undefined)).toBe(false); });
});

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

// Fuzzy formatter returns a bare duration phrase (no " left" suffix — the caller
// owns that; see db.js convention note).
test('formatTimeRemainingFuzzy returns "just a few minutes" under 5 minutes', () => {
  expect(formatTimeRemainingFuzzy(2 * 60000)).toBe('just a few minutes');
});

test('formatTimeRemainingFuzzy returns "about 15 minutes" for 5–20 minutes', () => {
  expect(formatTimeRemainingFuzzy(10 * 60000)).toBe('about 15 minutes');
});

test('formatTimeRemainingFuzzy returns "about half an hour" for 20–45 minutes', () => {
  expect(formatTimeRemainingFuzzy(30 * 60000)).toBe('about half an hour');
});

test('formatTimeRemainingFuzzy returns "about an hour" for 45–75 minutes', () => {
  expect(formatTimeRemainingFuzzy(60 * 60000)).toBe('about an hour');
});

test('formatTimeRemainingFuzzy returns "one to two hours" for 75–120 minutes', () => {
  expect(formatTimeRemainingFuzzy(90 * 60000)).toBe('one to two hours');
});

test('formatTimeRemainingFuzzy returns "just over N hours" when close above a whole hour', () => {
  expect(formatTimeRemainingFuzzy(2.1 * 3600000)).toBe('just over two hours');
});

test('formatTimeRemainingFuzzy returns "about N hours" for the middle of an hour band', () => {
  expect(formatTimeRemainingFuzzy(2.4 * 3600000)).toBe('about two hours');
});

test('formatTimeRemainingFuzzy returns "nearly N hours" when close below a whole hour', () => {
  expect(formatTimeRemainingFuzzy(2.8 * 3600000)).toBe('nearly three hours');
});

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

// ─────────────────────────────────────────────────────────────────────────────
// js/status.ts — the effective-status selector + CHIP_VALUES table extracted
// from the four hand-duplicated merge sites (groupNav.paintNavCard,
// groupContext.memberEffectiveAvailable/paintRosterRow/renderOwnStatusRow) and
// the CHIP_VALUES copies in me.ts/groupContext.ts. These pin the behavior BEFORE
// the sites are rewired to call the selector; all four agreed on the rule below.
const { effectiveStatus, CHIP_VALUES, chipIndexForMinutes } = require('../js/status');

describe('effectiveStatus — the single override-vs-primary merge', () => {
  const future = () => Date.now() + 60000;
  const past = () => Date.now() - 60000;

  describe('primary only (no override, or override disabled)', () => {
    test('primary available (future window) → available, primary fields', () => {
      const p = { status: 'available', availableUntil: future(), statusColor: '#abc', paletteKey: 'k1' };
      expect(effectiveStatus(p, null)).toEqual({
        available: true, statusColor: '#abc', paletteKey: 'k1', availableUntil: p.availableUntil,
      });
    });
    test('primary available (open-ended null window) → available (client fail-open)', () => {
      const p = { status: 'available', availableUntil: null };
      expect(effectiveStatus(p, null)).toEqual({
        available: true, statusColor: null, paletteKey: null, availableUntil: null,
      });
    });
    test('primary available but window lapsed → unavailable', () => {
      const p = { status: 'available', availableUntil: past() };
      expect(effectiveStatus(p, null).available).toBe(false);
    });
    test('primary unavailable → unavailable', () => {
      expect(effectiveStatus({ status: 'unavailable', availableUntil: future() }, null).available).toBe(false);
    });
    test('both null → all-null / not available', () => {
      expect(effectiveStatus(null, null)).toEqual({
        available: false, statusColor: null, paletteKey: null, availableUntil: null,
      });
    });
    test('override present but enabled:false is ignored → primary wins', () => {
      const p = { status: 'available', availableUntil: future(), statusColor: '#p' };
      const ov = { enabled: false, status: 'unavailable', availableUntil: null, statusColor: '#o' };
      expect(effectiveStatus(p, ov)).toEqual({
        available: true, statusColor: '#p', paletteKey: null, availableUntil: p.availableUntil,
      });
    });
    test('override with enabled undefined (not === true) is ignored → primary wins', () => {
      const p = { status: 'available', availableUntil: future(), statusColor: '#p' };
      const ov = { status: 'available', availableUntil: future(), statusColor: '#o' };
      expect(effectiveStatus(p, ov).statusColor).toBe('#p');
    });
  });

  describe('override enabled — taken wholesale, primary never mixed in', () => {
    test('override-on available → override fields, not primary', () => {
      const p = { status: 'unavailable', availableUntil: null, statusColor: '#p', paletteKey: 'kp' };
      const ov = { enabled: true, status: 'available', availableUntil: future(), statusColor: '#o', paletteKey: 'ko' };
      expect(effectiveStatus(p, ov)).toEqual({
        available: true, statusColor: '#o', paletteKey: 'ko', availableUntil: ov.availableUntil,
      });
    });
    test('override-on unavailable → unavailable, override color kept', () => {
      const p = { status: 'available', availableUntil: future(), statusColor: '#p' };
      const ov = { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#o' };
      expect(effectiveStatus(p, ov)).toEqual({
        available: false, statusColor: '#o', paletteKey: null, availableUntil: null,
      });
    });
    test('override-on with paletteKey null does NOT fall through to primary theme', () => {
      const p = { status: 'available', availableUntil: future(), statusColor: '#p', paletteKey: 'kp' };
      const ov = { enabled: true, status: 'available', availableUntil: future(), statusColor: '#o', paletteKey: null };
      expect(effectiveStatus(p, ov).paletteKey).toBeNull();
    });
    // Tripwire: an enabled-but-expired override renders UNAVAILABLE and is not
    // replaced by the primary — matches every current site. The input is
    // unreachable (no writer emits an expired override); this fires loudly if
    // one ever does.
    test('override-on but window lapsed → unavailable, primary NOT revealed', () => {
      const p = { status: 'available', availableUntil: future(), statusColor: '#p' };
      const ov = { enabled: true, status: 'available', availableUntil: past(), statusColor: '#o' };
      expect(effectiveStatus(p, ov)).toEqual({
        available: false, statusColor: '#o', paletteKey: null, availableUntil: ov.availableUntil,
      });
    });
  });
});

describe('CHIP_VALUES / chipIndexForMinutes', () => {
  test('table has 11 entries, first is 30 minutes', () => {
    expect(CHIP_VALUES).toHaveLength(11);
    expect(CHIP_VALUES[0]).toEqual({ minutes: 30, text: '30 minutes' });
    expect(CHIP_VALUES[3]).toEqual({ minutes: 120, text: '2 hours' });
  });
  test('exact match returns that index', () => {
    expect(chipIndexForMinutes(120)).toBe(3);
    expect(chipIndexForMinutes(1440)).toBe(10);
  });
  test('nearest match when between chips', () => {
    expect(chipIndexForMinutes(100)).toBe(2); // 100 is 10 from 90, 20 from 120 → 90 (index 2)
    expect(chipIndexForMinutes(75)).toBe(1);  // 75 equidistant 60/90 → first-found (strict <) keeps 60 (index 1)
  });
  test('legacy sub-13 values are treated as hours (×60)', () => {
    expect(chipIndexForMinutes(2)).toBe(3);   // 2h → 120 min → index 3
    expect(chipIndexForMinutes(1)).toBe(1);   // 1h → 60 min → index 1
  });
});
