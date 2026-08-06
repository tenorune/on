// Does the expunge still reach every place an account lives?
//
// This is a GUARD, not a behaviour test. It exists because the same bug shipped
// four times in one week, each time as "a residue family nobody remembered":
//
//   G5   pushTokens/{uid}          F6c moved it out of userPrefs; the wholesale
//                                  userPrefs null had been deleting it for free
//   G7   groupIdIndex/{gid}        never referenced in functions/ at all
//   G7   inviteIndex/{token}       enumerated only from users/{uid}/invites, so
//                                  group-scoped tokens were invisible
//   —    inviteIndex shape         graduation overwrote the record with a uid
//
// Every one was found by running the panel against a live project and reading
// the integrity report. None was found by a review, and none by the test suite,
// because a test suite only checks the families someone thought to write a test
// for — which is the same blind spot that caused the bug.
//
// So this guard is deliberately driven by `database.rules.json` rather than by a
// list maintained here. The rules file is the canonical inventory of the data
// model's top level (its root `$other` is `.read:false/.write:false`, so a node
// that is not listed there is not reachable by a client at all). Adding a
// top-level node to that file IS what a schema change looks like — and this test
// fails until whoever added it says where the expunge stands on it.
//
// The classification is explicit rather than inferred from the wildcard name.
// Those names do not discriminate: the uid-keyed mailboxes are spelled
// `$recipient`, `$target`, `$invitee`, `$revoked`, `$requester`, and a heuristic
// keyed on `$uid` would silently skip five of them — exactly the failure mode
// this guard exists to prevent.
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeStoreDeps } from './store-deps.js';
import { buildExpungeWrites } from '../telegram-auth.js';

const RULES = JSON.parse(nodeFs.readFileSync(
  nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), '..', '..', 'database.rules.json'),
  'utf8',
)).rules;

// Nulled by buildExpungeWrites itself, at exactly `{node}/{uid}`.
const BY_EXPUNGE = [
  'users',
  'userPrefs',
  'pushTokens',
  'locations',
  'knocks',
  'calls',
  'followRequests',
  'followGrants',
  'pendingInvites',
  'revocations',
];

// Account data, but nulled by the CALLER through `extraNulls` rather than by the
// enumerator — the Telegram mapping teardown decides these, because whether a
// mapping may be torn down depends on who holds it (see buildMappingTeardown).
const BY_CALLER = {
  telegramUsers: 'keyed by tgId; torn down by the caller via extraNulls, and refused when another account holds the mapping',
  telegramByUid: 'the reverse index of the above, torn down in the same write',
};

// Account data the expunge DOES reach, but not at a `{node}/{uid}` path — so
// this test cannot assert on them by uid. Each is covered by its own case
// elsewhere; the file:line is the assertion that would catch a regression.
const NOT_UID_KEYED = {
  codeIndex: 'keyed by share code — nulled at codeIndex/{presence.code} (ops-expunge-build.test.js)',
  inviteIndex: 'keyed by token — nulled for the account\'s own invites AND every invite in a group it owned (ops-expunge-build.test.js)',
  groupIdIndex: 'keyed by gid — released for owned groups only (ops-expunge-build.test.js)',
  groups: 'keyed by gid — owned groups nulled wholesale, membership rows per-uid by the enumerator',
  pendingInvitesByGroup: 'keyed by gid — wholesale for owned groups, per-uid otherwise',
  locationCells: 'keyed by gid — wholesale for owned groups (other members\' cells included), per-uid otherwise',
  canvases: 'keyed by the uid PAIR — enumerated per peer by crossRefRenderers',
};

// Not account-scoped, so an expunge has nothing to do here.
const NOT_ACCOUNT_DATA = {
  notifierState: 'server-internal notifier bookkeeping, not keyed by account',
  telegramLinkTokens: 'short-lived link tokens; they expire on their own and carry no account residue',
  $other: 'the root catch-all that denies every unlisted node — not a node itself',
};

function fullySeeded(uid = 'DEAD') {
  return makeStoreDeps({
    [`users/${uid}`]: {
      presence: { code: 'DEAD01' },
      invites: { tok1: { redemptionsUsed: 0 } },
      followers: { peer: 'PEER01' },
      groups: { gMember: { lastVisited: 1 }, gOwned: { lastVisited: 2 } },
    },
    [`userPrefs/${uid}`]: { following: { peer: {} } },
    [`pushTokens/${uid}`]: { tokA: { lastSeen: 1 } },
    [`locations/${uid}`]: { lat: 1, lng: 2, updatedAt: 3 },
    [`knocks/${uid}`]: { k: 1 },
    [`calls/${uid}`]: { c: 1 },
    [`followRequests/${uid}`]: { r: 1 },
    [`followGrants/${uid}`]: { g: 1 },
    [`pendingInvites/${uid}`]: { gInvited: { from: 'x' } },
    [`revocations/${uid}`]: { v: 1 },
    'groups/gMember': { ownerId: 'other', members: { [uid]: { role: 'member' } } },
    'groups/gOwned': { ownerId: uid, members: { [uid]: { role: 'owner' } }, invites: { gtok: {} } },
  });
}

describe('expunge completeness — the guard that catches the NEXT relocation', () => {
  test('every top-level node in database.rules.json is classified', () => {
    const classified = new Set([
      ...BY_EXPUNGE,
      ...Object.keys(BY_CALLER),
      ...Object.keys(NOT_UID_KEYED),
      ...Object.keys(NOT_ACCOUNT_DATA),
    ]);

    const unclassified = Object.keys(RULES).filter((k) => !k.startsWith('.') && !classified.has(k));

    // If this fails you have added a top-level node. Decide where the expunge
    // stands on it and add it to exactly one of the four lists above — do not
    // reach for NOT_ACCOUNT_DATA to make the red go away.
    expect(unclassified).toEqual([]);
  });

  test('nothing is classified that the rules file does not have', () => {
    const known = new Set(Object.keys(RULES));
    const stale = [
      ...BY_EXPUNGE,
      ...Object.keys(BY_CALLER),
      ...Object.keys(NOT_UID_KEYED),
      ...Object.keys(NOT_ACCOUNT_DATA),
    ].filter((k) => !known.has(k));

    expect(stale).toEqual([]);
  });

  test('every own-account node is actually nulled at {node}/{uid}', async () => {
    const writes = await buildExpungeWrites(fullySeeded(), 'DEAD');

    const missed = BY_EXPUNGE.filter((node) => writes[`${node}/DEAD`] !== null);

    expect(missed).toEqual([]);
  });

  test('a caller-owned node is NOT nulled by the enumerator, so extraNulls stays load-bearing', async () => {
    const writes = await buildExpungeWrites(fullySeeded(), 'DEAD');

    for (const node of Object.keys(BY_CALLER)) {
      expect(writes[`${node}/DEAD`]).toBeUndefined();
    }
  });
});
