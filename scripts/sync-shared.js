#!/usr/bin/env node
// scripts/sync-shared.js — mirror shared/ into functions/_shared/ byte-for-byte.
// shared/ is the single source of truth; firebase deploy archives only the
// functions/ directory, so functions consume this COMMITTED mirror. Run after
// every edit to shared/ and commit both sides — tests/sharedMirror.test.js and
// functions/test/shared-mirror.test.js fail loudly on a stale or hand-edited
// mirror. The script is deliberately dumb (flat copy, .js only, full replace);
// the byte-equality guards are what make it safe.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'shared');
const dest = path.join(root, 'functions', '_shared');

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
let n = 0;
for (const name of fs.readdirSync(src)) {
  if (!name.endsWith('.js')) continue;
  fs.copyFileSync(path.join(src, name), path.join(dest, name));
  n++;
}
console.log(`sync-shared: mirrored ${n} file(s) into functions/_shared/`);
