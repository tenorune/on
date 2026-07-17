#!/usr/bin/env node
// scripts/prod.js — production build with .env.production config
process.env.ENV = 'production';
const esbuild = require('esbuild');
const { define, envFile, writeIndexHtml, writeServiceWorker, writeAboutHtml, buildCss } = require('./build.js');

// Stale chunks (from a prior split) must not linger — writeServiceWorker
// enumerates whatever's in dist/chunks/ to build the SW precache list, so a
// leftover chunk from an earlier build would get hashed/cached forever.
const { rmSync } = require('fs');
rmSync('dist/chunks', { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: ['js/app.ts'],
  bundle: true,
  outdir: 'dist',
  entryNames: 'bundle',
  chunkNames: 'chunks/[name]-[hash]',
  // ESM + splitting lets the 78KB wordlist (js/wordlist.ts, dynamically
  // imported from js/identity.ts) live in its own chunk, fetched only by the
  // three flows that need it (create account, phrase restore, Telegram
  // graduation) instead of shipping in every boot.
  format: 'esm',
  splitting: true,
  // Production ships minified — dev builds (dev-build.js / dev.js) stay readable
  // for debugging. esbuild renames locals + strips whitespace/comments;
  // string-keyed DOM ids, window.* globals, and the define-substituted Firebase
  // config are all preserved, so behavior is unchanged.
  minify: true,
  // Linked sourcemap (dist/bundle.js.map) so minified prod stack traces map back
  // to original files/lines. The browser only fetches it when devtools are open —
  // zero cost for normal users, and it's not in the SW shell cache. No secrets in
  // it: the client bundle and its Firebase config are public by design (security
  // is enforced by RTDB rules).
  sourcemap: true,
  define,
});
buildCss(true);

const title = writeIndexHtml('KnockKnock');
writeAboutHtml('KnockKnock');
const cache = writeServiceWorker();
console.log(`Build complete: dist/bundle.js + index.html (title: "${title}") + sw.js (${cache}), using ${envFile}`);
