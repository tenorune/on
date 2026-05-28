// js/groupContext.js
// Group context view: own-status header band + roster.
// The group name and back-to-Direct affordance live in the persistent nav row
// (js/groupNav.js), not in this view. This module handles enter/exit, the
// own-status row, the chain-icon override toggle (installed into the nav row's
// slot), and the member roster.

import { watchGroupMeta, watchGroupMembers, watchGroupInvites, watchStatus, watchOwnMemberOverride, removeUserGroupsEntry, formatTimeRemaining, formatTimeRemainingFuzzy, timeRemainingMs, setLastTimeoutMinutes } from './db.js';
import { safeCssColor } from './utils.js';
import { navigateToDirect } from './groupNav.js';
import { renameGroup, deleteGroup, leaveGroup, editOwnDisplayName,
         setOverrideStatusAvailable, setOverrideStatusUnavailable,
         setOverrideAppearance } from './groups.js';
import { getLastTimeout, setLastTimeout } from './store.js';
import { openInviteModal } from './inviteModal.js';
import { buildInviteUrl } from './invites.js';
import { sendKnock, clearGroupCardBadge, drainPendingKnocks, getFloatedUserIds } from './knock.js';
import { KNOCK_ENABLED, PALETTES_ENABLED } from './features.js';
import { getPaletteByKey, getGlowForColor, applyPaletteVars, applyThemeVars, resetThemeVars, PALETTE_SETS, ICON_BOLT, ICON_TREE } from './palettes.js';

// Tabler Icons "link" and "link-off" (MIT licensed). Inlined as strings.

const CHIP_VALUES = [
  { minutes: 30,   text: '30 minutes' },
  { minutes: 60,   text: '1 hour' },
  { minutes: 90,   text: '1 hour 30 minutes' },
  { minutes: 120,  text: '2 hours' },
  { minutes: 180,  text: '3 hours' },
  { minutes: 240,  text: '4 hours' },
  { minutes: 360,  text: '6 hours' },
  { minutes: 480,  text: '8 hours' },
  { minutes: 720,  text: '12 hours' },
  { minutes: 1080, text: '18 hours' },
  { minutes: 1440, text: '24 hours' },
];
function chipIndexForMinutes(minutes) {
  let m = minutes;
  if (m <= 12) m = m * 60;
  let bestIndex = 0;
  let bestDist = Math.abs(CHIP_VALUES[0].minutes - m);
  for (let i = 1; i < CHIP_VALUES.length; i++) {
    const dist = Math.abs(CHIP_VALUES[i].minutes - m);
    if (dist < bestDist) { bestDist = dist; bestIndex = i; }
  }
  return bestIndex;
}

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
let _ownDisplayName = null; // string | null — own member displayName from watchGroupMembers, used to pre-fill the Edit-my-name prompt
let _membersOverrides = {}; // uid → statusOverride | null
const _memberPrimaries = new Map(); // uid → { status, availableUntil, statusColor, paletteKey } | null
let _settingsOutsideHandler = null;

// Reorder the existing roster `<li>` nodes so available members come first,
// alphabetical within each (available / unavailable) bucket. Rows currently
// being floated by a knock animation (knock.js prepends them) stay at the top
// regardless of availability — knock visuals own that slot for 20s.
function reorderRosterByAvailability() {
  const list = document.getElementById('group-roster');
  if (!list) return;
  const floatedSet = new Set(getFloatedUserIds());
  const rows = Array.from(list.children);
  const floated = rows.filter((r) => floatedSet.has(r.dataset.userId));
  const others = rows.filter((r) => !floatedSet.has(r.dataset.userId));
  others.sort((a, b) => {
    const aAvail = a.dataset.available === 'true';
    const bAvail = b.dataset.available === 'true';
    if (aAvail !== bAvail) return aAvail ? -1 : 1;
    const aName = (a.querySelector('.person-label')?.textContent || '').toLowerCase();
    const bName = (b.querySelector('.person-label')?.textContent || '').toLowerCase();
    return aName.localeCompare(bName);
  });
  for (const row of floated.concat(others)) list.appendChild(row);
}

function renderRoster(members, ownUserId) {
  const list = document.getElementById('group-roster');
  if (!list) return;
  list.innerHTML = '';

  // Own user is represented by the status row in the group-context header.
  // Don't duplicate them in the roster.
  const entries = Object.entries(members || {}).filter(([uid]) => uid !== ownUserId);
  entries.sort(([, a], [, b]) => {
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

    if (KNOCK_ENABLED) {
      li.classList.add('knockable');
      li.addEventListener('click', () => {
        sendKnock(uid, ownUserId, undefined, { contextGroupId: getCurrentGroupId() });
      });
    }

    list.appendChild(li);
  }
  reorderRosterByAvailability();
}

function paintRosterRow(uid) {
  const li = document.querySelector(`#group-roster [data-user-id="${uid}"]`);
  if (!li) return;
  const override = _membersOverrides[uid];
  const primary = _memberPrimaries.get(uid) || null;
  const overrideOn = !!(override && override.enabled === true);
  // Effective values: when the member has an active override for this group,
  // its statusColor / paletteKey win — that's the whole point of per-group
  // overrides. Otherwise we fall back to the member's primary user record.
  const status = overrideOn ? (override.status || 'unavailable') : (primary?.status || 'unavailable');
  const availableUntil = (overrideOn ? override.availableUntil : primary?.availableUntil) ?? null;
  const isAvailable = status === 'available' && (availableUntil == null || availableUntil > Date.now());
  const color = (overrideOn ? override.statusColor : null) || primary?.statusColor || null;
  const paletteKey = (overrideOn ? override.paletteKey : null) || primary?.paletteKey || null;
  const palette = PALETTES_ENABLED && paletteKey ? getPaletteByKey(paletteKey) : null;
  li.dataset.available = isAvailable ? 'true' : 'false';
  const dot = li.querySelector('.person-dot');
  if (dot) {
    dot.dataset.available = isAvailable ? 'true' : 'false';
    dot.classList.toggle('available', isAvailable);
    if (isAvailable && color && PALETTES_ENABLED) {
      const safe = safeCssColor(color);
      dot.style.background = safe;
      dot.style.borderColor = safe;
      dot.style.boxShadow = `0 0 10px ${safeCssColor(getGlowForColor(color))}`;
    } else if (isAvailable && color) {
      dot.style.background = safeCssColor(color);
      dot.style.borderColor = '';
      dot.style.boxShadow = '';
    } else {
      dot.style.background = '';
      dot.style.borderColor = '';
      dot.style.boxShadow = '';
    }
  }
  const statusEl = li.querySelector('.person-status');
  if (statusEl) {
    if (isAvailable) {
      // Mirror the Direct contacts list: fuzzy text ("nearly 18 hours",
      // "about half an hour") rather than precise H:M. The Fuzzy helper
      // returns "… left"; strip that suffix since we prefix with
      // "Available for ". Wrap in .status-available so the palette color
      // can apply per-card (mirrors following.js's pattern).
      const remaining = availableUntil
        ? formatTimeRemainingFuzzy(timeRemainingMs(availableUntil)).replace(/ left$/, '')
        : '';
      const text = remaining ? `Available for ${remaining}` : 'Available';
      statusEl.innerHTML = `<span class="status-available">${text}</span>`;
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
  if (PALETTES_ENABLED && palette && isAvailable) {
    li.style.background = palette.theme.surface;
    li.style.borderLeftColor = palette.color;
    if (statusEl) {
      statusEl.style.color = palette.theme.textMuted;
      const availableSpan = statusEl.querySelector('.status-available');
      if (availableSpan) availableSpan.style.color = palette.color;
    }
  } else {
    li.style.background = '';
    li.style.borderLeftColor = isAvailable && color ? safeCssColor(color) : '';
    if (statusEl) statusEl.style.color = '';
  }
  reorderRosterByAvailability();
}

function renderOwnStatusRow() {
  const dot = document.getElementById('group-my-dot');
  const label = document.getElementById('group-my-status-label');
  const timeRemaining = document.getElementById('group-time-remaining');
  const timeChip = document.getElementById('group-time-chip');
  const toggle = document.getElementById('group-override-toggle');
  if (!dot || !label) return;

  const overrideOn = !!(_ownOverride && _ownOverride.enabled === true);
  if (toggle) toggle.setAttribute('aria-pressed', overrideOn ? 'true' : 'false');

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
  // Color the "Available" label using --my-status so it matches the Direct
  // header (.status-label.available rule), regardless of which color is
  // active. Phase 4+ per-audience color picker will override --my-status
  // locally if it ships separate group palette state.
  label.classList.toggle('available', isAvailable);

  // Read-only mode applies the dot + chip dimming when override is OFF.
  dot.classList.toggle('readonly', !overrideOn);
  if (timeChip) timeChip.classList.toggle('readonly', !overrideOn);

  if (timeRemaining) {
    // null availableUntil means open-ended; no countdown to show
    if (isAvailable && availableUntil) {
      const formatted = formatTimeRemaining(timeRemainingMs(availableUntil));
      if (formatted) {
        timeRemaining.textContent = formatted + ' left';
        timeRemaining.style.display = '';
      } else {
        timeRemaining.style.display = 'none';
      }
    } else {
      timeRemaining.style.display = 'none';
    }
  }

  // Visibility: in Direct, when the user is Unavailable, #header-chips fades
  // out and #swatch-row fades in. Mirror that here for the group context —
  // when the user has an active override and is Unavailable, hide the
  // chip row and reveal the group swatch row. With override OFF, leave the
  // chip row visible (read-only) so the user can still reach Settings.
  const swatchRow = document.getElementById('group-swatch-row');
  const chipsContainer = document.querySelector('#group-context-root .group-header-chips');
  const showSwatch = PALETTES_ENABLED && overrideOn && !isAvailable;
  if (chipsContainer) chipsContainer.style.display = showSwatch ? 'none' : '';
  if (swatchRow) {
    swatchRow.style.display = showSwatch ? '' : 'none';
    if (showSwatch) renderGroupSwatchRow();
  }
}

// Per-group palette UI state (which set is active, are we in palette mode).
// Stored locally — these are view-state, not part of the override schema.
function getGroupPaletteState(groupId) {
  try {
    const raw = localStorage.getItem(`statusapp_group_palette_${groupId}`);
    if (raw) return { activeSet: 1, ...JSON.parse(raw) };
  } catch { /* ignore parse errors */ }
  return { activeSet: 1 };
}

function setGroupPaletteState(groupId, state) {
  try {
    localStorage.setItem(`statusapp_group_palette_${groupId}`, JSON.stringify(state));
  } catch { /* ignore quota errors */ }
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
  const currentPaletteKey = _ownOverride?.paletteKey || null;
  const currentColor = _ownOverride?.statusColor || null;
  // Mode is derived from override.paletteKey, not stored locally: paletteKey
  // set ⟺ palette mode. activeSet is the override's set when in palette
  // mode, otherwise the user-selected set from localStorage.
  let activeSet = state.activeSet;
  if (currentPaletteKey) {
    for (const setNum of [1, 2]) {
      if (PALETTE_SETS[setNum].some((p) => p.key === currentPaletteKey)) {
        activeSet = setNum;
        break;
      }
    }
  }
  const isPaletteMode = !!currentPaletteKey;

  // Set-toggle button (bolt = Set 1 / tree = Set 2). Toggling exits any
  // active palette mode (its paletteKey was for the OLD set).
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'set-toggle-btn';
  toggleBtn.innerHTML = activeSet === 1 ? ICON_BOLT : ICON_TREE;
  toggleBtn.addEventListener('click', () => {
    const nextSet = activeSet === 1 ? 2 : 1;
    setGroupPaletteState(_currentGroupId, { activeSet: nextSet });
    if (currentPaletteKey) {
      // Exit palette mode. Keep statusColor untouched — the user picked it
      // intentionally, and following.js's renderers will fall back to
      // primary.paletteKey for theming.
      _ownOverride = { ..._ownOverride, paletteKey: null };
      setOverrideAppearance(_currentGroupId, _currentUserId, { paletteKey: null }).catch(() => {});
    }
    applyEffectivePalette();
    renderGroupSwatchRow();
  });
  row.appendChild(toggleBtn);

  if (isPaletteMode) {
    const palette = getPaletteByKey(currentPaletteKey);
    if (!palette) return;
    const keyIdx = PALETTE_SETS[activeSet].findIndex((p) => p.key === palette.key);
    const complements = palette.complements;
    let ci = 0;
    for (let i = 0; i < 8; i++) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      if (i === keyIdx) {
        swatch.className = 'swatch key-swatch group-swatch';
        swatch.style.background = palette.color;
        swatch.dataset.paletteKey = palette.key;
        const keySelected = currentColor === palette.color;
        if (keySelected) swatch.classList.add('selected');
        swatch.addEventListener('click', () => {
          if (keySelected) {
            // Exit palette mode — clear paletteKey only, keep statusColor
            // so the user doesn't lose their pick. Optimistic local update
            // so the re-render reflects base mode without waiting on the
            // Firebase echo.
            _ownOverride = { ..._ownOverride, paletteKey: null };
            setOverrideAppearance(_currentGroupId, _currentUserId, { paletteKey: null }).catch(() => {});
            applyEffectivePalette();
            renderGroupSwatchRow();
          } else {
            // Reset statusColor to the palette's base color.
            _ownOverride = { ..._ownOverride, statusColor: palette.color };
            setOverrideAppearance(_currentGroupId, _currentUserId, { statusColor: palette.color }).catch(() => {});
            applyEffectivePalette();
            renderGroupSwatchRow();
          }
        });
      } else {
        const complementColor = complements[ci++];
        swatch.className = 'swatch group-swatch';
        swatch.style.background = complementColor;
        if (currentColor === complementColor) swatch.classList.add('selected');
        swatch.addEventListener('click', () => {
          _ownOverride = { ..._ownOverride, statusColor: complementColor };
          setOverrideAppearance(_currentGroupId, _currentUserId, { statusColor: complementColor }).catch(() => {});
          applyEffectivePalette();
          renderGroupSwatchRow();
        });
      }
      row.appendChild(swatch);
    }
  } else {
    // Base mode: 8 swatches in the active set. First tap writes only
    // statusColor (paletteKey stays null → theme inherits from primary).
    // Second tap on the selected swatch promotes to palette mode by
    // writing paletteKey.
    for (const palette of PALETTE_SETS[activeSet]) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch group-swatch';
      swatch.style.background = palette.color;
      swatch.dataset.paletteKey = palette.key;
      const selected = currentColor === palette.color;
      if (selected) swatch.classList.add('selected');
      swatch.addEventListener('click', () => {
        if (selected) {
          // Promote to palette mode for this palette.
          _ownOverride = { ..._ownOverride, paletteKey: palette.key };
          setOverrideAppearance(_currentGroupId, _currentUserId, { paletteKey: palette.key }).catch(() => {});
        } else {
          // Color-only change. Don't touch paletteKey.
          _ownOverride = { ..._ownOverride, statusColor: palette.color };
          setOverrideAppearance(_currentGroupId, _currentUserId, { statusColor: palette.color }).catch(() => {});
        }
        applyEffectivePalette();
        renderGroupSwatchRow();
      });
      row.appendChild(swatch);
    }
  }
}

// Apply the user's effective palette/theme to the document root vars while
// in group context. Effective values use override-first then primary-second
// for each of (statusColor, paletteKey) so a group-only color pick (base
// mode — no override.paletteKey) inherits the user's Direct theme rather
// than resetting it.
function applyEffectivePalette() {
  if (!PALETTES_ENABLED) return;
  const overrideOn = !!(_ownOverride && _ownOverride.enabled === true);
  const effectiveColor = (overrideOn ? _ownOverride.statusColor : null) || _ownPrimary?.statusColor || null;
  const effectiveKey = (overrideOn ? _ownOverride.paletteKey : null) || _ownPrimary?.paletteKey || null;
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
// last-known primary state from watchStatus.
function restorePrimaryPalette() {
  if (!PALETTES_ENABLED) return;
  const primaryKey = _ownPrimary?.paletteKey || null;
  const primaryColor = _ownPrimary?.statusColor || null;
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

function syncStatusSubscriptions(memberUids) {
  for (const uid of Array.from(_statusUnsubs.keys())) {
    if (!memberUids.has(uid)) {
      _statusUnsubs.get(uid)();
      _statusUnsubs.delete(uid);
      _memberPrimaries.delete(uid);
    }
  }
  for (const uid of memberUids) {
    if (!_statusUnsubs.has(uid)) {
      _statusUnsubs.set(uid, watchStatus(uid, (data) => {
        _memberPrimaries.set(uid, data
          ? {
              status: data.status,
              availableUntil: data.availableUntil ?? null,
              statusColor: data.statusColor || null,
              paletteKey: data.paletteKey || null,
            }
          : null);
        paintRosterRow(uid);
      }));
    }
  }
}

function closeSettingsMenu() {
  const details = document.getElementById('group-context-actions');
  if (details) details.open = false;
}

function installSettingsOutsideHandler() {
  if (_settingsOutsideHandler) return;
  _settingsOutsideHandler = (e) => {
    const details = document.getElementById('group-context-actions');
    if (!details || !details.open) return;
    if (details.contains(e.target)) return;
    details.open = false;
  };
  document.addEventListener('click', _settingsOutsideHandler);
}

function uninstallSettingsOutsideHandler() {
  if (!_settingsOutsideHandler) return;
  document.removeEventListener('click', _settingsOutsideHandler);
  _settingsOutsideHandler = null;
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

  // Handlers. Each handler closes the Settings details menu on activation
  // so the user doesn't have to tap Settings again to dismiss it.
  document.getElementById('group-action-rename').addEventListener('click', async () => {
    closeSettingsMenu();
    const next = window.prompt('New group name', groupName || '');
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    try { await renameGroup(groupId, userId, trimmed); } catch (e) { window.alert(e.message); }
  });

  document.getElementById('group-action-invite').addEventListener('click', () => {
    closeSettingsMenu();
    openInviteModal({
      scope: 'group',
      userId,
      groupId,
      groupName: groupName || groupId,
      activeInvite: _activeGroupInvite,
    });
  });

  document.getElementById('group-action-delete').addEventListener('click', async () => {
    closeSettingsMenu();
    if (!window.confirm(`Delete '${groupName || 'this group'}'? This cannot be undone.`)) return;
    try {
      await deleteGroup(groupId, userId);
      await navigateToDirect();
    } catch (e) { window.alert(e.message); }
  });

  document.getElementById('group-action-edit-name').addEventListener('click', async () => {
    closeSettingsMenu();
    const next = window.prompt('Your name in this group', _ownDisplayName || '');
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    try { await editOwnDisplayName(groupId, userId, trimmed); } catch (e) { window.alert(e.message); }
  });

  document.getElementById('group-action-leave').addEventListener('click', async () => {
    closeSettingsMenu();
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

  // Clear any pending unread-knock badge for this group
  clearGroupCardBadge(groupId);

  // Dismiss the Settings details menu when the user taps anywhere outside it.
  installSettingsOutsideHandler();

  // Subscribe to group members for the roster
  if (_membersUnsub) _membersUnsub();
  _statusUnsubs.forEach((fn) => fn());
  _statusUnsubs.clear();
  _memberPrimaries.clear();
  _membersOverrides = {};
  let drainedKnocksOnEntry = false;
  _membersUnsub = watchGroupMembers(groupId, (members) => {
    _membersOverrides = {};
    for (const [uid, m] of Object.entries(members || {})) {
      _membersOverrides[uid] = m.statusOverride || null;
    }
    _ownDisplayName = members?.[userId]?.displayName || null;
    renderRoster(members, userId);
    syncStatusSubscriptions(new Set(Object.keys(members || {})));
    // Re-paint each row to reflect the merged override+primary.
    for (const uid of Object.keys(members || {})) {
      paintRosterRow(uid);
    }
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
      ? {
          status: data.status,
          availableUntil: data.availableUntil ?? null,
          statusColor: data.statusColor || null,
          paletteKey: data.paletteKey || null,
        }
      : null;
    if (data?.lastTimeoutMinutes) {
      const idx = chipIndexForMinutes(data.lastTimeoutMinutes);
      const chipEl = document.getElementById('group-time-chip');
      if (chipEl && chipEl.textContent !== CHIP_VALUES[idx].text) {
        chipEl.textContent = CHIP_VALUES[idx].text;
      }
    }
    // Re-apply effective theme: a primary-side palette change (e.g. another
    // device picked a different Direct theme) would otherwise have been
    // written to root by app.js's watchStatus, clobbering our group-context
    // override theme.
    applyEffectivePalette();
    renderOwnStatusRow();
  });
  _ownOverrideUnsub = watchOwnMemberOverride(groupId, userId, (data) => {
    _ownOverride = data || null;
    applyEffectivePalette();
    renderOwnStatusRow();
  });

  // The chain-icon override toggle lives in the nav row and is fully owned by
  // js/groupNav.js (rendered into the row each time renderNavRow fires). No
  // install handoff here.

  // Wire the dot (clone-and-replace per the same pattern)
  const dot = document.getElementById('group-my-dot');
  if (dot) {
    const dotClone = dot.cloneNode(true);
    dot.parentNode.replaceChild(dotClone, dot);
    dotClone.addEventListener('click', () => {
      const overrideOn = !!(_ownOverride && _ownOverride.enabled === true);
      if (!overrideOn) return;  // read-only when toggle is OFF
      const currentlyAvailable = _ownOverride.status === 'available'
        && (_ownOverride.availableUntil == null || _ownOverride.availableUntil > Date.now());
      if (currentlyAvailable) {
        _ownOverride = { enabled: true, status: 'unavailable', availableUntil: null };
        renderOwnStatusRow();
        setOverrideStatusUnavailable(groupId, userId).catch(() => {});
      } else {
        // Read minutes via the chip-index lookup so we apply the same
        // legacy <=12 → *60 migration that js/me.js applies. Reading
        // getLastTimeout() raw and multiplying by 60000 treats a new-user
        // default of "2" as 2 minutes instead of 2 hours.
        const minutes = CHIP_VALUES[chipIndexForMinutes(getLastTimeout())].minutes;
        const availableUntil = Date.now() + minutes * 60000;
        _ownOverride = { enabled: true, status: 'available', availableUntil };
        renderOwnStatusRow();
        setOverrideStatusAvailable(groupId, userId, availableUntil).catch(() => {});
      }
    });
  }

  // Wire the time chip (clone-and-replace; cycles override duration when ON+available)
  const timeChip = document.getElementById('group-time-chip');
  if (timeChip) {
    timeChip.textContent = CHIP_VALUES[chipIndexForMinutes(getLastTimeout())].text;
    const chipClone = timeChip.cloneNode(true);
    timeChip.parentNode.replaceChild(chipClone, timeChip);
    chipClone.addEventListener('click', () => {
      const overrideOn = !!(_ownOverride && _ownOverride.enabled === true);
      if (!overrideOn) return;
      // Cycle the default duration regardless of whether the user is currently
      // available. If they're available, also push the new availableUntil to
      // the override. If they're unavailable, the new default applies the next
      // time they tap the dot to go available.
      const currentIdx = chipIndexForMinutes(getLastTimeout());
      const nextIdx = (currentIdx + 1) % CHIP_VALUES.length;
      const { minutes, text } = CHIP_VALUES[nextIdx];
      chipClone.textContent = text;
      setLastTimeout(minutes);
      setLastTimeoutMinutes(userId, minutes).catch(() => {});
      const currentlyAvailable = _ownOverride.status === 'available'
        && (_ownOverride.availableUntil == null || _ownOverride.availableUntil > Date.now());
      if (currentlyAvailable) {
        const availableUntil = Date.now() + minutes * 60000;
        _ownOverride = { enabled: true, status: 'available', availableUntil };
        renderOwnStatusRow();
        setOverrideStatusAvailable(groupId, userId, availableUntil).catch(() => {});
      }
    });
  }

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
    const isOwner = meta.ownerId === userId;
    wireActions(groupId, userId, isOwner, meta.name);
  });
}

export function exitGroupContext() {
  // Restore the user's Direct (primary) theme BEFORE we clear _ownPrimary —
  // otherwise the group's override theme stays on root vars until app.js's
  // next watchStatus tick happens to write something different.
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
  _currentGroupId = null;
  _currentUserId = null;
  _activeGroupInvite = null;
  closeSettingsMenu();
  uninstallSettingsOutsideHandler();
  const root = document.getElementById('group-context-root');
  const direct = document.getElementById('main-ui-direct');
  if (root) root.classList.add('hidden');
  if (direct) direct.classList.remove('hidden');
}

export function getCurrentGroupId() { return _currentGroupId; }

/**
 * Apply an optimistic override update from elsewhere (e.g. the chain-icon
 * toggle in groupNav.js, which lives outside this module's DOM scope but
 * needs to keep _ownOverride in sync so the dot/chip click handlers here
 * see the latest state before Firebase round-trips back).
 */
export function applyOptimisticOverride(override) {
  _ownOverride = override || null;
  renderOwnStatusRow();
}
