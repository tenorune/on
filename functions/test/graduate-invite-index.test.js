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
