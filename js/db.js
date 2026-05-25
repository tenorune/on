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
  await set(ref(db, `users/${userId}`), {
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

// Write own status to Firebase
export async function setStatus(userId, status, availableUntil) {
  await update(ref(db, `users/${userId}`), {
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

// Subscribe to a user's status in real-time. Returns unsubscribe fn.
export function watchStatus(userId, callback) {
  const userRef = ref(db, `users/${userId}`);
  return onValue(userRef, (snap) => {
    callback(snap.exists() ? snap.val() : null);
  });
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
export async function registerAsFollower(targetUserId, myUserId, myCode) {
  await set(ref(db, `users/${targetUserId}/followers/${myUserId}`), myCode);
}

// ── Following (own-side of the relationship) ─────────────────────────────────
// Storage: users/{myUid}/following/{followeeUid} = { code, label }
// Keyed by followee uid so per-entry updates don't disturb other entries.

export function watchFollowing(myUserId, callback) {
  const followingRef = ref(db, `users/${myUserId}/following`);
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
  await set(ref(db, `users/${myUserId}/following/${followeeUserId}`), { code, label: label ?? '' });
}

export async function removeFollowingEntry(myUserId, followeeUserId) {
  await remove(ref(db, `users/${myUserId}/following/${followeeUserId}`));
}

// Called when the follower wants to stop following targetUserId.
// Only removes the followers entry — does NOT write to revokedFollowers.
export async function unregisterAsFollower(targetUserId, myUserId) {
  await remove(ref(db, `users/${targetUserId}/followers/${myUserId}`));
}

// Remove a follower and add them to revokedFollowers
export async function removeFollower(myUserId, followerUserId) {
  await remove(ref(db, `users/${myUserId}/followers/${followerUserId}`));
  await set(ref(db, `users/${myUserId}/revokedFollowers/${followerUserId}`), true);
}

// Write back expired status (idempotent)
export async function writeBackExpired(userId) {
  await update(ref(db, `users/${userId}`), {
    status: 'unavailable',
    availableUntil: null,
  });
}

// One-time check: does this user's record exist in Firebase?
// Returns true if found, false if missing. Throws on network error (caller decides how to handle).
export async function userExists(userId) {
  const snap = await get(ref(db, `users/${userId}`));
  return snap.exists();
}

// Update lastSeen timestamp without changing status — called on every app open.
export async function touchLastSeen(userId) {
  await update(ref(db, `users/${userId}`), { lastSeen: Date.now() });
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
  await update(ref(db, `users/${userId}`), { code: newCode });
  for (const entry of getFollowing()) {
    await set(ref(db, `users/${entry.userId}/followers/${userId}`), newCode);
  }

  // Step 4: release old code last. If this throws, both codes exist briefly —
  // new code is already active, so old code is a harmless orphan. No rollback needed.
  await remove(ref(db, `codeIndex/${oldCode}`)).catch(() => {});

  return newCode;
}

export async function setStatusColor(userId, color) {
  await update(ref(db, `users/${userId}`), { statusColor: color });
}

export async function setUserFavorites(userId, favorites) {
  await update(ref(db, `users/${userId}`), { favorites });
}

export async function setLastTimeoutMinutes(userId, minutes) {
  await update(ref(db, `users/${userId}`), { lastTimeoutMinutes: minutes });
}

export async function setPaletteKey(userId, paletteKey) {
  await update(ref(db, `users/${userId}`), { paletteKey: paletteKey ?? null });
}

export async function setCallState(callerId, calleeId) {
  await update(ref(db, `users/${callerId}`), {
    callState: { calleeId, since: Date.now() },
  });
}

export async function clearCallState(callerId) {
  await update(ref(db, `users/${callerId}`), { callState: null });
}

// One-time read of a user's full document. Returns data object or null.
export async function getUser(userId) {
  const snap = await get(ref(db, `users/${userId}`));
  return snap.exists() ? snap.val() : null;
}

// Write a knock from sender to recipient (capped at 5).
// runTransaction: null → {count:1,ts}, count<5 → increment, count>=5 → abort.
export async function writeKnock(recipientId, senderId) {
  const knockRef = ref(db, `users/${recipientId}/knocks/${senderId}`);
  await runTransaction(knockRef, (current) => {
    if (current === null) return { count: 1, ts: Date.now() };
    if (current.count >= 5) return; // abort
    return { count: current.count + 1, ts: Date.now() };
  });
}

// One-time read of all pending knocks for myUserId.
// Returns Promise<DataSnapshot>. Caller checks snapshot.exists() and iterates snapshot.val().
export function getKnocks(myUserId) {
  return get(ref(db, `users/${myUserId}/knocks`));
}

// Attach onChildAdded listener on users/{myUserId}/knocks.
// callback(senderId, { count, ts }) fires for each child added (including existing at attach time).
// Returns unsubscribe function.
export function watchKnocksAdded(myUserId, callback) {
  const knocksRef = ref(db, `users/${myUserId}/knocks`);
  return onChildAdded(knocksRef, (snap) => {
    callback(snap.key, snap.val());
  });
}

// Delete a single knock entry for a sender. Returns raw promise — caller handles errors.
export function clearKnock(myUserId, senderId) {
  return remove(ref(db, `users/${myUserId}/knocks/${senderId}`));
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
