// js/invites.ts
// Invite-link primitive. Phase 0 supports personal-scope only.
// Token format: 22 chars from URL-safe base64 (128 bits of entropy).

import {
  claimInviteToken, writeUserInvite, readUserInvites,
  setInviteRevoked, setInviteLabel, releaseInviteToken,
  readInviteIndex, readUserInvite, incrementInviteRedemptions, getCreatorCode,
  registerAsFollower, setFollowingEntry,
  writeGroupInvite, readGroupInvites, readGroupInvite, setGroupInviteRevoked,
  readGroupName, readMember, callResolveInvitePreview,
} from './db.js';
import { getFollowing } from './store.js';
import { joinGroup } from './groups.js';

// The invite-index leaf: which collection owns a token (spec §9). The db layer
// returns it as an opaque record; this is the shape this module reads off it.
interface InviteIndexEntry {
  scope?: string;
  ownerPath: string;
}

// A personal- or group-scope invite record as stored under the owner path. Every
// field is optional because the db layer hands back a loose record; the readers
// below guard each one before use.
interface InviteRecord {
  scope?: string;
  token?: string;
  creatorUid?: string;
  creatorLabel?: string;
  createdAt?: number;
  expiresAt?: number | null;
  redemptionCap?: number | null;
  redemptionsUsed?: number;
  revoked?: boolean;
}

// The group name leaf readGroupName returns (only `.name` is consumed here).
interface GroupNameRecord {
  name: unknown;
}

// Pre-fetched records plumbed forward between the two-phase group-redemption
// calls so the post-prompt redeem skips the reads the pre-prompt preview paid for.
interface RedeemCache {
  indexEntry?: InviteIndexEntry | null;
  group?: GroupNameRecord | null;
}

interface AttemptRedeemOpts {
  cache?: RedeemCache;
  redeemerName?: string | null;
  displayName?: string;
}

interface RedeemGroupOpts {
  cache?: RedeemCache;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LABEL_MAX = 40;
const APP_URL_BASE = (typeof location !== 'undefined' && location.origin) ? location.origin : '';

export function generateInviteToken(): string {
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

function validateLabel(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('Creator label must be a string.');
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new Error('Creator label cannot be empty.');
  if (trimmed.length > LABEL_MAX) throw new Error(`Creator label must be at most ${LABEL_MAX} chars.`);
  return trimmed;
}

export function buildInviteUrl(token: string): string {
  // /invite, not /?i= (spec N1/A1): the shared link itself lands on the
  // mint-free landing — no boot, no detection needed, identically on every
  // platform. Legacy /?i= links are caught by the boot gate (inviteBootGate).
  return `${APP_URL_BASE}/invite?i=${token}`;
}

function findActivePersonalInvite(collection: Record<string, unknown> | null | undefined) {
  for (const [token, inv] of Object.entries(collection || {})) {
    const rec = inv as InviteRecord | null;
    if (rec && rec.scope === 'personal' && !rec.revoked) return { token, ...rec };
  }
  return null;
}

export async function createPersonalInvite(userId: string, creatorLabelRaw: unknown) {
  const creatorLabel = validateLabel(creatorLabelRaw);

  // Enforce one-active-personal-invite-per-user (spec §9.3).
  const collection = await readUserInvites(userId);
  const existing = findActivePersonalInvite(collection);
  if (existing) {
    return { token: existing.token, url: buildInviteUrl(existing.token), existing: true };
  }

  // Allocate a fresh token, retrying on the very rare collision.
  let token!: string;
  let claimed = false;
  for (let attempt = 0; attempt < 8 && !claimed; attempt += 1) {
    token = generateInviteToken();
    claimed = await claimInviteToken(token, `users/${userId}/invites/${token}`, userId);
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

export async function revokePersonalInvite(userId: string) {
  const collection = await readUserInvites(userId);
  const active = findActivePersonalInvite(collection);
  if (!active) return;
  await setInviteRevoked(userId, active.token);
  await releaseInviteToken(active.token);
}

export async function regeneratePersonalInvite(userId: string, creatorLabelRaw: unknown) {
  // Validate label up-front so a bad label doesn't cause us to revoke first and fail second.
  const creatorLabel = validateLabel(creatorLabelRaw);
  await revokePersonalInvite(userId);
  return createPersonalInvite(userId, creatorLabel);
}

// Rewrites just the creatorLabel on an existing personal invite (token/URL
// unchanged, so already-shared links keep working). Lets a re-share refresh a
// stale label — e.g. the arrival interstitial naming the inviter by their
// current Telegram first name rather than a name captured at create time (§29).
export async function updateInviteLabel(userId: string, token: string, creatorLabelRaw: unknown) {
  const creatorLabel = validateLabel(creatorLabelRaw);
  await setInviteLabel(userId, token, creatorLabel);
  return creatorLabel;
}

// Result shapes:
//   success: { ok: true, creatorUid, creatorCode, creatorLabel }
//   failure: { ok: false, reason: 'not-found'|'revoked'|'expired'|'cap'|'self'|'already-following'|'creator-missing' }
//
// alreadyFollowingSet: optional Set<string> of creator UIDs the redeemer already follows.
//   Null/undefined is treated as "not following anyone" — the function won't throw.
export async function redeemPersonalInvite(token: string, redeemerUid: string, redeemerCode: string, alreadyFollowingSet?: Set<string> | null, redeemerName?: string | null) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'not-found' };

  const indexEntry = await readInviteIndex(token) as InviteIndexEntry | null;
  if (!indexEntry) return { ok: false, reason: 'not-found' };
  if (indexEntry.scope !== 'personal') return { ok: false, reason: 'not-found' };

  // Parse owner path: users/{uid}/invites/{token}
  const match = indexEntry.ownerPath.match(/^users\/([^/]+)\/invites\/([^/]+)$/);
  if (!match) return { ok: false, reason: 'not-found' };
  const [, creatorUid] = match;

  const invite = await readUserInvite(creatorUid, token) as InviteRecord | null;
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
  // redeemerName (the redeemer's own display name — Telegram first name) rides
  // along so the creator's followers list can show "CODE (Name)" for a follow
  // that never went through a follow-request approval to teach them the name.
  // G10: the refusable write goes FIRST. The creator's presence/code was read
  // at :201, but they can be purged between that read and these writes; in
  // that window the G6 rules guard refuses setFollowingEntry, and running it
  // first means registerAsFollower never writes users/{creator}/followers/{me}
  // (plus its followerNames sibling) for an account that is gone. The refusal
  // propagates as a throw rather than becoming reason: 'creator-missing' —
  // "that invite is dead" and "couldn't check" are different answers (W1 J#1).
  await setFollowingEntry(redeemerUid, creatorUid, creatorCode, followLabel);
  await registerAsFollower(creatorUid, redeemerUid, redeemerCode, redeemerName);
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
export async function attemptRedeemFromUrl(token: string, redeemerUid: string, redeemerCode: string, opts: AttemptRedeemOpts = {}) {
  if (!token) return null;
  const cache = opts.cache || {};
  const indexEntry = cache.indexEntry !== undefined ? cache.indexEntry : (await readInviteIndex(token)) as InviteIndexEntry | null;
  if (!indexEntry) return { ok: false, reason: 'not-found' };

  if (indexEntry.scope === 'personal') {
    const followingSet = new Set(getFollowing().map((e) => e.userId));
    return redeemPersonalInvite(token, redeemerUid, redeemerCode, followingSet, opts.redeemerName);
  }
  if (indexEntry.scope === 'group') {
    const groupId = parseGroupIdFromOwnerPath(indexEntry.ownerPath);
    if (!opts.displayName) {
      // Preview the group name now so the caller can populate the displayname
      // prompt without a separate resolveInvitePreview round trip, and check
      // membership in parallel: an existing member must not be walked through
      // a pointless name prompt only to learn 'already-member' from the
      // post-prompt redeem call. (redeemGroupInvite keeps its own membership
      // guard for the prompt-window race.) Bundle the already-fetched records
      // into `cache` so the post-prompt call can reuse them.
      const [group, existingMember] = await Promise.all([
        cache.group !== undefined
          ? Promise.resolve(cache.group)
          : (groupId ? readGroupName(groupId) : Promise.resolve(null)),
        groupId ? readMember(groupId, redeemerUid) : Promise.resolve(null),
      ]);
      if (existingMember) {
        return { ok: false, reason: 'already-member', groupId, groupName: group?.name || null };
      }
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

function parseGroupIdFromOwnerPath(ownerPath: string): string | null {
  const m = ownerPath.match(/^groups\/([^/]+)\/invites\/[^/]+$/);
  return m ? m[1] : null;
}

// Resolves invite metadata for the pre-redemption welcome-screen framing. Handles
// both personal-scope (returns { scope, label }) and group-scope (returns
// { scope, groupName, groupId }).
//
// Delegates to the unauthenticated `resolveInvitePreview` Cloud callable: this
// runs BEFORE a brand-new user signs in, and every invite node is gated by
// `auth != null` in the security rules, so a direct client read here would be
// permission-denied for exactly the new users this framing targets. The callable
// reads server-side via the Admin SDK and returns only the preview-safe fields.
//
// Outcome contract (W1 J#1): a resolved preview object; null when the callable
// SUCCEEDED and judged the token invalid/revoked/expired; a THROWN
// 'invite-preview-unavailable' when the callable itself failed (network,
// server) — after one internal retry. Callers must not blanket-catch back to
// null: "that invite is dead" and "couldn't check" are different answers.
export async function resolveInvitePreview(token: string) {
  if (!token) return null;
  try {
    return await callResolveInvitePreview(token);
  } catch {
    try {
      return await callResolveInvitePreview(token);
    } catch {
      throw new Error('invite-preview-unavailable');
    }
  }
}

// Looks up just the creatorLabel for a personal-scope invite. Used by the welcome
// screen to name the inviter before the user has an identity. Returns null on any
// failure (missing token, not in index, not personal, revoked, DB error) so the
// caller can fall back to the generic welcome.
export async function resolveInviteCreatorLabel(token: string): Promise<string | null> {
  if (!token) return null;
  try {
    const indexEntry = await readInviteIndex(token) as InviteIndexEntry | null;
    if (!indexEntry || indexEntry.scope !== 'personal') return null;
    const match = indexEntry.ownerPath.match(/^users\/([^/]+)\/invites\/([^/]+)$/);
    if (!match) return null;
    const invite = await readUserInvite(match[1], match[2]) as InviteRecord | null;
    if (!invite || invite.revoked) return null;
    return invite.creatorLabel || null;
  } catch {
    return null;
  }
}

export function extractInviteTokenFromUrl(urlStr: string): string | null {
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
export function extractInboxIntentFromUrl(urlStr: string): boolean {
  try {
    return new URL(urlStr).searchParams.get('inbox') === '1';
  } catch {
    return false;
  }
}

// The SW's cold-start deep-link for a Direct-scope knock/call/availability tap.
// When set, boot lands in Direct (skip the last-context restore) so the Direct
// activity is visible, without opening any modal (#144).
export function extractDirectIntentFromUrl(urlStr: string): boolean {
  try {
    return new URL(urlStr).searchParams.get('direct') === '1';
  } catch {
    return false;
  }
}

function findActiveGroupInviteForCreator(collection: Record<string, unknown> | null | undefined, creatorUid: string) {
  for (const [token, inv] of Object.entries(collection || {})) {
    const rec = inv as InviteRecord | null;
    if (rec && rec.scope === 'group' && rec.creatorUid === creatorUid && !rec.revoked) {
      return { token, ...rec };
    }
  }
  return null;
}

export async function createGroupInvite(creatorUid: string, groupId: string) {
  const collection = await readGroupInvites(groupId);
  const existing = findActiveGroupInviteForCreator(collection, creatorUid);
  if (existing) {
    return { token: existing.token, url: buildInviteUrl(existing.token), existing: true };
  }

  let token!: string;
  let claimed = false;
  for (let attempt = 0; attempt < 8 && !claimed; attempt += 1) {
    token = generateInviteToken();
    claimed = await claimInviteToken(token, `groups/${groupId}/invites/${token}`, creatorUid);
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

export async function revokeGroupInvite(creatorUid: string, groupId: string) {
  const collection = await readGroupInvites(groupId);
  const active = findActiveGroupInviteForCreator(collection, creatorUid);
  if (!active) return;
  await setGroupInviteRevoked(groupId, active.token);
  await releaseInviteToken(active.token);
}

export async function regenerateGroupInvite(creatorUid: string, groupId: string) {
  await revokeGroupInvite(creatorUid, groupId);
  return createGroupInvite(creatorUid, groupId);
}

// `opts.cache` mirrors `attemptRedeemFromUrl`'s cache: pre-fetched indexEntry
// and group records, plumbed forward so the post-prompt redemption skips the
// reads the pre-prompt preview already paid for.
export async function redeemGroupInvite(token: string, redeemerUid: string, displayName: string, opts: RedeemGroupOpts = {}) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'not-found' };
  const cache = opts.cache || {};

  const indexEntry = cache.indexEntry !== undefined ? cache.indexEntry : (await readInviteIndex(token)) as InviteIndexEntry | null;
  if (!indexEntry) return { ok: false, reason: 'not-found' };
  if (indexEntry.scope !== 'group') return { ok: false, reason: 'not-found' };

  const match = indexEntry.ownerPath.match(/^groups\/([^/]+)\/invites\/([^/]+)$/);
  if (!match) return { ok: false, reason: 'not-found' };
  const [, groupId] = match;

  // Parallelize the remaining independent reads: group record (if not cached),
  // the specific invite token, and the redeemer's current membership row. All
  // three are independent — sequencing them costs round trips for no reason.
  // readGroupName (not readGroup): the redeemer is not yet a member, so the
  // membership-gated whole-group node would be denied. The name leaf is enough —
  // it's the only field this flow and joinGroup consume from `group`.
  // readGroupInvite (single token) instead of readGroupInvites (collection)
  // so a non-member cannot enumerate all active invite tokens.
  const [group, invite, existingMember] = await Promise.all([
    cache.group !== undefined ? Promise.resolve(cache.group) : readGroupName(groupId),
    readGroupInvite(groupId, token) as Promise<InviteRecord | null>,
    readMember(groupId, redeemerUid),
  ]);
  if (!group) return { ok: false, reason: 'group-missing' };

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
    await joinGroup(groupId, redeemerUid, displayName, { group, existing: existingMember, token });
  } catch (err) {
    const message = (err as Error).message || '';
    // The callable can reject with the same reason strings our own pre-checks
    // above use (revoked/expired/cap/not-found) when the invite state changes
    // in the race window between our reads and the callable's own re-validation.
    // Surface those verbatim instead of collapsing them into invalid-display-name.
    if (message === 'revoked' || message === 'expired' || message === 'cap' || message === 'not-found') {
      return { ok: false, reason: message };
    }
    if (/not found/i.test(message)) return { ok: false, reason: 'group-missing' };
    return { ok: false, reason: 'invalid-display-name', message: message || 'Invalid display name.' };
  }

  return { ok: true, groupId, groupName: group.name };
}
