// js/groups.js
// Group lifecycle business logic. Composes db.js primitives.

import {
  claimGroupId, writeGroup, writeMember, writeUserGroupsEntry,
  removeMember, removeUserGroupsEntry, deleteGroup as dbDeleteGroup,
  renameGroup as dbRenameGroup, setMemberDisplayName,
  readGroup, readMember, readMembers,
  setLastVisited, setCurrentContext,
  watchUserGroups,
  setStatusOverride, clearStatusOverride,
} from './db.js';
import { navigateToDirect, getCurrentContext, getLastKnownGroupName } from './groupNav.js';

const NAME_MAX = 40;
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function validateName(raw, field = 'Name') {
  if (typeof raw !== 'string') throw new Error(`${field} must be a string.`);
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new Error(`${field} cannot be empty.`);
  if (trimmed.length > NAME_MAX) throw new Error(`${field} must be at most ${NAME_MAX} chars.`);
  return trimmed;
}

function generateGroupId() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

export async function createGroup(ownerUid, nameRaw, ownerDisplayNameRaw) {
  const name = validateName(nameRaw, 'Group name');
  const ownerDisplayName = validateName(ownerDisplayNameRaw, 'Display name');

  let groupId;
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
  });
  await writeUserGroupsEntry(ownerUid, groupId, { lastVisited: now });

  return { groupId, name };
}

async function requireOwner(groupId, callerUid) {
  const group = await readGroup(groupId);
  if (!group) return null;
  if (group.ownerId !== callerUid) throw new Error('Only the owner can do that.');
  return group;
}

async function refuseOwner(groupId, callerUid) {
  const group = await readGroup(groupId);
  if (!group) return null;
  if (group.ownerId === callerUid) throw new Error('The owner cannot leave the group. Delete it instead.');
  return group;
}

export async function renameGroup(groupId, callerUid, newNameRaw) {
  const name = validateName(newNameRaw, 'Group name');
  const group = await requireOwner(groupId, callerUid);
  if (!group) return;
  await dbRenameGroup(groupId, name);
}

export async function deleteGroup(groupId, callerUid) {
  const group = await requireOwner(groupId, callerUid);
  if (!group) return;
  await dbDeleteGroup(groupId);
  await removeUserGroupsEntry(callerUid, groupId);
  // Members' own enumeration entries are cleaned up by their own apps' deletion-detection
  // mechanism (Task 18); we cannot reach into their user records from here.
}

export async function leaveGroup(groupId, callerUid) {
  const group = await refuseOwner(groupId, callerUid);
  if (!group) return;
  await removeMember(groupId, callerUid);
  await removeUserGroupsEntry(callerUid, groupId);
}

export async function joinGroup(groupId, joinerUid, displayNameRaw) {
  const displayName = validateName(displayNameRaw, 'Display name');
  const group = await readGroup(groupId);
  if (!group) throw new Error('Group not found.');

  const existing = await readMember(groupId, joinerUid);
  const now = Date.now();
  if (!existing) {
    await writeMember(groupId, joinerUid, {
      role: 'member',
      displayName,
      joinedAt: now,
    });
  }
  // Always bump lastVisited so the group surfaces at the top of the joiner's cards row.
  await writeUserGroupsEntry(joinerUid, groupId, { lastVisited: now });
}

export async function editOwnDisplayName(groupId, callerUid, newNameRaw) {
  const displayName = validateName(newNameRaw, 'Display name');
  await setMemberDisplayName(groupId, callerUid, displayName);
}

let _prevEnum = null;
let _detectorUnsub = null;

export function initGroupRemovalDetector(myUserId) {
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

  const dismissBtn = document.getElementById('group-removal-toast-dismiss');
  if (dismissBtn && !dismissBtn._wired) {
    dismissBtn._wired = true;
    dismissBtn.addEventListener('click', () => {
      document.getElementById('group-removal-toast').classList.add('hidden');
    });
  }
}

async function handleGroupRemoval(myUserId, groupId) {
  const group = await readGroup(groupId);
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

function showRemovalToast(message) {
  const el = document.getElementById('group-removal-toast');
  const txt = document.getElementById('group-removal-toast-text');
  if (!el || !txt) return;
  txt.textContent = message;
  el.classList.remove('hidden');

  // Wire dismiss button on first render
  const dismissBtn = document.getElementById('group-removal-toast-dismiss');
  if (dismissBtn && !dismissBtn._wired) {
    dismissBtn._wired = true;
    dismissBtn.addEventListener('click', () => el.classList.add('hidden'));
  }
}

// Test helpers — exported only for tests.
export function _resetGroupRemovalDetectorForTests() {
  if (_detectorUnsub) _detectorUnsub();
  _detectorUnsub = null;
  _prevEnum = null;
  const btn = document.getElementById('group-removal-toast-dismiss');
  if (btn) delete btn._wired;
}

export async function _feedSnapshotForTests(snapshot) {
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
export async function toggleStatusOverride(groupId, userId, nextEnabled) {
  if (nextEnabled) {
    await setStatusOverride(groupId, userId, {
      enabled: true,
      status: 'unavailable',
      availableUntil: null,
    });
  } else {
    await clearStatusOverride(groupId, userId);
  }
}

export async function setOverrideStatusAvailable(groupId, userId, availableUntil) {
  await setStatusOverride(groupId, userId, {
    enabled: true,
    status: 'available',
    availableUntil,
  });
}

export async function setOverrideStatusUnavailable(groupId, userId) {
  await setStatusOverride(groupId, userId, {
    enabled: true,
    status: 'unavailable',
    availableUntil: null,
  });
}
