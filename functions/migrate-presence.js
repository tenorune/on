#!/usr/bin/env node
// One-shot, idempotent migration to the presence schema split.
// Usage: cd functions && node migrate-presence.js --project <firebase-project-id>
//        (dev RTDB is in europe-west1, the default; pass --region or
//         --database-url for an instance in another region.)
// Lives in functions/ so Node resolves firebase-admin from functions/node_modules
// and parses this file as ESM (functions/package.json has "type":"module").
// Auth: set GOOGLE_APPLICATION_CREDENTIALS_JSON to the service-account JSON for
// the target environment (the same SA used by CI deploys).
// Run ONCE per environment, immediately BEFORE the functions+hosting+rules deploy.
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

function argVal(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const projectId = argVal('--project') || process.env.GCLOUD_PROJECT;
if (!projectId) { console.error('Pass --project <firebase-project-id>'); process.exit(1); }

const saJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
if (!saJson) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS_JSON to the service-account JSON'); process.exit(1); }

// RTDB instances outside us-central1 use a region-namespaced host. The dev DB
// lives in europe-west1 (matches FUNCTIONS_REGION). Pass --database-url to point
// at any other instance/region explicitly; otherwise we build the regional host
// from --region / FUNCTIONS_REGION (default europe-west1).
const region = argVal('--region') || process.env.FUNCTIONS_REGION || 'europe-west1';
const databaseURL = argVal('--database-url') || process.env.DATABASE_URL
  || (region === 'us-central1'
    ? `https://${projectId}-default-rtdb.firebaseio.com`
    : `https://${projectId}-default-rtdb.${region}.firebasedatabase.app`);

initializeApp({
  credential: cert(JSON.parse(saJson)),
  databaseURL,
});
console.log(`using databaseURL ${databaseURL}`);
const db = getDatabase();

const PRESENCE_FIELDS = ['status', 'availableUntil', 'statusColor', 'paletteKey', 'code', 'lastSeen'];
const LEGACY_AND_MOVED = [
  'status', 'availableUntil', 'statusColor', 'paletteKey', 'code', 'lastSeen', // now under presence/
  'knocks', 'callState', 'revokedFollowers',                                   // moved to top-level mailboxes / transient
  'favorites', 'lastTimeoutMinutes', 'currentContext',                          // legacy (live in userPrefs)
];

async function main() {
  const usersSnap = await db.ref('users').get();
  if (!usersSnap.exists()) { console.log('no users; nothing to migrate'); return; }
  const users = usersSnap.val();
  let migrated = 0;
  for (const [uid, u] of Object.entries(users)) {
    const updates = {};
    // 1. Copy presence fields into presence/ (only if not already there — idempotent).
    for (const f of PRESENCE_FIELDS) {
      if (u[f] !== undefined && u.presence?.[f] === undefined) {
        updates[`users/${uid}/presence/${f}`] = u[f];
      }
    }
    // 2. revokedFollowers/{revoker} → revocations/{revoker}/{uid}.
    for (const revoker of Object.keys(u.revokedFollowers || {})) {
      updates[`revocations/${revoker}/${uid}`] = true;
    }
    // 3. Delete the moved-away / legacy / transient top-level fields.
    for (const dead of LEGACY_AND_MOVED) {
      if (u[dead] !== undefined) updates[`users/${uid}/${dead}`] = null;
    }
    // NOTE: do NOT touch users/{uid}/groups/{gid}/lastVisited. That record's
    // ONLY field is lastVisited, so nulling it deletes the whole enumeration
    // node and the group disappears from the nav row. lastVisited stays here
    // (it's the nav-sort key); see the lastVisited→userPrefs follow-up issue.
    if (Object.keys(updates).length) { await db.ref().update(updates); migrated++; }
  }
  console.log(`migrated ${migrated} of ${Object.keys(users).length} user(s)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
