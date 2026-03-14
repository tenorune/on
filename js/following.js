// js/following.js
import {
  lookupCode, watchStatus, registerAsFollower, unregisterAsFollower,
  isExpired, writeBackExpired, formatTimeRemainingFuzzy, timeRemainingMs,
  formatLastSeen, // used in updateFolloweeRow for combined status text
} from './db.js';
import { getFollowing, addFollowing, removeFollowing, renameFollowing } from './store.js';
import { escapeHtml } from './utils.js';

const unsubscribers = new Map(); // userId → unsubscribe fn
const editingSet = new Set();
const lastUserData = new Map(); // userId → most recent userData from Firebase

let pendingUnfollow = null; // { entry, myUserId }

function showConfirm(entry, myUserId) {
  pendingUnfollow = { entry, myUserId };
  document.getElementById('unfollow-confirm-title').textContent = `Unfollow ${entry.label}?`;
  document.getElementById('unfollow-confirm').classList.remove('hidden');
}

function dismissConfirm() {
  document.getElementById('unfollow-confirm').classList.add('hidden');
  pendingUnfollow = null;
}

async function doUnfollow() {
  if (!pendingUnfollow) return;
  const { entry, myUserId } = pendingUnfollow;
  dismissConfirm();

  // 1. Unsubscribe first so the Firebase deletion echo doesn't re-trigger the callback
  const unsub = unsubscribers.get(entry.userId);
  if (unsub) unsub();
  unsubscribers.delete(entry.userId);
  lastUserData.delete(entry.userId);

  // 2. Remove from Firebase followers list (self-initiated — does not write revokedFollowers)
  await unregisterAsFollower(entry.userId, myUserId);

  // 3. Remove from localStorage
  removeFollowing(entry.userId);

  // 4. Remove row from DOM; show empty state if list is now empty
  const li = document.getElementById(`followee-${entry.userId}`);
  if (li) li.remove();

  const list = document.getElementById('following-list');
  if (list && list.querySelectorAll('li[id^="followee-"]').length === 0) {
    list.innerHTML = '<li style="color:var(--text-muted);font-size:13px;padding:12px 0;list-style:none">You\'re not following anyone yet.</li>';
  }
}

export function initFollowingTab(myUserId, myCode) {
  // Inject confirm sheet once (guard prevents duplicate on re-init)
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

    // Dismiss on backdrop click or Escape
    confirmEl.addEventListener('click', (e) => {
      if (e.target === confirmEl) dismissConfirm();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' &&
          !document.getElementById('unfollow-confirm').classList.contains('hidden')) {
        dismissConfirm();
      }
    });
    document.getElementById('unfollow-cancel-btn').addEventListener('click', dismissConfirm);
    document.getElementById('unfollow-do-btn').addEventListener('click', doUnfollow);
  }

  renderFollowingList(myUserId);

  // Refresh time labels for available followees every 60s (availableUntil is a
  // fixed timestamp in Firebase that never changes, so the subscription callback
  // won't re-fire; we need to recompute client-side to keep the display current)
  setInterval(() => {
    getFollowing().forEach((entry) => {
      const userData = lastUserData.get(entry.userId);
      if (!userData || userData.status !== 'available') return;
      if (editingSet.has(entry.userId)) return;
      updateFolloweeRow(entry, userData, myUserId);
      sortFollowingList();
    });
  }, 60000);

  document.getElementById('add-person-btn').addEventListener('click', () => {
    document.getElementById('add-person-form').classList.remove('hidden');
    document.getElementById('add-person-btn').classList.add('hidden');
    document.getElementById('add-code-input').focus();
  });

  document.getElementById('add-cancel-btn').addEventListener('click', () => {
    closeAddForm();
  });

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

function renderFollowingList(myUserId) {
  // Unsubscribe existing listeners
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers.clear();
  lastUserData.clear();

  const following = getFollowing();
  const list = document.getElementById('following-list');
  list.innerHTML = '';

  following.forEach((entry) => subscribeToFollowee(entry, myUserId));
}

function subscribeToFollowee(entry, myUserId) {
  const unsub = watchStatus(entry.userId, (userData) => {
    if (!userData) return;

    // Check if this user has revoked us
    if (userData.revokedFollowers && userData.revokedFollowers[myUserId]) {
      removeFollowing(entry.userId);
      unsub();
      unsubscribers.delete(entry.userId);
      renderFollowingList(myUserId);
      return;
    }

    // Expiry write-back (only when online to avoid queued writes on reconnect)
    if (userData.status === 'available' && isExpired(userData.availableUntil)) {
      if (navigator.onLine) writeBackExpired(entry.userId);
      userData.status = 'unavailable';
      userData.availableUntil = null;
    }

    lastUserData.set(entry.userId, userData);
    if (editingSet.has(entry.userId)) return;
    updateFolloweeRow(entry, userData, myUserId);
    sortFollowingList();
  });
  unsubscribers.set(entry.userId, unsub);
}

function updateFolloweeRow(entry, userData, myUserId) {
  const list = document.getElementById('following-list');
  let li = document.getElementById(`followee-${entry.userId}`);

  const isAvail = userData.status === 'available' && !isExpired(userData.availableUntil);
  const ms = timeRemainingMs(userData.availableUntil);
  let statusText;
  if (isAvail) {
    statusText = `<span class="status-available">Available for ${formatTimeRemainingFuzzy(ms).replace(/ left$/, '')}</span>`;
  } else {
    const lastSeenPhrase = formatLastSeen(userData.lastSeen ?? null);
    statusText = lastSeenPhrase ? `Last seen ${lastSeenPhrase}` : 'Unavailable';
  }

  if (!li) {
    li = document.createElement('li');
    li.id = `followee-${entry.userId}`;
    li.dataset.available = String(isAvail);
    li.innerHTML = `
      <div class="person-dot${isAvail ? ' available' : ''}"></div>
      <div class="person-info">
        <div class="person-label">${escapeHtml(entry.label)}</div>
        <div class="person-status">${statusText}</div>
      </div>
      <button class="unfollow-btn" title="Unfollow" data-userid="${entry.userId}">×</button>`;
    list.appendChild(li);
    li.querySelector('.person-label').addEventListener('click', () => {
      activateRename(entry, li.querySelector('.person-label'));
    });
    li.querySelector('.unfollow-btn').addEventListener('click', () => {
      showConfirm(entry, myUserId);
    });
  } else {
    li.dataset.available = String(isAvail);
    const dot = li.querySelector('.person-dot');
    const statusEl = li.querySelector('.person-status');
    dot.className = `person-dot${isAvail ? ' available' : ''}`;
    statusEl.className = 'person-status';
    statusEl.innerHTML = statusText;
  }
}

function getLabelText(li) {
  const labelEl = li.querySelector('.person-label');
  const input = labelEl.querySelector('.rename-input');
  return input ? input.value : labelEl.textContent;
}

function sortFollowingList() {
  const list = document.getElementById('following-list');
  const items = Array.from(list.querySelectorAll('li'));
  items.sort((a, b) => {
    const aAvail = a.dataset.available === 'true';
    const bAvail = b.dataset.available === 'true';
    if (aAvail !== bAvail) return bAvail ? 1 : -1;
    return getLabelText(a).localeCompare(getLabelText(b));
  });
  items.forEach((li) => list.appendChild(li));
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

  function confirm() {
    const val = input.value.trim();
    if (!val) return;
    renameFollowing(entry.userId, val);
    entry.label = val;
    editingSet.delete(entry.userId);
    labelEl.textContent = val;
  }

  function cancel() {
    editingSet.delete(entry.userId);
    labelEl.textContent = original;
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { cancel(); }
  });
  input.addEventListener('blur', () => {
    if (editingSet.has(entry.userId)) confirm();
  });
}

async function handleAddPerson(myUserId, myCode) {
  const codeInput = document.getElementById('add-code-input');
  const labelInput = document.getElementById('add-label-input');
  const errorEl = document.getElementById('add-error');

  const code = codeInput.value.trim().toUpperCase();
  const label = labelInput.value.trim();

  errorEl.classList.add('hidden');

  if (!code || !label) {
    showError(errorEl, 'Please fill in both fields.');
    return;
  }

  if (code.length !== 6 || !/^[A-Z0-9]{6}$/.test(code)) {
    showError(errorEl, 'Code must be 6 letters and numbers.');
    return;
  }

  const myCode6 = myCode.toUpperCase();
  if (code === myCode6) {
    showError(errorEl, "That's your own code.");
    return;
  }

  const following = getFollowing();
  const existing = following.find((e) => e.code.toUpperCase() === code);
  if (existing) {
    showError(errorEl, `You're already following someone with that code (${existing.label}).`);
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
  subscribeToFollowee({ code, label, userId: targetUserId }, myUserId);
  closeAddForm();
  document.getElementById('add-submit-btn').disabled = false;
}

function closeAddForm() {
  document.getElementById('add-person-form').classList.add('hidden');
  document.getElementById('add-person-btn').classList.remove('hidden');
  document.getElementById('add-code-input').value = '';
  document.getElementById('add-label-input').value = '';
  document.getElementById('add-error').classList.add('hidden');
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

