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
  delete global.navigator.permissions; // tests that install a Permissions API mock
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

// Eligibility must key off "own node actually published this tick's spell",
// not the raw available-status flip: the flip races the async publish chain
// (permission check -> getPositionOnce() -> write RTT), and a distance
// listener attached before locations/{me} exists gets rules-denied and
// permanently cancelled by the SDK. So: down-flips (nothing to race — the
// node is torn down synchronously) still dispatch immediately, but up-flips
// must wait for the tick's publish to actually land.
test('location-publishing-changed: down-flips dispatch synchronously with the status flip; up-flips wait for the tick publish to resolve', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  let fired = 0;
  document.addEventListener('location-publishing-changed', () => { fired++; });

  // No opt-in at all: up-flip has nothing to publish, so no dispatch — this
  // is the key RED-before-fix assertion (old code dispatched synchronously
  // off the status flip alone, regardless of opt-in/publish).
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  expect(fired).toBe(0); // NOT dispatched synchronously with the status flip
  await flush();
  expect(fired).toBe(0); // still nothing — no opt-in means no publish ever lands

  // Opt in while available: the tick fires and publishes; dispatch happens
  // only once that publish resolves, not synchronously with the opt-in call.
  await toggleContext('direct');
  await flush();
  expect(fired).toBe(1); // dispatched once the tick's publish landed

  // Down-flip via presence tick: teardown is synchronous, so this dispatches
  // immediately with the status flip (no async chain to wait on).
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  expect(fired).toBe(2);

  // Up-flip again (opt-in pref survived teardown): NOT dispatched
  // synchronously with the flip...
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 60000 });
  expect(fired).toBe(2);
  // ...only once the republish resolves.
  await flush();
  expect(fired).toBe(3);

  // In-tick expiry (down-flip with no presence tick involved): still
  // synchronous teardown -> dispatch, same as any other down-flip.
  jest.advanceTimersByTime(60000);
  await flush();
  expect(fired).toBe(4);
});

test('toggleContext on-branch dispatches location-publishing-changed only after its own tick publish resolves', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  let fired = 0;
  document.addEventListener('location-publishing-changed', () => { fired++; });
  const p = toggleContext('direct');
  expect(fired).toBe(0); // not yet — permission check + position read + publish still pending
  await expect(p).resolves.toBe('on');
  await flush();
  expect(fired).toBe(1);
});

test('isPublishingAvailable() is false immediately after an up-flip and only becomes true once the tick publish resolves', async () => {
  const { initLocationShare, toggleContext, isPublishingAvailable } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  expect(isPublishingAvailable()).toBe(false);

  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  // Status flipped, but the own node has not published yet this up-transition.
  expect(isPublishingAvailable()).toBe(false);
  await flush();
  expect(isPublishingAvailable()).toBe(true);
});

test('goUnavailable resets the published flag before dispatching — listeners see isPublishingAvailable() false', async () => {
  const { initLocationShare, toggleContext, isPublishingAvailable } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  expect(isPublishingAvailable()).toBe(true);
  let sawFalse = false;
  document.addEventListener('location-publishing-changed', () => { sawFalse = isPublishingAvailable() === false; });
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  expect(sawFalse).toBe(true);
});

test('revokePermissionTeardown resets the published flag and dispatches location-publishing-changed', async () => {
  const { initLocationShare, toggleContext, isPublishingAvailable } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  expect(isPublishingAvailable()).toBe(true);
  let sawFalse = false;
  document.addEventListener('location-publishing-changed', () => { sawFalse = isPublishingAvailable() === false; });
  geoBehavior = (ok, err) => err({ code: 1 }); // OS-level revocation mid-flight
  jest.advanceTimersByTime(60000);
  await flush();
  expect(sawFalse).toBe(true);
  expect(isPublishingAvailable()).toBe(false);
});

test('toggling the last context off resets the published flag and dispatches location-publishing-changed', async () => {
  const { initLocationShare, toggleContext, isPublishingAvailable } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  expect(isPublishingAvailable()).toBe(true);
  let sawFalse = false;
  document.addEventListener('location-publishing-changed', () => { sawFalse = isPublishingAvailable() === false; });
  await expect(toggleContext('direct')).resolves.toBe('off');
  expect(sawFalse).toBe(true);
  expect(isPublishingAvailable()).toBe(false);
});

test('_resetLocationShare resets the published flag and dispatches location-publishing-changed', async () => {
  const { initLocationShare, toggleContext, isPublishingAvailable, _resetLocationShare } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  expect(isPublishingAvailable()).toBe(true);
  let sawFalse = false;
  document.addEventListener('location-publishing-changed', () => { sawFalse = isPublishingAvailable() === false; });
  _resetLocationShare();
  expect(sawFalse).toBe(true);
});

test('toggleContext on-branch: enabling a second context while already publishing closes then reopens the distance subs (second-context enable race)', async () => {
  // wasRunning === true, _published === true (direct already live) — enabling
  // G1 must not let isPublishingAvailable() stay true across the gap where
  // locationCells/{gid}/{me} doesn't exist yet (the republish is mid-flight),
  // or a distance listener attaching right now gets rules-denied and
  // permanently cancelled. The fix resets _published + dispatches BEFORE the
  // republish, then markPublished's own dispatch reopens once it lands.
  const { initLocationShare, toggleContext, isPublishingAvailable } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  expect(isPublishingAvailable()).toBe(true);

  let fired = 0;
  const seenAtDispatch = [];
  document.addEventListener('location-publishing-changed', () => {
    fired++;
    seenAtDispatch.push(isPublishingAvailable());
  });

  const p = toggleContext('G1'); // loop already running: the on-branch's wasRunning path
  await expect(p).resolves.toBe('on');
  // The reset + dispatch happen synchronously within toggleContext's own
  // on-branch, before the republish it kicks off has resolved.
  expect(fired).toBe(1);
  expect(seenAtDispatch).toEqual([false]);
  expect(isPublishingAvailable()).toBe(false);

  // No further dispatch until the republish actually lands.
  expect(fired).toBe(1);
  await flush();
  expect(fired).toBe(2);
  expect(seenAtDispatch).toEqual([false, true]);
  expect(isPublishingAvailable()).toBe(true);
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

test('first status tick after init: unavailable with opt-ins set → opportunistic stale-row clear, once (spec §8)', async () => {
  // App closed while Available leaves locations/{uid} (+cells) behind; on
  // next launch the first own-status tick has wasAvailable === false, so the
  // going-unavailable clear never runs. The first tick must sweep instead.
  prefs.setLocationOptIn('direct', true);
  prefs.setLocationOptIn('G1', true);
  const { initLocationShare } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  await flush();
  expect(db.clearLocationData).toHaveBeenCalledTimes(1);
  expect(db.clearLocationData).toHaveBeenCalledWith('me', ['G1']);
  // Later unavailable ticks are NOT launches — no repeat sweep.
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  await flush();
  expect(db.clearLocationData).toHaveBeenCalledTimes(1);
});

test('first status tick after init: unavailable with NO opt-ins → nothing to sweep, no clear', async () => {
  const { initLocationShare } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  await flush();
  expect(db.clearLocationData).not.toHaveBeenCalled();
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

test('permission revoked mid-flight (tick errors code 1) → clear, loop stopped, opt-ins off, glyph event', async () => {
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
  const seen = [];
  document.addEventListener('location-optin-changed', () => seen.push(1));
  geoBehavior = (ok, err) => err({ code: 1 }); // OS-level revocation mid-flight
  jest.advanceTimersByTime(60000);
  await flush();
  // Everything published is deleted (the G1 cell included), spec §5/§8…
  expect(db.clearLocationData).toHaveBeenCalledWith('me', ['G1']);
  // …the opt-ins flip off so surfaces render what is actually happening…
  expect(prefs.getLocationOptIn('direct')).toBe(false);
  expect(prefs.getLocationOptIn('G1')).toBe(false);
  expect(seen.length).toBeGreaterThan(0); // glyphs repaint off this event
  // …and the loop is stopped: nothing publishes even if permission returns.
  geoBehavior = (ok) => ok(POS);
  jest.advanceTimersByTime(180000);
  await flush();
  expect(db.publishLocation).not.toHaveBeenCalled();
  expect(db.publishLocationCell).not.toHaveBeenCalled();
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

test('a tick never fires the permission PROMPT: Permissions API "prompt" skips capture; "granted" publishes', async () => {
  // Cross-device sync can land an opt-in on a device that never granted
  // geolocation — the background tick must not surprise-prompt (spec §5:
  // prompts fire on explicit glyph intent only).
  Object.defineProperty(global.navigator, 'permissions', {
    configurable: true,
    value: { query: jest.fn(async () => ({ state: 'prompt' })) },
  });
  prefs.setLocationOptIn('direct', true); // arrived via sync — no gesture on THIS device
  const { initLocationShare } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await flush(); await flush();
  expect(navigator.permissions.query).toHaveBeenCalledWith({ name: 'geolocation' });
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(db.publishLocation).not.toHaveBeenCalled();

  // Permission granted (user allowed it via the glyph or site settings) —
  // the next tick captures and publishes normally.
  navigator.permissions.query.mockImplementation(async () => ({ state: 'granted' }));
  jest.advanceTimersByTime(60000);
  await flush(); await flush();
  expect(db.publishLocation).toHaveBeenCalledWith('me', 52.52, 13.405, expect.any(Number));
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
