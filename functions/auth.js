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

// Dependency-injected so it's testable without firebase-admin:
//  - deps.allowAttempt(uid): shared (RTDB-backed) rate limiter — returns false
//    when the cap is exceeded. Keyed by the DERIVED UID (the account being
//    guessed), not the client IP: an attacker can't rotate the key by spoofing
//    X-Forwarded-For, and the shared store holds the limit across instances.
//  - deps.mintToken(uid): getAuth().createCustomToken.
export async function validateRecoveryHandler(request, deps) {
  const normalized = normalizeRecoveryCode(request.data?.code);
  if (!normalized) throw new HttpsError('invalid-argument', 'Invalid recovery code.');
  const uid = await deriveUid(normalized);
  if (!(await deps.allowAttempt(uid))) {
    throw new HttpsError('resource-exhausted', 'Too many attempts. Try again shortly.');
  }
  const token = await deps.mintToken(uid);
  return { token };
}
