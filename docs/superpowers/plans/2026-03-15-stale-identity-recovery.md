# Stale Identity Recovery Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect on startup when a user's Firebase record is missing and recover silently by showing a brief message and generating a fresh identity.

**Architecture:** Four independent changes — (1) `userExists()` in `db.js` with tests in a new `tests/db.test.js`; (2) `clearIdentity()` in `identity.js` with a test; (3) stale screen HTML + CSS; (4) updated `ensureIdentity()` and `main()` in `app.js`.

**Tech Stack:** Vanilla JS (ES modules), Firebase Realtime Database, Jest (CommonJS via Babel), CSS custom properties.

---

## Chunk 1: Pure helpers and UI shell

### Task 1: `userExists` — tests first, then implementation

**Files:**
- Create: `tests/db.test.js`
- Modify: `js/db.js`

- [ ] **Step 1: Create `tests/db.test.js` with failing tests**

```js
// tests/db.test.js
const { userExists } = require('../js/db');

jest.mock('firebase/database', () => ({
  ref: jest.fn(() => 'mock-ref'),
  get: jest.fn(),
}));
jest.mock('../js/firebase-config', () => ({ db: {} }));

const { get } = require('firebase/database');

test('userExists returns true when Firebase record exists', async () => {
  get.mockResolvedValueOnce({ exists: () => true });
  const result = await userExists('user-123');
  expect(result).toBe(true);
});

test('userExists returns false when Firebase record does not exist', async () => {
  get.mockResolvedValueOnce({ exists: () => false });
  const result = await userExists('user-456');
  expect(result).toBe(false);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern=db.test.js
```

Expected: 2 failures — `TypeError: userExists is not a function`

- [ ] **Step 3: Add `userExists` to `js/db.js`**

Add this export after `writeBackExpired` at the bottom of the Firebase operations section:

```js
// One-time check: does this user's record exist in Firebase?
// Returns true if found, false if missing. Throws on network error (caller decides how to handle).
export async function userExists(userId) {
  const snap = await get(ref(db, `users/${userId}`));
  return snap.exists();
}
```

`get` and `ref` are already imported at the top of the file.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=db.test.js
```

Expected: 2 tests pass

- [ ] **Step 5: Run full suite to confirm nothing broke**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add tests/db.test.js js/db.js
git commit -m "feat: add userExists to db.js with tests"
```

---

### Task 2: `clearIdentity` — test first, then implementation

**Files:**
- Modify: `tests/identity.test.js`
- Modify: `js/identity.js`

- [ ] **Step 1: Add failing test to `tests/identity.test.js`**

First, update the destructure on line 2 of `tests/identity.test.js`:

```js
const { generateCode, generateUserId, loadIdentity, saveIdentity, clearIdentity } = require('../js/identity');
```

Then append the new test after the existing tests:

```js
test('clearIdentity removes the stored identity so loadIdentity returns null', () => {
  saveIdentity('user-abc', 'XYZ123');
  clearIdentity();
  expect(loadIdentity()).toBeNull();
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --testPathPattern=identity.test.js
```

Expected: 1 failure — `TypeError: clearIdentity is not a function`

- [ ] **Step 3: Add `clearIdentity` to `js/identity.js`**

Add the function after `saveIdentity`:

```js
function clearIdentity() {
  localStorage.removeItem(STORAGE_KEY);
}
```

Add `clearIdentity` to `module.exports`:

```js
module.exports = { generateCode, generateUserId, loadIdentity, saveIdentity, clearIdentity };
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=identity.test.js
```

Expected: all 6 tests pass

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add tests/identity.test.js js/identity.js
git commit -m "feat: add clearIdentity to identity.js with test"
```

---

### Task 3: Stale screen HTML and CSS

**Files:**
- Modify: `index.html`
- Modify: `css/app.css`

No unit tests for HTML/CSS.

- [ ] **Step 1: Add the stale screen overlay to `index.html`**

Add this block immediately after the opening `<body>` tag (before `<!-- Tab panels -->`):

```html
<!-- Stale identity recovery screen -->
<div id="stale-screen" class="stale-screen hidden">
  <div class="stale-card">
    <p class="stale-msg">Your previous session was not found.<br>A new code has been generated for you.</p>
    <button id="stale-continue-btn" class="primary-btn">Continue</button>
  </div>
</div>
```

- [ ] **Step 2: Add CSS to `css/app.css`**

Append after the last rule in the file:

```css
/* Stale identity recovery screen */
.stale-screen {
  position: fixed;
  inset: 0;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
  padding: 2rem;
}
.stale-card {
  background: var(--surface);
  border-radius: 14px;
  padding: 2rem 1.5rem;
  max-width: 340px;
  width: 100%;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.stale-msg {
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--text-muted);
}
```

- [ ] **Step 3: Run tests to confirm nothing broke**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add index.html css/app.css
git commit -m "feat: add stale identity screen HTML and CSS"
```

---

## Chunk 2: App bootstrap wiring

### Task 4: Update `ensureIdentity` and `main` in `app.js`

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Add `clearIdentity` to the import from `identity.js`**

Find line 2 of `js/app.js`:

```js
import { loadIdentity, saveIdentity, generateUserId, generateCode } from './identity.js';
```

Replace with:

```js
import { loadIdentity, saveIdentity, generateUserId, generateCode, clearIdentity } from './identity.js';
```

- [ ] **Step 2: Add `userExists` to the import from `db.js`**

Find line 3 of `js/app.js`:

```js
import { initUser, watchStatus, isExpired, writeBackExpired } from './db.js';
```

Replace with:

```js
import { initUser, watchStatus, isExpired, writeBackExpired, userExists } from './db.js';
```

- [ ] **Step 3: Replace `ensureIdentity` with the stale-checking version**

Find the existing `ensureIdentity` function:

```js
async function ensureIdentity() {
  const existing = loadIdentity();
  if (existing) return existing;

  // First open: generate identity and register in Firebase with collision retry
  let userId, code, success;
  do {
    userId = generateUserId();
    code = generateCode();
    success = await initUser(userId, code);
  } while (!success);

  saveIdentity(userId, code);
  return { userId, code };
}
```

Replace with:

```js
async function ensureIdentity() {
  const existing = loadIdentity();
  if (existing) {
    try {
      const valid = await userExists(existing.userId);
      if (!valid) {
        clearIdentity();
        return null; // signals stale identity to caller
      }
    } catch {
      // Network error (offline) — assume valid and proceed
    }
    return existing;
  }

  // First open: generate identity and register in Firebase with collision retry
  let userId, code, success;
  do {
    userId = generateUserId();
    code = generateCode();
    success = await initUser(userId, code);
  } while (!success);

  saveIdentity(userId, code);
  return { userId, code };
}
```

- [ ] **Step 4: Add `showStaleScreen` helper and update `main`**

Add this function before `main()`:

```js
function showStaleScreen() {
  return new Promise((resolve) => {
    document.getElementById('stale-screen').classList.remove('hidden');
    document.getElementById('stale-continue-btn').addEventListener('click', () => {
      document.getElementById('stale-screen').classList.add('hidden');
      resolve();
    }, { once: true });
  });
}
```

Find inside `main()`:

```js
  const { userId, code } = await ensureIdentity();
```

Replace with:

```js
  let identity = await ensureIdentity();
  if (!identity) {
    await showStaleScreen();
    identity = await ensureIdentity();
  }
  const { userId, code } = identity;
```

- [ ] **Step 5: Run tests to confirm nothing broke**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add js/app.js
git commit -m "feat: detect stale identity on startup and show recovery screen"
```
