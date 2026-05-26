// js/groupContext.js
// Group context view: breadcrumb, header, roster. Roster + settings populated
// in Tasks 16-17. This scaffolding handles enter/exit and the breadcrumb back.

import { watchGroupMeta } from './db.js';
import { navigateToDirect } from './groupNav.js';

let _metaUnsub = null;
let _currentGroupId = null;
let _currentUserId = null;

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
  _currentGroupId = null;
  _currentUserId = null;
  const root = document.getElementById('group-context-root');
  const direct = document.getElementById('main-ui-direct');
  if (root) root.classList.add('hidden');
  if (direct) direct.classList.remove('hidden');
}

export function getCurrentGroupId() { return _currentGroupId; }
