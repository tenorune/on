#!/usr/bin/env node
// functions/ops/restore-preimage.js — rebuild an account from a pre-image dump.
//
// The panel has no restore route and deliberately will not grow one: README's
// "Reading a pre-image back" says restoring is a hand-written update() built
// from `.preImage`, run after a human has decided which subtrees should come
// back, because a blind replay resurrects paths other operations have
// legitimately changed since. This is that hand-written update with the
// judgement calls made explicit and checkable instead of retyped into a shell
// one-liner under time pressure. Every decision is still the operator's; what
// this removes is the arithmetic, not the choice.
//
// DRY RUN by default: it prints a verdict per path and writes nothing. With
// --yes it issues ONE atomic root update — the same all-or-nothing shape the
// purge used — preceded by its own pre-image dump, so undoing a purge is
// itself as auditable as the purge was.
//
// The dry run doubles as the purge's RESIDUE SWEEP (smoke-test step 9). It
// re-reads every dumped path live, so it can answer "did the deletes actually
// land" for the families it will not restore — locations/{uid},
// locationCells/{gid}/{uid}, and an owned group's whole locationCells/{gid}
// including other members' cells. Running it with no flags writes nothing and
// prints that sweep; it does not require any intent to restore.
//
// Lives under ops/ so it is never deployed: firebase.json ignores `ops/**`, and
// tests/firebaseConfig.test.js pins that exclusion.
//
// Usage:
//   cd functions
//   GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)" \
//   node ops/restore-preimage.js --file .ops-audit/<ts>-purge-<uid>.json \
//     --project <dev-project-id> --prod-project <prod-project-id> [--yes]
//
// WHAT A PRE-IMAGE CANNOT GIVE BACK — read before trusting a restore:
//
//   * canvas strokes. Never captured (they are the only unbounded node), so a
//     destroyed drawing is gone. Only `bg` is recoverable, opt-in.
//   * anything the purge did not itself write. The dump is the purge's
//     write-set, so a CASCADE the purge merely triggered is outside it. The
//     live case: purging a group's OWNER deletes `groups/{gid}` wholesale, and
//     every other member's client then deletes its own
//     `users/{member}/groups/{gid}` enumeration entry (js/groupNav.ts:250-258,
//     js/groupContext.ts:1499-1508) because an owner has no permission to
//     clear another user's record. Those entries were never in the write-set,
//     so restoring the group leaves it real, membered, and INVISIBLE in every
//     other member's nav — integrity.js:103's `group-enumeration-missing`.
//     --heal-group-enumeration rebuilds them from the restored member list.
//     Device-verified 2026-08-02.
//   * the Auth record, when a purge was run with `deleteAuthRecord`.
//
// Flags: --restore-transient (locations/knocks/calls), --restore-canvas-bg
// (bg leaf only), --heal-group-enumeration (the cascade repair above), and —
// for a users/ or userPrefs/ node that exists again because a client
// republished after the purge — --merge-account (captured values win, anything
// written since is kept) or --replace-account (overwrite it wholesale).
import * as nodeFs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { makeOpsDeps } from './deps.js';
import { writeAuditRecord, appendAuditOutcome } from './audit.js';

// Same locally-typed view of the global the rest of ops/ uses: the ambient
// process shim (types/app.d.ts) types only .env, and this is a Node CLI.
const proc = /** @type {{ argv: string[]; env: Record<string, string | undefined>; exit: (code?: number) => never }} */ (
  /** @type {unknown} */ (process)
);

const DEFAULT_REGION = 'europe-west1';

// Transient by the spec's own durability split (D3): a position fix and the
// knock/call mailboxes are stale within seconds, so restoring an hours-old copy
// republishes a lie. Clients rewrite these on their own.
const TRANSIENT = /^(knocks|calls|locations|locationCells)(\/|$)/;

// Global keys that may have been claimed since the purge. Never overwritten
// automatically: doing so takes a live third account's Telegram or share code,
// which is the same failure buildMappingTeardown exists to prevent on the way
// out.
const GUARDED_INDEX = /^(codeIndex|inviteIndex|telegramUsers|telegramByUid)(\/|$)/;

// The account's own two nodes. A multi-path update SETS the whole node rather
// than deep-merging, so restoring one over a recreated node drops whatever it
// holds now — hence the explicit merge/replace choice.
const OWN_NODE = /^(users|userPrefs)\/[^/]+$/;

const CANVAS = /^canvases(\/|$)/;

/** @param {unknown} a @param {unknown} b */
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * @typedef {{
 *   transient?: boolean,
 *   canvasBg?: boolean,
 *   replaceAccount?: boolean,
 *   mergeAccount?: boolean,
 *   uid?: string,
 * }} RestoreOptions
 */

/**
 * `residue`/`holds` are set only by the transient branch — the sweep reads them
 * and nothing else does, so a non-transient verdict cannot pollute the result.
 *
 * @typedef {{
 *   verdict: string,
 *   write?: [string, unknown],
 *   why: string,
 *   residue?: 'gone' | 'present',
 *   holds?: string[],
 * }} Decision
 */

/**
 * @typedef {{ path: string, verdict: string, why: string, residue?: 'gone' | 'present', holds?: string[] }} DecisionRow
 */

/**
 * Deep-merge the captured value over what is live, keeping any branch the live
 * node has that the dump does not.
 *
 * The asymmetry is the point. Where both sides hold a leaf the DUMP wins: it is
 * pre-purge truth, and the live value is whatever republished itself
 * afterwards — typically a still-open client's cached subset (the G3 window:
 * revoking does not evict a session, so a client keeps writing for up to its
 * ID token's remaining hour). Where only the live side has a branch it
 * SURVIVES, because it postdates the purge and nothing in the dump can speak
 * to it.
 *
 * @param {unknown} live @param {unknown} dumped @returns {unknown}
 */
export function deepMergeOverLive(live, dumped) {
  if (!isPlainObject(live) || !isPlainObject(dumped)) return dumped;
  /** @type {Record<string, unknown>} */
  const out = { ...live };
  for (const key of Object.keys(dumped)) {
    out[key] = key in live ? deepMergeOverLive(live[key], dumped[key]) : dumped[key];
  }
  return out;
}

/**
 * Decide what to do with one dumped path, given what is live there NOW.
 * Pure, so the whole decision table is testable without a database.
 *
 * @param {string} path
 * @param {unknown} dumped the value from `.preImage`
 * @param {unknown} live the value in the database right now
 * @param {RestoreOptions} [opts]
 * @returns {Decision}
 */
export function classify(path, dumped, live, opts = {}) {
  if (dumped === null || dumped === undefined) {
    return { verdict: 'skip-absent', why: 'nothing was there before the purge either' };
  }

  if (CANVAS.test(path)) {
    // The dump holds `bg` plus a MARKER STRING in `strokes` (audit.js's
    // STROKES_OMITTED). Replaying the node whole writes that sentence into the
    // database as if it were the drawing.
    const bg = isPlainObject(dumped) ? dumped.bg : undefined;
    if (!opts.canvasBg) {
      return { verdict: 'skip-canvas', why: 'strokes were never captured; a whole-node replay would write the "not captured" marker into the database' };
    }
    if (bg === undefined || bg === null) {
      return { verdict: 'skip-canvas', why: 'no bg was captured, so there is nothing restorable here' };
    }
    if (!same(live, null)) {
      return { verdict: 'conflict', why: 'the canvas exists again — restoring bg would overwrite the current one' };
    }
    return { verdict: 'restore', write: [`${path}/bg`, bg], why: 'bg leaf only; the drawing is gone for good' };
  }

  if (TRANSIENT.test(path) && !opts.transient) {
    // Not restored — but the live value was read to get here, and throwing it
    // away is how this branch used to make the purge's least-observed families
    // unobservable. These are exactly the paths smoke-test step 9's residue
    // sweep asks about (locations/{uid}, locationCells/{gid}/{uid}, and an
    // owned group's whole locationCells/{gid} including other members' cells),
    // and the answer is already in hand. Report it; still write nothing.
    const gone = same(live, null);
    return {
      verdict: 'skip-transient',
      residue: gone ? 'gone' : 'present',
      holds: isPlainObject(live) ? Object.keys(live) : [],
      why: gone
        ? 'not restored (clients republish it) — and the path is EMPTY now, so the purge cleared it'
        : `not restored (clients republish it) — but the path STILL HOLDS ${JSON.stringify(live).slice(0, 120)}`,
    };
  }

  if (same(live, dumped)) {
    return { verdict: 'already-there', why: 'the live value already matches the dump' };
  }

  if (GUARDED_INDEX.test(path)) {
    if (same(live, null)) return { verdict: 'restore', write: [path, dumped], why: 'index entry is free' };
    // A mapping that already points back at THIS account is not a hijack — it
    // is the deterministic-uid bootstrap having re-stamped it, usually with a
    // newer linkedAt. Overwriting it with the older captured value gains
    // nothing and loses the fresher timestamp.
    const holder = typeof live === 'string' ? live : (isPlainObject(live) ? live.uid : undefined);
    const liveTgId = isPlainObject(live) ? live.tgId : undefined;
    const dumpedTgId = isPlainObject(dumped) ? dumped.tgId : undefined;
    if (holder === opts.uid || (path.startsWith('telegramByUid/') && liveTgId === dumpedTgId)) {
      return { verdict: 'already-there', why: 'already points at this account (re-stamped since the purge); the live value is the fresher one' };
    }
    return { verdict: 'conflict', why: `this global key now holds ${JSON.stringify(live)} — a different account claimed it; restoring would take it from them` };
  }

  if (!same(live, null)) {
    if (OWN_NODE.test(path)) {
      if (opts.mergeAccount) {
        const kept = isPlainObject(live) && isPlainObject(dumped)
          ? Object.keys(live).filter((k) => !(k in dumped))
          : [];
        return {
          verdict: 'restore',
          write: [path, deepMergeOverLive(live, dumped)],
          why: `merged: captured values win, ${kept.length ? `post-purge key(s) kept: ${kept.join(', ')}` : 'no post-purge-only keys to keep'}`,
        };
      }
      if (!opts.replaceAccount) {
        return { verdict: 'conflict', why: 'the node exists again (a client wrote to it after the purge) — --merge-account restores the captured values while keeping anything written since; --replace-account overwrites the node wholesale' };
      }
      return { verdict: 'restore', write: [path, dumped], why: 'replacing the recreated node wholesale, as instructed — anything written since the purge is dropped' };
    }
    return { verdict: 'conflict', why: `something changed this path since the purge (live: ${JSON.stringify(live).slice(0, 80)})` };
  }

  return { verdict: 'restore', write: [path, dumped], why: 'path is empty; restoring the captured value' };
}

/**
 * RTDB refuses a multi-path update naming both a path and a descendant of it
 * ("values argument contains a path X that is ancestor of another path Y"), and
 * a purge write-set routinely contains both: buildExpungeWrites nulls an OWNED
 * group wholesale AND the shared enumerator emits the per-uid membership row
 * under it. The purge survives that because rootUpdate drops the redundant
 * nulls before the wire (telegram-auth.js:361-374); a restore has to do the
 * mirror-image collapse or the SDK rejects the whole payload.
 *
 * The DESCENDANT is dropped, never the ancestor: both values were captured at
 * the same instant, so the ancestor's whole-node value already contains the
 * descendant's — and it also carries what the descendant cannot, namely the
 * other members' rows in a group deleted for everyone. Containment is verified
 * rather than assumed; disagreement means the two came from different states,
 * where dropping either loses data, so it throws instead.
 *
 * @param {Record<string, unknown>} writes
 * @returns {{ writes: Record<string, unknown>, dropped: Array<{ path: string, under: string }> }}
 */
export function collapseRedundant(writes) {
  const keys = Object.keys(writes);
  /** @type {Record<string, unknown>} */
  const kept = {};
  /** @type {Array<{ path: string, under: string }>} */
  const dropped = [];

  for (const path of keys) {
    const ancestor = keys.find((a) => a !== path && path.startsWith(`${a}/`));
    if (ancestor === undefined) { kept[path] = writes[path]; continue; }

    /** @type {unknown} */
    let node = writes[ancestor];
    for (const seg of path.slice(ancestor.length + 1).split('/')) {
      if (!isPlainObject(node)) { node = undefined; break; }
      node = node[seg];
    }
    if (!same(node, writes[path])) {
      throw new Error(
        `refusing to restore: ${path} is nested under ${ancestor}, which RTDB will not accept in one update, `
        + 'but the two captured values disagree, so dropping either one loses data.\n'
        + `  under the ancestor: ${JSON.stringify(node)}\n`
        + `  at the path       : ${JSON.stringify(writes[path])}\n`
        + 'Restore them as two separate updates by hand.',
      );
    }
    dropped.push({ path, under: ancestor });
  }
  return { writes: kept, dropped };
}

/**
 * @param {Record<string, unknown>} preImage
 * @param {Record<string, unknown>} liveValues the same keys, current values
 * @param {RestoreOptions} [opts]
 * @returns {{
 *   decisions: DecisionRow[],
 *   writes: Record<string, unknown>,
 *   dropped: Array<{ path: string, under: string }>,
 * }}
 */
export function planRestore(preImage, liveValues, opts = {}) {
  /** @type {DecisionRow[]} */
  const decisions = [];
  /** @type {Record<string, unknown>} */
  const raw = {};
  for (const path of Object.keys(preImage)) {
    const d = classify(path, preImage[path], liveValues[path] ?? null, opts);
    decisions.push(d.residue === undefined
      ? { path, verdict: d.verdict, why: d.why }
      : { path, verdict: d.verdict, why: d.why, residue: d.residue, holds: d.holds ?? [] });
    if (d.write) raw[d.write[0]] = d.write[1];
  }
  const { writes, dropped } = collapseRedundant(raw);
  for (const { path, under } of dropped) {
    const d = decisions.find((x) => x.path === path);
    if (d) {
      d.verdict = 'folded';
      d.why = `restored as part of ${under}, which is being written whole — RTDB rejects an update naming both`;
    }
  }
  return { decisions, writes, dropped };
}

/**
 * The residue sweep, over a plan's decision rows.
 *
 * `clean` is a claim about the paths the DUMP names, and nothing wider: a
 * family the purge never wrote is not in the write-set, so it is not swept.
 * That is the same boundary G4 draws for the restore itself — the dump is the
 * purge's write-set, never a census of the database.
 *
 * @param {DecisionRow[]} decisions
 * @returns {{ swept: number, clean: boolean, present: Array<{ path: string, holds: string[] }> }}
 */
export function summarizeResidue(decisions) {
  const swept = decisions.filter((d) => d.residue !== undefined);
  const present = swept
    .filter((d) => d.residue === 'present')
    .map((d) => ({ path: d.path, holds: d.holds ?? [] }));
  return { swept: swept.length, clean: present.length === 0, present };
}

/**
 * Members of a restored group whose nav-enumeration entry may need rebuilding.
 * See the cascade note in this file's header for why the dump cannot hold them.
 *
 * `groupNodes` is each group's FINAL state — the value being restored now, or
 * the value already live if an earlier run restored it. Deriving candidates
 * from the payload alone would make this a silent no-op on exactly the run an
 * operator reaches for it: by then the group is `already-there`, so it is not
 * in the payload at all.
 *
 * Returns candidate paths only. The caller reads them live and hands them to
 * buildEnumerationRepair, so "never clobber an existing entry" is enforced
 * against real data rather than assumed from the dump.
 *
 * @param {Record<string, unknown>} groupNodes `groups/{gid}` -> final value
 * @param {Record<string, unknown>} writes the restore payload built so far
 * @returns {string[]}
 */
export function enumerationCandidates(groupNodes, writes) {
  /** @type {string[]} */
  const out = [];
  for (const [path, value] of Object.entries(groupNodes)) {
    const gid = /^groups\/([^/]+)$/.exec(path)?.[1];
    if (gid === undefined || !isPlainObject(value)) continue;
    const members = value.members;
    if (!isPlainObject(members)) continue;
    for (const uid of Object.keys(members)) {
      // A member whose own account node is in the payload already carries its
      // groups map inside that node; a nested path would collide with it.
      if (`users/${uid}` in writes) continue;
      out.push(`users/${uid}/groups/${gid}`);
    }
  }
  return out;
}

/**
 * @param {string[]} candidates
 * @param {Record<string, unknown>} liveValues candidate path -> current value
 * @returns {{ writes: Record<string, unknown>, skipped: string[] }}
 */
export function buildEnumerationRepair(candidates, liveValues) {
  /** @type {Record<string, unknown>} */
  const writes = {};
  /** @type {string[]} */
  const skipped = [];
  for (const path of candidates) {
    // Never clobber a live entry: it may hold `lastVisited`, and `true` is only
    // the default shape (js/db/groups.ts:23-26).
    if (!same(liveValues[path] ?? null, null)) { skipped.push(path); continue; }
    writes[path] = true;
  }
  return { writes, skipped };
}

// --- CLI ---------------------------------------------------------------------

/** @param {string[]} argv @param {string} name */
function flag(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
}

/** @param {Record<string, unknown>} writes @returns {string[]} */
function nestedPairs(writes) {
  const keys = Object.keys(writes);
  return keys.flatMap((p) => keys.filter((a) => a !== p && p.startsWith(`${a}/`)).map((a) => `${a} ⊃ ${p}`));
}

async function main() {
  const argv = proc.argv.slice(2);
  // First line out of the process, before any validation can throw: "no output
  // at all" must never be an ambiguous result for a recovery tool.
  console.log(`restore-preimage: starting (${argv.length ? argv.join(' ') : 'no arguments'})`);

  const file = flag(argv, '--file');
  const projectId = flag(argv, '--project');
  const prodProject = flag(argv, '--prod-project');
  const apply = argv.includes('--yes');
  /** @type {RestoreOptions} */
  const opts = {
    transient: argv.includes('--restore-transient'),
    canvasBg: argv.includes('--restore-canvas-bg'),
    replaceAccount: argv.includes('--replace-account'),
    mergeAccount: argv.includes('--merge-account'),
  };
  if (!file || !projectId) throw new Error('need --file <dump.json> and --project <id>');

  // The panel's gate, same rule: an UNDECLARED production project counts as
  // production. This writes to the database, so it fails closed too.
  if (!prodProject || !prodProject.trim() || prodProject.trim() === projectId) {
    if (!argv.includes('--i-know-this-is-prod')) {
      throw new Error(`refusing: --prod-project is ${prodProject ? 'the same as --project' : 'undeclared'}. Pass a different --prod-project, or --i-know-this-is-prod.`);
    }
  }

  const region = flag(argv, '--region') || DEFAULT_REGION;
  const databaseURL = flag(argv, '--database-url')
    || (region === 'us-central1'
      ? `https://${projectId}-default-rtdb.firebaseio.com`
      : `https://${projectId}-default-rtdb.${region}.firebasedatabase.app`);

  const saJson = proc.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!saJson) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS_JSON to the service-account JSON');

  const dump = /** @type {{ op?: string, project?: string, uids?: string[], preImage?: Record<string, unknown> }} */ (
    JSON.parse(nodeFs.readFileSync(file, 'utf8'))
  );
  const preImage = dump.preImage;
  if (!isPlainObject(preImage)) throw new Error(`${file} has no preImage object — is it an audit dump?`);
  const uid = dump.uids?.[0] ?? 'no-uid';
  opts.uid = uid;

  console.log(`dump: ${file}\n  op=${dump.op} uid=${uid} project=${dump.project} paths=${Object.keys(preImage).length}`);
  if (dump.project !== projectId) {
    console.log(`  ⚠ the dump was taken against project "${dump.project}", you are pointed at "${projectId}"`);
  }

  const { deps } = makeOpsDeps({ projectId, saJson, databaseURL });

  // Read every dumped path as it stands NOW. This is what makes a restore a
  // decision rather than a replay. Canvas paths are read as the bg leaf only —
  // reading the node would pull the unbounded strokes child.
  const paths = Object.keys(preImage);
  const liveList = await Promise.all(paths.map((p) => (CANVAS.test(p)
    ? deps.getVal(`${p}/bg`).then((bg) => (bg === null ? null : { bg }))
    : deps.getVal(p))));
  /** @type {Record<string, unknown>} */
  const liveValues = {};
  paths.forEach((p, i) => { liveValues[p] = liveList[i]; });

  const { decisions, writes } = planRestore(preImage, liveValues, opts);

  const order = ['restore', 'conflict', 'folded', 'already-there', 'skip-canvas', 'skip-transient', 'skip-absent'];
  for (const verdict of order) {
    const rows = decisions.filter((d) => d.verdict === verdict);
    if (!rows.length) continue;
    console.log(`\n${verdict.toUpperCase()} (${rows.length})`);
    for (const r of rows) console.log(`  ${r.path}\n      ${r.why}`);
  }

  // The residue sweep (smoke-test step 9). The per-path lines above already
  // carry it; this is the headline, because "did the location families actually
  // die" is a yes/no an operator should not have to reassemble from verdicts.
  const residue = summarizeResidue(decisions);
  if (residue.swept) {
    console.log(`\nRESIDUE SWEEP — ${residue.swept} transient path(s) from the write-set, re-read live`);
    if (residue.clean) {
      console.log('  ✓ all empty — every path the purge wrote in these families is gone');
    } else {
      console.log(`  ✗ ${residue.present.length} still holding data:`);
      for (const r of residue.present) {
        console.log(`      ${r.path}${r.holds.length ? `   keys: ${r.holds.join(', ')}` : ''}`);
      }
      console.log('  Before calling this a missed delete: a client that was open at purge time');
      console.log('  republishes its cache for up to its ID token\'s remaining hour (G3), and that');
      console.log('  looks identical to residue. Re-run this once the window has passed.');
    }
    console.log('  Scope: only paths the purge WROTE. A family it never touched is not in the dump (G4).');
  }

  // For the account's own nodes, show the key-level shape of the disagreement.
  // "the node exists again" is not actionable on its own; what is in it is.
  for (const path of paths.filter((p) => OWN_NODE.test(p))) {
    const live = liveValues[path];
    const dumped = preImage[path];
    if (same(live, null) || same(live, dumped) || !isPlainObject(live) || !isPlainObject(dumped)) continue;
    const liveOnly = Object.keys(live).filter((k) => !(k in dumped));
    const dumpOnly = Object.keys(dumped).filter((k) => !(k in live));
    const differ = Object.keys(dumped).filter((k) => k in live && !same(live[k], dumped[k]));
    console.log(`\nWHAT IS LIVE AT ${path}`);
    console.log(`  only in the live node (written since the purge) : ${liveOnly.join(', ') || '—'}`);
    console.log(`  only in the dump (lost until restored)          : ${dumpOnly.join(', ') || '—'}`);
    console.log(`  present in both but different                   : ${differ.join(', ') || '—'}`);
    for (const k of differ) {
      console.log(`    ${k}\n      live: ${JSON.stringify(live[k]).slice(0, 160)}\n      dump: ${JSON.stringify(dumped[k]).slice(0, 160)}`);
    }
  }

  // Opt-in repair, derived from the restored group rather than from the dump.
  if (argv.includes('--heal-group-enumeration')) {
    /** @type {Record<string, unknown>} */
    const groupNodes = {};
    for (const p of paths.filter((x) => /^groups\/[^/]+$/.test(x))) {
      groupNodes[p] = p in writes ? writes[p] : liveValues[p];
    }
    const candidates = enumerationCandidates(groupNodes, writes);
    const values = await Promise.all(candidates.map((p) => deps.getVal(p)));
    /** @type {Record<string, unknown>} */
    const liveEnum = {};
    candidates.forEach((p, i) => { liveEnum[p] = values[i]; });
    const repair = buildEnumerationRepair(candidates, liveEnum);
    const added = Object.keys(repair.writes);
    console.log(`\nGROUP-ENUMERATION REPAIR (${added.length}) — NOT from the pre-image`);
    console.log("  each member's client deleted this entry when the group vanished; the purge never touched it, so no dump can hold it");
    if (!candidates.length) console.log('  (no restored group has members needing one)');
    for (const p of added) console.log(`  + ${p} = true`);
    for (const p of repair.skipped) console.log(`  · ${p} — already present, left alone`);
    Object.assign(writes, repair.writes);
  }

  const writePaths = Object.keys(writes);
  console.log(`\n${writePaths.length} path(s) would be written.`);
  const conflicts = decisions.filter((d) => d.verdict === 'conflict').length;
  if (conflicts) console.log(`${conflicts} CONFLICT(s) are excluded from the payload — resolve those by hand.`);

  if (!apply) { console.log('\nDRY RUN — nothing written. Re-run with --yes to apply.'); return; }
  if (!writePaths.length) { console.log('nothing to write.'); return; }

  // RTDB validates this itself, but it throws AFTER the restore's own pre-image
  // has been written, leaving a `failed` audit line for a request that never
  // left the process.
  const overlap = nestedPairs(writes);
  if (overlap.length) throw new Error(`refusing: payload still contains nested paths — ${overlap.join(', ')}`);

  // The restore is a write over live data, so it gets the same treatment the
  // purge got: pre-image captured and flushed first, outcome appended after.
  const auditDir = flag(argv, '--audit-dir') || '.ops-audit';
  const ts = deps.now();
  /** @type {Record<string, unknown>} */
  const before = {};
  for (const p of writePaths) before[p] = liveValues[p] ?? null;
  const preImageFile = writeAuditRecord(nodeFs, auditDir, {
    ts,
    op: 'restore',
    project: projectId,
    uids: [uid],
    preImage: before,
    outcome: `pending — restoring from ${file}; the update has not been issued yet`,
  });

  /** @param {string} outcome */
  const finish = (outcome) => appendAuditOutcome(nodeFs, auditDir, {
    ts, op: 'restore', project: projectId, uids: [uid], paths: writePaths.length, preImageFile, completedAt: deps.now(), outcome,
  });

  try {
    await deps.update('/', writes);
  } catch (e) {
    try {
      finish(`failed: ${String(e)}`);
    } catch (auditErr) {
      console.error(`could not append the failed-outcome audit line: ${String(auditErr)}`);
    }
    throw e;
  }
  finish('ok');
  console.log(`\nRESTORED ${writePaths.length} path(s) in one atomic update. Audit: ${preImageFile}`);
}

// Run when invoked directly, while staying importable by the tests.
//
// Compared by RESOLVED PATH, not by filename. The first version of this guard
// tested `argv[1].endsWith('restore-preimage.mjs')`, so saving the file under
// any other name made node exit 0 having printed nothing at all — a recovery
// tool whose failure mode is silence is worse than one that crashes. realpath
// on both sides so a symlinked invocation still matches, and ANY uncertainty
// resolves to "run it", never to a silent no-op.
function invokedDirectly() {
  const entry = proc.argv[1];
  if (!entry) return true;
  try {
    return nodeFs.realpathSync(entry) === nodeFs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return true;
  }
}

if (invokedDirectly()) {
  main().catch((e) => { console.error(String(e)); proc.exit(1); });
}
