// tests/ownStatus.test.js
let db, initOwnStatus, subscribeOwnStatus;

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../js/db.js', () => ({ watchPresence: jest.fn(() => () => {}) }));
  db = require('../js/db.js');
  ({ initOwnStatus, subscribeOwnStatus } = require('../js/ownStatus.js'));
});

function captureWatch() {
  let cb;
  db.watchPresence.mockImplementation((uid, fn) => { cb = fn; return jest.fn(); });
  return () => cb;
}

test('initOwnStatus opens exactly one watchStatus regardless of subscriber count', () => {
  captureWatch();
  initOwnStatus('me');
  subscribeOwnStatus(jest.fn());
  subscribeOwnStatus(jest.fn());
  subscribeOwnStatus(jest.fn());
  expect(db.watchPresence).toHaveBeenCalledTimes(1);
  expect(db.watchPresence).toHaveBeenCalledWith('me', expect.any(Function));
});

test('a tick fans out to every subscriber in registration order', () => {
  const getCb = captureWatch();
  initOwnStatus('me');
  const calls = [];
  subscribeOwnStatus(() => calls.push('a'));
  subscribeOwnStatus(() => calls.push('b'));
  subscribeOwnStatus(() => calls.push('c'));
  getCb()({ status: 'available' });
  expect(calls).toEqual(['a', 'b', 'c']);
});

test('subscribing after a tick replays the last value immediately', () => {
  const getCb = captureWatch();
  initOwnStatus('me');
  getCb()({ status: 'available', availableUntil: 5 });
  const late = jest.fn();
  subscribeOwnStatus(late);
  expect(late).toHaveBeenCalledWith({ status: 'available', availableUntil: 5 });
});

test('subscribing before any tick does NOT fire (no fabricated value)', () => {
  captureWatch();
  initOwnStatus('me');
  const cb = jest.fn();
  subscribeOwnStatus(cb);
  expect(cb).not.toHaveBeenCalled();
});

test('replays a null tick (user node absent) — null is a real value, not "no tick"', () => {
  const getCb = captureWatch();
  initOwnStatus('me');
  getCb()(null);
  const late = jest.fn();
  subscribeOwnStatus(late);
  expect(late).toHaveBeenCalledWith(null);
});

test('unsubscribe stops further delivery', () => {
  const getCb = captureWatch();
  initOwnStatus('me');
  const cb = jest.fn();
  const unsub = subscribeOwnStatus(cb);
  unsub();
  getCb()({ status: 'available' });
  expect(cb).not.toHaveBeenCalled();
});

test('re-init tears down the previous watch and clears replay', () => {
  const unsub1 = jest.fn();
  db.watchPresence.mockImplementationOnce(() => unsub1);
  initOwnStatus('me');
  // second init
  let cb2;
  db.watchPresence.mockImplementationOnce((uid, fn) => { cb2 = fn; return jest.fn(); });
  initOwnStatus('other');
  expect(unsub1).toHaveBeenCalled();
  // No stale replay from the first watch:
  const late = jest.fn();
  subscribeOwnStatus(late);
  expect(late).not.toHaveBeenCalled();
});

test('a throwing consumer does not abort later consumers', () => {
  const getCb = captureWatch();
  initOwnStatus('me');
  const after = jest.fn();
  subscribeOwnStatus(() => { throw new Error('boom'); });
  subscribeOwnStatus(after);
  getCb()({ status: 'available' });
  expect(after).toHaveBeenCalledWith({ status: 'available' });
});

test('subscribing during fan-out delivers to the new consumer exactly once', () => {
  const getCb = captureWatch();
  initOwnStatus('me');
  const late = jest.fn();
  subscribeOwnStatus(() => { subscribeOwnStatus(late); });
  getCb()({ status: 'available' });
  expect(late).toHaveBeenCalledTimes(1);
  expect(late).toHaveBeenCalledWith({ status: 'available' });
});

test('unsubscribing a not-yet-visited consumer during fan-out skips it', () => {
  const getCb = captureWatch();
  initOwnStatus('me');
  const victim = jest.fn();
  let unsubVictim;
  subscribeOwnStatus(() => { unsubVictim(); }); // first consumer removes the victim
  unsubVictim = subscribeOwnStatus(victim);     // registered after, not yet visited
  getCb()({ status: 'available' });
  expect(victim).not.toHaveBeenCalled();
});
