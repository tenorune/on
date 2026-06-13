// tests/presenceHub.test.js
jest.mock('../js/db.js', () => ({ watchPresence: jest.fn() }));
const { watchPresence } = require('../js/db.js');
const { subscribePresence, _activeWatchCount, _resetPresenceHub } = require('../js/presenceHub.js');

describe('presenceHub', () => {
  let cbs, unsubs;
  beforeEach(() => {
    _resetPresenceHub();
    cbs = {}; unsubs = {};
    watchPresence.mockReset();
    watchPresence.mockImplementation((uid, cb) => {
      cbs[uid] = cb;
      const u = jest.fn();
      unsubs[uid] = u;
      return u;
    });
  });

  test('two consumers of the same uid share ONE underlying watch (#214 R3)', () => {
    subscribePresence('u1', jest.fn());
    subscribePresence('u1', jest.fn());
    expect(watchPresence).toHaveBeenCalledTimes(1);
    expect(_activeWatchCount()).toBe(1);
  });

  test('every consumer receives each tick', () => {
    const a = jest.fn(), b = jest.fn();
    subscribePresence('u1', a);
    subscribePresence('u1', b);
    cbs.u1({ status: 'available' });
    expect(a).toHaveBeenCalledWith({ status: 'available' });
    expect(b).toHaveBeenCalledWith({ status: 'available' });
  });

  test('a late consumer gets the cached value replayed (async, no flash)', async () => {
    subscribePresence('u1', jest.fn());
    cbs.u1({ status: 'available', statusColor: '#abc' });
    const b = jest.fn();
    subscribePresence('u1', b);        // late: underlying watch won't re-fire for it
    expect(b).not.toHaveBeenCalled();  // replay is async
    await Promise.resolve();
    expect(b).toHaveBeenCalledWith({ status: 'available', statusColor: '#abc' });
  });

  test('a synchronous first fire (during watchPresence) reaches the consumer', () => {
    watchPresence.mockImplementation((uid, cb) => { cb({ status: 'available' }); return jest.fn(); });
    const a = jest.fn();
    subscribePresence('u1', a);
    expect(a).toHaveBeenCalledWith({ status: 'available' });
  });

  test('underlying watch is torn down only when the LAST consumer leaves', () => {
    const ua = subscribePresence('u1', jest.fn());
    const ub = subscribePresence('u1', jest.fn());
    ua();
    expect(unsubs.u1).not.toHaveBeenCalled();
    expect(_activeWatchCount()).toBe(1);
    ub();
    expect(unsubs.u1).toHaveBeenCalledTimes(1);
    expect(_activeWatchCount()).toBe(0);
  });

  test('distinct uids get distinct watches', () => {
    subscribePresence('u1', jest.fn());
    subscribePresence('u2', jest.fn());
    expect(watchPresence).toHaveBeenCalledTimes(2);
    expect(_activeWatchCount()).toBe(2);
  });

  test('a consumer that throws during fan-out does not block the others', () => {
    const bad = () => { throw new Error('boom'); };
    const good = jest.fn();
    subscribePresence('u1', bad);
    subscribePresence('u1', good);
    expect(() => cbs.u1({ status: 'available' })).not.toThrow();
    expect(good).toHaveBeenCalledWith({ status: 'available' });
  });
});
