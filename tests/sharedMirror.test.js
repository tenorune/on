/** @jest-environment node */
// Guards for the shared/ → functions/_shared/ committed mirror (spec:
// docs/superpowers/2026-07-11-stack-analysis-and-migration-roadmaps.md, Doc 2).
// shared/ is the single source of truth; firebase deploy archives only
// functions/, so functions consume a byte-identical COMMITTED mirror produced
// by `npm run sync-shared`. These tests make a stale or hand-edited mirror a
// red CI test job (which gates the deploy job) instead of a prod surprise.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'shared');
const destDir = path.join(root, 'functions', '_shared');
const jsFiles = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort() : [];

test('functions/_shared/ mirrors shared/ byte-for-byte — if red, run: npm run sync-shared', () => {
  const srcFiles = jsFiles(srcDir);
  expect(srcFiles.length).toBeGreaterThan(0); // sanity: the scaffold exists
  expect(jsFiles(destDir)).toEqual(srcFiles); // same file set — no missing, no orphans
  for (const f of srcFiles) {
    expect(fs.readFileSync(path.join(destDir, f), 'utf8'))
      .toBe(fs.readFileSync(path.join(srcDir, f), 'utf8'));
  }
});

// Purity fence (spec wargame W4/W5): shared modules may import only sibling
// shared modules. Anything else would drag client/server code (or the firebase
// client SDK) through the mirror into Cloud Functions — and same-dir-only
// imports can never form a cycle with js/ or functions/.
test('shared/ modules import nothing outside shared/', () => {
  for (const f of jsFiles(srcDir)) {
    const src = fs.readFileSync(path.join(srcDir, f), 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      expect(m[1]).toMatch(/^\.\/[\w.-]+\.js$/);
    }
  }
});
