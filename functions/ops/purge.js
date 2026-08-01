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
// NO LOCAL FAMILIES. `locations/{uid}` and `locationCells/{gid}/{uid}` used to
// be built here and in merge.js, identically, because crossRefRenderers did not
// emit them; they now come from the enumerator like every other residue family,
// and the owned-group case they could not express — a deleted group stranding
// OTHER members' cells — is handled by the wholesale `locationCells/{gid}` null
// in buildExpungeWrites' owned-group block.
import { buildExpungeWrites } from '../telegram-auth.js';
import { rootUpdate } from '../telegram-shared.js';
import { canvasPeers } from './project.js';
// D3's durability split, imported rather than re-typed: `knocks`/`calls` are
// stale within seconds, the rest is real state a human would miss. Both lists
// are derived from OWN_MAILBOXES, so a seventh mailbox lands here on its own.
import { DROP_MAILBOXES as TRANSIENT_MAILBOXES, UNION_MAILBOXES as DURABLE_MAILBOXES } from './merge.js';
// The ONE Telegram mapping write-block (and the ONE teardown), shared with
// ops/merge.js: performLink's writes existed here as a third hand-written copy
// that had already drifted from the shipped one. Both entry points READ
// telegramUsers/{tgId} before touching it — see telegram-link-write.js for why.
import { buildLinkWrites, buildMappingTeardown } from '../telegram-link-write.js';

/** @typedef {import('../telegram-link-write.js').ReadDeps} ReadDeps */

// The two RTDB nodes this module reads whole, typed to exactly the fields it
// reads BY NAME and no further. Declared here rather than in ops/types.d.ts
// because that file holds the panel's read model — Snapshot, Row, Detail,
// Finding, WritePlan — projections the panel computes, not raw database node
// shapes (Snapshot itself deliberately types `users` as Record<string, any>).
// Putting a raw node shape there would read as a canonical schema that nothing
// else consumes and that would drift from the database in silence. These
// typedefs claim only what this file depends on, so they cannot be wrong about
// anything else.
//
// Every field is optional and every VALUE is `unknown`: a half-populated
// account is normal, RTDB prunes empty nodes out of existence, and this module
// only ever takes Object.keys of these maps. Naming the value shapes (a
// follower's share code, a group's lastVisited) would be inventing a claim
// nothing here verifies.

/** A record under `users/{uid}/invites/{token}`. @typedef {{ redemptionsUsed?: number }} InviteRecord */

/**
 * `users/{uid}`.
 * @typedef {{
 *   followers?: Record<string, unknown>,
 *   groups?: Record<string, unknown>,
 *   invites?: Record<string, InviteRecord>,
 * }} AccountNode
 */

/**
 * `userPrefs/{uid}`. `following` and `notify` are the only fields read by name;
 * the report enumerates the REST of the keys at runtime (Object.keys) precisely
 * because it has to name pref families this typedef does not and should not
 * know about.
 * @typedef {{ following?: Record<string, unknown>, notify?: Record<string, unknown> }} PrefsNode
 */

/**
 * Prefs keys reported by a dedicated line elsewhere in the report; anything
 * else under userPrefs is private state (palette, favorites, hints,
 * currentContext) that dies with the account and gets its own loss line.
 *
 * `notify` sat in this list while NOTHING reported it — a silent loss inside a
 * loss-reporting tool. The contact lines name the peer, not the per-contact
 * notification preference, and merge unions `userPrefs/{uid}/notify/{peer}` as
 * real state. It now has the dedicated line this list claims for it (below),
 * so the entry is true rather than merely asserted.
 */
const PREFS_REPORTED_ELSEWHERE = ['telegram', 'notifyChannel', 'following', 'notify'];

/**
 * buildExpungeWrites is declared against the whole Telegram handler surface
 * (TelegramAuthDeps) because it lives beside the callables, but it reads only
 * through `getVal`. The ops panel's deps (ops/deps.js) have no mintToken /
 * allowAttempt / randomToken, and widening that JSDoc would mean editing
 * shipped telegram-auth.js — out of bounds for this task. ONE assertion, at the
 * single call seam, and not `any`. Be clear about its direction: it WIDENS,
 * asserting mintToken/allowAttempt/randomToken that ops/deps.js does not have.
 * Harmless only while buildExpungeWrites reads through getVal alone — if it
 * ever reaches for another dep, this seam still typechecks and throws at
 * runtime. Narrowing that function's @param is the fix; it is a follow-up.
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
 * @param {ReadDeps} deps
 * @param {string} uid
 * @returns {Promise<{ own: AccountNode | null, prefs: PrefsNode | null }>}
 */
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

/** A node's child count, tolerating a leaf or an absent node. @param {unknown} value */
function countEntries(value) {
  if (value === null || value === undefined) return 0;
  return typeof value === 'object' ? Object.keys(value).length : 1;
}

/**
 * The loss report. Every line describes something the operator loses; `keeps`
 * holds only the three families spec §269-270 names as explicitly NOT a loss —
 * knocks, calls and location nodes — so the report is not noisy. "The write-set
 * does not destroy it" is NOT the test for a keep: push tokens and a stranded
 * canvas survive in the database and are still losses, because nothing carries
 * them and no one can reach them again.
 *
 * ONE report for purge and link impact, so the two can never disagree about a
 * family. Canvas and Telegram lines are derived from the finished write-set
 * rather than re-guessed, so a family the enumerator declines to null can never
 * be reported as deleted (and vice versa).
 *
 * @param {ReadDeps} deps
 * @param {string} uid
 * @param {{
 *   own: AccountNode | null,
 *   prefs: PrefsNode | null,
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
  for (const [token, rec] of Object.entries(own?.invites ?? {})) {
    const used = rec?.redemptionsUsed ?? 0;
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
        // canvas with a stranger is NOT deleted — and saying "deleted" would
        // claim a write the enumerator declined. It is still a loss: the only
        // account that could reach this drawing is the one being destroyed, so
        // the surviving peer keeps a canvas nobody can open again. §255-270
        // lists canvases among the losses; its not-a-loss list is knocks,
        // calls and location nodes only.
        losses.push(`canvases/${key} (with ${peer}) is NOT deleted but is stranded — ${peer} is not a contact, so the drawing survives as an orphan no one can reach through this account again`);
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

  // --- per-contact notify prefs --------------------------------------------
  // The dedicated line PREFS_REPORTED_ELSEWHERE claims exists for `notify`.
  // Merge unions this family BECAUSE it is real state a human chose; purge
  // deletes it, and the peer's own contact line says nothing about it.
  const notifyPeers = Object.keys(prefs?.notify || {}).filter((p) => p !== uid);
  if (notifyPeers.length) {
    losses.push(`userPrefs/${uid}/notify: per-contact notification settings for ${notifyPeers.join(', ')} are deleted — merge carries these across, this does not, and they are not recreated`);
  }

  // --- private prefs --------------------------------------------------------
  const otherPrefs = Object.keys(prefs || {}).filter((k) => !PREFS_REPORTED_ELSEWHERE.includes(k));
  if (otherPrefs.length) losses.push(`userPrefs/${uid} discarded (${otherPrefs.join(', ')})`);

  // --- telegram mapping: only a loss when the write-set actually nulls it ----
  if (tgId && writes[`telegramUsers/${tgId}`] === null) {
    losses.push(`telegramUsers/${tgId} deleted — this Telegram is unlinked, and the next Mini App open bootstraps a brand-new empty account`);
  }

  // --- push tokens: a loss, per spec §255-270 -------------------------------
  const tokens = countEntries(await deps.getVal(`pushTokens/${uid}`));
  if (tokens) {
    // Nothing is destroyed here — expunge never nulls pushTokens, and this
    // module does not add it (that family belongs in the shared enumerator).
    // But "nothing is destroyed" is not the test: merge UNIONS this family so
    // both devices stay reachable, and neither purge nor the link path carries
    // it, so the devices go dead. Going dead unnoticed is the loss. The spec's
    // not-a-loss list is knocks, calls and location nodes — push tokens are on
    // the loss side of it.
    losses.push(`pushTokens/${uid}: ${tokens} device token(s) are not carried — those devices stop receiving notifications for this account, and the node is left behind as residue (integrity: push-tokens-dangling)`);
  }

  // --- not losses (spec §269-270: knocks, calls, location nodes) ------------
  if (countEntries(await deps.getVal(`locations/${uid}`))) {
    keeps.push(`locations/${uid} deleted — a position fix, not durable state, not a loss`);
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

  /** @type {Record<string, unknown>} */
  const extraNulls = {};

  // The mapping teardown rides the same extraNulls seam unlinkTelegramHandler
  // uses (spec §8.1), so the whole purge stays ONE atomic update. Without it
  // the tgId would resolve to a uid with no account.
  //
  // But the reverse index is not proof of ownership. telegramUsers/{tgId} is a
  // GLOBAL key and integrity.js flags — at error severity — the exact state
  // where it points somewhere else. Nulling it unread is how this tool would
  // kill a live third account's Telegram while the loss line blamed the uid the
  // operator typed. The shared builder reads it and refuses when it is not
  // ours, naming the real holder in a conflict AND a loss line.
  /** @type {import('./types.js').Conflict[]} */
  const conflicts = [];
  /** @type {string[]} */
  const mappingLosses = [];
  const link = await deps.getVal(`telegramByUid/${uid}`);
  const tgId = link?.tgId ? String(link.tgId) : null;
  if (tgId) {
    extraNulls[`telegramByUid/${uid}`] = null;
    const teardown = await buildMappingTeardown(deps, { tgId, owner: uid, context: `${uid} is purged` });
    Object.assign(extraNulls, teardown.writes);
    conflicts.push(...teardown.conflicts);
    mappingLosses.push(...teardown.losses);
  }

  const writes = await expungeWrites(deps, uid, extraNulls);
  const { losses } = await describeImpact(deps, uid, { own, prefs, writes, canvasKeys, tgId });
  return { writes, conflicts, losses: [...losses, ...mappingLosses] };
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
  const writes = await expungeWrites(deps, derivedUid, {});
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

  const { own, prefs } = await readOwn(deps, derivedUid);
  const writes = await expungeWrites(deps, derivedUid, {
    [`telegramByUid/${derivedUid}`]: null,
  });

  /** @type {import('./types.js').Conflict[]} */
  const conflicts = [];
  /** @type {string[]} */
  const losses = [];

  // The shared performLink block: the mapping node, the reverse index, the
  // three prefs keys, the direct-relink reset for a prior holder that is not
  // part of this operation, and the loss lines for every mapping field
  // performLink does not restate. ONE copy, shared with ops/merge.js, and it
  // reads telegramUsers/{tgId} before writing it. `ownUids` says the derived
  // account (expunged above) and the phrase account (relinked below) need no
  // reset; anything else holding this tgId is a third party and is named.
  const linkWrites = await buildLinkWrites(deps, {
    tgId, uid: phraseUid, now, fallbackChatId: link.chatId, ownUids: [derivedUid, phraseUid],
  });
  conflicts.push(...linkWrites.conflicts);
  losses.push(...linkWrites.losses);

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

  Object.assign(writes, linkWrites.writes);

  const impact = await describeImpact(deps, derivedUid, { own, prefs, writes, canvasKeys, tgId });
  return { writes, conflicts, losses: [...impact.losses, ...losses] };
}
