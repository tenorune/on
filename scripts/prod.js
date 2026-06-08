#!/usr/bin/env node
// scripts/prod.js — production build with .env.production config
process.env.ENV = 'production';
const esbuild = require('esbuild');
const { define, envFile, writeIndexHtml, writeServiceWorker } = require('./build.js');

esbuild.buildSync({
  entryPoints: ['js/app.js'],
  bundle: true,
  outfile: 'dist/bundle.js',
  define,
});

const title = writeIndexHtml('KnockKnock');
const cache = writeServiceWorker();
console.log(`Build complete: dist/bundle.js + index.html (title: "${title}") + sw.js (${cache}), using ${envFile}`);
