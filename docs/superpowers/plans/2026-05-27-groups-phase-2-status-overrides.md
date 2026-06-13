# Groups Phase 2 — Per-Group Status Overrides — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ Superseded since shipping (updated 2026-06-13, [#217](https://github.com/tenorune/on/issues/217)).** This plan records Phase 2 *as originally planned*. Two scope decisions below were later outrun by the shipped code — the body is kept as the historical record, but the **current behavior** is:
> - **Per-audience color picker SHIPPED, not deferred.** The group-context palette picker (`renderGroupSwatchRow` + `applyAdoptedComboInGroup` / `setOverrideAppearance` in `js/groupContext.js` / `js/groups.js`) *does* write `statusOverride.statusColor` / `paletteKey`. (The plan's "No per-audience color picker / Phase 4+" decision no longer holds. The owner-level *group* color — Mode B/C — is the part still deferred; see groups spec §16 and [#218](https://github.com/tenorune/on/issues/218) G-B.)
> - **Toggle OFF *preserves* color/palette; it does not clear the whole record.** `toggleStatusOverride(OFF)` calls `mergeStatusOverride({ enabled: false, status: null, availableUntil: null })`, which keeps `statusColor` / `paletteKey` so an adopted color survives a toggle (the 2026-05-29 adoption behavior). `clearStatusOverride` still exists as a db primitive but is no longer the toggle-OFF path.

**Goal:** Ship per-**group** status overrides. A user can toggle "Set a unique status" inside any group's context. ON → that group's audience sees a status independent of the user's primary (defaults to Unavailable). OFF → that group inherits the primary status. The followers audience continues to see the primary status; no separate followers-audience override surface ships in this phase.

**Architecture:** Override data lives at the canonical `groups/{groupId}/members/{ownUid}/statusOverride` slot established in Phase 1's data model (spec §7). New `js/db.js` helpers set/clear the override and subscribe to own-member override per group. `js/groups.js` gains thin toggle + override-status wrappers. `js/groupContext.js` grows a new status row inside the group-context header (own dot + status label + time chip + override toggle), wired to override writes when toggle ON and read-only-mirror of primary when OFF. `js/groupNav.js`'s cards row reflects each card's own-override color (uses the user's primary `statusColor` as the Phase 2 fill; per-audience color picker is Phase 4+). The roster in `js/groupContext.js` renders each member's *context-appropriate* status: their override if `enabled === true`, else their primary from `watchStatus(uid)`.

**Tech Stack:** Vanilla ES modules, Firebase Realtime Database, esbuild, jest + jsdom. No security-rule changes (the existing wide-open `groups/$groupId` rule covers the override sub-path). No new dependencies. Phase 2 schema is forward-compatible with the spec's deferred `statusColor` / `paletteKey` fields — Phase 4+ can write them additively without migration.

**Spec reference:** `docs/superpowers/specs/2026-05-25-groups-design.md` (rev 2), specifically §4 (status model), §7 (`statusOverride` schema), §14 (cross-device sync), §16 Phase 2 deliverables.

**Scope decisions locked in upstream of this plan:**

- **No followers-audience override.** The primary status IS what direct followers see. The "Set a unique status" toggle ships per-group only; the symmetric "followers" toggle from spec §4 example 3 / §16 is dropped from Phase 2 and not deferred to a specific later phase.
- **No per-audience color picker.** The `statusOverride` schema's `statusColor` / `paletteKey` slots are preserved in the data model for Phase 4+ forward-compat, but Phase 2 never writes them. When an override is ON+available, the visual color falls back to the user's primary `statusColor`. — **[Superseded 2026-06-13 (#217): the per-audience picker shipped and now writes these slots. See the banner at the top.]**
- **Toggle OFF clears the override.** Setting `statusOverride` to null on toggle OFF (rather than preserving `{enabled: false, ...}`) keeps the schema clean and matches spec §4(4)'s "ON resets to Unavailable" semantic. When Phase 4+ adds per-audience colors, that phase will adjust the clear behavior to preserve color slots while clearing `enabled`/`status`/`availableUntil`. — **[Superseded 2026-06-13 (#217): toggle OFF now merge-preserves `statusColor`/`paletteKey` via `mergeStatusOverride`; it does not null the record. See the banner at the top.]**

---

## File Structure

**Modified files:**

| File | Change |
|---|---|
| `js/db.js` | Add: `setStatusOverride`, `clearStatusOverride`, `watchOwnMemberOverride`. |
| `js/groups.js` | Add: `toggleStatusOverride`, `setOverrideStatusAvailable`, `setOverrideStatusUnavailable`. |
| `js/groupContext.js` | New status-row state machine: subscribe to own primary (`watchStatus(ownUid)`) plus own override (`watchOwnMemberOverride(groupId, ownUid)`). Wire dot + time chip + override toggle. Update `renderRoster` + `syncStatusSubscriptions` to combine override+primary per member. |
| `js/groupNav.js` | Per-card own-override subscription so cards reflect the user's effective per-group color when override ON+available. |
| `index.template.html` | Add status row + override-toggle pill inside `<header class="group-context-header">`. |
| `css/app.css` | Styles for the group-context status row, override-toggle pill (ON / OFF / read-only states), and active-with-color group cards. |
| `tests/db.test.js` | Tests for the three new db.js exports. |
| `tests/groups.test.js` | Tests for the three new groups.js wrappers. |
| `tests/groupContext.test.js` | Tests for status-row rendering, toggle behavior, dot/chip wiring, roster context-aware status. |
| `tests/groupNav.test.js` | Tests for own-override color reflection on cards. |
| `tests/favorites.test.js`, `tests/following.test.js`, `tests/me.test.js`, `tests/mycode.test.js`, `tests/recovery.test.js` | Add `jest.fn()` stubs for the three new db.js exports. |
| `docs/HANDOFF.md` | Refresh post-Phase-2 state. |

**No new files.** All Phase 2 surface fits inside existing modules; the override is a small extension of the Phase 1 group-context view rather than a new screen.

---

## Conventions for this plan

Same as Phase 0 / Phase 1:

- **Test runner:** `npx jest <path>` from repo root.
- **Local dev:** `npm run dev`. **Build:** `node scripts/dev-build.js`.
- **Commit messages:** `type: subject` first line + body. Use `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`. Body explains the why.
- **One commit per task** unless a task explicitly says otherwise.
- **TDD discipline:** failing test first, run to confirm the failure mode, then implement.
- **Mock-update discipline:** every new export added to `js/db.js` must be added as a `jest.fn()` stub to the five existing db.js-mocking test files: `tests/favorites.test.js`, `tests/following.test.js`, `tests/me.test.js`, `tests/mycode.test.js`, `tests/recovery.test.js`. Missing entries cause `(0, _db.foo) is not a function` failures.

Baseline before Task 1: **590 tests passing** (the dev tip after the Phase 1 follow-up fixes).

---

## Task 1: db.js — statusOverride helpers + own-member subscription

The override is written as a single sub-object at `groups/{groupId}/members/{memberUid}/statusOverride`. Three helpers: `setStatusOverride` writes the full sub-object (replacing any prior value), `clearStatusOverride` deletes the sub-object entirely (toggle-OFF path), `watchOwnMemberOverride` subscribes to one user's override under one group (used by the cards row for own-color reflection without subscribing to the full roster).

**Files:**
- Modify: `js/db.js`
- Modify: `tests/db.test.js`
- Modify: the 5 mock files (`tests/favorites.test.js`, `tests/following.test.js`, `tests/me.test.js`, `tests/mycode.test.js`, `tests/recovery.test.js`)

- [ ] **Step 1: Write failing tests in `tests/db.test.js`**

Append at the end of the file:

```js
describe('statusOverride helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('setStatusOverride writes the sub-object at groups/{groupId}/members/{uid}/statusOverride', async () => {
    set.mockResolvedValue();
    await setStatusOverride('G1', 'uidA', { enabled: true, status: 'unavailable', availableUntil: null });
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/members/uidA/statusOverride');
    expect(set).toHaveBeenCalledWith('mock-ref', { enabled: true, status: 'unavailable', availableUntil: null });
  });

  test('setStatusOverride writes an available override with timestamp', async () => {
    set.mockResolvedValue();
    await setStatusOverride('G1', 'uidA', { enabled: true, status: 'available', availableUntil: 1234 });
    expect(set).toHaveBeenCalledWith('mock-ref', { enabled: true, status: 'available', availableUntil: 1234 });
  });

  test('clearStatusOverride removes the sub-object', async () => {
    remove.mockResolvedValue();
    await clearStatusOverride('G1', 'uidA');
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/members/uidA/statusOverride');
    expect(remove).toHaveBeenCalledWith('mock-ref');
  });

  test('watchOwnMemberOverride subscribes to the override sub-object', () => {
    let cb;
    onValue.mockImplementation((_ref, fn) => { cb = fn; return () => {}; });
    const seen = [];
    watchOwnMemberOverride('G1', 'uidA', (data) => seen.push(data));
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/members/uidA/statusOverride');
    cb({ exists: () => true, val: () => ({ enabled: true, status: 'available', availableUntil: 99 }) });
    expect(seen[0]).toEqual({ enabled: true, status: 'available', availableUntil: 99 });
    cb({ exists: () => false });
    expect(seen[1]).toBeNull();
  });
});
```

Add the new export names to the top-level destructure at the top of `tests/db.test.js`:

```js
const {
  // ... existing entries ...
  setStatusOverride, clearStatusOverride, watchOwnMemberOverride,
} = require('../js/db');
```

- [ ] **Step 2: Run tests; verify failure**

Run: `npx jest tests/db.test.js -t 'statusOverride helpers'`
Expected: FAIL — `setStatusOverride is not a function` (or similar for the other two).

- [ ] **Step 3: Add the three exports to `js/db.js`**

Insert after the existing `watchGroupMembers` block (around the group-members section, near line 270):

```js
// ── Phase 2: per-group status overrides ──────────────────────────────────────
// Canonical location: groups/{groupId}/members/{memberUid}/statusOverride.
// Writes are member-self-write (the user writes only to their own member
// record); same trust model as displayName edits.

export async function setStatusOverride(groupId, memberUid, override) {
  const overrideRef = ref(db, `groups/${groupId}/members/${memberUid}/statusOverride`);
  await set(overrideRef, override);
}

export async function clearStatusOverride(groupId, memberUid) {
  const overrideRef = ref(db, `groups/${groupId}/members/${memberUid}/statusOverride`);
  await remove(overrideRef);
}

export function watchOwnMemberOverride(groupId, memberUid, callback) {
  const overrideRef = ref(db, `groups/${groupId}/members/${memberUid}/statusOverride`);
  return onValue(overrideRef, (snap) => {
    callback(snap.exists() ? snap.val() : null);
  });
}
```

- [ ] **Step 4: Run db.js tests; verify pass**

Run: `npx jest tests/db.test.js`
Expected: PASS (all existing tests + the 4 new ones).

- [ ] **Step 5: Add `jest.fn()` stubs to the 5 db-mocking test files**

In each of `tests/favorites.test.js`, `tests/following.test.js`, `tests/me.test.js`, `tests/mycode.test.js`, `tests/recovery.test.js`, find the existing `jest.mock('../js/db.js', () => ({ ... }))` block and add these three entries (any position inside the object literal is fine, but keep alphabetical order if the file is alphabetical):

```js
setStatusOverride: jest.fn().mockResolvedValue(undefined),
clearStatusOverride: jest.fn().mockResolvedValue(undefined),
watchOwnMemberOverride: jest.fn(() => () => {}),
```

- [ ] **Step 6: Run the full suite; verify no regressions**

Run: `npx jest`
Expected: 594 passed (590 baseline + 4 new in db.test.js). No failures from the 5 mock files.

- [ ] **Step 7: Commit**

```bash
git add js/db.js tests/db.test.js tests/favorites.test.js tests/following.test.js tests/me.test.js tests/mycode.test.js tests/recovery.test.js
git commit -m "$(cat <<'EOF'
feat: db.js helpers for per-group statusOverride read/write/subscribe

Phase 2 prereq. setStatusOverride / clearStatusOverride / watchOwnMemberOverride
operate on the canonical groups/{groupId}/members/{uid}/statusOverride slot
established in Phase 1's data model. Member-self-write per spec §7. Mock
stubs added to the five db-mocking test files.
EOF
)"
```

---

## Task 2: groups.js — toggle + override-status wrappers

Three thin wrappers in `js/groups.js` compose the db.js primitives into the domain operations the UI calls. `toggleStatusOverride(groupId, userId, nextEnabled)` flips the toggle: ON writes `{ enabled: true, status: 'unavailable', availableUntil: null }` (spec §4(4)); OFF clears the entire override. `setOverrideStatusAvailable` and `setOverrideStatusUnavailable` update the override's `status`/`availableUntil` while preserving `enabled: true`.

**Files:**
- Modify: `js/groups.js`
- Modify: `tests/groups.test.js`

- [ ] **Step 1: Write failing tests in `tests/groups.test.js`**

Append at the end of the file (after the existing `describe` blocks):

```js
describe('toggleStatusOverride', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('enables the override with status=unavailable and availableUntil=null', async () => {
    db.setStatusOverride.mockResolvedValue(undefined);
    await toggleStatusOverride('G1', 'uidA', true);
    expect(db.setStatusOverride).toHaveBeenCalledWith('G1', 'uidA', {
      enabled: true,
      status: 'unavailable',
      availableUntil: null,
    });
    expect(db.clearStatusOverride).not.toHaveBeenCalled();
  });

  test('disables by clearing the entire override record', async () => {
    db.clearStatusOverride.mockResolvedValue(undefined);
    await toggleStatusOverride('G1', 'uidA', false);
    expect(db.clearStatusOverride).toHaveBeenCalledWith('G1', 'uidA');
    expect(db.setStatusOverride).not.toHaveBeenCalled();
  });
});

describe('setOverrideStatusAvailable', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('writes enabled=true, status=available, and the given availableUntil', async () => {
    db.setStatusOverride.mockResolvedValue(undefined);
    await setOverrideStatusAvailable('G1', 'uidA', 12345);
    expect(db.setStatusOverride).toHaveBeenCalledWith('G1', 'uidA', {
      enabled: true,
      status: 'available',
      availableUntil: 12345,
    });
  });
});

describe('setOverrideStatusUnavailable', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('writes enabled=true, status=unavailable, availableUntil=null', async () => {
    db.setStatusOverride.mockResolvedValue(undefined);
    await setOverrideStatusUnavailable('G1', 'uidA');
    expect(db.setStatusOverride).toHaveBeenCalledWith('G1', 'uidA', {
      enabled: true,
      status: 'unavailable',
      availableUntil: null,
    });
  });
});
```

Add the new imports / requires at the top of the file (alongside the existing `require('../js/groups')`):

```js
const { toggleStatusOverride, setOverrideStatusAvailable, setOverrideStatusUnavailable } = require('../js/groups');
```

(If the file already destructures from `../js/groups`, just add the three names to the existing destructure.)

- [ ] **Step 2: Run tests; verify failure**

Run: `npx jest tests/groups.test.js -t 'StatusOverride'`
Expected: FAIL — `toggleStatusOverride is not a function`.

- [ ] **Step 3: Add the three exports to `js/groups.js`**

Append at the end of the file:

```js
// ── Phase 2: per-group status overrides ──────────────────────────────────────

export async function toggleStatusOverride(groupId, userId, nextEnabled) {
  if (nextEnabled) {
    await setStatusOverride(groupId, userId, {
      enabled: true,
      status: 'unavailable',
      availableUntil: null,
    });
  } else {
    await clearStatusOverride(groupId, userId);
  }
}

export async function setOverrideStatusAvailable(groupId, userId, availableUntil) {
  await setStatusOverride(groupId, userId, {
    enabled: true,
    status: 'available',
    availableUntil,
  });
}

export async function setOverrideStatusUnavailable(groupId, userId) {
  await setStatusOverride(groupId, userId, {
    enabled: true,
    status: 'unavailable',
    availableUntil: null,
  });
}
```

Update the existing import line at the top of `js/groups.js` to include the two new db.js helpers (the existing import already pulls several names from `./db.js`):

```js
import {
  // ... existing names ...
  setStatusOverride, clearStatusOverride,
} from './db.js';
```

- [ ] **Step 4: Run groups.js tests; verify pass**

Run: `npx jest tests/groups.test.js`
Expected: PASS (existing tests + the 4 new ones in 3 new describe blocks).

- [ ] **Step 5: Run the full suite; verify no regressions**

Run: `npx jest`
Expected: 598 passed (594 from Task 1 + 4 new).

- [ ] **Step 6: Commit**

```bash
git add js/groups.js tests/groups.test.js
git commit -m "$(cat <<'EOF'
feat: groups.js wrappers for toggling per-group status overrides

toggleStatusOverride writes the spec §4(4) initial state on ON (status
unavailable, availableUntil null) and clears the whole override record on
OFF. setOverrideStatusAvailable / setOverrideStatusUnavailable update the
status fields while preserving enabled=true so the override remains active
across a dot tap.
EOF
)"
```

---

## Task 3: Group-context markup — own-status row + override toggle

Add an own-status row at the top of `<header class="group-context-header">`: a dot, a status label with time-remaining span, a time chip, and the override-toggle pill. Markup mirrors the Direct header's status structure but with distinct IDs scoped to the group context.

**Files:**
- Modify: `index.template.html`
- Modify: `css/app.css`

- [ ] **Step 1: Update the group-context-root markup in `index.template.html`**

Replace the existing `<header class="group-context-header"> ... </header>` block (around lines 214–226) with:

```html
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
            <button id="group-override-toggle" class="chip override-toggle" aria-pressed="false">Set a unique status</button>
          </div>
        </div>
      </div>
      <h2 id="group-context-name" class="group-context-name"></h2>
      <details id="group-context-actions" class="group-context-actions">
        <summary>Settings</summary>
        <div class="group-actions-menu">
          <button id="group-action-rename" class="ghost-btn hidden">Rename group</button>
          <button id="group-action-invite" class="ghost-btn hidden">Invite link</button>
          <button id="group-action-delete" class="ghost-btn hidden">Delete group</button>
          <button id="group-action-edit-name" class="ghost-btn hidden">Edit my name</button>
          <button id="group-action-leave" class="ghost-btn hidden">Leave group</button>
        </div>
      </details>
    </header>
```

- [ ] **Step 2: Add CSS rules to `css/app.css`**

Append before the existing `/* Group cards row */` block (or wherever the group-context-* styles already live in the file — they typically sit alongside the other group styles toward the bottom):

```css
.group-header-row {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.5rem 0;
}
.group-header-text { flex: 1; display: flex; flex-direction: column; gap: 0.25rem; }
.group-header-status-row { display: flex; align-items: baseline; gap: 0.5rem; }
.group-header-chips { display: flex; gap: 0.5rem; flex-wrap: wrap; }

/* Override toggle pill states */
.override-toggle[aria-pressed="true"] {
  background: var(--accent); color: white; border-color: var(--accent);
}
.override-toggle[aria-pressed="false"] {
  background: var(--surface); color: var(--text-muted);
}

/* Read-only mode: when override is OFF, the dot + time chip are not interactive */
#group-my-dot.readonly { cursor: default; opacity: 0.7; }
#group-time-chip.readonly { cursor: default; opacity: 0.5; pointer-events: none; }
```

- [ ] **Step 3: Run the build; verify markup renders**

Run: `node scripts/dev-build.js`
Expected: build succeeds; `grep -c 'group-my-dot\|group-override-toggle' index.html` ≥ 2.

- [ ] **Step 4: Commit**

```bash
git add index.template.html css/app.css
git commit -m "$(cat <<'EOF'
feat: add own-status row + override-toggle pill to group-context header

Markup mirrors the Direct header structure (dot, label, time chip) with
distinct IDs scoped to the group context so wiring can route writes to
the override path. Toggle pill uses aria-pressed for ON/OFF; readonly
class dims the dot + chip when override is OFF.
EOF
)"
```

---

## Task 4: groupContext — own status row state machine

The group-context status row reads from two sources: own primary (`watchStatus(ownUserId, ...)`, already used elsewhere in the app) and own override (`watchOwnMemberOverride(groupId, ownUserId, ...)`). The status row's effective state is the override when `enabled === true`, otherwise the primary. This task wires the subscriptions and the render function only — toggle/dot/chip click handlers come in Tasks 5–7.

**Files:**
- Modify: `js/groupContext.js`
- Modify: `tests/groupContext.test.js`

- [ ] **Step 1: Write failing tests in `tests/groupContext.test.js`**

Add `watchStatus` and `watchOwnMemberOverride` mocks to the db.js mock block at the top of the file (the block already lives there from Phase 1; just add/confirm these entries):

```js
jest.mock('../js/db.js', () => ({
  readGroup: jest.fn().mockResolvedValue(null),
  watchGroupMeta: jest.fn(() => () => {}),
  watchGroupMembers: jest.fn(() => () => {}),
  watchGroupInvites: jest.fn(() => () => {}),
  watchStatus: jest.fn(() => () => {}),
  watchOwnMemberOverride: jest.fn(() => () => {}),
  removeUserGroupsEntry: jest.fn().mockResolvedValue(undefined),
}));
```

Then add a new describe block (after the existing `owner actions` block):

```js
describe('own status row', () => {
  function captureCallbacks() {
    let metaCb, primaryCb, overrideCb;
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { primaryCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    return { getMetaCb: () => metaCb, getPrimaryCb: () => primaryCb, getOverrideCb: () => overrideCb };
  }

  beforeEach(() => { jest.clearAllMocks(); setupContextDom(); });

  test('renders primary status when override is null', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()(null);
    cbs.getPrimaryCb()({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000, statusColor: '#abcdef' });
    expect(document.getElementById('group-my-status-label').textContent).toBe('Available');
    expect(document.getElementById('group-my-dot').dataset.available).toBe('true');
  });

  test('renders override status when override.enabled is true', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getPrimaryCb()({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    expect(document.getElementById('group-my-status-label').textContent).toBe('Unavailable');
    expect(document.getElementById('group-my-dot').dataset.available).toBe('false');
  });

  test('toggle pill reflects override.enabled', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    expect(document.getElementById('group-override-toggle').getAttribute('aria-pressed')).toBe('true');
    cbs.getOverrideCb()(null);
    expect(document.getElementById('group-override-toggle').getAttribute('aria-pressed')).toBe('false');
  });

  test('dot and time chip get readonly class when override is OFF', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()(null);
    cbs.getPrimaryCb()({ status: 'unavailable', availableUntil: null });
    expect(document.getElementById('group-my-dot').classList.contains('readonly')).toBe(true);
    expect(document.getElementById('group-time-chip').classList.contains('readonly')).toBe(true);
  });

  test('dot and time chip lose readonly class when override is ON', () => {
    const cbs = captureCallbacks();
    enterGroupContext('G1', 'me');
    cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
    cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
    expect(document.getElementById('group-my-dot').classList.contains('readonly')).toBe(false);
    expect(document.getElementById('group-time-chip').classList.contains('readonly')).toBe(false);
  });
});
```

Update the `setupContextDom` helper near the top of the test file to include the new status-row markup. Replace the existing template literal block in `setupContextDom`:

```js
function setupContextDom() {
  document.body.innerHTML = `
    <div id="main-ui-direct"></div>
    <div id="group-context-root" class="group-context-root hidden">
      <div class="group-breadcrumb">
        <button id="group-breadcrumb-back">←</button>
        <span id="group-breadcrumb-name"></span>
      </div>
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
              <button id="group-override-toggle" class="chip override-toggle" aria-pressed="false">Set a unique status</button>
            </div>
          </div>
        </div>
        <h2 id="group-context-name"></h2>
        <details id="group-context-actions">
          <summary>Settings</summary>
          <div class="group-actions-menu">
            <button id="group-action-rename" class="hidden">Rename group</button>
            <button id="group-action-invite" class="hidden">Invite link</button>
            <button id="group-action-delete" class="hidden">Delete group</button>
            <button id="group-action-edit-name" class="hidden">Edit my name</button>
            <button id="group-action-leave" class="hidden">Leave group</button>
          </div>
        </details>
      </header>
      <ul id="group-roster"></ul>
    </div>
  `;
}
```

- [ ] **Step 2: Run tests; verify failure**

Run: `npx jest tests/groupContext.test.js -t 'own status row'`
Expected: FAIL — `Cannot read properties of null` reading status-row elements, or the toggle/dot/label state assertions fail because no code applies them yet.

- [ ] **Step 3: Implement the state machine in `js/groupContext.js`**

Add to the imports at the top:

```js
import { watchGroupMeta, watchGroupMembers, watchGroupInvites, watchStatus, watchOwnMemberOverride, removeUserGroupsEntry } from './db.js';
```

Add module-level state alongside the existing locals:

```js
let _ownPrimaryUnsub = null;
let _ownOverrideUnsub = null;
let _ownPrimary = null;  // { status, availableUntil, statusColor? } | null
let _ownOverride = null; // { enabled, status, availableUntil, statusColor?, paletteKey? } | null
```

Add a render function alongside `renderRoster`:

```js
function renderOwnStatusRow() {
  const dot = document.getElementById('group-my-dot');
  const label = document.getElementById('group-my-status-label');
  const timeRemaining = document.getElementById('group-time-remaining');
  const timeChip = document.getElementById('group-time-chip');
  const toggle = document.getElementById('group-override-toggle');
  if (!dot || !label || !toggle) return;

  const overrideOn = !!(_ownOverride && _ownOverride.enabled === true);
  toggle.setAttribute('aria-pressed', overrideOn ? 'true' : 'false');

  // Source of truth for the visible status: override when ON, else primary.
  const source = overrideOn ? _ownOverride : _ownPrimary;
  const status = source?.status || 'unavailable';
  const availableUntil = source?.availableUntil ?? null;
  const isAvailable = status === 'available' && (availableUntil == null || availableUntil > Date.now());

  dot.dataset.available = isAvailable ? 'true' : 'false';
  dot.classList.toggle('available', isAvailable);
  label.textContent = isAvailable ? 'Available' : 'Unavailable';

  // Read-only mode applies the dot + chip dimming when override is OFF.
  dot.classList.toggle('readonly', !overrideOn);
  if (timeChip) timeChip.classList.toggle('readonly', !overrideOn);

  if (timeRemaining) {
    if (isAvailable && availableUntil) {
      const ms = Math.max(0, availableUntil - Date.now());
      const hours = Math.floor(ms / 3600000);
      const minutes = Math.floor((ms % 3600000) / 60000);
      timeRemaining.textContent = '· ' + (hours > 0 ? `${hours}h ` : '') + `${minutes}m left`;
      timeRemaining.style.display = '';
    } else {
      timeRemaining.style.display = 'none';
    }
  }
}
```

In `enterGroupContext`, after the existing `_invitesUnsub` block, add:

```js
  // Subscribe to own primary status and own override under this group.
  if (_ownPrimaryUnsub) _ownPrimaryUnsub();
  if (_ownOverrideUnsub) _ownOverrideUnsub();
  _ownPrimary = null;
  _ownOverride = null;
  _ownPrimaryUnsub = watchStatus(userId, (data) => {
    _ownPrimary = data
      ? { status: data.status, availableUntil: data.availableUntil ?? null, statusColor: data.statusColor || null }
      : null;
    renderOwnStatusRow();
  });
  _ownOverrideUnsub = watchOwnMemberOverride(groupId, userId, (data) => {
    _ownOverride = data || null;
    renderOwnStatusRow();
  });
```

In `exitGroupContext`, tear down the new subs:

```js
  if (_ownPrimaryUnsub) { _ownPrimaryUnsub(); _ownPrimaryUnsub = null; }
  if (_ownOverrideUnsub) { _ownOverrideUnsub(); _ownOverrideUnsub = null; }
  _ownPrimary = null;
  _ownOverride = null;
```

- [ ] **Step 4: Run tests; verify pass**

Run: `npx jest tests/groupContext.test.js -t 'own status row'`
Expected: PASS.

- [ ] **Step 5: Run the full suite; verify no regressions**

Run: `npx jest`
Expected: 603 passed (598 from Task 2 + 5 new).

- [ ] **Step 6: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "$(cat <<'EOF'
feat: group-context own-status row reads override-or-primary

Subscribe to own primary (watchStatus) and own override
(watchOwnMemberOverride) on enter; render the override when enabled===true
else fall through to primary. Toggle pill reflects state via aria-pressed.
Dot + time chip get a 'readonly' class when override is OFF — Task 5
wires the click handlers that this class will gate.
EOF
)"
```

---

## Task 5: groupContext — override toggle click handler

Tapping the override-toggle pill flips the boolean and calls `toggleStatusOverride`. The render function from Task 4 will re-fire automatically via `watchOwnMemberOverride` when the write lands.

**Files:**
- Modify: `js/groupContext.js`
- Modify: `tests/groupContext.test.js`

- [ ] **Step 1: Write failing tests in `tests/groupContext.test.js`**

Add a new mock block for `js/groups.js` if not already present (Phase 1 already mocks it; just confirm `toggleStatusOverride` is in the mock):

```js
jest.mock('../js/groups.js', () => ({
  renameGroup: jest.fn().mockResolvedValue(undefined),
  deleteGroup: jest.fn().mockResolvedValue(undefined),
  leaveGroup: jest.fn().mockResolvedValue(undefined),
  editOwnDisplayName: jest.fn().mockResolvedValue(undefined),
  toggleStatusOverride: jest.fn().mockResolvedValue(undefined),
  setOverrideStatusAvailable: jest.fn().mockResolvedValue(undefined),
  setOverrideStatusUnavailable: jest.fn().mockResolvedValue(undefined),
}));
```

Append inside the `describe('own status row', ...)` block:

```js
test('clicking the toggle when OFF calls toggleStatusOverride with true', () => {
  const cbs = captureCallbacks();
  enterGroupContext('G1', 'me');
  cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
  cbs.getOverrideCb()(null);
  document.getElementById('group-override-toggle').click();
  expect(groupsModule.toggleStatusOverride).toHaveBeenCalledWith('G1', 'me', true);
});

test('clicking the toggle when ON calls toggleStatusOverride with false', () => {
  const cbs = captureCallbacks();
  enterGroupContext('G1', 'me');
  cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
  cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
  document.getElementById('group-override-toggle').click();
  expect(groupsModule.toggleStatusOverride).toHaveBeenCalledWith('G1', 'me', false);
});
```

- [ ] **Step 2: Run tests; verify failure**

Run: `npx jest tests/groupContext.test.js -t 'clicking the toggle'`
Expected: FAIL — `expect(jest.fn()).toHaveBeenCalledWith(...)` reports zero calls.

- [ ] **Step 3: Wire the toggle in `js/groupContext.js`**

Add `toggleStatusOverride` to the existing import from `./groups.js`:

```js
import { renameGroup, deleteGroup, leaveGroup, editOwnDisplayName, toggleStatusOverride } from './groups.js';
```

In `enterGroupContext`, after subscribing to the own primary + override, wire the toggle (once, using clone-and-replace so re-entry doesn't stack listeners):

```js
  // Wire the override toggle (replace via clone to drop any prior listener)
  const toggle = document.getElementById('group-override-toggle');
  if (toggle) {
    const clone = toggle.cloneNode(true);
    toggle.parentNode.replaceChild(clone, toggle);
    clone.addEventListener('click', () => {
      const nextEnabled = !(_ownOverride && _ownOverride.enabled === true);
      toggleStatusOverride(groupId, userId, nextEnabled).catch(() => {});
    });
  }
```

- [ ] **Step 4: Run tests; verify pass**

Run: `npx jest tests/groupContext.test.js`
Expected: PASS (all groupContext tests, including the two new toggle tests).

- [ ] **Step 5: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "$(cat <<'EOF'
feat: wire group-context override-toggle click handler

Tap flips override.enabled. Re-wiring uses clone-and-replace to drop any
prior listener, matching the existing Phase 1 wireActions pattern. The
re-render is driven by the watchOwnMemberOverride callback so no
optimistic UI update is needed.
EOF
)"
```

---

## Task 6: groupContext — dot click writes override status (when ON)

When the override is ON, tapping the dot toggles between Available (with `availableUntil = now + lastTimeoutMinutes * 60000`) and Unavailable. When override is OFF, the dot is non-interactive (the `readonly` class from Task 4 dims it; the click handler also early-returns to be defensive).

**Files:**
- Modify: `js/groupContext.js`
- Modify: `tests/groupContext.test.js`

- [ ] **Step 1: Write failing tests in `tests/groupContext.test.js`**

Mock `store.js`'s `getLastTimeout` in the file's mock block (add to or create the existing mock):

```js
jest.mock('../js/store.js', () => ({
  getLastTimeout: jest.fn(() => 120),
}));
```

Append inside the `describe('own status row', ...)` block:

```js
test('clicking the dot when override ON and currently unavailable goes available with lastTimeoutMinutes', () => {
  const cbs = captureCallbacks();
  enterGroupContext('G1', 'me');
  cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
  cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
  const before = Date.now();
  document.getElementById('group-my-dot').click();
  expect(groupsModule.setOverrideStatusAvailable).toHaveBeenCalled();
  const [g, u, until] = groupsModule.setOverrideStatusAvailable.mock.calls[0];
  expect(g).toBe('G1');
  expect(u).toBe('me');
  // 120 minutes from now, ±2s tolerance for test latency.
  expect(until).toBeGreaterThanOrEqual(before + 120 * 60000 - 2000);
  expect(until).toBeLessThanOrEqual(Date.now() + 120 * 60000 + 2000);
});

test('clicking the dot when override ON and currently available goes unavailable', () => {
  const cbs = captureCallbacks();
  enterGroupContext('G1', 'me');
  cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
  cbs.getOverrideCb()({ enabled: true, status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 });
  document.getElementById('group-my-dot').click();
  expect(groupsModule.setOverrideStatusUnavailable).toHaveBeenCalledWith('G1', 'me');
});

test('clicking the dot when override OFF is a no-op', () => {
  const cbs = captureCallbacks();
  enterGroupContext('G1', 'me');
  cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
  cbs.getOverrideCb()(null);
  document.getElementById('group-my-dot').click();
  expect(groupsModule.setOverrideStatusAvailable).not.toHaveBeenCalled();
  expect(groupsModule.setOverrideStatusUnavailable).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests; verify failure**

Run: `npx jest tests/groupContext.test.js -t 'clicking the dot'`
Expected: FAIL — handlers not wired.

- [ ] **Step 3: Wire the dot in `js/groupContext.js`**

Add `setOverrideStatusAvailable` and `setOverrideStatusUnavailable` to the import from `./groups.js`. Add `getLastTimeout` to imports from `./store.js`:

```js
import { renameGroup, deleteGroup, leaveGroup, editOwnDisplayName,
         toggleStatusOverride, setOverrideStatusAvailable, setOverrideStatusUnavailable } from './groups.js';
import { getLastTimeout } from './store.js';
```

In `enterGroupContext`, after the toggle wiring from Task 5, add:

```js
  // Wire the dot (clone-and-replace per the same pattern)
  const dot = document.getElementById('group-my-dot');
  if (dot) {
    const dotClone = dot.cloneNode(true);
    dot.parentNode.replaceChild(dotClone, dot);
    dotClone.addEventListener('click', () => {
      const overrideOn = !!(_ownOverride && _ownOverride.enabled === true);
      if (!overrideOn) return;  // read-only when toggle is OFF
      const currentlyAvailable = _ownOverride.status === 'available'
        && (_ownOverride.availableUntil == null || _ownOverride.availableUntil > Date.now());
      if (currentlyAvailable) {
        setOverrideStatusUnavailable(groupId, userId).catch(() => {});
      } else {
        const availableUntil = Date.now() + getLastTimeout() * 60000;
        setOverrideStatusAvailable(groupId, userId, availableUntil).catch(() => {});
      }
    });
  }
```

- [ ] **Step 4: Run tests; verify pass**

Run: `npx jest tests/groupContext.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "$(cat <<'EOF'
feat: group-context dot toggles override status when override is ON

When toggle ON: dot click writes setOverrideStatusAvailable or
setOverrideStatusUnavailable depending on current state. availableUntil
defaults to now + lastTimeoutMinutes (the shared cross-context default).
When toggle OFF: dot click is a no-op (readonly class also dims it
visually).
EOF
)"
```

---

## Task 7: groupContext — time-chip cycles override duration (when ON)

The time chip cycles through `CHIP_VALUES` (same list as `js/me.js`) and updates the override's `availableUntil` when the user is currently available under the override. When override OFF, or when override is unavailable, the time chip is non-interactive.

**Files:**
- Modify: `js/groupContext.js`
- Modify: `tests/groupContext.test.js`

- [ ] **Step 1: Write failing tests in `tests/groupContext.test.js`**

Append inside the `describe('own status row', ...)` block:

```js
test('clicking the time chip when override ON+available updates availableUntil', () => {
  const cbs = captureCallbacks();
  enterGroupContext('G1', 'me');
  cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
  cbs.getOverrideCb()({ enabled: true, status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 });
  const before = Date.now();
  document.getElementById('group-time-chip').click();
  expect(groupsModule.setOverrideStatusAvailable).toHaveBeenCalled();
  const [, , until] = groupsModule.setOverrideStatusAvailable.mock.calls[0];
  // Chip default cycles forward from "2 hours" (index 3) to "3 hours" (index 4).
  expect(until).toBeGreaterThanOrEqual(before + 180 * 60000 - 2000);
  expect(until).toBeLessThanOrEqual(Date.now() + 180 * 60000 + 2000);
});

test('clicking the time chip when override OFF is a no-op', () => {
  const cbs = captureCallbacks();
  enterGroupContext('G1', 'me');
  cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
  cbs.getOverrideCb()(null);
  document.getElementById('group-time-chip').click();
  expect(groupsModule.setOverrideStatusAvailable).not.toHaveBeenCalled();
});

test('clicking the time chip when override ON but unavailable is a no-op', () => {
  const cbs = captureCallbacks();
  enterGroupContext('G1', 'me');
  cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
  cbs.getOverrideCb()({ enabled: true, status: 'unavailable', availableUntil: null });
  document.getElementById('group-time-chip').click();
  expect(groupsModule.setOverrideStatusAvailable).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests; verify failure**

Run: `npx jest tests/groupContext.test.js -t 'time chip'`
Expected: FAIL — handler not wired.

- [ ] **Step 3: Wire the time chip in `js/groupContext.js`**

The chip-cycle logic needs `CHIP_VALUES` and `chipIndexForMinutes` — they live in `js/me.js`. Rather than re-import (which would couple modules awkwardly), duplicate the small table locally. Add to the top of `js/groupContext.js` (under existing imports):

```js
const CHIP_VALUES = [
  { minutes: 30,   text: '30 minutes' },
  { minutes: 60,   text: '1 hour' },
  { minutes: 90,   text: '1 hour 30 minutes' },
  { minutes: 120,  text: '2 hours' },
  { minutes: 180,  text: '3 hours' },
  { minutes: 240,  text: '4 hours' },
  { minutes: 360,  text: '6 hours' },
  { minutes: 480,  text: '8 hours' },
  { minutes: 720,  text: '12 hours' },
  { minutes: 1080, text: '18 hours' },
  { minutes: 1440, text: '24 hours' },
];
function chipIndexForMinutes(minutes) {
  let m = minutes;
  if (m <= 12) m = m * 60;
  let bestIndex = 0;
  let bestDist = Math.abs(CHIP_VALUES[0].minutes - m);
  for (let i = 1; i < CHIP_VALUES.length; i++) {
    const dist = Math.abs(CHIP_VALUES[i].minutes - m);
    if (dist < bestDist) { bestDist = dist; bestIndex = i; }
  }
  return bestIndex;
}
```

Add `setLastTimeout` to the `./store.js` import; add `setLastTimeoutMinutes` to the `./db.js` import:

```js
import { getLastTimeout, setLastTimeout } from './store.js';
import { /* existing... */, setLastTimeoutMinutes } from './db.js';
```

In `enterGroupContext`, after the dot wiring from Task 6:

```js
  // Wire the time chip
  const timeChip = document.getElementById('group-time-chip');
  if (timeChip) {
    timeChip.textContent = CHIP_VALUES[chipIndexForMinutes(getLastTimeout())].text;
    const chipClone = timeChip.cloneNode(true);
    timeChip.parentNode.replaceChild(chipClone, timeChip);
    chipClone.addEventListener('click', () => {
      const overrideOn = !!(_ownOverride && _ownOverride.enabled === true);
      if (!overrideOn) return;
      const currentlyAvailable = _ownOverride.status === 'available'
        && (_ownOverride.availableUntil == null || _ownOverride.availableUntil > Date.now());
      if (!currentlyAvailable) return;
      const currentIdx = chipIndexForMinutes(getLastTimeout());
      const nextIdx = (currentIdx + 1) % CHIP_VALUES.length;
      const { minutes, text } = CHIP_VALUES[nextIdx];
      chipClone.textContent = text;
      const availableUntil = Date.now() + minutes * 60000;
      setLastTimeout(minutes);
      setLastTimeoutMinutes(userId, minutes).catch(() => {});
      setOverrideStatusAvailable(groupId, userId, availableUntil).catch(() => {});
    });
  }
```

Note: `setLastTimeoutMinutes` is the existing db.js helper that syncs the user's chip-minutes selection across devices via `users/{uid}/lastTimeoutMinutes`. It's shared with the Direct header chip — both surfaces converge on the same default duration.

- [ ] **Step 4: Run tests; verify pass**

Run: `npx jest tests/groupContext.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "$(cat <<'EOF'
feat: group-context time chip cycles override duration when override ON

The chip cycles CHIP_VALUES (shared list with js/me.js, duplicated locally
to avoid a UI->UI module dependency) and writes the new availableUntil to
the override path. Time-chip selection also syncs across devices via the
shared lastTimeoutMinutes path so the Direct chip and the group-context
chip stay in lock-step.
EOF
)"
```

---

## Task 8: groupContext — roster shows each member's context-appropriate status

The roster currently subscribes to each member's primary via `watchStatus(uid)`. Phase 2 needs to merge that with their override (already arriving in the `watchGroupMembers` callback). For each member: if `member.statusOverride?.enabled === true`, render dot + label using the override's `status` + `availableUntil`; otherwise use the primary from `watchStatus`. Color falls back to the primary's `statusColor` (Phase 4+ will write `statusOverride.statusColor` and prefer it).

**Files:**
- Modify: `js/groupContext.js`
- Modify: `tests/groupContext.test.js`

- [ ] **Step 1: Write failing tests in `tests/groupContext.test.js`**

Replace the existing roster describe block (or add inside it) with the Phase 2 cases. Append at the end of the file:

```js
describe('roster context-aware status', () => {
  function captureMembers() {
    let membersCb;
    db.watchGroupMembers.mockImplementation((g, cb) => { membersCb = cb; return () => {}; });
    return () => membersCb;
  }
  function captureStatuses() {
    const cbs = {};
    db.watchStatus.mockImplementation((uid, cb) => { cbs[uid] = cb; return () => {}; });
    return cbs;
  }

  beforeEach(() => { jest.clearAllMocks(); setupContextDom(); });

  test('member with override.enabled uses override status not primary', () => {
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidA: {
        role: 'member',
        displayName: 'A',
        joinedAt: 2,
        statusOverride: { enabled: true, status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 },
      },
    });
    // uidA's primary says unavailable, but override should win.
    statusCbs.uidA?.({ status: 'unavailable', availableUntil: null });
    const li = document.querySelector('#group-roster [data-user-id="uidA"]');
    expect(li.dataset.available).toBe('true');
  });

  test('member without override uses primary status', () => {
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidB: { role: 'member', displayName: 'B', joinedAt: 3 },
    });
    statusCbs.uidB?.({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000, statusColor: '#abcdef' });
    const li = document.querySelector('#group-roster [data-user-id="uidB"]');
    expect(li.dataset.available).toBe('true');
  });

  test('member with override.enabled=false ignores override and uses primary', () => {
    const getMembers = captureMembers();
    const statusCbs = captureStatuses();
    enterGroupContext('G1', 'me');
    getMembers()({
      me: { role: 'owner', displayName: 'Me', joinedAt: 1 },
      uidC: {
        role: 'member',
        displayName: 'C',
        joinedAt: 4,
        statusOverride: { enabled: false, status: 'unavailable', availableUntil: null },
      },
    });
    statusCbs.uidC?.({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 });
    const li = document.querySelector('#group-roster [data-user-id="uidC"]');
    expect(li.dataset.available).toBe('true');
  });
});
```

- [ ] **Step 2: Run tests; verify failure**

Run: `npx jest tests/groupContext.test.js -t 'roster context-aware status'`
Expected: FAIL — current `syncStatusSubscriptions` writes only the primary; override is ignored.

- [ ] **Step 3: Update the roster rendering in `js/groupContext.js`**

Refactor `renderRoster` and `syncStatusSubscriptions` to keep the override per uid in module state and combine on every render. Add module-level state alongside the existing locals:

```js
let _membersOverrides = {}; // uid → statusOverride | null
const _memberPrimaries = new Map(); // uid → { status, availableUntil, statusColor } | null
```

Replace the body of `_membersUnsub = watchGroupMembers(...)` in `enterGroupContext` with:

```js
  _membersUnsub = watchGroupMembers(groupId, (members) => {
    _membersOverrides = {};
    for (const [uid, m] of Object.entries(members || {})) {
      _membersOverrides[uid] = m.statusOverride || null;
    }
    renderRoster(members, userId);
    syncStatusSubscriptions(new Set(Object.keys(members || {})));
    // Re-paint each row to reflect the merged override+primary.
    for (const uid of Object.keys(members || {})) {
      paintRosterRow(uid);
    }
  });
```

Add a `paintRosterRow(uid)` helper that combines override + primary and writes to the row's dataset / dot color:

```js
function paintRosterRow(uid) {
  const li = document.querySelector(`#group-roster [data-user-id="${uid}"]`);
  if (!li) return;
  const override = _membersOverrides[uid];
  const primary = _memberPrimaries.get(uid) || null;
  const overrideOn = !!(override && override.enabled === true);
  const source = overrideOn ? override : primary;
  const status = source?.status || 'unavailable';
  const availableUntil = source?.availableUntil ?? null;
  const isAvailable = status === 'available' && (availableUntil == null || availableUntil > Date.now());
  li.dataset.available = isAvailable ? 'true' : 'false';
  const dot = li.querySelector('.person-dot');
  if (dot) {
    dot.dataset.available = isAvailable ? 'true' : 'false';
    // Phase 2 color: prefer override.statusColor when present (Phase 4+ will
    // write it), else fall through to the member's primary statusColor.
    const color = override?.statusColor || primary?.statusColor || null;
    if (isAvailable && color) dot.style.background = safeCssColor(color);
    else dot.style.background = '';
  }
}
```

Replace the body of `syncStatusSubscriptions` so it stores primaries in `_memberPrimaries` and re-paints:

```js
function syncStatusSubscriptions(memberUids) {
  for (const uid of Array.from(_statusUnsubs.keys())) {
    if (!memberUids.has(uid)) {
      _statusUnsubs.get(uid)();
      _statusUnsubs.delete(uid);
      _memberPrimaries.delete(uid);
    }
  }
  for (const uid of memberUids) {
    if (!_statusUnsubs.has(uid)) {
      _statusUnsubs.set(uid, watchStatus(uid, (data) => {
        _memberPrimaries.set(uid, data
          ? { status: data.status, availableUntil: data.availableUntil ?? null, statusColor: data.statusColor || null }
          : null);
        paintRosterRow(uid);
      }));
    }
  }
}
```

In `exitGroupContext`, also clear the new state:

```js
  _membersOverrides = {};
  _memberPrimaries.clear();
```

- [ ] **Step 4: Run tests; verify pass**

Run: `npx jest tests/groupContext.test.js`
Expected: PASS (all groupContext tests including the three new roster tests).

- [ ] **Step 5: Run the full suite; verify no regressions**

Run: `npx jest`
Expected: ~613 passed (598 from Task 2 + 5 own-status-row + 2 toggle + 3 dot + 3 chip + 3 roster = 614, ±0 depending on jest's report).

- [ ] **Step 6: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "$(cat <<'EOF'
feat: roster renders each member's context-appropriate status

Combine each member's statusOverride (from watchGroupMembers) with their
primary (from watchStatus). Override wins when enabled===true; otherwise
fall through to primary. Dot color prefers override.statusColor when
present (Phase 4+ slot) else the primary's statusColor.
EOF
)"
```

---

## Task 9: groupNav — own-override color reflection on group cards

Spec §6 + §16 Phase 2: a group card's color reflects the user's override for that group when override is ON+available. Phase 2 uses the user's primary `statusColor` as the override's effective color (since per-audience color picking is deferred). Implementation: subscribe to own-member override per enumerated group, store in module state, re-render cards on each change.

**Files:**
- Modify: `js/groupNav.js`
- Modify: `tests/groupNav.test.js`

- [ ] **Step 1: Write failing tests in `tests/groupNav.test.js`**

Add `watchOwnMemberOverride` and `watchStatus` to the existing db.js mock block in the file:

```js
jest.mock('../js/db.js', () => ({
  // ... existing entries ...
  watchOwnMemberOverride: jest.fn(() => () => {}),
  watchStatus: jest.fn(() => () => {}),
}));
```

Append at the end of the file:

```js
describe('group cards own-override color reflection', () => {
  function setupCardsDom() {
    document.body.innerHTML = `
      <div id="group-cards-row"></div>
      <div id="create-group-modal" class="hidden"></div>
    `;
  }
  beforeEach(() => { jest.clearAllMocks(); setupCardsDom(); });

  test('card without active override has no inline color', () => {
    let enumCb, metaCb, overrideCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'someone', createdAt: 1 });
    overrideCb(null);
    const card = document.querySelector('#group-cards-row .group-card');
    expect(card.style.background).toBe('');
  });

  test('card with override.enabled=true and status=available shows primary statusColor', () => {
    let enumCb, metaCb, overrideCb, statusCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { statusCb = cb; return () => {}; });
    initNav('me');
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'someone', createdAt: 1 });
    statusCb({ status: 'available', availableUntil: Date.now() + 60 * 60 * 1000, statusColor: '#11aaff' });
    overrideCb({ enabled: true, status: 'available', availableUntil: Date.now() + 60 * 60 * 1000 });
    const card = document.querySelector('#group-cards-row .group-card');
    // Phase 2 uses primary statusColor as the effective override fill.
    expect(card.style.background).toMatch(/#11aaff|rgb\(17,\s*170,\s*255\)/i);
  });

  test('card with override.enabled=true but status=unavailable has no inline color', () => {
    let enumCb, metaCb, overrideCb;
    db.watchUserGroups.mockImplementation((uid, cb) => { enumCb = cb; return () => {}; });
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    db.watchStatus.mockImplementation(() => () => {});
    initNav('me');
    startCardsRowSubscriptions();
    enumCb({ G1: { lastVisited: 1 } });
    metaCb({ name: 'Family', ownerId: 'someone', createdAt: 1 });
    overrideCb({ enabled: true, status: 'unavailable', availableUntil: null });
    const card = document.querySelector('#group-cards-row .group-card');
    expect(card.style.background).toBe('');
  });
});
```

- [ ] **Step 2: Run tests; verify failure**

Run: `npx jest tests/groupNav.test.js -t 'own-override color reflection'`
Expected: FAIL — `card.style.background` is empty in the ON+available case.

- [ ] **Step 3: Implement the override color reflection in `js/groupNav.js`**

Add to the imports:

```js
import { setCurrentContext, setLastVisited, watchUserGroups, watchGroupMeta, watchOwnMemberOverride, watchStatus } from './db.js';
import { safeCssColor } from './utils.js';
```

Add module-level state alongside `_enumeration` / `_metaByGroupId`:

```js
let _ownPrimary = null;
let _ownPrimaryUnsub = null;
const _overrideByGroupId = {};
const _overrideSubs = {}; // groupId → unsubscribe
```

In `startCardsRowSubscriptions`, after the existing `_enumUnsub = watchUserGroups(...)`, add:

```js
  if (_ownPrimaryUnsub) _ownPrimaryUnsub();
  _ownPrimaryUnsub = watchStatus(_myUserId, (data) => {
    _ownPrimary = data
      ? { status: data.status, availableUntil: data.availableUntil ?? null, statusColor: data.statusColor || null }
      : null;
    renderCardsRow(_enumeration, _metaByGroupId);
  });
```

In `syncMetaSubs`, add a parallel block that maintains override subs per group. Modify `syncMetaSubs`:

```js
function syncMetaSubs() {
  const wantIds = new Set(Object.keys(_enumeration));
  // Existing meta-sub cleanup + setup ...
  for (const groupId of Object.keys(_metaSubs)) {
    if (!wantIds.has(groupId)) {
      _metaSubs[groupId]();
      delete _metaSubs[groupId];
      delete _metaByGroupId[groupId];
    }
  }
  for (const groupId of wantIds) {
    if (!_metaSubs[groupId]) {
      _metaSubs[groupId] = watchGroupMeta(groupId, (meta) => {
        if (meta) {
          _metaByGroupId[groupId] = meta;
          if (meta.name) _lastKnownNames[groupId] = meta.name;
        } else {
          delete _metaByGroupId[groupId];
        }
        renderCardsRow(_enumeration, _metaByGroupId);
      });
    }
  }
  // Override-sub cleanup + setup (new in Phase 2)
  for (const groupId of Object.keys(_overrideSubs)) {
    if (!wantIds.has(groupId)) {
      _overrideSubs[groupId]();
      delete _overrideSubs[groupId];
      delete _overrideByGroupId[groupId];
    }
  }
  for (const groupId of wantIds) {
    if (!_overrideSubs[groupId]) {
      _overrideSubs[groupId] = watchOwnMemberOverride(groupId, _myUserId, (override) => {
        if (override) _overrideByGroupId[groupId] = override;
        else delete _overrideByGroupId[groupId];
        renderCardsRow(_enumeration, _metaByGroupId);
      });
    }
  }
}
```

Update `renderCardsRow` so each card consults `_overrideByGroupId` + `_ownPrimary`. After the existing `card.textContent = name;` line and before the `active` class toggle, add:

```js
    const ov = _overrideByGroupId[groupId];
    const overrideActive = !!(ov && ov.enabled === true && ov.status === 'available'
      && (ov.availableUntil == null || ov.availableUntil > Date.now()));
    if (overrideActive) {
      const fill = ov.statusColor || _ownPrimary?.statusColor || null;
      if (fill) card.style.background = safeCssColor(fill);
    }
```

- [ ] **Step 4: Run tests; verify pass**

Run: `npx jest tests/groupNav.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite; verify no regressions**

Run: `npx jest`
Expected: ~616 passed.

- [ ] **Step 6: Commit**

```bash
git add js/groupNav.js tests/groupNav.test.js
git commit -m "$(cat <<'EOF'
feat: group cards reflect own-override color when ON+available

Subscribe to own-member override per enumerated group and to own primary
status; when a card's override is enabled+available, fill the card with
override.statusColor (Phase 4+ slot) or the user's primary statusColor as
the Phase 2 fallback. Cards with no override or with override but
unavailable stay visually neutral.
EOF
)"
```

---

## Task 10: End-to-end integration test + manual UI verification + build

A single end-to-end test exercises the full Phase 2 happy path in jsdom: enter a group, toggle override ON, see the dot become editable, click dot to go available, click time chip to change duration, toggle override OFF, see status row revert to primary.

**Files:**
- Modify: `tests/groupContext.test.js`

- [ ] **Step 1: Write the integration test**

Append at the end of `tests/groupContext.test.js`:

```js
describe('Phase 2 end-to-end happy path', () => {
  test('toggle ON → dot → chip → toggle OFF flow writes the expected db calls', () => {
    let metaCb, overrideCb, primaryCb;
    db.watchGroupMeta.mockImplementation((g, cb) => { metaCb = cb; return () => {}; });
    db.watchOwnMemberOverride.mockImplementation((g, uid, cb) => { overrideCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { primaryCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    primaryCb({ status: 'unavailable', availableUntil: null });
    overrideCb(null);

    // 1. Toggle ON
    document.getElementById('group-override-toggle').click();
    expect(groupsModule.toggleStatusOverride).toHaveBeenCalledWith('G1', 'me', true);
    overrideCb({ enabled: true, status: 'unavailable', availableUntil: null });

    // 2. Dot click — go available
    document.getElementById('group-my-dot').click();
    expect(groupsModule.setOverrideStatusAvailable).toHaveBeenCalled();
    overrideCb({ enabled: true, status: 'available', availableUntil: Date.now() + 120 * 60000 });

    // 3. Time chip — cycle duration
    document.getElementById('group-time-chip').click();
    expect(groupsModule.setOverrideStatusAvailable).toHaveBeenCalledTimes(2);

    // 4. Toggle OFF
    document.getElementById('group-override-toggle').click();
    expect(groupsModule.toggleStatusOverride).toHaveBeenLastCalledWith('G1', 'me', false);
    overrideCb(null);
    expect(document.getElementById('group-override-toggle').getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('group-my-dot').classList.contains('readonly')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test; verify pass**

Run: `npx jest tests/groupContext.test.js -t 'end-to-end happy path'`
Expected: PASS.

- [ ] **Step 3: Run the full suite; verify all 17+ new tests stably pass**

Run three consecutive times to surface any flake:

```bash
for i in 1 2 3; do npx jest 2>&1 | grep '^Tests:'; done
```

Expected output (each line):
```
Tests:       617 passed, 617 total
```

(Approximate count — exact total depends on whether any sub-tests were merged/split during implementation; the key invariant is that the count is stable across the three runs and increases monotonically from the 590 baseline.)

- [ ] **Step 4: Build verification**

Run: `node scripts/dev-build.js`
Expected: `Build complete: dist/bundle.js + index.html ...`. No build errors.

- [ ] **Step 5: Manual UI verification (run locally, not in CI)**

Start the dev server:

```bash
npm run dev
```

In a browser at `http://localhost:5000` (or whatever port `npm run dev` reports), with `GROUPS_ENABLED = true` already set on dev:

1. Sign in with a known secret phrase that owns at least one group.
2. Navigate into the group. Confirm the new own-status row appears above the group name with a dot, "Unavailable", a time chip, and the "Set a unique status" pill.
3. The dot + chip should appear dimmed (readonly class).
4. Tap "Set a unique status". The pill should change to ON (filled accent color). The dot + chip should become interactive.
5. Tap the dot. The dot should turn available, label change to "Available · Nh Nm left", time-remaining visible.
6. Tap the time chip. Label time-remaining should update to the next chip value.
7. Navigate back to Direct. Confirm the corresponding group card shows the user's primary status color.
8. Re-enter the group. Tap "Set a unique status" again (now ON → OFF). Confirm the override clears, the row reverts to primary status, the dot/chip dim, and the card on the Direct screen reverts to neutral.
9. With a second device / browser using the same secret phrase, observe the override syncs across devices: turning override ON in one client should immediately reflect in the other's group view.

There is no automated UI test for the cross-device sync; verify it by hand.

- [ ] **Step 6: Commit**

```bash
git add tests/groupContext.test.js
git commit -m "$(cat <<'EOF'
test: end-to-end Phase 2 toggle→dot→chip→toggle-off flow

A single jsdom test walks the full Phase 2 happy path: enter a group,
flip override ON, go available via dot, cycle duration via chip, flip
override OFF, confirm row reverts to primary and dot is readonly again.
EOF
)"
```

---

## Task 11: HANDOFF.md refresh

Update the canonical handoff document to reflect Phase 2 shipped state. The user reads this top-to-bottom whenever picking up the project.

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Update the lead paragraph**

Replace the existing "Most recent work" paragraph at the top of `docs/HANDOFF.md`:

```markdown
**Most recent work:** Phase 0 (1:1 invite links), Phase 1 (groups MVP), and Phase 2 (per-group status overrides) of the groups feature are shipped to `dev` with `GROUPS_ENABLED = true`. MVP is now complete per spec §17. Phase 3 (in-app push invites) is the next planned work and not yet planned or built.
```

- [ ] **Step 2: Update the §6 cross-device-sync table**

Add this row to the table (after the existing "Per-group meta" row, before "Group roster + statuses"):

```markdown
| **Own per-group status override** (Phase 2) | `watchOwnMemberOverride(groupId, ownUid)` per enumerated group — drives card color and the group-context status row |
```

- [ ] **Step 3: Update §11 in-progress work**

Replace the "Phase 2 — per-audience status overrides" subsection with:

```markdown
**Phase 3 — in-app push invites** (spec §16 Phase 3, Flow C in spec §10). Not yet planned or built.

- The data path is already designed and the security rules are in place: `pendingInvites/{inviteeUid}/{inviteId}` (top-level mailbox, forward-compatible with Phase B without a Cloud Function).
- Phase 3 adds writers and the receiving UI (the inline card at the top of Direct's contact list with Join / Decline).
- Spec §16 Phase 3 has the deliverable list. Use the `writing-plans` skill to produce a plan.

**Phase 2 — per-group status overrides** (now shipped on dev):

- Spec scope locked to per-**group** overrides only — the spec's symmetric "followers audience" override was dropped from Phase 2 because the primary status IS the followers' view.
- Per-audience color picker also deferred to Phase 4+; the `statusOverride.statusColor` and `paletteKey` schema slots are preserved (forward-compat) but not written by Phase 2. — **[Superseded 2026-06-13 (#217): the per-audience picker shipped and writes these slots; see the top-of-doc banner.]**
- New code: own status row + override toggle inside the group-context header; group cards reflect own-override color when ON+available (primary statusColor as the Phase 2 fill); roster renders each member's context-appropriate status.
- New db.js exports: `setStatusOverride`, `clearStatusOverride`, `watchOwnMemberOverride`. New groups.js exports: `toggleStatusOverride`, `setOverrideStatusAvailable`, `setOverrideStatusUnavailable`.
```

- [ ] **Step 4: Update §15 things-to-know**

Add a new bullet:

```markdown
- **Phase 2 designs preserve `statusColor` / `paletteKey` slots in `statusOverride` for Phase 4+.** Don't remove these from the schema; Phase 4+ will start writing them. Toggle OFF currently clears the whole override record; Phase 4+ will need to revisit that to preserve color/palette slots across toggle.
```

- [ ] **Step 5: Update §17 reference artifacts**

Add a sixth entry to the numbered list:

```markdown
6. **`docs/superpowers/plans/2026-05-27-groups-phase-2-status-overrides.md`** — Phase 2 plan as executed
```

- [ ] **Step 6: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "docs: refresh HANDOFF.md for post-Phase-2 state"
```

---

## Done

When all tasks complete:

- **Tests passing:** ~617 across 20 suites (590 baseline + ~27 Phase 2 tests, depending on jest's count of describe-block expansion).
- **Build clean:** `node scripts/dev-build.js` succeeds.
- **Manual UI verification:** Phase 2 cross-device sync verified by hand per Task 10 Step 5.
- **Schema:** `groups/{groupId}/members/{uid}/statusOverride: { enabled, status, availableUntil }` written; `statusColor` / `paletteKey` slots preserved unwritten for Phase 4+.
- **HANDOFF.md** refreshed.
- **Spec coverage:** §16 Phase 2 deliverables 1–5 implemented in scope. The dropped "followers audience" toggle (deliverable 1's parenthetical "plus the followers audience") is documented as a scope decision, not an oversight.

Use the `superpowers:finishing-a-development-branch` skill to integrate the work (PR → user merges to dev → user flips deploy when ready).
