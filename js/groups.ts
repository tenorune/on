// js/groups.ts
// Group lifecycle business logic. Composes db.js primitives.

import {
  claimGroupId, writeGroup, writeMember, writeUserGroupsEntry,
  removeMember, removeUserGroupsEntry, deleteGroup as dbDeleteGroup,
  renameGroup as dbRenameGroup, setMemberDisplayName,
  readGroup, readGroupName, readMember,
  watchUserGroups,
  mergeStatusOverride,
  readPendingInviteesForGroup, deletePendingInvite,
} from './db.js';
import { navigateToDirect, getCurrentContext, getLastKnownGroupName } from './groupNav.js';
import { clearGroupPaletteState } from './prefs.js';

const NAME_MAX = 40;
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// The toast/dismiss elements stash a one-shot `_wired` flag on the DOM node to
// avoid double-binding the click handler; not part of the lib DOM types.
type WiredEl = HTMLElement & { _wired?: boolean };

function validateName(raw: unknown, field = 'Name'): string {
  if (typeof raw !== 'string') throw new Error(`${field} must be a string.`);
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new Error(`${field} cannot be empty.`);
  if (trimmed.length > NAME_MAX) throw new Error(`${field} must be at most ${NAME_MAX} chars.`);
  return trimmed;
}

export function generateGroupId() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

export async function createGroup(ownerUid: string, nameRaw: unknown, ownerDisplayNameRaw: unknown) {
  const name = validateName(nameRaw, 'Group name');
  const ownerDisplayName = validateName(ownerDisplayNameRaw, 'Display name');

  // Initialized to '' only to satisfy the checker's definite-assignment analysis
  // (it can't see that the claim loop always runs once); the value is always
  // overwritten before use, or the !claimed guard below throws.
  let groupId = '';
  let claimed = false;
  for (let attempt = 0; attempt < 8 && !claimed; attempt += 1) {
    groupId = generateGroupId();
    claimed = await claimGroupId(groupId);
  }
  if (!claimed) throw new Error('Could not allocate a group id. Try again.');

  const now = Date.now();
  await writeGroup(groupId, { name, ownerId: ownerUid, createdAt: now });
  await writeMember(groupId, ownerUid, {
    role: 'owner',
    displayName: ownerDisplayName,
    joinedAt: now,
    // Default override ON + Available for 2h so the owner is immediately
    // visible to other group members. They can flip the override off via
    // the nav toggle if they prefer to broadcast their primary status, or
    // tap the dot to go unavailable.
    statusOverride: { enabled: true, status: 'available', availableUntil: now + 2 * 60 * 60 * 1000 },
  });
  await writeUserGroupsEntry(ownerUid, groupId, { lastVisited: now });

  return { groupId, name };
}

async function requireOwner(groupId: string, callerUid: string) {
  const group = await readGroup(groupId);
  if (!group) return null;
  if (group.ownerId !== callerUid) throw new Error('Only the owner can do that.');
  return group;
}

async function refuseOwner(groupId: string, callerUid: string) {
  const group = await readGroup(groupId);
  if (!group) return null;
  if (group.ownerId === callerUid) throw new Error('The owner cannot leave the group. Delete it instead.');
  return group;
}

export async function renameGroup(groupId: string, callerUid: string, newNameRaw: unknown) {
  const name = validateName(newNameRaw, 'Group name');
  const group = await requireOwner(groupId, callerUid);
  if (!group) return;
  await dbRenameGroup(groupId, name);
}

export async function deleteGroup(groupId: string, callerUid: string) {
  const group = await requireOwner(groupId, callerUid);
  if (!group) return;
  // Sweep pending invites for this group BEFORE the entity itself is gone,
  // so any concurrent Join attempt against a stale invite sees the group
  // missing and silently dismisses (see Inbox accept flow, Task 11).
  const pendingInvitees = await readPendingInviteesForGroup(groupId);
  await Promise.all(pendingInvitees.map((inviteeUid) =>
    deletePendingInvite(inviteeUid, groupId)
  ));
  await dbDeleteGroup(groupId);
  await removeUserGroupsEntry(callerUid, groupId);
  // Members' own enumeration entries are cleaned up by their own apps' deletion-detection
  // mechanism (Task 18); we cannot reach into their user records from here.
}

export async function leaveGroup(groupId: string, callerUid: string) {
  const group = await refuseOwner(groupId, callerUid);
  if (!group) return;
  await removeMember(groupId, callerUid);
  await removeUserGroupsEntry(callerUid, groupId);
}

export async function joinGroup(
  groupId: string,
  joinerUid: string,
  displayNameRaw: unknown,
  opts: { group?: unknown; existing?: unknown } = {},
) {
  const displayName = validateName(displayNameRaw, 'Display name');
  // Allow callers that have already fetched these (e.g. redeemGroupInvite) to
  // skip the duplicate reads. Use `in` so explicit `undefined` falls back to a
  // read, but explicit `null` (meaning "we checked and the row is absent")
  // skips the read.
  const group = ('group' in opts) ? opts.group : await readGroup(groupId);
  if (!group) throw new Error('Group not found.');

  const existing = ('existing' in opts) ? opts.existing : await readMember(groupId, joinerUid);
  const now = Date.now();
  if (!existing) {
    // Fresh membership: drop any per-group palette selection left over from a
    // PRIOR membership. The default override below carries no statusColor/
    // paletteKey, and groupContext seeds the color from the local per-group
    // palette state — a stale selection would seed an orphaned color (e.g. a
    // ROSE-palette WHITE with no theme), producing an impossible combo.
    clearGroupPaletteState(groupId);
    await writeMember(groupId, joinerUid, {
      role: 'member',
      displayName,
      joinedAt: now,
      // Default override ON + Available for 2h so the joiner is immediately
      // visible to other group members. They can flip the override off via
      // the nav toggle if they prefer to broadcast their primary status, or
      // tap the dot to go unavailable.
      statusOverride: { enabled: true, status: 'available', availableUntil: now + 2 * 60 * 60 * 1000 },
    });
  }
  // Always bump lastVisited so the group surfaces at the top of the joiner's cards row.
  await writeUserGroupsEntry(joinerUid, groupId, { lastVisited: now });
}

export async function editOwnDisplayName(groupId: string, callerUid: string, newNameRaw: unknown) {
  const displayName = validateName(newNameRaw, 'Display name');
  await setMemberDisplayName(groupId, callerUid, displayName);
}

let _prevEnum: Record<string, unknown> | null = null;
let _detectorUnsub: (() => void) | null = null;

export function initGroupRemovalDetector(myUserId: string) {
  if (_detectorUnsub) _detectorUnsub();
  _prevEnum = null;
  _detectorUnsub = watchUserGroups(myUserId, async (collection) => {
    const next = collection || {};
    if (_prevEnum === null) { _prevEnum = next; return; }
    const removed = Object.keys(_prevEnum).filter((id) => !next[id]);
    _prevEnum = next;
    for (const groupId of removed) {
      await handleGroupRemoval(myUserId, groupId);
    }
  });

  const dismissBtn = document.getElementById('group-removal-toast-dismiss') as WiredEl | null;
  if (dismissBtn && !dismissBtn._wired) {
    dismissBtn._wired = true;
    dismissBtn.addEventListener('click', () => {
      (document.getElementById('group-removal-toast') as HTMLElement).classList.add('hidden');
    });
  }
}

async function handleGroupRemoval(myUserId: string, groupId: string) {
  // Read the name LEAF, not the whole node: by the time the removal fires the
  // user is no longer a member (they left or were kicked), so the membership-
  // gated groups/{gid} whole-node read would be denied. The name leaf stays
  // readable, and a null result still means the group was deleted.
  const group = await readGroupName(groupId);
  let message;
  if (!group) {
    // Group entity is gone; fall back to the last name we saw before deletion.
    const cachedName = getLastKnownGroupName(groupId);
    message = `'${cachedName || groupId}' has been deleted.`;
  } else {
    message = `You've been removed from '${group.name}'.`;
  }
  showRemovalToast(message);

  const cur = getCurrentContext();
  if (cur.context === 'group' && cur.groupId === groupId) {
    await navigateToDirect();
  }
}

// One copy of the location-glyph denied-tap toast, shared by both glyph
// handlers (me.ts / groupContext.ts): with location denied at the OS level
// (e.g. iOS Safari Websites set to "Never") the tap otherwise reads as a
// silent no-op.
export const LOCATION_DENIED_TOAST =
  'Location permission is denied — allow location access for this app in your device settings.';

// Generic dismissable toast (the markup ids predate other consumers, hence
// group-removal-*). Also used by followRequests.js for the request/cancel
// confirmations.
export function showToast(message: string) {
  const el = document.getElementById('group-removal-toast');
  const txt = document.getElementById('group-removal-toast-text');
  if (!el || !txt) return;
  txt.textContent = message;
  el.classList.remove('hidden');

  // Wire dismiss button on first render
  const dismissBtn = document.getElementById('group-removal-toast-dismiss') as WiredEl | null;
  if (dismissBtn && !dismissBtn._wired) {
    dismissBtn._wired = true;
    dismissBtn.addEventListener('click', () => el.classList.add('hidden'));
  }
}

function showRemovalToast(message: string) {
  showToast(message);
}

/** test-only */
export function _resetGroupRemovalDetectorForTests() {
  if (_detectorUnsub) _detectorUnsub();
  _detectorUnsub = null;
  _prevEnum = null;
  const btn = document.getElementById('group-removal-toast-dismiss') as WiredEl | null;
  if (btn) delete btn._wired;
}

/** test-only */
export async function _feedSnapshotForTests(snapshot?: Record<string, unknown> | null) {
  const next = snapshot || {};
  if (_prevEnum === null) { _prevEnum = next; return; }
  const removed = Object.keys(_prevEnum).filter((id) => !next[id]);
  _prevEnum = next;
  for (const groupId of removed) {
    await handleGroupRemoval('me', groupId);
  }
}

// ── Phase 2: per-group status overrides ──────────────────────────────────────

// Note: Firebase RTDB set() strips null-valued keys on write. So a stored
// override of { enabled:true, status:'unavailable', availableUntil:null }
// reads back as { enabled:true, status:'unavailable' } — availableUntil is
// undefined, not null. All readers in this codebase use `?? null` or `== null`
// (loose) so this is accidentally correct, but be cautious about introducing
// strict-equality (`=== null`) checks against availableUntil.
// All four override mutators below merge into the existing record so the
// user's chosen statusColor + paletteKey persist across enable/disable and
// available/unavailable changes. RTDB drops null-valued keys from update()
// writes — that's how we clear status/availableUntil when toggling off.
export async function toggleStatusOverride(groupId: string, userId: string, nextEnabled: boolean) {
  if (nextEnabled) {
    await mergeStatusOverride(groupId, userId, {
      enabled: true,
      status: 'unavailable',
      availableUntil: null,
    });
  } else {
    await mergeStatusOverride(groupId, userId, {
      enabled: false,
      status: null,
      availableUntil: null,
    });
  }
}

export async function setOverrideStatusAvailable(groupId: string, userId: string, availableUntil: number) {
  await mergeStatusOverride(groupId, userId, {
    enabled: true,
    status: 'available',
    availableUntil,
  });
}

export async function setOverrideStatusUnavailable(groupId: string, userId: string) {
  await mergeStatusOverride(groupId, userId, {
    enabled: true,
    status: 'unavailable',
    availableUntil: null,
  });
}

// Used by the group-context palette picker. Writes only the keys the caller
// passes (using `in` rather than value-presence) so a single-field write —
// e.g. `{ statusColor: '#abc' }` for a complement-color tap — doesn't
// accidentally null out paletteKey. Pass null explicitly to remove a field.
export async function setOverrideAppearance(
  groupId: string,
  userId: string,
  fields: { statusColor?: string | null; paletteKey?: string | null },
) {
  const update: { statusColor?: string | null; paletteKey?: string | null } = {};
  if ('statusColor' in fields) update.statusColor = fields.statusColor;
  if ('paletteKey' in fields) update.paletteKey = fields.paletteKey;
  if (Object.keys(update).length === 0) return;
  await mergeStatusOverride(groupId, userId, update);
}
