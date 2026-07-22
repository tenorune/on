// js/locationShare.ts
// The location-sharing capture loop (spec 2026-07-18 §5, revised at device
// smoke 2026-07-19). One loop; each opted-in context is gated per tick on its
// OWN availability: 'direct' on the primary presence, each group on the own
// EFFECTIVE in-group status (override-aware, via statusStore) — group
// location is fully independent of the Direct context (operator call; the
// only Direct↔group relationship is the surfaces' precise cascade for
// mutuals). Raw point published only when 'direct' is opted in and
// Direct-available; one snapped cell per opted-in, in-group-available group.
// Published nodes are LAST-KNOWN data: they persist across availability
// flaps and app restarts, and are deleted only when the user disables a
// context (glyph off) or OS permission is revoked — so peers' distance
// listeners stay attached and stable instead of being cancelled by node
// deletes. Failed ticks are silent by design (Decision 3): the last written
// value stands and the next tick tries again.
import { publishLocation, publishLocationCell, clearLocationData, clearLocationCells, hasLocationNode, hasLocationCell, isAvailable } from './db.js';
import { getLocationOptIn, setLocationOptIn } from './prefs.js';
import { subscribeOwnStatus } from './ownStatus.js';
import { subscribeOwnStatus as subscribeOwnGroupStatus } from './statusStore.js';
import { isTelegramContext } from './telegram.js';
import { snapToCell, haversineMeters } from '../shared/geo.js';

const TICK_MS = 60000;
// A cached watch fix older than this cannot satisfy a position read — see
// getPositionOnce (a live watch streams ~1 fix/s; a full silent tick interval
// means the stream is dead).
const STALE_FIX_MAX_AGE_MS = TICK_MS;

let _userId: string | null = null;
let _getOptedInGids: () => string[] = () => [];
// Ground truth for the distance surfaces' eligibility, per context: "this
// context's own node is known to exist on the server". A distance listener
// attached at locations/{me} (or the gid's cell) before the node exists gets
// rules-denied on reciprocity and is cancelled by the SDK PERMANENTLY (no
// retry) — so a context enters this set only once a publish actually lands
// (markPublished, in tick()) or a boot-time probe finds the persisted node
// (seedPublishedFromServer). A context leaves the set only on the paths that
// DELETE its node: glyph-off, permission revocation, _resetLocationShare.
// Availability flaps don't touch it — nothing is deleted anymore.
const _publishedContexts = new Set<string>();
// Last own-presence SNAPSHOT (primary), kept so 'direct' availability can be
// re-evaluated at tick time: expiry is a TIME event — the window can lapse
// with no presence DATA tick arriving, and a cached boolean alone would let
// the loop keep publishing raw coordinates against an expired window.
let _lastPresence: PresenceNode | null = null;
// Per-opted-in-gid OWN effective in-group status (merged override/primary
// snapshot from statusStore), same time-aware treatment as _lastPresence.
const _gidSnapshots = new Map<string, { available: boolean; availableUntil: number | null }>();
const _gidStatusUnsubs = new Map<string, () => void>();
// Last evaluated availability per context, for transition detection: any
// change dispatches location-publishing-changed so the surfaces re-run their
// eligibility (and reconciles the loop).
const _ctxWasAvailable = new Map<string, boolean>();
// Last value actually WRITTEN per context ('direct' → raw coords, gid → the
// snapped cell). A tick that would rewrite the same data skips the set()
// entirely: the write burns a rules evaluation + fans a changed-value tick to
// every attached peer listener, for zero rendered change (audit F1 — the cell
// grid is ~1.1km, so stationary users otherwise rewrite every minute).
// Entries are recorded only when the write RESOLVES (a failed write must
// retry), and dropped wherever the context's node is deleted so re-enable
// republishes. updatedAt stops refreshing on suppressed ticks — nothing reads
// it (spec v1: "nothing gates on it").
const _lastPublished = new Map<string, { lat: number; lng: number; landedAt: number }>();
const RAW_REPUBLISH_MIN_METERS = 10;
// Audit-2 N2: the no-op skip above must not permanently silence the write the
// stale-membership sweep keys off. A mid-session kick leaves the landed cell
// in _lastPublished (nothing clears it client-side) while the gid still looks
// available via the status fallback — a stationary user would never attempt
// the denied write that fires the sweep, and the loop (plus its per-minute
// GPS fix) could not idle until a ~1.1km cell boundary was crossed. Let an
// unchanged cell through once per probe window; a landed probe re-arms it.
const STALE_MEMBERSHIP_PROBE_MS = 600000;
let _timer: ReturnType<typeof setInterval> | null = null;
let _unsubOwn: (() => void) | null = null;
let _visListener: (() => void) | null = null;
let _prefsSyncedListener: (() => void) | null = null;

// Browser geolocation runs as ONE long-lived watchPosition, not a per-read
// getCurrentPosition. On WebKit (macOS/iOS PWA + Safari) repeated cold
// getCurrentPosition calls hang after the first fix or two and then reject
// code 3 ("Timeout expired") — device trace 2026-07-21. That silently killed
// publishing (own node froze → distance stuck at last-known until reload) and,
// on the glyph-tap prove, returned 'unsupported' so the glyph stuck OFF. The
// watch streams fixes into _lastFix as the user moves; getPositionOnce serves
// that cache (keeping its Promise<coords>/reject-with-code contract) instead of
// firing its own read. Telegram keeps its LocationManager path — no WebKit hang
// there. _watchWaiters are one-shot getPositionOnce callers parked until the
// next fix/error arrives (no cached fix fresh enough to serve synchronously).
let _watchId: number | null = null;
let _watchHighAccuracy = false;
// Sticky "OS permission is denied" marker for the glyph surfaces: set on a
// code-1 prove reject and on the mid-flight revocation teardown, cleared the
// moment a fix is delivered or a prove succeeds (either implies granted).
// Without it, the repaint paths that read only the opt-in (prefs sync,
// opt-in-changed, band render) washed a just-painted denied glyph back to
// plain off — the denied state never survived its own dispatch.
let _permissionDenied = false;
let _lastFix: { lat: number; lng: number; at: number } | null = null;
let _watchWaiters: Array<(r: { lat: number; lng: number } | { code: number }) => void> = [];

function drainWatchWaiters(r: { lat: number; lng: number } | { code: number }): void {
  const waiters = _watchWaiters;
  _watchWaiters = [];
  for (const w of waiters) { try { w(r); } catch { /* waiter threw */ } }
}

// (Re)start the browser watch. No-op if already running at the same accuracy
// tier; a tier change (Direct opt-in flipping precise↔coarse) restarts it.
// _watchGeneration detects a stopGeoWatch that ran DURING watchPosition's
// callback: delivery is allowed to be synchronous (see getPositionOnce), so a
// synchronous code-1 error tears everything down before the id assignment
// below — which would then resurrect a dead watch, and the next glyph prove
// would park forever against a stream that no longer delivers.
let _watchGeneration = 0;
function startGeoWatch(highAccuracy: boolean): void {
  if (!navigator.geolocation || !navigator.geolocation.watchPosition) return;
  if (_watchId !== null && _watchHighAccuracy === highAccuracy) return;
  // Restart for a tier change — clear the old watch but DON'T drain waiters
  // (a getPositionOnce may have just parked one for this very start).
  if (_watchId !== null && navigator.geolocation.clearWatch) navigator.geolocation.clearWatch(_watchId);
  _watchId = null;
  _watchHighAccuracy = highAccuracy;
  const gen = _watchGeneration;
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      _lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, at: Date.now() };
      markGrantProven(); // a fix arrived without a prompt — grant proven on THIS device
      _permissionDenied = false; // a delivered fix means the permission is granted
      drainWatchWaiters({ lat: _lastFix.lat, lng: _lastFix.lng });
    },
    (err) => {
      const code = (err as { code?: number })?.code;
      drainWatchWaiters({ code: code ?? 2 });
      // code 1 = PERMISSION_DENIED: revoked → full teardown. code 2/3
      // (position-unavailable / timeout) keep the last fix and the watch up so
      // a later fix resumes publishing — no teardown, matching a silent tick.
      if (code === 1) revokePermissionTeardown();
    },
    { enableHighAccuracy: highAccuracy, timeout: 20000, maximumAge: 30000 },
  );
  if (gen === _watchGeneration) _watchId = id;
  else if (navigator.geolocation.clearWatch) navigator.geolocation.clearWatch(id); // torn down mid-callback
}

function stopGeoWatch(): void {
  _watchGeneration++; // invalidate an id assignment still pending in startGeoWatch
  if (_watchId !== null && navigator.geolocation?.clearWatch) navigator.geolocation.clearWatch(_watchId);
  _watchId = null;
  drainWatchWaiters({ code: 2 }); // unblock any parked reader — the watch is gone
}

// Tear down and rebuild the watch at its current tier. Needed because iOS
// suspension kills a running watch WITHOUT any error callback (device trace
// 2026-07-21, tram bug): _watchId still looks live, so startGeoWatch alone
// no-ops and the dead stream would serve its frozen _lastFix forever. Waiters
// are NOT drained — a parked getPositionOnce caller is served by the rebuilt
// watch's first fix/error. Restarts within the dedupe window collapse into
// one: on resume the stale-fix guard and the visibility handler both fire
// within ms (trace 21:55:29), and the second rebuild would discard a fresh
// watch that hasn't had time to deliver yet.
let _lastWatchRestartAt = 0;
const WATCH_RESTART_DEDUPE_MS = 10000;
function restartGeoWatch(): void {
  if (_watchId === null) return;
  const now = Date.now();
  if (now - _lastWatchRestartAt < WATCH_RESTART_DEDUPE_MS) return;
  _lastWatchRestartAt = now;
  if (navigator.geolocation?.clearWatch) navigator.geolocation.clearWatch(_watchId);
  _watchId = null;
  startGeoWatch(_watchHighAccuracy);
}

function anyOptIn(): boolean {
  return getLocationOptIn('direct') || _getOptedInGids().length > 0;
}

// One position read, browser or Telegram. Rejects with the underlying error;
// callers map code 1 (PERMISSION_DENIED) to the denied state. `highAccuracy`
// applies to the browser path only — it tiers the shared watch: high for the
// precise (Direct) tier + the glyph-tap prove, coarse for cell-only ticks,
// since the ~1.1km cell quantization makes a high-accuracy GPS wakeup pure
// battery burn (audit F2). Telegram's LocationManager has no accuracy API.
function getPositionOnce(opts?: { highAccuracy?: boolean }): Promise<{ lat: number; lng: number }> {
  if (isTelegramContext()) {
    return new Promise((resolve, reject) => {
      const lm = (window as unknown as {
        Telegram?: { WebApp?: { LocationManager?: {
          isInited?: boolean;
          init: (cb?: () => void) => void;
          getLocation: (cb: (data: { latitude: number; longitude: number } | null) => void) => void;
        } } };
      }).Telegram?.WebApp?.LocationManager;
      if (!lm) { reject(new Error('unsupported')); return; }
      const read = () => {
        lm.getLocation((data) => {
          if (data) resolve({ lat: data.latitude, lng: data.longitude });
          else reject({ code: 1 }); // user declined in Telegram's dialog
        });
      };
      // init()'s callback fires only on the FIRST init of a session — a
      // repeat init() never calls back (device-observed), which left every
      // later read hanging forever: the glyph couldn't re-enable and the
      // 60s ticks went silently dead until the Mini App was reopened.
      if (lm.isInited) read();
      else lm.init(read);
    });
  }
  // Browser: serve the long-lived watch's cache (see _watchId note) — never a
  // fresh getCurrentPosition, which hangs on repeat under WebKit. Ensure the
  // watch is running at the requested accuracy tier, then return a fresh-enough
  // cached fix synchronously, or park until the next fix/error the watch emits.
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation || !navigator.geolocation.watchPosition) { reject(new Error('unsupported')); return; }
    let settled = false;
    const onResult = (r: { lat: number; lng: number } | { code: number }) => {
      if (settled) return;
      settled = true;
      if ('code' in r) reject({ code: r.code }); else resolve(r);
    };
    // Park BEFORE starting so a synchronously-delivered first fix/error (the
    // real watch fires async, but nothing may rely on that) still reaches us.
    _watchWaiters.push(onResult);
    const hadWatch = _watchId !== null;
    startGeoWatch(opts?.highAccuracy ?? true);
    // No synchronous delivery, but a prior fix is cached: serve it if it is
    // fresher than one tick interval — the freshest the OS pushed (the watch
    // chases newer). An OLDER cache means the supposedly-live watch delivered
    // nothing for a whole tick: iOS suspension kills the stream with no error
    // callback (device trace 2026-07-21), so rebuild it and stay parked for a
    // real fix (the watch's own 20s timeout rejects code 3 if none comes).
    // A context that has never had a fix stays parked for the first delivery.
    if (!settled && _lastFix) {
      if (Date.now() - _lastFix.at <= STALE_FIX_MAX_AGE_MS) {
        _watchWaiters = _watchWaiters.filter((w) => w !== onResult);
        onResult({ lat: _lastFix.lat, lng: _lastFix.lng });
      } else if (hadWatch) {
        restartGeoWatch();
      }
    }
  });
}

// Primary availability re-evaluated from the stored snapshot (time-aware),
// not a cached boolean — see _lastPresence's note.
function presenceAvailable(): boolean {
  return isAvailable(_lastPresence?.status ?? null, _lastPresence?.availableUntil ?? null);
}

// Per-context OWN availability: 'direct' is the primary presence; a group is
// the own effective in-group status (override wins when enabled — statusStore
// merge). A gid whose snapshot hasn't ticked yet falls back to the primary,
// matching statusStore's merge for a group with no override; the snapshot's
// arrival re-evaluates. Time-aware on both arms.
function contextAvailable(context: string): boolean {
  if (context === 'direct') return presenceAvailable();
  const snap = _gidSnapshots.get(context);
  if (!snap) return presenceAvailable();
  return snap.available && (snap.availableUntil == null || snap.availableUntil > Date.now());
}

// Per-context eligibility read for the distance surfaces (following.ts /
// groupContext.ts): a surface may attach distance listeners for a context
// only while that context's own node is known to exist — attach-before-
// publish is rules-denied and permanently cancelled.
export function isContextPublished(context: string): boolean {
  return _publishedContexts.has(context);
}

// The other eligibility half: seeing a context's distances requires being de
// facto sharing THERE — available in that context (operator calls, device
// smoke 2026-07-19). Direct keys off the primary presence; a group keys off
// the own effective in-group status, independent of Direct.
export function isContextAvailable(context: string): boolean {
  return contextAvailable(context);
}

// Sticky denied read for the glyph paint paths (me.ts / groupContext.ts) —
// see _permissionDenied's note.
export function isPermissionDenied(): boolean {
  return _permissionDenied;
}

// Announces a publishing-state transition (a context's first landed publish,
// a node deletion, or a per-context availability flip) to the distance
// surfaces so their reconcile passes re-run eligibility.
function dispatchPublishingChanged() {
  document.dispatchEvent(new CustomEvent('location-publishing-changed'));
}

// tick()'s publish-resolution hook, and the boot seed's: marks a context's
// own node as existing and notifies the surfaces THEN — not on the earlier
// opt-in flip, which would race the async publish chain (see
// _publishedContexts' note). Guarded on the set so it fires once per
// context's arrival, not on every subsequent 60s tick's resolution.
function markPublished(context: string) {
  if (_publishedContexts.has(context)) return;
  _publishedContexts.add(context);
  dispatchPublishingChanged();
}

// Removes contexts whose nodes were just deleted. Dispatches only if
// something actually left the set.
function unmarkPublished(contexts: string[]) {
  let changed = false;
  for (const context of contexts) {
    _lastPublished.delete(context);
    changed = _publishedContexts.delete(context) || changed;
  }
  if (changed) dispatchPublishingChanged();
}

// Re-derives every tracked context's availability, reconciles the loop, and
// dispatches ONE event if anything flipped. The single availability
// authority: called on primary presence ticks, per-gid snapshot ticks,
// opt-in changes, and at the head of every 60s tick (time lapses arrive with
// no data tick). Published nodes are untouched by flips — the surfaces close
// or reopen subs against live nodes, cancel-free.
function evaluateAvailability() {
  const contexts = new Set(['direct', ..._getOptedInGids()]);
  let changed = false;
  for (const context of contexts) {
    const avail = contextAvailable(context);
    if ((_ctxWasAvailable.get(context) ?? false) !== avail) {
      _ctxWasAvailable.set(context, avail);
      changed = true;
    }
  }
  for (const key of [..._ctxWasAvailable.keys()]) {
    if (!contexts.has(key)) _ctxWasAvailable.delete(key); // dropped opt-ins
  }
  reconcile();
  if (changed) dispatchPublishingChanged();
}

// Permission revoked mid-flight (spec §5/§8): stop the loop, delete every
// published node, and flip every opt-in off so the glyphs (repainted off the
// opt-in-changed event) show what is actually happening. The prefs flip also
// keeps reconcile()/visibility handlers from restarting a loop that can only
// fail. Re-enabling is the normal glyph tap, which re-proves permission.
function revokePermissionTeardown() {
  const gids = _getOptedInGids(); // snapshot BEFORE flipping prefs — see clearPublished
  const contexts = [...(getLocationOptIn('direct') ? ['direct'] : []), ...gids];
  _permissionDenied = true;
  clearGrantProven(); // 'prompt' is genuine after a real revocation — see GEO_PROVEN_KEY
  stopLoop();
  clearPublished(gids);
  _publishedContexts.clear();
  _lastPublished.clear();
  dispatchPublishingChanged();
  for (const context of contexts) setLocationOptIn(context, false);
  syncGroupStatusSubs();
  evaluateAvailability();
  // Same per-context event the glyph toggle dispatches, one per flipped context.
  for (const context of contexts) {
    document.dispatchEvent(new CustomEvent('location-optin-changed', { detail: { context } }));
  }
}

// Spec §5: the permission PROMPT fires only on explicit glyph intent — never
// from the background tick. A cross-device-synced opt-in can land on a device
// that hasn't granted geolocation; without this gate the first tick would
// surprise-prompt (and re-prompt every minute). Only 'granted' captures.
// Pass-through when the Permissions API is unavailable (older browsers) and
// in the Telegram context (LocationManager has no silent query) — both keep
// the pre-gate behavior. NOT used by the glyph-tap path (toggleContext),
// which must keep prompting on explicit intent.
let _geoPermStatus: { state: string; addEventListener?: (t: string, l: () => void) => void } | null = null;
// Device-local "geolocation grant proven here": set the first time a watch fix
// actually arrives (obtaining a fix never prompts unless the state is genuinely
// pre-grant, so a delivered fix ⇒ granted on this device). Persisted because
// iOS WebKit (PWA, device trace 2026-07-21) answers a FRESH
// permissions.query with 'prompt' after every reload until the session has
// used geolocation — the gate below trusted that lie, so background ticks
// froze after any reload until a glyph re-toggle. A 'prompt' answer is
// overridden by this proof; a device that never got a fix (cross-device-synced
// opt-in, spec §5) has no proof and keeps the no-surprise-prompt gate closed.
const GEO_PROVEN_KEY = 'statusapp_geo_grant_proven';
function grantProven(): boolean {
  try { return localStorage.getItem(GEO_PROVEN_KEY) === '1'; } catch { return false; }
}
function markGrantProven(): void {
  try { if (localStorage.getItem(GEO_PROVEN_KEY) !== '1') localStorage.setItem(GEO_PROVEN_KEY, '1'); } catch { /* storage denied */ }
}
function clearGrantProven(): void {
  try { localStorage.removeItem(GEO_PROVEN_KEY); } catch { /* storage denied */ }
}
async function tickPermissionGranted(): Promise<boolean> {
  if (isTelegramContext()) return true;
  const perms = (navigator as Navigator & {
    permissions?: { query?: (d: { name: string }) => Promise<{ state: string; addEventListener?: (t: string, l: () => void) => void }> };
  }).permissions;
  if (!perms?.query) return true;
  if (_geoPermStatus) {
    if (_geoPermStatus.state === 'granted') return true;
    // Never trust a retained non-granted state outright: WebKit can flip the
    // retained object spuriously around suspend/resume (device trace
    // 2026-07-21 21:12:05, one gate-closed tick amid healthy ones). Drop the
    // cache and fall through to a fresh query, where the device proof applies.
    _geoPermStatus = null;
  }
  try {
    const status = await perms.query({ name: 'geolocation' });
    // Cache ONLY a granted status (else keep per-tick queries): iOS WebKit
    // (PWA, device-confirmed 2026-07-20) never updates a retained pre-grant
    // PermissionStatus, so a cached 'prompt' froze the gate closed for the
    // whole session even after the glyph prove was granted — while a FRESH
    // query returned 'granted'. A cached granted status stays fail-safe on
    // revocation: capture itself rejects code 1 → revokePermissionTeardown.
    if (status.state === 'granted' && typeof status.addEventListener === 'function') _geoPermStatus = status;
    if (status.state === 'granted') return true;
    // 'prompt' from a fresh query is a lie on iOS WebKit when this device
    // already proved the grant (see GEO_PROVEN_KEY) — capture won't prompt.
    if (status.state === 'prompt' && grantProven()) return true;
    return false;
  } catch { return true; } // a query the browser rejects must not silence the loop
}

// One tick in flight is enough: resume moments double-fire (the throttled
// interval tick + the visibility catch-up tick, device trace 2026-07-21
// 21:55:29) — both read the same fix and race the <10m suppression before
// either write lands, duplicating the publish. The age bound keeps a tick
// wedged on a dead watch (a parked read that never settles — no error
// callback ever fires) from silencing the loop: after half a tick interval
// the next tick proceeds regardless.
let _tickInFlightSince: number | null = null;
async function tick(): Promise<void> {
  const now0 = Date.now();
  if (_tickInFlightSince !== null && now0 - _tickInFlightSince < TICK_MS / 2) return;
  _tickInFlightSince = now0;
  try { await tickInner(); } finally { _tickInFlightSince = null; }
}

async function tickInner(): Promise<void> {
  if (!_userId) return;
  // Time lapses fire no data tick — re-derive first (dispatches + stops the
  // loop if nothing is publishable anymore).
  evaluateAvailability();
  const direct = getLocationOptIn('direct') && contextAvailable('direct');
  const gids = _getOptedInGids().filter((gid) => contextAvailable(gid));
  if (!direct && gids.length === 0) return;
  if (!(await tickPermissionGranted())) return;
  let pos;
  try {
    pos = await getPositionOnce({ highAccuracy: direct });
  }
  catch (err) {
    // code 1 = PERMISSION_DENIED: revoked mid-flight → full teardown. Every
    // other failure is a silent failed tick (Decision 3).
    if ((err as { code?: number })?.code === 1) revokePermissionTeardown();
    return;
  }
  const now = Date.now();
  if (direct) {
    const uid = _userId;
    const last = _lastPublished.get('direct');
    if (!last || haversineMeters(last.lat, last.lng, pos.lat, pos.lng) >= RAW_REPUBLISH_MIN_METERS) {
      publishLocation(uid, pos.lat, pos.lng, now).then(() => {
        _lastPublished.set('direct', { lat: pos.lat, lng: pos.lng, landedAt: now });
        markPublished('direct');
      }).catch(() => {}); // failed tick is silent (Decision 3); no entry recorded → next tick retries
    }
  }
  // One write per cell, NOT multipath with the raw point — a stale-membership
  // cell denial must not take the precise tier down with it (db/location.js).
  // Only in-group-available gids publish; an unavailable group's cell simply
  // stays at last-known (never deleted here).
  const cell = snapToCell(pos.lat, pos.lng);
  for (const gid of gids) {
    const uid = _userId;
    const last = _lastPublished.get(gid);
    if (last && last.lat === cell.lat && last.lng === cell.lng
        && now - last.landedAt < STALE_MEMBERSHIP_PROBE_MS) continue;
    publishLocationCell(gid, uid, pos.lat, pos.lng, now).then(() => {
      _lastPublished.set(gid, { lat: cell.lat, lng: cell.lng, landedAt: now });
      markPublished(gid);
    }).catch((err) => {
      // A PERMISSION_DENIED cell write means stale membership (kicked while
      // opted in) — the rules' delete-only carve-out still allows clearing.
      // Sweep: clear the orphaned cell, drop the opt-in, and let the normal
      // teardown paths idle the loop. Anything else stays a silent failed
      // tick (Decision 3). Error shape emulator-verified against the real
      // SDK (2026-07-20): a rules-denied `set` rejects with error.code ===
      // 'PERMISSION_DENIED' and message 'PERMISSION_DENIED: Permission
      // denied' — both matched by the guard below.
      const reason = String((err as { code?: string; message?: string })?.code ?? (err as { message?: string })?.message ?? '');
      if (!/permission.denied/i.test(reason)) return;
      clearLocationCells(uid, [gid]).catch(() => {});
      setLocationOptIn(gid, false);
      unmarkPublished([gid]);
      syncGroupStatusSubs();
      evaluateAvailability();
      document.dispatchEvent(new CustomEvent('location-optin-changed', { detail: { context: gid } }));
    });
  }
}

function startLoop() {
  if (_timer !== null) return;
  _timer = setInterval(() => { tick(); }, TICK_MS);
  tick();
}

function stopLoop() {
  if (_timer !== null) { clearInterval(_timer); _timer = null; }
  stopGeoWatch(); // nothing publishes while stopped — release the geolocation watch
}

// `gids` lets a caller pass a snapshot taken BEFORE flipping a pref — needed
// because `_getOptedInGids()` filters live off the pref, so a snapshot taken
// after toggling the just-disabled context off would silently drop it (its
// cell would then never get cleared). Defaults to the live list. Clears are
// deliberately NOT availability-filtered — deletion must reach every opted
// context's node, in-group-available or not.
function clearPublished(gids?: string[]) {
  if (!_userId) return;
  clearLocationData(_userId, gids ?? _getOptedInGids()).catch(() => {});
}

function anyPublishable(): boolean {
  if (getLocationOptIn('direct') && contextAvailable('direct')) return true;
  return _getOptedInGids().some((gid) => contextAvailable(gid));
}

function reconcile() {
  if (anyPublishable()) startLoop();
  else stopLoop();
}

// One statusStore subscription per opted-in gid — the own EFFECTIVE in-group
// status (override-aware). Kept in sync with the opt-in set: toggles, the
// cross-device prefs echo, and revocation all re-run this.
function syncGroupStatusSubs() {
  const wanted = new Set(_getOptedInGids());
  for (const [gid, unsub] of [..._gidStatusUnsubs]) {
    if (wanted.has(gid)) continue;
    unsub();
    _gidStatusUnsubs.delete(gid);
    _gidSnapshots.delete(gid);
  }
  for (const gid of wanted) {
    if (_gidStatusUnsubs.has(gid)) continue;
    _gidStatusUnsubs.set(gid, subscribeOwnGroupStatus(gid, (snap: { available: boolean; availableUntil: number | null }) => {
      _gidSnapshots.set(gid, { available: snap.available, availableUntil: snap.availableUntil ?? null });
      evaluateAvailability();
    }));
  }
}

// Boot-time (and prefs-echo-time) seed of the published set: last-known
// nodes persist across sessions, so a fresh init must learn "does my node
// exist" from the server — this session may never publish (booting
// unavailable) yet the surfaces should attach to the persisted nodes
// immediately. Read-only probes; each context is re-checked against the
// live opt-in when its probe resolves so a context toggled off mid-probe
// can't be marked. A rejected probe (own-cell read after a group kick) is
// treated as absent.
function seedPublishedFromServer() {
  const uid = _userId;
  if (!uid) return;
  const probe = (context: string, exists: Promise<boolean>) => {
    exists.then((found) => {
      if (found && _userId === uid && getLocationOptIn(context)) markPublished(context);
    }).catch(() => {});
  };
  // Contexts already known-published skip the probe — markPublished would be
  // a guaranteed no-op there (audit F5: a prefs echo re-probed every opted-in
  // context on every sibling-device swatch tap, even ones already published).
  if (getLocationOptIn('direct') && !_publishedContexts.has('direct')) probe('direct', hasLocationNode(uid));
  for (const gid of _getOptedInGids()) {
    if (!_publishedContexts.has(gid)) probe(gid, hasLocationCell(gid, uid));
  }
}

export function capabilityState(): 'supported' | 'unsupported' {
  if (isTelegramContext()) {
    const tg = (window as unknown as { Telegram?: { WebApp?: { LocationManager?: unknown } } }).Telegram;
    return tg?.WebApp?.LocationManager ? 'supported' : 'unsupported';
  }
  return navigator.geolocation ? 'supported' : 'unsupported';
}

export function initLocationShare(userId: string, getOptedInGids: () => string[]) {
  _userId = userId;
  _getOptedInGids = getOptedInGids;
  _unsubOwn = subscribeOwnStatus((presence: PresenceNode | null) => {
    _lastPresence = presence;
    evaluateAvailability();
  });
  syncGroupStatusSubs();
  seedPublishedFromServer();
  // A server echo of the prefs can opt a context in/out from another device —
  // re-sync the per-gid status subs, re-derive availability, and re-probe for
  // nodes the other device may have published.
  _prefsSyncedListener = () => {
    syncGroupStatusSubs();
    evaluateAvailability();
    seedPublishedFromServer();
  };
  document.addEventListener('location-prefs-synced', _prefsSyncedListener);
  // Ticks run regardless of visibility (last-known model), but real browsers
  // throttle background timers — an opportunistic tick on return to
  // foreground catches the cadence back up. The watch is rebuilt FIRST:
  // suspension kills it with no error callback (device trace 2026-07-21), so
  // the catch-up tick would otherwise read the frozen pre-suspension cache.
  _visListener = () => {
    if (document.visibilityState !== 'visible') return;
    if (_watchId !== null) restartGeoWatch();
    if (_timer !== null) tick();
  };
  document.addEventListener('visibilitychange', _visListener);
}

// The glyph handler. Flips the context's pref; first enable proves permission
// with an immediate position read before committing the pref.
export async function toggleContext(context: string): Promise<'on' | 'off' | 'denied' | 'unsupported'> {
  if (getLocationOptIn(context)) {
    // Snapshot before flipping the pref — see clearPublished's note.
    const gidsBeforeToggle = _getOptedInGids();
    setLocationOptIn(context, false);
    if (!anyOptIn()) {
      stopLoop();
      clearPublished(gidsBeforeToggle);
      unmarkPublished([context, ...gidsBeforeToggle]);
    } else if (context !== 'direct' && _userId) {
      // Only this group's cell needs deleting; other contexts keep publishing.
      // Cells-only clear — locations/{uid} must never be touched here: even a
      // transient raw-point delete makes RTDB re-evaluate reciprocity and
      // cancel every peer listener, and an unawaited republish is unordered
      // against the delete on real infra.
      clearLocationCells(_userId, [context]).catch(() => {});
      unmarkPublished([context]);
    } else if (context === 'direct' && _userId) {
      // 'direct' turned off but a group remains opted in: only the raw point
      // may exist while 'direct' is opted in, so clear it (no cells — the
      // groups' cells are untouched).
      clearLocationData(_userId, []).catch(() => {});
      unmarkPublished(['direct']);
    }
    syncGroupStatusSubs();
    evaluateAvailability();
    document.dispatchEvent(new CustomEvent('location-optin-changed', { detail: { context } }));
    return 'off';
  }
  if (capabilityState() === 'unsupported') return 'unsupported';
  try {
    await getPositionOnce(); // permission prompt fires here, on explicit intent
    _permissionDenied = false; // covers the Telegram path, which has no watch-fix hook
  } catch (err) {
    if ((err as { code?: number })?.code === 1) { _permissionDenied = true; return 'denied'; }
    return 'unsupported';
  }
  // reconcile()->startLoop() (via evaluateAvailability) already runs an
  // immediate tick when starting a stopped loop; only run the explicit tick
  // below for the already-running case (startLoop() is a no-op there), or
  // this context's first enable would publish twice.
  const wasRunning = _timer !== null;
  setLocationOptIn(context, true);
  syncGroupStatusSubs();
  evaluateAvailability();
  if (wasRunning) {
    // Loop already publishing: this context's node doesn't exist yet, and it
    // isn't in _publishedContexts, so its surfaces won't attach-race the
    // missing node; markPublished (in tick()) attaches them once the publish
    // lands. Other contexts' nodes are untouched — their subs stay open.
    tick(); // immediate first publish for this context
  }
  document.dispatchEvent(new CustomEvent('location-optin-changed', { detail: { context } }));
  return 'on';
}

export async function _tickNow() { await tick(); }

export function _resetLocationShare() {
  stopLoop();
  if (_unsubOwn) { _unsubOwn(); _unsubOwn = null; }
  if (_visListener) { document.removeEventListener('visibilitychange', _visListener); _visListener = null; }
  if (_prefsSyncedListener) { document.removeEventListener('location-prefs-synced', _prefsSyncedListener); _prefsSyncedListener = null; }
  for (const unsub of _gidStatusUnsubs.values()) unsub();
  _gidStatusUnsubs.clear();
  _gidSnapshots.clear();
  _ctxWasAvailable.clear();
  _userId = null;
  _publishedContexts.clear();
  _lastPublished.clear();
  _lastPresence = null;
  _getOptedInGids = () => [];
  _geoPermStatus = null;
  _permissionDenied = false;
  _lastFix = null; // stopLoop() above already cleared the watch itself
  _lastWatchRestartAt = 0;
  _tickInFlightSince = null;
  dispatchPublishingChanged();
}
