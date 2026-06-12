// tests/rules/smoke.test.js
const { assertSucceeds } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

test('emulator harness boots', async () => {
  await assertSucceeds(dbAs(env, 'u1').ref('users/u1/presence/status').set('available'));
});
