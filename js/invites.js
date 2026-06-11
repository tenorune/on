// js/invites.js
// Invite-link primitive. Phase 0 supports personal-scope only.
// Token format: 22 chars from URL-safe base64 (128 bits of entropy).

import {
  claimInviteToken, writeUserInvite, readUserInvites,
  setInviteRevoked, releaseInviteToken,
  readInviteIndex, readUserInvite, incrementInviteRedemptions, getCreatorCode,
  registerAsFollower, setFollowingEntry,
  writeGroupInvite, readGroupInvites, setGroupInviteRevoked, incrementGroupInviteRedemptions,
  readGroup, readMember,
} from './db.js';
import { getFollowing } from './store.js';
import { joinGroup } from './groups.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LABEL_MAX = 40;
const APP_URL_BASE = (typeof location !== 'undefined' && location.origin) ? location.origin : '';

export function generateInviteToken() {
  const bytes = new Uint8Array(16); // 128 bits
  globalThis.crypto.getRandomValues(bytes);
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

export function buildInviteUrl(token) {
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
  // Use the inviter's creatorLabel as the follow's local label so the contact
  // card shows their name rather than the share code.
  const followLabel = invite.creatorLabel || '';
  await registerAsFollower(creatorUid, redeemerUid, redeemerCode);
  await setFollowingEntry(redeemerUid, creatorUid, creatorCode, followLabel);
  await incrementInviteRedemptions(creatorUid, token);

  return { ok: true, creatorUid, creatorCode, creatorLabel: invite.creatorLabel || '' };
}

// Hook callable from app.js boot. Pulls the current following set from local store
// so the already-following check is fast, then dispatches to redeem.
//
// Known Phase 0 limitation: getFollowing() reads localStorage, which may be stale on
// a fresh device (Firebase → localStorage sync hasn't run yet). If a user redeems an
// invite for someone they already follow but localStorage doesn't know about it, the
// redeem proceeds. registerAsFollower/setFollowingEntry are idempotent (set() of the
// same value), so the only observable effect is incrementInviteRedemptions firing
// twice — the creator's redemption counter over-counts by 1. Acceptable for Phase 0;
// a Firebase-authoritative guard inside redeemPersonalInvite would close the gap.
// `opts.cache` is an opaque hint object returned from a prior `attemptRedeemFromUrl`
// (or a prior `resolveInvitePreview`-like fetcher) that holds already-fetched
// indexEntry/group records. When the new-user group-redemption flow calls this
// twice — once to discover that displayName is needed, once after the prompt —
// passing `cache` back on the second call skips duplicate index/group reads.
export async function attemptRedeemFromUrl(token, redeemerUid, redeemerCode, opts = {}) {
  if (!token) return null;
  const cache = opts.cache || {};
  const indexEntry = cache.indexEntry !== undefined ? cache.indexEntry : await readInviteIndex(token);
  if (!indexEntry) return { ok: false, reason: 'not-found' };

  if (indexEntry.scope === 'personal') {
    const followingSet = new Set(getFollowing().map((e) => e.userId));
    return redeemPersonalInvite(token, redeemerUid, redeemerCode, followingSet);
  }
  if (indexEntry.scope === 'group') {
    const groupId = parseGroupIdFromOwnerPath(indexEntry.ownerPath);
    if (!opts.displayName) {
      // Preview the group name now so the caller can populate the displayname
      // prompt without a separate resolveInvitePreview round trip. Bundle the
      // already-fetched records into `cache` so the post-prompt call can
      // reuse them.
      const group = cache.group !== undefined
        ? cache.group
        : (groupId ? await readGroup(groupId) : null);
      return {
        ok: false,
        reason: 'needs-display-name',
        groupId,
        groupName: group?.name || null,
        cache: { indexEntry, group },
      };
    }
    return redeemGroupInvite(token, redeemerUid, opts.displayName, { cache: { indexEntry, group: cache.group } });
  }
  return { ok: false, reason: 'not-found' };
}

function parseGroupIdFromOwnerPath(ownerPath) {
  const m = ownerPath.match(/^groups\/([^/]+)\/invites\/[^/]+$/);
  return m ? m[1] : null;
}

// Resolves invite metadata for the pre-redemption preview. Handles both
// personal-scope (returns { scope, label }) and group-scope (returns { scope, groupName, groupId }).
// Returns null on any failure (missing token, revoked, DB error, etc.).
export async function resolveInvitePreview(token) {
  if (!token) return null;
  try {
    const indexEntry = await readInviteIndex(token);
    if (!indexEntry) return null;

    if (indexEntry.scope === 'personal') {
      const m = indexEntry.ownerPath.match(/^users\/([^/]+)\/invites\/([^/]+)$/);
      if (!m) return null;
      const invite = await readUserInvite(m[1], m[2]);
      if (!invite || invite.revoked) return null;
      return { scope: 'personal', label: invite.creatorLabel || null };
    }

    if (indexEntry.scope === 'group') {
      const m = indexEntry.ownerPath.match(/^groups\/([^/]+)\/invites\/([^/]+)$/);
      if (!m) return null;
      // Independent reads — fire in parallel.
      const [group, invitesByToken] = await Promise.all([
        readGroup(m[1]),
        readGroupInvites(m[1]),
      ]);
      if (!group) return null;
      const invite = invitesByToken[m[2]];
      if (!invite || invite.revoked) return null;
      return { scope: 'group', groupName: group.name || null, groupId: m[1] };
    }

    return null;
  } catch {
    return null;
  }
}

// Looks up just the creatorLabel for a personal-scope invite. Used by the welcome
// screen to name the inviter before the user has an identity. Returns null on any
// failure (missing token, not in index, not personal, revoked, DB error) so the
// caller can fall back to the generic welcome.
export async function resolveInviteCreatorLabel(token) {
  if (!token) return null;
  try {
    const indexEntry = await readInviteIndex(token);
    if (!indexEntry || indexEntry.scope !== 'personal') return null;
    const match = indexEntry.ownerPath.match(/^users\/([^/]+)\/invites\/([^/]+)$/);
    if (!match) return null;
    const invite = await readUserInvite(match[1], match[2]);
    if (!invite || invite.revoked) return null;
    return invite.creatorLabel || null;
  } catch {
    return null;
  }
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

// The SW's cold-start deep-link for invite/follow-request taps (sw.template.js
// coldStartUrl). When set, boot lands in Direct and opens the Inbox modal
// instead of restoring the user's last (possibly group) context.
export function extractInboxIntentFromUrl(urlStr) {
  try {
    return new URL(urlStr).searchParams.get('inbox') === '1';
  } catch {
    return false;
  }
}

function findActiveGroupInviteForCreator(collection, creatorUid) {
  for (const [token, inv] of Object.entries(collection || {})) {
    if (inv && inv.scope === 'group' && inv.creatorUid === creatorUid && !inv.revoked) {
      return { token, ...inv };
    }
  }
  return null;
}

export async function createGroupInvite(creatorUid, groupId) {
  const collection = await readGroupInvites(groupId);
  const existing = findActiveGroupInviteForCreator(collection, creatorUid);
  if (existing) {
    return { token: existing.token, url: buildInviteUrl(existing.token), existing: true };
  }

  let token;
  let claimed = false;
  for (let attempt = 0; attempt < 8 && !claimed; attempt += 1) {
    token = generateInviteToken();
    claimed = await claimInviteToken(token, `groups/${groupId}/invites/${token}`);
  }
  if (!claimed) throw new Error('Could not allocate an invite token. Try again.');

  const now = Date.now();
  await writeGroupInvite(groupId, token, {
    scope: 'group',
    token,
    creatorUid,
    createdAt: now,
    expiresAt: null,
    redemptionCap: null,
    redemptionsUsed: 0,
    revoked: false,
  });
  return { token, url: buildInviteUrl(token), existing: false };
}

export async function revokeGroupInvite(creatorUid, groupId) {
  const collection = await readGroupInvites(groupId);
  const active = findActiveGroupInviteForCreator(collection, creatorUid);
  if (!active) return;
  await setGroupInviteRevoked(groupId, active.token);
  await releaseInviteToken(active.token);
}

export async function regenerateGroupInvite(creatorUid, groupId) {
  await revokeGroupInvite(creatorUid, groupId);
  return createGroupInvite(creatorUid, groupId);
}

// `opts.cache` mirrors `attemptRedeemFromUrl`'s cache: pre-fetched indexEntry
// and group records, plumbed forward so the post-prompt redemption skips the
// reads the pre-prompt preview already paid for.
export async function redeemGroupInvite(token, redeemerUid, displayName, opts = {}) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'not-found' };
  const cache = opts.cache || {};

  const indexEntry = cache.indexEntry !== undefined ? cache.indexEntry : await readInviteIndex(token);
  if (!indexEntry) return { ok: false, reason: 'not-found' };
  if (indexEntry.scope !== 'group') return { ok: false, reason: 'not-found' };

  const match = indexEntry.ownerPath.match(/^groups\/([^/]+)\/invites\/([^/]+)$/);
  if (!match) return { ok: false, reason: 'not-found' };
  const [, groupId] = match;

  // Parallelize the remaining independent reads: group record (if not cached),
  // group invites, and the redeemer's current membership row. All three are
  // independent — sequencing them costs round trips for no reason.
  const [group, invitesByToken, existingMember] = await Promise.all([
    cache.group !== undefined ? Promise.resolve(cache.group) : readGroup(groupId),
    readGroupInvites(groupId),
    readMember(groupId, redeemerUid),
  ]);
  if (!group) return { ok: false, reason: 'group-missing' };

  const invite = invitesByToken[token];
  if (!invite) return { ok: false, reason: 'not-found' };
  if (invite.revoked) return { ok: false, reason: 'revoked' };
  if (invite.expiresAt != null && invite.expiresAt < Date.now()) return { ok: false, reason: 'expired' };
  if (invite.redemptionCap != null && (invite.redemptionsUsed || 0) >= invite.redemptionCap) {
    return { ok: false, reason: 'cap' };
  }
  if (existingMember) {
    return { ok: false, reason: 'already-member', groupId, groupName: group.name };
  }

  // joinGroup validates displayName (throws on empty / too-long) and throws
  // 'Group not found.' if the group is deleted in the window since our guard.
  // Surface either as a structured result so callers always get { ok, reason }.
  // Pass `group` + `existing` so joinGroup doesn't re-read what we just fetched.
  try {
    await joinGroup(groupId, redeemerUid, displayName, { group, existing: existingMember });
  } catch (err) {
    if (/not found/i.test(err.message || '')) return { ok: false, reason: 'group-missing' };
    return { ok: false, reason: 'invalid-display-name', message: err.message || 'Invalid display name.' };
  }
  await incrementGroupInviteRedemptions(groupId, token);

  return { ok: true, groupId, groupName: group.name };
}
