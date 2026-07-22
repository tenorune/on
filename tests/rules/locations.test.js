/** @jest-environment node */
// Rules for the location-sharing feature (spec 2026-07-18): locations/{uid}
// readable only by a MUTUAL who is ALSO currently publishing (reciprocity by
// node existence); locationCells/{gid}/{uid} readable only by a co-member
// publishing into that same group.
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs, seed } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const LOC = { lat: 52.52, lng: 13.405, updatedAt: 1752800000000 };

// alice ↔ bob mutual; alice → carol one-way (alice follows carol only).
async function seedFollows(db) {
  await db.ref('users/alice/followers/bob').set('BOBCOD');
  await db.ref('users/bob/followers/alice').set('ALICOD');
  await db.ref('users/carol/followers/alice').set('ALICOD');
}

describe('locations/{uid}', () => {
  test('owner can write a valid node', async () => {
    await assertSucceeds(dbAs(env, 'alice').ref('locations/alice').set(LOC));
  });

  test('non-owner cannot write', async () => {
    await assertFails(dbAs(env, 'bob').ref('locations/alice').set(LOC));
  });

  test('validators: out-of-range lat, out-of-range lng, non-number updatedAt, unknown child', async () => {
    const own = dbAs(env, 'alice').ref('locations/alice');
    await assertFails(own.set({ ...LOC, lat: 91 }));
    await assertFails(own.set({ ...LOC, lat: -91 }));
    await assertFails(own.set({ ...LOC, lng: 181 }));
    await assertFails(own.set({ ...LOC, lng: -181 }));
    await assertFails(own.set({ ...LOC, updatedAt: 'now' }));
    await assertFails(own.set({ ...LOC, extra: true }));
  });

  test('owner can always read own node', async () => {
    await seed(env, async (db) => { await db.ref('locations/alice').set(LOC); });
    await assertSucceeds(dbAs(env, 'alice').ref('locations/alice').get());
  });

  test('mutual who is publishing can read', async () => {
    await seed(env, async (db) => {
      await seedFollows(db);
      await db.ref('locations/alice').set(LOC);
      await db.ref('locations/bob').set(LOC);
    });
    await assertSucceeds(dbAs(env, 'bob').ref('locations/alice').get());
  });

  test('mutual who is NOT publishing cannot read (reciprocity)', async () => {
    await seed(env, async (db) => {
      await seedFollows(db);
      await db.ref('locations/alice').set(LOC); // bob has no locations/bob
    });
    await assertFails(dbAs(env, 'bob').ref('locations/alice').get());
  });

  test('one-way follower cannot read even when publishing', async () => {
    await seed(env, async (db) => {
      // alice follows carol (users/carol/followers/alice), carol never
      // followed back — carol reading alice needs users/alice/followers/carol,
      // which is absent.
      await seedFollows(db);
      await db.ref('locations/alice').set(LOC);
      await db.ref('locations/carol').set(LOC);
    });
    await assertFails(dbAs(env, 'carol').ref('locations/alice').get());
  });

  test('unauthenticated cannot read', async () => {
    await seed(env, async (db) => { await db.ref('locations/alice').set(LOC); });
    await assertFails(dbAs(env, null).ref('locations/alice').get());
  });
});

describe('users/{uid}/followers — forgery guard (Fix 1)', () => {
  test('target CANNOT fabricate an inbound follower edge (create as $uid)', async () => {
    // mallory tries to claim "victim follows me" by writing into her OWN list.
    await assertFails(dbAs(env, 'mallory').ref('users/mallory/followers/victim').set('VICCOD'));
  });

  test('follower CAN still self-register (create as $follower)', async () => {
    await assertSucceeds(dbAs(env, 'mallory').ref('users/victim/followers/mallory').set('MALCOD'));
  });

  test('target CAN still remove a follower (delete as $uid)', async () => {
    await seed(env, async (db) => { await db.ref('users/victim/followers/mallory').set('MALCOD'); });
    await assertSucceeds(dbAs(env, 'victim').ref('users/victim/followers/mallory').remove());
  });

  test('forged-edge read exploit is blocked end-to-end', async () => {
    // mallory follows victim (legit, self as $follower) + publishes own node,
    // but CANNOT forge "victim follows mallory", so the mutual gate fails.
    await seed(env, async (db) => {
      await db.ref('users/victim/followers/mallory').set('MALCOD'); // mallory→victim
      await db.ref('locations/victim').set(LOC);
      await db.ref('locations/mallory').set(LOC);
    });
    await assertFails(dbAs(env, 'mallory').ref('users/mallory/followers/victim').set('VICCOD'));
    await assertFails(dbAs(env, 'mallory').ref('locations/victim').get());
  });

  test('followerNames: target cannot fabricate an inbound name either', async () => {
    await assertFails(dbAs(env, 'mallory').ref('users/mallory/followerNames/victim').set('Victim'));
  });
});

describe('locationCells/{gid}/{uid}', () => {
  const CELL = { lat: 52.52, lng: 13.41, updatedAt: 1752800000000 };

  async function seedGroup(db) {
    await db.ref('groups/G1/ownerId').set('alice');
    await db.ref('groups/G1/members/alice').set({ displayName: 'Alice' });
    await db.ref('groups/G1/members/bob').set({ displayName: 'Bob' });
  }

  test('member can write own cell', async () => {
    await seed(env, seedGroup);
    await assertSucceeds(dbAs(env, 'alice').ref('locationCells/G1/alice').set(CELL));
  });

  test('member cannot write another member cell', async () => {
    await seed(env, seedGroup);
    await assertFails(dbAs(env, 'alice').ref('locationCells/G1/bob').set(CELL));
  });

  test('non-member cannot write a cell', async () => {
    await seed(env, seedGroup);
    await assertFails(dbAs(env, 'mallory').ref('locationCells/G1/mallory').set(CELL));
  });

  test('kicked user can still DELETE own orphaned cell (carve-out)', async () => {
    await seed(env, async (db) => {
      await seedGroup(db);
      await db.ref('locationCells/G1/carol').set(CELL); // carol was a member once
    });
    await assertSucceeds(dbAs(env, 'carol').ref('locationCells/G1/carol').remove());
  });

  test('co-member publishing into the group can read cells', async () => {
    await seed(env, async (db) => {
      await seedGroup(db);
      await db.ref('locationCells/G1/alice').set(CELL);
      await db.ref('locationCells/G1/bob').set(CELL);
    });
    await assertSucceeds(dbAs(env, 'bob').ref('locationCells/G1/alice').get());
  });

  test('co-member NOT publishing into the group cannot read (reciprocity)', async () => {
    await seed(env, async (db) => {
      await seedGroup(db);
      await db.ref('locationCells/G1/alice').set(CELL); // bob has no cell in G1
    });
    await assertFails(dbAs(env, 'bob').ref('locationCells/G1/alice').get());
  });

  test('non-member cannot read even with a (stale) cell present', async () => {
    await seed(env, async (db) => {
      await seedGroup(db);
      await db.ref('locationCells/G1/alice').set(CELL);
      await db.ref('locationCells/G1/mallory').set(CELL);
    });
    await assertFails(dbAs(env, 'mallory').ref('locationCells/G1/alice').get());
  });
});

describe('groups/{gid}/members — self-join guard (Fix 2c)', () => {
  async function seedG(db) {
    await db.ref('groups/G1/ownerId').set('alice');
    await db.ref('groups/G1/members/alice').set({ role: 'owner', displayName: 'Alice' });
    await db.ref('groups/G1/members/bob').set({ role: 'member', displayName: 'Bob' });
  }

  test('DENIES a client self-CREATE of a member node (the #288 self-join)', async () => {
    await seed(env, seedG);
    await assertFails(dbAs(env, 'mallory').ref('groups/G1/members/mallory')
      .set({ role: 'member', displayName: 'Mallory', joinedAt: 1 }));
  });

  test('ALLOWS a member to self-UPDATE display name (existing membership)', async () => {
    await seed(env, seedG);
    await assertSucceeds(dbAs(env, 'bob').ref('groups/G1/members/bob/displayName').set('Bobby'));
  });

  test('ALLOWS a member to self-write statusOverride (existing membership)', async () => {
    await seed(env, seedG);
    await assertSucceeds(dbAs(env, 'bob').ref('groups/G1/members/bob/statusOverride')
      .set({ enabled: true, status: 'available', availableUntil: 1752800000000 }));
  });

  test('ALLOWS a member to self-LEAVE (delete own node)', async () => {
    await seed(env, seedG);
    await assertSucceeds(dbAs(env, 'bob').ref('groups/G1/members/bob').remove());
  });

  test('ALLOWS the owner to add and remove members', async () => {
    await seed(env, seedG);
    await assertSucceeds(dbAs(env, 'alice').ref('groups/G1/members/carol')
      .set({ role: 'member', displayName: 'Carol', joinedAt: 1 }));
    await assertSucceeds(dbAs(env, 'alice').ref('groups/G1/members/bob').remove());
  });

  test('forged-member coarse-cell read is blocked end-to-end', async () => {
    await seed(env, seedG);
    // mallory cannot self-join, so she can never publish a cell → never reads.
    await assertFails(dbAs(env, 'mallory').ref('groups/G1/members/mallory')
      .set({ role: 'member', displayName: 'M', joinedAt: 1 }));
  });
});

describe('groups/{gid} ownership — create-only guard (Fix A)', () => {
  // The $gid .write rule's second branch (newData.child('ownerId').val() ===
  // auth.uid) previously had no existence guard, so ANY authed user could
  // overwrite ownerId on an EXISTING group and seize ownership. It must only
  // fire on CREATE (!data.exists()).
  async function seedG1(db) {
    await db.ref('groups/G1/ownerId').set('alice');
    await db.ref('groups/G1/members/alice').set({ role: 'owner', displayName: 'Alice' });
  }

  test('DENIES a non-owner overwriting ownerId on an existing group (takeover)', async () => {
    await seed(env, seedG1);
    await assertFails(dbAs(env, 'mallory').ref('groups/G1/ownerId').set('mallory'));
  });

  test('DENIES the full takeover chain end-to-end: still cannot self-add as member', async () => {
    await seed(env, seedG1);
    await assertFails(dbAs(env, 'mallory').ref('groups/G1/ownerId').set('mallory'));
    // Owner-branch bypass stays closed: mallory is still not the owner, so
    // the members/$uid owner-add path is unavailable to her too.
    await assertFails(dbAs(env, 'mallory').ref('groups/G1/members/mallory')
      .set({ role: 'member', displayName: 'Mallory', joinedAt: 1 }));
  });

  test('ALLOWS creating a brand-new group in one write with self as ownerId', async () => {
    await assertSucceeds(dbAs(env, 'carol').ref('groups/GNEW')
      .set({ ownerId: 'carol', name: 'New', createdAt: 1 }));
  });

  test('ALLOWS the owner to update a group field on an existing group', async () => {
    await seed(env, seedG1);
    await assertSucceeds(dbAs(env, 'alice').ref('groups/G1/name').set('Renamed'));
  });

  test('ALLOWS the owner to delete the group node', async () => {
    await seed(env, seedG1);
    await assertSucceeds(dbAs(env, 'alice').ref('groups/G1').remove());
  });
});

describe('groups/{gid}/invites/{token}/redemptionsUsed — owner-only guard (Fix B)', () => {
  // The client +1 allowance let ANY authed user (even a non-member) walk the
  // counter up to the redemption cap (invite DoS). The legitimate bump moved
  // server-side (joinGroup callable, Admin SDK, bypasses rules); client
  // writes are now owner-only.
  async function seedG1WithInvite(db) {
    await db.ref('groups/G1/ownerId').set('alice');
    await db.ref('groups/G1/members/alice').set({ role: 'owner', displayName: 'Alice' });
    await db.ref('groups/G1/members/bob').set({ role: 'member', displayName: 'Bob' });
    await db.ref('groups/G1/invites/TOKG').set({
      scope: 'group', token: 'TOKG', creatorUid: 'alice', redemptionsUsed: 0, revoked: false,
    });
  }

  test('DENIES a non-owner (even an existing member) bumping redemptionsUsed', async () => {
    await seed(env, seedG1WithInvite);
    await assertFails(dbAs(env, 'bob').ref('groups/G1/invites/TOKG/redemptionsUsed').set(1));
  });

  test('ALLOWS the owner to write the counter', async () => {
    await seed(env, seedG1WithInvite);
    await assertSucceeds(dbAs(env, 'alice').ref('groups/G1/invites/TOKG/redemptionsUsed').set(0));
  });
});
