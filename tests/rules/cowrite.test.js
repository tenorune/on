// tests/rules/cowrite.test.js
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs, seed } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

test('calls: caller can ring callee (from===self); stranger cannot', async () => {
  await assertSucceeds(dbAs(env, 'caller').ref('calls/callee').set({ from: 'caller', ts: 1 }));
  await assertFails(dbAs(env, 'stranger').ref('calls/callee').set({ from: 'caller', ts: 1 }));
});

test('calls: named peer can update/clear an existing call; owner can too', async () => {
  await seed(env, (db) => db.ref('calls/callee').set({ from: 'caller', ts: 1 }));
  await assertSucceeds(dbAs(env, 'caller').ref('calls/callee').remove());      // peer clears
  await seed(env, (db) => db.ref('calls/callee').set({ from: 'caller', ts: 1 }));
  await assertSucceeds(dbAs(env, 'callee').ref('calls/callee/answered').set(true)); // owner answers
  await seed(env, (db) => db.ref('calls/callee').set({ from: 'caller', ts: 1 }));
  await assertFails(dbAs(env, 'stranger').ref('calls/callee').remove());
});

test('followers: follower self-registers; owner removes; stranger cannot', async () => {
  await assertSucceeds(dbAs(env, 'follower').ref('users/owner/followers/follower').set('CODE12'));
  await assertSucceeds(dbAs(env, 'owner').ref('users/owner/followers/follower').remove());
  await assertFails(dbAs(env, 'stranger').ref('users/owner/followers/follower').set('CODE12'));
});
