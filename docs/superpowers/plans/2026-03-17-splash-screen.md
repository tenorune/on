# Splash Screen Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare sequential UI flash on load with a themed full-screen splash that fades away once own status and all followee cards have rendered (or after 3s).

**Architecture:** A `#splash` overlay (static HTML, visible by default) covers the app on load. An early synchronous IIFE in `app.js` applies the stored palette theme before first paint. A counter in `app.js` tracks how many readiness signals are expected (1 for own status + N for followees); when the counter reaches zero or 3s elapses, `dismissSplash()` fades the overlay out. `me.js` and `following.js` fire injected callbacks on their first render each session.

**Tech Stack:** Vanilla JS ES modules, CSS transitions, Jest/jsdom for unit tests.

---

## Chunk 1: Static structure and app.js coordinator

### Task 1: Add `#splash` HTML element and CSS

**Files:**

- Modify: `index.html`
- Modify: `css/app.css`

No unit test needed — purely visual/structural.

- [ ] **Step 1: Add `#splash` as first child of `<body>` in `index.html`**

Insert immediately after `<body>`, before `<div id="stale-screen"`:

```html
<div id="splash">k&#x0338;n&#x0336;o&#x0338;c&#x0335;k&#x0335; &#x0336;k&#x0338;n&#x0337;o&#x0335;c&#x0338;k&#x0335;</div>
```

- [ ] **Step 2: Add CSS rules for `#splash` and `#splash.fading` in `css/app.css`**

Add after the `html, body` rule:

```css
#splash {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg); color: var(--text);
  font-size: 1.25rem;
  transition: opacity 0.5s;
}
#splash.fading { opacity: 0; pointer-events: none; }
```

- [ ] **Step 3: Verify in browser**

Load the app. The splash should appear full-screen with the strikethrough knock knock text, blocking all other UI. It will not dismiss yet (coordinator not wired). Reload with a palette active — the splash should render in that palette's background colour (once Task 2 is done).

- [ ] **Step 4: Commit**

```bash
git add index.html css/app.css
git commit -m "feat: add splash screen overlay element and CSS"
```

---

### Task 2: Add coordinator and early theme IIFE to `app.js`

**Files:**

- Modify: `js/app.js`

No unit test for `app.js` — coordinator functions are thin DOM wrappers; correctness is verified via the me.js and following.js callback tests in later tasks.

- [ ] **Step 1: Add the early theme IIFE at the top of `app.js`, before `main()`**

Place after the `import` block, before `async function ensureIdentity()`:

```js
// Apply stored palette theme before main() initialises Firebase so the splash
// renders in the user's chosen colours immediately.
(function applyStoredTheme() {
  try {
    const raw = localStorage.getItem('statusapp_palette_state');
    if (!raw) return;
    const state = JSON.parse(raw);
    const key = state?.activePaletteKey;
    if (!key) return;
    const palette = getPaletteByKey(key);
    if (palette) applyThemeVars(palette.theme);
  } catch {}
})();
```

- [ ] **Step 2: Add `splashCounter`, `splashDone`, `initSplash`, `signalReady`, `dismissSplash` to `app.js`**

Place after the IIFE, before `ensureIdentity`:

```js
let splashCounter = 0;
let splashDone = false;

function initSplash(followeeCount) {
  splashCounter = 1 + followeeCount;
  // Call dismissSplash directly (not signalReady) so the splash always
  // disappears after 3s regardless of how many followees haven't reported in.
  setTimeout(dismissSplash, 3000);
}

function signalReady() {
  if (splashDone) return;
  splashCounter--;
  if (splashCounter <= 0) {
    dismissSplash();
  }
}

function dismissSplash() {
  if (splashDone) return;
  splashDone = true;
  const el = document.getElementById('splash');
  if (!el) return;
  el.classList.add('fading');
  el.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'opacity') el.style.display = 'none';
  }, { once: true });
}
```

- [ ] **Step 3: Update `main()` — stale screen path**

The stale screen block currently reads:

```js
if (!identity) {
  await showStaleScreen();
  ({ identity, isNew } = await ensureIdentity());
}
```

Change to:

```js
if (!identity) {
  dismissSplash();
  await showStaleScreen();
  ({ identity, isNew } = await ensureIdentity());
}
```

- [ ] **Step 4: Update `main()` — wire callbacks and call `initSplash` after `initList`**

After the line `initList(userId, code);`, add a guarded block. The guard ensures we don't re-run the coordinator if the splash was already dismissed (stale identity path calls `dismissSplash()` before reaching this point):

```js
if (!splashDone) {
  const followeeCount = getFollowing().length;
  initSplash(followeeCount);
  setOwnStatusReadyCallback(signalReady);
  setFolloweeReadyCallback(signalReady);
}
```

This requires new named imports at the top of `app.js`. Make these additive edits to the existing import lines:

- Add `setOwnStatusReadyCallback` to the `me.js` import line:

  ```js
  import { initHeader, applyOwnStatus, enterFirstUseMode, setOwnStatusReadyCallback } from './me.js';
  ```

- Add `setFolloweeReadyCallback` to the `following.js` import line:

  ```js
  import { initList, setFolloweeReadyCallback } from './following.js';
  ```

- Add `getFollowing` to the `store.js` import line:

  ```js
  import { getPaletteState, getFollowing } from './store.js';
  ```

- [ ] **Step 5: Remove the now-duplicate `applyThemeVars` call from mid-`main()`**

In `main()`, inside `if (PALETTES_ENABLED)`, find and remove these lines (the IIFE now handles this before first paint):

```js
    // If stored in palette mode, apply theme before first paint (avoids flash)
    if (activePaletteKey) {
      applyThemeVars(getPaletteByKey(activePaletteKey).theme);
    }
```

The `applyPaletteVars(selectedKey)` call and `initSwatches(userId)` remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add js/app.js
git commit -m "feat: add splash coordinator and early palette theme IIFE"
```

---

## Chunk 2: Module wiring (me.js and following.js)

### Task 3: Wire readiness callback into `me.js`

**Files:**

- Modify: `js/me.js`
- Modify: `tests/me.test.js`

- [ ] **Step 1: Write failing tests in `tests/me.test.js`**

Add a new `describe` block after the existing tests:

```js
describe('setOwnStatusReadyCallback', () => {
  beforeEach(() => {
    makeFixture();
    initHeader('u1');
  });

  test('callback fires on first applyOwnStatus call', () => {
    const cb = jest.fn();
    setOwnStatusReadyCallback(cb);
    applyOwnStatus('available', Date.now() + 7200000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('callback does not fire on second applyOwnStatus call', () => {
    const cb = jest.fn();
    setOwnStatusReadyCallback(cb);
    applyOwnStatus('available', Date.now() + 7200000);
    applyOwnStatus('unavailable', null);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('callback fires on first-use path (setKnockKnock branch)', () => {
    const cb = jest.fn();
    setOwnStatusReadyCallback(cb);
    enterFirstUseMode();
    applyOwnStatus('unavailable', null); // triggers setKnockKnock
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('initHeader resets the flag so callback fires again after re-init', () => {
    const cb = jest.fn();
    setOwnStatusReadyCallback(cb);
    applyOwnStatus('available', Date.now() + 7200000);
    jest.advanceTimersByTime(250); // flush the setAvailable 200ms timer before re-init
    initHeader('u1'); // re-init resets ownStatusSignalled
    applyOwnStatus('unavailable', null);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
```

Also add `setOwnStatusReadyCallback` to the require at the top of `tests/me.test.js`:

```js
const { applyOwnStatus, initHeader, enterFirstUseMode, setOwnStatusReadyCallback } = require('../js/me.js');
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest tests/me.test.js --testNamePattern="setOwnStatusReadyCallback" 2>&1 | tail -20
```

Expected: FAIL — `setOwnStatusReadyCallback is not a function`

- [ ] **Step 3: Implement in `me.js`**

Add `ownStatusSignalled` and `onOwnStatusReady` as module-level variables (alongside `firstUseActive`):

```js
let ownStatusSignalled = false;
let onOwnStatusReady = null;
```

Add the export function (after `enterFirstUseMode`):

```js
export function setOwnStatusReadyCallback(fn) {
  onOwnStatusReady = fn;
}
```

In `initHeader`, reset the flag (add one line at the very start of `initHeader` body, before the `const dot = ...` line):

```js
ownStatusSignalled = false;
```

In `applyOwnStatus`, add at the very top, before any other logic:

```js
if (!ownStatusSignalled) {
  ownStatusSignalled = true;
  onOwnStatusReady?.();
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest tests/me.test.js 2>&1 | tail -10
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/me.js tests/me.test.js
git commit -m "feat: fire readiness callback on first applyOwnStatus in me.js"
```

---

### Task 4: Wire readiness callback into `following.js`

**Files:**

- Modify: `js/following.js`
- Modify: `tests/following.test.js`

- [ ] **Step 1: Write failing tests in `tests/following.test.js`**

Add a new `describe` block. First, find where `updateFolloweeRow` is tested (the `describe('updateFolloweeRow: ...')` block around line 350) to understand the test fixture pattern. Then add after the existing tests:

Define a `makeFolloweeLi` helper at the top of the new describe block. It creates the `<li>` structure that `updateFolloweeRow` expects (matching `createFolloweeRow`'s innerHTML):

```js
function makeFolloweeLi(userId) {
  const li = document.createElement('li');
  li.dataset.userId = userId;
  li.innerHTML = `
    <div class="person-dot"></div>
    <div class="person-info">
      <div class="person-label">${userId}</div>
      <div class="person-status">Unavailable</div>
    </div>
    <button class="unfollow-btn">×</button>`;
  document.getElementById('people-list').appendChild(li);
  return li;
}
```

Then add the describe block:

```js
describe('setFolloweeReadyCallback', () => {
  let cb;
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    cb = jest.fn();
    setFolloweeReadyCallback(cb);
  });

  test('callback fires on first updateFolloweeRow call for a userId', () => {
    const li = makeFolloweeLi('alice');
    const entry = { userId: 'alice', code: 'ALICE1' };
    updateFolloweeRow(entry, { status: 'unavailable', availableUntil: null }, 'me');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('callback does not fire again for the same userId', () => {
    const li = makeFolloweeLi('alice');
    const entry = { userId: 'alice', code: 'ALICE1' };
    updateFolloweeRow(entry, { status: 'unavailable', availableUntil: null }, 'me');
    updateFolloweeRow(entry, { status: 'available', availableUntil: Date.now() + 3600000 }, 'me');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('callback fires independently for different userIds', () => {
    makeFolloweeLi('alice');
    makeFolloweeLi('bob');
    const entryA = { userId: 'alice', code: 'ALICE1' };
    const entryB = { userId: 'bob',   code: 'BOB111' };
    updateFolloweeRow(entryA, { status: 'unavailable', availableUntil: null }, 'me');
    updateFolloweeRow(entryB, { status: 'unavailable', availableUntil: null }, 'me');
    expect(cb).toHaveBeenCalledTimes(2);
  });

  test('initList resets renderedFollowees so callback fires again after re-init', () => {
    makeFolloweeLi('alice');
    const entry = { userId: 'alice', code: 'ALICE1' };
    updateFolloweeRow(entry, { status: 'unavailable', availableUntil: null }, 'me');
    // Simulate re-init: initList clears renderedFollowees
    resetRenderedFollowees();
    makeFolloweeLi('alice');
    updateFolloweeRow(entry, { status: 'unavailable', availableUntil: null }, 'me');
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
```

Add `setFolloweeReadyCallback`, `updateFolloweeRow`, and `resetRenderedFollowees` to the require at the top of `tests/following.test.js`:

```js
const { ..., setFolloweeReadyCallback, updateFolloweeRow, resetRenderedFollowees } = require('../js/following.js');
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest tests/following.test.js --testNamePattern="setFolloweeReadyCallback" 2>&1 | tail -20
```

Expected: FAIL — `setFolloweeReadyCallback is not a function`

- [ ] **Step 3: Implement in `following.js`**

Add module-level variables alongside the existing ones at the top of the module:

```js
const renderedFollowees = new Set();
let onFolloweeReady = null;
```

Export the callback setter and a reset helper (place after `initList`):

```js
export function setFolloweeReadyCallback(fn) {
  onFolloweeReady = fn;
}

export function resetRenderedFollowees() {
  renderedFollowees.clear();
}
```

At the very start of `initList()` body, clear the set:

```js
renderedFollowees.clear();
```

Add `export` to the `updateFolloweeRow` function declaration so tests can import it directly (it is currently `function updateFolloweeRow` — change to `export function updateFolloweeRow`).

In `updateFolloweeRow`, add at the very top (before the `const li = ...` line):

```js
if (!renderedFollowees.has(entry.userId)) {
  renderedFollowees.add(entry.userId);
  onFolloweeReady?.();
}
```

- [ ] **Step 4: Run all tests to confirm they pass**

```bash
npx jest 2>&1 | tail -15
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/following.js tests/following.test.js
git commit -m "feat: fire readiness callback on first updateFolloweeRow per userId"
```

---

### Task 5: Final integration verification

- [ ] **Step 1: Run the full test suite**

```bash
npx jest 2>&1 | tail -15
```

Expected: all tests PASS with no regressions.

- [ ] **Step 2: Manual verification — page reload**

Load the app in a browser. Confirm:

- Splash appears immediately in the correct palette colours (if a theme is set)
- Real UI is hidden behind the splash
- Splash fades out after all followee cards have rendered (no flash of default state)
- If no palette is set, splash background is the default dark `--bg`

- [ ] **Step 3: Manual verification — first-time use**

Clear localStorage and reload. Confirm:

- Splash appears
- Fades out as soon as the first `applyOwnStatus` fires — in first-use mode this is the knock-knock display state, before the user taps the dot. The splash does not wait for "Available" confirmation; it dismisses on any first status callback.
- No 3s wait

- [ ] **Step 4: Manual verification — 3s timeout path**

Simulate slow Firebase by throttling network (browser DevTools → Network → Slow 3G). Confirm the splash dismisses itself after ~3 seconds even if not all signals have arrived.

- [ ] **Step 5: Manual verification — stale identity**

Manually delete the user's Firebase record and reload. Confirm:

- Splash fades out immediately before the stale screen appears
- Stale screen shows correctly
- After clicking Continue, the app initialises normally (no second splash)

- [ ] **Step 6: Commit and push**

```bash
git add -p  # review any remaining unstaged changes
git commit -m "feat: splash screen — hides UI flash on load and first-time use"
git push
```
