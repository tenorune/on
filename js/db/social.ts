// js/db/social.ts — Direct-relationship Firebase ops: identity/presence,
// following/followers, personal invites, user prefs, call signaling, knocks.
import { db } from '../firebase-config.js';
import {
  ref, set, get, update, onValue, remove, runTransaction, onChildAdded, push,
} from 'firebase/database';
import { generateCode } from '../identity.js';
import { getFollowing } from '../store.js';

// Re-exported through the db.js barrel so invite code reaches the unauthenticated
// invite-preview callable the same way it reaches every other Firebase op (via
// './db.js'), without importing firebase-config directly (which would pull
// firebase/auth into module graphs that mock only './db.js').
export { callResolveInvitePreview } from '../firebase-config.js';

// Register new user. Retries on code collision. Returns true on success, null on collision.
export async function initUser(userId: string, code: string): Promise<boolean | null> {
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
function inferScopeFromOwnerPath(ownerPath: string): 'group' | 'personal' {
  return ownerPath.startsWith('groups/') ? 'group' : 'personal';
}

export async function claimInviteToken(token: string, ownerPath: string, ownerUid: string): Promise<boolean> {
  const indexRef = ref(db, `inviteIndex/${token}`);
  const result = await runTransaction(indexRef, (current) => {
    if (current !== null) return; // abort — token already claimed
    // ownerUid stamps the creator so the rules can scope index DELETION (token
    // release) to them — a recipient who has the link knows the token but must
    // not be able to release it. See database.rules.json inviteIndex.
    return { scope: inferScopeFromOwnerPath(ownerPath), ownerPath, ownerUid };
  });
  return result.committed;
}

export async function releaseInviteToken(token: string): Promise<void> {
  await remove(ref(db, `inviteIndex/${token}`));
}

export async function readInviteIndex(token: string): Promise<Record<string, unknown> | null> {
  const snap = await get(ref(db, `inviteIndex/${token}`));
  return snap.exists() ? snap.val() : null;
}

// Personal invites under users/{uid}/invites/{token}.

export async function readUserInvite(userId: string, token: string): Promise<Record<string, unknown> | null> {
  const snap = await get(ref(db, `users/${userId}/invites/${token}`));
  return snap.exists() ? snap.val() : null;
}

export async function writeUserInvite(userId: string, token: string, payload: unknown): Promise<void> {
  await set(ref(db, `users/${userId}/invites/${token}`), payload);
}

export async function deleteUserInvite(userId: string, token: string): Promise<void> {
  await remove(ref(db, `users/${userId}/invites/${token}`));
}

export async function setInviteRevoked(userId: string, token: string): Promise<void> {
  await update(ref(db, `users/${userId}/invites/${token}`), { revoked: true });
}

// Rewrites just the creatorLabel on an existing invite (token/URL unchanged),
// so a re-share can refresh a stale label without minting a new link.
export async function setInviteLabel(userId: string, token: string, creatorLabel: string): Promise<void> {
  await update(ref(db, `users/${userId}/invites/${token}`), { creatorLabel });
}

export async function incrementInviteRedemptions(userId: string, token: string): Promise<void> {
  const inviteRef = ref(db, `users/${userId}/invites/${token}/redemptionsUsed`);
  await runTransaction(inviteRef, (current) => {
    return (current || 0) + 1;
  });
}

export async function getCreatorCode(creatorUserId: string): Promise<string | null> {
  const snap = await get(ref(db, `users/${creatorUserId}/presence/code`));
  return snap.exists() ? snap.val() : null;
}

export function watchUserInvites(userId: string, callback: (invites: Record<string, unknown>) => void): () => void {
  const invitesRef = ref(db, `users/${userId}/invites`);
  return onValue(invitesRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}

export async function readUserInvites(userId: string): Promise<Record<string, unknown>> {
  const snap = await get(ref(db, `users/${userId}/invites`));
  return snap.exists() ? snap.val() : {};
}

// Write own status to Firebase
export async function setStatus(userId: string, status: string, availableUntil: number | null): Promise<void> {
  await update(ref(db, `users/${userId}/presence`), {
    status,
    availableUntil: availableUntil ?? null,
    lastSeen: Date.now(),
  });
}

// Look up a userId by code. Returns userId string or null.
export async function lookupCode(code: string): Promise<string | null> {
  const snap = await get(ref(db, `codeIndex/${code.toUpperCase()}`));
  return snap.exists() ? snap.val() : null;
}

// Subscribe to a user's presence subtree in real-time. Returns unsubscribe fn.
export function watchPresence(userId: string, callback: (presence: PresenceNode | null) => void): () => void {
  const presRef = ref(db, `users/${userId}/presence`);
  return onValue(presRef, (snap) => { callback(snap.exists() ? snap.val() : null); });
}

// Subscribe to own followers list in real-time. Returns unsubscribe fn.
export function watchFollowers(myUserId: string, callback: (followers: { userId: string; code: unknown }[]) => void): () => void {
  const followersRef = ref(db, `users/${myUserId}/followers`);
  return onValue(followersRef, (snap) => {
    const data = snap.val() || {};
    // data is { followerId: theirCode, ... }
    callback(Object.entries(data).map(([userId, code]) => ({ userId, code })));
  });
}

// Subscribe to the display names followers published for themselves (invite
// redemptions write these — see registerAsFollower). Emits the raw
// { followerId: name } map ({} when absent). The consumer folds these into the
// device-local follower-name roster so the followers list can render
// "CODE (Name)" for a follow that never went through a follow-request approval.
export function watchFollowerNames(myUserId: string, callback: (names: Record<string, unknown>) => void): () => void {
  const namesRef = ref(db, `users/${myUserId}/followerNames`);
  return onValue(namesRef, (snap) => { callback(snap.val() || {}); });
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
export function watchUserPrefs(userId: string, callback: (prefs: UserPrefs | null) => void): () => void {
  const prefsRef = ref(db, `userPrefs/${userId}`);
  return onValue(prefsRef, (snap) => {
    callback(snap.exists() ? snap.val() : null);
  });
}

// One-shot read of the userPrefs subtree. Used at boot to pre-resolve the
// user's last currentContext before any UI paints, so a returning group-
// context user doesn't see a Direct flash before watchUserPrefs catches up.
export async function getUserPrefs(userId: string): Promise<UserPrefs | null> {
  const snap = await get(ref(db, `userPrefs/${userId}`));
  return snap.exists() ? snap.val() : null;
}

// Targeted read of the FCM push-token registry (token → { createdAt, lastSeen,
// ua }). Used by the stale-token TTL cull (prefs.cullStalePushTokens, #157).
export async function readPushTokens(userId: string): Promise<Record<string, { createdAt?: number; lastSeen?: number } | null> | null> {
  const snap = await get(ref(db, `userPrefs/${userId}/pushTokens`));
  return snap.exists() ? snap.val() : null;
}

// `fields` is a flat object keyed by slash-separated paths relative to
// userPrefs/{uid}, e.g. { 'hints/bolt': true, 'lastTimeoutMinutes': 30 }.
// RTDB's update() applies multi-path keys atomically.
export async function mergeUserPrefs(userId: string, fields: Record<string, unknown>): Promise<void> {
  await update(ref(db, `userPrefs/${userId}`), fields);
}

export async function registerAsFollower(targetUserId: string, myUserId: string, myCode: string, myName?: string | null): Promise<void> {
  // Clear any prior revocation BEFORE writing the followers entry — not in
  // parallel. The receiver's revocation watcher can fire on either write
  // independently; if the followers set echoes before the revocation remove,
  // the auto-unfollow fires on the freshly-established relationship and the new
  // follow is silently undone. Sequential remove → set ensures the revocation
  // is gone by the time the followers update is observable.
  await remove(ref(db, `revocations/${myUserId}/${targetUserId}`));
  await set(ref(db, `users/${targetUserId}/followers/${myUserId}`), myCode);
  // Publish our display name into a sibling node the target reads, so a follow
  // established without their involvement (invite redemption — no follow-request
  // approval to learn the name) still surfaces "CODE (Name)" on their list. Only
  // when we actually have a name (Telegram first name); web redeemers pass none,
  // so their behaviour is unchanged. The bare followers-code write above stays
  // the source of truth for the relationship itself — so this name write is
  // strictly cosmetic and must never break the follow: swallow any failure
  // (e.g. a name over the 40-char rule cap), which just degrades to bare code.
  if (typeof myName === 'string' && myName.length > 0) {
    await set(ref(db, `users/${targetUserId}/followerNames/${myUserId}`), myName).catch(() => {});
  }
}

// Subscribe to my own revocation mailbox: revocations/{me}/{revoker} = true
// means revoker removed me as a follower. Returns unsubscribe.
export function watchRevocations(myUserId: string, callback: (revocations: Record<string, unknown>) => void): () => void {
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

export function watchFollowing(myUserId: string, callback: (following: { userId: string; code: string; label: string }[]) => void): () => void {
  const followingRef = ref(db, `userPrefs/${myUserId}/following`);
  return onValue(followingRef, (snap) => {
    const data: Record<string, { code?: string; label?: string } | null> = snap.val() || {};
    // data is { followeeId: { code, label }, ... }
    callback(Object.entries(data).map(([userId, v]) => ({
      userId,
      code: v?.code ?? '',
      label: v?.label ?? '',
    })));
  });
}

export async function setFollowingEntry(myUserId: string, followeeUserId: string, code: string, label?: string | null): Promise<void> {
  await set(ref(db, `userPrefs/${myUserId}/following/${followeeUserId}`), { code, label: label ?? '' });
}

export async function removeFollowingEntry(myUserId: string, followeeUserId: string): Promise<void> {
  await remove(ref(db, `userPrefs/${myUserId}/following/${followeeUserId}`));
}

// Called when the follower wants to stop following targetUserId.
// Only removes the followers entry — does NOT write a revocations entry
// (revocation is for the followee EVICTING a follower, not self-unfollow).
export async function unregisterAsFollower(targetUserId: string, myUserId: string): Promise<void> {
  await remove(ref(db, `users/${targetUserId}/followers/${myUserId}`));
}

// Remove a follower and write to their revocations mailbox
export async function removeFollower(myUserId: string, followerUserId: string): Promise<void> {
  await remove(ref(db, `users/${myUserId}/followers/${followerUserId}`));
  await set(ref(db, `revocations/${followerUserId}/${myUserId}`), true);
}

// Write back expired status (idempotent)
export async function writeBackExpired(userId: string): Promise<void> {
  await update(ref(db, `users/${userId}/presence`), { status: 'unavailable', availableUntil: null });
}

// One-time check: does this user's record exist in Firebase?
// Returns true if found, false if missing. Throws on network error (caller decides how to handle).
// Reads users/{userId}/presence (not the whole users/{userId} node): post-M1 the
// whole node is owner-only readable, but presence is cross-user readable, and a
// user exists iff they have a presence node (presence-schema-split model). This is
// called cross-user (app.js recovery-code restore), so it must hit a readable path.
export async function userExists(userId: string): Promise<boolean> {
  const snap = await get(ref(db, `users/${userId}/presence`));
  return snap.exists();
}

// Update lastSeen timestamp without changing status — called on every app open.
export async function touchLastSeen(userId: string): Promise<void> {
  await update(ref(db, `users/${userId}/presence`), { lastSeen: Date.now() });
}

// Reserve a fresh code, update user record + follower entries, release old code.
// Returns the new code string on success. Throws on failure.
// Old code is deleted LAST so it remains valid if any earlier write fails.
export async function rotateCode(userId: string, oldCode: string): Promise<string> {
  // Step 1: reserve new code (collision-safe)
  let newCode: string, committed: boolean;
  do {
    newCode = generateCode();
    const result = await runTransaction(ref(db, `codeIndex/${newCode}`), (current) => {
      if (current !== null) return; // abort on collision
      return userId;
    });
    committed = result.committed;
  } while (!committed);

  // Steps 2–3: establish the new code in ONE atomic multi-path update (own
  // presence code + each follower's followers/{me} mirror) instead of a write
  // per followee (#214 R6). If it throws, the new code is orphaned in codeIndex
  // but the old code remains valid — user retries and the orphan is harmless.
  const updates: Record<string, unknown> = { [`users/${userId}/presence/code`]: newCode };
  for (const entry of getFollowing()) {
    updates[`users/${entry.userId}/followers/${userId}`] = newCode;
  }
  await update(ref(db), updates);

  // Step 4: release old code last. If this throws, both codes exist briefly —
  // new code is already active, so old code is a harmless orphan. No rollback needed.
  await remove(ref(db, `codeIndex/${oldCode}`)).catch(() => {});

  return newCode;
}

export async function setStatusColor(userId: string, color: string): Promise<void> {
  await update(ref(db, `users/${userId}/presence`), { statusColor: color });
}

export async function setPaletteKey(userId: string, paletteKey: string | null): Promise<void> {
  await update(ref(db, `users/${userId}/presence`), { paletteKey: paletteKey ?? null });
}

// ── Call signaling (symmetric mailboxes) ─────────────────────────────────────
export async function startCall(callerId: string, calleeId: string, clearUid?: string | null): Promise<void> {
  const ts = Date.now();
  const updates: Record<string, unknown> = {
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
export async function answerCall(calleeId: string, callerId: string): Promise<void> {
  await update(ref(db), {
    [`calls/${calleeId}/answered`]: true,
    [`calls/${callerId}/answered`]: true,
  });
}
export async function endCall(aUid: string, bUid: string): Promise<void> {
  await update(ref(db), { [`calls/${aUid}`]: null, [`calls/${bUid}`]: null });
}
export function watchOwnCall(myUserId: string, callback: (call: Record<string, unknown> | null) => void): () => void {
  const callRef = ref(db, `calls/${myUserId}`);
  return onValue(callRef, (snap) => { callback(snap.exists() ? snap.val() : null); });
}

// One-time read of a user's presence subtree. Returns data object or null.
export async function getUser(userId: string): Promise<PresenceNode | null> {
  const snap = await get(ref(db, `users/${userId}/presence`));
  return snap.exists() ? snap.val() : null;
}

// Write a knock from sender to recipient (capped at 5).
// runTransaction: null → {count:1,ts}, count<5 → increment, count>=5 → abort.
// opts.contextGroupId — optional group surface context carried with the knock.
export async function writeKnock(recipientId: string, senderId: string, opts: { contextGroupId?: string } = {}): Promise<void> {
  const knockRef = ref(db, `knocks/${recipientId}/${senderId}`);
  await runTransaction(knockRef, (current) => {
    if (current === null) {
      const next: { count: number; ts: number; contextGroupId?: string } = { count: 1, ts: Date.now() };
      if (opts.contextGroupId) next.contextGroupId = opts.contextGroupId;
      return next;
    }
    if (current.count >= 5) return; // abort
    const next: { count: number; ts: number; contextGroupId?: string } = { count: current.count + 1, ts: Date.now() };
    if (opts.contextGroupId) next.contextGroupId = opts.contextGroupId;
    else if (current.contextGroupId) next.contextGroupId = current.contextGroupId;
    return next;
  });
}

// One-time read of all pending knocks for myUserId.
// Returns Promise<DataSnapshot>. Caller checks snapshot.exists() and iterates snapshot.val().
export function getKnocks(myUserId: string) {
  return get(ref(db, `knocks/${myUserId}`));
}

// Attach onChildAdded listener on knocks/{myUserId}.
// callback(senderId, { count, ts }) fires for each child added (including existing at attach time).
// Returns unsubscribe function.
export function watchKnocksAdded(myUserId: string, callback: (senderId: string | null, knock: unknown) => void): () => void {
  const knocksRef = ref(db, `knocks/${myUserId}`);
  return onChildAdded(knocksRef, (snap) => {
    callback(snap.key, snap.val());
  });
}

// Delete a single knock entry for a sender. Returns raw promise — caller handles errors.
export function clearKnock(myUserId: string, senderId: string): Promise<void> {
  return remove(ref(db, `knocks/${myUserId}/${senderId}`));
}
