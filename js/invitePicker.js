// js/invitePicker.js
// Phase 3 in-app invite picker. Lives inside the unified invite modal's
// Section 2 for group-scope invites.
//
// Responsibilities:
//   - Render the merged list: labeled people first (everyone you follow, by
//     your private label), then code-only rows (followers you don't follow)
//   - Filter out current group members and the inviter themself
//   - Show "Invited" pill on rows with a pending invite
//   - Multi-select state for unselected rows
//   - Invite button → writePendingInvite for each selected; flip rows to Invited
//   - Tap "Invited" pill → deletePendingInvite; flip row back to selectable
//
// Eligibility is key-based (A1, #291): everyone whose key you hold —
// (followers ∪ following) − members − self. Rules already permit inviting
// any uid (database.rules.json requires only membership).
//
// Data is injected (followers map, following list, current member set, pending
// invitee set) rather than fetched inside this module so callers can shape
// the data freely and tests don't need to mock subscriptions.

import { writePendingInvite, deletePendingInvite } from './db.js';

let _state = null;

// Mirrors the eligibility rule used by renderInvitePicker's row builders below
// (followingEntries + followerOnlyEntries filters) so the two can never
// disagree: anyone whose key you hold is displayable unless they're already a
// group member or the inviter themself.
export function hasDisplayableInvitees({ followers, following = [], currentMemberUids, inviterUid }) {
  const eligible = (uid) => !currentMemberUids.has(uid) && uid !== inviterUid;
  if (following.some((f) => eligible(f.userId))) return true;
  const followingUids = new Set(following.map((f) => f.userId));
  return Object.keys(followers).some((uid) => !followingUids.has(uid) && eligible(uid));
}

export function renderInvitePicker({
  inviterUid, groupId, followers, following = [], currentMemberUids, pendingInviteeUids,
}) {
  _state = {
    inviterUid, groupId,
    selected: new Set(),
    pendingInviteeUids: new Set(pendingInviteeUids || []),
  };

  // Build the rendered list of { uid, displayName }, labeled people first.
  const followingEntries = following
    .filter((f) => !currentMemberUids.has(f.userId) && f.userId !== inviterUid)
    // A followee with no custom label falls back to their share code (from the
    // following entry itself, or the followers map for a mutual) so the row is
    // never blank.
    .map((f) => ({ uid: f.userId, displayName: f.label || f.code || followers[f.userId] || f.userId }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const followingUids = new Set(following.map((f) => f.userId));
  const followerOnlyEntries = Object.entries(followers)
    .filter(([uid]) => !followingUids.has(uid) && !currentMemberUids.has(uid) && uid !== inviterUid)
    .map(([uid, code]) => ({ uid, displayName: code }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const listEl = document.getElementById('invite-modal-picker-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  for (const entry of [...followingEntries, ...followerOnlyEntries]) {
    listEl.appendChild(buildRow(entry));
  }

  const sendBtn = document.getElementById('invite-modal-picker-send-btn');
  if (sendBtn) {
    // Remove any prior click handler to avoid double-binding across re-renders.
    const fresh = sendBtn.cloneNode(true);
    sendBtn.parentNode.replaceChild(fresh, sendBtn);
    fresh.addEventListener('click', () => sendSelected());
  }
  updateSendButton();
}

// The Invite button is disabled (and styled disabled) whenever nothing is
// selected — on first render, after deselecting the last row, and after a send
// clears the selection.
function updateSendButton() {
  const btn = document.getElementById('invite-modal-picker-send-btn');
  if (btn) btn.disabled = !_state || _state.selected.size === 0;
}

function buildRow({ uid, displayName }) {
  const li = document.createElement('li');
  li.className = 'invite-picker-row';
  li.dataset.uid = uid;

  const dot = document.createElement('span');
  dot.className = 'invite-picker-dot';
  li.appendChild(dot);

  const name = document.createElement('span');
  name.className = 'invite-picker-name';
  name.textContent = displayName;
  li.appendChild(name);

  const trailing = document.createElement('span');
  trailing.className = 'invite-picker-trailing';
  li.appendChild(trailing);

  refreshTrailing(li, uid);

  li.addEventListener('click', (e) => {
    // Pill click handles itself; don't double-toggle the row.
    if (e.target.closest('.invite-picker-pill-invited')) return;
    if (_state.pendingInviteeUids.has(uid)) return; // pending rows aren't selectable
    li.classList.toggle('selected');
    if (li.classList.contains('selected')) _state.selected.add(uid);
    else _state.selected.delete(uid);
    updateSendButton();
  });

  return li;
}

function refreshTrailing(li, uid) {
  const trailing = li.querySelector('.invite-picker-trailing');
  if (!trailing) return;
  trailing.innerHTML = '';
  if (_state.pendingInviteeUids.has(uid)) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'invite-picker-pill-invited';
    pill.textContent = 'Invited';
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      unInvite(uid, li);
    });
    trailing.appendChild(pill);
    li.classList.remove('selected');
  } else {
    const indicator = document.createElement('span');
    indicator.className = 'invite-picker-indicator';
    trailing.appendChild(indicator);
  }
}

async function sendSelected() {
  if (!_state) return;
  const uids = Array.from(_state.selected);
  if (uids.length === 0) return;
  await Promise.all(uids.map((uid) =>
    writePendingInvite(_state.inviterUid, uid, _state.groupId)
  ));
  // Flip selected rows to Invited; clear selection.
  for (const uid of uids) {
    _state.pendingInviteeUids.add(uid);
    _state.selected.delete(uid);
    const row = document.querySelector(`.invite-picker-row[data-uid="${uid}"]`);
    if (row) refreshTrailing(row, uid);
  }
  updateSendButton();
}

async function unInvite(uid, li) {
  if (!_state) return;
  await deletePendingInvite(uid, _state.groupId);
  _state.pendingInviteeUids.delete(uid);
  refreshTrailing(li, uid);
}
