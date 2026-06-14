// tests/rules/membership.test.js
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs, seed } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

test('pendingInvites: a member can invite (from===self); a non-member cannot', async () => {
  await seed(env, (db) => db.ref('groups/G1/members/inviter').set({ role: 'owner' }));
  await assertSucceeds(dbAs(env, 'inviter').ref('pendingInvites/invitee/G1').set({ from: 'inviter', ts: 1 }));
  await assertFails(dbAs(env, 'outsider').ref('pendingInvites/invitee/G1').set({ from: 'outsider', ts: 1 }));
  await assertFails(dbAs(env, 'inviter').ref('pendingInvites/invitee/G1').set({ from: 'someoneelse', ts: 1 }));
  await assertSucceeds(dbAs(env, 'invitee').ref('pendingInvites/invitee').get());
});

test('groups: only a member can read; self-join allowed (lighter)', async () => {
  await seed(env, (db) => db.ref('groups/G1').set({ ownerId: 'owner', members: { owner: { role: 'owner' } } }));
  await assertFails(dbAs(env, 'outsider').ref('groups/G1').get());
  await assertSucceeds(dbAs(env, 'owner').ref('groups/G1').get());
  await assertSucceeds(dbAs(env, 'joiner').ref('groups/G1/members/joiner').set({ role: 'member' })); // self-join
});

test('codeIndex: can point a code at your own uid only', async () => {
  await assertSucceeds(dbAs(env, 'u1').ref('codeIndex/ABC').set('u1'));
  await assertFails(dbAs(env, 'u1').ref('codeIndex/XYZ').set('u2'));
  await assertSucceeds(dbAs(env, 'u3').ref('codeIndex/QQQ').get());
});

test('groupIdIndex: first-writer-wins claim', async () => {
  await assertSucceeds(dbAs(env, 'u1').ref('groupIdIndex/G9').set(true));
  await assertFails(dbAs(env, 'u2').ref('groupIdIndex/G9').set(true)); // already claimed
});

test('canvases: only the two named participants can read/write', async () => {
  await assertSucceeds(dbAs(env, 'alice').ref('canvases/alice_bob/bg').set('#fff'));
  await assertSucceeds(dbAs(env, 'bob').ref('canvases/alice_bob/strokes/k1').set({ x: 1 }));
  await assertFails(dbAs(env, 'carol').ref('canvases/alice_bob/bg').get());
  await assertFails(dbAs(env, 'carol').ref('canvases/alice_bob/bg').set('#000'));
});

test('notifierState: locked to everyone (functions use admin SDK)', async () => {
  await assertFails(dbAs(env, 'u1').ref('notifierState/availability/u1').get());
  await assertFails(dbAs(env, 'u1').ref('notifierState/availability/u1').set(1));
});
