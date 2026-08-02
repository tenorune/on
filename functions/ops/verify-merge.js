#!/usr/bin/env node
// functions/ops/verify-merge.js — read the merge leg back.
//
// Smoke-test step 9's merge half asks whether the loser's contacts, groups,
// per-group names and canvases really are on the survivor, whether its push
// tokens moved, whether knocks/calls were dropped, and whether the loser's own
// nodes are gone. This answers all of that from live data, one line per claim.
//
// WHY NOT ops/restore-preimage.js. That tool is PURGE-shaped. Its whole verdict
// model rests on "a purge NULLED every path in its write-set"
// (restore-preimage.js:204), and it has no guard on the dump's `op` — point it
// at a merge dump and its verdicts, its RESIDUE SWEEP and its PEER REPUBLISH
// block are all built on an assumption that does not hold, because a merge's
// write-set is mostly non-null CARRIES onto the survivor. So the merge leg gets
// its own read-back, and the assertions come from ops/merge-fixture.js, where
// functions/test/ops-merge-fixture.test.js pins them against the real
// buildMergePlan rather than against anybody's expectations.
//
// Reads only. There is no --yes, because there is nothing to write.
//
// Usage:
//   cd functions
//   GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)" \
//   node ops/verify-merge.js --project <dev-id> --prod-project <prod-id> \
//     --tag run1 [--telegram] [--repoint]
//
// --telegram if the fixture was seeded with a Telegram mapping; add --repoint
// if the merge was run as "link via merge" rather than as a plain merge.
//
// Exits non-zero when anything is owed, so it can gate a script.
//
// Lives under ops/ so it is never deployed: firebase.json ignores `ops/**`, and
// tests/firebaseConfig.test.js pins that exclusion.
import * as nodeFs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeOpsDeps } from './deps.js';
import { buildMergeAssertions, checkAssertion, fixtureUids } from './merge-fixture.js';

const proc = /** @type {{ argv: string[]; env: Record<string, string | undefined>; exit: (code?: number) => never }} */ (
  /** @type {unknown} */ (process)
);

const DEFAULT_REGION = 'europe-west1';

/** @param {string[]} argv @param {string} name */
function flag(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
}

async function main() {
  const argv = proc.argv.slice(2);
  console.log(`verify-merge: starting (${argv.length ? argv.join(' ') : 'no arguments'})`);

  const projectId = flag(argv, '--project');
  const prodProject = flag(argv, '--prod-project');
  const tag = (flag(argv, '--tag') || '').trim();
  const telegram = argv.includes('--telegram');
  const repoint = argv.includes('--repoint');

  if (!projectId) throw new Error('need --project <firebase-project-id>');
  if (!/^[a-z0-9]{1,16}$/.test(tag)) throw new Error('need --tag <the tag the fixture was seeded with>');

  // This one only READS, so the gate is a warning rather than a refusal —
  // reading production to check a dev merge is pointless, not dangerous.
  if (prodProject && prodProject.trim() === projectId) {
    console.log(`  ⚠ --project is the declared production project (${projectId}). This tool only reads, but you are almost certainly pointed at the wrong place.`);
  }

  const region = flag(argv, '--region') || DEFAULT_REGION;
  const databaseURL = flag(argv, '--database-url')
    || (region === 'us-central1'
      ? `https://${projectId}-default-rtdb.firebaseio.com`
      : `https://${projectId}-default-rtdb.${region}.firebasedatabase.app`);

  const saJson = proc.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!saJson) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS_JSON to the service-account JSON');

  const { deps } = makeOpsDeps({ projectId, saJson, databaseURL });
  const { L, S } = fixtureUids(tag);
  const assertions = buildMergeAssertions({ tag, telegram, repoint });

  console.log(`\nmerge ${L} → ${S}`);
  console.log(`project=${projectId} tag=${tag}${telegram ? (repoint ? ' variant=link-via-merge' : ' variant=plain+telegram') : ''}`);
  console.log(`checking ${assertions.length} claim(s)\n`);

  // Every path is read live and independently. Canvas nodes are read as named
  // leaves by construction (the assertions name `.../bg` and `.../strokes`), so
  // nothing here ever pulls the unbounded strokes body into memory.
  const live = await Promise.all(assertions.map((a) => deps.getVal(a.path)));

  /** @type {string[]} */
  const failed = [];
  assertions.forEach((a, i) => {
    const res = checkAssertion(a, live[i]);
    console.log(`${res.ok ? '  ✓' : '  ✗'} ${a.path}`);
    console.log(`      ${a.why}`);
    if (!res.ok) {
      console.log(`      OWED: ${res.detail}`);
      failed.push(`${a.path} — ${res.detail}`);
    }
  });

  if (!failed.length) {
    console.log(`\nALL ${assertions.length} CLAIMS HOLD.`);
    console.log('  What this does NOT cover, and no read-back can:');
    console.log('    • the panel showed the conflicts and losses before you approved — that is yours to have read;');
    console.log('    • the write landed as ONE atomic update — read .ops-audit/audit.jsonl for the outcome line;');
    console.log('    • strokes on a carried canvas are GONE by design, and no assertion can miss them back into existence.');
    console.log('  Run the integrity report too: the seed is clean of errors and warnings, so anything it');
    console.log('  reports now beyond auth-missing (INFO, one per seeded uid) belongs to the merge.');
    return;
  }

  console.log(`\n${failed.length} OF ${assertions.length} CLAIM(S) OWED:`);
  for (const f of failed) console.log(`  ✗ ${f}`);
  console.log('\nBefore reading these as merge defects, rule out the two known causes:');
  console.log('  • G3 — a client that was open at merge time republishes its cache for up to an hour.');
  console.log('    Nothing here is app-born, so this should be impossible; if it is not, say which client existed.');
  console.log('  • a stale canvas-key list — the panel takes it from the snapshot, not the live re-read, so');
  console.log('    refresh the panel after seeding or a seeded canvas is invisible to the plan and never moves.');
  proc.exit(1);
}

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
