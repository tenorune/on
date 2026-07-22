// js/invitePicker.js
// Phase 3 in-app invite picker. Lives inside the unified invite modal's
// Section 2 for group-scope invites.
//
// Responsibilities:
//   - Render the merged list (mutuals first, then non-mutual followers)
//   - Filter out current group members and the inviter themself
//   - Show "Invited" pill on rows with a pending invite
//   - Multi-select state for unselected rows
//   - Invite button → writePendingInvite for each selected; flip rows to Invited
//   - Tap "Invited" pill → deletePendingInvite; flip row back to selectable
//
// Data is injected (followers map, mutuals list, current member set, pending
// invitee set) rather than fetched inside this module so callers can shape
// the data freely and tests don't need to mock subscriptions.

import { writePendingInvite, deletePendingInvite } from './db.js';

interface Mutual { userId: string; label?: string }
interface PickerState {
  inviterUid: string;
  groupId: string;
  selected: Set<string>;
  pendingInviteeUids: Set<string>;
}

let _state: PickerState | null = null;

// Mirrors the eligibility rule used by renderInvitePicker's row builders below
// (mutualEntries + nonMutualEntries filters) so the two can never disagree:
// a follower is displayable when they aren't already a group member and
// aren't the inviter themself.
export function hasDisplayableInvitees({ followers, mutuals, currentMemberUids, inviterUid }: { followers: Record<string, string>; mutuals: Mutual[]; currentMemberUids: Set<string>; inviterUid: string }) {
  const mutualLookup = new Map(mutuals.map((m): [string, string | undefined] => [m.userId, m.label]));
  const mutualHit = mutuals.some(
    (m) => followers[m.userId] && !currentMemberUids.has(m.userId) && m.userId !== inviterUid,
  );
  const nonMutualHit = Object.keys(followers).some(
    (uid) => !mutualLookup.has(uid) && !currentMemberUids.has(uid) && uid !== inviterUid,
  );
  return mutualHit || nonMutualHit;
}

export function renderInvitePicker({
  inviterUid, groupId, followers, mutuals, currentMemberUids, pendingInviteeUids,
}: { inviterUid: string; groupId: string; followers: Record<string, string>; mutuals: Mutual[]; currentMemberUids: Set<string>; pendingInviteeUids?: Iterable<string> | null }) {
  _state = {
    inviterUid, groupId,
    selected: new Set<string>(),
    pendingInviteeUids: new Set(pendingInviteeUids || []),
  };

  // Build the rendered list of { uid, displayName }, mutuals first.
  const mutualLookup = new Map(mutuals.map((m): [string, string | undefined] => [m.userId, m.label]));
  const mutualEntries = mutuals
    .filter((m) => followers[m.userId] && !currentMemberUids.has(m.userId) && m.userId !== inviterUid)
    // A mutual with no custom label falls back to their share code (the value in
    // the followers map, which the filter above guarantees is present) so the
    // row is never blank.
    .map((m) => ({ uid: m.userId, displayName: m.label || followers[m.userId] }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const nonMutualEntries = Object.entries(followers)
    .filter(([uid]) => !mutualLookup.has(uid) && !currentMemberUids.has(uid) && uid !== inviterUid)
    .map(([uid, code]) => ({ uid, displayName: code }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const listEl = document.getElementById('invite-modal-picker-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  for (const entry of [...mutualEntries, ...nonMutualEntries]) {
    listEl.appendChild(buildRow(entry));
  }

  const sendBtn = document.getElementById('invite-modal-picker-send-btn');
  if (sendBtn) {
    // Remove any prior click handler to avoid double-binding across re-renders.
    const fresh = sendBtn.cloneNode(true);
    (sendBtn.parentNode as Node).replaceChild(fresh, sendBtn);
    fresh.addEventListener('click', () => sendSelected());
  }
  updateSendButton();
}

// The Invite button is disabled (and styled disabled) whenever nothing is
// selected — on first render, after deselecting the last row, and after a send
// clears the selection.
function updateSendButton() {
  const btn = document.getElementById('invite-modal-picker-send-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = !_state || _state.selected.size === 0;
}

function buildRow({ uid, displayName }: { uid: string; displayName: string }) {
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
    if ((e.target as Element).closest('.invite-picker-pill-invited')) return;
    if (_state!.pendingInviteeUids.has(uid)) return; // pending rows aren't selectable
    li.classList.toggle('selected');
    if (li.classList.contains('selected')) _state!.selected.add(uid);
    else _state!.selected.delete(uid);
    updateSendButton();
  });

  return li;
}

function refreshTrailing(li: HTMLElement, uid: string) {
  const trailing = li.querySelector('.invite-picker-trailing');
  if (!trailing) return;
  trailing.innerHTML = '';
  if (_state!.pendingInviteeUids.has(uid)) {
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
  const state = _state;
  const uids = Array.from(state.selected);
  if (uids.length === 0) return;
  await Promise.all(uids.map((uid) =>
    writePendingInvite(state.inviterUid, uid, state.groupId)
  ));
  // Flip selected rows to Invited; clear selection.
  for (const uid of uids) {
    state.pendingInviteeUids.add(uid);
    state.selected.delete(uid);
    const row = document.querySelector<HTMLElement>(`.invite-picker-row[data-uid="${uid}"]`);
    if (row) refreshTrailing(row, uid);
  }
  updateSendButton();
}

async function unInvite(uid: string, li: HTMLElement) {
  if (!_state) return;
  await deletePendingInvite(uid, _state.groupId);
  _state.pendingInviteeUids.delete(uid);
  refreshTrailing(li, uid);
}
