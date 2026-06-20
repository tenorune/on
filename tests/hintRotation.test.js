// tests/hintRotation.test.js
const { resolvePool, selectNextHint, isPaused } = require('../js/hintRotation.js');

describe('resolvePool', () => {
  const vis = (set) => (id) => set.has(id);

  test('returns only available ids when any visible candidate is available', () => {
    const cands = [
      { id: 'a', available: false },
      { id: 'b', available: true },
      { id: 'c', available: true },
    ];
    expect(resolvePool(cands, vis(new Set(['a', 'b', 'c'])))).toEqual(['b', 'c']);
  });

  test('falls back to visible unavailable ids when none visible is available', () => {
    const cands = [
      { id: 'a', available: false },
      { id: 'b', available: false },
    ];
    expect(resolvePool(cands, vis(new Set(['a', 'b'])))).toEqual(['a', 'b']);
  });

  test('an available-but-offscreen candidate does not block a visible unavailable one', () => {
    const cands = [
      { id: 'off', available: true },   // not visible
      { id: 'on', available: false },   // visible
    ];
    expect(resolvePool(cands, vis(new Set(['on'])))).toEqual(['on']);
  });

  test('returns empty when nothing is visible', () => {
    const cands = [{ id: 'a', available: true }];
    expect(resolvePool(cands, vis(new Set()))).toEqual([]);
  });

  test('preserves input order', () => {
    const cands = [
      { id: 'x', available: true },
      { id: 'y', available: true },
    ];
    expect(resolvePool(cands, vis(new Set(['x', 'y'])))).toEqual(['x', 'y']);
  });
});

describe('selectNextHint', () => {
  const fresh = () => ({ lastType: null, lastIds: { longpress: null, swipe: null } });

  test('returns {type:null} when both pools are empty', () => {
    const r = selectNextHint(fresh(), { longpress: [], swipe: [] });
    expect(r.type).toBeNull();
    expect(r.id).toBeNull();
  });

  test('single non-empty pool: no type flip, round-robins and wraps', () => {
    let s = fresh();
    let r = selectNextHint(s, { longpress: ['a', 'b'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'a']);
    r = selectNextHint(r.state, { longpress: ['a', 'b'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'b']);
    r = selectNextHint(r.state, { longpress: ['a', 'b'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'a']); // wrap
  });

  test('both pools: type alternates every step', () => {
    let r = selectNextHint(fresh(), { longpress: ['a'], swipe: ['a'] });
    const types = [r.type];
    for (let i = 0; i < 3; i++) {
      r = selectNextHint(r.state, { longpress: ['a'], swipe: ['a'] });
      types.push(r.type);
    }
    expect(types).toEqual(['longpress', 'swipe', 'longpress', 'swipe']);
  });

  test('each type round-robins its OWN list independently while alternating', () => {
    const pools = { longpress: ['A', 'C'], swipe: ['A', 'B', 'C'] };
    let r = selectNextHint(fresh(), pools);
    const seq = [[r.type, r.id]];
    for (let i = 0; i < 5; i++) {
      r = selectNextHint(r.state, pools);
      seq.push([r.type, r.id]);
    }
    expect(seq).toEqual([
      ['longpress', 'A'],
      ['swipe', 'A'],
      ['longpress', 'C'],
      ['swipe', 'B'],
      ['longpress', 'A'],
      ['swipe', 'C'],
    ]);
  });

  test('round-robin is identity-stable when the pool reorders between calls', () => {
    let r = selectNextHint(fresh(), { longpress: ['A', 'B'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'A']);
    // same order → advance to B
    r = selectNextHint(r.state, { longpress: ['A', 'B'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'B']);
    // pool reordered to ['B','A']: advance to the card AFTER last-shown 'B'
    // in the CURRENT order, which wraps to 'A' (must NOT repeat 'B').
    r = selectNextHint(r.state, { longpress: ['B', 'A'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'A']);
  });

  test('restarts at index 0 when the last-shown id is gone from the pool', () => {
    let r = selectNextHint(fresh(), { longpress: ['A', 'B'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'A']);
    // 'A' removed; last-shown 'A' absent → restart at index 0 of current pool.
    r = selectNextHint(r.state, { longpress: ['B', 'C'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'B']);
  });
});

describe('isPaused', () => {
  const none = { overlayOpen: false, callActive: false, hidden: false, scrolling: false };
  test('false when nothing is set', () => { expect(isPaused(none)).toBe(false); });
  test('true if any single flag is set', () => {
    for (const k of ['overlayOpen', 'callActive', 'hidden', 'scrolling']) {
      expect(isPaused({ ...none, [k]: true })).toBe(true);
    }
  });
});
