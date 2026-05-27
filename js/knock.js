// js/knock.js
import { writeKnock, getKnocks, watchKnocksAdded, clearKnock } from './db.js';
import { getCurrentContext } from './groupNav.js';

// Module-level state — reset by initKnocks on each call
let debounceMap = new Map();   // recipientId → last knock timestamp
let deferredKeys = new Set();  // senderIds from snapshot; blocks live listener until cleared
let snapshotPending = false;   // true while waiting for getKnocks to resolve
let unsubKnocks = null;
let cachedUserId = null;       // stored so the visibility handler can re-call initKnocks

const INTENSITY_STEP = 0.4;
let pulseMap = new Map();      // senderId → { intensity: number, timerId: number | null }
let pendingByGroup = new Map(); // groupId → Set<senderId>: knocks received while user
                                 // wasn't in the right group context; drained on enter.

// Send a knock to recipientId. Guards: debounce (300ms). Flash fires only after debounce passes.
export function sendKnock(recipientId, senderId, statusColor, opts = {}) {
  const now = Date.now();
  if (now - (debounceMap.get(recipientId) ?? 0) < 300) return;
  debounceMap.set(recipientId, now);

  const li = document.querySelector(`[data-user-id="${recipientId}"]`);
  if (li) {
    // Use the recipient's current status color; fall back to grey when Unavailable
    const color = li.dataset.available === 'true' ? (statusColor || '#22c55e') : getKnockColor(li);
    li.style.setProperty('--knock-color', color);
    li.classList.add('knock-sender');
    li.addEventListener('animationend', () => li.classList.remove('knock-sender'), { once: true });
  }

  writeKnock(recipientId, senderId, opts);
}

// Initialize knock state and start listening. Call after initList so DOM exists.
export async function initKnocks(myUserId) {
  cachedUserId = myUserId;

  // Reset all module-level state
  debounceMap = new Map();
  deferredKeys = new Set();
  snapshotPending = true;
  if (unsubKnocks) { unsubKnocks(); unsubKnocks = null; }
  pulseMap.forEach(({ timerId }) => { if (timerId) clearTimeout(timerId); });
  pulseMap = new Map();
  pendingByGroup = new Map();
  floatTimers.forEach(({ timerId }) => { if (timerId) clearTimeout(timerId); });
  floatTimers.clear();
  groupBadgeCounts.clear();

  const appOpenTime = Date.now();

  // 1. Attach live listener synchronously (before any await) so we catch events
  //    that arrive during the snapshot fetch. Events arriving while snapshotPending
  //    is true are held until deferredKeys is populated; senders in deferredKeys
  //    are then skipped (they will be handled by the deferred batch).
  unsubKnocks = watchKnocksAdded(myUserId, (senderId, payload) => {
    const count = payload.count;
    const ts = payload.ts;
    const contextGroupId = payload.contextGroupId || null;
    // Skip senders from the initial snapshot (handled as deferred)
    if (snapshotPending || deferredKeys.has(senderId)) return;
    // App is backgrounded or on canvas — leave knock in DB so the next initKnocks
    // (on foreground / canvas exit) picks it up via getKnocks and shows it as deferred.
    if (document.visibilityState !== 'visible') return;
    const canvasScreen = document.getElementById('canvas-screen');
    if (canvasScreen && canvasScreen.classList.contains('active')) return;
    // Stale-knock check: only knocks that are clearly older than "this
    // session" should fall to the deferred path. Tolerate up to 60s of
    // clock skew between sender and recipient — without this, a fresh
    // cross-device knock can be misclassified as deferred when the
    // sender's clock runs a few seconds behind the recipient's.
    if (ts < appOpenTime - 60000) {
      applyDeferredKnock(senderId, contextGroupId);
      clearKnock(myUserId, senderId).catch(() => {});
      return;
    }
    const li = findKnockTargetCard(senderId, contextGroupId);
    if (!li) {
      if (contextGroupId) {
        bumpGroupCardBadge(contextGroupId);
        // Stash so the animation replays when the user enters this group.
        if (!pendingByGroup.has(contextGroupId)) pendingByGroup.set(contextGroupId, new Set());
        pendingByGroup.get(contextGroupId).add(senderId);
      }
      return;
    }
    applyLiveKnock(senderId, count, li);
    applyFloatToTop(li);
    // Bring the prepended li into view in group context — without this, a
    // user scrolled down in a long roster misses the float-to-top entirely.
    if (contextGroupId) window.scrollTo({ top: 0, behavior: 'smooth' });
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

  Object.entries(snapshot.val()).forEach(([senderId, payload]) => {
    toDelete.push(senderId);
    const ts = payload?.ts ?? 0;
    if (ts >= appOpenTime - 24 * 60 * 60 * 1000) {
      toAnimate.push({ senderId, contextGroupId: payload?.contextGroupId || null });
    }
    // Older-than-24h: added to toDelete but not toAnimate (silent delete)
  });

  // 5. Delete only snapshot keys; new knocks arriving after get() are not deleted
  await Promise.all(toDelete.map(senderId => clearKnock(myUserId, senderId).catch(() => {})));

  // 6. Clear deferredKeys — live listener now processes all senders normally
  deferredKeys.clear();

  // 7. Trigger all deferred animations simultaneously. For group-scoped
  //    knocks where the user isn't currently in that group context,
  //    findKnockTargetCard returns null — stash so drainPendingKnocks can
  //    replay the animation when they navigate to the group.
  toAnimate.forEach(({ senderId, contextGroupId }) => {
    const li = findKnockTargetCard(senderId, contextGroupId);
    if (li) {
      applyDeferredKnock(senderId, contextGroupId);
      applyFloatToTop(li);
    } else if (contextGroupId) {
      if (!pendingByGroup.has(contextGroupId)) pendingByGroup.set(contextGroupId, new Set());
      pendingByGroup.get(contextGroupId).add(senderId);
      bumpGroupCardBadge(contextGroupId);
    }
  });
}

/**
 * Replay queued knocks for a group the moment the user enters its context.
 * Each pending sender gets the deferred-knock animation + float-to-top
 * applied. Called from groupContext.enterGroupContext after the roster
 * has rendered (so findKnockTargetCard can resolve the li).
 */
export function drainPendingKnocks(groupId) {
  const set = pendingByGroup.get(groupId);
  if (!set || set.size === 0) return;
  // Take a snapshot then clear so re-entry doesn't double-animate.
  const senderIds = Array.from(set);
  pendingByGroup.delete(groupId);
  if (!cachedUserId) return;
  senderIds.forEach((senderId) => {
    const li = findKnockTargetCard(senderId, groupId);
    if (!li) return; // still not in DOM (race) — drop silently
    applyDeferredKnock(senderId, groupId);
    applyFloatToTop(li);
    clearKnock(cachedUserId, senderId).catch(() => {});
  });
  // Bring the prepended items into view.
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Returns the color to use for knock animations on this card.
// Uses grey when the person is Unavailable so the pulse matches their dot state.
function getKnockColor(li) {
  if (li.dataset.available !== 'true') {
    return getComputedStyle(document.documentElement).getPropertyValue('--dot-off').trim() || '#6b7280';
  }
  const dot = li.querySelector('.person-dot');
  return (dot && dot.style.background) || '#22c55e';
}

export function colorToRgba(color, alpha) {
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  // rgb(r, g, b) — browser-normalized form
  const m = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
  return `rgba(34, 197, 94, ${alpha})`; // fallback: green
}

function applyLiveKnock(senderId, count, li) {
  if (!li) li = document.querySelector(`[data-user-id="${senderId}"]`);
  if (!li) return;

  const color = getKnockColor(li);
  const current = pulseMap.get(senderId) ?? { intensity: 0, timerId: null };
  if (current.timerId) clearTimeout(current.timerId);

  const newIntensity = Math.min(1, current.intensity + count * INTENSITY_STEP);

  // Instant rise (no transition)
  // Use inset box-shadow instead of background-color so the pulse overlays without
  // conflicting with the palette card background set by updateFolloweeRow.
  li.style.transition = 'none';
  li.style.boxShadow = `inset 0 0 0 9999px ${colorToRgba(color, newIntensity)}`;
  void li.offsetHeight; // force reflow

  // Begin 2s decay
  li.style.transition = 'box-shadow 2s ease-out';
  li.style.boxShadow = `inset 0 0 0 9999px ${colorToRgba(color, 0)}`;

  const timerId = setTimeout(() => {
    li.style.transition = '';
    li.style.boxShadow = '';
    pulseMap.delete(senderId);
  }, 2100);

  pulseMap.set(senderId, { intensity: newIntensity, timerId });
}

function applyDeferredKnock(userId, contextGroupId) {
  // Route through findKnockTargetCard so a deferred knock that carries a
  // contextGroupId animates the right element (the group-roster li) instead
  // of the global-first match (which can land on a hidden Direct contact li
  // when the recipient is currently in group context).
  const li = findKnockTargetCard(userId, contextGroupId || null);
  if (!li) return; // not in DOM — skip silently

  li.style.setProperty('--knock-color', getKnockColor(li));
  li.classList.add('knock-deferred');
  li.addEventListener('animationend', () => li.classList.remove('knock-deferred'), { once: true });
}

// ── Float-to-top ─────────────────────────────────────────────────────────────

const FLOAT_MS = 20000;
const floatTimers = new Map(); // userId → { timerId, originalParent, originalSibling }

export function applyFloatToTop(li) {
  if (!li) return;
  const list = li.parentNode;
  if (!list) return;
  const userId = li.dataset.userId;
  if (floatTimers.has(userId)) {
    clearTimeout(floatTimers.get(userId).timerId);
  } else {
    floatTimers.set(userId, {
      originalParent: list,
      originalSibling: li.nextSibling,
      timerId: null,
    });
  }
  list.prepend(li);
  const timerId = setTimeout(() => restoreFromFloat(userId), FLOAT_MS);
  floatTimers.get(userId).timerId = timerId;
}

function restoreFromFloat(userId) {
  const entry = floatTimers.get(userId);
  if (!entry) return;
  const li = document.querySelector(`[data-user-id="${userId}"]`);
  if (li && entry.originalParent) {
    entry.originalParent.insertBefore(li, entry.originalSibling || null);
  }
  floatTimers.delete(userId);
}

export function getFloatedUserIds() {
  return Array.from(floatTimers.keys());
}

// ── Group card badge ──────────────────────────────────────────────────────────

const groupBadgeCounts = new Map();

export function bumpGroupCardBadge(groupId) {
  const current = (groupBadgeCounts.get(groupId) || 0) + 1;
  groupBadgeCounts.set(groupId, current);
  renderGroupBadge(groupId, current);
}

export function clearGroupCardBadge(groupId) {
  groupBadgeCounts.delete(groupId);
  renderGroupBadge(groupId, 0);
}

function renderGroupBadge(groupId, count) {
  const card = document.querySelector(`.group-card[data-group-id="${groupId}"]`);
  if (!card) return;
  let badge = card.querySelector('.group-card-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'group-card-badge';
      card.appendChild(badge);
    }
    badge.textContent = String(count);
  } else if (badge) {
    badge.remove();
  }
}

// ── Context-aware knock target lookup ────────────────────────────────────────

function findKnockTargetCard(senderId, contextGroupId) {
  if (contextGroupId) {
    const cur = getCurrentContext();
    if (cur.context === 'group' && cur.groupId === contextGroupId) {
      return document.querySelector(`#group-roster [data-user-id="${senderId}"]`);
    }
    return null; // recipient is in a different context; caller bumps the badge
  }
  return document.querySelector(`[data-user-id="${senderId}"]`);
}

// Re-run initKnocks when the app returns to the foreground or exits canvas,
// so that knocks received while backgrounded/on-canvas are shown as deferred.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && cachedUserId) {
    initKnocks(cachedUserId);
  }
});
document.addEventListener('canvas-exited', () => {
  if (cachedUserId) initKnocks(cachedUserId);
});
