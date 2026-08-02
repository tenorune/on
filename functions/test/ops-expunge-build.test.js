import { makeStoreDeps } from './store-deps.js';
import { buildExpungeWrites, crossRefRenderers, expungeDerivedAccount } from '../telegram-auth.js';

function seeded() {
  return makeStoreDeps({
    'users/dead': { presence: { code: 'DEAD01' }, followers: { peer: 'PEER01' }, groups: { g1: { lastVisited: 1 } }, invites: { tok1: { redemptionsUsed: 0 } } },
    'userPrefs/dead': { following: { peer: {} } },
    'groups/g1': { name: 'G', ownerId: 'other', members: { dead: { role: 'member' }, other: { role: 'owner' } } },
    'codeIndex/DEAD01': 'dead',
    'inviteIndex/tok1': { ownerPath: 'users/dead/invites/tok1', ownerUid: 'dead' },
  });
}

describe('crossRefRenderers', () => {
  test('is exported and renders every residue family at a given uid', () => {
    const paths = crossRefRenderers({
      followers: { peer: 'PEER01' },
      following: { peer: {} },
      groups: { g1: {} },
    }).map((render) => render('dead'));

    expect(paths).toEqual(expect.arrayContaining([
      'userPrefs/peer/following/dead',
      'users/peer/followers/dead',
      'users/peer/followerNames/dead',
      'canvases/dead_peer',
      'canvases/peer_dead',
      'groups/g1/members/dead',
      'pendingInvitesByGroup/g1/dead',
      'knocks/dead',
      'calls/dead',
      'followRequests/dead',
      'followGrants/dead',
      'pendingInvites/dead',
      'revocations/dead',
    ]));
  });
});

describe('buildExpungeWrites', () => {
  test('returns the null-set without writing anything', async () => {
    const deps = seeded();
    const before = JSON.stringify(deps.store);

    const writes = await buildExpungeWrites(deps, 'dead');

    expect(JSON.stringify(deps.store)).toBe(before); // nothing applied
    expect(writes['users/dead']).toBeNull();
    expect(writes['userPrefs/dead']).toBeNull();
    expect(writes['codeIndex/DEAD01']).toBeNull();
    expect(writes['inviteIndex/tok1']).toBeNull();
    expect(writes['groups/g1/members/dead']).toBeNull();
    expect(deps.update).not.toHaveBeenCalled();
  });

  test('folds extraNulls into the same set', async () => {
    const writes = await buildExpungeWrites(seeded(), 'dead', { 'telegramByUid/dead': null });
    expect(writes['telegramByUid/dead']).toBeNull();
  });

  test('expungeDerivedAccount still applies exactly this set', async () => {
    const deps = seeded();
    const writes = await buildExpungeWrites(deps, 'dead');

    const applyDeps = seeded();
    await expungeDerivedAccount(applyDeps, 'dead');

    for (const path of Object.keys(writes)) {
      expect(await applyDeps.getVal(path)).toBeNull();
    }
  });
});

// The global indexes that point INTO a group deleted wholesale.
//
// Found on dev 2026-08-02 by the panel's integrity report after a real purge:
// `group-id-index-dangling` on both groups the account owned, and
// `invite-index-dangling` on two tokens it had issued in them. Same shape as G5
// — a wholesale parent null destroys the record and strands the global key that
// resolves to it — and the same blind spot: neither path is in the purge's
// write-set, so the pre-image residue sweep cannot see them (G4's boundary).
//
// `groupIdIndex/{gid}` is a bare `true` existence lock keyed by the SAME gid as
// `groups/{gid}` (js/db/groups.ts:12-21), so a stranded entry burns that group
// code permanently: allocation can never reuse it.
//
// `inviteIndex/{token}` is `{scope, ownerPath, ownerUid}` (js/db/social.ts:44-54)
// and `ownerPath` is EITHER `users/{uid}/invites/{token}` OR
// `groups/{gid}/invites/{token}`. buildExpungeWrites only ever enumerated the
// first, from `users/{uid}/invites` — so a group-scoped token was invisible to it.
function seededOwner() {
  return makeStoreDeps({
    'users/dead': {
      presence: { code: 'DEAD01' },
      groups: { gOwn: { lastVisited: 1 }, gOther: { lastVisited: 2 } },
    },
    'userPrefs/dead': {},
    'groups/gOwn': {
      name: 'Owned', ownerId: 'dead',
      members: { dead: { role: 'owner' }, peer: { role: 'member' } },
      invites: { gtok1: { redemptionsUsed: 0 }, gtok2: { redemptionsUsed: 1 } },
    },
    'groups/gOther': {
      name: 'Theirs', ownerId: 'other',
      members: { dead: { role: 'member' }, other: { role: 'owner' } },
      invites: { otok: { redemptionsUsed: 0 } },
    },
    'groupIdIndex/gOwn': true,
    'groupIdIndex/gOther': true,
    'inviteIndex/gtok1': { scope: 'group', ownerPath: 'groups/gOwn/invites/gtok1', ownerUid: 'dead' },
    'inviteIndex/gtok2': { scope: 'group', ownerPath: 'groups/gOwn/invites/gtok2', ownerUid: 'peer' },
    'inviteIndex/otok': { scope: 'group', ownerPath: 'groups/gOther/invites/otok', ownerUid: 'dead' },
  });
}

describe('buildExpungeWrites: indexes pointing into a wholesale-deleted group', () => {
  test('an owned group releases its id-index entry, so the code can be reused', async () => {
    const writes = await buildExpungeWrites(seededOwner(), 'dead');

    expect(writes['groupIdIndex/gOwn']).toBeNull();
  });

  test("a group owned by someone else keeps its lock — the group is not going anywhere", async () => {
    const writes = await buildExpungeWrites(seededOwner(), 'dead');

    expect(writes['groupIdIndex/gOther']).toBeUndefined();
  });

  test('an owned group releases the index entry of every invite issued in it', async () => {
    const writes = await buildExpungeWrites(seededOwner(), 'dead');

    expect(writes['inviteIndex/gtok1']).toBeNull();
  });

  test("including a token a DIFFERENT member issued — the record dies with the group either way", async () => {
    const writes = await buildExpungeWrites(seededOwner(), 'dead');

    expect(writes['inviteIndex/gtok2']).toBeNull();
  });

  test('a token in a surviving group is left alone — its record still resolves', async () => {
    const writes = await buildExpungeWrites(seededOwner(), 'dead');

    expect(writes['inviteIndex/otok']).toBeUndefined();
  });

  test('the enlarged null-set still applies as one atomic update', async () => {
    const deps = seededOwner();

    await expungeDerivedAccount(deps, 'dead');

    expect(await deps.getVal('groupIdIndex/gOwn')).toBeNull();
    expect(await deps.getVal('inviteIndex/gtok1')).toBeNull();
    expect(await deps.getVal('inviteIndex/gtok2')).toBeNull();
    expect(await deps.getVal('groupIdIndex/gOther')).toBe(true);
    expect(await deps.getVal('inviteIndex/otok')).toEqual({ scope: 'group', ownerPath: 'groups/gOther/invites/otok', ownerUid: 'dead' });
  });
});
