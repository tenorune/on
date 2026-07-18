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
