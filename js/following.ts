// js/following.ts
import {
  lookupCode, watchFollowers, watchFollowerNames, registerAsFollower, unregisterAsFollower,
  removeFollower, isExpired, isAvailable,
  formatLastSeen, startCall, answerCall, endCall, watchOwnCall, setStatusColor,
  watchFollowing, setFollowingEntry, removeFollowingEntry, watchRevocations,
} from './db.js';
import { subscribePresence } from './presenceHub.js';
import { subscribeDistance } from './locationHub.js';
import { isContextPublished, isContextAvailable } from './locationShare.js';
import { formatDistancePrecise } from '../shared/geo.js';
import {
  getFollowing, addFollowing, removeFollowing, renameFollowing, updateFollowingCode,
  setFollowing, getFollowerName, setFollowerName,
  hasSeenServerFollowing, markServerFollowingSeen,
} from './store.js';
import {
  isHintSeen, markHintSeen,
  getMadeCallCount, incrementMadeCallCount, getAnsweredCallCount, incrementAnsweredCallCount,
  getPaletteState, setPaletteState,
  getFavorites, getLocationOptIn,
} from './prefs.js';
import { escapeHtml, hexToRgb, safeCssColor, resolveDisplayName, availableForText, distanceFragmentHtml } from './utils.js';
import { isLongpressHintEligible, isSwipeHintEligible } from './hints.js';
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED, KNOCK_ENABLED, CALL_ENABLED, NOTIFICATIONS_ENABLED } from './features.js';
import { createNotifyBell } from './notifyBell.js';
import { createCardDrawer, isCardDrawerOpen, closeCardDrawer } from './cardDrawer.js';
import { ensureNotificationsReady } from './notifyPrompt.js';
import { getGlowForColor, getPaletteByKey, enterPaletteMode, switchSet, PALETTE_SETS, paintStatusDot } from './palettes.js';
import { sendKnock, getFloatedUserIds, noteDirectActivity } from './knock.js';
import { saveCombo, buildAdoptedCombo } from './favorites.js';
import { reconcileChildren } from './reconcile.js';
import { refreshHints, clearActiveHint } from './hintRotation.js';
import { setListEmpty } from './firstRun.js';
import { extractInviteTokenFromText } from './inviteText.js';
import { attemptRedeemFromUrl, resolveInvitePreview } from './invites.js';
import { showGroupDisplayNamePrompt } from './groupDisplayNamePrompt.js';
import { beginGroupEntryTransition, endGroupEntryTransition } from './groupNav.js';

// Local contact shape (mirrors store.js's FollowingEntry) and the presence-node
// view this module reads/writes. UserData carries the runtime-present fields
// (statusColor/paletteKey/code/lastSeen) the minimal PresenceNode wire shape omits.
type FollowingEntry = { userId: string; code: string; label?: string };
type FollowerEntry = { userId: string; code: string };
type UserData = { status?: string | null; availableUntil?: number | null; statusColor?: string | null; paletteKey?: string | null; code?: string | null; lastSeen?: number | null };
type ConfirmAction = { type: 'unfollow' | 'removeFollower'; userId: string; myUserId: string };
type InvitePreview = { scope?: string; label?: string; groupName?: string };
type RedeemResult = { ok: boolean; reason?: string; groupId?: string | null; groupName?: string | null; cache?: unknown };
type InviteRedeemedCb = (result: RedeemResult) => void | Promise<void>;
export type InitListOptions = { onInviteRedeemed?: InviteRedeemedCb | null };

const unsubscribers = new Map<string, () => void>(); // userId → unsubscribe fn
const editingSet = new Set<string>();
const lastUserData = new Map<string, UserData>(); // userId → most recent userData from Firebase
const renderedFollowees = new Set<string>();

// Distance ticks land here; updateFolloweeRow reads it when painting. One
// subscription per rendered MUTUAL row, open exactly while our own Direct
// publishing pref is on (rules would deny the reads regardless — we just
// never attempt them). The invariant "_distanceUnsubs' keyset == currently
// rendered mutuals ∧ opt-in on" is maintained by reconcileDistanceSubs, which
// renderList calls on every pass — so it self-heals on any renderList trigger
// (opt-in flip, mutual-set change, initList, …), not just row create/teardown.
const _distances = new Map<string, number | null>();
const _distanceUnsubs = new Map<string, () => void>();
let onFolloweeReady: (() => void) | null = null;
let onFollowingListReady: ((count: number) => void) | null = null;
let _onInviteRedeemed: InviteRedeemedCb | null = null;

// Direct-list rows are keyed by data-user-id, but a group roster reuses the same
// attribute for the same uid. Scope every Direct-list row lookup to #people-list
// so a mutual who is also a group member never has their Direct row resolve to
// the group roster — which leaked their Direct status into the group card.
//
// uid -> row element, populated by the reconcile create/update hooks in
// renderList (this module's own #people-list nodes only, so it can never leak
// a group-roster node for the same uid). This is a pure optimization over the
// querySelector scan below — followeeRow always double-checks isConnected
// before trusting the cache, so a missed/late removal can only cost an extra
// scan, never hand back a wrong/detached row.
const _rowByUid = new Map<string, HTMLElement>();

function followeeRow(userId: string): HTMLElement | null {
  const cached = _rowByUid.get(userId);
  if (cached && cached.isConnected) return cached;
  return (document.querySelector(`#people-list [data-user-id="${userId}"]`) as HTMLElement | null);
}

let latestFollowersSnapshot: FollowerEntry[] = [];
let unsubFollowers: (() => void) | null = null;
let unsubFollowerNames: (() => void) | null = null;
let unsubFollowing: (() => void) | null = null;
let unsubRevocations: (() => void) | null = null;
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let _labelVisibilityHandler: (() => void) | null = null;
let pendingAction: ConfirmAction | null = null; // { type: 'unfollow'|'removeFollower', userId, myUserId }
// Session-singleton: null before init, set to myUserId at init, stable for the
// in-view lifetime — typed non-null so its reads don't each need a cast.
let myUserIdRef = null as unknown as string; // set at init time; used by renderList and confirm handlers
let callModeCalleeId: string | null = null;   // userId of callee while in call mode (null = not in call mode)
let _incomingCall: { from: string } | null = null; // { from } when someone is ringing me; null otherwise
export function getIncomingCallFrom() { return _incomingCall?.from ?? null; }
let unsubOwnCall: (() => void) | null = null;

// Tears down every per-followee watch (presence + distance) and cached state
// for a userId that's leaving the active set entirely (unfollowed, revoked,
// or dropped by a server sync). Centralized so the distance subscription
// stays paired with the presence one at every teardown site.
function teardownFolloweeWatches(userId: string) {
  const unsub = unsubscribers.get(userId);
  if (unsub) unsub();
  unsubscribers.delete(userId);
  lastUserData.delete(userId);
  _distanceUnsubs.get(userId)?.();
  _distanceUnsubs.delete(userId);
  _distances.delete(userId);
}

// Brings the open distance subscriptions back in line with "currently
// rendered mutual ∧ opted in to Direct location sharing". Called by renderList
// BEFORE reconcileChildren/DOM paint on every pass, so it covers all three
// ways eligibility can churn while a row stays mounted: opt-in flips on (open
// subs for already-rendered mutuals), opt-in flips off (close everything +
// drop the cache before the paint that follows can read it), and a row
// transitioning mutual → following-only (closes the sub the old key's
// onRemove never touched, before the new non-mutual row's first paint).
// `mutuals` must be the FollowingEntry list currently in the Mutuals section —
// callers pass an empty array when nothing should stay open.
function reconcileDistanceSubs(mutuals: FollowingEntry[], myUserId: string) {
  // Eligibility is "viewer shares in Direct" (last-known model): opt-in ∧
  // own node known to exist ∧ own availability. Without the published half,
  // attaching before locations/{me} exists gets rules-denied — the SDK
  // cancels the listener PERMANENTLY, and the "already open" guard below
  // would then block any resubscribe for the whole session. The availability
  // half is the display gate: an unavailable viewer is de facto not sharing
  // and must not see distances. Closing on unavailable is safe to reverse —
  // nodes persist, so the reopen attaches to live nodes with no cancel risk.
  const eligibleIds = (getLocationOptIn('direct') && isContextPublished('direct') && isContextAvailable('direct'))
    ? new Set(mutuals.map(e => e.userId)) : new Set<string>();

  _distanceUnsubs.forEach((unsub, userId) => {
    if (eligibleIds.has(userId)) return;
    unsub();
    _distanceUnsubs.delete(userId);
    _distances.delete(userId);
  });

  for (const entry of mutuals) {
    if (!eligibleIds.has(entry.userId)) continue;
    if (_distanceUnsubs.has(entry.userId)) continue; // already open — never overwrite without unsubbing first
    _distanceUnsubs.set(entry.userId, subscribeDistance(myUserId, entry.userId, (meters) => {
      _distances.set(entry.userId, meters);
      const data = lastUserData.get(entry.userId);
      if (data) updateFolloweeRow(entry, data, myUserId);
    }));
  }
}

function showConfirm(title: string, btnText: string, action: ConfirmAction) {
  pendingAction = action;
  (document.getElementById('unfollow-confirm-title') as HTMLElement).textContent = title;
  (document.getElementById('unfollow-do-btn') as HTMLElement).textContent = btnText;
  (document.getElementById('unfollow-confirm') as HTMLElement).classList.remove('hidden');
}

function dismissConfirm() {
  (document.getElementById('unfollow-confirm') as HTMLElement).classList.add('hidden');
  pendingAction = null;
}

async function doConfirm() {
  if (!pendingAction) return;
  const action = pendingAction;
  dismissConfirm();

  if (action.type === 'unfollow') {
    teardownFolloweeWatches(action.userId);
    await unregisterAsFollower(action.userId, action.myUserId);
    removeFollowing(action.userId);
    removeFollowingEntry(action.myUserId, action.userId).catch(() => {});
    renderList();
  } else if (action.type === 'removeFollower') {
    await removeFollower(action.myUserId, action.userId);
    // latestFollowersSnapshot will be updated by watchFollowers callback automatically
    // but we re-render immediately using the current snapshot minus the removed entry
    latestFollowersSnapshot = latestFollowersSnapshot.filter(f => f.userId !== action.userId);
    renderList();
  }
}

// The ONE composition of an available row's status text: fuzzy time plus the
// distance suffix for mutual rows with a known distance. updateFolloweeRow's
// full paint and _refreshTimeLabels' label-only path must both go through
// this — a refresh that recomposes only the time wipes the suffix until the
// next distance tick lands (device-visible: distance blinking out for ~10s
// every minute). The mutual gate reads li.dataset.mutual (not just the cache):
// a mutual→following-only transition can leave a stale _distances value
// around for one microtask before reconcileDistanceSubs (run at the end of
// the same renderList pass) deletes it — keying off the row means the
// non-mutual card can never render it, even transiently.
function availableStatusText(li: HTMLElement, userId: string, availableUntil: number | null): string {
  const meters = li.dataset.mutual === '1' ? _distances.get(userId) : undefined;
  const dist = typeof meters === 'number' ? distanceFragmentHtml(formatDistancePrecise(meters)) : '';
  return availableForText(availableUntil) + dist;
}

// 60s tick: advance "available for …" labels in place. A row whose
// availability actually FLIPPED (timer expired) gets the full repaint —
// label-only would leave a green row claiming availability. Rows in call mode
// have no .status-available span and also fall through to the full repaint.
export function _refreshTimeLabels(myUserId: string) {
  getFollowing().forEach((entry) => {
    const userData = lastUserData.get(entry.userId);
    if (!userData || userData.status !== 'available') return;
    if (editingSet.has(entry.userId)) return;
    if (!isAvailable(userData.status, userData.availableUntil)) {
      updateFolloweeRow(entry, userData, myUserId); // expired since last tick — full state flip
      return;
    }
    const li = followeeRow(entry.userId);
    const span = li?.querySelector('.status-available') as HTMLElement | null;
    if (li && span) {
      span.innerHTML = availableStatusText(li, entry.userId, userData.availableUntil ?? null);
    } else updateFolloweeRow(entry, userData, myUserId); // unexpected row shape — full paint
  });
}

export function initList(myUserId: string, myCode: string, { onInviteRedeemed = null }: InitListOptions = {}) {
  myUserIdRef = myUserId;
  _onInviteRedeemed = onInviteRedeemed;

  renderedFollowees.clear();

  // Reset stale subscription state from any prior init (also makes tests independent)
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers.clear();
  lastUserData.clear();
  _distanceUnsubs.forEach((unsub) => unsub());
  _distanceUnsubs.clear();
  _distances.clear();
  _rowByUid.clear();
  editingSet.clear();
  callModeCalleeId = null;
  _incomingCall = null;
  latestFollowersSnapshot = [];
  pendingAction = null;
  // Reset the add-form's invite/code mode tracking too: a fresh init means a
  // fresh DOM (add-invite-status etc. start blank), so any token remembered
  // from a prior session must not short-circuit updateAddFormMode's first call.
  _inviteModeToken = null;
  _previewSeq++;
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
  if (_labelVisibilityHandler) { document.removeEventListener('visibilitychange', _labelVisibilityHandler); _labelVisibilityHandler = null; }

  // Inject confirm sheet once
  if (!document.getElementById('unfollow-confirm')) {
    const confirmEl = document.createElement('div');
    confirmEl.id = 'unfollow-confirm';
    confirmEl.className = 'confirm-overlay hidden';
    confirmEl.innerHTML = `
    <div class="confirm-sheet">
      <h4 id="unfollow-confirm-title">Unfollow?</h4>
      <p>They won't be notified. You can re-add them later using their code.</p>
      <div class="confirm-btns">
        <button class="confirm-btn-cancel" id="unfollow-cancel-btn">Cancel</button>
        <button class="confirm-btn-remove" id="unfollow-do-btn">Unfollow</button>
      </div>
    </div>`;
    document.body.appendChild(confirmEl);
    confirmEl.addEventListener('click', (e) => { if (e.target === confirmEl) dismissConfirm(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' &&
          !((document.getElementById('unfollow-confirm') as HTMLElement).classList.contains('hidden'))) {
        dismissConfirm();
      }
    });
    (document.getElementById('unfollow-cancel-btn') as HTMLElement).addEventListener('click', dismissConfirm);
    (document.getElementById('unfollow-do-btn') as HTMLElement).addEventListener('click', doConfirm);
  }

  // Subscribe to followers list
  if (unsubFollowers) unsubFollowers();
  unsubFollowers = watchFollowers(myUserId, (followers) => {
    latestFollowersSnapshot = (followers as FollowerEntry[]);
    renderList();
  });

  // Fold self-published follower names (invite redemptions — see
  // registerAsFollower) into the device-local roster so the followers list can
  // show "CODE (Name)". Fill-if-empty: a name learned from a follow-request
  // approval (or user edit) stays authoritative and is never clobbered by the
  // published value. Re-render only when something new landed.
  if (unsubFollowerNames) unsubFollowerNames();
  unsubFollowerNames = watchFollowerNames(myUserId, (names) => {
    let changed = false;
    for (const [uid, name] of Object.entries(names || {})) {
      if (name && !getFollowerName(uid)) { setFollowerName(uid, (name as string)); changed = true; }
    }
    if (changed) renderList();
  });

  // Subscribe to own following list (cross-device sync of contacts)
  if (unsubFollowing) unsubFollowing();
  unsubFollowing = watchFollowing(myUserId, (serverFollowing) => {
    // One-shot list-ready signal for the post-restore splash gating: it needs
    // the SERVER list size (the local cache is empty on a fresh device), and it
    // must fire even when syncFollowingFromServer's change-detection stays
    // silent (server list identical to local — e.g. both empty). Fired BEFORE
    // the sync below: its renderList can deliver per-followee presence
    // synchronously (presenceHub replay for uids another surface already
    // watches), and those ready signals must not drain a splash counter that
    // hasn't been credited with the followee units yet.
    if (onFollowingListReady) {
      const cb = onFollowingListReady;
      onFollowingListReady = null;
      cb(serverFollowing.length);
    }
    syncFollowingFromServer(myUserId, serverFollowing);
  });

  // Subscribe to revocation mailbox: fires when a followee removes us as a follower
  if (unsubRevocations) unsubRevocations();
  unsubRevocations = watchRevocations(myUserId, (revokers) => {
    // A revoker key means that user removed me as a follower: drop them from my
    // following + tear down their presence watch (replaces the old per-followee
    // revokedFollowers check, now once instead of N times).
    for (const revokerId of Object.keys(revokers || {})) {
      if (!getFollowing().some((f) => f.userId === revokerId)) continue;
      removeFollowing(revokerId);
      removeFollowingEntry(myUserId, revokerId).catch(() => {});
      teardownFolloweeWatches(revokerId);
    }
    renderList();
  });

  // App-lifetime own-call watcher: detects rings + answers off the calls/{me}
  // mailbox (call detection no longer rides the followee presence watch).
  if (unsubOwnCall) unsubOwnCall();
  unsubOwnCall = watchOwnCall(myUserId, (call) => {
    if (!CALL_ENABLED) return;
    // An answered call (either role) → ensure we're on the canvas. Covers the
    // caller learning the callee picked up, AND boot-into-an-answered-call for
    // either side (the watcher fires on attach with the persisted record). Not
    // gated on callModeCalleeId, so it can't race app.js's boot recovery.
    if (call && call.answered) {
      const canvasScreen = document.getElementById('canvas-screen');
      if (canvasScreen && canvasScreen.classList.contains('active')) return; // already there — idempotent
      const peerId = ((call.to || call.from) as string);
      const entry = getFollowing().find((f) => f.userId === peerId);
      if (entry) {
        callModeCalleeId = peerId;
        _incomingCall = null;
        const peerData = lastUserData.get(peerId);
        const peerSurface = peerData?.paletteKey
          ? (getPaletteByKey(peerData.paletteKey)?.theme?.surface || '#1e293b') : '#1e293b';
        const myColor = getComputedStyle(document.documentElement).getPropertyValue('--my-status').trim() || '#22c55e';
        const peerColor = peerData?.statusColor || '#22c55e';
        // Lazy chunk: the canvas engine loads on first call entry, not at boot
        // (audit-2 N1 — a stray static import defeated the split).
        import('./canvas.js')
          .then(({ enterCanvas }) => enterCanvas(peerId, resolveDisplayName(entry), myUserId, myColor, peerColor, peerSurface, () => exitCallMode(myUserId)))
          .catch((err) => console.error('enterCanvas (answered) failed:', err));
      }
      return;
    }
    // Callee side: someone is ringing me (not yet in a call).
    const prevFrom = _incomingCall?.from ?? null;
    const nextFrom = (((call && call.from && !call.answered && callModeCalleeId === null) ? call.from : null) as string | null);
    if (prevFrom === nextFrom) {
      if (!call && callModeCalleeId !== null) handlePeerEnded(myUserId);
      return;
    }
    _incomingCall = nextFrom ? { from: nextFrom } : null;
    // A fresh incoming ring pulses the Direct chip when the user is off in a
    // group, mirroring how a Direct knock badges it (#144). No-op in Direct,
    // where the ringing row is already visible; cleared on entering Direct.
    if (nextFrom) noteDirectActivity();
    for (const uid of [prevFrom, nextFrom]) {
      if (!uid) continue;
      const entry = getFollowing().find((f) => f.userId === uid);
      const data = lastUserData.get(uid);
      if (entry && data) updateFolloweeRow(entry, data, myUserId);
    }
    // The ringing caller pins to the top; it drops back when the ring ends.
    // Re-sort via the coalesced/edit-safe scheduler (deferred — the watcher is
    // top-level, but this keeps it consistent with the availability path).
    scheduleResort();
    if (!call && callModeCalleeId !== null) handlePeerEnded(myUserId);
  });

  // Refresh time labels every 60s (label-only; see _refreshTimeLabels). Guarded
  // so a hidden tab does no DOM work between ticks; the visibilitychange
  // listener below catches the labels up the moment the tab becomes visible
  // again (otherwise they'd sit stale until the next 60s tick landed).
  refreshInterval = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    _refreshTimeLabels(myUserId);
  }, 60000);
  _labelVisibilityHandler = () => { if (document.visibilityState === 'visible') _refreshTimeLabels(myUserId); };
  document.addEventListener('visibilitychange', _labelVisibilityHandler);

  (document.getElementById('add-person-btn') as HTMLElement).addEventListener('click', () => {
    const form = (document.getElementById('add-person-form') as HTMLElement);
    const input = (document.getElementById('add-code-input') as HTMLInputElement);
    openAddForm();
    // iOS Safari/Chrome only honor a programmatic focus() on a laid-out (non-
    // clipped) element within the tap gesture. The form reveals via a
    // max-height:0 slide, so the input is still clipped to 0 height this tick and
    // the focus is silently dropped — Telegram's embedded webview is lenient,
    // which is why it worked there. Un-clip the form synchronously (instant open)
    // so the input has layout before we focus, then hand max-height back to the
    // CSS class (which still animates the close).
    form.style.maxHeight = 'none';
    void form.offsetHeight; // force layout so the input is measurable/focusable now
    input.focus();
    form.style.maxHeight = '';
    setTimeout(() => {
      input?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 50);
  });

  (document.getElementById('add-cancel-btn') as HTMLElement).addEventListener('click', closeAddForm);

  (document.getElementById('add-code-input') as HTMLElement).addEventListener('input', (e) => {
    // Invite links/tokens are case-sensitive — only code mode uppercases.
    if (updateAddFormMode((e.target as HTMLInputElement).value) === 'code') (e.target as HTMLInputElement).value = (e.target as HTMLInputElement).value.toUpperCase();
  });

  (document.getElementById('add-code-input') as HTMLElement).addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const codeInput = (document.getElementById('add-code-input') as HTMLInputElement);
    const errorEl = (document.getElementById('add-error') as HTMLElement);
    const code = codeInput.value.trim().toUpperCase();
    errorEl.classList.add('hidden');
    if (!code) { showError(errorEl, 'Please enter a code.'); return; }
    if (code.length !== 6 || !/^[A-Z0-9]{6}$/.test(code)) { showError(errorEl, "That doesn't look like a code or an invite link."); return; }
    if (code === myCode.toUpperCase()) { showError(errorEl, "That's your own code."); return; }
    const existing = getFollowing().find((f) => f.code.toUpperCase() === code);
    if (existing) { showError(errorEl, `You're already following ${resolveDisplayName(existing)}.`); return; }
    codeInput.disabled = true;
    const targetUserId = await lookupCode(code);
    codeInput.disabled = false;
    if (!targetUserId) { showError(errorEl, 'Code not found. Check the code and try again.'); return; }
    (document.getElementById('add-label-input') as HTMLElement).focus();
  });

  (document.getElementById('add-label-input') as HTMLElement).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddPerson(myUserId, myCode);
  });

  (document.getElementById('add-submit-btn') as HTMLElement).addEventListener('click', () => {
    handleAddPerson(myUserId, myCode);
  });

  window.addEventListener('online', () => (document.getElementById('offline-banner') as HTMLElement).classList.add('hidden'));
  window.addEventListener('offline', () => (document.getElementById('offline-banner') as HTMLElement).classList.remove('hidden'));
  if (!navigator.onLine) (document.getElementById('offline-banner') as HTMLElement).classList.remove('hidden');

  // Optimistic first render from cached following (the watchers above render
  // asynchronously). Without this, the empty/non-empty verdict — and so the
  // guided empty state (setListEmpty) — is established only when the first
  // Firebase callback lands, a task AFTER the browser has painted the bare empty
  // list ("Add a person", no guidance). Rendering synchronously here mounts the
  // guided empty state before first paint (iOS FTU / Mini-App flash finding);
  // the watcher callbacks then refine it. Idempotent — reconcileChildren diffs
  // and setListEmpty no-ops on an unchanged verdict.
  renderList();
}

export function setFolloweeReadyCallback(fn: () => void) {
  onFolloweeReady = fn;
}

// One-shot: fires on the first watchFollowing server tick with the entry
// count, then clears itself. See the initList call site.
export function setFollowingListReadyCallback(fn: (count: number) => void) {
  onFollowingListReady = fn;
}

export function resetRenderedFollowees() {
  renderedFollowees.clear();
}

export function getCallModeCalleeId() { return callModeCalleeId; }

// Snapshot accessor for callers that need the current followers + mutuals
// without setting up their own subscription. Currently used by the Phase 3
// invite picker.
export function getCurrentFollowersMap() {
  if (!latestFollowersSnapshot) return {};
  // Snapshot is an array of { userId, code }; convert to a map.
  const out: Record<string, string> = {};
  for (const f of latestFollowersSnapshot) out[f.userId] = f.code;
  return out;
}

export function getCurrentMutuals() {
  const followers = getCurrentFollowersMap();
  return getFollowing()
    .filter((f) => followers[f.userId])
    .map((f) => ({ userId: f.userId, label: f.label, code: f.code }));
}

function handlePeerEnded(myUserId: string) {
  const canvasScreen = document.getElementById('canvas-screen');
  if (canvasScreen && canvasScreen.classList.contains('active')) {
    import('./canvas.js').then(({ showPeerLeftDialog, exitCanvas }) => {
      showPeerLeftDialog(canvasScreen, 'Your partner', () => { exitCanvas(); exitCallMode(myUserId, { peerEnded: true }); });
    });
  } else {
    exitCallMode(myUserId, { peerEnded: true });
  }
}

export function enterCallMode(calleeEntry: FollowingEntry, myUserId: string) {
  incrementMadeCallCount();
  const ringer = _incomingCall?.from || null; // a caller I was about to be answered by, if any
  callModeCalleeId = calleeEntry.userId;
  _incomingCall = null;

  const calleeData = lastUserData.get(calleeEntry.userId);
  const callColor = calleeData?.statusColor || '#22c55e';

  // Apply glow to callee's card (clear any in-progress knock animation first)
  const liPre = followeeRow(calleeEntry.userId);
  if (liPre) {
    liPre.style.boxShadow = '';
    liPre.style.transition = '';
    liPre.style.setProperty('--call-color-rgb', hexToRgb(callColor));
    liPre.classList.add('call-mode');
  }

  renderList();

  // One atomic write: start the outgoing call AND drop any prior ringer's
  // mailbox. Doing it in one update means calls/{me} never goes null, so our
  // own-call watcher doesn't misread it as a peer-ended hangup.
  startCall(myUserId, calleeEntry.userId, ringer || undefined).catch(() => {});
}

export function reEnterCallMode(calleeEntry: FollowingEntry, calleeData: UserData, myUserId: string) {
  callModeCalleeId = calleeEntry.userId;
  // No Firebase write — state already persisted
  const callColor = calleeData?.statusColor || '#22c55e';
  const li = followeeRow(calleeEntry.userId);
  if (li) {
    li.style.boxShadow = '';
    li.style.transition = '';
    li.style.setProperty('--call-color-rgb', hexToRgb(callColor));
    li.classList.add('call-mode');
  }
  renderList();
}

export function exitCallMode(myUserId: string, { peerEnded = false }: { peerEnded?: boolean } = {}) {
  const prevCalleeId = callModeCalleeId;
  callModeCalleeId = null;
  if (prevCalleeId) {
    // Only the side that INITIATES the hangup writes the Firebase teardown.
    // When the PEER ended the call, we got here because our own mailbox already
    // went null — the peer's endCall cleared BOTH mailboxes. Re-issuing ours
    // would try to clear calls/{peer}, which by then is empty and not ours, so
    // the rules deny the whole multi-location update ("update at / permission_
    // denied" on the caller's console after a decline). Skip it.
    if (!peerEnded) endCall(myUserId, prevCalleeId).catch(() => {});
    const li = followeeRow(prevCalleeId);
    if (li) { li.classList.remove('call-mode'); li.style.removeProperty('--call-color-rgb'); }
  }
  renderList();
}

function renderList() {
  const myUserId = myUserIdRef;
  const following = getFollowing();
  const followerIds = new Set(latestFollowersSnapshot.map(f => f.userId));

  const mutuals = following.filter(f => followerIds.has(f.userId));
  const followingOnly = following.filter(f => !followerIds.has(f.userId));
  const followerOnly = latestFollowersSnapshot.filter(
    f => !following.find(g => g.userId === f.userId)
  );

  // Unsubscribe only entries no longer in the active (mutual/following) set.
  // Preserving existing subscriptions prevents a visible flash to "Unavailable"
  // on every followers-list change, and keeps lastUserData accurate for sorting.
  const activeUserIds = new Set([...mutuals, ...followingOnly].map(e => e.userId));
  unsubscribers.forEach((_unsub, userId) => {
    if (!activeUserIds.has(userId)) teardownFolloweeWatches(userId);
  });

  // Runs BEFORE reconcileChildren below: the update()/create() callbacks (and
  // the post-reconcile cache-repaint loop) read _distances synchronously while
  // painting, so eligibility must already be settled by the time they run —
  // otherwise a row losing its subscription this pass (opt-in off, or mutual →
  // following-only) would still paint the stale value it's about to lose.
  // subscribeDistance itself doesn't need the DOM node to exist yet (its first
  // tick lands async), so opening subs here for freshly-mutual rows is safe too.
  reconcileDistanceSubs(mutuals, myUserId);

  const list = (document.getElementById('people-list') as HTMLElement);

  const isEmpty = mutuals.length === 0 && followingOnly.length === 0 && followerOnly.length === 0;
  (document.getElementById('add-person-area') as HTMLElement).classList.toggle('has-list', !isEmpty);
  if (isEmpty) {
    reconcileChildren(list, [], {
      create: () => null, // unreachable with empty keys
      update: () => {},
      onRemove: (node) => {
        if (isCardDrawerOpen() && node.querySelector('.card-drawer')) closeCardDrawer();
        const uid = node.dataset.userId;
        if (uid && _rowByUid.get(uid) === node) _rowByUid.delete(uid);
      },
    });
    list.style.display = 'none';
    setListEmpty(true);
    return;
  }

  list.style.display = '';
  setListEmpty(false);

  // Sort uses lastUserData which still has status for entries with active subscriptions.
  // New entries (not yet subscribed) will sort as unavailable until Firebase delivers status.
  // The active call card pins to the top of its section: the person I'm calling
  // (callModeCalleeId) or the person ringing me (_incomingCall). These are
  // mutually exclusive — a ring is only registered when not already in a call.
  const pinnedCallUid = callModeCalleeId ?? (_incomingCall?.from ?? null);
  function sortFollowees(entries: FollowingEntry[]) {
    return [...entries].sort((a, b) => {
      if (pinnedCallUid) {
        if (a.userId === pinnedCallUid) return -1;
        if (b.userId === pinnedCallUid) return 1;
      }
      const aData = lastUserData.get(a.userId);
      const bData = lastUserData.get(b.userId);
      const aAvail = isAvailable(aData?.status, aData?.availableUntil);
      const bAvail = isAvailable(bData?.status, bData?.availableUntil);
      if (aAvail !== bAvail) return bAvail ? 1 : -1;
      const aName = resolveDisplayName(a);
      const bName = resolveDisplayName(b);
      return aName.localeCompare(bName);
    });
  }

  function sortFollowerOnly(entries: FollowerEntry[]) {
    return [...entries].sort((a, b) => a.code.localeCompare(b.code));
  }

  const entryByKey = new Map();
  const keys: string[] = [];
  function pushSection(labelKey: string, entries: (FollowingEntry | FollowerEntry)[], type: string) {
    if (entries.length === 0) return;
    keys.push(labelKey);
    for (const e of entries) {
      const k = `${type}:${e.userId}`;
      keys.push(k);
      entryByKey.set(k, e);
    }
  }
  pushSection('label:Mutuals', sortFollowees(mutuals), 'mutual');
  pushSection('label:Following', sortFollowees(followingOnly), 'following');
  pushSection('label:Followers', sortFollowerOnly(followerOnly), 'follower');

  // Floated rows stay pinned right after the first section label (same
  // contract applyFloatToTop honors), folded into the key order instead of
  // the old post-render re-prepend.
  const floated = getFloatedUserIds();
  if (floated.length && keys.length) {
    const firstLabelIdx = keys.findIndex((k) => k.startsWith('label:'));
    const anchor = firstLabelIdx >= 0 ? firstLabelIdx + 1 : 0;
    for (const uid of floated) {
      const idx = keys.findIndex((k) => !k.startsWith('label:') && k.endsWith(`:${uid}`));
      if (idx < 0 || idx === anchor) continue;
      const [k] = keys.splice(idx, 1);
      keys.splice(anchor, 0, k);
    }
  }

  // Call-above-knocks: a floated knock may now sit above the call-pinned card.
  // Lift the active call card (callee I'm calling, or caller ringing me) back to
  // the very top of its section so the live call stays the top row. Calls are
  // mutual-only, so the card lives in the first section.
  if (pinnedCallUid && keys.length) {
    const firstLabelIdx = keys.findIndex((k) => k.startsWith('label:'));
    const anchor = firstLabelIdx >= 0 ? firstLabelIdx + 1 : 0;
    const idx = keys.findIndex((k) => !k.startsWith('label:') && k.endsWith(`:${pinnedCallUid}`));
    if (idx > anchor) {
      const [k] = keys.splice(idx, 1);
      keys.splice(anchor, 0, k);
    }
  }

  // Track newly-created followee keys so we can repopulate from cache
  // after reconcile (update() runs before insertBefore on fresh nodes, so
  // updateFolloweeRow's document.querySelector lookup would return null).
  const freshFolloweeKeys: string[] = [];

  reconcileChildren(list, keys, {
    create: (key) => {
      if (key.startsWith('label:')) {
        const labelLi = document.createElement('li');
        labelLi.className = 'list-section-label';
        labelLi.textContent = key.slice('label:'.length);
        return labelLi;
      }
      const entry = entryByKey.get(key);
      if (key.startsWith('follower:')) return createFollowerOnlyRow(entry, myUserId);
      freshFolloweeKeys.push(key);
      return createFolloweeRow(entry, myUserId, key.startsWith('mutual:'));
    },
    update: (node, key) => {
      if (key.startsWith('label:')) return;
      // create() always stamps data-user-id before returning the node, and
      // reconcile runs update() immediately after create() (before insertion)
      // — so the attribute is already set here even for a brand-new row.
      // Refreshed on every pass (not just create) so the map self-heals if a
      // row's identity ever changes underneath the same key.
      const uid = node.dataset.userId;
      if (uid) _rowByUid.set(uid, node);
      const entry = entryByKey.get(key);
      if (key.startsWith('follower:')) {
        // Refresh the CODE (Name) label — the name can be learned post-create.
        const rosterName = getFollowerName(entry.userId);
        const label = node.querySelector('.person-label');
        if (label) {
          label.textContent = rosterName ? `${entry.code} (${rosterName})` : entry.code;
        }
        return;
      }
      // Followee rows: subscribe once; surviving rows repaint from the status
      // cache so they don't flash "Unavailable" until the next tick.
      // Fresh rows are handled post-reconcile (after insertBefore) below.
      if (!unsubscribers.has(entry.userId)) {
        subscribeToFollowee(entry, myUserId);
      } else if (!editingSet.has(entry.userId) && !freshFolloweeKeys.includes(key)) {
        const cached = lastUserData.get(entry.userId);
        if (cached) updateFolloweeRow(entry, cached, myUserId);
      }
    },
    // NB: closeCardDrawer dispatches 'card-drawer-close' SYNCHRONOUSLY while
    // this reconcile is in flight — listeners on that event must stay
    // paint-only (no renderList/reconcile call, which would throw the
    // re-entrancy guard mid-removal).
    onRemove: (node) => {
      if (isCardDrawerOpen() && node.querySelector('.card-drawer')) closeCardDrawer();
      // Identity-guarded: only delete if this removed node is still the one
      // the map has on file for its uid. Protects against a create-before-
      // remove ordering for the same uid within a pass (mirrors the roster's
      // eligibility-bit key flip) from wiping out a fresher entry.
      const uid = node.dataset.userId;
      if (uid && _rowByUid.get(uid) === node) _rowByUid.delete(uid);
    },
  });

  // Post-reconcile: repopulate fresh followee rows from cache. These nodes are
  // now in the DOM (insertBefore completed), so document.querySelector finds them.
  for (const key of freshFolloweeKeys) {
    const entry = entryByKey.get(key);
    if (!unsubscribers.has(entry.userId)) continue; // newly subscribed; will get data from Firebase
    if (editingSet.has(entry.userId)) continue;
    const cached = lastUserData.get(entry.userId);
    if (cached) updateFolloweeRow(entry, cached, myUserId);
  }
}

function applyAdoption(entry: FollowingEntry, myUserId: string) {
  const targetData = lastUserData.get(entry.userId);

  // Set CSS vars first so renderStrip reads the correct color when palette-state-changed fires
  if (targetData?.statusColor) {
    document.documentElement.style.setProperty('--my-status', targetData.statusColor);
    document.documentElement.style.setProperty('--my-glow', getGlowForColor(targetData.statusColor));
  }

  let statusWrittenToFirebase = false;

  if (targetData?.paletteKey) {
    // Palette mode: switch to the set containing this palette, then enter palette mode
    const setNum = PALETTE_SETS[2].some(p => p.key === targetData.paletteKey) ? 2 : 1;
    const setKey = String(setNum);
    const state = getPaletteState();
    state.activeSet = setNum;
    state.sets[setKey].selectedKey = targetData.paletteKey;
    if (targetData.statusColor) state.sets[setKey].selectedColor = targetData.statusColor;
    setPaletteState(state);
    enterPaletteMode(targetData.paletteKey, myUserId);
  } else if (targetData?.statusColor) {
    // Base mode: find the palette whose key color matches statusColor (if any)
    let matchedSet = null, matchedKey = null;
    for (const [sn, palettes] of Object.entries(PALETTE_SETS)) {
      const found = palettes.find(p => p.color === targetData.statusColor);
      if (found) { matchedSet = Number(sn); matchedKey = found.key; break; }
    }
    if (matchedSet !== null) {
      const state = getPaletteState();
      state.activeSet = matchedSet;
      state.sets[String(matchedSet)].selectedKey = matchedKey;
      state.sets[String(matchedSet)].selectedColor = targetData.statusColor;
      state.sets[String(matchedSet)].activePaletteKey = null;
      setPaletteState(state);
      switchSet(matchedSet, myUserId); // handles setStatusColor + renderSwatchRow + dispatch
      statusWrittenToFirebase = true;
    }
  }

  if (targetData?.statusColor && !statusWrittenToFirebase) {
    setStatusColor(myUserId, targetData.statusColor).catch(() => {});
  }

  const li = followeeRow(entry.userId);
  if (li) li.classList.add('adopted-from');
}

function triggerAdoption(entry: FollowingEntry, myUserId: string) {
  // Clear long-press hint on first adoption
  if (!isHintSeen('longpress')) {
    markHintSeen('longpress');
    clearActiveHint();
  }
  // Build the adopted combo from the source's broadcast state and push to
  // favorites BEFORE applying the adoption (the apply mutates picker state).
  const targetData = lastUserData.get(entry.userId);
  const adoptedCombo = buildAdoptedCombo(
    (targetData?.statusColor as string),
    targetData?.paletteKey ?? null,
  );
  saveCombo(adoptedCombo);
  applyAdoption(entry, myUserId);
}

function createFolloweeRow(entry: FollowingEntry, myUserId: string, isMutual = false) {
  const li = document.createElement('li');
  li.dataset.userId = entry.userId;
  if (isMutual) li.dataset.mutual = '1';

  const nameHtml = (entry.label)
    ? `<div class="person-label">${escapeHtml(entry.label)}</div>`
    : `<div class="person-label">${escapeHtml(entry.code)}</div>`;

  li.innerHTML = `
    <div class="person-dot"></div>
    <div class="person-info">
      ${nameHtml}
      <div class="person-status">Unavailable</div>
    </div>`;

  const displayName = resolveDisplayName(entry);
  const unfollowBtn = document.createElement('button');
  unfollowBtn.className = 'unfollow-btn';
  unfollowBtn.title = 'Unfollow';
  unfollowBtn.textContent = '×';
  unfollowBtn.addEventListener('click', (e) => {
    // Stop the tap bubbling to the li-level knock handler in both the inline
    // (flag-off) and in-slice paths.
    e.stopPropagation();
    showConfirm(`Unfollow ${displayName}?`, 'Unfollow', {
      type: 'unfollow',
      userId: entry.userId,
      myUserId,
    });
  });

  (li.querySelector('.person-label') as HTMLElement).addEventListener('click', () => {
    activateRename(entry, (li.querySelector('.person-label') as HTMLElement));
  });

  if (KNOCK_ENABLED && isMutual) {
    const labelEl = (li.querySelector('.person-label') as HTMLElement);
    li.addEventListener('click', (e) => {
      if (isCardDrawerOpen()) return;
      if (labelEl.contains((e.target as Node))) return;
      const statusColor = lastUserData.get(entry.userId)?.statusColor;
      sendKnock(entry.userId, myUserId, (statusColor as string | undefined));
    });
  }

  if (CALL_ENABLED && isMutual) {
    let swipeStartX = 0, swipeStartY = 0, swipeCardWidth = 0, swipeActive = false;

    li.addEventListener('pointerdown', (e) => {
      if (isCardDrawerOpen()) return;
      if ((e.target as Element).closest('.unfollow-btn, .person-label')) return;
      swipeStartX = e.clientX;
      swipeStartY = e.clientY;
      swipeCardWidth = li.getBoundingClientRect().width;
      swipeActive = true;
      try { li.setPointerCapture(e.pointerId); } catch (_) {}
    });

    li.addEventListener('pointermove', (e) => {
      if (!swipeActive) return;
      const dx = e.clientX - swipeStartX;
      const dy = e.clientY - swipeStartY;
      // Ignore predominantly vertical movements (scroll)
      if (Math.abs(dx) / (Math.abs(dy) + 0.001) < 1.5) return;
      const threshold = swipeCardWidth * 0.4;
      if (dx > threshold) {
        swipeActive = false;
        // Clear swipe hint on first right-swipe
        if (!isHintSeen('swipe')) {
          markHintSeen('swipe');
          clearActiveHint();
        }
        if (li.classList.contains('call-mode') && callModeCalleeId !== entry.userId) {
          // Card is glowing and we're NOT the caller — we're the receiver answering
          incrementAnsweredCallCount();
          const peerData = lastUserData.get(entry.userId);
          const peerSurface = peerData?.paletteKey
            ? (getPaletteByKey(peerData.paletteKey)?.theme?.surface || '#1e293b')
            : '#1e293b';
          const myColor = getComputedStyle(document.documentElement).getPropertyValue('--my-status').trim() || '#22c55e';
          const peerColor = peerData?.statusColor || '#22c55e';
          callModeCalleeId = entry.userId;
          _incomingCall = null;
          answerCall(myUserId, entry.userId).catch(() => {});
          import('./canvas.js')
            .then(({ enterCanvas }) => enterCanvas(entry.userId, resolveDisplayName(entry), myUserId, myColor, peerColor, peerSurface, () => {
              exitCallMode(myUserId);
            }))
            .catch(err => console.error('enterCanvas failed:', err));
        } else if (!li.classList.contains('call-mode')) {
          enterCallMode(entry, myUserId);
        }
      } else if (dx < -threshold) {
        swipeActive = false;
        if (li.classList.contains('call-mode')) {
          if (callModeCalleeId === entry.userId) {
            // We are the caller — exit call mode
            exitCallMode(myUserId);
          } else {
            // We are the receiver — optimistic UI, fire-and-forget Firebase
            // delete. Repaint the row from the cleared state so the glow AND
            // the "Calling you…" status text both clear: nulling _incomingCall
            // first makes the own-call watcher's delete echo a no-op transition
            // (prev===next===null), so it won't repaint the row for us.
            _incomingCall = null;
            const data = lastUserData.get(entry.userId);
            if (data) {
              updateFolloweeRow(entry, data, myUserId);
            } else {
              li.classList.remove('call-mode');
              li.style.removeProperty('--call-color-rgb');
            }
            endCall(myUserId, entry.userId).catch(() => {});
          }
        }
      }
    });

    li.addEventListener('pointerup',     () => { swipeActive = false; });
    li.addEventListener('pointercancel', () => { swipeActive = false; });
  }

  if (PALETTES_ENABLED && PALETTE_INTERACTIONS_ENABLED) {
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let pressStartX: number;
    let pressStartY: number;
    let suppressNextClick = false;

    li.addEventListener('pointerdown', (e) => {
      if (isCardDrawerOpen()) return;
      clearTimeout((pressTimer as ReturnType<typeof setTimeout>)); pressTimer = null;
      pressStartX = e.clientX;
      pressStartY = e.clientY;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        suppressNextClick = true;
        triggerAdoption(entry, myUserId);
      }, 500);
    });
    li.addEventListener('pointermove', (e) => {
      if (pressTimer && (Math.abs(e.clientX - pressStartX) > 8 ||
                         Math.abs(e.clientY - pressStartY) > 8)) {
        clearTimeout(pressTimer); pressTimer = null;
      }
    });
    ['pointerup', 'pointercancel'].forEach(ev =>
      li.addEventListener(ev, () => { clearTimeout((pressTimer as ReturnType<typeof setTimeout>)); pressTimer = null; })
    );
    li.addEventListener('click', (e) => {
      if (suppressNextClick) { suppressNextClick = false; e.stopImmediatePropagation(); }
    }, true);
  }

  // Assemble right-side actions. >=2 -> collapse behind a tool drawer; exactly
  // one -> inline. Bell is non-terminal (keeps the drawer open); unfollow is
  // terminal (closes it; the confirm overlay then covers the card).
  const actions = [];
  if (NOTIFICATIONS_ENABLED) {
    // Knock/Call are mutual-only interactions; non-mutual (Following) contacts
    // get availability only. (Followers use createFollowerOnlyRow — no bell.)
    const bell = createNotifyBell(entry.userId, {
      types: isMutual ? ['knock', 'call', 'availability'] : ['availability'],
      onNeedPermission: () => { ensureNotificationsReady().catch(() => {}); },
    });
    actions.push({ el: bell, closesDrawer: false });
  }
  actions.push({ el: unfollowBtn, closesDrawer: true });

  if (actions.length >= 2) {
    li.appendChild(createCardDrawer(actions));
  } else {
    li.appendChild(actions[0].el);
  }

  // Distance subscriptions are opened by reconcileDistanceSubs, called earlier
  // in the renderList pass this row was created in (before reconcileChildren).
  // Not needed here — no dependency on this DOM node existing.

  return li;
}

function createFollowerOnlyRow(follower: FollowerEntry, myUserId: string) {
  const li = document.createElement('li');
  li.className = 'follower-only';
  li.dataset.userId = follower.userId;

  // Roster display name remembered at follow-request approval (inbox.js):
  // shown next to the code, and pre-filled into the follow-back label field —
  // the user knows this person by name, not code.
  const rosterName = getFollowerName(follower.userId);
  const labelHtml = rosterName
    ? `${escapeHtml(follower.code)} (${escapeHtml(rosterName)})`
    : escapeHtml(follower.code);

  li.innerHTML = `
    <button class="follow-back-btn" title="Follow back">+</button>
    <div class="person-info">
      <div class="person-label" style="font-family:monospace">${labelHtml}</div>
    </div>
    <button class="unfollow-btn" title="Remove">×</button>`;

  (li.querySelector('.follow-back-btn') as HTMLElement).addEventListener('click', () => {
    (document.getElementById('add-code-input') as HTMLInputElement).value = follower.code;
    // Read at click time: the row persists across renders, and the roster name
    // can be learned (approval flow) after this row was created.
    (document.getElementById('add-label-input') as HTMLInputElement).value = getFollowerName(follower.userId) || '';
    openAddForm();
  });

  (li.querySelector('.unfollow-btn') as HTMLElement).addEventListener('click', () => {
    showConfirm(`Remove follower ${follower.code}?`, 'Remove', {
      type: 'removeFollower',
      userId: follower.userId,
      myUserId,
    });
  });

  return li;
}

// Reconcile local following list with server. Called from the watchFollowing
// subscription. On first tick where the server has nothing but local has
// entries, push local up (migration). Otherwise server wins on conflict
// (per-entry last-write-wins is enforced naturally by the keyed write path).
function syncFollowingFromServer(myUserId: string, serverFollowing: { userId: string; code: string; label: string }[]) {
  const localFollowing = getFollowing();

  // Any server list with entries in it proves this device is past the migration.
  if (serverFollowing.length > 0) markServerFollowingSeen(myUserId);

  // The migration push-up, gated: an empty server list means "this device never
  // synced" only for a device that has never seen one. For any other device it
  // means the server deleted those entries — a purge, merge or graduation of the
  // last followee — and republishing them writes cross-user residue naming a uid
  // that no longer exists, which nothing will ever clean up (G6). The rules
  // refuse that write regardless; this stops issuing it and prunes the ghost row.
  if (serverFollowing.length === 0 && localFollowing.length > 0 && !hasSeenServerFollowing(myUserId)) {
    for (const entry of localFollowing) {
      setFollowingEntry(myUserId, entry.userId, entry.code, entry.label ?? '').catch(() => {});
    }
    return;
  }

  // Compare as JSON strings keyed by uid (order-independent).
  const toMap = (arr: { userId: string; code: string; label?: string }[]) => {
    const m: Record<string, { code: string; label: string }> = {};
    for (const e of arr) m[e.userId] = { code: e.code, label: e.label ?? '' };
    return m;
  };
  const localJson  = JSON.stringify(toMap(localFollowing));
  const serverJson = JSON.stringify(toMap(serverFollowing));
  if (localJson === serverJson) return;

  setFollowing(serverFollowing);
  // Announce the cache update for consumers outside this module (same pattern
  // as 'last-timeout-synced'). groupContext re-evaluates its roster's
  // request-to-follow eligibility on this: a fresh-device restore that boots
  // straight into a group renders the roster before this first tick lands,
  // against an empty cache.
  document.dispatchEvent(new CustomEvent('following-synced'));
  // Tear down watchers for followees that disappeared; new ones will be
  // resubscribed by renderList.
  const serverIds = new Set(serverFollowing.map(e => e.userId));
  for (const uid of [...unsubscribers.keys()]) {
    if (!serverIds.has(uid)) teardownFolloweeWatches(uid);
  }
  renderList();
}

// Re-sort the Direct list after an availability change. Coalesced + deferred to a
// microtask: a presence value can arrive synchronously while renderList's reconcile
// is still in flight (presenceHub.js), and calling renderList() synchronously there
// would re-enter reconcileChildren on #people-list and throw. While a rename input
// is open, the reorder would blur it, so it's held until the edit closes
// (confirmRename/cancelRename flush it).
let _resortPending = false;
let _resortDeferredByEdit = false;

function scheduleResort() {
  if (_resortPending) return;
  _resortPending = true;
  queueMicrotask(runResort);
}

function runResort() {
  _resortPending = false;
  if (editingSet.size > 0) { _resortDeferredByEdit = true; return; }
  renderList();
}

function subscribeToFollowee(entry: FollowingEntry, myUserId: string) {
  // Through the shared presence hub so a uid we also watch in a group roster is
  // watched once at the RTDB layer (#214 R3). Same unsub contract as watchPresence.
  const unsub = subscribePresence(entry.userId, (userData: UserData | null) => {
    if (!userData) return;

    if (userData.status === 'available' && isExpired(userData.availableUntil)) {
      // Render the lapse locally only. Do NOT write back to the peer's node —
      // under R1 a client may write only its own presence (auth.uid === uid),
      // and every client computes expiry the same way, so display stays correct
      // without a (now-forbidden) cross-user write.
      userData.status = 'unavailable';
      userData.availableUntil = null;
    }

    if (userData.code && userData.code !== entry.code) {
      entry.code = userData.code;
      updateFollowingCode(entry.userId, userData.code);
      setFollowingEntry(myUserId, entry.userId, userData.code, entry.label ?? '').catch(() => {});
      renderList();
      return;
    }

    // Re-sort only when availability actually flips — group context also
    // resorts only on a flip now (groupContext.js's syncRosterOrder), same as
    // Direct here, to avoid reordering rows mid-interaction on every tick.
    const prev = lastUserData.get(entry.userId);
    const flipped = isAvailable(prev?.status, prev?.availableUntil)
      !== isAvailable(userData.status, userData.availableUntil);
    lastUserData.set(entry.userId, userData);
    // Skip the in-place repaint for a row being renamed (don't disturb its input);
    // the re-sort below still fires (deferred until the edit closes).
    if (!editingSet.has(entry.userId)) updateFolloweeRow(entry, userData, myUserId);
    if (flipped) scheduleResort();
  });
  unsubscribers.set(entry.userId, unsub);
}

export function updateFolloweeRow(entry: FollowingEntry, userData: UserData, myUserId: string) {
  if (!renderedFollowees.has(entry.userId)) {
    renderedFollowees.add(entry.userId);
    onFolloweeReady?.();
  }
  const li = followeeRow(entry.userId);
  if (!li) return;

  lastUserData.set(entry.userId, userData);

  const isAvail = isAvailable(userData.status, userData.availableUntil);
  const color = userData.statusColor || '#22c55e';
  let statusText;
  // Both checks gated by CALL_ENABLED so a stale calls/{me} mailbox entry
  // (e.g., a previous session left a call dangling) doesn't render call-mode
  // UI when calls are disabled on this device.
  const isCallee = CALL_ENABLED && callModeCalleeId !== null && entry.userId === callModeCalleeId;
  const isCallModeReceiver = CALL_ENABLED && !isCallee
    && _incomingCall?.from === entry.userId
    && !isCardDrawerOpen();
  if (isCallee) {
    const callText = getMadeCallCount() < 4
      ? 'Calling them\u2026 (swipe left to hang up)'
      : 'Calling them\u2026';
    statusText = isAvail
      ? `<span style="color:${safeCssColor(color)}">${callText}</span>`
      : callText;
  } else if (isCallModeReceiver) {
    const callText = getAnsweredCallCount() < 4
      ? 'Calling you\u2026 (swipe right to answer)'
      : 'Calling you\u2026';
    statusText = isAvail
      ? `<span style="color:${safeCssColor(color)}">${callText}</span>`
      : callText;
  } else if (isAvail) {
    const text = availableStatusText(li, entry.userId, userData.availableUntil ?? null);
    statusText = PALETTES_ENABLED
      ? `<span class="status-available" style="color:${safeCssColor(color)}">${text}</span>`
      : `<span class="status-available">${text}</span>`;
  } else {
    const lastSeenPhrase = formatLastSeen(userData.lastSeen ?? null);
    statusText = lastSeenPhrase ? `Last seen ${lastSeenPhrase}` : 'Unavailable';
  }

  li.dataset.available = String(isAvail);
  const dot = (li.querySelector('.person-dot') as HTMLElement | null);
  if (dot) {
    // Reset className first to clear any transient classes, then paint. The
    // PALETTES gate preserves the old behavior of leaving the dot's inline
    // styles untouched when palettes are off (CSS .available handles it).
    dot.className = `person-dot${isAvail ? ' available' : ''}`;
    if (PALETTES_ENABLED) paintStatusDot(dot, { color, available: isAvail, palettesEnabled: true });
  }
  const statusEl = (li.querySelector('.person-status') as HTMLElement);
  if (statusEl) statusEl.innerHTML = statusText;

  // Palette card styling (Increment 3): only when available
  if (PALETTES_ENABLED && userData.paletteKey && isAvail) {
    const palette = getPaletteByKey(userData.paletteKey);
    if (palette) {
      li.style.background      = palette.theme.surface;
      li.style.borderLeftColor = palette.color;
      statusEl.style.color     = palette.theme.textMuted;
      // The distance line reads var(--card-muted, --text-muted) from CSS —
      // stamped on the li (not the fragment) so label-only innerHTML
      // rebuilds keep the card-palette muted without re-running this branch.
      li.style.setProperty('--card-muted', palette.theme.textMuted);
      // .status-available keeps its inline statusColor (set above). The fuzzy
      // time follows the member's status color, not the palette theme — so the
      // text agrees with the status dot, mirroring the group roster
      // (groupContext.ts). Overriding to palette.color made the Direct text
      // disagree with the dot whenever a member's statusColor differed from
      // their palette's key color.
    } else {
      li.style.background      = '';
      li.style.borderLeftColor = '';
      statusEl.style.color     = '';
      li.style.removeProperty('--card-muted');
    }
  } else {
    li.style.background      = '';
    li.style.borderLeftColor = isAvail ? safeCssColor(color) : '';
    if (statusEl) statusEl.style.color = '';
    li.style.removeProperty('--card-muted');
  }

  // Call mode glow — caller side (this card is our active callee) or receiver side (they called us)
  if (isCallee || isCallModeReceiver) {
    const callColor = isAvail
      ? (userData.statusColor || '#22c55e')
      : (getComputedStyle(document.documentElement).getPropertyValue('--dot-off').trim() || '#6b7280');
    li.style.setProperty('--call-color-rgb', hexToRgb(callColor));
    li.classList.add('call-mode');
  } else {
    li.classList.remove('call-mode');
    li.style.removeProperty('--call-color-rgb');
  }

  // FTU hint eligibility — stamp attributes; js/hintRotation.js owns the actual
  // animation (one at a time, visible-only, prefer-available). Availability is a
  // tag here, NOT a gate: the engine resolves prefer-available-with-fallback.
  const peerColor = color;
  const peerTheme = userData.paletteKey || null;
  const isMyCombo = getFavorites().some(
    (c) => c.statusColor === peerColor && (c.paletteKey || null) === peerTheme);
  const longpressEligible = PALETTE_INTERACTIONS_ENABLED
    && isLongpressHintEligible()
    && !isCallee && !isCallModeReceiver
    && !isMyCombo;
  const swipeEligible = CALL_ENABLED
    && isSwipeHintEligible()
    && li.dataset.mutual === '1'
    && !isCallee && !isCallModeReceiver;
  li.dataset.hintAvail = isAvail ? '1' : '0';
  li.dataset.hintLongpress = longpressEligible ? '1' : '0';
  li.dataset.hintSwipe = swipeEligible ? '1' : '0';
  refreshHints();
}

// Re-stamp hint eligibility when the user's own combo changes — a row's
// longpress eligibility depends on whether the peer's combo equals mine.
// Re-running updateFolloweeRow recomputes the data-hint-* attrs and calls
// refreshHints so the engine sees fresh eligibility.
document.addEventListener('my-combo-changed', () => {
  for (const userId of renderedFollowees) {
    if (editingSet.has(userId)) continue;
    const data = lastUserData.get(userId);
    if (!data) continue;
    const entry = getFollowing().find((f) => f.userId === userId);
    if (entry) updateFolloweeRow(entry, data, myUserIdRef);
  }
});

// A knock float expired (knock.js). The card is no longer floated; re-sort so it
// lands in its correct current position instead of a stale captured one.
document.addEventListener('knock-float-restored', () => scheduleResort());

// Our own Direct location opt-in flipped (glyph tap, via locationShare.ts's
// toggleContext) or a server echo of prefs landed (prefs.ts's syncFromServer).
// renderList's reconcileDistanceSubs pass (run unconditionally at the end of
// every renderList) re-evaluates every currently-rendered mutual against the
// new opt-in value, so this re-render opens/closes subs for already-rendered
// mutual rows immediately — it does not wait for the row's section key to churn.
document.addEventListener('location-optin-changed', () => renderList());
document.addEventListener('location-prefs-synced', () => renderList());
// Our own published state changed (locationShare.ts — a context's first
// publish landed, the boot seed found a persisted node, or a teardown path
// deleted it). Same reconcile path: eligibility keys off the node existing,
// so this opens subs when the Direct node arrives and closes them when it is
// deleted (the server cancels the underlying listeners when our node
// disappears — they must be recreated, never reused). Unlike the two above,
// this can fire before initList — so it guards on init having happened.
document.addEventListener('location-publishing-changed', () => { if (myUserIdRef) renderList(); });

// On drawer close, reconcile deferred receiver-side call-mode against the
// latest known state — but ONLY for rows that actually have an incoming call
// cached. Re-rendering unrelated rows would re-stamp swipe-hint eligibility and
// could clobber an in-progress rename. A call cancelled while the drawer was
// open is no longer an incoming call here, so it's correctly skipped (its row
// never entered call-mode while deferred).
document.addEventListener('card-drawer-close', () => {
  if (getIncomingCallFrom() === null && callModeCalleeId === null) return;
  renderedFollowees.forEach((userId) => {
    if (editingSet.has(userId)) return;
    const data = lastUserData.get(userId);
    if (!data) return;
    if (getIncomingCallFrom() !== userId && callModeCalleeId !== userId) return;
    const entry = getFollowing().find((f) => f.userId === userId);
    if (entry) updateFolloweeRow(entry, data, myUserIdRef);
  });
});

function getLabelText(li: HTMLElement) {
  const labelEl = li.querySelector('.person-label');
  const input = ((labelEl ? labelEl.querySelector('.rename-input') : null) as HTMLInputElement | null);
  return input ? input.value : (labelEl ? labelEl.textContent : '');
}

function activateRename(entry: FollowingEntry, labelEl: HTMLElement) {
  const original = entry.label;
  editingSet.add(entry.userId);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = (original as string);
  labelEl.textContent = '';
  labelEl.appendChild(input);
  input.focus();
  input.select();

  function confirmRename() {
    const val = input.value.trim();
    if (!val) { cancelRename(); return; }
    renameFollowing(entry.userId, val);
    if (myUserIdRef) setFollowingEntry(myUserIdRef, entry.userId, entry.code, val).catch(() => {});
    entry.label = val;
    editingSet.delete(entry.userId);
    labelEl.textContent = val;
    // Re-sort: the new name changes alphabetical position, and this also flushes
    // any availability re-sort deferred while the edit was open. editingSet is
    // already cleared and this runs from a user event (Enter/blur), never inside
    // a reconcile, so calling renderList() here is re-entrancy-safe.
    _resortDeferredByEdit = false;
    renderList();
  }

  function cancelRename() {
    editingSet.delete(entry.userId);
    labelEl.textContent = original || entry.code;
    // Flush an availability re-sort that was deferred while this edit was open.
    if (_resortDeferredByEdit) { _resortDeferredByEdit = false; renderList(); }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmRename(); }
    if (e.key === 'Escape') { cancelRename(); }
  });
  input.addEventListener('blur', () => {
    if (editingSet.has(entry.userId)) confirmRename();
  });
}

// Invite-vs-code mode for the unified "Redeem an invite" form (spec N6). The
// status line doubles as the preview surface: it upgrades to "You'll follow …"
// when resolveInvitePreview lands, and stays at the generic detection text on
// any preview failure (fail-soft — submit still redeems).
let _inviteModeToken: string | null = null;
let _previewSeq = 0;
function updateAddFormMode(raw: string) {
  const token = extractInviteTokenFromText(raw);
  if (token !== null && token === _inviteModeToken) return 'invite'; // unchanged — don't re-fire the preview
  _inviteModeToken = token;
  const statusEl = (document.getElementById('add-invite-status') as HTMLElement);
  const submit = (document.getElementById('add-submit-btn') as HTMLElement);
  const labelEls = [document.getElementById('add-label-label'), document.getElementById('add-label-input')];
  if (!token) {
    statusEl.textContent = '';
    statusEl.classList.add('hidden');
    labelEls.forEach((el) => el && el.classList.remove('hidden'));
    submit.textContent = 'Follow';
    return 'code';
  }
  labelEls.forEach((el) => el && el.classList.add('hidden'));
  submit.textContent = 'Redeem invite';
  statusEl.textContent = 'Invite link detected';
  statusEl.classList.remove('hidden');
  const seq = ++_previewSeq;
  resolveInvitePreview(token).then((p: InvitePreview | null) => {
    if (seq !== _previewSeq || !p) return; // stale input or dead token — keep the generic text
    statusEl.textContent = p.scope === 'group'
      ? `You'll join '${p.groupName || 'a group'}'`
      : `You'll follow ${p.label || 'someone'}`;
  }).catch(() => { /* fail-soft (spec N6) */ });
  return 'invite';
}

function redeemFailureMessage(reason: string | null | undefined) {
  switch (reason) {
    case 'already-following': return "You're already following them.";
    case 'already-member': return "You're already in that group.";
    case 'self': return "That's your own invite.";
    case 'revoked':
    case 'expired': return 'This invite link has expired.';
    case 'cap': return 'This invite has reached its limit.';
    default: return "That invite link isn't valid.";
  }
}

// Invite-mode submit (spec N6): the exact boot-redemption pipeline, reused.
// Group invites prompt for a display name mid-flight, same as the URL flow
// (app.js:675) — the cache handoff skips the duplicate index/group reads.
async function handleRedeemInvite(myUserId: string, myCode: string, token: string) {
  const errorEl = (document.getElementById('add-error') as HTMLElement);
  const submit = (document.getElementById('add-submit-btn') as HTMLButtonElement);
  errorEl.classList.add('hidden');
  submit.disabled = true;
  // True once the group-entry guard is open (needs-display-name branch only),
  // so the shared success/failure tails below know to release it.
  let entryGuardOpen = false;
  try {
    let result = (await attemptRedeemFromUrl(token, myUserId, myCode, {}) as RedeemResult | null);
    if (result && result.ok === false && result.reason === 'needs-display-name') {
      const displayName = await showGroupDisplayNamePrompt(result.groupName || 'this group', '');
      // Group joins navigate straight into the group. Hide Direct + the nav row
      // and suspend renderNavRow across the brokered redeem below: it's a slow
      // callable whose own users/{uid}/groups write echoes an enumeration tick
      // that would paint the new group's card (backend code as the name — no
      // meta sub yet) over a still-visible Direct once closeAddForm reveals it.
      // Same flash the inbox Join guards (a9223c2); the redeem form reached it
      // by the other door. Released to navigateToGroup's own render on success
      // (restore=false), or restored on failure (restore=true).
      beginGroupEntryTransition();
      entryGuardOpen = true;
      result = (await attemptRedeemFromUrl(token, myUserId, myCode, { displayName, cache: (result.cache as NonNullable<Parameters<typeof attemptRedeemFromUrl>[3]>['cache']) }) as RedeemResult | null);
    }
    if (result && result.ok) {
      closeAddForm();
      renderList();
      // Release the guard (leaving Direct hidden) so navigateToGroup's synchronous
      // emit inside the callback owns the next paint — prompt → dark body → group.
      if (entryGuardOpen) endGroupEntryTransition(false);
      if (_onInviteRedeemed) await _onInviteRedeemed(result);
      return;
    }
    // Redeem failed (or was declined) — bring Direct back so the inline error
    // shows in the still-open form.
    if (entryGuardOpen) endGroupEntryTransition(true);
    showError(errorEl, redeemFailureMessage(result && result.reason));
  } finally {
    submit.disabled = false;
  }
}

async function handleAddPerson(myUserId: string, myCode: string) {
  const codeInput = (document.getElementById('add-code-input') as HTMLInputElement);
  const labelInput = (document.getElementById('add-label-input') as HTMLInputElement);
  const errorEl = (document.getElementById('add-error') as HTMLElement);

  const raw = codeInput.value.trim();
  const inviteToken = extractInviteTokenFromText(raw);
  if (inviteToken) return handleRedeemInvite(myUserId, myCode, inviteToken);
  const code = raw.toUpperCase();
  const label = labelInput.value.trim();

  errorEl.classList.add('hidden');

  if (!code) {
    showError(errorEl, 'Please enter a code.');
    return;
  }

  if (code.length !== 6 || !/^[A-Z0-9]{6}$/.test(code)) {
    showError(errorEl, "That doesn't look like a code or an invite link.");
    return;
  }

  if (code === myCode.toUpperCase()) {
    showError(errorEl, "That's your own code.");
    return;
  }

  const following = getFollowing();
  const existing = following.find((e) => e.code.toUpperCase() === code);
  if (existing) {
    showError(errorEl, `You're already following ${resolveDisplayName(existing)}.`);
    return;
  }

  (document.getElementById('add-submit-btn') as HTMLButtonElement).disabled = true;

  const targetUserId = await lookupCode(code);
  if (!targetUserId) {
    showError(errorEl, 'Code not found. Check the code and try again.');
    (document.getElementById('add-submit-btn') as HTMLButtonElement).disabled = false;
    return;
  }

  await registerAsFollower(targetUserId, myUserId, myCode);
  addFollowing({ code, label, userId: targetUserId });
  setFollowingEntry(myUserId, targetUserId, code, label).catch(() => {});
  closeAddForm();
  renderList();
  (document.getElementById('add-submit-btn') as HTMLButtonElement).disabled = false;
}

// Form mode: the sticky #nav-row / #app-header pin cannot be scrolled away,
// and browsers only fake the "push up" with a visual-viewport pan while the
// keyboard is open (the Telegram webview resizes instead and never pans). So
// opening the form unpins both via body.add-form-open (css/app.css) and closes
// the code drawer — open, it can occupy the whole scrollport from inside the
// sticky header — letting the scrollIntoView genuinely center the code input.
function openAddForm() {
  document.getElementById('code-drawer')?.classList.remove('open');
  document.getElementById('mycode-chip')?.classList.remove('active');
  document.body.classList.add('add-form-open');
  (document.getElementById('add-person-form') as HTMLElement).classList.add('open');
}

function closeAddForm() {
  (document.getElementById('add-person-form') as HTMLElement).classList.remove('open');
  document.body.classList.remove('add-form-open');
  (document.getElementById('add-code-input') as HTMLInputElement).value = '';
  (document.getElementById('add-label-input') as HTMLInputElement).value = '';
  (document.getElementById('add-error') as HTMLElement).classList.add('hidden');
  updateAddFormMode(''); // back to code mode (labels, button, status line)
}

function showError(el: HTMLElement, msg: string) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

