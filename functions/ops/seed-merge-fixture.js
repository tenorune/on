#!/usr/bin/env node
// functions/ops/seed-merge-fixture.js — write (or remove) the throwaway
// accounts smoke-test step 9's MERGE leg needs.
//
// The leg is the last unfinished part of docs/operator-panel-smoke-test.md. It
// wants two accounts seeded so the merge is not trivial, and hand-seeding that
// through the app is slow and gets it wrong in ways that are hard to notice —
// see ops/merge-fixture.js for the per-group-name case that a hand-written seed
// misses entirely.
//
// Everything this writes is DERIVED from a --tag, so the seed is reproducible,
// two runs never collide, and --clean removes exactly what it wrote (plus the
// paths the merge itself creates, which the seed never touched).
//
// Usage:
//   cd functions
//   GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)" \
//   node ops/seed-merge-fixture.js --project <dev-id> --prod-project <prod-id> \
//     --tag run1 [--telegram] [--yes]
//
//   ... same flags ... --tag run1 --clean [--yes]
//
// Dry run by default: it prints the write-set and touches nothing. --yes issues
// ONE atomic multi-path update, like every other write in this panel.
//
// Lives under ops/ so it is never deployed: firebase.json ignores `ops/**`, and
// tests/firebaseConfig.test.js pins that exclusion.
import * as nodeFs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeOpsDeps } from './deps.js';
import {
  buildMergeFixture,
  buildFixtureCleanup,
  fixtureUids,
  fixtureGids,
  fixtureCanvasKeys,
  fixtureNotes,
  assertMappingShape,
} from './merge-fixture.js';

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
  console.log(`seed-merge-fixture: starting (${argv.length ? argv.join(' ') : 'no arguments'})`);

  const projectId = flag(argv, '--project');
  const prodProject = flag(argv, '--prod-project');
  const tag = (flag(argv, '--tag') || '').trim();
  const apply = argv.includes('--yes');
  const clean = argv.includes('--clean');
  const telegram = argv.includes('--telegram');
  const mappingShape = flag(argv, '--mapping-shape') || 'loser';

  if (!projectId) throw new Error('need --project <firebase-project-id>');
  // A tag is required and must be path-safe: it is embedded in every uid, gid
  // and token this writes, and --clean derives its null-set from it. A typo'd
  // tag on --clean must miss everything rather than hit something else.
  if (!/^[a-z0-9]{1,16}$/.test(tag)) {
    throw new Error('need --tag <1-16 lowercase alphanumerics> — it names every path this owns, and --clean derives its null-set from it');
  }

  // Argument validation before anything reaches the network or the credential:
  // a typo'd shape should not need a database connection to be caught, and the
  // refusal is the only part of this CLI a container without a service account
  // can exercise (test/ops-merge-cli.test.js).
  if (!clean) assertMappingShape({ mappingShape, telegram });

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

  const { deps } = makeOpsDeps({ projectId, saJson, databaseURL });
  const uids = fixtureUids(tag);
  const gids = fixtureGids(tag);

  const writes = clean
    ? buildFixtureCleanup({ tag })
    : buildMergeFixture({ tag, now: deps.now(), telegram, mappingShape }).writes;

  console.log(`\n${clean ? 'CLEAN' : 'SEED'} tag=${tag} project=${projectId}${!clean && telegram ? ` mapping-shape=${mappingShape}` : ''} paths=${Object.keys(writes).length}`);
  for (const path of Object.keys(writes).sort()) {
    console.log(`  ${clean ? '−' : '+'} ${path}`);
  }

  if (!clean) {
    console.log('\nAccounts');
    for (const [role, uid] of Object.entries(uids)) console.log(`  ${role.padEnd(3)} ${uid}`);
    console.log('Groups');
    for (const [role, gid] of Object.entries(gids)) console.log(`  ${role.padEnd(3)} ${gid}`);
    console.log(`Canvas keys at seed time: ${fixtureCanvasKeys({ tag }).join(', ')}`);
    console.log('\nNotes');
    for (const note of fixtureNotes({ mappingShape })) console.log(`  • ${note}`);
    console.log('\nNext');
    console.log(`  1. refresh the panel so its shallow canvas-key read picks the seeded canvases up`);
    console.log(mappingShape === 'loser'
      ? `  2. run the integrity report — expect auth-missing (INFO) per uid and nothing worse`
      : `  2. run the integrity report — expect auth-missing (INFO) per uid, PLUS the telegram-mapping-asymmetric ERROR this shape exists to seed`);
    console.log(`  3. merge ${uids.L} → ${uids.S} (preview, read the conflicts and losses, execute)`);
    console.log(`  4. node ops/verify-merge.js --project ${projectId} --prod-project <prod-id> --tag ${tag}${telegram ? ' --telegram' : ''}${mappingShape === 'loser' ? '' : ` --mapping-shape ${mappingShape}`}`);
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Pass --yes to apply.');
    return;
  }

  // ONE atomic multi-path update, like every other write in this panel: a crash
  // cannot leave a half-seeded fixture whose merge plan means nothing.
  await deps.update('/', writes);
  console.log(`\napplied: ${Object.keys(writes).length} path(s) ${clean ? 'nulled' : 'written'}.`);
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
