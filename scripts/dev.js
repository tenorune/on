#!/usr/bin/env node
// scripts/dev.js — esbuild dev server with .env.local injection and LAN access
const esbuild = require('esbuild');
const { define, writeIndexHtml, writeAboutHtml, buildCss } = require('./build.js');
const { networkInterfaces } = require('os');

const PORT = 8080;

function getLanAddress() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of /** @type {import('os').NetworkInterfaceInfo[]} */ (nets[name])) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

async function main() {
  writeIndexHtml('On - Dev');
  writeAboutHtml('On - Dev');

  // Stale chunks (from a prior split) must not linger — writeServiceWorker
  // enumerates whatever's in dist/chunks/ to build the SW precache list.
  const { rmSync } = require('fs');
  rmSync('dist/chunks', { recursive: true, force: true });

  const ctx = await esbuild.context({
    entryPoints: ['js/app.ts'],
    bundle: true,
    outdir: 'dist',
    entryNames: 'bundle',
    chunkNames: 'chunks/[name]-[hash]',
    format: 'esm',
    splitting: true,
    define,
  });

  await ctx.watch();

  // Synchronous first CSS build so a fresh checkout's first page load can't
  // 404 dist/css/* while the watch context's initial async build is in flight.
  buildCss(false);
  const cssCtx = await esbuild.context({
    entryPoints: ['css/app.css', 'css/canvas.css', 'css/about.css'],
    outdir: 'dist/css',
  });
  await cssCtx.watch();

  const { port } = await ctx.serve({
    servedir: '.',
    host: '0.0.0.0',
    port: PORT,
  });

  const lan = getLanAddress();
  console.log(`\n  Local:   http://localhost:${port}`);
  console.log(`  Network: http://${lan}:${port}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
