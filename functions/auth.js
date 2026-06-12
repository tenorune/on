// functions/auth.js
import { createHash } from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';

// Mirror js/identity.js parseRecoveryCode normalization EXACTLY (minus the
// wordlist check — server-side, format + normalization is all that's needed for
// a correct uid; a non-real code just derives a dead uid). The normalized form
// MUST match the client's so the derived uid matches.
export function normalizeRecoveryCode(input) {
  if (typeof input !== 'string') return null;
  const normalized = input.toLowerCase().replace(/[\s,\-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) return null;
  const tokens = normalized.split('-');
  if (tokens.length !== 4) return null;
  for (const t of tokens) if (!/^[a-z]+$/.test(t)) return null;
  return tokens.join('-');
}

// Mirror js/identity.js deriveUserIdFromRecoveryCode: sha256 hex, first 32 chars.
export async function deriveUid(normalizedCode) {
  return createHash('sha256').update(normalizedCode, 'utf8').digest('hex').slice(0, 32);
}

const RATE_LIMIT = 10;          // per IP
const RATE_WINDOW_MS = 60_000;  // per minute
const _ipHits = new Map();      // ip -> [timestamps]

export function _resetRateLimit() { _ipHits.clear(); }

function rateLimit(ip, now = Date.now()) {
  const hits = (_ipHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) return false;
  hits.push(now);
  _ipHits.set(ip, hits);
  return true;
}

// Dependency-injected (deps.mintToken) so it's testable without firebase-admin.
export async function validateRecoveryHandler(request, deps) {
  const ip = request.rawRequest?.ip || 'unknown';
  if (!rateLimit(ip)) throw new HttpsError('resource-exhausted', 'Too many attempts. Try again shortly.');
  const normalized = normalizeRecoveryCode(request.data?.code);
  if (!normalized) throw new HttpsError('invalid-argument', 'Invalid recovery code.');
  const uid = await deriveUid(normalized);
  const token = await deps.mintToken(uid);
  return { token };
}
