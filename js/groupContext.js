// js/groupContext.js
// Group context view: breadcrumb, header, roster. Roster + settings populated
// in Tasks 16-17. This scaffolding handles enter/exit and the breadcrumb back.

import { watchGroupMeta, watchGroupMembers, watchStatus } from './db.js';
import { safeCssColor } from './utils.js';
import { navigateToDirect } from './groupNav.js';

let _metaUnsub = null;
let _membersUnsub = null;
const _statusUnsubs = new Map(); // memberUid → unsubscribe fn
let _currentGroupId = null;
let _currentUserId = null;

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
    list.appendChild(li);
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

  // Subscribe to group members for the roster
  if (_membersUnsub) _membersUnsub();
  _statusUnsubs.forEach((fn) => fn());
  _statusUnsubs.clear();
  _membersUnsub = watchGroupMembers(groupId, (members) => {
    renderRoster(members, userId);
    syncStatusSubscriptions(new Set(Object.keys(members || {})));
  });

  // Subscribe to group meta for the name + owner check
  _metaUnsub = watchGroupMeta(groupId, (meta) => {
    if (!meta) return; // deletion handled in Task 18
    const nameEl = document.getElementById('group-context-name');
    const crumbEl = document.getElementById('group-breadcrumb-name');
    if (nameEl) nameEl.textContent = meta.name || '';
    if (crumbEl) crumbEl.textContent = meta.name || '';

    const settings = document.getElementById('group-context-settings-btn');
    if (settings) {
      if (meta.ownerId === _currentUserId) settings.classList.remove('hidden');
      else settings.classList.add('hidden');
    }
  });
}

export function exitGroupContext() {
  if (_metaUnsub) { _metaUnsub(); _metaUnsub = null; }
  if (_membersUnsub) { _membersUnsub(); _membersUnsub = null; }
  _statusUnsubs.forEach((fn) => fn());
  _statusUnsubs.clear();
  _currentGroupId = null;
  _currentUserId = null;
  const root = document.getElementById('group-context-root');
  const direct = document.getElementById('main-ui-direct');
  if (root) root.classList.add('hidden');
  if (direct) direct.classList.remove('hidden');
}

export function getCurrentGroupId() { return _currentGroupId; }
