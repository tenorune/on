// js/following.js
import {
  lookupCode, watchStatus, watchFollowers, registerAsFollower, unregisterAsFollower,
  removeFollower, isExpired, writeBackExpired, formatTimeRemainingFuzzy, timeRemainingMs,
  formatLastSeen, setCallState, clearCallState, setStatusColor,
} from './db.js';
import {
  getFollowing, addFollowing, removeFollowing, renameFollowing, updateFollowingCode,
  getPaletteState,
} from './store.js';
import { escapeHtml, hexToRgb } from './utils.js';
import { PALETTES_ENABLED, KNOCK_ENABLED, CALL_ENABLED } from './features.js';
import { getGlowForColor, getPaletteByKey, enterPaletteMode, exitPaletteMode, switchSet } from './palettes.js';
import { sendKnock } from './knock.js';

const unsubscribers = new Map(); // userId → unsubscribe fn
const editingSet = new Set();
const lastUserData = new Map(); // userId → most recent userData from Firebase
const renderedFollowees = new Set();
let onFolloweeReady = null;

let latestFollowersSnapshot = [];
let unsubFollowers = null;
let refreshInterval = null;
let pendingAction = null; // { type: 'unfollow'|'removeFollower', userId, myUserId }
let myUserIdRef = null; // set at init time; used by renderList and confirm handlers
let callModeCalleeId = null;   // userId of callee while in call mode (null = not in call mode)
let adoptionSnapshot = null; // non-null while a card's palette is adopted

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
  adoptionSnapshot = null;
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
    if (existing) { showError(errorEl, `You're already following ${existing.label || existing.code}.`); return; }
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

export function enterCallMode(calleeEntry, myUserId) {
  // If we were being called by someone, clear their callState first
  lastUserData.forEach((userData, userId) => {
    if (userData.callState?.calleeId === myUserId) {
      clearCallState(userId).catch(() => {});
    }
  });

  callModeCalleeId = calleeEntry.userId;
  setCallState(myUserId, calleeEntry.userId).catch(() => {});

  const calleeData = lastUserData.get(calleeEntry.userId);
  const callColor = calleeData?.statusColor || '#22c55e';

  // Apply glow to callee's card (clear any in-progress knock animation first)
  const liPre = document.querySelector(`[data-user-id="${calleeEntry.userId}"]`);
  if (liPre) {
    liPre.style.boxShadow = '';
    liPre.style.transition = '';
    liPre.style.setProperty('--call-color-rgb', hexToRgb(callColor));
    liPre.classList.add('call-mode');
  }

  renderList();
}

export function reEnterCallMode(calleeEntry, calleeData, myUserId) {
  callModeCalleeId = calleeEntry.userId;
  // No Firebase write — state already persisted
  const callColor = calleeData?.statusColor || '#22c55e';
  const li = document.querySelector(`[data-user-id="${calleeEntry.userId}"]`);
  if (li) {
    li.style.boxShadow = '';
    li.style.transition = '';
    li.style.setProperty('--call-color-rgb', hexToRgb(callColor));
    li.classList.add('call-mode');
  }
  renderList();
}

export function exitCallMode(myUserId) {
  const prevCalleeId = callModeCalleeId;
  callModeCalleeId = null;
  clearCallState(myUserId).catch(() => {});

  if (prevCalleeId) {
    const li = document.querySelector(`[data-user-id="${prevCalleeId}"]`);
    if (li) {
      li.classList.remove('call-mode');
      li.style.removeProperty('--call-color-rgb');
    }
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
    list.innerHTML = '';
    list.style.display = 'none';
    emptyMsg.classList.remove('hidden');
    return;
  }

  list.style.display = '';
  emptyMsg.classList.add('hidden');
  list.innerHTML = '';

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
      const aAvail = aData ? aData.status === 'available' && !isExpired(aData.availableUntil) : false;
      const bAvail = bData ? bData.status === 'available' && !isExpired(bData.availableUntil) : false;
      if (aAvail !== bAvail) return bAvail ? 1 : -1;
      const aName = a.label || a.code;
      const bName = b.label || b.code;
      return aName.localeCompare(bName);
    });
  }

  function sortFollowerOnly(entries) {
    return [...entries].sort((a, b) => a.code.localeCompare(b.code));
  }

  function appendSection(labelText, entries, renderRow) {
    if (entries.length === 0) return;
    const labelLi = document.createElement('li');
    labelLi.className = 'list-section-label';
    labelLi.textContent = labelText;
    list.appendChild(labelLi);
    entries.forEach(renderRow);
  }

  appendSection('Mutuals', sortFollowees(mutuals), (entry) => {
    createFolloweeRow(entry, myUserId, true);
    // Only subscribe for entries not already subscribed (preserves existing connection)
    if (!unsubscribers.has(entry.userId)) {
      subscribeToFollowee(entry, myUserId);
    } else {
      // Row was just recreated from scratch; repopulate from cache so it doesn't
      // flash "Unavailable" until the next Firebase event arrives.
      const cached = lastUserData.get(entry.userId);
      if (cached) updateFolloweeRow(entry, cached, myUserId);
    }
  });

  appendSection('Following', sortFollowees(followingOnly), (entry) => {
    createFolloweeRow(entry, myUserId);
    if (!unsubscribers.has(entry.userId)) {
      subscribeToFollowee(entry, myUserId);
    } else {
      const cached = lastUserData.get(entry.userId);
      if (cached) updateFolloweeRow(entry, cached, myUserId);
    }
  });

  appendSection('Followers', sortFollowerOnly(followerOnly), (follower) => {
    createFollowerOnlyRow(follower, myUserId);
  });
}

function createFolloweeRow(entry, myUserId, isMutual = false) {
  const li = document.createElement('li');
  li.dataset.userId = entry.userId;

  const nameHtml = (entry.label)
    ? `<div class="person-label">${escapeHtml(entry.label)}</div>`
    : `<div class="person-label">${escapeHtml(entry.code)}</div>`;

  li.innerHTML = `
    <div class="person-dot"></div>
    <div class="person-info">
      ${nameHtml}
      <div class="person-status">Unavailable</div>
    </div>
    <button class="unfollow-btn" title="Unfollow">×</button>`;

  const displayName = entry.label || entry.code;
  li.querySelector('.unfollow-btn').addEventListener('click', () => {
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
    const unfollowBtnEl = li.querySelector('.unfollow-btn');
    li.addEventListener('click', (e) => {
      if (labelEl.contains(e.target)) return;
      if (unfollowBtnEl.contains(e.target)) return;
      const statusColor = lastUserData.get(entry.userId)?.statusColor;
      sendKnock(entry.userId, myUserId, statusColor);
    });
  }

  if (CALL_ENABLED && isMutual) {
    let swipeStartX = 0, swipeStartY = 0, swipeCardWidth = 0, swipeActive = false;

    li.addEventListener('pointerdown', (e) => {
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
        enterCallMode(entry, myUserId);
      } else if (dx < -threshold) {
        swipeActive = false;
        if (li.classList.contains('call-mode')) {
          if (callModeCalleeId === entry.userId) {
            // We are the caller — exit call mode
            exitCallMode(myUserId);
          } else {
            // We are the receiver — optimistic UI, fire-and-forget Firebase delete
            li.classList.remove('call-mode');
            li.style.removeProperty('--call-color-rgb');
            clearCallState(entry.userId).catch(() => {});
          }
        }
      }
    });

    li.addEventListener('pointerup',     () => { swipeActive = false; });
    li.addEventListener('pointercancel', () => { swipeActive = false; });
  }

  document.getElementById('people-list').appendChild(li);
}

function createFollowerOnlyRow(follower, myUserId) {
  const li = document.createElement('li');
  li.className = 'follower-only';
  li.dataset.userId = follower.userId;

  li.innerHTML = `
    <button class="follow-back-btn" title="Follow back">+</button>
    <div class="person-info">
      <div class="person-label" style="font-family:monospace">${escapeHtml(follower.code)}</div>
    </div>
    <button class="unfollow-btn" title="Remove">×</button>`;

  li.querySelector('.follow-back-btn').addEventListener('click', () => {
    document.getElementById('add-code-input').value = follower.code;
    document.getElementById('add-label-input').value = '';
    document.getElementById('add-person-form').classList.add('open');
  });

  li.querySelector('.unfollow-btn').addEventListener('click', () => {
    showConfirm(`Remove follower ${follower.code}?`, 'Remove', {
      type: 'removeFollower',
      userId: follower.userId,
      myUserId,
    });
  });

  document.getElementById('people-list').appendChild(li);
}

function subscribeToFollowee(entry, myUserId) {
  const unsub = watchStatus(entry.userId, (userData) => {
    if (!userData) return;

    if (userData.revokedFollowers && userData.revokedFollowers[myUserId]) {
      removeFollowing(entry.userId);
      unsub();
      unsubscribers.delete(entry.userId);
      renderList();
      return;
    }

    if (userData.status === 'available' && isExpired(userData.availableUntil)) {
      if (navigator.onLine) writeBackExpired(entry.userId);
      userData.status = 'unavailable';
      userData.availableUntil = null;
    }

    if (userData.code && userData.code !== entry.code) {
      entry.code = userData.code;
      updateFollowingCode(entry.userId, userData.code);
      renderList();
      return;
    }

    const prevUserData = lastUserData.get(entry.userId);
    lastUserData.set(entry.userId, userData);
    if (editingSet.has(entry.userId)) return;
    // Skip re-render if only the knocks subtree changed — knock writes trigger onValue
    // on the parent node, and we don't want them interrupting card animations.
    if (prevUserData &&
        userData.status === prevUserData.status &&
        userData.availableUntil === prevUserData.availableUntil &&
        userData.statusColor === prevUserData.statusColor &&
        userData.paletteKey === prevUserData.paletteKey &&
        userData.code === prevUserData.code &&
        userData.callState?.calleeId === prevUserData.callState?.calleeId) return;
    updateFolloweeRow(entry, userData, myUserId);
  });
  unsubscribers.set(entry.userId, unsub);
}

export function updateFolloweeRow(entry, userData, myUserId) {
  if (!renderedFollowees.has(entry.userId)) {
    renderedFollowees.add(entry.userId);
    onFolloweeReady?.();
  }
  const li = document.querySelector(`[data-user-id="${entry.userId}"]`);
  if (!li) return;

  const isAvail = userData.status === 'available' && !isExpired(userData.availableUntil);
  const color = userData.statusColor || '#22c55e';
  const glow  = getGlowForColor(color);
  const ms = timeRemainingMs(userData.availableUntil);
  let statusText;
  if (isAvail) {
    if (PALETTES_ENABLED) {
      statusText = `<span class="status-available" style="color:${color}">Available for ${formatTimeRemainingFuzzy(ms).replace(/ left$/, '')}</span>`;
    } else {
      statusText = `<span class="status-available">Available for ${formatTimeRemainingFuzzy(ms).replace(/ left$/, '')}</span>`;
    }
  } else {
    const lastSeenPhrase = formatLastSeen(userData.lastSeen ?? null);
    statusText = lastSeenPhrase ? `Last seen ${lastSeenPhrase}` : 'Unavailable';
  }

  li.dataset.available = String(isAvail);
  const dot = li.querySelector('.person-dot');
  if (dot) {
    dot.className = `person-dot${isAvail ? ' available' : ''}`;
    if (PALETTES_ENABLED) {
      if (isAvail) {
        dot.style.background  = color;
        dot.style.borderColor = color;
        dot.style.boxShadow   = `0 0 10px ${glow}`;
      } else {
        dot.style.background  = '';
        dot.style.borderColor = '';
        dot.style.boxShadow   = '';
      }
    }
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
    li.style.borderLeftColor = isAvail ? color : '';
    if (statusEl) statusEl.style.color = '';
  }

  // Call mode glow — caller side (this card is our active callee) or receiver side (they called us)
  const isCallee = callModeCalleeId !== null && entry.userId === callModeCalleeId;
  const isCallModeReceiver = !isCallee && userData.callState?.calleeId === myUserId;
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
}

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
    entry.label = val;
    editingSet.delete(entry.userId);
    labelEl.textContent = val;
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
    showError(errorEl, `You're already following ${existing.label || existing.code}.`);
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
