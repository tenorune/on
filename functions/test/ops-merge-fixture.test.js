// functions/test/ops-merge-fixture.test.js — the merge leg's seed and its
// read-back assertions.
//
// Smoke-test step 9's merge leg (S1) needs two throwaway accounts seeded so the
// merge is NOT trivial: a contact each side, a group only the loser is in (the
// per-group displayName carry), a group both are in (the collision), a group
// the loser OWNS (ownership follows), canvases in all three of merge.js's
// branches, push tokens both sides, an invite token, and one durable-mailbox
// collision. Hand-seeding that through the app is slow and gets it subtly wrong
// — the first attempt at writing it down produced a seed with no per-group name
// carry at all, because the only shared group's name is discarded (panel.html
// never sends adoptGroupNames).
//
// So the fixture is DERIVED and the assertions are pinned against the REAL
// buildMergePlan below, not against hand-written expectations. That is the
// point of this file: if merge.js's behaviour changes, the end-to-end case goes
// red and the assertions have to be re-derived rather than quietly drifting
// away from what the operator will actually see on the panel.
//
// The accounts are synthetic on purpose. Nothing here is ever opened in a
// client, so G3 (a revoked session republishing its cache) and G6 (a PEER's
// client republishing cross-user residue, permanently, with no mitigation) have
// no author on this leg. An app-born peer would re-open both.
import {
  fixtureUids,
  fixtureGids,
  fixtureTokens,
  fixtureCanvasKeys,
  buildMergeFixture,
  buildMergeAssertions,
  checkAssertion,
  buildFixtureCleanup,
} from '../ops/merge-fixture.js';
import { buildMergePlan, applyMergePlan } from '../ops/merge.js';

const TAG = 't1';
const NOW = 1_800_000_000_000;

// --- a minimal in-memory RTDB -----------------------------------------------
// Deep-set/get over slash paths, so the fixture's flat write-set and the merge
// plan's flat write-set land in the same tree the real database would build.
/** @param {Record<string, any>} tree @param {string} path */
function getPath(tree, path) {
  let node = tree;
  for (const seg of path.split('/').filter(Boolean)) {
    if (node === null || node === undefined || typeof node !== 'object') return null;
    node = node[seg];
  }
  return node === undefined ? null : node;
}

/** @param {Record<string, any>} tree @param {string} path @param {unknown} value */
function setPath(tree, path, value) {
  const segs = path.split('/').filter(Boolean);
  const last = segs.pop();
  if (!last) return;
  let node = tree;
  for (const seg of segs) {
    if (node[seg] === null || node[seg] === undefined || typeof node[seg] !== 'object') node[seg] = {};
    node = node[seg];
  }
  if (value === null) delete node[last];
  else node[last] = value;
}

// A write COPIES, exactly as a real database does. Storing the caller's object
// by reference aliased the fixture to the tree, so the merge's own null deleted
// a key out of the expectation it was being compared against.
const clone = (v) => (v === null || v === undefined ? null : JSON.parse(JSON.stringify(v)));

function makeDb(writes) {
  /** @type {Record<string, any>} */
  const tree = {};
  for (const [path, value] of Object.entries(writes)) setPath(tree, path, clone(value));
  return {
    tree,
    deps: {
      /** @param {string} path */
      getVal: async (path) => clone(getPath(tree, path)),
      /** @param {string} base @param {Record<string, unknown>} updates */
      update: async (base, updates) => {
        for (const [rel, value] of Object.entries(updates)) {
          setPath(tree, base === '/' ? rel : `${base}/${rel}`, clone(value));
        }
      },
      now: () => NOW,
    },
  };
}

/** Seed, merge, and hand back the resulting tree plus the plan. */
async function runMerge(opts = {}) {
  const fixture = buildMergeFixture({ tag: TAG, now: NOW, ...opts });
  const { tree, deps } = makeDb(fixture.writes);
  const plan = await buildMergePlan(deps, {
    loserUid: fixture.uids.L,
    survivorUid: fixture.uids.S,
    canvasKeys: fixtureCanvasKeys({ tag: TAG, ...opts }),
    telegramRepoint: Boolean(opts.repoint),
    now: NOW,
  });
  await applyMergePlan(deps, plan);
  return { fixture, tree, plan, live: (path) => getPath(tree, path) };
}

// --- the fixture itself ------------------------------------------------------

describe('fixture shape', () => {
  test('uids and gids are derived from the tag, so two runs never collide', () => {
    const a = fixtureUids('alpha');
    const b = fixtureUids('beta');
    expect(new Set(Object.values(a)).size).toBe(Object.keys(a).length);
    for (const role of Object.keys(a)) expect(a[role]).not.toBe(b[role]);
    expect(new Set(Object.values(fixtureGids('alpha'))).size).toBe(4);
  });

  test('every seeded path is disjoint — an RTDB multi-path update refuses overlaps', () => {
    const paths = Object.keys(buildMergeFixture({ tag: TAG, now: NOW }).writes);
    for (const a of paths) {
      for (const b of paths) {
        if (a !== b) expect(b.startsWith(`${a}/`)).toBe(false);
      }
    }
  });

  test('nothing is seeded outside the fixture tag', () => {
    const uids = Object.values(fixtureUids(TAG));
    const gids = Object.values(fixtureGids(TAG));
    const tokens = Object.values(fixtureTokens(TAG));
    for (const path of Object.keys(buildMergeFixture({ tag: TAG, now: NOW }).writes)) {
      const named = [...uids, ...gids, ...tokens].some((id) => path.includes(id));
      expect(named || path.startsWith('codeIndex/')).toBe(true);
    }
  });

  test('the cleanup nulls every path the seed wrote', () => {
    const seeded = Object.keys(buildMergeFixture({ tag: TAG, now: NOW }).writes);
    const cleanup = buildFixtureCleanup({ tag: TAG });
    for (const path of seeded) expect(cleanup[path]).toBeNull();
    expect(Object.values(cleanup).every((v) => v === null)).toBe(true);
  });

  test('the cleanup also nulls what the MERGE creates, not just what the seed wrote', async () => {
    const { fixture } = await runMerge();
    const cleanup = buildFixtureCleanup({ tag: TAG });
    // The carried canvas lands at a key that never existed before the merge.
    const carried = [fixture.uids.S, fixture.uids.P1].sort().join('_');
    expect(cleanup[`canvases/${carried}`]).toBeNull();
  });
});

// --- what the seed provably exercises ---------------------------------------

describe('the seed drives every branch the merge leg exists to observe', () => {
  test('a group only the loser is in carries the per-group displayName onto the survivor', async () => {
    const { fixture, live } = await runMerge();
    const { GA } = fixtureGids(TAG);
    expect(live(`groups/${GA}/members/${fixture.uids.S}`)).toEqual(
      fixture.writes[`groups/${GA}`].members[fixture.uids.L],
    );
    expect(live(`groups/${GA}/members/${fixture.uids.S}/displayName`)).toBe('L in GA');
    expect(live(`groups/${GA}/members/${fixture.uids.L}`)).toBeNull();
  });

  test('the shared group raises a collision and KEEPS the survivor name — adoptGroupNames has no UI', async () => {
    const { fixture, plan, live } = await runMerge();
    const { GB } = fixtureGids(TAG);
    const collision = plan.conflicts.find((c) => c.kind === 'group-member-collision');
    expect(collision).toBeDefined();
    expect(collision.detail).toContain('L in GB');
    expect(collision.detail).toContain('S in GB');
    expect(collision.resolution).toBe("survivor's record kept");
    expect(live(`groups/${GB}/members/${fixture.uids.S}/displayName`)).toBe('S in GB');
  });

  test('a group the loser OWNS follows ownership to the survivor and is NOT deleted', async () => {
    const { fixture, live } = await runMerge();
    const { GC } = fixtureGids(TAG);
    expect(live(`groups/${GC}/ownerId`)).toBe(fixture.uids.S);
    expect(live(`groups/${GC}/members/${fixture.uids.S}/role`)).toBe('owner');
    // The contrast with the purge leg, which nulls an owned group wholesale.
    expect(live(`groups/${GC}/name`)).toBeTruthy();
  });

  test('contacts: a loser-only follower and followee carry, a shared one collapses', async () => {
    const { fixture, plan, live } = await runMerge();
    const { S, P1, F1, C1 } = fixture.uids;
    expect(live(`users/${S}/followers/${F1}`)).toBe(fixture.codes.F1);
    expect(live(`users/${S}/followerNames/${F1}`)).toBe('F1 pub');
    expect(live(`userPrefs/${S}/following/${P1}`)).toEqual({ code: fixture.codes.P1, label: 'P1 (L note)' });
    expect(plan.conflicts.filter((c) => c.kind === 'contact-collapsed').length).toBeGreaterThanOrEqual(2);
    // C1 followed both, so the survivor's own entries stand unchanged.
    expect(live(`users/${S}/followers/${C1}`)).toBe(fixture.codes.C1);
  });

  test("peer backrefs repoint: the peer's card resolves to the survivor, their nickname survives", async () => {
    const { fixture, live } = await runMerge();
    const { L, S, P1, F1 } = fixture.uids;
    expect(live(`userPrefs/${F1}/following/${S}`)).toEqual({ code: fixture.codes.S, label: 'L (F1 note)' });
    expect(live(`userPrefs/${F1}/following/${L}`)).toBeNull();
    expect(live(`users/${P1}/followers/${S}`)).toBe(fixture.codes.S);
    expect(live(`users/${P1}/followerNames/${S}`)).toBe('L pub');
    expect(live(`users/${P1}/followers/${L}`)).toBeNull();
  });

  test('push tokens union onto the survivor and the loser node goes', async () => {
    const { fixture, live } = await runMerge();
    const { L, S } = fixture.uids;
    expect(Object.keys(live(`pushTokens/${S}`)).sort()).toEqual(['tokA', 'tokB', 'tokC']);
    expect(live(`pushTokens/${L}`)).toBeNull();
  });

  test('the invite token moves WITH its index entry keeping the {scope,ownerPath,ownerUid} shape', async () => {
    const { fixture, live } = await runMerge();
    const { L, S } = fixture.uids;
    const { inviteL } = fixtureTokens(TAG);
    expect(live(`users/${S}/invites/${inviteL}`)).toBeTruthy();
    // The 2fcc51f fix, on live data: a bare uid or a missing `scope` here is
    // what silently killed the invite preview.
    expect(live(`inviteIndex/${inviteL}`)).toEqual({
      scope: 'personal',
      ownerPath: `users/${S}/invites/${inviteL}`,
      ownerUid: S,
    });
    expect(live(`codeIndex/${fixture.codes.L}`)).toBeNull();
    expect(live(`users/${L}`)).toBeNull();
  });

  test('knocks and calls are dropped as transient; durable mailboxes union', async () => {
    const { fixture, plan, live } = await runMerge();
    const { L, S, F1, C1, P2 } = fixture.uids;
    expect(live(`knocks/${L}`)).toBeNull();
    expect(live(`calls/${L}`)).toBeNull();
    expect(plan.losses.some((l) => l === `knocks/${L} dropped (transient)`)).toBe(true);
    expect(plan.losses.some((l) => l === `calls/${L} dropped (transient)`)).toBe(true);
    expect(live(`followGrants/${S}/${F1}`)).toBeTruthy();
    expect(live(`revocations/${S}/${C1}`)).toBeTruthy();
    // and the one deliberate collision
    expect(plan.conflicts.some((c) => c.kind === 'mailbox-collision')).toBe(true);
    expect(live(`followRequests/${S}/${P2}`)).toEqual({ side: 'S' });
  });

  test('a pending invite to an unjoined group moves with its by-group mirror', async () => {
    const { fixture, live } = await runMerge();
    const { L, S } = fixture.uids;
    const { GD } = fixtureGids(TAG);
    expect(live(`pendingInvites/${S}/${GD}`)).toBeTruthy();
    expect(live(`pendingInvitesByGroup/${GD}/${S}`)).toBe(true);
    expect(live(`pendingInvitesByGroup/${GD}/${L}`)).toBeNull();
  });

  test('all three canvas branches fire: carry, collision, and between-the-two', async () => {
    const { fixture, plan, live } = await runMerge();
    const { L, S, P1, C1 } = fixture.uids;
    const key = (a, b) => [a, b].sort().join('_');
    // carry — settings move, strokes do not
    expect(live(`canvases/${key(S, P1)}/bg`)).toBe('grid-dark');
    expect(live(`canvases/${key(S, P1)}/strokes`)).toBeNull();
    expect(live(`canvases/${key(L, P1)}`)).toBeNull();
    // collision — the survivor's drawing stands
    expect(plan.conflicts.some((c) => c.kind === 'canvas-collision')).toBe(true);
    expect(live(`canvases/${key(S, C1)}/bg`)).toBe('plain');
    expect(live(`canvases/${key(L, C1)}`)).toBeNull();
    // between the two merged accounts — deleted outright
    expect(live(`canvases/${key(L, S)}`)).toBeNull();
  });

  test('the loser LOSES its location fix — a merge does not carry it to the survivor', async () => {
    const { fixture, live } = await runMerge();
    const { L, S } = fixture.uids;
    const { GA } = fixtureGids(TAG);
    expect(live(`locations/${L}`)).toBeNull();
    expect(live(`locationCells/${GA}/${L}`)).toBeNull();
    // Named explicitly because it is the one family an operator may expect to
    // move: the enumerator NULLS it on a merge exactly as it does on a purge.
    expect(live(`locations/${S}`)).toBeNull();
  });
});

// --- telegram variants -------------------------------------------------------

describe('the telegram variants', () => {
  test('a plain merge tears the loser mapping down rather than stranding it', async () => {
    const { fixture, live } = await runMerge({ telegram: true });
    const { L } = fixture.uids;
    expect(live(`telegramUsers/${fixture.tgId}`)).toBeNull();
    expect(live(`telegramByUid/${L}`)).toBeNull();
  });

  test('link-via-merge repoints the mapping at the survivor instead', async () => {
    const { fixture, live } = await runMerge({ telegram: true, repoint: true });
    const { L, S } = fixture.uids;
    expect(live(`telegramUsers/${fixture.tgId}/uid`)).toBe(S);
    expect(live(`telegramByUid/${S}/tgId`)).toBe(fixture.tgId);
    expect(live(`telegramByUid/${L}`)).toBeNull();
  });
});

// --- the assertions the verifier reads back ---------------------------------

describe('buildMergeAssertions matches what the merge actually leaves behind', () => {
  test('every assertion passes against the real post-merge tree', async () => {
    const { live } = await runMerge();
    const failures = [];
    for (const a of buildMergeAssertions({ tag: TAG })) {
      const res = checkAssertion(a, live(a.path));
      if (!res.ok) failures.push(`${a.path}: ${res.detail}`);
    }
    expect(failures).toEqual([]);
  });

  test('the same assertions FAIL against the pre-merge tree — they are not vacuous', () => {
    const fixture = buildMergeFixture({ tag: TAG, now: NOW });
    const { tree } = makeDb(fixture.writes);
    const passed = buildMergeAssertions({ tag: TAG })
      .filter((a) => checkAssertion(a, getPath(tree, a.path)).ok);
    // A handful (the survivor's untouched own entries) legitimately hold before
    // the merge too; the great majority must not.
    expect(passed.length).toBeLessThan(buildMergeAssertions({ tag: TAG }).length / 3);
  });

  test('the telegram assertions follow the variant that was seeded', async () => {
    const plainRun = await runMerge({ telegram: true });
    for (const a of buildMergeAssertions({ tag: TAG, telegram: true })) {
      expect(checkAssertion(a, plainRun.live(a.path))).toMatchObject({ ok: true });
    }
    const repointRun = await runMerge({ telegram: true, repoint: true });
    for (const a of buildMergeAssertions({ tag: TAG, telegram: true, repoint: true })) {
      expect(checkAssertion(a, repointRun.live(a.path))).toMatchObject({ ok: true });
    }
  });

  test('every assertion carries a reason, so a red line says what was owed', () => {
    for (const a of buildMergeAssertions({ tag: TAG })) {
      expect(typeof a.why).toBe('string');
      expect(a.why.length).toBeGreaterThan(0);
    }
  });
});

describe('checkAssertion', () => {
  test('gone accepts null and undefined, and nothing else', () => {
    expect(checkAssertion({ path: 'p', kind: 'gone', why: 'w' }, null).ok).toBe(true);
    expect(checkAssertion({ path: 'p', kind: 'gone', why: 'w' }, undefined).ok).toBe(true);
    expect(checkAssertion({ path: 'p', kind: 'gone', why: 'w' }, false).ok).toBe(false);
    expect(checkAssertion({ path: 'p', kind: 'gone', why: 'w' }, {}).ok).toBe(false);
  });

  test('present rejects an empty object — RTDB cannot hold one, so it reads as absent', () => {
    expect(checkAssertion({ path: 'p', kind: 'present', why: 'w' }, { a: 1 }).ok).toBe(true);
    expect(checkAssertion({ path: 'p', kind: 'present', why: 'w' }, {}).ok).toBe(false);
    expect(checkAssertion({ path: 'p', kind: 'present', why: 'w' }, null).ok).toBe(false);
  });

  test('equals is a deep compare and reports both sides on a miss', () => {
    const a = { path: 'p', kind: 'equals', value: { x: 1 }, why: 'w' };
    expect(checkAssertion(a, { x: 1 }).ok).toBe(true);
    const miss = checkAssertion(a, { x: 2 });
    expect(miss.ok).toBe(false);
    expect(miss.detail).toContain('"x":2');
  });

  test('keys compares the key SET, so token order never matters', () => {
    const a = { path: 'p', kind: 'keys', value: ['b', 'a'], why: 'w' };
    expect(checkAssertion(a, { a: 1, b: 2 }).ok).toBe(true);
    expect(checkAssertion(a, { a: 1 }).ok).toBe(false);
    expect(checkAssertion(a, { a: 1, b: 2, c: 3 }).ok).toBe(false);
  });
});
