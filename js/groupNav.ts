// js/groupNav.ts
// Navigation state machine: currentContext + group cards row.
// State is in-memory; writes mirror to Firebase via setCurrentContext / setLastVisited.

import { setLastVisited, watchUserGroups, watchGroupMeta, removeUserGroupsEntry, isAvailable } from './db.js';
import { effectiveStatus } from './status.js';
import { subscribeOwnStatus } from './ownStatus.js';
import { setCurrentContext } from './prefs.js';
import { safeCssColor, hexToRgb } from './utils.js';
import { GROUPS_ENABLED } from './features.js';
import { createGroup, toggleStatusOverride } from './groups.js';
import { setWatchedGroups, subscribeOwnOverride as storeSubscribeOwnOverride, getOwnOverride, pushOptimistic } from './statusStore.js';
import { openInviteModal } from './inviteModal.js';
import { getCurrentFollowersMap, getCurrentMutuals } from './following.js';
import { getGroupBadgeCount, getDirectBadgeCount } from './knock.js';
import { renderInboxNavSlot } from './inbox.js';
import { reconcileChildren } from './reconcile.js';

type NavContext = { context: string; groupId: string | null };
type GroupEnumEntry = { lastVisited?: number };
type GroupMeta = { name?: string };
type OverrideEntry = { enabled?: boolean | null; status?: string | null; availableUntil?: number | null; statusColor?: string | null; paletteKey?: string | null };
type OwnPrimary = { status?: string | null; availableUntil?: number | null; statusColor?: string | null };

// Set/clear the deferred-knock halo (a pulsing CSS class) to match the
// in-memory count from knock.js. Runs in every card paint, so a surviving
// card both gains the halo when a knock queues and loses it when the count
// drops to zero — and a context flip (full child replacement) re-applies it.
function applyBadgeIfNonZero(card: HTMLElement, count: number) {
  card.classList.toggle('knock-pending', count > 0);
}

let _myUserId: string | null = null;
let _state: NavContext = { context: 'direct', groupId: null };
const _listeners = new Set<(s: NavContext) => void>();

function parseContextString(s: string | null | undefined): NavContext {
  if (s === 'direct' || !s) return { context: 'direct', groupId: null };
  const m = typeof s === 'string' ? s.match(/^group:(.+)$/) : null;
  if (m) return { context: 'group', groupId: m[1] };
  return { context: 'direct', groupId: null };
}

function emit() {
  const snapshot = { ..._state };
  _listeners.forEach((fn) => { try { fn(snapshot); } catch { /* swallow */ } });
}

export function initNav(userId: string) {
  _myUserId = userId;
  _state = { context: 'direct', groupId: null };
  _listeners.clear();
}

export function getCurrentContext() {
  return { ..._state };
}

export function onContextChange(fn: (s: NavContext) => void) {
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

export async function navigateToGroup(groupId: string) {
  if (_state.context === 'group' && _state.groupId === groupId) return;
  _state = { context: 'group', groupId };
  emit(); // render immediately before Firebase round-trip
  setCurrentContext(`group:${groupId}`);
  setLastVisited(_myUserId as string, groupId, Date.now()).catch(() => {});
}

export function applyServerCurrentContext(rawValue: string | null | undefined) {
  const next = parseContextString(rawValue);
  if (next.context === _state.context && next.groupId === _state.groupId) return;
  _state = next;
  emit();
}

// ── Group cards row ──────────────────────────────────────────────────────────

let _enumeration: Record<string, GroupEnumEntry> = {};
let _metaByGroupId: Record<string, GroupMeta> = {};
// Names kept after meta clears, so a deletion toast can say "'Family' has been
// deleted" instead of "'1ASSKU46' has been deleted". Never cleared — the cost
// is one string per group the user has ever been in, negligible at Phase 1 scale.
const _lastKnownNames: Record<string, string> = {};
let _metaSubs: Record<string, () => void> = {};  // groupId → unsubscribe fn
let _enumUnsub: (() => void) | null = null;
let _ownPrimary: OwnPrimary | null = null;
let _ownPrimaryUnsub: (() => void) | null = null;
const _overrideByGroupId: Record<string, OverrideEntry> = {};
// One statusStore subscription per enumerated group, mirroring the store's raw
// override into _overrideByGroupId (the paint cache). The store now owns the
// underlying watchOwnMemberOverride subs; groupNav just repaints on fan-out.
const _overrideStoreUnsubs: Record<string, () => void> = {}; // groupId → unsubscribe
// Provider surface for group META (used by groupContext to avoid double-watching
// the active group). Consumers register per groupId; the underlying _metaSubs fan
// out to them. "Ticked" tracks whether the underlying sub has delivered ≥1 value,
// so replay never hands a consumer a fabricated `null` (which reads as "group
// deleted"). The own-override provider moved to statusStore.
const _metaConsumers: Record<string, Set<(meta: Record<string, unknown> | null) => void>> = {};      // groupId → Set<cb>
const _metaTicked = new Set<string>();
// One-shot groups-ready signal for the post-restore splash gating: fires once
// the group set is known (first watchUserGroups tick) AND every enumerated
// group has a meta tick (so the nav row renders real names, not groupIds).
let onGroupsReady: (() => void) | null = null;
let _enumTicked = false;
const _createListeners = new Set<() => void>();
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

export function setGroupsReadyCallback(fn: () => void) {
  onGroupsReady = fn;
}

function maybeSignalGroupsReady() {
  if (!onGroupsReady || !_enumTicked) return;
  for (const groupId of Object.keys(_enumeration)) {
    if (!_metaTicked.has(groupId)) return;
  }
  const cb = onGroupsReady;
  onGroupsReady = null;
  cb();
}

export function startCardsRowSubscriptions() {
  if (!_myUserId || !GROUPS_ENABLED) {
    // Nothing will ever enumerate — don't leave the splash gating waiting.
    const cb = onGroupsReady;
    onGroupsReady = null;
    cb?.();
    return;
  }

  // Tear down any existing per-group subscriptions before re-subscribing.
  for (const groupId of Object.keys(_metaSubs)) { _metaSubs[groupId](); }
  for (const k in _metaSubs) delete _metaSubs[k];
  for (const k in _metaByGroupId) delete _metaByGroupId[k];
  for (const groupId of Object.keys(_overrideStoreUnsubs)) { _overrideStoreUnsubs[groupId](); }
  for (const k in _overrideStoreUnsubs) delete _overrideStoreUnsubs[k];
  for (const k in _overrideByGroupId) delete _overrideByGroupId[k];
  _metaTicked.clear();
  _enumTicked = false;
  // Consumer registries are cleared on a full reset (user switch / re-login) so
  // stale callbacks from the old session don't keep underlying subs alive or
  // receive ticks intended for a different user.
  for (const k in _metaConsumers) delete _metaConsumers[k];
  _enumeration = {};
  _ownPrimary = null;

  if (_enumUnsub) _enumUnsub();
  _enumUnsub = watchUserGroups(_myUserId as string, (collection) => {
    _enumeration = (collection || {}) as Record<string, GroupEnumEntry>;
    _enumTicked = true;
    syncMetaSubs();
    setWatchedGroups(Object.keys(_enumeration));
    syncOverrideConsumers();
    renderNavRow();
    maybeSignalGroupsReady(); // an empty enumeration is ready immediately
  });
  if (_ownPrimaryUnsub) _ownPrimaryUnsub();
  _ownPrimaryUnsub = subscribeOwnStatus((data) => {
    _ownPrimary = data
      ? { status: data.status, availableUntil: data.availableUntil ?? null, statusColor: (data as { statusColor?: string | null }).statusColor || null }
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
          _metaByGroupId[groupId] = meta as GroupMeta;
          if (meta.name) _lastKnownNames[groupId] = meta.name as string;
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
        maybeSignalGroupsReady();
        // Fan out AFTER groupNav's own reaction so consumer order matches the
        // historical attach order (groupNav before groupContext).
        const consumers = _metaConsumers[groupId];
        if (consumers) for (const cb of [...consumers]) { try { cb(meta); } catch { /* consumer threw */ } }
      });
    }
  }
}

// One statusStore subscription per enumerated group, mirroring the store's raw
// override value into _overrideByGroupId. The store owns the underlying watch and
// the setWatchedGroups union keeps it alive; this callback just repaints the nav
// row on each fan-out (server tick or optimistic push).
function syncOverrideConsumers() {
  const want = new Set(Object.keys(_enumeration));
  for (const gid of Object.keys(_overrideStoreUnsubs)) {
    if (!want.has(gid)) {
      _overrideStoreUnsubs[gid]();
      delete _overrideStoreUnsubs[gid];
      delete _overrideByGroupId[gid];
    }
  }
  for (const gid of want) {
    if (!_overrideStoreUnsubs[gid]) {
      _overrideStoreUnsubs[gid] = storeSubscribeOwnOverride(gid, (override) => {
        if (override) _overrideByGroupId[gid] = override;
        else delete _overrideByGroupId[gid];
        renderNavRow();
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

function renderNavRowDirectMode(row: HTMLElement) {
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
function paintNavCard(card: HTMLElement, groupId: string) {
  const meta = _metaByGroupId[groupId];
  card.textContent = meta?.name || groupId;
  // Effective-status indicator: when override is enabled the group's chip
  // reflects the override (independent), otherwise it mirrors Direct
  // (primary). No per-field mixing — override.statusColor is preserved
  // across toggling enabled off (for restore-on-re-enable), but reading
  // it while enabled=false would leak the group's last pick into the
  // chip after the user turned the override off.
  const eff = effectiveStatus(_ownPrimary, _overrideByGroupId[groupId]);
  const available = eff.available;
  const effectiveColor = eff.statusColor || '#22c55e';
  card.classList.toggle('greyed', !available);
  card.style.borderColor = available ? safeCssColor(effectiveColor) : '';
  card.style.setProperty('--call-color-rgb', hexToRgb(effectiveColor));
  applyBadgeIfNonZero(card, getGroupBadgeCount(groupId));
}

function renderNavRowGroupMode(row: HTMLElement) {
  const groupId = _state.groupId as string;
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
          // Persistent node: read LIVE state at click time, never the render-time
          // closure (the toggle outlives the render that painted it).
          const gid = _state.groupId as string;
          const existing = getOwnOverride(gid) || {};
          const nextEnabled = !(existing.enabled === true);
          // pushOptimistic merges into the cached override, so statusColor/
          // paletteKey survive the flip without hand-spreading (the store owns
          // that invariant), and the synchronous fan-out repaints this nav row
          // AND groupContext's own-status row before toggleStatusOverride's write
          // round-trips.
          pushOptimistic(gid, nextEnabled
            ? { enabled: true, status: 'unavailable', availableUntil: null }
            : { enabled: false, status: null, availableUntil: null });
          toggleStatusOverride(gid, _myUserId as string, nextEnabled).catch(() => {});
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
function paintDirectCard(directCard: HTMLElement) {
  const primaryAvailable = isAvailable(_ownPrimary?.status, _ownPrimary?.availableUntil);
  const directColor = _ownPrimary?.statusColor || '#22c55e';
  directCard.classList.toggle('greyed', !primaryAvailable);
  directCard.style.borderColor = primaryAvailable ? safeCssColor(directColor) : '';
  directCard.style.setProperty('--call-color-rgb', hexToRgb(directColor));
  applyBadgeIfNonZero(directCard, getDirectBadgeCount());
}

export function onCreateRequested(fn: () => void) {
  _createListeners.add(fn);
  return () => _createListeners.delete(fn);
}

function emitCreateRequest() {
  _createListeners.forEach((fn) => { try { fn(); } catch { /* swallow */ } });
}

// ── Create group modal ───────────────────────────────────────────────────────

const _createModalCleanup: Array<() => void> = [];

function showCreateError(msg: string) {
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
  (document.getElementById('create-group-modal') as HTMLElement).classList.add('hidden');
  _createModalCleanup.forEach((fn) => fn());
  _createModalCleanup.length = 0;
}

export function openCreateGroupModal() {
  const overlay = document.getElementById('create-group-modal');
  if (!overlay) return;
  // Guard against double-open: if the modal is already showing, don't re-wire
  // listeners (the cleanup array would accumulate stale handlers).
  if (!overlay.classList.contains('hidden')) return;
  const nameInput = document.getElementById('create-group-name-input') as HTMLInputElement;
  const dnInput = document.getElementById('create-group-displayname-input') as HTMLInputElement;
  const submit = document.getElementById('create-group-submit-btn') as HTMLButtonElement;
  const cancel = document.getElementById('create-group-cancel-btn') as HTMLButtonElement;

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
      result = await createGroup(_myUserId as string, name, dn);
    } catch (err) {
      showCreateError((err as { message?: string }).message || 'Could not create group.');
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
    // Seed the override before navigateToGroup's emit: pushOptimistic marks the
    // group ticked, so enterGroupContext's store subscription replays this seed
    // synchronously — replacing the old direct cache write + post-navigate
    // applyOptimisticOverride that had to repaint the own-status row
    // enterGroupContext just reset.
    pushOptimistic(result.groupId, { enabled: true, status: 'unavailable', availableUntil: null });
    // Re-enable renderNavRow so the next emit (inside navigateToGroup)
    // paints the group-mode nav with our seeded data.
    _suspendRenderNavRow = false;
    // navigateToGroup runs emit() synchronously (renderNavRow +
    // enterGroupContext); open the invite modal too — all before the await
    // yields, so the first paint shows the group context + invite modal together
    // with no intermediate states.
    const navPromise = navigateToGroup(result.groupId);
    openInviteModal({
      scope: 'group',
      userId: _myUserId as string,
      groupId: result.groupId,
      groupName: name,
      // Without these the picker's "invite specific people" list renders empty
      // during the create flow (it only repopulated on a manual reopen via the
      // roster row). A brand-new group has just the creator as a member.
      followers: getCurrentFollowersMap(),
      mutuals: getCurrentMutuals(),
      currentMemberUids: new Set([_myUserId as string]),
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
export function getLastKnownGroupName(groupId: string) {
  return _lastKnownNames[groupId] || null;
}

// Prime the lastKnownName cache before navigateToGroup runs. Used by the
// invite-redemption flow so the nav row shows the group name immediately
// instead of briefly flashing the random groupId while watchGroupMeta is
// still in-flight.
export function setLastKnownGroupName(groupId: string, name: string) {
  if (groupId && name) _lastKnownNames[groupId] = name;
}

// Read-only subscription to a group's meta, backed by groupNav's existing
// per-group watchGroupMeta. groupContext uses this instead of opening its own
// watch on the active group. Replays the cached meta only after the underlying
// sub has ticked (never a fabricated null). The union rule in syncMetaSubs
// keeps the underlying sub alive while this consumer is registered, even if the
// group isn't enumerated yet (deep-link boot race).
export function subscribeGroupMeta(groupId: string, cb: (meta: Record<string, unknown> | null) => void) {
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
