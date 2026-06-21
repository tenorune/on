// js/following.js
import {
  lookupCode, watchFollowers, registerAsFollower, unregisterAsFollower,
  removeFollower, isExpired, isAvailable,
  formatLastSeen, startCall, answerCall, endCall, watchOwnCall, setStatusColor,
  watchFollowing, setFollowingEntry, removeFollowingEntry, watchRevocations,
} from './db.js';
import { subscribePresence } from './presenceHub.js';
import {
  getFollowing, addFollowing, removeFollowing, renameFollowing, updateFollowingCode,
  setFollowing, getFollowerName,
} from './store.js';
import {
  isHintSeen, markHintSeen,
  getMadeCallCount, incrementMadeCallCount, getAnsweredCallCount, incrementAnsweredCallCount,
  getPaletteState, setPaletteState,
  getFavorites,
} from './prefs.js';
import { escapeHtml, hexToRgb, safeCssColor, resolveDisplayName, availableForText } from './utils.js';
import { isLongpressHintEligible, isSwipeHintEligible } from './hints.js';
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED, KNOCK_ENABLED, CALL_ENABLED, NOTIFICATIONS_ENABLED } from './features.js';
import { createNotifyBell } from './notifyBell.js';
import { createCardDrawer, isCardDrawerOpen, closeCardDrawer } from './cardDrawer.js';
import { ensureNotificationsReady } from './notifyPrompt.js';
import { getGlowForColor, getPaletteByKey, enterPaletteMode, switchSet, PALETTE_SETS, paintStatusDot } from './palettes.js';
import { sendKnock, getFloatedUserIds, noteDirectActivity } from './knock.js';
import { saveCombo, buildAdoptedCombo } from './favorites.js';
import { enterCanvas, exitCanvas, showPeerLeftDialog } from './canvas.js';
import { reconcileChildren } from './reconcile.js';
import { refreshHints, clearActiveHint } from './hintRotation.js';

const unsubscribers = new Map(); // userId → unsubscribe fn
const editingSet = new Set();
const lastUserData = new Map(); // userId → most recent userData from Firebase
const renderedFollowees = new Set();
let onFolloweeReady = null;

// Direct-list rows are keyed by data-user-id, but a group roster reuses the same
// attribute for the same uid. Scope every Direct-list row lookup to #people-list
// so a mutual who is also a group member never has their Direct row resolve to
// the group roster — which leaked their Direct status into the group card.
function followeeRow(userId) {
  return document.querySelector(`#people-list [data-user-id="${userId}"]`);
}

let latestFollowersSnapshot = [];
let unsubFollowers = null;
let unsubFollowing = null;
let unsubRevocations = null;
let refreshInterval = null;
let pendingAction = null; // { type: 'unfollow'|'removeFollower', userId, myUserId }
let myUserIdRef = null; // set at init time; used by renderList and confirm handlers
let callModeCalleeId = null;   // userId of callee while in call mode (null = not in call mode)
let _incomingCall = null; // { from } when someone is ringing me; null otherwise
export function getIncomingCallFrom() { return _incomingCall?.from ?? null; }
let unsubOwnCall = null;

function showConfirm(title, btnText, action) {
  pendingAction = action;
  document.getElementById('unfollow-confirm-title').textContent = title;
  document.getElementById('unfollow-do-btn').textContent = btnText;
  document.getElementById('unfollow-confirm').classList.remove('hidden');
}

function dismissConfirm() {
  document.getElementById('unfollow-confirm').classList.add('hidden');
  pendingAction = null;
}

async function doConfirm() {
  if (!pendingAction) return;
  const action = pendingAction;
  dismissConfirm();

  if (action.type === 'unfollow') {
    const unsub = unsubscribers.get(action.userId);
    if (unsub) unsub();
    unsubscribers.delete(action.userId);
    lastUserData.delete(action.userId);
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

export function initList(myUserId, myCode) {
  myUserIdRef = myUserId;

  renderedFollowees.clear();

  // Reset stale subscription state from any prior init (also makes tests independent)
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers.clear();
  lastUserData.clear();
  editingSet.clear();
  callModeCalleeId = null;
  _incomingCall = null;
  latestFollowersSnapshot = [];
  pendingAction = null;
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }

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
          !document.getElementById('unfollow-confirm').classList.contains('hidden')) {
        dismissConfirm();
      }
    });
    document.getElementById('unfollow-cancel-btn').addEventListener('click', dismissConfirm);
    document.getElementById('unfollow-do-btn').addEventListener('click', doConfirm);
  }

  // Subscribe to followers list
  if (unsubFollowers) unsubFollowers();
  unsubFollowers = watchFollowers(myUserId, (followers) => {
    latestFollowersSnapshot = followers;
    renderList();
  });

  // Subscribe to own following list (cross-device sync of contacts)
  if (unsubFollowing) unsubFollowing();
  unsubFollowing = watchFollowing(myUserId, (serverFollowing) => {
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
      const unsub = unsubscribers.get(revokerId);
      if (unsub) { unsub(); unsubscribers.delete(revokerId); }
      lastUserData.delete(revokerId);
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
      const peerId = call.to || call.from;
      const entry = getFollowing().find((f) => f.userId === peerId);
      if (entry) {
        callModeCalleeId = peerId;
        _incomingCall = null;
        const peerData = lastUserData.get(peerId);
        const peerSurface = peerData?.paletteKey
          ? (getPaletteByKey(peerData.paletteKey)?.theme?.surface || '#1e293b') : '#1e293b';
        const myColor = getComputedStyle(document.documentElement).getPropertyValue('--my-status').trim() || '#22c55e';
        const peerColor = peerData?.statusColor || '#22c55e';
        enterCanvas(peerId, resolveDisplayName(entry), myUserId, myColor, peerColor, peerSurface, () => exitCallMode(myUserId))
          .catch((err) => console.error('enterCanvas (answered) failed:', err));
      }
      return;
    }
    // Callee side: someone is ringing me (not yet in a call).
    const prevFrom = _incomingCall?.from ?? null;
    const nextFrom = (call && call.from && !call.answered && callModeCalleeId === null) ? call.from : null;
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
    if (!call && callModeCalleeId !== null) handlePeerEnded(myUserId);
  });

  // Refresh time labels every 60s
  refreshInterval = setInterval(() => {
    getFollowing().forEach((entry) => {
      const userData = lastUserData.get(entry.userId);
      if (!userData || userData.status !== 'available') return;
      if (editingSet.has(entry.userId)) return;
      updateFolloweeRow(entry, userData, myUserId);
    });
  }, 60000);

  document.getElementById('add-person-btn').addEventListener('click', () => {
    document.getElementById('add-person-form').classList.add('open');
    document.getElementById('add-code-input').focus();
    setTimeout(() => {
      document.getElementById('add-code-input').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  });

  document.getElementById('add-cancel-btn').addEventListener('click', closeAddForm);

  document.getElementById('add-code-input').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  document.getElementById('add-code-input').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const codeInput = document.getElementById('add-code-input');
    const errorEl = document.getElementById('add-error');
    const code = codeInput.value.trim().toUpperCase();
    errorEl.classList.add('hidden');
    if (!code) { showError(errorEl, 'Please enter a code.'); return; }
    if (code.length !== 6 || !/^[A-Z0-9]{6}$/.test(code)) { showError(errorEl, 'Code must be 6 letters and numbers.'); return; }
    if (code === myCode.toUpperCase()) { showError(errorEl, "That's your own code."); return; }
    const existing = getFollowing().find((f) => f.code.toUpperCase() === code);
    if (existing) { showError(errorEl, `You're already following ${resolveDisplayName(existing)}.`); return; }
    codeInput.disabled = true;
    const targetUserId = await lookupCode(code);
    codeInput.disabled = false;
    if (!targetUserId) { showError(errorEl, 'Code not found. Check the code and try again.'); return; }
    document.getElementById('add-label-input').focus();
  });

  document.getElementById('add-label-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAddPerson(myUserId, myCode);
  });

  document.getElementById('add-submit-btn').addEventListener('click', () => {
    handleAddPerson(myUserId, myCode);
  });

  window.addEventListener('online', () => document.getElementById('offline-banner').classList.add('hidden'));
  window.addEventListener('offline', () => document.getElementById('offline-banner').classList.remove('hidden'));
  if (!navigator.onLine) document.getElementById('offline-banner').classList.remove('hidden');
}

export function setFolloweeReadyCallback(fn) {
  onFolloweeReady = fn;
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
  const out = {};
  for (const f of latestFollowersSnapshot) out[f.userId] = f.code;
  return out;
}

export function getCurrentMutuals() {
  const followers = getCurrentFollowersMap();
  return getFollowing()
    .filter((f) => followers[f.userId])
    .map((f) => ({ userId: f.userId, label: f.label, code: f.code }));
}

function handlePeerEnded(myUserId) {
  const canvasScreen = document.getElementById('canvas-screen');
  if (canvasScreen && canvasScreen.classList.contains('active')) {
    import('./canvas.js').then(({ showPeerLeftDialog, exitCanvas }) => {
      showPeerLeftDialog(canvasScreen, 'Your partner', () => { exitCanvas(); exitCallMode(myUserId, { peerEnded: true }); });
    });
  } else {
    exitCallMode(myUserId, { peerEnded: true });
  }
}

export function enterCallMode(calleeEntry, myUserId) {
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

export function reEnterCallMode(calleeEntry, calleeData, myUserId) {
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

export function exitCallMode(myUserId, { peerEnded = false } = {}) {
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
  unsubscribers.forEach((unsub, userId) => {
    if (!activeUserIds.has(userId)) {
      unsub();
      unsubscribers.delete(userId);
      lastUserData.delete(userId);
    }
  });

  const list = document.getElementById('people-list');
  const emptyMsg = document.getElementById('empty-list-msg');

  const isEmpty = mutuals.length === 0 && followingOnly.length === 0 && followerOnly.length === 0;
  document.getElementById('add-person-area').classList.toggle('has-list', !isEmpty);
  if (isEmpty) {
    reconcileChildren(list, [], {
      create: () => null, // unreachable with empty keys
      update: () => {},
      onRemove: (node) => {
        if (isCardDrawerOpen() && node.querySelector('.card-drawer')) closeCardDrawer();
      },
    });
    list.style.display = 'none';
    emptyMsg.classList.remove('hidden');
    return;
  }

  list.style.display = '';
  emptyMsg.classList.add('hidden');

  // Sort uses lastUserData which still has status for entries with active subscriptions.
  // New entries (not yet subscribed) will sort as unavailable until Firebase delivers status.
  function sortFollowees(entries) {
    return [...entries].sort((a, b) => {
      if (callModeCalleeId) {
        if (a.userId === callModeCalleeId) return -1;
        if (b.userId === callModeCalleeId) return 1;
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

  function sortFollowerOnly(entries) {
    return [...entries].sort((a, b) => a.code.localeCompare(b.code));
  }

  const entryByKey = new Map();
  const keys = [];
  function pushSection(labelKey, entries, type) {
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

  // Track newly-created followee keys so we can repopulate from cache
  // after reconcile (update() runs before insertBefore on fresh nodes, so
  // updateFolloweeRow's document.querySelector lookup would return null).
  const freshFolloweeKeys = [];

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

function applyAdoption(entry, myUserId) {
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

function triggerAdoption(entry, myUserId) {
  // Clear long-press hint on first adoption
  if (!isHintSeen('longpress')) {
    markHintSeen('longpress');
    clearActiveHint();
  }
  // Build the adopted combo from the source's broadcast state and push to
  // favorites BEFORE applying the adoption (the apply mutates picker state).
  const targetData = lastUserData.get(entry.userId);
  const adoptedCombo = buildAdoptedCombo(
    targetData?.statusColor,
    targetData?.paletteKey ?? null,
  );
  saveCombo(adoptedCombo);
  applyAdoption(entry, myUserId);
}

function createFolloweeRow(entry, myUserId, isMutual = false) {
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

  li.querySelector('.person-label').addEventListener('click', () => {
    activateRename(entry, li.querySelector('.person-label'));
  });

  if (KNOCK_ENABLED && isMutual) {
    const labelEl = li.querySelector('.person-label');
    li.addEventListener('click', (e) => {
      if (isCardDrawerOpen()) return;
      if (labelEl.contains(e.target)) return;
      const statusColor = lastUserData.get(entry.userId)?.statusColor;
      sendKnock(entry.userId, myUserId, statusColor);
    });
  }

  if (CALL_ENABLED && isMutual) {
    let swipeStartX = 0, swipeStartY = 0, swipeCardWidth = 0, swipeActive = false;

    li.addEventListener('pointerdown', (e) => {
      if (isCardDrawerOpen()) return;
      if (e.target.closest('.unfollow-btn, .person-label')) return;
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
          enterCanvas(entry.userId, resolveDisplayName(entry), myUserId, myColor, peerColor, peerSurface, () => {
            exitCallMode(myUserId);
          }).catch(err => console.error('enterCanvas failed:', err));
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
    let pressTimer = null;
    let pressStartX, pressStartY;
    let suppressNextClick = false;

    li.addEventListener('pointerdown', (e) => {
      if (isCardDrawerOpen()) return;
      clearTimeout(pressTimer); pressTimer = null;
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
      li.addEventListener(ev, () => { clearTimeout(pressTimer); pressTimer = null; })
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

  return li;
}

function createFollowerOnlyRow(follower, myUserId) {
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

  li.querySelector('.follow-back-btn').addEventListener('click', () => {
    document.getElementById('add-code-input').value = follower.code;
    // Read at click time: the row persists across renders, and the roster name
    // can be learned (approval flow) after this row was created.
    document.getElementById('add-label-input').value = getFollowerName(follower.userId) || '';
    document.getElementById('add-person-form').classList.add('open');
  });

  li.querySelector('.unfollow-btn').addEventListener('click', () => {
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
function syncFollowingFromServer(myUserId, serverFollowing) {
  const localFollowing = getFollowing();

  if (serverFollowing.length === 0 && localFollowing.length > 0) {
    for (const entry of localFollowing) {
      setFollowingEntry(myUserId, entry.userId, entry.code, entry.label ?? '').catch(() => {});
    }
    return;
  }

  // Compare as JSON strings keyed by uid (order-independent).
  const toMap = (arr) => {
    const m = {};
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
  for (const [uid, unsub] of unsubscribers.entries()) {
    if (!serverIds.has(uid)) {
      unsub();
      unsubscribers.delete(uid);
      lastUserData.delete(uid);
    }
  }
  renderList();
}

function subscribeToFollowee(entry, myUserId) {
  // Through the shared presence hub so a uid we also watch in a group roster is
  // watched once at the RTDB layer (#214 R3). Same unsub contract as watchPresence.
  const unsub = subscribePresence(entry.userId, (userData) => {
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

    lastUserData.set(entry.userId, userData);
    if (editingSet.has(entry.userId)) return;
    updateFolloweeRow(entry, userData, myUserId);
  });
  unsubscribers.set(entry.userId, unsub);
}

export function updateFolloweeRow(entry, userData, myUserId) {
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
    const text = availableForText(userData.availableUntil);
    statusText = PALETTES_ENABLED
      ? `<span class="status-available" style="color:${safeCssColor(color)}">${text}</span>`
      : `<span class="status-available">${text}</span>`;
  } else {
    const lastSeenPhrase = formatLastSeen(userData.lastSeen ?? null);
    statusText = lastSeenPhrase ? `Last seen ${lastSeenPhrase}` : 'Unavailable';
  }

  li.dataset.available = String(isAvail);
  const dot = li.querySelector('.person-dot');
  if (dot) {
    // Reset className first to clear any transient classes, then paint. The
    // PALETTES gate preserves the old behavior of leaving the dot's inline
    // styles untouched when palettes are off (CSS .available handles it).
    dot.className = `person-dot${isAvail ? ' available' : ''}`;
    if (PALETTES_ENABLED) paintStatusDot(dot, { color, available: isAvail, palettesEnabled: true });
  }
  const statusEl = li.querySelector('.person-status');
  if (statusEl) statusEl.innerHTML = statusText;

  // Palette card styling (Increment 3): only when available
  if (PALETTES_ENABLED && userData.paletteKey && isAvail) {
    const palette = getPaletteByKey(userData.paletteKey);
    if (palette) {
      li.style.background      = palette.theme.surface;
      li.style.borderLeftColor = palette.color;
      statusEl.style.color     = palette.theme.textMuted;
      const availableSpan = statusEl.querySelector('.status-available');
      if (availableSpan) availableSpan.style.color = palette.color;
    } else {
      li.style.background      = '';
      li.style.borderLeftColor = '';
      statusEl.style.color     = '';
    }
  } else {
    li.style.background      = '';
    li.style.borderLeftColor = isAvail ? safeCssColor(color) : '';
    if (statusEl) statusEl.style.color = '';
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

function getLabelText(li) {
  const labelEl = li.querySelector('.person-label');
  const input = labelEl ? labelEl.querySelector('.rename-input') : null;
  return input ? input.value : (labelEl ? labelEl.textContent : '');
}

function activateRename(entry, labelEl) {
  const original = entry.label;
  editingSet.add(entry.userId);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = original;
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
    // Re-sort: the new name changes alphabetical position. editingSet is already
    // cleared and this runs from a user event (Enter/blur), never inside a
    // reconcile, so calling renderList() here is re-entrancy-safe.
    renderList();
  }

  function cancelRename() {
    editingSet.delete(entry.userId);
    labelEl.textContent = original || entry.code;
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmRename(); }
    if (e.key === 'Escape') { cancelRename(); }
  });
  input.addEventListener('blur', () => {
    if (editingSet.has(entry.userId)) confirmRename();
  });
}

async function handleAddPerson(myUserId, myCode) {
  const codeInput = document.getElementById('add-code-input');
  const labelInput = document.getElementById('add-label-input');
  const errorEl = document.getElementById('add-error');

  const code = codeInput.value.trim().toUpperCase();
  const label = labelInput.value.trim();

  errorEl.classList.add('hidden');

  if (!code) {
    showError(errorEl, 'Please enter a code.');
    return;
  }

  if (code.length !== 6 || !/^[A-Z0-9]{6}$/.test(code)) {
    showError(errorEl, 'Code must be 6 letters and numbers.');
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

  document.getElementById('add-submit-btn').disabled = true;

  const targetUserId = await lookupCode(code);
  if (!targetUserId) {
    showError(errorEl, 'Code not found. Check the code and try again.');
    document.getElementById('add-submit-btn').disabled = false;
    return;
  }

  await registerAsFollower(targetUserId, myUserId, myCode);
  addFollowing({ code, label, userId: targetUserId });
  setFollowingEntry(myUserId, targetUserId, code, label).catch(() => {});
  closeAddForm();
  renderList();
  document.getElementById('add-submit-btn').disabled = false;
}

function closeAddForm() {
  document.getElementById('add-person-form').classList.remove('open');
  document.getElementById('add-code-input').value = '';
  document.getElementById('add-label-input').value = '';
  document.getElementById('add-error').classList.add('hidden');
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

