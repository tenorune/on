# Keyed Render Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full `innerHTML = ''` rebuilds in `renderNavRow`, `renderRoster`, and `renderList` with keyed reconciliation so DOM nodes persist across ticks, updates are in-place paints, and handlers attach once per node lifetime.

**Architecture:** One new ~60-line primitive (`js/reconcile.js`: `reconcileChildren(container, keys, { create, update, onRemove })`) adopted by the three renderers. The caller owns ordering (keys); the reconciler converges children to it — remove gone keys (with an `onRemove` hook used to close a card-drawer living in a removed row), create-once, update-always, minimal repositions. NOT a pure refactor: drawers/focus/animations deliberately survive ticks that don't remove their row.

**Tech Stack:** Vanilla ES modules, Jest (jsdom) at repo root.

**Spec:** `docs/superpowers/specs/2026-06-10-render-reconciliation-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `js/reconcile.js` | The keyed child reconciler | **Create** |
| `js/groupNav.js` | `renderNavRow` both modes via reconcile; new `paintNavCard`/`paintDirectCard`; toggle handler reads live state | Modify |
| `js/groupContext.js` | `renderRoster` via reconcile; `rosterKeys()` absorbs `reorderRosterByAvailability`; data-driven availability; eligibility-bit keys; invite-row handler reads `_lastMembers` | Modify |
| `js/following.js` | `renderList` via reconcile; row factories return nodes; float order folded into keys; follower-name read at click time | Modify |
| `tests/reconcile.test.js` | Unit tests for the primitive | **Create** |
| `tests/groupNav.test.js`, `tests/groupContext.test.js`, `tests/following.test.js`, `tests/knock.test.js` | New identity/lifecycle tests; ONE existing test rewritten to the new drawer contract | Modify |

## Cross-cutting rules (every task)

1. **Persistent-node discipline:** anything `create` builds is permanent for that key. Event handlers must read **live module state at event time**, never render-time closure captures that can go stale (exceptions explicitly noted as accepted). `update` must **clear** state it conditionally sets (e.g. `classList.toggle('greyed', !avail)` and `style.borderColor = avail ? color : ''` — the old build-fresh code only ever *added*).
2. **`update` paints; it never touches handlers or structure.** Structural per-row changes ride the key (the roster eligibility bit).
3. Existing tests assert post-render DOM and must keep passing unchanged, EXCEPT the one roster drawer test called out in Task 3 (the spec deliberately changes that contract).

---

## Task 1: `js/reconcile.js`

**Files:**
- Create: `js/reconcile.js`
- Test: `tests/reconcile.test.js`

- [ ] **Step 1: Write the failing tests** — create `tests/reconcile.test.js`:

```js
// tests/reconcile.test.js
const { reconcileChildren } = require('../js/reconcile.js');

let container;
beforeEach(() => {
  document.body.innerHTML = '<ul id="c"></ul>';
  container = document.getElementById('c');
});

function makeOpts(overrides = {}) {
  return {
    create: jest.fn((key) => {
      const li = document.createElement('li');
      li.textContent = `node-${key}`;
      return li;
    }),
    update: jest.fn(),
    ...overrides,
  };
}

test('creates nodes for new keys in order, stamps data-reconcile-key', () => {
  const opts = makeOpts();
  reconcileChildren(container, ['a', 'b', 'c'], opts);
  const kids = [...container.children];
  expect(kids.map((n) => n.dataset.reconcileKey)).toEqual(['a', 'b', 'c']);
  expect(opts.create).toHaveBeenCalledTimes(3);
  expect(opts.update).toHaveBeenCalledTimes(3); // update runs for new nodes too
});

test('preserves node identity across reconciles; create runs once per key', () => {
  const opts = makeOpts();
  reconcileChildren(container, ['a', 'b'], opts);
  const a1 = container.children[0];
  reconcileChildren(container, ['a', 'b'], opts);
  expect(container.children[0]).toBe(a1);
  expect(opts.create).toHaveBeenCalledTimes(2); // not 4
  expect(opts.update).toHaveBeenCalledTimes(4); // every reconcile updates
});

test('a create-attached handler fires once per click after many reconciles', () => {
  const clicks = jest.fn();
  const opts = makeOpts({
    create: (key) => {
      const li = document.createElement('li');
      li.addEventListener('click', clicks);
      return li;
    },
  });
  reconcileChildren(container, ['a'], opts);
  reconcileChildren(container, ['a'], opts);
  reconcileChildren(container, ['a'], opts);
  container.children[0].click();
  expect(clicks).toHaveBeenCalledTimes(1);
});

test('removes nodes whose key is gone, calling onRemove first', () => {
  const removed = [];
  const opts = makeOpts({ onRemove: (n) => removed.push(n.dataset.reconcileKey) });
  reconcileChildren(container, ['a', 'b', 'c'], opts);
  reconcileChildren(container, ['a', 'c'], opts);
  expect([...container.children].map((n) => n.dataset.reconcileKey)).toEqual(['a', 'c']);
  expect(removed).toEqual(['b']);
});

test('reorders existing nodes to match keys without recreating', () => {
  const opts = makeOpts();
  reconcileChildren(container, ['a', 'b', 'c'], opts);
  const [a, b, c] = [...container.children];
  reconcileChildren(container, ['c', 'a', 'b'], opts);
  expect([...container.children]).toEqual([c, a, b]);
  expect(opts.create).toHaveBeenCalledTimes(3);
});

test('disjoint key sets fully replace (old removed via onRemove, new created)', () => {
  const removed = [];
  const opts = makeOpts({ onRemove: (n) => removed.push(n.dataset.reconcileKey) });
  reconcileChildren(container, ['a', 'b'], opts);
  reconcileChildren(container, ['x', 'y'], opts);
  expect([...container.children].map((n) => n.dataset.reconcileKey)).toEqual(['x', 'y']);
  expect(removed.sort()).toEqual(['a', 'b']);
});

test('unkeyed foreign children are removed', () => {
  const stray = document.createElement('li');
  container.appendChild(stray);
  reconcileChildren(container, ['a'], makeOpts());
  expect([...container.children].map((n) => n.dataset.reconcileKey)).toEqual(['a']);
});

test('empty keys clears the container through onRemove', () => {
  const removed = [];
  const opts = makeOpts({ onRemove: (n) => removed.push(n.dataset.reconcileKey) });
  reconcileChildren(container, ['a', 'b'], opts);
  reconcileChildren(container, [], opts);
  expect(container.children.length).toBe(0);
  expect(removed.sort()).toEqual(['a', 'b']);
});
```

- [ ] **Step 2: Run** `npx jest tests/reconcile.test.js` — Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement** — create `js/reconcile.js`:

```js
// js/reconcile.js
// Keyed child reconciliation for the list renderers (nav row, group roster,
// Direct contact list). Previously each renderer did `innerHTML = ''` + full
// rebuild on every data tick, destroying transient DOM state (focus,
// animations, open card-drawers, knock float ordering) and re-attaching every
// listener. This converges a container's children to a desired ordered key
// list instead: nodes persist for the lifetime of their key.
//
// Contract:
// - The CALLER owns ordering; `keys` is the full desired ordered child list.
// - create(key) builds a node once per key lifetime — attach event handlers
//   here, and make them read live state at event time (the node outlives the
//   render that created it, so render-time closures go stale).
// - update(node, key) runs on EVERY reconcile, for new and surviving nodes —
//   in-place paint only (text/classes/styles); never handlers or structure.
//   Conditional state must be cleared as well as set.
// - onRemove(node), optional, runs before a node is removed (used to close a
//   card-drawer living inside a removed row).
// - Children without a data-reconcile-key are removed (renderers own their
//   containers exclusively); duplicate keys keep the first node.

export function reconcileChildren(container, keys, { create, update, onRemove }) {
  const want = new Set(keys);
  const byKey = new Map();
  for (const child of [...container.children]) {
    const k = child.dataset.reconcileKey;
    if (k !== undefined && want.has(k) && !byKey.has(k)) {
      byKey.set(k, child);
    } else {
      if (onRemove) { try { onRemove(child); } catch { /* hook threw */ } }
      child.remove();
    }
  }
  let cursor = null; // last correctly-positioned node
  for (const key of keys) {
    let node = byKey.get(key);
    if (!node) {
      node = create(key);
      node.dataset.reconcileKey = key;
    }
    update(node, key);
    const expected = cursor ? cursor.nextSibling : container.firstChild;
    if (node !== expected) container.insertBefore(node, expected);
    cursor = node;
  }
}
```

- [ ] **Step 4: Run** `npx jest tests/reconcile.test.js` — Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add js/reconcile.js tests/reconcile.test.js
git commit -m "feat: keyed child reconciler for the list renderers"
```

---

## Task 2: `groupNav.renderNavRow` adoption

**Files:**
- Modify: `js/groupNav.js` (`renderNavRow` ~235-248, `renderNavRowDirectMode` ~265-328, `renderNavRowGroupMode` ~330-396)
- Test: `tests/groupNav.test.js`

- [ ] **Step 1: Write the failing tests** — append to `tests/groupNav.test.js` (reuse `setupNavDom()` and the established capture patterns; `db`, `ownStatus` requires exist):

```js
describe('renderNavRow reconciliation', () => {
  beforeEach(() => { jest.clearAllMocks(); setupNavDom(); });

  function boot(enumeration) {
    let enumCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation(() => () => {});
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    ownStatus.subscribeOwnStatus.mockImplementation((cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    startCardsRowSubscriptions();
    enumCb(enumeration);
    return { enumCb: (e) => enumCb(e), statusCb: (s) => statusCb(s) };
  }

  test('group cards keep node identity across an own-status tick', () => {
    const t = boot({ G1: { lastVisited: 2 }, G2: { lastVisited: 1 } });
    const card1 = document.querySelector('#nav-row [data-group-id="G1"]');
    t.statusCb({ status: 'available', availableUntil: Date.now() + 60000, statusColor: '#22c55e' });
    expect(document.querySelector('#nav-row [data-group-id="G1"]')).toBe(card1);
  });

  test('card click handler attaches once across renders', () => {
    const t = boot({ G1: { lastVisited: 1 } });
    t.statusCb({ status: 'unavailable', availableUntil: null });
    t.statusCb({ status: 'unavailable', availableUntil: null });
    const setLastVisitedCalls = db.setLastVisited.mock.calls.length;
    document.querySelector('#nav-row [data-group-id="G1"]').click();
    // navigateToGroup → setCurrentContext/setLastVisited path fires exactly once
    expect(db.setLastVisited.mock.calls.length).toBe(setLastVisitedCalls + 1);
  });

  test('going unavailable CLEARS the border and greys a surviving card', () => {
    const t = boot({ G1: { lastVisited: 1 } });
    t.statusCb({ status: 'available', availableUntil: Date.now() + 60000, statusColor: '#11aaff' });
    const card = document.querySelector('#nav-row [data-group-id="G1"]');
    expect(card.style.borderColor).not.toBe('');
    expect(card.classList.contains('greyed')).toBe(false);
    t.statusCb({ status: 'unavailable', availableUntil: null });
    expect(document.querySelector('#nav-row [data-group-id="G1"]')).toBe(card);
    expect(card.style.borderColor).toBe('');
    expect(card.classList.contains('greyed')).toBe(true);
  });

  test('an added group creates one new card without recreating the rest', () => {
    const t = boot({ G1: { lastVisited: 2 } });
    const card1 = document.querySelector('#nav-row [data-group-id="G1"]');
    t.enumCb({ G1: { lastVisited: 2 }, G2: { lastVisited: 1 } });
    expect(document.querySelector('#nav-row [data-group-id="G1"]')).toBe(card1);
    expect(document.querySelector('#nav-row [data-group-id="G2"]')).not.toBeNull();
  });
});
```

(If `db.setLastVisited` isn't the observable for a card click in this suite, use whatever the existing card-click tests assert — match their seam exactly.)

- [ ] **Step 2: Run** `npx jest tests/groupNav.test.js -t "reconciliation"` — Expected: FAIL on node identity (`toBe` fails — rebuild creates new nodes).

- [ ] **Step 3: Implement.** In `js/groupNav.js`:

(a) `import { reconcileChildren } from './reconcile.js';`

(b) `renderNavRow` — remove the `row.innerHTML = '';` line only; the mode dispatch stays.

(c) Replace `renderNavRowDirectMode` with:

```js
function renderNavRowDirectMode(row) {
  const sorted = Object.keys(_enumeration).slice().sort((a, b) => {
    const va = _enumeration[a]?.lastVisited ?? 0;
    const vb = _enumeration[b]?.lastVisited ?? 0;
    return vb - va;
  });
  // "Direct" is the implicit current context — no label needed in the nav.
  const keys = ['inbox-slot', ...sorted.map((g) => `group:${g}`), 'plus'];
  reconcileChildren(row, keys, {
    create: (key) => {
      if (key === 'inbox-slot') {
        // Phase 3 Inbox slot — first position. The button itself is created/
        // torn down by js/inbox.js; the slot guarantees the DOM anchor.
        const slot = document.createElement('div');
        slot.id = 'nav-row-inbox-slot';
        slot.className = 'nav-row-inbox-slot';
        return slot;
      }
      if (key === 'plus') {
        const plus = document.createElement('button');
        plus.className = 'group-cards-plus';
        plus.textContent = '+';
        plus.title = 'Create a new group';
        plus.addEventListener('click', () => emitCreateRequest());
        return plus;
      }
      const groupId = key.slice('group:'.length);
      const card = document.createElement('button');
      card.className = 'group-card';
      card.dataset.groupId = groupId;
      card.addEventListener('click', () => navigateToGroup(groupId));
      return card;
    },
    update: (node, key) => {
      if (key === 'inbox-slot') { renderInboxNavSlot(); return; }
      if (key === 'plus') return;
      paintNavCard(node, key.slice('group:'.length));
    },
  });
}

// In-place paint for a Direct-mode group card. Persistent nodes mean every
// conditional must CLEAR as well as set (the old build-fresh code only added).
function paintNavCard(card, groupId) {
  const meta = _metaByGroupId[groupId];
  card.textContent = meta?.name || groupId;
  // Effective-status indicator: when override is enabled the group's chip
  // reflects the override (independent), otherwise it mirrors Direct
  // (primary). No per-field mixing — override.statusColor is preserved
  // across toggling enabled off (for restore-on-re-enable), but reading
  // it while enabled=false would leak the group's last pick into the
  // chip after the user turned the override off.
  const ov = _overrideByGroupId[groupId];
  const overrideOn = !!(ov && ov.enabled === true);
  const source = overrideOn ? ov : _ownPrimary;
  const isAvailable = source?.status === 'available'
    && (source.availableUntil == null || source.availableUntil > Date.now());
  const effectiveColor = source?.statusColor || '#22c55e';
  card.classList.toggle('greyed', !isAvailable);
  card.style.borderColor = isAvailable ? safeCssColor(effectiveColor) : '';
  card.style.setProperty('--call-color-rgb', hexToRgb(effectiveColor));
  applyBadgeIfNonZero(card, getGroupBadgeCount(groupId));
}
```

(d) Replace `renderNavRowGroupMode` with:

```js
function renderNavRowGroupMode(row) {
  const groupId = _state.groupId;
  reconcileChildren(row, ['group-name', 'override-toggle', 'direct-card'], {
    create: (key) => {
      if (key === 'group-name') {
        const current = document.createElement('span');
        current.className = 'nav-current nav-current-truncate';
        current.style.flex = '1';
        current.style.minWidth = '0';
        return current;
      }
      if (key === 'override-toggle') {
        // Override toggle:  =  OFF (linked to primary)   ≠  ON (independent).
        const toggle = document.createElement('button');
        toggle.id = 'group-override-toggle';
        toggle.type = 'button';
        toggle.addEventListener('click', () => {
          // Persistent node: read LIVE state at click time, never the render-
          // time closure (the toggle outlives the render that painted it).
          const gid = _state.groupId;
          // Preserve any existing statusColor/paletteKey across the toggle so
          // the optimistic update matches what mergeStatusOverride leaves on
          // the server. Without the spread, _ownOverride briefly has no
          // statusColor and the user's group dot falls back to --my-status
          // until the watch echo restores the field.
          const existing = _overrideByGroupId[gid] || {};
          const nextEnabled = !(existing.enabled === true);
          const nextState = nextEnabled
            ? { ...existing, enabled: true, status: 'unavailable', availableUntil: null }
            : { ...existing, enabled: false, status: null, availableUntil: null };
          _overrideByGroupId[gid] = nextState;
          renderNavRow();
          applyOptimisticOverride(nextState);
          toggleStatusOverride(gid, _myUserId, nextEnabled).catch(() => {});
        });
        return toggle;
      }
      // "Direct" card on the far right, styled like a group card.
      const directCard = document.createElement('button');
      directCard.className = 'group-card';
      directCard.dataset.nav = 'direct';
      directCard.textContent = 'Direct';
      directCard.addEventListener('click', () => navigateToDirect());
      return directCard;
    },
    update: (node, key) => {
      if (key === 'group-name') {
        const meta = _metaByGroupId[groupId];
        node.textContent = meta?.name || _lastKnownNames[groupId] || groupId;
        return;
      }
      if (key === 'override-toggle') {
        const override = _overrideByGroupId[groupId];
        const overrideOn = !!(override && override.enabled === true);
        node.textContent = overrideOn ? '≠' : '=';
        node.setAttribute('aria-pressed', overrideOn ? 'true' : 'false');
        node.setAttribute('aria-label', overrideOn
          ? 'Stop using a unique status for this group'
          : 'Set a unique status for this group');
        return;
      }
      paintDirectCard(node);
    },
  });
}

// Border color reflects the user's primary status (the audience Direct
// represents). --call-color-rgb is set even when greyed so a queued knock
// pulses even on an unavailable Direct chip.
function paintDirectCard(directCard) {
  const primaryAvailable = _ownPrimary?.status === 'available'
    && (_ownPrimary.availableUntil == null || _ownPrimary.availableUntil > Date.now());
  const directColor = _ownPrimary?.statusColor || '#22c55e';
  directCard.classList.toggle('greyed', !primaryAvailable);
  directCard.style.borderColor = primaryAvailable ? safeCssColor(directColor) : '';
  directCard.style.setProperty('--call-color-rgb', hexToRgb(directColor));
  applyBadgeIfNonZero(directCard, getDirectBadgeCount());
}
```

The mode flip (direct ↔ group) has disjoint key sets → full replace, which is correct. The toggle's old render-time closure over `overrideOn`/`groupId` is the load-bearing change — it now reads `_state.groupId`/`_overrideByGroupId` at click time.

- [ ] **Step 4: Run** `npx jest tests/groupNav.test.js` — Expected: WHOLE FILE PASS (new + all pre-existing nav tests; they assert post-render DOM, which is unchanged).

- [ ] **Step 5: Commit**

```bash
git add js/groupNav.js tests/groupNav.test.js
git commit -m "refactor(groupNav): reconcile the nav row; paint in place"
```

---

## Task 3: `groupContext.renderRoster` adoption

**Files:**
- Modify: `js/groupContext.js` (`reorderRosterByAvailability` ~98-119 → replaced; `renderRoster` ~121-291 → restructured; `paintRosterRow` tail; the second `reorderRosterByAvailability()` call site ~405)
- Test: `tests/groupContext.test.js`

**Pre-reading for the implementer:** `renderRoster` currently: blanket `closeCardDrawer()`, `innerHTML=''`, owner invite row, alphabetical member rows (each ~120 lines of li/dot/label/status + bell/request-follow actions + knock handlers + long-press handlers), then `reorderRosterByAvailability()` (floated → available → alphabetical, reading `row.dataset.available` from the DOM). `paintRosterRow(uid)` is the existing per-row painter; a second `reorderRosterByAvailability()` runs at ~405 after status paints.

- [ ] **Step 1: Write the failing tests.** In `tests/groupContext.test.js`:

(a) **REWRITE** the existing test `re-rendering the roster closes any open card drawer first` (the spec deliberately changes this contract) to:

```js
  test('a card drawer survives a members tick that keeps its row, closes when the row is removed', () => {
    const cardDrawer = require('../js/cardDrawer.js');
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    cardDrawer.closeCardDrawer.mockClear();
    // Unrelated tick (same member set): the drawer must NOT be force-closed.
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    expect(cardDrawer.closeCardDrawer).not.toHaveBeenCalled();
    // Simulate the open drawer living inside a's row, then remove a.
    const rowA = document.querySelector('#group-roster [data-user-id="a"]');
    const slice = document.createElement('div');
    slice.className = 'card-drawer';
    rowA.appendChild(slice);
    cardDrawer.isCardDrawerOpen.mockReturnValue(true);
    membersCb({});
    expect(cardDrawer.closeCardDrawer).toHaveBeenCalled();
    cardDrawer.isCardDrawerOpen.mockReturnValue(false);
  });
```

(b) Append new tests in the `describe('group roster render', …)` block:

```js
  test('roster rows keep node identity across a members tick', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    const rowA = document.querySelector('#group-roster [data-user-id="a"]');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    expect(document.querySelector('#group-roster [data-user-id="a"]')).toBe(rowA);
  });

  test('knock fires once per tap after two members ticks (no duplicated handlers)', () => {
    const knock = require('../js/knock.js');
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    document.querySelector('#group-roster [data-user-id="a"]').click();
    expect(knock.sendKnock).toHaveBeenCalledTimes(1);
  });

  test('an eligibility flip recreates the row (key carries the eligibility bit)', () => {
    const followRequests = require('../js/followRequests.js');
    followRequests.isFollowRequestEligible.mockReturnValue(true);
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    const before = document.querySelector('#group-roster [data-user-id="a"]');
    expect(before.querySelector('.card-drawer-toggle')).not.toBeNull();
    followRequests.isFollowRequestEligible.mockReturnValue(false);
    document.dispatchEvent(new CustomEvent('following-synced'));
    const after = document.querySelector('#group-roster [data-user-id="a"]');
    expect(after).not.toBe(before); // recreated, not patched
    expect(after.querySelector('.card-drawer-toggle')).toBeNull();
    expect(after.querySelector('.notify-bell')).not.toBeNull();
  });

  test('a floated member stays pinned to the top across a members tick', () => {
    const knock = require('../js/knock.js');
    knock.getFloatedUserIds.mockReturnValue(['b']);
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({
      a: { role: 'member', displayName: 'Alice', joinedAt: 1 },
      b: { role: 'member', displayName: 'Bob', joinedAt: 2 },
    });
    const rows = [...document.querySelectorAll('#group-roster li')];
    expect(rows[0].dataset.userId).toBe('b'); // floated beats alphabetical
    knock.getFloatedUserIds.mockReturnValue([]);
  });

  test('a displayName change repaints the surviving row label', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    const rowA = document.querySelector('#group-roster [data-user-id="a"]');
    membersCb({ a: { role: 'member', displayName: 'Alicia', joinedAt: 1 } });
    expect(document.querySelector('#group-roster [data-user-id="a"]')).toBe(rowA);
    expect(rowA.querySelector('.person-label').textContent).toBe('Alicia');
  });
```

(Check the knock mock factory: `getFloatedUserIds: jest.fn(() => [])` exists — `mockReturnValue` overrides per-test; reset it as shown.)

- [ ] **Step 2: Run** `npx jest tests/groupContext.test.js -t "reconcil"` and the rewritten drawer test — Expected: identity/handler/flip/float tests FAIL against the rebuild implementation; the rewritten drawer test FAILS (blanket close still fires).

- [ ] **Step 3: Implement.** In `js/groupContext.js`:

(a) `import { reconcileChildren } from './reconcile.js';` (and keep `closeCardDrawer`/`isCardDrawerOpen` imports — `onRemove` uses them).

(b) Add the shared availability helper (extracted so ordering is data-driven, not DOM-driven) and refactor `paintRosterRow`'s status/availableUntil/isAvailable computation to call it:

```js
// Effective in-group availability for a member, from data (not the DOM).
// Override-on means "independent in this group": every field comes from the
// override; override-off: primary wins. Mirrors paintRosterRow's merge.
function memberEffectiveAvailable(uid) {
  const override = _membersOverrides[uid];
  const primary = _memberPrimaries.get(uid) || null;
  const overrideOn = !!(override && override.enabled === true);
  const status = overrideOn ? (override.status || 'unavailable') : (primary?.status || 'unavailable');
  const availableUntil = (overrideOn ? override.availableUntil : primary?.availableUntil) ?? null;
  return status === 'available' && (availableUntil == null || availableUntil > Date.now());
}
```

(c) Add the ordering function — this **absorbs `reorderRosterByAvailability`** (floated → available → alphabetical, same effective order as today since that pass already ran after every render and repaint):

```js
const ROSTER_KEY_PREFIX = 'm:';
function rosterRowKey(uid) {
  // The eligibility bit rides the key: a request-to-follow eligibility flip
  // changes the row's action cluster (bare bell vs ⋮ drawer), so it recreates
  // that one row instead of update() rebuilding drawers in place.
  const bit = (FOLLOW_REQUESTS_ENABLED && isFollowRequestEligible(uid)) ? '1' : '0';
  return `${ROSTER_KEY_PREFIX}${uid}:${bit}`;
}
function rosterUidOf(key) {
  return key.slice(ROSTER_KEY_PREFIX.length, key.lastIndexOf(':'));
}

function rosterKeys(members, ownUserId) {
  const isOwner = _groupOwnerId !== null && _groupOwnerId === ownUserId;
  const entries = Object.entries(members || {}).filter(([uid]) => uid !== ownUserId);
  const floatedSet = new Set(getFloatedUserIds());
  const floated = [];
  const others = [];
  for (const [uid, member] of entries) {
    (floatedSet.has(uid) ? floated : others).push([uid, member]);
  }
  others.sort(([uidA, a], [uidB, b]) => {
    const availA = memberEffectiveAvailable(uidA);
    const availB = memberEffectiveAvailable(uidB);
    if (availA !== availB) return availA ? -1 : 1;
    const nameA = (a.displayName || '').toLowerCase();
    const nameB = (b.displayName || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });
  const keys = [];
  if (isOwner) keys.push('invite-row');
  for (const [uid] of floated) keys.push(rosterRowKey(uid));
  for (const [uid] of others) keys.push(rosterRowKey(uid));
  return keys;
}
```

(d) Restructure `renderRoster`:

```js
function renderRoster(members, ownUserId) {
  const list = document.getElementById('group-roster');
  if (!list) return;
  reconcileChildren(list, rosterKeys(members, ownUserId), {
    create: (key) => key === 'invite-row'
      ? createInviteRow(ownUserId)
      : createRosterRow(rosterUidOf(key), (members || {})[rosterUidOf(key)] || {}, ownUserId),
    update: (node, key) => {
      if (key === 'invite-row') return;
      const uid = rosterUidOf(key);
      const member = (members || {})[uid];
      const label = node.querySelector('.person-label');
      if (label && member) label.textContent = member.displayName || uid;
      paintRosterRow(uid);
    },
    // The drawer survives ticks that keep its row; close only when the row
    // holding the open drawer is removed (replaces the blanket close that
    // renderRoster used to do — the leak vector was the wipe itself).
    onRemove: (node) => {
      if (isCardDrawerOpen() && node.querySelector('.card-drawer')) closeCardDrawer();
    },
  });
}
```

The blanket `closeCardDrawer()` + `list.innerHTML = ''` at the top are GONE.

(e) `createInviteRow(ownUserId)`: the existing invite-row block moved verbatim into a function that returns the `<li>` — with ONE change: the click handler's `currentMemberUids` must read live state, not the render-time `members` closure (the row now persists across ticks):

```js
      currentMemberUids: new Set(Object.keys(_lastMembers || {})),
```

(f) `createRosterRow(uid, member, ownUserId)`: the existing `for (const [uid, member] of entries)` body moved verbatim into a function that RETURNS the `<li>` (drop the trailing `list.appendChild(li)`). The knock and long-press handlers already read live state (`getCurrentGroupId()`, `_ownOverride`) — unchanged. Known accepted staleness (comment it): `createRequestFollowButton(..., member.displayName || uid)` captures the display name at create time, so a member rename can leave a stale name in the request-toast until the row is recreated — cosmetic and rare.

(g) Delete `reorderRosterByAvailability` and replace its two call sites:
- The call at the end of `renderRoster` — gone (ordering is now in `rosterKeys`).
- The call at ~405 (after the member-status paint path) becomes `syncRosterOrder()`:

```js
// Re-converge roster order after a status change (availability moved a row).
// Reconciliation makes this a cheap reorder + repaint; no node churn.
function syncRosterOrder() {
  if (_lastMembers === null) return;
  renderRoster(_lastMembers, _currentUserId);
}
```

- **Recursion guard:** `paintRosterRow` must NOT call `syncRosterOrder`/reorder (renderRoster's `update` calls `paintRosterRow`). If the ~405 reorder call lives inside `paintRosterRow` or its caller chain, move it to the status-subscription callback site: paint first, then `syncRosterOrder()`. Verify by reading the actual caller (the `watchStatus` member callback in `syncStatusSubscriptions`).

(h) The `'following-synced'` listener (installed in `installGroupSyncListeners`) keeps calling `renderRoster(_lastMembers, _currentUserId)` — with eligibility-bit keys this now recreates exactly the flipped rows.

- [ ] **Step 4: Run** `npx jest tests/groupContext.test.js` — Expected: WHOLE FILE PASS (new tests + rewritten drawer test + all pre-existing). Then `npx jest tests/knock.test.js` (float interactions) — PASS.

- [ ] **Step 5: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "refactor(groupContext): reconcile the roster; ordering absorbs the reorder pass"
```

---

## Task 4: `following.renderList` adoption

**Files:**
- Modify: `js/following.js` (`renderList` ~279-395; `createFolloweeRow` ~462 and `createFollowerOnlyRow` ~626 tails; follower-name click handler)
- Test: `tests/following.test.js`

- [ ] **Step 1: Write the failing tests** — append to `tests/following.test.js` (reuse `initAndCaptureFollowersCallback`, `setupDom`, the `getFollowing`/`getFollowerName` mocks):

```js
describe('renderList reconciliation', () => {
  beforeEach(() => { setupDom(); jest.clearAllMocks(); });

  test('rows keep node identity across a followers tick', () => {
    getFollowing.mockReturnValue([{ userId: 'u1', code: 'AAA111', label: 'Alpha' }]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'AAA111' }]); // u1 mutual
    const row = document.querySelector('[data-user-id="u1"]');
    fire([{ userId: 'u1', code: 'AAA111' }]);
    expect(document.querySelector('[data-user-id="u1"]')).toBe(row);
  });

  test('a section move (mutual -> follower-only loses follow) replaces the row', () => {
    getFollowing.mockReturnValue([{ userId: 'u1', code: 'AAA111', label: 'Alpha' }]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'AAA111' }]);
    const mutualRow = document.querySelector('[data-user-id="u1"]');
    expect(mutualRow.dataset.mutual).toBe('1');
    // Following list empties: u1 becomes follower-only — structurally different row.
    getFollowing.mockReturnValue([]);
    fire([{ userId: 'u1', code: 'AAA111' }]);
    const followerRow = document.querySelector('[data-user-id="u1"]');
    expect(followerRow).not.toBe(mutualRow);
    expect(followerRow.classList.contains('follower-only')).toBe(true);
  });

  test('section labels render once and persist', () => {
    getFollowing.mockReturnValue([{ userId: 'u1', code: 'AAA111', label: 'Alpha' }]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'AAA111' }]);
    const label = document.querySelector('.list-section-label');
    expect(label.textContent).toBe('Mutuals');
    fire([{ userId: 'u1', code: 'AAA111' }]);
    expect(document.querySelectorAll('.list-section-label').length).toBe(1);
    expect(document.querySelector('.list-section-label')).toBe(label);
  });

  test('follow-back prefill reads the follower name at CLICK time, not render time', () => {
    getFollowing.mockReturnValue([]);
    getFollowerName.mockReturnValue(null); // unknown at render
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u2', code: 'Q3ZP7R' }]);
    getFollowerName.mockReturnValue('Bea'); // learned later (approval flow)
    document.querySelector('[data-user-id="u2"] .follow-back-btn').click();
    expect(document.getElementById('add-label-input').value).toBe('Bea');
  });

  test('empty list still clears rows and shows the empty state', () => {
    getFollowing.mockReturnValue([{ userId: 'u1', code: 'AAA111', label: 'Alpha' }]);
    const fire = initAndCaptureFollowersCallback();
    fire([{ userId: 'u1', code: 'AAA111' }]);
    getFollowing.mockReturnValue([]);
    fire([]);
    expect(document.querySelectorAll('#people-list li').length).toBe(0);
    expect(document.getElementById('people-list').style.display).toBe('none');
  });
});
```

- [ ] **Step 2: Run** `npx jest tests/following.test.js -t "reconciliation"` — Expected: identity/label-persist/prefill tests FAIL.

- [ ] **Step 3: Implement.** In `js/following.js`:

(a) `import { reconcileChildren } from './reconcile.js';`

(b) `createFolloweeRow(entry, myUserId, isMutual)` and `createFollowerOnlyRow(follower, myUserId)`: change their tails from `document.getElementById('people-list').appendChild(li)` to `return li;`. In `createFollowerOnlyRow`, change the follow-back click handler to read the name at click time:

```js
  li.querySelector('.follow-back-btn').addEventListener('click', () => {
    document.getElementById('add-code-input').value = follower.code;
    // Read at click time: the row persists across renders, and the roster name
    // can be learned (approval flow) after this row was created.
    document.getElementById('add-label-input').value = getFollowerName(follower.userId) || '';
    document.getElementById('add-person-form').classList.add('open');
  });
```

(The `CODE (Name)` label render stays at create; `update` refreshes it — see (d).)

(c) Restructure `renderList`: everything down through the empty-state block stays, EXCEPT: remove the blanket `closeCardDrawer()` at the top; the `isEmpty` branch replaces `list.innerHTML = ''` with a clearing reconcile (so a drawer inside a removed row closes via the hook), keeping `display:none` + empty-msg toggling; the non-empty branch drops `list.innerHTML = ''`. The clearing reconcile:

```js
  if (isEmpty) {
    reconcileChildren(list, [], {
      create: () => null, // unreachable with empty keys
      update: () => {},
      onRemove: (node) => {
        if (isCardDrawerOpen() && node.querySelector('.card-drawer')) closeCardDrawer();
      },
    });
    list.style.display = 'none';
    emptyMsg.classList.remove('hidden');
    return;
  }
```

(d) Replace the three `appendSection` calls and the floated-row re-prepend block with key construction + one reconcile (the per-entry subscribe/repopulate side effects move into `update`):

```js
  const entryByKey = new Map();
  const keys = [];
  function pushSection(labelKey, labelText, entries, type) {
    if (entries.length === 0) return;
    keys.push(labelKey);
    for (const e of entries) {
      const k = `${type}:${e.userId}`;
      keys.push(k);
      entryByKey.set(k, e);
    }
  }
  pushSection('label:Mutuals', 'Mutuals', sortFollowees(mutuals), 'mutual');
  pushSection('label:Following', 'Following', sortFollowees(followingOnly), 'following');
  pushSection('label:Followers', 'Followers', sortFollowerOnly(followerOnly), 'follower');

  // Floated rows stay pinned right after the first section label (same
  // contract applyFloatToTop honors), folded into the key order instead of
  // the old post-render re-prepend.
  const floated = getFloatedUserIds();
  if (floated.length && keys.length) {
    const firstLabelIdx = keys.findIndex((k) => k.startsWith('label:'));
    const anchor = firstLabelIdx >= 0 ? firstLabelIdx + 1 : 0;
    for (const uid of floated) {
      const idx = keys.findIndex((k) => !k.startsWith('label:') && k.endsWith(`:${uid}`));
      if (idx < 0 || idx === anchor) continue;
      const [k] = keys.splice(idx, 1);
      keys.splice(anchor, 0, k);
    }
  }

  reconcileChildren(list, keys, {
    create: (key) => {
      if (key.startsWith('label:')) {
        const labelLi = document.createElement('li');
        labelLi.className = 'list-section-label';
        labelLi.textContent = key.slice('label:'.length);
        return labelLi;
      }
      const entry = entryByKey.get(key);
      if (key.startsWith('follower:')) return createFollowerOnlyRow(entry, myUserId);
      return createFolloweeRow(entry, myUserId, key.startsWith('mutual:'));
    },
    update: (node, key) => {
      if (key.startsWith('label:')) return;
      const entry = entryByKey.get(key);
      if (key.startsWith('follower:')) {
        // Refresh the CODE (Name) label — the name can be learned post-create.
        const rosterName = getFollowerName(entry.userId);
        const label = node.querySelector('.person-label');
        if (label) {
          label.textContent = rosterName ? `${entry.code} (${rosterName})` : entry.code;
        }
        return;
      }
      // Followee rows: subscribe once; surviving/recreated rows repaint from
      // the status cache so they don't flash "Unavailable" until the next tick.
      if (!unsubscribers.has(entry.userId)) {
        subscribeToFollowee(entry, myUserId);
      } else if (!editingSet.has(entry.userId)) {
        const cached = lastUserData.get(entry.userId);
        if (cached) updateFolloweeRow(entry, cached, myUserId);
      }
    },
    onRemove: (node) => {
      if (isCardDrawerOpen() && node.querySelector('.card-drawer')) closeCardDrawer();
    },
  });
```

Notes: `createFollowerOnlyRow` builds the label with `escapeHtml` — the `update` path sets `textContent` (no HTML), which is safe-by-construction; keep it `textContent`. `isCardDrawerOpen` needs importing in following.js if only `closeCardDrawer` is imported today (check the import line).

- [ ] **Step 4: Run** `npx jest tests/following.test.js` — Expected: WHOLE FILE PASS. Then `npx jest tests/knock.test.js tests/mycode.test.js` (adjacent DOM suites) — PASS.

- [ ] **Step 5: Commit**

```bash
git add js/following.js tests/following.test.js
git commit -m "refactor(following): reconcile the Direct contact list"
```

---

## Task 5: Full-suite verification

- [ ] **Step 1:** `npx jest` — PASS expected. Any failure in a suite asserting pre-reconciliation DOM details (e.g. node counts including stale children, or the old drawer-close contract) is REAL — fix the production gap or, where the spec explicitly changed the contract (drawer survival), update the test to the new contract with a comment. Known pre-existing flake: `recovery.test.js` "no account" race — verify in isolation before treating as flake.
- [ ] **Step 2:** `cd functions && npm test` — PASS (untouched, confirm).
- [ ] **Step 3:** `npm run lint --if-present` — clean or absent.
- [ ] **Step 4:** Commit any straggler fixes: `git add -A && git commit -m "test: align suites with reconciliation contracts"` (skip if none).

---

## Self-Review Notes (spec traceability)

- Spec §1 (reconciler contract incl. onRemove, static keys, unkeyed removal): Task 1.
- Spec §2 nav (mode keys, paintNavCard, create-once handlers): Task 2 — plus the live-state toggle handler the spec's "create builds handlers once" implies.
- Spec §2 roster (rosterKeys absorbing reorder — availability now computed from data via `memberEffectiveAvailable` since the old pass read `dataset.available` from the DOM; eligibility-bit key; onRemove; blanket close removed; following-synced re-reconcile): Task 3.
- Spec §2 Direct list (typed keys, labels-as-keys, float fold-in, knock-skip/editing/empty-state retained; follower-name click-time read): Task 4.
- Spec §3 risk areas → named tests: displayName repaint (T3), eligibility flip no-leak (T3 via rewritten drawer test + flip test), mode flip (T2 disjoint-keys via reconcile unit test + existing nav-mode tests), section move (T4).
- Spec §4 testing inventory: covered across Tasks 1-4; backstop Task 5.
- Deliberate behavior changes are confined to: drawer survival (rewritten test, Task 3), focus/animation survival (inherent), handler attach-once (tested). Everything else preserves output.
