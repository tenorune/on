# My Code Follower Names Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the user's custom name for a follower (when they are also being followed back) as a muted subtitle beneath the follower's code on the My Code tab.

**Architecture:** `renderFollowers` in `js/mycode.js` is called on every Firebase `watchFollowers` callback. We look up each follower's `userId` in the localStorage following list (`getFollowing()`) and, if a match with a non-empty label is found, inject a name element into the row's HTML. No new network calls or state. A new CSS class styles the name.

**Tech Stack:** Vanilla JS ES modules, Firebase Realtime Database (read-only here), localStorage via `store.js`, Jest + jsdom for tests.

---

## Chunk 1: CSS rule and tested implementation

### Task 1: Add the `.person-follower-name` CSS rule

**Files:**
- Modify: `css/app.css:133-135` (after `.followers-section`, before `/* Utilities */`)

No automated test for CSS — verify visually after Task 2 is complete.

- [ ] **Step 1: Add the CSS rule**

  Open `css/app.css`. Find the `.followers-section` rule (currently the last rule in the `/* My Code tab */` block, around line 133). Insert immediately after it, before the `/* Utilities */` comment:

  ```css
  .person-follower-name { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
  ```

- [ ] **Step 2: Verify the file looks right**

  The My Code tab section should now end with:

  ```css
  .followers-section { width: 100%; max-width: 320px; display: flex; flex-direction: column; align-items: flex-start; }
  .person-follower-name { font-size: 12px; color: var(--text-muted); margin-top: 2px; }

  /* Utilities */
  ```

---

### Task 2: Test and implement follower name display in `renderFollowers`

**Files:**
- Create: `tests/mycode.test.js`
- Modify: `js/mycode.js` (export `renderFollowers`, add `getFollowing` import, add name logic)

#### Step 1: Write the failing tests

- [ ] **Create `tests/mycode.test.js`** with the following content:

  ```js
  // tests/mycode.test.js
  // Mock db.js directly (same pattern as me.test.js) — this prevents firebase
  // from being loaded at all. utils.js needs no mock; it's a pure function with
  // no external dependencies and loads fine in jsdom.
  jest.mock('../js/db.js', () => ({
    watchFollowers: jest.fn(),
    removeFollower: jest.fn(),
  }));
  jest.mock('../js/store.js', () => ({ getFollowing: jest.fn() }));

  const { getFollowing } = require('../js/store.js');
  const { renderFollowers } = require('../js/mycode.js');

  beforeEach(() => {
    document.body.innerHTML = '<ul id="followers-list"></ul><p id="no-followers-msg"></p>';
    getFollowing.mockReset();
  });

  test('shows custom name for a followed-back follower, and no name for an unknown follower', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: 'Alice' },
    ]);

    renderFollowers('myUserId', [
      { userId: 'u1', code: 'XY9K2M' },
      { userId: 'u2', code: 'Q3ZP7R' },
    ]);

    const items = document.querySelectorAll('#followers-list li');
    expect(items[0].querySelector('.person-follower-name').textContent).toBe('Alice');
    expect(items[1].querySelector('.person-follower-name')).toBeNull();
  });

  test('does not show name when label is empty string', () => {
    getFollowing.mockReturnValue([
      { userId: 'u1', code: 'XY9K2M', label: '' },
    ]);

    renderFollowers('myUserId', [{ userId: 'u1', code: 'XY9K2M' }]);

    const li = document.querySelector('#followers-list li');
    expect(li.querySelector('.person-follower-name')).toBeNull();
  });
  ```

- [ ] **Step 2: Run the tests to verify they fail**

  ```bash
  npx jest --testPathPatterns=tests/mycode.test.js --no-coverage
  ```

  Expected: Both tests fail. The likely error is `renderFollowers is not a function` (because it is not yet exported). If it fails for a different reason (e.g. a missing mock), fix the test setup before proceeding — do not move on until the failure is about missing behaviour, not a test configuration error.

#### Step 3: Implement

- [ ] **Add the `getFollowing` import to `js/mycode.js`**

  The current line 2 is:
  ```js
  import { watchFollowers, removeFollower } from './db.js';
  ```

  Add a new import line after it:
  ```js
  import { getFollowing } from './store.js';
  ```

- [ ] **Export `renderFollowers`**

  Find the line (currently around line 21):
  ```js
  function renderFollowers(myUserId, followers) {
  ```

  Change it to:
  ```js
  export function renderFollowers(myUserId, followers) {
  ```

- [ ] **Add the name lookup inside `renderFollowers`**

  Inside the `followers.forEach` loop, the current code builds each `li` like this:

  ```js
  followers.forEach(({ userId, code }) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="person-info">
        <div class="person-label" style="letter-spacing:2px;font-size:13px">${escapeHtml(code)}</div>
      </div>
      <button class="remove-btn" data-follower-id="${escapeHtml(userId)}">Remove</button>`;
  ```

  Replace that `li.innerHTML` assignment with:

  ```js
  followers.forEach(({ userId, code }) => {
    const li = document.createElement('li');
    const followingEntry = getFollowing().find((f) => f.userId === userId);
    const nameHtml = (followingEntry && followingEntry.label)
      ? `<div class="person-follower-name">${escapeHtml(followingEntry.label)}</div>`
      : '';
    li.innerHTML = `
      <div class="person-info">
        <div class="person-label" style="letter-spacing:2px;font-size:13px">${escapeHtml(code)}</div>
        ${nameHtml}
      </div>
      <button class="remove-btn" data-follower-id="${escapeHtml(userId)}">Remove</button>`;
  ```

  Leave the rest of the loop (the `remove-btn` event listener) unchanged.

#### Step 4: Verify

- [ ] **Run the tests**

  ```bash
  npx jest --testPathPatterns=tests/mycode.test.js --no-coverage
  ```

  Expected: Both tests pass. If either fails, re-read the implementation against the spec before changing the tests.

- [ ] **Run the full test suite**

  ```bash
  npx jest --no-coverage
  ```

  Expected: All tests pass. Zero failures.

#### Step 5: Commit

- [ ] **Commit**

  ```bash
  git add js/mycode.js css/app.css tests/mycode.test.js
  git commit -m "feat: show custom name under follower code on My Code tab"
  ```
