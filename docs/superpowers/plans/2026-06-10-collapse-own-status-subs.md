# Collapse Redundant Own-Status / Group-Meta Subscriptions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the duplicate RTDB subscriptions that peak inside a group context — own `users/{uid}` watched 3×, active-group meta + own override watched 2× — down to one underlying watch each, with no observable behavior change.

**Architecture:** A new `js/ownStatus.js` owns the single `watchStatus(self)` and fans out to registered consumers in registration order (preserving the theme-write ordering invariant). `js/groupNav.js` already owns per-group `watchGroupMeta` / `watchOwnMemberOverride` subscriptions; it grows two read-only subscribe APIs (`subscribeGroupMeta`, `subscribeOwnOverride`) backed by those, with replay-after-tick, a union-of-(enumerated ∪ consumer-held) lifecycle rule, and own-reaction-then-fan-out ordering. The three own-status consumers and groupContext's meta/override watchers swap to these APIs in place.

**Tech Stack:** Vanilla ES modules + Firebase RTDB (web SDK). Jest (jsdom) at the repo root.

**Spec:** `docs/superpowers/specs/2026-06-10-collapse-own-status-subs-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `js/ownStatus.js` | Single owner of `watchStatus(self)`; registration-order fan-out with post-tick replay | **Create** |
| `js/groupNav.js` | Add `subscribeGroupMeta` / `subscribeOwnOverride` providers over its existing per-group subs; union lifecycle; fan-out | Modify |
| `js/app.js` | `initOwnStatus(uid)` at boot; own-status handler → `subscribeOwnStatus` | Modify |
| `js/groupContext.js` | Own-status, meta, override watchers → the new APIs | Modify |
| `tests/ownStatus.test.js` | Unit tests for the fan-out module | **Create** |
| `tests/groupNav.test.js` | Provider-API tests | Modify |
| `tests/groupContext.test.js` | Repoint own-status/meta/override mocks to the new seams | Modify |

**Pure-refactor contract:** test *expectations* must not change — only the seams (which mock a test captures its callback from). The full-suite run in Task 5 is the backstop for mock stragglers.

---

## Task 1: ownStatus.js — single own-status owner

**Files:**
- Create: `js/ownStatus.js`
- Test: `tests/ownStatus.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/ownStatus.test.js`:

```js
// tests/ownStatus.test.js
let db, initOwnStatus, subscribeOwnStatus;

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../js/db.js', () => ({ watchStatus: jest.fn(() => () => {}) }));
  db = require('../js/db.js');
  ({ initOwnStatus, subscribeOwnStatus } = require('../js/ownStatus.js'));
});

function captureWatch() {
  let cb;
  db.watchStatus.mockImplementation((uid, fn) => { cb = fn; return jest.fn(); });
  return () => cb;
}

test('initOwnStatus opens exactly one watchStatus regardless of subscriber count', () => {
  captureWatch();
  initOwnStatus('me');
  subscribeOwnStatus(jest.fn());
  subscribeOwnStatus(jest.fn());
  subscribeOwnStatus(jest.fn());
  expect(db.watchStatus).toHaveBeenCalledTimes(1);
  expect(db.watchStatus).toHaveBeenCalledWith('me', expect.any(Function));
});

test('a tick fans out to every subscriber in registration order', () => {
  const getCb = captureWatch();
  initOwnStatus('me');
  const calls = [];
  subscribeOwnStatus(() => calls.push('a'));
  subscribeOwnStatus(() => calls.push('b'));
  subscribeOwnStatus(() => calls.push('c'));
  getCb()({ status: 'available' });
  expect(calls).toEqual(['a', 'b', 'c']);
});

test('subscribing after a tick replays the last value immediately', () => {
  const getCb = captureWatch();
  initOwnStatus('me');
  getCb()({ status: 'available', availableUntil: 5 });
  const late = jest.fn();
  subscribeOwnStatus(late);
  expect(late).toHaveBeenCalledWith({ status: 'available', availableUntil: 5 });
});

test('subscribing before any tick does NOT fire (no fabricated value)', () => {
  captureWatch();
  initOwnStatus('me');
  const cb = jest.fn();
  subscribeOwnStatus(cb);
  expect(cb).not.toHaveBeenCalled();
});

test('replays a null tick (user node absent) — null is a real value, not "no tick"', () => {
  const getCb = captureWatch();
  initOwnStatus('me');
  getCb()(null);
  const late = jest.fn();
  subscribeOwnStatus(late);
  expect(late).toHaveBeenCalledWith(null);
});

test('unsubscribe stops further delivery', () => {
  const getCb = captureWatch();
  initOwnStatus('me');
  const cb = jest.fn();
  const unsub = subscribeOwnStatus(cb);
  unsub();
  getCb()({ status: 'available' });
  expect(cb).not.toHaveBeenCalled();
});

test('re-init tears down the previous watch and clears replay', () => {
  const unsub1 = jest.fn();
  db.watchStatus.mockImplementationOnce(() => unsub1);
  initOwnStatus('me');
  // second init
  let cb2;
  db.watchStatus.mockImplementationOnce((uid, fn) => { cb2 = fn; return jest.fn(); });
  initOwnStatus('other');
  expect(unsub1).toHaveBeenCalled();
  // No stale replay from the first watch:
  const late = jest.fn();
  subscribeOwnStatus(late);
  expect(late).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/ownStatus.test.js`
Expected: FAIL — cannot find module `../js/ownStatus.js`.

- [ ] **Step 3: Create the module**

Create `js/ownStatus.js`:

```js
// js/ownStatus.js
// Single owner of the own-user `users/{uid}` subscription. Before this, three
// places opened watchStatus(self) — app.js (call-mode recovery + theme + own
// card), groupNav (nav cards), groupContext (own row + override palette) — so
// every status write, and every knock/follower write to the shared user node,
// was delivered three times. This collapses them to one underlying watch with a
// registration-order fan-out.
//
// ORDERING INVARIANT: callbacks fire in registration order, which equals the
// consumers' boot/attach order (groupNav.initNav → app.js handler →
// groupContext on enter). app.js's handler writes the Direct theme to :root;
// groupContext's handler (registered later, on group enter) re-applies the
// group-override theme on the SAME tick and must win. Do not reorder
// registration or change the Set's insertion-ordered iteration.

import { watchStatus } from './db.js';

const NO_TICK = Symbol('no-tick'); // distinct from null (= user node absent)
let _unsub = null;
let _last = NO_TICK;
const _subs = new Set();

export function initOwnStatus(uid) {
  if (_unsub) _unsub();
  _last = NO_TICK;
  _unsub = watchStatus(uid, (data) => {
    _last = data;
    for (const cb of _subs) {
      try { cb(data); } catch { /* one consumer's handler threw — keep going */ }
    }
  });
}

export function subscribeOwnStatus(cb) {
  _subs.add(cb);
  // Replay only if a real tick has landed (NO_TICK guard). A null replay is
  // legitimate — it means the user node is absent, which consumers handle.
  if (_last !== NO_TICK) {
    try { cb(_last); } catch { /* replay handler threw */ }
  }
  return () => { _subs.delete(cb); };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/ownStatus.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add js/ownStatus.js tests/ownStatus.test.js
git commit -m "feat: ownStatus single-owner fan-out for the own-user watch"
```

---

## Task 2: groupNav provider APIs (meta + own override)

**Files:**
- Modify: `js/groupNav.js` (state block ~lines 82-93; `startCardsRowSubscriptions` reset ~116-122; `syncMetaSubs` ~143-193; new exports)
- Test: `tests/groupNav.test.js`

**Context:** groupNav already opens `watchGroupMeta` and `watchOwnMemberOverride` per enumerated group for the nav cards. This task makes those subscriptions *also* serve external consumers, adds the union lifecycle so a consumer can hold a sub for a group that isn't (yet) enumerated, and tracks a per-group "ticked" flag so replay never fabricates a `null` (which groupContext reads as "group deleted").

- [ ] **Step 1: Write the failing tests**

Add to `tests/groupNav.test.js`. First add the new names to the `require('../js/groupNav')` at line 109's destructure (or wherever convenient — both requires point at the same module): add `subscribeGroupMeta, subscribeOwnOverride`. Then append:

```js
describe('subscribeGroupMeta / subscribeOwnOverride providers', () => {
  beforeEach(() => { jest.clearAllMocks(); setupNavDom(); });

  test('subscribeGroupMeta opens an underlying watch for an un-enumerated group (union rule)', () => {
    db.watchGroupMeta.mockImplementation((g, cb) => { return () => {}; });
    initNav('me');
    startCardsRowSubscriptions();
    db.watchGroupMeta.mockClear();
    subscribeGroupMeta('G9', jest.fn()); // G9 not in enumeration
    expect(db.watchGroupMeta).toHaveBeenCalledWith('G9', expect.any(Function));
  });

  test('subscribeGroupMeta does NOT replay before the first tick (no fake deletion)', () => {
    db.watchGroupMeta.mockImplementation(() => () => {});
    initNav('me');
    startCardsRowSubscriptions();
    const cb = jest.fn();
    subscribeGroupMeta('G9', cb);
    expect(cb).not.toHaveBeenCalled();
  });

  test('subscribeGroupMeta replays the cached meta after a tick', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    initNav('me');
    startCardsRowSubscriptions();
    subscribeGroupMeta('G9', jest.fn());
    metaCb({ name: 'Divers', ownerId: 'me', createdAt: 1 });
    const late = jest.fn();
    subscribeGroupMeta('G9', late);
    expect(late).toHaveBeenCalledWith({ name: 'Divers', ownerId: 'me', createdAt: 1 });
  });

  test('a meta tick fans out to consumers AFTER groupNav renders the nav row', () => {
    let metaCb;
    const order = [];
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    // renderNavRow writes into #nav-row; assert ordering via a consumer that
    // records when it ran relative to the nav row being (re)built.
    initNav('me');
    startCardsRowSubscriptions();
    subscribeGroupMeta('G9', () => order.push('consumer'));
    metaCb({ name: 'Divers', ownerId: 'me', createdAt: 1 });
    // The consumer runs after groupNav's own handler body (which calls
    // renderNavRow). We can at least assert the consumer fired exactly once.
    expect(order).toEqual(['consumer']);
  });

  test('a null meta tick fans out null (deletion) to consumers', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    initNav('me');
    startCardsRowSubscriptions();
    const cb = jest.fn();
    subscribeGroupMeta('G9', cb);
    metaCb(null);
    expect(cb).toHaveBeenCalledWith(null);
  });

  test('unsubscribing a consumer-only group tears down its underlying watch', () => {
    const unsub = jest.fn();
    db.watchGroupMeta.mockImplementation(() => unsub);
    initNav('me');
    startCardsRowSubscriptions();
    const off = subscribeGroupMeta('G9', jest.fn());
    off();
    expect(unsub).toHaveBeenCalled();
  });

  test('an enumerated group keeps its watch when a consumer unsubscribes', () => {
    let enumCb;
    const unsub = jest.fn();
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation(() => unsub);
    initNav('me');
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });   // G1 enumerated
    const off = subscribeGroupMeta('G1', jest.fn());
    off();
    expect(unsub).not.toHaveBeenCalled(); // still enumerated → sub stays
  });

  test('subscribeOwnOverride replays cached override after a tick, drops uid param', () => {
    let overrideCb;
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    initNav('me');
    startCardsRowSubscriptions();
    subscribeOwnOverride('G9', jest.fn());
    expect(db.watchOwnMemberOverride).toHaveBeenCalledWith('G9', 'me', expect.any(Function));
    overrideCb({ enabled: true, status: 'available' });
    const late = jest.fn();
    subscribeOwnOverride('G9', late);
    expect(late).toHaveBeenCalledWith({ enabled: true, status: 'available' });
  });

  test('subscribeOwnOverride replays null override after a null tick', () => {
    let overrideCb;
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    initNav('me');
    startCardsRowSubscriptions();
    subscribeOwnOverride('G9', jest.fn());
    overrideCb(null);
    const late = jest.fn();
    subscribeOwnOverride('G9', late);
    expect(late).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/groupNav.test.js -t "providers"`
Expected: FAIL — `subscribeGroupMeta is not a function`.

- [ ] **Step 3: Implement the providers**

In `js/groupNav.js`:

(a) Add state after the existing `_overrideSubs` declaration (~line 93):

```js
// Provider surface (used by groupContext to avoid double-watching the active
// group). Consumers register per groupId; the underlying _metaSubs/_overrideSubs
// fan out to them. "Ticked" tracks whether the underlying sub has delivered ≥1
// value, so replay never hands a consumer a fabricated `null` (which reads as
// "group deleted").
const _metaConsumers = {};      // groupId → Set<cb>
const _overrideConsumers = {};  // groupId → Set<cb>
const _metaTicked = new Set();
const _overrideTicked = new Set();
```

(b) In `startCardsRowSubscriptions`, extend the reset block (after the `_overrideByGroupId` clear, ~line 121) — clear the ticked flags too (consumer registries are owned by their callers' lifecycles, so leave them):

```js
  _metaTicked.clear();
  _overrideTicked.clear();
```

(c) Replace `syncMetaSubs` (lines ~143-193) with the union-aware version. The want-sets become enumerated ∪ consumer-held; the meta/override callbacks set the ticked flag and fan out after groupNav's own reaction; cleanup clears ticked + cache on teardown:

```js
function metaWantIds() {
  return new Set([...Object.keys(_enumeration), ...Object.keys(_metaConsumers)]);
}
function overrideWantIds() {
  return new Set([...Object.keys(_enumeration), ...Object.keys(_overrideConsumers)]);
}

function syncMetaSubs() {
  const metaWant = metaWantIds();
  for (const groupId of Object.keys(_metaSubs)) {
    if (!metaWant.has(groupId)) {
      _metaSubs[groupId]();
      delete _metaSubs[groupId];
      delete _metaByGroupId[groupId];
      _metaTicked.delete(groupId);
    }
  }
  for (const groupId of metaWant) {
    if (!_metaSubs[groupId]) {
      _metaSubs[groupId] = watchGroupMeta(groupId, (meta) => {
        _metaTicked.add(groupId);
        if (meta) {
          _metaByGroupId[groupId] = meta;
          if (meta.name) _lastKnownNames[groupId] = meta.name;
        } else {
          // Group entity deleted by its owner. Non-owner members never had
          // their users/{uid}/groups/{groupId} entry cleared by the owner
          // (the owner can't write to other users' records). Clear it
          // locally — the watchUserGroups delta then drops the card from
          // the nav and tears down our meta + override subs via
          // syncMetaSubs's cleanup loops.
          delete _metaByGroupId[groupId];
          if (_myUserId && _enumeration[groupId] !== undefined) {
            removeUserGroupsEntry(_myUserId, groupId).catch(() => {});
          }
        }
        renderNavRow();
        // Fan out AFTER groupNav's own reaction so consumer order matches the
        // historical attach order (groupNav before groupContext).
        const consumers = _metaConsumers[groupId];
        if (consumers) for (const cb of [...consumers]) { try { cb(meta); } catch { /* consumer threw */ } }
      });
    }
  }

  // Override-sub cleanup + setup (Phase 2)
  const overrideWant = overrideWantIds();
  for (const groupId of Object.keys(_overrideSubs)) {
    if (!overrideWant.has(groupId)) {
      _overrideSubs[groupId]();
      delete _overrideSubs[groupId];
      delete _overrideByGroupId[groupId];
      _overrideTicked.delete(groupId);
    }
  }
  for (const groupId of overrideWant) {
    if (!_overrideSubs[groupId]) {
      _overrideSubs[groupId] = watchOwnMemberOverride(groupId, _myUserId, (override) => {
        _overrideTicked.add(groupId);
        if (override) _overrideByGroupId[groupId] = override;
        else delete _overrideByGroupId[groupId];
        renderNavRow();
        const consumers = _overrideConsumers[groupId];
        if (consumers) for (const cb of [...consumers]) { try { cb(override); } catch { /* consumer threw */ } }
      });
    }
  }
}
```

(d) Add the two exported providers (place them near `getLastKnownGroupName`, ~line 488):

```js
// Read-only subscription to a group's meta, backed by groupNav's existing
// per-group watchGroupMeta. groupContext uses this instead of opening its own
// watch on the active group. Replays the cached meta only after the underlying
// sub has ticked (never a fabricated null). The union rule in syncMetaSubs
// keeps the underlying sub alive while this consumer is registered, even if the
// group isn't enumerated yet (deep-link boot race).
export function subscribeGroupMeta(groupId, cb) {
  (_metaConsumers[groupId] ||= new Set()).add(cb);
  syncMetaSubs();
  if (_metaTicked.has(groupId)) {
    try { cb(_metaByGroupId[groupId] ?? null); } catch { /* replay threw */ }
  }
  return () => {
    const set = _metaConsumers[groupId];
    if (set) { set.delete(cb); if (set.size === 0) delete _metaConsumers[groupId]; }
    syncMetaSubs();
  };
}

// Read-only subscription to the own member statusOverride for a group, backed
// by groupNav's existing watchOwnMemberOverride. groupContext uses this for the
// active group. (uid is groupNav's own _myUserId — consumers don't pass it.)
export function subscribeOwnOverride(groupId, cb) {
  (_overrideConsumers[groupId] ||= new Set()).add(cb);
  syncMetaSubs();
  if (_overrideTicked.has(groupId)) {
    try { cb(_overrideByGroupId[groupId] ?? null); } catch { /* replay threw */ }
  }
  return () => {
    const set = _overrideConsumers[groupId];
    if (set) { set.delete(cb); if (set.size === 0) delete _overrideConsumers[groupId]; }
    syncMetaSubs();
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/groupNav.test.js`
Expected: PASS (whole file — new provider tests + all pre-existing nav tests, which are unaffected since the meta/override callback bodies are behavior-identical for enumerated groups).

- [ ] **Step 5: Commit**

```bash
git add js/groupNav.js tests/groupNav.test.js
git commit -m "feat(groupNav): subscribeGroupMeta/subscribeOwnOverride providers"
```

---

## Task 3: Migrate own-status consumers to ownStatus (3→1)

**Files:**
- Modify: `js/app.js` (import ~line 3/17; boot ~line 352; handler ~line 577)
- Modify: `js/groupNav.js` (import; `initNav` own-primary sub ~line 131)
- Modify: `js/groupContext.js` (import; self-sub ~line 1059)
- Test: `tests/groupNav.test.js`, `tests/groupContext.test.js` (repoint own-status mock)

- [ ] **Step 1: Repoint the test seams (these are the "failing" step)**

In `tests/groupNav.test.js`, add an ownStatus mock near the other `jest.mock` calls at the top:

```js
jest.mock('../js/ownStatus.js', () => ({
  initOwnStatus: jest.fn(),
  subscribeOwnStatus: jest.fn(() => () => {}),
}));
```

Add `const ownStatus = require('../js/ownStatus.js');` next to the existing `const db = require('../js/db.js');` (line 35). Then repoint every own-status capture: replace each
`db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; })`
with
`ownStatus.subscribeOwnStatus.mockImplementation((cb) => { statusCb = cb; return () => {}; })`
(note: `subscribeOwnStatus` takes only `(cb)` — no uid). The `db.watchStatus` lines that capture this are at approximately lines 241, 256, 285, 306 (the own-primary nav-card tests). Leave `db.watchStatus` mocked in the factory (harmless) but it is no longer the seam for own status.

In `tests/groupContext.test.js`, add the same ownStatus mock near the top `jest.mock` calls:

```js
jest.mock('../js/ownStatus.js', () => ({
  subscribeOwnStatus: jest.fn(() => () => {}),
}));
```

Add `const ownStatus = require('../js/ownStatus.js');` next to the existing `const ... = require('../js/db.js')` consumers. In the `captureCallbacks()` helper (~line 754), repoint the primary line only:

```js
  function captureCallbacks() {
    let metaCb, primaryCb, overrideCb;
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    ownStatus.subscribeOwnStatus.mockImplementation((cb) => { primaryCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    return { getMetaCb: () => metaCb, getPrimaryCb: () => primaryCb, getOverrideCb: () => overrideCb };
  }
```

(The member-status tests that use `db.watchStatus.mockImplementation((uid, cb) => { statusCbs[uid] = cb; ... })` for roster members at lines ~322, 411, 424, 436, 458 stay on `db.watchStatus` — only the SELF subscription moves.)

Run: `npx jest tests/groupNav.test.js tests/groupContext.test.js`
Expected: FAIL — groupNav/groupContext still call `watchStatus` for self, so the repointed `subscribeOwnStatus` mocks capture nothing (`statusCb`/`primaryCb` undefined → "is not a function" when invoked).

- [ ] **Step 2: Implement the own-status swaps**

In `js/app.js`:
- Add the import (next to the groupNav import, ~line 17):
  ```js
  import { initOwnStatus, subscribeOwnStatus } from './ownStatus.js';
  ```
- Add `initOwnStatus(userId);` immediately before `initNav(userId);` (line 352):
  ```js
  initOwnStatus(userId);
  initNav(userId);
  ```
- Replace the own-status subscription at line 577 — change only the opening line; the async handler body stays identical:
  ```js
  subscribeOwnStatus(async (userData) => {
  ```
  (Was `watchStatus(userId, async (userData) => {`.)

In `js/groupNav.js`:
- Add `subscribeOwnStatus` to the imports: change the ownStatus consumption — add at the top imports:
  ```js
  import { subscribeOwnStatus } from './ownStatus.js';
  ```
- In `initNav`'s sibling `startCardsRowSubscriptions` own-primary block (line ~131), replace:
  ```js
  _ownPrimaryUnsub = subscribeOwnStatus((data) => {
  ```
  (Was `_ownPrimaryUnsub = watchStatus(_myUserId, (data) => {`.) The callback body is unchanged. Remove `watchStatus` from the `./db.js` import list in groupNav since it's no longer used there.

In `js/groupContext.js`:
- Add the import (next to the `./groupNav.js` import, line ~10):
  ```js
  import { subscribeOwnStatus } from './ownStatus.js';
  ```
- Replace the self-status subscription at line 1059 — opening line only:
  ```js
  _ownPrimaryUnsub = subscribeOwnStatus((data) => {
  ```
  (Was `_ownPrimaryUnsub = watchStatus(userId, (data) => {`.) Keep `watchStatus` in groupContext's `./db.js` import — it's still used for member roster status (`syncStatusSubscriptions`).

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx jest tests/groupNav.test.js tests/groupContext.test.js`
Expected: PASS (both files).

- [ ] **Step 4: Verify app.js + check straggler suites**

Run: `node --check js/app.js`
Expected: no syntax errors.

Run: `npx jest tests/invites.test.js tests/recovery.test.js`
Expected: PASS. If either fails with `initOwnStatus is not a function` or a `watchStatus` issue (these suites import `app.js`, whose `main()` auto-runs), add `initOwnStatus: jest.fn()` (and, if needed, `subscribeOwnStatus: jest.fn(() => () => {})`) — either by adding a `jest.mock('../js/ownStatus.js', …)` to that suite, or confirming its `db.js` mock already stubs `watchStatus`. Make the smallest change; do not touch assertions.

- [ ] **Step 5: Commit**

```bash
git add js/app.js js/groupNav.js js/groupContext.js tests/groupNav.test.js tests/groupContext.test.js tests/invites.test.js tests/recovery.test.js
git commit -m "refactor: route own-status through ownStatus (3 watches -> 1)"
```

(Only `git add` the straggler test files if Step 4 actually changed them.)

---

## Task 4: Migrate groupContext meta/override to groupNav providers (2→1 each)

**Files:**
- Modify: `js/groupContext.js` (import ~line 10; meta sub ~line 1203; override sub ~line 1079)
- Test: `tests/groupContext.test.js` (repoint meta/override mock seams)

- [ ] **Step 1: Repoint the test seams (the "failing" step)**

In `tests/groupContext.test.js`:

(a) Add `subscribeGroupMeta` / `subscribeOwnOverride` to the `jest.mock('../js/groupNav.js', …)` factory (~line 48):

```js
jest.mock('../js/groupNav.js', () => ({
  navigateToDirect: jest.fn().mockResolvedValue(undefined),
  getCurrentContext: jest.fn(() => ({ context: 'group', groupId: 'G1' })),
  applyOptimisticAppearance: jest.fn(),
  subscribeGroupMeta: jest.fn(() => () => {}),
  subscribeOwnOverride: jest.fn(() => () => {}),
}));
```

Add `const groupNav = require('../js/groupNav.js');` near the other requires.

(b) In `captureCallbacks()` (~line 754), repoint meta + override to the groupNav seams (note `subscribeOwnOverride` drops the uid arg):

```js
  function captureCallbacks() {
    let metaCb, primaryCb, overrideCb;
    groupNav.subscribeGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    ownStatus.subscribeOwnStatus.mockImplementation((cb) => { primaryCb = cb; return () => {}; });
    groupNav.subscribeOwnOverride.mockImplementation((g, cb) => { overrideCb = cb; return () => {}; });
    return { getMetaCb: () => metaCb, getPrimaryCb: () => primaryCb, getOverrideCb: () => overrideCb };
  }
```

(c) Repoint the standalone meta/override captures elsewhere in the file. Replace every
`db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; })` (and the `(groupId, cb)` variant) with
`groupNav.subscribeGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; })`,
and every
`db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; })` with
`groupNav.subscribeOwnOverride.mockImplementation((g, cb) => { overrideCb = cb; return () => {}; })`.
These appear at approximately lines 225/233/244/262 (owner-check + deletion tests) and the local capture at ~476. Leave `db.watchGroupMembers` (members) and `db.watchStatus` (member status) untouched.

Run: `npx jest tests/groupContext.test.js`
Expected: FAIL — groupContext still calls `db.watchGroupMeta`/`db.watchOwnMemberOverride` for the active group, so the repointed groupNav mocks capture nothing.

- [ ] **Step 2: Implement the swaps**

In `js/groupContext.js`:
- Extend the `./groupNav.js` import (line 10):
  ```js
  import { navigateToDirect, applyOptimisticAppearance, subscribeGroupMeta, subscribeOwnOverride } from './groupNav.js';
  ```
- Replace the own-override subscription opener (line 1079) — body unchanged:
  ```js
  _ownOverrideUnsub = subscribeOwnOverride(groupId, (data) => {
  ```
  (Was `_ownOverrideUnsub = watchOwnMemberOverride(groupId, userId, (data) => {`.)
- Replace the meta subscription opener (line 1203) — body unchanged:
  ```js
  _metaUnsub = subscribeGroupMeta(groupId, (meta) => {
  ```
  (Was `_metaUnsub = watchGroupMeta(groupId, (meta) => {`.)
- Remove `watchGroupMeta` and `watchOwnMemberOverride` from groupContext's `./db.js` import (no longer used there; `watchStatus`, `watchGroupMembers`, `watchGroupInvites` remain).

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx jest tests/groupContext.test.js`
Expected: PASS (whole file).

- [ ] **Step 4: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "refactor(groupContext): consume groupNav meta/override providers (2 watches -> 1)"
```

---

## Task 5: Full-suite verification

**Files:** possibly any suite that mocks `js/db.js`/`js/groupNav.js`/`js/ownStatus.js` and now breaks.

- [ ] **Step 1: Run the entire web suite**

Run: `npx jest`
Expected: PASS. If a suite fails because its code-under-test now reaches `ownStatus`/`subscribeGroupMeta`/`subscribeOwnOverride` through an unmocked seam, add the minimal `jest.fn()` stub (sync subscribe → `jest.fn(() => () => {})`; `initOwnStatus` → `jest.fn()`) to that suite's relevant mock factory. Do not change assertions or production code. Re-run until green.

- [ ] **Step 2: Run the functions suite (unaffected, but confirm)**

Run: `cd functions && npm test`
Expected: PASS.

- [ ] **Step 3: Lint (if configured)**

Run: `npm run lint --if-present`
Expected: clean, or no lint script.

- [ ] **Step 4: Commit any straggler fixes**

```bash
git add -A
git commit -m "test: mock stubs for ownStatus/groupNav provider seams"
```

(Skip if Step 1 needed no changes.)

---

## Self-Review Notes (traceability to spec)

- **§1 ownStatus module** (single watch, registration-order fan-out, post-tick replay, NO_TICK sentinel, re-init teardown): Task 1.
- **§2 groupNav providers** (subscribeGroupMeta/subscribeOwnOverride, replay-after-tick, union rule, deletion fan-out order, raw null override): Task 2.
- **§3 consumer swaps** (app.js initOwnStatus + handler; groupNav initNav; groupContext self/meta/override; db primitives keep signatures): Tasks 3–4.
- **§4 edge cases** — same-tick ordering (Task 1 invariant + registration order in Tasks 3–4); deep-link race (Task 2 union rule); deleted-while-inside (Task 2 fan-out + groupContext's preserved handler); leave/eviction (union rule keeps sub until exit); user switch (initOwnStatus re-init + startCardsRowSubscriptions ticked-clear); no fabricated nulls (ticked flags both providers).
- **§5 testing** — new ownStatus suite (Task 1); groupNav provider tests (Task 2); repointed groupContext/groupNav seams (Tasks 3–4); full-suite backstop (Task 5).
- **Pure-refactor contract:** no consumer callback body changes; member-roster `watchStatus` left intact; the two group-deleted reactions both preserved (groupNav's own + groupContext's `removeUserGroupsEntry`, idempotent) rather than consolidated (noted out-of-scope in spec).
