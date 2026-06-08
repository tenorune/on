# User-Card Tool Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse a user card's right-side action buttons (unfollow + notification bell) behind a three-dot drawer when there are two or more, give the bell a new monochrome theme-shaded icon and a one-type direct-toggle mode, and make the open drawer suppress/defer card gestures and incoming knocks/calls.

**Architecture:** A new shared `js/cardDrawer.js` owns the `⋮` toggle, the slide-in slice, singleton open/close state, dismissal (outside-tap / Escape / scroll), and broadcasts `card-drawer-open`/`card-drawer-close` document events plus an `isCardDrawerOpen()` predicate. `following.js` builds its right-side actions as elements and routes them through the drawer when there are ≥2; its knock/call/long-press handlers consult `isCardDrawerOpen()`. Knock deferral reuses the existing "leave it in the DB, replay via `initKnocks`" path; call deferral suppresses the receiver call-mode branch in `updateFolloweeRow` while a drawer is open and reconciles from `lastUserData` on close. `notifyBell.js` swaps the emoji for an inline `currentColor` SVG and toggles directly when it has a single type.

**Tech Stack:** Vanilla ES modules, Jest + jsdom (CommonJS `require` in tests), esbuild dev-build, CSS custom properties.

---

### Task 1: Bell — inline monochrome SVG icon + one-type direct toggle

**Files:**
- Modify: `js/notifyBell.js`
- Test: `tests/notifyBell.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/notifyBell.test.js`:

```javascript
test('renders an inline svg glyph (not the emoji)', () => {
  const bell = createNotifyBell('alex', {});
  expect(bell.querySelector('svg')).not.toBeNull();
  expect(bell.textContent).not.toContain('\u{1F514}');
});

test('single-type bell toggles the pref directly without a popover', () => {
  const bell = createNotifyBell('alex', { types: ['availability'] });
  document.body.appendChild(bell);
  bell.click();
  expect(document.querySelector('.notify-popover')).toBeNull();
  expect(setNotifyPref).toHaveBeenCalledWith('alex', 'availability', true);
});

test('single-type bell turning on calls onNeedPermission', () => {
  const onNeedPermission = jest.fn();
  const bell = createNotifyBell('alex', { types: ['availability'], onNeedPermission });
  document.body.appendChild(bell);
  bell.click();
  expect(onNeedPermission).toHaveBeenCalled();
});

test('single-type bell turning OFF does not call onNeedPermission', () => {
  getNotifyPrefs.mockReturnValue({ knock: false, call: false, availability: true });
  const onNeedPermission = jest.fn();
  const bell = createNotifyBell('alex', { types: ['availability'], onNeedPermission });
  document.body.appendChild(bell);
  bell.click();
  expect(setNotifyPref).toHaveBeenCalledWith('alex', 'availability', false);
  expect(onNeedPermission).not.toHaveBeenCalled();
});

test('multi-type bell still opens the popover', () => {
  const bell = createNotifyBell('alex', { types: ['knock', 'availability'] });
  document.body.appendChild(bell);
  bell.click();
  expect(document.querySelector('.notify-popover')).not.toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/notifyBell.test.js`
Expected: FAIL — the new tests fail (emoji still present; single-type click opens a popover).

- [ ] **Step 3: Implement the icon swap + direct-toggle path**

In `js/notifyBell.js`, add the glyph constant near the top (after the `TYPES` array):

```javascript
const BELL_SVG = '<svg viewBox="0 0 122.88 122.83" fill="currentColor" aria-hidden="true" focusable="false"><path d="M73.81,7.47A43.14,43.14,0,0,1,92.69,19.35a42.33,42.33,0,0,1,10.76,21.36l0,.28c.21,1.21.36,2.36.45,3.44.11,1.26.17,2.53.17,3.8h0V58.36c0,2.81,0,5.67.2,8.54a32.41,32.41,0,0,0,4.34,14.62A36.6,36.6,0,0,0,120,92.83a6.34,6.34,0,0,1,2.65,3.65,6.52,6.52,0,0,1-.08,3.56,6.62,6.62,0,0,1-1.91,3,6.33,6.33,0,0,1-4.25,1.57H82.27l0,.08h0c-4.14,24.2-37.61,24.13-41.65-.08H6.45A6.33,6.33,0,0,1,2,102.92a6.6,6.6,0,0,1-1.81-6.5A6.33,6.33,0,0,1,3,92.71c5.66-3.83,9.62-8,12.12-12.76s3.65-10.44,3.65-17.28V48.23c0-1.16.06-2.42.18-3.77s.29-2.52.51-3.76A42.89,42.89,0,0,1,49.39,7.41C54-2.47,69.2-2.49,73.81,7.47ZM87.71,24A36.34,36.34,0,0,0,70.38,13.57,3.42,3.42,0,0,1,68,11.22c-1.71-5.87-11-6-12.72-.05a3.43,3.43,0,0,1-2.48,2.38A36.1,36.1,0,0,0,26.15,41.9q-.28,1.58-.42,3.15c-.09,1-.13,2-.13,3.18V62.67c0,7.91-1.38,14.56-4.45,20.43-2.94,5.62-7.36,10.39-13.54,14.72H115.27A42.38,42.38,0,0,1,102.8,85,39.18,39.18,0,0,1,97.5,67.4c-.22-2.88-.21-6-.2-9V48.23h0c0-1.1,0-2.17-.13-3.22s-.21-2-.36-2.85l-.06-.27a35.62,35.62,0,0,0-9-17.9Z"/></svg>';
```

Replace the emoji assignment (`bell.textContent = '\u{1F514}';`) with:

```javascript
  bell.innerHTML = BELL_SVG;
```

Then, inside the `bell.addEventListener('click', ...)` handler, add the single-type short-circuit as the very first thing after the stale-popover cleanup lines (right before `if (_openPopover && _openPopover.dataset.target === targetUid)`):

```javascript
    // Single-type bell: the bell IS the toggle — no popover.
    if (shown.length === 1) {
      const type = shown[0].type;
      const next = !(getNotifyPrefs(targetUid)[type]);
      setNotifyPref(targetUid, type, next);
      paintBell(bell, targetUid, typeKeys);
      if (next && typeof onNeedPermission === 'function') onNeedPermission();
      return;
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/notifyBell.test.js`
Expected: PASS — all bell tests green (existing multi-type tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add js/notifyBell.js tests/notifyBell.test.js
git commit -m "Bell: inline monochrome SVG icon + one-type direct toggle"
```

---

### Task 2: cardDrawer module — core open/close, singleton, events

**Files:**
- Create: `js/cardDrawer.js`
- Test: `tests/cardDrawer.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/cardDrawer.test.js`:

```javascript
// tests/cardDrawer.test.js
const { createCardDrawer, isCardDrawerOpen } = require('../js/cardDrawer.js');

function makeAction(label) {
  const b = document.createElement('button');
  b.textContent = label;
  b.className = `act-${label}`;
  return b;
}

beforeEach(() => { document.body.innerHTML = ''; });

test('createCardDrawer returns an ellipsis toggle button', () => {
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  expect(ellipsis.tagName).toBe('BUTTON');
  expect(ellipsis.classList.contains('card-drawer-toggle')).toBe(true);
  expect(ellipsis.textContent).toBe('⋮');
});

test('clicking the ellipsis opens a drawer slice containing the actions', () => {
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  document.body.appendChild(ellipsis);
  expect(isCardDrawerOpen()).toBe(false);
  ellipsis.click();
  const slice = document.querySelector('.card-drawer');
  expect(slice).not.toBeNull();
  expect(slice.querySelector('.act-a')).not.toBeNull();
  expect(slice.querySelector('.act-b')).not.toBeNull();
  expect(isCardDrawerOpen()).toBe(true);
});

test('clicking the ellipsis again closes the drawer', () => {
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  document.body.appendChild(ellipsis);
  ellipsis.click();
  ellipsis.click();
  expect(document.querySelector('.card-drawer')).toBeNull();
  expect(isCardDrawerOpen()).toBe(false);
});

test('opening a second drawer closes the first (singleton)', () => {
  const e1 = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  const e2 = createCardDrawer([{ el: makeAction('c') }, { el: makeAction('d') }]);
  document.body.append(e1, e2);
  e1.click();
  e2.click();
  expect(document.querySelectorAll('.card-drawer').length).toBe(1);
  expect(document.querySelector('.card-drawer .act-c')).not.toBeNull();
});

test('open dispatches card-drawer-open, close dispatches card-drawer-close', () => {
  const opened = jest.fn();
  const closed = jest.fn();
  document.addEventListener('card-drawer-open', opened);
  document.addEventListener('card-drawer-close', closed);
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  document.body.appendChild(ellipsis);
  ellipsis.click();
  expect(opened).toHaveBeenCalledTimes(1);
  ellipsis.click();
  expect(closed).toHaveBeenCalledTimes(1);
  document.removeEventListener('card-drawer-open', opened);
  document.removeEventListener('card-drawer-close', closed);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/cardDrawer.test.js`
Expected: FAIL with "Cannot find module '../js/cardDrawer.js'".

- [ ] **Step 3: Implement the core module**

Create `js/cardDrawer.js`:

```javascript
// js/cardDrawer.js
// Shared per-card tool drawer. Collapses a user card's right-side action
// buttons behind a vertical ellipsis; tapping opens a slide-in slice.
// Consumed by following.js (and later groupContext.js) when a card has >=2
// right-side actions. Singleton: only one drawer open at a time.

let _open = null; // { slice, ellipsis, cleanup } | null

export function isCardDrawerOpen() {
  return _open !== null;
}

export function closeCardDrawer() {
  if (!_open) return;
  const { slice, cleanup } = _open;
  cleanup();
  slice.remove();
  _open = null;
  document.dispatchEvent(new CustomEvent('card-drawer-close'));
}

function openDrawer(ellipsis, actions) {
  const slice = document.createElement('div');
  slice.className = 'card-drawer';
  // Isolate every interaction inside the slice from card-level gesture
  // handlers (knock/call/long-press live on the parent li).
  slice.addEventListener('click', (e) => e.stopPropagation());
  slice.addEventListener('pointerdown', (e) => e.stopPropagation());

  for (const { el, closesDrawer } of actions) {
    if (closesDrawer) el.addEventListener('click', () => closeCardDrawer());
    slice.appendChild(el);
  }

  ellipsis.insertAdjacentElement('afterend', slice);
  // Trigger the slide-in transition on the next frame.
  requestAnimationFrame(() => slice.classList.add('open'));

  _open = { slice, ellipsis, cleanup: () => {} };
  document.dispatchEvent(new CustomEvent('card-drawer-open'));
}

export function createCardDrawer(actions) {
  // actions: Array<{ el: HTMLElement, closesDrawer?: boolean }>
  const ellipsis = document.createElement('button');
  ellipsis.type = 'button';
  ellipsis.className = 'card-drawer-toggle';
  ellipsis.setAttribute('aria-label', 'More actions');
  ellipsis.textContent = '⋮'; // ⋮

  ellipsis.addEventListener('click', (e) => {
    e.stopPropagation();
    const isMine = _open && _open.ellipsis === ellipsis;
    closeCardDrawer();
    if (!isMine) openDrawer(ellipsis, actions);
  });

  return ellipsis;
}
```

Note: `requestAnimationFrame` is provided by jsdom as a no-op-ish shim; the tests assert structure/state, not the `open` class timing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/cardDrawer.test.js`
Expected: PASS — all 5 core tests green.

- [ ] **Step 5: Commit**

```bash
git add js/cardDrawer.js tests/cardDrawer.test.js
git commit -m "cardDrawer: core open/close, singleton, events"
```

---

### Task 3: cardDrawer dismissal — outside-tap, Escape, scroll, terminal action

**Files:**
- Modify: `js/cardDrawer.js`
- Test: `tests/cardDrawer.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/cardDrawer.test.js`:

```javascript
test('tapping outside the drawer closes it', () => {
  const outside = document.createElement('div');
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  document.body.append(ellipsis, outside);
  ellipsis.click();
  outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(isCardDrawerOpen()).toBe(false);
});

test('clicking inside the slice does NOT close the drawer', () => {
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  document.body.appendChild(ellipsis);
  ellipsis.click();
  document.querySelector('.act-a').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(isCardDrawerOpen()).toBe(true);
});

test('a closesDrawer action closes the drawer when tapped', () => {
  const ellipsis = createCardDrawer([
    { el: makeAction('a') },
    { el: makeAction('b'), closesDrawer: true },
  ]);
  document.body.appendChild(ellipsis);
  ellipsis.click();
  document.querySelector('.act-b').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(isCardDrawerOpen()).toBe(false);
});

test('Escape closes the drawer', () => {
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  document.body.appendChild(ellipsis);
  ellipsis.click();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(isCardDrawerOpen()).toBe(false);
});

test('scrolling closes the drawer', () => {
  const ellipsis = createCardDrawer([{ el: makeAction('a') }, { el: makeAction('b') }]);
  document.body.appendChild(ellipsis);
  ellipsis.click();
  document.dispatchEvent(new Event('scroll'));
  expect(isCardDrawerOpen()).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/cardDrawer.test.js`
Expected: FAIL — outside-tap / Escape / scroll do not yet close the drawer.

- [ ] **Step 3: Implement dismissal handlers**

In `js/cardDrawer.js`, replace the body of `openDrawer` (from the `_open = ...` line onward) so it wires and stores teardown handlers. Replace:

```javascript
  _open = { slice, ellipsis, cleanup: () => {} };
  document.dispatchEvent(new CustomEvent('card-drawer-open'));
```

with:

```javascript
  const onOutside = (e) => {
    if (slice.contains(e.target) || ellipsis.contains(e.target)) return;
    closeCardDrawer();
  };
  const onKey = (e) => { if (e.key === 'Escape') closeCardDrawer(); };
  const onScroll = () => closeCardDrawer();

  const cleanup = () => {
    document.removeEventListener('click', onOutside, true);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('scroll', onScroll, true);
  };

  _open = { slice, ellipsis, cleanup };
  document.dispatchEvent(new CustomEvent('card-drawer-open'));

  // Register after dispatch + on the capture phase so the opening click that
  // bubbled to document does not immediately re-close it.
  document.addEventListener('click', onOutside, true);
  document.addEventListener('keydown', onKey);
  document.addEventListener('scroll', onScroll, true);
```

Note: the opening click calls `e.stopPropagation()` on the ellipsis, so it never reaches the capture-phase `onOutside` on `document` from a real bubble — but registering the listeners *after* the synchronous open also guarantees the same click can't trip them. `scroll` is captured (`true`) because scroll events do not bubble.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/cardDrawer.test.js`
Expected: PASS — all dismissal tests green.

- [ ] **Step 5: Commit**

```bash
git add js/cardDrawer.js tests/cardDrawer.test.js
git commit -m "cardDrawer: outside-tap, Escape, scroll, terminal-action dismissal"
```

---

### Task 4: Bell popover closes when any drawer closes

**Files:**
- Modify: `js/notifyBell.js`
- Test: `tests/notifyBell.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/notifyBell.test.js`:

```javascript
test('open popover closes when a card-drawer-close event fires', () => {
  const bell = createNotifyBell('alex', { types: ['knock', 'availability'] });
  document.body.appendChild(bell);
  bell.click();
  expect(document.querySelector('.notify-popover')).not.toBeNull();
  document.dispatchEvent(new CustomEvent('card-drawer-close'));
  expect(document.querySelector('.notify-popover')).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/notifyBell.test.js -t "card-drawer-close"`
Expected: FAIL — popover remains in the DOM after the event.

- [ ] **Step 3: Implement the listener**

In `js/notifyBell.js`, add this once at module scope (just after the `_openPopover` / `_outsideHandler` declarations near the top):

```javascript
// When the surrounding card drawer closes (Escape/scroll/outside-tap), tear
// down any popover we opened inside it so module state doesn't go stale.
document.addEventListener('card-drawer-close', () => closeOpenPopover());
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/notifyBell.test.js`
Expected: PASS — full bell suite green.

- [ ] **Step 5: Commit**

```bash
git add js/notifyBell.js tests/notifyBell.test.js
git commit -m "Bell: close popover on card-drawer-close"
```

---

### Task 5: Wire the drawer into following.js cards

**Files:**
- Modify: `js/following.js:439-583` (`createFolloweeRow`)
- Test: `tests/following.test.js`

The current `createFolloweeRow` puts `<button class="unfollow-btn">` in the row's
`innerHTML` and appends the bell at the end. We change it to build the unfollow
button and bell as elements, then: if there are ≥2 right-side actions, route them
through `createCardDrawer` and append the `⋮`; otherwise append the single action
inline. Follower rows (`createFollowerOnlyRow`) are unchanged — one action.

- [ ] **Step 1: Write the failing tests**

Add a new suite to `tests/following.test.js` (near the existing "notification bell on contact rows" suite). It mounts a mutual row and asserts drawer behavior. Reuse the file's existing `createNotifyBell` mock (returns a `.notify-bell` button).

```javascript
describe('tool drawer on contact rows', () => {
  function mountMutual(userId = 'alex') {
    setupDom();
    jest.clearAllMocks();
    createNotifyBell.mockImplementation(() => {
      const b = document.createElement('button');
      b.className = 'notify-bell';
      return b;
    });
    getFollowing.mockReturnValue([{ userId, code: 'ABC123', label: 'Alice' }]);
    watchStatus.mockReturnValue(jest.fn());
    watchFollowers.mockImplementation((_uid, cb) => { cb([{ userId, code: 'ABC123' }]); return jest.fn(); });
    initList('myUid', 'MYCODE');
    return document.querySelector(`[data-user-id="${userId}"]`);
  }

  test('mutual row shows a drawer toggle, not inline unfollow/bell', () => {
    const li = mountMutual();
    expect(li.querySelector('.card-drawer-toggle')).not.toBeNull();
    expect(li.querySelector('.unfollow-btn')).toBeNull();
    expect(li.querySelector('.notify-bell')).toBeNull();
  });

  test('opening the drawer reveals unfollow and bell', () => {
    const li = mountMutual();
    li.querySelector('.card-drawer-toggle').click();
    expect(li.querySelector('.card-drawer .unfollow-btn')).not.toBeNull();
    expect(li.querySelector('.card-drawer .notify-bell')).not.toBeNull();
  });

  test('tapping unfollow inside the drawer opens the confirm dialog', () => {
    const li = mountMutual();
    li.querySelector('.card-drawer-toggle').click();
    li.querySelector('.unfollow-btn').click();
    expect(document.querySelector('.confirm-overlay')).not.toBeNull();
  });
});
```

Also update the existing confirm-dialog and knock-skip tests that call
`li.querySelector('.unfollow-btn').click()` directly — the unfollow button now
lives inside the drawer. In `describe('confirm dialog', ...)` (around lines
383-418) and the knock suite's `'tapping unfollow-btn skips knock'` test (around
line 731), insert a drawer-open before the unfollow click:

```javascript
    li.querySelector('.card-drawer-toggle').click();
    li.querySelector('.unfollow-btn').click();
```

For `'tapping unfollow-btn skips knock'`, the assertion premise changes (knock is
globally gated while the drawer is open — see Task 6). Replace that test body with:

```javascript
  test('tapping unfollow inside the drawer does not knock', () => {
    const li = setupMutualWithKnock();
    sendKnock.mockClear();
    li.querySelector('.card-drawer-toggle').click();
    li.querySelector('.unfollow-btn').click();
    expect(sendKnock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/following.test.js -t "tool drawer"`
Expected: FAIL — no `.card-drawer-toggle` exists yet.

- [ ] **Step 3: Implement the drawer wiring in `createFolloweeRow`**

In `js/following.js`, add the import at the top with the other imports:

```javascript
import { createCardDrawer, isCardDrawerOpen } from './cardDrawer.js';
```

In `createFolloweeRow`, remove the `<button class="unfollow-btn">` from the
`li.innerHTML` template (the last line of the template string) so the row body is
just the dot + info:

```javascript
  li.innerHTML = `
    <div class="person-dot"></div>
    <div class="person-info">
      ${nameHtml}
      <div class="person-status">Unavailable</div>
    </div>`;
```

Then build the unfollow button as an element. Replace the existing
`li.querySelector('.unfollow-btn').addEventListener(...)` block with construction:

```javascript
  const displayName = entry.label || entry.code;
  const unfollowBtn = document.createElement('button');
  unfollowBtn.className = 'unfollow-btn';
  unfollowBtn.title = 'Unfollow';
  unfollowBtn.textContent = '×'; // ×
  unfollowBtn.addEventListener('click', () => {
    showConfirm(`Unfollow ${displayName}?`, 'Unfollow', {
      type: 'unfollow',
      userId: entry.userId,
      myUserId,
    });
  });
```

Replace the `NOTIFICATIONS_ENABLED` block at the end of the function (currently
lines ~572-580 that build + append the bell) and the old standalone unfollow
append with a single right-side-actions assembly placed at the end of the
function, just before `document.getElementById('people-list').appendChild(li);`:

```javascript
  // Assemble right-side actions. >=2 -> collapse behind a tool drawer; exactly
  // one -> inline. Bell is non-terminal (keeps the drawer open); unfollow is
  // terminal (closes it, then the confirm overlay covers the card).
  const actions = [];
  if (NOTIFICATIONS_ENABLED) {
    const bell = createNotifyBell(entry.userId, {
      types: isMutual ? ['knock', 'call', 'availability'] : ['availability'],
      onNeedPermission: () => { ensureNotificationsReady().catch(() => {}); },
    });
    actions.push({ el: bell, closesDrawer: false });
  }
  actions.push({ el: unfollowBtn, closesDrawer: true });

  if (actions.length >= 2) {
    li.appendChild(createCardDrawer(actions));
  } else {
    li.appendChild(actions[0].el);
  }
```

Finally, in the knock click handler (lines ~469-478) the code references
`unfollowBtnEl = li.querySelector('.unfollow-btn')`, which is now null at setup
(the button lives in the drawer, built on open). Remove that lookup and its
guard line; the drawer's `stopPropagation` plus the Task-6 gate handle it.
Change the handler to:

```javascript
  if (KNOCK_ENABLED && isMutual) {
    const labelEl = li.querySelector('.person-label');
    li.addEventListener('click', (e) => {
      if (isCardDrawerOpen()) return;
      if (labelEl.contains(e.target)) return;
      const statusColor = lastUserData.get(entry.userId)?.statusColor;
      sendKnock(entry.userId, myUserId, statusColor);
    });
  }
```

(The `isCardDrawerOpen()` guard added here is also Task 6 step 3 for the knock
gesture; keep it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/following.test.js`
Expected: PASS — the drawer suite passes and the updated confirm/knock tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/following.js tests/following.test.js
git commit -m "following: collapse right-side card actions into a tool drawer"
```

---

### Task 6: Global gesture gate (call swipe + long-press)

**Files:**
- Modify: `js/following.js` (swipe `pointerdown` ~483, long-press `pointerdown` ~548)
- Test: `tests/following.test.js`

The knock tap was already gated in Task 5. Here we gate the call-swipe and the
long-press palette-adoption gestures so an open drawer suppresses them globally.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('tool drawer on contact rows', ...)` suite in
`tests/following.test.js`:

```javascript
  test('call swipe is suppressed while a drawer is open', () => {
    const { setCallState } = require('../js/db.js');
    const li = mountMutual();
    li.querySelector('.card-drawer-toggle').click(); // open drawer
    setCallState.mockClear();
    const w = 300;
    jest.spyOn(li, 'getBoundingClientRect').mockReturnValue({ width: w });
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, pointerId: 1, bubbles: true }));
    li.dispatchEvent(new PointerEvent('pointermove', { clientX: w, clientY: 0, pointerId: 1, bubbles: true }));
    expect(li.classList.contains('call-mode')).toBe(false);
  });

  test('long-press adoption is suppressed while a drawer is open', () => {
    jest.useFakeTimers();
    const li = mountMutual();
    li.querySelector('.card-drawer-toggle').click(); // open drawer
    li.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, pointerId: 1, bubbles: true }));
    jest.advanceTimersByTime(600);
    // triggerAdoption calls getPaletteByKey; if suppressed it is never reached.
    expect(li.classList.contains('adopting')).toBe(false);
    jest.useRealTimers();
  });
```

(The long-press assertion is intentionally light — the key behavior is "no
adoption side-effects"; `adopting` is never added when the timer body is gated.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/following.test.js -t "suppressed while a drawer is open"`
Expected: FAIL — swipe enters call-mode and the long-press timer fires.

- [ ] **Step 3: Add the gate to both gestures**

In the call-swipe `pointerdown` handler (inside `if (CALL_ENABLED && isMutual)`),
add as the first line of the `pointerdown` listener:

```javascript
    li.addEventListener('pointerdown', (e) => {
      if (isCardDrawerOpen()) return;
      if (e.target.closest('.unfollow-btn, .person-label')) return;
      // ...existing body...
```

In the long-press `pointerdown` handler (inside
`if (PALETTES_ENABLED && PALETTE_INTERACTIONS_ENABLED)`), add as the first line:

```javascript
    li.addEventListener('pointerdown', (e) => {
      if (isCardDrawerOpen()) return;
      clearTimeout(pressTimer); pressTimer = null;
      // ...existing body...
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/following.test.js`
Expected: PASS — gestures suppressed while a drawer is open; full file green.

- [ ] **Step 5: Commit**

```bash
git add js/following.js tests/following.test.js
git commit -m "following: suppress card gestures globally while a drawer is open"
```

---

### Task 7: Defer incoming knocks while a drawer is open

**Files:**
- Modify: `js/knock.js`
- Test: `tests/knock.test.js`

Reuse the existing deferral machinery: the live knock handler already bails (and
leaves the knock in the DB) when the tab is hidden or canvas is active. Add the
same bail for "a card drawer is open", and replay via `initKnocks` on close.

- [ ] **Step 1: Write the failing test**

First inspect `tests/knock.test.js` for its mock of `./db.js` and the helper that
fires the `watchKnocksAdded` callback. Add a test mirroring the existing
visibility-gating test, but driven by an open drawer. Add `jest.mock('../js/cardDrawer.js', ...)`
at the top of the file alongside the other mocks:

```javascript
jest.mock('../js/cardDrawer.js', () => ({ isCardDrawerOpen: jest.fn(() => false) }));
```

Then add the test (place it with the other live-listener tests; reuse the file's
existing setup helpers — adapt names to match what the file already uses to fire
a live knock and to mount a target `li`):

```javascript
test('a live knock is ignored (left in DB) while a card drawer is open', async () => {
  const { isCardDrawerOpen } = require('../js/cardDrawer.js');
  isCardDrawerOpen.mockReturnValue(true);
  const { clearKnock } = require('../js/db.js');
  // ... mount a visible Direct target li for 'alex' and start initKnocks ...
  // ... fire a live knock from 'alex' via the captured watchKnocksAdded cb ...
  // Assert: no flash class applied and the knock is NOT cleared from the DB.
  expect(document.querySelector('[data-user-id="alex"]').classList.contains('knock-live')).toBe(false);
  expect(clearKnock).not.toHaveBeenCalled();
});
```

(Match the surrounding tests' exact mounting/firing pattern; the assertions above
are the contract.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/knock.test.js -t "while a card drawer is open"`
Expected: FAIL — knock animates and is cleared.

- [ ] **Step 3: Implement the guard + replay**

In `js/knock.js`, add the import at the top:

```javascript
import { isCardDrawerOpen } from './cardDrawer.js';
```

In the live `watchKnocksAdded` handler, add the bail next to the existing
visibility/canvas guards (right after the
`if (document.visibilityState !== 'visible') return;` line):

```javascript
    // A tool drawer is open — defer like the backgrounded case: leave the knock
    // in the DB so the card-drawer-close replay (initKnocks) shows it.
    if (isCardDrawerOpen()) return;
```

At the bottom of the file, next to the `visibilitychange` / `canvas-exited`
listeners, add:

```javascript
document.addEventListener('card-drawer-close', () => {
  if (cachedUserId) initKnocks(cachedUserId);
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/knock.test.js`
Expected: PASS — the new test passes; existing knock tests stay green.

- [ ] **Step 5: Commit**

```bash
git add js/knock.js tests/knock.test.js
git commit -m "knock: defer incoming knocks while a drawer is open, replay on close"
```

---

### Task 8: Defer incoming calls; reconcile from live state on close

**Files:**
- Modify: `js/following.js` (`updateFolloweeRow` receiver branch ~713; add close listener)
- Test: `tests/following.test.js`

While a drawer is open, suppress the *receiver*-side call-mode in
`updateFolloweeRow` (glow + "Calling you…" text). On `card-drawer-close`, re-run
`updateFolloweeRow` for every rendered followee from `lastUserData`, so a call
cancelled during the open window never appears and a still-live one does. The
caller-side (`isCallee`) branch is never suppressed.

- [ ] **Step 1: Write the failing tests**

Add to `tests/following.test.js`. Reuse the existing call-mode receiver suite's
setup style (search for `isCallModeReceiver` / `callState` usage around the
"call mode: receiver-side glow via updateFolloweeRow" suite, ~line 801, and
mirror its mocks and `updateFolloweeRow` invocation):

```javascript
describe('call deferral while a drawer is open', () => {
  // mountMutual() + helper to call updateFolloweeRow with an incoming call.
  // Reuse the receiver-glow suite's pattern for entry/userData shape.

  test('incoming call does not enter call-mode while a drawer is open', () => {
    const li = /* mount mutual 'alex' and open its drawer */;
    updateFolloweeRow(
      { userId: 'alex', code: 'ABC123', label: 'Alice' },
      { status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#22c55e',
        callState: { calleeId: 'myUid' } },
      'myUid',
    );
    expect(li.classList.contains('call-mode')).toBe(false);
  });

  test('closing the drawer applies a still-live call', () => {
    const li = /* mount mutual 'alex', open drawer, deliver the same incoming call */;
    // lastUserData now holds the live call; close the drawer:
    document.dispatchEvent(new CustomEvent('card-drawer-close'));
    expect(li.classList.contains('call-mode')).toBe(true);
  });

  test('a call cancelled during the open window is not replayed on close', () => {
    const li = /* mount mutual 'alex', open drawer, deliver incoming call */;
    // Deliver the cancellation (callState removed) while still open:
    updateFolloweeRow(
      { userId: 'alex', code: 'ABC123', label: 'Alice' },
      { status: 'available', availableUntil: Date.now() + 3600000, statusColor: '#22c55e' },
      'myUid',
    );
    document.dispatchEvent(new CustomEvent('card-drawer-close'));
    expect(li.classList.contains('call-mode')).toBe(false);
  });
});
```

(The note placeholders `/* ... */` are setup you copy from the receiver-glow
suite; the assertions are the contract. `updateFolloweeRow` is already exported
and `lastUserData` is populated by `subscribeToFollowee` — to keep these unit
tests self-contained, deliver the call by calling `updateFolloweeRow` directly,
and stash the same `userData` into the reconcile path by having the close
listener read `lastUserData`; see Step 3 — for the test, set the data via the
real subscription helper if reachable, otherwise assert against the close
listener reading the most recent `updateFolloweeRow` argument cache added in
Step 3.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/following.test.js -t "call deferral while a drawer is open"`
Expected: FAIL — the call enters call-mode immediately; close does nothing.

- [ ] **Step 3: Implement suppression + reconcile**

In `js/following.js`, in `updateFolloweeRow`, change the receiver detection so an
open drawer makes it false (the caller side `isCallee` is untouched):

```javascript
  const isCallee = CALL_ENABLED && callModeCalleeId !== null && entry.userId === callModeCalleeId;
  const isCallModeReceiver = CALL_ENABLED && !isCallee
    && userData.callState?.calleeId === myUserId
    && !isCardDrawerOpen();
```

Add a one-line cache of the latest row data keyed by userId so the reconcile pass
has fresh state even in unit tests that call `updateFolloweeRow` directly. Near
the top of `updateFolloweeRow`, right after the `const li = ...; if (!li) return;`
lines, add:

```javascript
  lastUserData.set(entry.userId, userData);
```

(`subscribeToFollowee` already does this; setting it here too is idempotent and
makes the direct-call path reconcile correctly.)

Register the reconcile listener once, at module scope (e.g. just below the
`updateFolloweeRow` definition or with the other module-level wiring):

```javascript
// On drawer close, reconcile any deferred receiver-side call-mode against the
// latest known state for every rendered followee. A call cancelled while the
// drawer was open simply isn't in lastUserData anymore, so it won't replay.
document.addEventListener('card-drawer-close', () => {
  renderedFollowees.forEach((userId) => {
    const data = lastUserData.get(userId);
    if (!data) return;
    const entry = getFollowing().find((f) => f.userId === userId);
    if (entry) updateFolloweeRow(entry, data, myUserIdRef);
  });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/following.test.js`
Expected: PASS — call deferral suite green; full file green.

- [ ] **Step 5: Commit**

```bash
git add js/following.js tests/following.test.js
git commit -m "following: defer incoming calls while a drawer is open, reconcile on close"
```

---

### Task 9: CSS — drawer slice, slide animation, ellipsis, bell glyph, popover

**Files:**
- Modify: `css/app.css`
- Modify: `sw.js` (cache bump)

No unit test (pure styling). Verified by the dev build + the manual checklist.

- [ ] **Step 1: Make the card a positioning context and style the ellipsis**

In `css/app.css`, ensure followee rows are relatively positioned (find the
`#people-list li` / person-row rule; if it lacks `position`, add
`position: relative;`). Add new rules near the existing `.notify-bell` block
(~line 1117):

```css
/* Card tool drawer */
.card-drawer-toggle {
  background: none; border: 0; cursor: pointer;
  color: var(--text-muted); font-size: 1.2rem; line-height: 1;
  padding: 2px 8px; flex-shrink: 0; align-self: center;
}
.card-drawer {
  position: absolute; top: 0; right: 0; bottom: 0;
  display: flex; align-items: center; gap: 0.25rem;
  padding: 0 0.5rem; background: var(--surface2);
  border-radius: 0 0.5rem 0.5rem 0;
  transform: translateX(100%); transition: transform 0.18s ease-out;
  z-index: 40;
}
.card-drawer.open { transform: translateX(0); }
```

- [ ] **Step 2: Size the monochrome bell glyph + theme it like the ×**

Update the existing `.notify-bell` rule so the inline SVG inherits the muted
theme color (matching `.unfollow-btn`). Replace the `.notify-bell` /
`.notify-bell.active` rules (~lines 1117-1118) with:

```css
.notify-bell { background: none; border: 0; cursor: pointer; color: var(--text-muted); opacity: 0.45; padding: 0.25rem; display: inline-flex; align-items: center; }
.notify-bell.active { opacity: 1; }
.notify-bell svg { width: 1rem; height: 1rem; display: block; }
```

- [ ] **Step 3: Position the bell popover under the drawer, right-aligned**

Add after the `.notify-popover` rule (~line 1119): when a popover is rendered
inside a drawer, anchor it beneath the slice, right-aligned.

```css
.card-drawer .notify-popover { position: absolute; top: 100%; right: 0; margin-top: 0.25rem; }
```

- [ ] **Step 4: Bump the service worker cache (shell assets changed)**

In `sw.js`, change `const CACHE = 'knockknock-v7';` to `'knockknock-v8'`.

- [ ] **Step 5: Build and eyeball the output**

Run: `node scripts/dev-build.js`
Expected: `Build complete: dist/bundle.js + index.html`. No errors.

- [ ] **Step 6: Commit**

```bash
git add css/app.css sw.js
git commit -m "css: tool drawer slice + slide, monochrome themed bell, popover-under-drawer; bump SW cache"
```

---

### Task 10: Full suite + manual verification checklist

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npx jest`
Expected: all suites pass (the prior baseline was 27 suites; this adds
`cardDrawer.test.js` → 28). Zero failures.

- [ ] **Step 2: Build**

Run: `node scripts/dev-build.js`
Expected: clean build.

- [ ] **Step 3: Manual checklist (record results in the PR/notes)**

Mutual card:
- [ ] Shows a `⋮`, no inline unfollow/bell.
- [ ] Tap `⋮` → drawer slides in from the right showing bell + unfollow.
- [ ] Bell shows the new monochrome glyph, colored like the `×`, across two
      different palettes (e.g. forest vs ember).
- [ ] Tap bell → 3-switch popover opens under the drawer, right-aligned; drawer
      stays open. Tap outside popover (inside drawer) → popover closes, drawer
      stays. Tap outside drawer → both close.
- [ ] While drawer open: tapping the card does not knock; right-swipe does not
      call; long-press does not adopt.
- [ ] Tap unfollow → drawer closes and the confirm dialog appears.
- [ ] Escape closes the drawer; scrolling the list closes the drawer.

Following-only card:
- [ ] Shows a `⋮`; drawer reveals unfollow + a single bell that toggles
      Availability directly (no popover); drawer stays open on toggle.

Follower card:
- [ ] No `⋮` — just the inline remove `×` (unchanged).

Deferral:
- [ ] Open a drawer, have another device knock → no flash while open; on close
      the knock replays.
- [ ] Open a drawer, have another device start a call → no glow while open; on
      close, glow appears if still ringing, nothing if they hung up.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin card-tool-drawer
```

---

## Notes for the implementer

- **Group rosters** (`js/groupContext.js`) intentionally get **no** drawer in this
  plan: each group card has a single right-side action (the bell), so the ≥2
  threshold leaves it inline. No code change there. The drawer is built reusable
  so a future second action triggers it automatically.
- **Feature-flag-off path:** if `NOTIFICATIONS_ENABLED` is false, a followee row
  has only the unfollow action (1) → inline, no drawer. The `actions.length >= 2`
  check handles this without special-casing.
- The confirm overlay is full-screen (`position: fixed; inset: 0`), so the order
  of "drawer closes" vs "confirm appears" on an unfollow tap is visually
  irrelevant.
