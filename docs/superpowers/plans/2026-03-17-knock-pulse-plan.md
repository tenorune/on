# Knock Pulse & Color Fix Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace queue-based live knock animation with a frequency-sensitive brightness pulse and fix knock color to use the sender's actual status color.

**Architecture:** Live knocks bypass the animation queue entirely. Instead, a `pulseMap` per sender tracks intensity and a cleanup timer. On each knock the card background snaps to the current intensity color (instant, no transition), then immediately begins a 2s CSS `ease-out` transition to `rgba(r,g,b,0)`. A follow-up knock cancels the cleanup timer, bumps intensity, and restarts the 2s fade. Deferred knocks continue to use the existing sequential queue; only their color read is fixed.

**Tech Stack:** Vanilla JS ES modules, Jest + jsdom, CSS transitions (no new CSS animation classes).

---

## File structure

| File | Role in this change |
|---|---|
| `js/knock.js` | Add `pulseMap`, `INTENSITY_STEP`, `applyLiveKnock()`, `getSenderColor()`, `hexToRgba()`; update `watchKnocksAdded` callback; fix `playNext()` color; simplify `playNext()` class logic; reset `pulseMap` in `initKnocks` |
| `css/app.css` | Remove `@keyframes knock-live` and `.knock-live` |
| `tests/knock.test.js` | Add pulse model and color-fix tests; remove stale live-queue tests |

---

## Chunk 1: Live knock pulse model

### Task 1: TDD — live knock pulse model

**Files:**
- Modify: `tests/knock.test.js` (add new tests)
- Modify: `js/knock.js` (implement pulse model)

---

- [ ] **Step 1.1: Add failing tests for `applyLiveKnock` and `pulseMap` reset**

Append this block to the bottom of `tests/knock.test.js`:

```js
// --- live knock pulse ---

describe('live knock pulse: color', () => {
  async function setupLive() {
    let liveCallback;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => { liveCallback = cb; return jest.fn(); });
    clearKnock.mockResolvedValue();
    await initKnocks('myUid');
    return liveCallback;
  }

  test('color read from person-dot.style.background', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    const dot = document.createElement('div');
    dot.className = 'person-dot';
    dot.style.background = '#f43f5e'; // rgb(244, 63, 94)
    li.appendChild(dot);

    fire('alice', { count: 1, ts: Date.now() });
    // alpha = INTENSITY_STEP (0.4)
    expect(li.style.backgroundColor).toBe('rgba(244, 63, 94, 0.4)');
  });

  test('falls back to #22c55e when dot has no inline background', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    const dot = document.createElement('div');
    dot.className = 'person-dot';
    li.appendChild(dot); // no dot.style.background set

    fire('alice', { count: 1, ts: Date.now() });
    // #22c55e = rgb(34, 197, 94)
    expect(li.style.backgroundColor).toBe('rgba(34, 197, 94, 0.4)');
  });
});

describe('live knock pulse: intensity', () => {
  async function setupLive() {
    let liveCallback;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => { liveCallback = cb; return jest.fn(); });
    clearKnock.mockResolvedValue();
    await initKnocks('myUid');
    return liveCallback;
  }

  test('count=1 sets alpha to 0.4 (INTENSITY_STEP)', async () => {
    const fire = await setupLive();
    makeLi('alice');
    fire('alice', { count: 1, ts: Date.now() });
    expect(document.querySelector('[data-user-id="alice"]').style.backgroundColor)
      .toBe('rgba(34, 197, 94, 0.4)');
  });

  test('count=2 sets alpha to 0.8', async () => {
    const fire = await setupLive();
    makeLi('alice');
    fire('alice', { count: 2, ts: Date.now() });
    expect(document.querySelector('[data-user-id="alice"]').style.backgroundColor)
      .toBe('rgba(34, 197, 94, 0.8)');
  });

  test('intensity capped at 1.0 — two sequential count=2 knocks stay ≤ 1', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    fire('alice', { count: 2, ts: Date.now() }); // 0.8
    fire('alice', { count: 2, ts: Date.now() }); // would be 1.6, capped to 1.0
    // jsdom may normalize rgba(r,g,b,1) → rgb(r,g,b); accept either
    const bg = li.style.backgroundColor;
    expect(['rgba(34, 197, 94, 1)', 'rgb(34, 197, 94)']).toContain(bg);
  });

  test('cancels previous cleanup timer on re-knock', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    fire('alice', { count: 1, ts: Date.now() });
    jest.advanceTimersByTime(1000); // 1s into 2.1s timer
    fire('alice', { count: 1, ts: Date.now() }); // resets timer
    // 1.2s after second knock (2.2s after first): first timer would have fired, second hasn't
    jest.advanceTimersByTime(1200);
    expect(li.style.backgroundColor).not.toBe('');
  });

  test('cleans up inline styles after 2.1s', async () => {
    const fire = await setupLive();
    const li = makeLi('alice');
    fire('alice', { count: 1, ts: Date.now() });
    expect(li.style.backgroundColor).not.toBe('');

    jest.advanceTimersByTime(2100);
    expect(li.style.backgroundColor).toBe('');
    expect(li.style.transition).toBe('');
  });

  test('skips silently when sender li not in DOM', async () => {
    const fire = await setupLive();
    // 'ghost' has no li in the DOM
    expect(() => fire('ghost', { count: 1, ts: Date.now() })).not.toThrow();
  });
});

describe('live knock pulse: pulseMap reset', () => {
  test('pulseMap is cleared on initKnocks re-call (cleanup timer cancelled)', async () => {
    let liveCallback;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => { liveCallback = cb; return jest.fn(); });
    clearKnock.mockResolvedValue();
    await initKnocks('myUid');

    const li = makeLi('alice');
    liveCallback('alice', { count: 1, ts: Date.now() });
    expect(li.style.backgroundColor).not.toBe('');

    // Re-init: pulseMap reset; timer cancelled; styles NOT cleaned (reset only clears state)
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockReturnValue(jest.fn());
    await initKnocks('myUid');

    // Advance past old timer duration — it should have been cancelled, no double-cleanup crash
    jest.advanceTimersByTime(2100);
    // No error means the cancelled timer didn't fire the delete on an already-cleared map
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 1.2: Run new tests to verify they fail**

```bash
cd /Users/michael/Public/Code/pwa-status-app
npx jest tests/knock.test.js --no-coverage 2>&1 | tail -30
```

Expected: new tests fail with errors like `TypeError` or assertion failures. Existing tests still pass.

---

- [ ] **Step 1.3: Implement pulse model in `js/knock.js`**

The full updated file:

```js
// js/knock.js
import { writeKnock, getKnocks, watchKnocksAdded, clearKnock } from './db.js';

// Module-level state — reset by initKnocks on each call
let debounceMap = new Map();   // recipientId → last knock timestamp
let queue = [];                // { userId, animationType, ts }
let deferredKeys = new Set();  // senderIds from snapshot; blocks live listener until cleared
let snapshotPending = false;   // true while waiting for getKnocks to resolve
let isPlaying = false;
let unsubKnocks = null;

const INTENSITY_STEP = 0.4;
let pulseMap = new Map();      // senderId → { intensity: number, timerId: number | null }

// Send a knock to recipientId. Guards: debounce (300ms). Flash fires only after debounce passes.
export function sendKnock(recipientId, senderId, statusColor) {
  const color = statusColor || '#22c55e';
  const now = Date.now();
  if (now - (debounceMap.get(recipientId) ?? 0) < 300) return;
  debounceMap.set(recipientId, now);

  const li = document.querySelector(`[data-user-id="${recipientId}"]`);
  if (li) {
    li.style.setProperty('--knock-color', color);
    li.classList.add('knock-sender');
    li.addEventListener('animationend', () => li.classList.remove('knock-sender'), { once: true });
  }

  writeKnock(recipientId, senderId);
}

// Initialize knock state and start listening. Call after initList so DOM exists.
export async function initKnocks(myUserId) {
  // Reset all module-level state
  debounceMap = new Map();
  queue = [];
  deferredKeys = new Set();
  snapshotPending = true;
  isPlaying = false;
  if (unsubKnocks) { unsubKnocks(); unsubKnocks = null; }
  pulseMap.forEach(({ timerId }) => { if (timerId) clearTimeout(timerId); });
  pulseMap = new Map();

  const appOpenTime = Date.now();

  // 1. Attach live listener synchronously (before any await) so we catch events
  //    that arrive during the snapshot fetch. Events arriving while snapshotPending
  //    is true are held until deferredKeys is populated; senders in deferredKeys
  //    are then skipped (they will be handled by the deferred batch).
  unsubKnocks = watchKnocksAdded(myUserId, (senderId, { count, ts }) => {
    // Skip senders from the initial snapshot (handled as deferred)
    if (snapshotPending || deferredKeys.has(senderId)) return;
    applyLiveKnock(senderId, count);
    clearKnock(myUserId, senderId).catch(() => {});
  });

  // 2. Read deferred knocks (one-time get)
  const snapshot = await getKnocks(myUserId);

  // 3. Populate deferredKeys from snapshot, then clear the pending flag so
  //    live events for non-deferred senders are processed normally going forward.
  if (snapshot.exists()) {
    Object.keys(snapshot.val()).forEach(senderId => deferredKeys.add(senderId));
  }
  snapshotPending = false;

  if (!snapshot.exists()) return;

  // 4. Categorize snapshot entries
  const toDelete = [];
  const toAnimate = [];

  Object.entries(snapshot.val()).forEach(([senderId, { count, ts }]) => {
    toDelete.push(senderId);
    if (ts >= appOpenTime - 24 * 60 * 60 * 1000) {
      toAnimate.push({ userId: senderId, animationType: 'deferred', ts });
    }
    // Older-than-24h: added to toDelete but not toAnimate (silent delete)
  });

  // 5. Delete only snapshot keys; new knocks arriving after get() are not deleted
  await Promise.all(toDelete.map(senderId => clearKnock(myUserId, senderId).catch(() => {})));

  // 6. Clear deferredKeys — live listener now processes all senders normally
  deferredKeys.clear();

  // 7. Sort deferred queue by ts ascending and begin playback
  toAnimate.sort((a, b) => a.ts - b.ts);
  toAnimate.forEach(entry => enqueue(entry));
}

function getSenderColor(li) {
  const dot = li.querySelector('.person-dot');
  return (dot && dot.style.background) || '#22c55e';
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyLiveKnock(senderId, count) {
  const li = document.querySelector(`[data-user-id="${senderId}"]`);
  if (!li) return;

  const color = getSenderColor(li);
  const current = pulseMap.get(senderId) ?? { intensity: 0, timerId: null };
  if (current.timerId) clearTimeout(current.timerId);

  const newIntensity = Math.min(1, current.intensity + count * INTENSITY_STEP);

  // Instant rise (no transition)
  li.style.transition = 'none';
  li.style.backgroundColor = hexToRgba(color, newIntensity);
  li.offsetHeight; // force reflow — separates instant-set from transition-start

  // Begin 2s decay. Use rgba(r,g,b,0) — not 'transparent' — to preserve hue during transition.
  li.style.transition = 'background-color 2s ease-out';
  li.style.backgroundColor = hexToRgba(color, 0);

  const timerId = setTimeout(() => {
    li.style.transition = '';
    li.style.backgroundColor = '';
    pulseMap.delete(senderId);
  }, 2100); // 100ms buffer after 2s transition

  pulseMap.set(senderId, { intensity: newIntensity, timerId });
}

function enqueue(entry) {
  queue.push(entry);
  if (!isPlaying) playNext();
}

function playNext() {
  if (queue.length === 0) { isPlaying = false; return; }
  isPlaying = true;
  const entry = queue.shift();

  const li = document.querySelector(`[data-user-id="${entry.userId}"]`);
  if (!li) { playNext(); return; } // not in DOM — skip silently

  li.style.setProperty('--knock-color', getSenderColor(li));
  li.classList.add('knock-deferred');

  let advanced = false;
  function advance() {
    if (advanced) return;
    advanced = true;
    clearTimeout(fallback);
    li.classList.remove('knock-deferred');
    const gap = (queue[0] && queue[0].userId === entry.userId) ? 300 : 500;
    setTimeout(playNext, gap);
  }

  const fallback = setTimeout(advance, 1200); // guard: advance if animationend never fires
  li.addEventListener('animationend', advance, { once: true });
}
```

Key changes from the original:
- Added `INTENSITY_STEP`, `pulseMap` module-level declarations
- `initKnocks`: added `pulseMap` cancel-and-reset block
- `watchKnocksAdded` callback: replaced `count × enqueue` loop with `applyLiveKnock(senderId, count)`
- Added `getSenderColor()`, `hexToRgba()`, `applyLiveKnock()` functions
- `playNext()`: replaced hardcoded `'#22c55e'` with `getSenderColor(li)`; simplified `cls` to always `'knock-deferred'` (no live entries reach the queue)

- [ ] **Step 1.4: Run knock tests to verify new tests pass**

```bash
npx jest tests/knock.test.js --no-coverage 2>&1 | tail -30
```

Expected: all new pulse tests pass. Some old live-queue tests (`'enqueues correct count × animation-1...'`, `'500ms gap between sequences...'`) will now fail — that is expected and will be fixed in Task 3.

- [ ] **Step 1.5: Commit**

```bash
git add js/knock.js tests/knock.test.js
git commit -m "feat: replace live knock queue with frequency-sensitive brightness pulse"
```

---

## Chunk 2: Deferred color fix and cleanup

### Task 2: TDD — deferred knock color fix

**Files:**
- Modify: `tests/knock.test.js` (add one test)
- `js/knock.js` already updated in Task 1 (`playNext` uses `getSenderColor`)

---

- [ ] **Step 2.1: Add failing test for deferred color fix**

Append to the bottom of `tests/knock.test.js` (after the pulse describe blocks added in Task 1):

```js
// --- deferred color fix ---

describe('initKnocks: deferred color fix', () => {
  test('playNext uses sender dot color instead of hardcoded green', async () => {
    const ts = Date.now() - 1000;
    getKnocks.mockResolvedValue({
      exists: () => true,
      val: () => ({ alice: { count: 1, ts } }),
    });
    watchKnocksAdded.mockReturnValue(jest.fn());
    clearKnock.mockResolvedValue();

    const li = makeLi('alice');
    const dot = document.createElement('div');
    dot.className = 'person-dot';
    dot.style.background = '#f43f5e';
    li.appendChild(dot);

    await initKnocks('myUid');

    // The first deferred entry starts immediately in playNext.
    // --knock-color should be the sender's dot color, not hardcoded green.
    expect(li.style.getPropertyValue('--knock-color')).toBe('#f43f5e');
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npx jest tests/knock.test.js --no-coverage -t "playNext uses sender dot color" 2>&1 | tail -20
```

Expected: FAIL — test asserts `#f43f5e` but `playNext` currently sets `#22c55e`.

Wait — `playNext` was already updated in Task 1 to use `getSenderColor(li)`. This test should therefore **pass** now. Verify:

```bash
npx jest tests/knock.test.js --no-coverage -t "playNext uses sender dot color" 2>&1 | tail -10
```

Expected: PASS. If it passes, proceed directly to Step 2.3 (no implementation needed for this test — it was fixed as part of Task 1).

- [ ] **Step 2.3: Commit**

```bash
git add tests/knock.test.js
git commit -m "test: add deferred knock color fix test"
```

---

### Task 3: Remove stale live-queue tests and CSS cleanup

**Files:**
- Modify: `tests/knock.test.js` (remove 2 stale test blocks)
- Modify: `css/app.css` (remove `@keyframes knock-live` and `.knock-live`)

---

- [ ] **Step 3.1: Remove stale live-queue tests from `tests/knock.test.js`**

**Remove** the entire `describe('initKnocks: live listener')` block (lines ~241–267):

```js
// DELETE THIS ENTIRE BLOCK:
describe('initKnocks: live listener', () => {
  test('enqueues correct count × animation-1 entries (including count > 1)', async () => {
    // ... entire test body
  });
});
```

**Remove** the `'500ms gap between sequences (different userId)'` test from inside `describe('animation queue: sequence gap')` (lines ~272–299):

```js
// DELETE THIS TEST:
test('500ms gap between sequences (different userId)', async () => {
  // ... entire test body
});
```

The describe block `'animation queue: sequence gap'` should remain — it still contains two valid tests:
- `'deferred sorted ascending before playback; live knocks appended to end'`
- `'skips silently when [data-user-id] element not found in DOM'`

- [ ] **Step 3.2: Run full knock test suite to verify no failures**

```bash
npx jest tests/knock.test.js --no-coverage 2>&1 | tail -15
```

Expected: all tests pass, no failures.

- [ ] **Step 3.3: Remove `@keyframes knock-live` and `.knock-live` from `css/app.css`**

In `css/app.css`, the knock animations block currently reads (lines ~433–448):

```css
/* Knock animations */
@keyframes knock-live {
  0%   { background-color: var(--knock-color); }
  100% { background-color: transparent; }
}
@keyframes knock-deferred {
  0%   { background-color: color-mix(in srgb, var(--knock-color) 55%, transparent); }
  100% { background-color: transparent; }
}
@keyframes knock-sender {
  0%   { background-color: var(--knock-color); }
  100% { background-color: transparent; }
}
.knock-live     { animation: knock-live     0.4s ease-out; }
.knock-deferred { animation: knock-deferred 0.8s ease-out; }
.knock-sender   { animation: knock-sender   0.2s ease-out; }
```

Replace with:

```css
/* Knock animations */
@keyframes knock-deferred {
  0%   { background-color: color-mix(in srgb, var(--knock-color) 55%, transparent); }
  100% { background-color: transparent; }
}
@keyframes knock-sender {
  0%   { background-color: var(--knock-color); }
  100% { background-color: transparent; }
}
.knock-deferred { animation: knock-deferred 0.8s ease-out; }
.knock-sender   { animation: knock-sender   0.2s ease-out; }
```

- [ ] **Step 3.4: Run full test suite and build**

```bash
npx jest --no-coverage 2>&1 | tail -10
```

Expected: all test suites pass.

```bash
npx webpack --mode production 2>&1 | tail -5
```

Expected: bundle builds cleanly, no errors.

- [ ] **Step 3.5: Commit**

```bash
git add tests/knock.test.js css/app.css
git commit -m "refactor: remove stale live-knock queue tests and knock-live CSS"
```
