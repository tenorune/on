// functions/test/ops-restore.test.js — the restore path's decision table.
//
// restore-preimage.js undoes a purge from its pre-image dump, and every
// judgement it makes is a pure function precisely so it can be pinned here
// rather than discovered against live data. Three of these cases are
// regressions from a real recovery run on dev (2026-08-02): the nested-path
// collapse, the merge over a client's post-purge republish, and the
// group-enumeration repair working on a SECOND run.
import {
  classify,
  deepMergeOverLive,
  collapseRedundant,
  planRestore,
  enumerationCandidates,
  buildEnumerationRepair,
} from '../ops/restore-preimage.js';

const STROKES_MARKER = 'strokes not captured — canvases/*/strokes is unbounded and is never read or written by the ops audit dump';

describe('classify — what a dumped path is worth now', () => {
  test('a null in the dump means nothing was there before the purge either', () => {
    expect(classify('locations/T1', null, null).verdict).toBe('skip-absent');
  });

  test('a live value equal to the dump needs no write', () => {
    expect(classify('users/P2/followers/T1', true, true).verdict).toBe('already-there');
  });

  test('an empty path takes the captured value back', () => {
    const d = classify('users/P2/followers/T1', true, null);
    expect(d.verdict).toBe('restore');
    expect(d.write).toEqual(['users/P2/followers/T1', true]);
  });

  test('a path something else changed since the purge is a conflict, not an overwrite', () => {
    const d = classify('groups/g1/members/T1', { role: 'member' }, { role: 'owner' });
    expect(d.verdict).toBe('conflict');
    expect(d.write).toBeUndefined();
  });
});

describe('classify — canvases never replay the strokes marker', () => {
  const dumped = { bg: 'grid-dark', strokes: STROKES_MARKER };

  test('a canvas is skipped by default, because the dump holds a sentence where the drawing was', () => {
    const d = classify('canvases/T1_P2', dumped, null);
    expect(d.verdict).toBe('skip-canvas');
    expect(d.write).toBeUndefined();
  });

  test('--restore-canvas-bg writes the bg LEAF only, never the node', () => {
    const d = classify('canvases/T1_P2', dumped, null, { canvasBg: true });
    expect(d.write).toEqual(['canvases/T1_P2/bg', 'grid-dark']);
    expect(JSON.stringify(d.write)).not.toContain('strokes not captured');
  });

  test('a canvas that never existed has no bg to restore even with the flag', () => {
    const d = classify('canvases/P2_T1', { strokes: STROKES_MARKER }, null, { canvasBg: true });
    expect(d.verdict).toBe('skip-canvas');
  });

  test('a canvas that exists again is a conflict rather than a bg overwrite', () => {
    const d = classify('canvases/T1_P2', dumped, { bg: 'plain' }, { canvasBg: true });
    expect(d.verdict).toBe('conflict');
  });
});

describe('classify — transient families stay stale-free', () => {
  test.each([
    ['locations/T1', { lat: 1, lng: 2 }],
    ['locationCells/g1/T1', { cell: 'u10j4' }],
    ['knocks/T1', { k1: true }],
    ['calls/T1', { c1: true }],
  ])('%s is skipped by default', (path, dumped) => {
    expect(classify(path, dumped, null).verdict).toBe('skip-transient');
  });

  test('--restore-transient opts back in', () => {
    const d = classify('locations/T1', { lat: 1 }, null, { transient: true });
    expect(d.verdict).toBe('restore');
  });
});

describe('classify — a global index is never taken from whoever holds it', () => {
  test('a free index entry is restored', () => {
    expect(classify('codeIndex/ABC123', 'T1', null).verdict).toBe('restore');
  });

  test('an entry held by a DIFFERENT account is a conflict', () => {
    const d = classify('codeIndex/ABC123', 'T1', 'SOMEONE-ELSE', { uid: 'T1' });
    expect(d.verdict).toBe('conflict');
    expect(d.why).toContain('SOMEONE-ELSE');
  });

  test('a mapping re-stamped by the bootstrap at the SAME uid is left alone, not treated as a hijack', () => {
    // Telegram uids are deterministic, so reopening the Mini App re-points the
    // mapping at the same account with a newer linkedAt. The live value is the
    // fresher one; restoring the captured one would only lose the timestamp.
    const d = classify(
      'telegramUsers/5550001',
      { uid: 'T1', linkedAt: 100 },
      { uid: 'T1', linkedAt: 999 },
      { uid: 'T1' },
    );
    expect(d.verdict).toBe('already-there');
    expect(d.write).toBeUndefined();
  });
});

describe('classify — the account node a live client republished (the G3 case)', () => {
  // Measured on dev: revoking does not evict a session, so a client that was
  // open at purge time keeps writing for up to its ID token's remaining hour.
  // What it puts back is its cached SUBSET.
  const live = { following: { P2: true }, currentContext: 'gNew' };
  const dumped = { following: { P2: true, P3: true }, notify: { P2: true }, palette: { key: '#3a7' } };

  test('with no flag it refuses to choose for the operator', () => {
    const d = classify('userPrefs/T1', dumped, live);
    expect(d.verdict).toBe('conflict');
    expect(d.why).toContain('--merge-account');
  });

  test('--merge-account restores the captured values AND keeps what was written since', () => {
    const d = classify('userPrefs/T1', dumped, live, { mergeAccount: true });
    const value = /** @type {Record<string, unknown>} */ (d.write?.[1]);
    expect(value.following).toEqual({ P2: true, P3: true }); // the dump wins
    expect(value.notify).toEqual({ P2: true }); // only the dump had it
    expect(value.currentContext).toBe('gNew'); // only the live node had it
  });

  test('--replace-account drops what was written since, and says so', () => {
    const d = classify('userPrefs/T1', dumped, live, { replaceAccount: true });
    expect(d.write?.[1]).toEqual(dumped);
    expect(/** @type {Record<string, unknown>} */ (d.write?.[1]).currentContext).toBeUndefined();
  });
});

describe('deepMergeOverLive', () => {
  test('the dump wins at a leaf both sides hold', () => {
    expect(deepMergeOverLive({ a: 'live' }, { a: 'dump' })).toEqual({ a: 'dump' });
  });

  test('a branch only the live node has survives, at any depth', () => {
    const merged = deepMergeOverLive(
      { notify: { P9: true }, onlyLive: 1 },
      { notify: { P2: true } },
    );
    expect(merged).toEqual({ notify: { P9: true, P2: true }, onlyLive: 1 });
  });

  test('a non-object on either side is replaced outright rather than merged', () => {
    expect(deepMergeOverLive('live', { a: 1 })).toEqual({ a: 1 });
    expect(deepMergeOverLive({ a: 1 }, 'dump')).toBe('dump');
  });
});

describe('collapseRedundant — RTDB rejects an update naming a path and its descendant', () => {
  // A purged OWNER's write-set contains groups/{gid} (nulled wholesale) AND
  // groups/{gid}/members/{uid} (from the shared enumerator). The purge survives
  // it because rootUpdate drops the redundant nulls; a restore has to collapse
  // the same pair or the SDK refuses the whole payload. This reached a live run.
  test('the descendant folds into the ancestor, which keeps the other members', () => {
    const { writes, dropped } = collapseRedundant({
      'groups/g1': { members: { ANN: { role: 'owner' }, BOB: { role: 'member' } } },
      'groups/g1/members/ANN': { role: 'owner' },
    });
    expect(Object.keys(writes)).toEqual(['groups/g1']);
    expect(dropped).toEqual([{ path: 'groups/g1/members/ANN', under: 'groups/g1' }]);
    const g1 = /** @type {{ members: Record<string, unknown> }} */ (writes['groups/g1']);
    expect(g1.members.BOB).toEqual({ role: 'member' });
  });

  test('an unrelated pair of paths is left alone', () => {
    const { writes, dropped } = collapseRedundant({ 'groups/g1': 1, 'groups/g2': 2 });
    expect(Object.keys(writes)).toEqual(['groups/g1', 'groups/g2']);
    expect(dropped).toEqual([]);
  });

  test('values that DISAGREE are refused rather than silently collapsed', () => {
    expect(() => collapseRedundant({
      'groups/g1': { members: { ANN: { role: 'member' } } },
      'groups/g1/members/ANN': { role: 'owner' },
    })).toThrow(/disagree/);
  });
});

describe('planRestore over a purged owner\'s write-set', () => {
  const preImage = {
    'users/ANN': { groups: { DIVERS: true }, presence: { code: 'ABC' } },
    'userPrefs/ANN': { following: { BOB: true } },
    'groups/DIVERS': { name: 'Divers', ownerId: 'ANN', members: { ANN: { role: 'owner' }, BOB: { role: 'member' } } },
    'groups/DIVERS/members/ANN': { role: 'owner' },
    'locationCells/DIVERS': { ANN: { cell: 'u1' }, BOB: { cell: 'u2' } },
    'locationCells/DIVERS/ANN': { cell: 'u1' },
    'canvases/ANN_BOB': { bg: 'grid', strokes: STROKES_MARKER },
    'codeIndex/ABC': 'ANN',
  };
  const allEmpty = Object.fromEntries(Object.keys(preImage).map((p) => [p, null]));

  test('the payload never contains a path and its descendant', () => {
    const { writes } = planRestore(preImage, allEmpty, { uid: 'ANN' });
    const keys = Object.keys(writes);
    const nested = keys.filter((k) => keys.some((a) => a !== k && k.startsWith(`${a}/`)));
    expect(nested).toEqual([]);
  });

  test('a folded path is reported as folded, not silently dropped', () => {
    const { decisions } = planRestore(preImage, allEmpty, { uid: 'ANN' });
    const folded = decisions.find((d) => d.path === 'groups/DIVERS/members/ANN');
    expect(folded?.verdict).toBe('folded');
    expect(folded?.why).toContain('groups/DIVERS');
  });

  test('the transient families stay out, and the collapse still holds when they are opted in', () => {
    const off = planRestore(preImage, allEmpty, { uid: 'ANN' });
    expect(off.writes['locationCells/DIVERS']).toBeUndefined();

    const on = planRestore(preImage, allEmpty, { uid: 'ANN', transient: true });
    expect(on.writes['locationCells/DIVERS']).toBeDefined();
    const keys = Object.keys(on.writes);
    expect(keys.filter((k) => keys.some((a) => a !== k && k.startsWith(`${a}/`)))).toEqual([]);
  });

  test('no strokes marker ever reaches the payload', () => {
    const { writes } = planRestore(preImage, allEmpty, { uid: 'ANN', canvasBg: true, transient: true });
    expect(JSON.stringify(writes)).not.toContain('strokes not captured');
  });
});

describe('group-enumeration repair — the cascade no pre-image can hold', () => {
  // Purging an owner deletes groups/{gid} wholesale; each other member's client
  // then deletes its OWN users/{member}/groups/{gid} entry, because the owner
  // has no permission to. The purge never wrote that path, so it is not in the
  // dump, and a restored group is invisible in every other member's nav.
  const group = {
    name: 'Divers',
    ownerId: 'ANN',
    members: { ANN: { role: 'owner' }, BOB: { role: 'member' }, CAT: { role: 'member' } },
  };

  test('a member whose own account node is in the payload is excluded — it already carries its groups map', () => {
    const writes = { 'users/ANN': { groups: { DIVERS: true } }, 'groups/DIVERS': group };
    expect(enumerationCandidates({ 'groups/DIVERS': group }, writes))
      .toEqual(['users/BOB/groups/DIVERS', 'users/CAT/groups/DIVERS']);
  });

  test('candidates come from the LIVE group when an earlier run already restored it', () => {
    // The run an operator reaches for this on is the second one, where the
    // group is `already-there` and therefore absent from the payload. Deriving
    // candidates from the payload alone made the flag a silent no-op.
    expect(enumerationCandidates({ 'groups/DIVERS': group }, {})).toEqual([
      'users/ANN/groups/DIVERS',
      'users/BOB/groups/DIVERS',
      'users/CAT/groups/DIVERS',
    ]);
  });

  test('a group with no members yields nothing', () => {
    expect(enumerationCandidates({ 'groups/DIVERS': { name: 'Divers' } }, {})).toEqual([]);
  });

  test('an absent entry is rebuilt as `true`, the default shape', () => {
    const { writes } = buildEnumerationRepair(['users/BOB/groups/DIVERS'], { 'users/BOB/groups/DIVERS': null });
    expect(writes).toEqual({ 'users/BOB/groups/DIVERS': true });
  });

  test('an entry that still exists is never clobbered — it may hold lastVisited', () => {
    const { writes, skipped } = buildEnumerationRepair(
      ['users/CAT/groups/DIVERS'],
      { 'users/CAT/groups/DIVERS': { lastVisited: 1754000000000 } },
    );
    expect(writes).toEqual({});
    expect(skipped).toEqual(['users/CAT/groups/DIVERS']);
  });

  test('the repair does not reintroduce a nested-path pair', () => {
    const writes = { 'users/ANN': { groups: { DIVERS: true } }, 'groups/DIVERS': group };
    const candidates = enumerationCandidates({ 'groups/DIVERS': group }, writes);
    const repair = buildEnumerationRepair(candidates, {});
    const keys = Object.keys({ ...writes, ...repair.writes });
    expect(keys.filter((k) => keys.some((a) => a !== k && k.startsWith(`${a}/`)))).toEqual([]);
  });
});
