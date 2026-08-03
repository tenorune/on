// tests/rules/ownership.test.js
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs, seed } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

test('userPrefs: owner read/write only', async () => {
  // The followee must exist — userPrefs/$uid/following/$followee is guarded by a
  // referential .validate (G6). This test is about ownership, not the referent.
  await seed(env, (db) => db.ref('users/u2/presence').set({ code: 'XK7P2M', status: 'unavailable', availableUntil: null }));
  await assertSucceeds(dbAs(env, 'u1').ref('userPrefs/u1/following/u2').set({ code: 'X' }));
  await assertFails(dbAs(env, 'u2').ref('userPrefs/u1/following/u2').get());
  await assertFails(dbAs(env, 'u2').ref('userPrefs/u1/following/u2').set({ code: 'Y' }));
});

test('users/{uid}: owner writes; any signed-in reads; unauth cannot', async () => {
  await assertSucceeds(dbAs(env, 'u1').ref('users/u1/presence/status').set('available'));
  await assertFails(dbAs(env, 'u2').ref('users/u1/presence/status').set('away'));
  await assertSucceeds(dbAs(env, 'u2').ref('users/u1/presence/status').get());
  await assertFails(dbAs(env, null).ref('users/u1/presence/status').get());
});

test('no listing: cannot read a whole collection root', async () => {
  await assertFails(dbAs(env, 'u1').ref('users').get());
  await assertFails(dbAs(env, 'u1').ref('userPrefs').get());
});

// Regression guard for the legacy `writeBackExpired` pattern: a client that
// watched a followed contact whose availability had lapsed used to write
// `unavailable` back to THAT contact's presence. R1 forbids cross-user presence
// writes; only the owner may write their own presence.
test('presence: a non-owner cannot write another user\'s presence; owner can', async () => {
  await assertFails(
    dbAs(env, 'u2').ref('users/u1/presence').update({ status: 'unavailable', availableUntil: null }),
  );
  await assertSucceeds(
    dbAs(env, 'u1').ref('users/u1/presence').update({ status: 'unavailable', availableUntil: null }),
  );
});
