#!/usr/bin/env node
// functions/ops/verify-auth-delete.js — the probe that settles D5/G2's original
// question: does admin.auth() behave on a uid that only ever existed as a
// CUSTOM TOKEN?
//
// It is not a special kind of record. Once the client completes one
// signInWithCustomToken, Firebase creates an ordinary Auth user; deleteUser
// takes a uid and does not care how it came to exist. Its marks are an empty
// providerData and a creationTime equal to that first sign-in, NOT to when the
// token was minted. So the interesting questions are the three the panel's
// purge now depends on:
//
//   1. Does a record exist at all? A purge can target an account whose client
//      never finished signing in — then getUser/deleteUser throw
//      auth/user-not-found, and the purge path has to survive that.
//   2. Does revokeRefreshTokens actually land? Its only observable effect is
//      tokensValidAfterTime moving. NOTE what it does NOT do: an already-issued
//      ID token stays valid until it expires, and database.rules.json never
//      checks auth.token.auth_time, so there is a window in which the client
//      can still write. That window is measured by hand (steps 3-4 of the
//      smoke test) — no script can observe it.
//   3. Does deleteUser leave the uid unusable? Expected answer: NO, and that is
//      the point. The Telegram uid is deriveTelegramUid(tgId, secret) —
//      deterministic — so the next Mini App open mints a fresh token for the
//      SAME uid and a NEW record appears under it. Deleting buys "this
//      session's cached state cannot be republished", not "this account can
//      never exist again". Step 6 checks that on a device.
//
// Lives under ops/ so it is never deployed: firebase.json ignores `ops/**`, and
// tests/firebaseConfig.test.js pins that exclusion.
//
// Usage:
//   cd functions
//   GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)" \
//   node ops/verify-auth-delete.js --project <dev-project-id> --uid <uid> \
//     --prod-project <prod-project-id> [--yes-delete]
//
// Without --yes-delete it reads and revokes only, both recoverable. --yes-delete
// adds the irreversible step.
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const proc = /** @type {{ argv: string[]; env: Record<string, string | undefined>; exit: (code?: number) => never }} */ (
  /** @type {unknown} */ (process)
);

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function parseProbeArgs(argv, env) {
  /** @param {string} name */
  const val = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  /** @param {string | undefined} v */
  const clean = (v) => { const t = (v || '').trim(); return t === '' ? null : t; };

  const projectId = clean(val('--project')) || clean(env.GCLOUD_PROJECT);
  if (!projectId) throw new Error('Pass --project <firebase-project-id>');

  const uid = clean(val('--uid'));
  if (!uid) throw new Error('Pass --uid <uid> — there is no sensible default target');

  const saJson = env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!saJson) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS_JSON to the service-account JSON');

  // Fails closed like the panel: this probe revokes a session and can delete an
  // Auth record, which against production is a real person losing their account.
  const prodProject = clean(val('--prod-project'));
  if (prodProject !== null && projectId === prodProject) {
    throw new Error(`refusing to run against the production project (${projectId}) — this probe revokes and can delete`);
  }

  return {
    projectId,
    uid,
    saJson,
    prodProject,
    deleteRecord: argv.includes('--yes-delete'),
  };
}

/**
 * Did the revoke land? Its ONLY observable effect is tokensValidAfterTime
 * moving forward, so an unchanged value is a failed revoke — reported as such
 * rather than assumed to have worked because the call did not throw.
 * @param {string | null | undefined} before
 * @param {string | null | undefined} after
 * @returns {{ ok: boolean, detail: string }}
 */
export function revokeVerdict(before, after) {
  if (!after) {
    return { ok: false, detail: 'FAILED: tokensValidAfterTime is absent after the revoke' };
  }
  if (before && Date.parse(after) <= Date.parse(before)) {
    return { ok: false, detail: `FAILED: tokensValidAfterTime did not advance (${before} → ${after})` };
  }
  return { ok: true, detail: `ok: tokensValidAfterTime ${before || '(unset)'} → ${after}` };
}

/**
 * Read back AFTER the delete. The pass is a getUser that throws
 * auth/user-not-found; anything else is not a pass, and an unexpected error is
 * inconclusive rather than success — a probe that reports a deletion it did not
 * confirm is worse than one that reports nothing.
 * @param {{ code?: string } | null} lookupError the error getUser threw, or null if it succeeded
 * @returns {{ ok: boolean, detail: string }}
 */
export function deleteVerdict(lookupError) {
  if (lookupError === null) {
    return { ok: false, detail: 'FAILED: the record is still readable after deleteUser' };
  }
  if (lookupError.code === 'auth/user-not-found') {
    return { ok: true, detail: 'ok: the record is gone (auth/user-not-found)' };
  }
  return { ok: false, detail: `INCONCLUSIVE: getUser failed with ${lookupError.code} — deletion not confirmed` };
}

/** @param {import('firebase-admin/auth').UserRecord} u */
function describe(u) {
  return {
    uid: u.uid,
    email: u.email ?? null,
    providerCount: u.providerData?.length ?? 0,
    creationTime: u.metadata?.creationTime ?? null,
    lastSignInTime: u.metadata?.lastSignInTime ?? null,
    tokensValidAfterTime: u.tokensValidAfterTime ?? null,
  };
}

async function main() {
  const opts = parseProbeArgs(proc.argv.slice(2), proc.env);
  initializeApp({ credential: cert(JSON.parse(opts.saJson)), projectId: opts.projectId });
  const auth = getAuth();
  /** @type {string[]} */
  const failures = [];

  // --- 1. does the record exist, and is it custom-token shaped? -------------
  let before;
  try {
    before = describe(await auth.getUser(opts.uid));
  } catch (e) {
    if (/** @type {{ code?: string }} */ (e)?.code === 'auth/user-not-found') {
      console.log(`1. NO AUTH RECORD for ${opts.uid}.`);
      console.log('   Not a failure: an account whose client never completed signInWithCustomToken');
      console.log('   has no record. It is the case the purge path must survive — nothing left to probe.');
      return;
    }
    throw e;
  }
  console.log('1. record:', JSON.stringify(before, null, 2));
  console.log(before.providerCount === 0
    ? '   providerData is empty — consistent with a custom-token account.'
    : `   providerData has ${before.providerCount} entries — this is NOT a pure custom-token account.`);

  // --- 2. revoke ------------------------------------------------------------
  await auth.revokeRefreshTokens(opts.uid);
  const afterRevoke = describe(await auth.getUser(opts.uid));
  const revoked = revokeVerdict(before.tokensValidAfterTime, afterRevoke.tokensValidAfterTime);
  console.log(`2. revokeRefreshTokens — ${revoked.detail}`);
  if (!revoked.ok) failures.push('revoke');
  console.log('   NOTE: an already-issued ID token is still valid until it expires; the rules do not');
  console.log('   check auth.token.auth_time. Measure that window by hand (smoke test steps 3-4).');

  // --- 5. delete, only when asked ------------------------------------------
  if (!opts.deleteRecord) {
    console.log('3. deleteUser SKIPPED — pass --yes-delete to run the irreversible step.');
  } else {
    await auth.deleteUser(opts.uid);
    /** @type {{ code?: string } | null} */
    let lookupError = null;
    try {
      await auth.getUser(opts.uid);
    } catch (e) {
      lookupError = /** @type {{ code?: string }} */ (e);
    }
    const deleted = deleteVerdict(lookupError);
    console.log(`3. deleteUser — ${deleted.detail}`);
    if (!deleted.ok) failures.push('delete');
    console.log('   STILL TO CHECK ON A DEVICE: reopen the Mini App. The uid is derived');
    console.log('   deterministically, so a NEW record under the SAME uid is the expected result —');
    console.log('   deleting does not retire the uid, it only ends this session.');
  }

  console.log(failures.length ? `\nFAILURES: ${failures.join(', ')}` : '\nall scripted checks passed');
  if (failures.length) proc.exit(1);
}

// Only run when invoked directly, so the tests can import the pure helpers.
if (proc.argv[1] && proc.argv[1].endsWith('ops/verify-auth-delete.js')) {
  main().catch((e) => { console.error(String(e)); proc.exit(1); });
}
