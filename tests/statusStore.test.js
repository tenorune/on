// tests/statusStore.test.js — the subscribable merged-status core (roadmap Task
// 2.2). Modeled on presenceHub: ref-counted underlying watches, last-value
// cache, async replay to late subscribers, synchronous pushOptimistic fan-out,
// _forTests reset. Lands dark (no consumers yet); 2.3 extends this suite.
//
// Harness: mock ../js/db.js so both watchPresence (used by the REAL presenceHub,
// which statusStore consumes for the own primary) and watchOwnMemberOverride are
// controllable. Each mock captures the callback + hands back a jest.fn() unsub.
jest.mock('../js/db.js', () => ({
  __esModule: true,
  watchPresence: jest.fn(),
  watchOwnMemberOverride: jest.fn(),
}));

const db = require('../js/db');
const {
  initStatusStore,
  subscribeOwnStatus,
  subscribeOwnOverride,
  getOwnOverride,
  setWatchedGroups,
  pushOptimistic,
  _resetStatusStoreForTests,
} = require('../js/statusStore');
const { _resetPresenceHub } = require('../js/presenceHub');

const flush = () => new Promise((r) => setTimeout(r, 0));
const future = () => Date.now() + 60000;

let primaryCb, primaryUnsub;
let overrideCbs, overrideUnsubs;

beforeEach(() => {
  jest.clearAllMocks();
  overrideCbs = {};
  overrideUnsubs = {};
  db.watchPresence.mockImplementation((uid, cb) => {
    primaryCb = cb;
    primaryUnsub = jest.fn();
    return primaryUnsub;
  });
  db.watchOwnMemberOverride.mockImplementation((gid, uid, cb) => {
    overrideCbs[gid] = cb;
    overrideUnsubs[gid] = jest.fn();
    return overrideUnsubs[gid];
  });
  _resetStatusStoreForTests();
  _resetPresenceHub();
  initStatusStore('me');
});

const firePrimary = (v) => primaryCb(v);
const fireOverride = (gid, v) => overrideCbs[gid](v);
// Which groups' underlying watchOwnMemberOverride unsubs have fired, sorted.
const unsubsCalledFor = () =>
  Object.keys(overrideUnsubs)
    .filter((gid) => overrideUnsubs[gid].mock.calls.length > 0)
    .sort();

describe('subscribeOwnStatus — watch lifecycle', () => {
  test('first subscriber lazily creates the primary + group override watches', () => {
    expect(db.watchPresence).not.toHaveBeenCalled();
    subscribeOwnStatus('G1', () => {});
    expect(db.watchPresence).toHaveBeenCalledTimes(1);
    expect(db.watchOwnMemberOverride).toHaveBeenCalledWith('G1', 'me', expect.any(Function));
  });

  test('Direct context (null groupId) tracks the primary only — no override watch', () => {
    const seen = [];
    subscribeOwnStatus(null, (s) => seen.push(s));
    expect(db.watchOwnMemberOverride).not.toHaveBeenCalled();
    firePrimary({ status: 'available', availableUntil: future(), statusColor: '#p' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ available: true, statusColor: '#p', source: 'primary' });
  });

  test('underlying watches are ref-counted; torn down only on last unsubscribe', () => {
    const u1 = subscribeOwnStatus('G1', () => {});
    const u2 = subscribeOwnStatus('G1', () => {});
    u1();
    expect(primaryUnsub).not.toHaveBeenCalled();
    expect(overrideUnsubs['G1']).not.toHaveBeenCalled();
    u2();
    expect(primaryUnsub).toHaveBeenCalledTimes(1);
    expect(overrideUnsubs['G1']).toHaveBeenCalledTimes(1);
  });
});

describe('subscribeOwnStatus — merged snapshot', () => {
  test('emits a merged snapshot once BOTH primary and override have ticked', () => {
    const seen = [];
    subscribeOwnStatus('G1', (s) => seen.push(s));
    firePrimary({ status: 'available', availableUntil: future(), statusColor: '#p' });
    expect(seen).toHaveLength(0); // override not ticked → not yet computable
    fireOverride('G1', { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#o' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ available: false, statusColor: '#o', source: 'override' });
  });

  test('override disabled → primary wins, source is primary', () => {
    const seen = [];
    subscribeOwnStatus('G1', (s) => seen.push(s));
    firePrimary({ status: 'available', availableUntil: future(), statusColor: '#p' });
    fireOverride('G1', { enabled: false });
    expect(seen[seen.length - 1]).toMatchObject({ available: true, statusColor: '#p', source: 'primary' });
  });
});

describe('replay semantics', () => {
  test('late subscriber replays the cached snapshot asynchronously', async () => {
    subscribeOwnStatus('G1', () => {});
    firePrimary({ status: 'available', availableUntil: future() });
    fireOverride('G1', null);
    const late = [];
    subscribeOwnStatus('G1', (s) => late.push(s));
    expect(late).toHaveLength(0); // async — nothing synchronously
    await flush();
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ available: true, source: 'primary' });
  });

  test('a subscriber added before any tick gets nothing (never a fabricated snapshot)', async () => {
    const seen = [];
    subscribeOwnStatus('G1', (s) => seen.push(s));
    await flush();
    expect(seen).toHaveLength(0);
  });
});

describe('pushOptimistic', () => {
  test('fans out synchronously, merges the partial, and is superseded by the next server tick', () => {
    const seen = [];
    subscribeOwnStatus('G1', (s) => seen.push(s));
    firePrimary({ status: 'available', availableUntil: future() });
    fireOverride('G1', { enabled: true, status: 'available', availableUntil: future(), statusColor: '#o' });
    const n = seen.length;

    pushOptimistic('G1', { status: 'unavailable', availableUntil: null });
    expect(seen).toHaveLength(n + 1); // synchronous
    expect(seen[seen.length - 1]).toMatchObject({ available: false, source: 'override' });
    expect(seen[seen.length - 1].statusColor).toBe('#o'); // statusColor survived the partial merge

    fireOverride('G1', { enabled: true, status: 'available', availableUntil: future(), statusColor: '#o' });
    expect(seen[seen.length - 1]).toMatchObject({ available: true, source: 'override' }); // echo wins
  });

  test('an optimistic write before any server tick marks the group ticked (create-group seed)', () => {
    const seen = [];
    subscribeOwnStatus('G3', (s) => seen.push(s));
    firePrimary({ status: 'unavailable', availableUntil: null });
    expect(seen).toHaveLength(0); // override not ticked yet
    pushOptimistic('G3', { enabled: true, status: 'unavailable', availableUntil: null });
    expect(seen).toHaveLength(1); // optimistic write is a legitimate first value
    expect(seen[0]).toMatchObject({ source: 'override' });
  });

  test('pushOptimistic on Direct (null) is a no-op', () => {
    const seen = [];
    subscribeOwnStatus(null, (s) => seen.push(s));
    firePrimary({ status: 'available', availableUntil: future() });
    const n = seen.length;
    pushOptimistic(null, { status: 'unavailable' });
    expect(seen).toHaveLength(n);
  });
});

describe('re-entrancy', () => {
  test('a subscriber that unsubscribes a peer mid-fan-out does not skip the survivors', () => {
    const order = [];
    let uB;
    subscribeOwnStatus('G1', () => { order.push('A'); uB(); }); // A drops B during fan-out
    uB = subscribeOwnStatus('G1', () => { order.push('B'); });
    subscribeOwnStatus('G1', () => { order.push('C'); });

    firePrimary({ status: 'available', availableUntil: future() });
    order.length = 0; // ignore anything before the override tick
    fireOverride('G1', { enabled: false });

    // Copy-the-set guard: B was removed mid-iteration → skipped; C still fires.
    expect(order).toEqual(['A', 'C']);
  });
});

// ── Task 2.3: the RAW own-override surface ────────────────────────────────────
// groupNav/groupContext click handlers read override fields directly and drive
// the underlying watches by enumeration (setWatchedGroups) ∪ their own consumers.
// The raw surface caches the override (OverrideInput — carries statusColor/
// paletteKey per baked decision (c)), merges optimistic partials into it, replays
// synchronously (unlike the async snapshot replay), and fans out to raw consumers.
describe('raw override surface', () => {
  test('pushOptimistic merges partials — statusColor survives a status flip', () => {
    setWatchedGroups(['G1']);
    fireOverride('G1', { enabled: true, status: 'available', availableUntil: 99, statusColor: '#abc' });
    pushOptimistic('G1', { status: 'unavailable', availableUntil: null });
    expect(getOwnOverride('G1')).toEqual(
      { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#abc' });
  });

  test('pushOptimistic fans out synchronously to raw consumers', () => {
    const seen = [];
    subscribeOwnOverride('G1', (o) => seen.push(o));
    fireOverride('G1', { enabled: false });
    pushOptimistic('G1', { enabled: true, status: 'unavailable', availableUntil: null });
    expect(seen).toHaveLength(2);        // tick fan-out + optimistic fan-out
    expect(seen[1].enabled).toBe(true);  // delivered before pushOptimistic returned
  });

  test('server tick overwrites optimistic wholesale (last-writer-wins)', () => {
    setWatchedGroups(['G1']);
    pushOptimistic('G1', { enabled: true, statusColor: '#abc' });
    fireOverride('G1', { enabled: true, status: 'unavailable', availableUntil: null });
    expect(getOwnOverride('G1')).toEqual({ enabled: true, status: 'unavailable', availableUntil: null });
  });

  test('no replay before first tick; a real null replays after (never a fabricated null)', () => {
    const seen = [];
    subscribeOwnOverride('G2', (o) => seen.push(o));
    expect(seen).toHaveLength(0);        // not ticked → no replay
    fireOverride('G2', null);
    const late = [];
    subscribeOwnOverride('G2', (o) => late.push(o));
    expect(late).toEqual([null]);        // real null replays synchronously
  });

  test('optimistic write before any server tick marks the group ticked (create-group seed)', () => {
    pushOptimistic('G3', { enabled: true, status: 'unavailable', availableUntil: null });
    const seen = [];
    subscribeOwnOverride('G3', (o) => seen.push(o));
    expect(seen).toHaveLength(1);        // optimistic seed is a legitimate first value
  });

  test('setWatchedGroups ∪ consumers drives underlying subs', () => {
    setWatchedGroups(['A', 'B']);
    expect(db.watchOwnMemberOverride).toHaveBeenCalledTimes(2);
    const unsub = subscribeOwnOverride('C', () => {}); // consumer-only group
    expect(db.watchOwnMemberOverride).toHaveBeenCalledTimes(3);
    setWatchedGroups(['A']);              // B dropped, C kept (consumer)
    expect(unsubsCalledFor()).toEqual(['B']);
    unsub();                             // C's last consumer leaves
    expect(unsubsCalledFor()).toEqual(['B', 'C']);
  });
});
