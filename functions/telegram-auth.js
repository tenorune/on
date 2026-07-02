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

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function generateShareCode() {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

// Claim a share code in codeIndex transactionally; loop on collision. Mirrors
// the client's initUser (js/db/social.js) so a bot/Mini-App account is
// indistinguishable from a web one.
async function claimShareCode(deps, uid) {
  for (;;) {
    const code = (deps.generateCode || generateShareCode)();
    const { committed } = await deps.transaction(`codeIndex/${code}`, (current) => {
      if (current !== null) return undefined; // abort — taken
      return uid;
    });
    if (committed) return code;
  }
}

// Resolve (or create) the app account behind a Telegram user. Idempotent.
//  - No mapping → derive uid, write mapping + reverse index + prefs defaults.
//  - No presence → bootstrap it (claim code) so bot commands work pre-Mini-App.
// Returns { uid, created, linked }.
export async function ensureTelegramUser(deps, tgUser) {
  const tgId = String(tgUser.id);
  const derivedUid = deriveTelegramUid(tgId);
  let mapping = await deps.getVal(`telegramUsers/${tgId}`);
  if (!mapping) {
    mapping = { uid: derivedUid, chatId: tgId, createdAt: deps.now() };
    await deps.set(`telegramUsers/${tgId}`, mapping);
    await deps.set(`telegramByUid/${derivedUid}`, { tgId, chatId: tgId });
    await deps.update(`userPrefs/${derivedUid}`, {
      'telegram/tgId': tgId,
      'telegram/linkedAt': deps.now(),
      notifyChannel: 'telegram',
    });
  }
  let created = false;
  const presence = await deps.getVal(`users/${mapping.uid}/presence`);
  if (!presence) {
    const code = await claimShareCode(deps, mapping.uid);
    await deps.set(`users/${mapping.uid}/presence`, { code, status: 'unavailable', availableUntil: null });
    created = true;
  }
  return { uid: mapping.uid, created, linked: mapping.uid !== derivedUid };
}

function requireTelegramUser(request, deps) {
  if (!deps.botToken) throw new HttpsError('failed-precondition', 'Telegram is not configured.');
  const tgUser = verifyInitData(request.data?.initData, deps.botToken, deps.now());
  if (!tgUser) throw new HttpsError('unauthenticated', 'Invalid Telegram signature.');
  return tgUser;
}

// Mini App boot: verify initData, ensure the account exists, mint a token.
export async function validateTelegramHandler(request, deps) {
  const tgUser = requireTelegramUser(request, deps);
  const { uid, created, linked } = await ensureTelegramUser(deps, tgUser);
  const token = await deps.mintToken(uid);
  return { token, uid, created, linked };
}

// Link the Telegram identity to an existing phrase account. The phrase goes
// through the same derived-uid rate limiter as validateRecovery (brute-force
// parity). The old derived account is left orphaned (spec: accepted trade-off);
// its reverse index is removed so notifications can't route to it.
export async function linkTelegramHandler(request, deps) {
  const tgUser = requireTelegramUser(request, deps);
  const normalized = normalizeRecoveryCode(request.data?.code);
  if (!normalized) throw new HttpsError('invalid-argument', 'Invalid recovery code.');
  const uid = await deriveUid(normalized);
  if (!(await deps.allowAttempt(uid))) throw new HttpsError('resource-exhausted', 'Too many attempts. Try again shortly.');
  const presence = await deps.getVal(`users/${uid}/presence`);
  if (!presence) throw new HttpsError('not-found', 'No account with that phrase.');
  const tgId = String(tgUser.id);
  const prior = await deps.getVal(`telegramUsers/${tgId}`);
  const chatId = prior?.chatId || tgId;
  if (prior && prior.uid !== uid) {
    // Direct relink (A→B) without an intervening unlink: account A must not be
    // left stranded pointing at a dead telegram channel, so reset its prefs
    // the same way unlinkTelegramHandler does.
    await deps.set(`telegramByUid/${prior.uid}`, null);
    await deps.update(`userPrefs/${prior.uid}`, { telegram: null, notifyChannel: 'push' });
  }
  await deps.set(`telegramUsers/${tgId}`, { uid, chatId, linkedAt: deps.now() });
  await deps.set(`telegramByUid/${uid}`, { tgId, chatId });
  await deps.update(`userPrefs/${uid}`, {
    'telegram/tgId': tgId,
    'telegram/linkedAt': deps.now(),
    notifyChannel: 'telegram',
  });
  const token = await deps.mintToken(uid);
  return { token };
}

// Revert the mapping to the Telegram-derived account. The phrase account goes
// back to push delivery (it no longer has a Telegram route).
export async function unlinkTelegramHandler(request, deps) {
  const tgUser = requireTelegramUser(request, deps);
  const tgId = String(tgUser.id);
  const prior = await deps.getVal(`telegramUsers/${tgId}`);
  const derivedUid = deriveTelegramUid(tgId);
  const chatId = prior?.chatId || tgId;
  if (prior && prior.uid !== derivedUid) {
    await deps.set(`telegramByUid/${prior.uid}`, null);
    await deps.update(`userPrefs/${prior.uid}`, { telegram: null, notifyChannel: 'push' });
  }
  await deps.set(`telegramUsers/${tgId}`, { uid: derivedUid, chatId, createdAt: deps.now() });
  await deps.set(`telegramByUid/${derivedUid}`, { tgId, chatId });
  const { uid } = await ensureTelegramUser(deps, tgUser); // re-bootstrap presence if needed
  const token = await deps.mintToken(uid);
  return { token };
}
