// functions/test/ops-merge-fixture-rules.test.js — the merge fixture's own
// write-set, checked against the rules it seeds under (M14).
//
// WHY THIS EXISTS. `ops/seed-merge-fixture.js` writes through the Admin SDK,
// which bypasses `database.rules.json` entirely. So a fixture can seed a
// database state NO CLIENT COULD PRODUCE and nothing anywhere goes red: the
// seed succeeds, the merge leg is unaffected, and the divergence is invisible
// until someone tries to drive a rules-validated write against those accounts
// and gets a failure that has nothing to do with the merge under test.
//
// That already happened once. `fixtureCodes` built `SMK${tag}${role}` with a
// tag regex of `^[a-z0-9]{1,16}$`, so every seeded `presence/code` carried
// lowercase — while SEC-1 (`1ae38a8`) has required `^[A-Z0-9]{1,32}$` since
// 2026-08-04. Invalid by CONSTRUCTION, not by luck: no tag produced a valid
// code. The fixture was written 2026-08-03, the rule shipped a day later, and
// nothing connected them.
//
// It is the security audit's own lesson running the other way: a prescription
// written before its dependency describes the world without that dependency,
// and so does a FIXTURE written before a rule. The one-line fix stops the
// lowercase; this file is the half that catches the NEXT rule, by deriving the
// constraint FROM the shipped rules file rather than restating it here.
//
// SCOPE, stated honestly. This is not a rules interpreter. It reads the
// charset family — `.validate` clauses carrying a regex literal — and applies
// them to the fixture's leaves. Length, type and `hasChildren` validations are
// NOT checked, and neither is any `.write` predicate. A guard that silently
// checked nothing would be worse than none, so the parse is pinned by a
// control: the two regex rules the file is known to carry must both be found.
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMergeFixture, fixtureCodes } from '../ops/merge-fixture.js';

const RULES = JSON.parse(nodeFs.readFileSync(
  nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)), '..', '..', 'database.rules.json'),
  'utf8',
)).rules;

const TAG = 't1';
const NOW = 1_800_000_000_000;

/**
 * Every `.validate` in the rules that constrains a leaf to a regex, as
 * {segments, regex}. `$name` segments are wildcards. A `.validate` that is not
 * a recognisable `matches(/re/)` is skipped rather than guessed at — the
 * control below is what stops that skipping from becoming a silent pass.
 * @param {any} node @param {string[]} at
 * @returns {{ segments: string[], source: string, regex: RegExp }[]}
 */
function regexValidations(node, at = []) {
  if (!node || typeof node !== 'object') return [];
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === '.validate') {
      const m = String(value).match(/\.matches\(\/(.+?)\/\)/);
      if (m) out.push({ segments: at, source: String(value), regex: new RegExp(m[1]) });
    } else if (!key.startsWith('.')) {
      out.push(...regexValidations(value, [...at, key]));
    }
  }
  return out;
}

/** Flatten the fixture's nested write-set into leaf path → value. */
function leaves(writes) {
  /** @type {[string, unknown][]} */
  const out = [];
  /** @param {string} path @param {unknown} value */
  const walk = (path, value) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) walk(`${path}/${k}`, v);
      return;
    }
    out.push([path, value]);
  };
  for (const [base, value] of Object.entries(writes)) walk(base, value);
  return out;
}

/** @param {string[]} rule @param {string[]} actual */
function pathMatches(rule, actual) {
  if (rule.length !== actual.length) return false;
  return rule.every((seg, i) => seg.startsWith('$') || seg === actual[i]);
}

describe('the merge fixture seeds a state a client could actually have written', () => {
  // The control. If the parser stops finding the rules — a reformat, a rename,
  // a `.validate` rewritten into some other shape — every claim below passes
  // vacuously, and a fixture drifting out of the charset would go unreported
  // exactly as it did before this file existed.
  test('the parse finds the charset rules the shipped file carries', () => {
    const found = regexValidations(RULES).map((v) => v.segments.join('/'));
    expect(found).toContain('users/$uid/presence/code');
    expect(found).toContain('knocks/$recipient/$sender/contextGroupId');
  });

  test('every seeded leaf satisfies every charset rule that names its path', () => {
    const validations = regexValidations(RULES);
    const offences = [];
    for (const variant of [{}, { telegram: true }]) {
      for (const [path, value] of leaves(buildMergeFixture({ tag: TAG, now: NOW, ...variant }).writes)) {
        const segments = path.split('/').filter(Boolean);
        for (const v of validations) {
          if (!pathMatches(v.segments, segments)) continue;
          if (typeof value !== 'string' || !v.regex.test(value)) {
            offences.push(`${path} = ${JSON.stringify(value)} violates ${v.segments.join('/')} ${v.regex}`);
          }
        }
      }
    }
    expect(offences).toEqual([]);
  });

  // codeIndex is keyed BY the code, so a code the charset forbids also puts a
  // forbidden key in the index — and the two must stay the same string, or the
  // fixture's own `--clean` derivation strands whichever one it did not build.
  test('the codes in the index are the codes on the accounts', () => {
    const codes = Object.values(fixtureCodes(TAG));
    const indexed = Object.keys(buildMergeFixture({ tag: TAG, now: NOW }).writes)
      .filter((p) => p.startsWith('codeIndex/'))
      .map((p) => p.slice('codeIndex/'.length));
    expect(indexed.sort()).toEqual([...codes].sort());
  });

  // By construction, not by luck: the tag regex the CLIs enforce is
  // lowercase-only, so if the derivation did not force case, no tag anywhere
  // would produce a valid code.
  test('no legal tag can produce a code the charset forbids', () => {
    const charset = regexValidations(RULES).find((v) => v.segments.join('/') === 'users/$uid/presence/code');
    for (const tag of ['run1', 'abc', 'z', '0', 'x'.repeat(16), 'a1b2c3']) {
      expect(/^[a-z0-9]{1,16}$/.test(tag)).toBe(true);
      for (const code of Object.values(fixtureCodes(tag))) {
        expect(charset.regex.test(code)).toBe(true);
      }
    }
  });
});
