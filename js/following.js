// js/following.js
import {
  lookupCode, watchStatus, watchFollowers, registerAsFollower, unregisterAsFollower,
  removeFollower, isExpired, writeBackExpired, formatTimeRemainingFuzzy, timeRemainingMs,
  formatLastSeen,
} from './db.js';
import { getFollowing, addFollowing, removeFollowing, renameFollowing, updateFollowingCode } from './store.js';
import { escapeHtml } from './utils.js';
import { PALETTES_ENABLED } from './features.js';
import { getGlowForColor, getPaletteByKey } from './palettes.js';

const unsubscribers = new Map(); // userId → unsubscribe fn
const editingSet = new Set();
const lastUserData = new Map(); // userId → most recent userData from Firebase

let latestFollowersSnapshot = [];
let unsubFollowers = null;
let refreshInterval = null;
let pendingAction = null; // { type: 'unfollow'|'removeFollower', userId, myUserId }
let myUserIdRef = null; // set at init time; used by renderList and confirm handlers

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

  // Reset stale subscription state from any prior init (also makes tests independent)
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers.clear();
  lastUserData.clear();
  editingSet.clear();
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

  document.getElementById('add-submit-btn').addEventListener('click', () => {
    handleAddPerson(myUserId, myCode);
  });

  window.addEventListener('online', () => document.getElementById('offline-banner').classList.add('hidden'));
  window.addEventListener('offline', () => document.getElementById('offline-banner').classList.remove('hidden'));
  if (!navigator.onLine) document.getElementById('offline-banner').classList.remove('hidden');
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
    createFolloweeRow(entry, myUserId);
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

function createFolloweeRow(entry, myUserId) {
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

    lastUserData.set(entry.userId, userData);
    if (editingSet.has(entry.userId)) return;
    updateFolloweeRow(entry, userData, myUserId);
  });
  unsubscribers.set(entry.userId, unsub);
}

function updateFolloweeRow(entry, userData, myUserId) {
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

  // Palette card styling (Increment 3)
  if (PALETTES_ENABLED && userData.paletteKey) {
    const palette = getPaletteByKey(userData.paletteKey);
    if (palette) {
      li.style.background      = palette.theme.surface;
      li.style.borderLeftColor = isAvail ? palette.color : 'transparent';
      statusEl.style.color     = palette.theme.textMuted;
      if (isAvail) {
        const availableSpan = statusEl.querySelector('.status-available');
        if (availableSpan) availableSpan.style.color = palette.color;
      }
    } else {
      // Unknown key — clear any previously set inline styles
      li.style.background      = '';
      li.style.borderLeftColor = '';
      statusEl.style.color     = '';
    }
  } else {
    li.style.background      = '';
    li.style.borderLeftColor = '';
    if (statusEl) statusEl.style.color = '';
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
