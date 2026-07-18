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
// Last own-presence SNAPSHOT, kept so availability can be re-evaluated at
// tick time: expiry is a TIME event — the window can lapse with no presence
// DATA tick arriving, and the cached boolean alone would let the loop keep
// publishing raw coordinates against an expired window.
let _lastPresence: PresenceNode | null = null;
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
  return presenceAvailable();
}

// Announces an available/unavailable transition to the distance surfaces so
// their reconcile passes close subs on unavailable (the server has cancelled
// the underlying listeners anyway) and REOPEN fresh ones on available.
function dispatchPublishingChanged() {
  document.dispatchEvent(new CustomEvent('location-publishing-changed'));
}

// The single going-unavailable path: stop the loop, delete everything
// published. Shared by the presence-subscription flip and the in-tick expiry
// re-evaluation so both transitions behave identically.
function goUnavailable() {
  _available = false;
  stopLoop();
  clearPublished();
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
  for (const context of contexts) setLocationOptIn(context, false);
  // Same per-context event the glyph toggle dispatches, one per flipped context.
  for (const context of contexts) {
    document.dispatchEvent(new CustomEvent('location-optin-changed', { detail: { context } }));
  }
}

async function tick(): Promise<void> {
  if (!_userId) return;
  if (_available && !presenceAvailable()) { goUnavailable(); return; } // window lapsed mid-session
  if (!_available || !anyOptIn()) return;
  if (document.visibilityState !== 'visible') return;
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
    publishLocation(_userId, pos.lat, pos.lng, now).catch(() => {});
  }
  // One write per cell, NOT multipath with the raw point — a stale-membership
  // cell denial must not take the precise tier down with it (db/location.js).
  for (const gid of _getOptedInGids()) {
    publishLocationCell(gid, _userId, pos.lat, pos.lng, now).catch(() => {});
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
  _unsubOwn = subscribeOwnStatus((presence: PresenceNode | null) => {
    _lastPresence = presence;
    const wasAvailable = _available;
    _available = presenceAvailable();
    if (wasAvailable && !_available) {
      goUnavailable();
    } else {
      reconcile();
      if (!wasAvailable && _available) dispatchPublishingChanged();
    }
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
    if (!anyOptIn()) { stopLoop(); clearPublished(gidsBeforeToggle); }
    else if (context !== 'direct' && _userId) {
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
  if (wasRunning) tick(); // immediate first publish for this context
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
  _lastPresence = null;
  _getOptedInGids = () => [];
}
