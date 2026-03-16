// js/knock.js
import { writeKnock, getKnocks, watchKnocksAdded, clearKnock } from './db.js';

// Module-level state — reset by initKnocks on each call
let debounceMap = new Map();   // recipientId → last knock timestamp
let queue = [];                // { userId, animationType, ts }
let deferredKeys = new Set();  // senderIds from snapshot; blocks live listener until cleared
let snapshotPending = false;   // true while waiting for getKnocks to resolve
let isPlaying = false;
let unsubKnocks = null;

// Send a knock to recipientId. Guards: debounce (300ms). Flash fires only after debounce passes.
export function sendKnock(recipientId, senderId, statusColor) {
  const color = statusColor || '#22c55e';
  const now = Date.now();
  if (now - (debounceMap.get(recipientId) ?? 0) < 300) return;
  debounceMap.set(recipientId, now);

  const li = document.querySelector(`[data-user-id="${recipientId}"]`);
  if (li) {
    li.style.setProperty('--knock-color', color);
    li.classList.add('knock-sender');
    li.addEventListener('animationend', () => li.classList.remove('knock-sender'), { once: true });
  }

  writeKnock(recipientId, senderId);
}

// Initialize knock state and start listening. Call after initList so DOM exists.
export async function initKnocks(myUserId) {
  // Reset all module-level state
  debounceMap = new Map();
  queue = [];
  deferredKeys = new Set();
  snapshotPending = true;
  isPlaying = false;
  if (unsubKnocks) { unsubKnocks(); unsubKnocks = null; }

  const appOpenTime = Date.now();

  // 1. Attach live listener synchronously (before any await) so we catch events
  //    that arrive during the snapshot fetch. Events arriving while snapshotPending
  //    is true are held until deferredKeys is populated; senders in deferredKeys
  //    are then skipped (they will be handled by the deferred batch).
  unsubKnocks = watchKnocksAdded(myUserId, (senderId, { count, ts }) => {
    // Skip senders from the initial snapshot (handled as deferred)
    if (snapshotPending || deferredKeys.has(senderId)) return;
    // Enqueue count × live animations
    for (let i = 0; i < count; i++) {
      enqueue({ userId: senderId, animationType: 'live', ts: Date.now() });
    }
    clearKnock(myUserId, senderId).catch(() => {});
  });

  // 2. Read deferred knocks (one-time get)
  const snapshot = await getKnocks(myUserId);

  // 3. Populate deferredKeys from snapshot, then clear the pending flag so
  //    live events for non-deferred senders are processed normally going forward.
  if (snapshot.exists()) {
    Object.keys(snapshot.val()).forEach(senderId => deferredKeys.add(senderId));
  }
  snapshotPending = false;

  if (!snapshot.exists()) return;

  // 4. Categorize snapshot entries
  const toDelete = [];
  const toAnimate = [];

  Object.entries(snapshot.val()).forEach(([senderId, { count, ts }]) => {
    toDelete.push(senderId);
    if (ts >= appOpenTime - 24 * 60 * 60 * 1000) {
      toAnimate.push({ userId: senderId, animationType: 'deferred', ts });
    }
    // Older-than-24h: added to toDelete but not toAnimate (silent delete)
  });

  // 5. Delete only snapshot keys; new knocks arriving after get() are not deleted
  await Promise.all(toDelete.map(senderId => clearKnock(myUserId, senderId).catch(() => {})));

  // 6. Clear deferredKeys — live listener now processes all senders normally
  deferredKeys.clear();

  // 7. Sort deferred queue by ts ascending and begin playback
  toAnimate.sort((a, b) => a.ts - b.ts);
  toAnimate.forEach(entry => enqueue(entry));
}

function enqueue(entry) {
  queue.push(entry);
  if (!isPlaying) playNext();
}

function playNext() {
  if (queue.length === 0) { isPlaying = false; return; }
  isPlaying = true;
  const entry = queue.shift();

  const li = document.querySelector(`[data-user-id="${entry.userId}"]`);
  if (!li) { playNext(); return; } // not in DOM — skip silently

  li.style.setProperty('--knock-color', '#22c55e');
  const cls = entry.animationType === 'live' ? 'knock-live' : 'knock-deferred';
  li.classList.add(cls);

  let advanced = false;
  function advance() {
    if (advanced) return;
    advanced = true;
    clearTimeout(fallback);
    li.classList.remove(cls);
    const gap = (queue[0] && queue[0].userId === entry.userId) ? 300 : 500;
    setTimeout(playNext, gap);
  }

  const fallback = setTimeout(advance, 1200); // guard: advance if animationend never fires
  li.addEventListener('animationend', advance, { once: true });
}
