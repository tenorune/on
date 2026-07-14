#!/usr/bin/env node
// @ts-check
// READ-ONLY audit — no writes, safe to run against production.
// Finds any presence node or group status-override that is `status:'available'`
// WITHOUT a concrete numeric availableUntil (null OR absent). That is the
// unenforced divergent shape: client isAvailable() reads it AVAILABLE, server
// primaryAvailable() reads it NOT — see tests/presencePredicateParity.test.js.
// The invariant "available always carries a concrete availableUntil" is enforced
// only by write-code convention, not by database.rules.json, so this is the tool
// that checks whether live data has ever crossed that unenforced boundary.
//
// Usage (same auth/region handling as migrate-presence.js):
//   cd functions && node audit-available-null.js --project <firebase-project-id>
//   GOOGLE_APPLICATION_CREDENTIALS_JSON = the service-account JSON
//   optional: --region / --database-url  (default region europe-west1)
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const proc = /** @type {{ argv: string[]; env: Record<string, string | undefined>; exit: (code?: number) => never }} */ (
  /** @type {unknown} */ (process)
);

/** @param {string} name @returns {string | undefined} */
function argVal(name) {
  const i = proc.argv.indexOf(name);
  return i >= 0 ? proc.argv[i + 1] : undefined;
}

const projectId = argVal('--project') || proc.env.GCLOUD_PROJECT;
if (!projectId) { console.error('Pass --project <firebase-project-id>'); proc.exit(1); }

const saJson = proc.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
if (!saJson) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS_JSON to the service-account JSON'); proc.exit(1); }

const region = argVal('--region') || proc.env.FUNCTIONS_REGION || 'europe-west1';
const databaseURL = argVal('--database-url') || proc.env.DATABASE_URL
  || (region === 'us-central1'
    ? `https://${projectId}-default-rtdb.firebaseio.com`
    : `https://${projectId}-default-rtdb.${region}.firebasedatabase.app`);

initializeApp({ credential: cert(JSON.parse(/** @type {string} */ (saJson))), databaseURL });
console.log(`using databaseURL ${databaseURL} (READ-ONLY)`);
const db = getDatabase();

/**
 * The exact divergent condition. `typeof !== 'number'` catches null AND absent
 * (RTDB strips null keys on write, so the stored shape is usually absent).
 * @param {{ status?: unknown, availableUntil?: unknown } | null | undefined} node
 */
function isAvailableWithoutConcreteUntil(node) {
  return !!node
    && node.status === 'available'
    && typeof node.availableUntil !== 'number';
}

async function main() {
  const [usersSnap, groupsSnap] = await Promise.all([
    db.ref('users').get(),
    db.ref('groups').get(),
  ]);
  const users = usersSnap.exists() ? usersSnap.val() : {};
  const groups = groupsSnap.exists() ? groupsSnap.val() : {};

  /** @type {string[]} */
  const primaryHits = [];
  for (const [uid, u] of Object.entries(users)) {
    if (isAvailableWithoutConcreteUntil(u?.presence)) {
      primaryHits.push(`users/${uid}/presence  → ${JSON.stringify(u.presence)}`);
    }
  }

  /** @type {string[]} */
  const overrideHits = [];
  for (const [gid, group] of Object.entries(groups)) {
    const members = group?.members || {};
    for (const [uid, member] of Object.entries(members)) {
      const ov = member?.statusOverride;
      // Only enabled overrides are consulted by overrideAvailable(); an
      // available-without-until override with enabled:true is the live risk.
      if (ov && ov.enabled === true && isAvailableWithoutConcreteUntil(ov)) {
        overrideHits.push(`groups/${gid}/members/${uid}/statusOverride  → ${JSON.stringify(ov)}`);
      }
    }
  }

  const total = primaryHits.length + overrideHits.length;
  const usersScanned = Object.keys(users).length;
  const groupsScanned = Object.keys(groups).length;
  console.log(`\nscanned ${usersScanned} user(s), ${groupsScanned} group(s)`);
  console.log(`primary-presence offenders : ${primaryHits.length}`);
  console.log(`group-override offenders   : ${overrideHits.length}`);
  if (total === 0) {
    console.log('\nCLEAN — no `available` node lacks a concrete availableUntil. Invariant holds in live data.');
  } else {
    console.log('\nFOUND — the divergent shape EXISTS in live data:');
    for (const h of [...primaryHits, ...overrideHits]) console.log(`  ${h}`);
  }
}

main().then(() => proc.exit(0)).catch((e) => { console.error(e); proc.exit(1); });
