// js/locationShare.ts
// The location-sharing capture loop (spec 2026-07-18 §5). One loop, gated per
// tick on: any context opted in ∧ own status available ∧ document visible ∧
// permission. Raw point published only when 'direct' is opted in; one snapped
// cell per opted-in group. Going unavailable (or toggling the last context
// off) deletes everything published — the opt-in prefs survive, so returning
// to available resumes silently. Failed ticks are silent by design (Decision
// 3): the last written value stands and the next tick tries again.
import { publishLocation, publishLocationCell, clearLocationData, clearLocationCells, isAvailable } from './db.js';
import { getLocationOptIn, setLocationOptIn } from './prefs.js';
import { subscribeOwnStatus } from './ownStatus.js';
import { isTelegramContext } from './telegram.js';

const TICK_MS = 60000;

let _userId: string | null = null;
let _getOptedInGids: () => string[] = () => [];
let _available = false;
// Ground truth for the distance surfaces' eligibility, per the final-review
// fix: "own node published this spell", not "available". The available-status
// flip races the async publish chain (permission check -> getPositionOnce()
// 0.1-5s -> write RTT); a distance listener attached the instant status flips
// arrives at locations/{me} before the node exists, gets rules-denied on
// reciprocity, and is cancelled by the SDK PERMANENTLY (no retry). Flipped
// true only once a publish actually lands (markPublished, in tick()); reset
// on every teardown path (goUnavailable, revokePermissionTeardown, last-
// context-off, _resetLocationShare) so a stale true never survives a delete.
let _published = false;
// Last own-presence SNAPSHOT, kept so availability can be re-evaluated at
// tick time: expiry is a TIME event — the window can lapse with no presence
// DATA tick arriving, and the cached boolean alone would let the loop keep
// publishing raw coordinates against an expired window.
let _lastPresence: PresenceNode | null = null;
// First-own-status-tick marker for the launch-time stale-row sweep (spec §8):
// closing the app while Available leaves locations/{uid} (+cells) behind, and
// the normal clear path only runs on an available→unavailable TRANSITION —
// which a fresh boot never sees (wasAvailable starts false).
let _firstStatusSeen = false;
let _timer: ReturnType<typeof setInterval> | null = null;
let _unsubOwn: (() => void) | null = null;
let _visListener: (() => void) | null = null;

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
          init: (cb?: () => void) => void;
          getLocation: (cb: (data: { latitude: number; longitude: number } | null) => void) => void;
        } } };
      }).Telegram?.WebApp?.LocationManager;
      if (!lm) { reject(new Error('unsupported')); return; }
      lm.init(() => {
        lm.getLocation((data) => {
          if (data) resolve({ lat: data.latitude, lng: data.longitude });
          else reject({ code: 1 }); // user declined in Telegram's dialog
        });
      });
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

// Own-availability read for the distance surfaces (following.ts /
// groupContext.ts): spec §6.2 opens distance subscriptions only while the
// viewer is PUBLISHING in the relevant context — own availability ∧ opt-in.
// The opt-in half lives in prefs; this exports the availability half.
// Time-aware (recomputed from the snapshot), so it flips false the moment
// the window lapses even before any presence tick lands.
export function isPublishingAvailable(): boolean {
  return presenceAvailable() && _published;
}

// Announces an available/unavailable transition to the distance surfaces so
// their reconcile passes close subs on unavailable (the server has cancelled
// the underlying listeners anyway) and REOPEN fresh ones on available.
function dispatchPublishingChanged() {
  document.dispatchEvent(new CustomEvent('location-publishing-changed'));
}

// tick()'s publish-resolution hook: flips _published true on the FIRST landed
// publish of an up-transition and notifies the surfaces THEN — not on the
// earlier status flip, which would race the async publish chain (see
// _published's note). Guarded on the flag itself so it fires once per
// up-transition, not on every subsequent 60s tick's resolution.
function markPublished() {
  if (_published) return;
  _published = true;
  dispatchPublishingChanged();
}

// The single going-unavailable path: stop the loop, delete everything
// published. Shared by the presence-subscription flip and the in-tick expiry
// re-evaluation so both transitions behave identically.
function goUnavailable() {
  _available = false;
  stopLoop();
  clearPublished();
  _published = false;
  dispatchPublishingChanged();
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
  _published = false;
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
  if (document.visibilityState !== 'visible') return;
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
    publishLocation(_userId, pos.lat, pos.lng, now).then(markPublished).catch(() => {});
  }
  // One write per cell, NOT multipath with the raw point — a stale-membership
  // cell denial must not take the precise tier down with it (db/location.js).
  for (const gid of _getOptedInGids()) {
    publishLocationCell(gid, _userId, pos.lat, pos.lng, now).then(markPublished).catch(() => {});
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
// cell would then never get cleared). Defaults to the live list for the
// going-unavailable path, where no pref has changed.
function clearPublished(gids?: string[]) {
  if (!_userId) return;
  clearLocationData(_userId, gids ?? _getOptedInGids()).catch(() => {});
}

function reconcile() {
  if (_available && anyOptIn()) startLoop();
  else stopLoop();
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
  _firstStatusSeen = false;
  _unsubOwn = subscribeOwnStatus((presence: PresenceNode | null) => {
    _lastPresence = presence;
    const firstTick = !_firstStatusSeen;
    _firstStatusSeen = true;
    const wasAvailable = _available;
    _available = presenceAvailable();
    if (wasAvailable && !_available) {
      goUnavailable();
    } else {
      reconcile();
      // No dispatch here on the up-flip: locations/{me} doesn't exist yet —
      // reconcile()->startLoop() just kicked off tick()'s async publish
      // chain. Firing now would let the surfaces attach distance listeners
      // before the node lands, get rules-denied on reciprocity, and be
      // cancelled by the SDK permanently. markPublished() (in tick()) is the
      // one that dispatches, once the publish actually resolves.
    }
    // Launch-time stale-row sweep (spec §8): booting unavailable while any
    // context is opted in means whatever the last session published is stale
    // — delete it opportunistically. Also the "kicked from a group" cleanup:
    // the delete-only rules carve-out lets the orphaned cell go too. Only on
    // the FIRST tick; later unavailable ticks are transitions, not launches.
    if (firstTick && !_available && anyOptIn()) clearPublished();
  });
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
      _published = false;
      dispatchPublishingChanged();
    } else if (context !== 'direct' && _userId) {
      // Only this group's cell needs deleting; other contexts keep publishing.
      // Cells-only clear — locations/{uid} must never be touched here: even a
      // transient raw-point delete makes RTDB re-evaluate reciprocity and
      // cancel every peer's precise-tier listener, and an unawaited republish
      // is unordered against the delete on real infra.
      clearLocationCells(_userId, [context]).catch(() => {});
    } else if (context === 'direct' && _userId) {
      // 'direct' turned off but a group remains opted in: only the raw point
      // may exist while 'direct' is opted in, so clear it (no cells — the
      // groups' cells are untouched).
      clearLocationData(_userId, []).catch(() => {});
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
    // Loop already publishing (spec final-review): the new context's cell
    // doesn't exist yet until this tick's republish lands. Reset + dispatch
    // BEFORE kicking it off so surfaces close the momentarily-ineligible subs
    // instead of attach-racing the missing node; markPublished's own dispatch
    // (in tick()) reopens them once the publish actually resolves.
    _published = false;
    dispatchPublishingChanged();
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
  _userId = null;
  _available = false;
  _published = false;
  _lastPresence = null;
  _firstStatusSeen = false;
  _getOptedInGids = () => [];
  dispatchPublishingChanged();
}
