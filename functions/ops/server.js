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
 * `auth` is carried from makeOpsDeps but no route uses it: the Admin-SDK auth
 * handle is already closed over by io.listAuthUsers, and the one route that
 * would need it directly — D5, deleting the Auth record alongside a purge — is
 * deferred on purpose until admin.auth().deleteUser is verified against a
 * custom-token uid on dev.
 * @returns {Record<string, RouteHandler>}
 */
export function createRoutes(ctx) {
  const { deps, io, opts, fs } = ctx;

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

  /** Nonces issued by a detail/preview response, consumed by the matching execute. */
  /** @type {Map<string, string>} */
  const nonces = new Map();
  let nonceSeq = 0;
  /** @param {string} uid */
  function issueNonce(uid) {
    nonceSeq += 1;
    const nonce = `n${nonceSeq}-${uid}`;
    nonces.set(uid, nonce);
    return nonce;
  }
  /**
   * Check the typed uid and the nonce, then BURN the nonce: an approval is for
   * one write, and a replayed execute must go back through a fresh preview.
   * @param {Record<string, unknown>} body @param {string} uid
   */
  function consumeConfirm(body, uid) {
    requireConfirm(body, uid, nonces.get(uid) ?? null);
    nonces.delete(uid);
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
   */
  async function execute(op, uids, plan, apply) {
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
      outcome: 'pending — pre-image captured and flushed; the destructive write has not been issued yet',
    });

    /** @param {string} outcome */
    const finish = (outcome) => appendAuditOutcome(fs, opts.auditDir, {
      ts, op, project: opts.projectId, uids, paths: paths.length, preImageFile, completedAt: deps.now(), outcome,
    });

    try {
      await apply(plan);
    } catch (e) {
      finish(`failed: ${String(e)}`);
      cached = null; // the database state after a failed atomic update is not assumed
      throw e;
    }
    finish('ok');
    cached = null; // force a fresh read after any mutation
    return {
      ok: true,
      op,
      // NOT "what was written": plan.writes is a superset of the wire payload.
      previewPaths: paths.length,
      preImageFile,
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
        rows: buildRows(snap, opts.uidSecret),
      };
    },

    'GET /api/detail': async (input) => {
      const uid = requireString(asQuery(input).get('uid'), 'uid');
      const snap = await current();
      const detail = buildDetail(snap, uid, opts.uidSecret);
      if (!detail) throw new Error(`no account at users/${uid}`);
      return { detail, nonce: issueNonce(uid), canvasKeys: canvasScope(snap) };
    },

    'GET /api/integrity': async () => ({ findings: runChecks(await current()) }),

    'POST /api/merge/preview': async (input) => {
      const body = asBody(input);
      const snap = await current();
      const plan = await buildMergePlan(deps, mergeOptions(body, canvasKeysOf(snap), deps.now()));
      return { plan, nonce: issueNonce(requireString(body.loserUid, 'loserUid')), canvasKeys: canvasScope(snap) };
    },
    'POST /api/merge/execute': async (input) => {
      const body = asBody(input);
      consumeConfirm(body, requireString(body.loserUid, 'loserUid'));
      // Re-read rather than reuse the cache: the snapshot behind the preview is
      // minutes old by the time an operator types a uid, and a stale
      // snapshot-derived input gating a destructive write has already destroyed
      // data once in this plan.
      const snap = await refresh();
      const options = mergeOptions(body, canvasKeysOf(snap), deps.now());
      const plan = await buildMergePlan(deps, options);
      return execute('merge', [options.loserUid, options.survivorUid], plan, (p) => applyMergePlan(deps, p));
    },

    'POST /api/purge/preview': async (input) => {
      const body = asBody(input);
      const uid = requireString(body.uid, 'uid');
      const snap = await current();
      const plan = await buildPurgePlan(deps, uid, canvasKeysOf(snap));
      return { plan, nonce: issueNonce(uid), canvasKeys: canvasScope(snap) };
    },
    'POST /api/purge/execute': async (input) => {
      const body = asBody(input);
      const uid = requireString(body.uid, 'uid');
      consumeConfirm(body, uid);
      const snap = await refresh();
      const plan = await buildPurgePlan(deps, uid, canvasKeysOf(snap));
      return execute('purge', [uid], plan, (p) => applyPurgePlan(deps, p));
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
      return { plan, nonce: issueNonce(options.derivedUid), canvasKeys: canvasScope(snap) };
    },
    'POST /api/link/production/execute': async (input) => {
      const body = asBody(input);
      consumeConfirm(body, requireString(body.derivedUid, 'derivedUid'));
      const snap = await refresh();
      const options = linkOptions(body, deps.now());
      const plan = await buildProductionLinkPlan(deps, options, canvasKeysOf(snap));
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

async function main() {
  const opts = parseArgs(proc.argv.slice(2), proc.env);
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
    if (!opts.uidSecret) console.log('TELEGRAM_UID_SECRET unset — provenance will read "unknown"');
    console.log(`audit trail: ${opts.auditDir}/`);
  });
}

// Only run when invoked directly, so the tests can import the pure helpers.
if (proc.argv[1] && proc.argv[1].endsWith('ops/server.js')) {
  main().catch((e) => { console.error(String(e)); proc.exit(1); });
}
