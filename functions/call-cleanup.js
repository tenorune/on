// functions/call-cleanup.js
// When a call mailbox (calls/{uid}) is DELETED, null the counterpart mailbox if
// it still points back at the removed user. Prevents an orphaned survivor: once
// our node is gone, the peer cannot clear their own via endCall — the calls
// .write rule denies the atomic both-null against a node that's absent and not
// theirs — so they'd be stranded on the canvas until a manual RTDB delete.
//
// Guard: only reap a counterpart that still references the removed user, so we
// never cancel a call the peer has already moved on to. The reap deletes the
// counterpart, which re-fires this trigger for the peer; by then OUR node is
// already gone, so getVal returns null and it stops — no loop.
/**
 * @param {{ getVal: (p: string) => Promise<any>, set: (p: string, v: unknown) => Promise<void> }} deps
 * @param {string} removedUid  the uid whose calls/{uid} node was just deleted
 * @param {any} beforeVal      the deleted node's prior value
 */
export async function handleCallCleanup(deps, removedUid, beforeVal) {
  if (!beforeVal) return;
  const peer = beforeVal.to || beforeVal.from;
  if (!peer || typeof peer !== 'string') return;
  const counterpart = await deps.getVal(`calls/${peer}`);
  if (!counterpart) return;
  if (counterpart.to === removedUid || counterpart.from === removedUid) {
    await deps.set(`calls/${peer}`, null);
  }
}

// How old a call mailbox may get before a scheduled sweep reaps it. Conservative
// (a real call is far shorter): 12h ensures we never delete a genuinely-live
// call, only the debris of a call whose BOTH clients died mid-session without a
// clean hangup — the case handleCallCleanup can't catch, because neither node
// was ever deleted so no onCall deletion event ever fires. This is the one
// product knob; raise it if a legitimately longer canvas session is ever a thing.
export const CALL_TTL_MS = 12 * 60 * 60 * 1000;

// Scheduled sweep: null every calls/{uid} whose ts is older than ttlMs (or whose
// ts is missing/malformed — never a live call). Nulling each stale node also
// trips onCall's reaper for its counterpart. Full-map read is fine at this app's
// scale; if calls/ ever grows large, switch to an orderByChild('ts') query with
// a `.indexOn`. Returns the swept uids for logging.
/**
 * @param {{ now: () => number, getVal: (p: string) => Promise<any>, update: (p: string, obj: Record<string, unknown>) => Promise<void> }} deps
 * @param {number} ttlMs
 * @returns {Promise<string[]>}
 */
export async function handleCallSweep(deps, ttlMs) {
  const calls = await deps.getVal('calls');
  if (!calls || typeof calls !== 'object') return [];
  const cutoff = deps.now() - ttlMs;
  /** @type {Record<string, null>} */
  const nulls = {};
  const swept = [];
  for (const [uid, node] of Object.entries(calls)) {
    const ts = node && typeof node.ts === 'number' ? node.ts : null;
    if (ts === null || ts < cutoff) {
      nulls[uid] = null;
      swept.push(uid);
    }
  }
  if (swept.length) await deps.update('calls', nulls);
  return swept;
}
