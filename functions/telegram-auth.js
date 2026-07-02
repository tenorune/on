// functions/telegram-auth.js — Telegram Mini App auth: initData verification,
// uid mapping/bootstrap, and the validate/link/unlink callable handlers.
// Deps are injected (see index.js) so everything tests without firebase-admin.
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { normalizeRecoveryCode, deriveUid } from './auth.js';

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // initData replay window

// Verify Telegram WebApp initData per https://core.telegram.org/bots/webapps
// #validating-data-received-via-the-mini-app. Returns the parsed `user` object
// on success, null on any failure (bad signature, stale, malformed).
export function verifyInitData(initData, botToken, now, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  if (typeof initData !== 'string' || !initData || !botToken) return null;
  let params;
  try { params = new URLSearchParams(initData); } catch { return null; }
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const authDateMs = Number(params.get('auth_date') || 0) * 1000;
  if (!authDateMs || now - authDateMs > maxAgeMs) return null;
  let user;
  try { user = JSON.parse(params.get('user') || ''); } catch { return null; }
  if (!user || user.id == null) return null;
  return user;
}

// Telegram-derived app uid — same 32-hex format as phrase uids (auth.js deriveUid).
export function deriveTelegramUid(tgId) {
  return createHash('sha256').update(`telegram:${tgId}`, 'utf8').digest('hex').slice(0, 32);
}
