// @ts-check
// js/groupNav.js
// Navigation state machine: currentContext + group cards row.
// State is in-memory; writes mirror to Firebase via setCurrentContext / setLastVisited.

import { setLastVisited, watchUserGroups, watchGroupMeta, watchOwnMemberOverride, removeUserGroupsEntry, isAvailable } from './db.js';
import { subscribeOwnStatus } from './ownStatus.js';
import { setCurrentContext } from './prefs.js';
import { safeCssColor, hexToRgb } from './utils.js';
import { GROUPS_ENABLED } from './features.js';
import { createGroup, toggleStatusOverride } from './groups.js';
import { applyOptimisticOverride } from './groupContext.js';
import { openInviteModal } from './inviteModal.js';
import { getCurrentFollowersMap, getCurrentMutuals } from './following.js';
import { getGroupBadgeCount, getDirectBadgeCount } from './knock.js';
import { renderInboxNavSlot } from './inbox.js';
import { reconcileChildren } from './reconcile.js';

/**
 * @typedef {{ context: string, groupId: string | null }} NavContext
 * @typedef {{ lastVisited?: number }} GroupEnumEntry
 * @typedef {{ name?: string }} GroupMeta
 * @typedef {{ enabled?: boolean | null, status?: string | null, availableUntil?: number | null, statusColor?: string | null, paletteKey?: string | null }} OverrideEntry
 * @typedef {{ status?: string | null, availableUntil?: number | null, statusColor?: string | null }} OwnPrimary
 */

// Set/clear the deferred-knock halo (a pulsing CSS class) to match the
// in-memory count from knock.js. Runs in every card paint, so a surviving
// card both gains the halo when a knock queues and loses it when the count
// drops to zero — and a context flip (full child replacement) re-applies it.
/**
 * @param {HTMLElement} card
 * @param {number} count
 */
function applyBadgeIfNonZero(card, count) {
  card.classList.toggle('knock-pending', count > 0);
}

/** @type {string | null} */
let _myUserId = null;
/** @type {NavContext} */
let _state = { context: 'direct', groupId: null };
/** @type {Set<(s: NavContext) => void>} */
const _listeners = new Set();

/**
 * @param {string | null | undefined} s
 * @returns {NavContext}
 */
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

/** @param {string} userId */
export function initNav(userId) {
  _myUserId = userId;
  _state = { context: 'direct', groupId: null };
  _listeners.clear();
}

export function getCurrentContext() {
  return { ..._state };
}

/** @param {(s: NavContext) => void} fn */
export function onContextChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export async function navigateToDirect() {
  if (_state.context === 'direct') return;
  _state = { context: 'direct', groupId: null };
  emit(); // render immediately before Firebase round-trip
  // setCurrentContext (prefs.js) writes both localStorage and
  // userPrefs/{uid}/currentContext.
  setCurrentContext('direct');
}

/** @param {string} groupId */
export async function navigateToGroup(groupId) {
  if (_state.context === 'group' && _state.groupId === groupId) return;
  _state = { context: 'group', groupId };
  emit(); // render immediately before Firebase round-trip
  setCurrentContext(`group:${groupId}`);
  await setLastVisited(/** @type {string} */ (_myUserId), groupId, Date.now());
}

/** @param {string | null | undefined} rawValue */
export function applyServerCurrentContext(rawValue) {
  const next = parseContextString(rawValue);
  if (next.context === _state.context && next.groupId === _state.groupId) return;
  _state = next;
  emit();
}

// ── Group cards row ──────────────────────────────────────────────────────────

/** @type {Record<string, GroupEnumEntry>} */
let _enumeration = {};
/** @type {Record<string, GroupMeta>} */
let _metaByGroupId = {};
// Names kept after meta clears, so a deletion toast can say "'Family' has been
// deleted" instead of "'1ASSKU46' has been deleted". Never cleared — the cost
// is one string per group the user has ever been in, negligible at Phase 1 scale.
/** @type {Record<string, string>} */
const _lastKnownNames = {};
/** @type {Record<string, () => void>} */
let _metaSubs = {};  // groupId → unsubscribe fn
/** @type {(() => void) | null} */
let _enumUnsub = null;
/** @type {OwnPrimary | null} */
let _ownPrimary = null;
/** @type {(() => void) | null} */
let _ownPrimaryUnsub = null;
/** @type {Record<string, OverrideEntry>} */
const _overrideByGroupId = {};
/** @type {Record<string, () => void>} */
const _overrideSubs = {}; // groupId → unsubscribe
// Provider surface (used by groupContext to avoid double-watching the active
// group). Consumers register per groupId; the underlying _metaSubs/_overrideSubs
// fan out to them. "Ticked" tracks whether the underlying sub has delivered ≥1
// value, so replay never hands a consumer a fabricated `null` (which reads as
// "group deleted").
/** @type {Record<string, Set<(meta: Record<string, unknown> | null) => void>>} */
const _metaConsumers = {};      // groupId → Set<cb>
/** @type {Record<string, Set<(override: StatusOverride | null) => void>>} */
const _overrideConsumers = {};  // groupId → Set<cb>
const _metaTicked = new Set();
const _overrideTicked = new Set();
/** @type {Record<string, StatusOverride | null>} */
const _overrideLastTick = {}; // groupId → last RAW value from watchOwnMemberOverride
                              // (incl. null); replay source, kept distinct from the
                              // optimistic-merged _overrideByGroupId nav-render cache.
/** @type {Set<() => void>} */
const _createListeners = new Set();
// When true, renderNavRow is a no-op and won't touch the row's .hidden class.
// Used by openCreateGroupModal's onSubmit to keep #nav-row hidden across the
// createGroup → seed → navigateToGroup transition, so the watchUserGroups tick
// fired by createGroup's writes can't unhide the row and flash the new card
// with its backend code as the name.
let _suspendRenderNavRow = false;

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
  _metaTicked.clear();
  _overrideTicked.clear();
  for (const k in _overrideLastTick) delete _overrideLastTick[k];
  // Consumer registries are cleared on a full reset (user switch / re-login) so
  // stale callbacks from the old session don't keep underlying subs alive or
  // receive ticks intended for a different user.
  for (const k in _metaConsumers) delete _metaConsumers[k];
  for (const k in _overrideConsumers) delete _overrideConsumers[k];
  _enumeration = {};
  _ownPrimary = null;

  if (_enumUnsub) _enumUnsub();
  _enumUnsub = watchUserGroups(/** @type {string} */ (_myUserId), (collection) => {
    _enumeration = /** @type {Record<string, GroupEnumEntry>} */ (collection || {});
    syncMetaSubs();
    renderNavRow();
  });
  if (_ownPrimaryUnsub) _ownPrimaryUnsub();
  _ownPrimaryUnsub = subscribeOwnStatus((data) => {
    _ownPrimary = data
      ? { status: data.status, availableUntil: data.availableUntil ?? null, statusColor: /** @type {{ statusColor?: string | null }} */ (data).statusColor || null }
      : null;
    renderNavRow();
  });
  // Re-render immediately to reflect the freshly cleared state (e.g. after
  // switching users or resetting subscriptions during tests).
  renderNavRow();
}

function metaWantIds() {
  return new Set([...Object.keys(_enumeration), ...Object.keys(_metaConsumers)]);
}
function overrideWantIds() {
  return new Set([...Object.keys(_enumeration), ...Object.keys(_overrideConsumers)]);
}

function syncMetaSubs() {
  const metaWant = metaWantIds();
  for (const groupId of Object.keys(_metaSubs)) {
    if (!metaWant.has(groupId)) {
      _metaSubs[groupId]();
      delete _metaSubs[groupId];
      delete _metaByGroupId[groupId];
      _metaTicked.delete(groupId);
    }
  }
  for (const groupId of metaWant) {
    if (!_metaSubs[groupId]) {
      _metaSubs[groupId] = watchGroupMeta(groupId, (meta) => {
        _metaTicked.add(groupId);
        if (meta) {
          _metaByGroupId[groupId] = /** @type {GroupMeta} */ (meta);
          if (meta.name) _lastKnownNames[groupId] = /** @type {string} */ (meta.name);
        } else {
          // Group entity deleted by its owner. Non-owner members never had
          // their users/{uid}/groups/{groupId} entry cleared by the owner
          // (the owner can't write to other users' records). Clear it
          // locally — the watchUserGroups delta then drops the card from
          // the nav and tears down our meta + override subs via
          // syncMetaSubs's cleanup loops.
          delete _metaByGroupId[groupId];
          if (_myUserId && _enumeration[groupId] !== undefined) {
            removeUserGroupsEntry(_myUserId, groupId).catch(() => {});
          }
        }
        renderNavRow();
        // Fan out AFTER groupNav's own reaction so consumer order matches the
        // historical attach order (groupNav before groupContext).
        const consumers = _metaConsumers[groupId];
        if (consumers) for (const cb of [...consumers]) { try { cb(meta); } catch { /* consumer threw */ } }
      });
    }
  }

  // Override-sub cleanup + setup (Phase 2)
  const overrideWant = overrideWantIds();
  for (const groupId of Object.keys(_overrideSubs)) {
    if (!overrideWant.has(groupId)) {
      _overrideSubs[groupId]();
      delete _overrideSubs[groupId];
      delete _overrideByGroupId[groupId];
      _overrideTicked.delete(groupId);
      delete _overrideLastTick[groupId];
    }
  }
  for (const groupId of overrideWant) {
    if (!_overrideSubs[groupId]) {
      _overrideSubs[groupId] = watchOwnMemberOverride(groupId, /** @type {string} */ (_myUserId), (override) => {
        _overrideTicked.add(groupId);
        _overrideLastTick[groupId] = override;
        if (override) _overrideByGroupId[groupId] = override;
        else delete _overrideByGroupId[groupId];
        renderNavRow();
        const consumers = _overrideConsumers[groupId];
        if (consumers) for (const cb of [...consumers]) { try { cb(override); } catch { /* consumer threw */ } }
      });
    }
  }
}

function renderNavRow() {
  const row = document.getElementById('nav-row');
  if (!row) return;
  if (_suspendRenderNavRow) return;
  if (!GROUPS_ENABLED) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');

  if (_state.context === 'group') {
    renderNavRowGroupMode(row);
  } else {
    renderNavRowDirectMode(row);
  }
}

// Optimistically merge appearance fields (statusColor / paletteKey) into the
// per-group override cache and re-render the nav row. Symmetric counterpart
// to applyOptimisticOverride (which goes groupNav → groupContext); this one
// lets groupContext push appearance changes back into groupNav before the
// Firebase ack so the Direct nav-row group-card border stays in sync.
/**
 * @param {string} groupId
 * @param {{ statusColor?: string | null, paletteKey?: string | null }} fields
 */
export function applyOptimisticAppearance(groupId, fields) {
  if (!groupId || !fields) return;
  const existing = _overrideByGroupId[groupId] || {};
  const next = { ...existing };
  if ('statusColor' in fields) next.statusColor = fields.statusColor;
  if ('paletteKey'  in fields) next.paletteKey  = fields.paletteKey;
  _overrideByGroupId[groupId] = next;
  renderNavRow();
}

/** @param {HTMLElement} row */
function renderNavRowDirectMode(row) {
  const sorted = Object.keys(_enumeration).slice().sort((a, b) => {
    const va = _enumeration[a]?.lastVisited ?? 0;
    const vb = _enumeration[b]?.lastVisited ?? 0;
    return vb - va;
  });
  // "Direct" is the implicit current context — no label needed in the nav.
  const keys = ['inbox-slot', ...sorted.map((g) => `group:${g}`), 'plus'];
  reconcileChildren(row, keys, {
    create: (key) => {
      if (key === 'inbox-slot') {
        // Phase 3 Inbox slot — first position. The button itself is created/
        // torn down by js/inbox.js; the slot guarantees the DOM anchor.
        const slot = document.createElement('div');
        slot.id = 'nav-row-inbox-slot';
        slot.className = 'nav-row-inbox-slot';
        return slot;
      }
      if (key === 'plus') {
        const plus = document.createElement('button');
        plus.className = 'group-cards-plus';
        plus.textContent = '+';
        plus.title = 'Create a new group';
        plus.addEventListener('click', () => emitCreateRequest());
        return plus;
      }
      const groupId = key.slice('group:'.length);
      const card = document.createElement('button');
      card.className = 'group-card';
      card.dataset.groupId = groupId;
      card.addEventListener('click', () => navigateToGroup(groupId));
      return card;
    },
    update: (node, key) => {
      if (key === 'inbox-slot') { renderInboxNavSlot(node); return; }
      if (key === 'plus') return;
      paintNavCard(node, key.slice('group:'.length));
    },
  });
}

// In-place paint for a Direct-mode group card. Persistent nodes mean every
// conditional must CLEAR as well as set (the old build-fresh code only added).
/**
 * @param {HTMLElement} card
 * @param {string} groupId
 */
function paintNavCard(card, groupId) {
  const meta = _metaByGroupId[groupId];
  card.textContent = meta?.name || groupId;
  // Effective-status indicator: when override is enabled the group's chip
  // reflects the override (independent), otherwise it mirrors Direct
  // (primary). No per-field mixing — override.statusColor is preserved
  // across toggling enabled off (for restore-on-re-enable), but reading
  // it while enabled=false would leak the group's last pick into the
  // chip after the user turned the override off.
  const ov = _overrideByGroupId[groupId];
  const overrideOn = !!(ov && ov.enabled === true);
  const source = overrideOn ? ov : _ownPrimary;
  const available = isAvailable(source?.status, source?.availableUntil);
  const effectiveColor = source?.statusColor || '#22c55e';
  card.classList.toggle('greyed', !available);
  card.style.borderColor = available ? safeCssColor(effectiveColor) : '';
  card.style.setProperty('--call-color-rgb', hexToRgb(effectiveColor));
  applyBadgeIfNonZero(card, getGroupBadgeCount(groupId));
}

/** @param {HTMLElement} row */
function renderNavRowGroupMode(row) {
  const groupId = /** @type {string} */ (_state.groupId);
  reconcileChildren(row, ['group-name', 'override-toggle', 'direct-card'], {
    create: (key) => {
      if (key === 'group-name') {
        const current = document.createElement('span');
        current.className = 'nav-current nav-current-truncate';
        current.style.flex = '1';
        current.style.minWidth = '0';
        return current;
      }
      if (key === 'override-toggle') {
        // Override toggle:  =  OFF (linked to primary)   ≠  ON (independent).
        const toggle = document.createElement('button');
        toggle.id = 'group-override-toggle';
        toggle.type = 'button';
        toggle.addEventListener('click', () => {
          // Persistent node: read LIVE state at click time, never the render-
          // time closure (the toggle outlives the render that painted it).
          const gid = /** @type {string} */ (_state.groupId);
          // Preserve any existing statusColor/paletteKey across the toggle so
          // the optimistic update matches what mergeStatusOverride leaves on
          // the server. Without the spread, _ownOverride briefly has no
          // statusColor and the user's group dot falls back to --my-status
          // until the watch echo restores the field.
          const existing = _overrideByGroupId[gid] || {};
          const nextEnabled = !(existing.enabled === true);
          const nextState = nextEnabled
            ? { ...existing, enabled: true, status: 'unavailable', availableUntil: null }
            : { ...existing, enabled: false, status: null, availableUntil: null };
          _overrideByGroupId[gid] = nextState;
          renderNavRow();
          applyOptimisticOverride(nextState);
          toggleStatusOverride(gid, /** @type {string} */ (_myUserId), nextEnabled).catch(() => {});
        });
        return toggle;
      }
      // "Direct" card on the far right, styled like a group card.
      const directCard = document.createElement('button');
      directCard.className = 'group-card';
      directCard.dataset.nav = 'direct';
      directCard.textContent = 'Direct';
      directCard.addEventListener('click', () => navigateToDirect());
      return directCard;
    },
    update: (node, key) => {
      if (key === 'group-name') {
        const meta = _metaByGroupId[groupId];
        node.textContent = meta?.name || _lastKnownNames[groupId] || groupId;
        return;
      }
      if (key === 'override-toggle') {
        const override = _overrideByGroupId[groupId];
        const overrideOn = !!(override && override.enabled === true);
        node.textContent = overrideOn ? '≠' : '=';
        node.setAttribute('aria-pressed', overrideOn ? 'true' : 'false');
        node.setAttribute('aria-label', overrideOn
          ? 'Stop using a unique status for this group'
          : 'Set a unique status for this group');
        return;
      }
      paintDirectCard(node);
    },
  });
}

// Border color reflects the user's primary status (the audience Direct
// represents). --call-color-rgb is set even when greyed so a queued knock
// pulses even on an unavailable Direct chip.
/** @param {HTMLElement} directCard */
function paintDirectCard(directCard) {
  const primaryAvailable = isAvailable(_ownPrimary?.status, _ownPrimary?.availableUntil);
  const directColor = _ownPrimary?.statusColor || '#22c55e';
  directCard.classList.toggle('greyed', !primaryAvailable);
  directCard.style.borderColor = primaryAvailable ? safeCssColor(directColor) : '';
  directCard.style.setProperty('--call-color-rgb', hexToRgb(directColor));
  applyBadgeIfNonZero(directCard, getDirectBadgeCount());
}

/** @param {() => void} fn */
export function onCreateRequested(fn) {
  _createListeners.add(fn);
  return () => _createListeners.delete(fn);
}

function emitCreateRequest() {
  _createListeners.forEach((fn) => { try { fn(); } catch { /* swallow */ } });
}

// ── Create group modal ───────────────────────────────────────────────────────

/** @type {Array<() => void>} */
const _createModalCleanup = [];

/** @param {string} msg */
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
  /** @type {HTMLElement} */ (document.getElementById('create-group-modal')).classList.add('hidden');
  _createModalCleanup.forEach((fn) => fn());
  _createModalCleanup.length = 0;
}

export function openCreateGroupModal() {
  const overlay = document.getElementById('create-group-modal');
  if (!overlay) return;
  // Guard against double-open: if the modal is already showing, don't re-wire
  // listeners (the cleanup array would accumulate stale handlers).
  if (!overlay.classList.contains('hidden')) return;
  const nameInput = /** @type {HTMLInputElement} */ (document.getElementById('create-group-name-input'));
  const dnInput = /** @type {HTMLInputElement} */ (document.getElementById('create-group-displayname-input'));
  const submit = /** @type {HTMLButtonElement} */ (document.getElementById('create-group-submit-btn'));
  const cancel = /** @type {HTMLButtonElement} */ (document.getElementById('create-group-cancel-btn'));

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
    // Hide #nav-row + #main-ui-direct synchronously so the watchUserGroups
    // tick triggered by createGroup's writes can't briefly flash the new
    // group card with its backend code as the name (renderNavRow's Direct
    // mode pulls from _metaByGroupId which is empty until watchGroupMeta
    // fires). Also keeps the optimistic-seed window below invisible.
    const navRowEl = document.getElementById('nav-row');
    const directEl = document.getElementById('main-ui-direct');
    if (navRowEl) navRowEl.classList.add('hidden');
    if (directEl) directEl.classList.add('hidden');
    // Suspend renderNavRow so the watchUserGroups callback fired during
    // createGroup's writes can't un-hide #nav-row mid-flight. We clear the
    // flag right before navigateToGroup's emit so the group-mode render
    // goes through.
    _suspendRenderNavRow = true;
    let result;
    try {
      result = await createGroup(/** @type {string} */ (_myUserId), name, dn);
    } catch (err) {
      showCreateError(/** @type {{ message?: string }} */ (err).message || 'Could not create group.');
      _suspendRenderNavRow = false;
      if (navRowEl) navRowEl.classList.remove('hidden');
      if (directEl) directEl.classList.remove('hidden');
      submit.disabled = false;
      return;
    }
    closeCreateModal();
    // Seed local caches with the values createGroup just wrote so the
    // first emit's renderNavRow paints the correct group name + override-
    // ON toggle without waiting for watchGroupMeta + watchOwnMemberOverride
    // ticks to round-trip. Same idea as the invite-redemption flow's
    // setLastKnownGroupName prime.
    _lastKnownNames[result.groupId] = name;
    _overrideByGroupId[result.groupId] = {
      enabled: true,
      status: 'unavailable',
      availableUntil: null,
    };
    // Re-enable renderNavRow so the next emit (inside navigateToGroup)
    // paints the group-mode nav with our seeded data.
    _suspendRenderNavRow = false;
    // navigateToGroup runs emit() synchronously (renderNavRow +
    // enterGroupContext); apply the optimistic override to repaint the
    // own-status row that enterGroupContext just reset, and open the invite
    // modal — all before the await yields, so the first paint shows the
    // group context + invite modal together with no intermediate states.
    const navPromise = navigateToGroup(result.groupId);
    applyOptimisticOverride({ enabled: true, status: 'unavailable', availableUntil: null });
    openInviteModal({
      scope: 'group',
      userId: /** @type {string} */ (_myUserId),
      groupId: result.groupId,
      groupName: name,
      // Without these the picker's "invite specific people" list renders empty
      // during the create flow (it only repopulated on a manual reopen via the
      // roster row). A brand-new group has just the creator as a member.
      followers: getCurrentFollowersMap(),
      mutuals: getCurrentMutuals(),
      currentMemberUids: new Set([/** @type {string} */ (_myUserId)]),
    });
    await navPromise;
    submit.disabled = false;
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
/** @param {string} groupId */
export function getLastKnownGroupName(groupId) {
  return _lastKnownNames[groupId] || null;
}

// Prime the lastKnownName cache before navigateToGroup runs. Used by the
// invite-redemption flow so the nav row shows the group name immediately
// instead of briefly flashing the random groupId while watchGroupMeta is
// still in-flight.
/**
 * @param {string} groupId
 * @param {string} name
 */
export function setLastKnownGroupName(groupId, name) {
  if (groupId && name) _lastKnownNames[groupId] = name;
}

// Read-only subscription to a group's meta, backed by groupNav's existing
// per-group watchGroupMeta. groupContext uses this instead of opening its own
// watch on the active group. Replays the cached meta only after the underlying
// sub has ticked (never a fabricated null). The union rule in syncMetaSubs
// keeps the underlying sub alive while this consumer is registered, even if the
// group isn't enumerated yet (deep-link boot race).
/**
 * @param {string} groupId
 * @param {(meta: Record<string, unknown> | null) => void} cb
 */
export function subscribeGroupMeta(groupId, cb) {
  if (!_metaConsumers[groupId]) _metaConsumers[groupId] = new Set();
  _metaConsumers[groupId].add(cb);
  syncMetaSubs();
  if (_metaTicked.has(groupId)) {
    try { cb(_metaByGroupId[groupId] ?? null); } catch { /* replay threw */ }
  }
  return () => {
    const set = _metaConsumers[groupId];
    if (set) { set.delete(cb); if (set.size === 0) delete _metaConsumers[groupId]; }
    syncMetaSubs();
  };
}

// Read-only subscription to the own member statusOverride for a group, backed
// by groupNav's existing watchOwnMemberOverride. groupContext uses this for the
// active group. (uid is groupNav's own _myUserId — consumers don't pass it.)
/**
 * @param {string} groupId
 * @param {(override: StatusOverride | null) => void} cb
 */
export function subscribeOwnOverride(groupId, cb) {
  if (!_overrideConsumers[groupId]) _overrideConsumers[groupId] = new Set();
  _overrideConsumers[groupId].add(cb);
  syncMetaSubs();
  if (_overrideTicked.has(groupId)) {
    try { cb(_overrideLastTick[groupId] ?? null); } catch { /* replay threw */ }
  }
  return () => {
    const set = _overrideConsumers[groupId];
    if (set) { set.delete(cb); if (set.size === 0) delete _overrideConsumers[groupId]; }
    syncMetaSubs();
  };
}
