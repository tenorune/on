// js/ownStatus.js
// Single owner of the own-user `users/{uid}/presence` subscription. Before this, three
// places opened watchStatus(self) — app.js (call-mode recovery + theme + own
// card), groupNav (nav cards), groupContext (own row + override palette) — so
// every status write, and every follower/social-graph write to the shared user
// node, was delivered three times. This collapses them to one underlying watch
// with a registration-order fan-out. (Knocks were moved to a top-level mailbox
// in the presence-schema-split work, so they no longer perturb this watch.)
//
// ORDERING INVARIANT: callbacks fire in registration order, which equals the
// consumers' boot/attach order (groupNav.initNav → app.js handler →
// groupContext on enter). app.js's handler writes the Direct theme to :root;
// groupContext's handler (registered later, on group enter) re-applies the
// group-override theme on the SAME tick and must win. Do not reorder
// registration or change the Set's insertion-ordered iteration.

import { watchPresence } from './db.js';

type OwnStatusCb = (data: PresenceNode | null) => void;

const NO_TICK = Symbol('no-tick'); // distinct from null (= user node absent)
let _unsub: (() => void) | null = null;
let _last: PresenceNode | null | typeof NO_TICK = NO_TICK;
const _subs = new Set<OwnStatusCb>();

export function initOwnStatus(uid: string) {
  if (_unsub) _unsub();
  _last = NO_TICK;
  _unsub = watchPresence(uid, (data) => {
    _last = data;
    // Snapshot before iterating: a consumer that (un)subscribes from within its
    // own tick handler must not be double-delivered (newly-added consumers get
    // exactly one delivery, via subscribeOwnStatus's synchronous replay) or
    // visited after removal. Registration order is preserved by the spread.
    for (const cb of [..._subs]) {
      if (!_subs.has(cb)) continue; // unsubscribed mid-fan-out — skip
      try { cb(data); } catch { /* one consumer's handler threw — keep going */ }
    }
  });
}

export function subscribeOwnStatus(cb: OwnStatusCb) {
  _subs.add(cb);
  // Replay only if a real tick has landed (NO_TICK guard). A null replay is
  // legitimate — it means the user node is absent, which consumers handle.
  if (_last !== NO_TICK) {
    try { cb(_last); } catch { /* replay handler threw */ }
  }
  return () => { _subs.delete(cb); };
}
