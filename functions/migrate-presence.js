#!/usr/bin/env node
// One-shot, idempotent migration to the presence schema split.
// Usage: cd functions && node migrate-presence.js --project <firebase-project-id>
// Lives in functions/ so Node resolves firebase-admin from functions/node_modules
// and parses this file as ESM (functions/package.json has "type":"module").
// Auth: set GOOGLE_APPLICATION_CREDENTIALS_JSON to the service-account JSON for
// the target environment (the same SA used by CI deploys).
// Run ONCE per environment, immediately BEFORE the functions+hosting+rules deploy.
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const projectArg = process.argv.indexOf('--project');
const projectId = projectArg >= 0 ? process.argv[projectArg + 1] : process.env.GCLOUD_PROJECT;
if (!projectId) { console.error('Pass --project <firebase-project-id>'); process.exit(1); }

const saJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
if (!saJson) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS_JSON to the service-account JSON'); process.exit(1); }

initializeApp({
  credential: cert(JSON.parse(saJson)),
  databaseURL: `https://${projectId}-default-rtdb.firebaseio.com`,
});
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
    // 4. Drop groups/{*}/lastVisited (sort hint; rebuilds on next navigation).
    for (const gid of Object.keys(u.groups || {})) {
      if (u.groups[gid] && typeof u.groups[gid] === 'object' && u.groups[gid].lastVisited !== undefined) {
        updates[`users/${uid}/groups/${gid}/lastVisited`] = null;
      }
    }
    if (Object.keys(updates).length) { await db.ref().update(updates); migrated++; }
  }
  console.log(`migrated ${migrated} of ${Object.keys(users).length} user(s)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
