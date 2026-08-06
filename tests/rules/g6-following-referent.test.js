// tests/rules/g6-following-referent.test.js — G6: a follow entry may only name
// an account that exists. Spec: docs/superpowers/specs/2026-08-03-g6-peer-republish-design.md §5.
// The write being refused here is a PEER's client replaying its localStorage
// cache into its OWN prefs after the followee was purged — a legitimate session
// writing an owner-only node, which is why no revocation-time check reaches it.
//
// M10: the guarded path below is typed BY HAND. It cannot import
// js/db/social.ts — this suite runs against the rules emulator, not jsdom — so
// the tie to the client is a test on the other side:
// tests/db.test.js, "setFollowingEntry — the path the G6 rules guard
// validates", asserts setFollowingEntry builds exactly
// userPrefs/{me}/following/{followee}. If you change the path here, change it
// there too; if that test goes red, this guard is sitting on a path nothing
// writes and these cases prove nothing.
//
// M12 is the same tie one layer over, for the PREDICATE rather than the path:
// tests/db.test.js, "followeeExists — the predicate the G6 rules guard
// enforces", reads the `.validate` out of database.rules.json and asserts the
// client probes that same node. Change which node the predicate keys on and
// that test goes red rather than the client quietly probing the old one.
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

// M11. setFollowingEntryClearingRevocation sends the revocation clear and the
// following write as one multi-path update, and the whole fix rests on RTDB
// applying that update all-or-nothing against these rules. jest can only prove
// the client issues ONE update() call — whether a refusal on the userPrefs path
// also rolls back the revocations path is a property of the database, not of
// our code, so it is pinned here against the real rules engine.
describe('M11 — a refused following write must not clear the revocation', () => {
  const REVOKED = 'revocations/M/T';

  test('the atomic update is rejected whole: the revocation key survives', async () => {
    // T has no presence/code — the G6 guard refuses the userPrefs path. M is
    // mid-redemption and its own mailbox still holds T's revocation.
    await seed(env, (db) => db.ref(REVOKED).set(true));

    await assertFails(dbAs(env, 'M').ref().update({
      [REVOKED]: null,
      'userPrefs/M/following/T': ENTRY,
    }));

    // The key is what M's revocation watcher uses to prune a stale server-side
    // following/T entry. If the delete had landed while the guard refused the
    // write beside it, that prune signal would be gone — M11.
    const after = await dbAs(env, 'M').ref(REVOKED).get();
    expect(after.val()).toBe(true);
  });

  test('the same update succeeds whole once the followee exists', async () => {
    await seed(env, async (db) => {
      await db.ref(REVOKED).set(true);
      await db.ref('users/T/presence').set({ code: 'XK7P2M', status: 'unavailable', availableUntil: null });
    });

    await assertSucceeds(dbAs(env, 'M').ref().update({
      [REVOKED]: null,
      'userPrefs/M/following/T': ENTRY,
    }));

    // Both halves landed together — the watcher can never observe the new
    // following entry while the revocation key is still there, which is the
    // ordering invariant registerAsFollower documents, now held by
    // construction rather than by sequencing.
    const revocation = await dbAs(env, 'M').ref(REVOKED).get();
    expect(revocation.exists()).toBe(false);
    const entry = await dbAs(env, 'M').ref('userPrefs/M/following/T').get();
    expect(entry.val()).toEqual(ENTRY);
  });
});
