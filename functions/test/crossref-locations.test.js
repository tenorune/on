// The residue families crossRefRenderers gained after the ops panel shipped:
// `locations/{uid}`, `locationCells/{gid}/{uid}`, and the pendingInvitesByGroup
// entries for groups the account is invited to but not a member of.
//
// These live in their own file rather than in telegram-auth.test.js: that suite
// has a 0-line diff across the ops-panel branch and is the standing proof the
// expungeDerivedAccount split preserved shipped behaviour. This change is a
// deliberate behaviour CHANGE, so its coverage belongs beside it, not inside
// the invariant.
import { makeStoreDeps } from './store-deps.js';
import { buildExpungeWrites, crossRefRenderers, graduateAccountData } from '../telegram-auth.js';

describe('crossRefRenderers: location residue', () => {
  test('renders the account-level location fix', () => {
    const paths = crossRefRenderers({ followers: {}, following: {}, groups: {} }).map((r) => r('dead'));

    expect(paths).toContain('locations/dead');
  });

  test('renders a coarse location cell per group the account belongs to', () => {
    const paths = crossRefRenderers({ followers: {}, following: {}, groups: { g1: {}, g2: {} } }).map((r) => r('dead'));

    expect(paths).toContain('locationCells/g1/dead');
    expect(paths).toContain('locationCells/g2/dead');
  });
});

describe('crossRefRenderers: pending invites to groups the account has not joined', () => {
  test('renders the by-group sweep entry for an invited-but-not-member group', () => {
    const paths = crossRefRenderers({
      followers: {},
      following: {},
      groups: { g1: {} },
      pendingInvites: { g9: { from: 'x' } },
    }).map((r) => r('dead'));

    expect(paths).toContain('pendingInvitesByGroup/g9/dead');
  });

  test('does not render a duplicate entry when the invite gid is also a member gid', () => {
    const paths = crossRefRenderers({
      followers: {},
      following: {},
      groups: { g1: {} },
      pendingInvites: { g1: { from: 'x' } },
    }).map((r) => r('dead'));

    expect(paths.filter((p) => p === 'pendingInvitesByGroup/g1/dead')).toHaveLength(1);
  });
});

describe('buildExpungeWrites: location residue', () => {
  function seeded() {
    return makeStoreDeps({
      'users/dead': { presence: { code: 'DEAD01' }, groups: { g1: { lastVisited: 1 }, owned: { lastVisited: 2 } } },
      'groups/g1': { ownerId: 'other', members: { dead: { role: 'member' }, other: { role: 'owner' } } },
      'groups/owned': { ownerId: 'dead', members: { dead: { role: 'owner' }, other: { role: 'member' } } },
      'locations/dead': { lat: 1, lng: 2, updatedAt: 3 },
      'locationCells/g1/dead': { cell: 'u33d', updatedAt: 3 },
      'locationCells/owned/dead': { cell: 'u33d', updatedAt: 3 },
      'locationCells/owned/other': { cell: 'u33e', updatedAt: 4 },
    });
  }

  test('nulls the account-level location fix', async () => {
    const writes = await buildExpungeWrites(seeded(), 'dead');

    expect(writes['locations/dead']).toBeNull();
  });

  test('nulls the location cell in a group owned by someone else', async () => {
    const writes = await buildExpungeWrites(seeded(), 'dead');

    expect(writes['locationCells/g1/dead']).toBeNull();
  });

  test('nulls the whole cell node of a group it owns, so no co-member cell is orphaned', async () => {
    // The group itself is deleted wholesale because the account owns it, which
    // would otherwise strand every OTHER member's cell under a gid that no
    // longer exists. Symmetric with the pendingInvitesByGroup/{gid} null that
    // already sits in the owned-group block.
    const writes = await buildExpungeWrites(seeded(), 'dead');

    expect(writes['locationCells/owned']).toBeNull();
  });

  test('the owned-group cell node null survives application as one atomic update', async () => {
    // The enumerator also emits locationCells/owned/dead, a descendant of the
    // wholesale null — rootUpdate must drop it as a redundant delete rather
    // than reject the update as an ancestor overlap.
    const deps = seeded();
    const { expungeDerivedAccount } = await import('../telegram-auth.js');

    await expungeDerivedAccount(deps, 'dead');

    expect(await deps.getVal('locationCells/owned')).toBeNull();
    expect(await deps.getVal('locations/dead')).toBeNull();
  });
});

describe('buildExpungeWrites: pending invites to groups the account has not joined', () => {
  test('nulls the by-group sweep entry the membership list cannot see', async () => {
    const deps = makeStoreDeps({
      'users/dead': { presence: { code: 'DEAD01' }, groups: { g1: { lastVisited: 1 } } },
      'groups/g1': { ownerId: 'other', members: { dead: { role: 'member' } } },
      'pendingInvites/dead': { g9: { from: 'inviter' } },
      'pendingInvitesByGroup/g9/dead': true,
    });

    const writes = await buildExpungeWrites(deps, 'dead');

    expect(writes['pendingInvitesByGroup/g9/dead']).toBeNull();
  });
});

describe('graduateAccountData: the new families move with the account', () => {
  test('moves the location fix and the group cell from the old uid to the new', async () => {
    const deps = makeStoreDeps({
      'users/old': { presence: { code: 'OLD001' }, groups: { g1: { lastVisited: 1 } } },
      'userPrefs/old': { following: {} },
      'groups/g1': { ownerId: 'other', members: { old: { role: 'member' } } },
      'locations/old': { lat: 1, lng: 2, updatedAt: 3 },
      'locationCells/g1/old': { cell: 'u33d', updatedAt: 3 },
    });

    await graduateAccountData(deps, 'old', 'new');

    expect(await deps.getVal('locations/new')).toEqual({ lat: 1, lng: 2, updatedAt: 3 });
    expect(await deps.getVal('locations/old')).toBeNull();
    expect(await deps.getVal('locationCells/g1/new')).toEqual({ cell: 'u33d', updatedAt: 3 });
    expect(await deps.getVal('locationCells/g1/old')).toBeNull();
  });

  test('moves the by-group sweep entry for a group it was only invited to', async () => {
    const deps = makeStoreDeps({
      'users/old': { presence: { code: 'OLD001' }, groups: {} },
      'userPrefs/old': { following: {} },
      'pendingInvites/old': { g9: { from: 'inviter' } },
      'pendingInvitesByGroup/g9/old': true,
    });

    await graduateAccountData(deps, 'old', 'new');

    expect(await deps.getVal('pendingInvitesByGroup/g9/new')).toBe(true);
    expect(await deps.getVal('pendingInvitesByGroup/g9/old')).toBeNull();
  });
});
