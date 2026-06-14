// tests/rules/validation.test.js — R1.5 field .validate hardening (#179, S1/S2/S4).
// Each path asserts BOTH that a legitimate client write is still accepted and
// that garbage / forged / unbounded writes are rejected.
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs, seed } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

describe('knocks/$r/$s — count cap + shape', () => {
  test('accepts a legit knock (count 1..5, ts, optional 8-char contextGroupId)', async () => {
    await assertSucceeds(dbAs(env, 'me').ref('knocks/you/me').set({ count: 1, ts: 1 }));
    await assertSucceeds(dbAs(env, 'me').ref('knocks/you/me').set({ count: 5, ts: 2, contextGroupId: 'ABCD1234' }));
  });
  test('rejects count outside 1..5 (client cap was advisory; rules now enforce it)', async () => {
    await assertFails(dbAs(env, 'me').ref('knocks/you/me').set({ count: 0, ts: 1 }));
    await assertFails(dbAs(env, 'me').ref('knocks/you/me').set({ count: 6, ts: 1 }));
    await assertFails(dbAs(env, 'me').ref('knocks/you/me').set({ count: 9e9, ts: 1 }));
    await assertFails(dbAs(env, 'me').ref('knocks/you/me').set({ count: 'x', ts: 1 }));
  });
  test('rejects missing required fields, unknown fields, and forged contextGroupId', async () => {
    await assertFails(dbAs(env, 'me').ref('knocks/you/me').set({ count: 1 }));               // no ts
    await assertFails(dbAs(env, 'me').ref('knocks/you/me').set({ count: 1, ts: 1, evil: 'x' })); // extra field
    await assertFails(dbAs(env, 'me').ref('knocks/you/me').set({ count: 1, ts: 1, contextGroupId: 'lower123' }));
    await assertFails(dbAs(env, 'me').ref('knocks/you/me').set({ count: 1, ts: 1, contextGroupId: 'TOOLONG99' }));
  });
});

describe('invites redemptionsUsed — monotonic counter', () => {
  test('accepts creation (0) and a +1 redemption increment', async () => {
    await assertSucceeds(dbAs(env, 'u2').ref('users/u1/invites/tok/redemptionsUsed').set(1)); // absent -> 1
    await seed(env, (db) => db.ref('users/u1/invites/tok/redemptionsUsed').set(1));
    await assertSucceeds(dbAs(env, 'u2').ref('users/u1/invites/tok/redemptionsUsed').set(2)); // redeemer 1 -> 2
    await assertSucceeds(dbAs(env, 'u1').ref('users/u1/invites/tok/redemptionsUsed').set(0)); // owner may reset/create
  });
  test('rejects a jump that would falsely exhaust the cap (DoS) or garbage', async () => {
    await seed(env, (db) => db.ref('users/u1/invites/tok/redemptionsUsed').set(1));
    await assertFails(dbAs(env, 'u2').ref('users/u1/invites/tok/redemptionsUsed').set(9999)); // 1 -> 9999
    await assertFails(dbAs(env, 'u2').ref('users/u1/invites/tok/redemptionsUsed').set(3));    // skips 2
    await assertFails(dbAs(env, 'u2').ref('users/u1/invites/tok/redemptionsUsed').set(0));    // non-owner cannot reset
    await assertFails(dbAs(env, 'u2').ref('users/u1/invites/tok/redemptionsUsed').set('x'));  // not a number
  });
  test('group invite redemptionsUsed enforces the same +1 rule', async () => {
    await seed(env, (db) => db.ref('groups/G/invites/tok/redemptionsUsed').set(2));
    await assertSucceeds(dbAs(env, 'u2').ref('groups/G/invites/tok/redemptionsUsed').set(3));
    await assertFails(dbAs(env, 'u2').ref('groups/G/invites/tok/redemptionsUsed').set(100));
  });
});

describe('users/$uid/followers/$f — bounded code string', () => {
  test('accepts a short code string; rejects non-string / oversized', async () => {
    await assertSucceeds(dbAs(env, 'me').ref('users/you/followers/me').set('XK7P2M'));
    await assertFails(dbAs(env, 'me').ref('users/you/followers/me').set(123));
    await assertFails(dbAs(env, 'me').ref('users/you/followers/me').set('x'.repeat(17)));
  });
});

describe('calls/$uid — shape', () => {
  test('accepts the caller and callee ring writes', async () => {
    await assertSucceeds(dbAs(env, 'me').ref('calls/me').set({ to: 'you', ts: 1 }));        // own node
    await assertSucceeds(dbAs(env, 'me').ref('calls/you').set({ from: 'me', ts: 1 }));        // ring the peer
    await assertSucceeds(dbAs(env, 'me').ref('calls/you').set({ from: 'me', ts: 1, answered: true }));
  });
  test('rejects missing ts, unknown fields, and non-boolean answered', async () => {
    await assertFails(dbAs(env, 'me').ref('calls/me').set({ to: 'you' }));                    // no ts
    await assertFails(dbAs(env, 'me').ref('calls/me').set({ to: 'you', ts: 1, evil: 'x' }));  // extra field
    await assertFails(dbAs(env, 'me').ref('calls/me').set({ to: 'you', ts: 1, answered: 'yes' }));
  });
});

describe('sender-identity mailboxes — no-forge + shape', () => {
  test('revocations: value must be true', async () => {
    await assertSucceeds(dbAs(env, 'me').ref('revocations/you/me').set(true));
    await assertFails(dbAs(env, 'me').ref('revocations/you/me').set('x'));
    await assertFails(dbAs(env, 'me').ref('revocations/you/me').set(false));
  });

  test('followRequests: from is bound to the requester key; shape enforced', async () => {
    await assertSucceeds(dbAs(env, 'me').ref('followRequests/you/me').set({ from: 'me', groupId: 'GRP12345', ts: 1 }));
    await assertFails(dbAs(env, 'me').ref('followRequests/you/me').set({ from: 'someoneElse', groupId: 'G', ts: 1 }));
    await assertFails(dbAs(env, 'me').ref('followRequests/you/me').set({ from: 'me', ts: 1, evil: 'x' }));
    await assertFails(dbAs(env, 'me').ref('followRequests/you/me').set({ from: 'me' })); // no ts
  });

  test('followGrants: from is bound to the approving target key', async () => {
    await assertSucceeds(dbAs(env, 'me').ref('followGrants/req/me').set({ from: 'me', code: 'XK7P2M', name: 'Al', ts: 1 }));
    await assertSucceeds(dbAs(env, 'me').ref('followGrants/req/me').set({ from: 'me', code: 'XK7P2M', ts: 1 })); // name optional
    await assertFails(dbAs(env, 'me').ref('followGrants/req/me').set({ from: 'forged', code: 'XK7P2M', ts: 1 }));
    await assertFails(dbAs(env, 'me').ref('followGrants/req/me').set({ from: 'me', code: 'XK7P2M', ts: 1, evil: 1 }));
  });

  test('pendingInvites: member can write {from,ts}; extra fields rejected', async () => {
    await seed(env, (db) => db.ref('groups/G/members/me').set(true));
    await assertSucceeds(dbAs(env, 'me').ref('pendingInvites/invitee/G').set({ from: 'me', ts: 1 }));
    await assertFails(dbAs(env, 'me').ref('pendingInvites/invitee/G').set({ from: 'me', ts: 1, evil: 'x' }));
    await assertFails(dbAs(env, 'me').ref('pendingInvites/invitee/G').set({ from: 'me' })); // no ts
  });

  test('pendingInvitesByGroup: value must be true', async () => {
    await seed(env, (db) => db.ref('groups/G/members/me').set(true));
    await assertSucceeds(dbAs(env, 'me').ref('pendingInvitesByGroup/G/invitee').set(true));
    await assertFails(dbAs(env, 'me').ref('pendingInvitesByGroup/G/invitee').set({ junk: 1 }));
  });
});

describe('users/$uid/presence — field shape (Increment 2)', () => {
  test('accepts a legit presence object and field updates', async () => {
    await assertSucceeds(dbAs(env, 'u1').ref('users/u1/presence').set({ code: 'XK7P2M', status: 'available', availableUntil: 123 }));
    await assertSucceeds(dbAs(env, 'u1').ref('users/u1/presence/lastSeen').set(456));
    await assertSucceeds(dbAs(env, 'u1').ref('users/u1/presence/statusColor').set('#a855f7'));
    await assertSucceeds(dbAs(env, 'u1').ref('users/u1/presence/paletteKey').set('default'));
    await assertSucceeds(dbAs(env, 'u1').ref('users/u1/presence/availableUntil').set(null)); // clear
  });
  test('rejects oversized / wrong-typed fields (notifier reads code; clients render status/color)', async () => {
    await assertFails(dbAs(env, 'u1').ref('users/u1/presence/code').set('x'.repeat(33)));
    await assertFails(dbAs(env, 'u1').ref('users/u1/presence/status').set('x'.repeat(20)));
    await assertFails(dbAs(env, 'u1').ref('users/u1/presence/statusColor').set('x'.repeat(65)));
    await assertFails(dbAs(env, 'u1').ref('users/u1/presence/availableUntil').set('soon'));
    await assertFails(dbAs(env, 'u1').ref('users/u1/presence/lastSeen').set('now'));
  });
});

describe('groups/$gid meta — field shape (Increment 2)', () => {
  test('accepts a legit group create + rename by the owner', async () => {
    await assertSucceeds(dbAs(env, 'owner').ref('groups/G').set({ name: 'Family', ownerId: 'owner', createdAt: 1 }));
    await assertSucceeds(dbAs(env, 'owner').ref('groups/G/name').set('Divers'));
  });
  test('rejects an oversized name / non-numeric createdAt', async () => {
    await seed(env, (db) => db.ref('groups/G').set({ name: 'Family', ownerId: 'owner', createdAt: 1 }));
    await assertFails(dbAs(env, 'owner').ref('groups/G/name').set('x'.repeat(65)));
    await assertFails(dbAs(env, 'owner').ref('groups/G/createdAt').set('yesterday'));
  });
});

describe('inviteIndex — owner-scoped create/release (S4)', () => {
  test('a creator claims a token stamping their own uid; cannot stamp another user', async () => {
    await assertSucceeds(dbAs(env, 'owner').ref('inviteIndex/tok').set({ scope: 'personal', ownerPath: 'users/owner/invites/tok', ownerUid: 'owner' }));
    // forging someone else's ownerUid is rejected
    await assertFails(dbAs(env, 'attacker').ref('inviteIndex/tok2').set({ scope: 'personal', ownerPath: 'users/owner/invites/tok2', ownerUid: 'owner' }));
  });
  test('only the owner may release (delete) the index entry — a link recipient cannot', async () => {
    await seed(env, (db) => db.ref('inviteIndex/tok').set({ scope: 'personal', ownerPath: 'users/owner/invites/tok', ownerUid: 'owner' }));
    await assertFails(dbAs(env, 'recipient').ref('inviteIndex/tok').remove()); // knows the token (had the link) but isn't the owner
    await assertSucceeds(dbAs(env, 'owner').ref('inviteIndex/tok').remove());
  });
  test('legacy entries without ownerUid stay deletable (back-compat — no migration needed)', async () => {
    await seed(env, (db) => db.ref('inviteIndex/legacy').set({ scope: 'personal', ownerPath: 'users/x/invites/legacy' }));
    await assertSucceeds(dbAs(env, 'anyone').ref('inviteIndex/legacy').remove());
  });
});
