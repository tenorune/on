// js/knock.js
import { writeKnock, getKnocks, watchKnocksAdded, clearKnock } from './db.js';
import { getCurrentContext, onContextChange } from './groupNav.js';
import { isCardDrawerOpen } from './cardDrawer.js';

// Module-level state — reset by initKnocks on each call
let debounceMap = new Map();   // recipientId → last knock timestamp
let deferredKeys = new Set();  // senderIds from snapshot; blocks live listener until cleared
let snapshotPending = false;   // true while waiting for getKnocks to resolve
let unsubKnocks = null;
let cachedUserId = null;       // stored so the visibility handler can re-call initKnocks
let contextSubInitialized = false;

const INTENSITY_STEP = 0.4;
let pulseMap = new Map();      // senderId → { intensity: number, timerId: number | null }
let pendingByGroup = new Map(); // groupId → Set<senderId>: knocks received while user
                                 // wasn't in the right group context; drained on enter.
let pendingDirect = new Set();  // senderIds for Direct-scope knocks received while
                                 // user wasn't in Direct context; drained on entry.

// Send a knock to recipientId. Guards: debounce (300ms). Flash fires only after debounce passes.
export function sendKnock(recipientId, senderId, statusColor, opts = {}) {
  const now = Date.now();
  if (now - (debounceMap.get(recipientId) ?? 0) < 300) return;
  debounceMap.set(recipientId, now);

  // Resolve the li in the current context — same scoping as the deferred /
  // live pulse handlers, so a group knock animates the group-roster row and
  // a Direct knock animates the Direct contact row (not whichever
  // [data-user-id] match the global selector hits first). The flash color
  // is sourced from the recipient's dot via getKnockColor, mirroring how
  // the receiver-side pulses pick their color — Direct + group then look
  // identical without depending on each caller to forward statusColor.
  const li = findKnockTargetCard(recipientId, opts.contextGroupId || null);
  if (li) {
    li.style.setProperty('--knock-color', getKnockColor(li));
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
  pendingDirect = new Set();
  floatTimers.forEach(({ timerId }) => { if (timerId) clearTimeout(timerId); });
  floatTimers.clear();
  groupBadgeCounts.clear();
  directBadgeCount = 0;
  // Register the context-change listener once per page lifetime so we can
  // drain pending Direct knocks + clear the Direct badge the moment the
  // user enters Direct context. Group-side drain still happens inside
  // groupContext.enterGroupContext (after the roster is rendered).
  if (!contextSubInitialized) {
    contextSubInitialized = true;
    onContextChange((ctx) => {
      if (ctx.context === 'direct') {
        clearDirectBadge();
        drainPendingDirectKnocks();
      }
    });
  }

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
    // A tool drawer is open — defer like the backgrounded case: leave the knock
    // in the DB so the card-drawer-close replay (initKnocks) shows it.
    if (isCardDrawerOpen()) return;
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
      } else {
        // Direct-scope knock arrived while the user is in a group context.
        // Stash + badge on the Direct chip; drain on context entry.
        pendingDirect.add(senderId);
        bumpDirectBadge();
      }
      // Knock stays in DB on purpose — drainPendingKnocks /
      // drainPendingDirectKnocks clear it after replaying the animation.
      return;
    }
    applyLiveKnock(senderId, count, li);
    applyFloatToTop(li);
    // Bring the prepended li into view in group context — without this, a
    // user scrolled down in a long roster misses the float-to-top entirely.
    // Instant scroll with positional args (the {behavior:'smooth'} variant
    // was unreliable after a same-tick DOM mutation on some platforms).
    if (contextGroupId) {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
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
      // Move first, animate next frame — see drainPendingKnocks for the
      // rationale.
      applyFloatToTop(li);
      requestAnimationFrame(() => applyDeferredKnock(senderId, contextGroupId));
    } else if (contextGroupId) {
      if (!pendingByGroup.has(contextGroupId)) pendingByGroup.set(contextGroupId, new Set());
      pendingByGroup.get(contextGroupId).add(senderId);
      bumpGroupCardBadge(contextGroupId);
    } else {
      // Direct knock + user is currently in a group context. Stash so the
      // animation replays when they return to Direct; flag the chip too.
      pendingDirect.add(senderId);
      bumpDirectBadge();
    }
  });
}

/**
 * Replay queued Direct-scope knocks when the user enters Direct context.
 * Counterpart to drainPendingKnocks(groupId).
 */
export function drainPendingDirectKnocks() {
  if (pendingDirect.size === 0) return;
  const senderIds = Array.from(pendingDirect);
  pendingDirect.clear();
  if (!cachedUserId) return;
  senderIds.forEach((senderId) => {
    const li = document.querySelector(`#main-ui-direct [data-user-id="${senderId}"]`);
    if (!li) return;
    // Move first, animate next frame — see drainPendingKnocks for the
    // rationale (real browsers swallow the keyframe start when class is
    // added in the same sync batch as the DOM move).
    applyFloatToTop(li);
    requestAnimationFrame(() => applyDeferredKnock(senderId, null));
    clearKnock(cachedUserId, senderId).catch(() => {});
  });
  if (senderIds.length) {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }
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
    // Move first so the animation class lands on the li at its final
    // position. Defer the animation one frame via requestAnimationFrame —
    // without it, drainPendingKnocks fires inside the same sync batch as
    // renderRoster + paintRosterRow + applyFloatToTop, and real browsers
    // (Chromium/Safari) swallow the keyframe start on the freshly-mutated
    // li. JSDOM doesn't run animations so unit tests don't surface this.
    applyFloatToTop(li);
    requestAnimationFrame(() => applyDeferredKnock(senderId, groupId));
    clearKnock(cachedUserId, senderId).catch(() => {});
  });
  // Bring the prepended items into view. Belt + suspenders against scroll
  // containers that don't respond to window.scrollTo on every platform.
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
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

  // Use the same CSS-keyframe approach as .knock-deferred — the previous
  // imperative transition (set boxShadow → reflow → set new boxShadow with
  // transition) was unreliable when followed on the same tick by a
  // list.prepend and a scrollTo (the layout/paint sequence ate the initial
  // intensity frame, so users saw no pulse). A keyframe animation is
  // declarative: the browser commits both endpoints and animates regardless
  // of concurrent DOM mutations.
  li.style.setProperty('--knock-color', getKnockColor(li));
  li.classList.remove('knock-live');
  void li.offsetHeight; // restart the animation cleanly if a prior is still mid-flight
  li.classList.add('knock-live');
  const onEnd = () => { li.classList.remove('knock-live'); };
  li.addEventListener('animationend', onEnd, { once: true });

  // Intensity stacking from rapid repeat knocks is dropped — the keyframe
  // animation is one-shot; multiple knocks within the window re-trigger
  // the full animation rather than accumulating opacity. pulseMap kept
  // only to satisfy the legacy reset path in initKnocks.
  pulseMap.set(senderId, { intensity: 1, timerId: null });
}

function applyDeferredKnock(userId, contextGroupId) {
  // Route through findKnockTargetCard so a deferred knock that carries a
  // contextGroupId animates the right element (the group-roster li) instead
  // of the global-first match (which can land on a hidden Direct contact li
  // when the recipient is currently in group context).
  const li = findKnockTargetCard(userId, contextGroupId || null);
  if (!li) return; // not in DOM — skip silently

  li.style.setProperty('--knock-color', getKnockColor(li));
  // Same reflow trick as applyLiveKnock: without it, drainPendingKnocks
  // firing in the same sync batch as renderRoster (entering a group with a
  // queued deferred knock) leaves the browser with no committed "initial
  // state" before the class is added. The keyframe animation never starts
  // and the user sees the float-to-top but no pulse.
  li.classList.remove('knock-deferred');
  void li.offsetHeight;
  li.classList.add('knock-deferred');
  li.addEventListener('animationend', () => li.classList.remove('knock-deferred'), { once: true });
}

// ── Float-to-top ─────────────────────────────────────────────────────────────

const FLOAT_MS = 20000;
const floatTimers = new Map(); // userId → { timerId, originalParent, originalSibling, startedAt }

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
      startedAt: Date.now(),
    });
  }
  // Refresh startedAt on every prepend so a re-knock extends the float.
  floatTimers.get(userId).startedAt = Date.now();
  // Don't let the floated li land above pinned header rows — Direct's section
  // labels (e.g. "Mutuals") or the group roster's owner-only "Invite to group"
  // row. Insert right after the first pinned row if one exists; otherwise
  // prepend (non-owner group roster, no pins).
  const pin = list.querySelector('.list-section-label, #group-roster-invite-row');
  if (pin) {
    list.insertBefore(li, pin.nextSibling);
  } else {
    list.prepend(li);
  }
  const timerId = setTimeout(() => restoreFromFloat(userId), FLOAT_MS);
  floatTimers.get(userId).timerId = timerId;
}

function restoreFromFloat(userId) {
  const entry = floatTimers.get(userId);
  floatTimers.delete(userId);
  if (!entry || !entry.originalParent) return;
  // Scope the lookup to the list the row was floated in. A global
  // document.querySelector could match a same-userId row in the OTHER context
  // (a Direct follower who is also a group member) and, because #main-ui-direct
  // precedes #group-context-root in the DOM, reparent the Direct row into the
  // group roster — leaving a phantom row in the wrong context and a gap in the
  // right one. The list element itself survives renderList/renderRoster rebuilds
  // (they clear innerHTML, not the <ul>), so it stays a valid scope.
  const li = entry.originalParent.querySelector(`[data-user-id="${userId}"]`);
  if (!li) return;
  // Re-anchor to the saved sibling only if it still lives in this list (a
  // rebuild may have replaced it).
  const sibling = entry.originalSibling && entry.originalSibling.parentNode === entry.originalParent
    ? entry.originalSibling
    : null;
  entry.originalParent.insertBefore(li, sibling);
}

export function getFloatedUserIds() {
  return Array.from(floatTimers.keys());
}

// ── Group / Direct card badges ───────────────────────────────────────────────

const groupBadgeCounts = new Map();
let directBadgeCount = 0;

export function bumpGroupCardBadge(groupId) {
  const current = (groupBadgeCounts.get(groupId) || 0) + 1;
  groupBadgeCounts.set(groupId, current);
  renderGroupBadge(groupId, current);
}

export function clearGroupCardBadge(groupId) {
  groupBadgeCounts.delete(groupId);
  renderGroupBadge(groupId, 0);
}

// Exposed for renderNavRow's per-card paint — the halo class is derived from
// this count on every paint (set when non-zero, cleared at zero), so the badge
// survives context flips and clears on surviving cards alike.
export function getGroupBadgeCount(groupId) {
  return groupBadgeCounts.get(groupId) || 0;
}

function renderGroupBadge(groupId, count) {
  const card = document.querySelector(`.group-card[data-group-id="${groupId}"]`);
  if (!card) return;
  // Visual indicator is a pulsing halo (CSS .group-card.knock-pending::after)
  // rather than a numeric badge — count is kept in memory only so renders
  // after a context change can restore the class.
  card.classList.toggle('knock-pending', count > 0);
  // Remove any legacy numeric badge if a previous version of the renderer
  // left one in the DOM.
  const oldBadge = card.querySelector('.group-card-badge');
  if (oldBadge) oldBadge.remove();
}

export function bumpDirectBadge() {
  directBadgeCount += 1;
  renderDirectBadge(directBadgeCount);
}

export function clearDirectBadge() {
  directBadgeCount = 0;
  renderDirectBadge(0);
}

export function getDirectBadgeCount() {
  return directBadgeCount;
}

function renderDirectBadge(count) {
  const card = document.querySelector('.group-card[data-nav="direct"]');
  if (!card) return;
  // Pulsing halo (CSS) rather than numeric badge — see renderGroupBadge.
  card.classList.toggle('knock-pending', count > 0);
  const oldBadge = card.querySelector('.group-card-badge');
  if (oldBadge) oldBadge.remove();
}

// ── Context-aware knock target lookup ────────────────────────────────────────

function findKnockTargetCard(senderId, contextGroupId) {
  const cur = getCurrentContext();
  if (contextGroupId) {
    if (cur.context === 'group' && cur.groupId === contextGroupId) {
      return document.querySelector(`#group-roster [data-user-id="${senderId}"]`);
    }
    return null; // recipient is in a different context; caller bumps the badge
  }
  // Direct-scope knock — only animate when the user is actually viewing
  // Direct. Otherwise the live/deferred handler routes through the Direct-
  // badge + pendingDirect path instead. Scope the lookup to #main-ui-direct
  // so a group-roster row with the same userId doesn't accidentally match.
  if (cur.context !== 'direct') return null;
  return document.querySelector(`#main-ui-direct [data-user-id="${senderId}"]`);
}

// Re-run initKnocks when the app returns to the foreground or exits canvas,
// so that knocks received while backgrounded/on-canvas are shown as deferred.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // Drain any floats whose 20s deadline elapsed while the tab was hidden.
  // setTimeout is throttled (or frozen) in background tabs, so the natural
  // timer can fire much later than FLOAT_MS or not at all — without this,
  // the floated li stays stuck at the top of the list when the user returns.
  // Process in two passes (collect then mutate) to avoid mutating the Map
  // during iteration.
  const now = Date.now();
  const toRestore = [];
  floatTimers.forEach((entry, userId) => {
    if (now - (entry.startedAt || 0) >= FLOAT_MS) toRestore.push(userId);
  });
  toRestore.forEach((userId) => {
    const entry = floatTimers.get(userId);
    if (entry?.timerId) clearTimeout(entry.timerId);
    restoreFromFloat(userId);
  });
  if (cachedUserId) initKnocks(cachedUserId);
});
document.addEventListener('canvas-exited', () => {
  if (cachedUserId) initKnocks(cachedUserId);
});
document.addEventListener('card-drawer-close', () => {
  if (cachedUserId) initKnocks(cachedUserId);
});
