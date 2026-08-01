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
// pre-image dump follows the SAME rule: a write-set path that is a bare canvas
// root (`canvases/{pair}`, the shape crossRefRenderers emits for a deletion)
// is NEVER read whole — a whole-node read reaches strokes transitively. Only
// the named metadata leaves merge.js carries are read, one field at a time,
// and the strokes omission is written INTO the pre-image itself (a string
// note in place of the payload) so a future operator sees what was never
// captured rather than assuming an empty canvas. Any path that names
// `.../strokes` explicitly is refused the same way, defense in depth.

// Mirrors merge.js's CANVAS_CARRIED. Not imported: that constant is private to
// merge.js, and this list would need to change in lockstep with it regardless
// (both trace back to the same operator ruling that strokes are never carried
// or read). If merge.js ever carries a new field, this list must gain it too.
const CANVAS_METADATA_FIELDS = ['bg'];

const CANVAS_ROOT_RE = /^canvases\/[^/]+$/;
const STROKES_PATH_RE = /\/strokes(\/|$)/;

const STROKES_OMITTED = 'strokes not captured — canvases/*/strokes is unbounded and is never read or written by the ops audit dump';

/**
 * Read the pre-image value for one write-set path, honoring the strokes rule.
 * @param {{ getVal: (path: string) => Promise<any> }} deps
 * @param {string} path
 * @returns {Promise<unknown>}
 */
async function readPreImageValue(deps, path) {
  // Defense in depth: an explicit strokes path (root or nested) is refused
  // without ever calling getVal, even though nothing upstream should pass one.
  if (STROKES_PATH_RE.test(path)) return STROKES_OMITTED;

  if (CANVAS_ROOT_RE.test(path)) {
    // A whole-node write target (crossRefRenderers emits exactly this shape
    // for a canvas deletion). Read named metadata leaves ONLY — never the
    // node itself, which would pull the strokes child in transitively.
    /** @type {Record<string, unknown>} */
    const metadata = {};
    for (const field of CANVAS_METADATA_FIELDS) {
      const value = await deps.getVal(`${path}/${field}`);
      if (value !== null && value !== undefined) metadata[field] = value;
    }
    return { ...metadata, strokes: STROKES_OMITTED };
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
 * @param {{
 *   mkdirSync: (path: string, opts?: object) => unknown,
 *   writeFileSync: (path: string, body: string) => unknown,
 *   appendFileSync: (path: string, body: string) => unknown,
 * }} fs
 * @param {string} dir
 * @param {{ ts: number, op: string, project: string, uids: string[], preImage: Record<string, unknown>, outcome: string }} record
 * @returns {string} the pre-image file path
 */
export function writeAuditRecord(fs, dir, record) {
  fs.mkdirSync(dir, { recursive: true });
  const file = `${dir}/${record.ts}-${record.op}-${record.uids[0]}.json`;
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  fs.appendFileSync(`${dir}/audit.jsonl`, `${JSON.stringify({
    ts: record.ts,
    op: record.op,
    project: record.project,
    uids: record.uids,
    paths: Object.keys(record.preImage).length,
    outcome: record.outcome,
    preImageFile: file,
  })}\n`);
  return file;
}
