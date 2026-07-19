// js/groupContext.ts
// Group context view: own-status header band + roster.
// The group name and back-to-Direct affordance live in the persistent nav row
// (js/groupNav.js), not in this view. This module handles enter/exit, the
// own-status row, the chain-icon override toggle (installed into the nav row's
// slot), and the member roster.

import { watchGroupMembers, watchGroupInvites, removeUserGroupsEntry, formatTimeRemaining, timeRemainingMs, isAvailable } from './db.js';
import { subscribePresence } from './presenceHub.js';
import { reconcileChildren } from './reconcile.js';
import { safeCssColor, availableForText, distanceFragmentHtml } from './utils.js';
import { CHIP_VALUES, chipIndexForMinutes, effectiveStatus } from './status.js';
import { navigateToDirect, subscribeGroupMeta } from './groupNav.js';
import { subscribeOwnOverride, getOwnOverride, pushOptimistic } from './statusStore.js';
import { subscribeOwnStatus } from './ownStatus.js';
import { renameGroup, deleteGroup, leaveGroup, editOwnDisplayName,
         setOverrideStatusAvailable, setOverrideStatusUnavailable,
         setOverrideAppearance, showToast, LOCATION_DENIED_TOAST } from './groups.js';
import { showTextPrompt, showConfirmModal } from './promptModal.js';
import {
  getPaletteState,
  getLastTimeout, setLastTimeout,
  getGroupChipMinutes, setGroupChipMinutes,
  getGroupPaletteState, setGroupPaletteState,
  isHintSeen, markHintSeen,
  getLocationOptIn,
} from './prefs.js';
import { saveCombo, buildAdoptedCombo } from './favorites.js';
import { openInviteModal } from './inviteModal.js';
import { getCurrentFollowersMap, getCurrentMutuals } from './following.js';
import { buildInviteUrl } from './invites.js';
import { sendKnock, clearGroupCardBadge, drainPendingKnocks, getFloatedUserIds } from './knock.js';
import { KNOCK_ENABLED, PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED, NOTIFICATIONS_ENABLED, FOLLOW_REQUESTS_ENABLED } from './features.js';
import { createCardDrawer, isCardDrawerOpen, closeCardDrawer } from './cardDrawer.js';
import { isFollowRequestEligible, createRequestFollowButton } from './followRequests.js';
import { createNotifyBell, isNotifyPopoverOpen } from './notifyBell.js';
import { ensureNotificationsReady } from './notifyPrompt.js';
import { getPaletteByKey, getGlowForColor, applyPaletteVars, applyThemeVars, resetThemeVars, PALETTE_SETS, startSwatchHints, buildSetToggleButton, buildSwatch, applyThemeHintIfDue, applyKeySpin, paintStatusDot } from './palettes.js';
import {
  shouldShowDotGoHint,
  isLongpressHintEligible,
} from './hints.js';
import { clearFirstUsePulse, paintLocationGlyph } from './me.js';
import { refreshHints, clearActiveHint } from './hintRotation.js';
import { toggleContext, capabilityState, isContextPublished, isContextAvailable } from './locationShare.js';
import { subscribeCellDistance, subscribeDistance } from './locationHub.js';
import { formatDistanceCoarse, formatDistancePrecise } from '../shared/geo.js';

type PresenceLike = { status?: string | null; availableUntil?: number | null; statusColor?: string | null; paletteKey?: string | null };
type OverrideEntry = PresenceLike & { enabled?: boolean | null };
type MemberEntry = { displayName?: string | null; statusOverride?: OverrideEntry | null };
type GroupInvite = { token: string; url: string; revoked?: boolean | null };

// Tabler Icons "link" and "link-off" (MIT licensed). Inlined as strings.

let _metaUnsub: (() => void) | null = null;
let _membersUnsub: (() => void) | null = null;
let _invitesUnsub: (() => void) | null = null;
const _statusUnsubs = new Map<string, () => void>(); // memberUid → unsubscribe fn
// Distance ticks land here; paintRosterRow reads them when painting a
// member's status suffix. Cell subscription: one per rendered roster member,
// open exactly while getLocationOptIn(currentGid). Precise subscription:
// additionally only for mutuals while getLocationOptIn('direct') — precise
// wins over cell when both are known (spec §6.2). The invariant "each map's
// keyset == currently eligible" is maintained by reconcileDistanceSubs, which
// renderRoster calls on every pass — mirrors js/following.ts's
// reconcileDistanceSubs (Task 9's fix for the same leak class: opening/
// closing subs only at row-create/row-remove misses eligibility churn on a
// row that stays mounted — opt-in flips, mutual-set changes, roster churn).
const _cellDistances = new Map<string, number | null>();    // memberUid → meters | null
const _cellUnsubs = new Map<string, () => void>();          // memberUid → unsubscribe fn
const _preciseDistances = new Map<string, number | null>(); // memberUid → meters | null
const _preciseUnsubs = new Map<string, () => void>();       // memberUid → unsubscribe fn
// Session-singleton: null between sessions, set for the whole in-group lifetime.
// Typed non-null so the ~30 uses don't each need a cast; the `if (!_currentGroupId)`
// guards are defensive and still fire at runtime.
let _currentGroupId = null as unknown as string;
let _currentUserId = null as unknown as string;
let _activeGroupInvite: GroupInvite | null = null;
let _ownPrimaryUnsub: (() => void) | null = null;
let _ownOverrideUnsub: (() => void) | null = null;
let _ownPrimary: PresenceLike | null = null;  // { status, availableUntil, statusColor? } | null
let _ownOverride: OverrideEntry | null = null; // { enabled, status, availableUntil, statusColor?, paletteKey? } | null
let _ownDisplayName: string | null = null; // string | null — own member displayName from watchGroupMembers, used to pre-fill the Edit-my-name prompt
let _membersOverrides: Record<string, OverrideEntry | null> = {}; // uid → statusOverride | null
const _memberPrimaries = new Map<string, PresenceLike | null>(); // uid → { status, availableUntil, statusColor, paletteKey } | null
let _settingsOutsideHandler: ((e: Event) => void) | null = null;
let _groupOwnerId: string | null = null;  // ownerId from the group-meta sub — used by renderRoster owner check
let _groupName: string | null = null;     // group name from the group-meta sub — used by roster invite row
let _lastMembers: Record<string, MemberEntry> | null = null;   // last members snapshot — allows re-render when meta arrives after members
// Timestamp of the most recent group palette-mode entry, or null. Tracked as
// a timestamp (not a one-shot bool) because setOverrideAppearance writes to
// RTDB and the own-override sub echoes back ~100-300ms later, calling
// renderOwnStatusRow → renderGroupSwatchRow and destroying the just-rendered
// key-spin element. The timestamp lets each subsequent render within the 5s
// window re-apply .key-spin with a CSS --key-spin-delay so the animation
// resumes mid-flight rather than restarting from 0deg. (The 5s window + spin
// application now live in palettes.applyKeySpin.)
let _groupPaletteEnterAt: number | null = null;

// Effective in-group availability for a member, from data (not the DOM).
// Override-on means "independent in this group": every field comes from the
// override; override-off: primary wins. Mirrors paintRosterRow's merge.
function memberEffectiveAvailable(uid: string) {
  return effectiveStatus(_memberPrimaries.get(uid) || null, _membersOverrides[uid]).available;
}

const ROSTER_KEY_PREFIX = 'm:';
function rosterRowKey(uid: string) {
  // The eligibility bit rides the key: a request-to-follow eligibility flip
  // changes the row's action cluster (bare bell vs ⋮ drawer), so it recreates
  // that one row instead of update() rebuilding drawers in place.
  const bit = (FOLLOW_REQUESTS_ENABLED && isFollowRequestEligible(uid)) ? '1' : '0';
  return `${ROSTER_KEY_PREFIX}${uid}:${bit}`;
}
function rosterUidOf(key: string) {
  return key.slice(ROSTER_KEY_PREFIX.length, key.lastIndexOf(':'));
}

function rosterKeys(members: Record<string, MemberEntry>, ownUserId: string) {
  const isOwner = _groupOwnerId !== null && _groupOwnerId === ownUserId;
  const entries = Object.entries(members || {}).filter(([uid]) => uid !== ownUserId);
  const floatedSet = new Set(getFloatedUserIds());
  const floated: [string, MemberEntry][] = [];
  const others: [string, MemberEntry][] = [];
  for (const e of entries) (floatedSet.has(e[0]) ? floated : others).push(e);
  others.sort(([uidA, a], [uidB, b]) => {
    const availA = memberEffectiveAvailable(uidA);
    const availB = memberEffectiveAvailable(uidB);
    if (availA !== availB) return availA ? -1 : 1;
    const nameA = (a.displayName || '').toLowerCase();
    const nameB = (b.displayName || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });
  const keys = [];
  if (isOwner) keys.push('invite-row');
  // Floated bucket is members-object order, not most-recently-floated — knock's own prepend wins between ticks and a reconcile self-heals; cosmetic only.
  for (const [uid] of floated) keys.push(rosterRowKey(uid));
  for (const [uid] of others) keys.push(rosterRowKey(uid));
  return keys;
}

function createInviteRow(ownUserId: string) {
  const inviteRow = document.createElement('li');
  inviteRow.id = 'group-roster-invite-row';
  inviteRow.className = 'roster-invite-row';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'add-btn';
  btn.textContent = 'Invite to group';
  btn.addEventListener('click', () => {
    // One entry point in both contexts: the modal itself renders the Telegram
    // "Share on Telegram" button or the web link UI, plus the in-app picker.
    openInviteModal({
      scope: 'group',
      userId: ownUserId,
      groupId: _currentGroupId,
      groupName: _groupName || _currentGroupId,
      activeInvite: _activeGroupInvite,
      followers: getCurrentFollowersMap(),
      mutuals: getCurrentMutuals(),
      currentMemberUids: new Set(Object.keys(_lastMembers || {})),
    });
  });
  inviteRow.appendChild(btn);
  return inviteRow;
}

function createRosterRow(uid: string, member: MemberEntry, ownUserId: string) {
  const li = document.createElement('li');
  li.className = 'group-roster-row';
  li.dataset.userId = uid;
  li.dataset.available = 'false';

  const dot = document.createElement('span');
  dot.className = 'person-dot';
  dot.dataset.available = 'false';

  const info = document.createElement('div');
  info.className = 'person-info';

  const label = document.createElement('span');
  label.className = 'person-label';
  label.textContent = member.displayName || uid;
  info.appendChild(label);

  const status = document.createElement('div');
  status.className = 'person-status';
  info.appendChild(status);

  li.appendChild(dot);
  li.appendChild(info);

  const actions = [];
  if (NOTIFICATIONS_ENABLED && uid !== ownUserId) {
    // Group context has no Call feature; you can knock members and see their
    // availability — so no Call toggle.
    const bell = createNotifyBell(uid, {
      types: ['knock', 'availability'],
      onNeedPermission: () => { ensureNotificationsReady().catch(() => {}); },
    });
    actions.push({ el: bell, closesDrawer: false });
  }
  if (FOLLOW_REQUESTS_ENABLED && uid !== ownUserId && isFollowRequestEligible(uid)) {
    // Accepted staleness: displayName is captured at create; a rename leaves a stale name in the request toast until the row is recreated (cosmetic, rare).
    const reqBtn = createRequestFollowButton(ownUserId, uid, getCurrentGroupId(), member.displayName || uid);
    actions.push({ el: reqBtn, closesDrawer: true });
  }
  // >=2 right-side actions collapse behind the shared ⋮ drawer (like Direct);
  // exactly one is shown inline (an already-followed member keeps the bare bell).
  if (actions.length >= 2) {
    li.appendChild(createCardDrawer(actions));
  } else if (actions.length === 1) {
    li.appendChild(actions[0].el);
  }

  if (KNOCK_ENABLED) {
    li.classList.add('knockable');
    // A tap drives a knock UNLESS it belongs to the per-member notification
    // bell or its (body-portaled) popover, or a popover is open and owns the
    // screen like a modal. Shared by the knock itself AND the press-feedback
    // highlight below, so neither the colored knock flash nor the row's
    // "pressable" highlight ever fires for a bell tap or behind a popover.
    const knockBlocked = (e: Event) =>
      (e.target as Element).closest('.notify-bell') ||
      (e.target as Element).closest('.notify-popover') ||
      (e.target as Element).closest('.card-drawer-toggle') ||
      (e.target as Element).closest('.card-drawer') ||
      isNotifyPopoverOpen() ||
      isCardDrawerOpen();
    li.addEventListener('click', (e) => {
      if (knockBlocked(e)) return;
      sendKnock(uid, ownUserId, undefined, { contextGroupId: getCurrentGroupId() });
    });
    // Press highlight is JS-driven (not CSS :active) so it can honour the same
    // guard — a CSS :active on the row would flash even when the bell inside it
    // is pressed, which reads as a (phantom) knock.
    const clearPress = () => li.classList.remove('knock-pressing');
    li.addEventListener('pointerdown', (e) => {
      if (knockBlocked(e)) return;
      li.classList.add('knock-pressing');
    });
    li.addEventListener('pointerup', clearPress);
    li.addEventListener('pointercancel', clearPress);
    li.addEventListener('pointerleave', clearPress);
  }

  if (PALETTES_ENABLED && PALETTE_INTERACTIONS_ENABLED && uid !== ownUserId) {
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let pressStartX: number;
    let pressStartY: number;
    let suppressNextClick = false;

    li.addEventListener('pointerdown', (e) => {
      // A press that starts on the notification bell drives the bell, not the
      // row's long-press adoption (the bell only stops click propagation, not
      // pointerdown). Without this, holding the bell would adopt the member's
      // palette.
      if ((e.target as Element).closest('.notify-bell')) return;
      // A press on the drawer toggle/slice, or while a drawer is open, belongs to
      // the drawer (or its dismissal) — not palette adoption.
      if ((e.target as Element).closest('.card-drawer-toggle') || (e.target as Element).closest('.card-drawer')) return;
      if (isCardDrawerOpen()) return;
      // Don't arm long-press adoption behind an open bell popover — the press
      // belongs to dismissing that modal, not adopting a member's palette.
      if (isNotifyPopoverOpen()) return;
      if (!_ownOverride?.enabled) return;
      clearTimeout((pressTimer as ReturnType<typeof setTimeout>)); pressTimer = null;
      pressStartX = e.clientX;
      pressStartY = e.clientY;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        suppressNextClick = true;
        triggerGroupAdoption(uid, ownUserId);
      }, 500);
    });
    li.addEventListener('pointermove', (e) => {
      if (pressTimer && (Math.abs(e.clientX - pressStartX) > 8 ||
                         Math.abs(e.clientY - pressStartY) > 8)) {
        clearTimeout((pressTimer as ReturnType<typeof setTimeout>)); pressTimer = null;
      }
    });
    ['pointerup', 'pointercancel'].forEach(ev =>
      li.addEventListener(ev, () => { clearTimeout((pressTimer as ReturnType<typeof setTimeout>)); pressTimer = null; })
    );
    li.addEventListener('click', (e) => {
      if (suppressNextClick) { suppressNextClick = false; e.stopImmediatePropagation(); }
    }, true);
  }

  return li;
}

// Brings the open cell/precise distance subscriptions back in line with
// "currently rendered roster member ∧ opted in". Called by renderRoster
// BEFORE reconcileChildren/DOM paint on every pass, so it covers every way
// eligibility can churn while a row stays mounted: own group opt-in flips on
// (open cell subs for already-rendered members), opt-in flips off (close
// everything + drop the cache before the paint that follows can read it), a
// member losing/gaining mutuality (precise sub churn independent of cell),
// and roster membership changes (a departed member's uid is simply absent
// from `memberUids`). `memberUids` must be the roster's current member set
// (excluding own uid) — callers pass an empty set when nothing should stay
// open.
function reconcileDistanceSubs(memberUids: Set<string>, myUserId: string, groupId: string) {
  // Eligibility is "viewer shares in the relevant context" (last-known
  // model): opt-in ∧ that context's own node known to exist ∧ own
  // availability IN THAT CONTEXT. Without the published half, listeners
  // attached before the node exists are rules-denied and cancelled
  // PERMANENTLY by the SDK, and the "already open" guards below would block
  // any resubscribe. Per-context on BOTH halves: the cell tier keys off THIS
  // group's own cell + own effective in-group availability (override-aware —
  // group location is independent of Direct), the precise tier off the own
  // raw point + Direct/primary availability. The availability half is the
  // display gate: a context-unavailable viewer is de facto not sharing there
  // and must not see that tier; closing is safe to reverse since the
  // persisted nodes make the reopen cancel-free. Mirrors following.ts's
  // reconcileDistanceSubs — deliberate parallel.
  const cellEligible = (isContextAvailable(groupId) && isContextPublished(groupId) && getLocationOptIn(groupId)) ? memberUids : new Set<string>();
  const mutualIds = new Set(getCurrentMutuals().map((m: { userId: string }) => m.userId));
  const directOn = isContextAvailable('direct') && isContextPublished('direct') && getLocationOptIn('direct');
  const preciseEligible = new Set<string>();
  if (directOn) {
    for (const uid of memberUids) {
      if (!mutualIds.has(uid)) continue;
      // Precise cascades into the group only while the MUTUAL broadcasts in
      // Direct: their PRIMARY availability drives their raw-point publishing
      // (a group override never publishes), so a Direct-unavailable mutual's
      // persisted locations node must not render precise here — the roster
      // falls back to their coarse cell. Their Direct opt-OUT needs no gate:
      // opting out deletes the node and the precise watch emits null. Member
      // presence ticks call syncRosterOrder → this reconcile, so the sub
      // opens/closes with their primary flips.
      const primary = _memberPrimaries.get(uid) || null;
      if (!isAvailable(primary?.status ?? null, primary?.availableUntil ?? null)) continue;
      preciseEligible.add(uid);
    }
  }

  _cellUnsubs.forEach((unsub, uid) => {
    if (cellEligible.has(uid)) return;
    unsub();
    _cellUnsubs.delete(uid);
    _cellDistances.delete(uid);
  });
  for (const uid of cellEligible) {
    if (_cellUnsubs.has(uid)) continue; // already open — never overwrite without unsubbing first
    _cellUnsubs.set(uid, subscribeCellDistance(groupId, myUserId, uid, (meters) => {
      _cellDistances.set(uid, meters);
      paintRosterRow(uid);
    }));
  }

  _preciseUnsubs.forEach((unsub, uid) => {
    if (preciseEligible.has(uid)) return;
    unsub();
    _preciseUnsubs.delete(uid);
    _preciseDistances.delete(uid);
  });
  for (const uid of preciseEligible) {
    if (_preciseUnsubs.has(uid)) continue;
    _preciseUnsubs.set(uid, subscribeDistance(myUserId, uid, (meters) => {
      _preciseDistances.set(uid, meters);
      paintRosterRow(uid);
    }));
  }
}

// Full teardown — called on group exit (and defensively at entry, mirroring
// _statusUnsubs) so a stale subscription from a previous group can never
// survive into the next one under the same uid.
function teardownAllDistanceSubs() {
  _cellUnsubs.forEach((fn) => fn());
  _cellUnsubs.clear();
  _cellDistances.clear();
  _preciseUnsubs.forEach((fn) => fn());
  _preciseUnsubs.clear();
  _preciseDistances.clear();
}

function renderRoster(members: Record<string, MemberEntry>, ownUserId: string) {
  const list = document.getElementById('group-roster');
  if (!list) return;
  // Reconcile distance subs before the DOM paint below — update()'s repaint
  // of every surviving row reads _cellDistances/_preciseDistances
  // synchronously, so eligibility must already be current. Mirrors
  // following.ts's reconcileDistanceSubs call ordering.
  if (_currentGroupId) {
    const memberUids = new Set(Object.keys(members || {}).filter((uid) => uid !== ownUserId));
    reconcileDistanceSubs(memberUids, ownUserId, _currentGroupId);
  }
  reconcileChildren(list, rosterKeys(members, ownUserId), {
    create: (key) => {
      if (key === 'invite-row') return createInviteRow(ownUserId);
      const uid = rosterUidOf(key);
      return createRosterRow(uid, (members || {})[uid] || {}, ownUserId);
    },
    update: (node, key) => {
      if (key === 'invite-row') return;
      const uid = rosterUidOf(key);
      const member = (members || {})[uid];
      const label = node.querySelector('.person-label');
      if (label && member) label.textContent = member.displayName || uid;
      // Pass `node`: reconcile runs update() BEFORE inserting a freshly-created
      // row, so a getElementById/querySelector lookup would miss it and the dot
      // would keep createRosterRow's default until a later re-render (the
      // override/status not applying on first render — esp. on a fresh restore).
      paintRosterRow(uid, node);
    },
    // The drawer survives ticks that keep its row; close only when the row
    // holding the open drawer is removed (replaces the blanket close that
    // renderRoster used to do — the leak vector was the wipe itself).
    onRemove: (node) => {
      if (isCardDrawerOpen() && node.querySelector('.card-drawer')) closeCardDrawer();
    },
  });
}

// Re-converge roster order after a status change (availability moved a row).
// Reconciliation makes this a cheap reorder + repaint; no node churn.
function syncRosterOrder() {
  if (_lastMembers === null) return;
  renderRoster(_lastMembers, _currentUserId);
}

function paintRosterRow(uid: string, li: HTMLElement | null = document.querySelector(`#group-roster [data-user-id="${uid}"]`) as HTMLElement | null) {
  if (!li) return;
  // Effective values: override-on means "independent in this group" — pull
  // every field (status/availableUntil/color/paletteKey) exclusively from
  // the override. No per-field fall-through to primary, otherwise a member
  // who chose to not theme their group card (override.paletteKey null)
  // would still pick up their Direct theme. Override-off: primary wins
  // for every field (the group is linked to Direct). effectiveStatus owns
  // that wholesale merge; the || null keeps the pre-refactor empty→null.
  const eff = effectiveStatus(_memberPrimaries.get(uid) || null, _membersOverrides[uid]);
  const available = eff.available;
  const availableUntil = eff.availableUntil;
  const color = eff.statusColor || null;
  const paletteKey = eff.paletteKey || null;
  const palette = PALETTES_ENABLED && paletteKey ? getPaletteByKey(paletteKey) : null;
  li.dataset.available = available ? 'true' : 'false';
  const dot = li.querySelector('.person-dot') as HTMLElement | null;
  if (dot) {
    dot.dataset.available = available ? 'true' : 'false';
    paintStatusDot(dot, { color, available, palettesEnabled: PALETTES_ENABLED });
  }
  const statusEl = li.querySelector('.person-status') as HTMLElement | null;
  if (statusEl) {
    if (available) {
      // Mirror the Direct contacts list: fuzzy text ("nearly 18 hours",
      // "about half an hour") rather than precise H:M. The Fuzzy helper
      // returns "… left"; strip that suffix since we prefix with
      // "Available for ". Wrap in .status-available so the palette color
      // can apply per-card (mirrors following.js's pattern). Inline the
      // statusColor in the span so a member with statusColor but no
      // paletteKey still gets the right text color — without the inline
      // style, the CSS rule (.status-available → var(--green)) wins and
      // the fuzzy time renders forest green.
      const precise = _preciseDistances.get(uid);
      const cell = _cellDistances.get(uid);
      const dist = typeof precise === 'number' ? distanceFragmentHtml(formatDistancePrecise(precise))
        : typeof cell === 'number' ? distanceFragmentHtml(formatDistanceCoarse(cell)) : '';
      const text = availableForText(availableUntil) + dist;
      const inlineColor = color ? safeCssColor(color) : '';
      statusEl.innerHTML = inlineColor
        ? `<span class="status-available" style="color:${inlineColor}">${text}</span>`
        : `<span class="status-available">${text}</span>`;
    } else {
      // Unavailable members deliberately render no status text in the
      // group-context roster — the absent green dot already conveys it.
      statusEl.innerHTML = '';
    }
  }
  // Card-level theming (mirrors following.js:726-744): when the member has a
  // palette and is available, color the card surface + border-left + status
  // text. Otherwise just border-left in statusColor (or clear when
  // unavailable). All inline styles so a re-paint can clear them cleanly.
  if (PALETTES_ENABLED && palette && available) {
    li.style.background = palette.theme.surface;
    li.style.borderLeftColor = palette.color;
    // Distance line reads var(--card-muted, --text-muted) — see following.ts.
    li.style.setProperty('--card-muted', palette.theme.textMuted);
    if (statusEl) {
      statusEl.style.color = palette.theme.textMuted;
      // .status-available's inline color (set in the innerHTML above) is
      // the member's statusColor — deliberately NOT overridden to
      // palette.color here. "Fuzzy time follows status color, not theme":
      // a member in palette mode with a complement-color statusColor
      // shows the complement, and a base-mode member with statusColor
      // but no paletteKey shows their statusColor instead of forest
      // green (the .status-available CSS default).
    }
  } else {
    li.style.background = '';
    li.style.borderLeftColor = available && color ? safeCssColor(color) : '';
    li.style.removeProperty('--card-muted');
    if (statusEl) statusEl.style.color = '';
  }
  // FTU longpress eligibility — stamp attributes; js/hintRotation.js owns the
  // animation. Availability is a tag, not a gate (engine resolves prefer-
  // available-with-fallback). No swipe hint in group context.
  const comboDiffers = color !== (_ownOverride?.statusColor || null)
    || paletteKey !== (_ownOverride?.paletteKey || null);
  const longpressEligible = PALETTE_INTERACTIONS_ENABLED
    && isLongpressHintEligible()
    && _ownOverride?.enabled === true
    && comboDiffers;
  li.dataset.hintAvail = available ? '1' : '0';
  li.dataset.hintLongpress = longpressEligible ? '1' : '0';
  li.dataset.hintSwipe = '0';
  refreshHints();
}

function renderOwnStatusRow() {
  const dot = document.getElementById('group-my-dot');
  const label = document.getElementById('group-my-status-label');
  const timeRemaining = document.getElementById('group-time-remaining');
  const timeChip = document.getElementById('group-time-chip');
  const toggle = document.getElementById('group-override-toggle');
  const glyph = document.getElementById('group-location-glyph');
  if (!dot || !label) return;

  const overrideOn = !!(_ownOverride && _ownOverride.enabled === true);
  if (toggle) toggle.setAttribute('aria-pressed', overrideOn ? 'true' : 'false');

  // Source of truth for the visible status: override when ON, else primary.
  // effectiveStatus owns the wholesale override-vs-primary merge; overrideOn
  // stays a separate local because the read-only / aria / chip-source logic
  // below keys off the toggle state, not availability.
  const eff = effectiveStatus(_ownPrimary, _ownOverride);
  const available = eff.available;
  const availableUntil = eff.availableUntil;

  dot.dataset.available = available ? 'true' : 'false';
  dot.classList.toggle('available', available);
  const color = eff.statusColor || null;
  if (available && color) dot.style.background = safeCssColor(color);
  else dot.style.background = '';
  label.textContent = available ? 'Available' : 'Unavailable';
  // Color the "Available" label using --my-status so it matches the Direct
  // header (.status-label.available rule), regardless of which color is
  // active. Phase 4+ per-audience color picker will override --my-status
  // locally if it ships separate group palette state.
  label.classList.toggle('available', available);

  // Read-only mode applies the dot + chip dimming when override is OFF.
  dot.classList.toggle('readonly', !overrideOn);
  if (timeChip) {
    timeChip.classList.toggle('readonly', !overrideOn);
    // Chip text mirrors the same source-of-truth as the dot/label. With
    // override ON, show the per-group chip default (fall back to Direct's
    // for fresh groups). With override OFF, show Direct's chip default —
    // that's what fellow members see, so the user's own view should match.
    const effectiveMinutes = overrideOn
      ? (getGroupChipMinutes(_currentGroupId) ?? getLastTimeout())
      : getLastTimeout();
    timeChip.textContent = CHIP_VALUES[chipIndexForMinutes(effectiveMinutes)].text;
  }

  // Coarse-tier location glyph: paint tri-state from the CURRENT group's
  // opt-in (not a captured gid — entering a different group must repaint
  // from that group's own pref) every time the own-status band renders.
  if (glyph) {
    const gid = getCurrentGroupId();
    paintLocationGlyph(glyph, capabilityState() === 'unsupported' ? 'denied'
      : getLocationOptIn(gid) ? 'on' : 'off');
  }

  if (timeRemaining) {
    // null availableUntil means open-ended; no countdown to show
    if (available && availableUntil) {
      const formatted = formatTimeRemaining(timeRemainingMs(availableUntil));
      if (formatted) {
        timeRemaining.textContent = formatted + ' left';
        timeRemaining.style.display = '';
        if (glyph) glyph.style.display = '';
      } else {
        timeRemaining.style.display = 'none';
        if (glyph) glyph.style.display = 'none';
      }
    } else {
      timeRemaining.style.display = 'none';
      if (glyph) glyph.style.display = 'none';
    }
  }

  // Visibility: in Direct, when the user is Unavailable, #header-chips fades
  // out and #swatch-row fades in. Mirror that here for the group context —
  // when the user has an active override and is Unavailable, hide the
  // chip row and reveal the group swatch row. With override OFF, leave the
  // chip row visible (read-only) so the user can still reach Settings.
  // Toggle visibility via opacity (NOT display:none) so the chip row and
  // swatch row keep co-occupying the same grid cell — the header height
  // stays constant across Available / Unavailable just like in Direct.
  const swatchRow = document.getElementById('group-swatch-row');
  const chipsContainer = document.querySelector('#group-context-root .group-header-chips') as HTMLElement | null;
  const showSwatch = PALETTES_ENABLED && overrideOn && !available;
  if (chipsContainer) {
    chipsContainer.style.opacity = showSwatch ? '0' : '';
    chipsContainer.style.pointerEvents = showSwatch ? 'none' : '';
  }
  if (swatchRow) {
    swatchRow.classList.toggle('visible', showSwatch);
    if (showSwatch) renderGroupSwatchRow();
  }
  // Always re-evaluate the dot-go-hint — renderGroupSwatchRow already
  // calls this internally, but it only runs when the swatch row is
  // visible. We need to clear the hint on go-available transitions too.
  paintGroupDotGoHint();
}

// Per-group palette UI state (which set is active, are we in palette mode).
// Stored locally — these are view-state, not part of the override schema.
// Per-group palette UI state lives in prefs.js (synced via
// userPrefs/{uid}/perGroup/{groupId}/paletteState). Re-imported here under the
// same names so this file's internal references don't change.

// Reconcile per-set local state with the override snapshot. Runs whenever
// the own-override sub fires (cross-device sync) and on enter so the
// picker reflects the server-side override's set + selection.
function syncGroupPaletteStateFromOverride() {
  if (!_currentGroupId) return;
  const state = getGroupPaletteState(_currentGroupId);
  const overrideColor = _ownOverride?.statusColor || null;
  const overrideKey = _ownOverride?.paletteKey || null;

  if (overrideKey) {
    for (const setNum of [1, 2]) {
      if (PALETTE_SETS[setNum].some((p) => p.key === overrideKey)) {
        state.activeSet = setNum;
        const sk = String(setNum);
        state.sets[sk].activePaletteKey = overrideKey;
        state.sets[sk].selectedKey = overrideKey;
        if (overrideColor) state.sets[sk].selectedColor = overrideColor;
        break;
      }
    }
  } else if (overrideColor) {
    // Base-mode pick (no paletteKey). Lock to whichever set the color
    // belongs to; if it's a complement (not a base color in either set),
    // leave activeSet but update the active set's selectedColor + clear
    // activePaletteKey.
    let matched = false;
    for (const setNum of [1, 2]) {
      const m = PALETTE_SETS[setNum].find((p) => p.color === overrideColor);
      if (m) {
        state.activeSet = setNum;
        const sk = String(setNum);
        state.sets[sk].selectedKey = m.key;
        state.sets[sk].selectedColor = m.color;
        state.sets[sk].activePaletteKey = null;
        matched = true;
        break;
      }
    }
    if (!matched) {
      const sk = String(state.activeSet);
      state.sets[sk].selectedColor = overrideColor;
      state.sets[sk].activePaletteKey = null;
    }
  }

  setGroupPaletteState(_currentGroupId, state);
}

// Group-context palette picker. Matches Direct's #swatch-row UX:
// - Base mode: tapping an unselected swatch writes only statusColor — the
//   user's effective theme stays as their Direct palette (or whichever
//   override palette was active before). A second tap on the same selected
//   swatch enters palette mode for that palette, which is what writes
//   paletteKey (and so applies the theme).
// - Palette mode: the key swatch sits at the same index it occupied in
//   the base-mode set, with the 7 complements filling the other slots so
//   the row's visual layout stays stable across the mode change. Tapping
//   the selected key exits palette mode (clears paletteKey, returns to the
//   primary theme). Tapping the key when a complement is active resets
//   statusColor to the palette's base color. Tapping a complement just
//   updates statusColor — paletteKey stays so the theme is preserved.
function renderGroupSwatchRow() {
  if (!PALETTES_ENABLED) return;
  const row = document.getElementById('group-swatch-row');
  if (!row) return;
  if (!_currentGroupId || !_currentUserId) return;
  row.innerHTML = '';

  const state = getGroupPaletteState(_currentGroupId);
  const activeSet = state.activeSet;
  const setData = state.sets[String(activeSet)];
  const isPaletteMode = !!setData.activePaletteKey;
  const selectedKey = setData.selectedKey;
  const currentColor = _ownOverride?.statusColor || setData.selectedColor;

  // Set-toggle button (bolt = Set 1 / tree = Set 2). Switching writes the
  // TARGET set's saved selectedColor + activePaletteKey to the override so
  // the user's effective color follows the active set immediately (matches
  // Direct's switchSet behavior — without this, toggling and then going
  // Available would broadcast the *previous* set's color).
  // Set-toggle button (shared builder; the FTU pulse + bolt/flower hint flag is
  // identical to Direct's, only the toggle action differs). Switching writes the
  // TARGET set's saved selectedColor + activePaletteKey to the override so the
  // user's effective color follows the active set immediately (matches Direct's
  // switchSet — without this, toggling then going Available would broadcast the
  // *previous* set's color).
  const toggleBtn = buildSetToggleButton(activeSet, (nextSet) => {
    const nextSetData = state.sets[String(nextSet)];
    const newState = { ...state, activeSet: nextSet };
    setGroupPaletteState(_currentGroupId, newState);
    const fields = {
      statusColor: nextSetData.selectedColor,
      paletteKey: nextSetData.activePaletteKey || null,
    };
    _ownOverride = { ..._ownOverride, ...fields };
    setOverrideAppearance(_currentGroupId, _currentUserId, fields).catch(() => {});
    applyEffectivePalette();
    renderGroupSwatchRow();
  });
  row.appendChild(toggleBtn);

  if (isPaletteMode) {
    const palette = getPaletteByKey(setData.activePaletteKey);
    if (!palette) return;
    const keyIdx = PALETTE_SETS[activeSet].findIndex((p) => p.key === palette.key);
    const complements = palette.complements;
    let ci = 0;
    for (let i = 0; i < 8; i++) {
      if (i === keyIdx) {
        const keySelected = currentColor === palette.color;
        const swatch = buildSwatch({
          color: palette.color, key: palette.key, datasetAttr: 'paletteKey',
          extraClass: 'group-swatch', keySwatch: true, selected: keySelected,
          onTap: () => {
            const newState = getGroupPaletteState(_currentGroupId);
            const sk = String(newState.activeSet);
            if (keySelected) {
              // Exit palette mode for this set. Don't change statusColor —
              // the user's pick survives, theme reverts to primary.
              newState.sets[sk].activePaletteKey = null;
              setGroupPaletteState(_currentGroupId, newState);
              _ownOverride = { ..._ownOverride, paletteKey: null };
              setOverrideAppearance(_currentGroupId, _currentUserId, { paletteKey: null }).catch(() => {});
            } else {
              // Reset statusColor to the palette's base color.
              newState.sets[sk].selectedColor = palette.color;
              setGroupPaletteState(_currentGroupId, newState);
              _ownOverride = { ..._ownOverride, statusColor: palette.color };
              setOverrideAppearance(_currentGroupId, _currentUserId, { statusColor: palette.color }).catch(() => {});
            }
            applyEffectivePalette();
            renderGroupSwatchRow();
          },
        });
        if (!applyKeySpin(swatch, _groupPaletteEnterAt)) _groupPaletteEnterAt = null;
        row.appendChild(swatch);
      } else {
        const complementColor = complements[ci++];
        const swatch = buildSwatch({
          color: complementColor, extraClass: 'group-swatch',
          selected: currentColor === complementColor,
          onTap: () => {
            const newState = getGroupPaletteState(_currentGroupId);
            newState.sets[String(newState.activeSet)].selectedColor = complementColor;
            setGroupPaletteState(_currentGroupId, newState);
            _ownOverride = { ..._ownOverride, statusColor: complementColor };
            setOverrideAppearance(_currentGroupId, _currentUserId, { statusColor: complementColor }).catch(() => {});
            applyEffectivePalette();
            renderGroupSwatchRow();
          },
        });
        row.appendChild(swatch);
      }
    }
  } else {
    // Base mode: 8 swatches in the active set. Selection follows the per-set
    // selectedKey (defaults: forest for Set 1, volt for Set 2). First tap
    // writes only statusColor; second tap on the selected swatch promotes
    // to palette mode by writing paletteKey.
    for (const palette of PALETTE_SETS[activeSet]) {
      const selected = palette.key === selectedKey;
      const swatch = buildSwatch({
        color: palette.color, key: palette.key, datasetAttr: 'paletteKey',
        extraClass: 'group-swatch', selected,
        onTap: () => {
          const newState = getGroupPaletteState(_currentGroupId);
          const sk = String(newState.activeSet);
          if (selected) {
            // Promote to palette mode for this palette.
            newState.sets[sk].activePaletteKey = palette.key;
            setGroupPaletteState(_currentGroupId, newState);
            _ownOverride = { ..._ownOverride, paletteKey: palette.key };
            setOverrideAppearance(_currentGroupId, _currentUserId, { paletteKey: palette.key }).catch(() => {});
            // Mirror palettes.enterPaletteMode — entering palette mode clears
            // the theme hint regardless of which picker the user used.
            if (!isHintSeen('theme')) markHintSeen('theme');
            // Timestamp the entry so the key-spin animation survives the
            // setOverrideAppearance echo's re-render (mirrors palettes.enterPaletteMode).
            _groupPaletteEnterAt = Date.now();
          } else {
            // Color-only change. Don't touch paletteKey.
            newState.sets[sk].selectedKey = palette.key;
            newState.sets[sk].selectedColor = palette.color;
            setGroupPaletteState(_currentGroupId, newState);
            _ownOverride = { ..._ownOverride, statusColor: palette.color };
            setOverrideAppearance(_currentGroupId, _currentUserId, { statusColor: palette.color }).catch(() => {});
          }
          applyEffectivePalette();
          renderGroupSwatchRow();
        },
      });
      row.appendChild(swatch);
    }
    // Theme hint on the selected swatch (shared applier — same gate as Direct).
    applyThemeHintIfDue(row);
  }
  paintGroupDotGoHint();
  // Rolling wave attractor across the unselected swatches — mirrors
  // palettes.js's startSwatchHints for #swatch-row. The function internally
  // gates on hints.shouldShowSwatchWave, so it's safe to call unconditionally.
  startSwatchHints(row, getGroupPaletteState(_currentGroupId));
}

// Pulse #group-my-dot to nudge the user toward going-active after they've
// picked a non-default per-group swatch. Mirrors palettes.js's dot-go-hint
// for #my-dot. Gated on:
//   (a) user picked a non-default swatch in the active set (selectedKey
//       differs from the set's default OR activePaletteKey is set)
//   (b) the FTU customAvail flag isn't yet seen
//   (c) the group dot is currently unavailable (no nudge if already active)
//   (d) override is ON (otherwise the dot isn't "the user's group dot")
function paintGroupDotGoHint() {
  const dot = document.getElementById('group-my-dot');
  if (!dot) return;
  if (!_currentGroupId || !PALETTES_ENABLED) {
    dot.classList.remove('dot-go-hint');
    return;
  }
  const gps = getGroupPaletteState(_currentGroupId);
  const sk = String(gps.activeSet);
  const defaultKey = gps.activeSet === 1 ? 'forest' : 'volt';
  const isNonDefault = gps.sets[sk].activePaletteKey != null || gps.sets[sk].selectedKey !== defaultKey;
  const overrideOn = !!(_ownOverride && _ownOverride.enabled === true);
  const available = effectiveStatus(_ownPrimary, _ownOverride).available;
  // overrideOn is the group-context-specific guard — without override ON the
  // group dot is read-only, so nudging the user to tap it is wrong.
  const shouldHint = overrideOn && shouldShowDotGoHint({ isNonDefault, dotAvailable: available });
  dot.classList.toggle('dot-go-hint', shouldHint);
}

// The user's "Direct color" semantically comes from either the server-side
// user record (statusColor field) or — for a fresh user who hasn't picked a
// swatch in Direct yet — the local paletteState's currently-selected key.
// app.js's boot path calls applyPaletteVars(selectedKey), so for a brand-new
// user --my-status starts at the paletteState's selected color (forest by
// default), NOT null. Mirror that fallback here so restorePrimaryPalette and
// applyEffectivePalette don't leave the override's color stuck on root when
// _ownPrimary.statusColor happens to be null.
function getDirectPrimaryStatusColor() {
  if (_ownPrimary?.statusColor) return _ownPrimary.statusColor;
  try {
    const ps = getPaletteState();
    const sk = String(ps.activeSet);
    const selectedKey = ps.sets[sk]?.selectedKey;
    if (selectedKey) {
      const palette = getPaletteByKey(selectedKey);
      if (palette) return palette.color;
    }
  } catch { /* paletteState unreadable — fall through */ }
  return null;
}

function getDirectPrimaryPaletteKey() {
  if (_ownPrimary?.paletteKey) return _ownPrimary.paletteKey;
  try {
    const ps = getPaletteState();
    const sk = String(ps.activeSet);
    return ps.sets[sk]?.activePaletteKey || null;
  } catch { return null; }
}

// Apply the user's effective palette/theme to the document root vars while
// in group context. Override ON means "independent in this group" — values
// come exclusively from the override (statusColor + paletteKey), with no
// fall-through to the Direct primary. Otherwise a Direct theme change
// would leak into a group the user is deliberately presenting differently
// to. Override OFF: primary wins (the group is linked to Direct).
function applyEffectivePalette() {
  if (!PALETTES_ENABLED) return;
  const overrideOn = !!(_ownOverride && _ownOverride.enabled === true);
  const effectiveColor = overrideOn
    ? ((_ownOverride as OverrideEntry).statusColor || null)
    : getDirectPrimaryStatusColor();
  const effectiveKey = overrideOn
    ? ((_ownOverride as OverrideEntry).paletteKey || null)
    : getDirectPrimaryPaletteKey();
  if (effectiveKey) {
    const palette = getPaletteByKey(effectiveKey);
    if (palette) {
      applyPaletteVars(effectiveKey);
      applyThemeVars(palette.theme);
    } else {
      resetThemeVars();
    }
  } else {
    resetThemeVars();
  }
  if (effectiveColor) {
    document.documentElement.style.setProperty('--my-status', effectiveColor);
    document.documentElement.style.setProperty('--my-glow', getGlowForColor(effectiveColor));
  }
}

// Restore the primary palette/theme on group context exit so the user's
// Direct view doesn't carry the group's theme. _ownPrimary still has the
// last-known primary state from watchPresence.
function restorePrimaryPalette() {
  if (!PALETTES_ENABLED) return;
  // Same helpers as applyEffectivePalette — for a fresh user who never wrote
  // statusColor to their record, fall back to the local paletteState's
  // selected color so we don't leave the group's --my-status (e.g. orange)
  // stuck on root when the user navigates back to Direct.
  const primaryKey = getDirectPrimaryPaletteKey();
  const primaryColor = getDirectPrimaryStatusColor();
  if (primaryKey) {
    const palette = getPaletteByKey(primaryKey);
    if (palette) {
      applyPaletteVars(primaryKey);
      applyThemeVars(palette.theme);
    } else {
      resetThemeVars();
    }
  } else {
    resetThemeVars();
  }
  if (primaryColor) {
    document.documentElement.style.setProperty('--my-status', primaryColor);
    document.documentElement.style.setProperty('--my-glow', getGlowForColor(primaryColor));
  }
}

function syncStatusSubscriptions(memberUids: Set<string>) {
  for (const uid of Array.from(_statusUnsubs.keys())) {
    if (!memberUids.has(uid)) {
      (_statusUnsubs.get(uid) as () => void)();
      _statusUnsubs.delete(uid);
      _memberPrimaries.delete(uid);
    }
  }
  for (const uid of memberUids) {
    if (!_statusUnsubs.has(uid)) {
      // Through the shared presence hub — a member who is also a Direct followee
      // is watched once at the RTDB layer (#214 R3).
      _statusUnsubs.set(uid, subscribePresence(uid, (data) => {
        _memberPrimaries.set(uid, data
          ? {
              status: data.status,
              availableUntil: data.availableUntil ?? null,
              statusColor: (data as PresenceLike).statusColor || null,
              paletteKey: (data as PresenceLike).paletteKey || null,
            }
          : null);
        // renderRoster's update repaints every row, including this one.
        syncRosterOrder();
      }));
    }
  }
}

function closeSettingsMenu() {
  const details = (document.getElementById('group-context-actions') as HTMLDetailsElement | null);
  if (details) details.open = false;
}

function installSettingsOutsideHandler() {
  if (_settingsOutsideHandler) return;
  _settingsOutsideHandler = (e) => {
    const details = (document.getElementById('group-context-actions') as HTMLDetailsElement | null);
    if (!details || !details.open) return;
    if (details.contains(e.target as Node | null)) return;
    details.open = false;
  };
  document.addEventListener('click', _settingsOutsideHandler);
}

function uninstallSettingsOutsideHandler() {
  if (!_settingsOutsideHandler) return;
  document.removeEventListener('click', _settingsOutsideHandler);
  _settingsOutsideHandler = null;
}

function wireActions(groupId: string, userId: string, isOwner: boolean, groupName: string | null) {
  const ids = ['group-action-rename', 'group-action-delete', 'group-action-edit-name', 'group-action-leave'];

  // Clone-and-replace each button to drop any previous listeners
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const clone = el.cloneNode(true);
    (el.parentNode as Node).replaceChild(clone, el);
  }

  // Visibility
  (document.getElementById('group-action-rename') as HTMLElement).classList.toggle('hidden', !isOwner);
  (document.getElementById('group-action-delete') as HTMLElement).classList.toggle('hidden', !isOwner);
  (document.getElementById('group-action-edit-name') as HTMLElement).classList.remove('hidden');
  (document.getElementById('group-action-leave') as HTMLElement).classList.toggle('hidden', isOwner);

  // Handlers. Each handler closes the Settings details menu on activation
  // so the user doesn't have to tap Settings again to dismiss it.
  // In-app prompts/confirms (not window.prompt/confirm/alert): those are
  // no-ops in some webviews — notably Telegram's macOS Desktop client — so a
  // rename/edit/delete/leave silently did nothing there. showTextPrompt returns
  // a trimmed non-empty string or null; showConfirmModal returns a boolean.
  (document.getElementById('group-action-rename') as HTMLElement).addEventListener('click', async () => {
    closeSettingsMenu();
    const next = await showTextPrompt({ title: 'New group name', value: groupName || '', confirmLabel: 'Save' });
    if (next == null) return;
    try { await renameGroup(groupId, userId, next); } catch (e) { showToast((e as Error).message); }
  });

  (document.getElementById('group-action-delete') as HTMLElement).addEventListener('click', async () => {
    closeSettingsMenu();
    const ok = await showConfirmModal({ title: `Delete ${groupName || 'this group'}?`, message: 'This cannot be undone.', confirmLabel: 'Delete' });
    if (!ok) return;
    try {
      await deleteGroup(groupId, userId);
      await navigateToDirect();
    } catch (e) { showToast((e as Error).message); }
  });

  (document.getElementById('group-action-edit-name') as HTMLElement).addEventListener('click', async () => {
    closeSettingsMenu();
    const next = await showTextPrompt({ title: 'Your name in this group', value: _ownDisplayName || '', confirmLabel: 'Save' });
    if (next == null) return;
    try { await editOwnDisplayName(groupId, userId, next); } catch (e) { showToast((e as Error).message); }
  });

  (document.getElementById('group-action-leave') as HTMLElement).addEventListener('click', async () => {
    closeSettingsMenu();
    const ok = await showConfirmModal({ title: `Leave ${groupName || 'this group'}?`, message: "You'll stop seeing this group. You can be re-invited later.", confirmLabel: 'Leave' });
    if (!ok) return;
    try {
      await leaveGroup(groupId, userId);
      await navigateToDirect();
    } catch (e) { showToast((e as Error).message); }
  });
}

// Listeners registered once at module load; react to sibling-device
// userPrefs sync ticks affecting this group while it's visible.
let _groupSyncListenersInstalled = false;
function installGroupSyncListeners() {
  if (_groupSyncListenersInstalled) return;
  _groupSyncListenersInstalled = true;
  document.addEventListener('group-palette-state-synced', (e) => {
    if (!_currentGroupId) return;
    if ((e as CustomEvent).detail?.groupId !== _currentGroupId) return;
    renderGroupSwatchRow();
  });
  document.addEventListener('group-chip-minutes-synced', (e) => {
    if (!_currentGroupId) return;
    if ((e as CustomEvent).detail?.groupId !== _currentGroupId) return;
    // Only re-render the chip from this event when override is ON — when
    // override is OFF the chip mirrors Direct's value, not the per-group one.
    if (!_ownOverride?.enabled) return;
    const minutes = (e as CustomEvent).detail.minutes;
    const idx = chipIndexForMinutes(minutes);
    if (idx < 0) return;
    const chipEl = document.getElementById('group-time-chip');
    if (chipEl) chipEl.textContent = CHIP_VALUES[idx].text;
  });
  // When override is OFF, the group chip mirrors Direct's chip default.
  // Direct-side chip changes (local user toggle in me.js, or a sibling
  // device's setLastTimeout that arrives via watchUserPrefs) need to
  // refresh the read-only group chip too.
  document.addEventListener('last-timeout-synced', () => {
    if (!_currentGroupId) return;
    if (_ownOverride?.enabled) return; // chip is showing the per-group value
    renderOwnStatusRow();
  });
  // The following list synced from the server. The roster's request-to-follow
  // eligibility is computed from that list at render time, so re-render: a
  // fresh-device restore that boots straight into this group paints the roster
  // against an empty following cache and offers the affordance for members the
  // user already follows. Also drops the affordance when a follow completes.
  document.addEventListener('following-synced', () => {
    if (!_currentGroupId || _lastMembers === null) return;
    renderRoster(_lastMembers, _currentUserId);
  });
  // A knock float expired (knock.js). Re-sort the roster so the card lands in
  // its correct current position rather than a stale captured one.
  document.addEventListener('knock-float-restored', () => {
    if (!_currentGroupId || _lastMembers === null) return;
    syncRosterOrder();
  });
  // Own group opt-in flipped (glyph tap, via locationShare.ts's toggleContext)
  // or a server echo of location prefs landed (prefs.ts's syncFromServer) —
  // either can flip cell OR precise eligibility (the latter checks
  // getLocationOptIn('direct') too). syncRosterOrder's renderRoster call
  // runs reconcileDistanceSubs unconditionally, so this re-render opens/
  // closes subs for already-rendered rows immediately — it doesn't wait for
  // a row's key to churn.
  document.addEventListener('location-optin-changed', () => {
    if (!_currentGroupId || _lastMembers === null) return;
    syncRosterOrder();
  });
  document.addEventListener('location-prefs-synced', () => {
    if (!_currentGroupId || _lastMembers === null) return;
    syncRosterOrder();
  });
  // Own published state changed (locationShare.ts — a context's first
  // publish landed, the boot seed found a persisted node, or a teardown
  // deleted it). Same re-render: reconcileDistanceSubs keys both tiers'
  // eligibility off the own node existing, so this opens subs when a node
  // arrives and closes them when it is deleted (the server cancelled the
  // old listeners; they must be recreated, never reused).
  document.addEventListener('location-publishing-changed', () => {
    if (!_currentGroupId || _lastMembers === null) return;
    syncRosterOrder();
  });
}

// One-time (module-lifetime, not per-entry) wiring for the group band's
// location glyph: click toggles the CURRENT group's context, and a
// cross-device pref sync repaints from whatever group is current at the
// time the event fires. Guarded by _glyphWired so switching groups
// repeatedly never piles up duplicate listeners on the persistent element.
let _glyphWired = false;
function wireGroupLocationGlyph() {
  if (_glyphWired) return;
  _glyphWired = true;
  const glyph = document.getElementById('group-location-glyph');
  if (!glyph) return;
  glyph.addEventListener('click', async () => {
    const gid = getCurrentGroupId();
    if (!gid) return;
    const state = await toggleContext(gid);
    paintLocationGlyph(glyph, state === 'on' ? 'on' : state === 'off' ? 'off' : 'denied');
    if (state === 'denied') showToast(LOCATION_DENIED_TOAST);
  });
  document.addEventListener('location-prefs-synced', () => {
    const gid = getCurrentGroupId();
    if (gid) paintLocationGlyph(glyph, getLocationOptIn(gid) ? 'on' : 'off');
  });
  // Pref flipped outside the tap path (locationShare's mid-flight-revocation
  // teardown): the click handler above never runs, so the paint rides the event.
  document.addEventListener('location-optin-changed', () => {
    const gid = getCurrentGroupId();
    if (gid) paintLocationGlyph(glyph, getLocationOptIn(gid) ? 'on' : 'off');
  });
}

export function enterGroupContext(groupId: string, userId: string) {
  if (_metaUnsub) _metaUnsub();
  _currentGroupId = groupId;
  _currentUserId = userId;
  installGroupSyncListeners();
  wireGroupLocationGlyph();

  const root = document.getElementById('group-context-root');
  const direct = document.getElementById('main-ui-direct');
  if (root) root.classList.remove('hidden');
  if (direct) direct.classList.add('hidden');

  // Clear any pending unread-knock badge for this group
  clearGroupCardBadge(groupId);

  // Dismiss the Settings details menu when the user taps anywhere outside it.
  installSettingsOutsideHandler();

  // Subscribe to group members for the roster
  if (_membersUnsub) _membersUnsub();
  _statusUnsubs.forEach((fn) => fn());
  _statusUnsubs.clear();
  _memberPrimaries.clear();
  // A stale cell/precise sub from a previous group must never survive into
  // this one under the same member uid — reconcileDistanceSubs alone
  // wouldn't catch that (an eligible uid already has an entry in the map, so
  // it would skip resubscribing, leaving the OLD group's cell watch open).
  teardownAllDistanceSubs();
  _membersOverrides = {};
  _lastMembers = null;
  _groupOwnerId = null;
  _groupName = null;
  // Reset the roster DOM so rows rebuild fresh for THIS group. renderRoster
  // reconciles by uid, so without this a member shared with the previously
  // viewed group keeps that group's request-follow button — which captured the
  // prior group's displayName + groupId at create time (stale name/context in
  // the request toast, and the request written against the wrong group).
  const rosterListEl = document.getElementById('group-roster');
  if (rosterListEl) rosterListEl.innerHTML = '';
  let drainedKnocksOnEntry = false;
  _membersUnsub = watchGroupMembers(groupId, (members) => {
    _lastMembers = (members as Record<string, MemberEntry>);
    _membersOverrides = {};
    for (const [uid, m] of Object.entries((members as Record<string, MemberEntry>) || {})) {
      _membersOverrides[uid] = m.statusOverride || null;
    }
    _ownDisplayName = ((members as Record<string, MemberEntry>))?.[userId]?.displayName || null;
    renderRoster((members as Record<string, MemberEntry>), userId);
    syncStatusSubscriptions(new Set(Object.keys(members || {})));
    // Replay any knocks that arrived while the user wasn't in this group.
    // Wait for the first members tick so the roster lis exist before drain
    // tries to look them up; one-shot per enterGroupContext call.
    if (!drainedKnocksOnEntry) {
      drainedKnocksOnEntry = true;
      drainPendingKnocks(groupId);
    }
  });

  // Subscribe to group invites so the owner-settings invite-link button can
  // open the modal in 'manage' state when an active invite already exists.
  if (_invitesUnsub) _invitesUnsub();
  _activeGroupInvite = null;
  _invitesUnsub = watchGroupInvites(groupId, (collection) => {
    let active = null;
    for (const [token, inv] of Object.entries((collection as Record<string, { revoked?: boolean | null }>) || {})) {
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
  _ownPrimaryUnsub = subscribeOwnStatus((data) => {
    _ownPrimary = data
      ? {
          status: data.status,
          availableUntil: data.availableUntil ?? null,
          statusColor: (data as PresenceLike).statusColor || null,
          paletteKey: (data as PresenceLike).paletteKey || null,
        }
      : null;
    // Per-group chip default is local-only for now (statusapp_group_chip_${groupId})
    // — it was previously synced through users/{uid}/lastTimeoutMinutes, which
    // leaked the group chip pick into Direct (and vice versa). Cross-device sync
    // of the per-group chip lands with the userPrefs/ migration.
    // Re-apply effective theme: a primary-side palette change (e.g. another
    // device picked a different Direct theme) would otherwise have been
    // written to root by app.js's watchPresence, clobbering our group-context
    // override theme.
    applyEffectivePalette();
    renderOwnStatusRow();
  });
  _ownOverrideUnsub = subscribeOwnOverride(groupId, (data) => {
    _ownOverride = data || null;
    syncGroupPaletteStateFromOverride();
    // Seed override.statusColor the first time we see an enabled override
    // with no statusColor — "override ON = independent", and applyEffective-
    // Palette intentionally won't fall back to primary, so without a seed
    // the dot renders against --my-status (the user's Direct color). Use
    // whatever swatch the picker is currently showing as selected for the
    // active set (defaults: forest for Set 1, volt for Set 2).
    if (PALETTES_ENABLED && _ownOverride && _ownOverride.enabled === true && !_ownOverride.statusColor) {
      const state = getGroupPaletteState(groupId);
      const seed = state.sets[String(state.activeSet)]?.selectedColor || null;
      if (seed) {
        // pushOptimistic merges the seed into the store cache and fans out,
        // re-entering this callback with the merged value; the !statusColor
        // guard above then short-circuits, so it can't loop.
        pushOptimistic(groupId, { statusColor: seed });
        setOverrideAppearance(groupId, userId, { statusColor: seed }).catch(() => {});
      }
    }
    applyEffectivePalette();
    renderOwnStatusRow();
    // Re-paint roster rows: the FTU longpress hint compares each member's
    // combo against _ownOverride, so a change here needs to re-evaluate the
    // show/hide for every row.
    for (const uid of _memberPrimaries.keys()) paintRosterRow(uid);
  });

  // The chain-icon override toggle lives in the nav row and is fully owned by
  // js/groupNav.js (rendered into the row each time renderNavRow fires). No
  // install handoff here.

  // Wire the dot (clone-and-replace per the same pattern)
  const dot = document.getElementById('group-my-dot');
  if (dot) {
    const dotClone = dot.cloneNode(true);
    (dot.parentNode as Node).replaceChild(dotClone, dot);
    // The clone-and-replace above wipes any FTU once-listener me.js installed.
    // Re-install so tapping the group dot terminates the first-use pulse — same
    // contract as the Direct dot.
    dotClone.addEventListener('click', clearFirstUsePulse, { once: true });
    dotClone.addEventListener('click', () => {
      const overrideOn = !!(_ownOverride && _ownOverride.enabled === true);
      if (!overrideOn) return;  // read-only when toggle is OFF
      const currentlyAvailable = isAvailable((_ownOverride as OverrideEntry).status, (_ownOverride as OverrideEntry).availableUntil);
      if (currentlyAvailable) {
        pushOptimistic(groupId, { status: 'unavailable', availableUntil: null });
        setOverrideStatusUnavailable(groupId, userId).catch(() => {});
      } else {
        // Read minutes via the chip-index lookup so we apply the same
        // legacy <=12 → *60 migration that js/me.js applies. Reading
        // getLastTimeout() raw and multiplying by 60000 treats a new-user
        // default of "2" as 2 minutes instead of 2 hours.
        // Use the per-group chip default if set; fall back to Direct's so a
        // fresh group still has a sensible "go available for N" duration.
        const baseMinutes = getGroupChipMinutes(groupId) ?? getLastTimeout();
        const minutes = CHIP_VALUES[chipIndexForMinutes(baseMinutes)].minutes;
        const availableUntil = Date.now() + minutes * 60000;
        pushOptimistic(groupId, { status: 'available', availableUntil });
        // Push the going-active combo to favorites — this is a real
        // unavailable→available transition with the user's committed
        // group-effective color + palette. Read the store cache (the push's
        // synchronous fan-out has already merged status:available into it).
        saveCombo(buildGroupCombo({
          ownOverride: getOwnOverride(groupId),
          ownPrimary: _ownPrimary,
          paletteState: getGroupPaletteState(groupId),
        }));
        // Mirror me.js: going active with the user demonstrably engaged
        // with the picker (entered palette mode or picked a non-default
        // selectedKey) is "non-default color" for hint-chain purposes.
        const gps = getGroupPaletteState(groupId);
        const sk = String(gps.activeSet);
        const defaultKey = gps.activeSet === 1 ? 'forest' : 'volt';
        if (gps.sets[sk].activePaletteKey != null || gps.sets[sk].selectedKey !== defaultKey) {
          markHintSeen('customAvail');
        }
        setOverrideStatusAvailable(groupId, userId, availableUntil).catch(() => {});
      }
    });
  }

  // Wire the time chip (clone-and-replace; cycles override duration when ON+available).
  // The chip's default duration is per-group (statusapp_group_chip_${groupId}) so
  // cycling it doesn't leak into Direct's chip and vice versa. Fall back to
  // getLastTimeout() (Direct's default) for groups the user hasn't touched.
  const timeChip = document.getElementById('group-time-chip');
  if (timeChip) {
    const initMinutes = getGroupChipMinutes(groupId) ?? getLastTimeout();
    timeChip.textContent = CHIP_VALUES[chipIndexForMinutes(initMinutes)].text;
    const chipClone = timeChip.cloneNode(true);
    (timeChip.parentNode as Node).replaceChild(chipClone, timeChip);
    chipClone.addEventListener('click', () => {
      const overrideOn = !!(_ownOverride && _ownOverride.enabled === true);
      if (!overrideOn) return;
      // Cycle the default duration regardless of whether the user is currently
      // available. If they're available, also push the new availableUntil to
      // the override. If they're unavailable, the new default applies the next
      // time they tap the dot to go available.
      const currentMinutes = getGroupChipMinutes(groupId) ?? getLastTimeout();
      const currentIdx = chipIndexForMinutes(currentMinutes);
      const nextIdx = (currentIdx + 1) % CHIP_VALUES.length;
      const { minutes, text } = CHIP_VALUES[nextIdx];
      chipClone.textContent = text;
      setGroupChipMinutes(groupId, minutes);
      const currentlyAvailable = isAvailable((_ownOverride as OverrideEntry).status, (_ownOverride as OverrideEntry).availableUntil);
      if (currentlyAvailable) {
        const availableUntil = Date.now() + minutes * 60000;
        pushOptimistic(groupId, { status: 'available', availableUntil });
        setOverrideStatusAvailable(groupId, userId, availableUntil).catch(() => {});
      }
    });
  }

  // Subscribe to group meta for the name + owner check
  _metaUnsub = subscribeGroupMeta(groupId, (meta) => {
    if (!meta) {
      // Group entity was deleted. Non-owner members never had their
      // users/{uid}/groups/{groupId} entry cleared by the owner (the
      // owner has no permission to write to other users' records).
      // Clear it locally; the watchUserGroups delta in groups.js then
      // surfaces the "deleted" toast and navigates back to Direct.
      removeUserGroupsEntry(userId, groupId).catch(() => {});
      return;
    }
    _groupOwnerId = (meta.ownerId || null) as string | null;
    _groupName = (meta.name || null) as string | null;
    const isOwner = meta.ownerId === userId;
    wireActions(groupId, userId, isOwner, meta.name as string | null);
    // Re-render the roster so the owner-only invite row appears even if the
    // members callback fired before meta (race condition on first load).
    if (_lastMembers !== null) renderRoster(_lastMembers, userId);
  });
}

export function exitGroupContext() {
  // Restore the user's Direct (primary) theme BEFORE we clear _ownPrimary —
  // otherwise the group's override theme stays on root vars until app.js's
  // next watchPresence tick happens to write something different.
  restorePrimaryPalette();
  if (_metaUnsub) { _metaUnsub(); _metaUnsub = null; }
  if (_membersUnsub) { _membersUnsub(); _membersUnsub = null; }
  if (_invitesUnsub) { _invitesUnsub(); _invitesUnsub = null; }
  if (_ownPrimaryUnsub) { _ownPrimaryUnsub(); _ownPrimaryUnsub = null; }
  if (_ownOverrideUnsub) { _ownOverrideUnsub(); _ownOverrideUnsub = null; }
  _ownPrimary = null;
  _ownOverride = null;
  _membersOverrides = {};
  _ownDisplayName = null;
  _memberPrimaries.clear();
  _statusUnsubs.forEach((fn) => fn());
  _statusUnsubs.clear();
  teardownAllDistanceSubs();
  _currentGroupId = null as unknown as string;
  _currentUserId = null as unknown as string;
  _activeGroupInvite = null;
  _groupOwnerId = null;
  _groupName = null;
  _lastMembers = null;
  // Close any open card drawer so its document-level capture listeners are
  // removed and _open is cleared before we navigate away.
  closeCardDrawer();
  closeSettingsMenu();
  uninstallSettingsOutsideHandler();
  const root = document.getElementById('group-context-root');
  const direct = document.getElementById('main-ui-direct');
  if (root) root.classList.add('hidden');
  if (direct) direct.classList.remove('hidden');
}

function getCurrentGroupId() { return _currentGroupId; }

/**
 * Apply an adopted (statusColor, paletteKey) pair to this group's state.
 * Performs the optimistic UI update, picker mirror, and fire-and-forget
 * Firebase write — but does NOT push to favorites or mark hints (those
 * are caller-specific concerns). Used by long-press group adoption and
 * by favorites-strip pill taps in group context.
 *
 * Caller must ensure override is currently enabled (otherwise this is a
 * silent no-op).
 */
export function applyAdoptedComboInGroup(adoptedColor: string, adoptedPaletteKey: string | null) {
  const groupId = _currentGroupId;
  if (!groupId || !_ownOverride?.enabled || !_currentUserId) return;

  // Optimistic local mutation: one push covers both this module's own-status
  // row (via the store subscription) and groupNav's card border — the two
  // renders the old applyOptimisticOverride + applyOptimisticAppearance pair
  // did separately.
  pushOptimistic(groupId, { statusColor: adoptedColor, paletteKey: adoptedPaletteKey });
  applyEffectivePalette();                // CSS vars in group context

  // Picker mirror.
  const state = getGroupPaletteState(groupId);
  const setKey = String(state.activeSet);
  if (adoptedPaletteKey) {
    const setNum = PALETTE_SETS[2].some(p => p.key === adoptedPaletteKey) ? 2 : 1;
    const tgtKey = String(setNum);
    state.activeSet = setNum;
    state.sets[tgtKey].selectedKey       = adoptedPaletteKey;
    state.sets[tgtKey].selectedColor     = adoptedColor;
    state.sets[tgtKey].activePaletteKey  = adoptedPaletteKey;
  } else {
    let matched = null;
    for (const sn of ['1', '2']) {
      const found = PALETTE_SETS[Number(sn)].find(p => p.color === adoptedColor);
      if (found) { matched = { set: sn, key: found.key }; break; }
    }
    if (matched) {
      state.activeSet = Number(matched.set);
      state.sets[matched.set].selectedKey      = matched.key;
      state.sets[matched.set].selectedColor    = adoptedColor;
      state.sets[matched.set].activePaletteKey = null;
    } else {
      state.sets[setKey].selectedColor    = adoptedColor;
      state.sets[setKey].activePaletteKey = null;
    }
  }
  setGroupPaletteState(groupId, state);

  // Firebase write (fire-and-forget).
  setOverrideAppearance(groupId, _currentUserId, { statusColor: adoptedColor, paletteKey: adoptedPaletteKey })
    .catch(() => {});
}

function triggerGroupAdoption(srcUid: string, ownUid: string) {
  const groupId = _currentGroupId;
  if (!groupId || !_ownOverride?.enabled) return;

  // 1. Source resolution: override-then-primary-then-forest-fallback.
  // _membersOverrides is a plain object keyed by uid; _memberPrimaries is a Map.
  const srcOverride = _membersOverrides?.[srcUid] || null;
  const srcPrimary  = _memberPrimaries?.get(srcUid) || null;
  let adoptedColor, adoptedPaletteKey;
  if (srcOverride?.enabled && srcOverride.statusColor) {
    adoptedColor      = srcOverride.statusColor;
    adoptedPaletteKey = srcOverride.paletteKey ?? null;
  } else if (srcOverride?.enabled && srcOverride.paletteKey) {
    // paletteKey-only override: derive color from the palette's key color.
    // Mirrors what the source row actually renders (paintRosterRow falls
    // through to palette.color when override.statusColor is missing).
    const p = PALETTE_SETS[1].find(x => x.key === srcOverride.paletteKey)
           || PALETTE_SETS[2].find(x => x.key === srcOverride.paletteKey);
    adoptedColor      = p?.color ?? '#22c55e';
    adoptedPaletteKey = srcOverride.paletteKey;
  } else {
    adoptedColor      = srcPrimary?.statusColor ?? '#22c55e';
    adoptedPaletteKey = srcPrimary?.paletteKey ?? null;
  }

  // 2. Push the adopted combo to favorites.
  saveCombo(buildAdoptedCombo(adoptedColor, adoptedPaletteKey));

  // 3-5. Apply the combo to this group's state.
  applyAdoptedComboInGroup(adoptedColor, adoptedPaletteKey);

  // 6. Hint flag.
  if (!isHintSeen('longpress')) {
    markHintSeen('longpress');
    clearActiveHint();
    // Re-stamp synchronously so eligibility drops to '0' before the engine's
    // next step. markHintSeen has no side effect and this path doesn't otherwise
    // repaint the roster, so without this the engine could re-pulse a longpress
    // hint until the async override echo repaints (the Direct path self-heals via
    // the my-combo-changed listener; group has no equivalent here).
    for (const uid of _memberPrimaries.keys()) paintRosterRow(uid);
  }

  // 7. Visual flash on the source row.
  const srcLi = document.querySelector(`#group-roster li[data-user-id="${srcUid}"]`);
  if (srcLi) {
    srcLi.classList.add('adopted-from');
    setTimeout(() => srcLi.classList.remove('adopted-from'), 800);
  }
}

// Pure helper. Resolves the user's current group-effective combo into the
// shape favorites.js expects. Used by adoption to push the pre-adoption
// combo to history before mutating the override.
export function buildGroupCombo({ ownOverride, ownPrimary, paletteState }: { ownOverride?: OverrideEntry | null; ownPrimary?: PresenceLike | null; paletteState?: { activeSet?: number; sets?: Record<string, { selectedKey?: string | null }> } | null }) {
  const overrideOn = !!ownOverride?.enabled;
  const statusColor =
    (overrideOn && ownOverride?.statusColor) ||
    ownPrimary?.statusColor ||
    '#22c55e';
  // Mirrors paintRosterRow's resolution: when override is enabled, the override
  // is authoritative — override.paletteKey of null/missing means "no palette",
  // NOT "fall through to primary." Otherwise the combo we save here wouldn't
  // match what the user was actually seeing in the group.
  const paletteKey = overrideOn
    ? (ownOverride?.paletteKey || null)
    : (ownPrimary?.paletteKey || null);
  const palette = paletteKey ? getPaletteByKey(paletteKey) : null;
  const activeSet = paletteState?.activeSet ?? 1;
  const activeSetKey = String(activeSet);
  const selectedKey = paletteState?.sets?.[activeSetKey]?.selectedKey ?? 'forest';
  return {
    statusColor,
    surface:  palette?.theme?.surface  ?? '#1e293b',
    surface2: palette?.theme?.surface2 ?? '#334155',
    paletteKey,
    selectedKey,
    activeSet,
  };
}
