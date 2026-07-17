#!/usr/bin/env node
// scripts/dev-build.js — build with .env.local (dev project) config
const esbuild = require('esbuild');
const { define, envFile, writeIndexHtml, writeServiceWorker, writeAboutHtml, buildCss } = require('./build.js');

// Stale chunks (from a prior split) must not linger — writeServiceWorker
// enumerates whatever's in dist/chunks/ to build the SW precache list.
const { rmSync } = require('fs');
rmSync('dist/chunks', { recursive: true, force: true });

esbuild.buildSync({
  entryPoints: ['js/app.ts'],
  bundle: true,
  outdir: 'dist',
  entryNames: 'bundle',
  chunkNames: 'chunks/[name]-[hash]',
  format: 'esm',
  splitting: true,
  define,
});
buildCss(false);

const title = writeIndexHtml('On - Dev');
writeAboutHtml('On - Dev');
const cache = writeServiceWorker();
console.log(`Build complete: dist/bundle.js + index.html (title: "${title}") + sw.js (${cache}), using ${envFile}`);
