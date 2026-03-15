# Code Rotation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a user to generate a new 6-character code from the My Code tab without disrupting existing follows or notifying non-mutual followers.

**Architecture:** Four sequential Firebase writes atomically establish the new code (old code deleted last so it stays valid on partial failure), followed by one localStorage write. The ↻ button in the code card opens a confirm sheet; on confirm, `rotateCode` (new in `db.js`) performs the Firebase writes and returns the new code; `mycode.js` then updates the DOM and calls `saveIdentity`. Mutuals detect the code change automatically via the existing `watchStatus` subscription in `following.js`.

**Tech Stack:** Vanilla JS ES modules, Firebase Realtime Database (`runTransaction`, `update`, `set`, `remove`), Jest + jsdom for tests.

---

## Chunk 1: Backend — store, db, following

### Task 1: `store.js` — `updateFollowingCode`

**Files:**
- Modify: `js/store.js` (add function + export it)
- Modify: `tests/store.test.js` (add two tests at the bottom)

**Context:** `store.js` uses CommonJS (`module.exports`). `saveFollowing` and `getFollowing` are private helpers in the same file — `updateFollowingCode` must live inside `store.js` to access them. The existing `renameFollowing` function in `store.js` (line 42) is a direct pattern to follow.

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `tests/store.test.js`:

```js
test('updateFollowingCode updates code for matching userId, leaves other fields unchanged', () => {
  addFollowing({ code: 'OLD123', label: 'Alice', userId: 'user-1' });
  updateFollowingCode('user-1', 'NEW456');
  const list = getFollowing();
  expect(list[0]).toEqual({ code: 'NEW456', label: 'Alice', userId: 'user-1' });
});

test('updateFollowingCode does not modify non-matching entries', () => {
  addFollowing({ code: 'OLD123', label: 'Alice', userId: 'user-1' });
  addFollowing({ code: 'ZZ91TL', label: 'Bob', userId: 'user-2' });
  updateFollowingCode('user-1', 'NEW456');
  const list = getFollowing();
  expect(list[1]).toEqual({ code: 'ZZ91TL', label: 'Bob', userId: 'user-2' });
});
```

Also update the `require` at the top of `tests/store.test.js` to include `updateFollowingCode`:

```js
const {
  getFollowing, addFollowing, removeFollowing, isFollowing,
  getLastTimeout, setLastTimeout, renameFollowing, updateFollowingCode,
} = require('../js/store');
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest tests/store.test.js --no-coverage
```

Expected: the two new tests FAIL with `TypeError: updateFollowingCode is not a function` (or similar). All existing tests PASS.

- [ ] **Step 3: Implement `updateFollowingCode` in `store.js`**

Add this function after `renameFollowing` (line 47), before the `module.exports` line:

```js
function updateFollowingCode(userId, newCode) {
  saveFollowing(getFollowing().map((e) =>
    e.userId === userId ? { ...e, code: newCode } : e
  ));
}
```

Update the `module.exports` line to include `updateFollowingCode`:

```js
module.exports = { getFollowing, addFollowing, removeFollowing, isFollowing, getLastTimeout, setLastTimeout, renameFollowing, updateFollowingCode };
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest tests/store.test.js --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/store.js tests/store.test.js
git commit -m "feat: add updateFollowingCode to store.js"
```

---

### Task 2: `db.js` — `rotateCode`

**Files:**
- Modify: `js/db.js` (add two imports + new exported function)
- Modify: `tests/db.test.js` (extend firebase mock, add module mocks, add rotateCode tests)

**Context:** `db.js` uses ES module `import` syntax. `rotateCode` needs `generateCode` from `identity.js` and `getFollowing` from `store.js`. Both are already exported. The existing `initUser` function (line 59) shows the same `runTransaction` collision-retry pattern. `firebase/database` is already mocked in `db.test.js`; that mock needs `runTransaction`, `set`, and `remove` added. `identity.js` and `store.js` must also be mocked (they are not imported by `db.js` currently, so add them at the top of the test file).

- [ ] **Step 1: Write the failing tests**

Update `tests/db.test.js`. The firebase mock at the top must be expanded, and two new mocks added. Replace the existing mock block and require block at the top with:

```js
// tests/db.test.js
const { userExists, touchLastSeen, rotateCode } = require('../js/db');

jest.mock('firebase/database', () => ({
  ref: jest.fn(() => 'mock-ref'),
  get: jest.fn(),
  update: jest.fn(),
  set: jest.fn(),
  remove: jest.fn(),
  runTransaction: jest.fn(),
}));
jest.mock('../js/firebase-config', () => ({ db: {} }));
jest.mock('../js/identity.js', () => ({ generateCode: jest.fn() }));
jest.mock('../js/store.js', () => ({ getFollowing: jest.fn() }));

const { get, update, set, remove, runTransaction } = require('firebase/database');
const { generateCode } = require('../js/identity.js');
const { getFollowing } = require('../js/store.js');
```

Then add the new tests at the bottom of the file (keep all existing tests untouched):

```js
describe('rotateCode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getFollowing.mockReturnValue([]);
  });

  test('happy path: reserves new code, updates user record, releases old code, returns new code', async () => {
    generateCode.mockReturnValue('NEW456');
    runTransaction.mockResolvedValue({ committed: true });
    update.mockResolvedValue();
    remove.mockResolvedValue();

    const result = await rotateCode('user-1', 'OLD123');

    expect(runTransaction).toHaveBeenCalledWith('mock-ref', expect.any(Function));
    expect(update).toHaveBeenCalledWith('mock-ref', { code: 'NEW456' });
    expect(remove).toHaveBeenCalledWith('mock-ref');
    expect(result).toBe('NEW456');
  });

  test('retries on collision: generateCode called twice, returns code from second attempt', async () => {
    generateCode
      .mockReturnValueOnce('TAKEN1')
      .mockReturnValueOnce('NEW456');
    runTransaction
      .mockResolvedValueOnce({ committed: false })
      .mockResolvedValueOnce({ committed: true });
    update.mockResolvedValue();
    remove.mockResolvedValue();

    const result = await rotateCode('user-1', 'OLD123');

    expect(generateCode).toHaveBeenCalledTimes(2);
    expect(result).toBe('NEW456');
  });

  test('calls set once per following entry with correct path value', async () => {
    getFollowing.mockReturnValue([
      { userId: 'followee-A', code: 'CODEA1', label: 'Alice' },
      { userId: 'followee-B', code: 'CODEB2', label: 'Bob' },
    ]);
    generateCode.mockReturnValue('NEW456');
    runTransaction.mockResolvedValue({ committed: true });
    update.mockResolvedValue();
    set.mockResolvedValue();
    remove.mockResolvedValue();

    await rotateCode('user-1', 'OLD123');

    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledWith('mock-ref', 'NEW456');
  });

  test('failure in step 2 (update) rejects the promise; remove is not called', async () => {
    generateCode.mockReturnValue('NEW456');
    runTransaction.mockResolvedValue({ committed: true });
    update.mockRejectedValue(new Error('network error'));

    await expect(rotateCode('user-1', 'OLD123')).rejects.toThrow('network error');
    expect(remove).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest tests/db.test.js --no-coverage
```

Expected: the four `rotateCode` tests FAIL with `TypeError: rotateCode is not a function` or `rotateCode is not exported`. All existing tests PASS.

- [ ] **Step 3: Implement `rotateCode` in `db.js`**

Add two new imports near the top of `js/db.js`, after the existing imports (after line 5):

```js
import { generateCode } from './identity.js';
import { getFollowing } from './store.js';
```

Add the function at the bottom of `js/db.js` (after `touchLastSeen`):

```js
// Reserve a fresh code, update user record + follower entries, release old code.
// Returns the new code string on success. Throws on failure.
// Old code is deleted LAST so it remains valid if any earlier write fails.
export async function rotateCode(userId, oldCode) {
  // Step 1: reserve new code (collision-safe)
  let newCode, committed;
  do {
    newCode = generateCode();
    const result = await runTransaction(ref(db, `codeIndex/${newCode}`), (current) => {
      if (current !== null) return; // abort on collision
      return userId;
    });
    committed = result.committed;
  } while (!committed);

  // Steps 2–3: establish new code. If either throws, new code is orphaned in
  // codeIndex but old code remains valid — user retries and the orphan is harmless.
  await update(ref(db, `users/${userId}`), { code: newCode });
  for (const entry of getFollowing()) {
    await set(ref(db, `users/${entry.userId}/followers/${userId}`), newCode);
  }

  // Step 4: release old code last. If this throws, both codes exist briefly —
  // new code is already active, so old code is a harmless orphan. No rollback needed.
  await remove(ref(db, `codeIndex/${oldCode}`)).catch(() => {});

  return newCode;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest tests/db.test.js --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/db.js tests/db.test.js
git commit -m "feat: add rotateCode to db.js"
```

---

### Task 3: `following.js` — code-change sync in `subscribeToFollowee`

**Files:**
- Modify: `js/following.js` (add import + guard block in `subscribeToFollowee`)
- Create: `tests/following.test.js`

**Context:** `subscribeToFollowee` (line 136) already receives `userData` from `watchStatus`. The code-change guard goes after the expiry write-back block and before `lastUserData.set`. `updateFollowingCode` is imported from `./store.js` alongside the existing store imports. The new test file mocks `db.js` directly (same pattern as `mycode.test.js`) and mocks `store.js`. `initFollowingTab` (the only exported function) drives `renderFollowingList` → `subscribeToFollowee`, so tests call `initFollowingTab` and then invoke the captured `watchStatus` callback directly.

- [ ] **Step 1: Write the failing tests**

Create `tests/following.test.js`:

```js
// tests/following.test.js
// Mock db.js directly — prevents Firebase from loading (same pattern as mycode.test.js).
// utils.js needs no mock; it's a pure function with no external dependencies.
jest.mock('../js/db.js', () => ({
  lookupCode: jest.fn(),
  watchStatus: jest.fn(),
  registerAsFollower: jest.fn(),
  unregisterAsFollower: jest.fn(),
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

const { watchStatus } = require('../js/db.js');
const { getFollowing, updateFollowingCode } = require('../js/store.js');
const { initFollowingTab } = require('../js/following.js');

function setupDom() {
  document.body.innerHTML = `
    <ul id="following-list"></ul>
    <button id="add-person-btn"></button>
    <div id="add-person-form" class="hidden">
      <input id="add-code-input" />
      <input id="add-label-input" />
      <div id="add-error" class="hidden"></div>
      <button id="add-submit-btn"></button>
      <button id="add-cancel-btn"></button>
    </div>
    <div id="offline-banner" class="hidden"></div>
  `;
}

describe('subscribeToFollowee — code-change sync', () => {
  let watchStatusCallback;

  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();

    watchStatus.mockImplementation((_userId, cb) => {
      watchStatusCallback = cb;
      return jest.fn(); // unsubscribe fn
    });

    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'OLD123', label: 'Alice' },
    ]);

    initFollowingTab('myUserId', 'MYCODE');
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

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest tests/following.test.js --no-coverage
```

Expected: all four tests FAIL (e.g. `updateFollowingCode is not a function` or it's never called).

- [ ] **Step 3: Implement the code-change sync in `following.js`**

Update the `import` line for `store.js` at the top of `js/following.js` (currently line 7) to include `updateFollowingCode`:

```js
import { getFollowing, addFollowing, removeFollowing, renameFollowing, updateFollowingCode } from './store.js';
```

In `subscribeToFollowee` (around line 154), add the code-change guard immediately after the expiry write-back block and before the `lastUserData.set` call:

```js
    // Code change sync — update localStorage if the followed user rotated their code
    if (userData.code && userData.code !== entry.code) {
      entry.code = userData.code;           // update in-memory entry to stay consistent
      updateFollowingCode(entry.userId, userData.code);
    }

    lastUserData.set(entry.userId, userData);
```

The full updated `subscribeToFollowee` function body should look like this (no other changes):

```js
function subscribeToFollowee(entry, myUserId) {
  const unsub = watchStatus(entry.userId, (userData) => {
    if (!userData) return;

    // Check if this user has revoked us
    if (userData.revokedFollowers && userData.revokedFollowers[myUserId]) {
      removeFollowing(entry.userId);
      unsub();
      unsubscribers.delete(entry.userId);
      renderFollowingList(myUserId);
      return;
    }

    // Expiry write-back (only when online to avoid queued writes on reconnect)
    if (userData.status === 'available' && isExpired(userData.availableUntil)) {
      if (navigator.onLine) writeBackExpired(entry.userId);
      userData.status = 'unavailable';
      userData.availableUntil = null;
    }

    // Code change sync — update localStorage if the followed user rotated their code
    if (userData.code && userData.code !== entry.code) {
      entry.code = userData.code;           // update in-memory entry to stay consistent
      updateFollowingCode(entry.userId, userData.code);
    }

    lastUserData.set(entry.userId, userData);
    if (editingSet.has(entry.userId)) return;
    updateFolloweeRow(entry, userData, myUserId);
    sortFollowingList();
  });
  unsubscribers.set(entry.userId, unsub);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest tests/following.test.js --no-coverage
```

Expected: all four tests PASS.

- [ ] **Step 5: Run full test suite to confirm no regressions**

```
npx jest --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add js/following.js tests/following.test.js
git commit -m "feat: sync code change in subscribeToFollowee"
```

---

## Chunk 2: UI — rotate button, confirm sheet, animation

### Task 4: `index.html` + `css/app.css` — structure and styles

**Files:**
- Modify: `index.html` (wrap code display in flex row, add rotate button and error message)
- Modify: `css/app.css` (add rotate-btn, code-display-row, spin animation, fade, confirm-btn-generate)

**Context:** The `#my-code-display` element (currently standalone inside `.code-card`) needs a sibling ↻ button to its right. Wrap them in a new `.code-display-row` flex container. The error message `#rotate-error-msg` goes between the Copy button and the hint. The confirm sheet reuses existing `.confirm-overlay` / `.confirm-sheet` CSS classes (injected by JS in Task 5) — only add a new `.confirm-btn-generate` button style to the CSS.

- [ ] **Step 1: Update `index.html` — wrap code display and add error message**

In `index.html`, find the `<div class="code-card">` block (lines 59–64) and replace it with:

```html
    <section id="tab-mycode" class="tab-panel">
      <div class="code-card">
        <div class="code-card-label">Your code</div>
        <div class="code-display-row">
          <div id="my-code-display" class="code-display">------</div>
          <button id="rotate-code-btn" class="rotate-btn" title="Generate new code">↻</button>
        </div>
        <button id="copy-code-btn" class="ghost-btn">Copy</button>
        <div id="rotate-error-msg" class="error-msg hidden">Couldn't generate a new code. Please try again.</div>
        <p class="hint">Share this code so others can follow your status.</p>
      </div>
      <div class="followers-section">
        <div class="section-title">Followers</div>
        <ul id="followers-list" class="person-list"></ul>
        <div id="no-followers-msg" class="hint hidden">No one is following you yet.</div>
      </div>
    </section>
```

- [ ] **Step 2: Update `css/app.css` — add rotate styles**

Find the `.code-display` rule (line 130). Replace it and add the new rules:

```css
.code-display-row {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  margin-bottom: 14px;
}
.code-display { font-size: 32px; font-weight: 700; letter-spacing: 6px; color: var(--text); transition: opacity 0.2s; }
.code-display.fading { opacity: 0; }
.rotate-btn {
  background: none; border: none; cursor: pointer;
  font-size: 20px; color: var(--text-muted); padding: 4px;
  transition: color 0.15s;
}
.rotate-btn:hover:not(:disabled) { color: var(--text); }
.rotate-btn:disabled { opacity: 0.4; cursor: default; }
@keyframes spin { to { transform: rotate(360deg); } }
.rotate-btn.spinning { animation: spin 0.7s linear infinite; }
```

Add `.confirm-btn-generate` after `.confirm-btn-remove` (currently line 201):

```css
.confirm-btn-generate { background: var(--accent); color: white; }
```

- [ ] **Step 3: Verify layout in browser**

Open `index.html` in a browser (or via the dev server) and navigate to the My Code tab. Confirm the ↻ button appears to the right of the code characters, on the same line.

- [ ] **Step 4: Commit**

```bash
git add index.html css/app.css
git commit -m "feat: add rotate button HTML and CSS to code card"
```

---

### Task 5: `mycode.js` — wire up rotation

**Files:**
- Modify: `js/mycode.js` (add imports, confirm sheet injection, rotate flow)

**Context:** `initMyCodeTab` receives `myUserId` and `myCode` as parameters. The Copy button closes over `myCode` — introduce `let currentCode = myCode` so it can be updated after rotation without re-initialising the tab. `rotateCode` is imported from `./db.js` alongside existing db imports. `saveIdentity` is imported from `./identity.js`. The confirm sheet is injected once with an id guard (same pattern as the unfollow confirm in `following.js`). The ↻ button is disabled when offline (`!navigator.onLine`) — checked on click, not via `disabled` attribute, since online status can change at any time.

- [ ] **Step 1: Update imports in `mycode.js`**

Replace the existing import lines at the top of `js/mycode.js` with:

```js
// js/mycode.js
import { watchFollowers, removeFollower, rotateCode } from './db.js';
import { getFollowing } from './store.js';
import { saveIdentity } from './identity.js';
import { escapeHtml } from './utils.js';
```

- [ ] **Step 2: Rewrite `initMyCodeTab` with rotate logic**

Replace the entire `initMyCodeTab` function (lines 6–20) with:

```js
export function initMyCodeTab(myUserId, myCode) {
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

      // Fade out, swap text, fade in
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

  watchFollowers(myUserId, (followers) => {
    renderFollowers(myUserId, followers);
  });
}
```

- [ ] **Step 3: Run the full test suite**

```
npx jest --no-coverage
```

Expected: all tests PASS. (The mycode.test.js mocks `db.js` and `store.js` directly and only tests `renderFollowers`, so the new imports don't affect those tests.)

- [ ] **Step 4: Build and smoke-test in browser**

```
npm run build
```

Open the app, navigate to My Code. Confirm:
- ↻ button appears next to the code
- Tapping ↻ shows the confirm sheet
- Tapping Cancel dismisses it
- Tapping Generate spins the button, then shows new code with fade animation
- Copy button copies the new code (not the old one)
- Error message appears if the network is unavailable

- [ ] **Step 5: Commit**

```bash
git add js/mycode.js
git commit -m "feat: wire up code rotation in mycode.js"
```
