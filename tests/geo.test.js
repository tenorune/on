/** @jest-environment node */
// Pins shared/geo.js behavior to test-fixtures/geo-vectors.json — the same
// table functions/test/geo.test.js pins the mirror to (parity discipline,
// like time-format-vectors.json).
const vectors = require('../test-fixtures/geo-vectors.json');
const { haversineMeters, snapToCell, formatDistancePrecise, formatDistanceCoarse } =
  require('../shared/geo.js');

describe('haversineMeters', () => {
  test.each(vectors.haversine)('%# distance', ({ a, b, meters }) => {
    const got = haversineMeters(a[0], a[1], b[0], b[1]);
    if (meters === 0) expect(got).toBe(0);
    else expect(Math.abs(got - meters) / meters).toBeLessThan(0.005);
  });
});

describe('snapToCell', () => {
  test.each(vectors.snap)('%# snap', ({ in: input, out }) => {
    const got = snapToCell(input[0], input[1]);
    expect(got.lat).toBeCloseTo(out[0], 10);
    expect(got.lng).toBeCloseTo(out[1], 10);
  });
});

describe('formatDistancePrecise', () => {
  test.each(vectors.precise)('%# $m → $text', ({ m, text }) => {
    expect(formatDistancePrecise(m)).toBe(text);
  });
});

describe('formatDistanceCoarse', () => {
  test.each(vectors.coarse)('%# $m → $text', ({ m, text }) => {
    expect(formatDistanceCoarse(m)).toBe(text);
  });
});
