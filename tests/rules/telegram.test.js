// tests/rules/telegram.test.js — server-only Telegram nodes + notifyChannel validation.
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs, seed } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

test('telegramUsers / telegramByUid: no client read or write, even for the mapped user', async () => {
  await seed(env, (db) => db.ref('telegramUsers/42').set({ uid: 'u1', chatId: '42' }));
  await seed(env, (db) => db.ref('telegramByUid/u1').set({ tgId: '42', chatId: '42' }));
  await assertFails(dbAs(env, 'u1').ref('telegramUsers/42').get());
  await assertFails(dbAs(env, 'u1').ref('telegramUsers/42/chatId').set('666'));
  await assertFails(dbAs(env, 'u1').ref('telegramByUid/u1').get());
  await assertFails(dbAs(env, 'u1').ref('telegramByUid/u1/chatId').set('666'));
});

test('notifyChannel: owner can set push/telegram; other values rejected; stranger rejected', async () => {
  await assertSucceeds(dbAs(env, 'u1').ref('userPrefs/u1/notifyChannel').set('telegram'));
  await assertSucceeds(dbAs(env, 'u1').ref('userPrefs/u1/notifyChannel').set('push'));
  await assertFails(dbAs(env, 'u1').ref('userPrefs/u1/notifyChannel').set('smoke-signals'));
  await assertFails(dbAs(env, 'stranger').ref('userPrefs/u1/notifyChannel').set('push'));
});
