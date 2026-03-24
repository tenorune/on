# Call Display Text Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the status text on user cards with call-state messages ("Calling…" / "is calling you…") during call mode, with onboarding hints for new users.

**Architecture:** Add two localStorage counters (`madeCallCount`, `answeredCallCount`) to `store.js`. In `following.js`, increment at call initiation and answer points, and short-circuit the status text logic in `updateFolloweeRow()` when a card is in call mode.

**Tech Stack:** Vanilla JS, localStorage, Jest

---

## Chunk 1: localStorage Counters

### Task 1: Add call count functions to store.js

**Files:**
- Modify: `js/store.js`
- Test: `tests/store.test.js`

- [ ] **Step 1: Write failing tests for call count getters and incrementers**

In `tests/store.test.js`, add at the end:

```js
// --- Call count counters ---

test('getMadeCallCount returns 0 when nothing stored', () => {
  expect(getMadeCallCount()).toBe(0);
});

test('incrementMadeCallCount increments from 0 to 1', () => {
  incrementMadeCallCount();
  expect(getMadeCallCount()).toBe(1);
});

test('incrementMadeCallCount accumulates', () => {
  incrementMadeCallCount();
  incrementMadeCallCount();
  incrementMadeCallCount();
  expect(getMadeCallCount()).toBe(3);
});

test('getAnsweredCallCount returns 0 when nothing stored', () => {
  expect(getAnsweredCallCount()).toBe(0);
});

test('incrementAnsweredCallCount increments from 0 to 1', () => {
  incrementAnsweredCallCount();
  expect(getAnsweredCallCount()).toBe(1);
});

test('incrementAnsweredCallCount accumulates', () => {
  incrementAnsweredCallCount();
  incrementAnsweredCallCount();
  incrementAnsweredCallCount();
  incrementAnsweredCallCount();
  expect(getAnsweredCallCount()).toBe(4);
});
```

Update the `require` at the top of `tests/store.test.js` to include the new functions:

```js
const {
  getFollowing, addFollowing, removeFollowing, isFollowing,
  getLastTimeout, setLastTimeout, renameFollowing, updateFollowingCode,
  getPalette, setPalette, getPaletteState, setPaletteState,
  getMadeCallCount, incrementMadeCallCount, getAnsweredCallCount, incrementAnsweredCallCount,
} = require('../js/store');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/store.test.js --verbose`
Expected: 6 new tests FAIL (functions not defined)

- [ ] **Step 3: Implement the four functions in store.js**

In `js/store.js`, add after the key constants at the top:

```js
const MADE_CALL_COUNT_KEY = 'statusapp_made_call_count';
const ANSWERED_CALL_COUNT_KEY = 'statusapp_answered_call_count';
```

Add before `module.exports`:

```js
function getMadeCallCount() {
  return parseInt(localStorage.getItem(MADE_CALL_COUNT_KEY) || '0', 10);
}

function incrementMadeCallCount() {
  localStorage.setItem(MADE_CALL_COUNT_KEY, String(getMadeCallCount() + 1));
}

function getAnsweredCallCount() {
  return parseInt(localStorage.getItem(ANSWERED_CALL_COUNT_KEY) || '0', 10);
}

function incrementAnsweredCallCount() {
  localStorage.setItem(ANSWERED_CALL_COUNT_KEY, String(getAnsweredCallCount() + 1));
}
```

Add all four to the `module.exports` object.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/store.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add js/store.js tests/store.test.js
git commit -m "feat: add madeCallCount and answeredCallCount localStorage counters"
```

---

## Chunk 2: Call Display Text and Counter Increments

### Task 2: Increment counters at call initiation and answer points

**Files:**
- Modify: `js/following.js`

- [ ] **Step 1: Import new store functions in following.js**

Update the `store.js` import at line 8 to include:

```js
import {
  getFollowing, addFollowing, removeFollowing, renameFollowing, updateFollowingCode,
  getPaletteState, setPaletteState,
  getMadeCallCount, incrementMadeCallCount, getAnsweredCallCount, incrementAnsweredCallCount,
} from './store.js';
```

- [ ] **Step 2: Increment madeCallCount in enterCallMode()**

In `enterCallMode()` (line 178), add `incrementMadeCallCount();` as the first line of the function body, before the `lastUserData.forEach` block.

- [ ] **Step 3: Increment answeredCallCount in the swipe-right answer handler**

In the swipe-right handler (around line 450), inside the `if (li.classList.contains('call-mode') && callModeCalleeId !== entry.userId)` block, add `incrementAnsweredCallCount();` as the first line, before `const peerData = ...`.

- [ ] **Step 4: Commit**

```bash
git add js/following.js
git commit -m "feat: increment call counters on call initiation and answer"
```

### Task 3: Replace status text during call mode

**Files:**
- Modify: `js/following.js:589-680` — `updateFolloweeRow()`

- [ ] **Step 1: Move role detection earlier in updateFolloweeRow()**

Currently `isCallee` and `isCallModeReceiver` are computed at line 653. Move these two lines to just after `let statusText;` (after line 601), so they're available for the status text logic:

```js
  let statusText;
  const isCallee = callModeCalleeId !== null && entry.userId === callModeCalleeId;
  const isCallModeReceiver = !isCallee && userData.callState?.calleeId === myUserId;
```

Remove the duplicate declarations from their original location (around line 653). The references at line 655 onward (`if (isCallee || isCallModeReceiver)`) remain unchanged.

- [ ] **Step 2: Add call-state text short-circuit**

After the `isCallModeReceiver` line and before the `if (isAvail)` block, add:

```js
  if (isCallee) {
    statusText = getMadeCallCount() < 4
      ? 'Calling\u2026 (swipe left to hang up)'
      : 'Calling\u2026';
  } else if (isCallModeReceiver) {
    statusText = getAnsweredCallCount() < 4
      ? 'is calling you\u2026 (swipe right to answer)'
      : 'is calling you\u2026';
  } else if (isAvail) {
```

This replaces the existing `if (isAvail) {` at line 602. The full block becomes:

```js
  if (isCallee) {
    statusText = getMadeCallCount() < 4
      ? 'Calling\u2026 (swipe left to hang up)'
      : 'Calling\u2026';
  } else if (isCallModeReceiver) {
    statusText = getAnsweredCallCount() < 4
      ? 'is calling you\u2026 (swipe right to answer)'
      : 'is calling you\u2026';
  } else if (isAvail) {
    if (PALETTES_ENABLED) {
      statusText = `<span class="status-available" style="color:${safeCssColor(color)}">Available for ${formatTimeRemainingFuzzy(ms).replace(/ left$/, '')}</span>`;
    } else {
      statusText = `<span class="status-available">Available for ${formatTimeRemainingFuzzy(ms).replace(/ left$/, '')}</span>`;
    }
  } else {
    const lastSeenPhrase = formatLastSeen(userData.lastSeen ?? null);
    statusText = lastSeenPhrase ? `Last seen ${lastSeenPhrase}` : 'Unavailable';
  }
```

- [ ] **Step 3: Run all tests**

Run: `npx jest --verbose`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add js/following.js
git commit -m "feat: show call-state text on user cards during call mode"
```

### Task 4: Add tests for call display text in following.test.js

**Files:**
- Modify: `tests/following.test.js`

- [ ] **Step 1: Add getMadeCallCount/getAnsweredCallCount to the store.js mock**

In the `jest.mock('../js/store.js', ...)` block (around line 48), add the four new functions to the mock object:

```js
  getMadeCallCount: jest.fn().mockReturnValue(0),
  incrementMadeCallCount: jest.fn(),
  getAnsweredCallCount: jest.fn().mockReturnValue(0),
  incrementAnsweredCallCount: jest.fn(),
```

Also add them to the destructured require at line 65:

```js
const { getFollowing, updateFollowingCode, getMadeCallCount, getAnsweredCallCount } = require('../js/store.js');
```

- [ ] **Step 2: Add call display text describe block**

Add this `describe` block after the existing "call mode: receiver-side glow via updateFolloweeRow" describe block (after line 771). Uses the existing `makeFolloweeLi` helper and `updateFolloweeRow` import:

```js
describe('call mode: display text during call', () => {
  beforeEach(() => {
    setupDom();
    jest.clearAllMocks();
    resetRenderedFollowees();
  });

  test('caller sees "Calling…" when madeCallCount >= 4', () => {
    getMadeCallCount.mockReturnValue(4);
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    makeFolloweeLi('alice');
    enterCallMode(entry, 'myUid');
    updateFolloweeRow(entry, {
      status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#22c55e',
    }, 'myUid');
    const status = document.querySelector('[data-user-id="alice"] .person-status');
    expect(status.textContent).toBe('Calling\u2026');
  });

  test('caller sees "(swipe left to hang up)" hint when madeCallCount < 4', () => {
    getMadeCallCount.mockReturnValue(2);
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    makeFolloweeLi('alice');
    enterCallMode(entry, 'myUid');
    updateFolloweeRow(entry, {
      status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#22c55e',
    }, 'myUid');
    const status = document.querySelector('[data-user-id="alice"] .person-status');
    expect(status.textContent).toBe('Calling\u2026 (swipe left to hang up)');
  });

  test('receiver sees "is calling you…" when answeredCallCount >= 4', () => {
    getAnsweredCallCount.mockReturnValue(5);
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    makeFolloweeLi('alice');
    updateFolloweeRow(entry, {
      status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#3b82f6',
      callState: { calleeId: 'myUid', since: Date.now() },
    }, 'myUid');
    const status = document.querySelector('[data-user-id="alice"] .person-status');
    expect(status.textContent).toBe('is calling you\u2026');
  });

  test('receiver sees "(swipe right to answer)" hint when answeredCallCount < 4', () => {
    getAnsweredCallCount.mockReturnValue(1);
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    makeFolloweeLi('alice');
    updateFolloweeRow(entry, {
      status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#3b82f6',
      callState: { calleeId: 'myUid', since: Date.now() },
    }, 'myUid');
    const status = document.querySelector('[data-user-id="alice"] .person-status');
    expect(status.textContent).toBe('is calling you\u2026 (swipe right to answer)');
  });

  test('normal status text resumes after call mode ends', () => {
    const entry = { userId: 'alice', code: 'AAA111', label: 'Alice' };
    makeFolloweeLi('alice');
    enterCallMode(entry, 'myUid');
    exitCallMode('myUid');
    updateFolloweeRow(entry, {
      status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#22c55e',
    }, 'myUid');
    const status = document.querySelector('[data-user-id="alice"] .person-status');
    expect(status.textContent).toContain('Available for');
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx jest tests/following.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add tests/following.test.js
git commit -m "test: add call display text tests"
```
