// Pins the committed mirror functions/_shared/geo.js to the same vector table
// the web suite uses — a divergent mirror is a red test, not a prod surprise.
import vectors from '../../test-fixtures/geo-vectors.json' with { type: 'json' };
import { haversineMeters, snapToCell, formatDistancePrecise, formatDistanceCoarse } from '../_shared/geo.js';

test.each(vectors.precise)('precise $m → $text', ({ m, text }) => {
  expect(formatDistancePrecise(m)).toBe(text);
});
test.each(vectors.coarse)('coarse $m → $text', ({ m, text }) => {
  expect(formatDistanceCoarse(m)).toBe(text);
});
test.each(vectors.haversine)('haversine %#', ({ a, b, meters }) => {
  const got = haversineMeters(a[0], a[1], b[0], b[1]);
  if (meters === 0) expect(got).toBe(0);
  else expect(Math.abs(got - meters) / meters).toBeLessThan(0.005);
});
test.each(vectors.snap)('snap %#', ({ in: input, out }) => {
  const got = snapToCell(input[0], input[1]);
  expect(got.lat).toBeCloseTo(out[0], 10);
  expect(got.lng).toBeCloseTo(out[1], 10);
});
