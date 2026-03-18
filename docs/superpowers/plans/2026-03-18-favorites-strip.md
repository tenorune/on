# Favorites Strip Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a horizontally-scrollable strip of two-color pills between the status bar and the people list, letting users recall saved palette+status-color combinations.

**Architecture:** A new `js/favorites.js` module owns all strip state, rendering, and interaction. It exposes two public functions: `saveFavorite()` (called by `me.js` and `following.js`) and `initFavoritesStrip(myUserId)` (called by `app.js`). `store.js` gets two new helpers for the `statusapp_favorites` localStorage key. The adoption revert machinery in `following.js` is removed; recovery is now via the strip.

**Tech Stack:** Vanilla JS ES modules, Jest + jsdom for tests, localStorage, existing `palettes.js` API (`switchSet`, `enterPaletteMode`, `exitPaletteMode`, `getPaletteByKey`, `getGlowForColor`).

**Spec:** `docs/superpowers/specs/2026-03-18-favorites-strip-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `js/store.js` | Modify | Add `getFavorites` / `setFavorites` helpers |
| `js/favorites.js` | Create | All favorites logic: save, dedup, render, interact |
| `js/following.js` | Modify | Call `saveFavorite` in `triggerAdoption`; remove revert machinery |
| `js/me.js` | Modify | Call `saveFavorite` in `setAvailable` (guarded) |
| `js/app.js` | Modify | Import and call `initFavoritesStrip` |
| `index.html` | Modify | Add `<div id="favorites-strip">` between header and main |
| `css/app.css` | Modify | Strip, pill, and collapsed-line styles |
| `tests/favorites.test.js` | Create | All favorites unit tests |
| `tests/following.test.js` | Modify | Update adoption tests for removed revert logic |

---

## Chunk 1: Data Layer

### Task 1: Store helpers — `getFavorites` / `setFavorites`

**Files:**
- Modify: `js/store.js`
- Create: `tests/favorites.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/favorites.test.js` with this exact content:

```js
// tests/favorites.test.js

// ─── Store helpers ──────────────────────────────────────────────────────────
// These tests use the REAL store implementation with jsdom localStorage.
// They must be in a describe block that requires the module fresh each time.

describe('getFavorites / setFavorites', () => {
  let getFavorites, setFavorites;

  beforeEach(() => {
    localStorage.clear();
    jest.resetModules();
    ({ getFavorites, setFavorites } = require('../js/store.js'));
  });

  test('returns empty array when nothing stored', () => {
    expect(getFavorites()).toEqual([]);
  });

  test('round-trips an array of combo objects', () => {
    const data = [
      { statusColor: '#22c55e', themeBg: '#0f172a', paletteKey: null, selectedKey: 'forest', activeSet: 1 },
    ];
    setFavorites(data);
    expect(getFavorites()).toEqual(data);
  });

  test('returns empty array when stored value is corrupt JSON', () => {
    localStorage.setItem('statusapp_favorites', '{bad json');
    expect(getFavorites()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
npx jest tests/favorites.test.js --no-coverage
```
Expected: `getFavorites is not a function` or similar.

- [ ] **Step 3: Implement `getFavorites` / `setFavorites` in `store.js`**

Add after the `setPaletteState` function (before `getPalette`):

```js
const FAVORITES_KEY = 'statusapp_favorites';

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
  } catch (_) { return []; }
}

function setFavorites(arr) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(arr));
}
```

Add `getFavorites, setFavorites` to `module.exports`.

- [ ] **Step 4: Run — verify PASS**

```bash
npx jest tests/favorites.test.js --no-coverage
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add js/store.js tests/favorites.test.js
git commit -m "feat: add getFavorites/setFavorites to store"
```

---

### Task 2: `saveFavorite` — core save logic in `favorites.js`

**Files:**
- Create: `js/favorites.js`
- Modify: `tests/favorites.test.js`

- [ ] **Step 1: Add mock setup + failing `saveFavorite` tests to `tests/favorites.test.js`**

Append to `tests/favorites.test.js` (after the store describe block):

```js
// ─── favorites.js tests ─────────────────────────────────────────────────────

jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true }));

jest.mock('../js/palettes.js', () => ({
  ...jest.requireActual('../js/palettes.js'),
  switchSet: jest.fn(),
  enterPaletteMode: jest.fn(),
  exitPaletteMode: jest.fn(),
  getPaletteByKey: jest.fn(),
  getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
}));

jest.mock('../js/db.js', () => ({
  setStatusColor: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../js/store.js', () => ({
  ...jest.requireActual('../js/store.js'),
  getPaletteState: jest.fn(),
  setPaletteState: jest.fn(),
  getFavorites: jest.fn(() => []),
  setFavorites: jest.fn(),
}));

// Default palette mock
const FOREST_PALETTE = { color: '#22c55e', theme: { bg: '#052e16' } };
const VOLT_PALETTE   = { color: '#aaff00', theme: { bg: '#1a2a00' } };
const IRIS_PALETTE   = { color: '#818cf8', theme: { bg: '#1e1b4b' } };

function defaultPaletteByKey(key) {
  return { forest: FOREST_PALETTE, volt: VOLT_PALETTE, iris: IRIS_PALETTE }[key] ?? null;
}

function defaultPaletteState() {
  return {
    activeSet: 1,
    sets: {
      '1': { selectedKey: 'forest', activePaletteKey: null },
      '2': { selectedKey: 'volt',   activePaletteKey: null },
    },
  };
}

function setupDom() {
  document.body.innerHTML = '<div id="favorites-strip"></div>';
  document.documentElement.style.setProperty('--my-status', '#22c55e');
  document.documentElement.style.setProperty('--my-glow', 'rgba(34,197,94,0.4)');
}

describe('saveFavorite', () => {
  let saveFavorite;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    // Re-apply mocks after resetModules
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(),
      enterPaletteMode: jest.fn(),
      exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn(defaultPaletteByKey),
      getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined) }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(defaultPaletteState),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => []),
      setFavorites: jest.fn(),
    }));
    ({ saveFavorite } = require('../js/favorites.js'));
  });

  test('does not save when combo matches slot 1 (all 4 fields match)', () => {
    // --my-status = '#22c55e' = forest color, selectedKey = 'forest', activeSet = 1
    // slot 1 statusColor = getPaletteByKey('forest').color = '#22c55e' → match
    saveFavorite();
    const { setFavorites } = require('../js/store.js');
    expect(setFavorites).not.toHaveBeenCalled();
  });

  test('does not save when combo matches slot 2', () => {
    require('../js/store.js').getPaletteState.mockReturnValue({
      activeSet: 2,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null },
        '2': { selectedKey: 'volt',   activePaletteKey: null },
      },
    });
    document.documentElement.style.setProperty('--my-status', '#aaff00');
    saveFavorite();
    expect(require('../js/store.js').setFavorites).not.toHaveBeenCalled();
  });

  test('saves when statusColor differs from both slots', () => {
    // Adopted iris color — --my-status doesn't match forest or volt
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    saveFavorite();
    const { setFavorites } = require('../js/store.js');
    expect(setFavorites).toHaveBeenCalledWith([
      expect.objectContaining({
        statusColor: '#818cf8',
        selectedKey: 'forest',
        activeSet: 1,
      }),
    ]);
  });

  test('prepends to existing history', () => {
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    const existing = [{ statusColor: '#3b82f6', themeBg: '#0f172a', paletteKey: null, selectedKey: 'ocean', activeSet: 1 }];
    require('../js/store.js').getFavorites.mockReturnValue(existing);
    saveFavorite();
    const { setFavorites } = require('../js/store.js');
    const saved = setFavorites.mock.calls.at(-1)[0];
    expect(saved[0].statusColor).toBe('#818cf8');
    expect(saved[1]).toEqual(existing[0]);
  });

  test('drops oldest entry when history reaches 14', () => {
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    const full = Array.from({ length: 14 }, (_, i) => ({
      statusColor: `#${String(i).padStart(6, '0')}`,
      themeBg: '#0f172a', paletteKey: null, selectedKey: 'ocean', activeSet: 1,
    }));
    require('../js/store.js').getFavorites.mockReturnValue(full);
    saveFavorite();
    const { setFavorites } = require('../js/store.js');
    const saved = setFavorites.mock.calls.at(-1)[0];
    expect(saved).toHaveLength(14);
    expect(saved[0].statusColor).toBe('#818cf8');
    expect(saved[13]).toEqual(full[12]); // last old entry is full[12], full[13] dropped
  });

  test('themeBg uses palette theme.bg when paletteKey is set', () => {
    require('../js/store.js').getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'iris', activePaletteKey: 'iris' },
        '2': { selectedKey: 'volt', activePaletteKey: null },
      },
    });
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    saveFavorite();
    const { setFavorites } = require('../js/store.js');
    const saved = setFavorites.mock.calls.at(-1)[0][0];
    expect(saved.themeBg).toBe('#1e1b4b'); // iris theme.bg
    expect(saved.paletteKey).toBe('iris');
  });

  test('themeBg is #0f172a when paletteKey is null', () => {
    document.documentElement.style.setProperty('--my-status', '#818cf8');
    saveFavorite();
    const { setFavorites } = require('../js/store.js');
    const saved = setFavorites.mock.calls.at(-1)[0][0];
    expect(saved.themeBg).toBe('#0f172a');
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
npx jest tests/favorites.test.js --no-coverage
```
Expected: `Cannot find module '../js/favorites.js'`.

- [ ] **Step 3: Create `js/favorites.js` with `saveFavorite`**

```js
// js/favorites.js
import { PALETTES_ENABLED } from './features.js';
import { getPaletteState, setPaletteState, getFavorites, setFavorites } from './store.js';
import { getPaletteByKey, switchSet, enterPaletteMode, exitPaletteMode, getGlowForColor } from './palettes.js';
import { setStatusColor } from './db.js';

const MAX_HISTORY = 14;
const DEFAULT_THEME_BG = '#0f172a';
const COLLAPSED_KEY = 'statusapp_favorites_collapsed';

let _myUserId = null;

// ─── Combo building ──────────────────────────────────────────────────────────

function buildCombo() {
  const ps = getPaletteState();
  const activeSetKey = String(ps.activeSet);
  const { selectedKey, activePaletteKey } = ps.sets[activeSetKey];
  const palette = activePaletteKey ? getPaletteByKey(activePaletteKey) : null;
  const statusColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--my-status').trim();
  return {
    statusColor,
    themeBg: palette?.theme.bg ?? DEFAULT_THEME_BG,
    paletteKey: activePaletteKey,
    selectedKey,
    activeSet: ps.activeSet,
  };
}

function slotCombo(setNum) {
  const ps = getPaletteState();
  const setKey = String(setNum);
  const { selectedKey, activePaletteKey } = ps.sets[setKey];
  const statusPalette = getPaletteByKey(selectedKey);
  const themePalette  = activePaletteKey ? getPaletteByKey(activePaletteKey) : null;
  return {
    statusColor: statusPalette?.color ?? DEFAULT_THEME_BG,
    themeBg: themePalette?.theme.bg ?? DEFAULT_THEME_BG,
    paletteKey: activePaletteKey,
    selectedKey,
    activeSet: setNum,
  };
}

function combosMatch(a, b) {
  return a.statusColor === b.statusColor
    && a.paletteKey === b.paletteKey
    && a.selectedKey === b.selectedKey
    && a.activeSet   === b.activeSet;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function saveFavorite() {
  if (!PALETTES_ENABLED) return;
  const combo = buildCombo();
  if (combosMatch(combo, slotCombo(1)) || combosMatch(combo, slotCombo(2))) return;
  const history = getFavorites();
  setFavorites([combo, ...history].slice(0, MAX_HISTORY));
  renderStrip();
}

export function initFavoritesStrip(myUserId) {
  _myUserId = myUserId;
  renderStrip();
}

// ─── Rendering (stubs — filled in Task 4) ───────────────────────────────────

function renderStrip() {
  // filled in Task 4
}
```

- [ ] **Step 4: Run — verify PASS**

```bash
npx jest tests/favorites.test.js --no-coverage
```
Expected: all `saveFavorite` tests pass. (Store tests still pass.)

- [ ] **Step 5: Commit**

```bash
git add js/favorites.js tests/favorites.test.js
git commit -m "feat: add saveFavorite to favorites.js"
```

---

## Chunk 2: UI Layer

### Task 3: HTML container + CSS styles

**Files:**
- Modify: `index.html`
- Modify: `css/app.css`

No failing test needed for pure HTML/CSS. After changes, the DOM element will be verifiable in existing test setups.

- [ ] **Step 1: Add strip container to `index.html`**

After `</header>` and before `<main id="main-list">`, insert:

```html
  <div id="favorites-strip"></div>
```

- [ ] **Step 2: Add styles to `css/app.css`**

Append after the `.adopted-from {}` rule:

```css
/* ── Favorites strip ─────────────────────────────────────────────── */
#favorites-strip {
  display: none; /* shown by JS when favorites exist */
}

.fav-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: 1px solid #1e293b;
}
.fav-strip::-webkit-scrollbar { display: none; }

.fav-pill {
  display: flex;
  height: 22px;
  width: 40px;
  border-radius: 11px;
  overflow: hidden;
  flex-shrink: 0;
  cursor: pointer;
}
.fav-pill--inactive { opacity: 0.45; }
.fav-pill--active   { opacity: 1; }
.fav-pill--history  { opacity: 1; }

.fav-pill-left,
.fav-pill-right { flex: 1; }

.fav-collapse-btn {
  background: none;
  border: none;
  color: #475569;
  font-size: 10px;
  cursor: pointer;
  padding: 0 4px;
  flex-shrink: 0;
  margin-left: auto;
}

.fav-collapsed {
  height: 3px;
  width: 100%;
  cursor: pointer;
}
```

- [ ] **Step 3: Confirm tests still pass**

```bash
npx jest tests/favorites.test.js --no-coverage
```
Expected: all existing tests pass (store + saveFavorite tests from Chunk 1).

- [ ] **Step 4: Commit**

```bash
git add index.html css/app.css
git commit -m "feat: add favorites-strip container and CSS"
```

---

### Task 4: Strip rendering — `renderStrip`, `initFavoritesStrip`

**Files:**
- Modify: `js/favorites.js`
- Modify: `tests/favorites.test.js`

- [ ] **Step 1: Write failing rendering tests**

Append to `tests/favorites.test.js`:

```js
describe('renderStrip / initFavoritesStrip', () => {
  let initFavoritesStrip;
  let mocks;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(), enterPaletteMode: jest.fn(), exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn(defaultPaletteByKey),
      getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined) }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(defaultPaletteState),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => []),
      setFavorites: jest.fn(),
    }));
    mocks = {
      getPaletteState: require('../js/store.js').getPaletteState,
      getFavorites: require('../js/store.js').getFavorites,
    };
    ({ initFavoritesStrip } = require('../js/favorites.js'));
  });

  const ONE_ENTRY = [
    { statusColor: '#818cf8', themeBg: '#1e1b4b', paletteKey: 'iris', selectedKey: 'iris', activeSet: 1 },
  ];

  test('strip container stays hidden when favorites array is empty', () => {
    initFavoritesStrip('myUid');
    expect(document.getElementById('favorites-strip').style.display).toBe('none');
  });

  test('strip container is shown when favorites has at least one entry', () => {
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    expect(document.getElementById('favorites-strip').style.display).not.toBe('none');
  });

  test('renders slot 1 pill with forest color and slot 2 pill with volt color', () => {
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    const pills = document.querySelectorAll('.fav-pill[data-type="slot"]');
    expect(pills).toHaveLength(2);
    expect(pills[0].querySelector('.fav-pill-left').style.background).toBe('#22c55e');
    expect(pills[1].querySelector('.fav-pill-left').style.background).toBe('#aaff00');
  });

  test('active slot (Set 1 active) has fav-pill--active class, slot 2 has fav-pill--inactive', () => {
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    const pills = document.querySelectorAll('.fav-pill[data-type="slot"]');
    expect(pills[0].classList.contains('fav-pill--active')).toBe(true);
    expect(pills[1].classList.contains('fav-pill--inactive')).toBe(true);
  });

  test('renders history pills with correct left color', () => {
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    const historyPills = document.querySelectorAll('.fav-pill[data-type="history"]');
    expect(historyPills).toHaveLength(1);
    expect(historyPills[0].querySelector('.fav-pill-left').style.background).toBe('#818cf8');
  });

  test('collapsed state: renders .fav-collapsed gradient line when collapsed', () => {
    localStorage.setItem('statusapp_favorites_collapsed', 'true');
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    expect(document.querySelector('.fav-collapsed')).not.toBeNull();
    expect(document.querySelector('.fav-strip')).toBeNull();
    localStorage.removeItem('statusapp_favorites_collapsed');
  });

  test('collapse button sets collapsed state and re-renders to collapsed', () => {
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    document.querySelector('.fav-collapse-btn').click();
    expect(localStorage.getItem('statusapp_favorites_collapsed')).toBe('true');
    expect(document.querySelector('.fav-collapsed')).not.toBeNull();
    localStorage.removeItem('statusapp_favorites_collapsed');
  });

  test('clicking collapsed line removes collapsed state and re-renders expanded', () => {
    localStorage.setItem('statusapp_favorites_collapsed', 'true');
    mocks.getFavorites.mockReturnValue(ONE_ENTRY);
    initFavoritesStrip('myUid');
    document.querySelector('.fav-collapsed').click();
    expect(localStorage.getItem('statusapp_favorites_collapsed')).toBeNull();
    expect(document.querySelector('.fav-strip')).not.toBeNull();
    localStorage.removeItem('statusapp_favorites_collapsed');
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
npx jest tests/favorites.test.js --no-coverage
```
Expected: rendering tests fail (strip stays hidden, no pills rendered).

- [ ] **Step 3: Implement rendering in `js/favorites.js`**

Replace the `renderStrip()` stub with the full implementation:

```js
// ─── Rendering ───────────────────────────────────────────────────────────────

function renderStrip() {
  const container = document.getElementById('favorites-strip');
  if (!container) return;
  const history = getFavorites();
  if (history.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';
  const collapsed = localStorage.getItem(COLLAPSED_KEY) === 'true';
  if (collapsed) {
    renderCollapsed(container, history);
  } else {
    renderExpanded(container, history);
  }
}

function renderCollapsed(container, history) {
  const slot1 = slotCombo(1);
  const slot2 = slotCombo(2);
  const allColors = [slot1.statusColor, slot2.statusColor, ...history.map(c => c.statusColor)];
  const n = allColors.length;
  const stops = allColors
    .map((c, i) => `${c} ${Math.round((i / (n - 1)) * 100)}%`)
    .join(', ');
  container.innerHTML =
    `<div class="fav-collapsed" style="background:linear-gradient(to right,${stops})"></div>`;
  container.querySelector('.fav-collapsed').addEventListener('click', () => {
    localStorage.removeItem(COLLAPSED_KEY);
    renderStrip();
  });
}

function renderExpanded(container, history) {
  const ps = getPaletteState();
  const slot1 = slotCombo(1);
  const slot2 = slotCombo(2);

  const slotPills = [
    renderPill(slot1, ps.activeSet === 1 ? 'active' : 'inactive', 'slot', 1),
    renderPill(slot2, ps.activeSet === 2 ? 'active' : 'inactive', 'slot', 2),
  ].join('');
  const historyPills = history
    .map((c, i) => renderPill(c, 'history', 'history', i))
    .join('');

  container.innerHTML =
    `<div class="fav-strip">${slotPills}${historyPills}` +
    `<button class="fav-collapse-btn" aria-label="Collapse">▲</button></div>`;

  container.querySelectorAll('.fav-pill[data-type="slot"]').forEach(el => {
    el.addEventListener('click', () => handleSlotTap(parseInt(el.dataset.index)));
  });
  container.querySelectorAll('.fav-pill[data-type="history"]').forEach(el => {
    el.addEventListener('click', () => handleHistoryTap(parseInt(el.dataset.index)));
  });
  container.querySelector('.fav-collapse-btn').addEventListener('click', () => {
    localStorage.setItem(COLLAPSED_KEY, 'true');
    renderStrip();
  });
}

function renderPill(combo, state, type, index) {
  return `<div class="fav-pill fav-pill--${state}" data-type="${type}" data-index="${index}">` +
    `<div class="fav-pill-left" style="background:${combo.statusColor}"></div>` +
    `<div class="fav-pill-right" style="background:${combo.themeBg}"></div></div>`;
}

// ─── Interaction handlers (filled in Task 5) ────────────────────────────────

function handleSlotTap(slotNum) {
  // filled in Task 5
}

function handleHistoryTap(idx) {
  // filled in Task 5
}
```

- [ ] **Step 4: Run — verify PASS**

```bash
npx jest tests/favorites.test.js --no-coverage
```
Expected: all rendering tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/favorites.js tests/favorites.test.js
git commit -m "feat: implement favorites strip rendering"
```

---

### Task 5: Pill tap interactions — `handleSlotTap` / `handleHistoryTap`

**Files:**
- Modify: `js/favorites.js`
- Modify: `tests/favorites.test.js`

- [ ] **Step 1: Write failing interaction tests**

Append to `tests/favorites.test.js`:

```js
describe('slot tap interactions', () => {
  let initFavoritesStrip, localMocks;

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(), enterPaletteMode: jest.fn(), exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn(defaultPaletteByKey),
      getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined) }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(defaultPaletteState),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => [
        { statusColor: '#818cf8', themeBg: '#1e1b4b', paletteKey: 'iris', selectedKey: 'iris', activeSet: 1 },
      ]),
      setFavorites: jest.fn(),
    }));
    localMocks = {
      switchSet: require('../js/palettes.js').switchSet,
    };
    ({ initFavoritesStrip } = require('../js/favorites.js'));
  });

  test('tapping active slot (slot 1 when Set 1 is active) is a no-op', () => {
    initFavoritesStrip('myUid');
    const slot1Pill = document.querySelector('.fav-pill[data-type="slot"][data-index="1"]');
    slot1Pill.click();
    expect(localMocks.switchSet).not.toHaveBeenCalled();
  });

  test('tapping inactive slot (slot 2) calls switchSet with 2', () => {
    initFavoritesStrip('myUid');
    const slot2Pill = document.querySelector('.fav-pill[data-type="slot"][data-index="2"]');
    slot2Pill.click();
    expect(localMocks.switchSet).toHaveBeenCalledWith(2, 'myUid');
  });
});

describe('history pill tap interactions', () => {
  let initFavoritesStrip, localMocks;
  const IRIS_COMBO = {
    statusColor: '#818cf8', themeBg: '#1e1b4b',
    paletteKey: 'iris', selectedKey: 'iris', activeSet: 1,
  };
  const NO_THEME_COMBO = {
    statusColor: '#3b82f6', themeBg: '#0f172a',
    paletteKey: null, selectedKey: 'ocean', activeSet: 2,
  };

  function tapHistoryPill(idx = 0) {
    document.querySelector(`.fav-pill[data-type="history"][data-index="${idx}"]`).click();
  }

  beforeEach(() => {
    setupDom();
    jest.resetModules();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true }));
    jest.mock('../js/palettes.js', () => ({
      ...jest.requireActual('../js/palettes.js'),
      switchSet: jest.fn(), enterPaletteMode: jest.fn(), exitPaletteMode: jest.fn(),
      getPaletteByKey: jest.fn(defaultPaletteByKey),
      getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
    }));
    jest.mock('../js/db.js', () => ({ setStatusColor: jest.fn().mockResolvedValue(undefined) }));
    jest.mock('../js/store.js', () => ({
      ...jest.requireActual('../js/store.js'),
      getPaletteState: jest.fn(defaultPaletteState),
      setPaletteState: jest.fn(),
      getFavorites: jest.fn(() => [IRIS_COMBO]),
      setFavorites: jest.fn(),
    }));
    localMocks = {
      switchSet:       require('../js/palettes.js').switchSet,
      enterPaletteMode: require('../js/palettes.js').enterPaletteMode,
      exitPaletteMode:  require('../js/palettes.js').exitPaletteMode,
      setStatusColor:   require('../js/db.js').setStatusColor,
      getPaletteState:  require('../js/store.js').getPaletteState,
      setPaletteState:  require('../js/store.js').setPaletteState,
      getFavorites:     require('../js/store.js').getFavorites,
      setFavorites:     require('../js/store.js').setFavorites,
    };
    ({ initFavoritesStrip } = require('../js/favorites.js'));
  });

  test('step 0: writes combo.selectedKey into palette state before calling switchSet', () => {
    initFavoritesStrip('myUid');
    tapHistoryPill();
    expect(localMocks.setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({
        sets: expect.objectContaining({
          '1': expect.objectContaining({ selectedKey: 'iris' }),
        }),
      })
    );
    // setPaletteState must be called before switchSet
    const setOrder = localMocks.setPaletteState.mock.invocationCallOrder[0];
    const switchOrder = localMocks.switchSet.mock.invocationCallOrder[0];
    expect(setOrder).toBeLessThan(switchOrder);
  });

  test('step 1: calls switchSet with combo.activeSet', () => {
    initFavoritesStrip('myUid');
    tapHistoryPill();
    expect(localMocks.switchSet).toHaveBeenCalledWith(1, 'myUid');
  });

  test('step 2a: calls enterPaletteMode when combo.paletteKey is non-null', () => {
    initFavoritesStrip('myUid');
    tapHistoryPill();
    expect(localMocks.enterPaletteMode).toHaveBeenCalledWith('iris', 'myUid');
    expect(localMocks.exitPaletteMode).not.toHaveBeenCalled();
  });

  test('step 2b: calls exitPaletteMode when combo.paletteKey is null', () => {
    localMocks.getFavorites.mockReturnValue([NO_THEME_COMBO]);
    localMocks.getPaletteState.mockReturnValue({
      activeSet: 2,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null },
        '2': { selectedKey: 'volt',   activePaletteKey: null },
      },
    });
    initFavoritesStrip('myUid');
    tapHistoryPill();
    expect(localMocks.exitPaletteMode).toHaveBeenCalledWith('myUid');
    expect(localMocks.enterPaletteMode).not.toHaveBeenCalled();
  });

  test('step 3: calls setStatusColor and sets --my-status and --my-glow CSS vars', () => {
    initFavoritesStrip('myUid');
    tapHistoryPill();
    expect(localMocks.setStatusColor).toHaveBeenCalledWith('myUid', '#818cf8');
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#818cf8');
    expect(document.documentElement.style.getPropertyValue('--my-glow')).toBe('rgba(34,197,94,0.4)');
  });

  test('step 3: setStatusColor is called after switchSet (overrides it)', () => {
    initFavoritesStrip('myUid');
    tapHistoryPill();
    const switchOrder    = localMocks.switchSet.mock.invocationCallOrder[0];
    const setStatusOrder = localMocks.setStatusColor.mock.invocationCallOrder[0];
    expect(switchOrder).toBeLessThan(setStatusOrder);
  });

  test('step 4: removes tapped pill from history', () => {
    initFavoritesStrip('myUid');
    tapHistoryPill();
    expect(localMocks.setFavorites).toHaveBeenCalledWith(
      expect.not.arrayContaining([IRIS_COMBO])
    );
  });

  test('step 5: prepends old active slot combo to history after tap', () => {
    // Tap IRIS_COMBO (activeSet: 1, selectedKey: 'iris'). Initial state has set1 selectedKey
    // 'forest'. Step 0 changes set1.selectedKey to 'iris' in palette state — with a state-
    // tracking mock, slotCombo(1) after the tap returns iris (differs from old forest), so
    // shouldPrepend is true and old slot 1 (forest) is prepended to history.
    let trackingState = {
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null },
        '2': { selectedKey: 'volt',   activePaletteKey: null },
      },
    };
    localMocks.getPaletteState.mockImplementation(() => JSON.parse(JSON.stringify(trackingState)));
    localMocks.setPaletteState.mockImplementation(s => { trackingState = JSON.parse(JSON.stringify(s)); });
    // IRIS_COMBO is the default getFavorites mock from beforeEach — no override needed
    initFavoritesStrip('myUid');
    tapHistoryPill();
    const saved = localMocks.setFavorites.mock.calls.at(-1)[0];
    // Old slot 1 (forest, no theme, set 1, statusColor #22c55e) should be prepended
    expect(saved[0]).toMatchObject({ selectedKey: 'forest', activeSet: 1, paletteKey: null, statusColor: '#22c55e' });
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
npx jest tests/favorites.test.js --no-coverage
```
Expected: interaction tests fail (stubs do nothing).

- [ ] **Step 3: Implement `handleSlotTap` and `handleHistoryTap` in `js/favorites.js`**

Replace the stub functions:

```js
function handleSlotTap(slotNum) {
  const ps = getPaletteState();
  if (ps.activeSet === slotNum) return;
  switchSet(slotNum, _myUserId);
  renderStrip();
}

function handleHistoryTap(idx) {
  const history = getFavorites();
  const combo = history[idx];
  if (!combo) return;

  // Snapshot old active slot BEFORE mutating state
  const oldSlot = slotCombo(getPaletteState().activeSet);

  // Step 0: restore selectedKey so switchSet highlights the right swatch
  const state = getPaletteState();
  state.sets[String(combo.activeSet)].selectedKey = combo.selectedKey;
  setPaletteState(state);

  // Step 1: switchSet (also calls setStatusColor internally — step 3 overrides)
  switchSet(combo.activeSet, _myUserId);

  // Step 2: apply or clear palette theme
  if (combo.paletteKey) {
    enterPaletteMode(combo.paletteKey, _myUserId);
  } else {
    exitPaletteMode(_myUserId);
  }

  // Step 3: apply canonical status color (overrides what switchSet wrote)
  setStatusColor(_myUserId, combo.statusColor).catch(() => {});
  document.documentElement.style.setProperty('--my-status', combo.statusColor);
  document.documentElement.style.setProperty('--my-glow', getGlowForColor(combo.statusColor));

  // Step 4: remove pill from history
  const newHistory = history.filter((_, i) => i !== idx);

  // Step 5: prepend old slot — dedup against new slot state
  const newSlot1 = slotCombo(1);
  const newSlot2 = slotCombo(2);
  const shouldPrepend = !combosMatch(oldSlot, newSlot1) && !combosMatch(oldSlot, newSlot2);
  const finalHistory = shouldPrepend
    ? [oldSlot, ...newHistory].slice(0, MAX_HISTORY)
    : newHistory;

  setFavorites(finalHistory);
  renderStrip();
}
```

- [ ] **Step 4: Run — verify PASS**

```bash
npx jest tests/favorites.test.js --no-coverage
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/favorites.js tests/favorites.test.js
git commit -m "feat: implement favorites pill tap interactions"
```

---

## Chunk 3: Integration

### Task 6: Wire auto-save triggers

**Files:**
- Modify: `js/following.js`
- Modify: `js/me.js`
- Modify: `tests/me.test.js`

- [ ] **Step 1: Write failing tests for the `savingEnabled` guard in `tests/me.test.js`**

First, add a top-level mock for `favorites.js` to `tests/me.test.js` (alongside the existing `jest.mock` calls at the top of the file). This prevents an import error after Task 6 adds the `favorites.js` import to `me.js`:

```js
jest.mock('../js/favorites.js', () => ({ saveFavorite: jest.fn(), initFavoritesStrip: jest.fn() }));
```

Then append a new describe block at the bottom of `tests/me.test.js`:

```js
describe('saveFavorite guard in setAvailable', () => {
  let applyOwnStatus, saveFavoriteMock;

  beforeEach(() => {
    jest.resetModules();
    saveFavoriteMock = jest.fn();
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true }));
    jest.mock('../js/favorites.js', () => ({ saveFavorite: saveFavoriteMock, initFavoritesStrip: jest.fn() }));
    jest.mock('../js/db.js', () => ({
      setStatus: jest.fn().mockResolvedValue(undefined),
      isExpired: (t) => t !== null && t !== undefined && t < Date.now(),
      formatTimeRemaining: (ms) => ms > 0 ? '2h' : '',
      timeRemainingMs: (t) => !t ? 0 : Math.max(0, t - Date.now()),
    }));
    jest.mock('../js/store.js', () => ({
      getLastTimeout: jest.fn().mockReturnValue(2),
      setLastTimeout: jest.fn(),
    }));
    jest.useFakeTimers();
    global.requestAnimationFrame = (fn) => fn();
    makeFixture();
    ({ applyOwnStatus } = require('../js/me.js'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('saveFavorite does NOT fire during page-load restore of available status', () => {
    // Fresh module: savingEnabled starts false. applyOwnStatus with available is the
    // page-load restore path — saveFavorite must not fire here.
    applyOwnStatus('available', Date.now() + 7200000);
    expect(saveFavoriteMock).not.toHaveBeenCalled();
  });

  test('saveFavorite fires when applyOwnStatus sets available after prior status call', () => {
    // applyOwnStatus(unavailable) → sets savingEnabled = true, then
    // applyOwnStatus(available) → setAvailable → saveFavorite fires.
    applyOwnStatus('unavailable', null);
    applyOwnStatus('available', Date.now() + 7200000);
    expect(saveFavoriteMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run — verify FAIL**

```bash
npx jest tests/me.test.js --no-coverage
```

Expected: the two new tests fail (module not found or guard not yet implemented).

- [ ] **Step 3: Add `saveFavorite` import and call to `js/following.js`**

Add import at top of `js/following.js` (after existing imports):

```js
import { saveFavorite } from './favorites.js';
```

Replace the `triggerAdoption` function:

```js
function triggerAdoption(entry, myUserId) {
  saveFavorite();
  applyAdoption(entry, myUserId);
}
```

- [ ] **Step 4: Add `saveFavorite` import and guarded call to `js/me.js`**

Add import at top of `js/me.js`:

```js
import { saveFavorite } from './favorites.js';
```

Add module-level flag after existing module-level variables:

```js
let savingEnabled = false;
```

> **Note on guard strategy:** The spec suggests checking the dot's current `available` class as the guard. The `savingEnabled` flag achieves the same result more reliably: on page-load, `applyOwnStatus` calls `setAvailable` before setting the flag, so the first call is suppressed. On any subsequent user-initiated transition, `savingEnabled` is already `true`. This avoids reading DOM class state inside `setAvailable`.

In `applyOwnStatus`, add `savingEnabled = true` at the end of each branch (before returns and at the end). The function should look like:

```js
export function applyOwnStatus(status, availableUntil) {
  if (!ownStatusSignalled) {
    ownStatusSignalled = true;
    onOwnStatusReady?.();
  }
  if (firstUseActive) {
    if (status === 'available' && !isExpired(availableUntil)) {
      firstUseActive = false;
      setAvailable(availableUntil);
    } else {
      setKnockKnock();
    }
    savingEnabled = true;  // ← add this
    return;
  }
  if (status === 'available' && !isExpired(availableUntil)) {
    setAvailable(availableUntil);
  } else {
    setUnavailable();
  }
  savingEnabled = true;  // ← add this
}
```

In `setAvailable`, add the guarded save at the very top (before `dot.classList.add('available')`):

```js
function setAvailable(availableUntil) {
  if (PALETTES_ENABLED && savingEnabled) saveFavorite();  // ← add this line

  const dot = document.getElementById('my-dot');
  // ... rest unchanged
```

- [ ] **Step 5: Run full suite — verify tests pass including the new guard tests**

```bash
npx jest --no-coverage
```

Expected: all tests pass including the two new `saveFavorite guard` tests.

`tests/following.test.js` will also need a mock for `favorites.js` at the top of the file (since `following.js` now imports it). Add this alongside the other file-level `jest.mock` calls:

```js
jest.mock('../js/favorites.js', () => ({ saveFavorite: jest.fn(), initFavoritesStrip: jest.fn() }));
```

- [ ] **Step 6: Commit**

```bash
git add js/following.js js/me.js tests/me.test.js tests/following.test.js
git commit -m "feat: wire saveFavorite to triggerAdoption and setAvailable"
```

---

### Task 7: Remove adoption revert machinery, update following tests

**Files:**
- Modify: `js/following.js`
- Modify: `tests/following.test.js`

The spec removes: `adoptionSnapshot` variable, `revertAdoption` function, the toggle logic that was in `triggerAdoption` (already replaced in Task 6), and the `if (adoptionSnapshot) revertAdoption(myUserId)` guard at the top of `applyAdoption`.

- [ ] **Step 1: Remove revert machinery from `js/following.js`**

**a)** Remove the `adoptionSnapshot` module-level variable (line ~28):
```js
let adoptionSnapshot = null; // non-null while a card's palette is adopted
```

**b)** Remove the `adoptionSnapshot = null` reset line in `initList`.

**c)** In `applyAdoption`, remove the first two lines:
```js
if (adoptionSnapshot) revertAdoption(myUserId);   // remove

const ps = getPaletteState();
const activeSet = String(ps.activeSet);
const style = getComputedStyle(document.documentElement);
adoptionSnapshot = {                               // remove this block...
  fromUserId: entry.userId,
  activeSet: ps.activeSet,
  activePaletteKey: ps.sets[activeSet].activePaletteKey,
  selectedKey: ps.sets[activeSet].selectedKey,
  statusColor: style.getPropertyValue('--my-status').trim(),
  glowColor:   style.getPropertyValue('--my-glow').trim(),
};                                                 // ...through here
```

`applyAdoption` after cleanup:
```js
function applyAdoption(entry, myUserId) {
  const targetData = lastUserData.get(entry.userId);
  if (targetData?.paletteKey) {
    enterPaletteMode(targetData.paletteKey, myUserId);
  }
  if (targetData?.statusColor) {
    setStatusColor(myUserId, targetData.statusColor).catch(() => {});
    const glow = getGlowForColor(targetData.statusColor);
    document.documentElement.style.setProperty('--my-status', targetData.statusColor);
    document.documentElement.style.setProperty('--my-glow', glow);
  }
  const li = document.querySelector(`[data-user-id="${entry.userId}"]`);
  if (li) li.classList.add('adopted-from');
}
```

**d)** Delete the entire `revertAdoption` function.

- [ ] **Step 2: Run — see which following tests now fail**

```bash
npx jest tests/following.test.js --no-coverage
```
Note the failing tests — they will be in the `'revertAdoption'` describe block and any test that called `_testOnlyTriggerAdoption` to revert.

- [ ] **Step 3: Delete the `'revertAdoption'` describe block from `tests/following.test.js`**

Remove the entire `describe('revertAdoption', ...)` block (approximately 130 lines covering tests for `switchSet` ordering, CSS var restoration, `.adopted-from` removal, snapshot clearing, etc.).

Also remove the following three tests from the `'long press handler'` describe block (they test revert behavior that is being removed):
- `'long press same card twice — second press reverts (calls switchSet)'`
- `'long press different card while adopted — revertAdoption called before new applyAdoption'`
- `'fires adoption on third long-press (re-adopt after revert)'`

- [ ] **Step 4: Update the `'applyAdoption'` describe block**

The `applyAdoption` tests that verified `adoptionSnapshot` was set should be removed or updated. Specifically, remove any assertion like:
```js
expect(adoptionSnapshot).not.toBeNull();
```
since `adoptionSnapshot` no longer exists. Keep tests that verify `enterPaletteMode`, `setStatusColor`, CSS vars, and `.adopted-from` class — those behaviors are unchanged.

- [ ] **Step 5: Run — verify PASS**

```bash
npx jest tests/following.test.js --no-coverage
```
Expected: all remaining tests pass.

- [ ] **Step 6: Commit**

```bash
git add js/following.js tests/following.test.js
git commit -m "refactor: remove adoption revert machinery; recovery via favorites strip"
```

---

### Task 8: `app.js` init + final test run

**Files:**
- Modify: `js/app.js`
- Verify: all test files

- [ ] **Step 1: Add `initFavoritesStrip` to `app.js`**

Add import at the top of `js/app.js`:

```js
import { initFavoritesStrip } from './favorites.js';
```

In the `main()` function, add `initFavoritesStrip(userId)` inside the existing `if (PALETTES_ENABLED)` block, after `initSwatches`:

```js
if (PALETTES_ENABLED) {
  document.getElementById('swatch-row').style.display = '';
  const paletteState = getPaletteState();
  const activeSetKey = String(paletteState.activeSet);
  const { selectedKey, activePaletteKey } = paletteState.sets[activeSetKey];
  applyPaletteVars(selectedKey);
  initSwatches(userId);
  initFavoritesStrip(userId);   // ← add this line
}
```

- [ ] **Step 2: Run the full test suite**

```bash
npx jest --no-coverage
```
Expected: all tests pass, 0 failures.

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat: initialize favorites strip in app.js"
```

- [ ] **Step 4: Push**

```bash
git push
```
