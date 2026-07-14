#!/usr/bin/env node
// @ts-check
// One-shot, idempotent repair for users whose group nav entries were deleted by
// the buggy first cut of migrate-presence.js (it nulled
// users/{uid}/groups/{gid}/lastVisited — the record's only field — which deletes
// the whole enumeration node, dropping the group from the nav row).
//
// Rebuilds users/{uid}/groups/{gid} from the surviving membership in
// groups/{gid}/members/{uid}, seeding lastVisited from the member's joinedAt.
// Only ADDS entries that are currently missing — never overwrites an existing
// record, so it's safe to re-run and won't clobber a real lastVisited.
//
// Usage: cd functions && node repair-user-groups.js --project <firebase-project-id>
//        (same auth + region handling as migrate-presence.js)
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

// The ambient `process` shim (types/app.d.ts) types only .env — it exists for
// browser bundle code. This Node CLI also needs argv/exit, so view the global
// through a locally-typed alias (exit typed `never` so the guards below narrow).
const proc = /** @type {{ argv: string[]; env: Record<string, string | undefined>; exit: (code?: number) => never }} */ (
  /** @type {unknown} */ (process)
);

/**
 * @param {string} name
 * @returns {string | undefined}
 */
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

// saJson guarded non-undefined above (proc.exit on the empty path); cast for the checker.
initializeApp({ credential: cert(JSON.parse(/** @type {string} */ (saJson))), databaseURL });
console.log(`using databaseURL ${databaseURL}`);
const db = getDatabase();

async function main() {
  const [groupsSnap, usersSnap] = await Promise.all([
    db.ref('groups').get(),
    db.ref('users').get(),
  ]);
  const groups = groupsSnap.exists() ? groupsSnap.val() : {};
  const users = usersSnap.exists() ? usersSnap.val() : {};

  /** @type {Record<string, { lastVisited: number }>} */
  const updates = {};
  let restored = 0;
  for (const [gid, group] of Object.entries(groups)) {
    const members = group?.members || {};
    for (const [uid, member] of Object.entries(members)) {
      // Already enumerated for this user? Leave it untouched.
      if (users[uid]?.groups?.[gid] !== undefined) continue;
      const lastVisited = typeof member?.joinedAt === 'number' ? member.joinedAt : Date.now();
      updates[`users/${uid}/groups/${gid}`] = { lastVisited };
      restored++;
    }
  }

  if (restored) await db.ref().update(updates);
  console.log(`restored ${restored} missing group enumeration entr${restored === 1 ? 'y' : 'ies'}`);
}

main().then(() => proc.exit(0)).catch((e) => { console.error(e); proc.exit(1); });
