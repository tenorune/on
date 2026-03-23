# Color Data Architecture Refactoring — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the combo data model with `surface` and `surface2` fields, rename `themeBg` → `surface2`, add `getAllCombos()` and `getCanvasColors()` APIs so any feature can access all 8 favorite combos from a single function call.

**Architecture:** The combo object gains two derived color fields (`surface`, `surface2`) computed from `paletteKey` at save time. Storage structure is unchanged — `statusapp_favorites` stays a flat history array, `statusapp_palette_state` stays picker-UI state. A new `getAllCombos()` function assembles `[slotCombo(1), slotCombo(2), ...getFavorites()]` as the single API for consumers. `getCanvasColors()` extracts unique pen and background colors from that array.

**Tech Stack:** Vanilla JS (ES modules via CommonJS for test compat), Jest + jsdom, localStorage.

**Reference docs:**
- `docs/color-data-refactoring-analysis.md` — full analysis and rationale
- `docs/color-theme-architecture-v0.7.html` — current architecture
- `docs/call-canvas-requirements.md` — what Call Canvas needs from this

---

## Chunk 1: Enrich combo shape, rename themeBg, update all mocks

### Task 1: Add constants for default surface colors

**Files:**
- Modify: `js/favorites.js:7-8`

- [ ] **Step 1: Replace DEFAULT_THEME_BG with three named constants**

In `js/favorites.js`, replace:
```javascript
const DEFAULT_THEME_BG = '#0f172a';
```
with:
```javascript
const DEFAULT_STATUS_COLOR = '#22c55e';  // default green (forest primary)
const DEFAULT_SURFACE  = '#1e293b';      // default slate card bg (--surface)
const DEFAULT_SURFACE2 = '#334155';      // default slate pill bg (--surface2)
```

Note: `DEFAULT_THEME_BG` was `#0f172a` (the `--bg` page background) but was used as both a surface2 fallback in `buildCombo`/`slotCombo` AND a statusColor fallback in `slotCombo` line 42. The statusColor fallback was a latent bug (dark navy as a status dot color). The new constants fix both issues.

- [ ] **Step 2: Update references in buildCombo and slotCombo**

In `buildCombo()` (line 26): replace `DEFAULT_THEME_BG` → `DEFAULT_SURFACE2`
In `slotCombo()` (line 42): replace `DEFAULT_THEME_BG` → `DEFAULT_STATUS_COLOR`
In `slotCombo()` (line 45): replace `DEFAULT_THEME_BG` → `DEFAULT_SURFACE2`

- [ ] **Step 3: Run tests**

Run: `npx jest tests/favorites.test.js --no-coverage`
Expected: All 36 tests pass

- [ ] **Step 4: Commit**

```bash
git add js/favorites.js
git commit -m "refactor: replace DEFAULT_THEME_BG with typed constants for status, surface, surface2"
```

---

### Task 2: Add surface/surface2 fields AND rename themeBg — atomic change

This task adds `surface` and `surface2` to combo objects, removes `themeBg`, and updates all consumers (`pillsLookSame`, `renderPill`) and all test mocks/fixtures in one atomic commit. This prevents an intermediate broken state where combos have the new field names but consumers still reference the old ones.

**Files:**
- Modify: `js/favorites.js:17-31, 33-49, 59-60, 286`
- Modify: `tests/favorites.test.js` (all describe blocks)

- [ ] **Step 1: Update buildCombo() — add surface, surface2, remove themeBg**

```javascript
function buildCombo() {
  const ps = getPaletteState();
  const activeSetKey = String(ps.activeSet);
  const { selectedKey, activePaletteKey } = ps.sets[activeSetKey];
  const palette = activePaletteKey ? getPaletteByKey(activePaletteKey) : null;
  const statusColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--my-status').trim();
  return {
    statusColor,
    surface:  palette?.theme.surface  ?? DEFAULT_SURFACE,
    surface2: palette?.theme.surface2 ?? DEFAULT_SURFACE2,
    paletteKey: activePaletteKey,
    selectedKey,
    activeSet: ps.activeSet,
  };
}
```

- [ ] **Step 2: Update slotCombo() — add surface, surface2, remove themeBg**

```javascript
function slotCombo(setNum) {
  const ps = getPaletteState();
  const setKey = String(setNum);
  const { selectedKey, activePaletteKey } = ps.sets[setKey];
  const statusPalette = getPaletteByKey(selectedKey);
  const themePalette  = activePaletteKey ? getPaletteByKey(activePaletteKey) : null;
  const isActiveSet = ps.activeSet === setNum;
  const statusColor = isActiveSet
    ? getComputedStyle(document.documentElement).getPropertyValue('--my-status').trim()
    : (ps.sets[setKey].selectedColor || statusPalette?.color || DEFAULT_STATUS_COLOR);
  return {
    statusColor,
    surface:  themePalette?.theme.surface  ?? DEFAULT_SURFACE,
    surface2: themePalette?.theme.surface2 ?? DEFAULT_SURFACE2,
    paletteKey: activePaletteKey,
    selectedKey,
    activeSet: setNum,
  };
}
```

- [ ] **Step 3: Update pillsLookSame()**

```javascript
function pillsLookSame(a, b) {
  return a.statusColor === b.statusColor && a.surface2 === b.surface2;
}
```

- [ ] **Step 4: Update renderPill()**

```javascript
function renderPill(combo, state, type, index) {
  return `<div class="fav-pill fav-pill--${state}" data-type="${type}" data-index="${index}">` +
    `<div class="fav-pill-left" style="background:${safeCssColor(combo.statusColor)}"></div>` +
    `<div class="fav-pill-right" style="background:${safeCssColor(combo.surface2)}"></div></div>`;
}
```

- [ ] **Step 5: Update ALL getPaletteByKey mocks in tests to include surface and surface2**

In `tests/favorites.test.js`, every `getPaletteByKey` mock across ALL describe blocks must return `surface` and `surface2` in the theme object. The correct values from `js/palettes.js` are:

```javascript
getPaletteByKey: jest.fn(key => ({
  forest: { color: '#22c55e', theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226' } },
  volt:   { color: '#aaff00', theme: { bg: '#0e1700', surface: '#192500', surface2: '#243600' } },
  iris:   { color: '#818cf8', theme: { bg: '#0c0c1e', surface: '#141432', surface2: '#1d1d47' } },
})[key] ?? null),
```

Apply this to ALL describe blocks: `saveFavorite`, `renderStrip / initFavoritesStrip`, `slot tap interactions`, `history pill tap interactions`.

- [ ] **Step 6: Rename all `themeBg` references in test fixtures to `surface2`**

Find-and-replace `themeBg` → `surface2` in `tests/favorites.test.js`.

**Important value changes:** Every fixture with `surface2: '#0f172a'` (the old DEFAULT_THEME_BG for null-paletteKey combos) must be updated to `'#334155'` (the new DEFAULT_SURFACE2). These occur at approximately lines: 23, 171, 184, 221, 292, 293, 314, 499.

For fixtures with palette-mode combos (e.g., `surface2: '#1d1d47'` for iris, `'#1e1b4b'` for iris bg — but `#1e1b4b` was the old wrong `bg` value used as surface2), check: the fixture should use the palette's actual `theme.surface2`. For iris that's `#1d1d47`. Verify each one.

- [ ] **Step 7: Update test names and assertions for surface2**

Rename:
- `'themeBg uses palette theme.surface2 when paletteKey is set (force=true)'` → `'surface2 uses palette theme.surface2 when paletteKey is set (force=true)'`
- `'themeBg is #0f172a when paletteKey is null (force=true)'` → `'surface2 defaults to #334155 when paletteKey is null (force=true)'`

Update the assertion in the second test:
```javascript
expect(saved.surface2).toBe('#334155');
```

- [ ] **Step 8: Add tests for the new surface field**

```javascript
test('combo includes surface from palette theme when paletteKey is set (force=true)', () => {
  require('../js/store.js').getPaletteState.mockReturnValue({
    activeSet: 1,
    sets: {
      '1': { selectedKey: 'forest', activePaletteKey: 'iris', selectedColor: '#818cf8' },
      '2': { selectedKey: 'volt', activePaletteKey: null, selectedColor: '#aaff00' },
    },
  });
  document.documentElement.style.setProperty('--my-status', '#818cf8');
  saveFavorite(true);
  const { setFavorites } = require('../js/store.js');
  const saved = setFavorites.mock.calls.at(-1)[0][0];
  expect(saved.surface).toBe('#141432');   // iris theme.surface
  expect(saved.surface2).toBe('#1d1d47');  // iris theme.surface2
});

test('combo includes default surface when paletteKey is null (force=true)', () => {
  document.documentElement.style.setProperty('--my-status', '#818cf8');
  saveFavorite(true);
  const { setFavorites } = require('../js/store.js');
  const saved = setFavorites.mock.calls.at(-1)[0][0];
  expect(saved.surface).toBe('#1e293b');   // DEFAULT_SURFACE
  expect(saved.surface2).toBe('#334155');  // DEFAULT_SURFACE2
});
```

- [ ] **Step 9: Run full test suite**

Run: `npx jest tests/favorites.test.js tests/following.test.js --no-coverage`
Expected: All tests pass

- [ ] **Step 10: Commit**

```bash
git add js/favorites.js tests/favorites.test.js
git commit -m "feat: add surface/surface2 to combos, rename themeBg, update all mocks"
```

---

## Chunk 2: Add getAllCombos and getCanvasColors APIs

No migration of old favorites data is needed — existing users' favorites will be naturally replaced as they interact with the palette picker. Old combos lacking `surface`/`surface2` fields will simply render with missing right-half colors until overwritten, which is acceptable.

### Task 3: Add getAllCombos()

**Files:**
- Modify: `js/favorites.js` (add and export function)
- Modify: `tests/favorites.test.js` (add tests)

- [ ] **Step 1: Write failing test**

Add a new describe block in `tests/favorites.test.js`:

```javascript
describe('getAllCombos', () => {
  let getAllCombos, initFavoritesStrip;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(), enterPaletteMode: jest.fn(), exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn(key => ({
        forest: { color: '#22c55e', theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226' } },
        volt:   { color: '#aaff00', theme: { bg: '#0e1700', surface: '#192500', surface2: '#243600' } },
        iris:   { color: '#818cf8', theme: { bg: '#0c0c1e', surface: '#141432', surface2: '#1d1d47' } },
      })[key] ?? null),
      getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined) }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(() => ({
        activeSet: 1,
        sets: {
          '1': { selectedKey: 'forest', activePaletteKey: null },
          '2': { selectedKey: 'volt',   activePaletteKey: null },
        },
      })),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => [
        { statusColor: '#818cf8', surface: '#141432', surface2: '#1d1d47', paletteKey: 'iris', selectedKey: 'iris', activeSet: 1 },
      ]),
      setFavorites: jest.fn(),
    }));
    ({ getAllCombos, initFavoritesStrip } = require('../js/favorites.js'));
  });

  test('returns slot 1, slot 2, then history combos', () => {
    initFavoritesStrip('myUid');
    const combos = getAllCombos();
    expect(combos).toHaveLength(3);
    expect(combos[0].activeSet).toBe(1);
    expect(combos[1].activeSet).toBe(2);
    expect(combos[2].paletteKey).toBe('iris');
  });

  test('all combos have surface and surface2 fields', () => {
    initFavoritesStrip('myUid');
    const combos = getAllCombos();
    combos.forEach(c => {
      expect(c.surface).toBeDefined();
      expect(c.surface2).toBeDefined();
    });
  });

  test('returns only 2 combos when history is empty', () => {
    require('../js/store.js').getFavorites.mockReturnValue([]);
    initFavoritesStrip('myUid');
    expect(getAllCombos()).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/favorites.test.js -t "getAllCombos" --no-coverage`
Expected: FAIL — `getAllCombos` is not exported

- [ ] **Step 3: Implement and export getAllCombos()**

In `js/favorites.js`:

```javascript
export function getAllCombos() {
  return [slotCombo(1), slotCombo(2), ...getFavorites()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/favorites.test.js -t "getAllCombos" --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/favorites.js tests/favorites.test.js
git commit -m "feat: add getAllCombos() — single API for all 8 favorite combos"
```

---

### Task 4: Add getCanvasColors()

**Files:**
- Modify: `js/favorites.js` (add and export function)
- Modify: `tests/favorites.test.js` (add tests)

- [ ] **Step 1: Write failing test**

```javascript
describe('getCanvasColors', () => {
  let getCanvasColors, initFavoritesStrip;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(), enterPaletteMode: jest.fn(), exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn(key => ({
        forest: { color: '#22c55e', theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226' } },
        volt:   { color: '#aaff00', theme: { bg: '#0e1700', surface: '#192500', surface2: '#243600' } },
        iris:   { color: '#818cf8', theme: { bg: '#0c0c1e', surface: '#141432', surface2: '#1d1d47' } },
      })[key] ?? null),
      getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined) }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(() => ({
        activeSet: 1,
        sets: {
          '1': { selectedKey: 'forest', activePaletteKey: null },
          '2': { selectedKey: 'volt',   activePaletteKey: null },
        },
      })),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => [
        { statusColor: '#818cf8', surface: '#141432', surface2: '#1d1d47', paletteKey: 'iris', selectedKey: 'iris', activeSet: 1 },
      ]),
      setFavorites: jest.fn(),
    }));
    ({ getCanvasColors, initFavoritesStrip } = require('../js/favorites.js'));
  });

  test('returns deduplicated pen colors', () => {
    initFavoritesStrip('myUid');
    const { penColors } = getCanvasColors();
    expect(penColors).toContain('#22c55e');
    expect(penColors).toContain('#aaff00');
    expect(penColors).toContain('#818cf8');
    expect(penColors.length).toBe(new Set(penColors).size);
  });

  test('returns deduplicated bg colors', () => {
    initFavoritesStrip('myUid');
    const { bgColors } = getCanvasColors();
    expect(bgColors).toContain('#1e293b');  // default surface (both slots)
    expect(bgColors).toContain('#141432');  // iris surface
    expect(bgColors.length).toBe(new Set(bgColors).size);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/favorites.test.js -t "getCanvasColors" --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement and export getCanvasColors()**

```javascript
export function getCanvasColors() {
  const combos = getAllCombos();
  const penColors = [...new Set(combos.map(c => c.statusColor))];
  const bgColors  = [...new Set(combos.map(c => c.surface))];
  return { penColors, bgColors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/favorites.test.js -t "getCanvasColors" --no-coverage`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx jest tests/favorites.test.js tests/following.test.js --no-coverage`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add js/favorites.js tests/favorites.test.js
git commit -m "feat: add getCanvasColors() for Call Canvas pen/bg color palette"
```

---

### Task 5: Final verification and documentation

**Files:**
- Modify: `docs/color-theme-architecture-v0.7.html`

- [ ] **Step 1: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests pass (ignore pre-existing status.test.js failures)

- [ ] **Step 2: Update architecture doc**

In `docs/color-theme-architecture-v0.7.html`:
1. Update combo shape in section 4.3: replace `themeBg` with `surface` and `surface2`
2. Update field table: add `surface` and `surface2` rows, remove `themeBg` row
3. Add `getAllCombos()` and `getCanvasColors()` to section 8 (File Map) under favorites.js
4. Add `pillsLookSame` description update (now compares `surface2` not `themeBg`)
5. Add changelog entry for this refactoring

- [ ] **Step 3: Commit**

```bash
git add docs/color-theme-architecture-v0.7.html
git commit -m "docs: update architecture doc for surface/surface2 fields and canvas APIs"
```
