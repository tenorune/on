/** @jest-environment node */
const { buildDrawingPayload, applyDrawingPayload } = require('../js/canvasDelta.ts');

describe('buildDrawingPayload', () => {
  test('first send carries everything with base 0', () => {
    const pts = [[0, 0], [0.1, 0.1]];
    expect(buildDrawingPayload(pts, 0, '#fff', 0.01)).toEqual(
      { color: '#fff', thickness: 0.01, points: [[0, 0], [0.1, 0.1]], base: 0 });
  });

  test('subsequent sends carry only the tail since lastSentIndex', () => {
    const pts = [[0, 0], [0.1, 0.1], [0.2, 0.2]];
    const p = buildDrawingPayload(pts, 2, '#fff', 0.01);
    expect(p.base).toBe(2);
    expect(p.points).toEqual([[0.2, 0.2]]);
  });
});

describe('applyDrawingPayload', () => {
  test('base 0 replaces the buffer (new stroke)', () => {
    expect(applyDrawingPayload([[9, 9]], { base: 0, points: [[0, 0]] })).toEqual([[0, 0]]);
  });

  test('base === buffer.length appends', () => {
    expect(applyDrawingPayload([[0, 0]], { base: 1, points: [[0.1, 0.1]] }))
      .toEqual([[0, 0], [0.1, 0.1]]);
  });

  test('missing base (legacy sender) replaces — old cumulative semantics', () => {
    expect(applyDrawingPayload([[9, 9]], { points: [[0, 0], [0.1, 0.1]] }))
      .toEqual([[0, 0], [0.1, 0.1]]);
  });

  test('a gap (skipped intermediate write) still yields a usable buffer', () => {
    // RTDB may coalesce rapid set()s; base can jump past buffer.length.
    expect(applyDrawingPayload([[0, 0]], { base: 3, points: [[0.4, 0.4]] }))
      .toEqual([[0, 0], [0.4, 0.4]]);
  });

  test('null buffer starts fresh from the payload tail', () => {
    expect(applyDrawingPayload(null, { base: 2, points: [[0.2, 0.2]] })).toEqual([[0.2, 0.2]]);
  });
});
