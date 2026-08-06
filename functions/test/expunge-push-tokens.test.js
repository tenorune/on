// pushTokens/{uid} — the family F6c relocated and the deletion path never
// followed.
//
// Push tokens used to live at userPrefs/{uid}/pushTokens, where expunge's
// wholesale `userPrefs/{uid}` null destroyed them for free. F6c moved them to a
// top-level owner-only node so watchUserPrefs would stop downloading them on
// every boot, and swept the three READERS (notifier.js, telegram.js,
// notifyChannel.ts — all dual-reading through the migration). Nothing swept the
// deleter, so buildExpungeWrites went on nulling two own-account nodes and
// stranding the third. Found on dev 2026-08-02 by the panel's integrity report
// (`push-tokens-dangling`) after a purge, which is the only tool that could
// have found it: the node is not in the purge's write-set, so it is not in the
// pre-image dump, so the residue sweep is structurally blind to it (G4).
//
// It reaches production, not just the panel: performLink calls
// expungeDerivedAccount on a standalone derived account (telegram-auth.js:210).
//
// These live in their own file rather than in telegram-auth.test.js: that suite
// has a 0-line diff across the ops-panel branch and is the standing proof the
// expungeDerivedAccount split preserved shipped behaviour. This is a deliberate
// behaviour CHANGE, so its coverage belongs beside it, not inside the
// invariant — same reasoning as crossref-locations.test.js.
//
// pushTokens/{uid} is the account's OWN top-level node, so it belongs beside
// users/{uid} and userPrefs/{uid}, NOT in crossRefRenderers. That enumerator
// renders paths under OTHER users' subtrees; routing this through it would also
// give the graduation walker move-semantics keyed off the wrong family.
import { makeStoreDeps } from './store-deps.js';
import { buildExpungeWrites, expungeDerivedAccount, graduateAccountData } from '../telegram-auth.js';

describe('buildExpungeWrites: the account\'s push tokens die with it', () => {
  test('the null-set clears pushTokens/{uid}', async () => {
    const deps = makeStoreDeps({
      'users/dead': { presence: { code: 'DEAD01' } },
      'userPrefs/dead': {},
      'pushTokens/dead': { tokenA: { lastSeen: 1 }, tokenB: { lastSeen: 2 } },
    });

    const writes = await buildExpungeWrites(deps, 'dead');

    expect(writes['pushTokens/dead']).toBeNull();
  });

  test('an account that never registered a token needs no special case', async () => {
    const deps = makeStoreDeps({ 'users/dead': {}, 'userPrefs/dead': {} });

    const writes = await buildExpungeWrites(deps, 'dead');

    expect(writes['pushTokens/dead']).toBeNull();
  });

  // Through the REAL apply path. buildExpungeWrites' raw output legitimately
  // contains ancestor/descendant pairs (an owned `groups/{gid}` plus the
  // enumerator's membership row under it); rootUpdate drops the redundant nulls
  // before the wire, which is what makes the single atomic update legal. Going
  // through deps.update directly would re-test that collapse and fail on it.
  test('a purged owner really loses the node, through expungeDerivedAccount', async () => {
    const deps = makeStoreDeps({
      'users/dead': { presence: { code: 'DEAD01' }, groups: { g1: { lastVisited: 1 } } },
      'userPrefs/dead': { following: {} },
      'groups/g1': { ownerId: 'dead', members: { dead: { role: 'owner' }, other: { role: 'member' } } },
      'pushTokens/dead': { tokenA: { lastSeen: 1 } },
    });

    await expungeDerivedAccount(deps, 'dead');

    expect(await deps.getVal('pushTokens/dead')).toBeNull();
  });

  test('the added path collides with nothing else in the write-set', async () => {
    const deps = makeStoreDeps({
      'users/dead': { presence: { code: 'DEAD01' }, groups: { g1: { lastVisited: 1 } } },
      'userPrefs/dead': { following: {} },
      'groups/g1': { ownerId: 'dead', members: { dead: { role: 'owner' } } },
      'pushTokens/dead': { tokenA: { lastSeen: 1 } },
    });

    const keys = Object.keys(await buildExpungeWrites(deps, 'dead'));
    const overlapping = keys.filter((k) => k !== 'pushTokens/dead'
      && (k.startsWith('pushTokens/dead/') || 'pushTokens/dead'.startsWith(`${k}/`)));

    expect(keys).toContain('pushTokens/dead');
    expect(overlapping).toEqual([]);
  });
});

describe('graduateAccountData: push tokens follow the account to its new uid', () => {
  const seed = () => makeStoreDeps({
    'users/old': { presence: { code: 'OLD001' } },
    'userPrefs/old': { following: {} },
    'pushTokens/old': { tokenA: { lastSeen: 1 }, tokenB: { lastSeen: 2 } },
  });

  test('the tokens arrive under the new uid, values intact', async () => {
    const deps = seed();

    await graduateAccountData(deps, 'old', 'new');

    expect(await deps.getVal('pushTokens/new')).toEqual({ tokenA: { lastSeen: 1 }, tokenB: { lastSeen: 2 } });
  });

  test('the old uid keeps nothing — a graduated account is not two registrations', async () => {
    const deps = seed();

    await graduateAccountData(deps, 'old', 'new');

    expect(await deps.getVal('pushTokens/old')).toBeNull();
  });

  test('an account with no tokens writes nothing for the family', async () => {
    const deps = makeStoreDeps({
      'users/old': { presence: { code: 'OLD001' } },
      'userPrefs/old': { following: {} },
    });

    await graduateAccountData(deps, 'old', 'new');

    expect(deps.store['pushTokens/new']).toBeUndefined();
    expect(deps.store['pushTokens/old']).toBeUndefined();
  });
});
