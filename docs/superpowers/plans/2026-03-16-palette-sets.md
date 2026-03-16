# Palette Sets Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two named palette sets (Natural + Electric) with a toggle, two-tap palette mode with UI theme shift, and palette-colored person cards.

**Architecture:** Three independently-deployable increments: (1) data model + toggle, (2) two-tap mode + theme vars, (3) card styling. All changes are in existing files — no new files created. Increments 1 and 2 are fully independent; Increment 3 produces no visible card behavior until Increment 2 is live (Firebase `paletteKey` is only written in Increment 2).

**Tech Stack:** Vanilla JS ES modules, Jest + jsdom (CommonJS interop via Babel), Firebase RTDB, CSS custom properties, esbuild.

**Spec:** `docs/superpowers/specs/2026-03-16-palette-sets-design.md`

---

## Chunk 1: Increment 1 — Two Palette Sets + Toggle

### Task 1.1: store.js — New Palette State Format

**Files:**
- Modify: `js/store.js`
- Test: `tests/store.test.js`

Background: `store.js` uses CommonJS (`module.exports`). Tests run via Jest with Babel. The existing `getPalette()`/`setPalette()` read/write `statusapp_palette`. We're adding `getPaletteState`/`setPaletteState` and updating `getPalette()` to read from the new state.

The new localStorage key is `statusapp_palette_state`. Default state:
```json
{
  "activeSet": 1,
  "sets": {
    "1": { "selectedKey": "forest", "activePaletteKey": null },
    "2": { "selectedKey": "volt",   "activePaletteKey": null }
  }
}
```

Migration rule: if `statusapp_palette_state` is absent on first read, write the default, then check for the legacy `statusapp_palette` key — if present, copy its value as Set 1's `selectedKey`, update the written state, then delete the old key.

- [ ] **Step 1: Write failing tests for `getPaletteState` in `tests/store.test.js`**

Add these tests at the end of the file, after the existing getPalette/setPalette tests:

```js
// --- getPaletteState / setPaletteState ---

test('getPaletteState returns default state when nothing stored', () => {
  const state = getPaletteState();
  expect(state.activeSet).toBe(1);
  expect(state.sets['1'].selectedKey).toBe('forest');
  expect(state.sets['1'].activePaletteKey).toBeNull();
  expect(state.sets['2'].selectedKey).toBe('volt');
  expect(state.sets['2'].activePaletteKey).toBeNull();
});

test('getPaletteState writes default to localStorage on first call', () => {
  getPaletteState();
  const raw = localStorage.getItem('statusapp_palette_state');
  expect(raw).not.toBeNull();
  const saved = JSON.parse(raw);
  expect(saved.activeSet).toBe(1);
});

test('getPaletteState migrates legacy statusapp_palette key into Set 1 selectedKey', () => {
  localStorage.setItem('statusapp_palette', 'ember');
  const state = getPaletteState();
  expect(state.sets['1'].selectedKey).toBe('ember');
  expect(localStorage.getItem('statusapp_palette')).toBeNull();
});

test('getPaletteState migration writes new state before deleting old key', () => {
  localStorage.setItem('statusapp_palette', 'coral');
  getPaletteState();
  const raw = localStorage.getItem('statusapp_palette_state');
  expect(JSON.parse(raw).sets['1'].selectedKey).toBe('coral');
});

test('setPaletteState round-trips via getPaletteState', () => {
  const state = getPaletteState();
  state.sets['1'].selectedKey = 'gold';
  setPaletteState(state);
  const loaded = getPaletteState();
  expect(loaded.sets['1'].selectedKey).toBe('gold');
});
```

Also add `getPaletteState, setPaletteState` to the require at the top of the test:
```js
const {
  getFollowing, addFollowing, removeFollowing, isFollowing,
  getLastTimeout, setLastTimeout, renameFollowing, updateFollowingCode,
  getPalette, setPalette, getPaletteState, setPaletteState,
} = require('../js/store');
```

Update the existing `getPalette` tests:
```js
// Replace old getPalette / setPalette tests with:
test('getPalette returns "forest" when nothing stored', () => {
  expect(getPalette()).toBe('forest');
});

test('getPalette returns activeSet selectedKey from palette state', () => {
  const state = getPaletteState();
  state.sets['1'].selectedKey = 'iris';
  setPaletteState(state);
  expect(getPalette()).toBe('iris');
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest tests/store.test.js --no-coverage
```

Expected: FAIL — `getPaletteState is not a function`

- [ ] **Step 3: Implement `getPaletteState`, `setPaletteState`, update `getPalette` in `js/store.js`**

Add these constants near the top of store.js (after the existing key constants):
```js
const PALETTE_STATE_KEY = 'statusapp_palette_state';
const PALETTE_LEGACY_KEY = 'statusapp_palette';

const DEFAULT_PALETTE_STATE = {
  activeSet: 1,
  sets: {
    '1': { selectedKey: 'forest', activePaletteKey: null },
    '2': { selectedKey: 'volt',   activePaletteKey: null },
  },
};
```

Add these two functions before `getPalette`:
```js
function getPaletteState() {
  const raw = localStorage.getItem(PALETTE_STATE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch { /* fall through to default */ }
  }
  // Write default first
  const state = JSON.parse(JSON.stringify(DEFAULT_PALETTE_STATE));
  localStorage.setItem(PALETTE_STATE_KEY, JSON.stringify(state));
  // Migrate legacy key
  const legacy = localStorage.getItem(PALETTE_LEGACY_KEY);
  if (legacy) {
    state.sets['1'].selectedKey = legacy;
    localStorage.setItem(PALETTE_STATE_KEY, JSON.stringify(state));
    localStorage.removeItem(PALETTE_LEGACY_KEY);
  }
  return state;
}

function setPaletteState(state) {
  localStorage.setItem(PALETTE_STATE_KEY, JSON.stringify(state));
}
```

Update `getPalette` to read from new state:
```js
function getPalette() {
  const state = getPaletteState();
  return state.sets[String(state.activeSet)].selectedKey;
}
```

Keep `setPalette` unchanged (backward-compat, no longer called by palettes.js):
```js
function setPalette(key) {
  localStorage.setItem('statusapp_palette', key);
}
```

Add `getPaletteState` and `setPaletteState` to the `module.exports`:
```js
module.exports = {
  getFollowing, addFollowing, removeFollowing, isFollowing,
  getLastTimeout, setLastTimeout, renameFollowing, updateFollowingCode,
  getPalette, setPalette, getPaletteState, setPaletteState,
};
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest tests/store.test.js --no-coverage
```

Expected: PASS — all store tests green

- [ ] **Step 5: Run full suite to confirm no regressions**

```bash
npx jest --no-coverage
```

Expected: all 137 existing tests still pass (new ones added on top)

- [ ] **Step 6: Commit**

```bash
git add js/store.js tests/store.test.js
git commit -m "feat(inc1): add getPaletteState/setPaletteState with migration, update getPalette"
```

---

### Task 1.2: palettes.js — PALETTE_SETS Data

**Files:**
- Modify: `js/palettes.js`
- Test: `tests/palettes.test.js`

Replace the flat `PALETTES` array with the `PALETTE_SETS` object. All palette data (including `theme` and `complements`) is added now even though Increments 2 and 3 don't use them yet. Also add the SVG icon constants.

- [ ] **Step 1: Write failing tests for the new data structure in `tests/palettes.test.js`**

Replace the entire block of `// --- PALETTES array ---` tests and the mock block at the top. The new file top should be:

```js
// tests/palettes.test.js
jest.mock('../js/db.js', () => ({
  setStatusColor: jest.fn().mockResolvedValue(undefined),
}));

const DEFAULT_PALETTE_STATE = {
  activeSet: 1,
  sets: {
    '1': { selectedKey: 'forest', activePaletteKey: null },
    '2': { selectedKey: 'volt',   activePaletteKey: null },
  },
};

jest.mock('../js/store.js', () => ({
  getPaletteState: jest.fn().mockImplementation(() =>
    JSON.parse(JSON.stringify(DEFAULT_PALETTE_STATE))
  ),
  setPaletteState: jest.fn(),
  getPalette: jest.fn().mockReturnValue('forest'),
  setPalette: jest.fn(),
}));

const {
  PALETTE_SETS, getPaletteByKey, getGlowForColor, applyPaletteVars,
  tapSwatch, initSwatches, switchSet,
} = require('../js/palettes.js');
const { setStatusColor } = require('../js/db.js');
const { getPaletteState, setPaletteState } = require('../js/store.js');
```

Then replace the PALETTES array tests with:

```js
// --- PALETTE_SETS structure ---

test('PALETTE_SETS[1] has 8 entries', () => {
  expect(PALETTE_SETS[1]).toHaveLength(8);
});

test('PALETTE_SETS[2] has 8 entries', () => {
  expect(PALETTE_SETS[2]).toHaveLength(8);
});

test('PALETTE_SETS[1] contains all Natural keys', () => {
  const keys = PALETTE_SETS[1].map(p => p.key);
  expect(keys).toEqual(['forest', 'ocean', 'iris', 'ember', 'coral', 'sky', 'gold', 'mint']);
});

test('PALETTE_SETS[2] contains all Electric keys', () => {
  const keys = PALETTE_SETS[2].map(p => p.key);
  expect(keys).toEqual(['volt', 'plasma', 'arc', 'venom', 'inferno', 'aurora', 'solar', 'ultraviolet']);
});

test('forest palette has correct hex and glow', () => {
  const forest = PALETTE_SETS[1].find(p => p.key === 'forest');
  expect(forest.color).toBe('#22c55e');
  expect(forest.glow).toBe('rgba(34,197,94,0.4)');
});

test('volt palette has correct hex and glow', () => {
  const volt = PALETTE_SETS[2].find(p => p.key === 'volt');
  expect(volt.color).toBe('#aaff00');
  expect(volt.glow).toBe('rgba(170,255,0,0.4)');
});

test('each Set 1 palette has theme and complements', () => {
  PALETTE_SETS[1].forEach(p => {
    expect(p.theme).toBeDefined();
    expect(p.theme.bg).toBeDefined();
    expect(p.complements).toHaveLength(7);
  });
});

test('each Set 2 palette has theme and complements', () => {
  PALETTE_SETS[2].forEach(p => {
    expect(p.theme).toBeDefined();
    expect(p.complements).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest tests/palettes.test.js --no-coverage
```

Expected: FAIL — `PALETTE_SETS is not defined` or similar

- [ ] **Step 3: Replace `PALETTES` with `PALETTE_SETS` in `js/palettes.js`**

Replace the existing `export const PALETTES = [...]` block with the full PALETTE_SETS and icon constants. New content for the data section (replaces lines 1–14):

```js
// js/palettes.js
import { getPaletteState, setPaletteState } from './store.js';
import { setStatusColor } from './db.js';

// SVG Icons (inlined)
// Heroicons bolt-solid (MIT) https://heroicons.com
export const ICON_BOLT = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-label="Switch to Electric palettes"><path d="M11.9834 1.90718C12.0546 1.57461 11.8932 1.23571 11.59 1.08152C11.2868 0.927338 10.9179 0.996463 10.6911 1.24994L2.19108 10.7499C1.99385 10.9704 1.9446 11.2861 2.06533 11.5562C2.18607 11.8262 2.45423 12 2.75001 12H9.32227L8.01666 18.0929C7.9454 18.4255 8.10685 18.7644 8.41002 18.9185C8.71318 19.0727 9.08215 19.0036 9.30894 18.7501L17.8089 9.25013C18.0062 9.0297 18.0554 8.71393 17.9347 8.4439C17.814 8.17388 17.5458 8.00003 17.25 8.00003H10.6778L11.9834 1.90718Z"/></svg>`;

// Bootstrap Icons tree (MIT) https://icons.getbootstrap.com
export const ICON_TREE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-label="Switch to Natural palettes"><path d="M8.416.223a.5.5 0 0 0-.832 0l-3 4.5A.5.5 0 0 0 5 5.5h.098L3.076 8.735A.5.5 0 0 0 3.5 9.5h.191l-1.638 3.276a.5.5 0 0 0 .447.724H7V16h2v-2.5h4.5a.5.5 0 0 0 .447-.724L12.31 9.5h.191a.5.5 0 0 0 .424-.765L10.902 5.5H11a.5.5 0 0 0 .416-.777zM6.437 4.758A.5.5 0 0 0 6 4.5h-.066L8 1.401 10.066 4.5H10a.5.5 0 0 0-.424.765L11.598 8.5H11.5a.5.5 0 0 0-.447.724L12.69 12.5H3.309l1.638-3.276A.5.5 0 0 0 4.5 8.5h-.098l2.022-3.235a.5.5 0 0 0 .013-.507"/></svg>`;

export const PALETTE_SETS = {
  1: [
    {
      key: 'forest', label: 'Forest',
      color: '#22c55e', glow: 'rgba(34,197,94,0.4)',
      theme: { bg: '#071a0c', surface: '#0f2e18', surface2: '#184226', text: '#ecfdf4', textMuted: '#5ea87a' },
      complements: ['#84cc16','#bef264','#a3e635','#fbbf24','#34d399','#4ade80','#86efac'],
    },
    {
      key: 'ocean', label: 'Ocean',
      color: '#3b82f6', glow: 'rgba(59,130,246,0.4)',
      theme: { bg: '#05101e', surface: '#0b1e38', surface2: '#102c52', text: '#eef4ff', textMuted: '#5f9acf' },
      complements: ['#06b6d4','#22d3ee','#38bdf8','#7dd3fc','#0ea5e9','#60a5fa','#a5f3fc'],
    },
    {
      key: 'iris', label: 'Iris',
      color: '#818cf8', glow: 'rgba(129,140,248,0.4)',
      theme: { bg: '#0c0c1e', surface: '#141432', surface2: '#1d1d47', text: '#eeeeff', textMuted: '#8080c0' },
      complements: ['#8b5cf6','#a78bfa','#c4b5fd','#ec4899','#6366f1','#e879f9','#f472b6'],
    },
    {
      key: 'ember', label: 'Ember',
      color: '#f97316', glow: 'rgba(249,115,22,0.4)',
      theme: { bg: '#180a02', surface: '#2b1505', surface2: '#3f1f08', text: '#fff1e8', textMuted: '#b06a30' },
      complements: ['#fbbf24','#f59e0b','#ef4444','#fb923c','#fcd34d','#dc2626','#d97706'],
    },
    {
      key: 'coral', label: 'Coral',
      color: '#f43f5e', glow: 'rgba(244,63,94,0.4)',
      theme: { bg: '#180507', surface: '#2b0a11', surface2: '#3f0e1a', text: '#ffe8ec', textMuted: '#a8406a' },
      complements: ['#fb7185','#fda4af','#ec4899','#f472b6','#e11d48','#ff6b9d','#fce7f3'],
    },
    {
      key: 'sky', label: 'Sky',
      color: '#06b6d4', glow: 'rgba(6,182,212,0.4)',
      theme: { bg: '#030f18', surface: '#071e30', surface2: '#0b2d47', text: '#e8fbff', textMuted: '#3a9ab8' },
      complements: ['#0ea5e9','#38bdf8','#7dd3fc','#10b981','#34d399','#3b82f6','#a5f3fc'],
    },
    {
      key: 'gold', label: 'Gold',
      color: '#eab308', glow: 'rgba(234,179,8,0.4)',
      theme: { bg: '#120d00', surface: '#221800', surface2: '#332400', text: '#fffbea', textMuted: '#9a7010' },
      complements: ['#f59e0b','#fb923c','#fbbf24','#fde68a','#f97316','#d97706','#fcd34d'],
    },
    {
      key: 'mint', label: 'Mint',
      color: '#10b981', glow: 'rgba(16,185,129,0.4)',
      theme: { bg: '#031210', surface: '#07221e', surface2: '#0b332c', text: '#e8fff9', textMuted: '#308870' },
      complements: ['#06b6d4','#14b8a6','#2dd4bf','#22c55e','#34d399','#6ee7b7','#67e8f9'],
    },
  ],
  2: [
    {
      key: 'volt', label: 'Volt',
      color: '#aaff00', glow: 'rgba(170,255,0,0.4)',
      theme: { bg: '#0e1700', surface: '#192500', surface2: '#243600', text: '#f4ffe6', textMuted: '#88cc33' },
      complements: ['#6633ff','#00ccee','#ff00aa','#1155ff','#bb00ff','#44ff00','#ffcc00'],
    },
    {
      key: 'plasma', label: 'Plasma',
      color: '#ff1aad', glow: 'rgba(255,26,173,0.4)',
      theme: { bg: '#180012', surface: '#260020', surface2: '#38002e', text: '#ffe8f8', textMuted: '#cc44aa' },
      complements: ['#22ff66','#aaff00','#00ccee','#44ff00','#00ffaa','#ff2244','#bb00ff'],
    },
    {
      key: 'arc', label: 'Arc',
      color: '#0055ff', glow: 'rgba(0,85,255,0.4)',
      theme: { bg: '#00050f', surface: '#000a1e', surface2: '#00102d', text: '#e8f0ff', textMuted: '#4488ee' },
      complements: ['#ff8800','#ff2244','#aaff00','#ff3300','#ffdd00','#7700ff','#00ddcc'],
    },
    {
      key: 'venom', label: 'Venom',
      color: '#00ff66', glow: 'rgba(0,255,102,0.4)',
      theme: { bg: '#001008', surface: '#001c10', surface2: '#002a18', text: '#e8fff2', textMuted: '#33aa66' },
      complements: ['#ff1aaa','#7733ff','#ff4400','#9900ff','#ff1133','#00ffdd','#77ff00'],
    },
    {
      key: 'inferno', label: 'Inferno',
      color: '#ff3300', glow: 'rgba(255,51,0,0.4)',
      theme: { bg: '#140400', surface: '#220700', surface2: '#320c00', text: '#fff0eb', textMuted: '#cc4422' },
      complements: ['#00ccdd','#33ee00','#0044ff','#00ddaa','#0055ff','#ffaa00','#ff0044'],
    },
    {
      key: 'aurora', label: 'Aurora',
      color: '#00e5ff', glow: 'rgba(0,229,255,0.4)',
      theme: { bg: '#00080f', surface: '#000f1a', surface2: '#001828', text: '#e8fcff', textMuted: '#22aacc' },
      complements: ['#ff3300','#ff11bb','#eeff00','#ff2266','#ff8800','#0055ff','#00ff88'],
    },
    {
      key: 'solar', label: 'Solar',
      color: '#ffdd00', glow: 'rgba(255,221,0,0.4)',
      theme: { bg: '#0f0c00', surface: '#1e1700', surface2: '#2d2300', text: '#fffde8', textMuted: '#ccaa00' },
      complements: ['#0044ff','#00ffcc','#aa00ff','#00aaff','#5500ff','#bbff00','#ff4400'],
    },
    {
      key: 'ultraviolet', label: 'Ultraviolet',
      color: '#8800ff', glow: 'rgba(136,0,255,0.4)',
      theme: { bg: '#070013', surface: '#0e0022', surface2: '#160033', text: '#f0e8ff', textMuted: '#9944dd' },
      complements: ['#bbff00','#ff7700','#00ff44','#ffee00','#00ee66','#ff00cc','#0055ff'],
    },
  ],
};
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/palettes.test.js --no-coverage
```

Expected: PASS for the new data tests; the existing function tests (getPaletteByKey, etc.) may fail since functions still import from old PALETTES — that's expected and will be fixed next step.

- [ ] **Step 5: Update `getPaletteByKey` and `getGlowForColor` to search both sets**

Replace the existing `getPaletteByKey` and `getGlowForColor` functions:

```js
export function getPaletteByKey(key) {
  for (const set of [PALETTE_SETS[1], PALETTE_SETS[2]]) {
    const found = set.find(p => p.key === key);
    if (found) return found;
  }
  return PALETTE_SETS[1][0]; // forest fallback (changed to null in Increment 3)
}

export function getGlowForColor(hex) {
  for (const set of [PALETTE_SETS[1], PALETTE_SETS[2]]) {
    const p = set.find(p => p.color === hex);
    if (p) return p.glow;
  }
  return PALETTE_SETS[1][0].glow; // forest fallback
}
```

- [ ] **Step 6: Update the `getPaletteByKey` and `getGlowForColor` tests in `palettes.test.js`**

Replace the existing `// --- getPaletteByKey ---` and `// --- getGlowForColor ---` sections:

```js
// --- getPaletteByKey ---

test('getPaletteByKey returns correct palette for Set 1 key', () => {
  const p = getPaletteByKey('iris');
  expect(p.color).toBe('#818cf8');
});

test('getPaletteByKey returns correct palette for Set 2 key', () => {
  const p = getPaletteByKey('volt');
  expect(p.color).toBe('#aaff00');
});

test('getPaletteByKey falls back to forest for unknown key', () => {
  const p = getPaletteByKey('nonexistent');
  expect(p.key).toBe('forest');
});

// --- getGlowForColor ---

test('getGlowForColor returns correct glow for Set 1 hex', () => {
  expect(getGlowForColor('#818cf8')).toBe('rgba(129,140,248,0.4)');
});

test('getGlowForColor returns correct glow for Set 2 hex', () => {
  expect(getGlowForColor('#aaff00')).toBe('rgba(170,255,0,0.4)');
});

test('getGlowForColor falls back to forest glow for unknown hex', () => {
  expect(getGlowForColor('#000000')).toBe('rgba(34,197,94,0.4)');
});
```

- [ ] **Step 7: Run tests**

```bash
npx jest tests/palettes.test.js --no-coverage
```

Expected: PASS for all data + getPaletteByKey + getGlowForColor tests. `applyPaletteVars` tests may still pass since they call `getPaletteByKey` internally.

- [ ] **Step 8: Commit**

```bash
git add js/palettes.js tests/palettes.test.js
git commit -m "feat(inc1): add PALETTE_SETS with Set 1 and Set 2 data, icons, update lookup functions"
```

---

### Task 1.3: palettes.js — tapSwatch, switchSet, initSwatches

**Files:**
- Modify: `js/palettes.js`
- Test: `tests/palettes.test.js`

Key behaviors:
- `tapSwatch`: updates `sets[activeSet].selectedKey` in state, not old `setPalette`
- `renderSwatchRow(userId)` (private): clears row, adds toggle button + 8 swatches for active set
- `initSwatches(userId)`: calls `renderSwatchRow`
- `switchSet(toSet, userId)`: updates `activeSet` in state, applies CSS vars + Firebase, re-renders

- [ ] **Step 1: Write failing tests for `tapSwatch` (updated), `initSwatches` (updated), and `switchSet` (new)**

Replace the `describe('tapSwatch', ...)` and `describe('initSwatches', ...)` blocks in `palettes.test.js` with:

```js
// --- applyPaletteVars (unchanged API) ---

test('applyPaletteVars sets --my-status on :root for Set 1 key', () => {
  applyPaletteVars('iris');
  expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#818cf8');
});

test('applyPaletteVars sets --my-glow on :root for Set 1 key', () => {
  applyPaletteVars('iris');
  expect(document.documentElement.style.getPropertyValue('--my-glow')).toBe('rgba(129,140,248,0.4)');
});

test('applyPaletteVars works for Set 2 key', () => {
  applyPaletteVars('volt');
  expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#aaff00');
});

test('applyPaletteVars falls back to forest for unknown key', () => {
  applyPaletteVars('nonexistent');
  expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#22c55e');
});

// --- tapSwatch ---

describe('tapSwatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null },
        '2': { selectedKey: 'volt',   activePaletteKey: null },
      },
    });
    document.body.innerHTML = `
      <div id="swatch-row">
        <div class="swatch selected" data-key="forest"></div>
        <div class="swatch" data-key="iris"></div>
      </div>`;
  });

  test('calls setPaletteState with updated selectedKey for active set', () => {
    tapSwatch('iris', 'uid1');
    expect(setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({
        sets: expect.objectContaining({
          '1': expect.objectContaining({ selectedKey: 'iris' }),
        }),
      })
    );
  });

  test('calls setStatusColor with userId and palette color', () => {
    tapSwatch('iris', 'uid1');
    expect(setStatusColor).toHaveBeenCalledWith('uid1', '#818cf8');
  });

  test('updates --my-status CSS var', () => {
    tapSwatch('iris', 'uid1');
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#818cf8');
  });

  test('moves .selected to tapped swatch', () => {
    tapSwatch('iris', 'uid1');
    expect(document.querySelector('[data-key="forest"]').classList.contains('selected')).toBe(false);
    expect(document.querySelector('[data-key="iris"]').classList.contains('selected')).toBe(true);
  });

  test('is synchronous — returns undefined', () => {
    expect(tapSwatch('iris', 'uid1')).toBeUndefined();
  });
});

// --- initSwatches ---

describe('initSwatches', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'iris', activePaletteKey: null },
        '2': { selectedKey: 'volt', activePaletteKey: null },
      },
    });
    document.body.innerHTML = `<div id="swatch-row"></div>`;
  });

  test('injects 8 swatches into #swatch-row', () => {
    initSwatches('uid1');
    expect(document.querySelectorAll('.swatch')).toHaveLength(8);
  });

  test('toggle button is first child of swatch-row', () => {
    initSwatches('uid1');
    const first = document.getElementById('swatch-row').firstChild;
    expect(first.tagName).toBe('BUTTON');
    expect(first.className).toBe('set-toggle-btn');
  });

  test('toggle button shows bolt icon when in Set 1 (pointing to Electric)', () => {
    initSwatches('uid1');
    const btn = document.querySelector('.set-toggle-btn');
    expect(btn.innerHTML).toContain('<svg');
    expect(btn.innerHTML).toContain('Switch to Electric');
  });

  test('Set 1 swatches have correct data-keys', () => {
    initSwatches('uid1');
    const keys = Array.from(document.querySelectorAll('.swatch')).map(s => s.dataset.key);
    expect(keys).toEqual(['forest', 'ocean', 'iris', 'ember', 'coral', 'sky', 'gold', 'mint']);
  });

  test('swatch matching savedKey gets .selected', () => {
    initSwatches('uid1'); // savedKey is 'iris'
    expect(document.querySelector('[data-key="iris"]').classList.contains('selected')).toBe(true);
    expect(document.querySelector('[data-key="forest"]').classList.contains('selected')).toBe(false);
  });

  test('clicking a swatch calls setPaletteState (via tapSwatch)', () => {
    initSwatches('uid1');
    document.querySelector('[data-key="forest"]').click();
    expect(setPaletteState).toHaveBeenCalled();
  });
});

// --- switchSet ---

describe('switchSet', () => {
  let mockState;

  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'forest', activePaletteKey: null },
        '2': { selectedKey: 'volt',   activePaletteKey: null },
      },
    };
    document.body.innerHTML = `<div id="swatch-row"></div>`;
  });

  test('calls setPaletteState with activeSet updated to target', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    switchSet(2, 'uid1');
    expect(setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({ activeSet: 2 })
    );
  });

  test('applies --my-status CSS var for target set selectedKey', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    switchSet(2, 'uid1');
    // volt (#aaff00) is Set 2 selectedKey
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#aaff00');
  });

  test('calls setStatusColor with target set selectedKey color', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    switchSet(2, 'uid1');
    expect(setStatusColor).toHaveBeenCalledWith('uid1', '#aaff00');
  });

  test('re-renders swatch row with Set 2 swatches after switching to Set 2', () => {
    // First call (in switchSet): returns state with activeSet 1
    // Second call (in renderSwatchRow after setPaletteState): returns state with activeSet 2
    getPaletteState
      .mockReturnValueOnce(JSON.parse(JSON.stringify(mockState)))
      .mockReturnValueOnce({ ...JSON.parse(JSON.stringify(mockState)), activeSet: 2 });

    switchSet(2, 'uid1');

    const keys = Array.from(document.querySelectorAll('.swatch')).map(s => s.dataset.key);
    expect(keys).toContain('volt');
    expect(keys).not.toContain('forest');
  });

  test('toggle button shows tree icon after switching to Set 2', () => {
    getPaletteState
      .mockReturnValueOnce(JSON.parse(JSON.stringify(mockState)))
      .mockReturnValueOnce({ ...JSON.parse(JSON.stringify(mockState)), activeSet: 2 });

    switchSet(2, 'uid1');
    const btn = document.querySelector('.set-toggle-btn');
    expect(btn.innerHTML).toContain('Switch to Natural');
  });

  test('clicking toggle button from Set 1 calls switchSet with 2', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    initSwatches('uid1');
    jest.clearAllMocks();

    // Return state with activeSet 1 for the toggle click's switchSet call
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));

    document.querySelector('.set-toggle-btn').click();
    expect(setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({ activeSet: 2 })
    );
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
npx jest tests/palettes.test.js --no-coverage
```

Expected: FAIL — `switchSet is not a function` and tapSwatch/initSwatches behavior tests fail

- [ ] **Step 3: Rewrite `tapSwatch`, `initSwatches`, and add `renderSwatchRow`, `switchSet` in `js/palettes.js`**

Replace the existing `tapSwatch` and `initSwatches` functions with the following block (add after `applyPaletteVars`):

```js
function renderSwatchRow(userId) {
  const row = document.getElementById('swatch-row');
  row.innerHTML = '';
  const state = getPaletteState();
  const setNum = state.activeSet;
  const savedKey = state.sets[String(setNum)].selectedKey;

  // Toggle button — icon represents the OTHER set (what you'd switch to)
  const btn = document.createElement('button');
  btn.className = 'set-toggle-btn';
  btn.innerHTML = setNum === 1 ? ICON_BOLT : ICON_TREE;
  btn.addEventListener('click', () => switchSet(setNum === 1 ? 2 : 1, userId));
  row.appendChild(btn);

  // Swatches for active set (Increment 2 will extend this to handle palette mode)
  PALETTE_SETS[setNum].forEach(p => {
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.dataset.key = p.key;
    swatch.style.background = p.color;
    if (p.key === savedKey) swatch.classList.add('selected');
    swatch.addEventListener('click', () => tapSwatch(p.key, userId));
    row.appendChild(swatch);
  });
}

export function tapSwatch(key, userId) {
  const state = getPaletteState();
  const setKey = String(state.activeSet);
  state.sets[setKey].selectedKey = key;
  setPaletteState(state);
  const palette = getPaletteByKey(key);
  setStatusColor(userId, palette.color).catch(() => {});
  applyPaletteVars(key);
  // Update DOM selection
  const row = document.getElementById('swatch-row');
  row.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
  const target = row.querySelector(`[data-key="${key}"]`);
  if (target) target.classList.add('selected');
}

export function initSwatches(userId) {
  renderSwatchRow(userId);
}

export function switchSet(toSet, userId) {
  const state = getPaletteState();
  state.activeSet = toSet;
  setPaletteState(state);

  const selectedKey = state.sets[String(toSet)].selectedKey;
  const palette = getPaletteByKey(selectedKey);
  applyPaletteVars(selectedKey);
  setStatusColor(userId, palette.color).catch(() => {});

  renderSwatchRow(userId);
}
```

Also remove the old `import { getPalette, setPalette }` import line from the top of `palettes.js` — replace with:
```js
import { getPaletteState, setPaletteState } from './store.js';
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/palettes.test.js --no-coverage
```

Expected: PASS — all palettes tests green

- [ ] **Step 5: Run full suite**

```bash
npx jest --no-coverage
```

Expected: PASS — all tests green (store + palettes + all others)

- [ ] **Step 6: Commit**

```bash
git add js/palettes.js tests/palettes.test.js
git commit -m "feat(inc1): tapSwatch/initSwatches use new state; add switchSet and toggle rendering"
```

---

### Task 1.4: css/app.css — Toggle Button Styles

**Files:**
- Modify: `css/app.css`

No TDD for CSS. Add styles after the existing `.swatch` block.

- [ ] **Step 1: Add `.set-toggle-btn` styles to `css/app.css`**

Find the line `.swatch.selected {` and add the following CSS block just before the `#swatch-row` rule (or after the `.swatch.selected` block — wherever makes semantic sense):

```css
.set-toggle-btn {
  width: 22px; height: 22px; background: none; border: none;
  cursor: pointer; color: var(--text-muted); padding: 0;
  flex-shrink: 0; display: flex; align-items: center; justify-content: center;
  border-radius: 5px; transition: color 0.15s, background 0.15s;
}
.set-toggle-btn:hover { color: var(--text); background: rgba(255,255,255,0.07); }
```

- [ ] **Step 2: Run full suite to confirm no regressions**

```bash
npx jest --no-coverage
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add css/app.css
git commit -m "feat(inc1): add .set-toggle-btn CSS styles"
```

---

### Task 1.5: Enable Feature Flag

**Files:**
- Modify: `js/features.js`

- [ ] **Step 1: Set `PALETTES_ENABLED: true` in `js/features.js`**

```js
// js/features.js
module.exports = {
  PALETTES_ENABLED: true,
};
```

- [ ] **Step 2: Run full suite**

```bash
npx jest --no-coverage
```

Expected: PASS — all tests green

- [ ] **Step 3: Commit**

```bash
git add js/features.js
git commit -m "feat(inc1): enable PALETTES_ENABLED feature flag"
```

---

## Chunk 2: Increment 2 — Two-Tap Palette Mode + Key Swatch + UI Theme Shift

### Task 2.1: db.js — Add `setPaletteKey`

**Files:**
- Modify: `js/db.js`
- Test: `tests/db.test.js`

- [ ] **Step 1: Write a failing test in `tests/db.test.js`**

Find where `setStatusColor` is tested and add adjacent test:

```js
test('setPaletteKey calls update with paletteKey field', async () => {
  await setPaletteKey('uid1', 'ember');
  expect(update).toHaveBeenCalledWith(
    expect.anything(),
    { paletteKey: 'ember' }
  );
});

test('setPaletteKey coerces undefined to null', async () => {
  await setPaletteKey('uid1', undefined);
  expect(update).toHaveBeenCalledWith(
    expect.anything(),
    { paletteKey: null }
  );
});
```

Also add `setPaletteKey` to the require/import at the top of `db.test.js`.

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest tests/db.test.js --no-coverage
```

Expected: FAIL — `setPaletteKey is not a function`

- [ ] **Step 3: Add `setPaletteKey` to `js/db.js`**

Add after `setStatusColor`:

```js
export async function setPaletteKey(userId, paletteKey) {
  await update(ref(db, `users/${userId}`), { paletteKey: paletteKey ?? null });
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/db.test.js --no-coverage
```

Expected: PASS

- [ ] **Step 5: Run full suite**

```bash
npx jest --no-coverage
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add js/db.js tests/db.test.js
git commit -m "feat(inc2): add setPaletteKey to db.js"
```

---

### Task 2.2: palettes.js — Two-Tap, Palette Mode, Theme Vars

**Files:**
- Modify: `js/palettes.js`
- Test: `tests/palettes.test.js`

New behaviors:
- `applyThemeVars(theme)`: sets `--bg`, `--surface`, `--surface2`, `--text`, `--text-muted`
- `resetThemeVars()`: restores those five vars to hardcoded slate defaults
- `enterPaletteMode(key, userId)`: sets `activePaletteKey` in store, calls `applyThemeVars`, writes Firebase, re-renders swatch row in palette mode
- `exitPaletteMode(userId)`: clears `activePaletteKey`, calls `resetThemeVars`, writes Firebase, re-renders in base mode
- `tapSwatch(key, userId)`: if `key === currentlySelectedKey && activePaletteKey === null` → call `enterPaletteMode`; else existing behavior. If in palette mode and tapping a non-Key-Swatch complement — that is handled by `exitPaletteMode` then `tapSwatch` normally. See spec note: "tapping any non-Key swatch in palette mode calls exitPaletteMode then tapSwatch normally."

The default slate values for `resetThemeVars()`:
```
--bg:         #0f172a
--surface:    #1e293b
--surface2:   #334155
--text:       #f1f5f9
--text-muted: #94a3b8
```

`renderSwatchRow` (private) is extended: when `activePaletteKey` is non-null, render in palette mode (Key Swatch at index K, complements at other positions). Palette mode layout: positions 0…K-1 → `complements[0…K-1]`, position K → Key Swatch, positions K+1…7 → `complements[K…6]`.

`switchSet` (Increment 2 extension): after setting `activeSet`, if the target set's `activePaletteKey` is non-null, call `applyThemeVars`; otherwise call `resetThemeVars`.

- [ ] **Step 1: Write failing tests in `tests/palettes.test.js`**

Add a new section at the end:

```js
// --- applyThemeVars / resetThemeVars ---

describe('applyThemeVars', () => {
  test('sets all five theme CSS vars', () => {
    applyThemeVars({ bg: '#111', surface: '#222', surface2: '#333', text: '#eee', textMuted: '#999' });
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#111');
    expect(document.documentElement.style.getPropertyValue('--surface')).toBe('#222');
    expect(document.documentElement.style.getPropertyValue('--surface2')).toBe('#333');
    expect(document.documentElement.style.getPropertyValue('--text')).toBe('#eee');
    expect(document.documentElement.style.getPropertyValue('--text-muted')).toBe('#999');
  });

  test('does not touch --my-status or --my-glow', () => {
    applyPaletteVars('iris');
    applyThemeVars({ bg: '#111', surface: '#222', surface2: '#333', text: '#eee', textMuted: '#999' });
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#818cf8');
  });
});

describe('resetThemeVars', () => {
  test('restores all five vars to slate defaults', () => {
    applyThemeVars({ bg: '#111', surface: '#222', surface2: '#333', text: '#eee', textMuted: '#999' });
    resetThemeVars();
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#0f172a');
    expect(document.documentElement.style.getPropertyValue('--surface')).toBe('#1e293b');
    expect(document.documentElement.style.getPropertyValue('--surface2')).toBe('#334155');
    expect(document.documentElement.style.getPropertyValue('--text')).toBe('#f1f5f9');
    expect(document.documentElement.style.getPropertyValue('--text-muted')).toBe('#94a3b8');
  });

  test('does not touch --my-status', () => {
    applyPaletteVars('ember');
    resetThemeVars();
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#f97316');
  });
});

// --- enterPaletteMode / exitPaletteMode ---

describe('enterPaletteMode', () => {
  let mockState;
  let setPaletteKeyMock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'ember', activePaletteKey: null },
        '2': { selectedKey: 'volt',  activePaletteKey: null },
      },
    };
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    document.body.innerHTML = `<div id="swatch-row"></div>`;
  });

  test('sets activePaletteKey in stored state', () => {
    enterPaletteMode('ember', 'uid1');
    expect(setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({
        sets: expect.objectContaining({
          '1': expect.objectContaining({ activePaletteKey: 'ember' }),
        }),
      })
    );
  });

  test('calls applyThemeVars — sets --bg to ember theme bg', () => {
    enterPaletteMode('ember', 'uid1');
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#180a02');
  });

  test('re-renders swatch row in palette mode (Key Swatch present)', () => {
    // After setPaletteState, renderSwatchRow calls getPaletteState — return updated state
    getPaletteState
      .mockReturnValueOnce(JSON.parse(JSON.stringify(mockState)))
      .mockReturnValueOnce({
        ...JSON.parse(JSON.stringify(mockState)),
        sets: { '1': { selectedKey: 'ember', activePaletteKey: 'ember' }, '2': { selectedKey: 'volt', activePaletteKey: null } },
      });
    enterPaletteMode('ember', 'uid1');
    expect(document.querySelector('.key-swatch')).not.toBeNull();
  });

  test('calls setPaletteKey with the entered key', () => {
    const { setPaletteKey } = require('../js/db.js');
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    enterPaletteMode('ember', 'uid1');
    expect(setPaletteKey).toHaveBeenCalledWith('uid1', 'ember');
  });
});

describe('exitPaletteMode', () => {
  let mockState;

  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      activeSet: 1,
      sets: {
        '1': { selectedKey: 'ember', activePaletteKey: 'ember' },
        '2': { selectedKey: 'volt',  activePaletteKey: null },
      },
    };
    document.body.innerHTML = `<div id="swatch-row"></div>`;
    // Apply a theme so we can verify it's reverted
    applyThemeVars({ bg: '#180a02', surface: '#2b1505', surface2: '#3f1f08', text: '#fff1e8', textMuted: '#b06a30' });
  });

  test('clears activePaletteKey in stored state', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    exitPaletteMode('uid1');
    expect(setPaletteState).toHaveBeenCalledWith(
      expect.objectContaining({
        sets: expect.objectContaining({
          '1': expect.objectContaining({ activePaletteKey: null }),
        }),
      })
    );
  });

  test('calls resetThemeVars — reverts --bg to slate default', () => {
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    exitPaletteMode('uid1');
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#0f172a');
  });

  test('preserves --my-status (does not clear status color)', () => {
    applyPaletteVars('ember');
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    exitPaletteMode('uid1');
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#f97316');
  });

  test('calls setPaletteKey with null', () => {
    const { setPaletteKey } = require('../js/db.js');
    getPaletteState.mockReturnValue(JSON.parse(JSON.stringify(mockState)));
    exitPaletteMode('uid1');
    expect(setPaletteKey).toHaveBeenCalledWith('uid1', null);
  });
});

// --- tapSwatch two-tap behavior ---

describe('tapSwatch two-tap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = `
      <div id="swatch-row">
        <div class="swatch selected" data-key="ember"></div>
      </div>`;
  });

  test('second tap on already-selected swatch (not in palette mode) calls enterPaletteMode', () => {
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: { '1': { selectedKey: 'ember', activePaletteKey: null }, '2': { selectedKey: 'volt', activePaletteKey: null } },
    });
    tapSwatch('ember', 'uid1');
    // enterPaletteMode should set --bg to ember theme
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#180a02');
  });

  test('first tap on a different swatch in palette mode calls exitPaletteMode then sets new color', () => {
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: { '1': { selectedKey: 'ember', activePaletteKey: 'ember' }, '2': { selectedKey: 'volt', activePaletteKey: null } },
    });
    tapSwatch('coral', 'uid1');
    // exitPaletteMode should have reset theme
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#0f172a');
    // New color should be applied
    expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#f43f5e');
  });
});

// --- palette mode swatch layout ---

describe('palette mode swatch layout', () => {
  function setupPaletteMode(activePaletteKey) {
    const idx = PALETTE_SETS[1].findIndex(p => p.key === activePaletteKey);
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: { '1': { selectedKey: activePaletteKey, activePaletteKey }, '2': { selectedKey: 'volt', activePaletteKey: null } },
    });
    document.body.innerHTML = `<div id="swatch-row"></div>`;
    initSwatches('uid1');
    return idx;
  }

  test('K=0 (forest): Key Swatch at position 0', () => {
    setupPaletteMode('forest');
    const swatches = document.querySelectorAll('.swatch');
    expect(swatches[0].classList.contains('key-swatch')).toBe(true);
    expect(swatches[1].classList.contains('key-swatch')).toBe(false);
  });

  test('K=3 (ember): Key Swatch at position 3', () => {
    setupPaletteMode('ember');
    const swatches = document.querySelectorAll('.swatch');
    expect(swatches[3].classList.contains('key-swatch')).toBe(true);
    expect(swatches[2].classList.contains('key-swatch')).toBe(false);
    expect(swatches[4].classList.contains('key-swatch')).toBe(false);
  });

  test('K=7 (mint): Key Swatch at position 7', () => {
    setupPaletteMode('mint');
    const swatches = document.querySelectorAll('.swatch');
    expect(swatches[7].classList.contains('key-swatch')).toBe(true);
    expect(swatches[6].classList.contains('key-swatch')).toBe(false);
  });

  test('8 total swatches in palette mode', () => {
    setupPaletteMode('ember');
    expect(document.querySelectorAll('.swatch')).toHaveLength(8);
  });

  test('tapping Key Swatch calls exitPaletteMode', () => {
    setupPaletteMode('forest');
    // Re-set getPaletteState for the exitPaletteMode call
    getPaletteState.mockReturnValue({
      activeSet: 1,
      sets: { '1': { selectedKey: 'forest', activePaletteKey: 'forest' }, '2': { selectedKey: 'volt', activePaletteKey: null } },
    });
    document.querySelector('.key-swatch').click();
    // exitPaletteMode resets theme
    expect(document.documentElement.style.getPropertyValue('--bg')).toBe('#0f172a');
  });
});
```

Also update the require at the top to include new exports:
```js
const {
  PALETTE_SETS, getPaletteByKey, getGlowForColor, applyPaletteVars,
  applyThemeVars, resetThemeVars,
  tapSwatch, initSwatches, switchSet,
  enterPaletteMode, exitPaletteMode,
} = require('../js/palettes.js');
```

And add `setPaletteKey` mock to the `jest.mock('../js/db.js', ...)` block:
```js
jest.mock('../js/db.js', () => ({
  setStatusColor: jest.fn().mockResolvedValue(undefined),
  setPaletteKey: jest.fn().mockResolvedValue(undefined),
}));
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest tests/palettes.test.js --no-coverage
```

Expected: FAIL — `applyThemeVars is not a function` and multiple other failures

- [ ] **Step 3: Implement `applyThemeVars`, `resetThemeVars`, `enterPaletteMode`, `exitPaletteMode` in `js/palettes.js`**

Add import for `setPaletteKey` at the top of `palettes.js`:
```js
import { setPaletteKey } from './db.js';
```

Add these new exported functions after `applyPaletteVars`:

```js
export function applyThemeVars(theme) {
  const r = document.documentElement;
  r.style.setProperty('--bg',         theme.bg);
  r.style.setProperty('--surface',    theme.surface);
  r.style.setProperty('--surface2',   theme.surface2);
  r.style.setProperty('--text',       theme.text);
  r.style.setProperty('--text-muted', theme.textMuted);
}

export function resetThemeVars() {
  const r = document.documentElement;
  r.style.setProperty('--bg',         '#0f172a');
  r.style.setProperty('--surface',    '#1e293b');
  r.style.setProperty('--surface2',   '#334155');
  r.style.setProperty('--text',       '#f1f5f9');
  r.style.setProperty('--text-muted', '#94a3b8');
}

export function enterPaletteMode(key, userId) {
  const state = getPaletteState();
  state.sets[String(state.activeSet)].activePaletteKey = key;
  setPaletteState(state);
  const palette = getPaletteByKey(key);
  applyThemeVars(palette.theme);
  setPaletteKey(userId, key).catch(() => {});
  renderSwatchRow(userId);
}

export function exitPaletteMode(userId) {
  const state = getPaletteState();
  state.sets[String(state.activeSet)].activePaletteKey = null;
  setPaletteState(state);
  resetThemeVars();
  setPaletteKey(userId, null).catch(() => {});
  renderSwatchRow(userId);
}
```

- [ ] **Step 4: Update `tapSwatch` for two-tap behavior**

Replace the existing `tapSwatch` export:

```js
export function tapSwatch(key, userId) {
  const state = getPaletteState();
  const setKey = String(state.activeSet);
  const currentlySelected = state.sets[setKey].selectedKey;
  const inPaletteMode = state.sets[setKey].activePaletteKey !== null;

  if (inPaletteMode) {
    // Tapping any non-Key swatch in palette mode: exit first, then apply new color
    exitPaletteMode(userId);
    // Re-read state after exit
    const freshState = getPaletteState();
    freshState.sets[setKey].selectedKey = key;
    setPaletteState(freshState);
    const palette = getPaletteByKey(key);
    setStatusColor(userId, palette.color).catch(() => {});
    applyPaletteVars(key);
    const row = document.getElementById('swatch-row');
    row.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
    const target = row.querySelector(`[data-key="${key}"]`);
    if (target) target.classList.add('selected');
    return;
  }

  if (key === currentlySelected) {
    // Second tap on already-selected swatch: enter palette mode
    enterPaletteMode(key, userId);
    return;
  }

  // First tap on unselected swatch: status color change only
  state.sets[setKey].selectedKey = key;
  setPaletteState(state);
  const palette = getPaletteByKey(key);
  setStatusColor(userId, palette.color).catch(() => {});
  applyPaletteVars(key);
  const row = document.getElementById('swatch-row');
  row.querySelectorAll('.swatch').forEach(s => s.classList.remove('selected'));
  const target = row.querySelector(`[data-key="${key}"]`);
  if (target) target.classList.add('selected');
}
```

- [ ] **Step 5: Update `renderSwatchRow` to handle palette mode**

Replace the existing `renderSwatchRow` function:

```js
function renderSwatchRow(userId) {
  const row = document.getElementById('swatch-row');
  row.innerHTML = '';
  const state = getPaletteState();
  const setNum = state.activeSet;
  const setKey = String(setNum);
  const savedKey = state.sets[setKey].selectedKey;
  const activePaletteKey = state.sets[setKey].activePaletteKey;

  // Toggle button
  const btn = document.createElement('button');
  btn.className = 'set-toggle-btn';
  btn.innerHTML = setNum === 1 ? ICON_BOLT : ICON_TREE;
  btn.addEventListener('click', () => switchSet(setNum === 1 ? 2 : 1, userId));
  row.appendChild(btn);

  if (!activePaletteKey) {
    // Base mode: 8 swatches for active set
    PALETTE_SETS[setNum].forEach(p => {
      const swatch = document.createElement('div');
      swatch.className = 'swatch';
      swatch.dataset.key = p.key;
      swatch.style.background = p.color;
      if (p.key === savedKey) swatch.classList.add('selected');
      swatch.addEventListener('click', () => tapSwatch(p.key, userId));
      row.appendChild(swatch);
    });
  } else {
    // Palette mode: Key Swatch at index K, complement swatches at other positions
    const keyPalette = getPaletteByKey(activePaletteKey);
    const keyIdx = PALETTE_SETS[setNum].findIndex(p => p.key === activePaletteKey);
    const complements = keyPalette.complements;
    let ci = 0;

    for (let i = 0; i < 8; i++) {
      const swatch = document.createElement('div');
      if (i === keyIdx) {
        swatch.className = 'swatch key-swatch';
        swatch.style.background = keyPalette.color;
        swatch.addEventListener('click', () => exitPaletteMode(userId));
      } else {
        const color = complements[ci++];
        swatch.className = 'swatch';
        swatch.style.background = color;
        swatch.addEventListener('click', () => {
          exitPaletteMode(userId);
          // Apply the complement color as status color directly
          document.documentElement.style.setProperty('--my-status', color);
          setStatusColor(userId, color).catch(() => {});
        });
      }
      row.appendChild(swatch);
    }
  }
}
```

Note: Tapping a complement swatch in palette mode exits palette mode and applies the complement color. This matches the prototype behavior (not stored as a named palette key, just a raw color). The spec says "tapping any non-Key swatch in palette mode calls `exitPaletteMode` then `tapSwatch` normally" — but complement swatches aren't palette keys, so we exit and apply the color directly.

- [ ] **Step 6: Update `switchSet` to apply/reset theme vars**

Replace the existing `switchSet` export:

```js
export function switchSet(toSet, userId) {
  const state = getPaletteState();
  state.activeSet = toSet;
  setPaletteState(state);

  const targetSetKey = String(toSet);
  const selectedKey = state.sets[targetSetKey].selectedKey;
  const activePaletteKey = state.sets[targetSetKey].activePaletteKey;
  const palette = getPaletteByKey(selectedKey);

  applyPaletteVars(selectedKey);
  setStatusColor(userId, palette.color).catch(() => {});

  if (activePaletteKey) {
    applyThemeVars(getPaletteByKey(activePaletteKey).theme);
  } else {
    resetThemeVars();
  }

  renderSwatchRow(userId);
}
```

- [ ] **Step 7: Run tests**

```bash
npx jest tests/palettes.test.js --no-coverage
```

Expected: PASS — all palettes tests green

- [ ] **Step 8: Run full suite**

```bash
npx jest --no-coverage
```

Expected: PASS — all tests green

- [ ] **Step 9: Commit**

```bash
git add js/palettes.js tests/palettes.test.js
git commit -m "feat(inc2): add two-tap palette mode, enterPaletteMode, exitPaletteMode, theme vars"
```

---

### Task 2.3: css/app.css — Key Swatch Styles

**Files:**
- Modify: `css/app.css`

- [ ] **Step 1: Add key-swatch CSS to `css/app.css`**

Add after the `.swatch.selected` block:

```css
.swatch.key-swatch {
  border-color: white;
  box-shadow: 0 0 0 2px rgba(255,255,255,0.25);
  position: relative;
}
.swatch.key-swatch::after {
  content: ''; position: absolute; inset: -6px; border-radius: 50%;
  border: 1.5px dashed rgba(255,255,255,0.65);
  animation: key-spin 4s linear infinite; pointer-events: none;
}
@keyframes key-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
```

- [ ] **Step 2: Run full suite**

```bash
npx jest --no-coverage
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add css/app.css
git commit -m "feat(inc2): add key-swatch spinning ring CSS"
```

---

### Task 2.4: app.js — Restore Palette Mode on Startup

**Files:**
- Modify: `js/app.js`
- Test: No automated test (startup integration — manual verification)

If `activePaletteKey` is set in the stored state for the active set, `app.js` must call `applyThemeVars` before first paint to avoid a theme flash, and re-render the swatch row in palette mode after `initSwatches` runs.

- [ ] **Step 1: Update `js/app.js` imports and the palette startup block**

Update the imports at the top of `app.js`:

```js
import { PALETTES_ENABLED } from './features.js';
import { applyPaletteVars, applyThemeVars, getPaletteByKey, initSwatches } from './palettes.js';
import { getPaletteState } from './store.js';
```

Replace the existing palette startup block in `main()`:

```js
if (PALETTES_ENABLED) {
  document.getElementById('swatch-row').style.display = '';
  const paletteState = getPaletteState();
  const activeSetKey = String(paletteState.activeSet);
  const { selectedKey, activePaletteKey } = paletteState.sets[activeSetKey];
  // Apply status color vars before first paint
  applyPaletteVars(selectedKey);
  // If stored in palette mode, apply theme before first paint (avoids flash)
  if (activePaletteKey) {
    applyThemeVars(getPaletteByKey(activePaletteKey).theme);
  }
  initSwatches(userId);
}
```

- [ ] **Step 2: Run full suite**

```bash
npx jest --no-coverage
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat(inc2): restore palette mode theme on startup to avoid flash"
```

---

## Chunk 3: Increment 3 — Palette Cards

### Task 3.1: palettes.js — `getPaletteByKey` Returns null for Unknown Keys

**Files:**
- Modify: `js/palettes.js`
- Test: `tests/palettes.test.js`

The spec requires `getPaletteByKey` to return `null` for unknown keys in Increment 3, so `following.js` can distinguish "found" from "not found". Callers that need a non-null fallback (like `applyPaletteVars`) must handle null explicitly.

- [ ] **Step 1: Update the `getPaletteByKey` fallback test in `palettes.test.js`**

Replace:
```js
test('getPaletteByKey falls back to forest for unknown key', () => {
  const p = getPaletteByKey('nonexistent');
  expect(p.key).toBe('forest');
});
```

With:
```js
test('getPaletteByKey returns null for unknown key', () => {
  expect(getPaletteByKey('nonexistent')).toBeNull();
});
```

Also update `applyPaletteVars` fallback test:
```js
test('applyPaletteVars falls back to forest for unknown key', () => {
  applyPaletteVars('nonexistent');
  expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#22c55e');
});
```
(This test should still pass after the change because `applyPaletteVars` will handle null internally.)

- [ ] **Step 2: Run to confirm the fallback test now fails**

```bash
npx jest tests/palettes.test.js --no-coverage
```

Expected: FAIL — `getPaletteByKey returns null for unknown key`

- [ ] **Step 3: Update `getPaletteByKey` to return null, update `applyPaletteVars` to handle null**

In `js/palettes.js`, replace `getPaletteByKey`:

```js
export function getPaletteByKey(key) {
  for (const set of [PALETTE_SETS[1], PALETTE_SETS[2]]) {
    const found = set.find(p => p.key === key);
    if (found) return found;
  }
  return null; // callers that need a non-null default must handle this
}
```

Update `applyPaletteVars` to handle null:

```js
export function applyPaletteVars(key) {
  const p = getPaletteByKey(key) || PALETTE_SETS[1][0]; // forest fallback
  document.documentElement.style.setProperty('--my-status', p.color);
  document.documentElement.style.setProperty('--my-glow', p.glow);
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/palettes.test.js --no-coverage
```

Expected: PASS

- [ ] **Step 5: Run full suite**

```bash
npx jest --no-coverage
```

Expected: PASS — confirm `getGlowForColor` still works (it doesn't call `getPaletteByKey`)

- [ ] **Step 6: Commit**

```bash
git add js/palettes.js tests/palettes.test.js
git commit -m "feat(inc3): getPaletteByKey returns null for unknown keys"
```

---

### Task 3.2: css/app.css — Border Left for Person Cards

**Files:**
- Modify: `css/app.css`

The palette card spec sets `li.style.borderLeftColor`. The `.person-list li` rule currently has no border-left, so a border-left with transparent color must be added as a base style.

- [ ] **Step 1: Add `border-left` to `.person-list li` in `css/app.css`**

Find the `.person-list li` rule (currently: `background: var(--surface); border-radius: 10px; ...`). Add `border-left: 3px solid transparent;` to it:

```css
.person-list li {
  background: var(--surface); border-radius: 10px; padding: 0.75rem 0.875rem;
  display: flex; align-items: center; gap: 0.75rem;
  margin-bottom: 0.5rem; list-style: none;
  border-left: 3px solid transparent;
}
```

- [ ] **Step 2: Run full suite**

```bash
npx jest --no-coverage
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add css/app.css
git commit -m "feat(inc3): add transparent border-left to person list items for palette card indicator"
```

---

### Task 3.3: following.js — Palette Card Styling

**Files:**
- Modify: `js/following.js`
- Test: `tests/following.test.js`

Update `updateFolloweeRow` to apply palette card styling when `userData.paletteKey` is set and `PALETTES_ENABLED` is true. If the key is unknown (`getPaletteByKey` returns null), fall back to default CSS behavior and clear any inline styles.

Styling applied per spec (name color is **not** changed):
- `li.style.background = palette.theme.surface`
- `li.style.borderLeftColor = isAvail ? palette.color : 'transparent'`
- `statusEl.style.color = palette.theme.textMuted`
- When available: `statusEl.querySelector('.status-available').style.color = palette.color`

When no palette or unknown key: clear all three inline styles.

- [ ] **Step 1: Write failing tests in `tests/following.test.js`**

First, update the mock at the top to include `getPaletteByKey`:

```js
jest.mock('../js/palettes.js', () => ({
  getGlowForColor: jest.fn(() => 'rgba(34,197,94,0.4)'),
  getPaletteByKey: jest.fn(),
}));
```

Add `getPaletteByKey` to the require:
```js
const { getGlowForColor, getPaletteByKey } = require('../js/palettes.js');
```

Add a new describe block at the end of the file for palette card tests. You'll need a helper to trigger `updateFolloweeRow` by simulating a watchStatus callback. Look at the existing test patterns in the file for how to do this (call `initAndCaptureFollowersCallback`, render an entry, then trigger `watchStatus` callback with userData). Here is the test block to add:

```js
// --- Palette Cards (Increment 3) ---

describe('palette card styling', () => {
  const OCEAN_PALETTE = {
    key: 'ocean', color: '#3b82f6', glow: 'rgba(59,130,246,0.4)',
    theme: { bg: '#05101e', surface: '#0b1e38', surface2: '#102c52', text: '#eef4ff', textMuted: '#5f9acf' },
    complements: [],
  };

  function setupOneFollowee(paletteKey) {
    setupDom();
    getFollowing.mockReturnValue([{ userId: 'user1', code: 'ABC123', label: 'Jordan' }]);

    let watchStatusCallback;
    watchStatus.mockImplementation((_uid, cb) => {
      watchStatusCallback = cb;
      return jest.fn();
    });

    const triggerFollowers = initAndCaptureFollowersCallback();
    triggerFollowers([]);           // no followers — 'Jordan' appears in Following section

    // Trigger watchStatus with palette data
    watchStatusCallback({ status: 'available', availableUntil: Date.now() + 3600000, paletteKey });
    return document.querySelector('[data-user-id="user1"]');
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const VOLT_PALETTE = {
    key: 'volt', color: '#aaff00', glow: 'rgba(170,255,0,0.4)',
    theme: { bg: '#0e1700', surface: '#192500', surface2: '#243600', text: '#f4ffe6', textMuted: '#88cc33' },
    complements: [],
  };

  test('card with known Set 1 paletteKey gets palette.theme.surface as background', () => {
    getPaletteByKey.mockReturnValue(OCEAN_PALETTE);
    const li = setupOneFollowee('ocean');
    expect(li.style.background).toBe('#0b1e38');
  });

  test('card with known Set 2 paletteKey gets palette.theme.surface as background', () => {
    getPaletteByKey.mockReturnValue(VOLT_PALETTE);
    const li = setupOneFollowee('volt');
    expect(li.style.background).toBe('#192500');
  });

  test('card with known paletteKey gets palette.color as borderLeftColor when available', () => {
    getPaletteByKey.mockReturnValue(OCEAN_PALETTE);
    const li = setupOneFollowee('ocean');
    expect(li.style.borderLeftColor).toBe('#3b82f6');
  });

  test('card with known paletteKey gets palette.theme.textMuted as status text color', () => {
    getPaletteByKey.mockReturnValue(OCEAN_PALETTE);
    const li = setupOneFollowee('ocean');
    const statusEl = li.querySelector('.person-status');
    expect(statusEl.style.color).toBe('#5f9acf');
  });

  test('available span inside status gets palette.color when available', () => {
    getPaletteByKey.mockReturnValue(OCEAN_PALETTE);
    const li = setupOneFollowee('ocean');
    const span = li.querySelector('.status-available');
    expect(span).not.toBeNull();
    expect(span.style.color).toBe('#3b82f6');
  });

  test('card with paletteKey: null renders with default CSS, no inline background', () => {
    getPaletteByKey.mockReturnValue(null);
    const li = setupOneFollowee(null);
    expect(li.style.background).toBe('');
  });

  test('card with unknown paletteKey string falls back to default CSS, no inline background', () => {
    getPaletteByKey.mockReturnValue(null);
    const li = setupOneFollowee('unknown-palette');
    expect(li.style.background).toBe('');
  });

  test('card without paletteKey field renders with default CSS (no regression)', () => {
    getPaletteByKey.mockReturnValue(null);
    const li = setupOneFollowee(undefined);
    expect(li.style.background).toBe('');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx jest tests/following.test.js --no-coverage
```

Expected: FAIL — palette card styling not applied

- [ ] **Step 3: Update `updateFolloweeRow` in `js/following.js`**

Update the import at the top of `following.js` to also import `getPaletteByKey`:

```js
import { PALETTES_ENABLED } from './features.js';
import { getGlowForColor, getPaletteByKey } from './palettes.js';
```

At the end of `updateFolloweeRow`, after `if (statusEl) statusEl.innerHTML = statusText;`, add the palette card styling block:

```js
  // Palette card styling (Increment 3)
  if (PALETTES_ENABLED && userData.paletteKey) {
    const palette = getPaletteByKey(userData.paletteKey);
    if (palette) {
      li.style.background      = palette.theme.surface;
      li.style.borderLeftColor = isAvail ? palette.color : 'transparent';
      statusEl.style.color     = palette.theme.textMuted;
      if (isAvail) {
        const availableSpan = statusEl.querySelector('.status-available');
        if (availableSpan) availableSpan.style.color = palette.color;
      }
    } else {
      // Unknown key — clear any previously set inline styles
      li.style.background      = '';
      li.style.borderLeftColor = '';
      statusEl.style.color     = '';
    }
  } else {
    li.style.background      = '';
    li.style.borderLeftColor = '';
    if (statusEl) statusEl.style.color = '';
  }
```

- [ ] **Step 4: Run tests**

```bash
npx jest tests/following.test.js --no-coverage
```

Expected: PASS

- [ ] **Step 5: Run full suite**

```bash
npx jest --no-coverage
```

Expected: PASS — all tests green

- [ ] **Step 6: Commit**

```bash
git add js/following.js tests/following.test.js
git commit -m "feat(inc3): apply palette card styling in updateFolloweeRow"
```

---
