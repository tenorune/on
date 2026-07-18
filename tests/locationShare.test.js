// Capture-loop contract for js/locationShare.ts. Geolocation is mocked at
// navigator.geolocation; db at the './db.js' barrel; prefs real (jsdom
// localStorage). Fake timers drive the 60s cadence.
jest.mock('../js/db.js', () => ({
  publishLocation: jest.fn().mockResolvedValue(undefined),
  publishLocationCell: jest.fn().mockResolvedValue(undefined),
  clearLocationData: jest.fn().mockResolvedValue(undefined),
  clearLocationCells: jest.fn().mockResolvedValue(undefined),
  isAvailable: (status, until) => status === 'available' && (until == null || until > Date.now()),
  mergeUserPrefs: jest.fn().mockResolvedValue(undefined),
  readPushTokens: jest.fn().mockResolvedValue(null),
}));
jest.mock('../js/telegram.js', () => ({ isTelegramContext: () => false }));
jest.mock('../js/ownStatus.js', () => {
  let cbs = [];
  return {
    subscribeOwnStatus: jest.fn((cb) => { cbs.push(cb); return () => { cbs = cbs.filter(c => c !== cb); }; }),
    __fireOwnStatus: (presence) => cbs.forEach(c => c(presence)),
  };
});

const db = require('../js/db.js');
const ownStatus = require('../js/ownStatus.js');
const prefs = require('../js/prefs.js');

const POS = { coords: { latitude: 52.52, longitude: 13.405 } };
let geoBehavior;

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  jest.clearAllMocks();
  geoBehavior = (ok, err) => ok(POS);
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: jest.fn((ok, err) => geoBehavior(ok, err)) },
  });
  prefs.initPrefs('me');
});
afterEach(() => {
  const { _resetLocationShare } = require('../js/locationShare.js');
  _resetLocationShare();
  jest.useRealTimers();
});

// Fresh module instance per test-file run is fine; state resets via _resetLocationShare.
const share = () => require('../js/locationShare.js');

async function flush() { await Promise.resolve(); await Promise.resolve(); }

test('no publish while nothing is opted in, even when available', async () => {
  const { initLocationShare } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await flush();
  expect(db.publishLocation).not.toHaveBeenCalled();
});

test('toggleContext dispatches location-optin-changed with the context, on both the on and off branches', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  const seen = [];
  document.addEventListener('location-optin-changed', (e) => seen.push(e.detail.context));
  await toggleContext('direct'); // on-branch
  await flush();
  await toggleContext('direct'); // off-branch
  await flush();
  expect(seen).toEqual(['direct', 'direct']);
});

test('direct opt-in + available publishes raw point immediately and every 60s', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await expect(toggleContext('direct')).resolves.toBe('on');
  await flush();
  expect(db.publishLocation).toHaveBeenCalledWith('me', 52.52, 13.405, expect.any(Number));
  // First enable must publish exactly once — reconcile()->startLoop() already
  // runs an immediate tick; a second explicit tick would double-publish.
  expect(db.publishLocation).toHaveBeenCalledTimes(1);
  db.publishLocation.mockClear();
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.publishLocation).toHaveBeenCalledTimes(1);
});

test('enabling a second context while the loop runs still publishes that context immediately', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  db.publishLocationCell.mockClear();
  // Loop is already running (startLoop() is a no-op here), so the explicit
  // tick in toggleContext's on-branch is the ONLY tick for this enable.
  await expect(toggleContext('G1')).resolves.toBe('on');
  await flush();
  expect(db.publishLocationCell).toHaveBeenCalledWith('G1', 'me', 52.52, 13.405, expect.any(Number));
  expect(db.publishLocationCell).toHaveBeenCalledTimes(1);
});

test('toggling direct off with a group still opted in clears only the raw point and keeps the loop running', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  await toggleContext('G1');
  await flush();
  db.clearLocationData.mockClear();
  db.publishLocation.mockClear();
  db.publishLocationCell.mockClear();
  await expect(toggleContext('direct')).resolves.toBe('off');
  await flush();
  // The raw point must be cleared — the invariant is that locations/{uid}
  // exists ONLY while 'direct' is opted in, and G1 remains opted in so no
  // "last context off" or per-group clear runs otherwise.
  expect(db.clearLocationData).toHaveBeenCalledWith('me', []);
  // The loop itself must still be running for the surviving group.
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.publishLocationCell).toHaveBeenCalled();
  expect(db.publishLocation).not.toHaveBeenCalled();
});

test('group opt-in publishes that cell, not the raw point', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await expect(toggleContext('G1')).resolves.toBe('on');
  await flush();
  expect(db.publishLocationCell).toHaveBeenCalledWith('G1', 'me', 52.52, 13.405, expect.any(Number));
  expect(db.publishLocation).not.toHaveBeenCalled();
});

test('going unavailable clears published data and stops the loop', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  await flush();
  expect(db.clearLocationData).toHaveBeenCalledWith('me', []);
  db.publishLocation.mockClear();
  jest.advanceTimersByTime(120000);
  await flush();
  expect(db.publishLocation).not.toHaveBeenCalled();
  // …and the opt-in pref SURVIVES (publishing resumes on next available)
  expect(prefs.getLocationOptIn('direct')).toBe(true);
});

test('location-publishing-changed fires on every availability transition, including in-tick expiry', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  let fired = 0;
  document.addEventListener('location-publishing-changed', () => { fired++; });
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  expect(fired).toBe(0); // no transition — stayed unavailable
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 60000 });
  expect(fired).toBe(1); // up-flip
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  expect(fired).toBe(2); // down-flip via presence tick
  await toggleContext('direct');
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 60000 });
  expect(fired).toBe(3);
  jest.advanceTimersByTime(60000); // window lapses — down-flip via in-tick expiry
  await flush();
  expect(fired).toBe(4);
});

test('availability window expiring mid-session stops publishing and clears — no presence tick needed', async () => {
  // Expiry is a TIME event, not a data event: no presence snapshot arrives
  // when the window lapses while foreground. The loop must re-evaluate
  // isAvailable(status, availableUntil) per tick off the stored snapshot.
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 60000 });
  await toggleContext('direct');
  await flush();
  expect(db.publishLocation).toHaveBeenCalledTimes(1);
  db.publishLocation.mockClear();
  jest.advanceTimersByTime(180000); // window lapsed at +60s; NO presence tick fires
  await flush();
  expect(db.clearLocationData).toHaveBeenCalledWith('me', []);
  expect(db.publishLocation).not.toHaveBeenCalled();
  // Loop is stopped — later timer advances publish nothing either.
  jest.advanceTimersByTime(120000);
  await flush();
  expect(db.publishLocation).not.toHaveBeenCalled();
});

test('toggling the last context off clears data', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  await expect(toggleContext('direct')).resolves.toBe('off');
  await flush();
  expect(db.clearLocationData).toHaveBeenCalled();
});

test('permission denial returns denied, flips the pref back off, and clears', async () => {
  geoBehavior = (ok, err) => err({ code: 1 }); // PERMISSION_DENIED
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await expect(toggleContext('direct')).resolves.toBe('denied');
  expect(prefs.getLocationOptIn('direct')).toBe(false);
  expect(db.publishLocation).not.toHaveBeenCalled();
});

test('a failed tick is silent — no clear, loop continues', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  geoBehavior = (ok, err) => err({ code: 3 }); // TIMEOUT
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.clearLocationData).not.toHaveBeenCalled();
  geoBehavior = (ok) => ok(POS);
  db.publishLocation.mockClear();
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.publishLocation).toHaveBeenCalledTimes(1);
});

test('toggling one of several contexts off clears just that cell — cells-only, raw point untouched', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  await toggleContext('G1');
  await flush();
  db.publishLocation.mockClear();
  db.clearLocationData.mockClear();
  db.clearLocationCells.mockClear();
  await expect(toggleContext('G1')).resolves.toBe('off');
  await flush();
  // Only G1's cell is cleared, via the cells-only helper — locations/{uid} is
  // never touched (a transient raw-point delete cancels every peer's
  // reciprocity-gated listener and races the republish on real infra).
  expect(db.clearLocationCells).toHaveBeenCalledWith('me', ['G1']);
  expect(db.clearLocationData).not.toHaveBeenCalled();
  // No compensating republish needed — the raw point never went away.
  expect(db.publishLocation).not.toHaveBeenCalled();
  // Direct keeps publishing on the next tick.
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.publishLocation).toHaveBeenCalledWith('me', 52.52, 13.405, expect.any(Number));
});

test('toggling off the last context — a group, not direct — still clears its cell', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('G1');
  await flush();
  db.clearLocationData.mockClear();
  await expect(toggleContext('G1')).resolves.toBe('off');
  await flush();
  // Must include 'G1' — the pref flips to off before this call, so a naive
  // read of the (now post-toggle) opted-in list would drop it and orphan
  // the cell in locationCells/G1/me.
  expect(db.clearLocationData).toHaveBeenCalledWith('me', ['G1']);
});

test('hidden document pauses ticks; visible resumes with an immediate tick', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  db.publishLocation.mockClear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  jest.advanceTimersByTime(180000);
  await flush();
  expect(db.publishLocation).not.toHaveBeenCalled();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  await flush();
  expect(db.publishLocation).toHaveBeenCalledTimes(1);
});
