// Durations rendered for a human reading a table, not for a machine.
//
// The panel used to print every age in raw minutes, so a year-old account read
// "525600m ago" — a number an operator has to do arithmetic on before it means
// anything, in the one column they scan to decide whether an account is dead.
import { agoLabel } from '../ops/format.js';

// humanDuration itself is pinned by test-fixtures/time-format-vectors.json in
// both suites (tests/utils.test.js and functions/test/presence-core.test.js) —
// it lives in shared/timeFormat.js with the other duration formatters, not
// here. What this file covers is what the PANEL adds on top of it.

describe('agoLabel', () => {
  const NOW = 1_000_000_000;

  test('an absent timestamp is a dash, not a duration from the epoch', () => {
    expect(agoLabel(null, NOW)).toBe('—');
    expect(agoLabel(undefined, NOW)).toBe('—');
  });

  test('a past timestamp reads as an age', () => {
    expect(agoLabel(NOW - 90 * 60_000, NOW)).toBe('1h 30m ago');
  });

  // A createdAt in the future is a data problem the panel exists to surface.
  // Clamping it to "<1m ago" would hide exactly the anomaly worth seeing.
  test('a future timestamp is not disguised as an age', () => {
    expect(agoLabel(NOW + 90 * 60_000, NOW)).toBe('in 1h 30m');
  });

  test('a non-numeric timestamp is a dash', () => {
    expect(agoLabel('yesterday', NOW)).toBe('—');
    expect(agoLabel(NaN, NOW)).toBe('—');
  });
});
