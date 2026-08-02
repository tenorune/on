#!/usr/bin/env node
// functions/ops/server.js — local operator panel. Binds 127.0.0.1 ONLY: the
// service-account credential is in-process, so anything reachable off-box is a
// full-database compromise.
//
// Usage: cd functions && node ops/server.js --project <id> [--port 8787]
//   GOOGLE_APPLICATION_CREDENTIALS_JSON = service-account JSON (required)
//   TELEGRAM_UID_SECRET                 = enables exact provenance
//   --prod-project <id> --i-know-this-is-prod   to point at production
//
// Both variables also fall back to functions/.env (and ONLY those two — see
// PANEL_ENV_KEYS). Anything set on the command line wins over that file.
//
// This file is the only caller of ops/{snapshot,project,integrity,merge,purge,
// audit}.js, so every safety property those modules prove is only real if the
// wiring here preserves it. The three that are load-bearing:
//
//   1. The pre-image dump is written AND fsynced BEFORE the destructive write
//      is issued (see `execute`). It is the only path back from an
//      irreversible RTDB update, and a dump that lands after the write
//      protects nothing.
//   2. A dump I/O failure is FATAL. If the pre-image cannot be persisted the
//      write does not happen at all.
//   3. capturePreImage is handed the FULL plan.writes key set — never the wire
//      payload, which rootUpdate has already stripped of the redundant
//      descendants that are exactly the values about to die.
import { createServer } from 'node:http';
import * as nodeFs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { makeOpsDeps } from './deps.js';
import { readSnapshot } from './snapshot.js';
import { buildRows, buildDetail } from './project.js';
import { runChecks } from './integrity.js';
import { buildMergePlan, applyMergePlan } from './merge.js';
import {
  buildPurgePlan, applyPurgePlan, buildLinkImpact, buildProductionLinkPlan,
} from './purge.js';
import { capturePreImage, writeAuditRecord, appendAuditOutcome } from './audit.js';

// The ambient `process` shim (types/app.d.ts) types only .env — it exists for
// browser bundle code. This Node CLI also needs argv/exit, so view the global
// through a locally-typed alias (exit typed `never` so guards narrow).
const proc = /** @type {{ argv: string[]; env: Record<string, string | undefined>; exit: (code?: number) => never }} */ (
  /** @type {unknown} */ (process)
);

const DEFAULT_PORT = 8787;
const DEFAULT_REGION = 'europe-west1';

/** The ONLY address this server ever binds. See the file header. */
export const BIND_ADDRESS = '127.0.0.1';

/**
 * The only host names this server will answer to.
 *
 * Binding to loopback is NOT sufficient on its own. Under DNS rebinding, a
 * page the operator is browsing resolves an attacker-controlled name to
 * 127.0.0.1, becomes same-origin with this server, and can then read
 * /api/snapshot (every uid, share code and tgId) and drive /api/*&#47;execute — a
 * cross-origin POST with no custom headers is a "simple request", so it is
 * delivered and executed regardless of what the response's CORS headers say.
 * The defence is to check the name the browser THINKS it connected to.
 */
export const ALLOWED_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

/** @typedef {ReturnType<typeof makeOpsDeps>} OpsWiring */
/** @typedef {OpsWiring['deps']} OpsDeps */
/** @typedef {OpsWiring['io']} OpsIo */
/** @typedef {import('./types.js').Snapshot} Snapshot */
/** @typedef {import('./types.js').WritePlan} WritePlan */
/** @typedef {import('./audit.js').AuditFs} AuditFs */

/**
 * One route. The input is whatever the dispatcher parsed for the method — a
 * URLSearchParams for GET, a decoded JSON object for POST — so it arrives
 * `unknown` and every handler narrows it explicitly.
 * @typedef {(input: unknown) => Promise<unknown>} RouteHandler
 */

/** @typedef {{ projectId: string, prodProject: string | null, prodAcknowledged: boolean }} GateOptions */

// --- argv / env ------------------------------------------------------------

/**
 * A CLI/env string, or null when it is absent, empty or whitespace. An env var
 * set to '' is an unparseable environment, not a declaration.
 * @param {string | undefined} value
 * @returns {string | null}
 */
function cleaned(value) {
  const trimmed = (value || '').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The ONLY variables the panel will accept from functions/.env.
 *
 * The panel is a plain `node ops/server.js`, so nothing auto-loads that file
 * the way the Firebase CLI does at deploy — yet functions/.env.example points
 * the operator there for TELEGRAM_UID_SECRET, and a secret that is genuinely
 * set still reads "unset" here. Reading the file closes that gap.
 *
 * It stays an allowlist rather than a general dotenv load because this process
 * holds a database-admin credential: letting a file set arbitrary variables in
 * it (FUNCTIONS_REGION, DATABASE_URL, PROD_PROJECT — the last of which decides
 * the production gate) is a wider blast radius than the problem being fixed.
 */
export const PANEL_ENV_KEYS = ['GOOGLE_APPLICATION_CREDENTIALS_JSON', 'TELEGRAM_UID_SECRET'];

/**
 * A dotenv value with one layer of matching surrounding quotes removed. Only a
 * *matched* pair is stripped, so a value that merely starts with a quote keeps
 * it — the secret is arbitrary bytes and guessing at its shape corrupts it.
 * @param {string} raw
 */
function unquote(raw) {
  const value = raw.trim();
  const quote = value[0];
  const quoted = (quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote);
  return quoted ? value.slice(1, -1) : value;
}

/**
 * Layer a functions/.env file UNDERNEATH the real process environment.
 *
 * The inline prefix always wins: it is how both the README and the smoke test
 * invoke this, and how an operator points a single run at a different project.
 * A file on disk quietly beating what was typed on the command line would make
 * the panel lie about which project's secret it is using. An inline value that
 * is empty or whitespace is not a declaration (see `cleaned`), so the file is
 * still the better answer there.
 *
 * @param {Record<string, string | undefined>} env the process environment
 * @param {string | null} fileText functions/.env contents, or null if absent
 * @returns {{ env: Record<string, string | undefined>, loaded: string[] }}
 *   the merged environment, and the variables that came from the file — the
 *   caller reports those at startup so nothing is absorbed silently.
 */
export function withEnvFile(env, fileText) {
  const merged = { ...env };
  /** @type {string[]} */
  const loaded = [];
  if (!fileText) return { env: merged, loaded };

  for (const line of fileText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Split on the FIRST '=' only, and never strip a trailing '#' comment: a
    // secret is arbitrary bytes, so '#' and '=' inside the value are part of
    // it. Truncating one would re-derive every Telegram uid wrong while the
    // panel looked perfectly healthy.
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!PANEL_ENV_KEYS.includes(key)) continue;
    if (cleaned(merged[key]) !== null) continue;

    merged[key] = unquote(trimmed.slice(eq + 1));
    loaded.push(key);
  }
  return { env: merged, loaded };
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function parseArgs(argv, env) {
  /** @param {string} name */
  const val = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

  const projectId = cleaned(val('--project')) || cleaned(env.GCLOUD_PROJECT);
  if (!projectId) throw new Error('Pass --project <firebase-project-id>');

  const saJson = env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!saJson) throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS_JSON to the service-account JSON');

  const region = cleaned(val('--region')) || cleaned(env.FUNCTIONS_REGION) || DEFAULT_REGION;
  const databaseURL = cleaned(val('--database-url')) || cleaned(env.DATABASE_URL)
    || (region === 'us-central1'
      ? `https://${projectId}-default-rtdb.firebaseio.com`
      : `https://${projectId}-default-rtdb.${region}.firebasedatabase.app`);

  // A junk --port must not become NaN and then let the OS pick a port nobody
  // is looking at; refuse instead.
  const rawPort = cleaned(val('--port'));
  const port = rawPort === null ? DEFAULT_PORT : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`--port must be an integer between 1 and 65535 (got ${JSON.stringify(rawPort)})`);
  }

  return {
    projectId,
    saJson,
    region,
    databaseURL,
    port,
    prodProject: cleaned(val('--prod-project')) || cleaned(env.PROD_PROJECT),
    prodAcknowledged: argv.includes('--i-know-this-is-prod'),
    uidSecret: cleaned(env.TELEGRAM_UID_SECRET),
    auditDir: cleaned(val('--audit-dir')) || '.ops-audit',
  };
}

/**
 * Is this run pointed at production? FAILS CLOSED: when nothing declares which
 * project is production (`--prod-project` / `PROD_PROJECT` unset, empty or
 * whitespace) the honest answer is "we do not know", and an operator panel
 * holding a database-admin credential must resolve that to "assume yes".
 * @param {{ projectId: string, prodProject: string | null }} opts
 * @returns {boolean}
 */
export function isProductionTarget(opts) {
  if (opts.prodProject === null || opts.prodProject === undefined) return true;
  return opts.projectId === opts.prodProject;
}

/** @param {GateOptions} opts */
export function assertProdGate(opts) {
  if (!isProductionTarget(opts) || opts.prodAcknowledged) return;
  if (opts.prodProject === null || opts.prodProject === undefined) {
    throw new Error(
      'No production project is declared, so this panel cannot tell dev from production and assumes production. '
      + 'Set --prod-project <id> (or PROD_PROJECT) to name it, or re-run with --i-know-this-is-prod if that is deliberate.',
    );
  }
  throw new Error(`${opts.projectId} is the production project — re-run with --i-know-this-is-prod if that is deliberate`);
}

/**
 * @param {{ confirmUid?: unknown, nonce?: unknown }} body
 * @param {string} expectedUid
 * @param {string | null | undefined} expectedNonce
 */
export function requireConfirm(body, expectedUid, expectedNonce) {
  if (body?.confirmUid !== expectedUid) throw new Error('confirm failed: the typed uid does not match');
  if (!expectedNonce) throw new Error('nonce failed: no preview was issued for this account — preview it again');
  if (body?.nonce !== expectedNonce) throw new Error('nonce failed: this preview is stale — refresh and try again');
}

// --- same-origin guard -----------------------------------------------------

/**
 * Split a `Host`-style authority into its name and (optional) port. Returns
 * null for anything that is not one, so a malformed header is refused rather
 * than parsed leniently.
 * @param {string} authority
 * @returns {{ name: string, port: number | null } | null}
 */
function splitAuthority(authority) {
  const m = /^(\[[0-9a-fA-F:]+\]|[^:[\]]+)(?::([0-9]{1,5}))?$/.exec(authority);
  if (!m) return null;
  return { name: m[1].toLowerCase(), port: m[2] === undefined ? null : Number(m[2]) };
}

/**
 * Is this authority one of ours? The port must match the socket we are
 * actually listening on when the header carries one.
 * @param {string | undefined} authority
 * @param {number | null | undefined} localPort
 */
function isLoopbackAuthority(authority, localPort) {
  if (typeof authority !== 'string' || authority === '') return false;
  const parsed = splitAuthority(authority);
  if (parsed === null) return false;
  if (!ALLOWED_HOSTS.includes(parsed.name)) return false;
  if (parsed.port !== null && localPort != null && parsed.port !== localPort) return false;
  return true;
}

/**
 * Reject anything that did not come from the panel page itself.
 *
 * `Host` catches DNS rebinding: the browser sends the name it resolved, so
 * `evil.example.com` never looks like `127.0.0.1` no matter what it resolves
 * to.
 *
 * `Origin` catches an ordinary cross-origin POST. NOTE — the review asked for
 * "reject any request carrying an Origin header at all"; that is not
 * implementable, because per the Fetch standard a browser attaches `Origin` to
 * every request whose method is not GET/HEAD *including same-origin ones*, so
 * a blanket rejection would 403 the panel's own preview and execute calls and
 * leave the tool unusable. The equivalent-strength rule is applied instead: an
 * `Origin`, when present, must itself be a loopback origin on this very port.
 * A cross-origin caller cannot forge one — `Origin` is a forbidden header name
 * in the browser.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {string | null} the refusal reason, or null when the request is ours
 */
export function originRefusal(req) {
  const localPort = req.socket?.localPort ?? null;
  const host = req.headers.host;
  if (!isLoopbackAuthority(host, localPort)) {
    return `refused: Host "${String(host)}" is not this server's loopback address — `
      + 'this panel answers only to 127.0.0.1 / localhost on its own port (DNS-rebinding guard)';
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    // "null" (a sandboxed or file: document) is not a loopback origin either.
    const parsed = /^https?:\/\/(.+)$/.exec(origin);
    if (parsed === null || !isLoopbackAuthority(parsed[1], localPort)) {
      return `refused: cross-origin request from "${origin}"`;
    }
  }
  return null;
}

// --- request narrowing -----------------------------------------------------

/** @param {unknown} input @returns {URLSearchParams} */
function asQuery(input) {
  if (!(input instanceof URLSearchParams)) throw new Error('expected a query string');
  return input;
}

/** @param {unknown} input @returns {Record<string, unknown>} */
function asBody(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('expected a JSON object body');
  }
  return /** @type {Record<string, unknown>} */ (input);
}

/** @param {unknown} value @param {string} field @returns {string} */
function requireString(value, field) {
  if (typeof value !== 'string' || value === '') throw new Error(`${field} is required`);
  return value;
}

/** @param {unknown} value @param {string} field @returns {string[]} */
function stringList(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`${field} must be an array of strings`);
  }
  return /** @type {string[]} */ (value);
}

// --- routes ----------------------------------------------------------------

/**
 * @param {{
 *   deps: OpsDeps,
 *   io: OpsIo,
 *   opts: ReturnType<typeof parseArgs>,
 *   fs: AuditFs,
 *   auth?: OpsWiring['auth'],
 * }} ctx
 * `auth` is REQUIRED by the purge route and optional elsewhere. It stopped
 * being a nicety on 2026-08-02: a purge on dev deleted `userPrefs/{uid}`, and
 * the account's still-signed-in client put the node back with its cached
 * `following` list (same keys, none of the other fields). Purge clears the
 * database; only revoking the session stops the client refilling it. The rules
 * let that session write `users/{uid}`, `userPrefs/{uid}` and its own rows in
 * every peer's `followers`/`followerNames`, so the resurrection reaches
 * cross-user residue too.
 * @returns {Record<string, RouteHandler>}
 */
export function createRoutes(ctx) {
  const { deps, io, opts, fs, auth } = ctx;

  /** @type {Snapshot | null} */
  let cached = null;
  /**
   * Why the shallow canvas key list is not on the snapshot: absent and empty
   * are DIFFERENT facts. `[]` asserts "there are no canvases"; not knowing
   * means every purge/link-impact report with contacts is lossy by design
   * (ops/purge.js). readSnapshot cannot express "unknown", so the failure is
   * caught here and tracked alongside the cache instead of collapsed into `[]`.
   * @type {string | null}
   */
  let canvasKeysError = null;

  const refresh = async () => {
    /** @type {string | null} */
    let failure = null;
    // listCanvasKeys is a separate shallow REST call. Letting it take the whole
    // panel down would be worse than degrading — but degrading SILENTLY (an
    // account with a drawing reading "nothing to lose") is worse than both.
    /** @type {OpsIo} */
    const guardedIo = {
      listCanvasKeys: async () => {
        try {
          return await io.listCanvasKeys();
        } catch (e) {
          failure = String(e);
          return [];
        }
      },
      listAuthUsers: io.listAuthUsers,
      now: io.now,
    };
    const snap = await readSnapshot(deps, guardedIo);
    canvasKeysError = failure;
    cached = snap;
    return snap;
  };
  const current = async () => cached || refresh();

  /**
   * The key list to hand merge/purge/link-impact, or undefined when it was not
   * examined. NEVER substitute `[]` here.
   * @param {Snapshot} snap
   * @returns {string[] | undefined}
   */
  const canvasKeysOf = (snap) => (canvasKeysError === null ? snap.canvasKeys : undefined);

  /**
   * The same fact, for the page. The panel must render "no canvases" and
   * "canvases were not examined" differently.
   * @param {Snapshot} snap
   */
  const canvasScope = (snap) => (canvasKeysError === null
    ? { examined: true, count: snap.canvasKeys.length, error: null }
    : { examined: false, count: null, error: canvasKeysError });

  /**
   * What an operator actually READ and typed a uid against. A nonce on its own
   * authorises a preview EVENT; it says nothing about the plan, and the
   * execute routes deliberately re-read the database and rebuild the plan
   * rather than trusting a minutes-old snapshot. Without this, the rebuilt
   * plan could differ from the one on screen and be applied anyway — the panel
   * showing one thing and doing another, which is the failure this whole tool
   * exists to prevent.
   * @typedef {{ paths: string[], losses: string[], conflicts: string[] }} PlanDigest
   */
  /** @typedef {{ nonce: string, approved: PlanDigest | null }} Approval */

  /** @type {Map<string, Approval>} */
  const approvals = new Map();

  /**
   * The operator-visible content of a plan. Write VALUES are deliberately not
   * included: merge and the production link stamp `now` into what they write,
   * so values legitimately differ between a preview and the execute that
   * follows it, and comparing them would refuse every real operation. The
   * values are still captured in full by the pre-image dump.
   * @param {WritePlan} plan
   * @returns {PlanDigest}
   */
  const digest = (plan) => ({
    paths: Object.keys(plan.writes).sort(),
    losses: [...plan.losses],
    conflicts: plan.conflicts.map((c) => `${c.kind}|${c.path}|${c.detail}|${c.resolution}`),
  });

  /**
   * randomUUID, not a counter: `n<seq>-<uid>` was guessable from a uid the
   * caller already had, which is no confirmation at all against anything that
   * can reach the socket.
   * @param {string} uid
   * @param {WritePlan | null} plan
   */
  function issueNonce(uid, plan) {
    const nonce = randomUUID();
    approvals.set(uid, { nonce, approved: plan === null ? null : digest(plan) });
    return nonce;
  }

  /**
   * Check the typed uid and the nonce, then BURN the approval: it is for one
   * write, and a replay must go back through a fresh preview.
   * @param {Record<string, unknown>} body @param {string} uid
   * @returns {PlanDigest} what the operator approved
   */
  function consumeConfirm(body, uid) {
    const record = approvals.get(uid);
    requireConfirm(body, uid, record?.nonce ?? null);
    approvals.delete(uid);
    if (!record || record.approved === null) {
      throw new Error(
        'nonce failed: that approval did not come from a preview of this operation — '
        + 'preview it, read the plan, and confirm again',
      );
    }
    return record.approved;
  }

  /**
   * Refuse when the freshly derived plan is not the plan the operator read.
   * Neither version is preferred and nothing is auto-applied: the only safe
   * move is to show the operator the new plan and make them approve that one.
   * @param {PlanDigest} approved
   * @param {WritePlan} plan
   */
  function assertPlanUnchanged(approved, plan) {
    const fresh = digest(plan);
    /** @type {string[]} */
    const diffs = [];
    /** @param {string} label @param {string[]} was @param {string[]} now */
    const compare = (label, was, now) => {
      for (const item of now) if (!was.includes(item)) diffs.push(`+ ${label}: ${item}`);
      for (const item of was) if (!now.includes(item)) diffs.push(`- ${label}: ${item}`);
    };
    compare('path', approved.paths, fresh.paths);
    compare('loss', approved.losses, fresh.losses);
    compare('conflict', approved.conflicts, fresh.conflicts);
    if (diffs.length) {
      throw new Error(
        'refused: the database changed since that preview, so the plan you approved is not the plan '
        + `this would apply. Nothing was written. Preview again and read the new plan:\n${diffs.join('\n')}`,
      );
    }
  }

  /**
   * The Auth record's identifying fields, or null when there is none. Read
   * before an opt-in Auth deletion so the audit record carries the one thing a
   * pre-image cannot: an Auth user, once deleted, has no dump to replay.
   * @param {NonNullable<OpsWiring['auth']>} authHandle
   * @param {string} uid
   * @returns {Promise<{ uid: string, email: string | null, creationTime: string | null } | null>}
   */
  async function readAuthIdentity(authHandle, uid) {
    try {
      const user = await authHandle.getUser(uid);
      return { uid: user.uid, email: user.email ?? null, creationTime: user.metadata?.creationTime ?? null };
    } catch (e) {
      // Already absent is not a failure — the purge should still proceed.
      if (/** @type {{ code?: string }} */ (e)?.code === 'auth/user-not-found') return null;
      throw e;
    }
  }

  /**
   * Capture the pre-image, FLUSH IT TO DISK, and only then apply.
   *
   * The ordering is the whole artifact. writeAuditRecord fsyncs the pre-image
   * file, the JSONL log and the containing directory; if any of that throws,
   * `apply` is never reached, so a dump that failed can never be paired with a
   * write that succeeded. The outcome lands afterwards as a second JSONL line
   * — including on failure, because an audit trail that only logs successes is
   * not an audit trail.
   *
   * @param {string} op
   * @param {string[]} uids
   * @param {WritePlan} plan
   * @param {(plan: WritePlan) => Promise<void>} apply
   * @param {{ uid: string, email: string | null, creationTime: string | null } | null} [authRecord]
   *   identity of an Auth record this operation is about to delete, recorded in
   *   the audit file because no pre-image can bring one back.
   */
  async function execute(op, uids, plan, apply, authRecord = null) {
    // The FULL preview write-set, not the wire payload: rootUpdate drops a null
    // that sits under an already-nulled ancestor, and those dropped descendants
    // are precisely the values that disappear with no other record of them.
    const paths = Object.keys(plan.writes);
    const preImage = await capturePreImage(deps, paths);
    const ts = deps.now();

    const preImageFile = writeAuditRecord(fs, opts.auditDir, {
      ts,
      op,
      project: opts.projectId,
      uids,
      preImage,
      // Present only when an Auth deletion was opted into. It is not a
      // pre-image — nothing can replay it — but it records what existed.
      ...(authRecord ? { authRecord } : {}),
      outcome: 'pending — pre-image captured and flushed; the destructive write has not been issued yet',
    });

    /** @param {string} outcome */
    const finish = (outcome) => appendAuditOutcome(fs, opts.auditDir, {
      ts, op, project: opts.projectId, uids, paths: paths.length, preImageFile, completedAt: deps.now(), outcome,
    });

    try {
      await apply(plan);
    } catch (e) {
      // The outcome append must never replace the real reason the write failed.
      try {
        finish(`failed: ${String(e)}`);
      } catch (auditErr) {
        console.error(`could not append the failed-outcome audit line: ${String(auditErr)}`);
      }
      cached = null; // the database state after a failed atomic update is not assumed
      throw e;
    }

    // PAST THIS POINT THE WRITE HAPPENED. Nothing below may turn that into a
    // failed request: telling an operator a destructive write failed when it
    // succeeded is worse than a crash — they would re-run it, and the panel
    // would keep serving pre-mutation rows.
    cached = null; // force a fresh read after any mutation
    /** @type {string | null} */
    let auditWarning = null;
    try {
      finish('ok');
    } catch (auditErr) {
      auditWarning = `THE WRITE SUCCEEDED, but the audit outcome line could not be appended (${String(auditErr)}). `
        + `${preImageFile} is on disk and complete; audit.jsonl still shows this operation as "pending", which normally `
        + 'means the process died mid-write — here it did not. Reconcile the log by hand.';
      console.error(auditWarning);
    }

    return {
      ok: true,
      op,
      // NOT "what was written": plan.writes is a superset of the wire payload.
      previewPaths: paths.length,
      preImageFile,
      auditWarning,
    };
  }

  /**
   * The merge argument block, built ONCE. Preview and execute constructing
   * their own is exactly how a panel comes to show one thing and do another.
   * @param {Record<string, unknown>} body
   * @param {string[] | undefined} canvasKeys
   * @param {number} now
   */
  const mergeOptions = (body, canvasKeys, now) => ({
    loserUid: requireString(body.loserUid, 'loserUid'),
    survivorUid: requireString(body.survivorUid, 'survivorUid'),
    adoptGroupNames: stringList(body.adoptGroupNames, 'adoptGroupNames'),
    telegramRepoint: Boolean(body.telegramRepoint),
    canvasKeys,
    now,
  });

  /**
   * Likewise for the production-link plan.
   * @param {Record<string, unknown>} body
   * @param {number} now
   */
  const linkOptions = (body, now) => ({
    derivedUid: requireString(body.derivedUid, 'derivedUid'),
    phraseUid: requireString(body.phraseUid, 'phraseUid'),
    now,
  });

  return {
    'GET /api/snapshot': async () => {
      const snap = await refresh();
      return {
        takenAt: snap.takenAt,
        project: opts.projectId,
        isProd: isProductionTarget(opts),
        canvasKeys: canvasScope(snap),
        // Ages and availability are computed against the SNAPSHOT's instant,
        // not the wall clock. Snapshots are cached, and a table whose ages
        // drift away from the data they describe would quietly disagree with
        // its own takenAt header.
        rows: buildRows(snap, opts.uidSecret, snap.takenAt),
      };
    },

    'GET /api/detail': async (input) => {
      const uid = requireString(asQuery(input).get('uid'), 'uid');
      const snap = await current();
      const detail = buildDetail(snap, uid, opts.uidSecret, snap.takenAt);
      if (!detail) throw new Error(`no account at users/${uid}`);
      // A detail view is not an approval of anything: the nonce it issues
      // carries NO plan, so an execute presenting it is refused (see
      // consumeConfirm) until the operation itself has been previewed.
      return { detail, nonce: issueNonce(uid, null), canvasKeys: canvasScope(snap) };
    },

    'GET /api/integrity': async () => ({ findings: runChecks(await current()) }),

    'POST /api/merge/preview': async (input) => {
      const body = asBody(input);
      const snap = await current();
      const plan = await buildMergePlan(deps, mergeOptions(body, canvasKeysOf(snap), deps.now()));
      return { plan, nonce: issueNonce(requireString(body.loserUid, 'loserUid'), plan), canvasKeys: canvasScope(snap) };
    },
    'POST /api/merge/execute': async (input) => {
      const body = asBody(input);
      const approved = consumeConfirm(body, requireString(body.loserUid, 'loserUid'));
      // Re-read rather than reuse the cache: the snapshot behind the preview is
      // minutes old by the time an operator types a uid, and a stale
      // snapshot-derived input gating a destructive write has already destroyed
      // data once in this plan. The re-derived plan is then checked AGAINST the
      // one the operator read — re-reading is right, applying a plan nobody
      // approved is not.
      const snap = await refresh();
      const options = mergeOptions(body, canvasKeysOf(snap), deps.now());
      const plan = await buildMergePlan(deps, options);
      assertPlanUnchanged(approved, plan);
      return execute('merge', [options.loserUid, options.survivorUid], plan, (p) => applyMergePlan(deps, p));
    },

    'POST /api/purge/preview': async (input) => {
      const body = asBody(input);
      const uid = requireString(body.uid, 'uid');
      const snap = await current();
      const plan = await buildPurgePlan(deps, uid, canvasKeysOf(snap));
      return { plan, nonce: issueNonce(uid, plan), canvasKeys: canvasScope(snap) };
    },
    'POST /api/purge/execute': async (input) => {
      const body = asBody(input);
      const uid = requireString(body.uid, 'uid');
      const approved = consumeConfirm(body, uid);
      const snap = await refresh();
      const plan = await buildPurgePlan(deps, uid, canvasKeysOf(snap));
      assertPlanUnchanged(approved, plan);

      // FAIL CLOSED. A purge whose session cannot be ended does not stick, and
      // reporting success for a write the client will undo is worse than
      // refusing: the operator walks away believing the account is gone.
      if (!auth) {
        throw new Error('purge needs an Admin-SDK auth handle to end the account\'s session — refusing');
      }
      const deleteAuthRecord = body.deleteAuthRecord === true;

      // Read the identity BEFORE anything destructive: no pre-image can restore
      // an Auth record, so these fields are the only trace it ever existed.
      const authRecord = deleteAuthRecord ? await readAuthIdentity(auth, uid) : null;

      // Revoke BEFORE the write. After it, there is a window in which the
      // client can put back exactly what was deleted — which is the bug.
      //
      // An account Firebase Auth has never seen is the ONE benign failure here
      // (G8, found on dev 2026-08-03): no Auth record means no session, so
      // there is nothing to outlive the write and nothing to republish a cache.
      // Refusing it refused the safest case — and made purging a synthetic
      // account impossible, which is the documented mitigation for G3 and G6
      // and what every ops/seed-merge-fixture.js account is. An ALLOWLIST of
      // one code, like opGuard's: any other failure is a revoke that should
      // have worked and did not, and that is G2, so it still refuses.
      /** @type {string | undefined} */
      let sessionNote;
      try {
        await auth.revokeRefreshTokens(uid);
      } catch (e) {
        if (/** @type {{ code?: string }} */ (e)?.code !== 'auth/user-not-found') {
          throw new Error(`purge refused: the account's session could not be revoked (${String(e)}). A purge whose session cannot be ended does not stick.`);
        }
        sessionNote = `NO AUTH RECORD for ${uid} — nothing to revoke, so no session can survive this purge. Deletion proceeded. An RTDB-only account (a seeded fixture, or one whose Auth record was already removed) is the expected case.`;
      }

      const executed = await execute('purge', [uid], plan, (p) => applyPurgePlan(deps, p), authRecord);
      const result = sessionNote ? { ...executed, sessionNote } : executed;
      if (!deleteAuthRecord) return result;

      // Nothing to delete, and calling deleteUser anyway would warn about a
      // record that never existed. readAuthIdentity already returns null for
      // exactly this case, so the absence is established, not assumed.
      if (!authRecord) return { ...result, authRecordDeleted: false, authRecord: null };

      // Irreversible LAST, and — like the audit-outcome append above — a
      // failure here may not turn a completed purge into a failed request.
      try {
        await auth.deleteUser(uid);
        return { ...result, authRecordDeleted: true, authRecord };
      } catch (e) {
        return {
          ...result,
          authRecordDeleted: false,
          authRecord,
          authWarning: `THE PURGE SUCCEEDED and the session is revoked, but the Auth record could not be deleted (${String(e)}). The record remains; the account cannot sign back in until it is removed by hand.`,
        };
      }
    },

    'POST /api/link/impact': async (input) => {
      const body = asBody(input);
      const snap = await current();
      const impact = await buildLinkImpact(deps, requireString(body.derivedUid, 'derivedUid'), canvasKeysOf(snap));
      return { ...impact, canvasKeys: canvasScope(snap) };
    },
    'POST /api/link/production/preview': async (input) => {
      const body = asBody(input);
      const snap = await current();
      const options = linkOptions(body, deps.now());
      const plan = await buildProductionLinkPlan(deps, options, canvasKeysOf(snap));
      return { plan, nonce: issueNonce(options.derivedUid, plan), canvasKeys: canvasScope(snap) };
    },
    'POST /api/link/production/execute': async (input) => {
      const body = asBody(input);
      const approved = consumeConfirm(body, requireString(body.derivedUid, 'derivedUid'));
      const snap = await refresh();
      const options = linkOptions(body, deps.now());
      const plan = await buildProductionLinkPlan(deps, options, canvasKeysOf(snap));
      assertPlanUnchanged(approved, plan);
      return execute('link-production', [options.derivedUid, options.phraseUid], plan, (p) => applyPurgePlan(deps, p));
    },
  };
}

// --- HTTP ------------------------------------------------------------------

/**
 * @param {{ routes: Record<string, RouteHandler>, page: string }} ctx
 * @returns {import('node:http').Server}
 */
export function createHttpServer({ routes, page }) {
  return createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${BIND_ADDRESS}`);
    const key = `${req.method} ${url.pathname}`;
    /** @param {number} code @param {string} type @param {string} body */
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };

    // Before ANY routing, including the page: this server has no auth and holds
    // a database-admin credential, so a request that did not come from the
    // panel itself is refused outright rather than answered.
    const refusal = originRefusal(req);
    if (refusal !== null) return send(403, 'text/plain', refusal);

    if (key === 'GET /') return send(200, 'text/html; charset=utf-8', page);
    const handler = routes[key];
    if (!handler) return send(404, 'text/plain', 'not found');

    /** @param {unknown} payload */
    const ok = (payload) => send(200, 'application/json', JSON.stringify(payload));
    /** @param {unknown} e */
    const fail = (e) => send(400, 'application/json', JSON.stringify({ error: String(e) }));

    if (req.method === 'GET') return Promise.resolve(handler(url.searchParams)).then(ok).catch(fail);

    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      /** @type {unknown} */
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch (e) {
        // A malformed body must answer like every other refusal, not crash the
        // process on an exception thrown inside an event handler.
        fail(e);
        return;
      }
      Promise.resolve(handler(body)).then(ok).catch(fail);
    });
    return undefined;
  });
}

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * functions/.env, or null when there is no such file. A read that fails for any
 * reason OTHER than absence is fatal: an unreadable file is a configuration the
 * operator needs to see, and swallowing it would reproduce the exact confusion
 * this loading exists to end — a secret that is set but silently missing.
 * @param {string} path
 */
function readEnvFile(path) {
  try {
    return nodeFs.readFileSync(path, 'utf8');
  } catch (e) {
    if (/** @type {{ code?: string }} */ (e).code === 'ENOENT') return null;
    throw e;
  }
}

async function main() {
  const { env, loaded } = withEnvFile(proc.env, readEnvFile(join(HERE, '..', '.env')));
  const opts = parseArgs(proc.argv.slice(2), env);
  assertProdGate(opts);
  const { deps, io, auth } = makeOpsDeps(opts);
  const routes = createRoutes({ deps, io, opts, fs: nodeFs, auth });
  const page = nodeFs.readFileSync(join(HERE, 'panel.html'), 'utf8');

  // BIND_ADDRESS is loopback ONLY — this process holds a service-account
  // credential, so a listener reachable off-box is a full-database compromise.
  createHttpServer({ routes, page }).listen(opts.port, BIND_ADDRESS, () => {
    console.log(`ops panel: http://${BIND_ADDRESS}:${opts.port}  project=${opts.projectId}`);
    if (isProductionTarget(opts)) {
      console.log(opts.prodProject
        ? '*** PRODUCTION ***'
        : '*** ASSUMING PRODUCTION — no --prod-project declared ***');
    }
    if (loaded.length) console.log(`loaded from functions/.env: ${loaded.join(', ')}`);
    if (!opts.uidSecret) console.log('TELEGRAM_UID_SECRET unset — provenance will read "unknown"');
    console.log(`audit trail: ${opts.auditDir}/`);
  });
}

// Only run when invoked directly, so the tests can import the pure helpers.
if (proc.argv[1] && proc.argv[1].endsWith('ops/server.js')) {
  main().catch((e) => { console.error(String(e)); proc.exit(1); });
}
