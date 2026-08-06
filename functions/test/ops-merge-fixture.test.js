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
// carry at all, because the only shared group's name is discarded unless the
// preview's adoption tick is ticked (M8, 17945c3 — and M13 for why the
// read-back has to be told which way it was run).
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
  fixtureTgId,
  fixtureNotes,
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
    adoptGroupNames: opts.adoptGroupNames || [],
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

  test('the shared group raises a collision and KEEPS the survivor name when nothing is adopted', async () => {
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

  test('a plain merge leaves the survivor with no telegram at all', async () => {
    const { fixture, live } = await runMerge({ telegram: true });
    const { S } = fixture.uids;
    expect(live(`telegramByUid/${S}`)).toBeNull();
    // The survivor is NOT switched onto a channel it cannot receive on —
    // integrity.js's `telegram-channel-unroutable` is an ERROR.
    expect(live(`userPrefs/${S}/notifyChannel`)).toBeNull();
  });

  test('link-via-merge repoints the mapping at the survivor instead', async () => {
    const { fixture, live } = await runMerge({ telegram: true, repoint: true });
    const { L, S } = fixture.uids;
    expect(live(`telegramUsers/${fixture.tgId}/uid`)).toBe(S);
    expect(live(`telegramByUid/${S}/tgId`)).toBe(fixture.tgId);
    expect(live(`telegramByUid/${L}`)).toBeNull();
  });

  // The variant had only three claims against the plain merge's 57, so "60/60"
  // would have been weakly earned. buildLinkWrites writes five paths and every
  // one of them is load-bearing: two integrity checks (telegram-prefs-disagree,
  // telegram-channel-unroutable) are both ERRORS and both key off the prefs side
  // that the original three assertions never looked at.
  test('link-via-merge writes the WHOLE link, mapping and prefs alike', async () => {
    const { fixture, live } = await runMerge({ telegram: true, repoint: true });
    const { S } = fixture.uids;
    const { tgId } = fixture;
    // chatId comes from the prior mapping, not from the fallback.
    expect(live(`telegramUsers/${tgId}/chatId`)).toBe(tgId);
    expect(typeof live(`telegramUsers/${tgId}/linkedAt`)).toBe('number');
    // The reverse index is exact — it carries no timestamp.
    expect(live(`telegramByUid/${S}`)).toEqual({ tgId, chatId: tgId });
    // The prefs side. Disagreement here is telegram-prefs-disagree (ERROR);
    // a channel with no mapping is telegram-channel-unroutable (ERROR).
    expect(live(`userPrefs/${S}/telegram/tgId`)).toBe(tgId);
    expect(typeof live(`userPrefs/${S}/telegram/linkedAt`)).toBe('number');
    expect(live(`userPrefs/${S}/notifyChannel`)).toBe('telegram');
  });

  test('link-via-merge is the NON-lossy link — it still carries everything a plain merge does', async () => {
    const { live } = await runMerge({ telegram: true, repoint: true });
    // Spot-check the families the README's "link via merge" row promises, since
    // the whole point of preferring it over "link as production" is that these
    // survive rather than being expunged.
    const failures = [];
    for (const a of buildMergeAssertions({ tag: TAG, telegram: true, repoint: true })) {
      const res = checkAssertion(a, live(a.path));
      if (!res.ok) failures.push(`${a.path}: ${res.detail}`);
    }
    expect(failures).toEqual([]);
  });
});

// --- who holds the mapping when the teardown branch runs ---------------------
//
// merge.js:389 calls buildMappingTeardown with owner=L and NO ownUids, so the
// builder's refusal (telegram-link-write.js:100) governs every case except "the
// loser holds it". The live 61/61 run covered only that one. These are the rest:
// each is a different holder of telegramUsers/{tgId}, and three of the four must
// end with the mapping still standing.
//
// The verifier is the reason these are seedable at all. Its plain+telegram claim
// list asserts telegramUsers/{tgId} is GONE, which is right for the loser shape
// and wrong for every other — and a verifier that reports a correct merge as
// owed is the 2dec78c failure repeated on purpose.
describe('the mapping shapes the teardown branch can meet', () => {
  test('a mapping held by an uninvolved account is refused, and that account keeps working', async () => {
    const { fixture, live } = await runMerge({ telegram: true, mappingShape: 'third-party' });
    const { L, S, P2 } = fixture.uids;
    expect(live(`telegramUsers/${fixture.tgId}/uid`)).toBe(P2);
    expect(live(`telegramByUid/${P2}/tgId`)).toBe(fixture.tgId);
    // The loser's own reverse index still comes down — it is the loser's.
    expect(live(`telegramByUid/${L}`)).toBeNull();
    expect(live(`telegramByUid/${S}`)).toBeNull();
  });

  test('the refusal is reported as a conflict rather than performed silently', async () => {
    const { plan, fixture } = await runMerge({ telegram: true, mappingShape: 'third-party' });
    const kinds = plan.conflicts.map((c) => c.kind);
    expect(kinds).toContain('telegram-mapping-not-owned');
    // And no loss line may claim the mapping was dropped, because it was not.
    expect(plan.losses.some((l) => l.includes(`telegramUsers/${fixture.tgId} dropped`))).toBe(false);
  });

  test('a mapping node carrying no uid is refused and named as such', async () => {
    const { plan, live, fixture } = await runMerge({ telegram: true, mappingShape: 'no-uid' });
    expect(live(`telegramUsers/${fixture.tgId}`)).not.toBeNull();
    expect(live(`telegramUsers/${fixture.tgId}/uid`)).toBeNull();
    const conflict = plan.conflicts.find((c) => c.kind === 'telegram-mapping-not-owned');
    expect(conflict?.detail).toContain('a mapping node carrying no uid');
  });

  test('a reverse index pointing at no mapping at all raises no conflict', async () => {
    // The seed must genuinely omit the mapping, or this passes by deleting one
    // that was there — which is the loser shape wearing a different name.
    const seeded = buildMergeFixture({ tag: TAG, now: NOW, telegram: true, mappingShape: 'absent' }).writes;
    expect(seeded[`telegramUsers/${fixtureTgId(TAG)}`]).toBeUndefined();
    expect(seeded[`telegramByUid/${fixtureUids(TAG).L}`]).toBeDefined();
    const { plan, live, fixture } = await runMerge({ telegram: true, mappingShape: 'absent' });
    expect(live(`telegramUsers/${fixture.tgId}`)).toBeNull();
    expect(live(`telegramByUid/${fixture.uids.L}`)).toBeNull();
    expect(plan.conflicts.map((c) => c.kind)).not.toContain('telegram-mapping-not-owned');
  });

  // The one shape whose refusal is CORRECT rather than merely safe: the survivor
  // is not destroyed by this merge, so "the forward mapping stays with its
  // owner, whose Telegram keeps working" — the loss line R2 had to fix at
  // merge.js:363 — is a true statement here.
  test('a mapping held by the SURVIVOR is left alone, and the survivor keeps its link', async () => {
    const { fixture, live } = await runMerge({ telegram: true, mappingShape: 'survivor' });
    const { L, S } = fixture.uids;
    expect(live(`telegramUsers/${fixture.tgId}/uid`)).toBe(S);
    expect(live(`telegramByUid/${S}/tgId`)).toBe(fixture.tgId);
    expect(live(`telegramByUid/${L}`)).toBeNull();
  });

  test('every shape has assertions that hold against the real post-merge tree', async () => {
    // A shape whose mapping SURVIVES must produce its own claim list. Identical
    // lists would mean the flag reached the seed and never reached the verifier
    // — the failure this whole block exists to prevent.
    const claims = (mappingShape) => buildMergeAssertions({ tag: TAG, telegram: true, mappingShape })
      .map((a) => `${a.path}:${a.kind}`).sort().join('|');
    for (const shape of ['third-party', 'no-uid', 'survivor']) {
      expect(claims(shape)).not.toBe(claims('loser'));
    }
    // `absent` is the exception and it would be dishonest to manufacture a
    // difference: the merge writes a null over a path that held nothing, so the
    // post-merge TREE is indistinguishable from the loser shape's. What differs
    // is the seed and the preview's loss line, neither of which a read-back sees.
    expect(claims('absent')).toBe(claims('loser'));
    const failures = [];
    for (const mappingShape of ['loser', 'third-party', 'no-uid', 'absent', 'survivor']) {
      const { live } = await runMerge({ telegram: true, mappingShape });
      for (const a of buildMergeAssertions({ tag: TAG, telegram: true, mappingShape })) {
        const res = checkAssertion(a, live(a.path));
        if (!res.ok) failures.push(`${mappingShape} ${a.path}: ${res.detail}`);
      }
    }
    expect(failures).toEqual([]);
  });

  // The flag has to change the CLAIMS, not just the seed. If the default list
  // still passed against a third-party merge, the shapes would be decoration.
  test('the loser-shape claims FAIL against a third-party merge — the flag is not cosmetic', async () => {
    const { live } = await runMerge({ telegram: true, mappingShape: 'third-party' });
    const owed = buildMergeAssertions({ tag: TAG, telegram: true })
      .filter((a) => !checkAssertion(a, live(a.path)).ok);
    expect(owed.map((a) => a.path)).toContain(`telegramUsers/${fixtureTgId(TAG)}`);
  });

  test('the cleanup nulls the paths only some shapes seed', () => {
    const cleanup = buildFixtureCleanup({ tag: TAG });
    const { P2, S } = fixtureUids(TAG);
    for (const shape of ['third-party', 'no-uid', 'absent', 'survivor']) {
      for (const path of Object.keys(buildMergeFixture({ tag: TAG, now: NOW, telegram: true, mappingShape: shape }).writes)) {
        expect(cleanup[path]).toBeNull();
      }
    }
    expect(cleanup[`telegramByUid/${P2}`]).toBeNull();
    expect(cleanup[`telegramByUid/${S}`]).toBeNull();
  });

  test('a shape without --telegram is refused rather than silently ignored', () => {
    expect(() => buildMergeFixture({ tag: TAG, now: NOW, mappingShape: 'third-party' }))
      .toThrow(/telegram/i);
  });

  // link via merge takes the OTHER branch (merge.js:351), where buildLinkWrites
  // has its own refusal and its own ownUids. Those expectations are a different
  // matrix; producing this one's claims for that run would be the cry-wolf bug.
  test('a shape combined with --repoint is refused', () => {
    expect(() => buildMergeAssertions({ tag: TAG, telegram: true, repoint: true, mappingShape: 'third-party' }))
      .toThrow(/repoint/i);
  });

  test('an unknown shape is refused by name', () => {
    expect(() => buildMergeFixture({ tag: TAG, now: NOW, telegram: true, mappingShape: 'nonsense' }))
      .toThrow(/nonsense/);
  });

  // A refusal shape is deliberately INCONSISTENT — that is the state it exists
  // to seed — so the "no errors before the merge" note is false for it. Left
  // unsaid, the operator reads a legitimate ERROR as a defect and stops.
  test('the notes warn that a refusal shape shows an integrity ERROR before the merge', () => {
    const notes = fixtureNotes({ mappingShape: 'third-party' }).join(' ');
    expect(notes).toContain('telegram-mapping-asymmetric');
    expect(fixtureNotes().join(' ')).not.toContain('telegram-mapping-asymmetric');
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

  // --- M13: the read-back has to know whether the operator ticked -----------
  // Before M8 (17945c3) the panel could not send adoptGroupNames at all, so the
  // shared group's claim could safely be hard-coded to the survivor's name. It
  // can now, and a merge run WITH the tick reported 1 of 57 owed on the dev
  // project (2026-08-05) — a FALSE failure on the leg whose whole job is
  // telling real residue from noise.
  test('a merge with the shared group ADOPTED matches the adoption-aware assertions', async () => {
    const { GB } = fixtureGids(TAG);
    const { live } = await runMerge({ adoptGroupNames: [GB] });
    const failures = [];
    for (const a of buildMergeAssertions({ tag: TAG, adopt: true })) {
      const res = checkAssertion(a, live(a.path));
      if (!res.ok) failures.push(`${a.path}: ${res.detail}`);
    }
    expect(failures).toEqual([]);
  });

  // The count of ONE is the load-bearing half of the live observation: it shows
  // the tick moves precisely the record it should and nothing else, which is
  // what tells M13 apart from a merge defect.
  test('adoption changes exactly one claim — the shared group displayName, and nothing else', () => {
    const { S } = fixtureUids(TAG);
    const { GB } = fixtureGids(TAG);
    const plain = buildMergeAssertions({ tag: TAG });
    const adopted = buildMergeAssertions({ tag: TAG, adopt: true });
    expect(adopted.map((a) => a.path)).toEqual(plain.map((a) => a.path));
    const differing = plain
      .filter((a, i) => JSON.stringify(a.value) !== JSON.stringify(adopted[i].value))
      .map((a) => a.path);
    expect(differing).toEqual([`groups/${GB}/members/${S}/displayName`]);
    expect(plain.find((a) => a.path === differing[0]).value).toBe('S in GB');
    expect(adopted.find((a) => a.path === differing[0]).value).toBe('L in GB');
  });

  // The stale half is the RATIONALE as much as the value: a reader who checks
  // why the claim is what it is was being told the panel cannot do something it
  // has done since 2026-08-03.
  test('no claim still explains itself by saying the panel cannot adopt', () => {
    const stale = /(never sends|sends no) adoptGroupNames/;
    for (const a of [...buildMergeAssertions({ tag: TAG }), ...buildMergeAssertions({ tag: TAG, adopt: true })]) {
      expect(a.why).not.toMatch(stale);
    }
    expect(fixtureNotes().join(' ')).not.toMatch(stale);
  });

  test('the seed notes tell the operator which way to verify a tick', () => {
    expect(fixtureNotes().join(' ')).toContain('--adopt');
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

  // Found on the FIRST live run of the merge leg (tag run2): the merge had
  // written inviteIndex correctly and this reported it owed, because RTDB
  // returned {ownerPath, ownerUid, scope} against an expectation written
  // {scope, ownerPath, ownerUid}. A verifier that cries wolf on a correct
  // merge is worse than no verifier — the operator's next move is to go
  // looking for a defect that is not there.
  test('equals ignores object key ORDER — RTDB returns keys in its own order', () => {
    const a = {
      path: 'p',
      kind: 'equals',
      value: { scope: 'personal', ownerPath: 'users/S/invites/T', ownerUid: 'S' },
      why: 'w',
    };
    expect(checkAssertion(a, { ownerPath: 'users/S/invites/T', ownerUid: 'S', scope: 'personal' }).ok).toBe(true);
  });

  test('equals stays order-SENSITIVE for arrays — order is meaningful in a list, not in a record', () => {
    const a = { path: 'p', kind: 'equals', value: [1, 2], why: 'w' };
    expect(checkAssertion(a, [1, 2]).ok).toBe(true);
    expect(checkAssertion(a, [2, 1]).ok).toBe(false);
  });

  test('equals still catches a real difference, nested and by key count', () => {
    const a = { path: 'p', kind: 'equals', value: { a: { b: 1 } }, why: 'w' };
    expect(checkAssertion(a, { a: { b: 2 } }).ok).toBe(false);
    expect(checkAssertion(a, { a: { b: 1 }, c: 3 }).ok).toBe(false);
    expect(checkAssertion(a, {}).ok).toBe(false);
    expect(checkAssertion(a, null).ok).toBe(false);
  });

  test('a miss prints both sides with keys SORTED, so two identical-looking values cannot recur', () => {
    const a = { path: 'p', kind: 'equals', value: { b: 1, a: 2 }, why: 'w' };
    const miss = checkAssertion(a, { b: 9, a: 2 });
    expect(miss.ok).toBe(false);
    expect(miss.detail).toContain('{"a":2,"b":1}');
    expect(miss.detail).toContain('{"a":2,"b":9}');
  });

  test('keys compares the key SET, so token order never matters', () => {
    const a = { path: 'p', kind: 'keys', value: ['b', 'a'], why: 'w' };
    expect(checkAssertion(a, { a: 1, b: 2 }).ok).toBe(true);
    expect(checkAssertion(a, { a: 1 }).ok).toBe(false);
    expect(checkAssertion(a, { a: 1, b: 2, c: 3 }).ok).toBe(false);
  });
});
