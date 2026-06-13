// js/presenceHub.js
// Multiplexes watchPresence(uid) so a user watched by more than one renderer —
// e.g. a mutual who is also a group co-member — has ONE underlying onValue on
// users/{uid}/presence, fanned out to every consumer, instead of N independent
// listeners on the same node (#214 R3). Both the Direct list (following.js) and
// the group roster (groupContext.js) subscribe through here.
//
// subscribePresence(uid, cb) returns an unsubscribe fn with the same contract as
// watchPresence's, so call sites swap one for the other and keep their existing
// teardown. The underlying watch is created on the first consumer and torn down
// when the last one leaves. The most recent value is cached per uid and replayed
// (async) to a late consumer, so a second subscriber doesn't render a stale
// "Unavailable" until the node's next write.
import { watchPresence } from './db.js';

const _entries = new Map(); // uid → { unsub, consumers: Set<cb>, last, hasValue }

export function subscribePresence(uid, cb) {
  let e = _entries.get(uid);
  const isNew = !e;
  if (isNew) {
    e = { unsub: null, consumers: new Set(), last: undefined, hasValue: false };
    _entries.set(uid, e);
  }
  // Register the consumer BEFORE creating the underlying watch, so a watch that
  // delivers its first value synchronously (during the watchPresence call) still
  // reaches us. For a uid that was already being watched, the underlying watch
  // won't re-fire just for a new consumer, so replay the cached value (async, to
  // avoid re-entering a caller's render loop).
  e.consumers.add(cb);
  if (isNew) {
    e.unsub = watchPresence(uid, (data) => {
      e.last = data;
      e.hasValue = true;
      // Copy so a consumer unsubscribing during fan-out can't mutate the live set.
      for (const c of [...e.consumers]) { try { c(data); } catch { /* one consumer threw */ } }
    });
  } else if (e.hasValue) {
    const v = e.last;
    Promise.resolve().then(() => {
      const cur = _entries.get(uid);
      if (cur && cur.consumers.has(cb)) cb(v);
    });
  }
  return () => {
    const cur = _entries.get(uid);
    if (!cur) return;
    cur.consumers.delete(cb);
    if (cur.consumers.size === 0) {
      if (cur.unsub) cur.unsub();
      _entries.delete(uid);
    }
  };
}

// How many underlying watches are live — for tests/diagnostics.
export function _activeWatchCount() {
  return _entries.size;
}

// Tear everything down (tests).
export function _resetPresenceHub() {
  for (const e of _entries.values()) { if (e.unsub) e.unsub(); }
  _entries.clear();
}
