/** @jest-environment node */
// Guard for the display-name cap (W2 C10): the cap now lives ONCE in
// shared/limits.js, but database.rules.json cannot import JS — this test pins
// the shared constant to the rules literal, and pins both former call sites to
// consuming shared.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function findFollowerNamesCap(rulesJson) {
  let found = null;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'followerNames' && v && typeof v === 'object') {
        const validate = JSON.stringify(v);
        const m = validate.match(/length\s*<=\s*(\d+)/);
        if (m) found = Number(m[1]);
      }
      walk(v);
    }
  };
  walk(rulesJson);
  return found;
}

test('the 40-char name cap: shared/limits.js agrees with RTDB rules, and both former literals consume shared (C10)', () => {
  const sharedCap = Number(read('shared/limits.js').match(/NAME_CAP\s*=\s*(\d+)/)?.[1]);
  const rulesCap = findFollowerNamesCap(JSON.parse(read('database.rules.json')));

  expect(Number.isFinite(sharedCap)).toBe(true);
  expect(Number.isFinite(rulesCap)).toBe(true);
  expect(rulesCap).toBe(sharedCap);

  // The two former literal holders now consume shared/ — a reintroduced local
  // cap literal would bypass this guard, so pin the imports too.
  expect(read('js/telegram.ts')).toContain("from '../shared/limits.js'");
  expect(read('js/telegram.ts')).not.toMatch(/TG_NAME_CAP\s*=\s*\d/);
  expect(read('functions/presence-core.js')).toContain("from './_shared/limits.js'");
  expect(read('functions/presence-core.js')).not.toMatch(/LABEL_MAX\s*=\s*\d/);
});
