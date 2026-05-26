// js/groupContext.js
// Group context view: breadcrumb, header, roster. Roster + settings populated
// in Tasks 16-17. This scaffolding handles enter/exit and the breadcrumb back.

import { watchGroupMeta, watchGroupMembers, watchGroupInvites, watchStatus, watchOwnMemberOverride, removeUserGroupsEntry, formatTimeRemaining, timeRemainingMs } from './db.js';
import { safeCssColor } from './utils.js';
import { navigateToDirect } from './groupNav.js';
import { renameGroup, deleteGroup, leaveGroup, editOwnDisplayName } from './groups.js';
import { openInviteModal } from './inviteModal.js';
import { buildInviteUrl } from './invites.js';
import { sendKnock, clearGroupCardBadge } from './knock.js';

let _metaUnsub = null;
let _membersUnsub = null;
let _invitesUnsub = null;
const _statusUnsubs = new Map(); // memberUid → unsubscribe fn
let _currentGroupId = null;
let _currentUserId = null;
let _activeGroupInvite = null;
let _ownPrimaryUnsub = null;
let _ownOverrideUnsub = null;
let _ownPrimary = null;  // { status, availableUntil, statusColor? } | null
let _ownOverride = null; // { enabled, status, availableUntil, statusColor?, paletteKey? } | null

function renderRoster(members, ownUserId) {
  const list = document.getElementById('group-roster');
  if (!list) return;
  list.innerHTML = '';

  const entries = Object.entries(members || {});
  entries.sort(([uidA, a], [uidB, b]) => {
    if (uidA === ownUserId) return -1;
    if (uidB === ownUserId) return 1;
    const nameA = (a.displayName || '').toLowerCase();
    const nameB = (b.displayName || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  for (const [uid, member] of entries) {
    const li = document.createElement('li');
    li.className = 'group-roster-row';
    li.dataset.userId = uid;
    li.dataset.available = 'false';

    const dot = document.createElement('span');
    dot.className = 'person-dot';
    dot.dataset.available = 'false';

    const label = document.createElement('span');
    label.className = 'person-label';
    label.textContent = member.displayName || uid;
    if (member.role === 'owner') {
      const badge = document.createElement('span');
      badge.className = 'role-badge';
      badge.textContent = ' (owner)';
      label.appendChild(badge);
    }

    li.appendChild(dot);
    li.appendChild(label);

    if (uid !== ownUserId) {
      const knockBtn = document.createElement('button');
      knockBtn.className = 'ghost-btn knock-btn';
      knockBtn.textContent = 'Knock';
      knockBtn.addEventListener('click', () => {
        sendKnock(uid, ownUserId, undefined, { contextGroupId: getCurrentGroupId() });
      });
      li.appendChild(knockBtn);
    }

    list.appendChild(li);
  }
}

function renderOwnStatusRow() {
  const dot = document.getElementById('group-my-dot');
  const label = document.getElementById('group-my-status-label');
  const timeRemaining = document.getElementById('group-time-remaining');
  const timeChip = document.getElementById('group-time-chip');
  const toggle = document.getElementById('group-override-toggle');
  if (!dot || !label || !toggle) return;

  const overrideOn = !!(_ownOverride && _ownOverride.enabled === true);
  toggle.setAttribute('aria-pressed', overrideOn ? 'true' : 'false');

  // Source of truth for the visible status: override when ON, else primary.
  const source = overrideOn ? _ownOverride : _ownPrimary;
  const status = source?.status || 'unavailable';
  const availableUntil = source?.availableUntil ?? null;
  const isAvailable = status === 'available' && (availableUntil == null || availableUntil > Date.now());

  dot.dataset.available = isAvailable ? 'true' : 'false';
  dot.classList.toggle('available', isAvailable);
  const color = source?.statusColor || null;
  if (isAvailable && color) dot.style.background = safeCssColor(color);
  else dot.style.background = '';
  label.textContent = isAvailable ? 'Available' : 'Unavailable';

  // Read-only mode applies the dot + chip dimming when override is OFF.
  dot.classList.toggle('readonly', !overrideOn);
  if (timeChip) timeChip.classList.toggle('readonly', !overrideOn);

  if (timeRemaining) {
    // null availableUntil means open-ended; no countdown to show
    if (isAvailable && availableUntil) {
      const formatted = formatTimeRemaining(timeRemainingMs(availableUntil));
      if (formatted) {
        timeRemaining.textContent = '· ' + formatted + ' left';
        timeRemaining.style.display = '';
      } else {
        timeRemaining.style.display = 'none';
      }
    } else {
      timeRemaining.style.display = 'none';
    }
  }
}

function syncStatusSubscriptions(memberUids) {
  for (const uid of Array.from(_statusUnsubs.keys())) {
    if (!memberUids.has(uid)) {
      _statusUnsubs.get(uid)();
      _statusUnsubs.delete(uid);
    }
  }
  for (const uid of memberUids) {
    if (!_statusUnsubs.has(uid)) {
      _statusUnsubs.set(uid, watchStatus(uid, (data) => {
        const li = document.querySelector(`#group-roster [data-user-id="${uid}"]`);
        if (!li) return;
        const available = data && data.status === 'available' && (data.availableUntil == null || data.availableUntil > Date.now());
        li.dataset.available = available ? 'true' : 'false';
        const dot = li.querySelector('.person-dot');
        if (dot) {
          dot.dataset.available = available ? 'true' : 'false';
          if (available && data.statusColor) dot.style.background = safeCssColor(data.statusColor);
          else dot.style.background = '';
        }
      }));
    }
  }
}

function wireActions(groupId, userId, isOwner, groupName) {
  const ids = ['group-action-rename', 'group-action-invite', 'group-action-delete', 'group-action-edit-name', 'group-action-leave'];

  // Clone-and-replace each button to drop any previous listeners
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
  }

  // Visibility
  document.getElementById('group-action-rename').classList.toggle('hidden', !isOwner);
  document.getElementById('group-action-invite').classList.toggle('hidden', !isOwner);
  document.getElementById('group-action-delete').classList.toggle('hidden', !isOwner);
  document.getElementById('group-action-edit-name').classList.remove('hidden');
  document.getElementById('group-action-leave').classList.toggle('hidden', isOwner);

  // Handlers
  document.getElementById('group-action-rename').addEventListener('click', async () => {
    const next = window.prompt('New group name', groupName || '');
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    try { await renameGroup(groupId, userId, trimmed); } catch (e) { window.alert(e.message); }
  });

  document.getElementById('group-action-invite').addEventListener('click', () => {
    openInviteModal({
      scope: 'group',
      userId,
      groupId,
      groupName: groupName || groupId,
      activeInvite: _activeGroupInvite,
    });
  });

  document.getElementById('group-action-delete').addEventListener('click', async () => {
    if (!window.confirm(`Delete '${groupName || 'this group'}'? This cannot be undone.`)) return;
    try {
      await deleteGroup(groupId, userId);
      await navigateToDirect();
    } catch (e) { window.alert(e.message); }
  });

  document.getElementById('group-action-edit-name').addEventListener('click', async () => {
    const next = window.prompt('Your name in this group', '');
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    try { await editOwnDisplayName(groupId, userId, trimmed); } catch (e) { window.alert(e.message); }
  });

  document.getElementById('group-action-leave').addEventListener('click', async () => {
    if (!window.confirm(`Leave '${groupName || 'this group'}'?`)) return;
    try {
      await leaveGroup(groupId, userId);
      await navigateToDirect();
    } catch (e) { window.alert(e.message); }
  });
}

export function enterGroupContext(groupId, userId) {
  if (_metaUnsub) _metaUnsub();
  _currentGroupId = groupId;
  _currentUserId = userId;

  const root = document.getElementById('group-context-root');
  const direct = document.getElementById('main-ui-direct');
  if (root) root.classList.remove('hidden');
  if (direct) direct.classList.add('hidden');

  // Wire the breadcrumb back button (replace via clone to drop any prior listener)
  const back = document.getElementById('group-breadcrumb-back');
  if (back) {
    const clone = back.cloneNode(true);
    back.parentNode.replaceChild(clone, back);
    clone.addEventListener('click', () => navigateToDirect());
  }

  // Clear any pending unread-knock badge for this group
  clearGroupCardBadge(groupId);

  // Subscribe to group members for the roster
  if (_membersUnsub) _membersUnsub();
  _statusUnsubs.forEach((fn) => fn());
  _statusUnsubs.clear();
  _membersUnsub = watchGroupMembers(groupId, (members) => {
    renderRoster(members, userId);
    syncStatusSubscriptions(new Set(Object.keys(members || {})));
  });

  // Subscribe to group invites so the owner-settings invite-link button can
  // open the modal in 'manage' state when an active invite already exists.
  if (_invitesUnsub) _invitesUnsub();
  _activeGroupInvite = null;
  _invitesUnsub = watchGroupInvites(groupId, (collection) => {
    let active = null;
    for (const [token, inv] of Object.entries(collection || {})) {
      if (inv && !inv.revoked) {
        active = { token, ...inv, url: buildInviteUrl(token) };
        break;
      }
    }
    _activeGroupInvite = active;
  });

  // Subscribe to own primary status and own override under this group.
  if (_ownPrimaryUnsub) _ownPrimaryUnsub();
  if (_ownOverrideUnsub) _ownOverrideUnsub();
  _ownPrimary = null;
  _ownOverride = null;
  _ownPrimaryUnsub = watchStatus(userId, (data) => {
    _ownPrimary = data
      ? { status: data.status, availableUntil: data.availableUntil ?? null, statusColor: data.statusColor || null }
      : null;
    renderOwnStatusRow();
  });
  _ownOverrideUnsub = watchOwnMemberOverride(groupId, userId, (data) => {
    _ownOverride = data || null;
    renderOwnStatusRow();
  });

  // Subscribe to group meta for the name + owner check
  _metaUnsub = watchGroupMeta(groupId, (meta) => {
    if (!meta) {
      // Group entity was deleted. Non-owner members never had their
      // users/{uid}/groups/{groupId} entry cleared by the owner (the
      // owner has no permission to write to other users' records).
      // Clear it locally; the watchUserGroups delta in groups.js then
      // surfaces the "deleted" toast and navigates back to Direct.
      removeUserGroupsEntry(userId, groupId).catch(() => {});
      return;
    }
    const nameEl = document.getElementById('group-context-name');
    const crumbEl = document.getElementById('group-breadcrumb-name');
    if (nameEl) nameEl.textContent = meta.name || '';
    if (crumbEl) crumbEl.textContent = meta.name || '';

    const isOwner = meta.ownerId === userId;
    wireActions(groupId, userId, isOwner, meta.name);
  });
}

export function exitGroupContext() {
  if (_metaUnsub) { _metaUnsub(); _metaUnsub = null; }
  if (_membersUnsub) { _membersUnsub(); _membersUnsub = null; }
  if (_invitesUnsub) { _invitesUnsub(); _invitesUnsub = null; }
  if (_ownPrimaryUnsub) { _ownPrimaryUnsub(); _ownPrimaryUnsub = null; }
  if (_ownOverrideUnsub) { _ownOverrideUnsub(); _ownOverrideUnsub = null; }
  _ownPrimary = null;
  _ownOverride = null;
  _statusUnsubs.forEach((fn) => fn());
  _statusUnsubs.clear();
  _currentGroupId = null;
  _currentUserId = null;
  _activeGroupInvite = null;
  const root = document.getElementById('group-context-root');
  const direct = document.getElementById('main-ui-direct');
  if (root) root.classList.add('hidden');
  if (direct) direct.classList.remove('hidden');
}

export function getCurrentGroupId() { return _currentGroupId; }
