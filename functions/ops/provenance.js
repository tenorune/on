// functions/ops/provenance.js — classify an account's origin.
//
// Three of the four categories are exact. Graduated-vs-linked is a HEURISTIC:
// performLink writes userPrefs/{uid}/telegram/linkedAt and
// telegramUsers/{tgId}.linkedAt in the SAME update (equal), while graduation
// copies the prefs subtree wholesale so its linkedAt is the original bootstrap
// time (strictly older). A graduated account that later re-links reads as
// 'phrase-linked' — hence `exact: false` on both. See spec §6.1.
import { deriveTelegramUid } from '../telegram-auth.js';

/**
 * @param {string} uid
 * @param {{ telegramUsers?: any, telegramByUid?: any, userPrefs?: any }} snapshot
 * @param {string | null | undefined} secret
 * @returns {import('./types.js').ProvenanceResult}
 */
export function classifyProvenance(uid, snapshot, secret) {
  const link = snapshot.telegramByUid?.[uid];
  const tgId = link?.tgId != null ? String(link.tgId) : null;

  if (!tgId) return { kind: 'phrase', exact: true, tgId: null };

  // deriveTelegramUid throws on a missing secret (fail-closed by design), so a
  // panel run without TELEGRAM_UID_SECRET reports unknown instead of guessing.
  let derived = null;
  try {
    derived = deriveTelegramUid(tgId, secret);
  } catch {
    return { kind: 'unknown', exact: false, tgId };
  }

  if (uid === derived) return { kind: 'telegram-derived', exact: true, tgId };

  const mappingLinkedAt = snapshot.telegramUsers?.[tgId]?.linkedAt;
  const prefsLinkedAt = snapshot.userPrefs?.[uid]?.telegram?.linkedAt;
  const graduated = typeof mappingLinkedAt === 'number'
    && typeof prefsLinkedAt === 'number'
    && prefsLinkedAt < mappingLinkedAt;

  return { kind: graduated ? 'graduated' : 'phrase-linked', exact: false, tgId };
}
