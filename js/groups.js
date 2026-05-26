// js/groups.js
// Group lifecycle business logic. Composes db.js primitives.

import {
  claimGroupId, writeGroup, writeMember, writeUserGroupsEntry,
  removeMember, removeUserGroupsEntry, deleteGroup as dbDeleteGroup,
  renameGroup as dbRenameGroup, setMemberDisplayName,
  readGroup, readMember, readMembers,
  setLastVisited, setCurrentContext,
} from './db.js';

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
