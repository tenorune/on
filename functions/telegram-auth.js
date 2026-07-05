// functions/telegram-auth.js — Telegram Mini App auth: initData verification,
// uid mapping/bootstrap, and the validate/link/unlink callable handlers.
// Deps are injected (see index.js) so everything tests without firebase-admin.
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { normalizeRecoveryCode, deriveUid } from './auth.js';
import { WELCOME_STRANGER_TEXT, openAppKeyboard } from './telegram-shared.js';

const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // initData replay window
// auth_date is HMAC-protected, this is defense-in-depth against clock nonsense.
const FUTURE_SKEW_MS = 5 * 60 * 1000;

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
  if (!authDateMs || now - authDateMs > maxAgeMs || authDateMs - now > FUTURE_SKEW_MS) return null;
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
    // Console differentiation (spec §8): stamp the Auth record with an
    // ANONYMOUS synthetic email — derived from the app uid only, never the
    // Telegram handle or numeric id (zero new information in Auth records).
    // Non-fatal: a console nicety must never break account bootstrap.
    try {
      await deps.setAuthEmail?.(derivedUid, `tg-${derivedUid}@telegram.invalid`);
    } catch (e) {
      console.error('[telegram] setAuthEmail failed (non-fatal):', e);
    }
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
  // First-ever open that created this account (not one already bootstrapped by
  // /start): send a one-time welcome DM. It gives an invited user who arrived via
  // a deep link and never typed /start a bot chat — their persistent re-entry
  // point (Menu Button + Open button). Non-fatal: a failed DM (e.g. the user
  // never granted PM write access) must never break Mini App boot.
  if (created && deps.sendMessage) {
    try {
      await deps.sendMessage(String(tgUser.id), WELCOME_STRANGER_TEXT, openAppKeyboard(deps.appUrl));
    } catch (e) {
      console.error('[telegram] welcome DM failed (non-fatal):', e);
    }
  }
  return { token, uid, created, linked };
}

// Link the Telegram identity to an existing phrase account. The phrase goes
// through the same derived-uid rate limiter as validateRecovery (brute-force
// parity). A prior Telegram-derived account is EXPUNGED (see the branch
// below) — the client warns first; a prior phrase account (direct relink)
// is left intact with its telegram routing/prefs reset.
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
    if (prior.uid === deriveTelegramUid(tgId)) {
      // Linking retires the temporary Telegram-derived account completely:
      // its uid is deterministic, so anything left behind (mapping, prefs,
      // social residue) would resurrect as a shadow account (same rationale
      // as unlink).
      await expungeDerivedAccount(deps, prior.uid);
      await deps.set(`telegramByUid/${prior.uid}`, null);
    } else {
      // Direct relink (A→B) without an intervening unlink: account A is a
      // real phrase account and must never be expunged (it stays reachable
      // via its phrase) — just reset its prefs off telegram the same way
      // unlinkTelegramHandler does.
      await deps.set(`telegramByUid/${prior.uid}`, null);
      await deps.update(`userPrefs/${prior.uid}`, { telegram: null, notifyChannel: 'push' });
    }
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

// Delete every RTDB record of the Telegram-derived shadow account, including
// residue it left on other users' records (follower/following backrefs,
// shared canvases, group memberships/ownership, invite tokens). Reads first,
// then deletes, so a half-populated account doesn't blow up on missing nodes.
//
// Deliberately NOT cleaned (transient/server-only, self-healing):
//  - Knocks this uid sent that are sitting in OTHER users' `knocks/{them}`
//    inboxes — those are addressed to the recipient, not owned by this uid.
//  - `notifierState` cooldown bookkeeping.
export async function expungeDerivedAccount(deps, uid) {
  const [presence, invites, followers, following, groups] = await Promise.all([
    deps.getVal(`users/${uid}/presence`),
    deps.getVal(`users/${uid}/invites`),
    deps.getVal(`users/${uid}/followers`),
    deps.getVal(`userPrefs/${uid}/following`),
    deps.getVal(`users/${uid}/groups`),
  ]);

  if (presence?.code) await deps.set(`codeIndex/${presence.code}`, null);

  for (const token of Object.keys(invites || {})) {
    await deps.set(`inviteIndex/${token}`, null);
  }

  for (const fid of Object.keys(followers || {})) {
    await deps.set(`userPrefs/${fid}/following/${uid}`, null);
  }

  for (const tid of Object.keys(following || {})) {
    await deps.set(`users/${tid}/followers/${uid}`, null);
  }

  const peers = new Set([...Object.keys(followers || {}), ...Object.keys(following || {})]);
  for (const peer of peers) {
    await deps.set(`canvases/${uid}_${peer}`, null);
    await deps.set(`canvases/${peer}_${uid}`, null);
  }

  for (const gid of Object.keys(groups || {})) {
    const ownerId = await deps.getVal(`groups/${gid}/ownerId`);
    if (ownerId === uid) {
      await deps.set(`groups/${gid}`, null);
      await deps.set(`pendingInvitesByGroup/${gid}`, null);
    } else {
      await deps.set(`groups/${gid}/members/${uid}`, null);
      await deps.set(`pendingInvitesByGroup/${gid}/${uid}`, null);
    }
  }

  await deps.set(`knocks/${uid}`, null);
  await deps.set(`calls/${uid}`, null);
  await deps.set(`followRequests/${uid}`, null);
  await deps.set(`followGrants/${uid}`, null);
  await deps.set(`pendingInvites/${uid}`, null);
  await deps.set(`revocations/${uid}`, null);

  await deps.set(`users/${uid}`, null);
  await deps.set(`userPrefs/${uid}`, null);
}

// Unlink expunges the Telegram identity entirely: the derived uid is
// deterministic (deriveTelegramUid), so simply reverting the mapping used to
// resurrect a shadow account that kept its pre-link state forever — able to
// set availability and knock with no real contact watching it. Instead we
// delete every RTDB record of the derived account (and its cross-user
// residue) and leave the mapping gone; reopening the Mini App afterwards
// bootstraps a genuinely fresh account at the same derived uid.
export async function unlinkTelegramHandler(request, deps) {
  const tgUser = requireTelegramUser(request, deps);
  const tgId = String(tgUser.id);
  const derivedUid = deriveTelegramUid(tgId);
  const prior = await deps.getVal(`telegramUsers/${tgId}`);
  if (prior && prior.uid !== derivedUid) {
    // Linked phrase account: clean it the same way a direct relink would.
    await deps.set(`telegramByUid/${prior.uid}`, null);
    await deps.update(`userPrefs/${prior.uid}`, { telegram: null, notifyChannel: 'push' });
  }
  await expungeDerivedAccount(deps, derivedUid);
  await deps.set(`telegramUsers/${tgId}`, null);
  await deps.set(`telegramByUid/${derivedUid}`, null);
  return { ok: true };
}
