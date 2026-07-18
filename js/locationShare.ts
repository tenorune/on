// js/locationShare.ts
// The location-sharing capture loop (spec 2026-07-18 §5). One loop, gated per
// tick on: any context opted in ∧ own status available ∧ document visible ∧
// permission. Raw point published only when 'direct' is opted in; one snapped
// cell per opted-in group. Going unavailable (or toggling the last context
// off) deletes everything published — the opt-in prefs survive, so returning
// to available resumes silently. Failed ticks are silent by design (Decision
// 3): the last written value stands and the next tick tries again.
import { publishLocation, publishLocationCell, clearLocationData, isAvailable } from './db.js';
import { getLocationOptIn, setLocationOptIn } from './prefs.js';
import { subscribeOwnStatus } from './ownStatus.js';
import { isTelegramContext } from './telegram.js';

const TICK_MS = 60000;

let _userId: string | null = null;
let _getOptedInGids: () => string[] = () => [];
let _available = false;
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

async function tick(): Promise<void> {
  if (!_userId || !_available || !anyOptIn()) return;
  if (document.visibilityState !== 'visible') return;
  let pos;
  try { pos = await getPositionOnce(); } catch { return; } // silent failed tick
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
    const wasAvailable = _available;
    _available = isAvailable(presence?.status ?? null, presence?.availableUntil ?? null);
    if (wasAvailable && !_available) { stopLoop(); clearPublished(); }
    else reconcile();
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
      clearLocationData(_userId, [context]).catch(() => {});
      // clearLocationData also nulls locations/{uid}; re-publish next tick if
      // direct is still on — acceptable within one tick, but avoid the gap:
      if (getLocationOptIn('direct')) tick();
    }
    return 'off';
  }
  if (capabilityState() === 'unsupported') return 'unsupported';
  try {
    await getPositionOnce(); // permission prompt fires here, on explicit intent
  } catch (err) {
    if ((err as { code?: number })?.code === 1) return 'denied';
    return 'unsupported';
  }
  setLocationOptIn(context, true);
  reconcile();
  if (_timer !== null) tick(); // immediate first publish for this context
  return 'on';
}

export async function _tickNow() { await tick(); }

export function _resetLocationShare() {
  stopLoop();
  if (_unsubOwn) { _unsubOwn(); _unsubOwn = null; }
  if (_visListener) { document.removeEventListener('visibilitychange', _visListener); _visListener = null; }
  _userId = null;
  _available = false;
  _getOptedInGids = () => [];
}
