// js/db/groups.js — Groups Firebase ops: user-side enumeration + ID allocation,
// entity CRUD + meta, members, per-group status overrides, group invites, the
// pending-invite mailbox, and follow requests/grants.
import { db } from '../firebase-config.js';
import {
  ref, set, get, update, onValue, remove, runTransaction, push,
} from 'firebase/database';

// ── Groups: user-side enumeration + ID allocation ─────────────────────────────
// users/{uid}/groups/{groupId} is the user's per-group enumeration record.
// In Phase 1 the only field is optional `lastVisited` (for cards-row ordering).
// groupIdIndex/{groupId} is a global existence lock for transactional allocation.

export async function claimGroupId(groupId) {
  const indexRef = ref(db, `groupIdIndex/${groupId}`);
  const result = await runTransaction(indexRef, (current) => {
    if (current !== null) return; // abort — id already claimed
    return true;
  });
  return result.committed;
}

export async function writeUserGroupsEntry(userId, groupId, payload) {
  const value = payload === undefined ? true : payload;
  await set(ref(db, `users/${userId}/groups/${groupId}`), value);
}

export async function removeUserGroupsEntry(userId, groupId) {
  await remove(ref(db, `users/${userId}/groups/${groupId}`));
}

export async function readUserGroups(userId) {
  const snap = await get(ref(db, `users/${userId}/groups`));
  return snap.exists() ? snap.val() : {};
}

export function watchUserGroups(userId, callback) {
  const groupsRef = ref(db, `users/${userId}/groups`);
  return onValue(groupsRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}

// lastVisited lives in the enumeration record itself (users/{uid}/groups/{gid}),
// which is the same node the nav-row sort reads (groupNav renderNavRowDirectMode).
// It deliberately stays here — NOT in userPrefs — so the write and read paths
// can't drift apart. (Moving the write to userPrefs while the read stayed here
// once silently broke nav-sort freshness; see the lastVisited→userPrefs issue.)
// This write touches users/{uid}/groups, not users/{uid}/presence, so it never
// re-fires presence watchers.
export async function setLastVisited(userId, groupId, ts) {
  await update(ref(db, `users/${userId}/groups/${groupId}`), { lastVisited: ts });
}

// ── Groups: entity CRUD + meta subscription ───────────────────────────────────
// groups/{groupId} root fields: name, ownerId, createdAt, (post-MVP: color, paletteKey).
// Sub-collections: members/, invites/ — managed by separate helpers below.

export async function writeGroup(groupId, payload) {
  await set(ref(db, `groups/${groupId}`), payload);
}

export async function readGroup(groupId) {
  const snap = await get(ref(db, `groups/${groupId}`));
  return snap.exists() ? snap.val() : null;
}

// Reads ONLY the group's name leaf (groups/{gid}/name). Used by the invite
// redeem/preview flow, which runs as a NOT-YET-member: the whole groups/{gid}
// node is membership-gated (it contains the private member list), but the name
// is non-secret and shown in invite previews. Returns { name } or null so callers
// can treat the result like a (minimal) group record. See database.rules.json
// groups/$gid/name/.read.
export async function readGroupName(groupId) {
  const snap = await get(ref(db, `groups/${groupId}/name`));
  return snap.exists() ? { name: snap.val() } : null;
}

export async function renameGroup(groupId, name) {
  await update(ref(db, `groups/${groupId}`), { name });
}

export async function deleteGroup(groupId) {
  await remove(ref(db, `groups/${groupId}`));
}

// Subscription that strips sub-collections so callers only react to meta changes
// (name, ownerId, etc.). Members and invites are watched separately.
const GROUP_META_FIELDS = ['name', 'ownerId', 'createdAt', 'color', 'paletteKey'];

export function watchGroupMeta(groupId, callback) {
  const groupRef = ref(db, `groups/${groupId}`);
  return onValue(groupRef, (snap) => {
    if (!snap.exists()) { callback(null); return; }
    const val = snap.val() || {};
    const meta = {};
    for (const k of GROUP_META_FIELDS) {
      if (val[k] !== undefined) meta[k] = val[k];
    }
    callback(meta);
  }, () => {
    // Listener CANCELLED (PERMISSION_DENIED). groups/{gid} is membership-gated,
    // so when the owner deletes the group the node goes null and the read rule
    // (data.child('members').child(me).exists()) now evaluates against nothing
    // → the member loses read access. Firebase fires THIS cancel callback, not a
    // null-value tick — so without handling it the deletion is invisible and the
    // stale group lingers in the member's nav (shown as its raw id). Treat
    // cancellation as "group gone for me" and emit null, driving groupNav's
    // deletion self-clean (removeUserGroupsEntry). Also covers a member being
    // removed from the group (likewise a read-access loss).
    callback(null);
  });
}

// ── Groups: members ───────────────────────────────────────────────────────────
// groups/{groupId}/members/{memberUid}: { role, displayName, joinedAt, statusOverride? (Phase 2) }.

export async function writeMember(groupId, memberUid, member) {
  await set(ref(db, `groups/${groupId}/members/${memberUid}`), member);
}

export async function readMember(groupId, memberUid) {
  const snap = await get(ref(db, `groups/${groupId}/members/${memberUid}`));
  return snap.exists() ? snap.val() : null;
}

export async function readMembers(groupId) {
  const snap = await get(ref(db, `groups/${groupId}/members`));
  return snap.exists() ? snap.val() : {};
}

export async function removeMember(groupId, memberUid) {
  await remove(ref(db, `groups/${groupId}/members/${memberUid}`));
}

export async function setMemberDisplayName(groupId, memberUid, displayName) {
  await update(ref(db, `groups/${groupId}/members/${memberUid}`), { displayName });
}

export function watchGroupMembers(groupId, callback) {
  const membersRef = ref(db, `groups/${groupId}/members`);
  return onValue(membersRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}

// ── Phase 2: per-group status overrides ──────────────────────────────────────
// Canonical location: groups/{groupId}/members/{memberUid}/statusOverride.
// Writes are member-self-write (the user writes only to their own member
// record); same trust model as displayName edits.

export async function setStatusOverride(groupId, memberUid, override) {
  const overrideRef = ref(db, `groups/${groupId}/members/${memberUid}/statusOverride`);
  await set(overrideRef, override);
}

export async function clearStatusOverride(groupId, memberUid) {
  const overrideRef = ref(db, `groups/${groupId}/members/${memberUid}/statusOverride`);
  await remove(overrideRef);
}

// Merge-update individual fields of a member's statusOverride sub-object
// without disturbing the others. Use this anywhere we want to flip just
// `enabled` or write just `statusColor`/`paletteKey`; the leftovers (e.g.
// the user's saved palette) persist across the change. Pass `null` to
// remove a field (RTDB drops null-valued keys from update writes).
export async function mergeStatusOverride(groupId, memberUid, fields) {
  const overrideRef = ref(db, `groups/${groupId}/members/${memberUid}/statusOverride`);
  await update(overrideRef, fields);
}

export function watchOwnMemberOverride(groupId, memberUid, callback) {
  const overrideRef = ref(db, `groups/${groupId}/members/${memberUid}/statusOverride`);
  return onValue(overrideRef, (snap) => {
    callback(snap.exists() ? snap.val() : null);
  });
}

// ── Groups: invites ───────────────────────────────────────────────────────────

export async function writeGroupInvite(groupId, token, payload) {
  await set(ref(db, `groups/${groupId}/invites/${token}`), payload);
}

export async function readGroupInvites(groupId) {
  const snap = await get(ref(db, `groups/${groupId}/invites`));
  return snap.exists() ? snap.val() : {};
}

export async function readGroupInvite(groupId, token) {
  const snap = await get(ref(db, `groups/${groupId}/invites/${token}`));
  return snap.exists() ? snap.val() : null;
}

export async function setGroupInviteRevoked(groupId, token) {
  await update(ref(db, `groups/${groupId}/invites/${token}`), { revoked: true });
}

export async function incrementGroupInviteRedemptions(groupId, token) {
  const inviteRef = ref(db, `groups/${groupId}/invites/${token}/redemptionsUsed`);
  await runTransaction(inviteRef, (current) => (current || 0) + 1);
}

export function watchGroupInvites(groupId, callback) {
  const invitesRef = ref(db, `groups/${groupId}/invites`);
  return onValue(invitesRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}

// ── Pending invites mailbox ──────────────────────────────────────────────────
// Phase 3 in-app push invites. Schema:
//   pendingInvites/{inviteeUid}/{groupId} = { from, ts }
//   pendingInvitesByGroup/{groupId}/{inviteeUid} = true   (sweep index)
//
// Writes are dual-writes (primary + index); deletions are dual-deletes.
// Keyed by groupId (not a random inviteId) so re-inviting the same person to
// the same group is a natural overwrite — no duplicate entries, no race.

export function watchPendingInvites(inviteeUid, callback) {
  const inboxRef = ref(db, `pendingInvites/${inviteeUid}`);
  return onValue(inboxRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}

export async function writePendingInvite(inviterUid, inviteeUid, groupId) {
  const ts = Date.now();
  await update(ref(db), {
    [`pendingInvites/${inviteeUid}/${groupId}`]: { from: inviterUid, ts },
    [`pendingInvitesByGroup/${groupId}/${inviteeUid}`]: true,
  });
}

export async function deletePendingInvite(inviteeUid, groupId) {
  await update(ref(db), {
    [`pendingInvites/${inviteeUid}/${groupId}`]: null,
    [`pendingInvitesByGroup/${groupId}/${inviteeUid}`]: null,
  });
}

// ── Follow requests (Groups §11) ─────────────────────────────────────────────
// Two Phase-B-clean mailboxes mirroring pendingInvites. The requester writes a
// request into the target's mailbox; on approve the target writes a grant (with
// THEIR share code) into the requester's mailbox; the requester completes the
// follow itself and clears the grant. Each party only ever writes its own data.
// NB: both writers take (requesterUid, targetUid) in that order, but the paths
// transpose — requests are keyed by target, grants by requester (each mailbox
// belongs to its reader).

export async function writeFollowRequest(requesterUid, targetUid, groupId) {
  await set(ref(db, `followRequests/${targetUid}/${requesterUid}`), {
    from: requesterUid, groupId, ts: Date.now(),
  });
}

export function watchFollowRequests(targetUid, callback) {
  const reqRef = ref(db, `followRequests/${targetUid}`);
  return onValue(reqRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}

export async function deleteFollowRequest(targetUid, requesterUid) {
  await remove(ref(db, `followRequests/${targetUid}/${requesterUid}`));
}

// `targetName` is the approver's display name in the shared group the request
// came from — the name the requester tapped on. The grant-watcher seeds the new
// following entry's label with it so the Direct card opens named, not coded.
export async function writeFollowGrant(requesterUid, targetUid, targetCode, targetName) {
  await set(ref(db, `followGrants/${requesterUid}/${targetUid}`), {
    from: targetUid, code: targetCode, name: targetName ?? null, ts: Date.now(),
  });
}

export function watchFollowGrants(requesterUid, callback) {
  const grantRef = ref(db, `followGrants/${requesterUid}`);
  return onValue(grantRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}

export async function deleteFollowGrant(requesterUid, targetUid) {
  await remove(ref(db, `followGrants/${requesterUid}/${targetUid}`));
}

export async function readPendingInviteesForGroup(groupId) {
  const snap = await get(ref(db, `pendingInvitesByGroup/${groupId}`));
  return snap.exists() ? Object.keys(snap.val()) : [];
}
