// functions/auth.js
import { createHash } from 'crypto';

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
