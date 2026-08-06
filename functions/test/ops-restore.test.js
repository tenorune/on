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
  summarizeResidue,
  summarizeRepublished,
  opGuard,
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

// The residue sweep — smoke-test step 9's least-observed leg.
//
// The purge's location families are the ones this branch changed most recently
// (crossRefRenderers gained locations/{u} and locationCells/{gid}/{u} in
// 4dea508, and buildExpungeWrites nulls an OWNED group's locationCells/{gid}
// wholesale), and nothing has ever watched them die on a live project. The
// restore's dry run reads every dumped path as it stands now, so it already
// holds the answer — it just used to throw it away at the transient branch and
// report a flat "skipped". These pin the reporting; the restore PAYLOAD is
// unchanged, which is what the verdict assertions below are for.
describe('residue sweep — what the transient branch now reports', () => {
  test('a transient path that is empty now reports its residue gone', () => {
    const d = classify('locations/T1', { lat: 1, lng: 2 }, null);
    expect(d.verdict).toBe('skip-transient');
    expect(d.residue).toBe('gone');
  });

  test('a transient path that still holds data reports residue present', () => {
    const d = classify('locations/T1', { lat: 1, lng: 2 }, { lat: 9, lng: 9 });
    expect(d.verdict).toBe('skip-transient');
    expect(d.residue).toBe('present');
  });

  test("an owned group's whole cells node names the members whose cells survived", () => {
    const dumped = { T1: { cell: 'u10j4' }, CAT: { cell: 'u10j5' }, ANN: { cell: 'u10j6' } };
    const d = classify('locationCells/DIVERS', dumped, { CAT: { cell: 'u10j5' }, ANN: { cell: 'u10j6' } });
    expect(d.residue).toBe('present');
    expect(d.holds).toEqual(['CAT', 'ANN']);
  });

  test('a non-transient path carries no residue field, so the sweep cannot be polluted by it', () => {
    const d = classify('users/T1', { name: 'x' }, null);
    expect(d.residue).toBeUndefined();
  });

  test('--restore-transient still turns an empty path into a restore, and claims no residue', () => {
    const d = classify('locations/T1', { lat: 1 }, null, { transient: true });
    expect(d.verdict).toBe('restore');
    expect(d.residue).toBeUndefined();
  });

  test('the findings survive planRestore into the decision rows', () => {
    const preImage = { 'locations/T1': { lat: 1 }, 'locationCells/DIVERS/T1': { cell: 'u10j4' } };
    const { decisions } = planRestore(preImage, { 'locations/T1': { lat: 9 } });
    expect(decisions.find((d) => d.path === 'locations/T1')?.residue).toBe('present');
    expect(decisions.find((d) => d.path === 'locationCells/DIVERS/T1')?.residue).toBe('gone');
  });

  test('a sweep with every family empty is clean', () => {
    const { decisions } = planRestore(
      { 'locations/T1': { lat: 1 }, 'locationCells/DIVERS/T1': { cell: 'u10j4' }, 'users/T1': { name: 'x' } },
      {},
    );
    expect(summarizeResidue(decisions)).toEqual({ swept: 2, clean: true, present: [] });
  });

  test('a sweep naming the paths that still hold data is not clean', () => {
    const { decisions } = planRestore(
      { 'locations/T1': { lat: 1 }, 'locationCells/DIVERS': { T1: { cell: 'u10j4' }, CAT: { cell: 'u10j5' } } },
      { 'locationCells/DIVERS': { CAT: { cell: 'u10j5' } } },
    );
    const summary = summarizeResidue(decisions);
    expect(summary.clean).toBe(false);
    expect(summary.swept).toBe(2);
    expect(summary.present).toEqual([{ path: 'locationCells/DIVERS', holds: ['CAT'] }]);
  });
});

// Peer republish (G6) — what `already-there` means on someone else's node.
//
// Device-observed on dev 2026-08-02. A purge nulled `userPrefs/{M}/following/{T}`
// as part of its 36-path atomic update; the audit log recorded `outcome: ok`,
// and the value was live again afterwards, byte-identical to the capture. No
// Cloud Function writes `following/` — every reference in functions/ is a read —
// and `userPrefs/$uid` is owner-only write (database.rules.json:6), so the only
// possible writer was M's own client, replaying its cache inside the G3 token
// window.
//
// The verdict was `already-there`, whose wording ("the live value already matches
// the dump") reads as benign — nothing to do. On a peer's node after a purge it
// means the opposite, and the damage is PERMANENT: the entry points at a uid that
// no longer exists and nothing will ever delete it again.
//
// Scoped deliberately to `users/{other}/**` and `userPrefs/{other}/**`. Those are
// owner-only in the rules, so an identical value there has exactly one possible
// author. A group node is not claimed, because an owner can write another
// member's row and the attribution would be a guess.
describe('classify — an already-there on a peer\'s node is a republish, not a no-op', () => {
  test('an identical value under another account\'s prefs is attributed to that peer', () => {
    const d = classify('userPrefs/M/following/T', { code: 'T00001', label: '' }, { code: 'T00001', label: '' }, { uid: 'T' });

    expect(d.verdict).toBe('already-there');
    expect(d.republishedBy).toBe('M');
  });

  test('the same under another account\'s users node', () => {
    const d = classify('users/M/followers/T', 'T00001', 'T00001', { uid: 'T' });

    expect(d.republishedBy).toBe('M');
  });

  test('the purged account\'s OWN node is not attributed to a peer', () => {
    const d = classify('userPrefs/T', { a: 1 }, { a: 1 }, { uid: 'T' });

    expect(d.verdict).toBe('already-there');
    expect(d.republishedBy).toBeUndefined();
  });

  test('a group node is not claimed — an owner can write another member\'s row', () => {
    const d = classify('groups/g1/members/T', { role: 'member' }, { role: 'member' }, { uid: 'T' });

    expect(d.republishedBy).toBeUndefined();
  });

  test('a peer node whose value DIFFERS is still a conflict, not a republish', () => {
    const d = classify('userPrefs/M/following/T', { code: 'T00001', label: '' }, { code: 'ZZZZZZ', label: 'x' }, { uid: 'T' });

    expect(d.verdict).toBe('conflict');
    expect(d.republishedBy).toBeUndefined();
  });

  test('planRestore carries the attribution, and summarizeRepublished collects it', () => {
    const preImage = {
      'userPrefs/M/following/T': { code: 'T00001', label: '' },
      'users/N/followers/T': 'T00001',
      'userPrefs/T': { a: 1 },
    };
    const live = {
      'userPrefs/M/following/T': { code: 'T00001', label: '' },
      'users/N/followers/T': 'T00001',
      'userPrefs/T': { a: 1 },
    };

    const { decisions } = planRestore(preImage, live, { uid: 'T' });

    expect(summarizeRepublished(decisions)).toEqual([
      { path: 'userPrefs/M/following/T', by: 'M' },
      { path: 'users/N/followers/T', by: 'N' },
    ]);
  });

  test('a clean purge yields no republish findings', () => {
    const { decisions } = planRestore({ 'userPrefs/M/following/T': { code: 'T00001' } }, {}, { uid: 'T' });

    expect(summarizeRepublished(decisions)).toEqual([]);
  });
});

// --- M9: the dump's `op` was read, printed, and never checked ---------------
//
// Every judgement in this module rests on "a purge NULLED every path in its
// write-set" (restore-preimage.js:204). That is false for a MERGE, whose
// write-set is mostly non-null carries onto the survivor — so the verdicts, the
// RESIDUE SWEEP and the PEER REPUBLISH block would all be built on an assumption
// that does not hold, and the `restore` verdict on paths the merge nulled would
// partially resurrect the merged-away account.
//
// This mattered in the abstract until 2026-08-03, when the merge leg ran and put
// a real merge dump in .ops-audit/ next to the purge dumps. The guard fires on a
// DRY RUN too: the dry run writes nothing, but its output is exactly what sends
// an operator hunting residue that is not there.
describe('opGuard — only a purge dump may be read back', () => {
  test('a purge dump passes', () => {
    expect(opGuard('purge', false)).toMatchObject({ ok: true });
  });

  test('a merge dump is refused, and the refusal says what would go wrong', () => {
    const v = opGuard('merge', false);
    expect(v.ok).toBe(false);
    expect(v.detail).toContain('merge');
    expect(v.detail).toContain('--i-know-this-is-not-a-purge');
  });

  test("a restore's own dump is refused — replaying it would undo the restore", () => {
    expect(opGuard('restore', false).ok).toBe(false);
  });

  test('a dump with no op at all is refused rather than assumed to be a purge', () => {
    expect(opGuard(undefined, false).ok).toBe(false);
    expect(opGuard(null, false).ok).toBe(false);
    expect(opGuard('', false).ok).toBe(false);
  });

  test('an unrecognised op is refused — the list is an allowlist, not a denylist', () => {
    expect(opGuard('link-production', false).ok).toBe(false);
    expect(opGuard('PURGE', false).ok).toBe(false);
  });

  test('the override lets it through and says so, so the transcript records the choice', () => {
    const v = opGuard('merge', true);
    expect(v.ok).toBe(true);
    expect(v.detail).toContain('overridden');
    expect(v.detail).toContain('merge');
  });

  test('the override does not silently bless a purge into looking overridden', () => {
    expect(opGuard('purge', true).detail).not.toContain('overridden');
  });
});
