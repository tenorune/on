#!/usr/bin/env node
// scripts/dev-build.js — build with .env.local (dev project) config
const esbuild = require('esbuild');
const { define, envFile, writeIndexHtml, writeServiceWorker, writeAboutHtml, buildCss } = require('./build.js');

esbuild.buildSync({
  entryPoints: ['js/app.ts'],
  bundle: true,
  outfile: 'dist/bundle.js',
  define,
});
buildCss(false);

const title = writeIndexHtml('On - Dev');
writeAboutHtml('On - Dev');
const cache = writeServiceWorker();
console.log(`Build complete: dist/bundle.js + index.html (title: "${title}") + sw.js (${cache}), using ${envFile}`);
