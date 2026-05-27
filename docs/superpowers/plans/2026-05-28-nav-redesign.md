# Navigation Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing group-cards strip (which sits above the contact list) with a single persistent, sticky nav row above the status surface that carries across Direct and Group contexts. In Direct context the nav row shows `Direct` (large/bold) + groups + `+`. In Group context it shows `Direct` (back-link) + chain-icon override toggle + group name (large/bold). Move the override-toggle from a pill in the chip row to the chain icon in the nav, and move Settings from above the roster into a chip in the chip row.

**Architecture:** A new top-level `<div id="nav-row">` lives inside `<body>` above both `#main-ui-direct` and `#group-context-root`. `js/groupNav.js` owns its rendering — `renderNavRow()` branches on `_state.context` to render either Direct mode or Group mode, and re-registers as an `onContextChange` listener so context changes drive re-renders. The existing subscriptions (`watchUserGroups`, `watchGroupMeta`, `watchOwnMemberOverride`, `watchStatus(myUid)`) feed both rendering modes; no new Firebase reads. The chain-icon button reuses the existing `toggleStatusOverride` / optimistic-update pattern from commit `bb4107d`. In group context, the body's `<h2 id="group-context-name">`, `<div class="group-breadcrumb">`, and override-toggle pill are deleted; Settings becomes a `<details>` whose `<summary>` is a chip alongside the time chip.

**Tech Stack:** Vanilla ES modules, Firebase RTDB (existing subscriptions only), esbuild, jest + jsdom. Inline SVG icons (no new dependencies). No security-rule changes.

**Spec reference:** `docs/superpowers/specs/2026-05-28-nav-redesign-design.md`.

---

## File Structure

**Modified files:**

| File | Change |
|---|---|
| `index.template.html` | Add `<div id="nav-row" class="nav-row hidden">` above `#main-ui-direct`. Remove `<div id="group-cards-row">`. In group context: remove `<h2 id="group-context-name">`, `<div class="group-breadcrumb">`, and the override-toggle pill. Move the `<details id="group-context-actions">` into the chip row. |
| `css/app.css` | Add `.nav-row`, `.nav-current`, `.nav-back`, `.group-card.greyed` rules. Apply `#app-header`-style surface band to `.group-context-header`. Set `#app-header` `top` to sit below the sticky nav row. Remove `.group-cards-row`, `.group-cards-plus`, `.group-cards-zero`, `.group-context-header-row` rules. |
| `js/groupNav.js` | Replace `initCardsRow` + `renderCardsRow` with `initNavRow` + `renderNavRow` rendering to `#nav-row`. Internal `onContextChange` listener drives re-renders. Group mode renders Direct back-link + chain SVG icon + group name. Direct mode renders Direct + groups + plus. |
| `js/groupContext.js` | Remove h2 + breadcrumb wiring. Remove the override-toggle pill click handler. Settings dismissal logic adapts to the new chip placement (still uses outside-tap + option-activation behaviors from `6db617e`). |
| `js/app.js` | Replace `initCardsRow()` with `initNavRow()` call. Wire the nav-row hide-during-overlays toggle. |
| `tests/groupNav.test.js` | Major updates: existing tests reference `#group-cards-row`, `#group-cards-plus`, `#group-cards-zero`. Replace setup DOM. Add tests for new Direct-mode render, group-mode render, chain icon click, border-color status indicator. |
| `tests/groupContext.test.js` | Remove `<h2 id="group-context-name">` from `setupContextDom`. Remove tests that rely on it. Drop existing override-toggle-pill tests (toggle is now in nav). Add Settings-chip tests. |
| `docs/HANDOFF.md` | Refresh to reflect the redesign. |

**No new files.**

---

## Conventions for this plan

Same as Phase 0 / Phase 1 / Phase 2:

- **Test runner:** `npx jest <path>` from repo root.
- **Local dev:** `npm run dev`. **Build:** `node scripts/dev-build.js`.
- **Commit messages:** `type: subject` first line + body. Use `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`. Body explains the why.
- **One commit per task** unless a task explicitly says otherwise.
- **TDD discipline:** failing test first, run to confirm the failure mode, then implement.

**Baseline before Task 1:** 629 tests passing.

---

## Task 1: Markup restructure

Restructure `index.template.html` to (a) add the new `<div id="nav-row">` above the current `#main-ui-direct`, (b) remove `<div id="group-cards-row">`, (c) remove `<h2 id="group-context-name">` and the entire `<div class="group-breadcrumb">` block, (d) delete the `<div class="group-context-header-row">` wrapper introduced in commit `6db617e`, (e) move the `<details id="group-context-actions">` into the chip row alongside the time chip, (f) delete the `<button id="group-override-toggle" class="chip override-toggle">` pill from the chip row.

The result: `<header class="group-context-header">` contains only `#group-header-row` (dot + status + chips) — no h2, no breadcrumb, no separate header-row wrapper.

**Files:**
- Modify: `index.template.html`

- [ ] **Step 1: Add the nav row above `#main-ui-direct`**

In `index.template.html`, find the line `<div id="main-ui-direct">` (around line 139). Immediately before it, insert:

```html
  <div id="nav-row" class="nav-row hidden">
    <!-- Populated by js/groupNav.js. Direct context: Direct + groups + plus.
         Group context: Direct (back) + chain icon override toggle + group name. -->
  </div>
```

- [ ] **Step 2: Remove the existing `#group-cards-row`**

Find this block in `index.template.html` (around line 182):

```html
    <div id="group-cards-row" class="group-cards-row hidden">
      <!-- Populated by groupNav.js. One .group-card per group; trailing #group-cards-plus button. -->
    </div>
```

Delete the entire block.

- [ ] **Step 3: Restructure the group-context header**

Find the `<div id="group-context-root">` block (around line 209). Replace the whole `<div id="group-context-root">` ... `</div>` opening through `<ul id="group-roster">` content with:

```html
  <div id="group-context-root" class="group-context-root hidden">
    <header class="group-context-header">
      <div id="group-header-row" class="group-header-row">
        <div id="group-my-dot" class="dot" data-available="false"></div>
        <div class="group-header-text">
          <div class="group-header-status-row">
            <span id="group-my-status-label" class="status-label">Unavailable</span>
            <span id="group-time-remaining" style="display:none"></span>
          </div>
          <div class="group-header-chips">
            <button id="group-time-chip" class="chip time-chip">2 hours</button>
            <details id="group-context-actions" class="group-context-actions">
              <summary class="chip">Settings</summary>
              <div class="group-actions-menu">
                <button id="group-action-rename" class="ghost-btn hidden">Rename group</button>
                <button id="group-action-invite" class="ghost-btn hidden">Invite link</button>
                <button id="group-action-delete" class="ghost-btn hidden">Delete group</button>
                <button id="group-action-edit-name" class="ghost-btn hidden">Edit my name</button>
                <button id="group-action-leave" class="ghost-btn hidden">Leave group</button>
              </div>
            </details>
          </div>
        </div>
      </div>
    </header>
    <ul id="group-roster" class="group-roster"></ul>
  </div>
```

Key deletions confirmed:
- No `<h2 id="group-context-name">` — group name lives in the nav row.
- No `<div class="group-breadcrumb">` — replaced by the `Direct` back-link in the nav row.
- No `<button id="group-override-toggle" class="chip override-toggle">` — replaced by the chain icon in the nav row.
- No `<div class="group-context-header-row">` wrapper — header simplified.

- [ ] **Step 4: Run the build to confirm markup compiles**

Run: `node scripts/dev-build.js`
Expected: `Build complete: dist/bundle.js + index.html ...`. No build errors.

- [ ] **Step 5: Run the test suite (expect failures — that's intentional, fixed in later tasks)**

Run: `npx jest 2>&1 | tail -10`
Expected: failures in `tests/groupNav.test.js` and `tests/groupContext.test.js` that reference the removed elements. The plan resolves these in Tasks 5–7. Confirm only those two suites are red and the failure messages reference the removed IDs (e.g., "Cannot read properties of null (reading 'classList')" or similar).

- [ ] **Step 6: Commit**

```bash
git add index.template.html
git commit -m "$(cat <<'EOF'
refactor: reshape index.template.html for nav-redesign markup

Add <div id="nav-row"> above #main-ui-direct (populated by
js/groupNav.js per task 3+). Remove the old #group-cards-row (the
nav row supersedes it). In group context: drop the breadcrumb block,
drop the <h2 id="group-context-name"> (the nav carries the name),
drop the .group-context-header-row wrapper, drop the
#group-override-toggle pill (chain icon in the nav replaces it).
Move <details id="group-context-actions"> into the chip row
alongside the time chip; its <summary> becomes a chip-styled
button.

Tests will be red on jest until tasks 5-7 update them — committing
this scaffold first keeps each task focused.
EOF
)"
```

---

## Task 2: CSS scaffold for the nav row + group-context header band

Add the new `.nav-row`, `.nav-current`, `.nav-back`, and `.group-card.greyed` rules. Apply `#app-header`-style surface band to `.group-context-header` so the group's own-availability section visually matches Direct's. Set `#app-header` `top` to `3rem` so it sits below the sticky nav row. Remove the now-obsolete `.group-cards-row`, `.group-cards-plus`, `.group-cards-zero`, and `.group-context-header-row` CSS rules.

**Files:**
- Modify: `css/app.css`

- [ ] **Step 1: Remove the obsolete `.group-cards-*` and `.group-context-header-row` rules**

Find and delete the following rule blocks in `css/app.css`:

```css
.group-cards-row {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding: 0.5rem 1rem 0.25rem;
  margin-bottom: 0;
}
```

```css
.group-cards-plus {
  flex: 0 0 auto;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--text-muted);
  border: 1px dashed var(--text-muted);
  cursor: pointer;
  font-size: 0.9rem;
}
```

```css
.group-cards-zero {
  flex: 1;
  text-align: center;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: transparent;
  border: 1px dashed var(--text-muted);
  color: var(--text-muted);
  cursor: pointer;
}
```

```css
.group-context-header-row {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
}
```

Note: keep `.group-card`, `.group-card.active`, and `.group-card-badge` — the nav reuses `.group-card` styling.

- [ ] **Step 2: Add the nav-row rules**

After the `#app-header` block (around line 466), add:

```css
.nav-row {
  position: sticky;
  top: 0;
  z-index: 101;
  background: var(--surface);
  padding: 0.5rem 1rem;
  border-bottom: 1px solid var(--surface2);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  overflow-x: auto;
  scrollbar-width: none;
}
.nav-row::-webkit-scrollbar { display: none; }
.nav-row.hidden { display: none; }
.nav-current {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text);
  background: transparent;
  border: none;
  cursor: default;
  padding: 0.25rem 0.5rem;
  flex-shrink: 0;
}
.nav-back {
  font-size: 0.9rem;
  font-weight: normal;
  color: var(--text-muted);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  flex-shrink: 0;
}
.nav-back:hover { color: var(--text); }
.nav-current-truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
  min-width: 0;
}
.nav-row .group-card {
  max-width: 8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 2px solid transparent;
}
.nav-row .group-card.greyed {
  color: var(--text-muted);
}
.nav-row .group-cards-plus {
  flex: 0 0 auto;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--text-muted);
  border: 1px dashed var(--text-muted);
  cursor: pointer;
  font-size: 0.9rem;
}
#group-override-toggle {
  background: transparent;
  border: none;
  color: var(--text);
  cursor: pointer;
  padding: 0.25rem;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
#group-override-toggle svg {
  width: 20px;
  height: 20px;
  display: block;
}
```

- [ ] **Step 3: Apply surface-band styling to `.group-context-header`**

Replace the existing `.group-context-header` rule in `css/app.css`:

```css
.group-context-header { display: flex; flex-direction: column; align-items: stretch; margin-bottom: 0.75rem; }
```

with:

```css
.group-context-header {
  background: var(--surface);
  padding: 1rem;
  border-bottom: 1px solid var(--surface2);
  margin-bottom: 0;
}
```

This mirrors `#app-header`'s surface band so the group's own-availability section visually matches Direct's.

- [ ] **Step 4: Push `#app-header` and `.group-context-header` below the sticky nav row**

Modify the existing `#app-header` rule. Currently:

```css
#app-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--surface);
  padding: 1rem;
  border-bottom: 1px solid var(--surface2);
}
```

Change `top: 0` to `top: 3rem` (clears the sticky nav row above it).

Also remove the obsolete `.group-context-root { padding: 0.75rem; }` rule and replace with:

```css
.group-context-root { padding: 0; }
```

(The header band now provides its own padding; the roster inside has its own margin via `.group-roster-row` from `011ab3a`.)

- [ ] **Step 5: Remove the obsolete breadcrumb CSS**

Find and delete in `css/app.css`:

```css
.group-breadcrumb { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
.group-breadcrumb-back {
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
}
.group-breadcrumb-name { color: var(--text-muted); }
```

- [ ] **Step 6: Build to confirm CSS is syntactically clean**

Run: `node scripts/dev-build.js`
Expected: success. (CSS isn't validated by the build, but markup that references removed classes won't crash either; this is a sanity check.)

- [ ] **Step 7: Commit**

```bash
git add css/app.css
git commit -m "$(cat <<'EOF'
style: CSS scaffold for the nav row + group-context surface band

Add .nav-row sticky-top rules (positioned above #app-header, which
moves to top: 3rem to clear it). Add .nav-current (1.25rem 700) for the
current-context label and .nav-back (0.9rem normal text-muted) for the
back-link. Add .nav-row .group-card max-width + ellipsis truncation
and .greyed text class for unavailable groups.

Apply #app-header's surface-band treatment (var(--surface) bg + 1px
bottom border) to .group-context-header so the group's own-availability
section visually matches Direct.

Remove obsolete .group-cards-row, .group-cards-plus, .group-cards-zero,
.group-context-header-row, .group-breadcrumb*, and the
.group-context-root padding (which the header band supersedes).
EOF
)"
```

---

## Task 3: groupNav.js — `renderNavRow` in Direct mode

Replace the existing `initCardsRow` + `renderCardsRow` exports with `initNavRow` + `renderNavRow`. The new render targets `#nav-row` and produces, in Direct mode: `Direct` (using `.nav-current`) + each enumerated group (using `.group-card`) + `+` (using `.group-cards-plus`). Group ordering: `Direct` pinned left, groups by `lastVisited desc`, `+` trailing right. The CTA copy "Create your first group" is gone — `+` is always present.

`renderNavRow` also branches on context: in group mode it renders Direct back-link + a placeholder for the chain icon (added in Task 6) + the group name. This task scaffolds both modes; the chain icon SVG comes in Task 6.

**Files:**
- Modify: `js/groupNav.js`
- Modify: `tests/groupNav.test.js`

- [ ] **Step 1: Write failing tests in `tests/groupNav.test.js`**

Replace the test file's existing setup DOM (look for `#group-cards-row` references). The new setup uses `#nav-row`:

```js
function setupNavDom() {
  document.body.innerHTML = `
    <div id="nav-row" class="nav-row hidden"></div>
    <div id="main-ui-direct"></div>
    <div id="group-context-root" class="hidden"></div>
    <div id="create-group-modal" class="hidden"></div>
  `;
}
```

Find every place that currently calls a different setup helper or inlines the old markup — replace with `setupNavDom()` in the `beforeEach`.

Rewrite the existing render tests around the new shape. Replace whatever the file currently has for the basic-render block with:

```js
describe('renderNavRow — Direct mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupNavDom();
  });

  test('Direct context with no groups renders Direct + plus only', () => {
    db.watchUserGroups.mockImplementation(() => () => {});
    db.watchGroupMeta.mockImplementation(() => () => {});
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    const row = document.getElementById('nav-row');
    const items = row.querySelectorAll('.nav-current, .group-card, .group-cards-plus');
    expect(items.length).toBe(2);
    expect(items[0].classList.contains('nav-current')).toBe(true);
    expect(items[0].textContent).toBe('Direct');
    expect(items[1].classList.contains('group-cards-plus')).toBe(true);
    expect(items[1].textContent).toBe('+');
  });

  test('Direct context with two groups renders Direct + lastVisited order + plus', () => {
    let enumCb, metaCb1, metaCb2;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    const metaCbs = {};
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCbs[groupId] = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 100 }, G2: { lastVisited: 200 } });
    metaCbs.G1({ name: 'Work', ownerId: 'me', createdAt: 1 });
    metaCbs.G2({ name: 'Family', ownerId: 'me', createdAt: 2 });
    const row = document.getElementById('nav-row');
    const items = row.querySelectorAll('.nav-current, .group-card, .group-cards-plus');
    expect(items.length).toBe(4);
    expect(items[0].textContent).toBe('Direct');
    // G2 has higher lastVisited, comes before G1.
    expect(items[1].textContent).toBe('Family');
    expect(items[1].dataset.groupId).toBe('G2');
    expect(items[2].textContent).toBe('Work');
    expect(items[2].dataset.groupId).toBe('G1');
    expect(items[3].textContent).toBe('+');
  });

  test('Tapping a group card navigates to that group', () => {
    let enumCb, metaCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    db.setCurrentContext.mockResolvedValue(undefined);
    db.setLastVisited.mockResolvedValue(undefined);
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    document.querySelector('.group-card[data-group-id="G1"]').click();
    expect(db.setCurrentContext).toHaveBeenCalledWith('me', 'group:G1');
  });

  test('Tapping the + button emits a create-group request', () => {
    db.watchUserGroups.mockImplementation(() => () => {});
    db.watchGroupMeta.mockImplementation(() => () => {});
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    const handler = jest.fn();
    onCreateRequested(handler);
    document.querySelector('.group-cards-plus').click();
    expect(handler).toHaveBeenCalled();
  });

  test('Tapping Direct in Direct context is a no-op (no setCurrentContext call)', () => {
    db.watchUserGroups.mockImplementation(() => () => {});
    db.watchGroupMeta.mockImplementation(() => () => {});
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    db.setCurrentContext.mockResolvedValue(undefined);
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    document.querySelector('.nav-current').click();
    expect(db.setCurrentContext).not.toHaveBeenCalled();
  });
});
```

Update the file's top-level requires to import the new exports:

```js
const { initNav, initNavRow, startCardsRowSubscriptions, onContextChange, onCreateRequested } = require('../js/groupNav');
```

- [ ] **Step 2: Run tests; verify failure**

Run: `npx jest tests/groupNav.test.js -t 'renderNavRow' 2>&1 | tail -15`
Expected: FAIL — `initNavRow is not a function` (the function doesn't exist yet).

- [ ] **Step 3: Replace `initCardsRow` + `renderCardsRow` in `js/groupNav.js`**

Find the existing `export function initCardsRow()` block (around line 74) and replace through the end of `renderCardsRow` (around line 161) with:

```js
export function initNavRow() {
  const row = document.getElementById('nav-row');
  if (!row) return;
  if (!GROUPS_ENABLED) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');
  renderNavRow();
  // Re-render whenever the active context changes.
  onContextChange(() => renderNavRow());
}

export function renderNavRow() {
  const row = document.getElementById('nav-row');
  if (!row) return;
  if (!GROUPS_ENABLED) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');
  row.innerHTML = '';

  if (_state.context === 'group') {
    renderNavRowGroupMode(row);
  } else {
    renderNavRowDirectMode(row);
  }
}

function renderNavRowDirectMode(row) {
  const current = document.createElement('button');
  current.className = 'nav-current';
  current.textContent = 'Direct';
  current.addEventListener('click', () => { /* no-op — already in Direct */ });
  row.appendChild(current);

  const groupIds = Object.keys(_enumeration);
  const sorted = groupIds.slice().sort((a, b) => {
    const va = _enumeration[a]?.lastVisited ?? 0;
    const vb = _enumeration[b]?.lastVisited ?? 0;
    return vb - va;
  });

  for (const groupId of sorted) {
    const meta = _metaByGroupId[groupId];
    const name = meta?.name || groupId;
    const card = document.createElement('button');
    card.className = 'group-card';
    card.dataset.groupId = groupId;
    card.textContent = name;
    card.addEventListener('click', () => navigateToGroup(groupId));
    row.appendChild(card);
  }

  const plus = document.createElement('button');
  plus.className = 'group-cards-plus';
  plus.textContent = '+';
  plus.title = 'Create a new group';
  plus.addEventListener('click', () => emitCreateRequest());
  row.appendChild(plus);
}

function renderNavRowGroupMode(row) {
  const groupId = _state.groupId;
  const meta = _metaByGroupId[groupId];
  const name = meta?.name || _lastKnownNames[groupId] || groupId;

  const back = document.createElement('button');
  back.className = 'nav-back';
  back.textContent = 'Direct';
  back.addEventListener('click', () => navigateToDirect());
  row.appendChild(back);

  // Placeholder slot for the chain-icon override toggle. Task 6 fills this in.
  const toggleSlot = document.createElement('span');
  toggleSlot.id = 'group-override-toggle-slot';
  row.appendChild(toggleSlot);

  const current = document.createElement('span');
  current.className = 'nav-current nav-current-truncate';
  current.textContent = name;
  row.appendChild(current);
}
```

Update the existing default export named-import block at the top of the file. The file currently imports things — make sure no imports are deleted. The change is purely replacing the two old functions; subscriptions (`startCardsRowSubscriptions`, `syncMetaSubs`) remain.

Inside `syncMetaSubs`, find every call to `renderCardsRow(_enumeration, _metaByGroupId)` and change to `renderNavRow()`. Inside `startCardsRowSubscriptions`, do the same.

Also, replace the existing watchStatus(_myUserId) subscription callback's `renderCardsRow(...)` call with `renderNavRow()`.

- [ ] **Step 4: Update `js/app.js` to call `initNavRow` instead of `initCardsRow`**

In `js/app.js`, find the import line that references `initCardsRow` and change it to `initNavRow`:

```js
import { initNav, startCardsRowSubscriptions, initNavRow, onContextChange, applyServerCurrentContext, navigateToGroup } from './groupNav.js';
```

Find the call site (currently `initCardsRow()`) and change to `initNavRow()`.

- [ ] **Step 5: Run tests; expect Direct-mode tests pass**

Run: `npx jest tests/groupNav.test.js -t 'renderNavRow' 2>&1 | tail -10`
Expected: PASS on the 5 new Direct-mode tests.

- [ ] **Step 6: Run full suite; many failures still expected**

Run: `npx jest 2>&1 | tail -10`
Expected: failures still in `tests/groupContext.test.js` (since the markup changed in Task 1). Some `tests/groupNav.test.js` test cases that pre-dated this redesign may still fail until Task 5 cleans them up.

- [ ] **Step 7: Commit**

```bash
git add js/groupNav.js js/app.js tests/groupNav.test.js
git commit -m "$(cat <<'EOF'
feat: groupNav.js renders the new persistent nav row in Direct mode

Replace initCardsRow/renderCardsRow with initNavRow/renderNavRow.
Direct mode renders: Direct (large/bold via .nav-current) + each
enumerated group (.group-card sorted by lastVisited desc) + the +
button (always, no more zero-state CTA copy). renderNavRow branches
on _state.context — group mode is scaffolded (Direct back-link +
toggle-slot placeholder + group name) and filled in by Task 6's
chain-icon wiring.

renderNavRow auto-re-renders on onContextChange, so switching contexts
re-paints the row without explicit caller wiring.

js/app.js wires the renamed initNavRow() call.
EOF
)"
```

---

## Task 4: Border color + greyed text per group in Direct nav

Apply the effective-status indicator to each `.group-card` in the Direct-context nav: a colored border when the user is effectively available in that group, no border + greyed text when unavailable. Falls back to a forest-green default when no `statusColor` is set (palettes disabled).

**Files:**
- Modify: `js/groupNav.js`
- Modify: `tests/groupNav.test.js`

- [ ] **Step 1: Write failing tests in `tests/groupNav.test.js`**

Replace the existing `'group cards own-override color reflection'` describe block (or add to it) with:

```js
describe('Direct nav per-group status indicator', () => {
  beforeEach(() => { jest.clearAllMocks(); setupNavDom(); });

  test('card with effective available status shows a colored border (primary)', () => {
    let enumCb, metaCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    statusCb({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000, statusColor: '#11aaff' });
    const card = document.querySelector('.group-card[data-group-id="G1"]');
    expect(card.style.borderColor).toMatch(/#11aaff|rgb\(17,\s*170,\s*255\)/i);
    expect(card.classList.contains('greyed')).toBe(false);
  });

  test('card with effective available status and no statusColor falls back to forest green', () => {
    let enumCb, metaCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    statusCb({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 });
    const card = document.querySelector('.group-card[data-group-id="G1"]');
    expect(card.style.borderColor).toMatch(/#22c55e|rgb\(34,\s*197,\s*94\)/i);
  });

  test('card with override enabled+available uses override color over primary', () => {
    let enumCb, metaCb, overrideCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    statusCb({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000, statusColor: '#ff0000' });
    overrideCb({ enabled: true, status: 'available', availableUntil: Date.now() + 30 * 60 * 1000, statusColor: '#00ff00' });
    const card = document.querySelector('.group-card[data-group-id="G1"]');
    expect(card.style.borderColor).toMatch(/#00ff00|rgb\(0,\s*255,\s*0\)/i);
  });

  test('card with effective unavailable status has no border and greyed class', () => {
    let enumCb, metaCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    statusCb({ status: 'unavailable', availableUntil: null });
    const card = document.querySelector('.group-card[data-group-id="G1"]');
    expect(card.style.borderColor).toBe('');
    expect(card.classList.contains('greyed')).toBe(true);
  });

  test('card with override enabled+unavailable has no border and greyed (override masks available primary)', () => {
    let enumCb, metaCb, overrideCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    statusCb({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000, statusColor: '#ff0000' });
    overrideCb({ enabled: true, status: 'unavailable', availableUntil: null });
    const card = document.querySelector('.group-card[data-group-id="G1"]');
    expect(card.style.borderColor).toBe('');
    expect(card.classList.contains('greyed')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests; verify failure**

Run: `npx jest tests/groupNav.test.js -t 'per-group status indicator' 2>&1 | tail -10`
Expected: FAIL — no border or greyed class is being applied yet.

- [ ] **Step 3: Implement the status-indicator logic in `renderNavRowDirectMode`**

In `js/groupNav.js`, update the per-card loop inside `renderNavRowDirectMode`. Replace this section:

```js
  for (const groupId of sorted) {
    const meta = _metaByGroupId[groupId];
    const name = meta?.name || groupId;
    const card = document.createElement('button');
    card.className = 'group-card';
    card.dataset.groupId = groupId;
    card.textContent = name;
    card.addEventListener('click', () => navigateToGroup(groupId));
    row.appendChild(card);
  }
```

with:

```js
  for (const groupId of sorted) {
    const meta = _metaByGroupId[groupId];
    const name = meta?.name || groupId;
    const card = document.createElement('button');
    card.className = 'group-card';
    card.dataset.groupId = groupId;
    card.textContent = name;

    // Effective-status indicator: prefer override (when enabled), else primary.
    const ov = _overrideByGroupId[groupId];
    const overrideOn = !!(ov && ov.enabled === true);
    const source = overrideOn ? ov : _ownPrimary;
    const isAvailable = source?.status === 'available'
      && (source.availableUntil == null || source.availableUntil > Date.now());
    if (isAvailable) {
      const color = source.statusColor || '#22c55e';
      card.style.borderColor = safeCssColor(color);
    } else {
      card.classList.add('greyed');
    }

    card.addEventListener('click', () => navigateToGroup(groupId));
    row.appendChild(card);
  }
```

- [ ] **Step 4: Run tests; verify pass**

Run: `npx jest tests/groupNav.test.js -t 'per-group status indicator' 2>&1 | tail -10`
Expected: PASS on all 5 new tests.

- [ ] **Step 5: Commit**

```bash
git add js/groupNav.js tests/groupNav.test.js
git commit -m "$(cat <<'EOF'
feat: Direct nav per-group border-color status indicator

Each .group-card in the Direct-context nav now reflects the user's
effective status for that group. Effective = override when
enabled===true, else primary. When available, the card gets a
border-color equal to (override.statusColor || primary.statusColor ||
'#22c55e'). When unavailable, no border and the .greyed class drops
the name color to var(--text-muted).

Spec calls for "forest green" as the no-palette default; #22c55e
matches the existing --green token.
EOF
)"
```

---

## Task 5: `renderNavRow` group mode wiring + groupContext test fixture refresh

Group mode currently renders a placeholder for the chain icon. This task validates the group-mode render shape (Direct back-link + slot + group name) with tests, and refreshes `tests/groupContext.test.js`'s `setupContextDom` to match Task 1's markup so its existing tests can run.

**Files:**
- Modify: `tests/groupNav.test.js`
- Modify: `tests/groupContext.test.js`

- [ ] **Step 1: Add group-mode tests to `tests/groupNav.test.js`**

Append a new describe block:

```js
describe('renderNavRow — group mode', () => {
  beforeEach(() => { jest.clearAllMocks(); setupNavDom(); });

  test('group mode renders Direct (back) + chain icon slot + group name', () => {
    let enumCb, metaCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    db.setCurrentContext.mockResolvedValue(undefined);
    db.setLastVisited.mockResolvedValue(undefined);
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    navigateToGroup('G1');
    const row = document.getElementById('nav-row');
    expect(row.querySelector('.nav-back')).not.toBeNull();
    expect(row.querySelector('.nav-back').textContent).toBe('Direct');
    expect(row.querySelector('#group-override-toggle-slot')).not.toBeNull();
    const current = row.querySelector('.nav-current');
    expect(current).not.toBeNull();
    expect(current.textContent).toBe('Family');
    expect(current.classList.contains('nav-current-truncate')).toBe(true);
  });

  test('Tapping Direct back-link in group mode navigates to Direct', () => {
    let enumCb, metaCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation(() => () => {});
    db.watchStatus.mockImplementation(() => () => {});
    db.setCurrentContext.mockResolvedValue(undefined);
    db.setLastVisited.mockResolvedValue(undefined);
    initNav('me');
    initNavRow();
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    navigateToGroup('G1');
    document.querySelector('.nav-back').click();
    expect(db.setCurrentContext).toHaveBeenCalledWith('me', 'direct');
  });
});
```

Update the require destructure at the top of the file to include `navigateToGroup`:

```js
const { initNav, initNavRow, startCardsRowSubscriptions, navigateToGroup, onCreateRequested } = require('../js/groupNav');
```

- [ ] **Step 2: Refresh `tests/groupContext.test.js`'s `setupContextDom`**

Replace the entire `setupContextDom` function in `tests/groupContext.test.js` with:

```js
function setupContextDom() {
  document.body.innerHTML = `
    <div id="nav-row"></div>
    <div id="main-ui-direct"></div>
    <div id="group-context-root" class="group-context-root hidden">
      <header class="group-context-header">
        <div id="group-header-row">
          <div id="group-my-dot" class="dot" data-available="false"></div>
          <div class="group-header-text">
            <div class="group-header-status-row">
              <span id="group-my-status-label" class="status-label">Unavailable</span>
              <span id="group-time-remaining" style="display:none"></span>
            </div>
            <div class="group-header-chips">
              <button id="group-time-chip" class="chip time-chip">2 hours</button>
              <details id="group-context-actions">
                <summary class="chip">Settings</summary>
                <div class="group-actions-menu">
                  <button id="group-action-rename" class="hidden">Rename group</button>
                  <button id="group-action-invite" class="hidden">Invite link</button>
                  <button id="group-action-delete" class="hidden">Delete group</button>
                  <button id="group-action-edit-name" class="hidden">Edit my name</button>
                  <button id="group-action-leave" class="hidden">Leave group</button>
                </div>
              </details>
            </div>
          </div>
        </div>
      </header>
      <ul id="group-roster"></ul>
    </div>
  `;
}
```

Then find every test that does `expect(document.getElementById('group-context-name').textContent).toBe(...)` and remove or rewrite. Example: the test currently named `'enterGroupContext renders the breadcrumb name and header name on watchGroupMeta tick'` — replace its body (it currently asserts on `#group-breadcrumb-name` and `#group-context-name`) with a simpler check that confirms the meta callback fires without crashing:

```js
  test('watchGroupMeta tick does not throw when h2 and breadcrumb are absent', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    expect(() => metaCb({ name: 'Family', ownerId: 'owner', createdAt: 1 })).not.toThrow();
  });
```

Also find the existing test `'breadcrumb back button calls navigateToDirect'` and delete it (the breadcrumb no longer exists; the nav-row back-link is tested in Task 5 Step 1).

Drop the existing tests that target the `<button id="group-override-toggle" class="chip override-toggle">` pill — there are several in the `'own status row'` describe block (search for `group-override-toggle`). Specifically:
- `'toggle pill reflects override.enabled'`
- `'clicking the toggle when OFF calls toggleStatusOverride with true'`
- `'clicking the toggle when ON calls toggleStatusOverride with false'`
- `'re-entering the context does not double-wire the toggle'`

Delete these four tests. Task 6 reintroduces equivalent coverage for the new chain icon.

- [ ] **Step 3: Run the full suite; expect green except for items the next tasks address**

Run: `npx jest 2>&1 | tail -10`
Expected: most failures from Task 1's markup change should now be resolved. The chain-icon click handler test is not yet added (Task 6). Settings-chip dismissal tests already pass since the markup is in place. If there are unexpected failures, read the messages and adjust the fixture; do not invent new behavior.

- [ ] **Step 4: Commit**

```bash
git add tests/groupNav.test.js tests/groupContext.test.js
git commit -m "$(cat <<'EOF'
test: refresh fixtures for nav-redesign markup

tests/groupNav.test.js: setupNavDom uses #nav-row; two new tests cover
the group-mode render shape (Direct back-link + toggle-slot + group
name with nav-current-truncate) and the back-link navigation.

tests/groupContext.test.js: setupContextDom drops the breadcrumb and
the h2 group-name; chip row now contains the Settings <details>.
Removes tests that asserted on the deleted breadcrumb/h2 markup and
the four override-toggle-pill tests (Task 6 replaces them with chain-
icon equivalents).
EOF
)"
```

---

## Task 6: Chain icon SVG + override toggle wiring in the nav

Insert the inline link/link-off SVG into the `#group-override-toggle-slot`. The button reflects override state via aria-pressed + the visible SVG. Tap toggles override. Optimistic update mirrors the existing `_ownOverride` update from commit `bb4107d`.

The chain icon lives in the nav row but its state comes from the group-context module's `_ownOverride` (the source of truth for the override). We need a small cross-module dance: the nav-row chain icon click handler calls `toggleStatusOverride(groupId, userId, ...)`; the existing `watchOwnMemberOverride` subscription in `groupContext.js` updates `_ownOverride`. To re-render the chain icon when override state changes, expose a small refresh hook from `groupContext.js` or have the nav row subscribe to its own `watchOwnMemberOverride` for the current group.

**Simpler approach:** the chain icon lives in `groupContext.js` since the override is its concern. `renderNavRow` group mode leaves the `#group-override-toggle-slot` placeholder; `enterGroupContext` populates it. `exitGroupContext` clears it.

**Files:**
- Modify: `js/groupContext.js`
- Modify: `tests/groupContext.test.js`

- [ ] **Step 1: Write failing tests in `tests/groupContext.test.js`**

Add a new describe block:

```js
describe('chain-icon override toggle', () => {
  function captureCallbacks() {
    let metaCb, primaryCb, overrideCb;
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { primaryCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    return { getMetaCb: () => metaCb, getPrimaryCb: () => primaryCb, getOverrideCb: () => overrideCb };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    setupContextDom();
    // The nav row hosts the toggle slot the chain icon lives in.
    document.getElementById('nav-row').innerHTML =
      '<span id="group-override-toggle-slot"></span>';
  });

  test('enterGroupContext installs a chain-icon button in the toggle slot', () => {
    enterGroupContext('G1', 'me');
    const slot = document.getElementById('group-override-toggle-slot');
    const btn = slot.querySelector('#group-override-toggle');
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toMatch(/Set a unique status/i);
  });

  test('chain icon reflects override.enabled=true via aria-pressed=true', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    const btn = document.getElementById('group-override-toggle');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-label')).toMatch(/Stop using a unique status/i);
  });

  test('tapping the chain icon calls toggleStatusOverride with the inverted state', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()(null);
    document.getElementById('group-override-toggle').click();
    expect(groupsModule.toggleStatusOverride).toHaveBeenCalledWith('G1', 'me', true);
  });

  test('tapping the chain icon when override is ON calls toggleStatusOverride with false', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    document.getElementById('group-override-toggle').click();
    expect(groupsModule.toggleStatusOverride).toHaveBeenCalledWith('G1', 'me', false);
  });

  test('chain icon click optimistically updates _ownOverride so dot click can fire immediately', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()(null);
    // 1. Tap toggle ON; do NOT fire override callback (simulating Firebase ack lag).
    document.getElementById('group-override-toggle').click();
    // 2. Immediately tap the dot. With the optimistic update, the dot handler
    //    should see override.enabled === true and write the available state.
    document.getElementById('group-my-dot').click();
    expect(groupsModule.setOverrideStatusAvailable).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests; verify failure**

Run: `npx jest tests/groupContext.test.js -t 'chain-icon' 2>&1 | tail -15`
Expected: FAIL — `#group-override-toggle` element doesn't exist; chain icon is not yet wired.

- [ ] **Step 3: Add chain-icon rendering + click wiring in `js/groupContext.js`**

At the top of `js/groupContext.js` (after the existing imports), add the SVG markup constants:

```js
// Tabler Icons "link" and "link-off" (MIT licensed). Inlined as strings.
const SVG_LINK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l6 -6"/><path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464"/><path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463"/></svg>';
const SVG_LINK_OFF = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l3 -3"/><path d="M14 8l1.45 -1.485a4.973 4.973 0 0 1 6.998 .035a4.973 4.973 0 0 1 0 6.93l-2.45 2.52"/><path d="M16 12l-1.55 1.553a4.97 4.97 0 0 0 -1.45 3.5a4.97 4.97 0 0 0 1.45 3.502a4.973 4.973 0 0 0 6.998 -.035"/><path d="M3 3l18 18"/></svg>';
```

Add a render helper. Find `renderOwnStatusRow()` and immediately after it, add:

```js
function renderOverrideToggleIcon() {
  const btn = document.getElementById('group-override-toggle');
  if (!btn) return;
  const overrideOn = !!(_ownOverride && _ownOverride.enabled === true);
  // Inverted semantics: solid chain = override OFF (linked to primary);
  // broken chain = override ON (status independent for this group).
  btn.innerHTML = overrideOn ? SVG_LINK_OFF : SVG_LINK;
  btn.setAttribute('aria-pressed', overrideOn ? 'true' : 'false');
  btn.setAttribute('aria-label', overrideOn
    ? 'Stop using a unique status for this group'
    : 'Set a unique status for this group');
}
```

In `enterGroupContext`, find the existing override-toggle pill wiring block (the `// Wire the override toggle (replace via clone to drop any prior listener)` section installed earlier) and replace it with:

```js
  // Install the chain icon button in the nav row's override-toggle slot.
  const slot = document.getElementById('group-override-toggle-slot');
  if (slot) {
    slot.innerHTML = '<button id="group-override-toggle" type="button"></button>';
    const btn = document.getElementById('group-override-toggle');
    btn.addEventListener('click', () => {
      const nextEnabled = !(_ownOverride && _ownOverride.enabled === true);
      // Optimistic update — mirror commit bb4107d's pattern so a follow-up
      // dot/chip tap isn't gated on Firebase ack.
      _ownOverride = nextEnabled
        ? { enabled: true, status: 'unavailable', availableUntil: null }
        : null;
      renderOwnStatusRow();
      renderOverrideToggleIcon();
      toggleStatusOverride(groupId, userId, nextEnabled).catch(() => {});
    });
    renderOverrideToggleIcon();
  }
```

In the existing `watchOwnMemberOverride` callback in `enterGroupContext`, after `renderOwnStatusRow();`, also call `renderOverrideToggleIcon();`:

```js
  _ownOverrideUnsub = watchOwnMemberOverride(groupId, userId, (data) => {
    _ownOverride = data || null;
    renderOwnStatusRow();
    renderOverrideToggleIcon();
  });
```

In `exitGroupContext`, clear the nav slot. Add this line near the other teardowns:

```js
  const slot = document.getElementById('group-override-toggle-slot');
  if (slot) slot.innerHTML = '';
```

- [ ] **Step 4: Run tests; verify pass**

Run: `npx jest tests/groupContext.test.js -t 'chain-icon' 2>&1 | tail -10`
Expected: PASS on all 5 chain-icon tests.

- [ ] **Step 5: Run the full suite**

Run: `npx jest 2>&1 | tail -6`
Expected: green. (If any roster or own-status tests are still red, address them inline before committing — but the prior cleanup in Task 5 should have covered them.)

- [ ] **Step 6: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "$(cat <<'EOF'
feat: chain-icon override toggle in the nav row

Render an inline SVG button into #group-override-toggle-slot when the
user is in a group context. Inverted semantics per spec: solid chain
(Tabler "link") = override OFF (user is linked to their primary);
broken chain (Tabler "link-off") = override ON. aria-pressed and
aria-label flip on state change for screen readers.

Click handler mirrors the optimistic-update pattern from commit
bb4107d so a follow-up tap on the dot/chip isn't gated by Firebase
ack. The existing toggleStatusOverride writer is reused — no new
db.js exports.

watchOwnMemberOverride's callback now also calls
renderOverrideToggleIcon so the chain icon updates on cross-device
syncs.
EOF
)"
```

---

## Task 7: Group context body cleanup — remove obsolete h2 + breadcrumb wiring

Delete the dead `js/groupContext.js` code that wrote to the now-removed `<h2 id="group-context-name">` and the `#group-breadcrumb-name`/`#group-breadcrumb-back`. The Settings dismissal logic is unchanged (the `<details>` is still the same element, just placed differently in markup) but verify it still works.

**Files:**
- Modify: `js/groupContext.js`
- Modify: `tests/groupContext.test.js`

- [ ] **Step 1: Remove breadcrumb wiring in `enterGroupContext`**

In `js/groupContext.js`, find this block in `enterGroupContext`:

```js
  // Wire the breadcrumb back button (replace via clone to drop any prior listener)
  const back = document.getElementById('group-breadcrumb-back');
  if (back) {
    const clone = back.cloneNode(true);
    back.parentNode.replaceChild(clone, back);
    clone.addEventListener('click', () => navigateToDirect());
  }
```

Delete the entire block.

- [ ] **Step 2: Remove h2 + breadcrumb name writes in the `watchGroupMeta` callback**

In `js/groupContext.js`, find the watchGroupMeta callback inside `enterGroupContext` (around line 467). It currently writes to `#group-context-name` and `#group-breadcrumb-name`. Replace these lines:

```js
    const nameEl = document.getElementById('group-context-name');
    const crumbEl = document.getElementById('group-breadcrumb-name');
    if (nameEl) nameEl.textContent = meta.name || '';
    if (crumbEl) crumbEl.textContent = meta.name || '';
```

with: (nothing — delete these four lines)

The group name now lives only in the nav row, rendered by `groupNav.js`.

- [ ] **Step 3: Remove the now-unused `navigateToDirect` import if no other call site remains**

Check `grep -n "navigateToDirect" js/groupContext.js`. The action handlers (deleteGroup → navigateToDirect, leaveGroup → navigateToDirect) still use it. So the import stays. (Verify; if the only call sites are still there, no change.)

- [ ] **Step 4: Add a regression test in `tests/groupContext.test.js`**

Append to the existing `'groupContext scaffolding'` describe block:

```js
  test('enterGroupContext does not crash when h2 and breadcrumb are absent', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    expect(() => {
      enterGroupContext('G1', 'me');
      metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    }).not.toThrow();
  });
```

- [ ] **Step 5: Run the full suite**

Run: `npx jest 2>&1 | tail -6`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "$(cat <<'EOF'
refactor: drop obsolete breadcrumb + h2 wiring in groupContext

The breadcrumb back button and the <h2 id="group-context-name"> are
removed from the markup in Task 1; their JS writers (the clone-and-
replace back-button handler, and the watchGroupMeta callback's
textContent writes to #group-context-name / #group-breadcrumb-name)
are now dead. Delete them.

Group name presentation lives entirely in the nav row now, rendered
by js/groupNav.js. The breadcrumb back affordance is replaced by the
Direct nav-back button in group mode.
EOF
)"
```

---

## Task 8: Hide the nav row during full-viewport overlays

When the welcome, restore, stale, invite-failure, recovery, displayname, or create-group overlays are visible, the nav row is irrelevant and should not flash behind them. Add a small helper in `js/app.js` that toggles a `.hidden` class on `#nav-row` based on whether any overlay is open. The overlays themselves have `position: fixed; inset: 0` so the nav is hidden visually under them, but for clean DOM state we also hide it via CSS.

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Hide the nav at boot, show it after redemption / identity flows complete**

In `js/app.js`, find the `main()` function. Locate the call to `initNavRow()` (added in Task 3 Step 4). The current sequencing is fine — `initNavRow()` already calls `row.classList.remove('hidden')` to reveal it on init. The nav stays hidden via the markup's `class="nav-row hidden"` until `initNavRow` runs.

The remaining concern is overlays that appear AFTER initNavRow runs (e.g., the displayname overlay shown by `showGroupDisplayNamePrompt` for existing users joining a new group, or the invite-failure overlay). Per the spec, these are full-viewport and would visually obscure the nav anyway — no action needed for them.

Mark this task done with no code change required.

- [ ] **Step 2: Confirm overlays don't visually leak nav-row content**

Run: `node scripts/dev-build.js` and then open `index.html` locally. With the dev server running (`npm run dev`), verify that no overlay shows nav-row content peeking through. (This is the manual verification — Task 9 captures it more formally.)

- [ ] **Step 3: Commit (no-op)**

This task records the analysis above without a code change. Skip the commit.

---

## Task 9: End-to-end build + manual UI verification + test stability

A coordinated build + manual run + 3× test stability check before committing.

**Files:** none modified.

- [ ] **Step 1: Run the full test suite three times**

```bash
for i in 1 2 3; do npx jest 2>&1 | grep '^Tests:'; done
```

Expected: three identical lines reporting a stable test count (629 baseline + ~12–15 new from this plan = ~641–644). If any run produces a different count, surface the flake.

- [ ] **Step 2: Build verification**

```bash
node scripts/dev-build.js
```

Expected: `Build complete: dist/bundle.js + index.html ...`. No errors.

- [ ] **Step 3: Manual UI walkthrough (local dev server)**

```bash
npm run dev
```

Open the dev URL (typically `http://localhost:5000`). Walk these flows:

1. **Direct context with no groups:** Confirm nav shows `Direct  [+]` (large bold Direct, tiny dashed-border +). Tap `+` → create-group modal opens.
2. **Direct context with multiple groups:** Confirm nav shows `Direct  [Family]  [Work]  [+]`. Groups ordered by lastVisited desc.
3. **Available-with-color in Direct:** With dev's palette flag, if you have an available primary status, each group card shows a colored border. With no `statusColor`, the border falls back to forest green.
4. **Unavailable in Direct:** Each group card has no border and the name is greyed.
5. **Tap a group card:** Navigates into that group. Nav switches to `Direct  🔗  Family` (or equivalent). `Direct` is small/unbold; group name is large/bold.
6. **Tap chain icon:** Override flips ON. The icon should swap to broken chain. The "Set a unique status" pill is gone (replaced by Settings) — confirm. The dot becomes interactive (not readonly).
7. **Tap dot in group context:** Goes Available. The override status writes correctly. Tapping the dot a second time goes Unavailable.
8. **Tap Settings chip:** Menu drops down. Tap outside or tap an option → menu closes. Tap Rename → prompt; submit → group renamed (visible immediately in the nav row).
9. **Tap Direct in group nav:** Returns to Direct context.
10. **Cross-device sync:** With a second device on the same secret phrase, change override on one → confirm the chain icon flips on the other.

If any flow misbehaves, capture it as a follow-up; don't fix in this task.

- [ ] **Step 4: Commit a no-op marker (optional)**

If you want a marker commit so subsequent work has a clean base:

```bash
git commit --allow-empty -m "chore: nav-redesign verification checkpoint"
```

Otherwise skip the commit.

---

## Task 10: HANDOFF.md refresh

Update `docs/HANDOFF.md` to reflect the nav redesign on dev.

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Update §3 Code layout**

In the "Key JS modules" table, the entries for `groupNav.js` and `groupContext.js` reference the now-removed group-cards-row. Update them:

- `groupNav.js`: change *"Owns the group cards row at the top of Direct context and the create-group modal"* to *"Owns the persistent nav row (Direct + groups + plus in Direct context; Direct back + chain-icon slot + group name in group context) and the create-group modal."*
- `groupContext.js`: change the override-toggle reference from pill to chain icon. Add the line *"Override toggle is now rendered as an inline-SVG chain icon installed into the nav row's #group-override-toggle-slot at enter time."*

- [ ] **Step 2: Update §8 Layout & visual constraints**

Replace the bullet *"Direct context vs group context: the existing main UI is wrapped in `<div id="main-ui-direct">`. The group context view is `<div id="group-context-root">`. Only one is visible at a time, toggled by `groupContext.js`'s `enterGroupContext`/`exitGroupContext` based on `groupNav.onContextChange` listener."* with:

> Direct context vs group context: the existing main UI is wrapped in `<div id="main-ui-direct">`. The group context view is `<div id="group-context-root">`. A sticky `<div id="nav-row">` sits above both at all times (hidden by `.hidden` class until `initNavRow` runs). Only one of `#main-ui-direct` / `#group-context-root` is visible at a time, toggled by `groupContext.js`'s `enterGroupContext`/`exitGroupContext` based on `groupNav.onContextChange` listener; the nav row re-renders independently via its own `onContextChange` listener.

- [ ] **Step 3: Add a §11 entry for the redesign**

Add a new subsection:

```markdown
**Nav redesign (post-Phase-2) — shipped on dev:**

- Persistent sticky `#nav-row` replaces the old `#group-cards-row` strip that used to sit above the contact list.
- In Direct context: `Direct` (large/bold) + groups + `+`. Each group's card shows a status-colored border when the user is effectively available in that group; greyed name + no border when unavailable.
- In group context: `Direct` (small back-link) + chain-icon override toggle + group name (large/bold).
- Override toggle moved from a pill in the chip row to an inline-SVG chain icon in the nav. Inverted semantics: solid chain = override OFF (linked); broken chain = override ON.
- Group context body lost its h2 group name, its breadcrumb back button, and the override-toggle pill. Settings became a chip in the chip row.
- Spec: `docs/superpowers/specs/2026-05-28-nav-redesign-design.md`. Plan: `docs/superpowers/plans/2026-05-28-nav-redesign.md`.
```

- [ ] **Step 4: Update §17 reference artifacts**

Add a seventh entry:

```markdown
7. **`docs/superpowers/specs/2026-05-28-nav-redesign-design.md`** + **`docs/superpowers/plans/2026-05-28-nav-redesign.md`** — Nav redesign as shipped
```

- [ ] **Step 5: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "docs: refresh HANDOFF.md for the nav redesign"
```

---

## Done

When all tasks complete:

- **Tests passing:** ~641–644 across 20 suites (629 baseline + new tests added by this plan).
- **Build clean:** `node scripts/dev-build.js` succeeds.
- **Manual UI verification:** all flows in Task 9 Step 3 confirmed.
- **Markup:** new `#nav-row` element; deleted `#group-cards-row`, `<h2 id="group-context-name">`, `<div class="group-breadcrumb">`, `<div class="group-context-header-row">`, the override-toggle pill.
- **CSS:** new `.nav-row`, `.nav-current`, `.nav-back`, `.group-card.greyed`; surface-band on `.group-context-header`; `#app-header { top: 3rem; }`. Deleted `.group-cards-*` and `.group-breadcrumb*` rules.
- **JS:** `js/groupNav.js` renders via `initNavRow` + `renderNavRow` with Direct/Group branching; `js/groupContext.js` installs/clears the chain icon in the nav slot; old pill + h2 + breadcrumb wiring deleted.
- **HANDOFF.md** refreshed.

Use the `superpowers:finishing-a-development-branch` skill to integrate the work (PR → user merges to dev → user verifies live).
