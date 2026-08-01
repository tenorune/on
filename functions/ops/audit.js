// functions/ops/audit.js — the only thing resembling undo. RTDB has no
// rollback, so before any mutation the panel dumps the CURRENT value of every
// path the write-set touches. The JSONL line stays payload-free (path count
// only) so it can be read at a glance; the values live in the per-op file.
//
// `fs` is injected so this tests without touching disk.
//
// OPERATOR RULING — canvases/{pair}/strokes is the only unbounded node in the
// database. merge.js and purge.js (via buildExpungeWrites) never carry or read
// strokes; a destroyed canvas is a reported loss, not a preserved one. The
// pre-image dump follows the SAME rule. This is enforced as an INVARIANT over
// every path shape, not a lookup of the two shapes today's write-sets happen
// to produce (round-1 review, I1): the database root, a bare `canvases`
// ancestor, and anything under `canvases/` (any depth, any trailing slash)
// are all routed away from a raw `getVal`, and a refusal is written INTO the
// pre-image the same way the strokes omission is, so a gap is visible rather
// than silent.
import { CANVAS_CARRIED } from './merge.js';

/**
 * @typedef {{
 *   mkdirSync: (path: string, opts?: object) => unknown,
 *   writeFileSync: (path: string, body: string, opts?: { flag?: string }) => unknown,
 *   appendFileSync: (path: string, body: string) => unknown,
 *   openSync: (path: string, flags: string) => number,
 *   fsyncSync: (fd: number) => unknown,
 *   closeSync: (fd: number) => unknown,
 * }} AuditFs
 */

const STROKES_OMITTED = 'strokes not captured — canvases/*/strokes is unbounded and is never read or written by the ops audit dump';
const REFUSED_ROOT = 'refused — the database root (or an empty path) is not read; a whole-database read would reach canvases/*/strokes transitively';
const REFUSED_CANVASES_ANCESTOR = 'refused — "canvases" is a bare ancestor of every canvas including canvases/*/strokes; it is never read whole';

/** RTDB's own path normalization: no leading/trailing slash, no doubled slashes. @param {string} path */
function normalizePath(path) {
  return path.replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * A destroyed-canvas write target (`canvases/{pair}`, the exact shape
 * crossRefRenderers emits — telegram-auth.js:414-415 — for a canvas
 * deletion). Read named metadata leaves ONLY, one field at a time, from the
 * SAME list merge.js carries — never the node itself, which would pull the
 * strokes child in transitively.
 * @param {{ getVal: (path: string) => Promise<any> }} deps
 * @param {string} path
 * @returns {Promise<Record<string, unknown>>}
 */
async function readCanvasMetadata(deps, path) {
  /** @type {Record<string, unknown>} */
  const metadata = {};
  for (const field of CANVAS_CARRIED) {
    const value = await deps.getVal(`${path}/${field}`);
    if (value !== null && value !== undefined) metadata[field] = value;
  }
  return { ...metadata, strokes: STROKES_OMITTED };
}

/**
 * Read the pre-image value for one write-set path, honoring the strokes rule
 * as an invariant over the path's SHAPE, not a lookup of known-good shapes.
 * @param {{ getVal: (path: string) => Promise<any> }} deps
 * @param {string} rawPath
 * @returns {Promise<unknown>}
 */
async function readPreImageValue(deps, rawPath) {
  const path = normalizePath(rawPath);

  // The database root, or an empty path — never a whole-database read.
  if (path === '') return REFUSED_ROOT;
  // A bare ancestor of every canvas — never read whole.
  if (path === 'canvases') return REFUSED_CANVASES_ANCESTOR;

  if (path.startsWith('canvases/')) {
    // Any depth, anywhere: `.../strokes` (or a nested strokes path) is
    // refused outright, no read issued at all — defense in depth, since
    // nothing upstream should ever hand this in.
    if (/\/strokes(\/|$)/.test(path)) return STROKES_OMITTED;

    const rest = path.slice('canvases/'.length); // non-empty: 'canvases' alone was handled above
    if (!rest.includes('/')) {
      // Exactly `canvases/{pair}` (a trailing slash was already stripped by
      // normalizePath) — the whole-node write target. Metadata-only.
      return readCanvasMetadata(deps, path);
    }
    // A genuine named leaf under a canvas (e.g. `canvases/{pair}/bg`) reads
    // only that leaf — it cannot reach strokes unless the leaf name IS
    // strokes, already excluded above.
    const value = await deps.getVal(path);
    return value ?? null;
  }

  const value = await deps.getVal(path);
  return value ?? null;
}

/**
 * @param {{ getVal: (path: string) => Promise<any> }} deps
 * @param {string[]} paths
 * @returns {Promise<Record<string, unknown>>}
 */
export async function capturePreImage(deps, paths) {
  const values = await Promise.all(paths.map((p) => readPreImageValue(deps, p)));
  /** @type {Record<string, unknown>} */
  const out = {};
  paths.forEach((p, i) => { out[p] = values[i]; });
  return out;
}

/**
 * fsync a file just written via writeFileSync/appendFileSync: the write
 * syscall returning only means the bytes were handed to the kernel, not that
 * they are on stable storage. The dump's entire purpose is surviving a crash
 * in the window right before a destructive write, so that gap is closed here
 * rather than trusted away (round-1 review, I2).
 * @param {AuditFs} fs @param {string} path
 */
function fsyncFile(fs, path) {
  const fd = fs.openSync(path, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * fsync the directory itself. A newly created filename is not durable until
 * its directory entry is flushed too — POSIX does not guarantee a crash right
 * after `writeFileSync` leaves the new name visible on recovery even if the
 * file's own bytes are synced. Both files this module writes can be
 * brand-new (the per-op file always is on first write; `audit.jsonl` is on
 * the very first call for a given directory), so the directory is synced
 * once per call rather than conditionally guessing which write was new.
 * @param {AuditFs} fs @param {string} dir
 */
function fsyncDir(fs, dir) {
  const fd = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** @param {unknown} err @returns {boolean} */
function isEexist(err) {
  if (typeof err !== 'object' || err === null) return false;
  return /** @type {{ code?: unknown }} */ (err).code === 'EEXIST';
}

/**
 * Reserve a filename exclusively (`wx`, refuses to clobber): a same-
 * millisecond/op/uid collision must not silently overwrite a prior audit
 * record, the one artifact that is the only path back from an irreversible
 * write (round-1 review, M4). Retries with a numeric suffix until an unused
 * name is found.
 * @param {AuditFs} fs @param {string} base @param {string} body
 * @returns {string}
 */
function writeExclusive(fs, base, body) {
  let path = base;
  let attempt = 1;
  for (;;) {
    try {
      fs.writeFileSync(path, body, { flag: 'wx' });
      return path;
    } catch (err) {
      if (!isEexist(err)) throw err;
      attempt += 1;
      path = base.replace(/\.json$/, `-${attempt}.json`);
    }
  }
}

/**
 * @param {AuditFs} fs
 * @param {string} dir
 * @param {{ ts: number, op: string, project: string, uids: string[], preImage: Record<string, unknown>, outcome: string }} record
 * @returns {string} the pre-image file path
 */
export function writeAuditRecord(fs, dir, record) {
  fs.mkdirSync(dir, { recursive: true });
  // An empty uids array must not produce an unguarded `undefined` in the
  // filename (round-1 review, M4).
  const uid = record.uids[0] ?? 'no-uid';
  const base = `${dir}/${record.ts}-${record.op}-${uid}.json`;
  const file = writeExclusive(fs, base, JSON.stringify(record, null, 2));
  fsyncFile(fs, file);

  fs.appendFileSync(`${dir}/audit.jsonl`, `${JSON.stringify({
    ts: record.ts,
    op: record.op,
    project: record.project,
    uids: record.uids,
    paths: Object.keys(record.preImage).length,
    outcome: record.outcome,
    preImageFile: file,
  })}\n`);
  fsyncFile(fs, `${dir}/audit.jsonl`);

  fsyncDir(fs, dir);
  return file;
}

/**
 * Append the OUTCOME of a destructive write, after the fact.
 *
 * The pre-image dump has to be complete and fsynced BEFORE the destructive
 * write is issued — that is its entire purpose, since the window it protects
 * is the one between "the values still exist" and "they do not". So the
 * outcome cannot ride on the same record: writeAuditRecord is called first
 * with a `pending` outcome, and this appends the resolution as a second JSONL
 * line correlated by `ts`/`op`/`uids` and by the pre-image file path.
 *
 * No directory fsync here: `audit.jsonl` already exists (writeAuditRecord
 * created and synced it), so this append adds no new directory entry.
 *
 * @param {AuditFs} fs
 * @param {string} dir
 * @param {{
 *   ts: number,
 *   op: string,
 *   project: string,
 *   uids: string[],
 *   paths: number,
 *   preImageFile: string,
 *   completedAt: number,
 *   outcome: string,
 * }} record
 */
export function appendAuditOutcome(fs, dir, record) {
  fs.appendFileSync(`${dir}/audit.jsonl`, `${JSON.stringify(record)}\n`);
  fsyncFile(fs, `${dir}/audit.jsonl`);
}
