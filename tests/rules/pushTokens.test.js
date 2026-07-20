// tests/rules/pushTokens.test.js
// F6c: FCM push-token records moved OUT of the wholesale-watched userPrefs node
// to a fresh top-level pushTokens/{uid}/{token} path. Owner-only read+write; a
// non-owner can neither read nor write another user's node.
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

test('owner can write and read their own pushTokens node', async () => {
  await assertSucceeds(dbAs(env, 'alice').ref('pushTokens/alice/tok1').set({ createdAt: 1, lastSeen: 1, ua: 'UA' }));
  await assertSucceeds(dbAs(env, 'alice').ref('pushTokens/alice').get());
});

test('non-owner can neither read nor write another user\'s pushTokens', async () => {
  await assertFails(dbAs(env, 'bob').ref('pushTokens/alice/tok2').set({ createdAt: 1, lastSeen: 1, ua: 'x' }));
  await assertFails(dbAs(env, 'bob').ref('pushTokens/alice').get());
});
