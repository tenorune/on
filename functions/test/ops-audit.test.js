import { makeStoreDeps } from './store-deps.js';
import { capturePreImage, writeAuditRecord } from '../ops/audit.js';
import { CANVAS_CARRIED } from '../ops/merge.js';

// A typed stand-in for node:fs's ErrnoException — just enough to carry a
// `.code`, honestly typed rather than cast through `any` (round-2 review).
// `types: []` means the ambient `NodeJS.ErrnoException` global isn't
// available here, so this is a small local class instead.
class FakeFsError extends Error {
  /** @param {string} message @param {string} code */
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

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
        throw new FakeFsError(`EEXIST: file already exists, open '${path}'`, 'EEXIST');
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

  // M4 (this file's stable ID, `ops/audit.js:167`): the rethrow of anything
  // that is NOT EEXIST. The branch was already correct and had no test — a
  // retry loop that swallowed, say, EACCES would spin forever on a directory
  // it cannot write, appending suffixes to a name that will never succeed.
  test('a write failure that is not a collision propagates unchanged, with no retry', () => {
    const { fs: fakeFs } = makeFakeFs();
    const denied = new FakeFsError("EACCES: permission denied, open '/audit/5000-purge-L.json'", 'EACCES');
    let attempts = 0;
    fakeFs.writeFileSync = () => { attempts += 1; throw denied; };

    // The SAME error object, not a wrapped or re-typed one: the operator has
    // to see the real errno, and nothing here can diagnose it better.
    expect(() => writeAuditRecord(fakeFs, '/audit', {
      ts: 5000, op: 'purge', project: 'demo', uids: ['L'], preImage: { a: 1 }, outcome: 'ok',
    })).toThrow(denied);
    expect(attempts).toBe(1);
  });

  // An error with no `code` at all takes the same path — isEexist answers
  // false for anything that is not an object carrying code === 'EEXIST', and
  // "unrecognised" must mean rethrow rather than retry.
  test('an error carrying no errno code is rethrown too, never retried', () => {
    const { fs: fakeFs } = makeFakeFs();
    const odd = new Error('disk on fire');
    let attempts = 0;
    fakeFs.writeFileSync = () => { attempts += 1; throw odd; };

    expect(() => writeAuditRecord(fakeFs, '/audit', {
      ts: 5100, op: 'purge', project: 'demo', uids: ['L'], preImage: { a: 1 }, outcome: 'ok',
    })).toThrow(odd);
    expect(attempts).toBe(1);
  });

  // M5 (`ops/audit.js:181-189`): the collision retry was `for (;;)`. It
  // terminates as soon as one name is free, so this is insurance rather than a
  // fix — but an fs that answers EEXIST to every candidate (a full directory, a
  // frozen clock, another writer) spun forever inside a panel holding a
  // database-admin credential, with no destructive write yet issued and no
  // message.
  test('the collision retry gives up at a cap, fails closed and names the cause', () => {
    const { fs: fakeFs } = makeFakeFs();
    let attempts = 0;
    fakeFs.writeFileSync = (path) => {
      attempts += 1;
      throw new FakeFsError(`EEXIST: file already exists, open '${path}'`, 'EEXIST');
    };

    /** @type {unknown} */
    let caught = null;
    try {
      writeAuditRecord(fakeFs, '/audit', {
        ts: 6000, op: 'purge', project: 'demo', uids: ['L'], preImage: { a: 1 }, outcome: 'ok',
      });
    } catch (err) { caught = err; }

    expect(String(caught)).toMatch(/could not reserve an audit filename/);
    // Bounded — and the message names the bound it actually applied and the
    // name it was reserving, so the operator can look at the directory.
    expect(attempts).toBeGreaterThan(1);
    expect(attempts).toBeLessThan(1000);
    expect(String(caught)).toContain(String(attempts));
    expect(String(caught)).toContain('/audit/6000-purge-L.json');
  });

  // Below the cap it must still behave exactly as before: suffix and succeed.
  // A cap that also broke the ordinary two-way collision would be a worse bug
  // than the unbounded loop it replaces.
  test('a run of real collisions below the cap still finds a free name', () => {
    const { fs: fakeFs, files } = makeFakeFs();
    const paths = [];
    for (let i = 0; i < 5; i += 1) {
      paths.push(writeAuditRecord(fakeFs, '/audit', {
        ts: 7000, op: 'purge', project: 'demo', uids: ['L'], preImage: { n: i }, outcome: 'ok',
      }));
    }
    expect(new Set(paths).size).toBe(5);
    paths.forEach((p, i) => expect(JSON.parse(files[p]).preImage).toEqual({ n: i }));
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

// R3: the fsyncDir catch branch was the one behaviour added in the final fix
// wave with no test. It is the difference between a bare EISDIR out of an audit
// write and a message that says which platform requirement was violated.
describe('fsyncDir failure is diagnosable', () => {
  test('a directory openSync failure names the platform requirement and keeps the cause', () => {
    const { fs: fakeFs } = makeFakeFs();
    const eisdir = new FakeFsError("EISDIR: illegal operation on a directory, open '/audit'", 'EISDIR');
    const realOpen = fakeFs.openSync;
    // Only the DIRECTORY open fails — the pre-image and JSONL opens must still
    // work, or the test would pass for the wrong reason.
    fakeFs.openSync = (path) => {
      if (path === '/audit') throw eisdir;
      return realOpen(path);
    };

    expect(() => writeAuditRecord(fakeFs, '/audit', {
      ts: 4000, op: 'purge', project: 'demo', uids: ['u1'], preImage: { a: 1 }, outcome: 'ok',
    })).toThrow(/requires Linux or macOS/);
  });

  test('the raised error carries the original fs error as its cause', () => {
    const { fs: fakeFs } = makeFakeFs();
    const eisdir = new FakeFsError("EISDIR: illegal operation on a directory, open '/audit'", 'EISDIR');
    const realOpen = fakeFs.openSync;
    fakeFs.openSync = (path) => {
      if (path === '/audit') throw eisdir;
      return realOpen(path);
    };

    let caught;
    try {
      writeAuditRecord(fakeFs, '/audit', {
        ts: 4001, op: 'purge', project: 'demo', uids: ['u1'], preImage: { a: 1 }, outcome: 'ok',
      });
    } catch (err) { caught = err; }

    expect(caught.cause).toBe(eisdir);
  });
});
