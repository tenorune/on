import { makeStoreDeps } from './store-deps.js';
import { OWN_MAILBOXES } from '../telegram-auth.js';
import { DROP_MAILBOXES, UNION_MAILBOXES } from '../ops/merge.js';
import {
  buildPurgePlan,
  buildLinkImpact,
  buildProductionLinkPlan,
  applyPurgePlan,
} from '../ops/purge.js';

/**
 * A derived account that owns a group, holds a canvas and a redeemed invite.
 *
 * Every nested value here is deliberately NON-empty: store-deps prunes `{}` to
 * absent on read, so a fixture written as `following: { peer: {} }` reads back
 * as no userPrefs node at all and silently makes the assertions vacuous.
 */
function loaded() {
  return makeStoreDeps({
    'users/D': {
      presence: { code: 'DDD111', lastSeen: 5 },
      followers: { peer: 'PEER01' },
      followerNames: { peer: 'Dee' },
      groups: { owned: { lastVisited: 1 }, joined: { lastVisited: 1 } },
      invites: { tokD: { redemptionsUsed: 3 } },
    },
    'userPrefs/D': { following: { peer: { code: 'PEER01', label: 'Peer' } }, palette: { hue: 7 } },
    'users/peer': { presence: { code: 'PEER01' }, followers: { D: 'DDD111' } },
    'userPrefs/peer': { following: { D: { code: 'DDD111', label: 'Dee' } } },
    'groups/owned': { name: 'Owned Group', ownerId: 'D', members: { D: { role: 'owner' }, other: { role: 'member' } } },
    'groups/joined': { name: 'Joined Group', ownerId: 'other', members: { D: { role: 'member' }, other: { role: 'owner' } } },
    'codeIndex/DDD111': 'D',
    'inviteIndex/tokD': { ownerPath: 'users/D/invites/tokD', ownerUid: 'D' },
  });
}

/** A derived account that holds nothing. */
function empty() {
  return makeStoreDeps({ 'users/E': { presence: { code: 'EEE111' } }, 'codeIndex/EEE111': 'E' });
}

/**
 * rootUpdate's projection, re-derived here so the apply assertions are pinned
 * against an INDEPENDENT computation rather than against the module under test:
 * a null that sits under an already-nulled ancestor is a redundant delete and
 * is dropped; any other overlap is illegal and would be rejected by RTDB.
 * @param {Record<string, unknown>} writes
 */
function wirePayload(writes) {
  const keys = Object.keys(writes).sort();
  /** @type {Record<string, unknown>} */
  const kept = {};
  keys.forEach((key, i) => {
    const ancestor = keys.slice(0, i).reverse().find((k) => key.startsWith(`${k}/`));
    if (ancestor === undefined) kept[key] = writes[key];
    else if (!(writes[ancestor] === null && writes[key] === null)) {
      throw new Error(`overlapping write: '${key}' under '${ancestor}'`);
    }
  });
  return kept;
}

describe('buildPurgePlan', () => {
  test('previews without writing', async () => {
    const deps = loaded();
    const before = JSON.stringify(deps.store);
    await buildPurgePlan(deps, 'D');
    expect(JSON.stringify(deps.store)).toBe(before);
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.set).not.toHaveBeenCalled();
    expect(deps.transaction).not.toHaveBeenCalled();
  });

  test('refuses a uid with no account rather than previewing a no-op', async () => {
    await expect(buildPurgePlan(loaded(), 'typo')).rejects.toThrow(/no account/);
  });

  test('names the peers who lose a contact', async () => {
    const { losses } = await buildPurgePlan(loaded(), 'D');
    expect(losses.some((l) => l.includes('peer'))).toBe(true);
    expect(losses.some((l) => l.includes('PEER01'))).toBe(true);
  });

  test('names owned groups as deleted for every member — the sharpest edge', async () => {
    const { losses } = await buildPurgePlan(loaded(), 'D');
    expect(losses.some((l) => l.includes('Owned Group') && l.includes('other'))).toBe(true);
  });

  test('does not claim the joined group is deleted', async () => {
    const { losses } = await buildPurgePlan(loaded(), 'D');
    expect(losses.some((l) => l.includes('Joined Group') && l.includes('deleted'))).toBe(false);
    expect(losses.some((l) => l.includes('Joined Group'))).toBe(true);
  });

  test('names the invite token and its redemption count', async () => {
    const { losses } = await buildPurgePlan(loaded(), 'D');
    expect(losses.some((l) => l.includes('tokD') && l.includes('3'))).toBe(true);
  });

  test('applying it removes the account and its residue', async () => {
    const deps = loaded();
    await applyPurgePlan(deps, await buildPurgePlan(deps, 'D'));
    expect(await deps.getVal('users/D')).toBeNull();
    expect(await deps.getVal('users/peer/followers/D')).toBeNull();
    expect(await deps.getVal('userPrefs/peer/following/D')).toBeNull();
    expect(await deps.getVal('groups/owned')).toBeNull();
    expect(await deps.getVal('groups/joined/members/D')).toBeNull();
    expect(await deps.getVal('codeIndex/DDD111')).toBeNull();
    expect(await deps.getVal('inviteIndex/tokD')).toBeNull();
  });

  test('drops the location point and every per-group location cell', async () => {
    const deps = loaded();
    deps.store['locations/D'] = { lat: 1, lng: 2, updatedAt: 1 };
    deps.store['locationCells/owned/D'] = { lat: 1, lng: 2, updatedAt: 1 };
    deps.store['locationCells/joined/D'] = { lat: 1, lng: 2, updatedAt: 1 };
    const plan = await buildPurgePlan(deps, 'D');
    expect(plan.writes['locations/D']).toBeNull();
    expect(plan.writes['locationCells/owned/D']).toBeNull();
    expect(plan.writes['locationCells/joined/D']).toBeNull();
    await applyPurgePlan(deps, plan);
    expect(await deps.getVal('locations/D')).toBeNull();
    expect(await deps.getVal('locationCells/joined/D')).toBeNull();
  });

  test('a dropped location point is reported as not-a-loss, never as a loss', async () => {
    const deps = loaded();
    deps.store['locations/D'] = { lat: 1, lng: 2, updatedAt: 1 };
    const { losses } = await buildPurgePlan(deps, 'D');
    expect(losses.some((l) => l.includes('locations/D'))).toBe(false);
  });

  test('tears the telegram mapping down in the same update and reports it', async () => {
    const deps = loaded();
    deps.store['telegramByUid/D'] = { tgId: '42', chatId: '42' };
    deps.store['telegramUsers/42'] = { uid: 'D', chatId: '42', createdAt: 1 };
    const plan = await buildPurgePlan(deps, 'D');
    expect(plan.writes['telegramUsers/42']).toBeNull();
    expect(plan.writes['telegramByUid/D']).toBeNull();
    expect(plan.losses.some((l) => l.includes('telegramUsers/42'))).toBe(true);
    await applyPurgePlan(deps, plan);
    expect(await deps.getVal('telegramUsers/42')).toBeNull();
    expect(await deps.getVal('telegramByUid/D')).toBeNull();
  });

  // THE finding: telegramUsers/{tgId} is a GLOBAL key, and the purged
  // account's reverse index is not proof that it owns it. integrity.js raises
  // telegram-mapping-asymmetric at ERROR severity for exactly this state — the
  // operator sees that error and purges the stale-looking account, and an
  // unconditional null would take LIVE account X's Telegram down with it while
  // the loss line said the mapping belonged to the purged uid.
  test('a mapping the purged account does not own is left alone, and the real owner is named', async () => {
    const deps = loaded();
    deps.store['telegramByUid/D'] = { tgId: '42', chatId: '42' };
    deps.store['telegramUsers/42'] = { uid: 'X', chatId: '42' };
    deps.store['users/X'] = { presence: { code: 'XXX111' } };
    const plan = await buildPurgePlan(deps, 'D');
    expect(plan.writes['telegramUsers/42']).toBeUndefined();
    expect(plan.writes['telegramByUid/D']).toBeNull();
    expect(plan.conflicts.some((c) => c.kind === 'telegram-mapping-not-owned' && c.path === 'telegramUsers/42')).toBe(true);
    expect(plan.losses.some((l) => l.includes('telegramUsers/42') && l.includes('NOT deleted') && l.includes('X'))).toBe(true);
    // and never the line claiming this Telegram was unlinked by the purge
    expect(plan.losses.some((l) => l.includes('bootstraps a brand-new empty account'))).toBe(false);
    // X's Telegram still resolves to X after the purge is applied
    await applyPurgePlan(deps, plan);
    expect(await deps.getVal('telegramUsers/42')).toEqual({ uid: 'X', chatId: '42' });
    expect(await deps.getVal('users/X/presence/code')).toBe('XXX111');
  });

  test('a mapping the purged account DOES own is still torn down and reported as a loss', async () => {
    const deps = loaded();
    deps.store['telegramByUid/D'] = { tgId: '42', chatId: '42' };
    deps.store['telegramUsers/42'] = { uid: 'D', chatId: '42' };
    const plan = await buildPurgePlan(deps, 'D');
    expect(plan.writes['telegramUsers/42']).toBeNull();
    expect(plan.conflicts).toEqual([]);
    expect(plan.losses.some((l) => l.includes('bootstraps a brand-new empty account'))).toBe(true);
  });

  test('per-contact notify prefs are named, not buried in the generic prefs line', async () => {
    const deps = loaded();
    deps.store['userPrefs/D/notify'] = { peer: { available: true } };
    const { losses } = await buildPurgePlan(deps, 'D');
    // merge unions userPrefs/{uid}/notify/{peer} as real state; purge deletes
    // it, and the peer's contact line says nothing about the setting itself.
    const line = losses.find((l) => l.includes('userPrefs/D/notify'));
    expect(line).toBeDefined();
    expect(line).toContain('peer');
  });

  test('an account with no telegram mapping gets no mapping writes and no mapping loss', async () => {
    const plan = await buildPurgePlan(loaded(), 'D');
    expect(Object.keys(plan.writes).some((k) => k.startsWith('telegram'))).toBe(false);
    expect(plan.losses.some((l) => l.includes('telegram'))).toBe(false);
  });

  test('names each supplied canvas that the write-set actually deletes', async () => {
    const { losses, writes } = await buildPurgePlan(loaded(), 'D', ['D_peer', 'other_stranger']);
    expect(writes['canvases/D_peer']).toBeNull();
    expect(losses.some((l) => l.includes('canvases/D_peer') && l.includes('peer'))).toBe(true);
    expect(losses.some((l) => l.includes('other_stranger'))).toBe(false);
  });

  test('says so when no canvas key list was supplied — never silently safe', async () => {
    const { losses } = await buildPurgePlan(loaded(), 'D');
    expect(losses.some((l) => l.toLowerCase().includes('canvas'))).toBe(true);
  });

  test('durable mailbox contents are a loss; transient ones are not', async () => {
    const deps = loaded();
    deps.store['knocks/D'] = { peer: { count: 1, ts: 1 } };
    deps.store['pendingInvites/D'] = { g9: { invitedBy: 'peer' } };
    const { losses } = await buildPurgePlan(deps, 'D');
    expect(losses.some((l) => l.includes('pendingInvites/D'))).toBe(true);
    expect(losses.some((l) => l.includes('knocks/D'))).toBe(false);
  });

  test('never reads a canvas subtree or anything named strokes', async () => {
    const deps = loaded();
    await buildPurgePlan(deps, 'D', ['D_peer']);
    const paths = deps.getVal.mock.calls.map(([p]) => String(p));
    expect(paths.filter((p) => p.startsWith('canvases'))).toEqual([]);
    expect(paths.filter((p) => p.includes('strokes'))).toEqual([]);
  });

  test('execute sends exactly the preview projection — no less, and no more', async () => {
    const deps = loaded();
    deps.store['telegramByUid/D'] = { tgId: '42', chatId: '42' };
    deps.store['telegramUsers/42'] = { uid: 'D', chatId: '42' };
    const plan = await buildPurgePlan(deps, 'D', ['D_peer']);
    await applyPurgePlan(deps, plan);

    expect(deps.update).toHaveBeenCalledTimes(1);
    const [path, payload] = deps.update.mock.calls[0];
    expect(path).toBe('/');
    // Exact equality pins BOTH directions: a missing key means execute did less
    // than the operator approved, an extra key means it did more.
    expect(payload).toEqual(wirePayload(plan.writes));
    for (const key of Object.keys(payload)) {
      expect(Object.prototype.hasOwnProperty.call(plan.writes, key)).toBe(true);
    }
  });
});

// --- G4 --------------------------------------------------------------------
// A purge also CAUSES deletions it never writes, and those are invisible to the
// pre-image: nothing captured them, so nothing can replay them. The preview has
// to NAME them before the operator approves, and they must stay apart from the
// write-set — every claim here is a prediction about client behaviour, not a
// path this plan writes.
describe('cascade predictions', () => {
  /** D owns a group whose only other member is `other`. */
  const soloOwner = () => {
    const deps = loaded();
    deps.store['users/D'].groups.solo = { lastVisited: 1 };
    deps.store['groups/solo'] = { name: 'Solo Group', ownerId: 'D', members: { D: { role: 'owner' } } };
    return deps;
  };

  test('names the group, the member and the entry that member’s client deletes', async () => {
    const { cascades } = await buildPurgePlan(loaded(), 'D');
    expect(cascades).toHaveLength(1);
    expect(cascades[0]).toContain('Owned Group');
    expect(cascades[0]).toContain('other');
    expect(cascades[0]).toContain('users/other/groups/owned');
  });

  // The whole point of the entry: the operator must not read it as a write-set
  // line. It is worded as a prediction, and it names both the remedy and the
  // integrity check that spots the un-healed state.
  test('reads as a prediction, and names the remedy rather than only the damage', async () => {
    const { cascades } = await buildPurgePlan(loaded(), 'D');
    expect(cascades[0]).toContain('PREDICTED');
    expect(cascades[0]).toContain('--heal-group-enumeration');
    expect(cascades[0]).toContain('group-enumeration-missing');
  });

  test('the predicted path is NOT in the write-set — that is why it needs naming', async () => {
    const { writes, cascades } = await buildPurgePlan(loaded(), 'D');
    expect(cascades).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(writes, 'users/other/groups/owned')).toBe(false);
  });

  test('a group the account does not own cascades nothing — the group survives', async () => {
    const { cascades } = await buildPurgePlan(loaded(), 'D');
    expect(cascades.some((c) => c.includes('Joined Group'))).toBe(false);
  });

  // No other member means no other client, so there is nothing to predict.
  // Reporting one here would be noise on the commonest owned-group purge.
  test('an owned group with no other members cascades nothing', async () => {
    const { cascades } = await buildPurgePlan(soloOwner(), 'D');
    expect(cascades.some((c) => c.includes('Solo Group'))).toBe(false);
    expect(cascades).toHaveLength(1);
  });

  test('an account owning no group has no cascades at all', async () => {
    const { cascades } = await buildPurgePlan(empty(), 'E');
    expect(cascades).toEqual([]);
  });

  // The production link runs the SAME expunge, so it triggers the same cascade.
  // Carrying it on one of the two previews and not the other would be the same
  // defect this item exists to close, one route over.
  test('the production link carries them too — it is the same expunge', async () => {
    const deps = loaded();
    deps.store['telegramUsers/42'] = { uid: 'D', chatId: '42', createdAt: 100 };
    deps.store['telegramByUid/D'] = { tgId: '42', chatId: '42' };
    deps.store['users/P'] = { presence: { code: 'PPP111' } };
    const { cascades } = await buildProductionLinkPlan(deps, { derivedUid: 'D', phraseUid: 'P', now: 1_750_000_000_000 });
    expect(cascades).toHaveLength(1);
    expect(cascades[0]).toContain('users/other/groups/owned');
  });
});

describe('mailbox durability partition', () => {
  test('is the one partition of OWN_MAILBOXES, never a second local list', () => {
    expect([...DROP_MAILBOXES, ...UNION_MAILBOXES].sort()).toEqual([...OWN_MAILBOXES].sort());
  });
});

describe('buildLinkImpact', () => {
  test('an account holding contacts, groups, canvases or redeemed invites is lossy', async () => {
    const impact = await buildLinkImpact(loaded(), 'D');
    expect(impact.verdict).toBe('lossy');
    expect(impact.losses.some((l) => l.includes('Owned Group'))).toBe(true);
    expect(impact.losses.some((l) => l.includes('tokD'))).toBe(true);
  });

  test('an empty account is safe to link', async () => {
    const impact = await buildLinkImpact(empty(), 'E');
    expect(impact.verdict).toBe('safe');
    expect(impact.losses).toEqual([]);
  });

  test('transient residue is listed as kept, not as a loss', async () => {
    const deps = empty();
    deps.store['knocks/E'] = { peer: { count: 1, ts: 1 } };
    deps.store['locations/E'] = { lat: 1, lng: 2, updatedAt: 1 };
    const impact = await buildLinkImpact(deps, 'E');
    expect(impact.verdict).toBe('safe');
    expect(impact.keeps.some((k) => k.includes('knocks'))).toBe(true);
    expect(impact.keeps.some((k) => k.includes('locations/E'))).toBe(true);
  });

  test('a redeemed invite token alone makes it lossy', async () => {
    const deps = empty();
    deps.store['users/E'] = { presence: { code: 'EEE111' }, invites: { tokE: { redemptionsUsed: 1 } } };
    expect((await buildLinkImpact(deps, 'E')).verdict).toBe('lossy');
  });

  test('a durable mailbox entry alone makes it lossy — production’s gate counts neither', async () => {
    const deps = empty();
    deps.store['pendingInvites/E'] = { g9: { invitedBy: 'peer' } };
    const impact = await buildLinkImpact(deps, 'E');
    expect(impact.verdict).toBe('lossy');
    expect(impact.losses.some((l) => l.includes('pendingInvites/E'))).toBe(true);
  });

  test('push tokens alone make it lossy — the devices stop being reachable', async () => {
    const deps = empty();
    deps.store['pushTokens/E'] = { tok: { createdAt: 1, lastSeen: 2 } };
    const impact = await buildLinkImpact(deps, 'E');
    expect(impact.verdict).toBe('lossy');
    expect(impact.losses.some((l) => l.includes('pushTokens/E') && l.includes('stop receiving'))).toBe(true);
    expect(impact.keeps.some((k) => k.includes('pushTokens'))).toBe(false);
  });

  test('purge and link impact agree about push tokens', async () => {
    const deps = loaded();
    deps.store['pushTokens/D'] = { tok: { createdAt: 1, lastSeen: 2 } };
    const purge = await buildPurgePlan(deps, 'D');
    const impact = await buildLinkImpact(deps, 'D');
    const line = (/** @type {string[]} */ ls) => ls.filter((l) => l.includes('pushTokens/D'));
    expect(line(purge.losses)).toHaveLength(1);
    expect(line(impact.losses)).toEqual(line(purge.losses));
  });

  test('a contact with an unknown canvas list is never reported as safe', async () => {
    const deps = empty();
    deps.store['users/E'] = { presence: { code: 'EEE111' }, followers: { peer: 'PEER01' } };
    deps.store['users/peer'] = { presence: { code: 'PEER01' } };
    const impact = await buildLinkImpact(deps, 'E');
    expect(impact.verdict).toBe('lossy');
    expect(impact.losses.some((l) => l.toLowerCase().includes('canvas'))).toBe(true);
  });

  test('an explicitly empty canvas list is trusted and reports no canvas loss', async () => {
    const deps = empty();
    deps.store['users/E'] = { presence: { code: 'EEE111' }, followers: { peer: 'PEER01' } };
    deps.store['users/peer'] = { presence: { code: 'PEER01' } };
    const impact = await buildLinkImpact(deps, 'E', []);
    expect(impact.losses.some((l) => l.toLowerCase().includes('canvas'))).toBe(false);
  });

  test('a stranded canvas is a loss, and is never described as deleted', async () => {
    const deps = empty();
    const impact = await buildLinkImpact(deps, 'E', ['E_stranger']);
    const line = impact.losses.find((l) => l.includes('E_stranger'));
    expect(impact.verdict).toBe('lossy');
    // Still a loss the operator must see, but the report must not claim a
    // delete the enumerator declined to make.
    expect(line).toContain('NOT deleted');
    expect(impact.keeps.some((k) => k.includes('E_stranger'))).toBe(false);
  });

  test('does not mutate and reads no canvas subtree', async () => {
    const deps = loaded();
    const before = JSON.stringify(deps.store);
    await buildLinkImpact(deps, 'D', ['D_peer']);
    expect(JSON.stringify(deps.store)).toBe(before);
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.set).not.toHaveBeenCalled();
    expect(deps.transaction).not.toHaveBeenCalled();
    expect(deps.getVal.mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith('canvases'))).toEqual([]);
  });
});

describe('buildProductionLinkPlan', () => {
  const NOW = 1_750_000_000_000;

  function linkable() {
    const deps = empty();
    deps.store['telegramUsers/42'] = { uid: 'E', chatId: '42', createdAt: 100 };
    deps.store['telegramByUid/E'] = { tgId: '42', chatId: '42' };
    deps.store['users/P'] = { presence: { code: 'PPP111' } };
    return deps;
  }

  test('expunges the derived account and writes exactly what performLink writes', async () => {
    const { writes } = await buildProductionLinkPlan(linkable(), { derivedUid: 'E', phraseUid: 'P', now: NOW });
    expect(writes['users/E']).toBeNull();
    expect(writes['userPrefs/E']).toBeNull();
    expect(writes['telegramByUid/E']).toBeNull();
    expect(writes['telegramUsers/42']).toEqual({ uid: 'P', chatId: '42', linkedAt: NOW });
    expect(writes['telegramByUid/P']).toEqual({ tgId: '42', chatId: '42' });
    expect(writes['userPrefs/P/telegram/tgId']).toBe('42');
    expect(writes['userPrefs/P/telegram/linkedAt']).toBe(NOW);
    expect(writes['userPrefs/P/notifyChannel']).toBe('telegram');
  });

  // R4: the report asserted the stale mapping is "left pointing at {phraseUid}"
  // as fact, but that ownership was INFERRED from the phrase account's reverse
  // index and never read. The reverse index is exactly the thing that can be
  // wrong — integrity.js raises telegram-mapping-asymmetric for it at error
  // severity.
  test('names the real holder of the stale mapping rather than assuming the phrase account', async () => {
    const deps = linkable();
    // P's reverse index claims tgId 77, but 77 really belongs to W.
    deps.store['telegramByUid/P'] = { tgId: '77', chatId: '77' };
    deps.store['telegramUsers/77'] = { uid: 'W', chatId: '77' };
    deps.store['users/W'] = { presence: { code: 'WWW111' } };

    const { conflicts, losses } = await buildProductionLinkPlan(deps, { derivedUid: 'E', phraseUid: 'P', now: NOW });

    const relink = conflicts.find((c) => c.kind === 'telegram-relink' && c.path === 'telegramByUid/P');
    expect(relink).toBeDefined();
    expect(relink.resolution).toContain('W');
    expect(relink.resolution).not.toMatch(/left pointing at P\b/);
    expect(losses.some((l) => l.includes('telegramUsers/77') && l.includes('W'))).toBe(true);
  });

  test('still reports the ordinary case, where the phrase account really does hold it', async () => {
    const deps = linkable();
    deps.store['telegramByUid/P'] = { tgId: '77', chatId: '77' };
    deps.store['telegramUsers/77'] = { uid: 'P', chatId: '77' };

    const { conflicts } = await buildProductionLinkPlan(deps, { derivedUid: 'E', phraseUid: 'P', now: NOW });

    const relink = conflicts.find((c) => c.kind === 'telegram-relink' && c.path === 'telegramByUid/P');
    expect(relink.resolution).toContain('P');
  });

  test('previews without writing', async () => {
    const deps = linkable();
    const before = JSON.stringify(deps.store);
    await buildProductionLinkPlan(deps, { derivedUid: 'E', phraseUid: 'P', now: NOW });
    expect(JSON.stringify(deps.store)).toBe(before);
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.set).not.toHaveBeenCalled();
    expect(deps.transaction).not.toHaveBeenCalled();
  });

  test('refuses when the derived account has no telegram mapping', async () => {
    await expect(buildProductionLinkPlan(empty(), { derivedUid: 'E', phraseUid: 'P', now: NOW }))
      .rejects.toThrow(/no telegram mapping/);
  });

  test('refuses when the phrase uid has no account', async () => {
    const deps = linkable();
    delete deps.store['users/P'];
    await expect(buildProductionLinkPlan(deps, { derivedUid: 'E', phraseUid: 'P', now: NOW }))
      .rejects.toThrow(/no account with that phrase uid/);
  });

  test('refuses to link an account to itself — that write-set would be rejected at execute', async () => {
    const deps = linkable();
    await expect(buildProductionLinkPlan(deps, { derivedUid: 'E', phraseUid: 'E', now: NOW }))
      .rejects.toThrow(/same account/);
  });

  test('reports the mapping metadata performLink overwrites', async () => {
    const { losses } = await buildProductionLinkPlan(linkable(), { derivedUid: 'E', phraseUid: 'P', now: NOW });
    expect(losses.some((l) => l.includes('createdAt'))).toBe(true);
  });

  test('mirrors performLink’s direct-relink reset when the tgId belongs to another real account', async () => {
    const deps = linkable();
    deps.store['telegramUsers/42'] = { uid: 'X', chatId: '42' };
    deps.store['users/X'] = { presence: { code: 'XXX111' } };
    deps.store['telegramByUid/X'] = { tgId: '42', chatId: '42' };
    const { writes, conflicts, losses } = await buildProductionLinkPlan(deps, { derivedUid: 'E', phraseUid: 'P', now: NOW });
    expect(writes['telegramByUid/X']).toBeNull();
    expect(writes['userPrefs/X/telegram']).toBeNull();
    expect(writes['userPrefs/X/notifyChannel']).toBe('push');
    expect(conflicts.some((c) => c.kind === 'telegram-relink')).toBe(true);
    expect(losses.some((l) => l.includes('X'))).toBe(true);
  });

  test('surfaces a conflict when the phrase account already holds a different tgId', async () => {
    const deps = linkable();
    deps.store['telegramByUid/P'] = { tgId: '99', chatId: '99' };
    deps.store['telegramUsers/99'] = { uid: 'P', chatId: '99' };
    const { conflicts, losses, writes } = await buildProductionLinkPlan(deps, { derivedUid: 'E', phraseUid: 'P', now: NOW });
    expect(conflicts.some((c) => c.path === 'telegramByUid/P')).toBe(true);
    expect(losses.some((l) => l.includes('99'))).toBe(true);
    // Production does NOT touch the stale forward mapping; the plan must not
    // quietly invent a write performLink never makes.
    expect(writes['telegramUsers/99']).toBeUndefined();
  });

  test('applies as one atomic update with no overlapping paths', async () => {
    const deps = linkable();
    const plan = await buildProductionLinkPlan(deps, { derivedUid: 'E', phraseUid: 'P', now: NOW });
    await applyPurgePlan(deps, plan);
    expect(deps.update).toHaveBeenCalledTimes(1);
    const [path, payload] = deps.update.mock.calls[0];
    expect(path).toBe('/');
    expect(payload).toEqual(wirePayload(plan.writes));
    expect(await deps.getVal('users/E')).toBeNull();
    expect(await deps.getVal('telegramUsers/42')).toEqual({ uid: 'P', chatId: '42', linkedAt: NOW });
    expect(await deps.getVal('userPrefs/P/notifyChannel')).toBe('telegram');
  });
});
