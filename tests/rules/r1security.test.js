// tests/rules/r1security.test.js
// R1 final security review — invite-redemption counter writes (C1/C2),
// users/{uid} read scoping (M1), and the non-member group-redeem read flow.
//
// EMULATOR LIMITATION NOTE (see gaps.test.js): RTDB emulator v4.11.2 mishandles
// data.child()/root.child() on DELETEs and child-path-writes evaluated at an
// ancestor rule. None of the cases below depend on that; the counter writes are
// direct writes at the counter leaf and the reads are plain gets. The rules are
// written to be correct for production Firebase regardless.
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs, seed } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

// ── C1: personal-invite redemption counter ───────────────────────────────────
// redeemPersonalInvite (redeemer, uid !== creator) calls incrementInviteRedemptions
// → runTransaction on users/{creator}/invites/{token}/redemptionsUsed.
describe('C1 personal-invite redemption counter', () => {
  beforeEach(async () => {
    await seed(env, (db) => db.ref('users/creator/invites/TOK').set({
      scope: 'personal', token: 'TOK', creatorUid: 'creator', redemptionsUsed: 0, revoked: false,
    }));
  });

  test('a redeemer (uid !== creator) CAN write the redemptionsUsed counter', async () => {
    await assertSucceeds(dbAs(env, 'redeemer').ref('users/creator/invites/TOK/redemptionsUsed').set(1));
  });

  test('a redeemer CANNOT write other invite fields', async () => {
    await assertFails(dbAs(env, 'redeemer').ref('users/creator/invites/TOK/revoked').set(true));
    await assertFails(dbAs(env, 'redeemer').ref('users/creator/invites/TOK/redemptionCap').set(0));
  });

  test('a redeemer CANNOT write the creator presence subtree', async () => {
    await assertFails(dbAs(env, 'redeemer').ref('users/creator/presence/status').set('available'));
  });

  test('the creator can still write the whole invite (owner write intact)', async () => {
    await assertSucceeds(dbAs(env, 'creator').ref('users/creator/invites/TOK').set({
      scope: 'personal', token: 'TOK', creatorUid: 'creator', redemptionsUsed: 5, revoked: true,
    }));
  });
});

// ── M1: users/{uid} read scoping ─────────────────────────────────────────────
describe('M1 users/{uid} read scoping', () => {
  beforeEach(async () => {
    await seed(env, async (db) => {
      await db.ref('users/B/presence').set({ code: 'CODE-B', status: 'available' });
      await db.ref('users/B/invites/TOKB').set({ scope: 'personal', token: 'TOKB', creatorUid: 'B', revoked: false });
      await db.ref('users/B/groups/G1').set({ lastVisited: 1 });
      await db.ref('users/B/followers/someone').set('their-code');
    });
  });

  test('a non-owner CAN read users/{B}/presence', async () => {
    await assertSucceeds(dbAs(env, 'A').ref('users/B/presence').get());
    await assertSucceeds(dbAs(env, 'A').ref('users/B/presence/code').get());
  });

  test('a non-owner CAN read a specific users/{B}/invites/{token} (per-token)', async () => {
    await assertSucceeds(dbAs(env, 'A').ref('users/B/invites/TOKB').get());
  });

  test('a non-owner CANNOT enumerate users/{B}/invites (collection read blocked)', async () => {
    await assertFails(dbAs(env, 'A').ref('users/B/invites').get());
  });

  test('a non-owner CANNOT read users/{B}/groups or users/{B}/followers', async () => {
    await assertFails(dbAs(env, 'A').ref('users/B/groups').get());
    await assertFails(dbAs(env, 'A').ref('users/B/followers').get());
  });

  test('a non-owner CANNOT read the whole users/{B} node', async () => {
    await assertFails(dbAs(env, 'A').ref('users/B').get());
  });

  test('the owner CAN still read their own whole node', async () => {
    await assertSucceeds(dbAs(env, 'B').ref('users/B').get());
  });
});

// ── C2 + group-redeem non-member read flow ───────────────────────────────────
// redeemGroupInvite (non-member) now uses readGroupInvite(groupId, token)
// (single-token read) instead of readGroupInvites(groupId) (whole collection),
// so the rule is per-token, not collection-level — symmetric with personal invites.
// then writeMember(self), writeUserGroupsEntry(self), and
//   incrementGroupInviteRedemptions → groups/{gid}/invites/{token}/redemptionsUsed (C2).
describe('C2 + group-redeem non-member read flow', () => {
  beforeEach(async () => {
    await seed(env, async (db) => {
      await db.ref('groups/G1').set({
        name: 'Family',
        ownerId: 'owner',
        members: { owner: { role: 'owner', displayName: 'O' } },
        invites: { TOKG: { scope: 'group', token: 'TOKG', creatorUid: 'owner', redemptionsUsed: 0, revoked: false } },
      });
    });
  });

  test('a non-member joiner CAN read groups/{G}/name (preview) but NOT the whole node', async () => {
    await assertSucceeds(dbAs(env, 'joiner').ref('groups/G1/name').get());
    await assertFails(dbAs(env, 'joiner').ref('groups/G1').get());
  });

  test('a non-member joiner CANNOT enumerate groups/{G}/invites (collection read blocked — M1-class leak)', async () => {
    await assertFails(dbAs(env, 'joiner').ref('groups/G1/invites').get());
  });

  test('a non-member joiner CAN read a specific groups/{G}/invites/{token} (per-token read)', async () => {
    await assertSucceeds(dbAs(env, 'joiner').ref('groups/G1/invites/TOKG').get());
  });

  test('a non-member joiner CAN probe their OWN membership row', async () => {
    await assertSucceeds(dbAs(env, 'joiner').ref('groups/G1/members/joiner').get());
  });

  test('a non-member joiner CANNOT read the full member list', async () => {
    await assertFails(dbAs(env, 'joiner').ref('groups/G1/members').get());
  });

  test('a non-member joiner CANNOT read another member\'s row', async () => {
    await assertFails(dbAs(env, 'joiner').ref('groups/G1/members/owner').get());
  });

  test('a non-member joiner CANNOT self-join directly (join only via callable); CANNOT bump redemptionsUsed even as a member (Fix B)', async () => {
    // Self-join at the rules level is now blocked (Fix 2c); clients must use the joinGroup callable (Admin SDK).
    await assertFails(dbAs(env, 'joiner').ref('groups/G1/members/joiner').set({ role: 'member', displayName: 'J', joinedAt: 1 }));
    // Fix B: the redemption counter bump is now owner-only at the rules level.
    // The legitimate bump moved server-side to the joinGroup callable (Admin
    // SDK, bypasses rules) — a member (even one added via that callable) can
    // no longer walk the counter from the client. This inverts the old C2
    // assertion, which is exactly the behavior Fix B outlaws.
    await seed(env, async (db) => {
      await db.ref('groups/G1/members/joiner').set({ role: 'member', displayName: 'J', joinedAt: 1 });
    });
    await assertFails(dbAs(env, 'joiner').ref('groups/G1/invites/TOKG/redemptionsUsed').set(1));
  });

  test('a true outsider (no member row, after join not happening) still cannot read the member list', async () => {
    await assertFails(dbAs(env, 'outsider').ref('groups/G1/members').get());
  });
});
