// Leaf-listen contract for watchGroupMeta (audit F3): two exact-path listens
// (name, ownerId) instead of one whole-node listen; the membership-gated
// ownerId listen's cancel is the "gone for me" signal.
const mockPaths = [];
const mockCbs = new Map();    // path → value callback
const mockCancels = new Map(); // path → cancel callback
jest.mock('firebase/database', () => ({
  ref: jest.fn((_db, path) => ({ path })),
  onValue: jest.fn((r, cb, cancel) => {
    mockPaths.push(r.path);
    mockCbs.set(r.path, cb);
    mockCancels.set(r.path, cancel);
    return () => { mockCbs.delete(r.path); mockCancels.delete(r.path); };
  }),
  set: jest.fn(), update: jest.fn(), get: jest.fn(),
  push: jest.fn(), remove: jest.fn(), onChildAdded: jest.fn(),
  query: jest.fn(), orderByKey: jest.fn(), startAfter: jest.fn(),
  runTransaction: jest.fn(), onDisconnect: jest.fn(),
}));
jest.mock('../js/firebase-config.js', () => ({ db: {} }));

const { watchGroupMeta } = require('../js/db/groups.js');
const snap = (val) => ({ exists: () => val !== null && val !== undefined, val: () => val });

beforeEach(() => { mockPaths.length = 0; mockCbs.clear(); mockCancels.clear(); });

test('attaches exactly two leaf listens — never the group root', () => {
  watchGroupMeta('G1', jest.fn());
  expect(mockPaths.sort()).toEqual(['groups/G1/name', 'groups/G1/ownerId']);
});

test('emits merged meta as leaves tick, and name updates re-emit', () => {
  const cb = jest.fn();
  watchGroupMeta('G1', cb);
  mockCbs.get('groups/G1/ownerId')(snap('alice'));
  mockCbs.get('groups/G1/name')(snap('Hikers'));
  expect(cb).toHaveBeenLastCalledWith({ name: 'Hikers', ownerId: 'alice' });
  mockCbs.get('groups/G1/name')(snap('Peak Crew'));
  expect(cb).toHaveBeenLastCalledWith({ name: 'Peak Crew', ownerId: 'alice' });
});

test('ownerId cancel (deletion / kick) emits null, exactly once', () => {
  const cb = jest.fn();
  watchGroupMeta('G1', cb);
  mockCbs.get('groups/G1/name')(snap('Hikers'));
  mockCancels.get('groups/G1/ownerId')();
  expect(cb).toHaveBeenLastCalledWith(null);
});

test('unsubscribe detaches both listens', () => {
  const un = watchGroupMeta('G1', jest.fn());
  un();
  expect(mockCbs.size).toBe(0);
});
