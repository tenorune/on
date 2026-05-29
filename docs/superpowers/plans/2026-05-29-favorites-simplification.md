# Favorites Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the favorites strip's mixed live-slot + history model into a single uniform 8-entry history of combos the user has committed to. Two writers: going-active (any context, unavailable→available transition) and long-press adoption (any context, pushes the adopted combo).

**Architecture:** Add a new exported `saveCombo(combo)` in `js/favorites.js` that subsumes `saveFavorite(force)` + `saveCustomCombo(combo)`. Switch all four call sites (Direct go-active, Direct adoption, group go-active, group adoption) to use it. Simplify `handleHistoryTap` to adopt-only (no swap). Drop slot-pill rendering and all slot-derived helpers. Bump cap from 6 → 8. No schema change.

**Tech Stack:** Vanilla ES modules, Firebase RTDB, jest + jsdom. Spec: `docs/superpowers/specs/2026-05-29-favorites-simplification-design.md`.

---

## File structure

| File | Role |
|---|---|
| `js/favorites.js` | **Major rewrite.** Add `saveCombo`, simplify `handleHistoryTap` + render functions, drop all slot helpers + `_lastCommittedCombo` machinery. |
| `js/me.js` | **Modify.** Switch Direct go-active call site from `saveFavorite()` to `saveCombo(buildCombo())`. |
| `js/following.js` | **Modify.** Switch Direct adoption call site from `saveFavorite(true)` to `saveCombo(adoptedCombo)`. Drop the `removeHistoryDuplicatesOfSlots()` call. |
| `js/groupContext.js` | **Modify.** Switch group adoption from `saveCustomCombo(preCombo)` to `saveCombo(adoptedCombo)`. Add NEW call site in dot-tap-to-go-available handler. |
| `tests/favorites.test.js` | **Major rewrite.** Add `saveCombo` suite. Rewrite `handleHistoryTap` tests. Drop slot-tap and `saveCustomCombo` suites. Rewrite render tests. Update `getAllCombos` tests. |
| `tests/me.test.js` | **Modify.** Replace `saveFavorite` mock + assertions with `saveCombo`. |
| `tests/following.test.js` | **Modify.** Replace `saveFavorite`/`removeHistoryDuplicatesOfSlots` mocks + assertions with `saveCombo`. |
| `tests/groupContext.test.js` | **Modify.** Replace `saveCustomCombo` mock with `saveCombo`. Update assertions. Add new test for group go-active. |

---

## Task 1: Add `saveCombo` export (coexists with existing writers)

TDD-first new export. Old `saveFavorite` + `saveCustomCombo` stay functional until later tasks switch callers.

**Files:**
- Modify: `js/favorites.js`
- Test: `tests/favorites.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/favorites.test.js` after the existing `describe('saveCustomCombo', ...)` block:

```js
describe('saveCombo', () => {
  let saveCombo;
  let store;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(),
      enterPaletteMode: jest.fn(),
      exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn(() => null),
      getGlowForColor: jest.fn(() => '#000'),
    }));
    jest.mock('../js/db.js', () => ({
      setStatusColor: jest.fn().mockResolvedValue(undefined),
      setUserFavorites: jest.fn().mockResolvedValue(undefined),
    }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(() => ({
        activeSet: 1,
        sets: { '1': { selectedKey: 'forest', activePaletteKey: null, selectedColor: '#22c55e' },
                '2': { selectedKey: 'volt',   activePaletteKey: null, selectedColor: '#aaff00' } },
      })),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => []),
      setFavorites: jest.fn(),
    }));
    store = require('../js/store.js');
    ({ saveCombo } = require('../js/favorites.js'));
  });

  test('pushes combo to empty history', () => {
    const combo = { statusColor: '#ff00aa', surface: '#111', surface2: '#222',
                    paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 };
    saveCombo(combo);
    expect(store.setFavorites).toHaveBeenCalledTimes(1);
    expect(store.setFavorites.mock.calls[0][0][0]).toEqual(combo);
  });

  test('prepends combo to non-empty history', () => {
    const existing = { statusColor: '#000000', surface: '#111', surface2: '#222',
                       paletteKey: null, selectedKey: 'forest', activeSet: 1 };
    const incoming = { statusColor: '#ff00aa', surface: '#111', surface2: '#222',
                       paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 };
    store.getFavorites.mockReturnValueOnce([existing]);
    saveCombo(incoming);
    const written = store.setFavorites.mock.calls[0][0];
    expect(written[0]).toEqual(incoming);
    expect(written[1]).toEqual(existing);
  });

  test('head-only dedupe: suppresses push when incoming matches head', () => {
    const combo = { statusColor: '#ff00aa', surface: '#111', surface2: '#222',
                    paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 };
    store.getFavorites.mockReturnValueOnce([combo]);
    saveCombo(combo);
    expect(store.setFavorites).not.toHaveBeenCalled();
  });

  test('does NOT dedupe against non-head positions (deeper duplicates allowed)', () => {
    const other = { statusColor: '#aabbcc', surface: '#000', surface2: '#000',
                    paletteKey: null, selectedKey: 'volt', activeSet: 2 };
    const combo = { statusColor: '#ff00aa', surface: '#111', surface2: '#222',
                    paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 };
    // combo is at slot 2; head is `other` — dedupe should NOT fire.
    store.getFavorites.mockReturnValueOnce([other, combo]);
    saveCombo(combo);
    expect(store.setFavorites).toHaveBeenCalledTimes(1);
    const written = store.setFavorites.mock.calls[0][0];
    expect(written[0]).toEqual(combo);
    expect(written.length).toBe(3); // [combo, other, combo]
  });

  test('drops oldest when history is full (cap at 8)', () => {
    const full = Array.from({ length: 8 }, (_, i) => ({
      statusColor: `#00000${i}`, surface: '#111', surface2: '#222',
      paletteKey: null, selectedKey: 'forest', activeSet: 1,
    }));
    const incoming = { statusColor: '#ff00aa', surface: '#111', surface2: '#222',
                       paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 };
    store.getFavorites.mockReturnValueOnce(full);
    saveCombo(incoming);
    const written = store.setFavorites.mock.calls[0][0];
    expect(written.length).toBe(8);
    expect(written[0]).toEqual(incoming);
    expect(written[7]).toEqual(full[6]); // last full entry pushed off
  });

  test('null combo is a no-op', () => {
    saveCombo(null);
    expect(store.setFavorites).not.toHaveBeenCalled();
  });

  test('feature flags off → no-op', () => {
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: false, PALETTE_INTERACTIONS_ENABLED: false }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getFavorites: jest.fn(() => []),
      setFavorites: jest.fn(),
    }));
    const off = require('../js/store.js');
    const { saveCombo: gated } = require('../js/favorites.js');
    gated({ statusColor: '#fff', surface: '#000', surface2: '#000', paletteKey: null, selectedKey: 'forest', activeSet: 1 });
    expect(off.setFavorites).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and confirm tests fail**

Run: `npx jest tests/favorites.test.js -t "saveCombo" 2>&1 | tail -20`
Expected: FAIL with `saveCombo is not a function`.

- [ ] **Step 3: Implement `saveCombo`**

Edit `js/favorites.js`. Add a new constant near the existing `MAX_HISTORY` (around line 11):

```js
const MAX_FAVORITES = 8;
```

Add the new export after the existing `saveCustomCombo` function (around line 172):

```js
// Single writer for the new model. Pushes a caller-supplied combo to the
// head of the favorites strip, with head-only dedupe and cap-at-8. Used
// by going-active (Direct + group) and by long-press adoption (Direct +
// group). Replaces saveFavorite and saveCustomCombo; both will be removed
// in a follow-up cleanup task once all callers are migrated.
export function saveCombo(combo) {
  if (!PALETTES_ENABLED || !PALETTE_INTERACTIONS_ENABLED) return;
  if (!combo) return;
  const history = getFavorites();
  if (history.length && pillsLookSame(history[0], combo)) return; // head-only dedupe
  writeFavorites([combo, ...history].slice(0, MAX_FAVORITES));
  renderStrip();
}
```

- [ ] **Step 4: Run and confirm tests pass**

Run: `npx jest tests/favorites.test.js -t "saveCombo" 2>&1 | tail -10`
Expected: PASS, 7 tests.

Then: `npx jest tests/favorites.test.js 2>&1 | tail -5`
Expected: all PASS (no regressions in existing suites).

Then: `npx jest 2>&1 | tail -5`
Expected: 21 suites passing, count grew by 7 from 688 to 695.

- [ ] **Step 5: Commit**

```bash
git add js/favorites.js tests/favorites.test.js
git commit -m "feat: saveCombo — single writer for the simplified favorites model

Pushes a caller-supplied combo to the head of the favorites strip with
head-only dedupe and cap-at-8. Coexists with saveFavorite and
saveCustomCombo for now; callers will migrate to it in follow-up tasks,
and the old writers + slot helpers get cleaned up in the final pass."
```

---

## Task 2: Switch `me.js` Direct go-active to `saveCombo`

**Files:**
- Modify: `js/me.js`
- Test: `tests/me.test.js`

- [ ] **Step 1: Update `me.test.js` mock and assertions**

In `tests/me.test.js` line 3, replace the favorites mock:

```js
jest.mock('../js/favorites.js', () => ({ saveCombo: jest.fn(), initFavoritesStrip: jest.fn() }));
```

In `tests/me.test.js` line 390 (inside the `describe('saveFavorite guard in setAvailable', ...)` block), replace the inner mock:

```js
jest.mock('../js/favorites.js', () => ({ saveCombo: jest.fn(), initFavoritesStrip: jest.fn() }));
```

Then rename the describe and update all `saveFavoriteMock` references in that block to `saveComboMock`. The block becomes:

```js
describe('saveCombo guard in setAvailable', () => {
  let applyOwnStatus, saveComboMock;

  beforeEach(() => {
    jest.resetModules();
    // (existing setup, with the inner jest.mock replaced as above)
    saveComboMock = require('../js/favorites.js').saveCombo;
    // (rest of setup)
  });

  test('saveCombo does NOT fire during page-load restore of available status', () => {
    // (existing body, with saveFavoriteMock → saveComboMock)
    expect(saveComboMock).not.toHaveBeenCalled();
  });

  test('saveCombo fires when applyOwnStatus sets available after prior status call', () => {
    // (existing body, with saveFavoriteMock → saveComboMock)
    expect(saveComboMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest tests/me.test.js -t "saveCombo" 2>&1 | tail -10`
Expected: FAIL — `saveCombo` is not called yet (me.js still calls `saveFavorite`).

- [ ] **Step 3: Update `me.js` import + call site**

In `js/me.js`, change line 5:

```js
import { saveCombo } from './favorites.js';
```

Find `buildCombo` — it lives in `js/favorites.js`, not `me.js`. The current `saveFavorite()` call in me.js (line 168) doesn't pass a combo because `saveFavorite` internally calls `buildCombo()`. After migration, me.js needs to pass the combo explicitly. Two options:

**Option A (recommended):** export `buildCombo` from `js/favorites.js` and call `saveCombo(buildCombo())` from me.js.

**Option B:** keep `buildCombo` private to favorites.js and have `saveCombo` accept a "build it yourself" sentinel like `undefined`.

Use Option A. In `js/favorites.js`, change `function buildCombo()` (line 25) to `export function buildCombo()`.

In `js/me.js` line 5, expand the import:

```js
import { saveCombo, buildCombo } from './favorites.js';
```

In `js/me.js` line 168, replace the call:

```js
  if (PALETTES_ENABLED && savingEnabled && !dot.classList.contains('available')) saveCombo(buildCombo());
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/me.test.js 2>&1 | tail -5`
Expected: all PASS.

Run: `npx jest 2>&1 | tail -5`
Expected: 21 suites passing, no regressions.

- [ ] **Step 5: Commit**

```bash
git add js/me.js js/favorites.js tests/me.test.js
git commit -m "refactor: Direct go-active uses saveCombo

setAvailable now calls saveCombo(buildCombo()) instead of saveFavorite().
buildCombo gets exported from favorites.js so me.js can pass the combo
explicitly rather than relying on saveFavorite's internal build."
```

---

## Task 3: Switch `following.js` Direct adoption to `saveCombo`

**Files:**
- Modify: `js/following.js`
- Test: `tests/following.test.js`

- [ ] **Step 1: Update `following.test.js` mock and assertions**

In `tests/following.test.js` line 2, replace the favorites mock:

```js
jest.mock('../js/favorites.js', () => ({ saveCombo: jest.fn(), initFavoritesStrip: jest.fn(), getAllCombos: jest.fn(() => []) }));
```

(Drops `saveFavorite` and `removeHistoryDuplicatesOfSlots` from the mock — neither will be imported by `following.js` after this task.)

Update the test at line 1301:

```js
test('calls saveCombo once after adoption with the adopted combo', () => {
  const { saveCombo } = require('../js/favorites.js');
  // (existing test setup that triggers the long-press adoption)
  expect(saveCombo).toHaveBeenCalledTimes(1);
  // Adopted combo has the source's statusColor + paletteKey.
  expect(saveCombo).toHaveBeenCalledWith(expect.objectContaining({
    statusColor: expect.any(String),
    paletteKey: expect.anything(), // could be string or null
  }));
});
```

Delete the test at line 1308 (`'calls removeHistoryDuplicatesOfSlots after adoption to clean up same-combo duplicates'`) entirely — the function is going away.

- [ ] **Step 2: Run and confirm the assertion fails**

Run: `npx jest tests/following.test.js -t "saveCombo" 2>&1 | tail -10`
Expected: FAIL — `saveCombo` not called yet.

- [ ] **Step 3: Update `following.js` import + adoption call site**

In `js/following.js` line 21, replace the import:

```js
import { saveCombo, getAllCombos } from './favorites.js';
```

(Drops `saveFavorite` and `removeHistoryDuplicatesOfSlots`.)

Find `triggerAdoption` (line 418). Replace the body:

```js
function triggerAdoption(entry, myUserId) {
  // Clear long-press hint on first adoption
  if (!isHintSeen('longpress')) {
    markHintSeen('longpress');
    document.querySelectorAll('.longpress-hint').forEach(el => el.remove());
  }
  // Build the adopted combo from the source's broadcast state and push to
  // favorites BEFORE applying the adoption (the apply mutates picker state).
  const targetData = lastUserData.get(entry.userId);
  const adoptedColor = targetData?.statusColor || '#22c55e';
  const adoptedPaletteKey = targetData?.paletteKey ?? null;
  // Resolve surface colors from the palette (matches buildCombo's shape).
  const adoptedPalette = adoptedPaletteKey ? getPaletteByKey(adoptedPaletteKey) : null;
  const adoptedCombo = {
    statusColor: adoptedColor,
    surface:  adoptedPalette?.theme?.surface  ?? '#1e293b',
    surface2: adoptedPalette?.theme?.surface2 ?? '#334155',
    paletteKey: adoptedPaletteKey,
    selectedKey: adoptedPaletteKey ?? 'forest', // best-guess selectedKey
    activeSet: adoptedPaletteKey && PALETTE_SETS[2].some(p => p.key === adoptedPaletteKey) ? 2 : 1,
  };
  saveCombo(adoptedCombo);
  applyAdoption(entry, myUserId);
  // (removeHistoryDuplicatesOfSlots call from here is GONE — slots no longer exist.)
}
```

`getPaletteByKey` and `PALETTE_SETS` are already imported at the top of `js/following.js`. Verify with `grep -n "PALETTE_SETS\|getPaletteByKey" js/following.js | head -5`. If not, add them to the existing import from `./palettes.js`.

- [ ] **Step 4: Run tests**

Run: `npx jest tests/following.test.js 2>&1 | tail -5`
Expected: all PASS.

Run: `npx jest 2>&1 | tail -5`
Expected: 21 suites passing, no regressions.

- [ ] **Step 5: Commit**

```bash
git add js/following.js tests/following.test.js
git commit -m "refactor: Direct adoption pushes adopted combo via saveCombo

triggerAdoption now builds the adopted combo from the source's broadcast
statusColor + paletteKey and pushes it to favorites via saveCombo,
replacing the prior 'push pre-adoption combo via saveFavorite(true)
then dedupe-against-slots' flow. Removes the removeHistoryDuplicatesOfSlots
call since slots are going away in a later task."
```

---

## Task 4: Switch group adoption to `saveCombo`

**Files:**
- Modify: `js/groupContext.js`
- Test: `tests/groupContext.test.js`

- [ ] **Step 1: Update `groupContext.test.js` mock and assertions**

In `tests/groupContext.test.js` line 60, replace the favorites mock:

```js
jest.mock('../js/favorites.js', () => ({
  saveCombo: jest.fn(),
}));
```

In the long-press adoption test around line 1210, replace assertions:

```js
test('long-press triggers adoption when this group override is ON', () => {
  setupRoster({
    ownOverrideEnabled: true,
    members: { src: { displayName: 'Alice' } },
  });
  const li = document.querySelector('#group-roster li[data-user-id="src"]');
  li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
  jest.advanceTimersByTime(600);
  expect(groups.setOverrideAppearance).toHaveBeenCalledWith('G1', 'me',
    expect.objectContaining({ statusColor: '#ff00aa', paletteKey: 'forest' }));
  expect(groupNav.applyOptimisticAppearance).toHaveBeenCalledWith('G1',
    expect.objectContaining({ statusColor: '#ff00aa', paletteKey: 'forest' }));
  expect(favorites.saveCombo).toHaveBeenCalledWith(expect.objectContaining({
    statusColor: '#ff00aa', paletteKey: 'forest',
  }));
});
```

Update the `'long-press is a no-op when this group override is OFF'` test at line 1195 to assert `saveCombo` not called:

```js
expect(favorites.saveCombo).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run and confirm tests fail**

Run: `npx jest tests/groupContext.test.js -t "long-press" 2>&1 | tail -10`
Expected: FAIL — `saveCombo` not called yet (`saveCustomCombo` is).

- [ ] **Step 3: Update `groupContext.js` import + adoption call site**

In `js/groupContext.js` line 21:

```js
import { saveCombo } from './favorites.js';
```

Find `triggerGroupAdoption` (around line 996). Replace the favorites-push block (around lines 1044-1049):

```js
  // 2. Push the adopted combo to favorites.
  const adoptedCombo = {
    statusColor: adoptedColor,
    surface:  adoptedPaletteKey ? (getPaletteByKey(adoptedPaletteKey)?.theme?.surface  ?? '#1e293b') : '#1e293b',
    surface2: adoptedPaletteKey ? (getPaletteByKey(adoptedPaletteKey)?.theme?.surface2 ?? '#334155') : '#334155',
    paletteKey: adoptedPaletteKey,
    selectedKey: adoptedPaletteKey ?? 'forest',
    activeSet: adoptedPaletteKey && PALETTE_SETS[2].some(p => p.key === adoptedPaletteKey) ? 2 : 1,
  };
  saveCombo(adoptedCombo);
```

(Removes the `buildGroupCombo({ ownOverride: _ownOverride, ... })` + `saveCustomCombo(preCombo)` calls — they pushed the pre-adoption combo, which the new model doesn't track.)

`getPaletteByKey` and `PALETTE_SETS` are already imported (line 26). Verify.

- [ ] **Step 4: Run tests**

Run: `npx jest tests/groupContext.test.js 2>&1 | tail -5`
Expected: all PASS.

Run: `npx jest 2>&1 | tail -5`
Expected: 21 suites passing, no regressions.

- [ ] **Step 5: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "refactor: group adoption pushes adopted combo via saveCombo

triggerGroupAdoption now builds an adoptedCombo from the resolved
source color + paletteKey and pushes it via saveCombo, replacing the
prior 'push pre-adoption combo via saveCustomCombo(buildGroupCombo(...))'
flow. The pre-adoption combo is no longer pushed — per the new model,
favorites only records combos the user actively commits to."
```

---

## Task 5: Add group go-active push (NEW call site)

**Files:**
- Modify: `js/groupContext.js`
- Test: `tests/groupContext.test.js`

- [ ] **Step 1: Add the failing test**

Append to `tests/groupContext.test.js` inside the existing `describe('group-context long-press adoption', ...)` block (or open a new sibling `describe('group-context go-available', ...)`):

```js
describe('group-context dot-tap to go available', () => {
  const db = require('../js/db.js');
  const groups = require('../js/groups.js');
  const favorites = require('../js/favorites.js');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    exitGroupContext();
  });

  test('dot-tap going available with override ON pushes the going-active combo to favorites', () => {
    db.watchGroupMembers.mockImplementation((_gid, cb) => { cb({}); return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb({ enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#ff00aa', paletteKey: 'forest' });
      return () => {};
    });
    db.watchStatus.mockImplementation((_uid, cb) => { cb({ statusColor: '#000', paletteKey: null }); return () => {}; });
    setupContextDom();
    enterGroupContext('G1', 'me');

    const dot = document.getElementById('group-my-dot');
    dot.click();

    expect(groups.setOverrideStatusAvailable).toHaveBeenCalled();
    expect(favorites.saveCombo).toHaveBeenCalledWith(expect.objectContaining({
      statusColor: '#ff00aa',
      paletteKey: 'forest',
    }));
  });

  test('dot-tap going UNavailable with override ON does NOT push to favorites', () => {
    db.watchGroupMembers.mockImplementation((_gid, cb) => { cb({}); return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa', paletteKey: 'forest' });
      return () => {};
    });
    db.watchStatus.mockImplementation((_uid, cb) => { cb({ statusColor: '#000', paletteKey: null }); return () => {}; });
    setupContextDom();
    enterGroupContext('G1', 'me');

    const dot = document.getElementById('group-my-dot');
    dot.click();

    expect(groups.setOverrideStatusUnavailable).toHaveBeenCalled();
    expect(favorites.saveCombo).not.toHaveBeenCalled();
  });

  test('chip cycle while available does NOT push to favorites', () => {
    db.watchGroupMembers.mockImplementation((_gid, cb) => { cb({}); return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000, statusColor: '#ff00aa', paletteKey: 'forest' });
      return () => {};
    });
    db.watchStatus.mockImplementation((_uid, cb) => { cb({ statusColor: '#000', paletteKey: null }); return () => {}; });
    setupContextDom();
    enterGroupContext('G1', 'me');

    const chip = document.getElementById('group-time-chip');
    chip.click();
    // Chip cycle updates availableUntil but combo is unchanged — not a transition.
    expect(favorites.saveCombo).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and confirm tests fail**

Run: `npx jest tests/groupContext.test.js -t "go available" 2>&1 | tail -15`
Expected: FAIL — `saveCombo` not called at the dot-tap-to-go-available site.

- [ ] **Step 3: Add the call site**

In `js/groupContext.js`, find the dot-tap handler at line ~920 (the `else` branch of the dot-tap handler — where `setOverrideStatusAvailable` is called). Add a `saveCombo` call BEFORE the Firebase write:

```js
      } else {
        const baseMinutes = getGroupChipMinutes(groupId) ?? getLastTimeout();
        const minutes = CHIP_VALUES[chipIndexForMinutes(baseMinutes)].minutes;
        const availableUntil = Date.now() + minutes * 60000;
        _ownOverride = { ..._ownOverride, status: 'available', availableUntil };
        renderOwnStatusRow();
        // Push the going-active combo to favorites — this is a real
        // unavailable→available transition with the user's committed
        // group-effective color + palette.
        saveCombo(buildGroupCombo({
          ownOverride: _ownOverride,
          ownPrimary: _ownPrimary,
          paletteState: getGroupPaletteState(groupId),
        }));
        setOverrideStatusAvailable(groupId, userId, availableUntil).catch(() => {});
      }
```

DO NOT add a `saveCombo` call to the chip-cycle handler at line ~956 — that updates `availableUntil`, not the combo, and is not a transition per the spec.

- [ ] **Step 4: Run tests**

Run: `npx jest tests/groupContext.test.js -t "go available" 2>&1 | tail -10`
Expected: PASS, 3 tests.

Run: `npx jest 2>&1 | tail -5`
Expected: 21 suites passing.

- [ ] **Step 5: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "feat: group dot-tap-to-go-available pushes to favorites

New writer site for the simplified favorites model. When the user
taps the group own-status dot to transition unavailable→available
(override ON), the group-effective combo is built via buildGroupCombo
and pushed via saveCombo. Chip-cycle-while-available does NOT push
(combo unchanged); going-UNavailable does NOT push (no commit event)."
```

---

## Task 6: Simplify `handleHistoryTap` to adopt-only

**Files:**
- Modify: `js/favorites.js`
- Test: `tests/favorites.test.js`

- [ ] **Step 1: Rewrite the `history pill tap interactions` describe block**

In `tests/favorites.test.js`, find the `describe('history pill tap interactions', ...)` block (line ~560). Replace its content with these tests:

```js
describe('history pill tap interactions (adopt-only)', () => {
  let tapHistoryPill, localMocks;
  let trackingState;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
    localMocks = {
      switchSet: jest.fn(),
      enterPaletteMode: jest.fn(),
      exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn((key) => {
        const palettes = {
          forest: { color: '#22c55e', theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226' } },
          iris:   { color: '#818cf8', theme: { bg: '#0c0c1e', surface: '#141432', surface2: '#1d1d47' } },
        };
        return palettes[key] ?? null;
      }),
      getGlowForColor: jest.fn(() => 'rgba(0,0,0,0.4)'),
      setStatusColor: jest.fn().mockResolvedValue(undefined),
      setPaletteState: jest.fn((s) => { trackingState = JSON.parse(JSON.stringify(s)); }),
      getFavorites: jest.fn(() => [
        { statusColor: '#818cf8', surface: '#141432', surface2: '#1d1d47',
          paletteKey: 'iris', selectedKey: 'iris', activeSet: 1 },
      ]),
      setFavorites: jest.fn(),
    };
    trackingState = {
      activeSet: 1,
      sets: { '1': { selectedKey: 'forest', activePaletteKey: null, selectedColor: '#22c55e' },
              '2': { selectedKey: 'volt',   activePaletteKey: null, selectedColor: '#aaff00' } },
    };
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: localMocks.switchSet,
      enterPaletteMode: localMocks.enterPaletteMode,
      exitPaletteMode: localMocks.exitPaletteMode,
      getPaletteByKey: localMocks.getPaletteByKey,
      getGlowForColor: localMocks.getGlowForColor,
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: localMocks.setStatusColor, setUserFavorites: jest.fn().mockResolvedValue(undefined) }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(() => trackingState),
      setPaletteState: localMocks.setPaletteState,
      getFavorites: localMocks.getFavorites,
      setFavorites: localMocks.setFavorites,
    }));
    const { initFavoritesStrip } = require('../js/favorites.js');
    initFavoritesStrip('myUid');
    tapHistoryPill = () => {
      const pill = document.querySelector('.fav-pill[data-type="history"]');
      pill.click();
    };
  });

  test('restores combo selectedKey/selectedColor into palette state', () => {
    tapHistoryPill();
    const lastSet = localMocks.setPaletteState.mock.calls.at(-1)[0];
    expect(lastSet.sets['1'].selectedKey).toBe('iris');
    expect(lastSet.sets['1'].selectedColor).toBe('#818cf8');
  });

  test('calls switchSet with the combo activeSet', () => {
    tapHistoryPill();
    expect(localMocks.switchSet).toHaveBeenCalledWith(1, 'myUid');
  });

  test('calls enterPaletteMode when combo.paletteKey is non-null', () => {
    tapHistoryPill();
    expect(localMocks.enterPaletteMode).toHaveBeenCalledWith('iris', 'myUid');
  });

  test('calls exitPaletteMode when combo.paletteKey is null', () => {
    localMocks.getFavorites.mockReturnValue([
      { statusColor: '#abc', surface: '#000', surface2: '#000',
        paletteKey: null, selectedKey: 'forest', activeSet: 1 },
    ]);
    const { initFavoritesStrip } = require('../js/favorites.js');
    initFavoritesStrip('myUid');
    tapHistoryPill();
    expect(localMocks.exitPaletteMode).toHaveBeenCalledWith('myUid');
  });

  test('calls setStatusColor with the combo statusColor', () => {
    tapHistoryPill();
    expect(localMocks.setStatusColor).toHaveBeenCalledWith('myUid', '#818cf8');
  });

  test('does NOT mutate the favorites strip (no setFavorites call)', () => {
    tapHistoryPill();
    expect(localMocks.setFavorites).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and confirm the new tests fail on the `setFavorites` assertion**

Run: `npx jest tests/favorites.test.js -t "history pill tap interactions" 2>&1 | tail -15`
Expected: the `does NOT mutate the favorites strip` test FAILS because the current implementation calls `writeFavorites([oldSlot, ...newHistory]...)`.

- [ ] **Step 3: Rewrite `handleHistoryTap`**

In `js/favorites.js`, find `handleHistoryTap` (line ~485). Replace the entire function with:

```js
function handleHistoryTap(idx) {
  const combo = getFavorites()[idx];
  if (!combo) return;

  // Restore picker state to reflect this combo.
  const state = JSON.parse(JSON.stringify(getPaletteState()));
  state.sets[String(combo.activeSet)].selectedKey = combo.selectedKey;
  state.sets[String(combo.activeSet)].selectedColor = combo.statusColor;
  setPaletteState(state);

  // Switch set + apply palette/theme.
  switchSet(combo.activeSet, _myUserId);
  if (combo.paletteKey) {
    enterPaletteMode(combo.paletteKey, _myUserId);
  } else {
    exitPaletteMode(_myUserId);
  }

  // Apply canonical status color (overrides what switchSet wrote).
  setStatusColor(_myUserId, combo.statusColor).catch(() => {});
  document.documentElement.style.setProperty('--my-status', combo.statusColor);
  document.documentElement.style.setProperty('--my-glow', getGlowForColor(combo.statusColor));

  // No history mutation, no slot swap, no _lastCommittedCombo update.
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/favorites.test.js -t "history pill tap interactions" 2>&1 | tail -10`
Expected: PASS, 6 tests.

Run: `npx jest 2>&1 | tail -5`
Expected: 21 suites passing, no regressions.

- [ ] **Step 5: Commit**

```bash
git add js/favorites.js tests/favorites.test.js
git commit -m "refactor: handleHistoryTap is adopt-only — no slot swap

Tapping a favorite pill restores the combo into picker state and
applies its statusColor/paletteKey, but no longer mutates the strip
itself. The 'swap displaced slot back into history' flow goes away
because slots are no longer a privileged surface — every entry is
just history."
```

---

## Task 7: Simplify rendering (drop slot pills + slot1/slot2 from gradient)

**Files:**
- Modify: `js/favorites.js`
- Test: `tests/favorites.test.js`

- [ ] **Step 1: Update `renderStrip / initFavoritesStrip` test assertions**

In `tests/favorites.test.js`, find the `describe('renderStrip / initFavoritesStrip', ...)` block (line ~397). Delete the tests that assert slot rendering:

- `'renders slot 1 pill with forest color and slot 2 pill with volt color'` (line ~452) → DELETE
- `'active slot (Set 1 active) has fav-pill--inactive class, slot 2 has fav-pill--active'` (line ~461) → DELETE

Update `'renders history pills with correct left color'` (line ~469) to verify pill count matches history length only (no extra slot pills):

```js
test('renders history pills with correct left color', () => {
  // History has 2 entries → expect exactly 2 pills (no slot pills).
  const history = [
    { statusColor: '#ff00aa', surface: '#111', surface2: '#222', paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 },
    { statusColor: '#00ffaa', surface: '#111', surface2: '#222', paletteKey: 'volt',   selectedKey: 'volt',   activeSet: 2 },
  ];
  // (existing mock setup, with getFavorites returning the above)
  // After initFavoritesStrip with expanded state:
  const pills = document.querySelectorAll('.fav-pill');
  expect(pills.length).toBe(2);
  expect(pills[0].querySelector('.fav-pill-left').style.background).toContain('rgb(255, 0, 170)');
  expect(pills[1].querySelector('.fav-pill-left').style.background).toContain('rgb(0, 255, 170)');
});
```

The `'collapsed state: renders .fav-collapsed gradient line when collapsed'` test (line ~477) probably still passes since it doesn't check exact colors. If it asserts specific gradient stops including slot colors, update it to use only history colors.

- [ ] **Step 2: Run and confirm new/updated tests fail**

Run: `npx jest tests/favorites.test.js -t "renderStrip" 2>&1 | tail -15`
Expected: FAIL — `pills.length` is 4 (2 slots + 2 history) instead of 2.

- [ ] **Step 3: Simplify `renderExpanded`**

In `js/favorites.js`, find `renderExpanded` (line ~280). Replace the entire function with:

```js
function renderExpanded(container, history) {
  const pills = history
    .map((c, i) => renderPill(c, 'history', 'history', i))
    .join('');
  container.innerHTML =
    `<div class="fav-strip">${pills}` +
    `<button class="fav-collapse-btn" aria-label="Collapse">▲</button></div>`;

  // Animate pill width when pill count changes
  const strip = container.querySelector('.fav-strip');
  const pillEls = container.querySelectorAll('.fav-pill');
  const pillCount = pillEls.length;
  const collapseBtn = container.querySelector('.fav-collapse-btn');
  const gap = 6; // matches CSS gap
  const padding = 24; // matches CSS padding (12px each side)
  const btnWidth = collapseBtn ? collapseBtn.offsetWidth + gap : 0;
  const availableWidth = strip.clientWidth - padding - btnWidth;
  const targetWidth = Math.floor((availableWidth - gap * (pillCount - 1)) / pillCount);

  if (_prevPillCount > 0 && pillCount > _prevPillCount) {
    const oldWidth = Math.floor((availableWidth - gap * (_prevPillCount - 1)) / _prevPillCount);
    pillEls.forEach(el => { el.style.width = oldWidth + 'px'; });
    requestAnimationFrame(() => {
      pillEls.forEach(el => { el.style.width = targetWidth + 'px'; });
    });
  } else {
    pillEls.forEach(el => { el.style.width = targetWidth + 'px'; });
  }
  _prevPillCount = pillCount;

  // History pill click handlers — no more slot-pill loop, no more
  // ps/activeSet check.
  container.querySelectorAll('.fav-pill[data-type="history"]').forEach(el => {
    el.addEventListener('click', () => handleHistoryTap(parseInt(el.dataset.index)));
  });
  container.querySelector('.fav-collapse-btn').addEventListener('click', () => {
    setFavoritesCollapsed(true);
    renderStrip();
  });
}
```

Net changes from the current function:
- `const ps = getPaletteState();` — removed (dead after slots go).
- `const slot1 = slotCombo(1); const slot2 = slotCombo(2);` — removed.
- `slotPills` construction — removed.
- `${slotPills}${historyPills}` — replaced with just `${pills}`.
- The slot-pill click-handler `querySelectorAll('.fav-pill[data-type="slot"]')` loop (lines ~320-324) — removed.

- [ ] **Step 4: Simplify `renderCollapsed`**

In `js/favorites.js`, find `renderCollapsed` (line ~228). Replace the colors-array construction at the top:

```js
function renderCollapsed(container, history) {
  const allColors = history.map(c => c.statusColor);
  const n = allColors.length;
  // (rest of function unchanged — gradient construction over allColors, etc.)
```

(Removes `const slot1 = slotCombo(1); const slot2 = slotCombo(2);` and the `[slot1.statusColor, slot2.statusColor, ...]` prefix.)

- [ ] **Step 5: Run tests**

Run: `npx jest tests/favorites.test.js 2>&1 | tail -5`
Expected: all PASS.

Run: `npx jest 2>&1 | tail -5`
Expected: 21 suites passing, no regressions.

- [ ] **Step 6: Commit**

```bash
git add js/favorites.js tests/favorites.test.js
git commit -m "refactor: drop slot-pill rendering — strip is pure history

renderExpanded no longer renders slotCombo(1) + slotCombo(2) before
the history pills. renderCollapsed no longer prepends slot1/slot2
colors to the gradient. The favorites strip now shows up to 8 pills,
all sourced from history. The picker swatch row (#swatch-row /
#group-swatch-row) remains the live workspace; favorites is a pure
history surface."
```

---

## Task 8: Big cleanup — delete dead code, bump cap, rewrite remaining tests

**Files:**
- Modify: `js/favorites.js`
- Test: `tests/favorites.test.js`

This is the largest task. It removes everything that's now dead and bumps the cap.

- [ ] **Step 1: Delete dead test suites first**

In `tests/favorites.test.js`:

- Delete the entire `describe('saveFavorite', ...)` block (~lines 128-394). All 17 tests rely on `saveFavorite` semantics that are gone (force=true / non-forced previous-combo / _lastCommittedCombo). The `saveCombo` suite from Task 1 covers the replacement semantics.
- Delete the entire `describe('slot tap interactions', ...)` block (~lines 506-557). `handleSlotTap` is going away.
- Delete the entire `describe('saveCustomCombo', ...)` block (~lines 893-957). It's been absorbed by `saveCombo`.
- Delete the standalone `test('saveFavorite: does not save when PALETTE_INTERACTIONS_ENABLED is false', ...)` at line ~710. The `saveCombo` suite has the equivalent test.
- Update the `describe('getAllCombos', ...)` block (line ~739): `getAllCombos` now returns just `getFavorites()`, so the tests for slot1/slot2 inclusion no longer apply. Replace with:

```js
describe('getAllCombos', () => {
  let getAllCombos;
  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
    jest.mock('../js/db.js', () => ({}));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getFavorites: jest.fn(() => [
        { statusColor: '#abc', surface: '#000', surface2: '#000', paletteKey: null, selectedKey: 'forest', activeSet: 1 },
        { statusColor: '#def', surface: '#000', surface2: '#000', paletteKey: null, selectedKey: 'volt',   activeSet: 2 },
      ]),
    }));
    ({ getAllCombos } = require('../js/favorites.js'));
  });

  test('returns the favorites array directly', () => {
    const combos = getAllCombos();
    expect(combos.length).toBe(2);
    expect(combos[0].statusColor).toBe('#abc');
    expect(combos[1].statusColor).toBe('#def');
  });
});
```

- [ ] **Step 2: Run remaining tests to confirm they still pass before code surgery**

Run: `npx jest tests/favorites.test.js 2>&1 | tail -5`
Expected: PASS — the surviving suites (`getFavorites/setFavorites`, `renderStrip/initFavoritesStrip`, `history pill tap interactions (adopt-only)`, updated `getAllCombos`, `getCanvasColors`, `saveCombo`) all pass.

If any of these reference deleted helpers indirectly, update or delete them per the failure message.

- [ ] **Step 3: Delete dead code from `js/favorites.js`**

In `js/favorites.js`, delete:

- `slotCombo(setNum)` function (line ~42)
- `slotVisuallyMatches(combo, setNum)` function (line ~70)
- `combosMatch(a, b)` function (line ~59)
- `removeHistoryDuplicatesOfSlots()` exported function (line ~121)
- `handleSlotTap(slotNum)` function (line ~477)
- `_lastCommittedCombo` module-level variable (line ~20)
- `onPaletteStateChanged` listener and its `document.addEventListener('palette-state-changed', ...)` registration (line ~174 and ~189)
- The `_lastCommittedCombo = buildCombo();` line in `initFavoritesStrip` (line ~188)
- The entire `saveFavorite(force = false)` function (line ~133)
- The entire `saveCustomCombo(combo)` function (line ~165)

Update `getAllCombos` (line ~91):

```js
export function getAllCombos() {
  return getFavorites();
}
```

- [ ] **Step 4: Rename `MAX_HISTORY` → `MAX_FAVORITES` and bump value**

Find `const MAX_HISTORY = 6;` (line ~11). Delete it. The `MAX_FAVORITES = 8` constant from Task 1 is the replacement.

Find any remaining `MAX_HISTORY` references in `js/favorites.js` (there may be one in `handleHistoryTap` if not already covered by Task 6). Replace with `MAX_FAVORITES`.

Run: `grep -n "MAX_HISTORY" js/favorites.js`
Expected: no matches.

- [ ] **Step 5: Update the `renderExpanded` pill-sizing reference if needed**

If Task 7 left any reference to the old strip composition (e.g. comments mentioning "2 slot pills + up to 6 history"), update to reflect "up to 8 history pills."

- [ ] **Step 6: Run the full test suite**

Run: `npx jest tests/favorites.test.js 2>&1 | tail -5`
Expected: all PASS.

Run: `npx jest 2>&1 | tail -5`
Expected: 21 suites passing, test count reduced from previous (deleted suites) but stable.

- [ ] **Step 7: Run the dev build**

Run: `node scripts/dev-build.js 2>&1 | tail -3`
Expected: `Build complete: dist/bundle.js + index.html ...`

If the build fails with "module X imports undefined Y" — that's a sign a caller still imports a deleted name. Fix the import and re-run.

Common imports that may still reference deleted exports:
- `removeHistoryDuplicatesOfSlots` (already dropped from `following.js` in Task 3 — verify).
- `saveFavorite` / `saveCustomCombo` from any module — check with: `grep -rn "saveFavorite\|saveCustomCombo" js/ tests/`
- `handleSlotTap` — not exported, no external callers.

- [ ] **Step 8: Commit**

```bash
git add js/favorites.js tests/favorites.test.js
git commit -m "refactor: remove dead code from favorites simplification

Deleted:
- slotCombo, slotVisuallyMatches, combosMatch (slot-derivation helpers)
- handleSlotTap (no slot pills to tap)
- removeHistoryDuplicatesOfSlots (slots no longer privileged)
- _lastCommittedCombo state + onPaletteStateChanged listener (no
  'previous combo' concept anymore)
- saveFavorite (replaced by saveCombo)
- saveCustomCombo (absorbed by saveCombo)
- MAX_HISTORY constant (renamed to MAX_FAVORITES = 8)

Test suites for the deleted functions are also gone — saveCombo suite
from Task 1 covers the replacement semantics. The strip now caps at 8
entries (was 2 slots + 6 history)."
```

---

## Task 9: Final verification + manual checklist

**Files:** No code changes.

- [ ] **Step 1: Run the full test suite**

Run: `npx jest 2>&1 | tail -5`
Expected: `Test Suites: 21 passed, 21 total`. Test count will be lower than the pre-plan count because deleted suites exceed new tests added. Note actual numbers.

- [ ] **Step 2: Run the dev build**

Run: `node scripts/dev-build.js 2>&1 | tail -3`
Expected: `Build complete: dist/bundle.js + index.html ...`

- [ ] **Step 3: Grep for any leftover references to deleted APIs**

```bash
grep -rn "saveFavorite\|saveCustomCombo\|removeHistoryDuplicatesOfSlots\|slotCombo\|slotVisuallyMatches\|handleSlotTap\|MAX_HISTORY\|_lastCommittedCombo" js/ tests/
```

Expected: no matches anywhere. If any remain, those are bugs introduced during the refactor — fix and re-run tests.

- [ ] **Step 4: Manual verification checklist**

Walk through these in the live dev build with real Firebase to verify end-to-end behavior:

1. **Direct go-active first time:** fresh user, pick forest, tap dot to go available. Strip becomes visible with one pill (forest combo).
2. **Direct go-active with same combo twice in a row:** tap dot to go unavailable, then available again with same combo. Strip still has one pill — head dedupe.
3. **Direct go-active with a different combo:** change picker to iris, tap dot. Strip now has two pills, iris at slot 1, forest at slot 2.
4. **Direct adoption:** long-press a mutual with a distinct combo. Strip gets the adopted combo at slot 1. The pre-adoption combo (whatever it was) is gone from the strip unless previously committed.
5. **Tap a favorite pill:** picker updates to that combo (set + swatch + theme); strip is unchanged (same pill order, same count).
6. **Group go-active (override ON):** in a group with override ON, tap own dot to go available. Strip gets the group-effective combo at slot 1.
7. **Group go-active (override OFF):** in a group with override OFF, tap own dot to go available via Direct. Direct's go-active path pushes; group context doesn't double-push.
8. **Group adoption:** long-press a roster member. Strip gets the adopted combo at slot 1.
9. **Chip cycle while available:** in either context, cycle the time chip while available. Strip is unchanged.
10. **Cap at 8:** commit 9 distinct combos in a row. Strip caps at 8; oldest falls off.
11. **Cross-device:** commit on device A; device B's strip updates without reload.

Note any failures inline.

- [ ] **Step 5: Push**

```bash
git push -u origin <branch-name>
```

(Replace `<branch-name>` with the active feature branch.)

---

## Self-review notes

- **Spec coverage:** every locked scope decision in `docs/superpowers/specs/2026-05-29-favorites-simplification-design.md` has a task:
  - Two-writer rule → Tasks 2-5
  - Tap-to-restore adopt-only → Task 6
  - Head-only dedupe + cap 8 → Task 1 + Task 8
  - No "previous combo" → Task 8 deletes `_lastCommittedCombo`
  - Chip cycle doesn't push → Task 5 test
  - Group auto-seed doesn't push → naturally true; auto-seed sets unavailable
  - No schema change → confirmed
  - All dead code removed → Task 8
- **No placeholders:** every step has exact files, exact code or exact deletion targets, exact commands, exact expected output.
- **Type/name consistency:** `saveCombo` used identically across tasks 1-5. `buildCombo` exported from favorites.js (Task 2) and consumed by me.js (Task 2). `buildGroupCombo` already exists from prior work and is consumed by Task 5.
- **Test-mock discipline (HANDOFF §13):** No new `js/db.js` exports. The 5 db-mocking test files don't need touching. Favorites mock updates in `me.test.js`, `following.test.js`, `groupContext.test.js` are covered by Tasks 2/3/4 respectively.
