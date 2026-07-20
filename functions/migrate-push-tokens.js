#!/usr/bin/env node
// One-shot, idempotent migration for audit F6c: relocate FCM push-token records
// out of the wholesale-watched userPrefs node into a fresh top-level
// pushTokens/{uid}/{token} path.
//
// Each record embeds navigator.userAgent and lived inside
// userPrefs/{uid}/pushTokens — a node watchUserPrefs downloads on every boot and
// re-delivers on every prefs echo. Readers: the server-side notifier
// (functions/notifier.js sendToUser), the bot's /notifications gate
// (functions/telegram.js), the app's channel pill (js/notifyChannel.ts
// accountHasPushTokens), and the client's stale-token cull — all dual-read the
// new path with a legacy fallback during the migration window. This copies
// every user's tokens to pushTokens/{uid}/{token} and nulls the legacy
// userPrefs/{uid}/pushTokens copy, in ONE atomic multi-path update.
//
// Per-token copy (not a wholesale subtree set): the hosting deploy that precedes
// this migration ships clients that already WRITE the new path, so a user may
// have fresh new-path tokens by the time this runs. Copying token-by-token and
// nulling only the legacy location never clobbers those newer records, and makes
// the run safe to repeat (a re-run finds the legacy copies already gone).
//
// Usage: cd functions && node migrate-push-tokens.js --project <firebase-project-id> [--apply]
//        (same auth + region handling as repair-user-groups.js / migrate-presence.js)
//        Without --apply it prints a dry-run summary and writes nothing.
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

const apply = proc.argv.includes('--apply');

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
  const usersSnap = await db.ref('userPrefs').get();
  const users = usersSnap.exists() ? usersSnap.val() : {};

  /** @type {Record<string, unknown>} */
  const updates = {};
  let usersMoved = 0;
  let tokensMoved = 0;
  for (const [uid, prefs] of Object.entries(users)) {
    const tokens = prefs?.pushTokens;
    if (!tokens || typeof tokens !== 'object') continue;
    const entries = Object.entries(tokens);
    if (!entries.length) {
      // An empty node still shouldn't linger in the watched prefs — clear it.
      updates[`userPrefs/${uid}/pushTokens`] = null;
      continue;
    }
    for (const [token, record] of entries) {
      updates[`pushTokens/${uid}/${token}`] = record;
      tokensMoved += 1;
    }
    updates[`userPrefs/${uid}/pushTokens`] = null;
    usersMoved += 1;
  }

  console.log(`${apply ? 'APPLYING' : 'DRY RUN'}: ${tokensMoved} token(s) across ${usersMoved} user(s) → pushTokens/{uid}, legacy userPrefs/{uid}/pushTokens nulled`);
  if (!apply) {
    console.log('re-run with --apply to write these changes');
    return;
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
  console.log(`migrated ${tokensMoved} token(s) for ${usersMoved} user(s)`);
}

main().then(() => proc.exit(0)).catch((e) => { console.error(e); proc.exit(1); });
