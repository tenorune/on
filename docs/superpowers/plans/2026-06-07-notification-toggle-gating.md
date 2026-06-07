# Relationship-Gated Notification Toggles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only the notification toggles that can actually fire for a contact — `createNotifyBell` takes a `types` list, and each call site passes the relationship-appropriate set.

**Architecture:** `js/notifyBell.js` gains a `types` parameter (defaults to all three for back-compat) and renders/active-counts only those switches. `js/following.js` passes `['knock','call','availability']` for mutuals and `['availability']` for non-mutual "Following" rows (Followers already get no bell — separate `createFollowerOnlyRow`). `js/groupContext.js` passes `['knock','availability']` (no Call in groups).

**Tech Stack:** Vanilla ES modules, Jest + jsdom.

**Spec:** `docs/superpowers/specs/2026-06-07-notification-toggle-gating-design.md`.

---

## File structure
- **Modify:** `js/notifyBell.js` — `types` param on `createNotifyBell`; `paintBell` counts only visible types.
- **Modify:** `js/following.js` — pass `types` based on `isMutual` in `createFolloweeRow`.
- **Modify:** `js/groupContext.js` — pass `types: ['knock','availability']`.
- **Test:** `tests/notifyBell.test.js`, `tests/following.test.js`, `tests/groupContext.test.js`.

---

## Task 1: `types` parameter on `createNotifyBell`

**Files:**
- Modify: `js/notifyBell.js`
- Test: `tests/notifyBell.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `tests/notifyBell.test.js` (it already mocks `../js/prefs.js` with `getNotifyPrefs`/`setNotifyPref`):

```js
test('renders only the switches in the types list', () => {
  const bell = createNotifyBell('alex', { types: ['availability'] });
  document.body.appendChild(bell);
  bell.click();
  const switches = [...document.querySelectorAll('.notify-switch')].map((s) => s.dataset.type);
  expect(switches).toEqual(['availability']);
});

test('defaults to all three types when types omitted', () => {
  const bell = createNotifyBell('alex', {});
  document.body.appendChild(bell);
  bell.click();
  const switches = [...document.querySelectorAll('.notify-switch')].map((s) => s.dataset.type);
  expect(switches).toEqual(['knock', 'call', 'availability']);
});

test('active-state counts only visible types', () => {
  // knock pref is on, but only availability is shown → bell not active
  getNotifyPrefs.mockReturnValue({ knock: true, call: false, availability: false });
  const bell = createNotifyBell('alex', { types: ['availability'] });
  expect(bell.classList.contains('active')).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/notifyBell.test.js -t "types"`
Expected: FAIL — the first test gets all three switches (types param ignored), the active-state test sees `active` true.

- [ ] **Step 3: Implement in `js/notifyBell.js`**

Change `paintBell` to count a passed list, and `createNotifyBell` to filter by `types`:

```js
function paintBell(bell, targetUid, typeKeys) {
  const p = getNotifyPrefs(targetUid);
  bell.classList.toggle('active', typeKeys.some((t) => p[t]));
}

export function createNotifyBell(targetUid, { types, onNeedPermission } = {}) {
  const shown = (types && types.length) ? TYPES.filter((t) => types.includes(t.type)) : TYPES;
  const typeKeys = shown.map((t) => t.type);

  const bell = document.createElement('button');
  bell.className = 'notify-bell';
  bell.type = 'button';
  bell.setAttribute('aria-label', 'Notification settings');
  bell.textContent = '\u{1F514}'; // 🔔
  paintBell(bell, targetUid, typeKeys);

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_openPopover && !document.contains(_openPopover)) { _openPopover = null; }
    if (_openPopover && _openPopover.dataset.target === targetUid) { closeOpenPopover(); return; }
    closeOpenPopover();

    const popover = document.createElement('div');
    popover.className = 'notify-popover';
    popover.dataset.target = targetUid;
    const prefs = getNotifyPrefs(targetUid);
    for (const { type, label } of shown) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'notify-switch';
      row.setAttribute('role', 'switch');
      row.setAttribute('aria-checked', String(prefs[type]));
      row.dataset.type = type;
      row.textContent = label;
      row.classList.toggle('on', prefs[type]);
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const next = !(getNotifyPrefs(targetUid)[type]);
        setNotifyPref(targetUid, type, next);
        row.setAttribute('aria-checked', String(next));
        row.classList.toggle('on', next);
        paintBell(bell, targetUid, typeKeys);
        if (next && typeof onNeedPermission === 'function') onNeedPermission();
      });
      popover.appendChild(row);
    }
    bell.insertAdjacentElement('afterend', popover);
    _openPopover = popover;

    _outsideHandler = (ev) => {
      if (popover.contains(ev.target) || bell.contains(ev.target)) return;
      closeOpenPopover();
    };
    document.addEventListener('click', _outsideHandler);
  });

  document.addEventListener('notify-prefs-synced', () => paintBell(bell, targetUid, typeKeys));
  return bell;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/notifyBell.test.js`
Expected: PASS (whole file — new tests + the existing ones; the existing "three switches" / "active when any pref on" tests still pass via the default-all-types path).

- [ ] **Step 5: Commit**

```bash
git add js/notifyBell.js tests/notifyBell.test.js
git commit -m "feat(notifyBell): types param — render only the given toggle set"
```

---

## Task 2: Gate the Direct bell by mutual status

**Files:**
- Modify: `js/following.js` (the `createNotifyBell` call in `createFolloweeRow`, ~line 573)
- Test: `tests/following.test.js`

- [ ] **Step 1: Write the failing test**

`tests/following.test.js` already mocks `../js/notifyBell.js`. Update the assertion(s) to check `types`, and add a non-mutual case. Use the suite's existing render flow (the helper that fires `watchFollowers` and drives `renderList`); a **mutual** = a contact present in *both* the following list and the followers snapshot, a **Following-only** = in the following list but *not* in followers.

```js
const { createNotifyBell } = require('../js/notifyBell.js');

test('mutual contact gets a bell with all three types', () => {
  // render a mutual row (uid in both following + followers) via the suite's flow
  renderMutualRowForTest({ userId: 'alex', code: 'alex-code', label: 'Alex K.' });
  expect(createNotifyBell).toHaveBeenCalledWith('alex',
    expect.objectContaining({ types: ['knock', 'call', 'availability'] }));
});

test('non-mutual Following contact gets availability-only', () => {
  // render a following-only row (uid in following, NOT in followers)
  renderFollowingOnlyRowForTest({ userId: 'bea', code: 'bea-code', label: 'Bea' });
  expect(createNotifyBell).toHaveBeenCalledWith('bea',
    expect.objectContaining({ types: ['availability'] }));
});
```

> `renderMutualRowForTest` / `renderFollowingOnlyRowForTest` are placeholders for the suite's real render entry points — reuse the existing flow (the mutual-row test from the notifications work already exists; add the following-only variant by seeding the following list with a uid absent from the followers snapshot).

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/following.test.js -t "types\|availability-only"`
Expected: FAIL — the call currently passes only `{ onNeedPermission }` (no `types`).

- [ ] **Step 3: Implement in `js/following.js`**

In `createFolloweeRow`, change the bell creation (currently `createNotifyBell(entry.userId, { onNeedPermission: ... })`) to pass `types` derived from `isMutual`:

```js
  if (NOTIFICATIONS_ENABLED) {
    const bell = createNotifyBell(entry.userId, {
      types: isMutual ? ['knock', 'call', 'availability'] : ['availability'],
      onNeedPermission: () => { ensureNotificationsReady().catch(() => {}); },
    });
    li.appendChild(bell);
  }
```

(`createFolloweeRow` serves Mutuals with `isMutual=true` and Following with `isMutual=false`; Followers use `createFollowerOnlyRow`, which has no bell — no change needed there.)

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/following.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/following.js tests/following.test.js
git commit -m "feat(following): bell shows knock/call only for mutuals, availability for following"
```

---

## Task 3: Group roster bell — knock + availability (no call)

**Files:**
- Modify: `js/groupContext.js` (the `createNotifyBell` call in `renderRoster`, ~line 149)
- Test: `tests/groupContext.test.js`

- [ ] **Step 1: Write the failing test**

`tests/groupContext.test.js` already mocks `../js/notifyBell.js`. Add/adjust an assertion on the roster member's bell types (reuse the suite's roster render flow):

```js
const { createNotifyBell } = require('../js/notifyBell.js');

test('group roster bell offers knock + availability (no call)', () => {
  renderRosterForTest({ bea: { displayName: 'Bea' } }); // suite's existing roster render flow
  expect(createNotifyBell).toHaveBeenCalledWith('bea',
    expect.objectContaining({ types: ['knock', 'availability'] }));
});
```

> `renderRosterForTest` is a placeholder for the suite's real roster render entry point — reuse the existing one (the group-roster bell test from the notifications work already drives it).

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/groupContext.test.js -t "knock + availability"`
Expected: FAIL — the call currently passes only `{ onNeedPermission }`.

- [ ] **Step 3: Implement in `js/groupContext.js`**

In `renderRoster`, add `types` to the bell call:

```js
    if (NOTIFICATIONS_ENABLED && uid !== ownUserId) {
      const bell = createNotifyBell(uid, {
        types: ['knock', 'availability'],
        onNeedPermission: () => { ensureNotificationsReady().catch(() => {}); },
      });
      li.appendChild(bell);
    }
```

- [ ] **Step 4: Run the full suite**

Run: `npx jest`
Expected: PASS (no regressions; count up by Task 1's new tests + the Direct/group assertions).

- [ ] **Step 5: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "feat(groupContext): roster bell drops the dead Call toggle (knock + availability)"
```

---

## Deploy note
Changes `dist/bundle.js` (shell asset) → **recommend** an `sw.js` `CACHE` bump (currently `knockknock-v6`) at deploy — recommend, not auto.
