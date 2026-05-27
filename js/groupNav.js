// js/groupNav.js
// Navigation state machine: currentContext + group cards row.
// State is in-memory; writes mirror to Firebase via setCurrentContext / setLastVisited.

import { setCurrentContext, setLastVisited, watchUserGroups, watchGroupMeta, watchOwnMemberOverride, watchStatus } from './db.js';
import { safeCssColor } from './utils.js';
import { GROUPS_ENABLED } from './features.js';
import { createGroup, toggleStatusOverride } from './groups.js';
import { applyOptimisticOverride } from './groupContext.js';

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
  emit(); // render immediately before Firebase round-trip
  await setCurrentContext(_myUserId, 'direct');
}

export async function navigateToGroup(groupId) {
  if (_state.context === 'group' && _state.groupId === groupId) return;
  _state = { context: 'group', groupId };
  emit(); // render immediately before Firebase round-trip
  await setCurrentContext(_myUserId, `group:${groupId}`);
  await setLastVisited(_myUserId, groupId, Date.now());
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
// Names kept after meta clears, so a deletion toast can say "'Family' has been
// deleted" instead of "'1ASSKU46' has been deleted". Never cleared — the cost
// is one string per group the user has ever been in, negligible at Phase 1 scale.
const _lastKnownNames = {};
let _metaSubs = {};  // groupId → unsubscribe fn
let _enumUnsub = null;
let _ownPrimary = null;
let _ownPrimaryUnsub = null;
const _overrideByGroupId = {};
const _overrideSubs = {}; // groupId → unsubscribe
const _createListeners = new Set();

export function initNavRow() {
  const row = document.getElementById('nav-row');
  if (!row) return;
  if (!GROUPS_ENABLED) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');
  renderNavRow();
  // Re-render whenever the active context changes.
  onContextChange(() => renderNavRow());
}

export function startCardsRowSubscriptions() {
  if (!_myUserId || !GROUPS_ENABLED) return;

  // Tear down any existing per-group subscriptions before re-subscribing.
  for (const groupId of Object.keys(_metaSubs)) { _metaSubs[groupId](); }
  for (const k in _metaSubs) delete _metaSubs[k];
  for (const k in _metaByGroupId) delete _metaByGroupId[k];
  for (const groupId of Object.keys(_overrideSubs)) { _overrideSubs[groupId](); }
  for (const k in _overrideSubs) delete _overrideSubs[k];
  for (const k in _overrideByGroupId) delete _overrideByGroupId[k];
  _enumeration = {};
  _ownPrimary = null;

  if (_enumUnsub) _enumUnsub();
  _enumUnsub = watchUserGroups(_myUserId, (collection) => {
    _enumeration = collection || {};
    syncMetaSubs();
    renderNavRow();
  });
  if (_ownPrimaryUnsub) _ownPrimaryUnsub();
  _ownPrimaryUnsub = watchStatus(_myUserId, (data) => {
    _ownPrimary = data
      ? { status: data.status, availableUntil: data.availableUntil ?? null, statusColor: data.statusColor || null }
      : null;
    renderNavRow();
  });
  // Re-render immediately to reflect the freshly cleared state (e.g. after
  // switching users or resetting subscriptions during tests).
  renderNavRow();
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
        if (meta) {
          _metaByGroupId[groupId] = meta;
          if (meta.name) _lastKnownNames[groupId] = meta.name;
        } else {
          delete _metaByGroupId[groupId];
        }
        renderNavRow();
      });
    }
  }

  // Override-sub cleanup + setup (Phase 2)
  for (const groupId of Object.keys(_overrideSubs)) {
    if (!wantIds.has(groupId)) {
      _overrideSubs[groupId]();
      delete _overrideSubs[groupId];
      delete _overrideByGroupId[groupId];
    }
  }
  for (const groupId of wantIds) {
    if (!_overrideSubs[groupId]) {
      _overrideSubs[groupId] = watchOwnMemberOverride(groupId, _myUserId, (override) => {
        if (override) _overrideByGroupId[groupId] = override;
        else delete _overrideByGroupId[groupId];
        renderNavRow();
      });
    }
  }
}

function renderNavRow() {
  const row = document.getElementById('nav-row');
  if (!row) return;
  if (!GROUPS_ENABLED) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');
  row.innerHTML = '';

  if (_state.context === 'group') {
    renderNavRowGroupMode(row);
  } else {
    renderNavRowDirectMode(row);
  }
}

function renderNavRowDirectMode(row) {
  // "Direct" is the implicit current context — no label needed in the nav.
  // The groups + create-group button stand in for navigation; tapping a card
  // moves to that group, the persistent nav itself signals where you are.

  const groupIds = Object.keys(_enumeration);
  const sorted = groupIds.slice().sort((a, b) => {
    const va = _enumeration[a]?.lastVisited ?? 0;
    const vb = _enumeration[b]?.lastVisited ?? 0;
    return vb - va;
  });

  for (const groupId of sorted) {
    const meta = _metaByGroupId[groupId];
    const name = meta?.name || groupId;
    const card = document.createElement('button');
    card.className = 'group-card';
    card.dataset.groupId = groupId;
    card.textContent = name;

    // Effective-status indicator: prefer override (when enabled), else primary.
    const ov = _overrideByGroupId[groupId];
    const overrideOn = !!(ov && ov.enabled === true);
    const source = overrideOn ? ov : _ownPrimary;
    const isAvailable = source?.status === 'available'
      && (source.availableUntil == null || source.availableUntil > Date.now());
    if (isAvailable) {
      const color = ov?.statusColor || _ownPrimary?.statusColor || '#22c55e';
      card.style.borderColor = safeCssColor(color);
    } else {
      card.classList.add('greyed');
    }

    card.addEventListener('click', () => navigateToGroup(groupId));
    row.appendChild(card);
  }

  const plus = document.createElement('button');
  plus.className = 'group-cards-plus';
  plus.textContent = '+';
  plus.title = 'Create a new group';
  plus.addEventListener('click', () => emitCreateRequest());
  row.appendChild(plus);
}

function renderNavRowGroupMode(row) {
  const groupId = _state.groupId;
  const meta = _metaByGroupId[groupId];
  const name = meta?.name || _lastKnownNames[groupId] || groupId;
  const override = _overrideByGroupId[groupId];
  const overrideOn = !!(override && override.enabled === true);

  const back = document.createElement('button');
  back.className = 'nav-back';
  back.textContent = 'Direct';
  back.addEventListener('click', () => navigateToDirect());
  row.appendChild(back);

  // Chain-icon equivalent override toggle, rendered inline. Inverted semantics:
  // ○ (open circle) = override OFF (user linked to primary). ⊘ (circle-slash) =
  // override ON (user has a unique status here). Unicode text — guaranteed to
  // render in any system font.
  const toggle = document.createElement('button');
  toggle.id = 'group-override-toggle';
  toggle.type = 'button';
  toggle.textContent = overrideOn ? '⊘' : '○';
  toggle.setAttribute('aria-pressed', overrideOn ? 'true' : 'false');
  toggle.setAttribute('aria-label', overrideOn
    ? 'Stop using a unique status for this group'
    : 'Set a unique status for this group');
  toggle.addEventListener('click', () => {
    const nextEnabled = !overrideOn;
    // Optimistic local update so the click feels instant and a follow-up tap
    // on the in-context dot/chip isn't gated by Firebase ack (bb4107d pattern).
    const nextState = nextEnabled
      ? { enabled: true, status: 'unavailable', availableUntil: null }
      : null;
    _overrideByGroupId[groupId] = nextState;
    renderNavRow();
    // Push the same optimistic update into groupContext so its dot/chip
    // handlers see the new state immediately (otherwise they read a stale
    // _ownOverride and silently no-op until Firebase round-trips back).
    applyOptimisticOverride(nextState);
    toggleStatusOverride(groupId, _myUserId, nextEnabled).catch(() => {});
  });
  row.appendChild(toggle);

  const current = document.createElement('span');
  current.className = 'nav-current nav-current-truncate';
  current.textContent = name;
  row.appendChild(current);
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

// Returns the most recent name we observed for a group, or null. Used by the
// removal-toast in groups.js so the message can read "'Family' has been deleted"
// instead of falling back to the opaque group id.
export function getLastKnownGroupName(groupId) {
  return _lastKnownNames[groupId] || null;
}
