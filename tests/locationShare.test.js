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
// Per-group OWN effective status (override-aware) comes from statusStore —
// locationShare subscribes one per opted-in gid so group publishing keys off
// in-group availability, independent of the Direct/primary status.
jest.mock('../js/statusStore.js', () => {
  const subs = new Map(); // gid -> Set<cb>
  return {
    subscribeOwnStatus: jest.fn((gid, cb) => {
      if (!subs.has(gid)) subs.set(gid, new Set());
      subs.get(gid).add(cb);
      return () => { subs.get(gid)?.delete(cb); };
    }),
    __fireGroupStatus: (gid, snap) => { (subs.get(gid) || []).forEach((cb) => cb(snap)); },
    __groupSubCount: (gid) => (subs.get(gid)?.size ?? 0),
  };
});
const statusStore = require('../js/statusStore.js');
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

test('direct opt-in + available publishes raw point immediately; an unchanged 60s tick is suppressed', async () => {
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
  // Audit F1: a stationary tick writes nothing — the last-known node stands.
  expect(db.publishLocation).not.toHaveBeenCalled();
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
  // The loop itself must still be running for the surviving group — move to a
  // new cell so this tick proves liveness rather than being suppressed as a
  // no-op (audit F1: G1's cell already landed at POS above).
  geoBehavior = (ok) => ok({ coords: { latitude: 52.54, longitude: 13.405 } }); // ≥2 cells away
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

// Eligibility has two halves the surfaces AND with the opt-in:
// isContextPublished (the context's own node exists — attach-before-publish
// is rules-denied and permanently cancelled) and isOwnAvailable (seeing
// distances requires being de-facto-sharing, i.e. available — operator call
// at device smoke). Availability flips dispatch so the surfaces close/reopen
// their subs, but the published state persists across them: nothing is
// deleted, so a reopen attaches to a live node with no cancel risk.
test('location-publishing-changed fires on the first landed publish AND on availability flips; published state persists across flaps', async () => {
  const { initLocationShare, toggleContext, isContextPublished, isContextAvailable } = share();
  const isOwnAvailable = () => isContextAvailable('direct');
  initLocationShare('me', () => []);
  let fired = 0;
  document.addEventListener('location-publishing-changed', () => { fired++; });

  // Up-flip with no opt-in: still a display-gate transition — dispatches.
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  expect(fired).toBe(1);
  expect(isOwnAvailable()).toBe(true);
  await flush();
  expect(fired).toBe(1); // nothing published, no further dispatch

  // Opt in while available: one more dispatch once that publish resolves.
  await toggleContext('direct');
  await flush();
  expect(fired).toBe(2);

  // Down-flip: dispatch (surfaces hide distances) but nothing is deleted —
  // the published state persists.
  ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
  expect(fired).toBe(3);
  expect(isOwnAvailable()).toBe(false);
  expect(isContextPublished('direct')).toBe(true);
  await flush();
  expect(fired).toBe(3);

  // Up-flip again: dispatch with the flip (the node still exists — surfaces
  // may reattach immediately); the republish lands on an already-published
  // context, so no extra dispatch after it resolves.
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 60000 });
  expect(fired).toBe(4);
  expect(isOwnAvailable()).toBe(true);
  await flush();
  expect(fired).toBe(4);

  // In-tick expiry: a down-flip with no presence tick — dispatches, deletes
  // nothing.
  jest.advanceTimersByTime(60000);
  await flush();
  expect(fired).toBe(5);
  expect(isOwnAvailable()).toBe(false);
  expect(isContextPublished('direct')).toBe(true);
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
  // G1's cell publish is still mid-flight — not yet published. The opt-in
  // itself may dispatch once (G1 just became a tracked-and-available
  // context), but eligibility stays closed on the published half.
  expect(isContextPublished('G1')).toBe(false);
  const firedBeforeLanding = fired;
  await flush();
  // The cell landed: exactly one more dispatch, for G1's arrival.
  expect(fired).toBe(firedBeforeLanding + 1);
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

test('a PERMISSION_DENIED cell write sweeps the stale gid opt-in, clears the orphaned cell, and idles the loop', async () => {
  // Kicked-group scenario: the gid stays opted-in, but membership is gone —
  // the rules deny the cell write forever. The sweep must clear the orphaned
  // cell, drop the opt-in, and let the normal teardown paths idle the loop
  // (no more denied writes every 60s).
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('G1');
  await flush();
  expect(db.publishLocationCell).toHaveBeenCalledTimes(1); // initial cell landed at POS
  // Move to a new cell so the next tick actually attempts a write instead of
  // being suppressed as a no-op (audit F1) — then that write gets denied.
  geoBehavior = (ok) => ok({ coords: { latitude: 52.54, longitude: 13.405 } }); // ≥2 cells away
  db.publishLocationCell.mockRejectedValueOnce({ code: 'PERMISSION_DENIED' });
  const seen = [];
  document.addEventListener('location-optin-changed', (e) => seen.push(e.detail.context));
  jest.advanceTimersByTime(60000);
  await flush();
  await flush();
  expect(prefs.getLocationOptIn('G1')).toBe(false);
  expect(db.clearLocationCells).toHaveBeenCalledWith('me', ['G1']);
  expect(seen).toEqual(['G1']);
  // No other context opted in — the loop must now be idle: nothing publishes
  // on the next 60s advance, proving reconcile() actually stopped the timer.
  db.publishLocationCell.mockClear();
  db.publishLocation.mockClear();
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.publishLocationCell).not.toHaveBeenCalled();
  expect(db.publishLocation).not.toHaveBeenCalled();
});

test('a network-style rejection on a cell write changes nothing (Decision 3: silent failed tick)', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('G1');
  await flush();
  geoBehavior = (ok) => ok({ coords: { latitude: 52.54, longitude: 13.405 } }); // ≥2 cells away
  db.publishLocationCell.mockRejectedValueOnce({ code: 'unavailable' });
  const seen = [];
  document.addEventListener('location-optin-changed', (e) => seen.push(e.detail.context));
  jest.advanceTimersByTime(60000);
  await flush();
  await flush();
  expect(prefs.getLocationOptIn('G1')).toBe(true);
  expect(db.clearLocationCells).not.toHaveBeenCalled();
  expect(seen).toEqual([]);
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
  // Recovery tick moves ≥10m from the original POS — the first publish (from
  // toggleContext, above) already landed at POS, so a same-POS retry here
  // would be a legitimate no-op (audit F1) rather than proof the loop
  // recovered from the failed tick.
  geoBehavior = (ok) => ok({ coords: { latitude: 52.5205, longitude: 13.405 } }); // ~55m
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
  // Direct keeps publishing on the next tick — move ≥10m so this tick proves
  // liveness rather than being suppressed as a no-op (audit F1: direct's raw
  // point already landed at 52.52,13.405 above).
  geoBehavior = (ok) => ok({ coords: { latitude: 52.5205, longitude: 13.405 } }); // ~55m
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.publishLocation).toHaveBeenCalledWith('me', 52.5205, 13.405, expect.any(Number));
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

// Task 8: the Permissions API is queried once and the PermissionStatus is
// cached — its `.state` stays live on the retained object, so subsequent
// ticks read it synchronously instead of re-querying every 60s.
describe('geolocation PermissionStatus caching', () => {
  test('a live PermissionStatus (supports addEventListener) is queried once across ticks', async () => {
    const status = { state: 'granted', addEventListener: jest.fn() };
    Object.defineProperty(global.navigator, 'permissions', {
      configurable: true,
      value: { query: jest.fn(async () => status) },
    });
    prefs.setLocationOptIn('direct', true);
    const { initLocationShare } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await flush(); await flush(); // first tick (immediate, from startLoop)
    jest.advanceTimersByTime(60000);
    await flush(); await flush(); // second tick (interval)
    expect(navigator.permissions.query).toHaveBeenCalledTimes(1);
  });

  test('_resetLocationShare clears the cached status — the next tick re-queries', async () => {
    const status = { state: 'granted', addEventListener: jest.fn() };
    Object.defineProperty(global.navigator, 'permissions', {
      configurable: true,
      value: { query: jest.fn(async () => status) },
    });
    prefs.setLocationOptIn('direct', true);
    const { initLocationShare, _resetLocationShare } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await flush(); await flush();
    expect(navigator.permissions.query).toHaveBeenCalledTimes(1);

    _resetLocationShare();
    prefs.setLocationOptIn('direct', true);
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await flush(); await flush();
    expect(navigator.permissions.query).toHaveBeenCalledTimes(2);
  });

  test('a status without addEventListener is not cached — every tick re-queries', async () => {
    Object.defineProperty(global.navigator, 'permissions', {
      configurable: true,
      value: { query: jest.fn(async () => ({ state: 'granted' })) },
    });
    prefs.setLocationOptIn('direct', true);
    const { initLocationShare } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await flush(); await flush();
    jest.advanceTimersByTime(60000);
    await flush(); await flush();
    expect(navigator.permissions.query).toHaveBeenCalledTimes(2);
  });

  test("a 'prompt' status is never cached — the tick after a grant re-queries and publishes (iOS PWA regression)", async () => {
    // Device-observed (iOS PWA, 2026-07-20): WebKit does NOT update a retained
    // pre-grant PermissionStatus. Caching the 'prompt' object froze the gate
    // closed for the whole session even after the glyph prove was granted —
    // a FRESH query at that point returned 'granted'.
    const promptStatus = { state: 'prompt', addEventListener: jest.fn() };
    const grantedStatus = { state: 'granted', addEventListener: jest.fn() };
    let current = promptStatus;
    Object.defineProperty(global.navigator, 'permissions', {
      configurable: true,
      value: { query: jest.fn(async () => current) },
    });
    prefs.setLocationOptIn('direct', true);
    const { initLocationShare } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await flush(); await flush(); // first tick: 'prompt' → no capture (no surprise prompt)
    expect(db.publishLocation).not.toHaveBeenCalled();

    // The user grants (glyph prove / Settings). Only a fresh query sees it —
    // the retained promptStatus object stays 'prompt' forever on iOS.
    current = grantedStatus;
    jest.advanceTimersByTime(60000);
    await flush(); await flush();
    expect(navigator.permissions.query).toHaveBeenCalledTimes(2);
    expect(db.publishLocation).toHaveBeenCalled();
  });

  test('a cached status whose .state later flips to non-granted makes the next tick skip capture', async () => {
    const status = { state: 'granted', addEventListener: jest.fn() };
    Object.defineProperty(global.navigator, 'permissions', {
      configurable: true,
      value: { query: jest.fn(async () => status) },
    });
    prefs.setLocationOptIn('direct', true);
    const { initLocationShare } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await flush(); await flush();
    expect(db.publishLocation).toHaveBeenCalled();
    db.publishLocation.mockClear();
    navigator.geolocation.getCurrentPosition.mockClear();

    // The browser mutates the retained object in place on revocation — no
    // re-query needed for the cache to observe the flip.
    status.state = 'denied';
    jest.advanceTimersByTime(60000);
    await flush(); await flush();
    expect(navigator.permissions.query).toHaveBeenCalledTimes(1);
    expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
    expect(db.publishLocation).not.toHaveBeenCalled();
  });
});


// Group location is independent of the Direct context (operator call at
// device smoke): a group's cell publishing and availability key off the OWN
// EFFECTIVE in-group status (override-aware, via statusStore), not the
// primary presence. The only Direct↔group relationship is the precise
// cascade for mutuals — handled on the surfaces, not here.
describe('group publishing is independent of Direct availability', () => {
  const FUTURE = () => Date.now() + 3600000;

  test('primary-unavailable + group override available → the cell publishes, the raw point does not', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: FUTURE() });
    await toggleContext('G1');
    await flush();
    db.publishLocationCell.mockClear();
    // Primary drops; the G1 override says available (the ANN scenario).
    ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
    statusStore.__fireGroupStatus('G1', { available: true, availableUntil: FUTURE() });
    // Cross-cell move — G1's cell already landed at 52.52,13.405 above, so an
    // unmoved tick here would be a legitimate no-op (audit F1) rather than
    // proof the override-available tier is still firing.
    geoBehavior = (ok) => ok({ coords: { latitude: 52.54, longitude: 13.405 } }); // ≥2 cells away
    jest.advanceTimersByTime(60000);
    await flush();
    expect(db.publishLocationCell).toHaveBeenCalledWith('G1', 'me', 52.54, 13.405, expect.any(Number));
    expect(db.publishLocation).not.toHaveBeenCalled();
  });

  test('primary down-flip with direct + group opted in: direct publishing stops, the override-available group continues', async () => {
    const { initLocationShare, toggleContext, isContextAvailable } = share();
    initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: FUTURE() });
    await toggleContext('direct');
    await flush();
    await toggleContext('G1');
    await flush();
    statusStore.__fireGroupStatus('G1', { available: true, availableUntil: FUTURE() });
    ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
    expect(isContextAvailable('direct')).toBe(false);
    expect(isContextAvailable('G1')).toBe(true);
    db.publishLocation.mockClear();
    db.publishLocationCell.mockClear();
    // Cross-cell move — G1's cell already landed at POS above, so an unmoved
    // tick here would be a legitimate no-op (audit F1) rather than proof the
    // override-available group keeps publishing.
    geoBehavior = (ok) => ok({ coords: { latitude: 52.54, longitude: 13.405 } }); // ≥2 cells away
    jest.advanceTimersByTime(60000);
    await flush();
    expect(db.publishLocationCell).toHaveBeenCalledTimes(1);
    expect(db.publishLocation).not.toHaveBeenCalled();
  });

  test('a gid availability transition dispatches location-publishing-changed', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
    ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
    await toggleContext('G1'); // opt in while nothing is available
    await flush();
    let fired = 0;
    document.addEventListener('location-publishing-changed', () => { fired++; });
    statusStore.__fireGroupStatus('G1', { available: true, availableUntil: FUTURE() });
    expect(fired).toBe(1); // G1 false→true
    statusStore.__fireGroupStatus('G1', { available: false, availableUntil: null });
    expect(fired).toBe(2); // G1 true→false
  });

  test('with no override data yet, a gid falls back to primary availability (statusStore merge semantics)', async () => {
    const { initLocationShare, toggleContext, isContextAvailable } = share();
    initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: FUTURE() });
    await toggleContext('G1');
    await flush();
    expect(isContextAvailable('G1')).toBe(true); // no snapshot ticked — primary wins
    expect(db.publishLocationCell).toHaveBeenCalled();
  });

  test('a gid override availability window lapsing stops its cell publishing (time-aware, no presence tick)', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
    ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
    await toggleContext('G1');
    await flush();
    statusStore.__fireGroupStatus('G1', { available: true, availableUntil: Date.now() + 60000 });
    await flush();
    db.publishLocationCell.mockClear();
    jest.advanceTimersByTime(180000); // window lapsed at +60s, no tick fires
    await flush();
    // At most the tick at +60s (boundary) — after the lapse nothing publishes,
    // and nothing is deleted (last-known persists).
    const callsAfterLapse = db.publishLocationCell.mock.calls.length;
    jest.advanceTimersByTime(120000);
    await flush();
    expect(db.publishLocationCell.mock.calls.length).toBe(callsAfterLapse);
    expect(db.clearLocationData).not.toHaveBeenCalled();
    expect(db.clearLocationCells).not.toHaveBeenCalled();
  });

  test('opting a gid out tears down its own-status subscription', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: FUTURE() });
    await toggleContext('G1');
    await flush();
    expect(statusStore.__groupSubCount('G1')).toBe(1);
    await toggleContext('G1');
    await flush();
    expect(statusStore.__groupSubCount('G1')).toBe(0);
  });
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
    // Move ≥10m via the LocationManager mock — the first tick already landed
    // at 52.52,13.405 above, so an unmoved read here would be a legitimate
    // no-op (audit F1) rather than proof the inited-manager fast path still
    // delivers reads on later ticks.
    lm.getLocation.mockImplementation((cb) => cb({ latitude: 52.5205, longitude: 13.405 }));
    jest.advanceTimersByTime(60000);
    await flush(); await flush();
    expect(db.publishLocation).toHaveBeenCalledTimes(1);
  });
});

describe('no-op publish suppression (audit F1)', () => {
  test('stationary user: the 60s tick republishes neither the raw point nor the cell', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await toggleContext('direct');
    await flush();
    await toggleContext('G1');
    await flush();
    db.publishLocation.mockClear();
    db.publishLocationCell.mockClear();
    jest.advanceTimersByTime(60000); // same POS as the first publish
    await flush();
    expect(db.publishLocation).not.toHaveBeenCalled();
    expect(db.publishLocationCell).not.toHaveBeenCalled();
  });

  test('a >=10m move republishes the raw point; an in-cell move does not republish the cell', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await toggleContext('direct');
    await flush();
    await toggleContext('G1');
    await flush();
    db.publishLocation.mockClear();
    db.publishLocationCell.mockClear();
    // ~0.0005° lat ≈ 55 m: leaves the 10 m raw threshold, stays in the 0.01° cell.
    geoBehavior = (ok) => ok({ coords: { latitude: 52.5205, longitude: 13.405 } });
    jest.advanceTimersByTime(60000);
    await flush();
    expect(db.publishLocation).toHaveBeenCalledTimes(1);
    expect(db.publishLocationCell).not.toHaveBeenCalled();
  });

  test('a cross-cell move republishes the cell', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await toggleContext('G1');
    await flush();
    db.publishLocationCell.mockClear();
    geoBehavior = (ok) => ok({ coords: { latitude: 52.54, longitude: 13.405 } }); // ≥2 cells away
    jest.advanceTimersByTime(60000);
    await flush();
    expect(db.publishLocationCell).toHaveBeenCalledTimes(1);
  });

  test('glyph off then on republishes even when stationary (cache invalidated on delete)', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await toggleContext('direct');
    await flush();
    await toggleContext('direct'); // off — node deleted
    await flush();
    db.publishLocation.mockClear();
    await toggleContext('direct'); // on again, same POS
    await flush();
    expect(db.publishLocation).toHaveBeenCalledTimes(1);
  });

  test('a failed publish does not poison the cache — the next tick retries', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    db.publishLocation.mockRejectedValueOnce(new Error('offline'));
    await toggleContext('direct');
    await flush();
    db.publishLocation.mockClear();
    jest.advanceTimersByTime(60000); // same POS — but the first write never landed
    await flush();
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
  // Each of the two ticks in this window must move ≥10m from the last landed
  // point, or the second (same-position) tick would be a legitimate no-op
  // (audit F1) rather than proof ticks keep running while hidden.
  let _n = 0;
  geoBehavior = (ok) => ok({ coords: { latitude: 52.52 + 0.001 * (++_n), longitude: 13.405 } });
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

describe('GPS options by tier (audit F2)', () => {
  const lastGeoOpts = () =>
    navigator.geolocation.getCurrentPosition.mock.calls.at(-1)[2];

  test('a tick publishing the precise tier requests a high-accuracy, fresh fix', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await toggleContext('direct');
    await flush();
    expect(lastGeoOpts()).toMatchObject({ enableHighAccuracy: true, maximumAge: 30000 });
  });

  test('a cell-only tick requests a coarse fix and accepts one up to 90s old', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await toggleContext('G1'); // direct never opted in → cell-only ticks
    await flush();
    // The toggle's prove-read keeps the default (explicit-intent) options; the
    // loop tick that follows is what must go coarse.
    jest.advanceTimersByTime(60000);
    await flush();
    expect(lastGeoOpts()).toMatchObject({ enableHighAccuracy: false, maximumAge: 90000 });
  });

  test('the glyph-tap prove read keeps explicit-intent defaults', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
    await toggleContext('direct'); // prove-read fires even while unavailable
    expect(lastGeoOpts()).toMatchObject({ enableHighAccuracy: true, maximumAge: 30000 });
  });
});

test('a prefs echo does not re-probe contexts already marked published (audit F5)', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush(); // publish landed → 'direct' is in _publishedContexts
  db.hasLocationNode.mockClear();
  document.dispatchEvent(new CustomEvent('location-prefs-synced'));
  await flush();
  expect(db.hasLocationNode).not.toHaveBeenCalled();
});

test('an unchanged cell is re-attempted once the stale-membership probe window lapses (audit-2 N2)', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 7200000 });
  await toggleContext('G1');
  await flush();
  expect(db.publishLocationCell).toHaveBeenCalledTimes(1); // initial cell landed
  db.publishLocationCell.mockClear();
  // Stationary: the next nine 60s ticks are all no-op-suppressed (audit F1).
  for (let i = 0; i < 9; i++) { jest.advanceTimersByTime(60000); await flush(); }
  expect(db.publishLocationCell).not.toHaveBeenCalled();
  // The tenth tick crosses the 10-min probe window: the unchanged cell is
  // written once anyway, so a stale membership can be caught (the sweep keys
  // off this write's rejection — audit-2 N2).
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.publishLocationCell).toHaveBeenCalledTimes(1);
  db.publishLocationCell.mockClear();
  // A landed probe re-arms the window: the following tick suppresses again.
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.publishLocationCell).not.toHaveBeenCalled();
});

test('a kicked, stationary member is swept by the probe write without crossing a cell boundary (audit-2 N2)', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 7200000 });
  await toggleContext('G1');
  await flush();
  expect(db.publishLocationCell).toHaveBeenCalledTimes(1);
  // Kick happens server-side: the client keeps the opt-in, the landed cell in
  // _lastPublished, and the (now stale) gid status fallback. All later cell
  // writes are rules-denied.
  db.publishLocationCell.mockRejectedValue({ code: 'PERMISSION_DENIED' });
  db.publishLocationCell.mockClear();
  const seen = [];
  document.addEventListener('location-optin-changed', (e) => seen.push(e.detail.context));
  // Stationary — no cell boundary is ever crossed. Nine suppressed ticks…
  for (let i = 0; i < 9; i++) { jest.advanceTimersByTime(60000); await flush(); }
  expect(db.publishLocationCell).not.toHaveBeenCalled();
  // …then the probe tick attempts the write; the denial fires the existing sweep.
  jest.advanceTimersByTime(60000);
  await flush();
  await flush();
  expect(prefs.getLocationOptIn('G1')).toBe(false);
  expect(db.clearLocationCells).toHaveBeenCalledWith('me', ['G1']);
  expect(seen).toEqual(['G1']);
  // Sweep idled the loop: nothing publishes on the next advance.
  db.publishLocationCell.mockClear();
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.publishLocationCell).not.toHaveBeenCalled();
});
