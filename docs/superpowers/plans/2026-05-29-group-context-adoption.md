# Group-Context Long-Press Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add long-press-to-adopt-color/palette to the group-context roster, writing the adopted appearance into the per-group `statusOverride` only (no effect on Direct or other groups), with optimistic UI across the own-status row, group-context theme, and the Direct nav-row group-card border.

**Architecture:** New gesture handler in `js/groupContext.js` mirrors Direct's 500ms long-press shape. Writes go through the existing `setOverrideAppearance` (no new RTDB writers). Optimistic UI requires two existing helpers (`applyOptimisticOverride`, `applyEffectivePalette`) plus one new symmetric helper exported from `js/groupNav.js` (`applyOptimisticAppearance`). Favorites push uses a new `saveCustomCombo(combo)` export from `js/favorites.js` so the saved combo reflects the pre-adoption group-effective state (not Direct's state). Gated on this group's override toggle being ON; silent no-op when OFF.

**Tech Stack:** Vanilla ES modules, Firebase RTDB, jest + jsdom. Spec: `docs/superpowers/specs/2026-05-29-group-context-adoption-design.md`. Reference for Direct's gesture shape: `js/following.js:533-560` and `triggerAdoption` at `js/following.js:418-427`.

---

## File structure

| File | Role |
|---|---|
| `js/groupNav.js` | **Modify.** Add new export `applyOptimisticAppearance(groupId, fields)`. |
| `js/favorites.js` | **Modify.** Add new export `saveCustomCombo(combo)` that does the "force push to history" path with a caller-supplied combo. |
| `js/groupContext.js` | **Modify.** Add `buildGroupCombo(groupId, ownOverride, ownPrimary, paletteState)` helper. Add long-press gesture installation to roster row construction. Import the new `applyOptimisticAppearance` and `saveCustomCombo`. |
| `css/app.css` | **Modify.** Add `.adopted-from` rule scoped to `#group-context-root #group-roster li`. |
| `tests/groupNav.test.js` | **Modify.** Test `applyOptimisticAppearance`. |
| `tests/favorites.test.js` | **Modify.** Test `saveCustomCombo`. |
| `tests/groupContext.test.js` | **Modify.** Add `applyOptimisticAppearance: jest.fn()` to the `groupNav` mock. Add `saveCustomCombo: jest.fn()` to a new `favorites` mock. Add adoption suite. |

Files **not** touched: `js/db.js`, `js/groups.js`, `js/prefs.js`, `js/following.js`, `js/me.js`. All required setters exist already (`setOverrideAppearance`, `setGroupPaletteState`, `applyOptimisticOverride`, `applyEffectivePalette`, `markHintSeen('longpress')`).

---

## Task 1: `applyOptimisticAppearance` export in `js/groupNav.js`

Lays down the new symmetric helper before any caller exists. TDD-first.

**Files:**
- Modify: `js/groupNav.js` (add export near `applyServerCurrentContext`).
- Test: `tests/groupNav.test.js`.

- [ ] **Step 1: Add the failing test**

Edit `tests/groupNav.test.js`. Add `applyOptimisticAppearance` to the destructured imports near the top of the file (around line 27):

```js
const {
  initNav, getCurrentContext, navigateToDirect, navigateToGroup,
  onContextChange, applyServerCurrentContext, applyOptimisticAppearance,
} = require('../js/groupNav');
```

Then append a new `describe` block at the end of the file:

```js
describe('applyOptimisticAppearance', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="nav-row"></div>';
    jest.clearAllMocks();
  });

  test('merges statusColor + paletteKey into the internal cache and re-renders the nav row', () => {
    db.watchUserGroups.mockImplementation((_uid, cb) => {
      cb({ G1: { lastVisited: 1 } });
      return () => {};
    });
    db.watchGroupMeta.mockImplementation((_gid, cb) => {
      cb({ name: 'Family', ownerId: 'me' });
      return () => {};
    });
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000 });
      return () => {};
    });
    initNav('me');
    require('../js/groupNav').initNavRow();
    require('../js/groupNav').startCardsRowSubscriptions();

    applyOptimisticAppearance('G1', { statusColor: '#ff00aa', paletteKey: 'forest' });

    const card = document.querySelector('#nav-row [data-group-id="G1"]');
    expect(card).not.toBeNull();
    expect(card.style.borderColor).toBe('rgb(255, 0, 170)');
  });

  test('preserves enabled/status/availableUntil from the existing override entry', () => {
    db.watchUserGroups.mockImplementation((_uid, cb) => {
      cb({ G1: { lastVisited: 1 } });
      return () => {};
    });
    db.watchGroupMeta.mockImplementation((_gid, cb) => {
      cb({ name: 'Family', ownerId: 'me' });
      return () => {};
    });
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb({ enabled: true, status: 'available', availableUntil: 9999999999999, statusColor: '#000000' });
      return () => {};
    });
    initNav('me');
    require('../js/groupNav').initNavRow();
    require('../js/groupNav').startCardsRowSubscriptions();

    applyOptimisticAppearance('G1', { statusColor: '#ff00aa', paletteKey: 'forest' });

    const card = document.querySelector('#nav-row [data-group-id="G1"]');
    expect(card.style.borderColor).toBe('rgb(255, 0, 170)');
    // The group card should remain bordered (i.e. "effectively available" is preserved
    // because enabled/status/availableUntil were not clobbered).
    expect(card.style.borderStyle).not.toBe('none');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest tests/groupNav.test.js -t "applyOptimisticAppearance" 2>&1 | tail -20`
Expected: FAIL with `applyOptimisticAppearance is not a function`.

- [ ] **Step 3: Implement the export**

Edit `js/groupNav.js`. After `applyServerCurrentContext` (~line 71) add:

```js
// Optimistically merge appearance fields (statusColor / paletteKey) into the
// per-group override cache and re-render the nav row. Symmetric counterpart
// to applyOptimisticOverride (which goes groupNav → groupContext); this one
// lets groupContext push appearance changes back into groupNav before the
// Firebase ack so the Direct nav-row group-card border stays in sync.
export function applyOptimisticAppearance(groupId, fields) {
  if (!groupId || !fields) return;
  const existing = _overrideByGroupId[groupId] || {};
  const next = { ...existing };
  if ('statusColor' in fields) next.statusColor = fields.statusColor;
  if ('paletteKey'  in fields) next.paletteKey  = fields.paletteKey;
  _overrideByGroupId[groupId] = next;
  renderNavRow();
}
```

(`renderNavRow` is already defined in this file; check that it's in lexical scope at the new function's position. If it's declared later, move the new export to a location after `renderNavRow` is defined, or use a forward-reference pattern consistent with the rest of the file.)

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest tests/groupNav.test.js -t "applyOptimisticAppearance" 2>&1 | tail -10`
Expected: PASS, 2 tests.

Then run the whole file to confirm no regressions: `npx jest tests/groupNav.test.js 2>&1 | tail -5`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/groupNav.js tests/groupNav.test.js
git commit -m "feat: applyOptimisticAppearance in groupNav for cross-module sync

Symmetric counterpart to applyOptimisticOverride. Lets groupContext
push statusColor/paletteKey changes into groupNav's override cache
and re-render the nav row before Firebase ack, so the Direct nav-row
group-card border stays in sync during adoption."
```

---

## Task 2: `saveCustomCombo` export in `js/favorites.js`

Adds the helper needed to push a pre-built combo to the favorites history. Required because `saveFavorite(true)` builds the combo from Direct's `paletteState`, which is wrong for group-context callers.

**Files:**
- Modify: `js/favorites.js`.
- Test: `tests/favorites.test.js`.

- [ ] **Step 1: Add the failing test**

Edit `tests/favorites.test.js`. After the existing `describe('saveFavorite')` block append:

```js
describe('saveCustomCombo', () => {
  let saveCustomCombo;
  let store;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    // Re-apply the same mock pattern the existing saveFavorite suite uses
    // (favorites.js → prefs.js → store.js; mocking store.js catches the chain).
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(),
      enterPaletteMode: jest.fn(),
      exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn(() => null),
      getGlowForColor: jest.fn(() => '#000'),
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined) }));
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
    ({ saveCustomCombo } = require('../js/favorites.js'));
  });

  test('pushes the supplied combo to history (no dedupe match)', () => {
    const combo = { statusColor: '#ff00aa', surface: '#111', surface2: '#222',
                    paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 };
    saveCustomCombo(combo);
    expect(store.setFavorites).toHaveBeenCalledTimes(1);
    const written = store.setFavorites.mock.calls[0][0];
    expect(written[0]).toEqual(combo);
  });

  test('does not push when an equivalent combo is already at the head of history', () => {
    const combo = { statusColor: '#ff00aa', surface: '#111', surface2: '#222',
                    paletteKey: 'forest', selectedKey: 'forest', activeSet: 1 };
    store.getFavorites.mockReturnValueOnce([combo]);
    saveCustomCombo(combo);
    expect(store.setFavorites).not.toHaveBeenCalled();
  });

  test('is a no-op when feature flags are off', () => {
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: false, PALETTE_INTERACTIONS_ENABLED: false }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getFavorites: jest.fn(() => []),
      setFavorites: jest.fn(),
    }));
    const off = require('../js/store.js');
    const { saveCustomCombo: gated } = require('../js/favorites.js');
    gated({ statusColor: '#fff', surface: '#000', surface2: '#000', paletteKey: null, selectedKey: 'forest', activeSet: 1 });
    expect(off.setFavorites).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest tests/favorites.test.js -t "saveCustomCombo" 2>&1 | tail -20`
Expected: FAIL with `saveCustomCombo is not a function`.

- [ ] **Step 3: Implement the export**

Edit `js/favorites.js`. Find the existing `saveFavorite` function (around line 133) and immediately after it add:

```js
// Force-push a caller-supplied combo to the favorites history. Used by
// group-context adoption, where the relevant "previous combo" is the
// group-effective combo (not Direct's paletteState that buildCombo reads).
// Same dedupe + cap semantics as the force branch of saveFavorite.
export function saveCustomCombo(combo) {
  if (!PALETTES_ENABLED || !PALETTE_INTERACTIONS_ENABLED) return;
  if (!combo) return;
  const history = getFavorites();
  if (history.some(h => pillsLookSame(combo, h))) return;
  writeFavorites([combo, ...history].slice(0, MAX_HISTORY));
  renderStrip();
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest tests/favorites.test.js -t "saveCustomCombo" 2>&1 | tail -10`
Expected: PASS, 3 tests.

Then: `npx jest tests/favorites.test.js 2>&1 | tail -5`
Expected: all tests PASS (no regressions in existing `saveFavorite` suite).

- [ ] **Step 5: Commit**

```bash
git add js/favorites.js tests/favorites.test.js
git commit -m "feat: saveCustomCombo for caller-supplied favorites push

Group-context adoption needs to push the pre-adoption group-effective
combo to favorites history, not Direct's paletteState. Adds a small
exported helper that takes a built combo and force-pushes it with the
same dedupe + cap semantics as saveFavorite(true)."
```

---

## Task 3: `buildGroupCombo` helper in `js/groupContext.js`

Pure function that resolves the user's current group-effective combo (override → primary → forest fallback) into the shape that `saveCustomCombo` expects.

**Files:**
- Modify: `js/groupContext.js` (add helper near the existing palette resolution code around line 533, but keep it pure — no side effects).
- Test: `tests/groupContext.test.js`.

- [ ] **Step 1: Add the failing test**

Edit `tests/groupContext.test.js`. Find the end of the file and append:

```js
describe('buildGroupCombo', () => {
  let buildGroupCombo;

  beforeEach(() => {
    jest.resetModules();
    ({ buildGroupCombo } = require('../js/groupContext.js'));
  });

  test('prefers override.statusColor + override.paletteKey when override is enabled', () => {
    const combo = buildGroupCombo({
      ownOverride: { enabled: true, statusColor: '#ff00aa', paletteKey: 'forest' },
      ownPrimary:  { statusColor: '#000', paletteKey: 'volt' },
      paletteState: { activeSet: 2, sets: { '1': { selectedKey: 'forest' }, '2': { selectedKey: 'volt' } } },
    });
    expect(combo.statusColor).toBe('#ff00aa');
    expect(combo.paletteKey).toBe('forest');
    expect(combo.activeSet).toBe(2);
    expect(combo.selectedKey).toBe('volt');
  });

  test('falls back to primary when override.statusColor is missing', () => {
    const combo = buildGroupCombo({
      ownOverride: { enabled: true, statusColor: null, paletteKey: null },
      ownPrimary:  { statusColor: '#abc123', paletteKey: 'volt' },
      paletteState: { activeSet: 1, sets: { '1': { selectedKey: 'forest' }, '2': { selectedKey: 'volt' } } },
    });
    expect(combo.statusColor).toBe('#abc123');
    expect(combo.paletteKey).toBe('volt');
  });

  test('falls back to forest #22c55e when neither override nor primary has a color', () => {
    const combo = buildGroupCombo({
      ownOverride: null,
      ownPrimary: null,
      paletteState: { activeSet: 1, sets: { '1': { selectedKey: 'forest' }, '2': { selectedKey: 'volt' } } },
    });
    expect(combo.statusColor).toBe('#22c55e');
    expect(combo.paletteKey).toBe(null);
  });
});
```

This requires `buildGroupCombo` to be exported. The test runs without the `jest.mock` block at the top of `tests/groupContext.test.js` interfering because `jest.resetModules()` doesn't reset mocks themselves — only the cache. The existing mocks (`groupNav`, `groups`, etc.) still apply, but `buildGroupCombo` is a pure function that doesn't touch them.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest tests/groupContext.test.js -t "buildGroupCombo" 2>&1 | tail -20`
Expected: FAIL with `buildGroupCombo is not a function`.

- [ ] **Step 3: Implement the helper**

Edit `js/groupContext.js`. Near the bottom of the file (just before the last `export` if any, or at the end) add:

```js
// Pure helper. Resolves the user's current group-effective combo into the
// shape favorites.js expects. Used by adoption to push the pre-adoption
// combo to history before mutating the override.
export function buildGroupCombo({ ownOverride, ownPrimary, paletteState }) {
  const overrideOn = !!ownOverride?.enabled;
  const statusColor =
    (overrideOn && ownOverride?.statusColor) ||
    ownPrimary?.statusColor ||
    '#22c55e';
  const paletteKey =
    (overrideOn && ownOverride?.paletteKey != null ? ownOverride.paletteKey : null) ??
    (ownPrimary?.paletteKey ?? null);
  const palette = paletteKey ? getPaletteByKey(paletteKey) : null;
  const activeSet = paletteState?.activeSet ?? 1;
  const activeSetKey = String(activeSet);
  const selectedKey = paletteState?.sets?.[activeSetKey]?.selectedKey ?? 'forest';
  return {
    statusColor,
    surface:  palette?.theme?.surface  ?? null,
    surface2: palette?.theme?.surface2 ?? null,
    paletteKey,
    selectedKey,
    activeSet,
  };
}
```

`getPaletteByKey` is already imported at the top of the file (`palettes.js`).

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest tests/groupContext.test.js -t "buildGroupCombo" 2>&1 | tail -10`
Expected: PASS, 3 tests.

Then: `npx jest tests/groupContext.test.js 2>&1 | tail -5`
Expected: all PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "feat: buildGroupCombo helper for adoption's pre-write favorites push

Pure function that resolves override → primary → forest fallback into
the combo shape that favorites.js's saveCustomCombo accepts. Used by
adoption to push the pre-adoption group-effective combo to history
before mutating the override."
```

---

## Task 4: Add `applyOptimisticAppearance` + `saveCustomCombo` mocks to `tests/groupContext.test.js`

Prerequisite for the adoption tests in Task 5. Per HANDOFF §13: new exports consumed by `groupContext.js` need mocks added to the modules that `groupContext.test.js` mocks.

**Files:**
- Modify: `tests/groupContext.test.js`.

- [ ] **Step 1: Edit the existing mock blocks**

In `tests/groupContext.test.js`, find the `jest.mock('../js/groupNav.js', ...)` block (~line 44) and add the new stub:

```js
jest.mock('../js/groupNav.js', () => ({
  navigateToDirect: jest.fn().mockResolvedValue(undefined),
  getCurrentContext: jest.fn(() => ({ context: 'group', groupId: 'G1' })),
  applyOptimisticAppearance: jest.fn(),
}));
```

Add a new `favorites.js` mock right after the existing `groups.js` mock block:

```js
jest.mock('../js/favorites.js', () => ({
  saveCustomCombo: jest.fn(),
}));
```

Add a `prefs.js` mock alongside (groupContext imports `isHintSeen`, `markHintSeen`, `getGroupPaletteState`, `setGroupPaletteState` from it; the new adoption flow uses the hint helpers and groupPaletteState helpers):

```js
jest.mock('../js/prefs.js', () => ({
  isHintSeen: jest.fn(() => false),
  markHintSeen: jest.fn(),
  getGroupPaletteState: jest.fn(() => ({
    activeSet: 1,
    sets: {
      '1': { selectedKey: 'forest', selectedColor: '#22c55e', activePaletteKey: null },
      '2': { selectedKey: 'volt',   selectedColor: '#aaff00', activePaletteKey: null },
    },
  })),
  setGroupPaletteState: jest.fn(),
}));
```

(If `groupContext.js` imports additional helpers from `prefs.js` that the existing roster-render tests depend on, add `jest.fn()` stubs for those too — verify by running the suite after Step 2 and adding any missing names that come up as `undefined is not a function`.)

- [ ] **Step 2: Confirm the rest of the suite still passes**

Run: `npx jest tests/groupContext.test.js 2>&1 | tail -5`
Expected: all PASS (the mocks are additive; no existing behavior depends on them).

- [ ] **Step 3: Commit**

```bash
git add tests/groupContext.test.js
git commit -m "test: stub applyOptimisticAppearance + saveCustomCombo for adoption tests"
```

---

## Task 5: Long-press gesture installation on roster rows

Wire the gesture handler into the roster row construction in `groupContext.js`. Mirror Direct's 500ms shape (`js/following.js:533-560`) — same timing, same suppress-next-click pattern, same 8px move threshold.

**Files:**
- Modify: `js/groupContext.js` (extend the roster row construction block around line 130 and add a `triggerGroupAdoption` function below it).
- Test: `tests/groupContext.test.js`.

- [ ] **Step 1: Add the failing test — gate behavior**

Append to `tests/groupContext.test.js`:

```js
describe('group-context long-press adoption', () => {
  const db = require('../js/db.js');
  const groups = require('../js/groups.js');
  const groupNav = require('../js/groupNav.js');
  const favorites = require('../js/favorites.js');
  const knock = require('../js/knock.js');
  const prefs = require('../js/prefs.js');

  function setupRoster({ ownOverrideEnabled, members }) {
    db.watchGroupMembers.mockImplementation((_gid, cb) => {
      cb(members);
      return () => {};
    });
    db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
      cb(ownOverrideEnabled
        ? { enabled: true, status: 'available', availableUntil: Date.now() + 60000 }
        : { enabled: false, status: null });
      return () => {};
    });
    db.watchStatus.mockImplementation((uid, cb) => {
      cb({ status: 'available', statusColor: '#ff00aa', paletteKey: 'forest' });
      return () => {};
    });
    setupContextDom();
    enterGroupContext('G1', 'me');
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    exitGroupContext();
  });

  test('long-press is a no-op when this group override is OFF', () => {
    setupRoster({
      ownOverrideEnabled: false,
      members: { src: { displayName: 'Alice' } },
    });
    const li = document.querySelector('#group-roster li[data-user-id="src"]');
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    jest.advanceTimersByTime(600);
    expect(groups.setOverrideAppearance).not.toHaveBeenCalled();
    expect(groupNav.applyOptimisticAppearance).not.toHaveBeenCalled();
    expect(favorites.saveCustomCombo).not.toHaveBeenCalled();
  });

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
    expect(favorites.saveCustomCombo).toHaveBeenCalled();
  });

  test('movement > 8px cancels the long-press', () => {
    setupRoster({
      ownOverrideEnabled: true,
      members: { src: { displayName: 'Alice' } },
    });
    const li = document.querySelector('#group-roster li[data-user-id="src"]');
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    li.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 0 }));
    jest.advanceTimersByTime(600);
    expect(groups.setOverrideAppearance).not.toHaveBeenCalled();
  });

  test('short tap (pointerup before timer) fires knock, not adopt', () => {
    setupRoster({
      ownOverrideEnabled: true,
      members: { src: { displayName: 'Alice' } },
    });
    const li = document.querySelector('#group-roster li[data-user-id="src"]');
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    jest.advanceTimersByTime(200);
    li.dispatchEvent(new PointerEvent('pointerup', { clientX: 0, clientY: 0 }));
    li.click();
    jest.advanceTimersByTime(400);
    expect(groups.setOverrideAppearance).not.toHaveBeenCalled();
    expect(knock.sendKnock).toHaveBeenCalled();
  });
});
```

Note: the test file's existing top-of-file `jest.mock(...)` declarations cover `groupNav`, `groups`, `favorites`, `db`, `knock`, etc. Add mocks for any module the test references that isn't already mocked.

- [ ] **Step 2: Run and confirm it fails**

Run: `npx jest tests/groupContext.test.js -t "long-press adoption" 2>&1 | tail -25`
Expected: FAIL (all four tests fail because the gesture isn't installed yet).

- [ ] **Step 3: Implement the gesture installation**

Edit `js/groupContext.js`. Add the imports at the top (find the existing import lines around 10-24):

```js
import { applyOptimisticAppearance } from './groupNav.js';
import { saveCustomCombo } from './favorites.js';
import { isHintSeen, markHintSeen, getGroupPaletteState, setGroupPaletteState } from './prefs.js';
import { PALETTE_INTERACTIONS_ENABLED } from './features.js';
```

(Check existing imports — most of these names will already be imported; merge into the existing import statements, don't duplicate.)

In the roster row construction block (around line 130, just after the existing `if (KNOCK_ENABLED) { ... }` block) add:

```js
if (PALETTES_ENABLED && PALETTE_INTERACTIONS_ENABLED && uid !== ownUserId) {
  let pressTimer = null;
  let pressStartX, pressStartY;
  let suppressNextClick = false;

  li.addEventListener('pointerdown', (e) => {
    if (!_ownOverride?.enabled) return;
    clearTimeout(pressTimer); pressTimer = null;
    pressStartX = e.clientX;
    pressStartY = e.clientY;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      suppressNextClick = true;
      triggerGroupAdoption(uid, ownUserId);
    }, 500);
  });
  li.addEventListener('pointermove', (e) => {
    if (pressTimer && (Math.abs(e.clientX - pressStartX) > 8 ||
                       Math.abs(e.clientY - pressStartY) > 8)) {
      clearTimeout(pressTimer); pressTimer = null;
    }
  });
  ['pointerup', 'pointercancel'].forEach(ev =>
    li.addEventListener(ev, () => { clearTimeout(pressTimer); pressTimer = null; })
  );
  li.addEventListener('click', (e) => {
    if (suppressNextClick) { suppressNextClick = false; e.stopImmediatePropagation(); }
  }, true);
}
```

Below the existing roster rendering function, add `triggerGroupAdoption`:

```js
function triggerGroupAdoption(srcUid, ownUid) {
  const groupId = _currentGroupId;
  if (!groupId || !_ownOverride?.enabled) return;

  // 1. Source resolution: override-then-primary-then-forest-fallback.
  // _membersOverrides is a plain object keyed by uid; _memberPrimaries is a Map.
  const srcOverride = _membersOverrides?.[srcUid] || null;
  const srcPrimary  = _memberPrimaries?.get(srcUid) || null;
  let adoptedColor, adoptedPaletteKey;
  if (srcOverride?.enabled && srcOverride.statusColor) {
    adoptedColor      = srcOverride.statusColor;
    adoptedPaletteKey = srcOverride.paletteKey ?? null;
  } else {
    adoptedColor      = srcPrimary?.statusColor ?? '#22c55e';
    adoptedPaletteKey = srcPrimary?.paletteKey ?? null;
  }

  // 2. Pre-adoption favorites push (group-effective combo).
  const preCombo = buildGroupCombo({
    ownOverride:  _ownOverride,
    ownPrimary:   _ownPrimary,
    paletteState: getGroupPaletteState(groupId),
  });
  saveCustomCombo(preCombo);

  // 3. Optimistic local mutation.
  const newOverride = { ..._ownOverride, statusColor: adoptedColor, paletteKey: adoptedPaletteKey };
  applyOptimisticOverride(newOverride);   // _ownOverride + renderOwnStatusRow
  applyEffectivePalette();                // CSS vars in group context
  applyOptimisticAppearance(groupId, { statusColor: adoptedColor, paletteKey: adoptedPaletteKey });

  // 4. Picker mirror.
  const state = getGroupPaletteState(groupId);
  const setKey = String(state.activeSet);
  if (adoptedPaletteKey) {
    const setNum = PALETTE_SETS[2].some(p => p.key === adoptedPaletteKey) ? 2 : 1;
    const tgtKey = String(setNum);
    state.activeSet = setNum;
    state.sets[tgtKey].selectedKey       = adoptedPaletteKey;
    state.sets[tgtKey].selectedColor     = adoptedColor;
    state.sets[tgtKey].activePaletteKey  = adoptedPaletteKey;
  } else {
    let matched = null;
    for (const sn of ['1', '2']) {
      const found = PALETTE_SETS[Number(sn)].find(p => p.color === adoptedColor);
      if (found) { matched = { set: sn, key: found.key }; break; }
    }
    if (matched) {
      state.activeSet = Number(matched.set);
      state.sets[matched.set].selectedKey      = matched.key;
      state.sets[matched.set].selectedColor    = adoptedColor;
      state.sets[matched.set].activePaletteKey = null;
    } else {
      state.sets[setKey].selectedColor    = adoptedColor;
      state.sets[setKey].activePaletteKey = null;
    }
  }
  setGroupPaletteState(groupId, state);

  // 5. Firebase write (fire-and-forget).
  setOverrideAppearance(groupId, ownUid, { statusColor: adoptedColor, paletteKey: adoptedPaletteKey })
    .catch(() => {});

  // 6. Hint flag.
  if (!isHintSeen('longpress')) markHintSeen('longpress');

  // 7. Visual flash on the source row.
  const srcLi = document.querySelector(`#group-roster li[data-user-id="${srcUid}"]`);
  if (srcLi) {
    srcLi.classList.add('adopted-from');
    setTimeout(() => srcLi.classList.remove('adopted-from'), 800);
  }
}
```

(Confirm the names `_currentGroupId`, `_ownOverride`, `_ownPrimary`, `_membersOverrides`, `_memberPrimaries`, `applyOptimisticOverride`, `applyEffectivePalette`, `setOverrideAppearance`, `PALETTE_SETS` are all in scope at the new function's location. If not, hoist or import as needed.)

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx jest tests/groupContext.test.js -t "long-press adoption" 2>&1 | tail -20`
Expected: PASS, 4 tests.

Run the full file: `npx jest tests/groupContext.test.js 2>&1 | tail -5`
Expected: all PASS.

Run the full suite: `npx jest 2>&1 | tail -5`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "feat: long-press adoption in group-context roster

500ms press-and-hold on any other member's row adopts their effective-
in-this-group color + palette into the user's own statusOverride for
this group only. Gated on this group's override being ON; silent no-op
when OFF. Wires the optimistic path: applyOptimisticOverride +
applyEffectivePalette + applyOptimisticAppearance (groupNav) so the
own-status row, group-context theme, and Direct nav-row group-card
border all update before Firebase ack. Picker mirrors the adopted
combo via setGroupPaletteState. Pre-adoption combo pushed to favorites
via saveCustomCombo. Mirrors Direct's 500ms / 8px-move-cancel /
suppress-next-click gesture shape."
```

---

## Task 6: Source-resolution coverage tests

The gesture-arbitration tests in Task 5 used a simple `paletteKey: 'forest'` source. Cover the rest of the source-resolution branches.

**Files:**
- Test: `tests/groupContext.test.js`.

- [ ] **Step 1: Add the tests**

Append to the existing `describe('group-context long-press adoption', ...)` block from Task 5. These tests share the same `beforeEach`/`afterEach` (fake timers + clearAllMocks) and the same describe-level `const db = require('../js/db.js')` etc. declarations.

```js
test('source uses override.statusColor when override is enabled', () => {
  db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
    cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000 });
    return () => {};
  });
  db.watchGroupMembers.mockImplementation((_gid, cb) => {
    cb({ src: { displayName: 'Alice', statusOverride: { enabled: true, statusColor: '#aa00ff', paletteKey: 'volt' } } });
    return () => {};
  });
  db.watchStatus.mockImplementation((uid, cb) => {
    cb({ statusColor: '#000', paletteKey: 'forest' });   // primary, but override wins
    return () => {};
  });
  setupContextDom();
  enterGroupContext('G1', 'me');
  const li = document.querySelector('#group-roster li[data-user-id="src"]');
  li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
  jest.advanceTimersByTime(600);
  expect(groups.setOverrideAppearance).toHaveBeenCalledWith('G1', 'me',
    { statusColor: '#aa00ff', paletteKey: 'volt' });
});

test('source falls back to primary when override is disabled or missing color', () => {
  db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
    cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000 });
    return () => {};
  });
  db.watchGroupMembers.mockImplementation((_gid, cb) => {
    cb({ src: { displayName: 'Alice' } });   // no override
    return () => {};
  });
  db.watchStatus.mockImplementation((uid, cb) => {
    cb({ statusColor: '#abcdef', paletteKey: 'forest' });
    return () => {};
  });
  setupContextDom();
  enterGroupContext('G1', 'me');
  const li = document.querySelector('#group-roster li[data-user-id="src"]');
  li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
  jest.advanceTimersByTime(600);
  expect(groups.setOverrideAppearance).toHaveBeenCalledWith('G1', 'me',
    { statusColor: '#abcdef', paletteKey: 'forest' });
});

test('source falls back to forest #22c55e when neither override nor primary has a color', () => {
  db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
    cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000 });
    return () => {};
  });
  db.watchGroupMembers.mockImplementation((_gid, cb) => {
    cb({ src: { displayName: 'Alice' } });
    return () => {};
  });
  db.watchStatus.mockImplementation((uid, cb) => {
    cb({});   // no statusColor, no paletteKey
    return () => {};
  });
  setupContextDom();
  enterGroupContext('G1', 'me');
  const li = document.querySelector('#group-roster li[data-user-id="src"]');
  li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
  jest.advanceTimersByTime(600);
  expect(groups.setOverrideAppearance).toHaveBeenCalledWith('G1', 'me',
    { statusColor: '#22c55e', paletteKey: null });
});

test('marks longpress hint seen on first adoption', () => {
  prefs.isHintSeen.mockReturnValue(false);
  db.watchOwnMemberOverride.mockImplementation((_gid, _uid, cb) => {
    cb({ enabled: true, status: 'available', availableUntil: Date.now() + 60000 });
    return () => {};
  });
  db.watchGroupMembers.mockImplementation((_gid, cb) => {
    cb({ src: { displayName: 'Alice' } });
    return () => {};
  });
  db.watchStatus.mockImplementation((uid, cb) => {
    cb({ statusColor: '#abc', paletteKey: null });
    return () => {};
  });
  setupContextDom();
  enterGroupContext('G1', 'me');
  const li = document.querySelector('#group-roster li[data-user-id="src"]');
  li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
  jest.advanceTimersByTime(600);
  expect(prefs.markHintSeen).toHaveBeenCalledWith('longpress');
});
```

- [ ] **Step 2: Run and confirm they pass**

Run: `npx jest tests/groupContext.test.js -t "long-press adoption" 2>&1 | tail -10`
Expected: PASS, all tests in the suite.

- [ ] **Step 3: Commit**

```bash
git add tests/groupContext.test.js
git commit -m "test: source-resolution + hint-flag coverage for group-context adoption"
```

---

## Task 7: `.adopted-from` flash CSS

Adds the visual flash on the source row, mirroring Direct's affordance.

**Files:**
- Modify: `css/app.css`.

- [ ] **Step 1: Find Direct's rule**

Run: `grep -n "adopted-from" css/app.css`
Expected: one or more matches showing the existing rule used by Direct.

- [ ] **Step 2: Add a group-context-scoped variant**

If Direct's existing `.adopted-from` rule is global (matches both contexts naturally because the class name is the same), no change is needed — the rule already applies to any element with `.adopted-from`. **Verify with a manual test:** in the dev build, long-press a group-context roster row and confirm the flash plays. If it does, skip Steps 3–4 and go to Step 5.

If Direct's rule is scoped to `#main-ui-direct ...` or similar, add a sibling rule scoped to group context. Find Direct's rule, copy it, change the scope selector:

```css
#group-context-root #group-roster li.adopted-from {
  /* paste Direct's flash properties here, e.g. animation: adopt-flash 800ms; */
}
```

- [ ] **Step 3: Run the build to confirm no CSS errors**

Run: `node scripts/dev-build.js 2>&1 | tail -3`
Expected: `Build complete: dist/bundle.js + index.html ...`

- [ ] **Step 4: Commit**

```bash
git add css/app.css
git commit -m "style: .adopted-from flash on group-context roster rows"
```

(If no changes were needed — Step 2's verification showed Direct's rule already applies — skip the commit and proceed to Task 8.)

---

## Task 8: Manual verification + final test + build

End-to-end sanity check.

**Files:**
- No code changes.

- [ ] **Step 1: Run the full test suite**

Run: `npx jest 2>&1 | tail -5`
Expected: `Test Suites: 21 passed, 21 total`, `Tests: <N> passed` where N has grown by ~12 (4 gate + 4 source + 2 applyOptimisticAppearance + 3 saveCustomCombo + 3 buildGroupCombo).

- [ ] **Step 2: Run the dev build**

Run: `node scripts/dev-build.js 2>&1 | tail -3`
Expected: `Build complete: dist/bundle.js + index.html (title: "On - Dev", using .env.local)`.

- [ ] **Step 3: Walk through the spec's manual verification checklist**

From `docs/superpowers/specs/2026-05-29-group-context-adoption-design.md` "Manual verification":

1. Group context, override OFF: long-press → no-op.
2. Group context, override ON, source with primary statusColor: long-press → dot adopts, theme shifts, picker updates.
3. Same as (2) but source has paletteKey: paletteKey adopts too.
4. Adopt A then B: combo shows B's; favorites strip has pre-A combo.
5. Adopt while unavailable: settings update, dot stays muted, lights up on go-available.
6. Adopt → toggle OFF → toggle ON: adopted color/palette persist.
7. Adopt on Device A → Device B sees new color/palette without reload.
8. Adopt on Device A → other members in the group see the new color in their roster.
9. Nav-row group card border adopts new color in the same frame.
9a. Toggle OFF reverts the card to primary; toggle ON restores adopted.
10. `longpress` hint flag marked seen on first group-context adoption.

Note any failures inline and fix before declaring complete. If a manual step fails, return to the relevant task.

- [ ] **Step 4: Final push**

```bash
git push -u origin claude/wonderful-heisenberg-fRek8
```

---

## Self-review notes

- **Spec coverage:** Every locked scope decision in `docs/superpowers/specs/2026-05-29-group-context-adoption-design.md` has a task: gate (Task 5), source (Task 6), what gets adopted (Task 6), write target (Task 5 + uses Task 1's helper), picker mirroring (Task 5), favorites (Tasks 2 + 5), hint flag (Task 6), gesture timing (Task 5), optimistic update (Tasks 1 + 5).
- **No placeholders:** Each step lists exact files, exact code, exact commands, and expected output.
- **Type consistency:** `applyOptimisticAppearance(groupId, fields)` used identically in Tasks 1, 4, 5. `saveCustomCombo(combo)` used identically in Tasks 2, 4, 5. `buildGroupCombo({ ownOverride, ownPrimary, paletteState })` used identically in Tasks 3, 5.
- **HANDOFF §13 test-mock discipline:** No new `js/db.js` exports, so the 5 db-mocking test files don't need touching. Task 4 covers the `groupNav.js` and `favorites.js` mocks in `tests/groupContext.test.js`.
- **HANDOFF §15 stale note:** Out-of-scope here, but the spec's open follow-ups call it out for a later doc-only commit.
