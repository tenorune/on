// js/inbox.js
// Phase 3 invitee-side Inbox. Subscribes to pendingInvites/{ownUid}/ and
// renders a nav-row button (visible when ≥1 pending) plus a modal that lists
// all pending invites with per-row Join / Decline.

import { watchPendingInvites, deletePendingInvite, readGroup, readMember } from './db.js';
import { joinGroup } from './groups.js';
import { navigateToGroup } from './groupNav.js';
import { getFollowing } from './prefs.js';
import { showGroupDisplayNamePrompt } from './groupDisplayNamePrompt.js';

let _myUid = null;
let _pending = {};               // groupId → { from, ts }
let _unsubscribe = null;
let _overlayHandlerInstalled = false;

export function initInbox(uid) {
  _myUid = uid;
  if (_unsubscribe) _unsubscribe();
  _unsubscribe = watchPendingInvites(uid, (snap) => {
    _pending = snap || {};
    renderInboxNavSlot();
    refreshInboxModalIfOpen();
    if (getPendingCount() === 0) closeInboxModal();
  });
  installOverlayHandlerOnce();
}

export function getPendingCount() {
  return Object.keys(_pending).length;
}

export function renderInboxNavSlot() {
  const slot = document.getElementById('nav-row-inbox-slot');
  if (!slot) return;
  slot.innerHTML = '';
  if (getPendingCount() === 0) return;
  const btn = document.createElement('button');
  btn.className = 'inbox-btn';
  btn.type = 'button';
  btn.textContent = 'Inbox';
  btn.title = 'Pending invites';
  btn.addEventListener('click', () => openInboxModal());
  slot.appendChild(btn);
}

export async function openInboxModal() {
  const modal = document.getElementById('inbox-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  await renderInboxModalRows();
}

function closeInboxModal() {
  const modal = document.getElementById('inbox-modal');
  if (!modal) return;
  modal.classList.add('hidden');
}

async function refreshInboxModalIfOpen() {
  const modal = document.getElementById('inbox-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  await renderInboxModalRows();
}

async function renderInboxModalRows() {
  const list = document.getElementById('inbox-modal-list');
  if (!list) return;
  list.innerHTML = '';
  const following = getFollowing();
  const inviterLabelByUid = {};
  for (const f of following) inviterLabelByUid[f.userId] = f.label;

  const entries = Object.entries(_pending);
  for (const [groupId, record] of entries) {
    const inviterLabel = inviterLabelByUid[record.from] || record.from;
    const group = await readGroup(groupId);
    const groupName = group?.name || groupId;
    list.appendChild(buildInboxRow({ groupId, inviterLabel, groupName }));
  }
}

function buildInboxRow({ groupId, inviterLabel, groupName }) {
  const li = document.createElement('li');
  li.className = 'inbox-row';
  li.dataset.groupId = groupId;

  const text = document.createElement('span');
  text.className = 'inbox-row-text';
  text.textContent = `${inviterLabel} invited you to join '${groupName}'.`;
  li.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'inbox-row-actions';

  const joinBtn = document.createElement('button');
  joinBtn.type = 'button';
  joinBtn.className = 'inbox-join-btn primary-btn';
  joinBtn.textContent = 'Join';
  joinBtn.addEventListener('click', () => handleJoin(groupId, groupName));
  actions.appendChild(joinBtn);

  const declineBtn = document.createElement('button');
  declineBtn.type = 'button';
  declineBtn.className = 'inbox-decline-btn ghost-btn';
  declineBtn.textContent = 'Decline';
  declineBtn.addEventListener('click', () => handleDecline(groupId));
  actions.appendChild(declineBtn);

  li.appendChild(actions);
  return li;
}

async function handleJoin(groupId, groupName) {
  if (!_myUid) return;
  // Race protection: check membership and group existence in parallel.
  const [existingMember, group] = await Promise.all([
    readMember(groupId, _myUid),
    readGroup(groupId),
  ]);
  // Race protection 1: invitee may have joined this group via link already.
  if (existingMember) {
    await deletePendingInvite(_myUid, groupId);
    return;
  }
  // Race protection 2: group may have been deleted between invite and Join.
  if (!group) {
    await deletePendingInvite(_myUid, groupId);
    return;
  }
  // Prompt for the invitee's per-group display name (mirrors Flow A/B).
  closeInboxModal();
  const displayName = await showGroupDisplayNamePrompt(groupName);
  await joinGroup(groupId, _myUid, displayName);
  await Promise.all([
    deletePendingInvite(_myUid, groupId),
    navigateToGroup(groupId),
  ]);
}

async function handleDecline(groupId) {
  if (!_myUid) return;
  await deletePendingInvite(_myUid, groupId);
}

function installOverlayHandlerOnce() {
  if (_overlayHandlerInstalled) return;
  _overlayHandlerInstalled = true;
  document.addEventListener('click', (e) => {
    const modal = document.getElementById('inbox-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (e.target === modal) closeInboxModal();
  });
}
