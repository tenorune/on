# PALETTE_INTERACTIONS_ENABLED Feature Flag Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `PALETTE_INTERACTIONS_ENABLED: false` feature flag to gate the v0.6 favorites strip and long-press adoption features independently of the base palette system.

**Architecture:** Single new flag in `js/features.js`; guards added at 3 call sites (`favorites.js`, `app.js`, `following.js`); 5 test mocks updated in `favorites.test.js` and 3 in `following.test.js`; 2 new tests added.

**Tech Stack:** Vanilla JS ES modules, Jest (jsdom), no build step.

---

## Chunk 1: Flag + favorites.js guard

### Task 1: Add flag to features.js

**Files:**
- Modify: `js/features.js`

- [ ] **Step 1: Open `js/features.js`**

Current contents:
```js
module.exports = {
  PALETTES_ENABLED: true,
  KNOCK_ENABLED: false,
  CALL_ENABLED: true,
};
```

- [ ] **Step 2: Add the new flag**

Insert `PALETTE_INTERACTIONS_ENABLED: false,` after `PALETTES_ENABLED`:

```js
module.exports = {
  PALETTES_ENABLED: true,
  PALETTE_INTERACTIONS_ENABLED: false,
  KNOCK_ENABLED: false,
  CALL_ENABLED: true,
};
```

- [ ] **Step 3: Run the full test suite to confirm no regressions**

```bash
npx jest --no-coverage 2>&1 | tail -6
```

Expected: same pass/fail counts as before (pre-existing `status.test.js` failures are fine; no new failures).

- [ ] **Step 4: Commit**

```bash
git add js/features.js
git commit -m "feat: add PALETTE_INTERACTIONS_ENABLED feature flag (default false)"
```

---

### Task 2: Write failing test — favorites.js flag guard

**Files:**
- Modify: `tests/favorites.test.js`

- [ ] **Step 1: Add a standalone isolated test at the bottom of the file** (after all `describe` blocks, before EOF)

This test follows the same full-isolation pattern as the `PALETTES_ENABLED: false` test in `following.test.js` — it calls `jest.resetModules()`, re-applies every mock, then restores at the end.

```js
test('saveFavorite: does not save when PALETTE_INTERACTIONS_ENABLED is false', () => {
  jest.resetModules();
  jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: false }));
  jest.mock('../js/palettes.js', () => ({
    ...jest.requireActual('../js/palettes.js'),
    getPaletteByKey: jest.fn(() => ({ color: '#22c55e', theme: { bg: '#052e16', surface2: '#184226' } })),
    getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
  }));
  jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined) }));
  jest.mock('../js/store.js', () => ({
    ...jest.requireActual('../js/store.js'),
    getPaletteState: jest.fn(() => ({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null },
        '2': { selectedKey: 'volt', activePaletteKey: null },
      },
    })),
    setPaletteState: jest.fn(),
    getFavorites: jest.fn(() => []),
    setFavorites: jest.fn(),
  }));
  const { saveFavorite: sf } = require('../js/favorites.js');
  sf();
  const { setFavorites } = require('../js/store.js');
  expect(setFavorites).not.toHaveBeenCalled();
  // No restore needed — this test is last in the file.
});
```

- [ ] **Step 2: Run the new test to confirm it fails**

```bash
npx jest tests/favorites.test.js --no-coverage -t "does not save when PALETTE_INTERACTIONS_ENABLED is false" 2>&1 | tail -10
```

Expected: FAIL — `setFavorites` was called (the guard doesn't exist yet).

---

### Task 3: Update favorites.js guard + import

**Files:**
- Modify: `js/favorites.js` (line 2 and line 60)

- [ ] **Step 1: Update the import at line 2**

Change:
```js
import { PALETTES_ENABLED } from './features.js';
```
To:
```js
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED } from './features.js';
```

- [ ] **Step 2: Update the `saveFavorite` early-return guard at line 60**

Change:
```js
if (!PALETTES_ENABLED) return;
```
To:
```js
if (!PALETTES_ENABLED || !PALETTE_INTERACTIONS_ENABLED) return;
```

- [ ] **Step 3: Run the new test to confirm it passes**

```bash
npx jest tests/favorites.test.js --no-coverage -t "does not save when PALETTE_INTERACTIONS_ENABLED is false" 2>&1 | tail -10
```

Expected: PASS.

---

### Task 4: Update all 5 favorites.test.js feature mocks

**Files:**
- Modify: `tests/favorites.test.js`

All existing `jest.mock('../js/features.js', ...)` calls in this file must add `PALETTE_INTERACTIONS_ENABLED: true` so the existing tests keep working with the new guard.

- [ ] **Step 1: Update line 37 (top-level mock)**

Change:
```js
jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true }));
```
To:
```js
jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
```

- [ ] **Step 2: Update line ~92 (`saveFavorite` describe `beforeEach`)**

Same change — `{ PALETTES_ENABLED: true }` → `{ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }`.

- [ ] **Step 3: Update line ~230 (`renderStrip / initFavoritesStrip` describe `beforeEach`)**

Same change.

- [ ] **Step 4: Update line ~337 (`slot tap interactions` describe `beforeEach`)**

Same change.

- [ ] **Step 5: Update line ~403 (`history pill tap interactions` describe `beforeEach`)**

Same change.

- [ ] **Step 6: Run favorites tests to confirm all pass**

```bash
npx jest tests/favorites.test.js --no-coverage 2>&1 | tail -6
```

Expected: all tests pass (count increases by 1 from the new test).

- [ ] **Step 7: Commit**

```bash
git add js/favorites.js tests/favorites.test.js
git commit -m "feat: gate saveFavorite on PALETTE_INTERACTIONS_ENABLED"
```

---

## Chunk 2: app.js + following.js guards

### Task 5: Update app.js — import + initFavoritesStrip guard

**Files:**
- Modify: `js/app.js` (line 8 and line 111)

- [ ] **Step 1: Update the import at line 8**

Change:
```js
import { PALETTES_ENABLED, KNOCK_ENABLED, CALL_ENABLED } from './features.js';
```
To:
```js
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED, KNOCK_ENABLED, CALL_ENABLED } from './features.js';
```

- [ ] **Step 2: Update the `initFavoritesStrip` call at line 111**

The current `if (PALETTES_ENABLED)` block ends with:
```js
  initSwatches(userId);
  initFavoritesStrip(userId);
```

Change the last line only:
```js
  initSwatches(userId);
  if (PALETTE_INTERACTIONS_ENABLED) initFavoritesStrip(userId);
```

- [ ] **Step 3: Run full test suite**

```bash
npx jest --no-coverage 2>&1 | tail -6
```

Expected: no new failures.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: gate initFavoritesStrip on PALETTE_INTERACTIONS_ENABLED"
```

---

### Task 6: Write failing test — following.js long-press guard

**Files:**
- Modify: `tests/following.test.js`

- [ ] **Step 1: Find the `PALETTES_ENABLED false` test at line ~1248**

It's inside the last `describe` block, just before the closing `});`. Add a new test immediately before the existing `'PALETTES_ENABLED false — no adoption on long press'` test:

```js
test('PALETTE_INTERACTIONS_ENABLED false — no long-press handler attached (palettes still active)', () => {
  jest.resetModules();
  jest.mock('../js/features.js', () => ({
    PALETTES_ENABLED: true,
    PALETTE_INTERACTIONS_ENABLED: false,
    KNOCK_ENABLED: true,
    CALL_ENABLED: true,
  }));
  const { initList: initList3 } = require('../js/following.js');
  setupDom();
  jest.useFakeTimers();
  let cb;
  const { watchFollowers: wf3, watchStatus: ws3 } = require('../js/db.js');
  wf3.mockImplementation((_uid, fn) => { cb = fn; return jest.fn(); });
  ws3.mockReturnValue(jest.fn());
  const { getFollowing: gf3 } = require('../js/store.js');
  gf3.mockReturnValue([{ userId: TARGET_ID, code: 'XY9K2M', label: 'Alice' }]);
  initList3(MY_ID, 'MYCODE');
  cb([{ userId: TARGET_ID, code: 'XY9K2M' }]);
  const li = document.querySelector(`[data-user-id="${TARGET_ID}"]`);
  press(li);
  jest.advanceTimersByTime(600);
  const { setStatusColor: ssc3 } = require('../js/db.js');
  expect(ssc3).not.toHaveBeenCalled();
  // Restore
  jest.resetModules();
  jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true, KNOCK_ENABLED: true, CALL_ENABLED: true }));
});
```

- [ ] **Step 2: Run the new test to confirm it fails**

```bash
npx jest tests/following.test.js --no-coverage -t "PALETTE_INTERACTIONS_ENABLED false" 2>&1 | tail -10
```

Expected: FAIL — long press fires even when `PALETTE_INTERACTIONS_ENABLED: false`.

---

### Task 7: Update following.js — import + long-press guard

**Files:**
- Modify: `js/following.js` (line 11 and line 433)

- [ ] **Step 1: Update the import at line 11**

Change:
```js
import { PALETTES_ENABLED, KNOCK_ENABLED, CALL_ENABLED } from './features.js';
```
To:
```js
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED, KNOCK_ENABLED, CALL_ENABLED } from './features.js';
```

- [ ] **Step 2: Update the long-press guard at line 433**

Change:
```js
if (PALETTES_ENABLED) {
```
To:
```js
if (PALETTES_ENABLED && PALETTE_INTERACTIONS_ENABLED) {
```

- [ ] **Step 3: Run the new test to confirm it passes**

```bash
npx jest tests/following.test.js --no-coverage -t "PALETTE_INTERACTIONS_ENABLED false" 2>&1 | tail -10
```

Expected: PASS.

---

### Task 8: Update following.test.js — 3 existing feature mocks

**Files:**
- Modify: `tests/following.test.js`

- [ ] **Step 1: Update line 14 (top-level mock)**

Change:
```js
jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, KNOCK_ENABLED: true, CALL_ENABLED: true }));
```
To:
```js
jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true, KNOCK_ENABLED: true, CALL_ENABLED: true }));
```

- [ ] **Step 2: Update the `PALETTES_ENABLED: false` isolation mock** (was line ~1252 before Task 6's insertion — search by content, not line number)

Change:
```js
jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: false, KNOCK_ENABLED: true, CALL_ENABLED: true }));
```
To:
```js
jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: false, PALETTE_INTERACTIONS_ENABLED: false, KNOCK_ENABLED: true, CALL_ENABLED: true }));
```

- [ ] **Step 3: Update the restore mock at the end of the `PALETTES_ENABLED: false` test** (was line ~1271 before Task 6's insertion — search by content)

Change:
```js
jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, KNOCK_ENABLED: true, CALL_ENABLED: true }));
```
To:
```js
jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true, KNOCK_ENABLED: true, CALL_ENABLED: true }));
```

- [ ] **Step 4: Run following tests to confirm all pass**

```bash
npx jest tests/following.test.js --no-coverage 2>&1 | tail -6
```

Expected: all pass (count increases by 1 from the new test).

- [ ] **Step 5: Run full test suite for final verification**

```bash
npx jest --no-coverage 2>&1 | tail -6
```

Expected: no new failures vs. baseline (pre-existing `status.test.js` failures are pre-existing and unrelated).

- [ ] **Step 6: Commit + push**

```bash
git add js/following.js tests/following.test.js
git commit -m "feat: gate long-press adoption on PALETTE_INTERACTIONS_ENABLED"
git push
```
