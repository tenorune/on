// js/groupNav.js
// Navigation state machine: currentContext + group cards row.
// State is in-memory; writes mirror to Firebase via setCurrentContext / setLastVisited.

import { setCurrentContext, setLastVisited, watchUserGroups, watchGroupMeta } from './db.js';
import { GROUPS_ENABLED } from './features.js';

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
