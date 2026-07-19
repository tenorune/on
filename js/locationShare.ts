// js/locationShare.ts
// The location-sharing capture loop (spec 2026-07-18 §5, revised at device
// smoke 2026-07-19). One loop, gated per tick on: any context opted in ∧ own
// status available ∧ permission. Raw point published only when 'direct' is
// opted in; one snapped cell per opted-in group. Published nodes are
// LAST-KNOWN data: they persist across availability flaps and app restarts,
// and are deleted only when the user disables a context (glyph off) or OS
// permission is revoked — so peers' distance listeners stay attached and
// stable instead of being cancelled by node deletes. Failed ticks are silent
// by design (Decision 3): the last written value stands and the next tick
// tries again.
import { publishLocation, publishLocationCell, clearLocationData, clearLocationCells, hasLocationNode, hasLocationCell, isAvailable } from './db.js';
import { getLocationOptIn, setLocationOptIn } from './prefs.js';
import { subscribeOwnStatus } from './ownStatus.js';
import { isTelegramContext } from './telegram.js';

const TICK_MS = 60000;

let _userId: string | null = null;
let _getOptedInGids: () => string[] = () => [];
let _available = false;
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
// Last own-presence SNAPSHOT, kept so availability can be re-evaluated at
// tick time: expiry is a TIME event — the window can lapse with no presence
// DATA tick arriving, and the cached boolean alone would let the loop keep
// publishing raw coordinates against an expired window.
let _lastPresence: PresenceNode | null = null;
let _timer: ReturnType<typeof setInterval> | null = null;
let _unsubOwn: (() => void) | null = null;
let _visListener: (() => void) | null = null;
let _prefsSyncedListener: (() => void) | null = null;

function anyOptIn(): boolean {
  return getLocationOptIn('direct') || _getOptedInGids().length > 0;
}

// One position read, browser or Telegram. Rejects with the underlying error;
// callers map code 1 (PERMISSION_DENIED) to the denied state.
function getPositionOnce(): Promise<{ lat: number; lng: number }> {
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
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('unsupported')); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 },
    );
  });
}

// Availability re-evaluated from the stored snapshot (time-aware), not the
// cached boolean — see _lastPresence's note.
function presenceAvailable(): boolean {
  return isAvailable(_lastPresence?.status ?? null, _lastPresence?.availableUntil ?? null);
}

// Per-context eligibility read for the distance surfaces (following.ts /
// groupContext.ts): a surface may attach distance listeners for a context
// only while that context's own node is known to exist — attach-before-
// publish is rules-denied and permanently cancelled. Own availability is NOT
// part of eligibility anymore: last-known nodes persist, so the listeners
// stay readable (and open) across availability flaps.
export function isContextPublished(context: string): boolean {
  return _publishedContexts.has(context);
}

// Announces a published-context transition to the distance surfaces so their
// reconcile passes attach subs for a context that just landed its first
// publish (or detach for one whose node was just deleted).
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
  for (const context of contexts) changed = _publishedContexts.delete(context) || changed;
  if (changed) dispatchPublishingChanged();
}

// The single going-unavailable path: stop the loop, nothing else. The
// published nodes stay — they are the last-known data peers keep reading —
// and the published set is untouched, so the surfaces' subs stay open.
// Shared by the presence-subscription flip and the in-tick expiry
// re-evaluation so both transitions behave identically.
function goUnavailable() {
  _available = false;
  stopLoop();
}

// Permission revoked mid-flight (spec §5/§8): stop the loop, delete every
// published node, and flip every opt-in off so the glyphs (repainted off the
// opt-in-changed event) show what is actually happening. The prefs flip also
// keeps reconcile()/visibility handlers from restarting a loop that can only
// fail. Re-enabling is the normal glyph tap, which re-proves permission.
function revokePermissionTeardown() {
  const gids = _getOptedInGids(); // snapshot BEFORE flipping prefs — see clearPublished
  const contexts = [...(getLocationOptIn('direct') ? ['direct'] : []), ...gids];
  stopLoop();
  clearPublished(gids);
  _publishedContexts.clear();
  dispatchPublishingChanged();
  for (const context of contexts) setLocationOptIn(context, false);
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
async function tickPermissionGranted(): Promise<boolean> {
  if (isTelegramContext()) return true;
  const perms = (navigator as Navigator & {
    permissions?: { query?: (d: { name: string }) => Promise<{ state: string }> };
  }).permissions;
  if (!perms?.query) return true;
  try {
    const status = await perms.query({ name: 'geolocation' });
    return status.state === 'granted';
  } catch { return true; } // a query the browser rejects must not silence the loop
}

async function tick(): Promise<void> {
  if (!_userId) return;
  if (_available && !presenceAvailable()) { goUnavailable(); return; } // window lapsed mid-session
  if (!_available || !anyOptIn()) return;
  if (!(await tickPermissionGranted())) return;
  let pos;
  try { pos = await getPositionOnce(); }
  catch (err) {
    // code 1 = PERMISSION_DENIED: revoked mid-flight → full teardown. Every
    // other failure is a silent failed tick (Decision 3).
    if ((err as { code?: number })?.code === 1) revokePermissionTeardown();
    return;
  }
  const now = Date.now();
  if (getLocationOptIn('direct')) {
    publishLocation(_userId, pos.lat, pos.lng, now).then(() => markPublished('direct')).catch(() => {});
  }
  // One write per cell, NOT multipath with the raw point — a stale-membership
  // cell denial must not take the precise tier down with it (db/location.js).
  for (const gid of _getOptedInGids()) {
    publishLocationCell(gid, _userId, pos.lat, pos.lng, now).then(() => markPublished(gid)).catch(() => {});
  }
}

function startLoop() {
  if (_timer !== null) return;
  _timer = setInterval(() => { tick(); }, TICK_MS);
  tick();
}

function stopLoop() {
  if (_timer !== null) { clearInterval(_timer); _timer = null; }
}

// `gids` lets a caller pass a snapshot taken BEFORE flipping a pref — needed
// because `_getOptedInGids()` filters live off the pref, so a snapshot taken
// after toggling the just-disabled context off would silently drop it (its
// cell would then never get cleared). Defaults to the live list.
function clearPublished(gids?: string[]) {
  if (!_userId) return;
  clearLocationData(_userId, gids ?? _getOptedInGids()).catch(() => {});
}

function reconcile() {
  if (_available && anyOptIn()) startLoop();
  else stopLoop();
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
  if (getLocationOptIn('direct')) probe('direct', hasLocationNode(uid));
  for (const gid of _getOptedInGids()) probe(gid, hasLocationCell(gid, uid));
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
    const wasAvailable = _available;
    _available = presenceAvailable();
    if (wasAvailable && !_available) {
      goUnavailable();
    } else {
      reconcile();
      // No dispatch here on the up-flip: a first-ever publish may still be
      // mid-flight — markPublished() (in tick()) is the one that dispatches,
      // once the publish actually resolves. Contexts already in the set
      // never left it (nothing was deleted going unavailable), so their
      // surfaces' subs are still open and need no event.
    }
  });
  seedPublishedFromServer();
  // A server echo of the prefs can opt a context in from another device —
  // that device may have published the node already, so re-probe.
  _prefsSyncedListener = () => seedPublishedFromServer();
  document.addEventListener('location-prefs-synced', _prefsSyncedListener);
  // Ticks run regardless of visibility (last-known model), but real browsers
  // throttle background timers — an opportunistic tick on return to
  // foreground catches the cadence back up.
  _visListener = () => {
    if (document.visibilityState === 'visible' && _timer !== null) tick();
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
    document.dispatchEvent(new CustomEvent('location-optin-changed', { detail: { context } }));
    return 'off';
  }
  if (capabilityState() === 'unsupported') return 'unsupported';
  try {
    await getPositionOnce(); // permission prompt fires here, on explicit intent
  } catch (err) {
    if ((err as { code?: number })?.code === 1) return 'denied';
    return 'unsupported';
  }
  // reconcile()->startLoop() already runs an immediate tick when starting a
  // stopped loop; only run the explicit tick below for the already-running
  // case (startLoop() is a no-op there), or this context's first enable
  // would publish twice.
  const wasRunning = _timer !== null;
  setLocationOptIn(context, true);
  reconcile();
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
  _userId = null;
  _available = false;
  _publishedContexts.clear();
  _lastPresence = null;
  _getOptedInGids = () => [];
  dispatchPublishingChanged();
}
