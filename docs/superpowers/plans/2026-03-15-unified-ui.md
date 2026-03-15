# Unified UI Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-tab layout with a single scrollable screen — sticky header with status controls + one merged people list.

**Architecture:** Refactor in-place: `me.js`, `following.js`, `mycode.js` each retarget new DOM IDs. `app.js` removes tab init; calls `initCodeDrawer` → `initHeader` → `initList` in order. Firebase subscriptions open at load time.

**Tech Stack:** Vanilla JS ES modules, esbuild, Firebase Realtime Database, Jest + jsdom + Babel

---

## File Structure

| File | Change |
|------|--------|
| `index.html` | Replace `<main>` + `<nav>` with unified header + list |
| `css/app.css` | Remove tab/nav/slider rules; update `.dot`; add header/drawer/chip/section rules |
| `js/app.js` | Remove `initTabs`; update imports + init order |
| `js/me.js` | Rename `initMeTab` → `initHeader`; replace slider with chip logic; update `applyOwnStatus` |
| `js/mycode.js` | Rename `initMyCodeTab` → `initCodeDrawer`; remove `renderFollowers` + `watchFollowers` call |
| `js/following.js` | Rename `initFollowingTab` → `initList`; add `renderList`; absorb follower rendering |
| `tests/me.test.js` | Rewrite fixture + tests for `initHeader` / `applyOwnStatus` |
| `tests/mycode.test.js` | Remove `renderFollowers` tests; update fixture + function name |
| `tests/following.test.js` | Add `watchFollowers`/`removeFollower` mocks; update fixture; add `renderList` tests |

---

## Chunk 1: Structure — HTML, CSS, app.js

### Task 1: Restructure index.html

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace `<main>` and `<nav>` content**

Replace everything between `<body>` and `<script src="dist/bundle.js">` (keeping the stale-screen div and script tag) with:

```html
  <!-- Stale identity recovery screen -->
  <div id="stale-screen" class="stale-screen hidden">
    <div class="stale-card">
      <p class="stale-msg">Your previous session was not found.<br>A new code has been generated for you.</p>
      <button id="stale-continue-btn" class="primary-btn">Continue</button>
    </div>
  </div>

  <header id="app-header">
    <div id="header-row">
      <div id="my-dot" class="dot"></div>
      <div id="header-text">
        <div id="header-status-row">
          <span id="my-status-label" class="status-label">Unavailable</span>
          <span id="time-remaining" style="display:none"></span>
        </div>
        <div id="header-chips">
          <button id="time-chip" class="chip time-chip">2 hours</button>
          <button id="mycode-chip" class="chip">My Code</button>
        </div>
      </div>
    </div>
    <div id="code-drawer">
      <p class="code-card-label">Your code</p>
      <div class="code-display-row">
        <span id="my-code-display" class="code-display"></span>
        <button id="rotate-code-btn" class="rotate-btn" title="Generate new code">↻</button>
        <button id="copy-code-btn" class="ghost-btn">Copy</button>
      </div>
      <p id="rotate-error-msg" class="error-msg hidden"></p>
      <p class="hint">Share this so others can follow your status.</p>
    </div>
  </header>

  <main id="main-list">
    <div id="offline-banner" class="offline-banner hidden">Offline — showing last known status</div>
    <ul id="people-list" class="person-list"></ul>
    <p id="empty-list-msg" class="hidden">Add someone below to get started.</p>
    <button id="add-person-btn" class="add-btn">+ Add person</button>
    <div id="add-person-form" class="add-form hidden">
      <label class="field-label">Code</label>
      <input id="add-code-input" type="text" maxlength="6" placeholder="e.g. XK7P2M" class="code-input" autocomplete="off" />
      <label class="field-label">Name (optional)</label>
      <input id="add-label-input" type="text" maxlength="40" placeholder="e.g. Partner, Mom" class="text-input" />
      <p id="add-error" class="error-msg hidden"></p>
      <div style="display:flex;gap:8px">
        <button id="add-submit-btn" class="primary-btn">Follow</button>
        <button id="add-cancel-btn" class="ghost-btn">Cancel</button>
      </div>
    </div>
  </main>
```

Note: `#header-chips` and `#code-drawer` have **no** `hidden` class — visibility is controlled by CSS `.visible` / `.open` classes + JS `style.display`.

- [ ] **Step 2: Run build to verify no syntax errors**

```bash
npm run build
```

Expected: exits 0, `dist/bundle.js` updated.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: replace tab layout with unified header + list HTML"
```

---

### Task 2: Update css/app.css

**Files:**
- Modify: `css/app.css`

- [ ] **Step 1: Remove obsolete rule blocks**

Delete these rule blocks entirely from `css/app.css`:

- `--nav-h: 64px;` line inside `:root`
- `main { height: calc(100vh - var(--nav-h)); overflow-y: auto; }` block
- `.tab-panel { ... }` and `.tab-panel.active { ... }` blocks
- `.bottom-nav { ... }`, `.nav-btn { ... }`, `.nav-btn.active { ... }`, `.nav-icon { ... }`, `.nav-label { ... }` blocks
- `.dot-wrap { ... }` block
- `.slider-wrap { ... }`, `.slider-header { ... }`, `.slider-title { ... }`, `.slider-value { ... }`, `.slider { ... }`, `.slider-ticks { ... }` blocks
- `.followers-section { ... }` and `.section-title { ... }` blocks
- `.code-card { ... }` block

- [ ] **Step 2: Update existing rules**

Replace the `.dot` rule:
```css
.dot {
  width: 3rem; height: 3rem; border-radius: 50%;
  background: var(--dot-off); border: 2px solid var(--dot-off-border);
  cursor: pointer; transition: background 0.3s, box-shadow 0.3s;
  flex-shrink: 0;
}
```

Replace the `main` rule:
```css
main {
  padding: 1rem;
}
```

Replace `.status-label` (keep `.status-label.available`):
```css
.status-label { font-size: 1rem; font-weight: 600; color: var(--text-muted); }
.status-label.available { color: var(--green); }
```

Replace `.person-dot`:
```css
.person-dot {
  width: 2rem; height: 2rem; border-radius: 50%; flex-shrink: 0;
  background: var(--dot-off); border: 1px solid var(--dot-off-border);
}
```

Replace `.person-list li`:
```css
.person-list li {
  background: var(--surface); border-radius: 10px; padding: 0.75rem 0.875rem;
  display: flex; align-items: center; gap: 0.75rem;
  margin-bottom: 0.5rem; list-style: none;
}
```

Replace `.person-label`:
```css
.person-label { font-size: 0.875rem; color: var(--text); cursor: pointer; }
```

Replace `.person-status`:
```css
.person-status { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.125rem; }
```

Replace `.person-follower-name`:
```css
.person-follower-name { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.125rem; }
```

Replace `.add-btn`:
```css
.add-btn {
  width: 100%; background: var(--surface); color: var(--text-muted);
  border: 1px dashed var(--surface2); padding: 0.75rem; border-radius: 10px;
  font-size: 0.8125rem; cursor: pointer; margin-top: 0.25rem;
}
```

Replace `.code-card-label`:
```css
.code-card-label { font-size: 0.6875rem; letter-spacing: 0.0625rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.625rem; }
```

Replace `.code-display`:
```css
.code-display { font-size: 2rem; font-weight: 700; letter-spacing: 0.375rem; color: var(--text); transition: opacity 0.2s; }
```

- [ ] **Step 3: Add new rules**

Append to the end of `css/app.css` (before the final newline):

```css
/* App header */
#app-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--surface);
  padding: 1rem;
  border-bottom: 1px solid var(--surface2);
}

#header-row {
  display: flex;
  align-items: center;
  gap: 0.875rem;
}

#header-text {
  flex: 1;
}

#header-status-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 1rem;
}

#time-remaining {
  color: var(--text-muted);
  font-size: 0.875rem;
}

/* Chips */
#header-chips {
  display: none;
  gap: 0.5rem;
  margin-top: 0.5rem;
  opacity: 0;
  transform: translateY(-6px);
  transition: opacity 0.25s ease, transform 0.25s ease;
}
#header-chips.visible {
  opacity: 1;
  transform: translateY(0);
}

.chip {
  background: var(--surface2);
  border: 1px solid var(--surface2);
  color: var(--text);
  border-radius: 999px;
  padding: 0.25rem 0.875rem;
  font-size: 0.8125rem;
  cursor: pointer;
}
.chip.active {
  border-color: var(--accent);
  color: var(--accent);
}
.time-chip {
  min-width: 9.25rem;
  text-align: center;
}

/* Code drawer */
#code-drawer {
  overflow: hidden;
  max-height: 0;
  transition: max-height 0.3s ease, margin-top 0.3s ease;
  margin-top: 0;
}
#code-drawer.open {
  max-height: 12.5rem;
  margin-top: 0.75rem;
}

/* List section labels */
.list-section-label {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.0625rem;
  color: var(--text-muted);
  padding: 0.75rem 0 0.25rem;
  list-style: none;
  background: transparent;
  border-radius: 0;
  margin-bottom: 0;
}

/* Follower-only row */
.person-list li.follower-only {
  opacity: 0.6;
}

/* Follow-back button */
.follow-back-btn {
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  border: 1.5px solid var(--accent);
  color: var(--accent);
  background: transparent;
  font-size: 1.125rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0.375rem;
  margin: -0.375rem;
}
```

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add css/app.css
git commit -m "feat: update CSS for unified layout — remove tab/nav/slider, add header/drawer/chip rules"
```

---

### Task 3: Update app.js

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Replace app.js with updated version**

Replace the entire file content:

```js
// js/app.js
import { loadIdentity, saveIdentity, generateUserId, generateCode, clearIdentity } from './identity.js';
import { initUser, watchStatus, isExpired, writeBackExpired, userExists, touchLastSeen } from './db.js';
import { initHeader, applyOwnStatus } from './me.js';
import { initList } from './following.js';
import { initCodeDrawer } from './mycode.js';

async function ensureIdentity() {
  const existing = loadIdentity();
  if (existing) {
    try {
      const valid = await userExists(existing.userId);
      if (!valid) {
        clearIdentity();
        return null;
      }
    } catch {
      // Network error (offline) — assume valid and proceed
    }
    return existing;
  }

  let userId, code, success;
  do {
    userId = generateUserId();
    code = generateCode();
    success = await initUser(userId, code);
  } while (!success);

  saveIdentity(userId, code);
  return { userId, code };
}

function showStaleScreen() {
  return new Promise((resolve) => {
    document.getElementById('stale-screen').classList.remove('hidden');
    document.getElementById('stale-continue-btn').addEventListener('click', () => {
      document.getElementById('stale-screen').classList.add('hidden');
      resolve();
    }, { once: true });
  });
}

async function main() {
  let identity = await ensureIdentity();
  if (!identity) {
    await showStaleScreen();
    identity = await ensureIdentity();
  }
  const { userId, code } = identity;

  touchLastSeen(userId).catch(() => {});

  initCodeDrawer(userId, code);
  initHeader(userId);
  initList(userId, code);

  watchStatus(userId, (userData) => {
    if (!userData) return;
    const expired = userData.status === 'available' && isExpired(userData.availableUntil);
    if (expired) writeBackExpired(userId);
    applyOwnStatus(
      expired ? 'unavailable' : userData.status,
      expired ? null : userData.availableUntil,
    );
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  }
}

main().catch(console.error);
```

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat: update app.js — remove initTabs, wire up initCodeDrawer/initHeader/initList"
```

---

## Chunk 2: me.js → initHeader

### Task 4: Rewrite me.js with chip-based time selection

**Files:**
- Modify: `js/me.js`
- Modify: `tests/me.test.js`

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/me.test.js`:

```js
// tests/me.test.js
jest.mock('../js/db.js', () => ({
  setStatus: jest.fn().mockResolvedValue(undefined),
  isExpired: (t) => t !== null && t !== undefined && t < Date.now(),
  formatTimeRemaining: (ms) => ms > 0 ? '2h' : '',
  timeRemainingMs: (t) => !t ? 0 : Math.max(0, t - Date.now()),
}));
jest.mock('../js/store.js', () => ({
  getLastTimeout: jest.fn(),
  setLastTimeout: jest.fn(),
}));

const { setStatus } = require('../js/db.js');
const { getLastTimeout, setLastTimeout } = require('../js/store.js');
const { applyOwnStatus, initHeader } = require('../js/me.js');

// jsdom doesn't apply stylesheets, so #header-chips has no computed display.
// The fixture sets style="display:none" on chips to match the CSS default.
function makeFixture() {
  document.body.innerHTML = `
    <div id="my-dot"></div>
    <span id="my-status-label" class="status-label">Unavailable</span>
    <span id="time-remaining" style="display:none"></span>
    <div id="header-chips" style="display:none">
      <button id="time-chip" class="chip time-chip"></button>
      <button id="mycode-chip" class="chip"></button>
    </div>
    <div id="code-drawer"></div>
  `;
}

beforeEach(() => {
  jest.useFakeTimers();
  global.requestAnimationFrame = (fn) => fn();
  makeFixture();
  jest.clearAllMocks();
  getLastTimeout.mockReturnValue(2); // old-format default — set AFTER clearAllMocks
});

afterEach(() => {
  jest.useRealTimers();
});

// --- applyOwnStatus ---

test('applyOwnStatus available: label text is "Available"', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  expect(document.getElementById('my-status-label').textContent).toBe('Available');
});

test('applyOwnStatus available: dot gets available class', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  expect(document.getElementById('my-dot').classList.contains('available')).toBe(true);
});

test('applyOwnStatus available: time-remaining is visible with time text', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  const el = document.getElementById('time-remaining');
  expect(el.style.display).not.toBe('none');
  expect(el.textContent).toMatch(/^· .+ left$/);
});

test('applyOwnStatus available: header-chips display is set to flex', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  expect(document.getElementById('header-chips').style.display).toBe('flex');
});

test('applyOwnStatus available: header-chips gets .visible class (rAF is synchronous in tests)', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  expect(document.getElementById('header-chips').classList.contains('visible')).toBe(true);
});

test('applyOwnStatus unavailable: label text is "Unavailable"', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  applyOwnStatus('unavailable', null);
  expect(document.getElementById('my-status-label').textContent).toBe('Unavailable');
});

test('applyOwnStatus unavailable: dot loses available class', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  applyOwnStatus('unavailable', null);
  expect(document.getElementById('my-dot').classList.contains('available')).toBe(false);
});

test('applyOwnStatus unavailable: time-remaining is hidden', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  applyOwnStatus('unavailable', null);
  expect(document.getElementById('time-remaining').style.display).toBe('none');
});

test('applyOwnStatus unavailable: chips .visible class removed', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  applyOwnStatus('unavailable', null);
  expect(document.getElementById('header-chips').classList.contains('visible')).toBe(false);
});

test('countdown timer fires after expiry: dot loses available class', () => {
  const availableUntil = Date.now() + 1000;
  applyOwnStatus('available', availableUntil);
  expect(document.getElementById('my-dot').classList.contains('available')).toBe(true);
  jest.advanceTimersByTime(35000);
  expect(document.getElementById('my-dot').classList.contains('available')).toBe(false);
});

// --- chip migration ---

test('getLastTimeout returning 2 (old format hours): time-chip text is "2 hours"', () => {
  getLastTimeout.mockReturnValue(2);
  initHeader('uid1');
  expect(document.getElementById('time-chip').textContent).toBe('2 hours');
});

test('getLastTimeout returning 120 (new format minutes): time-chip text is "2 hours"', () => {
  getLastTimeout.mockReturnValue(120);
  initHeader('uid1');
  expect(document.getElementById('time-chip').textContent).toBe('2 hours');
});

test('getLastTimeout returning 60 (new format minutes): time-chip text is "1 hour"', () => {
  getLastTimeout.mockReturnValue(60);
  initHeader('uid1');
  expect(document.getElementById('time-chip').textContent).toBe('1 hour');
});

test('getLastTimeout returning 1 (old format 1h): time-chip text is "1 hour"', () => {
  getLastTimeout.mockReturnValue(1);
  initHeader('uid1');
  expect(document.getElementById('time-chip').textContent).toBe('1 hour');
});

// --- time chip cycle ---

test('clicking time chip while available advances to next chip and calls setStatus', async () => {
  getLastTimeout.mockReturnValue(120); // index 3 = 2 hours
  initHeader('uid1');
  document.getElementById('my-dot').classList.add('available');

  document.getElementById('time-chip').click();
  await Promise.resolve();

  // Advances from index 3 (120min/2 hours) to index 4 (180min/3 hours)
  expect(document.getElementById('time-chip').textContent).toBe('3 hours');
  expect(setStatus).toHaveBeenCalledWith('uid1', 'available', expect.any(Number));
  expect(setLastTimeout).toHaveBeenCalledWith(180);
});

test('time chip cycle wraps from last chip back to first', async () => {
  getLastTimeout.mockReturnValue(480); // index 7 = 8 hours
  initHeader('uid1');
  document.getElementById('my-dot').classList.add('available');

  document.getElementById('time-chip').click();
  await Promise.resolve();

  expect(document.getElementById('time-chip').textContent).toBe('30 minutes');
  expect(setLastTimeout).toHaveBeenCalledWith(30);
});

test('clicking time chip while unavailable does nothing', async () => {
  getLastTimeout.mockReturnValue(120);
  initHeader('uid1');
  // dot does NOT have 'available' class

  document.getElementById('time-chip').click();
  await Promise.resolve();

  expect(setStatus).not.toHaveBeenCalled();
});

// --- mycode chip ---

test('clicking mycode chip toggles code-drawer open class', () => {
  getLastTimeout.mockReturnValue(2);
  initHeader('uid1');

  const drawer = document.getElementById('code-drawer');
  expect(drawer.classList.contains('open')).toBe(false);

  document.getElementById('mycode-chip').click();
  expect(drawer.classList.contains('open')).toBe(true);

  document.getElementById('mycode-chip').click();
  expect(drawer.classList.contains('open')).toBe(false);
});

test('clicking mycode chip toggles active class on the chip', () => {
  getLastTimeout.mockReturnValue(2);
  initHeader('uid1');

  const chip = document.getElementById('mycode-chip');
  chip.click();
  expect(chip.classList.contains('active')).toBe(true);
  chip.click();
  expect(chip.classList.contains('active')).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/me.test.js --no-coverage
```

Expected: FAIL — `initHeader` is not exported / fixture IDs not found.

- [ ] **Step 3: Implement initHeader in me.js**

Replace the entire contents of `js/me.js`:

```js
// js/me.js
import { setStatus, isExpired, formatTimeRemaining, timeRemainingMs } from './db.js';
import { getLastTimeout, setLastTimeout } from './store.js';

const CHIP_VALUES = [
  { minutes: 30,  text: '30 minutes' },
  { minutes: 60,  text: '1 hour' },
  { minutes: 90,  text: '1 hour 30 minutes' },
  { minutes: 120, text: '2 hours' },
  { minutes: 180, text: '3 hours' },
  { minutes: 240, text: '4 hours' },
  { minutes: 360, text: '6 hours' },
  { minutes: 480, text: '8 hours' },
];

let countdownTimer = null;
let currentChipIndex = 3; // default: 2 hours

function migrateToChipIndex() {
  let stored = getLastTimeout();
  if (stored <= 12) stored = stored * 60;
  let bestIndex = 0;
  let bestDist = Math.abs(CHIP_VALUES[0].minutes - stored);
  for (let i = 1; i < CHIP_VALUES.length; i++) {
    const dist = Math.abs(CHIP_VALUES[i].minutes - stored);
    if (dist < bestDist) { bestDist = dist; bestIndex = i; }
  }
  return bestIndex;
}

function showChips(chipsEl) {
  chipsEl.style.display = 'flex';
  requestAnimationFrame(() => chipsEl.classList.add('visible'));
}

function hideChips(chipsEl) {
  if (getComputedStyle(chipsEl).display === 'none') return;
  chipsEl.classList.remove('visible');
  chipsEl.addEventListener('transitionend', function handler(e) {
    if (e.target === chipsEl && e.propertyName === 'opacity') {
      chipsEl.style.display = 'none';
      chipsEl.removeEventListener('transitionend', handler);
    }
  });
}

export function initHeader(myUserId) {
  const dot = document.getElementById('my-dot');
  const timeChip = document.getElementById('time-chip');
  const mycodeChip = document.getElementById('mycode-chip');
  const drawer = document.getElementById('code-drawer');

  currentChipIndex = migrateToChipIndex();
  timeChip.textContent = CHIP_VALUES[currentChipIndex].text;

  dot.addEventListener('click', async () => {
    if (dot.classList.contains('available')) {
      await setStatus(myUserId, 'unavailable', null);
      setUnavailable();
    } else {
      const { minutes } = CHIP_VALUES[currentChipIndex];
      const availableUntil = Date.now() + minutes * 60000;
      await setStatus(myUserId, 'available', availableUntil);
      setAvailable(availableUntil);
    }
  });

  timeChip.addEventListener('click', async () => {
    if (!document.getElementById('my-dot').classList.contains('available')) return;
    currentChipIndex = (currentChipIndex + 1) % CHIP_VALUES.length;
    const { minutes, text } = CHIP_VALUES[currentChipIndex];
    timeChip.textContent = text;
    const availableUntil = Date.now() + minutes * 60000;
    await setStatus(myUserId, 'available', availableUntil);
    const tr = document.getElementById('time-remaining');
    tr.textContent = '· ' + formatTimeRemaining(timeRemainingMs(availableUntil)) + ' left';
    setLastTimeout(minutes);
  });

  mycodeChip.addEventListener('click', () => {
    const isOpen = drawer.classList.contains('open');
    drawer.classList.toggle('open');
    mycodeChip.classList.toggle('active', !isOpen);
  });
}

export function applyOwnStatus(status, availableUntil) {
  if (status === 'available' && !isExpired(availableUntil)) {
    setAvailable(availableUntil);
  } else {
    setUnavailable();
  }
}

function setAvailable(availableUntil) {
  const dot = document.getElementById('my-dot');
  const label = document.getElementById('my-status-label');
  const timeRemaining = document.getElementById('time-remaining');
  const chips = document.getElementById('header-chips');

  dot.classList.add('available');
  label.classList.add('available');
  label.textContent = 'Available';
  timeRemaining.textContent = '· ' + formatTimeRemaining(timeRemainingMs(availableUntil)) + ' left';
  timeRemaining.style.display = '';
  showChips(chips);

  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    const ms = timeRemainingMs(availableUntil);
    if (ms <= 0) {
      dot.classList.remove('available');
      label.classList.remove('available');
      label.textContent = 'Unavailable';
      timeRemaining.textContent = '';
      timeRemaining.style.display = 'none';
      hideChips(chips);
      clearInterval(countdownTimer);
    } else {
      timeRemaining.textContent = '· ' + formatTimeRemaining(ms) + ' left';
    }
  }, 30000);
}

function setUnavailable() {
  const dot = document.getElementById('my-dot');
  const label = document.getElementById('my-status-label');
  const timeRemaining = document.getElementById('time-remaining');
  const chips = document.getElementById('header-chips');

  dot.classList.remove('available');
  label.classList.remove('available');
  label.textContent = 'Unavailable';
  timeRemaining.textContent = '';
  timeRemaining.style.display = 'none';
  hideChips(chips);
  clearInterval(countdownTimer);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/me.test.js --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/me.js tests/me.test.js
git commit -m "feat: replace slider with chip-based time selection in me.js (initHeader)"
```

---

## Chunk 3: mycode.js → initCodeDrawer

### Task 5: Remove renderFollowers from mycode.js

**Files:**
- Modify: `js/mycode.js`
- Modify: `tests/mycode.test.js`

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/mycode.test.js`:

```js
// tests/mycode.test.js
jest.mock('../js/db.js', () => ({
  rotateCode: jest.fn(),
}));
jest.mock('../js/identity.js', () => ({ saveIdentity: jest.fn() }));

const { rotateCode } = require('../js/db.js');
const { saveIdentity } = require('../js/identity.js');
const { initCodeDrawer } = require('../js/mycode.js');

beforeEach(() => {
  document.body.innerHTML = `
    <span id="my-code-display" class="code-display"></span>
    <button id="rotate-code-btn" class="rotate-btn"></button>
    <button id="copy-code-btn" class="ghost-btn">Copy</button>
    <p id="rotate-error-msg" class="error-msg hidden"></p>
  `;
  Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
  jest.clearAllMocks();
});

test('initCodeDrawer sets code display to initial code', () => {
  initCodeDrawer('uid1', 'ABC123');
  expect(document.getElementById('my-code-display').textContent).toBe('ABC123');
});

test('initCodeDrawer: rotate button opens confirm sheet when online', () => {
  initCodeDrawer('uid1', 'ABC123');
  document.getElementById('rotate-code-btn').click();
  const sheet = document.getElementById('rotate-confirm');
  expect(sheet).not.toBeNull();
  expect(sheet.classList.contains('hidden')).toBe(false);
});

test('initCodeDrawer: rotate button does nothing when offline', () => {
  Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
  initCodeDrawer('uid1', 'ABC123');
  document.getElementById('rotate-code-btn').click();
  // confirm sheet is injected on init but stays hidden
  const sheet = document.getElementById('rotate-confirm');
  expect(sheet.classList.contains('hidden')).toBe(true);
});

test('rotate success: updates code display and calls saveIdentity', async () => {
  rotateCode.mockResolvedValue('XYZ789');
  initCodeDrawer('uid1', 'ABC123');

  // Open confirm, click generate
  document.getElementById('rotate-code-btn').click();
  document.getElementById('rotate-do-btn').click();

  // Flush promises and the 200ms fade timeout
  await new Promise((resolve) => setTimeout(resolve, 250));

  expect(document.getElementById('my-code-display').textContent).toBe('XYZ789');
  expect(saveIdentity).toHaveBeenCalledWith('uid1', 'XYZ789');
});

test('rotate error: shows error message and re-enables buttons', async () => {
  rotateCode.mockRejectedValue(new Error('network'));
  initCodeDrawer('uid1', 'ABC123');

  document.getElementById('rotate-code-btn').click();
  document.getElementById('rotate-do-btn').click();

  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(document.getElementById('rotate-error-msg').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('rotate-code-btn').disabled).toBe(false);
  expect(document.getElementById('copy-code-btn').disabled).toBe(false);
});

test('copy button calls clipboard.writeText with current code', () => {
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    get: () => ({ writeText }),
    configurable: true,
  });
  initCodeDrawer('uid1', 'ABC123');
  document.getElementById('copy-code-btn').click();
  expect(writeText).toHaveBeenCalledWith('ABC123');
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/mycode.test.js --no-coverage
```

Expected: FAIL — `initCodeDrawer` not exported.

- [ ] **Step 3: Update mycode.js**

In `js/mycode.js`:
- Rename `initMyCodeTab` → `initCodeDrawer`
- Remove the `import { watchFollowers, removeFollower, rotateCode }` line and replace with `import { rotateCode } from './db.js';`
- Remove the `watchFollowers(myUserId, ...)` call at the bottom of `initCodeDrawer`
- Remove the `export function renderFollowers(...)` function entirely

The resulting file:

```js
// js/mycode.js
import { rotateCode } from './db.js';
import { saveIdentity } from './identity.js';

export function initCodeDrawer(myUserId, myCode) {
  let currentCode = myCode;

  document.getElementById('my-code-display').textContent = currentCode;

  document.getElementById('copy-code-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(currentCode).then(() => {
      const btn = document.getElementById('copy-code-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    });
  });

  // Inject rotate confirm sheet once (guard prevents duplicate on re-init)
  if (!document.getElementById('rotate-confirm')) {
    const el = document.createElement('div');
    el.id = 'rotate-confirm';
    el.className = 'confirm-overlay hidden';
    el.innerHTML = `
      <div class="confirm-sheet">
        <h4>Generate a new code?</h4>
        <p>Your current code will no longer work for new people to find you.</p>
        <div class="confirm-btns">
          <button class="confirm-btn-cancel" id="rotate-cancel-btn">Cancel</button>
          <button class="confirm-btn-generate" id="rotate-do-btn">Generate</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el) dismissRotateConfirm(); });
    document.getElementById('rotate-cancel-btn').addEventListener('click', dismissRotateConfirm);
    document.getElementById('rotate-do-btn').addEventListener('click', doRotate);
  }

  document.getElementById('rotate-code-btn').addEventListener('click', () => {
    if (!navigator.onLine) return;
    document.getElementById('rotate-confirm').classList.remove('hidden');
  });

  async function doRotate() {
    dismissRotateConfirm();
    const rotateBtn = document.getElementById('rotate-code-btn');
    const copyBtn = document.getElementById('copy-code-btn');
    const errorEl = document.getElementById('rotate-error-msg');

    rotateBtn.classList.add('spinning');
    rotateBtn.disabled = true;
    copyBtn.disabled = true;
    errorEl.classList.add('hidden');

    try {
      const newCode = await rotateCode(myUserId, currentCode);

      const display = document.getElementById('my-code-display');
      display.classList.add('fading');
      await new Promise((r) => setTimeout(r, 200));
      display.textContent = newCode;
      display.classList.remove('fading');

      currentCode = newCode;
      saveIdentity(myUserId, newCode);
    } catch (_e) {
      errorEl.classList.remove('hidden');
    } finally {
      rotateBtn.classList.remove('spinning');
      rotateBtn.disabled = false;
      copyBtn.disabled = false;
    }
  }

  function dismissRotateConfirm() {
    document.getElementById('rotate-confirm').classList.add('hidden');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/mycode.test.js --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npx jest --no-coverage
```

Expected: all test files PASS.

- [ ] **Step 6: Commit**

```bash
git add js/mycode.js tests/mycode.test.js
git commit -m "feat: rename initMyCodeTab→initCodeDrawer, remove renderFollowers from mycode.js"
```

---

## Chunk 4: following.js → initList + renderList + final build

### Task 6: Refactor following.js — merged list with sections

**Files:**
- Modify: `js/following.js`
- Modify: `tests/following.test.js`

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/following.test.js`:

```js
// tests/following.test.js
jest.mock('../js/db.js', () => ({
  lookupCode: jest.fn(),
  watchStatus: jest.fn(),
  watchFollowers: jest.fn(),
  registerAsFollower: jest.fn(),
  unregisterAsFollower: jest.fn(),
  removeFollower: jest.fn(),
  isExpired: jest.fn(() => false),
  writeBackExpired: jest.fn(),
  formatTimeRemainingFuzzy: jest.fn(() => 'about 2 hours left'),
  timeRemainingMs: jest.fn(() => 7200000),
  formatLastSeen: jest.fn(() => null),
}));
jest.mock('../js/store.js', () => ({
  getFollowing: jest.fn(),
  addFollowing: jest.fn(),
  removeFollowing: jest.fn(),
  renameFollowing: jest.fn(),
  updateFollowingCode: jest.fn(),
}));

const { watchStatus, watchFollowers, updateFollowingCode } = require('../js/db.js');
const { getFollowing } = require('../js/store.js');
const { initList } = require('../js/following.js');

function setupDom() {
  document.body.innerHTML = `
    <ul id="people-list"></ul>
    <p id="empty-list-msg" class="hidden">Add someone below to get started.</p>
    <button id="add-person-btn"></button>
    <div id="add-person-form" class="hidden">
      <input id="add-code-input" />
      <input id="add-label-input" />
      <p id="add-error" class="hidden"></p>
      <button id="add-submit-btn"></button>
      <button id="add-cancel-btn"></button>
    </div>
    <div id="offline-banner" class="hidden"></div>
  `;
}

/// Helper: call initList and capture the watchFollowers callback.
// Calling the returned fn(followersArray) triggers renderList().
function initAndCaptureFollowersCallback(myUserId = 'myUid', myCode = 'MYCODE') {
  let followersCallback;
  watchFollowers.mockImplementation((_userId, cb) => {
    followersCallback = cb;
    return jest.fn();
  });
  watchStatus.mockReturnValue(jest.fn());
  initList(myUserId, myCode);
  return (arr) => followersCallback(arr);
}

// --- renderList: section rendering ---

describe('renderList: sections', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
  });

  test('user in both getFollowing and followers → row under "Mutuals" label', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'XY9K2M' }]);

    const labels = Array.from(document.querySelectorAll('.list-section-label'));
    expect(labels.some(l => l.textContent === 'Mutuals')).toBe(true);
    expect(labels.some(l => l.textContent === 'Following')).toBe(false);
    expect(labels.some(l => l.textContent === 'Followers')).toBe(false);
  });

  test('user in getFollowing but not followers → row under "Following" label', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([]); // no followers

    const labels = Array.from(document.querySelectorAll('.list-section-label'));
    expect(labels.some(l => l.textContent === 'Following')).toBe(true);
    expect(labels.some(l => l.textContent === 'Mutuals')).toBe(false);
  });

  test('user in followers but not getFollowing → row under "Followers" label', () => {
    getFollowing.mockReturnValue([]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u2', code: 'Q3ZP7R' }]);

    const labels = Array.from(document.querySelectorAll('.list-section-label'));
    expect(labels.some(l => l.textContent === 'Followers')).toBe(true);
    expect(labels.some(l => l.textContent === 'Mutuals')).toBe(false);
    expect(labels.some(l => l.textContent === 'Following')).toBe(false);
  });

  test('empty section has no label rendered', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([]); // no followers → no Mutuals, no Followers labels

    const labels = Array.from(document.querySelectorAll('.list-section-label'));
    expect(labels.some(l => l.textContent === 'Mutuals')).toBe(false);
    expect(labels.some(l => l.textContent === 'Followers')).toBe(false);
  });

  test('all groups empty → #empty-list-msg shown, #people-list hidden', () => {
    getFollowing.mockReturnValue([]);
    const fire = initAndCaptureFollowersCallback();
    fire([]);

    expect(document.getElementById('empty-list-msg').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('people-list').style.display).toBe('none');
  });

  test('non-empty list → #empty-list-msg hidden, #people-list visible', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([]);

    expect(document.getElementById('empty-list-msg').classList.contains('hidden')).toBe(true);
  });
});

// --- renderList: follower-only rows ---

describe('renderList: follower-only rows', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
  });

  test('follower-only row has .follower-only class', () => {
    getFollowing.mockReturnValue([]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u2', code: 'Q3ZP7R' }]);

    const li = document.querySelector('[data-user-id="u2"]');
    expect(li).not.toBeNull();
    expect(li.classList.contains('follower-only')).toBe(true);
  });

  test('follower-only row has .follow-back-btn', () => {
    getFollowing.mockReturnValue([]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u2', code: 'Q3ZP7R' }]);

    const li = document.querySelector('[data-user-id="u2"]');
    expect(li.querySelector('.follow-back-btn')).not.toBeNull();
  });

  test('clicking follow-back btn pre-fills code input and shows add form', () => {
    getFollowing.mockReturnValue([]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u2', code: 'Q3ZP7R' }]);

    const li = document.querySelector('[data-user-id="u2"]');
    li.querySelector('.follow-back-btn').click();

    expect(document.getElementById('add-code-input').value).toBe('Q3ZP7R');
    expect(document.getElementById('add-person-form').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('add-person-btn').classList.contains('hidden')).toBe(true);
  });
});

// --- renderList: name display (moved from mycode.test.js) ---

describe('renderList: name display on mutual rows', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
  });

  test('mutual row with non-empty label shows .person-follower-name with code', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'XY9K2M' }]);

    const li = document.querySelector('[data-user-id="u1"]');
    const nameEl = li.querySelector('.person-follower-name');
    expect(nameEl).not.toBeNull();
    expect(nameEl.textContent).toBe('XY9K2M');
  });

  test('mutual row with empty label has no .person-follower-name', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: '' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'XY9K2M' }]);

    const li = document.querySelector('[data-user-id="u1"]');
    expect(li.querySelector('.person-follower-name')).toBeNull();
  });

  test('mutual row with label: primary .person-label shows label text', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'XY9K2M' }]);

    const li = document.querySelector('[data-user-id="u1"]');
    expect(li.querySelector('.person-label').textContent).toBe('Alice');
  });
});

// --- renderList: XSS escaping (moved from mycode.test.js) ---

describe('renderList: XSS escaping', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
  });

  test('escapes HTML in label', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: '<b>Alice</b>' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'XY9K2M' }]);

    const li = document.querySelector('[data-user-id="u1"]');
    const labelEl = li.querySelector('.person-label');
    expect(labelEl.textContent).toBe('<b>Alice</b>');
    expect(labelEl.innerHTML).not.toContain('<b>');
  });

  test('escapes HTML in code', () => {
    getFollowing.mockReturnValue([]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: '<img>' }]);

    const li = document.querySelector('[data-user-id="u1"]');
    expect(li.innerHTML).not.toContain('<img>');
  });
});

// --- confirm dialog: unfollow and removeFollower routing ---

describe('confirm dialog', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
  });

  test('× on following row sets confirm title to "Unfollow [name]?" and button to "Unfollow"', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);
    const fire = initAndCaptureFollowersCallback();
    fire([]); // u1 is following-only

    const li = document.querySelector('[data-user-id="u1"]');
    li.querySelector('.unfollow-btn').click();

    expect(document.getElementById('unfollow-confirm-title').textContent).toBe('Unfollow Alice?');
    expect(document.getElementById('unfollow-do-btn').textContent).toBe('Unfollow');
    expect(document.getElementById('unfollow-confirm').classList.contains('hidden')).toBe(false);
  });

  test('× on follower-only row sets confirm title to "Remove follower [code]?" and button to "Remove"', () => {
    getFollowing.mockReturnValue([]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u2', code: 'Q3ZP7R' }]); // u2 is follower-only

    const li = document.querySelector('[data-user-id="u2"]');
    li.querySelector('.unfollow-btn').click();

    expect(document.getElementById('unfollow-confirm-title').textContent).toBe('Remove follower Q3ZP7R?');
    expect(document.getElementById('unfollow-do-btn').textContent).toBe('Remove');
    expect(document.getElementById('unfollow-confirm').classList.contains('hidden')).toBe(false);
  });
});

// --- subscribeToFollowee — code-change sync (updated for initList) ---

describe('subscribeToFollowee — code-change sync', () => {
  let watchFollowersCallback;
  let watchStatusCallback;

  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();

    watchFollowers.mockImplementation((_userId, cb) => {
      watchFollowersCallback = cb;
      return jest.fn();
    });
    watchStatus.mockImplementation((_userId, cb) => {
      watchStatusCallback = cb;
      return jest.fn();
    });

    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'OLD123', label: 'Alice' },
    ]);

    initList('myUserId', 'MYCODE');
    // Fire followers callback to trigger renderList, which calls subscribeToFollowee
    // (u1 is in getFollowing but not in followers → Following section; subscribeToFollowee called)
    watchFollowersCallback([]);
  });

  test('calls updateFollowingCode when userData.code differs from entry.code', () => {
    watchStatusCallback({ status: 'unavailable', code: 'NEW456' });
    expect(updateFollowingCode).toHaveBeenCalledWith('u1', 'NEW456');
  });

  test('does not call updateFollowingCode when userData.code matches entry.code', () => {
    watchStatusCallback({ status: 'unavailable', code: 'OLD123' });
    expect(updateFollowingCode).not.toHaveBeenCalled();
  });

  test('does not call updateFollowingCode when userData.code is absent', () => {
    watchStatusCallback({ status: 'unavailable' });
    expect(updateFollowingCode).not.toHaveBeenCalled();
  });

  test('updates entry.code in place so a second identical callback does not trigger another sync', () => {
    watchStatusCallback({ status: 'unavailable', code: 'NEW456' });
    watchStatusCallback({ status: 'unavailable', code: 'NEW456' });
    expect(updateFollowingCode).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (and not due to import errors)**

```bash
npx jest tests/following.test.js --no-coverage
```

Expected: FAIL — `initList` is not exported, `watchFollowers` not in mock context. Some existing tests may also fail.

- [ ] **Step 3: Implement following.js changes**

Replace the entire contents of `js/following.js`:

```js
// js/following.js
import {
  lookupCode, watchStatus, watchFollowers, registerAsFollower, unregisterAsFollower,
  removeFollower, isExpired, writeBackExpired, formatTimeRemainingFuzzy, timeRemainingMs,
  formatLastSeen,
} from './db.js';
import { getFollowing, addFollowing, removeFollowing, renameFollowing, updateFollowingCode } from './store.js';
import { escapeHtml } from './utils.js';

const unsubscribers = new Map(); // userId → unsubscribe fn
const editingSet = new Set();
const lastUserData = new Map(); // userId → most recent userData from Firebase

let latestFollowersSnapshot = [];
let unsubFollowers = null;
let pendingAction = null; // { type: 'unfollow'|'removeFollower', userId, myUserId }
let myUserIdRef = null; // set at init time; used by renderList and confirm handlers

function showConfirm(title, btnText, action) {
  pendingAction = action;
  document.getElementById('unfollow-confirm-title').textContent = title;
  document.getElementById('unfollow-do-btn').textContent = btnText;
  document.getElementById('unfollow-confirm').classList.remove('hidden');
}

function dismissConfirm() {
  document.getElementById('unfollow-confirm').classList.add('hidden');
  pendingAction = null;
}

async function doConfirm() {
  if (!pendingAction) return;
  const action = pendingAction;
  dismissConfirm();

  if (action.type === 'unfollow') {
    const unsub = unsubscribers.get(action.userId);
    if (unsub) unsub();
    unsubscribers.delete(action.userId);
    lastUserData.delete(action.userId);
    await unregisterAsFollower(action.userId, action.myUserId);
    removeFollowing(action.userId);
    renderList();
  } else if (action.type === 'removeFollower') {
    await removeFollower(action.myUserId, action.userId);
    // latestFollowersSnapshot will be updated by watchFollowers callback automatically
    // but we re-render immediately using the current snapshot minus the removed entry
    latestFollowersSnapshot = latestFollowersSnapshot.filter(f => f.userId !== action.userId);
    renderList();
  }
}

export function initList(myUserId, myCode) {
  myUserIdRef = myUserId;

  // Reset stale subscription state from any prior init (also makes tests independent)
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers.clear();
  lastUserData.clear();
  editingSet.clear();
  latestFollowersSnapshot = [];
  pendingAction = null;

  // Inject confirm sheet once
  if (!document.getElementById('unfollow-confirm')) {
    const confirmEl = document.createElement('div');
    confirmEl.id = 'unfollow-confirm';
    confirmEl.className = 'confirm-overlay hidden';
    confirmEl.innerHTML = `
    <div class="confirm-sheet">
      <h4 id="unfollow-confirm-title">Unfollow?</h4>
      <p>They won't be notified. You can re-add them later using their code.</p>
      <div class="confirm-btns">
        <button class="confirm-btn-cancel" id="unfollow-cancel-btn">Cancel</button>
        <button class="confirm-btn-remove" id="unfollow-do-btn">Unfollow</button>
      </div>
    </div>`;
    document.body.appendChild(confirmEl);
    confirmEl.addEventListener('click', (e) => { if (e.target === confirmEl) dismissConfirm(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' &&
          !document.getElementById('unfollow-confirm').classList.contains('hidden')) {
        dismissConfirm();
      }
    });
    document.getElementById('unfollow-cancel-btn').addEventListener('click', dismissConfirm);
    document.getElementById('unfollow-do-btn').addEventListener('click', doConfirm);
  }

  // Subscribe to followers list
  if (unsubFollowers) unsubFollowers();
  unsubFollowers = watchFollowers(myUserId, (followers) => {
    latestFollowersSnapshot = followers;
    renderList();
  });

  // Refresh time labels every 60s
  setInterval(() => {
    getFollowing().forEach((entry) => {
      const userData = lastUserData.get(entry.userId);
      if (!userData || userData.status !== 'available') return;
      if (editingSet.has(entry.userId)) return;
      updateFolloweeRow(entry, userData, myUserId);
    });
  }, 60000);

  document.getElementById('add-person-btn').addEventListener('click', () => {
    document.getElementById('add-person-form').classList.remove('hidden');
    document.getElementById('add-person-btn').classList.add('hidden');
    document.getElementById('add-code-input').focus();
  });

  document.getElementById('add-cancel-btn').addEventListener('click', closeAddForm);

  document.getElementById('add-code-input').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  document.getElementById('add-submit-btn').addEventListener('click', () => {
    handleAddPerson(myUserId, myCode);
  });

  window.addEventListener('online', () => document.getElementById('offline-banner').classList.add('hidden'));
  window.addEventListener('offline', () => document.getElementById('offline-banner').classList.remove('hidden'));
  if (!navigator.onLine) document.getElementById('offline-banner').classList.remove('hidden');
}

function renderList() {
  const myUserId = myUserIdRef;
  const following = getFollowing();
  const followerIds = new Set(latestFollowersSnapshot.map(f => f.userId));

  const mutuals = following.filter(f => followerIds.has(f.userId));
  const followingOnly = following.filter(f => !followerIds.has(f.userId));
  const followerOnly = latestFollowersSnapshot.filter(
    f => !following.find(g => g.userId === f.userId)
  );

  // Unsubscribe only entries no longer in the active (mutual/following) set.
  // Preserving existing subscriptions prevents a visible flash to "Unavailable"
  // on every followers-list change, and keeps lastUserData accurate for sorting.
  const activeUserIds = new Set([...mutuals, ...followingOnly].map(e => e.userId));
  unsubscribers.forEach((unsub, userId) => {
    if (!activeUserIds.has(userId)) {
      unsub();
      unsubscribers.delete(userId);
      lastUserData.delete(userId);
    }
  });

  const list = document.getElementById('people-list');
  const emptyMsg = document.getElementById('empty-list-msg');

  const isEmpty = mutuals.length === 0 && followingOnly.length === 0 && followerOnly.length === 0;
  if (isEmpty) {
    list.innerHTML = '';
    list.style.display = 'none';
    emptyMsg.classList.remove('hidden');
    return;
  }

  list.style.display = '';
  emptyMsg.classList.add('hidden');
  list.innerHTML = '';

  // Sort uses lastUserData which still has status for entries with active subscriptions.
  // New entries (not yet subscribed) will sort as unavailable until Firebase delivers status.
  function sortFollowees(entries) {
    return [...entries].sort((a, b) => {
      const aData = lastUserData.get(a.userId);
      const bData = lastUserData.get(b.userId);
      const aAvail = aData ? aData.status === 'available' && !isExpired(aData.availableUntil) : false;
      const bAvail = bData ? bData.status === 'available' && !isExpired(bData.availableUntil) : false;
      if (aAvail !== bAvail) return bAvail ? 1 : -1;
      const aName = a.label || a.code;
      const bName = b.label || b.code;
      return aName.localeCompare(bName);
    });
  }

  function sortFollowerOnly(entries) {
    return [...entries].sort((a, b) => a.code.localeCompare(b.code));
  }

  function appendSection(labelText, entries, renderRow) {
    if (entries.length === 0) return;
    const labelLi = document.createElement('li');
    labelLi.className = 'list-section-label';
    labelLi.textContent = labelText;
    list.appendChild(labelLi);
    entries.forEach(renderRow);
  }

  appendSection('Mutuals', sortFollowees(mutuals), (entry) => {
    createFolloweeRow(entry, myUserId);
    // Only subscribe for entries not already subscribed (preserves existing connection)
    if (!unsubscribers.has(entry.userId)) {
      subscribeToFollowee(entry, myUserId);
    }
  });

  appendSection('Following', sortFollowees(followingOnly), (entry) => {
    createFolloweeRow(entry, myUserId);
    if (!unsubscribers.has(entry.userId)) {
      subscribeToFollowee(entry, myUserId);
    }
  });

  appendSection('Followers', sortFollowerOnly(followerOnly), (follower) => {
    createFollowerOnlyRow(follower, myUserId);
  });
}

function createFolloweeRow(entry, myUserId) {
  const li = document.createElement('li');
  li.dataset.userId = entry.userId;

  const nameHtml = (entry.label)
    ? `<div class="person-label">${escapeHtml(entry.label)}</div>
       <div class="person-follower-name">${escapeHtml(entry.code)}</div>`
    : `<div class="person-label" style="font-family:monospace">${escapeHtml(entry.code)}</div>`;

  li.innerHTML = `
    <div class="person-dot"></div>
    <div class="person-info">
      ${nameHtml}
      <div class="person-status">Unavailable</div>
    </div>
    <button class="unfollow-btn" title="Unfollow">×</button>`;

  const displayName = entry.label || entry.code;
  li.querySelector('.unfollow-btn').addEventListener('click', () => {
    showConfirm(`Unfollow ${displayName}?`, 'Unfollow', {
      type: 'unfollow',
      userId: entry.userId,
      myUserId,
    });
  });

  li.querySelector('.person-label').addEventListener('click', () => {
    activateRename(entry, li.querySelector('.person-label'));
  });

  document.getElementById('people-list').appendChild(li);
}

function createFollowerOnlyRow(follower, myUserId) {
  const li = document.createElement('li');
  li.className = 'follower-only';
  li.dataset.userId = follower.userId;

  li.innerHTML = `
    <button class="follow-back-btn" title="Follow back">+</button>
    <div class="person-info">
      <div class="person-label" style="font-family:monospace">${escapeHtml(follower.code)}</div>
    </div>
    <button class="unfollow-btn" title="Remove">×</button>`;

  li.querySelector('.follow-back-btn').addEventListener('click', () => {
    document.getElementById('add-code-input').value = follower.code;
    document.getElementById('add-label-input').value = '';
    document.getElementById('add-person-form').classList.remove('hidden');
    document.getElementById('add-person-btn').classList.add('hidden');
  });

  li.querySelector('.unfollow-btn').addEventListener('click', () => {
    showConfirm(`Remove follower ${follower.code}?`, 'Remove', {
      type: 'removeFollower',
      userId: follower.userId,
      myUserId,
    });
  });

  document.getElementById('people-list').appendChild(li);
}

function subscribeToFollowee(entry, myUserId) {
  const unsub = watchStatus(entry.userId, (userData) => {
    if (!userData) return;

    if (userData.revokedFollowers && userData.revokedFollowers[myUserId]) {
      removeFollowing(entry.userId);
      unsub();
      unsubscribers.delete(entry.userId);
      renderList();
      return;
    }

    if (userData.status === 'available' && isExpired(userData.availableUntil)) {
      if (navigator.onLine) writeBackExpired(entry.userId);
      userData.status = 'unavailable';
      userData.availableUntil = null;
    }

    if (userData.code && userData.code !== entry.code) {
      entry.code = userData.code;
      updateFollowingCode(entry.userId, userData.code);
    }

    lastUserData.set(entry.userId, userData);
    if (editingSet.has(entry.userId)) return;
    updateFolloweeRow(entry, userData, myUserId);
  });
  unsubscribers.set(entry.userId, unsub);
}

function updateFolloweeRow(entry, userData, myUserId) {
  const li = document.querySelector(`[data-user-id="${entry.userId}"]`);
  if (!li) return;

  const isAvail = userData.status === 'available' && !isExpired(userData.availableUntil);
  const ms = timeRemainingMs(userData.availableUntil);
  let statusText;
  if (isAvail) {
    statusText = `<span class="status-available">Available for ${formatTimeRemainingFuzzy(ms).replace(/ left$/, '')}</span>`;
  } else {
    const lastSeenPhrase = formatLastSeen(userData.lastSeen ?? null);
    statusText = lastSeenPhrase ? `Last seen ${lastSeenPhrase}` : 'Unavailable';
  }

  li.dataset.available = String(isAvail);
  const dot = li.querySelector('.person-dot');
  if (dot) dot.className = `person-dot${isAvail ? ' available' : ''}`;
  const statusEl = li.querySelector('.person-status');
  if (statusEl) statusEl.innerHTML = statusText;
}

function getLabelText(li) {
  const labelEl = li.querySelector('.person-label');
  const input = labelEl ? labelEl.querySelector('.rename-input') : null;
  return input ? input.value : (labelEl ? labelEl.textContent : '');
}

function activateRename(entry, labelEl) {
  const original = entry.label;
  editingSet.add(entry.userId);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = original;
  labelEl.textContent = '';
  labelEl.appendChild(input);
  input.focus();
  input.select();

  function confirmRename() {
    const val = input.value.trim();
    if (!val) return;
    renameFollowing(entry.userId, val);
    entry.label = val;
    editingSet.delete(entry.userId);
    labelEl.textContent = val;
  }

  function cancelRename() {
    editingSet.delete(entry.userId);
    labelEl.textContent = original;
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmRename(); }
    if (e.key === 'Escape') { cancelRename(); }
  });
  input.addEventListener('blur', () => {
    if (editingSet.has(entry.userId)) confirmRename();
  });
}

async function handleAddPerson(myUserId, myCode) {
  const codeInput = document.getElementById('add-code-input');
  const labelInput = document.getElementById('add-label-input');
  const errorEl = document.getElementById('add-error');

  const code = codeInput.value.trim().toUpperCase();
  const label = labelInput.value.trim();

  errorEl.classList.add('hidden');

  if (!code) {
    showError(errorEl, 'Please enter a code.');
    return;
  }

  if (code.length !== 6 || !/^[A-Z0-9]{6}$/.test(code)) {
    showError(errorEl, 'Code must be 6 letters and numbers.');
    return;
  }

  if (code === myCode.toUpperCase()) {
    showError(errorEl, "That's your own code.");
    return;
  }

  const following = getFollowing();
  const existing = following.find((e) => e.code.toUpperCase() === code);
  if (existing) {
    showError(errorEl, `You're already following ${existing.label || existing.code}.`);
    return;
  }

  document.getElementById('add-submit-btn').disabled = true;

  const targetUserId = await lookupCode(code);
  if (!targetUserId) {
    showError(errorEl, 'Code not found. Check the code and try again.');
    document.getElementById('add-submit-btn').disabled = false;
    return;
  }

  await registerAsFollower(targetUserId, myUserId, myCode);
  addFollowing({ code, label, userId: targetUserId });
  closeAddForm();
  renderList();
  document.getElementById('add-submit-btn').disabled = false;
}

function closeAddForm() {
  document.getElementById('add-person-form').classList.add('hidden');
  document.getElementById('add-person-btn').classList.remove('hidden');
  document.getElementById('add-code-input').value = '';
  document.getElementById('add-label-input').value = '';
  document.getElementById('add-error').classList.add('hidden');
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}
```

- [ ] **Step 4: Run all tests**

```bash
npx jest --no-coverage
```

Expected: all test files PASS. If any fail, fix before continuing.

- [ ] **Step 5: Run final build**

```bash
npm run build
```

Expected: exits 0, `dist/bundle.js` updated.

- [ ] **Step 6: Commit**

```bash
git add js/following.js tests/following.test.js
git commit -m "feat: refactor following.js — initList, renderList with Mutuals/Following/Followers sections"
```
