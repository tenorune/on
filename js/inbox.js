// js/inbox.js
// Phase 3 invitee-side Inbox. Subscribes to pendingInvites/{ownUid}/ and
// renders a nav-row button (visible when ≥1 pending) plus a modal that lists
// all pending invites with per-row Join / Decline.

import { watchPendingInvites, deletePendingInvite, readGroupName, readMember,
  watchFollowRequests, deleteFollowRequest, writeFollowGrant } from './db.js';
import { joinGroup, showToast } from './groups.js';
import { navigateToGroup } from './groupNav.js';
import { getFollowing } from './prefs.js';
import { setFollowerName } from './store.js';
import { showGroupDisplayNamePrompt } from './groupDisplayNamePrompt.js';

let _myUid = null;
let _myCode = null;
let _pending = {};               // groupId → { from, ts }
let _followRequests = {};        // requesterUid → { from, groupId, ts }
let _unsubscribe = null;
let _frUnsubscribe = null;
let _overlayHandlerInstalled = false;

// "Unseen" tracking (per-device, like the knock-pending cue). An invite is
// unseen until the user opens the Inbox. Keyed by groupId:ts so a re-invite
// (new ts after a decline) glows again. localStorage so it survives reloads.
const SEEN_KEY = 'statusapp_inbox_seen';
let _seen = new Set();
function loadSeen() {
  try { _seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { _seen = new Set(); }
}
function persistSeen() {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([..._seen])); } catch { /* quota */ }
}
function inviteKey(groupId, record) { return `${groupId}:${record?.ts ?? ''}`; }
function followRequestKey(reqUid, record) { return `fr:${reqUid}:${record?.ts ?? ''}`; }
function pendingKeys() { return Object.entries(_pending).map(([gid, r]) => inviteKey(gid, r)); }
function followRequestKeys() { return Object.entries(_followRequests).map(([uid, r]) => followRequestKey(uid, r)); }
function allKeys() { return pendingKeys().concat(followRequestKeys()); }
function totalCount() { return Object.keys(_pending).length + Object.keys(_followRequests).length; }
function hasUnseen() { return allKeys().some((k) => !_seen.has(k)); }
// Drop seen entries no longer live (declined/joined/approved) so the set can't grow
// unbounded and a future same-key item isn't pre-marked seen.
function pruneSeen() {
  const live = new Set(allKeys());
  let changed = false;
  for (const k of _seen) if (!live.has(k)) { _seen.delete(k); changed = true; }
  if (changed) persistSeen();
}
function markAllSeen() {
  let changed = false;
  for (const k of allKeys()) if (!_seen.has(k)) { _seen.add(k); changed = true; }
  if (changed) persistSeen();
}

export function initInbox(uid, code) {
  _myUid = uid;
  _myCode = code;
  _groupNameCache.clear();
  loadSeen();
  const onChange = () => {
    pruneSeen();
    renderInboxNavSlot();
    refreshInboxModalIfOpen();
    if (totalCount() === 0) closeInboxModal();
  };
  if (_unsubscribe) _unsubscribe();
  _unsubscribe = watchPendingInvites(uid, (snap) => { _pending = snap || {}; onChange(); });
  if (_frUnsubscribe) _frUnsubscribe();
  _frUnsubscribe = watchFollowRequests(uid, (snap) => { _followRequests = snap || {}; onChange(); });
  installOverlayHandlerOnce();
}

export function getPendingCount() {
  return Object.keys(_pending).length;
}

// A backgrounded/suspended PWA (iOS especially, but also an occluded desktop
// window) freezes the RTDB socket, so an invite or follow-request that arrives
// while hidden never reaches the live onValue listeners — the Inbox stays empty
// until a full restart. Re-subscribe the watchers when the app returns to the
// foreground so the current server state is pulled in and rendered. Mirrors
// knock.js's visibilitychange re-init.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (_myUid) initInbox(_myUid, _myCode);
});

// `slot` is passed by the nav-row reconcile's update(node) — which runs BEFORE
// the freshly-created node is inserted, so a getElementById lookup would miss it
// (and find nothing once a group round-trip has recreated the slot). Paint into
// the node we're handed; other callers (data-change / open) omit it and fall
// back to the live DOM node.
export function renderInboxNavSlot(slot = document.getElementById('nav-row-inbox-slot')) {
  if (!slot) return;
  slot.innerHTML = '';
  if (totalCount() === 0) return;
  const btn = document.createElement('button');
  btn.className = 'inbox-btn';
  if (hasUnseen()) btn.classList.add('unseen'); // glow until opened
  btn.type = 'button';
  btn.textContent = 'Inbox';
  btn.title = 'Pending invites';
  btn.addEventListener('click', () => openInboxModal());
  slot.appendChild(btn);
}

// Deep-link target for an invite push notification (app.js routes type:'invite'
// here). Same code path as tapping the nav-row Inbox button.
export async function openInboxModal() {
  const modal = document.getElementById('inbox-modal');
  if (!modal) return;
  // Opening the Inbox = the invites are now seen; clear the glow.
  markAllSeen();
  renderInboxNavSlot();
  modal.classList.remove('hidden');
  await renderInboxModalRows();
}

export function closeInboxModal() {
  const modal = document.getElementById('inbox-modal');
  if (!modal) return;
  modal.classList.add('hidden');
}

async function refreshInboxModalIfOpen() {
  const modal = document.getElementById('inbox-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  await renderInboxModalRows();
}

// Session cache for the group-name read. The inbox re-renders fully on every
// watchPendingInvites/watchFollowRequests tick and on every modal open, and a
// pending invite's group name is effectively static per session — so re-fetching
// it each render is wasteful (#214 R5). Cleared on initInbox.
//
// Reads the NAME LEAF only (readGroupName → groups/{gid}/name), not the whole
// groups/{gid} node: the invitee isn't a member yet, and groups/{gid}/.read is
// membership-gated, so a whole-node read is denied ("Permission denied"). The
// name leaf is readable by any authed user. Returns { name } or null.
const _groupNameCache = new Map(); // groupId → { name } | null
async function cachedReadGroupName(groupId) {
  if (_groupNameCache.has(groupId)) return _groupNameCache.get(groupId);
  const group = await readGroupName(groupId);
  if (group) _groupNameCache.set(groupId, group);
  return group;
}

async function renderInboxModalRows() {
  const list = document.getElementById('inbox-modal-list');
  if (!list) return;
  const inviteEntries = Object.entries(_pending);
  const frEntries = Object.entries(_followRequests);

  // Lightweight in-flight state so the modal isn't blank while reads round-trip.
  list.innerHTML = '';
  if (inviteEntries.length + frEntries.length > 0) {
    const loading = document.createElement('li');
    loading.className = 'inbox-loading';
    loading.textContent = 'Loading…';
    list.appendChild(loading);
  }

  const following = getFollowing();
  const labelByUid = {};
  for (const f of following) labelByUid[f.userId] = f.label;

  // Invite rows. Inviter name: own label → their group displayName → fallback.
  const inviteRows = await Promise.all(inviteEntries.map(async ([groupId, record]) => {
    const needMember = !labelByUid[record.from];
    const [group, member] = await Promise.all([
      cachedReadGroupName(groupId),
      // The inviter's group displayName is only a nicer label (falls back to
      // 'Someone'). Reading ANOTHER member's node is membership-private, so if
      // the invitee no longer follows the inviter (unfollowed, or list not yet
      // synced) and isn't a member, this read is denied — fail soft, don't let
      // it reject the whole row.
      needMember ? readMember(groupId, record.from).catch(() => null) : Promise.resolve(null),
    ]);
    const inviterLabel = labelByUid[record.from] || member?.displayName || 'Someone';
    const groupName = group?.name || groupId;
    return buildInboxRow({ groupId, inviterLabel, groupName });
  }));

  // Follow-request rows. Requester name: own label → their shared-group displayName → fallback.
  const frRows = await Promise.all(frEntries.map(async ([requesterUid, record]) => {
    let requesterLabel = labelByUid[requesterUid];
    if (!requesterLabel && record.groupId) {
      const member = await readMember(record.groupId, requesterUid);
      requesterLabel = member?.displayName;
    }
    return buildFollowRequestRow({ requesterUid, requesterLabel: requesterLabel || 'Someone' });
  }));

  list.innerHTML = '';
  for (const row of inviteRows) list.appendChild(row);
  for (const row of frRows) list.appendChild(row);
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

function buildFollowRequestRow({ requesterUid, requesterLabel }) {
  const li = document.createElement('li');
  li.className = 'inbox-row';
  li.dataset.requesterId = requesterUid;

  const text = document.createElement('span');
  text.className = 'inbox-row-text';
  text.textContent = `${requesterLabel} wants to follow you.`;
  li.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'inbox-row-actions';

  const approveBtn = document.createElement('button');
  approveBtn.type = 'button';
  approveBtn.className = 'inbox-approve-btn primary-btn';
  approveBtn.textContent = 'Approve';
  approveBtn.addEventListener('click', () => handleApprove(requesterUid, requesterLabel));
  actions.appendChild(approveBtn);

  const declineBtn = document.createElement('button');
  declineBtn.type = 'button';
  declineBtn.className = 'inbox-fr-decline-btn ghost-btn';
  declineBtn.textContent = 'Decline';
  declineBtn.addEventListener('click', () => handleFollowRequestDecline(requesterUid));
  actions.appendChild(declineBtn);

  li.appendChild(actions);
  return li;
}

async function handleApprove(requesterUid, requesterLabel) {
  if (!_myUid || !_myCode) return;
  // Double-tap guard.
  const row = document.querySelector(`.inbox-row[data-requester-id="${requesterUid}"]`);
  const btn = row?.querySelector('.inbox-approve-btn');
  if (btn) { if (btn.disabled) return; btn.disabled = true; }
  // Hand the requester our code so their client completes the follow, then clear
  // the request. The requester's grant-watcher does the rest. On failure, re-enable
  // the captured button and surface the error (mirrors handleJoin) — a retry after
  // a grant-written/delete-failed split just rewrites the same grant (set is
  // idempotent) and re-deletes.
  try {
    // The grant carries my display name in the shared group — the name the
    // requester tapped on the roster — so their new Direct card opens named.
    const groupId = _followRequests[requesterUid]?.groupId;
    const me = groupId ? await readMember(groupId, _myUid) : null;
    await writeFollowGrant(requesterUid, _myUid, _myCode, me?.displayName ?? null);
    // Symmetrically, remember the requester's roster name for my follower card
    // ("CODE (Name)") and the follow-back prefill. Skip the generic fallback.
    if (requesterLabel && requesterLabel !== 'Someone') {
      setFollowerName(requesterUid, requesterLabel);
    }
    await deleteFollowRequest(_myUid, requesterUid);
  } catch (e) {
    if (btn) btn.disabled = false;
    showToast(e.message || 'Could not approve this request. Please try again.');
  }
}

async function handleFollowRequestDecline(requesterUid) {
  if (!_myUid) return;
  await deleteFollowRequest(_myUid, requesterUid);
}

async function handleJoin(groupId, groupName) {
  if (!_myUid) return;
  // Double-tap guard: disable the Join button on first click so a second
  // click can't open the displayName prompt twice.
  const row = document.querySelector(`.inbox-row[data-group-id="${groupId}"]`);
  const joinBtn = row?.querySelector('.inbox-join-btn');
  if (joinBtn) {
    if (joinBtn.disabled) return;
    joinBtn.disabled = true;
  }
  // Race protection: check membership and group existence in parallel. The
  // existence check uses readGroupName (name leaf) — the invitee isn't a member
  // yet, so a whole groups/{gid} read would be denied; a null name means the
  // group was deleted between invite and Join.
  const [existingMember, group] = await Promise.all([
    readMember(groupId, _myUid),
    readGroupName(groupId),
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
  try {
    // Pass the group + membership we already read so joinGroup skips its own
    // membership-gated reads — a not-yet-member can't read the whole groups/{gid}
    // node, only the name leaf (same pattern as redeemGroupInvite).
    await joinGroup(groupId, _myUid, displayName, { group, existing: existingMember });
  } catch (e) {
    // Join failed — a network error, or the group was deleted in the race
    // window after our existence check. Leave the pending invite in place so the
    // Inbox row stays (re-opening re-renders a fresh, enabled Join), re-enable
    // the captured button, and surface the error rather than swallowing it.
    if (joinBtn) joinBtn.disabled = false;
    showToast(e.message || 'Could not join this group. Please try again.');
    return;
  }
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
  // Escape-to-dismiss for keyboard users — the modal has aria-modal="true",
  // which traps focus, so without this there is no keyboard path out.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('inbox-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    closeInboxModal();
  });
}
