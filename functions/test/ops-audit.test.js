import { makeStoreDeps } from './store-deps.js';
import { capturePreImage, writeAuditRecord } from '../ops/audit.js';
import { CANVAS_CARRIED } from '../ops/merge.js';

// A fake fs that models the durability primitives writeAuditRecord now uses
// (round-1 review, I2): openSync/fsyncSync/closeSync, and writeFileSync
// honoring the exclusive-create flag (`wx`) so a same-name write throws
// EEXIST exactly like node:fs does, rather than silently clobbering.
function makeFakeFs() {
  /** @type {Record<string, string>} */
  const files = {};
  /** @type {Record<number, string>} */
  const openFds = {};
  /** @type {string[]} */
  const fsyncedPaths = [];
  let nextFd = 1;
  const fs = {
    mkdirSync: () => {},
    writeFileSync: (path, body, opts) => {
      if (opts && opts.flag === 'wx' && Object.prototype.hasOwnProperty.call(files, path)) {
        const err = new Error(`EEXIST: file already exists, open '${path}'`);
        /** @type {any} */ (err).code = 'EEXIST';
        throw err;
      }
      files[path] = body;
    },
    appendFileSync: (path, body) => { files[path] = (files[path] || '') + body; },
    openSync: (path) => { const fd = nextFd; nextFd += 1; openFds[fd] = path; return fd; },
    fsyncSync: (fd) => { fsyncedPaths.push(openFds[fd]); },
    closeSync: (fd) => { delete openFds[fd]; },
  };
  return { fs, files, fsyncedPaths };
}

describe('capturePreImage', () => {
  test('reads the current value of every path the plan will write', async () => {
    const deps = makeStoreDeps({ 'users/u1': { presence: { code: 'AAA111' } }, 'codeIndex/AAA111': 'u1' });
    const pre = await capturePreImage(deps, ['users/u1', 'codeIndex/AAA111', 'users/absent']);
    expect(pre).toEqual({
      'users/u1': { presence: { code: 'AAA111' } },
      'codeIndex/AAA111': 'u1',
      'users/absent': null,
    });
  });

  // Operator ruling: canvases/{pair}/strokes is the only unbounded node in the
  // database, and the pre-image dump follows the same rule merge/purge do —
  // it must never read or write stroke bodies. A destroyed canvas is recorded
  // as "it existed, here is its metadata", never as its drawing.
  test('captures a destroyed canvas as metadata only, never its strokes', async () => {
    const deps = makeStoreDeps({
      'canvases/aaa_bbb': {
        bg: '#fff',
        // A whole-node read of canvases/aaa_bbb would pull this in. It must
        // never be reachable through capturePreImage.
        strokes: { s1: { points: [1, 2, 3], blob: 'x'.repeat(5000) } },
      },
    });
    const pre = await capturePreImage(deps, ['canvases/aaa_bbb']);

    // Positive: the metadata that IS recoverable is captured.
    expect(pre['canvases/aaa_bbb']).toMatchObject({ bg: '#fff' });
    // Negative: the omission is recorded IN the dump, not silently absent,
    // and it is definitely not the real stroke payload.
    expect(pre['canvases/aaa_bbb'].strokes).not.toEqual({ s1: { points: [1, 2, 3], blob: 'x'.repeat(5000) } });
    expect(typeof pre['canvases/aaa_bbb'].strokes).toBe('string');
    expect(pre['canvases/aaa_bbb'].strokes).toMatch(/strokes/i);

    // No read this function issued ever targeted the bare canvas root (which
    // would pull the whole node, strokes included) or anything under /strokes.
    for (const [path] of deps.getVal.mock.calls) {
      expect(path).not.toBe('canvases/aaa_bbb');
      expect(path).not.toMatch(/\/strokes(\/|$)/);
    }
  });

  test('refuses to read an explicit strokes path even if one is passed in', async () => {
    const deps = makeStoreDeps({ 'canvases/aaa_bbb/strokes/s1': { points: [1, 2, 3] } });
    const pre = await capturePreImage(deps, ['canvases/aaa_bbb/strokes/s1']);
    expect(pre['canvases/aaa_bbb/strokes/s1']).not.toEqual({ points: [1, 2, 3] });
    expect(deps.getVal).not.toHaveBeenCalled();
  });

  test('a canvas with no metadata still records the strokes omission, not a false empty', async () => {
    const deps = makeStoreDeps({ 'canvases/ccc_ddd': { strokes: { s1: { points: [9] } } } });
    const pre = await capturePreImage(deps, ['canvases/ccc_ddd']);
    expect(pre['canvases/ccc_ddd'].bg).toBeUndefined();
    expect(typeof pre['canvases/ccc_ddd'].strokes).toBe('string');
  });

  // Round-1 review (I1): the strokes guard must be an invariant over path
  // SHAPE, not a lookup of the two shapes today's write-sets happen to
  // produce. Each of these is a shape the old CANVAS_ROOT_RE/STROKES_PATH_RE
  // pair let fall through to an unrestricted deps.getVal(path) — a
  // whole-subtree read reaching strokes.
  test('refuses a bare "canvases" ancestor rather than reading it whole', async () => {
    const deps = makeStoreDeps({ 'canvases/aaa_bbb': { bg: '#fff', strokes: { s1: { big: 'x'.repeat(5000) } } } });
    const pre = await capturePreImage(deps, ['canvases']);
    expect(deps.getVal).not.toHaveBeenCalledWith('canvases');
    expect(typeof pre.canvases).toBe('string');
    expect(pre.canvases).not.toEqual(expect.objectContaining({ aaa_bbb: expect.anything() }));
  });

  test('refuses an empty path rather than reading the database root', async () => {
    const deps = makeStoreDeps({ 'canvases/aaa_bbb': { strokes: { s1: {} } } });
    const pre = await capturePreImage(deps, ['']);
    expect(deps.getVal).not.toHaveBeenCalledWith('');
    expect(typeof pre['']).toBe('string');
  });

  test('refuses "/" rather than reading the database root', async () => {
    const deps = makeStoreDeps({ 'canvases/aaa_bbb': { strokes: { s1: {} } } });
    const pre = await capturePreImage(deps, ['/']);
    expect(deps.getVal).not.toHaveBeenCalledWith('/');
    expect(typeof pre['/']).toBe('string');
  });

  test('a trailing slash on a canvas root is still metadata-only, never a whole-node read', async () => {
    const deps = makeStoreDeps({
      'canvases/aaa_bbb': { bg: '#fff', strokes: { s1: { big: 'x'.repeat(5000) } } },
    });
    const pre = await capturePreImage(deps, ['canvases/aaa_bbb/']);
    expect(pre['canvases/aaa_bbb/']).toMatchObject({ bg: '#fff' });
    expect(pre['canvases/aaa_bbb/'].strokes).not.toEqual({ s1: { big: 'x'.repeat(5000) } });
    for (const [path] of deps.getVal.mock.calls) {
      expect(path).not.toBe('canvases/aaa_bbb');
      expect(path).not.toBe('canvases/aaa_bbb/');
      expect(path).not.toMatch(/\/strokes(\/|$)/);
    }
  });
});

describe('writeAuditRecord', () => {
  test('writes the pre-image file and appends one JSONL line', () => {
    const { fs: fakeFs, files } = makeFakeFs();

    const path = writeAuditRecord(fakeFs, '/audit', {
      ts: 1000, op: 'merge', project: 'demo', uids: ['L', 'S'], preImage: { 'users/L': { a: 1 } }, outcome: 'ok',
    });

    expect(path).toBe('/audit/1000-merge-L.json');
    expect(JSON.parse(files[path]).preImage).toEqual({ 'users/L': { a: 1 } });
    const line = JSON.parse(files['/audit/audit.jsonl'].trim());
    expect(line).toEqual({ ts: 1000, op: 'merge', project: 'demo', uids: ['L', 'S'], paths: 1, outcome: 'ok', preImageFile: path });
  });

  test('the JSONL line carries no payload values, only the path count', () => {
    const { fs: fakeFs, files } = makeFakeFs();
    writeAuditRecord(fakeFs, '/audit', { ts: 1, op: 'purge', project: 'demo', uids: ['D'], preImage: { 'users/D': { secret: 'x' } }, outcome: 'ok' });
    expect(files['/audit/audit.jsonl']).not.toContain('secret');
  });

  // Round-1 review (I2): a write syscall returning is not durability. Both
  // the pre-image file and the JSONL log must be fsynced, and — because a
  // brand-new filename is not durable until its directory entry is flushed
  // too — the containing directory is fsynced as well.
  test('fsyncs the pre-image file, the JSONL log, and the containing directory', () => {
    const { fs: fakeFs, fsyncedPaths } = makeFakeFs();
    const path = writeAuditRecord(fakeFs, '/audit', {
      ts: 2000, op: 'merge', project: 'demo', uids: ['L'], preImage: { a: 1 }, outcome: 'ok',
    });
    expect(fsyncedPaths).toContain(path);
    expect(fsyncedPaths).toContain('/audit/audit.jsonl');
    expect(fsyncedPaths).toContain('/audit');
  });

  // Round-1 review (M4): a same ts/op/uid must never clobber a prior record.
  test('refuses to clobber a same ts/op/uid collision — suffixes instead', () => {
    const { fs: fakeFs, files } = makeFakeFs();
    const first = writeAuditRecord(fakeFs, '/audit', {
      ts: 3000, op: 'merge', project: 'demo', uids: ['L'], preImage: { a: 1 }, outcome: 'ok',
    });
    const second = writeAuditRecord(fakeFs, '/audit', {
      ts: 3000, op: 'merge', project: 'demo', uids: ['L'], preImage: { a: 2 }, outcome: 'ok',
    });
    expect(first).toBe('/audit/3000-merge-L.json');
    expect(second).not.toBe(first);
    // The first record is untouched by the second write.
    expect(JSON.parse(files[first]).preImage).toEqual({ a: 1 });
    expect(JSON.parse(files[second]).preImage).toEqual({ a: 2 });
  });

  // Round-1 review (M4): an empty uids array must not crash or produce an
  // `undefined` filename segment.
  test('handles an empty uids array without crashing or writing "undefined"', () => {
    const { fs: fakeFs, files } = makeFakeFs();
    const path = writeAuditRecord(fakeFs, '/audit', {
      ts: 4000, op: 'sweep', project: 'demo', uids: [], preImage: { a: 1 }, outcome: 'ok',
    });
    expect(path).not.toContain('undefined');
    expect(files[path]).toBeDefined();
  });
});

// Round-1 review (I3, anti-drift): the canvas metadata fields capturePreImage
// reads must be the SAME list merge.js carries, not a hand-copied duplicate
// that can silently drift on the one artifact that is the only path back
// from an irreversible write. This seeds every field merge.js's own
// CANVAS_CARRIED names (imported, not retyped) and asserts capturePreImage
// picks up every one of them and nothing else besides the strokes marker —
// so a future field added to merge.js's list without updating this file
// would fail here precisely because the value would go uncaptured.
describe('canvas metadata parity with merge.js', () => {
  test('captures exactly the fields merge.js carries for a canvas, nothing more', async () => {
    /** @type {Record<string, unknown>} */
    const canvasNode = { strokes: { s1: { points: [1] } } };
    for (const field of CANVAS_CARRIED) canvasNode[field] = `value-of-${field}`;
    const deps = makeStoreDeps({ 'canvases/aaa_bbb': canvasNode });

    const pre = await capturePreImage(deps, ['canvases/aaa_bbb']);

    for (const field of CANVAS_CARRIED) {
      expect(pre['canvases/aaa_bbb'][field]).toBe(`value-of-${field}`);
    }
    expect(Object.keys(pre['canvases/aaa_bbb']).sort()).toEqual([...CANVAS_CARRIED, 'strokes'].sort());
  });
});
