// Durations rendered for a human reading a table, not for a machine.
//
// The panel used to print every age in raw minutes, so a year-old account read
// "525600m ago" — a number an operator has to do arithmetic on before it means
// anything, in the one column they scan to decide whether an account is dead.
import { humanDuration, agoLabel } from '../ops/format.js';

describe('humanDuration', () => {
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  test('under a minute does not claim a whole minute', () => {
    expect(humanDuration(0)).toBe('<1m');
    expect(humanDuration(59 * SEC)).toBe('<1m');
  });

  test('minutes up to an hour', () => {
    expect(humanDuration(MIN)).toBe('1m');
    expect(humanDuration(59 * MIN)).toBe('59m');
  });

  // The operator's cutoff: past an hour, minutes stop being the useful unit.
  test('hours and minutes up to a day', () => {
    expect(humanDuration(HOUR)).toBe('1h 0m');
    expect(humanDuration(HOUR + 30 * MIN)).toBe('1h 30m');
    expect(humanDuration(23 * HOUR + 59 * MIN)).toBe('23h 59m');
  });

  test('days and hours beyond that', () => {
    expect(humanDuration(DAY)).toBe('1d 0h');
    expect(humanDuration(15 * DAY + 4 * HOUR)).toBe('15d 4h');
  });

  // 22145 minutes was the real reading that prompted this.
  test('the reading that prompted the change is legible', () => {
    expect(humanDuration(22145 * MIN)).toBe('15d 9h');
  });
});

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
