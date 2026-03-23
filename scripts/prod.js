#!/usr/bin/env node
// scripts/prod.js — production build with .env.production config
process.env.ENV = 'production';
const esbuild = require('esbuild');
const { define, envFile } = require('./build.js');

esbuild.buildSync({
  entryPoints: ['js/app.js'],
  bundle: true,
  outfile: 'dist/bundle.js',
  define,
});

console.log(`Build complete: dist/bundle.js (using ${envFile})`);
