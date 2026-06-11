// js/db.js
import { db } from './firebase-config.js';
import {
  ref, set, get, update, onValue, remove, runTransaction, onChildAdded, onChildRemoved,
  push, query, orderByKey, startAfter, onDisconnect,
} from 'firebase/database';
import { generateCode } from './identity.js';
import { getFollowing } from './store.js';

// --- Pure helpers (exported for testing) ---

export function isExpired(availableUntil) {
  if (availableUntil === null || availableUntil === undefined) return false;
  return availableUntil < Date.now();
}

export function timeRemainingMs(availableUntil) {
  if (!availableUntil) return 0;
  return Math.max(0, availableUntil - Date.now());
}

export function formatTimeRemaining(ms) {
  if (ms <= 0) return '';
  if (ms < 60000) return '< 1m';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

const HOUR_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
function hourWord(n) { return HOUR_WORDS[n] ?? String(n); }

export function formatTimeRemainingFuzzy(ms) {
  if (ms <= 0) return '';
  const minutes = ms / 60000;
  const hours = ms / 3600000;
  if (minutes < 5) return 'just a few minutes left';
  if (minutes < 20) return 'about 15 minutes left';
  if (minutes < 45) return 'about half an hour left';
  if (minutes < 75) return 'about an hour left';
  if (minutes < 120) return 'one to two hours left';
  const floor = Math.floor(hours);
  const frac = hours - floor;
  if (frac < 0.25) return `just over ${hourWord(floor)} hours left`;
  if (frac >= 0.75) return `nearly ${hourWord(floor + 1)} hours left`;
  return `about ${hourWord(Math.round(hours))} hours left`;
}

export function formatLastSeen(lastSeenMs) {
  if (lastSeenMs == null) return null;
  const elapsed = Date.now() - lastSeenMs;
  const days = elapsed / (24 * 60 * 60 * 1000);
  if (days < 7) return null;
  if (days < 14) return 'over a week ago';
  if (days < 28) return 'over two weeks ago';
  return 'over a month ago';
}

// --- Firebase operations ---

// Register new user. Retries on code collision. Returns true on success, null on collision.
export async function initUser(userId, code) {
  const codeRef = ref(db, `codeIndex/${code}`);
  const result = await runTransaction(codeRef, (current) => {
    if (current !== null) return; // abort — code taken
    return userId;
  });
  if (!result.committed) {
    return null; // signal collision to caller
  }
  await set(ref(db, `users/${userId}/presence`), {
    code,
    status: 'unavailable',
    availableUntil: null,
  });
  return true;
}

// ── Invites ──────────────────────────────────────────────────────────────────
// inviteIndex/{token} → { scope, ownerPath } — global lookup table.
// Same transactional-claim pattern as codeIndex (see initUser above).

// Callers are trusted to pass a well-formed ownerPath (users/{uid}/invites/{token}
// or groups/{groupId}/invites/{token}); any non-groups/ prefix is treated as personal.
function inferScopeFromOwnerPath(ownerPath) {
  return ownerPath.startsWith('groups/') ? 'group' : 'personal';
}

export async function claimInviteToken(token, ownerPath) {
  const indexRef = ref(db, `inviteIndex/${token}`);
  const result = await runTransaction(indexRef, (current) => {
    if (current !== null) return; // abort — token already claimed
    return { scope: inferScopeFromOwnerPath(ownerPath), ownerPath };
  });
  return result.committed;
}

export async function releaseInviteToken(token) {
  await remove(ref(db, `inviteIndex/${token}`));
}

export async function readInviteIndex(token) {
  const snap = await get(ref(db, `inviteIndex/${token}`));
  return snap.exists() ? snap.val() : null;
}

// Personal invites under users/{uid}/invites/{token}.

export async function readUserInvite(userId, token) {
  const snap = await get(ref(db, `users/${userId}/invites/${token}`));
  return snap.exists() ? snap.val() : null;
}

export async function writeUserInvite(userId, token, payload) {
  await set(ref(db, `users/${userId}/invites/${token}`), payload);
}

export async function deleteUserInvite(userId, token) {
  await remove(ref(db, `users/${userId}/invites/${token}`));
}

export async function setInviteRevoked(userId, token) {
  await update(ref(db, `users/${userId}/invites/${token}`), { revoked: true });
}

export async function incrementInviteRedemptions(userId, token) {
  const inviteRef = ref(db, `users/${userId}/invites/${token}/redemptionsUsed`);
  await runTransaction(inviteRef, (current) => {
    return (current || 0) + 1;
  });
}

export async function getCreatorCode(creatorUserId) {
  const snap = await get(ref(db, `users/${creatorUserId}/presence/code`));
  return snap.exists() ? snap.val() : null;
}

export function watchUserInvites(userId, callback) {
  const invitesRef = ref(db, `users/${userId}/invites`);
  return onValue(invitesRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}

export async function readUserInvites(userId) {
  const snap = await get(ref(db, `users/${userId}/invites`));
  return snap.exists() ? snap.val() : {};
}

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

// Write own status to Firebase
export async function setStatus(userId, status, availableUntil) {
  await update(ref(db, `users/${userId}/presence`), {
    status,
    availableUntil: availableUntil ?? null,
    lastSeen: Date.now(),
  });
}

// Look up a userId by code. Returns userId string or null.
export async function lookupCode(code) {
  const snap = await get(ref(db, `codeIndex/${code.toUpperCase()}`));
  return snap.exists() ? snap.val() : null;
}

// Subscribe to a user's presence subtree in real-time. Returns unsubscribe fn.
export function watchPresence(userId, callback) {
  const presRef = ref(db, `users/${userId}/presence`);
  return onValue(presRef, (snap) => { callback(snap.exists() ? snap.val() : null); });
}

// Subscribe to own followers list in real-time. Returns unsubscribe fn.
export function watchFollowers(myUserId, callback) {
  const followersRef = ref(db, `users/${myUserId}/followers`);
  return onValue(followersRef, (snap) => {
    const data = snap.val() || {};
    // data is { followerId: theirCode, ... }
    callback(Object.entries(data).map(([userId, code]) => ({ userId, code })));
  });
}

// Called when user A follows user B: registers A in B's followers
// ── User preferences (cross-device sync) ────────────────────────────────────
// All user-private state that needs to sync across devices lives under
// `userPrefs/{uid}/` — deliberately NOT under `users/{uid}/` so it doesn't
// get echoed to every follower's watchPresence tick. The schema is:
//   userPrefs/{uid}/
//     hints/ { bolt, flower, theme, stripPeek, longpress, swipe, customAvail }
//     madeCallCount, answeredCallCount
//     favoritesCollapsed
//     lastTimeoutMinutes                          ← Direct's chip default
//     currentContext                              ← (planned, post-foundation)
//     favorites/ [...]                            ← (planned, post-foundation)
//     paletteState/direct/                        ← (planned, post-foundation)
//     perGroup/{groupId}/
//       paletteState/                             ← (planned, post-foundation)
//       lastTimeoutMinutes                        ← per-group chip default
//
// Reads on the consumer side use localStorage (the cache populated by
// watchUserPrefs's tick); writes call mergeUserPrefs so multi-leaf updates
// land in a single RTDB op.
export function watchUserPrefs(userId, callback) {
  const prefsRef = ref(db, `userPrefs/${userId}`);
  return onValue(prefsRef, (snap) => {
    callback(snap.exists() ? snap.val() : null);
  });
}

// One-shot read of the userPrefs subtree. Used at boot to pre-resolve the
// user's last currentContext before any UI paints, so a returning group-
// context user doesn't see a Direct flash before watchUserPrefs catches up.
export async function getUserPrefs(userId) {
  const snap = await get(ref(db, `userPrefs/${userId}`));
  return snap.exists() ? snap.val() : null;
}

// `fields` is a flat object keyed by slash-separated paths relative to
// userPrefs/{uid}, e.g. { 'hints/bolt': true, 'lastTimeoutMinutes': 30 }.
// RTDB's update() applies multi-path keys atomically.
export async function mergeUserPrefs(userId, fields) {
  await update(ref(db, `userPrefs/${userId}`), fields);
}

export async function registerAsFollower(targetUserId, myUserId, myCode) {
  // Clear any prior revocation BEFORE writing the followers entry — not in
  // parallel. The receiver's revocation watcher can fire on either write
  // independently; if the followers set echoes before the revocation remove,
  // the auto-unfollow fires on the freshly-established relationship and the new
  // follow is silently undone. Sequential remove → set ensures the revocation
  // is gone by the time the followers update is observable.
  await remove(ref(db, `revocations/${myUserId}/${targetUserId}`));
  await set(ref(db, `users/${targetUserId}/followers/${myUserId}`), myCode);
}

// Subscribe to my own revocation mailbox: revocations/{me}/{revoker} = true
// means revoker removed me as a follower. Returns unsubscribe.
export function watchRevocations(myUserId, callback) {
  const revRef = ref(db, `revocations/${myUserId}`);
  return onValue(revRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}

// ── Following (own-side of the relationship) ─────────────────────────────────
// Storage: userPrefs/{myUid}/following/{followeeUid} = { code, label }
// Keyed by followee uid so per-entry updates don't disturb other entries.
// Sits under userPrefs/ (not users/) because following is purely private —
// nobody else needs to read your own following list, so putting it under
// the broadcast-to-followees user record was wasteful per-tick bandwidth.

export function watchFollowing(myUserId, callback) {
  const followingRef = ref(db, `userPrefs/${myUserId}/following`);
  return onValue(followingRef, (snap) => {
    const data = snap.val() || {};
    // data is { followeeId: { code, label }, ... }
    callback(Object.entries(data).map(([userId, v]) => ({
      userId,
      code: v?.code ?? '',
      label: v?.label ?? '',
    })));
  });
}

export async function setFollowingEntry(myUserId, followeeUserId, code, label) {
  await set(ref(db, `userPrefs/${myUserId}/following/${followeeUserId}`), { code, label: label ?? '' });
}

export async function removeFollowingEntry(myUserId, followeeUserId) {
  await remove(ref(db, `userPrefs/${myUserId}/following/${followeeUserId}`));
}

// Called when the follower wants to stop following targetUserId.
// Only removes the followers entry — does NOT write a revocations entry
// (revocation is for the followee EVICTING a follower, not self-unfollow).
export async function unregisterAsFollower(targetUserId, myUserId) {
  await remove(ref(db, `users/${targetUserId}/followers/${myUserId}`));
}

// Remove a follower and write to their revocations mailbox
export async function removeFollower(myUserId, followerUserId) {
  await remove(ref(db, `users/${myUserId}/followers/${followerUserId}`));
  await set(ref(db, `revocations/${followerUserId}/${myUserId}`), true);
}

// Write back expired status (idempotent)
export async function writeBackExpired(userId) {
  await update(ref(db, `users/${userId}/presence`), { status: 'unavailable', availableUntil: null });
}

// One-time check: does this user's record exist in Firebase?
// Returns true if found, false if missing. Throws on network error (caller decides how to handle).
export async function userExists(userId) {
  const snap = await get(ref(db, `users/${userId}`));
  return snap.exists();
}

// Update lastSeen timestamp without changing status — called on every app open.
export async function touchLastSeen(userId) {
  await update(ref(db, `users/${userId}/presence`), { lastSeen: Date.now() });
}

// Reserve a fresh code, update user record + follower entries, release old code.
// Returns the new code string on success. Throws on failure.
// Old code is deleted LAST so it remains valid if any earlier write fails.
export async function rotateCode(userId, oldCode) {
  // Step 1: reserve new code (collision-safe)
  let newCode, committed;
  do {
    newCode = generateCode();
    const result = await runTransaction(ref(db, `codeIndex/${newCode}`), (current) => {
      if (current !== null) return; // abort on collision
      return userId;
    });
    committed = result.committed;
  } while (!committed);

  // Steps 2–3: establish new code. If either throws, new code is orphaned in
  // codeIndex but old code remains valid — user retries and the orphan is harmless.
  await update(ref(db, `users/${userId}/presence`), { code: newCode });
  for (const entry of getFollowing()) {
    await set(ref(db, `users/${entry.userId}/followers/${userId}`), newCode);
  }

  // Step 4: release old code last. If this throws, both codes exist briefly —
  // new code is already active, so old code is a harmless orphan. No rollback needed.
  await remove(ref(db, `codeIndex/${oldCode}`)).catch(() => {});

  return newCode;
}

export async function setStatusColor(userId, color) {
  await update(ref(db, `users/${userId}/presence`), { statusColor: color });
}

export async function setPaletteKey(userId, paletteKey) {
  await update(ref(db, `users/${userId}/presence`), { paletteKey: paletteKey ?? null });
}

// ── Call signaling (symmetric mailboxes) ─────────────────────────────────────
export async function startCall(callerId, calleeId, clearUid) {
  const ts = Date.now();
  const updates = {
    [`calls/${callerId}`]: { to: calleeId, ts },
    [`calls/${calleeId}`]: { from: callerId, ts },
  };
  // Optionally drop a prior ringer's mailbox (caller chose a different call
  // while being rung) in the SAME write, so calls/{caller} never blinks null.
  if (clearUid && clearUid !== callerId && clearUid !== calleeId) {
    updates[`calls/${clearUid}`] = null;
  }
  await update(ref(db), updates);
}
export async function answerCall(calleeId, callerId) {
  await update(ref(db), {
    [`calls/${calleeId}/answered`]: true,
    [`calls/${callerId}/answered`]: true,
  });
}
export async function endCall(aUid, bUid) {
  await update(ref(db), { [`calls/${aUid}`]: null, [`calls/${bUid}`]: null });
}
export function watchOwnCall(myUserId, callback) {
  const callRef = ref(db, `calls/${myUserId}`);
  return onValue(callRef, (snap) => { callback(snap.exists() ? snap.val() : null); });
}

// One-time read of a user's presence subtree. Returns data object or null.
export async function getUser(userId) {
  const snap = await get(ref(db, `users/${userId}/presence`));
  return snap.exists() ? snap.val() : null;
}

// Write a knock from sender to recipient (capped at 5).
// runTransaction: null → {count:1,ts}, count<5 → increment, count>=5 → abort.
// opts.contextGroupId — optional group surface context carried with the knock.
export async function writeKnock(recipientId, senderId, opts = {}) {
  const knockRef = ref(db, `knocks/${recipientId}/${senderId}`);
  await runTransaction(knockRef, (current) => {
    if (current === null) {
      const next = { count: 1, ts: Date.now() };
      if (opts.contextGroupId) next.contextGroupId = opts.contextGroupId;
      return next;
    }
    if (current.count >= 5) return; // abort
    const next = { count: current.count + 1, ts: Date.now() };
    if (opts.contextGroupId) next.contextGroupId = opts.contextGroupId;
    else if (current.contextGroupId) next.contextGroupId = current.contextGroupId;
    return next;
  });
}

// One-time read of all pending knocks for myUserId.
// Returns Promise<DataSnapshot>. Caller checks snapshot.exists() and iterates snapshot.val().
export function getKnocks(myUserId) {
  return get(ref(db, `knocks/${myUserId}`));
}

// Attach onChildAdded listener on knocks/{myUserId}.
// callback(senderId, { count, ts }) fires for each child added (including existing at attach time).
// Returns unsubscribe function.
export function watchKnocksAdded(myUserId, callback) {
  const knocksRef = ref(db, `knocks/${myUserId}`);
  return onChildAdded(knocksRef, (snap) => {
    callback(snap.key, snap.val());
  });
}

// Delete a single knock entry for a sender. Returns raw promise — caller handles errors.
export function clearKnock(myUserId, senderId) {
  return remove(ref(db, `knocks/${myUserId}/${senderId}`));
}

// --- Canvas operations ---

export function getCanvasId(uid1, uid2) {
  return [uid1, uid2].sort().join('_');
}

export async function loadCanvas(canvasId) {
  const snap = await get(ref(db, `canvases/${canvasId}`));
  if (!snap.exists()) return { bg: null, strokes: [] };
  const val = snap.val();
  const strokes = val.strokes
    ? Object.entries(val.strokes).map(([key, data]) => ({ key, data }))
    : [];
  return { bg: val.bg || null, strokes };
}

export async function pushStroke(canvasId, stroke) {
  const strokeRef = await push(ref(db, `canvases/${canvasId}/strokes`), stroke);
  return strokeRef.key;
}

export async function removeStroke(canvasId, strokeKey) {
  await remove(ref(db, `canvases/${canvasId}/strokes/${strokeKey}`));
}

let _bgUnsub = null;

export function watchCanvasBg(canvasId, onChange) {
  _bgUnsub = onValue(ref(db, `canvases/${canvasId}/bg`), (snap) => {
    onChange(snap.val());
  });
}

export function unwatchCanvasBg() {
  if (_bgUnsub) { _bgUnsub(); _bgUnsub = null; }
}

export function setDrawingState(canvasId, userId, drawingData) {
  return set(ref(db, `canvases/${canvasId}/drawing/${userId}`), drawingData);
}

let _drawingUnsub = null;

export function watchDrawing(canvasId, peerId, onChange) {
  _drawingUnsub = onValue(ref(db, `canvases/${canvasId}/drawing/${peerId}`), (snap) => {
    onChange(snap.val());
  });
}

export function unwatchDrawing() {
  if (_drawingUnsub) { _drawingUnsub(); _drawingUnsub = null; }
}

export async function setClearRequest(canvasId, requesterId) {
  await update(ref(db, `canvases/${canvasId}`), { clearRequest: requesterId });
}

export async function removeClearRequest(canvasId) {
  await update(ref(db, `canvases/${canvasId}`), { clearRequest: null });
}

export async function clearAllStrokes(canvasId) {
  await remove(ref(db, `canvases/${canvasId}/strokes`));
  await remove(ref(db, `canvases/${canvasId}/drawing`));
  await update(ref(db, `canvases/${canvasId}`), { clearRequest: null });
}

let _clearReqUnsub = null;

export function watchClearRequest(canvasId, onChange) {
  _clearReqUnsub = onValue(ref(db, `canvases/${canvasId}/clearRequest`), (snap) => {
    onChange(snap.val());
  });
}

export function unwatchClearRequest() {
  if (_clearReqUnsub) { _clearReqUnsub(); _clearReqUnsub = null; }
}

export async function setCanvasBg(canvasId, color) {
  await update(ref(db, `canvases/${canvasId}`), { bg: color });
}

let _strokeAddUnsub = null;
let _strokeRemoveUnsub = null;

export function watchStrokes(canvasId, lastKey, onStroke, onStrokeRemoved) {
  const strokesRef = ref(db, `canvases/${canvasId}/strokes`);
  const q = lastKey
    ? query(strokesRef, orderByKey(), startAfter(lastKey))
    : strokesRef;
  _strokeAddUnsub = onChildAdded(q, (snap) => {
    onStroke({ key: snap.key, data: snap.val() });
  });
  if (onStrokeRemoved) {
    _strokeRemoveUnsub = onChildRemoved(strokesRef, (snap) => {
      onStrokeRemoved(snap.key);
    });
  }
}

export function unwatchStrokes() {
  if (_strokeAddUnsub) { _strokeAddUnsub(); _strokeAddUnsub = null; }
  if (_strokeRemoveUnsub) { _strokeRemoveUnsub(); _strokeRemoveUnsub = null; }
}

export async function setCanvasPresence(canvasId, userId, present) {
  const presenceRef = ref(db, `canvases/${canvasId}/presence/${userId}`);
  await set(presenceRef, present);
  if (present) {
    // If we disconnect unexpectedly (browser close, crash, network loss),
    // Firebase server will automatically set presence to false.
    onDisconnect(presenceRef).set(false);
  }
}

let _presenceUnsub = null;

export function watchCanvasPresence(canvasId, onChange) {
  _presenceUnsub = onValue(ref(db, `canvases/${canvasId}/presence`), (snap) => {
    onChange(snap.val() || {});
  });
}

export function unwatchCanvasPresence() {
  if (_presenceUnsub) { _presenceUnsub(); _presenceUnsub = null; }
}
