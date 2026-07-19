// Capture-loop contract for js/locationShare.ts. Geolocation is mocked at
// navigator.geolocation; db at the './db.js' barrel; prefs real (jsdom
// localStorage). Fake timers drive the 60s cadence.
//
// Model (smoke-test revision 2026-07-19): published nodes are LAST-KNOWN
// data — they persist across availability flaps and app restarts, and are
// deleted only when the user disables a context (glyph off) or OS permission
// is revoked. Publishing itself stays tied to availability (60s ticks while
// available), but going unavailable no longer deletes anything, and the
// document-visibility gate on ticks is gone. Eligibility for the distance
// surfaces is per-context ("this context's own node is known to exist"),
// seeded at boot from the server so a restart sees last-known immediately.
jest.mock('../js/db.js', () => ({
  publishLocation: jest.fn().mockResolvedValue(undefined),
  publishLocationCell: jest.fn().mockResolvedValue(undefined),
  clearLocationData: jest.fn().mockResolvedValue(undefined),
  clearLocationCells: jest.fn().mockResolvedValue(undefined),
  hasLocationNode: jest.fn().mockResolvedValue(false),
  hasLocationCell: jest.fn().mockResolvedValue(false),
  isAvailable: (status, until) => status === 'available' && (until == null || until > Date.now()),
  mergeUserPrefs: jest.fn().mockResolvedValue(undefined),
  readPushTokens: jest.fn().mockResolvedValue(null),
}));
jest.mock('../js/telegram.js', () => ({ isTelegramContext: jest.fn(() => false) }));
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
  // clearAllMocks does NOT clear mockResolvedValue implementations — reset
  // the existence probes to their default explicitly per test.
  db.hasLocationNode.mockResolvedValue(false);
  db.hasLocationCell.mockResolvedValue(false);
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

test('going unavailable stops the loop but KEEPS the published data — last-known persists', async () => {
  const { initLocationShare, toggleContext, isContextPublished } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  expect(isContextPublished('direct')).toBe(true);
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  await flush();
  // No delete: the node is last-known data now, removed only on disable.
  expect(db.clearLocationData).not.toHaveBeenCalled();
  expect(db.clearLocationCells).not.toHaveBeenCalled();
  // Published state survives the flap — distance subs stay eligible/open.
  expect(isContextPublished('direct')).toBe(true);
  // But the loop is stopped: no fresh publishes while unavailable.
  db.publishLocation.mockClear();
  jest.advanceTimersByTime(120000);
  await flush();
  expect(db.publishLocation).not.toHaveBeenCalled();
  // …and the opt-in pref SURVIVES (publishing resumes on next available)
  expect(prefs.getLocationOptIn('direct')).toBe(true);
});

// Eligibility keys off "this context's own node is known to exist" — a
// distance listener attached before the node exists is rules-denied and
// permanently cancelled by the SDK, so the first-ever publish of a context
// still gates its surfaces. Availability flaps no longer touch the state
// (nothing is deleted), so they dispatch nothing.
test('location-publishing-changed fires once when a context first lands, never on availability flaps', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  let fired = 0;
  document.addEventListener('location-publishing-changed', () => { fired++; });

  // No opt-in at all: nothing to publish, no dispatch.
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await flush();
  expect(fired).toBe(0);

  // Opt in while available: dispatch only once that publish resolves.
  await toggleContext('direct');
  await flush();
  expect(fired).toBe(1);

  // Down-flip: nothing is deleted, published state persists — no dispatch.
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  await flush();
  expect(fired).toBe(1);

  // Up-flip again: the republish lands on an already-published context — no
  // re-dispatch (the surfaces' subs never closed).
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 60000 });
  await flush();
  expect(fired).toBe(1);

  // In-tick expiry: stops the loop, deletes nothing, dispatches nothing.
  jest.advanceTimersByTime(60000);
  await flush();
  expect(fired).toBe(1);
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

test('isContextPublished is per-context: a landed cell publish marks that gid, not direct', async () => {
  const { initLocationShare, toggleContext, isContextPublished } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  expect(isContextPublished('direct')).toBe(false);
  expect(isContextPublished('G1')).toBe(false);
  await toggleContext('G1');
  await flush();
  expect(isContextPublished('G1')).toBe(true);
  expect(isContextPublished('direct')).toBe(false);
  await toggleContext('direct');
  await flush();
  expect(isContextPublished('direct')).toBe(true);
});

test('enabling a second context mid-spell leaves the first context published — no global close/reopen', async () => {
  const { initLocationShare, toggleContext, isContextPublished } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  expect(isContextPublished('direct')).toBe(true);

  let fired = 0;
  document.addEventListener('location-publishing-changed', () => { fired++; });

  const p = toggleContext('G1'); // loop already running: the on-branch's wasRunning path
  await expect(p).resolves.toBe('on');
  // Direct's node never went anywhere — its surfaces must not churn.
  expect(isContextPublished('direct')).toBe(true);
  // G1's cell publish is still mid-flight — not published yet, no dispatch.
  expect(isContextPublished('G1')).toBe(false);
  expect(fired).toBe(0);
  await flush();
  // The cell landed: exactly one dispatch, for G1's arrival.
  expect(fired).toBe(1);
  expect(isContextPublished('G1')).toBe(true);
  expect(isContextPublished('direct')).toBe(true);
});

test('availability window expiring mid-session stops publishing but does NOT clear — no presence tick needed', async () => {
  // Expiry is a TIME event, not a data event: no presence snapshot arrives
  // when the window lapses while foreground. The loop must re-evaluate
  // isAvailable(status, availableUntil) per tick off the stored snapshot.
  const { initLocationShare, toggleContext, isContextPublished } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 60000 });
  await toggleContext('direct');
  await flush();
  expect(db.publishLocation).toHaveBeenCalledTimes(1);
  db.publishLocation.mockClear();
  jest.advanceTimersByTime(180000); // window lapsed at +60s; NO presence tick fires
  await flush();
  // Last-known persists: no delete on expiry.
  expect(db.clearLocationData).not.toHaveBeenCalled();
  expect(db.publishLocation).not.toHaveBeenCalled();
  expect(isContextPublished('direct')).toBe(true);
  // Loop is stopped — later timer advances publish nothing either.
  jest.advanceTimersByTime(120000);
  await flush();
  expect(db.publishLocation).not.toHaveBeenCalled();
});

test('booting unavailable with opt-ins set does NOT delete the last-known data (old stale-row sweep is gone)', async () => {
  prefs.setLocationOptIn('direct', true);
  prefs.setLocationOptIn('G1', true);
  const { initLocationShare } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  await flush();
  expect(db.clearLocationData).not.toHaveBeenCalled();
  expect(db.clearLocationCells).not.toHaveBeenCalled();
});

test('init seeds published state from existing server nodes — a restart sees last-known without a fresh publish', async () => {
  prefs.setLocationOptIn('direct', true);
  prefs.setLocationOptIn('G1', true);
  db.hasLocationNode.mockResolvedValue(true);
  db.hasLocationCell.mockResolvedValue(true);
  const { initLocationShare, isContextPublished } = share();
  let fired = 0;
  document.addEventListener('location-publishing-changed', () => { fired++; });
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  await flush();
  expect(db.hasLocationNode).toHaveBeenCalledWith('me');
  expect(db.hasLocationCell).toHaveBeenCalledWith('G1', 'me');
  expect(isContextPublished('direct')).toBe(true);
  expect(isContextPublished('G1')).toBe(true);
  expect(fired).toBeGreaterThan(0); // surfaces get told to attach
  // No publish happened — the seed is read-only.
  expect(db.publishLocation).not.toHaveBeenCalled();
  expect(db.publishLocationCell).not.toHaveBeenCalled();
});

test('init seeding: absent server nodes leave contexts unpublished (surfaces must not attach-race)', async () => {
  prefs.setLocationOptIn('direct', true);
  const { initLocationShare, isContextPublished } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  await flush();
  expect(isContextPublished('direct')).toBe(false);
});

test('init seeding probes only opted-in contexts', async () => {
  const { initLocationShare } = share();
  initLocationShare('me', () => []);
  await flush();
  expect(db.hasLocationNode).not.toHaveBeenCalled();
  expect(db.hasLocationCell).not.toHaveBeenCalled();
});

test('location-prefs-synced re-runs the seed: a cross-device opt-in with an existing node becomes published', async () => {
  const { initLocationShare, isContextPublished } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  await flush();
  expect(isContextPublished('G1')).toBe(false);
  // Another device opted G1 in and published its cell; the pref echo lands here.
  prefs.setLocationOptIn('G1', true);
  db.hasLocationCell.mockResolvedValue(true);
  document.dispatchEvent(new CustomEvent('location-prefs-synced'));
  await flush();
  expect(isContextPublished('G1')).toBe(true);
});

test('toggling a context off removes only that context from the published state', async () => {
  const { initLocationShare, toggleContext, isContextPublished } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  await toggleContext('G1');
  await flush();
  expect(isContextPublished('direct')).toBe(true);
  expect(isContextPublished('G1')).toBe(true);
  await expect(toggleContext('G1')).resolves.toBe('off');
  expect(isContextPublished('G1')).toBe(false);
  expect(isContextPublished('direct')).toBe(true);
});

test('toggling the last context off resets published state and dispatches location-publishing-changed', async () => {
  const { initLocationShare, toggleContext, isContextPublished } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  expect(isContextPublished('direct')).toBe(true);
  let sawFalse = false;
  document.addEventListener('location-publishing-changed', () => { sawFalse = isContextPublished('direct') === false; });
  await expect(toggleContext('direct')).resolves.toBe('off');
  expect(sawFalse).toBe(true);
  expect(isContextPublished('direct')).toBe(false);
});

test('revokePermissionTeardown resets published state and dispatches location-publishing-changed', async () => {
  const { initLocationShare, toggleContext, isContextPublished } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  expect(isContextPublished('direct')).toBe(true);
  let sawFalse = false;
  document.addEventListener('location-publishing-changed', () => { sawFalse = isContextPublished('direct') === false; });
  geoBehavior = (ok, err) => err({ code: 1 }); // OS-level revocation mid-flight
  jest.advanceTimersByTime(60000);
  await flush();
  expect(sawFalse).toBe(true);
  expect(isContextPublished('direct')).toBe(false);
});

test('_resetLocationShare resets published state and dispatches location-publishing-changed', async () => {
  const { initLocationShare, toggleContext, isContextPublished, _resetLocationShare } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  expect(isContextPublished('direct')).toBe(true);
  let sawFalse = false;
  document.addEventListener('location-publishing-changed', () => { sawFalse = isContextPublished('direct') === false; });
  _resetLocationShare();
  expect(sawFalse).toBe(true);
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

describe('Telegram Mini App position reads', () => {
  // Mimics the device-observed LocationManager: init()'s callback fires only
  // on the FIRST init of a session — later init() calls never call back.
  // Every position read after the first must therefore go through the
  // isInited fast path or it hangs forever (glyph un-retoggleable, ticks
  // silently dead until the app is reopened).
  let lm;
  beforeEach(() => {
    const { isTelegramContext } = require('../js/telegram.js');
    isTelegramContext.mockReturnValue(true);
    lm = {
      isInited: false,
      _initCalls: 0,
      init: jest.fn((cb) => {
        lm._initCalls++;
        if (lm._initCalls === 1) { lm.isInited = true; if (cb) cb(); }
        // subsequent init calls: callback never fires (device behavior)
      }),
      getLocation: jest.fn((cb) => cb({ latitude: 52.52, longitude: 13.405 })),
    };
    window.Telegram = { WebApp: { LocationManager: lm } };
  });
  afterEach(() => {
    require('../js/telegram.js').isTelegramContext.mockReturnValue(false);
    delete window.Telegram;
  });

  test('first enable publishes: the loop tick after the glyph-tap read must not hang on a second init()', async () => {
    const { initLocationShare, toggleContext, isContextPublished } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    // The glyph tap's permission-proving read consumes the one working
    // init(); the immediate tick's read follows right behind it.
    await expect(toggleContext('direct')).resolves.toBe('on');
    await flush(); await flush();
    expect(db.publishLocation).toHaveBeenCalledWith('me', 52.52, 13.405, expect.any(Number));
    expect(isContextPublished('direct')).toBe(true);
  });

  test('glyph re-enable after off resolves — no hang on a repeat init()', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await toggleContext('direct');
    await flush();
    await expect(toggleContext('direct')).resolves.toBe('off');
    let resolved = null;
    toggleContext('direct').then((r) => { resolved = r; });
    await flush(); await flush();
    expect(resolved).toBe('on');
  });

  test('60s ticks keep publishing — position reads use the inited manager directly', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await toggleContext('direct');
    await flush(); await flush();
    db.publishLocation.mockClear();
    jest.advanceTimersByTime(60000);
    await flush(); await flush();
    expect(db.publishLocation).toHaveBeenCalledTimes(1);
  });
});

test('hidden document no longer pauses ticks — publishing continues off-screen', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush();
  db.publishLocation.mockClear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  jest.advanceTimersByTime(120000);
  await flush();
  expect(db.publishLocation).toHaveBeenCalledTimes(2);
  // Returning to visible still runs an opportunistic immediate tick (the
  // browser throttles background timers on real devices — this catches up).
  db.publishLocation.mockClear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  await flush();
  expect(db.publishLocation).toHaveBeenCalledTimes(1);
});
