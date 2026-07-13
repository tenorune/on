// Byte-equality guard for the committed _shared/ mirror — the functions-suite
// twin of tests/sharedMirror.test.js. If red: edit shared/ (never _shared/)
// and run `npm run sync-shared` at the repo root.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const srcDir = path.join(root, 'shared');
const destDir = path.join(root, 'functions', '_shared');
const jsFiles = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.js')).sort() : [];

test('functions/_shared/ mirrors shared/ byte-for-byte — if red, run: npm run sync-shared', () => {
  const srcFiles = jsFiles(srcDir);
  expect(srcFiles.length).toBeGreaterThan(0);
  expect(jsFiles(destDir)).toEqual(srcFiles);
  for (const f of srcFiles) {
    expect(readFileSync(path.join(destDir, f), 'utf8'))
      .toBe(readFileSync(path.join(srcDir, f), 'utf8'));
  }
});
