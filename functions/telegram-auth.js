// functions/telegram-auth.js — Telegram Mini App auth: initData verification,
// uid mapping/bootstrap, and the validate/link/unlink callable handlers.
// Deps are injected (see index.js) so everything tests without firebase-admin.
import { createHmac, timingSafeEqual } from 'crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { normalizeRecoveryCode, deriveUid } from './auth.js';
import { WELCOME_STRANGER_TEXT, openAppKeyboard, rootUpdate } from './telegram-shared.js';

/**
 * The injected I/O surface (built by functions/index.js; tests inject fakes).
 * getVal returns raw RTDB snapshot values — `any` by design at this seam.
 * @typedef {{
 *   getVal: (path: string) => Promise<any>,
 *   set: (path: string, value: unknown) => Promise<unknown>,
 *   update: (path: string, writes: Record<string, unknown>) => Promise<unknown>,
 *   transaction: (path: string, fn: (current: any) => unknown) => Promise<{ committed: boolean }>,
 *   now: () => number,
 *   mintToken: (uid: string) => Promise<string>,
 *   allowAttempt: (uid: string) => Promise<boolean>,
 *   randomToken: () => string,
 *   sendMessage?: ((chatId: string, text: string, extra?: object) => Promise<unknown>) | null,
 *   setAuthEmail?: ((uid: string, email: string) => Promise<unknown>) | null,
 *   generateCode?: (() => string) | null,
 *   botToken?: string | null,
 *   uidSecret?: string | null,
 *   appUrl?: string | null,
 * }} TelegramAuthDeps
 */
/**
 * Callable request envelope (the fields these handlers read).
 * @typedef {{
 *   data?: { initData?: unknown, code?: unknown, token?: unknown, confirm?: unknown },
 *   auth?: { uid?: string } | null,
 * }} TgRequest
 */

const DEFAULT_MAX_AGE_MS = 4 * 60 * 60 * 1000; // initData replay window (F3 #287: shortened from 24h)
// auth_date is HMAC-protected, this is defense-in-depth against clock nonsense.
const FUTURE_SKEW_MS = 5 * 60 * 1000;

const LINK_TOKEN_TTL_MS = 5 * 60 * 1000; // one-tap web→TG link token lifetime

// Verify Telegram WebApp initData per https://core.telegram.org/bots/webapps
// #validating-data-received-via-the-mini-app. Returns the parsed `user` object
// on success, null on any failure (bad signature, stale, malformed).
/**
 * @param {unknown} initData
 * @param {string | null | undefined} botToken
 * @param {number} now
 * @param {number} [maxAgeMs]
 */
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

// Telegram-derived app uid — same 32-hex format as phrase uids (auth.js
// deriveUid). Keyed by a server-held secret (F1 #287): the tgId is a PUBLIC
// numeric id, so an unkeyed hash would let any authed user compute another
// account's uid and read its world-readable presence (share code, lastSeen).
// HMAC with a secret restores the same unguessability phrase uids already have.
// Fail-closed: a missing secret throws rather than derive a guessable uid.
/** @param {string | number} tgId @param {string | null | undefined} secret */
export function deriveTelegramUid(tgId, secret) {
  if (!secret) throw new Error('TELEGRAM_UID_SECRET is not configured');
  return createHmac('sha256', secret).update(`telegram:${tgId}`, 'utf8').digest('hex').slice(0, 32);
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
/** @param {TelegramAuthDeps} deps @param {string} uid */
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
// Callers that already read telegramUsers/{tgId} pass it as priorMapping
// (null counts as "read and absent"; undefined means "not read") so the
// mapping isn't fetched twice. Returns { uid, created, linked, presence } —
// presence is whatever this function read or bootstrapped, so callers need
// no second presence read either.
/**
 * @param {TelegramAuthDeps} deps
 * @param {{ id: string | number }} tgUser
 * @param {any} [priorMapping]
 */
export async function ensureTelegramUser(deps, tgUser, priorMapping) {
  const tgId = String(tgUser.id);
  const derivedUid = deriveTelegramUid(tgId, deps.uidSecret);
  let mapping = priorMapping === undefined ? await deps.getVal(`telegramUsers/${tgId}`) : priorMapping;
  if (!mapping) {
    mapping = { uid: derivedUid, chatId: tgId, createdAt: deps.now() };
    // Mapping, reverse index, and prefs defaults land atomically — a crash
    // can't leave a mapping without its notification route.
    await rootUpdate(deps, {
      [`telegramUsers/${tgId}`]: mapping,
      [`telegramByUid/${derivedUid}`]: { tgId, chatId: tgId },
      [`userPrefs/${derivedUid}/telegram/tgId`]: tgId,
      [`userPrefs/${derivedUid}/telegram/linkedAt`]: deps.now(),
      [`userPrefs/${derivedUid}/notifyChannel`]: 'telegram',
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
  let presence = await deps.getVal(`users/${mapping.uid}/presence`);
  if (!presence) {
    const code = await claimShareCode(deps, mapping.uid);
    presence = { code, status: 'unavailable', availableUntil: null };
    await deps.set(`users/${mapping.uid}/presence`, presence);
    created = true;
  }
  return { uid: mapping.uid, created, linked: mapping.uid !== derivedUid, presence };
}

/** @param {TgRequest} request @param {TelegramAuthDeps} deps */
function requireTelegramUser(request, deps) {
  // Both the bot token and the uid secret must be configured before any
  // handler derives a uid — fail-closed with a clean precondition error rather
  // than let deriveTelegramUid throw mid-flight (F1 #287).
  if (!deps.botToken || !deps.uidSecret) throw new HttpsError('failed-precondition', 'Telegram is not configured.');
  const tgUser = verifyInitData(request.data?.initData, deps.botToken, deps.now());
  if (!tgUser) throw new HttpsError('unauthenticated', 'Invalid Telegram signature.');
  return tgUser;
}

// Mini App boot: verify initData, ensure the account exists, mint a token.
/** @param {TgRequest} request @param {TelegramAuthDeps} deps */
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

// Callers that already read telegramUsers/{tgId} pass it as priorMapping so it
// isn't fetched twice (redeemTelegramLinkTokenHandler); undefined means "not
// read", null means "read and absent" — same convention as ensureTelegramUser.
/**
 * @param {TelegramAuthDeps} deps
 * @param {string} uid
 * @param {{ id: string | number }} tgUser
 * @param {any} [priorMapping]
 */
export async function performLink(deps, uid, tgUser, priorMapping) {
  const tgId = String(tgUser.id);
  const [presence, prior] = await Promise.all([
    deps.getVal(`users/${uid}/presence`),
    priorMapping === undefined ? deps.getVal(`telegramUsers/${tgId}`) : Promise.resolve(priorMapping),
  ]);
  if (!presence) throw new HttpsError('not-found', 'No account with that phrase.');
  const chatId = prior?.chatId || tgId;
  const now = deps.now();
  /** @type {Record<string, unknown>} */
  const writes = {};
  if (prior && prior.uid !== uid) {
    if (prior.uid === deriveTelegramUid(tgId, deps.uidSecret)) {
      // Linking retires the temporary Telegram-derived account completely.
      await expungeDerivedAccount(deps, prior.uid);
      writes[`telegramByUid/${prior.uid}`] = null;
    } else {
      // Direct relink (A→B): account A is a real phrase account — never expunge;
      // just reset its prefs off telegram (as unlinkTelegramHandler does).
      writes[`telegramByUid/${prior.uid}`] = null;
      writes[`userPrefs/${prior.uid}/telegram`] = null;
      writes[`userPrefs/${prior.uid}/notifyChannel`] = 'push';
    }
  }
  writes[`telegramUsers/${tgId}`] = { uid, chatId, linkedAt: now };
  writes[`telegramByUid/${uid}`] = { tgId, chatId };
  writes[`userPrefs/${uid}/telegram/tgId`] = tgId;
  writes[`userPrefs/${uid}/telegram/linkedAt`] = now;
  writes[`userPrefs/${uid}/notifyChannel`] = 'telegram';
  await rootUpdate(deps, writes);
  return { token: await deps.mintToken(uid) };
}

// Link the Telegram identity to an existing phrase account. The phrase goes
// through the same derived-uid rate limiter as validateRecovery (brute-force
// parity). A prior Telegram-derived account is EXPUNGED (see the branch
// below) — the client warns first; a prior phrase account (direct relink)
// is left intact with its telegram routing/prefs reset.
/** @param {TgRequest} request @param {TelegramAuthDeps} deps */
export async function linkTelegramHandler(request, deps) {
  const tgUser = requireTelegramUser(request, deps);
  const normalized = normalizeRecoveryCode(request.data?.code);
  if (!normalized) throw new HttpsError('invalid-argument', 'Invalid recovery code.');
  const uid = await deriveUid(normalized);
  if (!(await deps.allowAttempt(uid))) throw new HttpsError('resource-exhausted', 'Too many attempts. Try again shortly.');
  return performLink(deps, uid, tgUser);
}

// Authenticated (web session) mint of a single-use token bound to this account's
// uid. The phrase never leaves the device — the web app is already signed in, so
// request.auth.uid identifies the account. Fresh token every call.
/** @param {TgRequest} request @param {TelegramAuthDeps} deps */
export async function mintTelegramLinkTokenHandler(request, deps) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const token = deps.randomToken();
  await deps.set(`telegramLinkTokens/${token}`, { uid, exp: deps.now() + LINK_TOKEN_TTL_MS });
  return { token };
}

// Redeem a mint-token from the web onramp: verify this Telegram (initData),
// resolve the token → account uid, and link. If THIS Telegram already holds a
// standalone account with contacts/groups, linking would expunge it — so return
// needsConfirm (with counts) unless the caller passes confirm:true. Token is
// single-use: deleted only on an actual link.
/** @param {TgRequest} request @param {TelegramAuthDeps} deps */
export async function redeemTelegramLinkTokenHandler(request, deps) {
  const tgUser = requireTelegramUser(request, deps);
  const token = request.data?.token;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    throw new HttpsError('invalid-argument', 'Invalid link token.');
  }
  const rec = await deps.getVal(`telegramLinkTokens/${token}`);
  if (!rec || !rec.uid || (rec.exp && rec.exp < deps.now())) {
    throw new HttpsError('not-found', 'That link expired.');
  }
  const tgId = String(tgUser.id);
  const derivedUid = deriveTelegramUid(tgId, deps.uidSecret);
  const prior = await deps.getVal(`telegramUsers/${tgId}`);
  // Relink: this Telegram is currently linked to a DIFFERENT real account.
  // Linking switches it away from that account (which stays reachable via its
  // own phrase on the web) — a surprising move, so confirm first.
  if (prior?.uid && prior.uid !== rec.uid && prior.uid !== derivedUid) {
    if (!request.data?.confirm) return { needsConfirm: true, reason: 'relink' };
  } else {
    // Standalone/derived account on this Telegram: warn only if linking would
    // expunge data it holds (the same paths expungeDerivedAccount removes).
    const [followers, following, groups] = await Promise.all([
      deps.getVal(`users/${derivedUid}/followers`),
      deps.getVal(`userPrefs/${derivedUid}/following`),
      deps.getVal(`users/${derivedUid}/groups`),
    ]);
    const contacts = new Set([...Object.keys(followers || {}), ...Object.keys(following || {})]).size;
    const groupCount = Object.keys(groups || {}).length;
    if ((contacts > 0 || groupCount > 0) && !request.data?.confirm) {
      return { needsConfirm: true, reason: 'replace', counts: { contacts, groups: groupCount } };
    }
  }
  const result = await performLink(deps, rec.uid, tgUser, prior); // prior already read above (C8)
  await rootUpdate(deps, { [`telegramLinkTokens/${token}`]: null }); // single-use
  return result;
}

// Delete every RTDB record of the Telegram-derived shadow account, including
// residue it left on other users' records (follower/following backrefs,
// shared canvases, group memberships/ownership, invite tokens). Two read
// phases (the account's own lists, then the owned-group check), then ONE
// atomic multi-path update — a crash can't leave a half-expunged account,
// and a half-populated account doesn't blow up on missing nodes.
//
// Deliberately NOT cleaned (transient/server-only, self-healing):
//  - Knocks this uid sent that are sitting in OTHER users' `knocks/{them}`
//    inboxes — those are addressed to the recipient, not owned by this uid.
//  - `notifierState` cooldown bookkeeping.
//
// `extraNulls` lets a caller fold its own disjoint deletes (mapping teardown,
// reverse-index nulls) into the SAME atomic update, so the whole teardown is
// one write with no dangling-mapping crash window (unlinkTelegramHandler).
/**
 * Build the null-set that expunges `uid` — everything expungeDerivedAccount
 * writes, without applying it. Split out so the ops panel can PREVIEW a purge
 * (and render it as a loss report) before anything is destroyed; expunge
 * itself is now this plus one rootUpdate, so preview and execute cannot drift.
 * @param {TelegramAuthDeps} deps
 * @param {string} uid
 * @param {Record<string, unknown> | null} [extraNulls]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildExpungeWrites(deps, uid, extraNulls = null) {
  const [presence, invites, followers, following, groups, pendingInvites] = await Promise.all([
    deps.getVal(`users/${uid}/presence`),
    deps.getVal(`users/${uid}/invites`),
    deps.getVal(`users/${uid}/followers`),
    deps.getVal(`userPrefs/${uid}/following`),
    deps.getVal(`users/${uid}/groups`),
    // Read for the enumerator's by-group sweep entries: the gids of groups this
    // account was invited to but never joined are visible nowhere else.
    deps.getVal(`pendingInvites/${uid}`),
  ]);

  const gids = Object.keys(groups || {});
  const ownerIds = await Promise.all(gids.map((gid) => deps.getVal(`groups/${gid}/ownerId`)));

  /** @type {Record<string, unknown>} */
  const nulls = {};

  if (presence?.code) nulls[`codeIndex/${presence.code}`] = null;

  for (const token of Object.keys(invites || {})) {
    nulls[`inviteIndex/${token}`] = null;
  }

  // Cross-user residue (backrefs, canvases, group membership, mailboxes) — the
  // SAME family graduation moves, from one enumerator so the two can't drift.
  // A self-follow renders paths under `users/{uid}`/`userPrefs/{uid}` (nulled
  // wholesale below); rootUpdate drops those as redundant deletes.
  for (const render of crossRefRenderers({ followers, following, groups, pendingInvites })) {
    nulls[render(uid)] = null;
  }

  // Owned groups are removed WHOLE — the enumerator's per-uid membership/pending
  // nulls under them are redundant and dropped by rootUpdate; membership in
  // groups owned by others stays nulled per-uid by the enumerator above.
  // The by-group index nodes go with them: a group that no longer exists cannot
  // have pending invites, and its coarse location cells would otherwise be
  // stranded under a dead gid — including cells belonging to OTHER members,
  // which the per-uid enumerator has no way to reach.
  gids.forEach((gid, i) => {
    if (ownerIds[i] === uid) {
      nulls[`groups/${gid}`] = null;
      nulls[`pendingInvitesByGroup/${gid}`] = null;
      nulls[`locationCells/${gid}`] = null;
    }
  });

  nulls[`users/${uid}`] = null;
  nulls[`userPrefs/${uid}`] = null;

  if (extraNulls) Object.assign(nulls, extraNulls);

  return nulls;
}

/**
 * @param {TelegramAuthDeps} deps
 * @param {string} uid
 * @param {Record<string, unknown> | null} [extraNulls]
 */
export async function expungeDerivedAccount(deps, uid, extraNulls = null) {
  await rootUpdate(deps, await buildExpungeWrites(deps, uid, extraNulls));
}

// Inbound/self mailboxes keyed by uid — deleted on expunge, moved on graduation
// so a rename leaves no orphaned residue behind at the old uid.
export const OWN_MAILBOXES = ['knocks', 'calls', 'followRequests', 'followGrants', 'pendingInvites', 'revocations'];

// The cross-user residue a Telegram-derived account leaves on OTHER records:
// follower/following backrefs (incl. the self-published followerName), shared
// canvases, group membership + pending-invite entries, and inbound mailboxes.
// ONE enumerator so expunge (nulls each path) and graduation (moves each
// old→new) can't drift apart when a new residue family is added — the reason
// followerNames had to be touched in both. Returned as (uid)=>path renderers:
// the entry SET is fixed by the account's own lists, only the uid embedded in
// each path varies. Self-references (a pathological self-follow) and expunge's
// owned-group wholesale deletes are deliberately NOT special-cased here —
// expunge's rootUpdate drops the redundant nulls and graduation's
// doomed/consumed guards handle the overlaps, so both stay correct without the
// enumerator knowing. Order matters: it is the graduation walker's original
// move order, so the consumed-source dedup picks the same winner.
/**
 * `pendingInvites` is the raw `pendingInvites/{uid}` node and only its KEYS are
 * read, so it is typed as the map it is rather than joining the three `any`
 * boundary annotations beside it.
 * @param {{ followers?: any, following?: any, groups?: any, pendingInvites?: Record<string, unknown> | null }} lists
 * @returns {Array<(u: string) => string>}
 */
export function crossRefRenderers({ followers, following, groups, pendingInvites }) {
  const followerIds = Object.keys(followers || {});
  const followingIds = Object.keys(following || {});
  const peers = new Set([...followerIds, ...followingIds]);
  const gids = Object.keys(groups || {});
  /** @type {Array<(u: string) => string>} */
  const r = [];
  for (const fid of followerIds) r.push((u) => `userPrefs/${fid}/following/${u}`);
  for (const tid of followingIds) {
    r.push((u) => `users/${tid}/followers/${u}`);
    r.push((u) => `users/${tid}/followerNames/${u}`);
  }
  for (const peer of peers) {
    r.push((u) => `canvases/${u}_${peer}`);
    r.push((u) => `canvases/${peer}_${u}`);
  }
  for (const gid of gids) {
    r.push((u) => `groups/${gid}/members/${u}`);
    r.push((u) => `pendingInvitesByGroup/${gid}/${u}`);
  }
  for (const box of OWN_MAILBOXES) {
    r.push((u) => `${box}/${u}`);
  }
  // Location residue. Appended AFTER the pre-existing families so the order
  // above — the graduation walker's original move order, which the
  // consumed-source dedup depends on — is untouched. A location fix is
  // transient, but it is still uid-keyed cross-user-visible residue: left
  // behind it is a position for an account that no longer exists (the
  // `location-dangling` finding), and on graduation it has to follow the
  // account or the next tick is the only thing that restores it.
  r.push((u) => `locations/${u}`);
  for (const gid of gids) r.push((u) => `locationCells/${gid}/${u}`);
  // Pending invites to groups the account has NOT joined. `groups` cannot see
  // these — a pending invite is by definition to a group you are not in yet —
  // so the gids come from the invitee's own mailbox, which is dual-written with
  // this by-group sweep index (js/db/groups.ts). Moving or deleting one without
  // the other is exactly the asymmetry integrity.js reports.
  for (const gid of Object.keys(pendingInvites || {})) {
    if (!gids.includes(gid)) r.push((u) => `pendingInvitesByGroup/${gid}/${u}`);
  }
  return r;
}

// Rename a Telegram-derived account's data from oldUid to newUid — the "move,
// not merge" core of graduation (spec §7). Copies the account's own subtree,
// rewrites every cross-user backref, index, canvas, and group entry that
// names oldUid, and moves inbound mailboxes. Reads the own subtree WHOLE (as
// real RTDB getVal does) so no per-key enumeration can miss a field; every
// movable path is known from own/prefs up front, so the rest is ONE parallel
// read phase and ONE atomic multi-path update (the old per-node copy+delete
// pairs could crash apart; this can't). Absent sources aren't moved, so a
// half-populated account doesn't blow up on missing nodes.
//
// Deliberately does NOT delete the old own subtree itself — the caller folds
// that drop, together with the telegramUsers/telegramByUid repoint, into the
// SAME atomic update via `extraWrites` (the expunge `extraNulls` pattern), so
// the whole graduation is all-or-nothing: either everything moved and the
// mapping flipped, or nothing happened and a retry starts clean. (The §38
// split-brain window — a crash between the move and a separate flip update
// stranding backrefs at newUid while the mapping still pointed at the derived
// uid, wedging same-phrase retries on the already-exists guard — is closed by
// this folding.) A move's target that lands INSIDE a subtree extraWrites
// deletes wholesale (a pathological self-follow's backrefs) is dropped: it
// used to be written and then deleted across the two updates, and as part of
// one update it would be an illegal ancestor overlap — the delete wins either
// way.
/**
 * @param {TelegramAuthDeps} deps
 * @param {string} oldUid
 * @param {string} newUid
 * @param {Record<string, unknown> | null} [extraWrites]
 */
export async function graduateAccountData(deps, oldUid, newUid, extraWrites = null) {
  const [own, prefs, pendingInvites] = await Promise.all([
    deps.getVal(`users/${oldUid}`),
    deps.getVal(`userPrefs/${oldUid}`),
    // Same read expunge makes, for the same reason: the by-group sweep entries
    // for groups this account was invited to but never joined are not derivable
    // from its own subtree, and a move that leaves them behind strands them at
    // a uid that is about to stop existing.
    deps.getVal(`pendingInvites/${oldUid}`),
  ]);

  // Every from→to move pair, from the SAME enumerator expunge nulls (so a new
  // residue family lands in both): render each cross-user path at old→new.
  const gids = Object.keys(own?.groups || {});
  const moves = crossRefRenderers({ followers: own?.followers, following: prefs?.following, groups: own?.groups, pendingInvites })
    .map((render) => [render(oldUid), render(newUid)]);

  const [resolvedMoves, owners] = await Promise.all([
    Promise.all(moves.map(async ([from, to]) => ({ from, to, val: await deps.getVal(from) }))),
    Promise.all(gids.map(async (gid) => ({ gid, ownerId: await deps.getVal(`groups/${gid}/ownerId`) }))),
  ]);

  /** @type {Record<string, unknown>} */
  const writes = {};

  // 1. Copy the own subtree verbatim to the new uid.
  if (own) writes[`users/${newUid}`] = own;
  if (prefs) writes[`userPrefs/${newUid}`] = prefs;

  // 2. Repoint indexes that resolve to the account.
  const code = own?.presence?.code;
  if (code) writes[`codeIndex/${code}`] = newUid;
  for (const token of Object.keys(own?.invites || {})) {
    writes[`inviteIndex/${token}`] = newUid;
  }

  // 3. The moves: write the new key, drop the old — skipping absent sources.
  // A source can appear twice (self-follow: both canvas directions are
  // canvases/{old}_{old}); the old sequential walker moved it once and the
  // second move read an already-nulled source — the first pair wins here too.
  // A target inside a subtree extraWrites deletes wholesale is dropped (see
  // the function comment); its source still nulls, and rootUpdate filters
  // that null when the source sits under the same deleted subtree.
  const nullRoots = Object.keys(extraWrites || {}).filter((k) => /** @type {Record<string, unknown>} */ (extraWrites)[k] === null);
  const doomed = (/** @type {string} */ path) => nullRoots.some((r) => path === r || path.startsWith(`${r}/`));
  const consumed = new Set();
  for (const { from, to, val } of resolvedMoves) {
    if (val === null || val === undefined || consumed.has(from)) continue;
    consumed.add(from);
    if (!doomed(to)) writes[to] = val;
    writes[from] = null;
  }

  // 4. Group ownership follows the member entry.
  for (const { gid, ownerId } of owners) {
    if (ownerId === oldUid) writes[`groups/${gid}/ownerId`] = newUid;
  }

  if (extraWrites) Object.assign(writes, extraWrites);

  await rootUpdate(deps, writes);
}

// Graduation callable (spec §7): give an UNLINKED Telegram-derived account a
// secret phrase, migrating it to the phrase-derived uid so it becomes a
// first-class phrase account ("use the app outside Telegram"). A rename, not a
// merge — the target uid must be free.
/** @param {TgRequest} request @param {TelegramAuthDeps} deps */
export async function graduateTelegramHandler(request, deps) {
  const tgUser = requireTelegramUser(request, deps);
  const normalized = normalizeRecoveryCode(request.data?.code);
  if (!normalized) throw new HttpsError('invalid-argument', 'Invalid recovery code.');
  const newUid = await deriveUid(normalized);
  // Same brute-force limiter as validateRecovery, keyed by the candidate uid.
  if (!(await deps.allowAttempt(newUid))) throw new HttpsError('resource-exhausted', 'Too many attempts. Try again shortly.');

  const tgId = String(tgUser.id);
  const derivedUid = deriveTelegramUid(tgId, deps.uidSecret);
  const [prior, targetPresence] = await Promise.all([
    deps.getVal(`telegramUsers/${tgId}`),
    deps.getVal(`users/${newUid}/presence`),
  ]);
  // Require an unlinked derived account: the mapping must still point at the
  // derived uid. A linked account already has a phrase — nothing to graduate.
  if (!prior || prior.uid !== derivedUid) {
    throw new HttpsError('failed-precondition', 'This Telegram account is not eligible to graduate.');
  }
  // The target uid must be free — graduation never merges into an existing
  // account. The client regenerates a phrase and retries on collision.
  if (targetPresence) {
    throw new HttpsError('already-exists', 'That phrase is already in use. Try another.');
  }

  // The whole graduation — data move, index repoints, mapping flip, and
  // old-subtree drop — lands as ONE atomic update: the flip/drop writes fold
  // into the walker's update via extraWrites (the expunge extraNulls
  // pattern). Either everything moved and the mapping flipped, or nothing
  // happened and a retry starts clean — the §38 split-brain window (crash
  // between a move update and a separate flip update wedging same-phrase
  // retries on the already-exists guard) no longer exists. The mapping stays
  // authoritative until this update; flipping it in the same write is
  // strictly stronger than "flip last".
  const chatId = prior.chatId || tgId;
  await graduateAccountData(deps, derivedUid, newUid, {
    [`telegramUsers/${tgId}`]: { uid: newUid, chatId, linkedAt: deps.now() },
    [`telegramByUid/${derivedUid}`]: null,
    [`telegramByUid/${newUid}`]: { tgId, chatId },
    [`users/${derivedUid}`]: null,
    [`userPrefs/${derivedUid}`]: null,
  });

  return { ok: true, uid: newUid };
}

// Unlink expunges the Telegram identity entirely: the derived uid is
// deterministic (deriveTelegramUid), so simply reverting the mapping used to
// resurrect a shadow account that kept its pre-link state forever — able to
// set availability and knock with no real contact watching it. Instead we
// delete every RTDB record of the derived account (and its cross-user
// residue) and leave the mapping gone; reopening the Mini App afterwards
// bootstraps a genuinely fresh account at the same derived uid.
/** @param {TgRequest} request @param {TelegramAuthDeps} deps */
export async function unlinkTelegramHandler(request, deps) {
  const tgUser = requireTelegramUser(request, deps);
  const tgId = String(tgUser.id);
  const derivedUid = deriveTelegramUid(tgId, deps.uidSecret);
  const prior = await deps.getVal(`telegramUsers/${tgId}`);
  // The mapping teardown (and, for a linked phrase account, its off-telegram
  // reset) fold into expunge's single atomic update — no dangling-mapping
  // window between the expunge and the mapping nulls. All these paths are
  // disjoint from the derived account's own subtree (prior.uid ≠ derivedUid
  // for the linked case; telegramUsers/telegramByUid are separate roots).
  /** @type {Record<string, unknown>} */
  const teardown = {
    [`telegramUsers/${tgId}`]: null,
    [`telegramByUid/${derivedUid}`]: null,
  };
  if (prior && prior.uid !== derivedUid) {
    teardown[`telegramByUid/${prior.uid}`] = null;
    teardown[`userPrefs/${prior.uid}/telegram`] = null;
    teardown[`userPrefs/${prior.uid}/notifyChannel`] = 'push';
  }
  await expungeDerivedAccount(deps, derivedUid, teardown);
  return { ok: true };
}
