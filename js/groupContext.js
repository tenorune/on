// js/groupContext.js
// Group context view: own-status header band + roster.
// The group name and back-to-Direct affordance live in the persistent nav row
// (js/groupNav.js), not in this view. This module handles enter/exit, the
// own-status row, the chain-icon override toggle (installed into the nav row's
// slot), and the member roster.

import { watchGroupMeta, watchGroupMembers, watchGroupInvites, watchStatus, watchOwnMemberOverride, removeUserGroupsEntry, formatTimeRemaining, formatTimeRemainingFuzzy, timeRemainingMs } from './db.js';
import { safeCssColor } from './utils.js';
import { navigateToDirect, applyOptimisticAppearance } from './groupNav.js';
import { renameGroup, deleteGroup, leaveGroup, editOwnDisplayName,
         setOverrideStatusAvailable, setOverrideStatusUnavailable,
         setOverrideAppearance } from './groups.js';
import {
  getPaletteState,
  getLastTimeout, setLastTimeout,
  getGroupChipMinutes, setGroupChipMinutes,
  getGroupPaletteState, setGroupPaletteState,
  isHintSeen, markHintSeen,
} from './prefs.js';
import { saveCombo, buildAdoptedCombo } from './favorites.js';
import { openInviteModal } from './inviteModal.js';
import { buildInviteUrl } from './invites.js';
import { sendKnock, clearGroupCardBadge, drainPendingKnocks, getFloatedUserIds } from './knock.js';
import { KNOCK_ENABLED, PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED, NOTIFICATIONS_ENABLED } from './features.js';
import { createNotifyBell } from './notifyBell.js';
import { ensureNotificationsReady } from './notifyPrompt.js';
import { getPaletteByKey, getGlowForColor, applyPaletteVars, applyThemeVars, resetThemeVars, PALETTE_SETS, ICON_BOLT, ICON_TREE, startSwatchHints } from './palettes.js';
import {
  shouldShowThemeHint, shouldShowDotGoHint, shouldShowSetTogglePulse,
  isLongpressHintEligible,
} from './hints.js';
import { clearFirstUsePulse } from './me.js';

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
// Timestamp of the most recent group palette-mode entry, or null. Tracked as
// a timestamp (not a one-shot bool) because setOverrideAppearance writes to
// RTDB and watchOwnMemberOverride echoes back ~100-300ms later, calling
// renderOwnStatusRow → renderGroupSwatchRow and destroying the just-rendered
// key-spin element. The timestamp lets each subsequent render within the 5s
// window re-apply .key-spin with a CSS --key-spin-delay so the animation
// resumes mid-flight rather than restarting from 0deg.
const KEY_SPIN_MS = 5000;
let _groupPaletteEnterAt = null;

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

    if (NOTIFICATIONS_ENABLED && uid !== ownUserId) {
      // Group context has no Call feature; you can knock members and see their
      // availability — so no Call toggle.
      const bell = createNotifyBell(uid, {
        types: ['knock', 'availability'],
        onNeedPermission: () => { ensureNotificationsReady().catch(() => {}); },
      });
      li.appendChild(bell);
    }

    if (KNOCK_ENABLED) {
      li.classList.add('knockable');
      li.addEventListener('click', (e) => {
        // The per-member notification bell lives inside this row. It stops its
        // own click propagation, but guard here too so a bell tap can never
        // knock even if that propagation is defeated (stale shell, synthetic
        // events, the body-portaled popover). Taps on the bell or its popover
        // manage notification prefs only — never a knock.
        if (e.target.closest('.notify-bell') || e.target.closest('.notify-popover')) return;
        sendKnock(uid, ownUserId, undefined, { contextGroupId: getCurrentGroupId() });
      });
    }

    if (PALETTES_ENABLED && PALETTE_INTERACTIONS_ENABLED && uid !== ownUserId) {
      let pressTimer = null;
      let pressStartX, pressStartY;
      let suppressNextClick = false;

      li.addEventListener('pointerdown', (e) => {
        // A press that starts on the notification bell drives the bell, not the
        // row's long-press adoption (the bell only stops click propagation, not
        // pointerdown). Without this, holding the bell would adopt the member's
        // palette.
        if (e.target.closest('.notify-bell')) return;
        if (!_ownOverride?.enabled) return;
        clearTimeout(pressTimer); pressTimer = null;
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
          clearTimeout(pressTimer); pressTimer = null;
        }
      });
      ['pointerup', 'pointercancel'].forEach(ev =>
        li.addEventListener(ev, () => { clearTimeout(pressTimer); pressTimer = null; })
      );
      li.addEventListener('click', (e) => {
        if (suppressNextClick) { suppressNextClick = false; e.stopImmediatePropagation(); }
      }, true);
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
  // Effective values: override-on means "independent in this group" — pull
  // every field (status/availableUntil/color/paletteKey) exclusively from
  // the override. No per-field fall-through to primary, otherwise a member
  // who chose to not theme their group card (override.paletteKey null)
  // would still pick up their Direct theme. Override-off: primary wins
  // for every field (the group is linked to Direct).
  const status = overrideOn ? (override.status || 'unavailable') : (primary?.status || 'unavailable');
  const availableUntil = (overrideOn ? override.availableUntil : primary?.availableUntil) ?? null;
  const isAvailable = status === 'available' && (availableUntil == null || availableUntil > Date.now());
  const color = overrideOn ? (override.statusColor || null) : (primary?.statusColor || null);
  const paletteKey = overrideOn ? (override.paletteKey || null) : (primary?.paletteKey || null);
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
      // can apply per-card (mirrors following.js's pattern). Inline the
      // statusColor in the span so a member with statusColor but no
      // paletteKey still gets the right text color — without the inline
      // style, the CSS rule (.status-available → var(--green)) wins and
      // the fuzzy time renders forest green.
      const remaining = availableUntil
        ? formatTimeRemainingFuzzy(timeRemainingMs(availableUntil)).replace(/ left$/, '')
        : '';
      const text = remaining ? `Available for ${remaining}` : 'Available';
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
  if (PALETTES_ENABLED && palette && isAvailable) {
    li.style.background = palette.theme.surface;
    li.style.borderLeftColor = palette.color;
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
    li.style.borderLeftColor = isAvailable && color ? safeCssColor(color) : '';
    if (statusEl) statusEl.style.color = '';
  }
  // FTU longpress hint pulse — mirrors following.js's pattern. Shows the
  // ".longpress-hint" text on each available member whose combo differs
  // from the user's current group-effective combo. Gated on:
  // (a) PALETTE_INTERACTIONS_ENABLED
  // (b) the rest of the FTU chain has progressed (customAvail + theme +
  //     stripPeek all marked seen)
  // (c) override is ON for this group — otherwise long-press is a no-op
  // (d) member is available
  // (e) member's combo differs from user's (no point adopting your own combo)
  // (f) longpress hint not yet seen
  if (PALETTE_INTERACTIONS_ENABLED) {
    const showHint = isLongpressHintEligible()
      && _ownOverride?.enabled === true
      && isAvailable
      && (color !== (_ownOverride?.statusColor || null) || paletteKey !== (_ownOverride?.paletteKey || null));
    const existing = li.querySelector('.longpress-hint');
    if (!showHint && existing) {
      existing.remove();
    } else if (showHint && !existing) {
      const hint = document.createElement('div');
      hint.className = 'longpress-hint';
      li.style.position = 'relative';
      li.appendChild(hint);
    }
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
  // Toggle visibility via opacity (NOT display:none) so the chip row and
  // swatch row keep co-occupying the same grid cell — the header height
  // stays constant across Available / Unavailable just like in Direct.
  const swatchRow = document.getElementById('group-swatch-row');
  const chipsContainer = document.querySelector('#group-context-root .group-header-chips');
  const showSwatch = PALETTES_ENABLED && overrideOn && !isAvailable;
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
// watchOwnMemberOverride fires (cross-device sync) and on enter so the
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
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'set-toggle-btn';
  toggleBtn.innerHTML = activeSet === 1 ? ICON_BOLT : ICON_TREE;
  // FTU hint pulse — same logic as Direct's #swatch-row set-toggle. The hint
  // is set-specific (bolt vs flower), and the persistent flag is shared with
  // Direct so clearing it in either context clears it everywhere.
  const hintName = activeSet === 1 ? 'bolt' : 'flower';
  if (shouldShowSetTogglePulse(activeSet)) {
    toggleBtn.classList.add('first-use-pulse');
    toggleBtn.addEventListener('click', () => {
      toggleBtn.classList.remove('first-use-pulse');
      markHintSeen(hintName);
    }, { once: true });
  }
  toggleBtn.addEventListener('click', () => {
    const nextSet = activeSet === 1 ? 2 : 1;
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
      const swatch = document.createElement('button');
      swatch.type = 'button';
      if (i === keyIdx) {
        swatch.className = 'swatch key-swatch group-swatch';
        if (_groupPaletteEnterAt != null) {
          const elapsed = Date.now() - _groupPaletteEnterAt;
          if (elapsed < KEY_SPIN_MS) {
            swatch.classList.add('key-spin');
            if (elapsed > 0) swatch.style.setProperty('--key-spin-delay', `-${elapsed}ms`);
          } else {
            _groupPaletteEnterAt = null;
          }
        }
        swatch.style.background = palette.color;
        swatch.dataset.paletteKey = palette.key;
        const keySelected = currentColor === palette.color;
        if (keySelected) swatch.classList.add('selected');
        swatch.addEventListener('click', () => {
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
        });
      } else {
        const complementColor = complements[ci++];
        swatch.className = 'swatch group-swatch';
        swatch.style.background = complementColor;
        if (currentColor === complementColor) swatch.classList.add('selected');
        swatch.addEventListener('click', () => {
          const newState = getGroupPaletteState(_currentGroupId);
          newState.sets[String(newState.activeSet)].selectedColor = complementColor;
          setGroupPaletteState(_currentGroupId, newState);
          _ownOverride = { ..._ownOverride, statusColor: complementColor };
          setOverrideAppearance(_currentGroupId, _currentUserId, { statusColor: complementColor }).catch(() => {});
          applyEffectivePalette();
          renderGroupSwatchRow();
        });
      }
      row.appendChild(swatch);
    }
  } else {
    // Base mode: 8 swatches in the active set. Selection follows the per-set
    // selectedKey (defaults: forest for Set 1, volt for Set 2). First tap
    // writes only statusColor; second tap on the selected swatch promotes
    // to palette mode by writing paletteKey.
    for (const palette of PALETTE_SETS[activeSet]) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch group-swatch';
      swatch.style.background = palette.color;
      swatch.dataset.paletteKey = palette.key;
      const selected = palette.key === selectedKey;
      if (selected) swatch.classList.add('selected');
      swatch.addEventListener('click', () => {
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
      });
      row.appendChild(swatch);
    }
    // Theme hint: pulsing dotted ring on the selected swatch once the user
    // has gone Available with a custom color but hasn't yet entered palette
    // mode anywhere — mirrors palettes.js's base-mode theme-hint logic.
    if (shouldShowThemeHint()) {
      const selectedSwatch = row.querySelector('.swatch.selected');
      if (selectedSwatch) selectedSwatch.classList.add('theme-hint');
    }
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
  const status = overrideOn ? _ownOverride?.status : _ownPrimary?.status;
  const availableUntil = overrideOn ? _ownOverride?.availableUntil : _ownPrimary?.availableUntil;
  const isAvailable = status === 'available' && (availableUntil == null || availableUntil > Date.now());
  // overrideOn is the group-context-specific guard — without override ON the
  // group dot is read-only, so nudging the user to tap it is wrong.
  const shouldHint = overrideOn && shouldShowDotGoHint({ isNonDefault, dotAvailable: isAvailable });
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
    ? (_ownOverride.statusColor || null)
    : getDirectPrimaryStatusColor();
  const effectiveKey = overrideOn
    ? (_ownOverride.paletteKey || null)
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
// last-known primary state from watchStatus.
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

// Listeners registered once at module load; react to sibling-device
// userPrefs sync ticks affecting this group while it's visible.
let _groupSyncListenersInstalled = false;
function installGroupSyncListeners() {
  if (_groupSyncListenersInstalled) return;
  _groupSyncListenersInstalled = true;
  document.addEventListener('group-palette-state-synced', (e) => {
    if (!_currentGroupId) return;
    if (e.detail?.groupId !== _currentGroupId) return;
    renderGroupSwatchRow();
  });
  document.addEventListener('group-chip-minutes-synced', (e) => {
    if (!_currentGroupId) return;
    if (e.detail?.groupId !== _currentGroupId) return;
    // Only re-render the chip from this event when override is ON — when
    // override is OFF the chip mirrors Direct's value, not the per-group one.
    if (!_ownOverride?.enabled) return;
    const minutes = e.detail.minutes;
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
}

export function enterGroupContext(groupId, userId) {
  if (_metaUnsub) _metaUnsub();
  _currentGroupId = groupId;
  _currentUserId = userId;
  installGroupSyncListeners();

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
    // Per-group chip default is local-only for now (statusapp_group_chip_${groupId})
    // — it was previously synced through users/{uid}/lastTimeoutMinutes, which
    // leaked the group chip pick into Direct (and vice versa). Cross-device sync
    // of the per-group chip lands with the userPrefs/ migration.
    // Re-apply effective theme: a primary-side palette change (e.g. another
    // device picked a different Direct theme) would otherwise have been
    // written to root by app.js's watchStatus, clobbering our group-context
    // override theme.
    applyEffectivePalette();
    renderOwnStatusRow();
  });
  _ownOverrideUnsub = watchOwnMemberOverride(groupId, userId, (data) => {
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
        _ownOverride = { ..._ownOverride, statusColor: seed };
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
    dot.parentNode.replaceChild(dotClone, dot);
    // The clone-and-replace above wipes any FTU once-listener me.js installed.
    // Re-install so tapping the group dot terminates the first-use pulse — same
    // contract as the Direct dot.
    dotClone.addEventListener('click', clearFirstUsePulse, { once: true });
    dotClone.addEventListener('click', () => {
      const overrideOn = !!(_ownOverride && _ownOverride.enabled === true);
      if (!overrideOn) return;  // read-only when toggle is OFF
      const currentlyAvailable = _ownOverride.status === 'available'
        && (_ownOverride.availableUntil == null || _ownOverride.availableUntil > Date.now());
      if (currentlyAvailable) {
        // Spread instead of replace — otherwise the optimistic update
        // strips statusColor + paletteKey until the watch echo restores
        // them, and the dot briefly falls back to --my-status (i.e. the
        // user's Direct color).
        _ownOverride = { ..._ownOverride, status: 'unavailable', availableUntil: null };
        renderOwnStatusRow();
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
        // Spread preserves statusColor/paletteKey across the optimistic
        // update — see the unavailable branch above for why.
        _ownOverride = { ..._ownOverride, status: 'available', availableUntil };
        renderOwnStatusRow();
        // Push the going-active combo to favorites — this is a real
        // unavailable→available transition with the user's committed
        // group-effective color + palette.
        saveCombo(buildGroupCombo({
          ownOverride: _ownOverride,
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
    timeChip.parentNode.replaceChild(chipClone, timeChip);
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
      const currentlyAvailable = _ownOverride.status === 'available'
        && (_ownOverride.availableUntil == null || _ownOverride.availableUntil > Date.now());
      if (currentlyAvailable) {
        const availableUntil = Date.now() + minutes * 60000;
        // Spread preserves statusColor/paletteKey across the optimistic
        // update.
        _ownOverride = { ..._ownOverride, status: 'available', availableUntil };
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
export function applyAdoptedComboInGroup(adoptedColor, adoptedPaletteKey) {
  const groupId = _currentGroupId;
  if (!groupId || !_ownOverride?.enabled || !_currentUserId) return;

  // Optimistic local mutation.
  const newOverride = { ..._ownOverride, statusColor: adoptedColor, paletteKey: adoptedPaletteKey };
  applyOptimisticOverride(newOverride);   // _ownOverride + renderOwnStatusRow
  applyEffectivePalette();                // CSS vars in group context
  applyOptimisticAppearance(groupId, { statusColor: adoptedColor, paletteKey: adoptedPaletteKey });

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

function triggerGroupAdoption(srcUid, ownUid) {
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
  if (!isHintSeen('longpress')) markHintSeen('longpress');

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
export function buildGroupCombo({ ownOverride, ownPrimary, paletteState }) {
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
