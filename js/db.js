// js/db.js
import { db } from './firebase-config.js';
import {
  ref, set, get, update, onValue, remove, runTransaction,
} from 'firebase/database';

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

export function formatTimeRemainingFuzzy(ms) {
  if (ms <= 0) return '';
  const minutes = ms / 60000;
  const hours = ms / 3600000;
  if (minutes < 5) return 'just a few minutes left';
  if (minutes < 20) return 'about 15 minutes left';
  if (minutes < 45) return 'about half an hour left';
  if (minutes < 75) return 'about an hour left';
  if (minutes < 120) return 'a little more than an hour left';
  const floor = Math.floor(hours);
  const frac = hours - floor;
  if (frac < 0.25) return `just over ${floor} hours left`;
  if (frac >= 0.75) return `nearly ${floor + 1} hours left`;
  return `about ${Math.round(hours)} hours left`;
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
