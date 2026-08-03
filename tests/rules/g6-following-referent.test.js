// tests/rules/g6-following-referent.test.js — G6: a follow entry may only name
// an account that exists. Spec: docs/superpowers/specs/2026-08-03-g6-peer-republish-design.md §5.
// The write being refused here is a PEER's client replaying its localStorage
// cache into its OWN prefs after the followee was purged — a legitimate session
// writing an owner-only node, which is why no revocation-time check reaches it.
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs, seed } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const ENTRY = { code: 'XK7P2M', label: 'Bea' };

describe('userPrefs/$uid/following/$followee — the followee must exist', () => {
  test('accepts a follow entry naming a real account', async () => {
    await seed(env, (db) => db.ref('users/T/presence').set({ code: 'XK7P2M', status: 'unavailable', availableUntil: null }));
    await assertSucceeds(dbAs(env, 'M').ref('userPrefs/M/following/T').set(ENTRY));
  });

  test('rejects a follow entry naming a uid with no user record (the G6 republish)', async () => {
    await assertFails(dbAs(env, 'M').ref('userPrefs/M/following/T').set(ENTRY));
  });

  test('rejects it when users/T holds only a follower row — the forgeable shape', async () => {
    // users/$uid/followers/$follower is writable BY the follower, so a peer's own
    // follower row creates the users/T node. A bare users/T.exists() predicate
    // would pass here, and registerAsFollower runs immediately before
    // setFollowingEntry in js/following.ts:1518-1520, so it would pass every time.
    await seed(env, (db) => db.ref('users/T/followers/M').set('XK7P2M'));
    await assertFails(dbAs(env, 'M').ref('userPrefs/M/following/T').set(ENTRY));
  });

  test('allows deleting an entry that is already dangling', async () => {
    // .validate is skipped on delete, and it must be: the purge's own cross-ref
    // null and a user unfollowing a dead contact both go through here.
    await seed(env, (db) => db.ref('userPrefs/M/following/T').set(ENTRY));
    await assertSucceeds(dbAs(env, 'M').ref('userPrefs/M/following/T').remove());
  });

  test('rejects a write to a field UNDER the entry (validate does not run on ancestors)', async () => {
    await assertFails(dbAs(env, 'M').ref('userPrefs/M/following/T/label').set('Bea'));
  });

  test('rejects a write two levels below the entry ($field\'s $sub)', async () => {
    // The $field copy closes exactly one level; without an explicit $sub rule
    // a write here would be validated by nothing (M1).
    await assertFails(dbAs(env, 'M').ref('userPrefs/M/following/T/label/x').set('Bea'));
  });

  test('leaves an unrelated prefs update alone while a dangling entry exists', async () => {
    // .validate covers the data being written, not the rest of the tree.
    await seed(env, (db) => db.ref('userPrefs/M/following/T').set(ENTRY));
    await assertSucceeds(dbAs(env, 'M').ref('userPrefs/M').update({ notifyChannel: 'push' }));
  });

  test('still refuses a non-owner, existing followee or not', async () => {
    await seed(env, (db) => db.ref('users/T/presence').set({ code: 'XK7P2M', status: 'unavailable', availableUntil: null }));
    await assertFails(dbAs(env, 'X').ref('userPrefs/M/following/T').set(ENTRY));
  });
});
