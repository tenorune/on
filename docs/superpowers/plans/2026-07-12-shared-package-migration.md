# Shared-Package Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The executing agent is assumed to be an opus-class model; per-task implementers get only their own task — the Interfaces blocks carry the cross-task contracts.

**Goal:** One source of truth (`shared/`) for the code units currently duplicated between `js/` and `functions/`, consumed by the client directly and by Cloud Functions via a committed byte-identical mirror (`functions/_shared/`), with loud guard tests replacing today's cross-reference comments.

**Architecture:** Option A from the spec (`docs/superpowers/2026-07-11-stack-analysis-and-migration-roadmaps.md`, Document 2): `shared/` holds pure, dependency-free ESM modules; `scripts/sync-shared.js` mirrors them byte-for-byte into `functions/_shared/`; the mirror is **committed** so `firebase deploy` (which archives only `functions/`) needs no build hook; byte-equality guard tests in BOTH Jest suites block CI's deploy job on staleness. Existing modules keep their public API via re-exports — zero import churn at call sites.

**Tech Stack:** Plain `.js` ESM (no TypeScript in `shared/` — ever; see spec wargame W7), Node `fs` for the sync script, Jest (jsdom suite at root, node-ESM suite in `functions/`).

## Global Constraints

- **Baseline:** `claude/telegram-app-adaptation-t1r1jp` is merged to `main` and deployed to prod. Cut the work branch from `dev` (integration branch; post-merge it contains all Telegram work). Do not merge to `dev`/`main`; do not open PRs. The old "a `dev` push wipes branch-only Telegram functions" landmine is retired by the merge — but the first functions deploy carrying `_shared/` still needs the post-deploy smoke check in Task 2.
- **Test commands:** web suite = `node_modules/.bin/jest` from repo root (NOT bare `npx jest`); functions suite = `cd functions && npm test`. Both must be fully green before every commit. `npm run build` must complete cleanly where a task says so.
- **Behavior-identical policy:** every task here is a refactor. If a step surfaces a genuine behavioral bug, STOP, report it to the operator, and do not fix it inside the refactor commit.
- **`shared/` purity fence:** files in `shared/` import nothing outside `shared/` (no `js/`, no `functions/`, no node_modules). Enforced by a guard test from Task 1 onward.
- **Never edit `functions/_shared/` by hand.** Edit `shared/`, run `npm run sync-shared`, commit both.
- **Ordering with the TypeScript plan** (`2026-07-12-typescript-adoption.md`): run THIS plan's Tasks 1–2 before that plan converts `js/utils.js`. Otherwise the plans are independent.
- Fresh container setup: `apt-get update && apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev` before `npm ci`; then `cd functions && npm ci`.

---

### Task 1: `shared/` scaffold — sync script, first module, guard tests

**Files:**
- Create: `shared/timeFormat.js`
- Create: `scripts/sync-shared.js`
- Create: `tests/sharedMirror.test.js`
- Create: `functions/test/shared-mirror.test.js`
- Modify: `package.json` (add the `sync-shared` script)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `shared/timeFormat.js` exporting `formatTimeRemaining(ms: number): string` and `formatTimeRemainingFuzzy(ms: number): string` (byte-identical to today's duplicates — Task 2 wires consumers). `npm run sync-shared` → refreshes `functions/_shared/`. Guard tests that later tasks rely on to catch staleness.

- [ ] **Step 1: Write the failing guard tests (web suite)**

Create `tests/sharedMirror.test.js`:

```js
/** @jest-environment node */
// Guards for the shared/ → functions/_shared/ committed mirror (spec:
// docs/superpowers/2026-07-11-stack-analysis-and-migration-roadmaps.md, Doc 2).
// shared/ is the single source of truth; firebase deploy archives only
// functions/, so functions consume a byte-identical COMMITTED mirror produced
// by `npm run sync-shared`. These tests make a stale or hand-edited mirror a
// red CI test job (which gates the deploy job) instead of a prod surprise.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'shared');
const destDir = path.join(root, 'functions', '_shared');
const jsFiles = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort() : [];

test('functions/_shared/ mirrors shared/ byte-for-byte — if red, run: npm run sync-shared', () => {
  const srcFiles = jsFiles(srcDir);
  expect(srcFiles.length).toBeGreaterThan(0); // sanity: the scaffold exists
  expect(jsFiles(destDir)).toEqual(srcFiles); // same file set — no missing, no orphans
  for (const f of srcFiles) {
    expect(fs.readFileSync(path.join(destDir, f), 'utf8'))
      .toBe(fs.readFileSync(path.join(srcDir, f), 'utf8'));
  }
});

// Purity fence (spec wargame W4/W5): shared modules may import only sibling
// shared modules. Anything else would drag client/server code (or the firebase
// client SDK) through the mirror into Cloud Functions — and same-dir-only
// imports can never form a cycle with js/ or functions/.
test('shared/ modules import nothing outside shared/', () => {
  for (const f of jsFiles(srcDir)) {
    const src = fs.readFileSync(path.join(srcDir, f), 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      expect(m[1]).toMatch(/^\.\/[\w.-]+\.js$/);
    }
  }
});
```

- [ ] **Step 2: Write the failing guard test (functions suite)**

Create `functions/test/shared-mirror.test.js` (the functions suite runs bare Node ESM — this second copy exists so `cd functions && npm test` alone also catches a stale mirror, e.g. after a hand-edit of `_shared/`):

```js
// Byte-equality guard for the committed _shared/ mirror — the functions-suite
// twin of tests/sharedMirror.test.js. If red: edit shared/ (never _shared/)
// and run `npm run sync-shared` at the repo root.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const srcDir = path.join(root, 'shared');
const destDir = path.join(root, 'functions', '_shared');
const jsFiles = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.js')).sort() : [];

test('functions/_shared/ mirrors shared/ byte-for-byte — if red, run: npm run sync-shared', () => {
  const srcFiles = jsFiles(srcDir);
  expect(srcFiles.length).toBeGreaterThan(0);
  expect(jsFiles(destDir)).toEqual(srcFiles);
  for (const f of srcFiles) {
    expect(readFileSync(path.join(destDir, f), 'utf8'))
      .toBe(readFileSync(path.join(srcDir, f), 'utf8'));
  }
});
```

(Referencing files outside `functions/` from a functions **test** is established practice here — `functions/test/presence-core.test.js` already imports `../../test-fixtures/time-format-vectors.json`. Tests are never deployed; only `_shared/` source is.)

- [ ] **Step 3: Create the first shared module**

Create `shared/timeFormat.js` — the bodies are copied **byte-for-byte** from `js/utils.js:88-116` (which is currently byte-identical to `functions/presence-core.js:52-80`); only the header comment is new:

```js
// shared/timeFormat.js — the time-remaining formatters, ONE copy for web +
// functions. Consumed by js/ directly (../shared/…) and by functions/ via the
// committed byte-identical mirror functions/_shared/ (npm run sync-shared —
// never edit the mirror by hand). Behavior pinned by
// test-fixtures/time-format-vectors.json in both suites.
//
// Both formatters return a bare duration PHRASE with no trailing " left" —
// the caller owns that suffix (e.g. `formatTimeRemaining(ms) + ' left'` for a
// precise countdown, or `Available for ${formatTimeRemainingFuzzy(ms)}` for
// the fuzzy roster text). Keeping the suffix out of the helpers means no call
// site has to strip it back off.
export function formatTimeRemaining(ms) {
  if (ms <= 0) return '';
  if (ms < 60000) return '< 1m';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

const HOUR_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
function hourWord(n) { return HOUR_WORDS[n] ?? String(n); }

export function formatTimeRemainingFuzzy(ms) {
  if (ms <= 0) return '';
  const minutes = ms / 60000;
  const hours = ms / 3600000;
  if (minutes < 5) return 'just a few minutes';
  if (minutes < 20) return 'about 15 minutes';
  if (minutes < 45) return 'about half an hour';
  if (minutes < 75) return 'about an hour';
  if (minutes < 120) return 'one to two hours';
  const floor = Math.floor(hours);
  const frac = hours - floor;
  if (frac < 0.25) return `just over ${hourWord(floor)} hours`;
  if (frac >= 0.75) return `nearly ${hourWord(floor + 1)} hours`;
  return `about ${hourWord(Math.round(hours))} hours`;
}
```

- [ ] **Step 4: Run both new guard tests to verify they fail**

Run: `node_modules/.bin/jest tests/sharedMirror.test.js`
Expected: FAIL — the mirror test fails (`functions/_shared/` doesn't exist, file-set mismatch `[] != ['timeFormat.js']`); the purity test passes (no external imports).

Run: `cd functions && npm test -- test/shared-mirror.test.js`
Expected: FAIL — same mirror mismatch.

- [ ] **Step 5: Write the sync script**

Create `scripts/sync-shared.js` (CommonJS, matching the other `scripts/*.js`):

```js
#!/usr/bin/env node
// scripts/sync-shared.js — mirror shared/ into functions/_shared/ byte-for-byte.
// shared/ is the single source of truth; firebase deploy archives only the
// functions/ directory, so functions consume this COMMITTED mirror. Run after
// every edit to shared/ and commit both sides — tests/sharedMirror.test.js and
// functions/test/shared-mirror.test.js fail loudly on a stale or hand-edited
// mirror. The script is deliberately dumb (flat copy, .js only, full replace);
// the byte-equality guards are what make it safe.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'shared');
const dest = path.join(root, 'functions', '_shared');

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
let n = 0;
for (const name of fs.readdirSync(src)) {
  if (!name.endsWith('.js')) continue;
  fs.copyFileSync(path.join(src, name), path.join(dest, name));
  n++;
}
console.log(`sync-shared: mirrored ${n} file(s) into functions/_shared/`);
```

Add to `package.json` `"scripts"` (after the `"test:rules"` line):

```json
    "sync-shared": "node scripts/sync-shared.js"
```

- [ ] **Step 6: Run the sync, then verify both guards pass**

Run: `npm run sync-shared`
Expected: `sync-shared: mirrored 1 file(s) into functions/_shared/`

Run: `node_modules/.bin/jest tests/sharedMirror.test.js`
Expected: PASS (both tests).

Run: `cd functions && npm test -- test/shared-mirror.test.js`
Expected: PASS.

- [ ] **Step 7: Run the FULL suites (nothing else may have moved)**

Run: `node_modules/.bin/jest` (repo root) and `cd functions && npm test`
Expected: all green — this task adds files only; no existing test may change status.

- [ ] **Step 8: Commit (mirror included)**

```bash
git add shared/timeFormat.js functions/_shared/timeFormat.js scripts/sync-shared.js tests/sharedMirror.test.js functions/test/shared-mirror.test.js package.json
git commit -m "feat(shared): scaffold shared/ with committed functions/_shared mirror + guards"
```

---

### Task 2: Consume `shared/timeFormat.js` — retire the formatter duplicates

**Files:**
- Modify: `js/utils.js:82-116` (delete the duplicated formatters, re-export)
- Modify: `functions/presence-core.js:46-80` (delete the duplicated formatters, re-export)
- Test: existing `tests/utils.test.js` and `functions/test/presence-core.test.js` (unchanged — they now prove the re-export plumbing)

**Interfaces:**
- Consumes: `shared/timeFormat.js` → `formatTimeRemaining(ms)`, `formatTimeRemainingFuzzy(ms)` (Task 1).
- Produces: `js/utils.js` and `functions/presence-core.js` keep their existing exports `formatTimeRemaining` / `formatTimeRemainingFuzzy` unchanged for all call sites (`js/utils.js availableForText`, `functions/telegram.js`, `functions/notifier.js` via `buildMessage` — none are edited).

- [ ] **Step 1: Confirm the duplicates are still byte-identical before touching them**

Run:
```bash
sed -n '88,116p' js/utils.js > /tmp/a && sed -n '52,80p' functions/presence-core.js > /tmp/b && diff /tmp/a /tmp/b && echo IDENTICAL
```
Expected: `IDENTICAL`. If not, STOP — the duplicates drifted since planning; report to the operator before proceeding.

- [ ] **Step 2: Replace the client copy with a re-export**

In `js/utils.js`, delete lines 82–116 (the `// DUPLICATED in functions/presence-core.js …` comment block, `formatTimeRemaining`, `HOUR_WORDS`, `hourWord`, and `formatTimeRemainingFuzzy`) and replace with the block below.

**PITFALL — do NOT use a bare `export … from` here:** `export { x } from '…'` does not create a local binding, and `availableForText` at `js/utils.js:132` calls `formatTimeRemainingFuzzy` locally — a bare re-export would throw `ReferenceError: formatTimeRemainingFuzzy is not defined` at runtime (and only at runtime; the suites would catch it, but don't write it in the first place). Import-then-export is required:

```js
// Time-remaining formatters live in shared/timeFormat.js — one copy for web +
// functions (mirrored into functions/_shared/; see scripts/sync-shared.js).
// Imported (not just re-exported) because availableForText below uses the
// fuzzy formatter locally; exported so call sites and tests keep importing
// from utils.
import { formatTimeRemaining, formatTimeRemainingFuzzy } from '../shared/timeFormat.js';
export { formatTimeRemaining, formatTimeRemainingFuzzy };
```

(The `import`/`export` pair must sit at top-level of the module — place it where the deleted block was; esbuild hoists imports, and babel-jest accepts mid-file imports in ESM source.)

- [ ] **Step 3: Replace the functions copy with a re-export**

In `functions/presence-core.js`, delete lines 46–80 (the `// DUPLICATED in js/utils.js …` comment block through `formatTimeRemainingFuzzy`) and replace with:

```js
// Time-remaining formatters live in shared/timeFormat.js, consumed here via
// the committed mirror functions/_shared/ (npm run sync-shared — never edit
// the mirror by hand). Re-exported so telegram.js and the tests keep
// importing from presence-core.
export { formatTimeRemaining, formatTimeRemainingFuzzy } from './_shared/timeFormat.js';
```

(Nothing else in `presence-core.js` calls the formatters — `buildMessage` and `statusCircle` don't — so a bare re-export is safe here, unlike the client side.)

- [ ] **Step 4: Run the fixture-pinned tests in both suites**

Run: `node_modules/.bin/jest tests/utils.test.js tests/sharedMirror.test.js`
Expected: PASS — the time-format vectors now exercise `shared/timeFormat.js` through the re-export.

Run: `cd functions && npm test`
Expected: PASS, including `test/presence-core.test.js` vectors through `./_shared/timeFormat.js`.

- [ ] **Step 5: Prove bare-Node ESM resolution of the mirror chain (deploy-shaped runtime)**

Cloud Functions runs plain Node ESM with no bundler — prove the `presence-core.js → ./_shared/timeFormat.js` chain resolves there:

Run:
```bash
cd functions && node --input-type=module -e "import('./presence-core.js').then(m => console.log(m.formatTimeRemainingFuzzy(3600000)))"
```
Expected output: `about an hour`

- [ ] **Step 6: Full suites + build**

Run: `node_modules/.bin/jest` && `cd functions && npm test` && `npm run build`
Expected: all green; build completes (`Build complete: dist/bundle.js + index.html …`). The client bundle now inlines `shared/timeFormat.js` — esbuild resolves the relative path outside `js/` without config.

- [ ] **Step 7: Commit**

```bash
git add js/utils.js functions/presence-core.js
git commit -m "refactor(shared): time formatters consume shared/timeFormat.js via re-export"
```

- [ ] **Step 8: Record the deploy smoke-check for the operator (do NOT deploy yourself)**

Spec wargame W2: the first prod deploy that carries `functions/_shared/` should be smoke-checked — one bot `/status` reply for an available contact must render a fuzzy time (e.g. "about an hour"), proving the CLI archived `_shared/` and Node resolved it in prod. Add this line to the task's completion report to the operator; deploys ride the normal `main` pipeline post-merge.

---

### Task 3: Notify-channel predicate → `shared/notifyDelivery.js`

**Files:**
- Create: `shared/notifyDelivery.js`
- Create: `tests/notifyDelivery.test.js`
- Modify: `js/notifySuppression.js:12-27` (comment + `botDelivered`)
- Modify: `js/notifyChannel.js:31-40,126` (comment + render default)
- Modify: `functions/notifier.js:43` (route gate) + its nearby comment at lines 23-24
- Modify: `test-fixtures/notify-channel-vectors.json:2` (`_comment` only)

**Interfaces:**
- Consumes: the mirror machinery from Task 1 (`npm run sync-shared`, guards).
- Produces: `shared/notifyDelivery.js` exporting `telegramPreferred(notifyChannel: string|null|undefined): boolean` — returns `notifyChannel !== 'push'`. All three readers route through it; their public APIs (`botDelivered(prefs)`, `syncNotifyChannel(userId, prefs)`, `sendToUser(...)`) are unchanged.

**Blast-radius note (spec wargame W3):** this is the notification-delivery spine. Get it wrong and telegram-routed users silently stop receiving. Everything here must stay behavior-identical; the 5-vector fixture and all three readers' existing tests run unchanged. The done-gate includes a post-deploy on-device check (Step 8) — green suites alone do not close this task.

- [ ] **Step 1: Write the failing test for the shared predicate**

Create `tests/notifyDelivery.test.js`:

```js
/** @jest-environment node */
// Pins shared/notifyDelivery.js telegramPreferred to the SAME vector file the
// three readers are pinned to (W2 C10) — the fixture stays the spec; this test
// makes the shared unit answer to it directly.
import { telegramPreferred } from '../shared/notifyDelivery.js';
import fixture from '../test-fixtures/notify-channel-vectors.json';

test.each(fixture.vectors)(
  'telegramPreferred(%p)',
  ({ notifyChannel, telegramDelivered }) => {
    expect(telegramPreferred(notifyChannel)).toBe(telegramDelivered);
  }
);
```

Run: `node_modules/.bin/jest tests/notifyDelivery.test.js`
Expected: FAIL — `Cannot find module '../shared/notifyDelivery.js'`.

- [ ] **Step 2: Create the shared module and sync**

Create `shared/notifyDelivery.js`:

```js
// shared/notifyDelivery.js — THE notify-channel delivery default (W2 C10):
// for a linked/routed account, notifications are Telegram-delivered iff
// notifyChannel !== 'push'. A MISSING or unknown channel reads as telegram;
// only an explicit 'push' opts out. Pinned by
// test-fixtures/notify-channel-vectors.json. Readers: js/notifySuppression.js
// botDelivered, js/notifyChannel.js render default, functions/notifier.js
// sendToUser route gate (via the functions/_shared/ mirror).
//
// NOT covered here (delivery-level extra, W1 J#3): the notifier additionally
// falls back to the bot when the channel IS 'push' but the account has zero
// push tokens.
export function telegramPreferred(notifyChannel) {
  return notifyChannel !== 'push';
}
```

Run: `npm run sync-shared` then `node_modules/.bin/jest tests/notifyDelivery.test.js tests/sharedMirror.test.js`
Expected: PASS.

- [ ] **Step 3: Wire the client readers**

In `js/notifySuppression.js`: add below the existing `import { isTelegramContext } from './telegram.js';`:

```js
import { telegramPreferred } from '../shared/notifyDelivery.js';
```

Change `botDelivered` (line 22-24) to:

```js
export function botDelivered(prefs) {
  return prefs?.telegram != null && telegramPreferred(prefs?.notifyChannel);
}
```

In the big comment above it (lines 12-21), replace the sentence `The server notifier (functions/notifier.js sendToUser) is the third reader of this default — the three must never disagree, pinned by test-fixtures/notify-channel-vectors.json (W2 C10).` with: `The channel default itself lives in shared/notifyDelivery.js telegramPreferred (one copy for all three readers, pinned by test-fixtures/notify-channel-vectors.json — W2 C10).` Keep the FOURTH/FIFTH-reader sentences unchanged (they consume the linked half, which stays here).

In `js/notifyChannel.js`: add to the imports:

```js
import { telegramPreferred } from '../shared/notifyDelivery.js';
```

Change line 126 from:

```js
  setActive(pill, prefs.notifyChannel === 'push' ? 'push' : 'telegram');
```

to:

```js
  setActive(pill, telegramPreferred(prefs.notifyChannel) ? 'telegram' : 'push');
```

In its comment block (lines 31-33), replace `is mirrored by js/notifySuppression.js botDelivered and the server notifier (functions/notifier.js sendToUser) — the three must never disagree.` with `routes through shared/notifyDelivery.js telegramPreferred, the one copy of the channel default for all three readers.`

- [ ] **Step 4: Wire the server reader**

In `functions/notifier.js`: add to the imports (alongside the existing `./presence-core.js` import):

```js
import { telegramPreferred } from './_shared/notifyDelivery.js';
```

Change line 43 from:

```js
    if (channel !== 'push' && tgRoute && tgRoute.chatId) {
```

to:

```js
    if (telegramPreferred(channel) && tgRoute && tgRoute.chatId) {
```

Update the comment at lines 23-24 (`channel !== 'push' (not === 'telegram'): a MISSING channel on a routed account reads as telegram, matching the client predicates in …`) to end with `— the default lives in _shared/notifyDelivery.js telegramPreferred (source: shared/), one copy for all three readers.`

- [ ] **Step 5: Update the fixture's `_comment`**

In `test-fixtures/notify-channel-vectors.json`, inside the `_comment` string, replace the fragment `The three readers must never disagree: js/notifySuppression.js botDelivered, js/notifyChannel.js render default (notifyChannel === 'push' ? push : telegram), functions/notifier.js sendToUser route gate.` with `The default is implemented once in shared/notifyDelivery.js telegramPreferred and consumed by js/notifySuppression.js botDelivered, js/notifyChannel.js render default, and functions/notifier.js sendToUser route gate.` (JSON string — keep it one line, keep surrounding text.)

- [ ] **Step 6: Full suites + build**

Run: `node_modules/.bin/jest` && `cd functions && npm test` && `npm run build`
Expected: all green — `tests/notifySuppression.test.js`, `tests/notifyChannel.test.js`, and `functions/test/notifier.test.js` all pass UNCHANGED (they pin behavior, which has not moved).

- [ ] **Step 7: Commit**

```bash
git add shared/notifyDelivery.js functions/_shared/notifyDelivery.js tests/notifyDelivery.test.js js/notifySuppression.js js/notifyChannel.js functions/notifier.js test-fixtures/notify-channel-vectors.json
git commit -m "refactor(shared): one telegramPreferred predicate for the three notify-channel readers"
```

- [ ] **Step 8: Record the on-device done-gate for the operator**

Report: after this reaches prod, the operator should observe (a) one knock to a telegram-routed account arriving as a bot message, and (b) one knock to a push-channel account arriving as web push. Task 3 is not "done" until that walkthrough passes — green suites are necessary, not sufficient.

---

### Task 4: Name cap → `shared/limits.js`

**Files:**
- Create: `shared/limits.js`
- Modify: `functions/presence-core.js:97-107` (cap block consumes shared)
- Modify: `js/telegram.js:30-32` (`TG_NAME_CAP` → shared `NAME_CAP`)
- Modify: `tests/name-cap-invariant.test.js` (reads shared instead of the two retired literals)

**Interfaces:**
- Consumes: mirror machinery (Task 1).
- Produces: `shared/limits.js` exporting `NAME_CAP` (the number `40`), `clampLabel(s): string` (`String(s ?? '').slice(0, NAME_CAP)`), `clampName(s): string` (`clampLabel(s).trim()`). `functions/presence-core.js` keeps exporting `clampName` (via re-export) — `functions/telegram.js` imports it from there and is not touched.

**Behavior-preservation note:** `js/telegram.js` trims **then** slices; `clampName` slices **then** trims. For strings near the cap with leading/trailing whitespace these differ — so the client does NOT switch to `clampName`; it keeps its own composition and consumes only the shared `NAME_CAP` constant. The constant is the actual three-way invariant (client/functions/rules); the composition order is per-surface behavior and stays put.

- [ ] **Step 1: Rewrite the invariant test to expect the shared constant (red first)**

Replace the body of `tests/name-cap-invariant.test.js` `test(...)` (keep the file header comment, `read`, and `findFollowerNamesCap` as they are, but update the header's first sentence to: `Guard for the display-name cap (W2 C10): the cap now lives ONCE in shared/limits.js, but database.rules.json cannot import JS — this test pins the shared constant to the rules literal, and pins both former call sites to consuming shared.`):

```js
test('the 40-char name cap: shared/limits.js agrees with RTDB rules, and both former literals consume shared (C10)', () => {
  const sharedCap = Number(read('shared/limits.js').match(/NAME_CAP\s*=\s*(\d+)/)?.[1]);
  const rulesCap = findFollowerNamesCap(JSON.parse(read('database.rules.json')));

  expect(Number.isFinite(sharedCap)).toBe(true);
  expect(Number.isFinite(rulesCap)).toBe(true);
  expect(rulesCap).toBe(sharedCap);

  // The two former literal holders now consume shared/ — a reintroduced local
  // cap literal would bypass this guard, so pin the imports too.
  expect(read('js/telegram.js')).toContain("from '../shared/limits.js'");
  expect(read('js/telegram.js')).not.toMatch(/TG_NAME_CAP\s*=\s*\d/);
  expect(read('functions/presence-core.js')).toContain("from './_shared/limits.js'");
  expect(read('functions/presence-core.js')).not.toMatch(/LABEL_MAX\s*=\s*\d/);
});
```

Run: `node_modules/.bin/jest tests/name-cap-invariant.test.js`
Expected: FAIL — `shared/limits.js` doesn't exist.

- [ ] **Step 2: Create `shared/limits.js` and sync**

```js
// shared/limits.js — the 40-char display-name / label cap, ONE copy for web +
// functions. database.rules.json spells the same cap and cannot import JS —
// tests/name-cap-invariant.test.js pins the two to each other. Cap rationale
// (#164 R3b): comfortably exceeds what a notification shows; a longer client
// cap than the rules would make cosmetic followerNames writes silently fail.
export const NAME_CAP = 40;

// Cap for labels used in transient output (FCM titles): hard slice.
export const clampLabel = (s) => String(s ?? '').slice(0, NAME_CAP);

// Trimming variant for labels that get STORED (group display names, redeemer
// names): slice then trim, so a cut mid-whitespace doesn't keep a dangling
// space. NOTE js/telegram.js telegramFirstName deliberately does NOT use this
// (it trims before slicing — per-surface behavior, same cap).
export const clampName = (s) => clampLabel(s).trim();
```

Run: `npm run sync-shared`

- [ ] **Step 3: Consume in functions**

In `functions/presence-core.js`, delete lines 97-107 (the `// Cap user-controlled labels…` comment, `const LABEL_MAX = 40;`, `const clampLabel = …`, the `// Trimming variant…` comment, and `export const clampName = …`) and replace with:

```js
// Label caps live in shared/limits.js (one copy; rules parity pinned by
// tests/name-cap-invariant.test.js). clampName re-exported for telegram.js.
import { clampLabel } from './_shared/limits.js';
export { clampName } from './_shared/limits.js';
```

(`buildMessage` below uses `clampLabel` — the import keeps it in scope; `clampName` had no internal callers.)

- [ ] **Step 4: Consume in the client**

In `js/telegram.js`, replace lines 30-32:

```js
// Mirrors the 40-char creatorLabel cap in database.rules.json / functions
// validation — keep the three in step (W3-B CL#9).
const TG_NAME_CAP = 40;
```

with:

```js
// The 40-char creatorLabel cap lives in shared/limits.js (rules parity pinned
// by tests/name-cap-invariant.test.js). Trim-then-slice order is deliberate
// here — see the clampName note in shared/limits.js.
import { NAME_CAP } from '../shared/limits.js';
```

and in `telegramFirstName` change `.slice(0, TG_NAME_CAP)` to `.slice(0, NAME_CAP)`. (Move the import to the top of the file with the other imports — `js/telegram.js` has a top import block.)

- [ ] **Step 5: Verify green + full suites + build**

Run: `node_modules/.bin/jest tests/name-cap-invariant.test.js` → PASS.
Run: `node_modules/.bin/jest` && `cd functions && npm test` && `npm run build` → all green.

- [ ] **Step 6: Commit**

```bash
git add shared/limits.js functions/_shared/limits.js functions/presence-core.js js/telegram.js tests/name-cap-invariant.test.js
git commit -m "refactor(shared): one NAME_CAP/clamp source in shared/limits.js"
```

---

### Task 5: Id formats → `shared/idFormats.js`

**Files:**
- Create: `shared/idFormats.js`
- Create: `tests/idFormats.test.js`
- Modify: `functions/telegram-shared.js:7-18` (regex defs → re-export)
- Modify: `js/notifyRouting.js:13-17` (local `GROUP_ID_RE` → import)

**Interfaces:**
- Consumes: mirror machinery (Task 1).
- Produces: `shared/idFormats.js` exporting `GROUP_ID_RE` (`/^[A-Z0-9]{8}$/`) and `UID_RE` (`/^[0-9a-f]{32}$/`). `functions/telegram-shared.js` re-exports both, so `functions/telegram.js:6` (which imports `GROUP_ID_RE, UID_RE` from `./telegram-shared.js`) is untouched.

**Blast-radius note:** these regexes are the bot's validation of attacker-controllable `callback_query.data` before Admin-SDK writes (which bypass rules). The regex source strings must be copied EXACTLY — a widened pattern here is a security regression, not a style issue.

- [ ] **Step 1: Write the failing test**

Create `tests/idFormats.test.js`:

```js
/** @jest-environment node */
// Pins the shared id-format regexes: sample vectors (the trust boundary for
// attacker-controllable callback args and notification payloads), the RTDB
// rules' copy of the gid pattern (rules can't import JS), and the two former
// definition sites now consuming shared/.
import { GROUP_ID_RE, UID_RE } from '../shared/idFormats.js';
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('GROUP_ID_RE accepts exactly 8 chars of A-Z0-9', () => {
  expect(GROUP_ID_RE.test('ABC12345')).toBe(true);
  expect(GROUP_ID_RE.test('ABCD1234X')).toBe(false); // 9 chars
  expect(GROUP_ID_RE.test('abc12345')).toBe(false);  // lowercase
  expect(GROUP_ID_RE.test('ABC1234')).toBe(false);   // 7 chars
  expect(GROUP_ID_RE.test('ABC1234!')).toBe(false);  // symbol
  expect(GROUP_ID_RE.test('')).toBe(false);
});

test('UID_RE accepts exactly 32 lowercase hex chars', () => {
  expect(UID_RE.test('0123456789abcdef0123456789abcdef')).toBe(true);
  expect(UID_RE.test('0123456789ABCDEF0123456789ABCDEF')).toBe(false); // uppercase
  expect(UID_RE.test('0123456789abcdef0123456789abcde')).toBe(false);  // 31
  expect(UID_RE.test('0123456789abcdef0123456789abcdef0')).toBe(false); // 33
});

test('the RTDB rules still spell the same gid pattern (rules cannot import JS)', () => {
  // database.rules.json:97 pins contextGroupId to /^[A-Z0-9]{8}$/ — keep the
  // literal in step with shared/idFormats.js GROUP_ID_RE.
  expect(read('database.rules.json')).toContain('matches(/^[A-Z0-9]{8}$/)');
  expect(GROUP_ID_RE.source).toBe('^[A-Z0-9]{8}$');
});

test('the former definition sites consume shared/ (no local redefinition)', () => {
  expect(read('js/notifyRouting.js')).toContain("from '../shared/idFormats.js'");
  expect(read('js/notifyRouting.js')).not.toMatch(/const GROUP_ID_RE\s*=/);
  expect(read('functions/telegram-shared.js')).toContain("'./_shared/idFormats.js'");
  expect(read('functions/telegram-shared.js')).not.toMatch(/const (GROUP_ID_RE|UID_RE)\s*=/);
});
```

Run: `node_modules/.bin/jest tests/idFormats.test.js`
Expected: FAIL — module not found.

- [ ] **Step 2: Create `shared/idFormats.js` and sync**

```js
// shared/idFormats.js — the app's id-format trust boundary, ONE copy for web +
// functions. Group ids: 8 chars of A-Z0-9 (js/groups.js generateGroupId;
// database.rules.json pins the same literal — tests/idFormats.test.js keeps
// them in step). App uids: SHA-256 hex truncated to 32 chars (js/identity.js
// deriveUserIdFromRecoveryCode; functions/telegram-auth.js deriveTelegramUid).
// Server side these gate attacker-controllable callback_query.data before
// Admin-SDK writes that BYPASS the rules; client side they gate forged
// notification payloads before navigation. Do not widen.
export const GROUP_ID_RE = /^[A-Z0-9]{8}$/;
export const UID_RE = /^[0-9a-f]{32}$/;
```

Run: `npm run sync-shared`

- [ ] **Step 3: Consume in functions**

In `functions/telegram-shared.js`, delete lines 7-18 (both regex comment blocks and both `export const` regex lines) and insert at the same spot:

```js
// Id-format regexes live in shared/idFormats.js (one copy; the trust-boundary
// rationale is documented there). Re-exported so telegram.js / telegram-auth.js
// keep importing them from this module.
export { GROUP_ID_RE, UID_RE } from './_shared/idFormats.js';
```

- [ ] **Step 4: Consume in the client**

In `js/notifyRouting.js`, delete line 17 (`const GROUP_ID_RE = /^[A-Z0-9]{8}$/;`) and, keeping the existing comment at lines 13-16 (trim its last sentence to end at `…falls back to Direct rather than reaching navigateToGroup (#164 R3c).`), add at the top of the file:

```js
import { GROUP_ID_RE } from '../shared/idFormats.js';
```

- [ ] **Step 5: Verify green + full suites + build**

Run: `node_modules/.bin/jest tests/idFormats.test.js` → PASS.
Run: `node_modules/.bin/jest` && `cd functions && npm test` && `npm run build` → all green (the bot callback-guard tests in `functions/test/` pass unchanged).

- [ ] **Step 6: Commit**

```bash
git add shared/idFormats.js functions/_shared/idFormats.js functions/telegram-shared.js js/notifyRouting.js tests/idFormats.test.js
git commit -m "refactor(shared): one GROUP_ID_RE/UID_RE source in shared/idFormats.js"
```

---

### Task 6: Presence-predicate parity — pin and document, do NOT unify

**Files:**
- Create: `tests/presencePredicateParity.test.js`
- Modify: `js/utils.js:70-75` (comment only)
- Modify: `functions/presence-core.js:39-44` (comment only)

**Interfaces:**
- Consumes: nothing new.
- Produces: a parity test that documents the REAL, existing divergence between the client and server availability predicates. No behavior change anywhere.

**Why no unification (spec Doc 2, unit #5):** the two predicates were written independently and are NOT behavior-identical. OBSERVED at planning time: client `isAvailable(status, availableUntil)` (`js/utils.js:73`) treats `null` `availableUntil` as **not expired** → an open-ended `available` is available. Server `primaryAvailable(presence, now)` (`functions/presence-core.js:42`) requires `isFutureMs(availableUntil)` → `null` reads **unavailable**. The server side documents its assumption ("available state always carries a future availableUntil — true for the app's timed-availability model"), while the client's `availableForText` explicitly renders the open-ended case. Per the spec: a divergence is either a latent bug (file it) or intentional (document it) — this task pins both behaviors and surfaces the question to the operator; it does not decide.

- [ ] **Step 1: Write the parity test (it should pass immediately — it pins current reality)**

Create `tests/presencePredicateParity.test.js`:

```js
/** @jest-environment node */
// Pins BOTH availability predicates — client js/utils.js isAvailable and
// server functions/presence-core.js primaryAvailable — over one vector table,
// INCLUDING their known divergence on open-ended availability (null
// availableUntil): the client reads it available, the server reads it not.
// This is deliberately a parity *pin*, not a unification: whether the
// divergence is a latent bug or intentional is the operator's call (spec
// 2026-07-11 Doc 2 unit #5). If either side moves, this fails and the
// question must be re-asked — do not silently "fix" one to match the other.
import { isAvailable } from '../js/utils.js';
import { primaryAvailable } from '../functions/presence-core.js';

const NOW = 1_000_000;
const FUTURE = NOW + 60_000;
const PAST = NOW - 60_000;

const VECTORS = [
  // status, availableUntil, client, server
  ['available', FUTURE, true, true],
  ['available', PAST, false, false],
  ['available', null, true, false], // ← THE divergence: open-ended availability
  ['unavailable', FUTURE, false, false],
  ['unavailable', null, false, false],
  [undefined, FUTURE, false, false],
];

test.each(VECTORS)(
  'status=%p availableUntil=%p → client %p / server %p',
  (status, availableUntil, client, server) => {
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    try {
      expect(isAvailable(status, availableUntil)).toBe(client);
      expect(primaryAvailable({ status, availableUntil }, NOW)).toBe(server);
    } finally {
      dateNow.mockRestore();
    }
  }
);
```

(The client predicate reads `Date.now()` internally — hence the spy; the server one takes `now` explicitly.)

Run: `node_modules/.bin/jest tests/presencePredicateParity.test.js`
Expected: PASS on every vector. If any vector FAILS, the predicates have drifted from the planning-time reading — STOP and report the actual behavior to the operator before adjusting the table.

- [ ] **Step 2: Cross-link the two predicates in comments**

In `js/utils.js`, extend the comment above `isAvailable` (lines 70-72) with one line:

```js
// NOTE: the server's functions/presence-core.js primaryAvailable deliberately
// differs on null availableUntil (open-ended reads available here, not there)
// — parity pinned in tests/presencePredicateParity.test.js; don't unify blind.
```

In `functions/presence-core.js`, extend the comment above `primaryAvailable` (lines 39-41) with one line:

```js
// NOTE: the client's js/utils.js isAvailable deliberately differs on null
// availableUntil (open-ended reads available there, not here) — parity pinned
// in tests/presencePredicateParity.test.js; don't unify blind.
```

- [ ] **Step 3: Full suites**

Run: `node_modules/.bin/jest` && `cd functions && npm test`
Expected: all green (comment-only source changes; one new test file).

- [ ] **Step 4: Commit**

```bash
git add tests/presencePredicateParity.test.js js/utils.js functions/presence-core.js
git commit -m "test(shared): pin client/server availability-predicate parity incl. null-AU divergence"
```

- [ ] **Step 5: Surface the divergence question to the operator**

Include in the task report, verbatim question: "Client treats `status: 'available'` with `null availableUntil` as available (open-ended); the server notifier/bot treat it as unavailable. Latent bug or intentional? A) intentional — keep the pin as-is; B) bug — file an issue to reconcile (separate work, not this plan)." Do not proceed to unification in this plan regardless of the answer.

---

### Task 7: Documentation — landmine entry + README

**Files:**
- Modify: `docs/HANDOFF.md` (Landmines list in the top block area)
- Modify: `README.md` (Tech Stack section)

**Interfaces:**
- Consumes: everything above (documents it).
- Produces: durable docs; no code.

- [ ] **Step 1: Add the HANDOFF landmine**

In `docs/HANDOFF.md`, add to the current landmine list (alongside the existing build-artifact/CSP items):

```markdown
- `shared/` is the single source of truth for code used by BOTH `js/` and `functions/`; `functions/_shared/` is a COMMITTED byte-identical mirror (`npm run sync-shared`) because `firebase deploy` archives only `functions/`. Never edit `functions/_shared/` by hand — edit `shared/`, run the sync, commit both. Staleness fails `tests/sharedMirror.test.js` + `functions/test/shared-mirror.test.js` (both block CI's deploy job). `shared/` modules must stay pure (no imports outside `shared/` — guard-tested).
```

- [ ] **Step 2: Update the README Tech Stack**

In `README.md`'s "Tech Stack" list, extend the Cloud Functions bullet (or add a bullet after it):

```markdown
- **`shared/`** — pure modules used by both the web client and Cloud Functions (time formatting, notify-channel default, name caps, id formats); functions consume a committed mirror (`functions/_shared/`, `npm run sync-shared`) since deploys archive only `functions/`
```

- [ ] **Step 3: Full suites (docs shouldn't break anything, but the gate is cheap)**

Run: `node_modules/.bin/jest` && `cd functions && npm test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs/HANDOFF.md README.md
git commit -m "docs(shared): sync-shared landmine + README stack note"
```

---

## Plan-wide done criteria

- All seven tasks committed on the feature branch; both suites green from a clean tree; `npm run build` clean.
- The operator's post-deploy smoke checks recorded in Tasks 2 and 8/3 are surfaced in the final report (bot `/status` fuzzy time; one telegram-routed and one push-routed knock).
- The Task 6 divergence question is answered by the operator (answer does not block this plan).
- Push the branch; the maintainer merges (never merge to `dev`/`main` from a session).
