// js/knock.js
import { writeKnock, getKnocks, watchKnocksAdded, clearKnock } from './db.js';
import { getCurrentContext, onContextChange } from './groupNav.js';
import { isCardDrawerOpen } from './cardDrawer.js';
import { hexToRgb } from './utils.js';

// Boundary/state shapes.
interface PulseEntry { intensity: number; timerId: ReturnType<typeof setTimeout> | null; }
interface FloatEntry { timerId: ReturnType<typeof setTimeout> | null; startedAt: number; }
interface KnockPayload { count?: number; ts?: number; contextGroupId?: string | null; }

// Module-level state — reset by initKnocks on each call
let debounceMap = new Map<string, number>();   // recipientId → last knock timestamp
let deferredKeys = new Set<string>();  // senderIds from snapshot; blocks live listener until cleared
let snapshotPending = false;   // true while waiting for getKnocks to resolve
let unsubKnocks: (() => void) | null = null;
let cachedUserId: string | null = null;       // stored so the visibility handler can re-call initKnocks
let contextSubInitialized = false;

const INTENSITY_STEP = 0.4;
let pulseMap = new Map<string, PulseEntry>();      // senderId → { intensity: number, timerId: number | null }
let pendingByGroup = new Map<string, Set<string>>(); // groupId → Set<senderId>: knocks received while user
                                 // wasn't in the right group context; drained on enter.
let pendingDirect = new Set<string>();  // senderIds for Direct-scope knocks received while
                                 // user wasn't in Direct context; drained on entry.
// Knocks received while the tab is occluded (backgrounded / drawer open / on
// canvas). Buffered in memory instead of forcing a full initKnocks re-read on
// drawer-close / canvas-exit — the listener never died, so re-fetching is waste.
// The knock is LEFT in the DB at buffer time (see the live handler): the DB is
// the cold-start backstop for a tab closed while still hidden. Only presentation
// (drainHeldKnocks) clears it. Keyed by senderId; a repeat overwrites the payload.
const _heldWhileAway = new Map<string, KnockPayload>();

// Send a knock to recipientId. Guards: debounce (300ms). Flash fires only after debounce passes.
export function sendKnock(recipientId: string, senderId: string, statusColor?: string, opts: { contextGroupId?: string } = {}) {
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
export async function initKnocks(myUserId: string) {
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
    onContextChange((ctx: { context: string }) => {
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
  unsubKnocks = watchKnocksAdded(myUserId, (senderId, payloadRaw) => {
    // The onChildAdded key is always present in practice; the db signature widens
    // it to string|null defensively. payload is the child value (unknown at the
    // boundary) — read through a local KnockPayload shape.
    const sid = senderId as string;
    const payload = (payloadRaw || {}) as KnockPayload;
    const count = payload.count;
    const ts = payload.ts;
    const contextGroupId = payload.contextGroupId || null;
    // Skip senders from the initial snapshot (handled as deferred)
    if (snapshotPending || deferredKeys.has(sid)) return;
    // App is backgrounded — buffer in memory (drained on visibilitychange→visible)
    // AND leave the knock in the DB as the cold-start backstop for a tab closed
    // while still hidden. Do NOT clearKnock here — only presentation (drain) clears.
    if (document.visibilityState !== 'visible') { _heldWhileAway.set(sid, payload); return; }
    // A tool drawer is open — buffer + leave in DB; drained on card-drawer-close.
    if (isCardDrawerOpen()) { _heldWhileAway.set(sid, payload); return; }
    // On canvas — buffer + leave in DB; drained on canvas-exited.
    const canvasScreen = document.getElementById('canvas-screen');
    if (canvasScreen && canvasScreen.classList.contains('active')) { _heldWhileAway.set(sid, payload); return; }
    // Stale-knock check: only knocks that are clearly older than "this
    // session" should fall to the deferred path. Tolerate up to 60s of
    // clock skew between sender and recipient — without this, a fresh
    // cross-device knock can be misclassified as deferred when the
    // sender's clock runs a few seconds behind the recipient's.
    if ((ts as number) < appOpenTime - 60000) {
      applyDeferredKnock(sid, contextGroupId);
      clearKnock(myUserId, sid).catch(() => {});
      return;
    }
    const li = findKnockTargetCard(sid, contextGroupId);
    if (!li) {
      if (contextGroupId) {
        bumpGroupCardBadge(contextGroupId);
        // Stash so the animation replays when the user enters this group.
        if (!pendingByGroup.has(contextGroupId)) pendingByGroup.set(contextGroupId, new Set());
        pendingByGroup.get(contextGroupId)!.add(sid);
      } else {
        // Direct-scope knock arrived while the user is in a group context.
        // Stash + badge on the Direct chip; drain on context entry.
        pendingDirect.add(sid);
        bumpDirectBadge();
      }
      // Knock stays in DB on purpose — drainPendingKnocks /
      // drainPendingDirectKnocks clear it after replaying the animation.
      return;
    }
    applyLiveKnock(sid, count, li);
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
    clearKnock(myUserId, sid).catch(() => {});
  });

  // 2. Read deferred knocks (one-time get). A cold-start read can race the RTDB
  //    connection's auth handshake: the custom-token auth propagates to the
  //    socket slightly after signInWithCustomToken resolves, so a one-shot get()
  //    can transiently fail with permission_denied — unlike live listeners,
  //    which re-fire once authed. Retry briefly; on persistent failure, degrade
  //    to live-only. (If this read threw, snapshotPending would stay true and the
  //    live listener above would hold every knock for the whole session.)
  let snapshot: Awaited<ReturnType<typeof getKnocks>> | null = null;
  for (let attempt = 0; ; attempt += 1) {
    try { snapshot = await getKnocks(myUserId); break; }
    catch (err) {
      if (attempt >= 4) { console.warn('initKnocks: deferred-knock snapshot unavailable, continuing live-only', err); break; }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  // 3. Populate deferredKeys from snapshot, then clear the pending flag so
  //    live events for non-deferred senders are processed normally going forward.
  if (snapshot && snapshot.exists()) {
    Object.keys(snapshot.val()).forEach(senderId => deferredKeys.add(senderId));
  }
  snapshotPending = false;

  if (!snapshot || !snapshot.exists()) return;

  // 4. Categorize snapshot entries
  const toDelete: string[] = [];
  const toAnimate: { senderId: string; contextGroupId: string | null }[] = [];

  Object.entries(snapshot.val() as Record<string, KnockPayload>).forEach(([senderId, payload]) => {
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
      pendingByGroup.get(contextGroupId)!.add(senderId);
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
    const li = document.querySelector<HTMLElement>(`#main-ui-direct [data-user-id="${senderId}"]`);
    if (!li) return;
    // Move first, animate next frame — see drainPendingKnocks for the
    // rationale (real browsers swallow the keyframe start when class is
    // added in the same sync batch as the DOM move).
    applyFloatToTop(li);
    requestAnimationFrame(() => applyDeferredKnock(senderId, null));
    clearKnock(cachedUserId!, senderId).catch(() => {});
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
export function drainPendingKnocks(groupId: string) {
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
    clearKnock(cachedUserId!, senderId).catch(() => {});
  });
  // Bring the prepended items into view. Belt + suspenders against scroll
  // containers that don't respond to window.scrollTo on every platform.
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
}

/**
 * Present knocks buffered while the tab was occluded (backgrounded / drawer open
 * / on canvas). Called on card-drawer-close, canvas-exited, and — before the
 * initKnocks safety net — on visibilitychange→visible. Mirrors drainPendingKnocks
 * exactly: snapshot-then-clear the buffer up front (so a re-entrant call can't
 * double-animate), then per held sender apply float-to-top synchronously, run the
 * deferred pulse in the next rAF (keyframe/reflow rationale is documented at
 * drainPendingKnocks + applyDeferredKnock), and clear the knock from the DB.
 * A sender whose li is not in the current DOM context (cross-context knock —
 * e.g. Direct while in a group, or a different group) is stashed + badged via
 * the same pendingByGroup/pendingDirect fallback the live handler uses, and is
 * left in the DB so drainPendingKnocks/drainPendingDirectKnocks clears it on
 * navigation to that context.
 */
function drainHeldKnocks() {
  if (_heldWhileAway.size === 0) return;
  // Snapshot then clear so re-entry doesn't double-animate.
  const held = Array.from(_heldWhileAway.entries());
  _heldWhileAway.clear();
  if (!cachedUserId) return;
  held.forEach(([sid, payload]) => {
    const contextGroupId = payload.contextGroupId || null;
    const li = findKnockTargetCard(sid, contextGroupId);
    if (!li) {
      // Target card not in the current DOM context (e.g. a Direct-scope
      // knock buffered while the user is in a group, or a knock for a
      // different group). Fall back to the same stash+badge path the live
      // handler uses — badge immediately and replay on navigation, instead
      // of dropping the knock silently.
      if (contextGroupId) {
        bumpGroupCardBadge(contextGroupId);
        if (!pendingByGroup.has(contextGroupId)) pendingByGroup.set(contextGroupId, new Set());
        pendingByGroup.get(contextGroupId)!.add(sid);
      } else {
        pendingDirect.add(sid);
        bumpDirectBadge();
      }
      // Knock stays in DB on purpose — drainPendingKnocks /
      // drainPendingDirectKnocks clear it after replaying the animation.
      return;
    }
    applyFloatToTop(li);
    requestAnimationFrame(() => applyDeferredKnock(sid, contextGroupId));
    clearKnock(cachedUserId!, sid).catch(() => {});
  });
}

// Returns the color to use for knock animations on this card.
// Uses grey when the person is Unavailable so the pulse matches their dot state.
function getKnockColor(li: HTMLElement) {
  if (li.dataset.available !== 'true') {
    return getComputedStyle(document.documentElement).getPropertyValue('--dot-off').trim() || '#6b7280';
  }
  const dot = li.querySelector<HTMLElement>('.person-dot');
  return (dot && dot.style.background) || '#22c55e';
}

export function colorToRgba(color: string, alpha: number) {
  if (color.startsWith('#')) {
    // Reuse the shared hex parser (utils.hexToRgb) instead of re-slicing here.
    return `rgba(${hexToRgb(color)}, ${alpha})`;
  }
  // rgb(r, g, b) — browser-normalized form
  const m = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
  return `rgba(34, 197, 94, ${alpha})`; // fallback: green
}

function applyLiveKnock(senderId: string, count: number | undefined, li: HTMLElement | null) {
  if (!li) li = document.querySelector<HTMLElement>(`[data-user-id="${senderId}"]`);
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

function applyDeferredKnock(userId: string, contextGroupId: string | null) {
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
const floatTimers = new Map<string, FloatEntry>(); // userId → { timerId, startedAt }

export function applyFloatToTop(li: HTMLElement | null) {
  if (!li) return;
  const list = li.parentNode;
  if (!list) return;
  const userId = li.dataset.userId!;
  if (floatTimers.has(userId)) {
    clearTimeout(floatTimers.get(userId)!.timerId as ReturnType<typeof setTimeout>);
  } else {
    floatTimers.set(userId, { timerId: null, startedAt: Date.now() });
  }
  // Refresh startedAt on every prepend so a re-knock extends the float.
  floatTimers.get(userId)!.startedAt = Date.now();
  // Don't let the floated li land above pinned header rows — Direct's section
  // labels (e.g. "Mutuals") or the group roster's owner-only "Invite to group"
  // row. Insert right after the first pinned row if one exists; otherwise
  // prepend (non-owner group roster, no pins).
  const pin = list.querySelector('.list-section-label, #group-roster-invite-row');
  // Element siblings (not nextSibling) so whitespace text nodes between rows
  // don't throw off the call-card check.
  let ref = pin ? pin.nextElementSibling : list.firstElementChild; // insert before this
  // Keep floats below an active call card (.call-mode) at the top — a live or
  // ringing call is the stable top row, above floated knocks (call-above-knocks,
  // both directions). Mirrors the call-pin lift in following.js renderList.
  if (ref && ref !== li && ref.classList.contains('call-mode')) {
    ref = ref.nextElementSibling;
  }
  (list as Node).insertBefore(li, ref); // ref === null appends (matches the old no-pin tail)
  const timerId = setTimeout(() => restoreFromFloat(userId), FLOAT_MS);
  floatTimers.get(userId)!.timerId = timerId;
}

function restoreFromFloat(userId: string) {
  if (!floatTimers.has(userId)) return;
  floatTimers.delete(userId);
  // Don't restore to a captured position — by now the list may have re-sorted
  // (availability / call pins), making the old neighbor stale and landing the
  // card in the wrong slot (or appended to the bottom). The card is no longer in
  // getFloatedUserIds(), so just ask the active context to re-sort; it lands in
  // its correct CURRENT position. following.js → scheduleResort, groupContext →
  // syncRosterOrder. (This also makes restore honor status changes during the
  // float, and removes the cross-context manual-move/phantom-row risk entirely.)
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('knock-float-restored', { detail: { userId } }));
  }
}

export function getFloatedUserIds() {
  return Array.from(floatTimers.keys());
}

// ── Group / Direct card badges ───────────────────────────────────────────────

const groupBadgeCounts = new Map<string, number>();
let directBadgeCount = 0;

export function bumpGroupCardBadge(groupId: string) {
  const current = (groupBadgeCounts.get(groupId) || 0) + 1;
  groupBadgeCounts.set(groupId, current);
  renderGroupBadge(groupId, current);
}

export function clearGroupCardBadge(groupId: string) {
  groupBadgeCounts.delete(groupId);
  renderGroupBadge(groupId, 0);
}

// Exposed for renderNavRow's per-card paint — the halo class is derived from
// this count on every paint (set when non-zero, cleared at zero), so the badge
// survives context flips and clears on surviving cards alike.
export function getGroupBadgeCount(groupId: string) {
  return groupBadgeCounts.get(groupId) || 0;
}

function renderGroupBadge(groupId: string, count: number) {
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

// Pulse the Direct chip for Direct-scope activity (e.g. an incoming call) that
// lands while the user is NOT in Direct — mirrors how a Direct knock badges the
// chip. No-op in Direct, where the activity is already visible. Cleared on
// entering Direct (the onContextChange handler in initKnocks), like knock badges.
export function noteDirectActivity() {
  if (getCurrentContext().context === 'direct') return;
  bumpDirectBadge();
}

export function clearDirectBadge() {
  directBadgeCount = 0;
  renderDirectBadge(0);
}

export function getDirectBadgeCount() {
  return directBadgeCount;
}

function renderDirectBadge(count: number) {
  const card = document.querySelector('.group-card[data-nav="direct"]');
  if (!card) return;
  // Pulsing halo (CSS) rather than numeric badge — see renderGroupBadge.
  card.classList.toggle('knock-pending', count > 0);
  const oldBadge = card.querySelector('.group-card-badge');
  if (oldBadge) oldBadge.remove();
}

// ── Context-aware knock target lookup ────────────────────────────────────────

function findKnockTargetCard(senderId: string, contextGroupId: string | null) {
  const cur = getCurrentContext();
  if (contextGroupId) {
    if (cur.context === 'group' && cur.groupId === contextGroupId) {
      return document.querySelector<HTMLElement>(`#group-roster [data-user-id="${senderId}"]`);
    }
    return null; // recipient is in a different context; caller bumps the badge
  }
  // Direct-scope knock — only animate when the user is actually viewing
  // Direct. Otherwise the live/deferred handler routes through the Direct-
  // badge + pendingDirect path instead. Scope the lookup to #main-ui-direct
  // so a group-roster row with the same userId doesn't accidentally match.
  if (cur.context !== 'direct') return null;
  return document.querySelector<HTMLElement>(`#main-ui-direct [data-user-id="${senderId}"]`);
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
  const toRestore: string[] = [];
  floatTimers.forEach((entry, userId) => {
    if (now - (entry.startedAt || 0) >= FLOAT_MS) toRestore.push(userId);
  });
  toRestore.forEach((userId) => {
    const entry = floatTimers.get(userId);
    if (entry?.timerId) clearTimeout(entry.timerId);
    restoreFromFloat(userId);
  });
  // Drain the in-memory buffer FIRST so held knocks present immediately and their
  // clearKnock removes them from the DB before initKnocks' getKnocks read — this
  // prevents double-presentation. The full initKnocks stays as the safety net for
  // a genuinely backgrounded tab that missed throttled events the listener never
  // delivered (the server re-read catches those).
  drainHeldKnocks();
  if (cachedUserId) initKnocks(cachedUserId);
});
document.addEventListener('canvas-exited', () => {
  // Tab never left the foreground and the listener never died — just present the
  // buffered knocks; no full initKnocks re-read needed.
  drainHeldKnocks();
});
document.addEventListener('card-drawer-close', () => {
  // Same as canvas-exit: drain the in-memory buffer instead of re-initializing.
  drainHeldKnocks();
});
