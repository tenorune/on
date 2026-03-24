#!/usr/bin/env node
// scripts/dev-build.js — build with .env.local (dev project) config
const esbuild = require('esbuild');
const { define, envFile } = require('./build.js');

esbuild.buildSync({
  entryPoints: ['js/app.js'],
  bundle: true,
  outfile: 'dist/bundle.js',
  define,
});

console.log(`Build complete: dist/bundle.js (using ${envFile})`);
