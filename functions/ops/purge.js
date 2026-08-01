// functions/ops/purge.js — purge previews and the Telegram link-impact report.
//
// Purge is buildExpungeWrites (functions/telegram-auth.js) unchanged: the ONE
// enumerator expunge, graduation and merge already share builds the null-set,
// and this module only adds the human-readable loss report — which peers lose a
// contact, and, the sharpest edge in the tool, which groups are DELETED for
// every member because the purged account owns them. Nothing here re-lists a
// residue path family; a temptation to do so belongs in crossRefRenderers.
//
// buildLinkImpact answers "would linking this Telegram-derived account to a
// phrase account destroy anything?". Production's own gate
// (redeemTelegramLinkTokenHandler) counts only followers/following/groups, so
// it is silent about owned groups, canvases, redeemed invite tokens and durable
// mailboxes. This verdict is deliberately stricter. See spec §8.2-8.3.
//
// `writes` is the PREVIEW set — what an operator approves — and a SUPERSET of
// the wire payload: rootUpdate drops a null that sits under an already-nulled
// ancestor as a redundant delete. Correct for a loss report; nothing here may
// be labelled "what will be written".
//
// TWO LOCAL FAMILIES, DELIBERATELY. crossRefRenderers does not emit
// `locations/{uid}` or `locationCells/{gid}/{uid}`, so merge.js handles them
// locally and this module does the same, identically. Whether they belong in
// the enumerator is an open question for the operator: answering it would
// change shipped expunge behaviour, so it is not answered here.
import { buildExpungeWrites } from '../telegram-auth.js';
import { rootUpdate } from '../telegram-shared.js';
import { canvasPeers } from './project.js';
// D3's durability split, imported rather than re-typed: `knocks`/`calls` are
// stale within seconds, the rest is real state a human would miss. Both lists
// are derived from OWN_MAILBOXES, so a seventh mailbox lands here on its own.
import { DROP_MAILBOXES as TRANSIENT_MAILBOXES, UNION_MAILBOXES as DURABLE_MAILBOXES } from './merge.js';

/** @typedef {{ getVal: (path: string) => Promise<any> }} ReadDeps */

/**
 * Prefs keys reported by a dedicated line elsewhere in the report; anything
 * else under userPrefs is private state (palette, favorites, hints,
 * currentContext) that dies with the account and gets its own loss line.
 */
const PREFS_REPORTED_ELSEWHERE = ['telegram', 'notifyChannel', 'following', 'notify'];

/**
 * buildExpungeWrites is declared against the whole Telegram handler surface
 * (TelegramAuthDeps) because it lives beside the callables, but it reads only
 * through `getVal`. The ops panel's deps (ops/deps.js) have no mintToken /
 * allowAttempt / randomToken, and widening that JSDoc would mean editing
 * shipped telegram-auth.js — out of bounds for this task. One narrow assertion
 * at the single call seam, never `any`, never a suppression.
 * @param {ReadDeps} deps
 * @param {string} uid
 * @param {Record<string, unknown>} extraNulls
 * @returns {Promise<Record<string, unknown>>}
 */
function expungeWrites(deps, uid, extraNulls) {
  const authDeps = /** @type {import('../telegram-auth.js').TelegramAuthDeps} */ (deps);
  return buildExpungeWrites(authDeps, uid, extraNulls);
}

/**
 * The two families the shared enumerator does not emit. A null on a path that
 * holds nothing is a no-op, so these are unconditional — conditioning a residue
 * null on a read is exactly how expunge and graduation drifted once before.
 * @param {string} uid
 * @param {string[]} gids
 * @returns {Record<string, null>}
 */
function locationNulls(uid, gids) {
  /** @type {Record<string, null>} */
  const nulls = { [`locations/${uid}`]: null };
  for (const gid of gids) nulls[`locationCells/${gid}/${uid}`] = null;
  return nulls;
}

/** @param {ReadDeps} deps @param {string} uid */
async function readOwn(deps, uid) {
  // Both nodes are bounded (no canvas, no strokes anywhere beneath them) and
  // are read WHOLE so no per-key enumeration can miss a field, exactly as
  // graduateAccountData reads them.
  const [own, prefs] = await Promise.all([
    deps.getVal(`users/${uid}`),
    deps.getVal(`userPrefs/${uid}`),
  ]);
  return { own, prefs };
}

/** A node's child count, tolerating a leaf or an absent node. @param {any} value */
function countEntries(value) {
  if (value === null || value === undefined) return 0;
  return typeof value === 'object' ? Object.keys(value).length : 1;
}

/**
 * The loss report. Every line describes something the write-set destroys;
 * `keeps` holds the things an operator might FEAR are losses but are not —
 * transient mailboxes, a position fix, and the push tokens expunge leaves
 * behind. Canvas and Telegram lines are derived from the finished write-set
 * rather than re-guessed, so a family the enumerator declines to null can never
 * be reported as deleted (and vice versa).
 *
 * @param {ReadDeps} deps
 * @param {string} uid
 * @param {{
 *   own: any,
 *   prefs: any,
 *   writes: Record<string, unknown>,
 *   canvasKeys: string[] | undefined,
 *   tgId: string | null,
 * }} ctx
 * @returns {Promise<{ losses: string[], keeps: string[] }>}
 */
async function describeImpact(deps, uid, { own, prefs, writes, canvasKeys, tgId }) {
  /** @type {string[]} */
  const losses = [];
  /** @type {string[]} */
  const keeps = [];

  // --- contacts -------------------------------------------------------------
  const followerIds = Object.keys(own?.followers || {}).filter((p) => p !== uid);
  const followingIds = Object.keys(prefs?.following || {}).filter((p) => p !== uid);
  const peers = [...new Set([...followerIds, ...followingIds])];
  for (const peer of peers) {
    const code = await deps.getVal(`users/${peer}/presence/code`);
    const inbound = followerIds.includes(peer);
    const outbound = followingIds.includes(peer);
    const how = inbound && outbound
      ? 'a mutual contact'
      : inbound ? 'they followed this account' : 'this account followed them';
    losses.push(`${peer} (${code || 'no code'}) loses this contact — ${how}`);
  }

  // --- groups: owned ones vanish for EVERY member ---------------------------
  for (const gid of Object.keys(own?.groups || {})) {
    const [name, ownerId, members] = await Promise.all([
      deps.getVal(`groups/${gid}/name`),
      deps.getVal(`groups/${gid}/ownerId`),
      deps.getVal(`groups/${gid}/members`),
    ]);
    const others = Object.keys(members || {}).filter((m) => m !== uid);
    if (ownerId === uid) {
      const who = others.length ? `: ${others.join(', ')}` : ' (no other members)';
      losses.push(`group "${name || gid}" is DELETED for every member${who}`);
    } else {
      losses.push(`removed from group "${name || gid}" (the group itself survives)`);
    }
  }

  // --- invite tokens --------------------------------------------------------
  for (const [token, rec] of Object.entries(own?.invites || {})) {
    const used = /** @type {any} */ (rec)?.redemptionsUsed ?? 0;
    losses.push(`invite token ${token} stops working (${used} redemption(s) used)`);
  }

  // --- canvases: reported from the write-set, never from the key list alone --
  if (canvasKeys === undefined) {
    // Silence here would be the worst kind of defect: an account with a drawing
    // would read "safe" and the operator would approve a loss they never saw.
    if (peers.length) {
      losses.push(
        `shared canvases could not be enumerated (no canvas key list supplied) — any canvas with ${peers.join(', ')} is deleted with its drawing history`,
      );
    }
  } else {
    for (const { peer, key } of canvasPeers(canvasKeys, uid)) {
      if (writes[`canvases/${key}`] === null) {
        losses.push(`canvases/${key} (with ${peer}) is deleted — the drawing history is lost`);
      } else {
        // The enumerator only emits canvases with a follower/followee, so a
        // canvas with a stranger survives the account. Residue, not a loss.
        keeps.push(`canvases/${key} is NOT deleted (${peer} is not a contact) — left behind as residue`);
      }
    }
  }

  // --- mailboxes: durable ones are a real loss, transient ones are not ------
  for (const box of DURABLE_MAILBOXES) {
    const count = countEntries(await deps.getVal(`${box}/${uid}`));
    if (count) losses.push(`${box}/${uid} deleted (${count} entr${count === 1 ? 'y' : 'ies'}) — durable state, not recreated`);
  }
  for (const box of TRANSIENT_MAILBOXES) {
    const count = countEntries(await deps.getVal(`${box}/${uid}`));
    if (count) keeps.push(`${box}/${uid} deleted (${count}) — transient, not a loss`);
  }

  // --- private prefs --------------------------------------------------------
  const otherPrefs = Object.keys(prefs || {}).filter((k) => !PREFS_REPORTED_ELSEWHERE.includes(k));
  if (otherPrefs.length) losses.push(`userPrefs/${uid} discarded (${otherPrefs.join(', ')})`);

  // --- telegram mapping: only a loss when the write-set actually nulls it ----
  if (tgId && writes[`telegramUsers/${tgId}`] === null) {
    losses.push(`telegramUsers/${tgId} deleted — this Telegram is unlinked, and the next Mini App open bootstraps a brand-new empty account`);
  }

  // --- not losses -----------------------------------------------------------
  if (countEntries(await deps.getVal(`locations/${uid}`))) {
    keeps.push(`locations/${uid} deleted — a position fix, not durable state, not a loss`);
  }
  const tokens = countEntries(await deps.getVal(`pushTokens/${uid}`));
  if (tokens) {
    // Expunge does not null pushTokens and this module does not add it (that
    // family belongs in the shared enumerator, not here). Nothing is destroyed,
    // so it is not a loss — but the operator should know it is left behind;
    // integrity.js flags it as push-tokens-dangling.
    keeps.push(`pushTokens/${uid} (${tokens}) is NOT deleted — expunge leaves it as residue (integrity: push-tokens-dangling)`);
  }

  return { losses, keeps };
}

/**
 * Preview a purge. Performs NO writes. `canvasKeys` is the shallow key list
 * from the snapshot — the only way to learn which canvases exist without
 * reading a node whose `strokes` child is unbounded. It is the one input that
 * does not come from this live re-read, so it is used ONLY to name losses,
 * never to gate a write: the deletes come from the enumerator either way, and
 * omitting the list produces an explicit "could not be enumerated" loss rather
 * than a silent clean bill of health.
 *
 * @param {ReadDeps} deps
 * @param {string} uid
 * @param {string[]} [canvasKeys]
 * @returns {Promise<import('./types.js').WritePlan>}
 */
export async function buildPurgePlan(deps, uid, canvasKeys) {
  const { own, prefs } = await readOwn(deps, uid);
  // A typo'd uid must not produce an approvable no-op plan.
  if (!own) throw new Error(`purge: no account at users/${uid}`);

  const gids = Object.keys(own.groups || {});
  /** @type {Record<string, unknown>} */
  const extraNulls = locationNulls(uid, gids);

  // The mapping teardown rides the same extraNulls seam unlinkTelegramHandler
  // uses (spec §8.1), so the whole purge stays ONE atomic update. Without it
  // the tgId would resolve to a uid with no account.
  const link = await deps.getVal(`telegramByUid/${uid}`);
  const tgId = link?.tgId ? String(link.tgId) : null;
  if (tgId) {
    extraNulls[`telegramByUid/${uid}`] = null;
    extraNulls[`telegramUsers/${tgId}`] = null;
  }

  const writes = await expungeWrites(deps, uid, extraNulls);
  const { losses } = await describeImpact(deps, uid, { own, prefs, writes, canvasKeys, tgId });
  return { writes, conflicts: [], losses };
}

/**
 * Apply a plan built here. ONE atomic update, exactly like expunge and merge —
 * a crash cannot half-purge. rootUpdate drops the previewed nulls that sit
 * under an already-nulled ancestor, so the wire payload is a SUBSET of
 * plan.writes and nothing else about it differs.
 * @param {{ update: (path: string, writes: Record<string, unknown>) => Promise<unknown> }} deps
 * @param {import('./types.js').WritePlan} plan
 */
export async function applyPurgePlan(deps, plan) {
  await rootUpdate(deps, plan.writes);
}

/**
 * Would linking this Telegram-derived account to a phrase account destroy
 * anything? Renders the same expunge write-set as a loss report, and is
 * strictly stronger than production's gate: safe requires contacts, groups,
 * canvases, invite tokens, durable mailboxes and non-default prefs all zero.
 * Transient residue is listed in `keeps` explicitly as *not* a loss so the
 * report is not noisy (spec §8.3 #1).
 *
 * Passing `[]` for canvasKeys asserts "there are none"; omitting it means "not
 * known", which is reported as a loss rather than assumed away.
 *
 * @param {ReadDeps} deps
 * @param {string} derivedUid
 * @param {string[]} [canvasKeys]
 * @returns {Promise<{ verdict: 'safe' | 'lossy', losses: string[], keeps: string[] }>}
 */
export async function buildLinkImpact(deps, derivedUid, canvasKeys) {
  const { own, prefs } = await readOwn(deps, derivedUid);
  if (!own) throw new Error(`link impact: no account at users/${derivedUid}`);

  // Linking REPOINTS the mapping rather than deleting it, so no mapping
  // teardown here — and therefore no mapping loss line either.
  const writes = await expungeWrites(deps, derivedUid, locationNulls(derivedUid, Object.keys(own.groups || {})));
  const { losses, keeps } = await describeImpact(deps, derivedUid, {
    own, prefs, writes, canvasKeys, tgId: null,
  });
  return { verdict: losses.length ? 'lossy' : 'safe', losses, keeps };
}

/**
 * "Link as production does" — expunge the derived account, then write exactly
 * what performLink (telegram-auth.js:196) writes, folded into the SAME atomic
 * update via the extraNulls seam. For when buildLinkImpact returns 'safe'; use
 * link-via-merge (ops/merge.js with telegramRepoint) whenever it returns
 * 'lossy'. Spec §8.3 #3.
 *
 * @param {ReadDeps} deps
 * @param {{ derivedUid: string, phraseUid: string, now: number }} opts
 * @param {string[]} [canvasKeys]
 * @returns {Promise<import('./types.js').WritePlan>}
 */
export async function buildProductionLinkPlan(deps, { derivedUid, phraseUid, now }, canvasKeys) {
  // Same uid on both sides would put `userPrefs/{uid}` = null alongside
  // `userPrefs/{uid}/telegram/tgId` — a legal-looking preview that rootUpdate
  // rejects at execute. Refuse at build time.
  if (derivedUid === phraseUid) throw new Error('link: derived and phrase uid are the same account');

  const link = await deps.getVal(`telegramByUid/${derivedUid}`);
  if (!link?.tgId) throw new Error(`link: ${derivedUid} has no telegram mapping`);
  if (!(await deps.getVal(`users/${phraseUid}/presence`))) {
    throw new Error(`link: no account with that phrase uid (${phraseUid})`);
  }
  const tgId = String(link.tgId);
  const prior = await deps.getVal(`telegramUsers/${tgId}`);
  // performLink's precedence, with the reverse index as a middle fallback for
  // the asymmetric case where the forward mapping is missing entirely (there,
  // production would invent chatId = tgId; a recorded chatId is strictly
  // better and this is the only place the two differ).
  const chatId = prior?.chatId || link.chatId || tgId;

  const { own, prefs } = await readOwn(deps, derivedUid);
  const writes = await expungeWrites(deps, derivedUid, {
    [`telegramByUid/${derivedUid}`]: null,
    ...locationNulls(derivedUid, Object.keys(own?.groups || {})),
  });

  /** @type {import('./types.js').Conflict[]} */
  const conflicts = [];
  /** @type {string[]} */
  const losses = [];

  if (prior?.uid && prior.uid !== phraseUid && prior.uid !== derivedUid) {
    // performLink's direct-relink branch (A→B): the prior holder is a real
    // phrase account, never expunged — its telegram routing is reset instead.
    // Mirrored exactly, or the panel and the shipped path drift (spec §8.3).
    conflicts.push({
      kind: 'telegram-relink',
      path: `telegramUsers/${tgId}`,
      detail: `tgId ${tgId} is currently linked to ${prior.uid}, not to ${derivedUid}`,
      resolution: `${prior.uid} keeps its account; its telegram prefs reset to push, exactly as performLink does`,
    });
    writes[`telegramByUid/${prior.uid}`] = null;
    writes[`userPrefs/${prior.uid}/telegram`] = null;
    writes[`userPrefs/${prior.uid}/notifyChannel`] = 'push';
    losses.push(`${prior.uid} loses its Telegram link and is reset to notifyChannel: push`);
  }

  const phraseLink = await deps.getVal(`telegramByUid/${phraseUid}`);
  if (phraseLink?.tgId && String(phraseLink.tgId) !== tgId) {
    // performLink overwrites the reverse index and the prefs without touching
    // the old forward mapping. Reproduced verbatim — but an overwrite the
    // operator cannot see is exactly the defect this report exists to prevent.
    conflicts.push({
      kind: 'telegram-relink',
      path: `telegramByUid/${phraseUid}`,
      detail: `${phraseUid} already holds tgId ${phraseLink.tgId}`,
      resolution: `overwritten with tgId ${tgId}; telegramUsers/${phraseLink.tgId} is left pointing at ${phraseUid}, exactly as performLink leaves it`,
    });
    losses.push(`${phraseUid}'s prior Telegram link (tgId ${phraseLink.tgId}) is replaced; telegramUsers/${phraseLink.tgId} is left behind as a stale second mapping`);
  }

  // performLink replaces the mapping NODE, so any child it does not restate
  // dies with it. createdAt is the one that exists in practice.
  for (const field of Object.keys(prior || {})) {
    if (!['uid', 'chatId', 'linkedAt'].includes(field)) {
      losses.push(`telegramUsers/${tgId}.${field} (${JSON.stringify(prior[field])}) is dropped — performLink replaces the mapping node wholesale`);
    }
  }

  writes[`telegramUsers/${tgId}`] = { uid: phraseUid, chatId, linkedAt: now };
  writes[`telegramByUid/${phraseUid}`] = { tgId, chatId };
  writes[`userPrefs/${phraseUid}/telegram/tgId`] = tgId;
  writes[`userPrefs/${phraseUid}/telegram/linkedAt`] = now;
  writes[`userPrefs/${phraseUid}/notifyChannel`] = 'telegram';

  const impact = await describeImpact(deps, derivedUid, { own, prefs, writes, canvasKeys, tgId });
  return { writes, conflicts, losses: [...impact.losses, ...losses] };
}
