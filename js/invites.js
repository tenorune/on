// js/invites.js
// Invite-link primitive. Phase 0 supports personal-scope only.
// Token format: 22 chars from URL-safe base64 (128 bits of entropy).

import {
  claimInviteToken, writeUserInvite, readUserInvites,
  setInviteRevoked, releaseInviteToken,
  readInviteIndex, readUserInvite, incrementInviteRedemptions, getCreatorCode,
  registerAsFollower, setFollowingEntry,
} from './db.js';
import { getFollowing } from './store.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LABEL_MAX = 40;
const APP_URL_BASE = (typeof location !== 'undefined' && location.origin) ? location.origin : '';

export function generateInviteToken() {
  const bytes = new Uint8Array(16); // 128 bits
  (globalThis.crypto || require('crypto').webcrypto).getRandomValues(bytes);
  // Encode 16 bytes (128 bits) → 22 base64url chars (each char = 6 bits; 22 * 6 = 132, last 4 bits are zero-padded).
  // Use the cleaner approach: read 22 indices off ALPHABET using consecutive 6-bit windows.
  let out = '';
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < 16; i += 1) {
    acc = (acc << 8) | bytes[i];
    bits += 8;
    while (bits >= 6 && out.length < 22) {
      bits -= 6;
      out += ALPHABET[(acc >> bits) & 0x3f];
    }
  }
  // Flush the remaining bits: shift them to the high end of a 6-bit group (right-zero-pad per RFC 4648).
  if (out.length < 22) {
    out += ALPHABET[(acc << (6 - bits)) & 0x3f];
  }
  return out;
}

function validateLabel(raw) {
  if (typeof raw !== 'string') throw new Error('Creator label must be a string.');
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new Error('Creator label cannot be empty.');
  if (trimmed.length > LABEL_MAX) throw new Error(`Creator label must be at most ${LABEL_MAX} chars.`);
  return trimmed;
}

function buildInviteUrl(token) {
  return `${APP_URL_BASE}/?i=${token}`;
}

function findActivePersonalInvite(collection) {
  for (const [token, inv] of Object.entries(collection || {})) {
    if (inv && inv.scope === 'personal' && !inv.revoked) return { token, ...inv };
  }
  return null;
}

export async function createPersonalInvite(userId, creatorLabelRaw) {
  const creatorLabel = validateLabel(creatorLabelRaw);

  // Enforce one-active-personal-invite-per-user (spec §9.3).
  const collection = await readUserInvites(userId);
  const existing = findActivePersonalInvite(collection);
  if (existing) {
    return { token: existing.token, url: buildInviteUrl(existing.token), existing: true };
  }

  // Allocate a fresh token, retrying on the very rare collision.
  let token;
  let claimed = false;
  for (let attempt = 0; attempt < 8 && !claimed; attempt += 1) {
    token = generateInviteToken();
    claimed = await claimInviteToken(token, `users/${userId}/invites/${token}`);
  }
  if (!claimed) throw new Error('Could not allocate an invite token. Try again.');

  const now = Date.now();
  const payload = {
    scope: 'personal',
    token,
    creatorUid: userId,
    creatorLabel,
    createdAt: now,
    expiresAt: null,
    redemptionCap: null,
    redemptionsUsed: 0,
    revoked: false,
  };
  await writeUserInvite(userId, token, payload);

  return { token, url: buildInviteUrl(token), existing: false };
}

export async function revokePersonalInvite(userId) {
  const collection = await readUserInvites(userId);
  const active = findActivePersonalInvite(collection);
  if (!active) return;
  await setInviteRevoked(userId, active.token);
  await releaseInviteToken(active.token);
}

export async function regeneratePersonalInvite(userId, creatorLabelRaw) {
  // Validate label up-front so a bad label doesn't cause us to revoke first and fail second.
  const creatorLabel = validateLabel(creatorLabelRaw);
  await revokePersonalInvite(userId);
  return createPersonalInvite(userId, creatorLabel);
}

// Result shapes:
//   success: { ok: true, creatorUid, creatorCode, creatorLabel }
//   failure: { ok: false, reason: 'not-found'|'revoked'|'expired'|'cap'|'self'|'already-following'|'creator-missing' }
//
// alreadyFollowingSet: optional Set<string> of creator UIDs the redeemer already follows.
//   Null/undefined is treated as "not following anyone" — the function won't throw.
export async function redeemPersonalInvite(token, redeemerUid, redeemerCode, alreadyFollowingSet) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'not-found' };

  const indexEntry = await readInviteIndex(token);
  if (!indexEntry) return { ok: false, reason: 'not-found' };
  if (indexEntry.scope !== 'personal') return { ok: false, reason: 'not-found' };

  // Parse owner path: users/{uid}/invites/{token}
  const match = indexEntry.ownerPath.match(/^users\/([^/]+)\/invites\/([^/]+)$/);
  if (!match) return { ok: false, reason: 'not-found' };
  const [, creatorUid] = match;

  const invite = await readUserInvite(creatorUid, token);
  if (!invite) return { ok: false, reason: 'not-found' };
  if (invite.revoked) return { ok: false, reason: 'revoked' };
  if (invite.expiresAt != null && invite.expiresAt < Date.now()) return { ok: false, reason: 'expired' };
  if (invite.redemptionCap != null && (invite.redemptionsUsed || 0) >= invite.redemptionCap) {
    return { ok: false, reason: 'cap' };
  }
  if (creatorUid === redeemerUid) return { ok: false, reason: 'self' };
  if (alreadyFollowingSet && alreadyFollowingSet.has && alreadyFollowingSet.has(creatorUid)) {
    return { ok: false, reason: 'already-following' };
  }

  const creatorCode = await getCreatorCode(creatorUid);
  if (!creatorCode) return { ok: false, reason: 'creator-missing' };

  // Create the follow relationship and persist in own following list.
  await registerAsFollower(creatorUid, redeemerUid, redeemerCode);
  await setFollowingEntry(redeemerUid, creatorUid, creatorCode, '');
  await incrementInviteRedemptions(creatorUid, token);

  return { ok: true, creatorUid, creatorCode, creatorLabel: invite.creatorLabel || '' };
}

// Hook callable from app.js boot. Pulls the current following set from local store
// so the already-following check is fast, then dispatches to redeem.
export async function attemptRedeemFromUrl(token, redeemerUid, redeemerCode) {
  if (!token) return null;
  const followingSet = new Set(getFollowing().map((e) => e.userId));
  return redeemPersonalInvite(token, redeemerUid, redeemerCode, followingSet);
}

export function extractInviteTokenFromUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const t = url.searchParams.get('i');
    if (!t) return null;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(t)) return null;
    return t;
  } catch {
    return null;
  }
}
