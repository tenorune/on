// tests/locationHub.test.js — mirrors presenceHub.test.js's harness style.
// Mock './db.js' BEFORE importing the hub, capturing per-path callbacks so
// tests can push location ticks by hand.
jest.mock('../js/db.js', () => {
  const watchers = new Map(); // key: uid or `${gid}/${uid}` → Set<cb>
  return {
    __watchers: watchers,
    watchLocation: jest.fn((uid, cb) => {
      if (!watchers.has(uid)) watchers.set(uid, new Set());
      watchers.get(uid).add(cb);
      return () => watchers.get(uid)?.delete(cb);
    }),
    watchLocationCell: jest.fn((gid, uid, cb) => {
      const key = `${gid}/${uid}`;
      if (!watchers.has(key)) watchers.set(key, new Set());
      watchers.get(key).add(cb);
      return () => watchers.get(key)?.delete(cb);
    }),
  };
});
const db = require('../js/db.js');
const { subscribeDistance, subscribeCellDistance, _activeLocationWatchCount, _resetLocationHub } =
  require('../js/locationHub.js');

const fire = (key, val) => { for (const cb of db.__watchers.get(key) || []) cb(val); };

beforeEach(() => { _resetLocationHub(); db.__watchers.clear(); });

test('emits null until both points exist, then meters', () => {
  const cb = jest.fn();
  subscribeDistance('me', 'peer', cb);
  fire('me', { lat: 52.52, lng: 13.405, updatedAt: 1 });
  expect(cb).toHaveBeenLastCalledWith(null);
  fire('peer', { lat: 52.5205, lng: 13.4055, updatedAt: 1 });
  expect(cb.mock.calls.at(-1)[0]).toBeGreaterThan(50);
  expect(cb.mock.calls.at(-1)[0]).toBeLessThan(80);
});

test('peer going null (stopped publishing) emits null', () => {
  const cb = jest.fn();
  subscribeDistance('me', 'peer', cb);
  fire('me', { lat: 1, lng: 1, updatedAt: 1 });
  fire('peer', { lat: 1, lng: 1.001, updatedAt: 1 });
  fire('peer', null);
  expect(cb).toHaveBeenLastCalledWith(null);
});

test('own node is watched ONCE across N peer subscriptions', () => {
  subscribeDistance('me', 'a', () => {});
  subscribeDistance('me', 'b', () => {});
  subscribeDistance('me', 'c', () => {});
  // 1 own + 3 peers = 4 underlying watches, not 6
  expect(_activeLocationWatchCount()).toBe(4);
});

test('unsubscribe tears down the underlying watch when last consumer leaves', () => {
  const un1 = subscribeDistance('me', 'a', () => {});
  const un2 = subscribeDistance('me', 'a', () => {});
  un1(); un2();
  expect(_activeLocationWatchCount()).toBe(0);
});

test('resubscribing after full teardown opens FRESH underlying watches (no stale node reuse)', () => {
  // Eligibility churn (unavailable → available) closes and reopens distance
  // subs; a listener the server cancelled must never be resurrected from the
  // node cache — the reopen has to create brand-new onValue watches.
  const un = subscribeDistance('me', 'a', () => {});
  const callsAfterFirst = db.watchLocation.mock.calls.length;
  un();
  const cb = jest.fn();
  subscribeDistance('me', 'a', cb);
  expect(db.watchLocation.mock.calls.length).toBe(callsAfterFirst + 2); // me + a, fresh
  expect(cb).not.toHaveBeenCalled(); // and no stale cached value replayed
});

test('cell distance combines per-group cells', () => {
  const cb = jest.fn();
  subscribeCellDistance('G1', 'me', 'peer', cb);
  fire('G1/me', { lat: 52.52, lng: 13.41, updatedAt: 1 });
  fire('G1/peer', { lat: 52.53, lng: 13.42, updatedAt: 1 });
  expect(cb.mock.calls.at(-1)[0]).toBeGreaterThan(1000);
});

test('a late consumer gets the cached distance replayed (async, no flash)', async () => {
  const a = jest.fn();
  subscribeDistance('me', 'peer', a);
  fire('me', { lat: 52.52, lng: 13.405, updatedAt: 1 });
  fire('peer', { lat: 52.5205, lng: 13.4055, updatedAt: 1 });
  expect(a).toHaveBeenCalled(); // a got the distance

  const b = jest.fn();
  subscribeDistance('me', 'peer', b);  // late: underlying watches won't re-fire for it
  expect(b).not.toHaveBeenCalled();    // replay is async
  await Promise.resolve();
  expect(b).toHaveBeenCalled();
  expect(b.mock.calls.at(-1)[0]).toBeGreaterThan(50);
  expect(b.mock.calls.at(-1)[0]).toBeLessThan(80);
});

test('a consumer that throws during fan-out does not block the others', () => {
  const bad = () => { throw new Error('boom'); };
  const good = jest.fn();
  subscribeDistance('me', 'peer', bad);
  subscribeDistance('me', 'peer', good);
  expect(() => {
    fire('me', { lat: 52.52, lng: 13.405, updatedAt: 1 });
    fire('peer', { lat: 52.5205, lng: 13.4055, updatedAt: 1 });
  }).not.toThrow();
  expect(good).toHaveBeenCalled();
});
