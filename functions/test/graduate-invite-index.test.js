// inviteIndex/{token} after a rename — graduation's third shape.
//
// `claimInviteToken` (js/db/social.ts:44-54) writes
// `{ scope, ownerPath, ownerUid }`, and `database.rules.json:56` validates that
// `ownerPath` and `ownerUid` are present. Three writers had drifted to three
// different shapes:
//
//   claimInviteToken     { scope, ownerPath, ownerUid }   preview works
//   merge.js:256         { ownerPath, ownerUid }          no scope → preview breaks
//   graduateAccountData  newUid (a bare STRING)           breaks preview AND the schema
//
// `resolveInvitePreviewHandler` (functions/invites.js:27,35) branches on
// `index.scope` and returns `{ preview: null }` for anything else, so both of the
// broken shapes silently kill the invite's welcome-screen framing. Graduation's
// also violates the rules — it lands only because the Admin SDK bypasses them.
// The bare-uid line looks like `codeIndex/{code} = newUid` on the line above
// being copied onto an index with a different shape.
//
// Found 2026-08-02 while fixing G7. Coverage lives here rather than in
// telegram-auth.test.js because this is a deliberate behaviour change; that
// suite's assertion on the old value had to change with it, which is the first
// break in its 0-line diff and is recorded in docs/HANDOFF.md.
import { makeStoreDeps } from './store-deps.js';
import { graduateAccountData } from '../telegram-auth.js';

const OLD = 'oldderiveduid00000000000000000ab';
const NEW = 'phraseuid000000000000000000000ab';

function seeded() {
  return makeStoreDeps({
    [`users/${OLD}`]: {
      presence: { code: 'DERV01' },
      invites: { TOK1: { scope: 'personal', creatorLabel: 'Ada' } },
    },
    [`userPrefs/${OLD}`]: {},
    'codeIndex/DERV01': OLD,
    'inviteIndex/TOK1': { scope: 'personal', ownerPath: `users/${OLD}/invites/TOK1`, ownerUid: OLD },
  });
}

describe('graduateAccountData: the invite index survives the rename intact', () => {
  test('the entry keeps the documented shape instead of being replaced by a uid', async () => {
    const deps = seeded();

    await graduateAccountData(deps, OLD, NEW);

    expect(deps.store['inviteIndex/TOK1']).toEqual({
      scope: 'personal',
      ownerPath: `users/${NEW}/invites/TOK1`,
      ownerUid: NEW,
    });
  });

  test('scope survives, so the welcome screen can still frame the invite', async () => {
    const deps = seeded();

    await graduateAccountData(deps, OLD, NEW);

    // functions/invites.js:27 — anything that is not 'personal' or 'group'
    // resolves to no preview at all.
    expect(deps.store['inviteIndex/TOK1'].scope).toBe('personal');
  });

  test('ownerUid follows the account, so the new owner can still release the token', async () => {
    const deps = seeded();

    await graduateAccountData(deps, OLD, NEW);

    // database.rules.json:55 scopes index DELETION to ownerUid — left at the old
    // uid, the graduated account could never release its own token.
    expect(deps.store['inviteIndex/TOK1'].ownerUid).toBe(NEW);
  });

  test('codeIndex is untouched by this — it really is a bare uid', async () => {
    const deps = seeded();

    await graduateAccountData(deps, OLD, NEW);

    expect(deps.store['codeIndex/DERV01']).toBe(NEW);
  });

  // Variant A, hijack form: presence/code is the account's own field, but
  // codeIndex/{code} is authoritative for ownership. An account that planted a
  // VICTIM's live code in its own presence would, on graduation, repoint
  // codeIndex/{victimCode} to the new uid under the Admin SDK — stealing the
  // victim's code so contacts scanning it reach the graduate. Repoint only when
  // the entry actually belongs to the account graduating.
  test('does NOT repoint a codeIndex entry the account does not own (Variant A hijack)', async () => {
    const deps = makeStoreDeps({
      [`users/${OLD}`]: { presence: { code: 'VICT01' } }, // planted a victim's code
      [`userPrefs/${OLD}`]: {},
      'codeIndex/VICT01': 'victim', // authoritative: the entry belongs to the victim
    });

    await graduateAccountData(deps, OLD, NEW);

    expect(deps.store['codeIndex/VICT01']).toBe('victim'); // NOT repointed to NEW
  });

  // The same Variant A shape as the codeIndex case directly above, on the index
  // one line below it. `users/{uid}/invites` is the account's OWN subtree and
  // the rules validate nothing about the token KEY (database.rules.json:32-38),
  // so a holder can plant a victim's live token there. This repoint runs under
  // the Admin SDK, where the rule that forbids overwriting an existing
  // inviteIndex entry does not apply — so an unconditional repoint hands the
  // victim's still-circulating invite link to the graduating account, and
  // `ownerUid` then locks the victim out of releasing it.
  test('does NOT repoint an inviteIndex entry the account does not own (Variant A hijack)', async () => {
    const victimEntry = { scope: 'personal', ownerPath: 'users/victim/invites/VICTTOK', ownerUid: 'victim' };
    const deps = makeStoreDeps({
      [`users/${OLD}`]: {
        presence: { code: 'DERV01' },
        invites: { VICTTOK: { scope: 'personal', creatorLabel: 'planted' } },
      },
      [`userPrefs/${OLD}`]: {},
      'codeIndex/DERV01': OLD,
      'inviteIndex/VICTTOK': victimEntry,
    });

    await graduateAccountData(deps, OLD, NEW);

    expect(deps.store['inviteIndex/VICTTOK']).toEqual(victimEntry);
  });

  // A LEGACY entry is a bare uid string — the broken shape this very file
  // exists to have fixed, and one that is still sitting in any project that ran
  // the old graduation. Ownership is readable from it (the string IS the owner),
  // so the guard must read it rather than treat the missing `ownerUid` as
  // "not mine" and strand the token forever. Its own control is the test below:
  // a legacy string naming the VICTIM must still be refused, so the
  // normalization cannot degrade into "a string is always ours".
  test('repoints a LEGACY bare-uid entry this account owns', async () => {
    const deps = makeStoreDeps({
      [`users/${OLD}`]: { presence: { code: 'DERV01' }, invites: { TOK1: { scope: 'personal' } } },
      [`userPrefs/${OLD}`]: {},
      'codeIndex/DERV01': OLD,
      'inviteIndex/TOK1': OLD, // legacy bare string, owned by this account
    });

    await graduateAccountData(deps, OLD, NEW);

    expect(deps.store['inviteIndex/TOK1']).toEqual({
      scope: 'personal',
      ownerPath: `users/${NEW}/invites/TOK1`,
      ownerUid: NEW,
    });
  });

  test('does NOT repoint a LEGACY bare-uid entry owned by someone else', async () => {
    const deps = makeStoreDeps({
      [`users/${OLD}`]: { presence: { code: 'DERV01' }, invites: { VICTTOK: { scope: 'personal' } } },
      [`userPrefs/${OLD}`]: {},
      'codeIndex/DERV01': OLD,
      'inviteIndex/VICTTOK': 'victim', // legacy bare string, owned by the victim
    });

    await graduateAccountData(deps, OLD, NEW);

    expect(deps.store['inviteIndex/VICTTOK']).toBe('victim');
  });

  // The control for the guard above: an entry the account DOES own must still
  // follow the rename, or graduation strands every legitimate invite link.
  test('still repoints an entry the account does own', async () => {
    const deps = seeded();

    await graduateAccountData(deps, OLD, NEW);

    expect(deps.store['inviteIndex/TOK1'].ownerUid).toBe(NEW);
  });

  test('an account with no invites writes no index entries', async () => {
    const deps = makeStoreDeps({
      [`users/${OLD}`]: { presence: { code: 'DERV01' } },
      [`userPrefs/${OLD}`]: {},
      'codeIndex/DERV01': OLD,
    });

    await graduateAccountData(deps, OLD, NEW);

    expect(Object.keys(deps.store).filter((k) => k.startsWith('inviteIndex/'))).toEqual([]);
  });
});
