// functions/telegram-link-write.js — the ONE Telegram mapping write-block, and
// the ONE place a mapping is torn down. Used by shipped performLink and by the
// ops panel alike.
//
// performLink (functions/telegram-auth.js) writes the forward mapping, the
// reverse index and the three prefs keys as a single block. That block once
// existed in THREE hand-written copies — the shipped one, one in ops/merge.js
// and one in ops/purge.js — and the two ops copies had already drifted from the
// shipped one three ways: `chatId` precedence, what happens to a prior holder,
// and whether the mapping fields performLink discards are reported at all.
// merge.js's comment said it "mirrors performLink exactly" and it did not. Same
// shape as the crossRefRenderers and CANVAS_CARRIED landmines: one behaviour,
// several transcriptions, and nothing that fails when they disagree.
//
// There is now ONE copy. This module started life at functions/ops/link-write.js
// with a parity test standing in for shared code; it lives HERE, outside ops/,
// because `functions.ignore` excludes `ops/**` from the deploy archive — a
// shipped module importing from there would deploy a Cloud Function that dies at
// cold start on a missing module, taking the whole Telegram link flow with it.
// Nothing in this file may import from ops/ at runtime for the same reason.
//
// OWNERSHIP — why both entry points read before they write.
// telegramUsers/{tgId} is a GLOBAL key. The account an operator names is not
// necessarily its owner: integrity.js raises `telegram-mapping-asymmetric` at
// ERROR severity for exactly the state where telegramUsers[tgId].uid !== uid,
// and the panel's own report asserts that state occurs in production. Writing
// that key without reading it kills an uninvolved account's Telegram — its next
// Mini App open bootstraps a brand-new empty account — while the loss report
// blames the account the operator typed. So:
//
//  * TEARDOWN (a delete) refuses to write a mapping the account does not own,
//    raises a conflict and says whose it is. Nothing else in the operation
//    needs that key gone, and deleting it destroys a third party's live state.
//  * A LINK/REPOINT still writes, because taking over the mapping is the whole
//    point and is what production does — but it resets the prior holder exactly
//    as performLink's direct-relink branch does, and names them in a conflict
//    and a loss line, so the operator sees the third party before confirming
//    rather than after.
//
// `deps.getVal` is the raw RTDB read seam; `any` there is the shipped
// convention (telegram-auth.js's own TelegramAuthDeps), not a suppression.
/** @typedef {{ getVal: (path: string) => Promise<any> }} ReadDeps */

/**
 * The fields performLink restates when it replaces telegramUsers/{tgId}. It
 * writes the NODE, so every other child dies with it — `createdAt` is the one
 * that exists in practice. Anything outside this list is reported as a loss.
 */
export const LINK_NODE_FIELDS = ['uid', 'chatId', 'linkedAt'];

/**
 * `priorUid` is set by buildMappingTeardown — who held telegramUsers/{tgId}
 * before this operation, so a caller can name them without a second read. It is
 * absent from buildLinkWrites' result, which reports a prior holder through its
 * conflict and loss lines instead.
 * @typedef {{
 *   writes: Record<string, unknown>,
 *   conflicts: import('./ops/types.js').Conflict[],
 *   losses: string[],
 *   priorUid?: string | null,
 * }} LinkWriteResult
 */

/**
 * Read the forward mapping and report who holds it.
 * @param {ReadDeps} deps
 * @param {string} tgId
 * @returns {Promise<{ prior: any, priorUid: string | null }>}
 */
export async function readMapping(deps, tgId) {
  const prior = await deps.getVal(`telegramUsers/${tgId}`);
  return { prior, priorUid: prior?.uid ? String(prior.uid) : null };
}

/**
 * Tear down telegramUsers/{tgId} because `owner` is being destroyed — but only
 * if `owner` actually holds it. An absent mapping is still nulled: a null on a
 * path that holds nothing is a no-op, and conditioning residue nulls on a read
 * is how the shipped enumerator drifted once already.
 *
 * `ownUids` widens "actually holds it" to the other accounts this operation is
 * already destroying, and it is not optional politeness. Without it, a mapping
 * held by a merge's LOSER was refused as though it belonged to an uninvolved
 * third party — and the refusal's loss line promised "the forward mapping stays
 * with its owner, whose Telegram keeps working" while the caller nulled
 * `users/{loser}` moments later. The promise was false in exactly that case.
 * A holder outside `owner` and `ownUids` is still a real third party and is
 * still refused.
 *
 * `priorUid` is returned so a caller can describe WHOSE mapping it was without
 * reading the node a second time.
 *
 * @param {ReadDeps} deps
 * @param {{ tgId: string, owner: string, context: string, ownUids?: string[] }} opts `context`
 *   names the operation in the loss line ("purged", "merged away").
 * @returns {Promise<LinkWriteResult>}
 */
export async function buildMappingTeardown(deps, { tgId, owner, context, ownUids = [] }) {
  const { prior, priorUid } = await readMapping(deps, tgId);
  if (prior && priorUid !== owner && !(priorUid !== null && ownUids.includes(priorUid))) {
    const whose = priorUid ? priorUid : 'a mapping node carrying no uid';
    return {
      writes: {},
      conflicts: [{
        kind: 'telegram-mapping-not-owned',
        path: `telegramUsers/${tgId}`,
        detail: `${owner} points at tgId ${tgId}, but telegramUsers/${tgId} belongs to ${whose} (integrity: telegram-mapping-asymmetric)`,
        resolution: 'left untouched — deleting it would unlink an account that is not part of this operation',
      }],
      losses: [
        `telegramUsers/${tgId} is NOT deleted — it belongs to ${whose}, not to ${owner} (${context}). `
        + `${owner}'s reverse index is removed; the forward mapping stays with its owner, whose Telegram keeps working.`,
      ],
      priorUid,
    };
  }
  return { writes: { [`telegramUsers/${tgId}`]: null }, conflicts: [], losses: [], priorUid };
}

/**
 * performLink's mapping-write block, once.
 *
 * `fallbackChatId` is the reverse index's recorded chatId, used only when the
 * forward mapping is missing or carries none — production would invent
 * `chatId = tgId` there, and a recorded chatId is strictly better. That is the
 * ONLY place this deviates from performLink, and the parity test pins it by
 * passing no fallback.
 *
 * `ownUids` are the accounts this operation is already destroying or already
 * writing (the purged/merged-away account and the link target). A prior holder
 * in that set needs no reset — the caller's own write-set covers it, which is
 * what performLink's expunge branch does for a Telegram-derived prior holder.
 * A prior holder OUTSIDE it is an uninvolved third party and is handled exactly
 * as performLink's direct-relink branch handles a real phrase account: prefs
 * reset to push, account left intact, and named in the report.
 *
 * `prior` lets a caller that ALREADY read telegramUsers/{tgId} hand the node
 * over instead of paying a second read of a global key — performLink's own
 * callers pass it one, and re-reading here would both cost a round trip and
 * give this builder a different view of the key than the caller it serves.
 * `undefined` means "not supplied, read it"; `null` means "supplied, and there
 * is no mapping" — the two are NOT the same and an absent node is a normal,
 * expected state.
 *
 * @param {ReadDeps} deps
 * @param {{
 *   tgId: string,
 *   uid: string,
 *   now: number,
 *   fallbackChatId?: string | null,
 *   ownUids?: string[],
 *   prior?: any,
 * }} opts
 * @returns {Promise<LinkWriteResult>}
 */
export async function buildLinkWrites(deps, { tgId, uid, now, fallbackChatId, ownUids = [], prior: suppliedPrior }) {
  const { prior, priorUid } = suppliedPrior === undefined
    ? await readMapping(deps, tgId)
    : { prior: suppliedPrior, priorUid: suppliedPrior?.uid ? String(suppliedPrior.uid) : null };
  const chatId = prior?.chatId || fallbackChatId || tgId;

  /** @type {Record<string, unknown>} */
  const writes = {};
  /** @type {import('./ops/types.js').Conflict[]} */
  const conflicts = [];
  /** @type {string[]} */
  const losses = [];

  if (priorUid && priorUid !== uid && !ownUids.includes(priorUid)) {
    conflicts.push({
      kind: 'telegram-relink',
      path: `telegramUsers/${tgId}`,
      detail: `tgId ${tgId} is currently linked to ${priorUid}, which is not part of this operation`,
      resolution: `${priorUid} keeps its account; its telegram prefs reset to push, exactly as performLink does`,
    });
    writes[`telegramByUid/${priorUid}`] = null;
    writes[`userPrefs/${priorUid}/telegram`] = null;
    writes[`userPrefs/${priorUid}/notifyChannel`] = 'push';
    losses.push(`${priorUid} loses its Telegram link and is reset to notifyChannel: push`);
  }

  for (const field of Object.keys(prior || {})) {
    if (!LINK_NODE_FIELDS.includes(field)) {
      losses.push(`telegramUsers/${tgId}.${field} (${JSON.stringify(prior[field])}) is dropped — performLink replaces the mapping node wholesale`);
    }
  }

  writes[`telegramUsers/${tgId}`] = { uid, chatId, linkedAt: now };
  writes[`telegramByUid/${uid}`] = { tgId, chatId };
  writes[`userPrefs/${uid}/telegram/tgId`] = tgId;
  writes[`userPrefs/${uid}/telegram/linkedAt`] = now;
  writes[`userPrefs/${uid}/notifyChannel`] = 'telegram';
  return { writes, conflicts, losses };
}
