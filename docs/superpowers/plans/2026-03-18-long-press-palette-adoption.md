# Long-press Palette Adoption — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Long-pressing a followee card adopts that user's palette theme and status color; long-pressing again reverts.

**Architecture:** All logic in `js/following.js`. Three new private functions (`applyAdoption`, `revertAdoption`, `triggerAdoption`), one new module-level state variable (`adoptionSnapshot`), and a long press handler attached in `createFolloweeRow`. Gated by `PALETTES_ENABLED`.

**Tech Stack:** Vanilla JS, pointer events, Jest + jsdom, Firebase RTDB (via `db.js`), `palettes.js` (`enterPaletteMode`, `exitPaletteMode`, `switchSet`).

---

## Chunk 1: Scaffolding — imports, state, mock updates

### Task 1: Add imports and `adoptionSnapshot` state

**Files:**

- Modify: `js/following.js:2-12` (import block)
- Modify: `js/following.js:62-75` (initList resets)
- Modify: `tests/following.test.js:14-19` (palettes.js mock)
- Modify: `tests/following.test.js:59-65` (destructured imports)

- [ ] **Step 1: Write a genuinely failing test — palettes mock does NOT yet have `enterPaletteMode`**

  In `tests/following.test.js`, add a new `describe` block after the existing import section.
  The test asserts absence so it fails before the mock is updated:

  ```js
  // --- long-press palette adoption ---

  describe('long-press palette adoption: scaffolding', () => {
    beforeEach(() => {
      setupDom();
      jest.clearAllMocks();
    });

    test('enterPaletteMode is NOT yet a jest.fn() in the palettes mock (will fail until Step 3)', () => {
      // This test should FAIL until the mock is updated in Step 3.
      // jest.requireActual returns the real function, not a jest.fn().
      const { enterPaletteMode } = require('../js/palettes.js');
      expect(jest.isMockFunction(enterPaletteMode)).toBe(true);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  cd /Users/michael/Public/Code/pwa-status-app && npx jest tests/following.test.js -t "enterPaletteMode is NOT yet a jest.fn" --no-coverage 2>&1 | tail -20
  ```

  Expected: FAIL — `jest.isMockFunction(enterPaletteMode)` is `false` because the current mock uses
  `jest.requireActual` for `enterPaletteMode`, giving the real function, not a spy.

- [ ] **Step 3: Update palettes.js mock to add `enterPaletteMode`, `exitPaletteMode`, `switchSet`**

  In `tests/following.test.js`, replace the palettes mock:

  ```js
  jest.mock('../js/palettes.js', () => ({
    ...jest.requireActual('../js/palettes.js'),
    getPaletteByKey: jest.fn(),
    applyThemeVars: jest.fn(),
    resetThemeVars: jest.fn(),
    enterPaletteMode: jest.fn(),
    exitPaletteMode: jest.fn(),
    switchSet: jest.fn(),
  }));
  ```

  And update the destructured imports line in the test file:

  ```js
  const { getGlowForColor, getPaletteByKey, enterPaletteMode, exitPaletteMode, switchSet } = require('../js/palettes.js');
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  npx jest tests/following.test.js -t "enterPaletteMode and exitPaletteMode are importable" --no-coverage 2>&1 | tail -10
  ```

  Expected: PASS.

- [ ] **Step 5: Update `following.js` imports**

  In `js/following.js`, update the three import lines:

  **db.js import** — add `setStatusColor`:

  ```js
  import {
    lookupCode, watchStatus, watchFollowers, registerAsFollower, unregisterAsFollower,
    removeFollower, isExpired, writeBackExpired, formatTimeRemainingFuzzy, timeRemainingMs,
    formatLastSeen, setCallState, clearCallState, setStatusColor,
  } from './db.js';
  ```

  **store.js import** — add `getPaletteState`:

  ```js
  import {
    getFollowing, addFollowing, removeFollowing, renameFollowing, updateFollowingCode,
    getPaletteState,
  } from './store.js';
  ```

  **palettes.js import** — add `enterPaletteMode`, `exitPaletteMode`, `switchSet`:

  ```js
  import { getGlowForColor, getPaletteByKey, enterPaletteMode, exitPaletteMode, switchSet } from './palettes.js';
  ```

- [ ] **Step 6: Add `adoptionSnapshot` module state and reset in `initList`**

  After the `let callModeCalleeId = null;` line in `following.js`, add:

  ```js
  let adoptionSnapshot = null; // non-null while a card's palette is adopted
  ```

  In `initList`, after `callModeCalleeId = null;`, add:

  ```js
  adoptionSnapshot = null;
  ```

- [ ] **Step 7: Run all tests to verify no regressions**

  ```bash
  npx jest tests/following.test.js --no-coverage 2>&1 | tail -10
  ```

  Expected: all tests that passed before still pass.

- [ ] **Step 8: Commit**

  ```bash
  git add js/following.js tests/following.test.js
  git commit -m "feat: long-press adoption — add imports, adoptionSnapshot state, mock updates"
  ```

---

## Chunk 2: `applyAdoption` function

### Task 2: Implement `applyAdoption` with TDD

**Files:**

- Modify: `js/following.js` (add `applyAdoption` function)
- Modify: `tests/following.test.js` (new `describe` block)

**Test setup pattern used throughout this chunk:**

```js
// Helper used in adoption tests — sets up a mutual card and populates lastUserData
function setupMutualAndFireStatus(userId, userData, myUserId = 'myUid') {
  getFollowing.mockReturnValue([{ userId, code: 'XY9K2M', label: 'Alice' }]);
  const fire = initAndCaptureFollowersCallback(myUserId);
  fire([{ userId, code: 'XY9K2M' }]);  // mutual
  // Populate lastUserData by firing a watchStatus callback
  const watchStatusCb = watchStatus.mock.calls.find(c => c[0] === userId)?.[1];
  if (watchStatusCb) watchStatusCb(userData);
  return document.querySelector(`[data-user-id="${userId}"]`);
}
```

- [ ] **Step 1: Write failing tests for `applyAdoption`**

  Add this `describe` block in `tests/following.test.js`:

  ```js
  describe('applyAdoption', () => {
    const TARGET_ID = 'u1';
    const MY_ID = 'myUid';

    beforeEach(() => {
      setupDom();
      jest.clearAllMocks();
      // Pre-set CSS vars so snapshot can read them
      document.documentElement.style.setProperty('--my-status', '#22c55e');
      document.documentElement.style.setProperty('--my-glow', '#86efac');
    });

    test('calls enterPaletteMode with target paletteKey when present', () => {
      setupMutualAndFireStatus(TARGET_ID, { statusColor: '#f59e0b', paletteKey: 'ember' });
      // Trigger long press via the exposed triggerAdoption path — we test applyAdoption
      // indirectly by calling triggerAdoption; it is tested directly here once exported
      // by calling the adoption path via long press (tested in Task 4).
      // For unit coverage, export applyAdoption temporarily is NOT needed —
      // test via updateFolloweeRow + long press in Task 4.
      // Here we write integration assertions using enterPaletteMode mock calls.
      // We'll add the long-press trigger tests in Task 4; skip direct call here.
      expect(true).toBe(true); // placeholder — replaced in Task 4
    });
  });
  ```

  > **Note:** `applyAdoption` is private and tested indirectly through the long press handler.
  > The real tests are in Task 4. In this task we write unit-style tests that call it via a
  > thin exported helper. Add to the `following.js` export block for test purposes:
  > `export function _testOnlyTriggerAdoption(entry, myUserId) { triggerAdoption(entry, myUserId); }`
  >
  > Then in the test file, destructure `_testOnlyTriggerAdoption` from the import and use it
  > without the long press timer complexity.

- [ ] **Step 2: Add test-only export to `following.js`** (remove before final commit)

  At the end of `following.js`, add temporarily:

  ```js
  export function _testOnlyTriggerAdoption(entry, myUserId) { triggerAdoption(entry, myUserId); }
  ```

  > This will be removed in Task 4 once triggerAdoption is wired to the long press handler
  > and tested via pointer events. The test helper is removed then.

- [ ] **Step 3: Write the real failing tests for `applyAdoption`**

  Replace the placeholder `describe('applyAdoption', ...)` with:

  ```js
  describe('applyAdoption', () => {
    const TARGET_ID = 'u1';
    const MY_ID = 'myUid';

    beforeEach(() => {
      setupDom();
      jest.clearAllMocks();
      document.documentElement.style.setProperty('--my-status', '#22c55e');
      document.documentElement.style.setProperty('--my-glow', '#86efac');
    });

    function triggerAdoptionFor(userId, userData) {
      const li = setupMutualAndFireStatus(userId, userData, MY_ID);
      const { _testOnlyTriggerAdoption } = require('../js/following.js');
      _testOnlyTriggerAdoption({ userId }, MY_ID);
      return li;
    }

    test('calls enterPaletteMode with target paletteKey when present', () => {
      triggerAdoptionFor(TARGET_ID, { statusColor: '#f59e0b', paletteKey: 'ember' });
      expect(enterPaletteMode).toHaveBeenCalledWith('ember', MY_ID);
    });

    test('does NOT call enterPaletteMode when target has no paletteKey', () => {
      triggerAdoptionFor(TARGET_ID, { statusColor: '#f59e0b' });
      expect(enterPaletteMode).not.toHaveBeenCalled();
    });

    test('calls setStatusColor with target statusColor when present', () => {
      const { setStatusColor } = require('../js/db.js');
      triggerAdoptionFor(TARGET_ID, { statusColor: '#f59e0b', paletteKey: 'ember' });
      expect(setStatusColor).toHaveBeenCalledWith(MY_ID, '#f59e0b');
    });

    test('does NOT call setStatusColor when target has no statusColor', () => {
      const { setStatusColor } = require('../js/db.js');
      triggerAdoptionFor(TARGET_ID, { paletteKey: 'ember' });
      expect(setStatusColor).not.toHaveBeenCalled();
    });

    test('sets --my-status CSS var to target statusColor', () => {
      triggerAdoptionFor(TARGET_ID, { statusColor: '#f59e0b' });
      expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#f59e0b');
    });

    test('adds .adopted-from class to target li', () => {
      const li = triggerAdoptionFor(TARGET_ID, { statusColor: '#f59e0b' });
      expect(li.classList.contains('adopted-from')).toBe(true);
    });

    test('snapshots current --my-status before applying new one', () => {
      // After adoption, adopting a second card should revert to the original
      // (tested more fully in revertAdoption tests, but snapshot capture verified here)
      const { setStatusColor } = require('../js/db.js');
      triggerAdoptionFor(TARGET_ID, { statusColor: '#f59e0b' });
      // First adoption wrote #f59e0b; snapshot held #22c55e
      // Second long press on same card should revert
      const { _testOnlyTriggerAdoption } = require('../js/following.js');
      _testOnlyTriggerAdoption({ userId: TARGET_ID }, MY_ID);
      // Revert: setStatusColor called with original #22c55e
      expect(setStatusColor).toHaveBeenLastCalledWith(MY_ID, '#22c55e');
    });
  });
  ```

- [ ] **Step 4: Run tests to verify they fail**

  ```bash
  npx jest tests/following.test.js -t "applyAdoption" --no-coverage 2>&1 | tail -20
  ```

  Expected: FAIL — `triggerAdoption` is not defined.

- [ ] **Step 5: Implement `applyAdoption`, `revertAdoption`, `triggerAdoption` in `following.js`**

  Add these three functions before `createFolloweeRow` (around line 330):

  ```js
  function applyAdoption(entry, myUserId) {
    if (adoptionSnapshot) revertAdoption(myUserId);

    const ps = getPaletteState();
    const activeSet = String(ps.activeSet);
    const style = getComputedStyle(document.documentElement);
    adoptionSnapshot = {
      fromUserId: entry.userId,
      activeSet: ps.activeSet,
      activePaletteKey: ps.sets[activeSet].activePaletteKey,
      selectedKey: ps.sets[activeSet].selectedKey,
      statusColor: style.getPropertyValue('--my-status').trim(),
      glowColor:   style.getPropertyValue('--my-glow').trim(),
    };

    const targetData = lastUserData.get(entry.userId);
    if (targetData?.paletteKey) {
      enterPaletteMode(targetData.paletteKey, myUserId);
    }
    if (targetData?.statusColor) {
      setStatusColor(myUserId, targetData.statusColor).catch(() => {});
      const glow = getGlowForColor(targetData.statusColor);
      document.documentElement.style.setProperty('--my-status', targetData.statusColor);
      document.documentElement.style.setProperty('--my-glow', glow);
    }

    const li = document.querySelector(`[data-user-id="${entry.userId}"]`);
    if (li) li.classList.add('adopted-from');
  }

  function revertAdoption(myUserId) {
    const snapshot = adoptionSnapshot;
    if (!snapshot) return;

    switchSet(snapshot.activeSet, myUserId);

    if (snapshot.activePaletteKey) {
      enterPaletteMode(snapshot.activePaletteKey, myUserId);
    } else {
      exitPaletteMode(myUserId);
    }

    document.documentElement.style.setProperty('--my-status', snapshot.statusColor);
    document.documentElement.style.setProperty('--my-glow', snapshot.glowColor);
    setStatusColor(myUserId, snapshot.statusColor).catch(() => {});

    document.querySelectorAll('.adopted-from').forEach(el => el.classList.remove('adopted-from'));
    adoptionSnapshot = null;
  }

  function triggerAdoption(entry, myUserId) {
    if (adoptionSnapshot?.fromUserId === entry.userId) {
      revertAdoption(myUserId);
    } else {
      applyAdoption(entry, myUserId);
    }
  }
  ```

- [ ] **Step 6: Run `applyAdoption` tests to verify they pass**

  ```bash
  npx jest tests/following.test.js -t "applyAdoption" --no-coverage 2>&1 | tail -15
  ```

  Expected: all PASS.

- [ ] **Step 7: Run full test suite for regressions**

  ```bash
  npx jest tests/following.test.js --no-coverage 2>&1 | tail -10
  ```

  Expected: same pass count as before this chunk.

- [ ] **Step 8: Commit**

  ```bash
  git add js/following.js tests/following.test.js
  git commit -m "feat: implement applyAdoption, revertAdoption, triggerAdoption"
  ```

---

## Chunk 3: `revertAdoption` tests and long press handler

### Task 3: Write `revertAdoption` tests

**Files:**

- Modify: `tests/following.test.js`

- [ ] **Step 1: Write `revertAdoption` tests**

  Add after the `applyAdoption` describe block:

  ```js
  describe('revertAdoption', () => {
    const TARGET_ID = 'u1';
    const MY_ID = 'myUid';

    function adoptThenRevert(targetData) {
      setupDom();
      jest.clearAllMocks();
      document.documentElement.style.setProperty('--my-status', '#22c55e');
      document.documentElement.style.setProperty('--my-glow', '#86efac');
      setupMutualAndFireStatus(TARGET_ID, targetData, MY_ID);
      const { _testOnlyTriggerAdoption } = require('../js/following.js');
      _testOnlyTriggerAdoption({ userId: TARGET_ID }, MY_ID);  // adopt
      jest.clearAllMocks(); // clear calls from adoption so we only see revert calls
      _testOnlyTriggerAdoption({ userId: TARGET_ID }, MY_ID);  // revert
    }

    test('calls switchSet with snapshot activeSet before enterPaletteMode/exitPaletteMode', () => {
      adoptThenRevert({ statusColor: '#f59e0b', paletteKey: 'ember' });
      // invocationCallOrder uses a global counter; clearAllMocks() resets call lists but NOT the
      // counter, so values from the revert phase are always > values from the adoption phase.
      const switchSetOrder = switchSet.mock.invocationCallOrder[0];
      const enterOrder = enterPaletteMode.mock.invocationCallOrder[0];
      expect(switchSetOrder).toBeLessThan(enterOrder);
    });

    test('calls enterPaletteMode with original activePaletteKey when snapshot had one', () => {
      // Set up store to return an activePaletteKey in the snapshot
      const { getPaletteState } = require('../js/store.js');
      getPaletteState.mockReturnValue({
        activeSet: 1,
        sets: {
          '1': { selectedKey: 'ocean', activePaletteKey: 'ocean' },
          '2': { selectedKey: 'volt', activePaletteKey: null },
        },
      });
      adoptThenRevert({ statusColor: '#f59e0b' });
      expect(enterPaletteMode).toHaveBeenCalledWith('ocean', MY_ID);
      expect(exitPaletteMode).not.toHaveBeenCalled();
    });

    test('calls exitPaletteMode when snapshot activePaletteKey was null', () => {
      // Default store mock has activePaletteKey: null
      adoptThenRevert({ statusColor: '#f59e0b' });
      expect(exitPaletteMode).toHaveBeenCalledWith(MY_ID);
      expect(enterPaletteMode).not.toHaveBeenCalled();
    });

    test('restores --my-status CSS var from snapshot after palette mode calls', () => {
      // enterPaletteMode/exitPaletteMode (mocked) would normally overwrite --my-status;
      // revertAdoption must set CSS vars AFTER calling those functions.
      // Verify by checking the final value matches the snapshot (not any intermediate value).
      adoptThenRevert({ statusColor: '#f59e0b' });
      expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#22c55e');
    });

    test('--my-status restored after switchSet (ordering verified via invocationCallOrder)', () => {
      // Spy on style.setProperty to capture the call order of switchSet vs CSS var restore.
      const spy = jest.spyOn(document.documentElement.style, 'setProperty');
      adoptThenRevert({ statusColor: '#f59e0b' });
      // invocationCallOrder uses global counter; clearAllMocks() preserves it.
      const switchSetOrder = switchSet.mock.invocationCallOrder[0];
      const statusVarCall = spy.mock.calls.findIndex(c => c[0] === '--my-status' && c[1] === '#22c55e');
      const statusVarOrder = spy.mock.invocationCallOrder[statusVarCall];
      expect(switchSetOrder).toBeLessThan(statusVarOrder);
      spy.mockRestore();
    });

    test('restores --my-glow CSS var from snapshot', () => {
      adoptThenRevert({ statusColor: '#f59e0b' });
      expect(document.documentElement.style.getPropertyValue('--my-glow')).toBe('#86efac');
    });

    test('calls setStatusColor with original statusColor', () => {
      const { setStatusColor } = require('../js/db.js');
      adoptThenRevert({ statusColor: '#f59e0b' });
      expect(setStatusColor).toHaveBeenCalledWith(MY_ID, '#22c55e');
    });

    test('setStatusColor called after switchSet', () => {
      const { setStatusColor } = require('../js/db.js');
      adoptThenRevert({ statusColor: '#f59e0b' });
      // invocationCallOrder uses a global counter preserved across clearAllMocks() calls.
      const switchSetOrder = switchSet.mock.invocationCallOrder[0];
      const setStatusColorOrder = setStatusColor.mock.invocationCallOrder[0];
      expect(switchSetOrder).toBeLessThan(setStatusColorOrder);
    });

    test('removes .adopted-from class from li', () => {
      setupDom();
      jest.clearAllMocks();
      document.documentElement.style.setProperty('--my-status', '#22c55e');
      document.documentElement.style.setProperty('--my-glow', '#86efac');
      const li = setupMutualAndFireStatus(TARGET_ID, { statusColor: '#f59e0b' }, MY_ID);
      const { _testOnlyTriggerAdoption } = require('../js/following.js');
      _testOnlyTriggerAdoption({ userId: TARGET_ID }, MY_ID); // adopt
      expect(li.classList.contains('adopted-from')).toBe(true);
      _testOnlyTriggerAdoption({ userId: TARGET_ID }, MY_ID); // revert
      expect(li.classList.contains('adopted-from')).toBe(false);
    });

    test('clears adoptionSnapshot — second revert is a no-op', () => {
      const { setStatusColor } = require('../js/db.js');
      adoptThenRevert({ statusColor: '#f59e0b' });
      jest.clearAllMocks();
      // Trigger again — should not call switchSet or setStatusColor
      const { _testOnlyTriggerAdoption } = require('../js/following.js');
      // Third trigger on same card — adoptionSnapshot is null, so it will adopt not revert
      // Just verify it does NOT call switchSet (which would happen if revert ran again)
      _testOnlyTriggerAdoption({ userId: TARGET_ID }, MY_ID);
      expect(switchSet).not.toHaveBeenCalled(); // this is a fresh adoption, not revert
    });
  });
  ```

- [ ] **Step 2: Run revertAdoption tests**

  ```bash
  npx jest tests/following.test.js -t "revertAdoption" --no-coverage 2>&1 | tail -20
  ```

  Expected: all PASS (implementation already in place from Task 2).

- [ ] **Step 3: Run full test suite**

  ```bash
  npx jest tests/following.test.js --no-coverage 2>&1 | tail -10
  ```

  Expected: all passing.

- [ ] **Step 4: Commit**

  ```bash
  git add tests/following.test.js
  git commit -m "test: revertAdoption coverage — ordering, CSS vars, switchSet, cleanup"
  ```

---

### Task 4: Wire long press handler in `createFolloweeRow`; remove `_testOnlyTriggerAdoption`

**Files:**

- Modify: `js/following.js` (attach handler in `createFolloweeRow`, remove temp export)
- Modify: `tests/following.test.js` (long press timing tests, remove `_testOnlyTriggerAdoption` usage)

- [ ] **Step 1: Write long press timer tests**

  Add this `describe` block in `tests/following.test.js`:

  ```js
  describe('long press handler', () => {
    const TARGET_ID = 'u1';
    const MY_ID = 'myUid';

    function setupForLongPress(userData = { statusColor: '#f59e0b' }) {
      setupDom();
      jest.useFakeTimers();
      jest.clearAllMocks();
      document.documentElement.style.setProperty('--my-status', '#22c55e');
      document.documentElement.style.setProperty('--my-glow', '#86efac');
      setupMutualAndFireStatus(TARGET_ID, userData, MY_ID);
      return document.querySelector(`[data-user-id="${TARGET_ID}"]`);
    }

    afterEach(() => jest.useRealTimers());

    function press(li, x = 50, y = 50) {
      li.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
    }

    test('fires adoption after 500 ms', () => {
      const li = setupForLongPress();
      press(li);
      jest.advanceTimersByTime(500);
      expect(enterPaletteMode).not.toHaveBeenCalled(); // no paletteKey
      // setStatusColor should have been called (statusColor present)
      const { setStatusColor } = require('../js/db.js');
      expect(setStatusColor).toHaveBeenCalledWith(MY_ID, '#f59e0b');
    });

    test('does NOT fire adoption at 499 ms', () => {
      const li = setupForLongPress();
      press(li);
      jest.advanceTimersByTime(499);
      const { setStatusColor } = require('../js/db.js');
      expect(setStatusColor).not.toHaveBeenCalled();
    });

    test('pointermove > 8 px cancels — no adoption', () => {
      const li = setupForLongPress();
      press(li, 50, 50);
      li.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 59, clientY: 50 }));
      jest.advanceTimersByTime(500);
      const { setStatusColor } = require('../js/db.js');
      expect(setStatusColor).not.toHaveBeenCalled();
    });

    test('pointermove <= 8 px does NOT cancel', () => {
      const li = setupForLongPress();
      press(li, 50, 50);
      li.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 57, clientY: 50 }));
      jest.advanceTimersByTime(500);
      const { setStatusColor } = require('../js/db.js');
      expect(setStatusColor).toHaveBeenCalled();
    });

    test('pointerup before 500 ms cancels — no adoption', () => {
      const li = setupForLongPress();
      press(li, 50, 50);
      li.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      jest.advanceTimersByTime(500);
      const { setStatusColor } = require('../js/db.js');
      expect(setStatusColor).not.toHaveBeenCalled();
    });

    test('pointercancel cancels — no adoption', () => {
      const li = setupForLongPress();
      press(li, 50, 50);
      li.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
      jest.advanceTimersByTime(500);
      const { setStatusColor } = require('../js/db.js');
      expect(setStatusColor).not.toHaveBeenCalled();
    });

    test('long press same card twice — second press reverts (calls switchSet)', () => {
      const li = setupForLongPress();
      press(li); jest.advanceTimersByTime(500); // adopt
      jest.clearAllMocks();
      press(li); jest.advanceTimersByTime(500); // revert
      expect(switchSet).toHaveBeenCalled();
    });

    test('long press different card while adopted — revertAdoption called before new applyAdoption', () => {
      // Set up two mutual cards
      setupDom();
      jest.useFakeTimers();
      jest.clearAllMocks();
      document.documentElement.style.setProperty('--my-status', '#22c55e');
      document.documentElement.style.setProperty('--my-glow', '#86efac');
      getFollowing.mockReturnValue([
        { userId: 'u1', code: 'AAAA11', label: 'Alice' },
        { userId: 'u2', code: 'BBBB22', label: 'Bob' },
      ]);
      let followersCallback;
      watchFollowers.mockImplementation((_uid, cb) => { followersCallback = cb; return jest.fn(); });
      watchStatus.mockReturnValue(jest.fn());
      initList(MY_ID, 'MYCODE');
      followersCallback([
        { userId: 'u1', code: 'AAAA11' },
        { userId: 'u2', code: 'BBBB22' },
      ]);
      // Fire status for both users
      const u1cb = watchStatus.mock.calls.find(c => c[0] === 'u1')?.[1];
      const u2cb = watchStatus.mock.calls.find(c => c[0] === 'u2')?.[1];
      if (u1cb) u1cb({ statusColor: '#f59e0b' });
      if (u2cb) u2cb({ statusColor: '#3b82f6' });

      const li1 = document.querySelector('[data-user-id="u1"]');
      const li2 = document.querySelector('[data-user-id="u2"]');

      // Adopt u1
      li1.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50 }));
      jest.advanceTimersByTime(500);
      jest.clearAllMocks();

      // Now long-press u2 — should revert u1 first, then adopt u2
      li2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50 }));
      jest.advanceTimersByTime(500);

      // switchSet called (revert of u1) before setStatusColor for u2's color
      const { setStatusColor } = require('../js/db.js');
      const switchSetOrder = switchSet.mock.invocationCallOrder[0];
      const u2AdoptOrder = setStatusColor.mock.calls.findIndex(c => c[1] === '#3b82f6');
      const u2AdoptInvOrder = setStatusColor.mock.invocationCallOrder[u2AdoptOrder];
      expect(switchSetOrder).toBeLessThan(u2AdoptInvOrder);
      // And u2 was actually adopted
      expect(setStatusColor).toHaveBeenCalledWith(MY_ID, '#3b82f6');
    });

    test('target has no statusColor — CSS vars unchanged, setStatusColor not called', () => {
      const { setStatusColor } = require('../js/db.js');
      const li = setupForLongPress({ paletteKey: 'ember' }); // no statusColor
      press(li);
      jest.advanceTimersByTime(500);
      expect(setStatusColor).not.toHaveBeenCalled();
      expect(document.documentElement.style.getPropertyValue('--my-status')).toBe('#22c55e'); // unchanged
    });

    test('PALETTES_ENABLED false — no adoption on long press', () => {
      // Isolate this test: reset module registry, apply a PALETTES_ENABLED:false override,
      // then restore the original mock after the test. Use afterEach in a nested describe to
      // guarantee cleanup even if the test throws.
      jest.resetModules();
      jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: false, KNOCK_ENABLED: true, CALL_ENABLED: true }));
      const { initList: initList2 } = require('../js/following.js');
      setupDom();
      jest.useFakeTimers();
      let cb;
      const { watchFollowers: wf, watchStatus: ws } = require('../js/db.js');
      wf.mockImplementation((_uid, fn) => { cb = fn; return jest.fn(); });
      ws.mockReturnValue(jest.fn());
      const { getFollowing: gf } = require('../js/store.js');
      gf.mockReturnValue([{ userId: TARGET_ID, code: 'XY9K2M', label: 'Alice' }]);
      initList2(MY_ID, 'MYCODE');
      cb([{ userId: TARGET_ID, code: 'XY9K2M' }]);
      const li = document.querySelector(`[data-user-id="${TARGET_ID}"]`);
      press(li);
      jest.advanceTimersByTime(500);
      const { setStatusColor } = require('../js/db.js');
      expect(setStatusColor).not.toHaveBeenCalled();
      // Restore: reset registry and re-apply original PALETTES_ENABLED:true mock so later
      // tests using the module cache get the correct version.
      jest.resetModules();
      jest.mock('../js/features.js', () => ({ PALETTES_ENABLED: true, KNOCK_ENABLED: true, CALL_ENABLED: true }));
    });
  });
  ```

- [ ] **Step 2: Run long press tests to verify they fail**

  ```bash
  npx jest tests/following.test.js -t "long press handler" --no-coverage 2>&1 | tail -20
  ```

  Expected: most FAILs (handler not yet attached in `createFolloweeRow`).

- [ ] **Step 3: Attach long press handler in `createFolloweeRow`**

  In `js/following.js`, inside `createFolloweeRow`, after the `CALL_ENABLED` block (around line 404), add:

  ```js
  if (PALETTES_ENABLED) {
    let pressTimer = null;
    let pressStartX, pressStartY;

    li.addEventListener('pointerdown', (e) => {
      pressStartX = e.clientX;
      pressStartY = e.clientY;
      pressTimer = setTimeout(() => triggerAdoption(entry, myUserId), 500);
    });
    li.addEventListener('pointermove', (e) => {
      if (pressTimer && (Math.abs(e.clientX - pressStartX) > 8 ||
                         Math.abs(e.clientY - pressStartY) > 8)) {
        clearTimeout(pressTimer); pressTimer = null;
      }
    });
    ['pointerup', 'pointercancel'].forEach(ev =>
      li.addEventListener(ev, () => { clearTimeout(pressTimer); pressTimer = null; })
    );
  }
  ```

- [ ] **Step 4: Migrate `applyAdoption` and `revertAdoption` tests to use long press instead of `_testOnlyTriggerAdoption`**

  > **Important:** Migrate consumers BEFORE removing the export in Step 5.
  > Running after Step 3 ensures the long press handler is in place before this migration.

  The `applyAdoption` and `revertAdoption` describe blocks used `_testOnlyTriggerAdoption`. Replace each usage:

  **Pattern to replace:**

  ```js
  const { _testOnlyTriggerAdoption } = require('../js/following.js');
  _testOnlyTriggerAdoption({ userId: TARGET_ID }, MY_ID);
  ```

  **Replace with a helper that uses long press (add at top of the adoption section):**

  ```js
  function longPressCard(userId) {
    jest.useFakeTimers();
    const li = document.querySelector(`[data-user-id="${userId}"]`);
    li.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50 }));
    jest.advanceTimersByTime(500);
    jest.useRealTimers();
    return li;
  }
  ```

  Update every `applyAdoption` and `revertAdoption` test to call `longPressCard(TARGET_ID)` instead of `_testOnlyTriggerAdoption(...)`.

  > **Note:** The `triggerAdoptionFor` helper and `adoptThenRevert` helper in those describe blocks already call `setupMutualAndFireStatus`, so you only need to replace the `_testOnlyTriggerAdoption` lines with `longPressCard` calls.

- [ ] **Step 5: Remove `_testOnlyTriggerAdoption` from `following.js`**

  > **Only after Step 4 consumers are migrated and passing.** Delete the line:

  ```js
  export function _testOnlyTriggerAdoption(entry, myUserId) { triggerAdoption(entry, myUserId); }
  ```

  Also remove the destructured `_testOnlyTriggerAdoption` from the test file import line if present.

- [ ] **Step 6: Run long press tests to verify they pass**

  ```bash
  npx jest tests/following.test.js -t "long press handler" --no-coverage 2>&1 | tail -20
  ```

  Expected: all PASS.

- [ ] **Step 7: Run full test suite**

  ```bash
  npx jest tests/following.test.js --no-coverage 2>&1 | tail -10
  ```

  Expected: all passing, no regressions.

- [ ] **Step 8: Commit**

  ```bash
  git add js/following.js tests/following.test.js
  git commit -m "feat: attach long-press handler in createFolloweeRow; remove _testOnlyTriggerAdoption"
  ```

---

## Chunk 4: CSS visual indicator and final cleanup

### Task 5: Add `.adopted-from` CSS style

**Files:**

- Modify: `css/app.css`

- [ ] **Step 1: Locate the palette/knock/call CSS section**

  ```bash
  grep -n "knock-sender\|call-mode\|\.adopted" /Users/michael/Public/Code/pwa-status-app/css/app.css
  ```

  Add the `.adopted-from` style immediately after the `.call-mode` block.

- [ ] **Step 2: Add the style**

  In `css/app.css`, after the `.call-mode::after` block, add:

  ```css
  /* Long-press palette adoption indicator */
  .adopted-from {
    outline: 1.5px solid var(--my-status, #22c55e);
    outline-offset: -1.5px;
  }
  ```

  > This uses `--my-status` (the adopted color) as the outline color. `outline-offset: -1.5px`
  > draws the outline inside the card boundary. Omit `border-radius` — the `<li>`'s own
  > `border-radius` already applies to the outline natively in modern browsers.

- [ ] **Step 3: Run tests to confirm no breakage**

  ```bash
  npx jest tests/following.test.js --no-coverage 2>&1 | tail -10
  ```

  Expected: all passing (CSS is not tested by Jest).

- [ ] **Step 4: Commit**

  ```bash
  git add css/app.css
  git commit -m "feat: add .adopted-from CSS indicator for long-press palette adoption"
  ```

---

### Task 6: Worktree integration and branch finish

- [ ] **Step 1: Run full test suite one final time**

  ```bash
  npx jest --no-coverage 2>&1 | tail -15
  ```

  Expected: all tests passing (note: 4 pre-existing failures in `status.test.js` are acceptable — do not fix them here).

- [ ] **Step 2: Use superpowers:finishing-a-development-branch skill to decide how to integrate**

  Invoke: `superpowers:finishing-a-development-branch`
