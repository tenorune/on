#!/usr/bin/env node
// scripts/gen-wordlist.js — regenerate js/wordlist.js from the EFF long wordlist.
// Source: the public-domain EFF long wordlist (https://www.eff.org/dice),
// fetched via the eff-diceware-passphrase npm package.
//
// Usage: node scripts/gen-wordlist.js
//
// This runs `npm pack eff-diceware-passphrase` in a temp directory, extracts
// the wordlist.json, filters to entries matching /^[a-z]+$/ (drops 4
// hyphenated entries: drop-down, felt-tip, t-shirt, yo-yo), and overwrites
// js/wordlist.js. After running, inspect the diff and run the tests.

const { execSync } = require('child_process');
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('fs');
const { tmpdir } = require('os');
const path = require('path');

const workDir = mkdtempSync(path.join(tmpdir(), 'wordlist-'));
try {
  execSync('npm pack eff-diceware-passphrase', { cwd: workDir, stdio: 'pipe' });
  execSync('tar xzf eff-diceware-passphrase-*.tgz', { cwd: workDir, stdio: 'pipe' });
  const raw = JSON.parse(readFileSync(path.join(workDir, 'package', 'wordlist.json'), 'utf8'));
  const filtered = raw.filter((w) => /^[a-z]+$/.test(w));
  const dropped = raw.filter((w) => !/^[a-z]+$/.test(w));
  console.log(`Source: ${raw.length} words`);
  console.log(`Filtered: ${filtered.length} words (dropped ${dropped.length}: ${dropped.join(', ')})`);

  const body = filtered.map((w) => `  "${w}",`).join('\n');
  const file = `// @ts-check
// js/wordlist.js — EFF long wordlist (public domain), filtered to ${filtered.length} words
// Source: https://www.eff.org/dice (eff_large_wordlist.txt)
// Filter: kept only entries matching /^[a-z]+$/ (dropped: ${dropped.join(', ')})
// Regenerate with: node scripts/gen-wordlist.js
const WORDLIST = Object.freeze([
${body}
]);

const WORDSET = new Set(WORDLIST);

module.exports = { WORDLIST, WORDSET };
`;
  const outPath = path.resolve(__dirname, '..', 'js', 'wordlist.js');
  writeFileSync(outPath, file);
  console.log(`Wrote: ${outPath}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
