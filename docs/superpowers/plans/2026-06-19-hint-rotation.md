# Hint Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-row, multi-card longpress/swipe hint placement with a single
rotating spotlight that shows one hint at a time, on a fully-visible card, biased to
available people, alternating type and cycling cards.

**Architecture:** A new `js/hintRotation.js` owns ALL hint DOM. The two row-paint
functions (`updateFolloweeRow` in `following.js`, `paintRosterRow` in `groupContext.js`)
stop placing hint elements and instead **stamp eligibility data-attributes**
(`data-hint-longpress`, `data-hint-swipe`, `data-hint-avail`) on their rows. The engine
reads those attributes from the active context's list container, applies visibility +
prefer-available, runs a 6.85 s rotation with two independent per-type round-robin
pointers, and places exactly one `.longpress-hint`/`.swipe-hint` at a time. A pure core
(`resolvePool` / `selectNextHint` / `isPaused`) holds the algorithm and is unit-tested
without DOM.

**Tech Stack:** vanilla ES modules, esbuild, Jest (jsdom). Spec:
`docs/superpowers/specs/2026-06-19-hint-rotation-design.md`.

---

## File Structure

- **Create `js/hintRotation.js`** — the single owner of hint DOM. Pure core
  (`resolvePool`, `selectNextHint`, `isPaused`) + engine (collect candidates, visibility,
  pause detection, timer, placement, `initHintRotation`, `refreshHints`,
  `stopHintRotation`).
- **Create `tests/hintRotation.test.js`** — unit tests for the pure core + jsdom tests
  for candidate collection, placement, and pause-flag detection.
- **Modify `js/following.js`** — replace the hint-placement block (963–1026) with
  attribute stamping; delete `_hintAlternateTimer`/`_hintAlternateShow` (56–57) and
  `refreshLongpressHints` + its `my-combo-changed` listener (1047–1065); call
  `refreshHints()` after stamping.
- **Modify `js/groupContext.js`** — replace the longpress block (405–419) with attribute
  stamping; call `refreshHints()` after stamping.
- **Modify `js/app.js`** — call `initHintRotation()` once at boot.
- **Modify `tests/following.test.js`, `tests/groupContext.test.js`** — convert existing
  hint-DOM assertions to the new data-attribute assertions.

---

## Task 1: Pure rotation core

**Files:**
- Create: `js/hintRotation.js`
- Test: `tests/hintRotation.test.js`

- [ ] **Step 1: Write failing tests for `resolvePool`**

Create `tests/hintRotation.test.js`:

```javascript
// tests/hintRotation.test.js
const { resolvePool, selectNextHint, isPaused } = require('../js/hintRotation.js');

describe('resolvePool', () => {
  const vis = (set) => (id) => set.has(id);

  test('returns only available ids when any visible candidate is available', () => {
    const cands = [
      { id: 'a', available: false },
      { id: 'b', available: true },
      { id: 'c', available: true },
    ];
    expect(resolvePool(cands, vis(new Set(['a', 'b', 'c'])))).toEqual(['b', 'c']);
  });

  test('falls back to visible unavailable ids when none visible is available', () => {
    const cands = [
      { id: 'a', available: false },
      { id: 'b', available: false },
    ];
    expect(resolvePool(cands, vis(new Set(['a', 'b'])))).toEqual(['a', 'b']);
  });

  test('an available-but-offscreen candidate does not block a visible unavailable one', () => {
    const cands = [
      { id: 'off', available: true },   // not visible
      { id: 'on', available: false },   // visible
    ];
    expect(resolvePool(cands, vis(new Set(['on'])))).toEqual(['on']);
  });

  test('returns empty when nothing is visible', () => {
    const cands = [{ id: 'a', available: true }];
    expect(resolvePool(cands, vis(new Set()))).toEqual([]);
  });

  test('preserves input order', () => {
    const cands = [
      { id: 'x', available: true },
      { id: 'y', available: true },
    ];
    expect(resolvePool(cands, vis(new Set(['x', 'y'])))).toEqual(['x', 'y']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/hintRotation.test.js -t resolvePool`
Expected: FAIL — "Cannot find module '../js/hintRotation.js'".

- [ ] **Step 3: Create `js/hintRotation.js` with `resolvePool`**

```javascript
// js/hintRotation.js
//
// Single owner of the FTU longpress/swipe hint animations. Row-paint code in
// following.js (Direct) and groupContext.js (group) stamps eligibility
// data-attributes (data-hint-longpress / data-hint-swipe / data-hint-avail) on
// each row; this module reads them from the active context's list and animates
// exactly ONE hint at a time, alternating type and rotating cards. See
// docs/superpowers/specs/2026-06-19-hint-rotation-design.md.

// ── Pure core ────────────────────────────────────────────────────────────────

// Given candidates [{ id, available }] (already eligibility-filtered, in order)
// and an isVisible(id) predicate, return the ordered list of ids that may show:
// visible-only (B4); within visible, prefer available, else fall back to visible
// unavailable (B5 / Interpretation Y).
export function resolvePool(candidates, isVisible) {
  const visible = (candidates || []).filter((c) => c && isVisible(c.id));
  if (visible.length === 0) return [];
  const available = visible.filter((c) => c.available);
  const pool = available.length ? available : visible;
  return pool.map((c) => c.id);
}
```

> This module is **pure ESM** (`export` only — no `module.exports`), matching the other
> app modules (e.g. `following.js`). Jest requires it via babel's ESM→CJS interop, the
> same way `tests/following.test.js` does `require('../js/following.js')`.

- [ ] **Step 4: Run tests to verify `resolvePool` passes**

Run: `npx jest tests/hintRotation.test.js -t resolvePool`
Expected: PASS (5 tests).

- [ ] **Step 5: Write failing tests for `selectNextHint`**

Append to `tests/hintRotation.test.js`:

```javascript
describe('selectNextHint', () => {
  const fresh = () => ({ lastType: null, lastIds: { longpress: null, swipe: null } });

  test('returns {type:null} when both pools are empty', () => {
    const r = selectNextHint(fresh(), { longpress: [], swipe: [] });
    expect(r.type).toBeNull();
    expect(r.id).toBeNull();
  });

  test('single non-empty pool: no type flip, round-robins and wraps', () => {
    let s = fresh();
    let r = selectNextHint(s, { longpress: ['a', 'b'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'a']);
    r = selectNextHint(r.state, { longpress: ['a', 'b'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'b']);
    r = selectNextHint(r.state, { longpress: ['a', 'b'], swipe: [] });
    expect([r.type, r.id]).toEqual(['longpress', 'a']); // wrap
  });

  test('both pools: type alternates every step', () => {
    let r = selectNextHint(fresh(), { longpress: ['a'], swipe: ['a'] });
    const types = [r.type];
    for (let i = 0; i < 3; i++) {
      r = selectNextHint(r.state, { longpress: ['a'], swipe: ['a'] });
      types.push(r.type);
    }
    expect(types).toEqual(['longpress', 'swipe', 'longpress', 'swipe']);
  });

  test('each type round-robins its OWN list independently while alternating', () => {
    const pools = { longpress: ['A', 'C'], swipe: ['A', 'B', 'C'] };
    let r = selectNextHint(fresh(), pools);
    const seq = [[r.type, r.id]];
    for (let i = 0; i < 5; i++) {
      r = selectNextHint(r.state, pools);
      seq.push([r.type, r.id]);
    }
    // longpress pointer: A, C, A ; swipe pointer: A, B, C
    expect(seq).toEqual([
      ['longpress', 'A'],
      ['swipe', 'A'],
      ['longpress', 'C'],
      ['swipe', 'B'],
      ['longpress', 'A'],
      ['swipe', 'C'],
    ]);
  });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `npx jest tests/hintRotation.test.js -t selectNextHint`
Expected: FAIL — "selectNextHint is not a function".

- [ ] **Step 7: Add `selectNextHint`**

In `js/hintRotation.js`, add above `module.exports`:

```javascript
// Pick the next single hint. state = { lastType, pointers: { longpress, swipe } }.
// pools = { longpress: [id...], swipe: [id...] } (already resolved/ordered).
// Alternate type between the types that currently have a pool; advance that
// type's own round-robin pointer. Returns { type, id, state } (type/id null when
// nothing is showable).
export function selectNextHint(state, pools) {
  const types = [];
  if (pools.longpress && pools.longpress.length) types.push('longpress');
  if (pools.swipe && pools.swipe.length) types.push('swipe');
  if (types.length === 0) return { type: null, id: null, state: { ...state } };

  const type = types.length === 1
    ? types[0]
    : (state.lastType === 'longpress' ? 'swipe' : 'longpress');

  const pool = pools[type];
  const prev = state.pointers[type] ?? -1;
  const idx = (prev + 1) % pool.length;
  return {
    type,
    id: pool[idx],
    state: { lastType: type, pointers: { ...state.pointers, [type]: idx } },
  };
}
```

(`export function` makes it requirable in the test — no `module.exports` needed.)

- [ ] **Step 8: Run to verify `selectNextHint` passes**

Run: `npx jest tests/hintRotation.test.js -t selectNextHint`
Expected: PASS.

- [ ] **Step 9: Write failing tests for `isPaused`**

Append to `tests/hintRotation.test.js`:

```javascript
describe('isPaused', () => {
  const none = { overlayOpen: false, callActive: false, hidden: false, scrolling: false };
  test('false when nothing is set', () => { expect(isPaused(none)).toBe(false); });
  test('true if any single flag is set', () => {
    for (const k of ['overlayOpen', 'callActive', 'hidden', 'scrolling']) {
      expect(isPaused({ ...none, [k]: true })).toBe(true);
    }
  });
});
```

- [ ] **Step 10: Run to verify they fail**

Run: `npx jest tests/hintRotation.test.js -t isPaused`
Expected: FAIL — "isPaused is not a function".

- [ ] **Step 11: Add `isPaused`**

In `js/hintRotation.js`, add above `module.exports`:

```javascript
// Pure pause predicate (B6). Engine computes the flags from the DOM/app state.
export function isPaused({ overlayOpen, callActive, hidden, scrolling }) {
  return !!(overlayOpen || callActive || hidden || scrolling);
}
```

- [ ] **Step 12: Run the whole file; confirm green**

Run: `npx jest tests/hintRotation.test.js`
Expected: PASS (all describe blocks).

- [ ] **Step 13: Commit**

```bash
git add js/hintRotation.js tests/hintRotation.test.js
git commit -m "feat: pure rotation core for hint scheduling (resolvePool/selectNextHint/isPaused)"
```

---

## Task 2: Engine — collection, placement, pause flags, timer

**Files:**
- Modify: `js/hintRotation.js`
- Test: `tests/hintRotation.test.js`

- [ ] **Step 1: Add dep mocks at the top of the test file, then write collection/placement tests**

Because Task 2 adds imports to `hintRotation.js` (`groupNav`, `cardDrawer`, `notifyBell`,
`following`), add these `jest.mock` calls at the VERY TOP of `tests/hintRotation.test.js`
(Jest hoists them above the existing `require`s), so the suite never loads those real
modules:

```javascript
jest.mock('../js/groupNav.js', () => ({ getCurrentContext: jest.fn(() => ({ context: 'direct', groupId: null })) }));
jest.mock('../js/cardDrawer.js', () => ({ isCardDrawerOpen: jest.fn(() => false) }));
jest.mock('../js/notifyBell.js', () => ({ isNotifyPopoverOpen: jest.fn(() => false) }));
jest.mock('../js/following.js', () => ({
  getCallModeCalleeId: jest.fn(() => null),
  getIncomingCallFrom: jest.fn(() => null),
}));
```

Then append the collection/placement tests:

```javascript
const {
  _collectCandidates, _placeHint, _clearActive, _resetEngineForTest,
} = require('../js/hintRotation.js');

describe('engine: _collectCandidates', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <ul id="people-list">
        <li data-user-id="a" data-hint-longpress="1" data-hint-swipe="1" data-hint-avail="1"></li>
        <li data-user-id="b" data-hint-longpress="0" data-hint-swipe="1" data-hint-avail="0"></li>
        <li data-user-id="c" data-hint-longpress="1" data-hint-swipe="0" data-hint-avail="1"></li>
      </ul>`;
  });

  test('reads data-hint-* attributes from #people-list in DOM order', () => {
    const pools = _collectCandidates(document.getElementById('people-list'));
    expect(pools.longpress.map((c) => [c.id.dataset.userId, c.available]))
      .toEqual([['a', true], ['c', true]]);
    expect(pools.swipe.map((c) => [c.id.dataset.userId, c.available]))
      .toEqual([['a', true], ['b', false]]);
  });
});

describe('engine: placement', () => {
  beforeEach(() => {
    _resetEngineForTest();
    document.body.innerHTML = `<ul id="people-list"><li data-user-id="a"></li></ul>`;
  });

  test('_placeHint adds exactly one hint element of the right class', () => {
    const li = document.querySelector('[data-user-id="a"]');
    _placeHint(li, 'longpress');
    expect(document.querySelectorAll('.longpress-hint').length).toBe(1);
    expect(li.querySelector('.longpress-hint')).not.toBeNull();
  });

  test('_placeHint swaps to a single element when the type changes on the same card', () => {
    const li = document.querySelector('[data-user-id="a"]');
    _placeHint(li, 'longpress');
    _placeHint(li, 'swipe');
    expect(document.querySelectorAll('.longpress-hint, .swipe-hint').length).toBe(1);
    expect(li.querySelector('.swipe-hint')).not.toBeNull();
  });

  test('_clearActive removes all hint elements document-wide', () => {
    const li = document.querySelector('[data-user-id="a"]');
    _placeHint(li, 'longpress');
    _clearActive();
    expect(document.querySelectorAll('.longpress-hint, .swipe-hint').length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/hintRotation.test.js -t "engine:"`
Expected: FAIL — `_collectCandidates`/`_placeHint`/etc. undefined.

- [ ] **Step 3: Add engine state, collection, and placement**

In `js/hintRotation.js`, replace the imports/top with the real module imports and add
engine internals. At the TOP of the file (after the header comment) add:

```javascript
import { getCurrentContext } from './groupNav.js';
import { isCardDrawerOpen } from './cardDrawer.js';
import { isNotifyPopoverOpen } from './notifyBell.js';
import { getCallModeCalleeId, getIncomingCallFrom } from './following.js';
```

> Note: `following.js` will import `refreshHints` from this module — that import cycle
> is fine because both sides are used only at call time, never at module-eval time.

Then, above `module.exports`, add the engine:

```javascript
// ── Engine state ─────────────────────────────────────────────────────────────
const STEP_MS = 6850;
const CONTAINER_BY_CONTEXT = { direct: '#people-list', group: '#group-roster' };

let _state = { lastType: null, lastIds: { longpress: null, swipe: null } };
let _active = null;        // { li, type } | null
let _timer = null;
let _scrolling = false;
let _scrollEndTimer = null;
let _started = false;

function _container() {
  const { context } = getCurrentContext();
  return document.querySelector(CONTAINER_BY_CONTEXT[context] || '#people-list');
}

// Read eligibility attributes the row-paint code stamps. container may be passed
// (tests) or resolved from the active context.
export function _collectCandidates(container = _container()) {
  const pools = { longpress: [], swipe: [] };
  if (!container) return pools;
  for (const li of container.querySelectorAll('[data-user-id]')) {
    const available = li.dataset.hintAvail === '1';
    if (li.dataset.hintLongpress === '1') pools.longpress.push({ id: li, available });
    if (li.dataset.hintSwipe === '1') pools.swipe.push({ id: li, available });
  }
  return pools;
}

export function _clearActive() {
  // Engine is the sole owner — sweep ALL hint elements so exactly zero remain.
  document.querySelectorAll('.longpress-hint, .swipe-hint').forEach((el) => el.remove());
  _active = null;
}

export function _placeHint(li, type) {
  if (_active && _active.li === li && _active.type === type && document.contains(li)) return;
  _clearActive();
  const hint = document.createElement('div');
  hint.className = type === 'swipe' ? 'swipe-hint' : 'longpress-hint';
  li.style.position = 'relative';
  li.appendChild(hint);
  _active = { li, type };
}

// Test-only reset so suites start from a clean engine.
export function _resetEngineForTest() {
  _stopTimer();
  _clearActive();
  _state = { lastType: null, lastIds: { longpress: null, swipe: null } };
  _scrolling = false;
  _started = false;
}
```

Add `_stopTimer` (used above) near the timer code:

```javascript
function _stopTimer() { if (_timer) { clearInterval(_timer); _timer = null; } }
```

> All public + test-exported functions use `export` (pure ESM). No `module.exports`.
> The four `_`-prefixed helpers tested here (`_collectCandidates`, `_placeHint`,
> `_clearActive`, `_resetEngineForTest`) are exported for the unit tests; `_container`
> and `_stopTimer` stay private.

- [ ] **Step 4: Run to verify collection + placement pass**

Run: `npx jest tests/hintRotation.test.js -t "engine:"`
Expected: PASS.

- [ ] **Step 5: Write failing test for pause-flag collection**

The dep mocks are already at the top of the file (Step 1). Append the pause-flags test
(it reuses those mocks via `require` handles):

```javascript
const { _collectPauseFlags } = require('../js/hintRotation.js');
const cardDrawer = require('../js/cardDrawer.js');
const notifyBell = require('../js/notifyBell.js');
const following = require('../js/following.js');

describe('engine: _collectPauseFlags', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="add-person-form"></div>
      <div id="code-drawer"></div>
      <div id="create-group-modal" class="hidden"></div>
      <details id="group-context-actions"></details>
      <div id="recovery-revealed" class="hidden"></div>`;
    cardDrawer.isCardDrawerOpen.mockReturnValue(false);
    notifyBell.isNotifyPopoverOpen.mockReturnValue(false);
    following.getCallModeCalleeId.mockReturnValue(null);
    following.getIncomingCallFrom.mockReturnValue(null);
  });

  test('overlayOpen true when the code drawer is open', () => {
    document.getElementById('code-drawer').classList.add('open');
    expect(_collectPauseFlags().overlayOpen).toBe(true);
  });

  test('overlayOpen true when the settings details is open', () => {
    document.getElementById('group-context-actions').open = true;
    expect(_collectPauseFlags().overlayOpen).toBe(true);
  });

  test('callActive true when a call is in progress', () => {
    following.getCallModeCalleeId.mockReturnValue('peer1');
    expect(_collectPauseFlags().callActive).toBe(true);
  });

  test('all flags false in a clean Direct view', () => {
    expect(_collectPauseFlags()).toEqual({
      overlayOpen: false, callActive: false, hidden: false, scrolling: false,
    });
  });
});
```

> Because this test mocks `following.js`, place these `jest.mock` calls at the TOP of
> the file (Jest hoists them). Keep the Task-1 pure tests working — they don't touch
> these mocks.

- [ ] **Step 6: Run to verify they fail**

Run: `npx jest tests/hintRotation.test.js -t _collectPauseFlags`
Expected: FAIL — `_collectPauseFlags` undefined.

- [ ] **Step 7: Add `_collectPauseFlags`**

In `js/hintRotation.js`, add:

```javascript
function _modalOpen(id) {
  const el = document.getElementById(id);
  return !!el && !el.classList.contains('hidden');
}

export function _collectPauseFlags() {
  const recovery = document.getElementById('recovery-revealed');
  const overlayOpen =
    isCardDrawerOpen() ||
    !!document.getElementById('add-person-form')?.classList.contains('open') ||
    !!document.getElementById('code-drawer')?.classList.contains('open') ||
    _modalOpen('create-group-modal') ||
    _modalOpen('invite-modal') ||
    document.getElementById('group-context-actions')?.open === true ||
    isNotifyPopoverOpen() ||
    (!!recovery && !recovery.classList.contains('hidden'));
  const callActive = getCallModeCalleeId() !== null || getIncomingCallFrom() !== null;
  const hidden = document.visibilityState === 'hidden';
  return { overlayOpen, callActive, hidden, scrolling: _scrolling };
}
```

(`export function _collectPauseFlags` — already exported for the test; nothing else.)

- [ ] **Step 8: Run to verify pause flags pass**

Run: `npx jest tests/hintRotation.test.js -t _collectPauseFlags`
Expected: PASS.

- [ ] **Step 9: Add the timer/visibility/refresh/init wiring (no new test; covered by integration + manual)**

In `js/hintRotation.js`, add the remaining engine glue:

```javascript
// Visible region: top edge = bottom of the lowest CURRENTLY-PINNED header in the
// active context (measured live, so it's correct whether or not the group header
// is ever made sticky — see #274). Bottom edge = viewport bottom.
function _regionTop() {
  const headers = [
    document.getElementById('nav-row'),
    document.getElementById('app-header'),
    document.querySelector('.group-context-header'),
  ];
  let top = 0;
  for (const el of headers) {
    if (!el || el.classList.contains('hidden')) continue;
    const pos = getComputedStyle(el).position;
    if (pos !== 'sticky' && pos !== 'fixed') continue;
    const b = el.getBoundingClientRect().bottom;
    if (b > top) top = b;
  }
  return top;
}

function _isFullyVisible(li) {
  const r = li.getBoundingClientRect();
  const top = _regionTop();
  const bottom = window.innerHeight || document.documentElement.clientHeight;
  return r.height > 0 && r.top >= top && r.bottom <= bottom;
}

function _step() {
  if (isPaused(_collectPauseFlags())) { _clearActive(); return; }
  const cand = _collectCandidates();
  const pools = {
    longpress: resolvePool(cand.longpress, _isFullyVisible),
    swipe: resolvePool(cand.swipe, _isFullyVisible),
  };
  const next = selectNextHint(_state, pools);
  _state = next.state;
  if (!next.id) { _clearActive(); return; }
  _placeHint(next.id, next.type);
}

function _ensureTimer() {
  if (_timer) return;
  _step();                       // immediate first pulse on (re)start
  _timer = setInterval(_step, STEP_MS);
}

export function refreshHints() {
  if (!_started) return;
  if (isPaused(_collectPauseFlags())) { _clearActive(); _stopTimer(); return; }
  if (_active && !document.contains(_active.li)) _clearActive(); // DOM-removal clears now
  _ensureTimer();
}

function _onScroll() {
  _scrolling = true;
  _clearActive();
  _stopTimer();
  clearTimeout(_scrollEndTimer);
  _scrollEndTimer = setTimeout(() => { _scrolling = false; refreshHints(); }, 150);
}

let _mo = null;
function _scheduleRefresh() {
  if (_scheduleRefresh._raf) return;
  _scheduleRefresh._raf = setTimeout(() => { _scheduleRefresh._raf = null; refreshHints(); }, 50);
}

export function initHintRotation() {
  if (_started) return;
  _started = true;
  document.addEventListener('visibilitychange', refreshHints);
  window.addEventListener('scroll', _onScroll, { passive: true });
  // Catch overlays opening/closing (class/`open`/popover-node changes) without
  // wiring every call site. Debounced; refreshHints never mutates hint DOM except
  // to clear, so this can't loop.
  _mo = new MutationObserver(_scheduleRefresh);
  _mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'open'], childList: true });
  refreshHints();
}

export function stopHintRotation() {
  document.removeEventListener('visibilitychange', refreshHints);
  window.removeEventListener('scroll', _onScroll);
  if (_mo) { _mo.disconnect(); _mo = null; }
  _resetEngineForTest();
}
```

(`refreshHints`, `initHintRotation`, `stopHintRotation` are declared with `export` above
— `_regionTop`, `_isFullyVisible`, `_step`, `_ensureTimer`, `_onScroll`,
`_scheduleRefresh` stay private.)

- [ ] **Step 10: Run the whole file; confirm green**

Run: `npx jest tests/hintRotation.test.js`
Expected: PASS (Task 1 + Task 2 blocks).

- [ ] **Step 11: Commit**

```bash
git add js/hintRotation.js tests/hintRotation.test.js
git commit -m "feat: hint rotation engine (collect/visibility/pause/timer/placement)"
```

---

## Task 3: Direct list — stamp attributes, remove old placement

**Files:**
- Modify: `js/following.js:56-57` (delete alt-timer state), `:963-1026` (replace block),
  `:1047-1065` (delete `my-combo-changed` listener + `refreshLongpressHints`)
- Test: `tests/following.test.js`

- [ ] **Step 1: Mock the engine in this suite, then update existing hint tests**

At the TOP of `tests/following.test.js` (with the other `jest.mock` calls), add:

```javascript
jest.mock('../js/hintRotation.js', () => ({
  refreshHints: jest.fn(),
  initHintRotation: jest.fn(),
  stopHintRotation: jest.fn(),
}));
```

This stubs `refreshHints()` (the only engine symbol `following.js` now imports) so the
suite tests *stamping*, not rotation, and never loads the real engine's deps.

Then run: `grep -n "longpress-hint\|swipe-hint" tests/following.test.js`

For EACH matching assertion, convert DOM-presence checks to attribute checks using this
mapping (apply verbatim):
- `li.querySelector('.longpress-hint')` *is present* → `li.dataset.hintLongpress === '1'`
- `li.querySelector('.longpress-hint')` *is null/absent* → `li.dataset.hintLongpress !== '1'`
- `li.querySelector('.swipe-hint')` *is present* → `li.dataset.hintSwipe === '1'`
- `li.querySelector('.swipe-hint')` *is null/absent* → `li.dataset.hintSwipe !== '1'`
- Any assertion about the **alternation timer** (advancing `setInterval`, both hints
  swapping over time) → delete it; the swap now lives in `tests/hintRotation.test.js`
  (`selectNextHint`). The Direct row only reports eligibility.

If a test asserted "first mutual gets swipe-hint, others don't", change it to assert
**all** eligible mutuals get `data-hint-swipe === '1'` (selection across them is the
engine's job, tested separately).

- [ ] **Step 2: Run the edited tests to verify they fail against current code**

Run: `npx jest tests/following.test.js`
Expected: FAIL — rows don't have `data-hint-*` yet.

- [ ] **Step 3: Replace the hint-placement block with attribute stamping**

In `js/following.js`, replace the entire block from line 963 (`// Long-press hint:`)
through line 1026 (the closing of the swipe `else if`) with:

```javascript
  // FTU hint eligibility — stamp attributes; js/hintRotation.js owns the actual
  // animation (one at a time, visible-only, prefer-available). Availability is a
  // tag here, NOT a gate: the engine resolves prefer-available-with-fallback.
  const peerColor = color;
  const peerTheme = userData.paletteKey || null;
  const isMyCombo = getFavorites().some(
    (c) => c.statusColor === peerColor && (c.paletteKey || null) === peerTheme);
  const longpressEligible = PALETTE_INTERACTIONS_ENABLED
    && isLongpressHintEligible()
    && !isCallee && !isCallModeReceiver
    && !isMyCombo;
  const swipeEligible = CALL_ENABLED
    && isSwipeHintEligible()
    && li.dataset.mutual === '1'
    && !isCallee && !isCallModeReceiver;
  li.dataset.hintAvail = isAvail ? '1' : '0';
  li.dataset.hintLongpress = longpressEligible ? '1' : '0';
  li.dataset.hintSwipe = swipeEligible ? '1' : '0';
  refreshHints();
```

- [ ] **Step 4: Delete the alternation-timer state**

In `js/following.js`, delete lines 56–57:

```javascript
let _hintAlternateTimer = null;
let _hintAlternateShow = 'longpress'; // 'longpress' | 'swipe'
```

- [ ] **Step 5: Delete `refreshLongpressHints` and its listener**

In `js/following.js`, delete the `my-combo-changed` listener and the whole
`refreshLongpressHints` function (lines ~1047–1065):

```javascript
/** Re-evaluate long-press hints when the user's own combo changes. */
document.addEventListener('my-combo-changed', () => refreshLongpressHints());

function refreshLongpressHints() {
  ...
}
```

(The engine already listens for `my-combo-changed` via `initHintRotation`. The combo
change triggers a re-stamp through the normal repaint path; the engine drops a now-
ineligible spotlight on its next step.)

- [ ] **Step 6: Add the import**

At the top of `js/following.js`, add to the import list:

```javascript
import { refreshHints } from './hintRotation.js';
```

- [ ] **Step 7: Run the Direct tests**

Run: `npx jest tests/following.test.js`
Expected: PASS. If a test still references `refreshLongpressHints` or the alt-timer,
delete that test (its behavior moved to `hintRotation.test.js`).

- [ ] **Step 8: Commit**

```bash
git add js/following.js tests/following.test.js
git commit -m "refactor: Direct rows stamp hint-eligibility attrs; remove inline placement"
```

---

## Task 4: Group roster — stamp attributes, remove old placement

**Files:**
- Modify: `js/groupContext.js:405-419` (replace block)
- Test: `tests/groupContext.test.js`

- [ ] **Step 1: Mock the engine in this suite, then update existing group hint tests**

At the TOP of `tests/groupContext.test.js` (with the other `jest.mock` calls), add:

```javascript
jest.mock('../js/hintRotation.js', () => ({
  refreshHints: jest.fn(),
  initHintRotation: jest.fn(),
  stopHintRotation: jest.fn(),
}));
```

Then run: `grep -n "longpress-hint" tests/groupContext.test.js`

Convert each assertion with the same mapping as Task 3 Step 1:
- present → `li.dataset.hintLongpress === '1'`
- absent → `li.dataset.hintLongpress !== '1'`

(There is no swipe in group; `data-hint-swipe` is always `'0'` here.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/groupContext.test.js`
Expected: FAIL — roster rows lack `data-hint-*`.

- [ ] **Step 3: Replace the longpress block with attribute stamping**

In `js/groupContext.js`, replace lines 405–419 (the `if (PALETTE_INTERACTIONS_ENABLED) { ... }`
longpress block) with:

```javascript
  // FTU longpress eligibility — stamp attributes; js/hintRotation.js owns the
  // animation. Availability is a tag, not a gate (engine resolves prefer-
  // available-with-fallback). No swipe hint in group context.
  const comboDiffers = color !== (_ownOverride?.statusColor || null)
    || paletteKey !== (_ownOverride?.paletteKey || null);
  const longpressEligible = PALETTE_INTERACTIONS_ENABLED
    && isLongpressHintEligible()
    && _ownOverride?.enabled === true
    && comboDiffers;
  li.dataset.hintAvail = available ? '1' : '0';
  li.dataset.hintLongpress = longpressEligible ? '1' : '0';
  li.dataset.hintSwipe = '0';
  refreshHints();
```

- [ ] **Step 4: Add the import**

At the top of `js/groupContext.js`, add to the import list:

```javascript
import { refreshHints } from './hintRotation.js';
```

(`isLongpressHintEligible` is already imported in groupContext.js — confirm it is; if
not, add it from `./hints.js`.)

- [ ] **Step 5: Run the group tests**

Run: `npx jest tests/groupContext.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "refactor: group roster stamps hint-eligibility attr; remove inline placement"
```

---

## Task 5: Boot wiring

**Files:**
- Modify: `js/app.js` (near the other init calls, ~line 781)

- [ ] **Step 1: Add the init import**

At the top of `js/app.js`, add:

```javascript
import { initHintRotation } from './hintRotation.js';
```

- [ ] **Step 2: Call `initHintRotation()` after the list is initialized**

In `js/app.js`, immediately after `initList(userId, code);` (~line 781) add:

```javascript
  initHintRotation();
```

- [ ] **Step 3: Confirm context changes drive a refresh**

`onContextChange` already fires `enterGroupContext` / `exitGroupContext`, both of which
repaint rows (→ `refreshHints()`), and the engine's MutationObserver catches the
`.hidden` toggle between `#main-ui-direct` and `#group-context-root`. No extra wiring
needed. Verify by reading the `onContextChange((ctx) => …)` block (~line 620) — do NOT
add a duplicate listener.

- [ ] **Step 4: Build to confirm the bundle compiles**

Run: `node scripts/dev-build.js`
Expected: `Build complete: dist/bundle.js + index.html …` with no errors.

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat: initialize hint rotation at boot"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full web suite**

Run: `npx jest`
Expected: all suites pass. If `following.test.js`/`groupContext.test.js` have leftover
references to removed symbols (`refreshLongpressHints`, `_hintAlternateTimer`), fix per
Tasks 3–4 and re-run.

- [ ] **Step 2: Run the Cloud Functions suite (should be untouched)**

Run: `cd functions && npm test && cd ..`
Expected: 4 suites / 76 pass.

- [ ] **Step 3: Production-ish build**

Run: `node scripts/dev-build.js`
Expected: clean build.

- [ ] **Step 4: Manual device/browser check (the layout-dependent parts jsdom can't cover)**

Verify on a real list (dev build, two contexts):
- Only ONE hint pulses at a time; it alternates type and moves between cards.
- A hint never appears on a card that's scrolled out of the visible region.
- Available people are preferred; with nobody available, an unavailable card still
  teaches.
- Opening any drawer/modal/settings/notify-popover, starting/receiving a call, or
  backgrounding the app halts the pulse; it resumes after.
- Group context shows longpress only; Direct alternates longpress/swipe.

- [ ] **Step 5: Commit any test fixups, then push the branch**

```bash
git add -A
git commit -m "test: finalize hint-rotation suite fixups" --allow-empty
git push -u origin claude/stoic-edison-fd4173
```

---

## Self-Review notes (for the implementer)
- **Spec coverage:** B1 (`selectNextHint` one-at-a-time) ✓; B2 Model 1 (per-type
  pointers) ✓; B3 cadence/order (`STEP_MS`, DOM-order collection, clear-on-detach) ✓;
  B4 visibility (`_isFullyVisible`/`_regionTop`) ✓; B5 Interpretation Y (`resolvePool`) ✓;
  B6 pauses (`_collectPauseFlags` + scroll + visibility + MutationObserver) ✓; B7 scope
  (container-by-context; group stamps swipe='0') ✓; B8 reduced-motion not honored (no
  reduced-motion check anywhere) ✓.
- **Type consistency:** candidate shape `{ id, available }` is used by `resolvePool`,
  `_collectCandidates`, and tests; `id` is the `<li>` element in the engine and a string
  in pure tests (the functions are element-agnostic).
- **Known jsdom gap:** `_isFullyVisible`/`_regionTop` depend on layout + external CSS,
  which jsdom doesn't compute — verified manually (Task 6 Step 4), not in unit tests. The
  rotation algorithm itself is fully unit-tested via the injected visibility predicate.
