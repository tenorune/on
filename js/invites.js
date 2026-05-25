// js/invites.js
// Invite-link primitive. Phase 0 supports personal-scope only.
// Token format: 22 chars from URL-safe base64 (128 bits of entropy).

import {
  claimInviteToken, writeUserInvite, readUserInvites,
} from './db.js';

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
