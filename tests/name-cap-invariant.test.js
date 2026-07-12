/** @jest-environment node */
// Guard for the display-name cap (W2 C10). The 40-char cap is spelled in three
// places across two runtimes plus the RTDB rules, and they must stay in step
// (W3-B CL#9): a client that truncates to a longer cap than the rules allow
// would have its cosmetic followerNames write silently rejected
// (js/db/social.js swallows the error). No shared module can span web / functions
// / rules JSON, so this test pins the three literals to one another by reading
// the source directly — change one without the others and it fails here.
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

test('the 40-char name cap agrees across client, functions, and RTDB rules (C10)', () => {
  const clientCap = Number(read('js/telegram.js').match(/TG_NAME_CAP\s*=\s*(\d+)/)?.[1]);
  const functionsCap = Number(read('functions/presence-core.js').match(/LABEL_MAX\s*=\s*(\d+)/)?.[1]);
  const rulesCap = findFollowerNamesCap(JSON.parse(read('database.rules.json')));

  // Each source actually yielded a number (the pattern didn't silently miss).
  expect(Number.isFinite(clientCap)).toBe(true);
  expect(Number.isFinite(functionsCap)).toBe(true);
  expect(Number.isFinite(rulesCap)).toBe(true);

  // The load-bearing invariant: all three are the same cap.
  expect(functionsCap).toBe(clientCap);
  expect(rulesCap).toBe(clientCap);
});
