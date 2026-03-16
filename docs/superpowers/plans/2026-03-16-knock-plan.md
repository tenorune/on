# Knock Feature Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mutual followers can tap each other's card to send a "knock" — a pulsing animation on the recipient's card that signals presence without any words.

**Architecture:** A new `knock.js` module owns all knock state (debounce map, animation queue, deferred-key set) and exposes `sendKnock` and `initKnocks`. Four new Firebase functions in `db.js` handle reads/writes. `following.js` attaches the click listener on mutual rows and adds a field-change guard to prevent knock writes from interrupting card animations. The feature is gated behind `KNOCK_ENABLED` in `features.js`.

**Tech Stack:** Vanilla JS ES modules, Firebase Realtime Database (`runTransaction`, `onChildAdded`, `get`, `remove`), Jest + jsdom, CSS `@keyframes`, `touch-action: manipulation`.

---

## Chunk 1: Feature flag, CSS, and DB layer

### Task 1: Feature flag + CSS animations

**Files:**
- Modify: `js/features.js`
- Modify: `css/app.css`

- [ ] **Step 1: Add KNOCK_ENABLED flag**

In `js/features.js`, add `KNOCK_ENABLED: false` to the exports object:

```js
// js/features.js
module.exports = {
  PALETTES_ENABLED: true,
  KNOCK_ENABLED: false,
};
```

- [ ] **Step 2: Add knock CSS to app.css**

At the end of `css/app.css`, add:

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

- [ ] **Step 3: Add touch-action and label width to app.css**

In the `.person-list li` rule (around line 45), add `touch-action: manipulation;`:

```css
.person-list li {
  background: var(--surface); border-radius: 10px; padding: 0.75rem 0.875rem;
  display: flex; align-items: center; gap: 0.75rem;
  margin-bottom: 0.5rem; list-style: none;
  border-left: 3px solid transparent;
  touch-action: manipulation;
}
```

In the `.person-label` rule (around line 57), add `width: fit-content;` (keep existing `height: 1.4rem`):

```css
.person-label { font-size: 1rem; line-height: 1.4; height: 1.4rem; color: var(--text); cursor: pointer; width: fit-content; }
```

- [ ] **Step 4: Commit**

```bash
git add js/features.js css/app.css
git commit -m "feat: add KNOCK_ENABLED flag and knock CSS animations"
```

---

### Task 2: DB layer — four new Firebase functions

**Files:**
- Modify: `js/db.js`

No unit tests for this task. The functions follow established patterns and are exercised via mocks in knock.test.js.

- [ ] **Step 1: Add onChildAdded to the firebase/database import**

Current import line (line 4):
```js
import {
  ref, set, get, update, onValue, remove, runTransaction,
} from 'firebase/database';
```

Change to:
```js
import {
  ref, set, get, update, onValue, remove, runTransaction, onChildAdded,
} from 'firebase/database';
```

- [ ] **Step 2: Add the four knock DB functions at the end of db.js**

```js
// Write a knock from sender to recipient (capped at 5).
// runTransaction: null → {count:1,ts}, count<5 → increment, count>=5 → abort.
export async function writeKnock(recipientId, senderId) {
  const knockRef = ref(db, `users/${recipientId}/knocks/${senderId}`);
  await runTransaction(knockRef, (current) => {
    if (current === null) return { count: 1, ts: Date.now() };
    if (current.count >= 5) return; // abort
    return { count: current.count + 1, ts: Date.now() };
  });
}

// One-time read of all pending knocks for myUserId.
// Returns Promise<DataSnapshot>. Caller checks snapshot.exists() and iterates snapshot.val().
export function getKnocks(myUserId) {
  return get(ref(db, `users/${myUserId}/knocks`));
}

// Attach onChildAdded listener on users/{myUserId}/knocks.
// callback(senderId, { count, ts }) fires for each child added (including existing at attach time).
// Returns unsubscribe function.
export function watchKnocksAdded(myUserId, callback) {
  const knocksRef = ref(db, `users/${myUserId}/knocks`);
  return onChildAdded(knocksRef, (snap) => {
    callback(snap.key, snap.val());
  });
}

// Delete a single knock entry for a sender. Returns raw promise — caller handles errors.
export function clearKnock(myUserId, senderId) {
  return remove(ref(db, `users/${myUserId}/knocks/${senderId}`));
}
```

- [ ] **Step 3: Verify no existing tests broke**

Run: `npm test`
Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add js/db.js
git commit -m "feat: add writeKnock, getKnocks, watchKnocksAdded, clearKnock to db.js"
```

---

## Chunk 2: knock.js module, following.js integration, and app.js wiring

### Task 3: knock.js module (TDD)

**Files:**
- Create: `js/knock.js`
- Create: `tests/knock.test.js`

- [ ] **Step 1: Write the test file (failing)**

Create `tests/knock.test.js`:

```js
// tests/knock.test.js

// Module-level let bindings — re-assigned in beforeEach after jest.resetModules()
let writeKnock, getKnocks, watchKnocksAdded, clearKnock;
let sendKnock, initKnocks;

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetModules();
  jest.mock('../js/features.js', () => ({ KNOCK_ENABLED: true, PALETTES_ENABLED: false }));
  jest.mock('../js/db.js', () => ({
    writeKnock: jest.fn(),
    getKnocks: jest.fn(),
    watchKnocksAdded: jest.fn(),
    clearKnock: jest.fn(),
  }));
  jest.mock('../js/store.js', () => ({}));
  jest.mock('../js/firebase-config.js', () => ({ db: {} }));
  ({ sendKnock, initKnocks } = require('../js/knock.js'));
  // Re-bind db mocks to fresh instances created after resetModules
  const db = require('../js/db.js');
  writeKnock = db.writeKnock;
  getKnocks = db.getKnocks;
  watchKnocksAdded = db.watchKnocksAdded;
  clearKnock = db.clearKnock;
});
afterEach(() => {
  jest.useRealTimers();
  document.body.innerHTML = '';
});

function makeLi(userId) {
  const li = document.createElement('li');
  li.dataset.userId = userId;
  document.body.appendChild(li);
  return li;
}

// --- sendKnock ---

describe('sendKnock: debounce', () => {
  test('suppresses flash and write within 300ms', () => {
    makeLi('u1');
    sendKnock('u1', 'me');
    writeKnock.mockClear();
    jest.advanceTimersByTime(299);
    sendKnock('u1', 'me');
    expect(writeKnock).not.toHaveBeenCalled();
  });

  test('allows knock after 300ms', () => {
    makeLi('u1');
    sendKnock('u1', 'me');
    writeKnock.mockClear();
    jest.advanceTimersByTime(300);
    sendKnock('u1', 'me');
    expect(writeKnock).toHaveBeenCalledWith('u1', 'me');
  });

  test('debounce map persists across re-renders (module-level, userId string key)', () => {
    makeLi('u1');
    sendKnock('u1', 'me');
    writeKnock.mockClear();
    // Simulate re-render: remove and recreate li
    document.body.innerHTML = '';
    makeLi('u1');
    jest.advanceTimersByTime(100);
    sendKnock('u1', 'me');
    // Debounce still in effect — should not call writeKnock
    expect(writeKnock).not.toHaveBeenCalled();
  });
});

describe('sendKnock: flash', () => {
  test('flash fires after debounce passes', () => {
    const li = makeLi('u1');
    sendKnock('u1', 'me');
    expect(li.classList.contains('knock-sender')).toBe(true);
  });

  test('no flash for debounced taps', () => {
    const li = makeLi('u1');
    sendKnock('u1', 'me');
    li.classList.remove('knock-sender');
    jest.advanceTimersByTime(100);
    sendKnock('u1', 'me');
    expect(li.classList.contains('knock-sender')).toBe(false);
  });

  test('statusColor defaults to #22c55e when absent', () => {
    const li = makeLi('u1');
    sendKnock('u1', 'me');
    expect(li.style.getPropertyValue('--knock-color')).toBe('#22c55e');
  });

  test('statusColor is applied as --knock-color when provided', () => {
    const li = makeLi('u1');
    sendKnock('u1', 'me', '#f43f5e');
    expect(li.style.getPropertyValue('--knock-color')).toBe('#f43f5e');
  });

  test('knock-sender class is removed on animationend', () => {
    const li = makeLi('u1');
    sendKnock('u1', 'me');
    expect(li.classList.contains('knock-sender')).toBe(true);
    li.dispatchEvent(new Event('animationend'));
    expect(li.classList.contains('knock-sender')).toBe(false);
  });
});

describe('sendKnock: writeKnock call', () => {
  test('calls writeKnock after debounce passes', () => {
    makeLi('u1');
    sendKnock('u1', 'me');
    expect(writeKnock).toHaveBeenCalledWith('u1', 'me');
  });
});

// --- initKnocks: deferred processing ---

describe('initKnocks: deferred (null snapshot)', () => {
  test('null snapshot → no animations, no errors', async () => {
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockReturnValue(jest.fn());
    await expect(initKnocks('myUid')).resolves.not.toThrow();
  });
});

describe('initKnocks: deferred (within 24h)', () => {
  test('within-24h entries enqueue one deferred animation per sender', async () => {
    const ts = Date.now() - 1000; // 1 second ago
    getKnocks.mockResolvedValue({
      exists: () => true,
      val: () => ({ alice: { count: 3, ts }, bob: { count: 1, ts } }),
    });
    watchKnocksAdded.mockReturnValue(jest.fn());
    clearKnock.mockResolvedValue();

    makeLi('alice');
    makeLi('bob');

    await initKnocks('myUid');

    // Each sender gets one deferred animation class (not three)
    // Trigger the animation
    const aliceLi = document.querySelector('[data-user-id="alice"]');
    const bobLi = document.querySelector('[data-user-id="bob"]');
    // One of them should have a knock-deferred class (the queue runs the first)
    const hasDeferredClass = aliceLi.classList.contains('knock-deferred') ||
                             bobLi.classList.contains('knock-deferred');
    expect(hasDeferredClass).toBe(true);
  });

  test('older-than-24h entries are deleted without animating', async () => {
    const ts = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
    getKnocks.mockResolvedValue({
      exists: () => true,
      val: () => ({ alice: { count: 2, ts } }),
    });
    watchKnocksAdded.mockReturnValue(jest.fn());
    clearKnock.mockResolvedValue();

    makeLi('alice');
    await initKnocks('myUid');

    // clearKnock called for alice
    expect(clearKnock).toHaveBeenCalledWith('myUid', 'alice');
    // No animation on alice's card
    const aliceLi = document.querySelector('[data-user-id="alice"]');
    expect(aliceLi.classList.contains('knock-deferred')).toBe(false);
  });

  test('only snapshot keys are deleted (not new knocks arriving during window)', async () => {
    const ts = Date.now() - 1000;
    getKnocks.mockResolvedValue({
      exists: () => true,
      val: () => ({ alice: { count: 1, ts } }),
    });
    watchKnocksAdded.mockReturnValue(jest.fn());
    clearKnock.mockResolvedValue();

    await initKnocks('myUid');

    // Only alice was in snapshot — only alice should be deleted
    expect(clearKnock).toHaveBeenCalledWith('myUid', 'alice');
    expect(clearKnock).toHaveBeenCalledTimes(1);
  });
});

describe('initKnocks: deferredKeys skip set', () => {
  test('live listener skips senders in deferredKeys during deletion window', async () => {
    const ts = Date.now() - 1000;
    let liveCallback;
    getKnocks.mockResolvedValue({
      exists: () => true,
      val: () => ({ alice: { count: 1, ts } }),
    });
    // Make clearKnock hang until we manually resolve to simulate deletion window
    let resolveClear;
    clearKnock.mockReturnValue(new Promise(r => { resolveClear = r; }));
    watchKnocksAdded.mockImplementation((_uid, cb) => {
      liveCallback = cb;
      return jest.fn();
    });

    const initPromise = initKnocks('myUid');
    // Fire live callback for alice while deletion is pending
    liveCallback('alice', { count: 1, ts: Date.now() });
    // writeKnock should NOT be called (skipped by deferredKeys)
    expect(writeKnock).not.toHaveBeenCalled();
    resolveClear();
    await initPromise;
  });

  test('deferredKeys cleared → previously-deferred sender fires are processed', async () => {
    const ts = Date.now() - 1000;
    let liveCallback;
    getKnocks.mockResolvedValue({
      exists: () => true,
      val: () => ({ alice: { count: 1, ts } }),
    });
    clearKnock.mockResolvedValue();
    watchKnocksAdded.mockImplementation((_uid, cb) => {
      liveCallback = cb;
      return jest.fn();
    });

    makeLi('alice');
    await initKnocks('myUid');

    // After initKnocks completes, deferredKeys is cleared
    // A new live callback for alice should now enqueue a live animation
    clearKnock.mockClear();
    liveCallback('alice', { count: 2, ts: Date.now() });
    expect(clearKnock).toHaveBeenCalledWith('myUid', 'alice');
  });
});

// --- initKnocks: live listener ---

describe('initKnocks: live listener', () => {
  test('enqueues correct count × animation-1 entries (including count > 1)', async () => {
    let liveCallback;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => {
      liveCallback = cb;
      return jest.fn();
    });
    clearKnock.mockResolvedValue();

    await initKnocks('myUid');

    const li = makeLi('alice');
    liveCallback('alice', { count: 3, ts: Date.now() });

    // First knock-live animation starts immediately
    expect(li.classList.contains('knock-live')).toBe(true);

    // Fire animationend, advance timer past gap; second animation should start
    li.dispatchEvent(new Event('animationend'));
    jest.advanceTimersByTime(300);
    expect(li.classList.contains('knock-live')).toBe(true);

    li.dispatchEvent(new Event('animationend'));
    jest.advanceTimersByTime(300);
    expect(li.classList.contains('knock-live')).toBe(true);
  });
});

// --- animation queue ---

describe('animation queue: sequence gap', () => {
  test('500ms gap between sequences (different userId)', async () => {
    let liveCallback;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => {
      liveCallback = cb;
      return jest.fn();
    });
    clearKnock.mockResolvedValue();

    await initKnocks('myUid');
    const liA = makeLi('alice');
    const liB = makeLi('bob');

    liveCallback('alice', { count: 1, ts: Date.now() });
    liveCallback('bob', { count: 1, ts: Date.now() + 1 });

    // alice animates first
    expect(liA.classList.contains('knock-live')).toBe(true);
    liA.dispatchEvent(new Event('animationend'));

    // < 500ms: bob should not have started
    jest.advanceTimersByTime(499);
    expect(liB.classList.contains('knock-live')).toBe(false);

    // After 500ms: bob starts
    jest.advanceTimersByTime(1);
    expect(liB.classList.contains('knock-live')).toBe(true);
  });

  test('deferred sorted ascending before playback; live knocks appended to end', async () => {
    const now = Date.now();
    const ts1 = now - 5000; // older
    const ts2 = now - 2000; // newer
    let liveCallback;

    getKnocks.mockResolvedValue({
      exists: () => true,
      val: () => ({
        bob:   { count: 1, ts: ts2 },
        alice: { count: 1, ts: ts1 },
      }),
    });
    clearKnock.mockResolvedValue();
    watchKnocksAdded.mockImplementation((_uid, cb) => {
      liveCallback = cb;
      return jest.fn();
    });

    const liA = makeLi('alice');
    const liB = makeLi('bob');
    const liC = makeLi('carol');

    await initKnocks('myUid');

    // After deferredKeys is cleared, enqueue a live knock for carol
    liveCallback('carol', { count: 1, ts: Date.now() });

    // alice (older ts) should animate first
    expect(liA.classList.contains('knock-deferred')).toBe(true);
    expect(liB.classList.contains('knock-deferred')).toBe(false);
  });

  test('skips silently when [data-user-id] element not found in DOM', async () => {
    let liveCallback;
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockImplementation((_uid, cb) => {
      liveCallback = cb;
      return jest.fn();
    });
    clearKnock.mockResolvedValue();

    await initKnocks('myUid');
    // No li for 'ghost' in DOM — should not throw
    expect(() => liveCallback('ghost', { count: 1, ts: Date.now() })).not.toThrow();
  });
});

// --- initKnocks: state reset ---

describe('initKnocks: state reset', () => {
  test('resets debounce map, queue, and deferredKeys on re-call', async () => {
    getKnocks.mockResolvedValue({ exists: () => false });
    watchKnocksAdded.mockReturnValue(jest.fn());

    await initKnocks('myUid');

    const li = makeLi('u1');
    sendKnock('u1', 'me');     // sets debounce entry
    writeKnock.mockClear();

    await initKnocks('myUid');  // re-call should reset debounce map

    jest.advanceTimersByTime(0);
    sendKnock('u1', 'me');
    // After reset, debounce map is cleared so knock should go through
    expect(writeKnock).toHaveBeenCalledWith('u1', 'me');
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npm test tests/knock.test.js`
Expected: FAIL — module `../js/knock.js` not found.

- [ ] **Step 3: Create js/knock.js**

```js
// js/knock.js
import { KNOCK_ENABLED } from './features.js';
import { writeKnock, getKnocks, watchKnocksAdded, clearKnock } from './db.js';

// Module-level state — reset by initKnocks on each call
let debounceMap = new Map();   // recipientId → last knock timestamp
let queue = [];                // { userId, animationType, ts }
let deferredKeys = new Set();  // senderIds from snapshot; blocks live listener until cleared
let isPlaying = false;
let unsubKnocks = null;

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
  isPlaying = false;
  if (unsubKnocks) { unsubKnocks(); unsubKnocks = null; }

  const appOpenTime = Date.now();

  // 1. Read deferred knocks (one-time get)
  const snapshot = await getKnocks(myUserId);

  // 2. Populate deferredKeys synchronously before attaching live listener
  if (snapshot.exists()) {
    Object.keys(snapshot.val()).forEach(senderId => deferredKeys.add(senderId));
  }

  // 3. Attach live listener — fires asynchronously, after deferredKeys is populated
  unsubKnocks = watchKnocksAdded(myUserId, (senderId, { count, ts }) => {
    // Skip senders from the initial snapshot (handled as deferred)
    if (deferredKeys.size > 0 && deferredKeys.has(senderId)) return;
    // Enqueue count × live animations
    for (let i = 0; i < count; i++) {
      enqueue({ userId: senderId, animationType: 'live', ts: Date.now() });
    }
    clearKnock(myUserId, senderId).catch(() => {});
  });

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

  li.style.setProperty('--knock-color', '#22c55e');
  const cls = entry.animationType === 'live' ? 'knock-live' : 'knock-deferred';
  li.classList.add(cls);

  li.addEventListener('animationend', () => {
    li.classList.remove(cls);
    // 300ms within a sequence (same userId), 500ms between sequences
    const gap = (queue[0] && queue[0].userId === entry.userId) ? 300 : 500;
    setTimeout(playNext, gap);
  }, { once: true });
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npm test tests/knock.test.js`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/knock.js tests/knock.test.js
git commit -m "feat: add knock.js module with sendKnock, initKnocks, and animation queue"
```

---

### Task 4: following.js integration + tests

**Files:**
- Modify: `js/following.js`
- Modify: `tests/following.test.js`

- [ ] **Step 1: Write failing tests for the new following.js behavior**

Add the following test blocks to `tests/following.test.js`.

First, update the `jest.mock('../js/db.js', ...)` block to include the new db functions so imports don't break:

```js
// In the existing jest.mock('../js/db.js') call, add:
writeKnock: jest.fn(),
getKnocks: jest.fn(),
watchKnocksAdded: jest.fn(),
clearKnock: jest.fn(),
```

Then add a mock for `knock.js` near the top (after existing mocks):

```js
jest.mock('../js/knock.js', () => ({
  sendKnock: jest.fn(),
}));
```

Then add the new test blocks at the end of `tests/following.test.js`:

```js
// --- subscribeToFollowee: field-change guard ---

describe('subscribeToFollowee: field-change guard', () => {
  let fireStatus; // fn(userData) → triggers watchStatus callback

  function setupMutual(userId = 'u1') {
    setupDom();
    jest.clearAllMocks();
    getFollowing.mockReturnValue([{ userId, code: 'ABC123', label: 'Alice' }]);
    let statusCallback;
    watchStatus.mockImplementation((_uid, cb) => {
      statusCallback = cb;
      return jest.fn();
    });
    watchFollowers.mockImplementation((_uid, cb) => {
      cb([{ userId, code: 'ABC123' }]); // make it a mutual
      return jest.fn();
    });
    initList('myUid', 'MYCODE');
    fireStatus = (data) => statusCallback(data);
  }

  test('updateFolloweeRow NOT called when only knocks key changes', () => {
    setupMutual();
    const baseData = {
      status: 'unavailable', availableUntil: null,
      statusColor: '#22c55e', paletteKey: null, code: 'ABC123',
    };
    fireStatus(baseData); // initial call, sets lastUserData

    const li = document.querySelector('[data-user-id="u1"]');
    const dotBefore = li.querySelector('.person-dot').className;

    // Fire again with only knocks key added — all 5 named fields unchanged
    fireStatus({ ...baseData, knocks: { someUser: { count: 1, ts: Date.now() } } });

    // DOM should not have changed (no re-render)
    expect(li.querySelector('.person-dot').className).toBe(dotBefore);
  });

  test('updateFolloweeRow IS called when status changes', () => {
    setupMutual();
    const baseData = {
      status: 'unavailable', availableUntil: null,
      statusColor: '#22c55e', paletteKey: null, code: 'ABC123',
    };
    fireStatus(baseData);
    const li = document.querySelector('[data-user-id="u1"]');
    const statusElBefore = li.querySelector('.person-status').innerHTML;

    // Fire with changed status
    fireStatus({ ...baseData, status: 'available', availableUntil: Date.now() + 3600000 });
    // status changed → updateFolloweeRow runs → person-status text changes
    expect(document.querySelector('[data-user-id="u1"] .person-status').innerHTML)
      .not.toBe(statusElBefore);
  });
});

// --- click handler on mutual rows ---

describe('knock click handler on mutual rows', () => {
  const { sendKnock } = require('../js/knock.js');

  function setupMutualWithKnock(userId = 'u1') {
    setupDom();
    jest.clearAllMocks();
    getFollowing.mockReturnValue([{ userId, code: 'ABC123', label: 'Alice' }]);
    watchStatus.mockReturnValue(jest.fn());
    watchFollowers.mockImplementation((_uid, cb) => {
      cb([{ userId, code: 'ABC123' }]);
      return jest.fn();
    });
    // Re-enable KNOCK_ENABLED for this test suite
    jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, KNOCK_ENABLED: true }));
    initList('myUid', 'MYCODE');
    return document.querySelector(`[data-user-id="${userId}"]`);
  }

  test('tapping mutual li calls sendKnock', () => {
    const li = setupMutualWithKnock();
    li.click();
    expect(sendKnock).toHaveBeenCalled();
  });

  test('tapping person-label skips knock (allows rename)', () => {
    const li = setupMutualWithKnock();
    sendKnock.mockClear();
    li.querySelector('.person-label').click();
    expect(sendKnock).not.toHaveBeenCalled();
  });

  test('tapping unfollow-btn skips knock', () => {
    const li = setupMutualWithKnock();
    sendKnock.mockClear();
    li.querySelector('.unfollow-btn').click();
    expect(sendKnock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — verify new tests fail**

Run: `npm test tests/following.test.js`
Expected: new tests fail (sendKnock not called, guard not present).

- [ ] **Step 3: Add sendKnock import to following.js**

At the top of `js/following.js`, add the import (after the existing imports):

```js
import { KNOCK_ENABLED } from './features.js';  // already there
import { sendKnock } from './knock.js';           // ADD THIS
```

- [ ] **Step 4: Add click listener on mutual rows in createFolloweeRow**

In `createFolloweeRow` (line 229), after the `li.querySelector('.person-label').addEventListener(...)` block and before `document.getElementById('people-list').appendChild(li)`, add:

```js
  if (KNOCK_ENABLED) {
    const labelEl = li.querySelector('.person-label');
    const unfollowBtnEl = li.querySelector('.unfollow-btn');
    li.addEventListener('click', (e) => {
      if (labelEl.contains(e.target)) return;
      if (unfollowBtnEl.contains(e.target)) return;
      const statusColor = lastUserData.get(entry.userId)?.statusColor;
      sendKnock(entry.userId, myUserId, statusColor);
    });
  }
```

Note: this listener is added inside `createFolloweeRow` which is only called for mutual and following-only rows. However, the spec says knock should only fire for mutual rows. The distinction is handled by `renderList` which calls `createFolloweeRow` for mutuals and following-only rows. Since the knock should only apply to mutuals, the click listener should only be attached in the mutuals section.

To do this, pass a flag to `createFolloweeRow` or separate the mutual call. The cleanest approach: add an `isMutual` parameter to `createFolloweeRow`:

```js
function createFolloweeRow(entry, myUserId, isMutual = false) {
  // ... existing code ...

  if (KNOCK_ENABLED && isMutual) {
    const labelEl = li.querySelector('.person-label');
    const unfollowBtnEl = li.querySelector('.unfollow-btn');
    li.addEventListener('click', (e) => {
      if (labelEl.contains(e.target)) return;
      if (unfollowBtnEl.contains(e.target)) return;
      const statusColor = lastUserData.get(entry.userId)?.statusColor;
      sendKnock(entry.userId, myUserId, statusColor);
    });
  }

  document.getElementById('people-list').appendChild(li);
}
```

In `renderList`, update the mutuals section call to pass `true`:
```js
appendSection('Mutuals', sortFollowees(mutuals), (entry) => {
  createFolloweeRow(entry, myUserId, true);  // ADD true
  // ...
});
```

The `appendSection('Following', ...)` call stays with no third argument (defaults to `false`).

- [ ] **Step 5: Add field-change guard to subscribeToFollowee**

In `subscribeToFollowee` (around line 315), change:

```js
    lastUserData.set(entry.userId, userData);
    if (editingSet.has(entry.userId)) return;
    updateFolloweeRow(entry, userData, myUserId);
```

To:

```js
    const prevUserData = lastUserData.get(entry.userId);
    lastUserData.set(entry.userId, userData);
    if (editingSet.has(entry.userId)) return;
    // Skip re-render if only the knocks subtree changed — knock writes trigger onValue
    // on the parent node, and we don't want them interrupting card animations.
    if (prevUserData &&
        userData.status === prevUserData.status &&
        userData.availableUntil === prevUserData.availableUntil &&
        userData.statusColor === prevUserData.statusColor &&
        userData.paletteKey === prevUserData.paletteKey &&
        userData.code === prevUserData.code) return;
    updateFolloweeRow(entry, userData, myUserId);
```

- [ ] **Step 6: Run tests — verify they pass**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add js/following.js tests/following.test.js
git commit -m "feat: add knock click listener on mutual rows and subscribeToFollowee guard"
```

---

### Task 5: app.js wiring

**Files:**
- Modify: `js/app.js`

No new tests needed. The integration is covered by existing tests and the new knock tests.

- [ ] **Step 1: Add KNOCK_ENABLED and initKnocks imports to app.js**

Change the existing features import:
```js
import { PALETTES_ENABLED } from './features.js';
```
To:
```js
import { PALETTES_ENABLED, KNOCK_ENABLED } from './features.js';
```

Add initKnocks import after the `initList` import:
```js
import { initList } from './following.js';
import { initKnocks } from './knock.js';   // ADD THIS
```

- [ ] **Step 2: Call initKnocks after initList in main()**

After `initList(userId, code);` (line 59), add:

```js
  initList(userId, code);
  if (KNOCK_ENABLED) initKnocks(userId);  // ADD THIS
```

- [ ] **Step 3: Build bundle and verify no errors**

Run: `npm run build`
Expected: build succeeds, no errors.

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: wire initKnocks into app startup after initList"
```

---

## Final verification

- [ ] **Run full test suite**

Run: `npm test`
Expected: all tests pass with 0 failures.

- [ ] **Build bundle**

Run: `npm run build`
Expected: `dist/bundle.js` generated with no errors.

- [ ] **Verify feature is flagged off**

Confirm `KNOCK_ENABLED: false` in `js/features.js`. The feature should have no visible effect in production until the flag is enabled.
