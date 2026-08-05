// functions/ops/merge-fixture.js — the seed and the read-back for smoke-test
// step 9's MERGE leg (S1), and nothing else.
//
// WHY THIS EXISTS. The merge leg is the last unfinished part of
// docs/operator-panel-smoke-test.md. It needs two throwaway accounts seeded so
// the merge is not trivial, and seeding that by hand through the app is both
// slow and easy to get subtly wrong. The first written-down version of the seed
// produced NO per-group displayName carry at all: its only shared group hits
// merge.js's collision branch, whose resolution is "survivor's record kept"
// unless the loser's name is adopted via `adoptGroupNames`. A group the loser
// is in and the survivor is NOT is what carries a per-group name
// UNCONDITIONALLY (merge.js:220-221), which is why the fixture has both.
//
// ⚠️ `adoptGroupNames` was unreachable from the browser when that was written,
// and has been a per-group tick in the preview since M8 (17945c3) — so the
// read-back takes an `adopt` argument rather than assuming the tick is off
// (M13). Read `buildMergeAssertions`' own note before changing it.
//
// PURE ON PURPOSE. Everything here is a value: a flat write-set, a list of
// assertions, and one verdict function. The live wiring is in
// ops/seed-merge-fixture.js and ops/verify-merge.js, which are thin CLIs over
// this. functions/test/ops-merge-fixture.test.js drives the write-set through
// the REAL buildMergePlan/applyMergePlan and checks every assertion against the
// resulting tree, so these two lists cannot drift apart from merge.js.
//
// SYNTHETIC ACCOUNTS ARE THE POINT, not a shortcut. merge.js reads RTDB and
// nothing else, so an app-born account exercises no code path a seeded one
// misses — while an app-born account DOES bring a client, and a client is a
// hazard here, not a feature:
//   * G3 — a revoked session keeps writing for up to an hour, and what it
//     republishes is indistinguishable from residue the merge missed;
//   * G6 — a PEER's client republishes cross-user residue PERMANENTLY, with no
//     mitigation and no way to close every peer's client.
// Nothing seeded here is ever opened in a client, so on this leg both have no
// author. That is worth more than realism.
//
// The one integrity finding to expect afterwards is `auth-missing` at INFO
// severity, once per seeded uid (integrity.js:210-212) — an RTDB user with no
// Auth record, which is exactly what these are. Everything else is
// RTDB-internal, and the seed is deliberately self-consistent (reciprocal
// follows both ways, a followerName for every follower, a codeIndex entry
// matching every presence code, a groupIdIndex per group, membership and
// enumeration in both directions, pendingInvites mirrored by group). So the
// integrity report should be CLEAN of errors and warnings before the merge —
// which makes it a second verifier: any error or warning afterwards is the
// merge's doing.
//
// Lives under ops/ so it is never deployed: firebase.json ignores `ops/**`, and
// tests/firebaseConfig.test.js pins that exclusion.

/**
 * Canvas keys are SORTED uid pairs — the same rule merge.js and project.js use.
 * @param {string} a @param {string} b
 */
const pairKey = (a, b) => [a, b].sort().join('_');

/**
 * Six accounts, derived from a tag so two runs on the same project never
 * collide and a half-cleaned run is always identifiable by its tag.
 *
 * L  the loser        S  the survivor
 * P1 followed by L only, member of the loser-only group and the owned group
 * P2 followed by S only, owner of the shared group and the unjoined group
 * F1 follows L only   C1 follows and is followed by BOTH (the collapse case)
 * @param {string} tag
 */
export function fixtureUids(tag) {
  return {
    L: `smk-${tag}-loser`,
    S: `smk-${tag}-survivor`,
    P1: `smk-${tag}-peer1`,
    P2: `smk-${tag}-peer2`,
    F1: `smk-${tag}-follower`,
    C1: `smk-${tag}-both`,
  };
}

/**
 * GA loser only — the per-group displayName CARRY.
 * GB both       — the collision (survivor's record kept, no adopt UI).
 * GC loser OWNS — ownership follows, and the group is NOT deleted (unlike a purge).
 * GD neither    — L has an unjoined pending invite to it.
 * @param {string} tag
 */
export function fixtureGids(tag) {
  return { GA: `smg-${tag}-carry`, GB: `smg-${tag}-shared`, GC: `smg-${tag}-owned`, GD: `smg-${tag}-invited` };
}

/** @param {string} tag */
export function fixtureTokens(tag) {
  return { inviteL: `smt-${tag}-loserinvite` };
}

/**
 * Share codes for the seeded accounts.
 *
 * ⚠️ UPPER-CASED because the shipped rules require it: SEC-1 (`1ae38a8`) has
 * validated `users/$uid/presence/code` against `^[A-Z0-9]{1,32}$` since
 * 2026-08-04, and the tag regex both CLIs enforce is lowercase-only — so
 * without this, no tag could produce a legal code (M14). The Admin SDK bypasses
 * rules, so the seed worked anyway; what it wrote was a state no client could
 * have produced. `ops-merge-fixture-rules.test.js` derives the constraint from
 * `database.rules.json` rather than restating it, and is what catches the next
 * rule of this kind.
 *
 * ⚠️ Changing this changes every seeded code AND every code the cleanup nulls.
 * A fixture seeded by an older build must be cleaned by that build, or its
 * `codeIndex/` entries strand.
 * @param {string} tag
 */
export function fixtureCodes(tag) {
  const uids = fixtureUids(tag);
  /** @type {Record<string, string>} */
  const out = {};
  for (const role of Object.keys(uids)) out[role] = `SMK${tag}${role}`.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return out;
}

/**
 * A stable numeric Telegram id for the tag. Digits only, because tgIds are
 * numeric everywhere else and telegramUsers is keyed by them.
 * @param {string} tag
 */
export function fixtureTgId(tag) {
  let h = 7;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return `99${String(h).padStart(5, '0')}`;
}

/**
 * The canvas keys that exist AT SEED TIME. The panel gets this list from a
 * shallow REST read; the tests and the verifier take it from here so a merge
 * plan can be built without one.
 * @param {{ tag: string }} opts
 */
export function fixtureCanvasKeys({ tag }) {
  const { L, S, P1, C1 } = fixtureUids(tag);
  return [pairKey(L, P1), pairKey(L, C1), pairKey(S, C1), pairKey(L, S)];
}

/**
 * Who holds `telegramUsers/{tgId}` when the plain merge's teardown runs.
 *
 * merge.js:389 calls buildMappingTeardown with `owner: L` and NO `ownUids`, so
 * everything except `loser` lands in the builder's refusal
 * (telegram-link-write.js:100) and the mapping must SURVIVE the merge.
 *
 * All five ran on dev, 2026-08-03, one run each: `loser` 61/61, `third-party`
 * 62/62, `no-uid` 62/62, `absent` 61/61, `survivor` 61/61. The refusals were
 * watched rather than reasoned about, which is what these exist for.
 *
 * `survivor` is the one refusal that is right rather than merely safe: S is not
 * destroyed by this merge, so the loss line's "the forward mapping stays with
 * its owner, whose Telegram keeps working" is true — which is exactly what it
 * was NOT in the case R2 had to fix at merge.js:363.
 * @typedef {'loser' | 'third-party' | 'no-uid' | 'absent' | 'survivor'} MappingShape
 */
export const MAPPING_SHAPES = /** @type {MappingShape[]} */ ([
  'loser', 'third-party', 'no-uid', 'absent', 'survivor',
]);

/**
 * A shape only means anything when a mapping is seeded, and combining one with
 * a repoint would produce claims for the WRONG branch — link via merge takes
 * merge.js:351, where buildLinkWrites has its own refusal and its own ownUids.
 * Both are refused rather than coerced: a fixture that silently seeds something
 * other than what was asked for hands the verifier claims that do not match the
 * tree, and a verifier that reports a correct merge as owed is the 2dec78c
 * failure on purpose.
 * @param {{ mappingShape?: string, telegram?: boolean, repoint?: boolean }} opts
 * @returns {MappingShape}
 */
export function assertMappingShape({ mappingShape = 'loser', telegram = false, repoint = false }) {
  if (!MAPPING_SHAPES.includes(/** @type {MappingShape} */ (mappingShape))) {
    throw new Error(`unknown mappingShape "${mappingShape}" — expected one of ${MAPPING_SHAPES.join(', ')}`);
  }
  if (mappingShape !== 'loser' && !telegram) {
    throw new Error(`mappingShape "${mappingShape}" needs a telegram mapping to hold — seed with --telegram, or drop the shape`);
  }
  if (mappingShape !== 'loser' && repoint) {
    throw new Error(`mappingShape "${mappingShape}" is a plain-merge shape; --repoint takes the other branch (merge.js:351), whose expectations are not these`);
  }
  return /** @type {MappingShape} */ (mappingShape);
}

/**
 * The whole seed as one flat, DISJOINT write-set — every key is a whole
 * top-level record, because an RTDB multi-path update refuses two keys where
 * one is an ancestor of the other.
 * @param {{ tag: string, now: number, telegram?: boolean, mappingShape?: string }} opts
 */
export function buildMergeFixture({ tag, now, telegram = false, mappingShape = 'loser' }) {
  const shape = assertMappingShape({ mappingShape, telegram });
  const uids = fixtureUids(tag);
  const gids = fixtureGids(tag);
  const codes = fixtureCodes(tag);
  const tokens = fixtureTokens(tag);
  const tgId = fixtureTgId(tag);
  const { L, S, P1, P2, F1, C1 } = uids;
  const { GA, GB, GC, GD } = gids;

  /** @type {Record<string, unknown>} */
  const writes = {};

  // --- the two merging accounts --------------------------------------------
  // The loser's lastSeen is the NEWER of the two, so merge.js:264 has something
  // to carry; every presence here is 'unavailable', because 'available' without
  // a concrete availableUntil is an integrity ERROR.
  writes[`users/${L}`] = {
    presence: { code: codes.L, status: 'unavailable', lastSeen: now - 1_000 },
    followers: { [F1]: codes.F1, [C1]: codes.C1 },
    followerNames: { [F1]: 'F1 pub', [C1]: 'C1 pub' },
    groups: {
      [GA]: { lastVisited: now - 5_000 },
      // NEWER than the survivor's, so the enumeration entry is carried too.
      [GB]: { lastVisited: now - 2_000 },
      [GC]: { lastVisited: now - 9_000 },
    },
    invites: { [tokens.inviteL]: { createdAt: now - 50_000, scope: 'personal' } },
  };
  writes[`userPrefs/${L}`] = {
    following: {
      [P1]: { code: codes.P1, label: 'P1 (L note)' },
      [C1]: { code: codes.C1, label: 'C1 (L note)' },
    },
    notify: { [P1]: { knock: true } },
    currentContext: 'direct',
    ...(telegram ? { telegram: { tgId, linkedAt: now - 100_000 } } : {}),
  };
  writes[`users/${S}`] = {
    presence: { code: codes.S, status: 'unavailable', lastSeen: now - 60_000 },
    followers: { [C1]: codes.C1 },
    followerNames: { [C1]: 'C1 pub' },
    groups: { [GB]: { lastVisited: now - 90_000 } },
  };
  writes[`userPrefs/${S}`] = {
    following: {
      [P2]: { code: codes.P2, label: 'P2 (S note)' },
      [C1]: { code: codes.C1, label: 'C1 (S note)' },
    },
    currentContext: 'direct',
  };

  // --- the four peers, seeded reciprocally so integrity is clean -----------
  writes[`users/${P1}`] = {
    presence: { code: codes.P1, status: 'unavailable', lastSeen: now - 30_000 },
    followers: { [L]: codes.L },
    followerNames: { [L]: 'L pub' },
    groups: { [GA]: { lastVisited: now - 6_000 }, [GC]: { lastVisited: now - 7_000 } },
  };
  writes[`users/${P2}`] = {
    presence: { code: codes.P2, status: 'unavailable', lastSeen: now - 30_000 },
    followers: { [S]: codes.S },
    followerNames: { [S]: 'S pub' },
    groups: { [GB]: { lastVisited: now - 8_000 }, [GD]: { lastVisited: now - 8_500 } },
  };
  writes[`users/${F1}`] = {
    presence: { code: codes.F1, status: 'unavailable', lastSeen: now - 40_000 },
  };
  writes[`userPrefs/${F1}`] = { following: { [L]: { code: codes.L, label: 'L (F1 note)' } } };
  writes[`users/${C1}`] = {
    presence: { code: codes.C1, status: 'unavailable', lastSeen: now - 20_000 },
    followers: { [L]: codes.L, [S]: codes.S },
    followerNames: { [L]: 'L pub', [S]: 'S pub' },
  };
  writes[`userPrefs/${C1}`] = {
    following: {
      [L]: { code: codes.L, label: 'L (C1 note)' },
      [S]: { code: codes.S, label: 'S (C1 note)' },
    },
  };

  // --- groups ---------------------------------------------------------------
  writes[`groups/${GA}`] = {
    name: 'smoke carry group',
    ownerId: P1,
    members: {
      [P1]: { displayName: 'P1 in GA', role: 'owner' },
      [L]: { displayName: 'L in GA', role: 'member' },
    },
  };
  writes[`groups/${GB}`] = {
    name: 'smoke shared group',
    ownerId: P2,
    members: {
      [P2]: { displayName: 'P2 in GB', role: 'owner' },
      [L]: { displayName: 'L in GB', role: 'member' },
      [S]: { displayName: 'S in GB', role: 'member' },
    },
  };
  writes[`groups/${GC}`] = {
    name: 'smoke owned group',
    ownerId: L,
    members: {
      [L]: { displayName: 'L in GC', role: 'owner' },
      [P1]: { displayName: 'P1 in GC', role: 'member' },
    },
  };
  writes[`groups/${GD}`] = {
    name: 'smoke unjoined group',
    ownerId: P2,
    members: { [P2]: { displayName: 'P2 in GD', role: 'owner' } },
  };
  for (const gid of [GA, GB, GC, GD]) writes[`groupIdIndex/${gid}`] = true;

  // --- indexes --------------------------------------------------------------
  for (const role of /** @type {const} */ (['L', 'S', 'P1', 'P2', 'F1', 'C1'])) {
    writes[`codeIndex/${codes[role]}`] = uids[role];
  }
  writes[`inviteIndex/${tokens.inviteL}`] = {
    scope: 'personal',
    ownerPath: `users/${L}/invites/${tokens.inviteL}`,
    ownerUid: L,
  };

  // --- push tokens: BOTH sides, so the union is observable ------------------
  writes[`pushTokens/${L}`] = {
    tokA: { platform: 'web', updatedAt: now - 11_000 },
    tokB: { platform: 'ios', updatedAt: now - 12_000 },
  };
  writes[`pushTokens/${S}`] = { tokC: { platform: 'web', updatedAt: now - 13_000 } };

  // --- mailboxes: two transient, and every durable family ------------------
  writes[`knocks/${L}`] = { [F1]: { ts: now - 3_000 } };
  writes[`calls/${L}`] = { ts: now - 1_500, peer: F1 };
  // followRequests is seeded on BOTH sides at the same key — the deliberate
  // mailbox-collision, which is a real loss and has to appear in the report.
  writes[`followRequests/${L}`] = { [P2]: { ts: now - 4_000, side: 'L' } };
  writes[`followRequests/${S}`] = { [P2]: { side: 'S' } };
  writes[`followGrants/${L}`] = { [F1]: { ts: now - 4_100 } };
  writes[`revocations/${L}`] = { [C1]: { ts: now - 4_200 } };
  // A pending invite to a group L never joined: `groups` cannot see this gid,
  // so it is the case the enumerator reads out of the mailbox itself.
  writes[`pendingInvites/${L}`] = { [GD]: { ts: now - 4_300, by: P2 } };
  writes[`pendingInvitesByGroup/${GD}`] = { [L]: true };

  // --- canvases: all three of merge.js's branches ---------------------------
  writes[`canvases/${pairKey(L, P1)}`] = { bg: 'grid-dark', strokes: { s1: { pts: [1, 2] } } };
  writes[`canvases/${pairKey(L, C1)}`] = { bg: 'grid-light', strokes: { s1: { pts: [3, 4] } } };
  writes[`canvases/${pairKey(S, C1)}`] = { bg: 'plain', strokes: { s1: { pts: [5, 6] } } };
  writes[`canvases/${pairKey(L, S)}`] = { bg: 'between', strokes: { s1: { pts: [7, 8] } } };

  // --- location: nulled by the enumerator on a merge, never carried --------
  writes[`locations/${L}`] = { lat: 51.5, lng: -0.12, updatedAt: now - 2_500 };
  for (const gid of [GA, GB, GC]) {
    writes[`locationCells/${gid}`] = { [L]: { cell: 'gcpuvxr', updatedAt: now - 2_500 } };
  }

  // --- telegram, opt-in -----------------------------------------------------
  // The loser's reverse index is seeded in EVERY shape: it is what sends
  // merge.js:385 into the teardown branch at all. What varies is who the
  // forward mapping says it belongs to.
  if (telegram) {
    writes[`telegramByUid/${L}`] = { tgId, chatId: tgId, linkedAt: now - 100_000 };
    if (shape === 'loser') {
      writes[`telegramUsers/${tgId}`] = { uid: L, chatId: tgId, linkedAt: now - 100_000 };
    } else if (shape === 'third-party') {
      // P2 is in the fixture but not in the merge, and it gets its own reverse
      // index so P2 itself is self-consistent — the asymmetry is L's alone.
      writes[`telegramUsers/${tgId}`] = { uid: P2, chatId: tgId, linkedAt: now - 200_000 };
      writes[`telegramByUid/${P2}`] = { tgId, chatId: tgId, linkedAt: now - 200_000 };
    } else if (shape === 'no-uid') {
      writes[`telegramUsers/${tgId}`] = { chatId: tgId, linkedAt: now - 100_000 };
    } else if (shape === 'survivor') {
      writes[`telegramUsers/${tgId}`] = { uid: S, chatId: tgId, linkedAt: now - 200_000 };
      writes[`telegramByUid/${S}`] = { tgId, chatId: tgId, linkedAt: now - 200_000 };
    }
    // 'absent': the reverse index above points at nothing. The teardown nulls
    // the mapping path anyway — deliberately unconditional, so a residue null
    // is never conditioned on a read (telegram-link-write.js:77).
  }

  return { writes, uids, gids, codes, tokens, tgId, canvasKeys: fixtureCanvasKeys({ tag }), notes: fixtureNotes() };
}

/**
 * What the operator should know before and after, printed by both CLIs.
 *
 * A refusal shape is deliberately INCONSISTENT — that is the state it exists to
 * seed — so the "no errors before the merge" line is false for it and has to be
 * replaced rather than left standing. Unsaid, the operator reads a legitimate
 * integrity ERROR as a defect and stops.
 * @param {{ mappingShape?: string }} [opts]
 */
export function fixtureNotes({ mappingShape = 'loser' } = {}) {
  if (mappingShape !== 'loser') {
    return [
      'Accounts are SYNTHETIC and no client ever holds them, so G3 and G6 have no author on this leg.',
      'Expect exactly one integrity finding per seeded uid: auth-missing, severity INFO (an RTDB user with no Auth record).',
      `This is the "${mappingShape}" mapping shape, so the seed is deliberately inconsistent: EXPECT telegram-mapping-asymmetric (ERROR) against the loser BEFORE the merge${mappingShape === 'no-uid' ? ', plus telegram-mapping-dangling (WARN) for the mapping node itself' : ''}. That is the state being tested, not a defect.`,
      'The teardown must REFUSE: expect a telegram-mapping-not-owned conflict in the preview and NO loss line saying the mapping was dropped. The mapping must still be there afterwards.',
      'Verify with the same --mapping-shape you seeded, or the claims describe a different merge than the one you ran.',
      'ops/restore-preimage.js is purge-shaped (it assumes every dumped path was NULLED) — do not read a merge dump with it. Verify with ops/verify-merge.js.',
    ];
  }
  return [
    'Accounts are SYNTHETIC and no client ever holds them, so G3 and G6 have no author on this leg.',
    'Expect exactly one integrity finding per seeded uid: auth-missing, severity INFO (an RTDB user with no Auth record).',
    'Expect NO integrity errors or warnings before the merge — the seed is self-consistent. Anything after it is the merge.',
    'The shared group is a COLLISION. Leave its tick alone and it resolves "survivor\'s record kept"; TICK it (M8) and the loser\'s per-group name is adopted — then verify with `ops/verify-merge.js --adopt`, or that one claim reports a FALSE failure (M13). The unconditional per-group name carry comes from the loser-ONLY group either way.',
    'ops/restore-preimage.js is purge-shaped (it assumes every dumped path was NULLED) — do not read a merge dump with it. Verify with ops/verify-merge.js.',
  ];
}

/**
 * Every path the fixture owns, nulled — including the ones the MERGE creates,
 * which the seed never wrote. Always includes the telegram paths so one cleanup
 * covers a run of either variant.
 * @param {{ tag: string }} opts
 */
export function buildFixtureCleanup({ tag }) {
  // Every shape's paths, not just the default one's: a run seeded with
  // --mapping-shape third-party owns telegramByUid/{P2}, and a cleanup derived
  // from the loser shape alone would leave a live-looking Telegram mapping
  // behind on a project someone else is about to read an integrity report on.
  /** @type {Record<string, unknown>} */
  const seeded = {};
  for (const mappingShape of MAPPING_SHAPES) {
    Object.assign(seeded, buildMergeFixture({ tag, now: 0, telegram: true, mappingShape }).writes);
  }
  const { L, S, P1 } = fixtureUids(tag);
  const tgId = fixtureTgId(tag);
  /** @type {Record<string, null>} */
  const out = {};
  for (const path of Object.keys(seeded)) out[path] = null;
  // Created by the merge, so absent from the seed's write-set.
  out[`canvases/${pairKey(S, P1)}`] = null;
  out[`followGrants/${S}`] = null;
  out[`revocations/${S}`] = null;
  out[`pendingInvites/${S}`] = null;
  out[`telegramByUid/${S}`] = null;
  out[`telegramUsers/${tgId}`] = null;
  out[`locations/${S}`] = null;
  return out;
}

/**
 * @typedef {{
 *   path: string,
 *   kind: 'gone' | 'present' | 'equals' | 'keys',
 *   value?: unknown,
 *   why: string,
 * }} Assertion
 */

/**
 * What the database must look like once the merge has run. Grouped in the order
 * the smoke test asks for it: contacts, groups, per-group names, canvases, push
 * tokens, then the loser's own nodes.
 *
 * `mappingShape` must match the shape the fixture was SEEDED with: it decides
 * whether the forward mapping is claimed gone or claimed still standing, and
 * reading one back against the other is the cry-wolf failure (2dec78c), not a
 * discovery.
 *
 * `adopt` must match what the operator TICKED at execute time, and it is the
 * same kind of argument for the same reason (M13). The shared group is the
 * fixture's only collision, so one boolean covers it: false claims the
 * survivor's per-group name, true claims the loser's. Passing the wrong one
 * reports a false failure on exactly that claim — which is what happened on
 * the dev project on 2026-08-05, before this option existed.
 * @param {{ tag: string, telegram?: boolean, repoint?: boolean, mappingShape?: string, adopt?: boolean }} opts
 * @returns {Assertion[]}
 */
export function buildMergeAssertions({ tag, telegram = false, repoint = false, mappingShape = 'loser', adopt = false }) {
  const shape = assertMappingShape({ mappingShape, telegram, repoint });
  const { L, S, P1, P2, F1, C1 } = fixtureUids(tag);
  const { GA, GB, GC, GD } = fixtureGids(tag);
  const codes = fixtureCodes(tag);
  const { inviteL } = fixtureTokens(tag);
  const tgId = fixtureTgId(tag);
  /** @type {Assertion[]} */
  const a = [];
  /** @type {(path: string, kind: Assertion['kind'], why: string, value?: unknown) => void} */
  const add = (path, kind, why, value) => a.push(value === undefined ? { path, kind, why } : { path, kind, value, why });

  // --- contacts -------------------------------------------------------------
  add(`users/${S}/followers/${F1}`, 'equals', 'F1 followed only the loser, so the contact carries', codes.F1);
  add(`users/${S}/followerNames/${F1}`, 'equals', "the follower's published name carries with them", 'F1 pub');
  add(`userPrefs/${S}/following/${P1}`, 'equals', "the loser's card for P1 carries, private label and all", { code: codes.P1, label: 'P1 (L note)' });
  add(`userPrefs/${F1}/following/${S}`, 'equals', "F1's card is repointed: the CODE becomes the survivor's, F1's own nickname stays", { code: codes.S, label: 'L (F1 note)' });
  add(`userPrefs/${F1}/following/${L}`, 'gone', 'the backref to the loser is residue and must be nulled');
  add(`users/${P1}/followers/${S}`, 'equals', 'the loser followed P1, so the survivor appears in P1 followers', codes.S);
  add(`users/${P1}/followerNames/${S}`, 'equals', 'the name the loser published to P1 is repointed, not dropped', 'L pub');
  add(`users/${P1}/followers/${L}`, 'gone', 'residue on a peer record');
  add(`users/${P1}/followerNames/${L}`, 'gone', 'residue on a peer record');
  add(`users/${C1}/followers/${L}`, 'gone', 'residue, even though C1 followed both');
  add(`userPrefs/${C1}/following/${L}`, 'gone', 'residue, even though C1 followed both');
  add(`users/${S}/followers/${C1}`, 'equals', 'C1 followed both: contact-collapsed, survivor entry kept', codes.C1);
  add(`userPrefs/${S}/following/${C1}`, 'equals', 'both followed C1: contact-collapsed, survivor card kept', { code: codes.C1, label: 'C1 (S note)' });
  add(`userPrefs/${C1}/following/${S}`, 'equals', "C1 followed both, so C1's own card is untouched", { code: codes.S, label: 'S (C1 note)' });

  // --- groups and per-group names ------------------------------------------
  add(`groups/${GA}/members/${S}`, 'equals', "the loser-only group carries its WHOLE member record — this is the per-group displayName carry", { displayName: 'L in GA', role: 'member' });
  add(`groups/${GA}/members/${L}`, 'gone', 'the loser membership is nulled by the shared enumerator');
  add(`users/${S}/groups/${GA}`, 'present', 'the enumeration entry carries, or the group is invisible in the survivor nav');
  add(
    `groups/${GB}/members/${S}/displayName`,
    'equals',
    adopt
      ? "the shared group is a collision and the preview's tick ADOPTED the loser's per-group name (M8)"
      : "the shared group is a collision and, with its tick left alone, the survivor's record wins",
    adopt ? 'L in GB' : 'S in GB',
  );
  add(`groups/${GB}/members/${L}`, 'gone', 'the loser membership in the shared group is nulled');
  add(`users/${S}/groups/${GB}`, 'present', "the loser's visit was the more recent, so its enumeration entry wins");
  add(`groups/${GC}/ownerId`, 'equals', 'ownership of a group the loser OWNED follows to the survivor', S);
  add(`groups/${GC}/members/${S}`, 'equals', "the owned group's member record carries, role included", { displayName: 'L in GC', role: 'owner' });
  add(`groups/${GC}/members/${L}`, 'gone', 'the loser membership is nulled');
  add(`groups/${GC}/name`, 'present', 'a MERGE does not delete an owned group — the contrast with a purge, which nulls it wholesale');
  add(`users/${S}/groups/${GC}`, 'present', 'the enumeration entry for the owned group carries');

  // --- mailboxes ------------------------------------------------------------
  add(`pendingInvites/${S}/${GD}`, 'present', 'a durable mailbox entry unions onto the survivor');
  add(`pendingInvitesByGroup/${GD}/${S}`, 'equals', 'and its by-group mirror moves with it — moving one without the other is the asymmetry integrity.js flags', true);
  add(`pendingInvitesByGroup/${GD}/${L}`, 'gone', 'the by-group mirror for the loser is nulled from the mailbox-derived gid');
  add(`pendingInvites/${L}`, 'gone', 'the loser mailbox is nulled');
  add(`knocks/${L}`, 'gone', 'knocks are dropped as transient (D3), not carried');
  add(`calls/${L}`, 'gone', 'calls are dropped as transient (D3) — merging them resurrects stuck calls');
  add(`followGrants/${S}/${F1}`, 'present', 'a durable mailbox entry unions onto the survivor');
  add(`followGrants/${L}`, 'gone', 'the loser mailbox is nulled');
  add(`revocations/${S}/${C1}`, 'present', 'a revocation blocks re-following, so it is durable and unions');
  add(`revocations/${L}`, 'gone', 'the loser mailbox is nulled');
  add(`followRequests/${S}/${P2}`, 'equals', 'both held the same key: mailbox-collision, survivor entry kept and the loser entry reported as a loss', { side: 'S' });
  add(`followRequests/${L}`, 'gone', 'the loser mailbox is nulled');

  // --- identity -------------------------------------------------------------
  add(`users/${S}/invites/${inviteL}`, 'present', 'the invite token moves to the survivor');
  add(`inviteIndex/${inviteL}`, 'equals', 'and its index entry keeps the full {scope,ownerPath,ownerUid} shape — a missing scope silently kills the invite preview (the 2fcc51f fix, on live data)', { scope: 'personal', ownerPath: `users/${S}/invites/${inviteL}`, ownerUid: S });
  add(`codeIndex/${codes.L}`, 'gone', "the loser share code is freed for reuse (D1)");
  add(`codeIndex/${codes.S}`, 'equals', 'the survivor code is untouched', S);
  add(`users/${S}/presence/lastSeen`, 'present', "the loser's lastSeen was the newer, so it is carried");

  // --- push tokens ----------------------------------------------------------
  add(`pushTokens/${S}`, 'keys', "both devices stay reachable: the loser tokens union with the survivor's", ['tokA', 'tokB', 'tokC']);
  add(`pushTokens/${L}`, 'gone', 'the loser push-token node goes — the G5 family, on the merge path');

  // --- canvases -------------------------------------------------------------
  add(`canvases/${pairKey(S, P1)}/bg`, 'equals', 'canvas settings carry to the survivor-side key', 'grid-dark');
  add(`canvases/${pairKey(S, P1)}/strokes`, 'gone', 'strokes are NEVER carried — the drawing is lost, and the loss report says so');
  add(`canvases/${pairKey(L, P1)}`, 'gone', 'the loser-side canvas is deleted once carried');
  add(`canvases/${pairKey(S, C1)}/bg`, 'equals', "canvas-collision: the survivor's drawing is kept untouched", 'plain');
  add(`canvases/${pairKey(L, C1)}`, 'gone', "and the loser's is deleted");
  add(`canvases/${pairKey(L, S)}`, 'gone', 'a canvas BETWEEN the two merging accounts is deleted, not moved');

  // --- location -------------------------------------------------------------
  add(`locations/${L}`, 'gone', 'the enumerator nulls a location fix on a merge exactly as on a purge');
  add(`locations/${S}`, 'gone', 'and it is NOT carried to the survivor — the one family an operator may expect to move');
  for (const gid of [GA, GB, GC]) {
    add(`locationCells/${gid}/${L}`, 'gone', 'the coarse cell goes with the location fix');
  }

  // --- the loser's own subtrees --------------------------------------------
  add(`users/${L}`, 'gone', 'the loser account is gone');
  add(`userPrefs/${L}`, 'gone', "the loser prefs are discarded — the survivor's win wholesale");

  // --- telegram, when seeded ------------------------------------------------
  // buildLinkWrites (telegram-link-write.js:188-192) writes FIVE paths, and every
  // one is load-bearing. Two integrity checks are ERRORS and both key off the
  // prefs side: `telegram-prefs-disagree` when `userPrefs/{uid}/telegram/tgId`
  // disagrees with the reverse index, and `telegram-channel-unroutable` when
  // notifyChannel is telegram with no mapping behind it. Asserting only the
  // mapping node would leave the half that fails loudest unchecked.
  if (telegram && repoint) {
    add(`telegramUsers/${tgId}/uid`, 'equals', 'link via merge repoints the mapping at the survivor — this is the non-lossy link', S);
    add(`telegramUsers/${tgId}/chatId`, 'equals', 'the chatId comes from the PRIOR mapping, not from the fallback', tgId);
    add(`telegramUsers/${tgId}/linkedAt`, 'present', 'the mapping is re-stamped at link time');
    add(`telegramByUid/${S}`, 'equals', 'the reverse index is rebuilt exactly — it carries no timestamp of its own', { tgId, chatId: tgId });
    add(`telegramByUid/${L}`, 'gone', 'the loser reverse index is nulled either way');
    add(`userPrefs/${S}/telegram/tgId`, 'equals', 'the prefs side must agree with the reverse index — disagreement is `telegram-prefs-disagree`, an integrity ERROR', tgId);
    add(`userPrefs/${S}/telegram/linkedAt`, 'present', 'stamped alongside the mapping');
    add(`userPrefs/${S}/notifyChannel`, 'equals', 'the survivor is switched onto telegram — and it is routable, because the mapping above exists (`telegram-channel-unroutable` is an ERROR)', 'telegram');
  } else if (telegram) {
    // The loser's reverse index comes down in EVERY shape — it is the loser's,
    // and merge.js:390 nulls it outside the teardown's verdict entirely. What
    // the shape decides is whether the forward mapping survives.
    add(`telegramByUid/${L}`, 'gone', 'the loser reverse index is nulled either way');
    if (shape === 'loser' || shape === 'absent') {
      // 'absent' reads identically: the teardown nulls a path that held nothing.
      // The difference between the two lives in the seed and in the preview's
      // loss line, and no read-back can see it.
      add(`telegramUsers/${tgId}`, 'gone', 'without a repoint the mapping must come down, or the next Mini App open bootstraps onto a dead uid');
      add(`telegramByUid/${S}`, 'gone', 'a plain merge does NOT hand the survivor the Telegram link — that is what link via merge is for');
    } else if (shape === 'third-party') {
      add(`telegramUsers/${tgId}/uid`, 'equals', 'the mapping belongs to an account this merge is NOT destroying, so the teardown must refuse it — deleting it would unlink a live third party (R2)', P2);
      add(`telegramByUid/${P2}/tgId`, 'equals', "and P2's Telegram keeps working, which is what the refusal's loss line promises", tgId);
      add(`telegramByUid/${S}`, 'gone', 'a plain merge does NOT hand the survivor the Telegram link');
    } else if (shape === 'no-uid') {
      add(`telegramUsers/${tgId}`, 'present', 'a mapping node carrying no uid has no provable owner, so it is refused and left standing rather than deleted on a guess');
      add(`telegramUsers/${tgId}/uid`, 'gone', 'and it still carries no uid — the merge did not adopt it either');
      add(`telegramByUid/${S}`, 'gone', 'a plain merge does NOT hand the survivor the Telegram link');
    } else if (shape === 'survivor') {
      add(`telegramUsers/${tgId}/uid`, 'equals', "the survivor holds the mapping and survives the merge, so tearing it down would unlink an account that is still here", S);
      add(`telegramByUid/${S}/tgId`, 'equals', "the survivor's own reverse index is untouched — this is the one refusal that is right rather than merely safe", tgId);
    }
    add(`userPrefs/${S}/notifyChannel`, 'gone', 'and it is not switched onto a channel it cannot receive on');
  }

  return a;
}

/**
 * RTDB cannot store an empty object, so one reads back as absent.
 * @param {unknown} v
 */
const isEmptyish = (v) => v === null || v === undefined
  || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

/**
 * Order-INSENSITIVE deep equality for records, order-SENSITIVE for arrays.
 *
 * RTDB returns an object's keys in its own order, not the order the write used,
 * so a JSON.stringify comparison reports a false miss on values that are
 * identical. Observed on the first live run of the merge leg: `inviteIndex` came
 * back `{ownerPath, ownerUid, scope}` against an expectation written
 * `{scope, ownerPath, ownerUid}` and was reported owed, on a merge that had done
 * exactly the right thing. A verifier that cries wolf on a correct merge is
 * worse than no verifier — it sends the operator hunting a defect that is not
 * there. Arrays stay order-sensitive: order is meaningful in a list and not in a
 * record.
 * @param {unknown} a @param {unknown} b @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const isArr = Array.isArray(a);
  if (isArr !== Array.isArray(b)) return false;
  if (isArr) {
    const x = /** @type {unknown[]} */ (a);
    const y = /** @type {unknown[]} */ (b);
    return x.length === y.length && x.every((v, i) => deepEqual(v, y[i]));
  }
  const x = /** @type {Record<string, unknown>} */ (a);
  const y = /** @type {Record<string, unknown>} */ (b);
  const xk = Object.keys(x);
  return xk.length === Object.keys(y).length
    && xk.every((k) => Object.prototype.hasOwnProperty.call(y, k) && deepEqual(x[k], y[k]));
}

/**
 * Render for a FAILURE line, keys sorted. Two values that differ only in key
 * order are now equal, so anything printed here is a genuine difference — and
 * sorting both sides is what makes that difference findable by eye instead of
 * leaving the reader diffing two shuffled objects.
 * @param {unknown} v @returns {string}
 */
function stableShow(v) {
  if (v === undefined) return 'undefined';
  return JSON.stringify(v, (_key, value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    const obj = /** @type {Record<string, unknown>} */ (value);
    /** @type {Record<string, unknown>} */
    const sorted = {};
    for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
    return sorted;
  });
}

/**
 * One assertion against one live value. Pure, so the verifier's output is
 * pinned by tests rather than discovered against live data.
 * @param {Assertion} assertion
 * @param {unknown} live
 * @returns {{ ok: boolean, detail: string }}
 */
export function checkAssertion(assertion, live) {
  const show = stableShow;
  switch (assertion.kind) {
    case 'gone':
      return live === null || live === undefined
        ? { ok: true, detail: 'gone' }
        : { ok: false, detail: `still holds ${show(live)}` };
    case 'present':
      return isEmptyish(live)
        ? { ok: false, detail: 'absent' }
        : { ok: true, detail: `present (${show(live)})` };
    case 'keys': {
      const want = [...(/** @type {string[]} */ (assertion.value))].sort();
      const got = isEmptyish(live) ? [] : Object.keys(/** @type {object} */ (live)).sort();
      return want.length === got.length && want.every((k, i) => k === got[i])
        ? { ok: true, detail: `keys ${got.join(', ')}` }
        : { ok: false, detail: `want keys [${want.join(', ')}], got [${got.join(', ')}]` };
    }
    case 'equals':
    default:
      return deepEqual(live, assertion.value)
        ? { ok: true, detail: `= ${show(live)}` }
        : { ok: false, detail: `want ${show(assertion.value)}, got ${show(live)}` };
  }
}
