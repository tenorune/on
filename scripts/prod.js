#!/usr/bin/env node
// scripts/prod.js — production build with .env.local injection
const esbuild = require('esbuild');
const { define } = require('./build.js');

esbuild.buildSync({
  entryPoints: ['js/app.js'],
  bundle: true,
  outfile: 'dist/bundle.js',
  define,
  minify: false, // keep readable for debugging; enable for production deploy
});

console.log('Build complete: dist/bundle.js');
