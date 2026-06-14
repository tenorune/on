#!/usr/bin/env node
// scripts/prod.js — production build with .env.production config
process.env.ENV = 'production';
const esbuild = require('esbuild');
const { define, envFile, writeIndexHtml, writeServiceWorker } = require('./build.js');

esbuild.buildSync({
  entryPoints: ['js/app.js'],
  bundle: true,
  outfile: 'dist/bundle.js',
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

const title = writeIndexHtml('KnockKnock');
const cache = writeServiceWorker();
console.log(`Build complete: dist/bundle.js + index.html (title: "${title}") + sw.js (${cache}), using ${envFile}`);
