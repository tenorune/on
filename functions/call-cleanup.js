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
