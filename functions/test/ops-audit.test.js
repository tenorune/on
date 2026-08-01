import { makeStoreDeps } from './store-deps.js';
import { capturePreImage, writeAuditRecord } from '../ops/audit.js';

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
});

describe('writeAuditRecord', () => {
  test('writes the pre-image file and appends one JSONL line', () => {
    /** @type {Record<string, string>} */
    const files = {};
    const fakeFs = {
      mkdirSync: () => {},
      writeFileSync: (path, body) => { files[path] = body; },
      appendFileSync: (path, body) => { files[path] = (files[path] || '') + body; },
    };

    const path = writeAuditRecord(fakeFs, '/audit', {
      ts: 1000, op: 'merge', project: 'demo', uids: ['L', 'S'], preImage: { 'users/L': { a: 1 } }, outcome: 'ok',
    });

    expect(path).toBe('/audit/1000-merge-L.json');
    expect(JSON.parse(files[path]).preImage).toEqual({ 'users/L': { a: 1 } });
    const line = JSON.parse(files['/audit/audit.jsonl'].trim());
    expect(line).toEqual({ ts: 1000, op: 'merge', project: 'demo', uids: ['L', 'S'], paths: 1, outcome: 'ok', preImageFile: path });
  });

  test('the JSONL line carries no payload values, only the path count', () => {
    const files = {};
    const fakeFs = {
      mkdirSync: () => {},
      writeFileSync: (p, b) => { files[p] = b; },
      appendFileSync: (p, b) => { files[p] = (files[p] || '') + b; },
    };
    writeAuditRecord(fakeFs, '/audit', { ts: 1, op: 'purge', project: 'demo', uids: ['D'], preImage: { 'users/D': { secret: 'x' } }, outcome: 'ok' });
    expect(files['/audit/audit.jsonl']).not.toContain('secret');
  });
});
