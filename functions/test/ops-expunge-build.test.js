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
