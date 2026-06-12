// tests/rules/mailboxes.test.js
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

test('knock: sender can write own key, cannot forge another sender; recipient reads', async () => {
  await assertSucceeds(dbAs(env, 'me').ref('knocks/you/me').set({ ts: 1 }));
  await assertFails(dbAs(env, 'me').ref('knocks/you/attacker').set({ ts: 1 }));
  await assertSucceeds(dbAs(env, 'you').ref('knocks/you').get());
  await assertFails(dbAs(env, 'me').ref('knocks/you').get());
});

test('followRequest: requester writes own key; target reads', async () => {
  await assertSucceeds(dbAs(env, 'req').ref('followRequests/tgt/req').set({ ts: 1 }));
  await assertFails(dbAs(env, 'req').ref('followRequests/tgt/someoneelse').set({ ts: 1 }));
  await assertSucceeds(dbAs(env, 'tgt').ref('followRequests/tgt').get());
});

test('followGrant: target (grantor) writes own key; requester reads', async () => {
  await assertSucceeds(dbAs(env, 'tgt').ref('followGrants/req/tgt').set({ from: 'tgt', code: 'X' }));
  await assertFails(dbAs(env, 'evil').ref('followGrants/req/tgt').set({ from: 'tgt' }));
  await assertSucceeds(dbAs(env, 'req').ref('followGrants/req').get());
});

test('revocation: revoker writes own key; revoked reads', async () => {
  await assertSucceeds(dbAs(env, 'revoker').ref('revocations/revoked/revoker').set(true));
  await assertSucceeds(dbAs(env, 'revoked').ref('revocations/revoked').get());
  await assertFails(dbAs(env, 'revoker').ref('revocations/revoked').get());
});
