// tests/rules/ownership.test.js
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

test('userPrefs: owner read/write only', async () => {
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
