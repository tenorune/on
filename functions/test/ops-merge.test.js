import { makeStoreDeps } from './store-deps.js';
import {
  buildMergePlan, applyMergePlan, DROP_MAILBOXES, UNION_MAILBOXES,
} from '../ops/merge.js';
import { crossRefRenderers, OWN_MAILBOXES } from '../telegram-auth.js';

const NOW = 1_750_000_000_000;

// Loser L and survivor S, both real, overlapping in several families.
//
// NB fixture rule (store-deps `prune`, mirroring RTDB): an empty object does
// not exist on read. Every node below therefore carries real content —
// `following` cards are `{ code, label }`, the shape js/db/social.ts writes —
// or the union logic under test would never fire and the assertion would be
// green against a node that reads back as absent.
function world(extra = {}) {
  return makeStoreDeps({
    'users/L': {
      presence: { code: 'LLL111', status: 'unavailable', availableUntil: null, lastSeen: 9000 },
      followers: { shared: 'SHR001', onlyL: 'ONL001' },
      followerNames: { shared: 'Shared', onlyL: 'OnlyL' },
      groups: { g1: { lastVisited: 5000 }, g2: { lastVisited: 100 } },
      invites: { tokL: { redemptionsUsed: 2 } },
    },
    'users/S': {
      presence: { code: 'SSS222', status: 'unavailable', availableUntil: null, lastSeen: 1000 },
      followers: { shared: 'SHR001' },
      followerNames: { shared: 'Shared' },
      groups: { g1: { lastVisited: 200 } },
    },
    'users/shared': { presence: { code: 'SHR001' }, followers: { L: 'LLL111', S: 'SSS222' }, followerNames: { L: 'LoserPublished', S: 'SurvivorPublished' } },
    'users/onlyL': { presence: { code: 'ONL001' }, followers: { L: 'LLL111' }, followerNames: { L: 'LoserPublished' } },
    'userPrefs/L': {
      following: { shared: { code: 'SHR001', label: 'Shared' }, onlyL: { code: 'ONL001', label: 'Only L' } },
      favorites: ['loser-combo'],
      notifyChannel: 'push',
    },
    'userPrefs/S': {
      following: { shared: { code: 'SHR001', label: 'Shared (survivor)' } },
      favorites: ['survivor-combo'],
      notifyChannel: 'push',
    },
    'userPrefs/shared': { following: { L: { code: 'LLL111', label: 'the loser' }, S: { code: 'SSS222', label: 'the survivor' } } },
    'userPrefs/onlyL': { following: { L: { code: 'LLL111', label: 'my name for them' } } },
    'groups/g1': {
      name: 'Shared Group',
      ownerId: 'other',
      members: { L: { role: 'member', displayName: 'LoserName' }, S: { role: 'member', displayName: 'SurvivorName' }, other: { role: 'owner' } },
    },
    'groups/g2': { name: 'Loser Owns', ownerId: 'L', members: { L: { role: 'owner', displayName: 'LoserName' } } },
    'codeIndex/LLL111': 'L',
    'codeIndex/SSS222': 'S',
    'inviteIndex/tokL': { ownerPath: 'users/L/invites/tokL', ownerUid: 'L' },
    'pushTokens/L': { tokenL: { createdAt: 1, lastSeen: 9000 } },
    'pushTokens/S': { tokenS: { createdAt: 1, lastSeen: 1000 } },
    'knocks/L': { shared: { count: 1, ts: 500 } },
    'pendingInvites/L': { g3: { from: 'other', ts: 400 } },
    ...extra,
  });
}

const merge = (deps, opts = {}) => buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, ...opts });

describe('buildMergePlan — nothing is applied at preview time', () => {
  test('returns writes without touching the store', async () => {
    const deps = world();
    const before = JSON.stringify(deps.store);
    await merge(deps);
    expect(JSON.stringify(deps.store)).toBe(before);
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.set).not.toHaveBeenCalled();
    expect(deps.transaction).not.toHaveBeenCalled();
  });

  test('refuses a self-merge and a missing account', async () => {
    await expect(buildMergePlan(world(), { loserUid: 'L', survivorUid: 'L', now: NOW })).rejects.toThrow(/same uid/);
    await expect(merge(world(), { loserUid: 'ghost' })).rejects.toThrow(/no account/);
    await expect(merge(world(), { survivorUid: 'ghost' })).rejects.toThrow(/graduateAccountData/);
  });
});

describe('contacts', () => {
  test('a peer who followed only the loser is repointed to the survivor', async () => {
    const { writes } = await merge(world());
    expect(writes['users/onlyL/followers/S']).toBe('SSS222');
    expect(writes['users/onlyL/followers/L']).toBeNull();
    expect(writes['userPrefs/S/following/onlyL']).toEqual({ code: 'ONL001', label: 'Only L' });
  });

  // C2: users/{peer}/followers/{uid} holds THAT uid's share code, and the
  // peer's following card's `code` resolves to an account. Repointing to the
  // survivor must therefore carry the SURVIVOR's code — carrying the loser's
  // would leave the peer with a card resolving to a uid that no longer exists.
  test('a repointed backref carries the survivor share code, never the loser one', async () => {
    const { writes } = await merge(world());
    expect(writes['users/onlyL/followers/S']).toBe('SSS222');
    expect(writes['userPrefs/onlyL/following/S']).toEqual({ code: 'SSS222', label: 'my name for them' });
    expect(JSON.stringify(writes['userPrefs/onlyL/following/S'])).not.toContain('LLL111');
  });

  // §7 peer-backref row: followerNames is repointed, not dropped. A published
  // name is not a resolvable identifier — it belongs to the one human behind
  // both accounts — so carrying it across is lossless, where carrying the
  // loser's CODE would point the peer at a uid that stops existing.
  test('the published name is repointed to the survivor, not dropped', async () => {
    const { writes } = await merge(world());
    expect(writes['users/onlyL/followerNames/S']).toBe('LoserPublished');
    expect(writes['users/onlyL/followerNames/L']).toBeNull();
  });

  test('a survivor with no share code is refused, never a silent contact delete', async () => {
    const deps = world({ 'users/S/presence': { status: 'unavailable', lastSeen: 1000 } });
    await expect(merge(deps)).rejects.toThrow(/no share code/);
  });

  test('a peer who followed BOTH collapses to one card, reported as a conflict', async () => {
    const { writes, conflicts } = await merge(world());
    expect(writes['users/shared/followers/L']).toBeNull();
    // the survivor's existing entry is untouched, not overwritten
    expect(writes['users/shared/followers/S']).toBeUndefined();
    expect(writes['userPrefs/shared/following/S']).toBeUndefined();
    expect(conflicts.some((c) => c.kind === 'contact-collapsed' && c.path.includes('shared'))).toBe(true);
  });

  test('the survivor own lists union with the loser, survivor winning', async () => {
    const { writes, conflicts } = await merge(world());
    expect(writes['users/S/followers/onlyL']).toBe('ONL001');
    expect(writes['users/S/followerNames/onlyL']).toBe('OnlyL');
    expect(writes['users/S/followers/shared']).toBeUndefined();
    expect(conflicts.filter((c) => c.kind === 'contact-collapsed').length).toBeGreaterThanOrEqual(2);
  });
});

describe('groups', () => {
  test('a group only the loser is in moves the member record intact', async () => {
    const { writes } = await merge(world());
    expect(writes['groups/g2/members/S']).toEqual({ role: 'owner', displayName: 'LoserName' });
    expect(writes['groups/g2/members/L']).toBeNull();
  });

  test('ownership of a group the loser owns repoints to the survivor', async () => {
    const { writes } = await merge(world());
    expect(writes['groups/g2/ownerId']).toBe('S');
  });

  test('a shared group keeps the survivor displayName by default (D4)', async () => {
    const { writes, conflicts } = await merge(world());
    expect(writes['groups/g1/members/S']).toBeUndefined(); // survivor's record untouched
    expect(writes['groups/g1/members/L']).toBeNull();
    expect(conflicts.some((c) => c.kind === 'group-member-collision' && c.path === 'groups/g1/members/S')).toBe(true);
  });

  test('adoptGroupNames swaps in the loser displayName for the named group only (D4)', async () => {
    const { writes } = await merge(world(), { adoptGroupNames: ['g1'] });
    expect(writes['groups/g1/members/S/displayName']).toBe('LoserName');
  });

  test('the higher role wins on a member collision', async () => {
    const deps = world({ 'groups/g1/members/L': { role: 'owner', displayName: 'LoserName' } });
    const { writes } = await merge(deps);
    expect(writes['groups/g1/members/S/role']).toBe('owner');
  });

  test('the group enumeration entry keeps the higher lastVisited', async () => {
    const { writes } = await merge(world());
    expect(writes['users/S/groups/g1']).toEqual({ lastVisited: 5000 });
    expect(writes['users/S/groups/g2']).toEqual({ lastVisited: 100 });
  });

  test('a lower lastVisited leaves the survivor entry alone', async () => {
    const deps = world({ 'users/S/groups/g1': { lastVisited: 99999 } });
    const { writes } = await merge(deps);
    expect(writes['users/S/groups/g1']).toBeUndefined();
  });

  test('location residue for the loser is dropped', async () => {
    const { writes } = await merge(world());
    expect(writes['locations/L']).toBeNull();
    expect(writes['locationCells/g1/L']).toBeNull();
    expect(writes['locationCells/g2/L']).toBeNull();
  });
});

describe('identity and indexes', () => {
  test('the loser share code is freed, not aliased (D1)', async () => {
    const { writes } = await merge(world());
    expect(writes['codeIndex/LLL111']).toBeNull();
    expect(writes['codeIndex/SSS222']).toBeUndefined();
  });

  test('invite tokens move and their index repoints, so links keep working', async () => {
    const { writes } = await merge(world());
    expect(writes['users/S/invites/tokL']).toEqual({ redemptionsUsed: 2 });
    expect(writes['inviteIndex/tokL']).toEqual({ ownerPath: 'users/S/invites/tokL', ownerUid: 'S' });
  });

  test('lastSeen takes the max of the two accounts', async () => {
    const { writes } = await merge(world());
    expect(writes['users/S/presence/lastSeen']).toBe(9000);
  });

  test('a staler loser lastSeen does not clobber the survivor', async () => {
    const deps = world({ 'users/L/presence': { code: 'LLL111', lastSeen: 5 } });
    const { writes } = await merge(deps);
    expect(writes['users/S/presence/lastSeen']).toBeUndefined();
  });

  test('survivor prefs win wholesale; only following unions', async () => {
    const { writes, losses } = await merge(world());
    expect(writes['userPrefs/S/favorites']).toBeUndefined(); // survivor's kept
    expect(writes['userPrefs/S/following/onlyL']).toEqual({ code: 'ONL001', label: 'Only L' });
    expect(writes['userPrefs/L']).toBeNull();
    expect(losses.some((l) => l.includes('userPrefs/L'))).toBe(true);
  });
});

describe('push tokens, mailboxes, canvases', () => {
  test('push tokens union so both devices stay reachable', async () => {
    const { writes } = await merge(world());
    expect(writes['pushTokens/S/tokenL']).toEqual({ createdAt: 1, lastSeen: 9000 });
    expect(writes['pushTokens/L']).toBeNull();
  });

  test('transient mailboxes are dropped, durable ones union (D3)', async () => {
    const { writes } = await merge(world());
    expect(writes['knocks/L']).toBeNull();
    expect(writes['knocks/S']).toBeUndefined();
    expect(writes['pendingInvites/S/g3']).toEqual({ from: 'other', ts: 400 });
    expect(writes['pendingInvites/L']).toBeNull();
  });

  // C5: the six mailbox names live in OWN_MAILBOXES, not here. A seventh added
  // there must land in exactly one of the two buckets — and defaults to the
  // durable (union) one, which is the safe direction.
  test('the mailbox split is a partition of the shared list, not a second copy', () => {
    expect([...DROP_MAILBOXES, ...UNION_MAILBOXES].sort()).toEqual([...OWN_MAILBOXES].sort());
    expect(DROP_MAILBOXES.filter((b) => UNION_MAILBOXES.includes(b))).toEqual([]);
  });

  test('a durable mailbox entry the survivor already holds is kept AND the drop is reported', async () => {
    const deps = world({ 'pendingInvites/S': { g3: { from: 'someone-else', ts: 1 } } });
    const { writes, conflicts, losses } = await merge(deps);
    expect(writes['pendingInvites/S/g3']).toBeUndefined();
    // D3 unions these because they are real state, so a dropped one is a real
    // loss the operator must see before approving.
    expect(conflicts.some((c) => c.kind === 'mailbox-collision' && c.path === 'pendingInvites/S/g3')).toBe(true);
    expect(losses.some((l) => l.includes('pendingInvites/L/g3'))).toBe(true);
  });

  test('a moved pending invite keeps its by-group mirror in step', async () => {
    const { writes } = await merge(world());
    expect(writes['pendingInvitesByGroup/g3/S']).toBe(true);
    expect(writes['pendingInvitesByGroup/g3/L']).toBeNull();
  });

  // C3: these are dead the moment the loser is, whether or not they hold
  // anything today — the parity guard below cannot be satisfied by a write-set
  // that only nulls them when the fixture happens to be non-empty.
  test('always-dead families are nulled unconditionally, not only when non-empty', async () => {
    const { writes } = await merge(world());
    for (const path of ['calls/L', 'followRequests/L', 'followGrants/L', 'revocations/L',
      'pendingInvitesByGroup/g1/L', 'pendingInvitesByGroup/g2/L']) {
      expect({ path, value: writes[path] }).toEqual({ path, value: null });
    }
  });

  // C1: a canvas node is METADATA-ONLY on a move. canvases/{pair}/strokes is
  // the only unbounded node in the database; loading it into an update payload
  // is the constraint this project guards hardest.
  test('a canvas with a peer moves under the correctly sorted key, WITHOUT its strokes', async () => {
    const deps = world({ 'canvases/L_peerz': { bg: '#ffeecc', strokes: { s1: { color: 'red' } } } });
    const { writes, losses } = await buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, canvasKeys: ['L_peerz'] });
    // sorted([S, peerz]) — NOT a string replacement of the uid
    expect(writes['canvases/S_peerz/bg']).toBe('#ffeecc');
    expect(writes['canvases/S_peerz']).toBeUndefined(); // never a wholesale node write
    expect(writes['canvases/L_peerz']).toBeNull();
    expect(losses.some((l) => l.includes('canvases/L_peerz') && l.includes('strokes'))).toBe(true);
  });

  // canvasKeys is the ONE input that does not come from the live re-read — it
  // comes from the snapshot. A canvas created between snapshot and preview is
  // absent from it, so the collision guard misses and the move lands on a live
  // node. A wholesale node write would delete the survivor's strokes with no
  // conflict and no loss line, making the approved loss report say the
  // opposite of what happens. Leaf writes bound that race to a lost bg.
  test('a survivor canvas missing from a stale canvasKeys keeps its strokes', async () => {
    const deps = world({
      'canvases/L_peerz': { bg: '#111', strokes: { loser: { color: 'red' } } },
      'canvases/S_peerz': { bg: '#222', strokes: { survivor: { color: 'blue' } } },
    });
    const plan = await buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, canvasKeys: ['L_peerz'] });
    expect(plan.writes['canvases/S_peerz']).toBeUndefined();
    expect(plan.writes['canvases/S_peerz/bg']).toBe('#111');

    await applyMergePlan(deps, plan);
    // read off the raw store, so even the test never asks for a strokes node
    expect(deps.store['canvases/S_peerz'].strokes).toEqual({ survivor: { color: 'blue' } });
    expect(await deps.getVal('canvases/S_peerz/bg')).toBe('#111');
  });

  test('no code path reads a canvas subtree or carries strokes into the write-set', async () => {
    const deps = world({
      'canvases/L_peerz': { bg: '#ffeecc', strokes: { s1: { color: 'red' } } },
      'canvases/S_other': { bg: '#000', strokes: { s2: { color: 'blue' } } },
    });
    const { writes } = await buildMergePlan(deps, {
      loserUid: 'L', survivorUid: 'S', now: NOW, canvasKeys: ['L_peerz', 'S_other'],
    });
    const canvasReads = deps.getVal.mock.calls.map(([p]) => String(p)).filter((p) => p.startsWith('canvases'));
    // every canvas read is a single named leaf — never the node, never strokes
    expect(canvasReads.filter((p) => !/^canvases\/[^/]+\/(bg)$/.test(p))).toEqual([]);
    expect(deps.getVal.mock.calls.map(([p]) => String(p)).filter((p) => p.includes('strokes'))).toEqual([]);
    expect(JSON.stringify(writes)).not.toContain('strokes');
  });

  test('a canvas collision keeps the survivor drawing and reports it (D2)', async () => {
    const deps = world({
      'canvases/L_peerz': { bg: '#111', strokes: { loser: { color: 'red' } } },
      'canvases/S_peerz': { bg: '#222', strokes: { survivor: { color: 'blue' } } },
    });
    const { writes, conflicts, losses } = await buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, canvasKeys: ['L_peerz', 'S_peerz'] });
    expect(writes['canvases/S_peerz']).toBeUndefined();
    expect(writes['canvases/L_peerz']).toBeNull();
    expect(conflicts.some((c) => c.kind === 'canvas-collision')).toBe(true);
    expect(losses.some((l) => l.includes('canvases/L_peerz'))).toBe(true);
  });

  test('a canvas BETWEEN the two merging accounts is deleted, never self-keyed', async () => {
    const deps = world({ 'canvases/L_S': { bg: '#333', strokes: { s1: { color: 'red' } } } });
    const { writes, losses } = await buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, canvasKeys: ['L_S'] });
    expect(writes['canvases/L_S']).toBeNull();
    expect(writes['canvases/S_S']).toBeUndefined();
    expect(losses.some((l) => l.includes('canvases/L_S'))).toBe(true);
  });

  test('a canvas that names neither merging account is left alone', async () => {
    const deps = world({ 'canvases/S_other': { bg: '#444' } });
    const { writes } = await buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, canvasKeys: ['S_other', 'x_y'] });
    expect(Object.keys(writes).filter((k) => k.startsWith('canvases/'))).toEqual([]);
  });
});

describe('telegram repoint', () => {
  // performLink replaces the mapping NODE, so `createdAt` here really is
  // destroyed. This test used to seed it and assert only the resulting node,
  // which pinned the SILENT drop as correct: merge never read the mapping, so
  // it could not report what it was about to overwrite. The node assertion is
  // unchanged — wholesale replacement is production's behaviour — but the drop
  // must now appear in the loss report the operator approves, exactly as
  // buildProductionLinkPlan already reported it.
  test('mirrors performLink writes when telegramRepoint is set, and reports the fields it overwrites', async () => {
    const deps = world({
      'telegramUsers/42': { uid: 'L', chatId: '42', createdAt: 100 },
      'telegramByUid/L': { tgId: '42', chatId: '42' },
    });
    const { writes, losses } = await buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, telegramRepoint: true });
    expect(writes['telegramUsers/42']).toEqual({ uid: 'S', chatId: '42', linkedAt: NOW });
    expect(writes['telegramByUid/L']).toBeNull();
    expect(writes['telegramByUid/S']).toEqual({ tgId: '42', chatId: '42' });
    expect(writes['userPrefs/S/telegram/tgId']).toBe('42');
    expect(writes['userPrefs/S/telegram/linkedAt']).toBe(NOW);
    expect(writes['userPrefs/S/notifyChannel']).toBe('telegram');
    expect(losses.some((l) => l.includes('telegramUsers/42.createdAt') && l.includes('100'))).toBe(true);
  });

  test('a survivor already holding a DIFFERENT tgId is reported as a relink conflict', async () => {
    const deps = world({
      'telegramUsers/42': { uid: 'L', chatId: '42' },
      'telegramByUid/L': { tgId: '42', chatId: '42' },
      'telegramUsers/99': { uid: 'S', chatId: '99' },
      'telegramByUid/S': { tgId: '99', chatId: '99' },
    });
    const { writes, conflicts } = await buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, telegramRepoint: true });
    expect(conflicts.some((c) => c.kind === 'telegram-relink')).toBe(true);
    expect(writes['telegramUsers/99']).toBeNull();
    expect(writes['telegramUsers/42']).toEqual({ uid: 'S', chatId: '42', linkedAt: NOW });
  });

  test('repoint without a loser link is refused rather than half-applied', async () => {
    await expect(merge(world(), { telegramRepoint: true })).rejects.toThrow(/no telegram link/);
  });

  test('without repoint the loser mapping is torn down, not left dangling', async () => {
    const deps = world({
      'telegramUsers/42': { uid: 'L', chatId: '42' },
      'telegramByUid/L': { tgId: '42', chatId: '42' },
    });
    const { writes } = await merge(deps);
    expect(writes['telegramUsers/42']).toBeNull();
    expect(writes['telegramByUid/L']).toBeNull();
    expect(writes['userPrefs/S/notifyChannel']).toBeUndefined();
  });

  // telegramUsers/{tgId} is a GLOBAL key and the loser's reverse index is not
  // proof of ownership — integrity.js raises telegram-mapping-asymmetric at
  // ERROR severity for exactly this state, and the panel exists because that
  // state occurs in production. Deleting the mapping here would kill LIVE
  // account X's Telegram (its next Mini App open bootstraps a brand-new empty
  // account) while the loss line blamed the loser.
  test('a mapping the loser does not own is left alone, and the real owner is named', async () => {
    const deps = world({
      'telegramUsers/42': { uid: 'X', chatId: '42' },
      'telegramByUid/L': { tgId: '42', chatId: '42' },
      'users/X': { presence: { code: 'XXX111' } },
    });
    const { writes, conflicts, losses } = await merge(deps);
    expect(writes['telegramUsers/42']).toBeUndefined();
    expect(writes['telegramByUid/L']).toBeNull();
    expect(conflicts.some((c) => c.kind === 'telegram-mapping-not-owned' && c.path === 'telegramUsers/42')).toBe(true);
    expect(losses.some((l) => l.includes('telegramUsers/42') && l.includes('NOT deleted') && l.includes('X'))).toBe(true);
    // and never the old line claiming the loser's link was dropped
    expect(losses.some((l) => l.includes('telegramUsers/42 dropped'))).toBe(false);
    // X's Telegram still works after the merge is applied
    await applyMergePlan(deps, await merge(deps));
    expect(await deps.getVal('telegramUsers/42')).toEqual({ uid: 'X', chatId: '42' });
  });

  test('repointing a tgId a third account holds resets that account instead of silently stealing it', async () => {
    const deps = world({
      'telegramUsers/42': { uid: 'X', chatId: '42' },
      'telegramByUid/L': { tgId: '42', chatId: '42' },
      'telegramByUid/X': { tgId: '42', chatId: '42' },
      'users/X': { presence: { code: 'XXX111' } },
      'userPrefs/X': { notifyChannel: 'telegram', telegram: { tgId: '42', linkedAt: 5 } },
    });
    const { writes, conflicts, losses } = await buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, telegramRepoint: true });
    // the repoint still happens — that is performLink's own behaviour — but X
    // is reset exactly as performLink resets a prior phrase holder, and the
    // operator reads X's name in a conflict and a loss before confirming.
    expect(writes['telegramUsers/42']).toEqual({ uid: 'S', chatId: '42', linkedAt: NOW });
    expect(writes['telegramByUid/X']).toBeNull();
    expect(writes['userPrefs/X/telegram']).toBeNull();
    expect(writes['userPrefs/X/notifyChannel']).toBe('push');
    expect(conflicts.some((c) => c.kind === 'telegram-relink' && c.detail.includes('X'))).toBe(true);
    expect(losses.some((l) => l.includes('X') && l.includes('push'))).toBe(true);
  });

  test('a survivor reverse index pointing at a mapping someone else holds is not deleted', async () => {
    const deps = world({
      'telegramUsers/42': { uid: 'L', chatId: '42' },
      'telegramByUid/L': { tgId: '42', chatId: '42' },
      // S's reverse index claims tgId 99, but 99 really belongs to Y
      'telegramByUid/S': { tgId: '99', chatId: '99' },
      'telegramUsers/99': { uid: 'Y', chatId: '99' },
      'users/Y': { presence: { code: 'YYY111' } },
    });
    const { writes, conflicts, losses } = await buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, telegramRepoint: true });
    expect(writes['telegramUsers/99']).toBeUndefined();
    expect(conflicts.some((c) => c.kind === 'telegram-mapping-not-owned' && c.path === 'telegramUsers/99')).toBe(true);
    expect(losses.some((l) => l.includes('telegramUsers/99') && l.includes('Y'))).toBe(true);
    expect(losses.some((l) => l.includes('telegramUsers/99 dropped'))).toBe(false);
  });
});

describe('the loser is gone afterwards', () => {
  test('own subtrees are nulled and the plan applies atomically', async () => {
    const deps = world();
    const plan = await merge(deps);
    await applyMergePlan(deps, plan);

    expect(await deps.getVal('users/L')).toBeNull();
    expect(await deps.getVal('userPrefs/L')).toBeNull();
    expect(await deps.getVal('users/onlyL/followers/S')).toBe('SSS222');
    expect(await deps.getVal('groups/g2/ownerId')).toBe('S');
    // one atomic update, exactly like graduation
    expect(deps.update).toHaveBeenCalledTimes(1);
  });

  // Task 6 carried forward: pin BOTH directions. "Every previewed key landed"
  // catches execute-did-LESS; it does not catch execute-did-MORE, which is the
  // direction that burns an operator who approved a loss report.
  test('the wire payload is exactly the previewed write-set, no more and no less', async () => {
    // The self-follow is here on purpose: it is what makes the preview a strict
    // superset (its backrefs are nulls under a nulled ancestor), so the
    // exception clause below is exercised rather than merely present.
    const deps = world({
      'canvases/L_peerz': { bg: '#ffeecc', strokes: { s1: { color: 'red' } } },
      'users/L/followers': { shared: 'SHR001', onlyL: 'ONL001', L: 'LLL111' },
      'userPrefs/L/following': {
        shared: { code: 'SHR001', label: 'Shared' },
        onlyL: { code: 'ONL001', label: 'Only L' },
        L: { code: 'LLL111', label: 'me' },
      },
    });
    const plan = await buildMergePlan(deps, { loserUid: 'L', survivorUid: 'S', now: NOW, canvasKeys: ['L_peerz'] });
    await applyMergePlan(deps, plan);

    expect(deps.update).toHaveBeenCalledTimes(1);
    const [path, payload] = deps.update.mock.calls[0];
    expect(path).toBe('/');

    // no MORE than preview: every wire key was previewed, with the same value
    for (const key of Object.keys(payload)) {
      expect({ key, previewed: key in plan.writes }).toEqual({ key, previewed: true });
      expect({ key, value: payload[key] }).toEqual({ key, value: plan.writes[key] });
    }
    // no LESS than preview: the ONLY previewed key allowed to be missing from
    // the wire is a null already covered by a nulled ancestor (the preview is a
    // superset — a loss report, not the payload).
    const nulledAncestors = Object.keys(payload).filter((k) => payload[k] === null);
    const dropped = Object.keys(plan.writes).filter((k) => !(k in payload));
    for (const key of dropped) {
      const redundant = plan.writes[key] === null && nulledAncestors.some((a) => key.startsWith(`${a}/`));
      expect({ key, redundantDelete: redundant }).toEqual({ key, redundantDelete: true });
    }
    // the exception clause above must actually have run
    expect(dropped.length).toBeGreaterThan(0);
  });
});

// The two overlaps graduation carries explicit doomed/consumed guards for: a
// write aimed INSIDE a subtree the same update deletes wholesale is an illegal
// ancestor overlap that RTDB rejects outright, taking the whole merge with it.
describe('self-references cannot produce an illegal overlap', () => {
  test('a pathological self-follow applies cleanly', async () => {
    const deps = world({
      'users/L/followers': { shared: 'SHR001', onlyL: 'ONL001', L: 'LLL111' },
      'userPrefs/L/following': {
        shared: { code: 'SHR001', label: 'Shared' },
        onlyL: { code: 'ONL001', label: 'Only L' },
        L: { code: 'LLL111', label: 'me' },
      },
    });
    const plan = await merge(deps);
    expect(plan.writes['users/S/followers/L']).toBeUndefined();
    expect(plan.writes['userPrefs/S/following/L']).toBeUndefined();
    await expect(applyMergePlan(deps, plan)).resolves.toBeUndefined();
    expect(await deps.getVal('users/L')).toBeNull();
  });

  test('an edge between the two merging accounts is dropped, not moved onto itself', async () => {
    const deps = world({
      'users/L/followers': { shared: 'SHR001', S: 'SSS222' },
      'userPrefs/L/following': { shared: { code: 'SHR001', label: 'Shared' }, S: { code: 'SSS222', label: 'the survivor' } },
      'userPrefs/S/following/L': { code: 'LLL111', label: 'the loser' },
      'users/S/followers/L': 'LLL111',
    });
    const plan = await merge(deps);
    expect(plan.writes['users/S/followers/S']).toBeUndefined();
    expect(plan.writes['userPrefs/S/following/S']).toBeUndefined();
    expect(plan.writes['users/S/followers/L']).toBeNull();
    expect(plan.writes['userPrefs/S/following/L']).toBeNull();
    await applyMergePlan(deps, plan);
    expect(await deps.getVal('users/S/followers/L')).toBeNull();
    expect(await deps.getVal('users/S/presence/code')).toBe('SSS222');
  });
});

describe('parity with the shared residue enumerator', () => {
  test('every family crossRefRenderers emits for the loser is handled', async () => {
    // The source comments state expunge and graduation share this enumerator
    // SPECIFICALLY so a new residue family cannot be added to one and missed
    // by the other. Merge is its third consumer; this is the drift guard.
    //
    // canvasKeys carries BOTH orderings of each peer pair because that is what
    // the enumerator emits (it cannot know which sorted key exists), and
    // canvases are the one family merge drives from the shallow key list
    // rather than from the enumerator — see merge.js for why.
    const deps = world();
    const own = await deps.getVal('users/L');
    const prefs = await deps.getVal('userPrefs/L');
    const families = crossRefRenderers({ followers: own.followers, following: prefs.following, groups: own.groups })
      .map((render) => render('L'));

    const canvasKeys = families
      .filter((p) => p.startsWith('canvases/'))
      .map((p) => p.slice('canvases/'.length));
    const { writes } = await merge(deps, { canvasKeys });

    expect(canvasKeys.length).toBeGreaterThan(0);
    for (const path of families) {
      const handled = path in writes
        // or covered by a wholesale delete of an ancestor
        || Object.keys(writes).some((w) => writes[w] === null && path.startsWith(`${w}/`));
      expect({ path, handled }).toEqual({ path, handled: true });
    }
  });
});
