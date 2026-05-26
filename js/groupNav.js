// js/groupNav.js
// Navigation state machine: currentContext + group cards row.
// State is in-memory; writes mirror to Firebase via setCurrentContext / setLastVisited.

import { setCurrentContext, setLastVisited, watchUserGroups, watchGroupMeta } from './db.js';
import { GROUPS_ENABLED } from './features.js';
import { createGroup } from './groups.js';

let _myUserId = null;
let _state = { context: 'direct', groupId: null };
const _listeners = new Set();

function parseContextString(s) {
  if (s === 'direct' || !s) return { context: 'direct', groupId: null };
  const m = typeof s === 'string' ? s.match(/^group:(.+)$/) : null;
  if (m) return { context: 'group', groupId: m[1] };
  return { context: 'direct', groupId: null };
}

function emit() {
  const snapshot = { ..._state };
  _listeners.forEach((fn) => { try { fn(snapshot); } catch { /* swallow */ } });
}

export function initNav(userId) {
  _myUserId = userId;
  _state = { context: 'direct', groupId: null };
  _listeners.clear();
}

export function getCurrentContext() {
  return { ..._state };
}

export function onContextChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export async function navigateToDirect() {
  if (_state.context === 'direct') return;
  _state = { context: 'direct', groupId: null };
  await setCurrentContext(_myUserId, 'direct');
  emit();
}

export async function navigateToGroup(groupId) {
  if (_state.context === 'group' && _state.groupId === groupId) return;
  _state = { context: 'group', groupId };
  await setCurrentContext(_myUserId, `group:${groupId}`);
  await setLastVisited(_myUserId, groupId, Date.now());
  emit();
}

export function applyServerCurrentContext(rawValue) {
  const next = parseContextString(rawValue);
  if (next.context === _state.context && next.groupId === _state.groupId) return;
  _state = next;
  emit();
}

// ── Group cards row ──────────────────────────────────────────────────────────

let _enumeration = {};
let _metaByGroupId = {};
let _metaSubs = {};  // groupId → unsubscribe fn
let _enumUnsub = null;
const _createListeners = new Set();

export function initCardsRow() {
  const row = document.getElementById('group-cards-row');
  if (!row) return;
  if (!GROUPS_ENABLED) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');
  renderCardsRow(_enumeration, _metaByGroupId);
}

export function startCardsRowSubscriptions() {
  if (!_myUserId || !GROUPS_ENABLED) return;
  if (_enumUnsub) _enumUnsub();
  _enumUnsub = watchUserGroups(_myUserId, (collection) => {
    _enumeration = collection || {};
    syncMetaSubs();
    renderCardsRow(_enumeration, _metaByGroupId);
  });
}

function syncMetaSubs() {
  const wantIds = new Set(Object.keys(_enumeration));
  for (const groupId of Object.keys(_metaSubs)) {
    if (!wantIds.has(groupId)) {
      _metaSubs[groupId]();
      delete _metaSubs[groupId];
      delete _metaByGroupId[groupId];
    }
  }
  for (const groupId of wantIds) {
    if (!_metaSubs[groupId]) {
      _metaSubs[groupId] = watchGroupMeta(groupId, (meta) => {
        if (meta) _metaByGroupId[groupId] = meta;
        else delete _metaByGroupId[groupId];
        renderCardsRow(_enumeration, _metaByGroupId);
      });
    }
  }
}

export function renderCardsRow(enumeration, metaByGroupId) {
  const row = document.getElementById('group-cards-row');
  if (!row) return;
  row.classList.remove('hidden');
  row.innerHTML = '';

  const groupIds = Object.keys(enumeration);

  if (groupIds.length === 0) {
    const cta = document.createElement('button');
    cta.id = 'group-cards-zero';
    cta.className = 'group-cards-zero';
    cta.textContent = 'Create your first group';
    cta.addEventListener('click', () => emitCreateRequest());
    row.appendChild(cta);
    return;
  }

  const sorted = groupIds.slice().sort((a, b) => {
    const va = enumeration[a]?.lastVisited ?? 0;
    const vb = enumeration[b]?.lastVisited ?? 0;
    return vb - va;
  });

  for (const groupId of sorted) {
    const meta = metaByGroupId[groupId];
    const name = meta?.name || groupId;
    const card = document.createElement('button');
    card.className = 'group-card';
    card.dataset.groupId = groupId;
    card.textContent = name;
    if (_state.context === 'group' && _state.groupId === groupId) {
      card.classList.add('active');
    }
    card.addEventListener('click', () => navigateToGroup(groupId));
    row.appendChild(card);
  }

  const plus = document.createElement('button');
  plus.id = 'group-cards-plus';
  plus.className = 'group-cards-plus';
  plus.textContent = '+';
  plus.title = 'Create a new group';
  plus.addEventListener('click', () => emitCreateRequest());
  row.appendChild(plus);
}

export function onCreateRequested(fn) {
  _createListeners.add(fn);
  return () => _createListeners.delete(fn);
}

function emitCreateRequest() {
  _createListeners.forEach((fn) => { try { fn(); } catch { /* swallow */ } });
}

// ── Create group modal ───────────────────────────────────────────────────────

const _createModalCleanup = [];

function showCreateError(msg) {
  const el = document.getElementById('create-group-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideCreateError() {
  const el = document.getElementById('create-group-error');
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

function closeCreateModal() {
  document.getElementById('create-group-modal').classList.add('hidden');
  _createModalCleanup.forEach((fn) => fn());
  _createModalCleanup.length = 0;
}

export function openCreateGroupModal() {
  const overlay = document.getElementById('create-group-modal');
  if (!overlay) return;
  // Guard against double-open: if the modal is already showing, don't re-wire
  // listeners (the cleanup array would accumulate stale handlers).
  if (!overlay.classList.contains('hidden')) return;
  const nameInput = document.getElementById('create-group-name-input');
  const dnInput = document.getElementById('create-group-displayname-input');
  const submit = document.getElementById('create-group-submit-btn');
  const cancel = document.getElementById('create-group-cancel-btn');

  nameInput.value = '';
  dnInput.value = '';
  hideCreateError();
  overlay.classList.remove('hidden');
  if (nameInput.focus) nameInput.focus();

  const onSubmit = async () => {
    const name = (nameInput.value || '').trim();
    const dn = (dnInput.value || '').trim();
    if (!name || !dn) { showCreateError('Both fields are required.'); return; }
    submit.disabled = true;
    try {
      const result = await createGroup(_myUserId, name, dn);
      closeCreateModal();
      await navigateToGroup(result.groupId);
    } catch (err) {
      showCreateError(err.message || 'Could not create group.');
    } finally {
      submit.disabled = false;
    }
  };
  const onCancel = () => closeCreateModal();

  submit.addEventListener('click', onSubmit);
  cancel.addEventListener('click', onCancel);
  _createModalCleanup.push(() => submit.removeEventListener('click', onSubmit));
  _createModalCleanup.push(() => cancel.removeEventListener('click', onCancel));
}

// Wire the create-requested event from the cards row to this modal.
onCreateRequested(openCreateGroupModal);
