#!/usr/bin/env node
// scripts/dev.js — esbuild dev server with .env.local injection and LAN access
const esbuild = require('esbuild');
const { define, writeIndexHtml, writeAboutHtml } = require('./build.js');
const { networkInterfaces } = require('os');

const PORT = 8080;

function getLanAddress() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

async function main() {
  writeIndexHtml('On - Dev');
  writeAboutHtml('On - Dev');

  const ctx = await esbuild.context({
    entryPoints: ['js/app.ts'],
    bundle: true,
    outfile: 'dist/bundle.js',
    define,
  });

  await ctx.watch();

  const { host, port } = await ctx.serve({
    servedir: '.',
    host: '0.0.0.0',
    port: PORT,
  });

  const lan = getLanAddress();
  console.log(`\n  Local:   http://localhost:${port}`);
  console.log(`  Network: http://${lan}:${port}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
