# Groups Phase 3 — In-App Push Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Phase 3 in-app push invite flow (Flow C in the groups design spec). Owners can directly invite their followers into a group from the unified invite modal; invitees see pending invites in a new "Inbox" nav element and accept/decline from a modal.

**Architecture:**
- Data lives at `pendingInvites/{inviteeUid}/{groupId} = { from, ts }` (deterministic key for natural dedup). A parallel index `pendingInvitesByGroup/{groupId}/{inviteeUid} = true` enables the `deleteGroup` sweep without a full-tree scan. All writes are dual-writes; deletions are dual-deletes.
- The existing `inviteModal.js` is extended with a Section 2 (in-app picker) that renders only for `scope === 'group'`. Dismiss-on-tap-outside replaces the Cancel/Close buttons (for both scopes).
- The picker is a new module `js/invitePicker.js` that reads followers (via existing `watchFollowers`), mutuals (via `prefs.getFollowing`), current group members (via the already-active `watchGroupMembers` subscription in `groupContext.js`), and the pending-invite index for the group.
- The Inbox is a new module `js/inbox.js` that subscribes to `watchPendingInvites(ownUid)`, renders a single nav-row button (visible only when ≥1 pending), and opens its own modal listing all pending invites with per-row Join/Decline.

**Tech Stack:** Vanilla ES modules, Firebase Realtime Database, Jest + jsdom.

**Spec:** `docs/superpowers/specs/2026-05-25-groups-design.md` §10 Flow C, §16 Phase 3.

---

## File structure

**New files:**
- `js/invitePicker.js` — picker module: data sources, rendering, multi-select state, Invite button, "Invited" pill / un-invite.
- `js/inbox.js` — Inbox module: subscription, nav-row rendering, Inbox modal, Join/Decline handlers.
- `tests/invitePicker.test.js`
- `tests/inbox.test.js`

**Modified files:**
- `js/db.js` — add `watchPendingInvites`, `writePendingInvite`, `deletePendingInvite`, `readPendingInviteesForGroup`. ~50 lines added.
- `js/groups.js` — extend `deleteGroup` to sweep pending invites for that group. ~10 lines added.
- `js/groupContext.js` — settings menu button text update, add roster "+ Invite to group" row + handler. ~15 lines added.
- `js/groupNav.js` — render Inbox element before group cards in Direct mode. ~10 lines added.
- `js/inviteModal.js` — render Section 2 picker container when scope is 'group'; replace Cancel/Close handlers with overlay-click dismiss; pass picker callbacks. ~30 lines net.
- `js/app.js` — boot-time init of `inbox.init(userId)`. 1 line added.
- `index.template.html` — drop Cancel/Close buttons; add Section 2 DOM; rename "Invite link" → "Invite"; new Inbox button + modal. ~30 lines net.
- `database.rules.json` — add `pendingInvitesByGroup` path (honor-system rules).
- `css/app.css` — small additions for `.invite-picker-row`, `.invite-picker-pill-invited`, `.inbox-btn`, `.inbox-modal` styles. ~40 lines.
- Eleven test files — add `jest.fn()` stubs for the new `db.js` exports.

---

## Conventions used in this plan

- All tests use Jest's standard `describe`/`test`/`expect` API.
- Test files mock `js/db.js` (and other dependencies) with `jest.mock` factory functions, matching the pattern already established in `tests/groupContext.test.js`.
- New `js/db.js` exports must be added to **every** existing db-mocking test file as `jest.fn()` stubs. The current list: `tests/favorites.test.js`, `tests/following.test.js`, `tests/me.test.js`, `tests/mycode.test.js`, `tests/groupContext.test.js`, `tests/groupNav.test.js`, `tests/groups.test.js`, `tests/invites.test.js`, `tests/inviteModal.test.js`, `tests/knock.test.js`, `tests/recovery.test.js`. (Use `grep -l "jest.mock.*'../js/db.js'" tests/` to confirm before adding stubs.)
- Frequent commits — one commit per task minimum.

---

## Task 1: Add `db.js` primitives for the pending-invite mailbox

**Files:**
- Modify: `js/db.js` — add 4 functions
- Test: `tests/db.test.js` — does not exist; existing pattern is to test db.js indirectly through modules. Skip a dedicated test here; coverage comes via downstream module tests (Task 3 + Task 8 + Task 11).

- [ ] **Step 1: Add the four exports**

Append after the existing groups block (look for the end of `// ── Groups: invites ──`):

```javascript
// ── Pending invites mailbox ──────────────────────────────────────────────────
// Phase 3 in-app push invites. Schema:
//   pendingInvites/{inviteeUid}/{groupId} = { from, ts }
//   pendingInvitesByGroup/{groupId}/{inviteeUid} = true   (sweep index)
//
// Writes are dual-writes (primary + index); deletions are dual-deletes.
// Keyed by groupId (not a random inviteId) so re-inviting the same person to
// the same group is a natural overwrite — no duplicate entries, no race.

export function watchPendingInvites(inviteeUid, callback) {
  const inboxRef = ref(db, `pendingInvites/${inviteeUid}`);
  return onValue(inboxRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}

export async function writePendingInvite(inviterUid, inviteeUid, groupId) {
  const ts = Date.now();
  await update(ref(db), {
    [`pendingInvites/${inviteeUid}/${groupId}`]: { from: inviterUid, ts },
    [`pendingInvitesByGroup/${groupId}/${inviteeUid}`]: true,
  });
}

export async function deletePendingInvite(inviteeUid, groupId) {
  await update(ref(db), {
    [`pendingInvites/${inviteeUid}/${groupId}`]: null,
    [`pendingInvitesByGroup/${groupId}/${inviteeUid}`]: null,
  });
}

export async function readPendingInviteesForGroup(groupId) {
  const snap = await get(ref(db, `pendingInvitesByGroup/${groupId}`));
  return snap.exists() ? Object.keys(snap.val()) : [];
}
```

- [ ] **Step 2: Run the test suite to confirm nothing breaks**

```bash
npx jest
```

Expected: all previously-passing tests still pass. New exports aren't yet referenced anywhere; nothing should change.

- [ ] **Step 3: Commit**

```bash
git add js/db.js
git commit -m "feat(db): pending-invite mailbox primitives + sweep index"
```

---

## Task 2: Stub the new `db.js` exports in every db-mocking test file

**Files:**
- Modify: `tests/favorites.test.js`, `tests/following.test.js`, `tests/me.test.js`, `tests/mycode.test.js`, `tests/groupContext.test.js`, `tests/groupNav.test.js`, `tests/groups.test.js`, `tests/invites.test.js`, `tests/inviteModal.test.js`, `tests/knock.test.js`, `tests/recovery.test.js`

- [ ] **Step 1: Confirm the file list**

```bash
grep -l "jest.mock.*'../js/db.js'" tests/
```

Expected output: all 11 files above. If the list differs, use the actual output.

- [ ] **Step 2: Add stubs to each file**

For each file, find the `jest.mock('../js/db.js', () => ({` block and add these four entries inside the returned object literal (any position is fine):

```javascript
  watchPendingInvites: jest.fn(() => () => {}),
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readPendingInviteesForGroup: jest.fn().mockResolvedValue([]),
```

- [ ] **Step 3: Run all tests**

```bash
npx jest
```

Expected: all tests still pass. Stubs are harmless additions; no behavior should change.

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: stub new db.js pending-invite exports in mocking test files"
```

---

## Task 3: Extend `groups.deleteGroup` to sweep pending invites

**Files:**
- Modify: `js/groups.js` — `deleteGroup` function (~line 84)
- Test: `tests/groups.test.js`

- [ ] **Step 1: Write the failing test**

Open `tests/groups.test.js` and find the `describe('deleteGroup', ...)` block. Inside it, add:

```javascript
test('deleteGroup sweeps pending invites for the group', async () => {
  const { readGroup, deleteGroup: dbDeleteGroup, removeUserGroupsEntry,
          readPendingInviteesForGroup, deletePendingInvite } = require('../js/db.js');
  readGroup.mockResolvedValueOnce({ ownerId: 'me', name: 'Family', createdAt: 1 });
  readPendingInviteesForGroup.mockResolvedValueOnce(['inviteeA', 'inviteeB']);

  await deleteGroup('G1', 'me');

  expect(readPendingInviteesForGroup).toHaveBeenCalledWith('G1');
  expect(deletePendingInvite).toHaveBeenCalledWith('inviteeA', 'G1');
  expect(deletePendingInvite).toHaveBeenCalledWith('inviteeB', 'G1');
  expect(dbDeleteGroup).toHaveBeenCalledWith('G1');
  expect(removeUserGroupsEntry).toHaveBeenCalledWith('me', 'G1');
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
npx jest tests/groups.test.js -t "deleteGroup sweeps"
```

Expected: FAIL — `expect(readPendingInviteesForGroup).toHaveBeenCalledWith('G1')` will fail because the current `deleteGroup` doesn't call it.

- [ ] **Step 3: Add the imports and sweep logic**

Open `js/groups.js`. At the top, find the existing `import { ... } from './db.js';` block and add the two new imports:

```javascript
import {
  // ...existing imports stay as-is...
  readPendingInviteesForGroup, deletePendingInvite,
} from './db.js';
```

Then find the `deleteGroup` function (~line 84) and replace it with:

```javascript
export async function deleteGroup(groupId, callerUid) {
  const group = await requireOwner(groupId, callerUid);
  if (!group) return;
  // Sweep pending invites for this group BEFORE the entity itself is gone,
  // so any concurrent Join attempt against a stale invite sees the group
  // missing and silently dismisses (see Inbox accept flow, Task 11).
  const pendingInvitees = await readPendingInviteesForGroup(groupId);
  await Promise.all(pendingInvitees.map((inviteeUid) =>
    deletePendingInvite(inviteeUid, groupId)
  ));
  await dbDeleteGroup(groupId);
  await removeUserGroupsEntry(callerUid, groupId);
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
npx jest tests/groups.test.js -t "deleteGroup sweeps"
```

Expected: PASS.

- [ ] **Step 5: Run the rest of the deleteGroup tests to confirm no regression**

```bash
npx jest tests/groups.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add tests/groups.test.js js/groups.js
git commit -m "feat(groups): deleteGroup sweeps pending invites for the group"
```

---

## Task 4: Add `pendingInvitesByGroup` to database rules

**Files:**
- Modify: `database.rules.json`

- [ ] **Step 1: Add the rule block**

Open `database.rules.json`. After the existing `pendingInvites` block, add:

```json
    "pendingInvitesByGroup": {
      "$groupId": {
        ".read": true,
        ".write": true
      }
    },
```

The full result should have both blocks; verify with:

```bash
grep -A 5 '"pendingInvites"' database.rules.json
grep -A 5 '"pendingInvitesByGroup"' database.rules.json
```

- [ ] **Step 2: Commit**

```bash
git add database.rules.json
git commit -m "feat(rules): add pendingInvitesByGroup path (sweep index)"
```

---

## Task 5: Invite modal — drop Cancel/Close buttons, dismiss on overlay tap

**Files:**
- Modify: `index.template.html` (~line 65–66 and ~line 79)
- Modify: `js/inviteModal.js`
- Test: `tests/inviteModal.test.js`

- [ ] **Step 1: Write the failing test**

Open `tests/inviteModal.test.js`. Add a new test at the end of the file (inside the existing top-level `describe` block):

```javascript
test('clicking the modal overlay (outside the card) dismisses the modal', () => {
  document.body.innerHTML = `
    <div id="invite-modal" class="modal-overlay hidden">
      <div class="modal-card">
        <h2 id="invite-modal-title"></h2>
        <p id="invite-modal-subtitle"></p>
        <div id="invite-modal-create"></div>
        <div id="invite-modal-manage"></div>
      </div>
    </div>
  `;
  openInviteModal({ scope: 'personal', userId: 'u1' });
  expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(false);
  // Click the overlay (the modal-overlay element itself, not the card)
  document.getElementById('invite-modal').click();
  expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(true);
});

test('clicking inside the modal card does NOT dismiss', () => {
  document.body.innerHTML = `
    <div id="invite-modal" class="modal-overlay hidden">
      <div class="modal-card" id="card">
        <h2 id="invite-modal-title"></h2>
        <p id="invite-modal-subtitle"></p>
        <div id="invite-modal-create"></div>
        <div id="invite-modal-manage"></div>
      </div>
    </div>
  `;
  openInviteModal({ scope: 'personal', userId: 'u1' });
  document.getElementById('card').click();
  expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(false);
});
```

- [ ] **Step 2: Run — verify failures**

```bash
npx jest tests/inviteModal.test.js -t "overlay"
```

Expected: FAIL — overlay click doesn't currently dismiss.

- [ ] **Step 3: Update `index.template.html` — remove Cancel and Close buttons**

Find the line:

```html
          <button id="invite-modal-create-btn" class="primary-btn">Create invite link</button>
          <button id="invite-modal-cancel-btn" class="ghost-btn">Cancel</button>
```

Change to:

```html
          <button id="invite-modal-create-btn" class="primary-btn">Create invite link</button>
```

Find the line:

```html
          <button id="invite-modal-revoke-btn" class="ghost-btn">Revoke</button>
          <button id="invite-modal-close-btn" class="primary-btn">Close</button>
```

Change to:

```html
          <button id="invite-modal-revoke-btn" class="ghost-btn">Revoke</button>
```

- [ ] **Step 4: Update `js/inviteModal.js` — overlay-click dismiss; remove Cancel/Close handlers**

Open `js/inviteModal.js`. Find:

```javascript
  on(document.getElementById('invite-modal-cancel-btn'), 'click', () => closeModal());
```

Delete that line.

Find:

```javascript
  on(document.getElementById('invite-modal-close-btn'), 'click', () => closeModal());
}
```

Replace with:

```javascript
  // Dismiss on tap-outside (overlay click, but not card click).
  const overlay = document.getElementById('invite-modal');
  on(overlay, 'click', (e) => {
    if (e.target === overlay) closeModal();
  });
}
```

- [ ] **Step 5: Run — verify the new tests pass**

```bash
npx jest tests/inviteModal.test.js
```

Expected: all pass. Existing tests that referenced `invite-modal-cancel-btn` or `invite-modal-close-btn` may fail; if so, delete those tests or remove the obsolete button references inside them.

- [ ] **Step 6: Commit**

```bash
git add index.template.html js/inviteModal.js tests/inviteModal.test.js
git commit -m "feat(inviteModal): dismiss on overlay tap; drop Cancel/Close buttons"
```

---

## Task 6: Invite modal — add Section 2 DOM (in-app picker container)

**Files:**
- Modify: `index.template.html` — add picker section
- Modify: `js/inviteModal.js` — show/hide the section based on scope

- [ ] **Step 1: Write the failing test**

Open `tests/inviteModal.test.js`. Add:

```javascript
test('Section 2 (in-app picker) renders when scope is group', () => {
  document.body.innerHTML = `
    <div id="invite-modal" class="modal-overlay hidden">
      <div class="modal-card">
        <h2 id="invite-modal-title"></h2>
        <p id="invite-modal-subtitle"></p>
        <div id="invite-modal-create"></div>
        <div id="invite-modal-manage"></div>
        <div id="invite-modal-picker" class="hidden">
          <p id="invite-modal-picker-framing"></p>
          <button id="invite-modal-picker-send-btn"></button>
          <ul id="invite-modal-picker-list"></ul>
        </div>
      </div>
    </div>
  `;
  openInviteModal({ scope: 'group', userId: 'u1', groupId: 'G1', groupName: 'Family' });
  expect(document.getElementById('invite-modal-picker').classList.contains('hidden')).toBe(false);
});

test('Section 2 (in-app picker) is hidden when scope is personal', () => {
  document.body.innerHTML = `
    <div id="invite-modal" class="modal-overlay hidden">
      <div class="modal-card">
        <h2 id="invite-modal-title"></h2>
        <p id="invite-modal-subtitle"></p>
        <div id="invite-modal-create"></div>
        <div id="invite-modal-manage"></div>
        <div id="invite-modal-picker" class="hidden">
          <p id="invite-modal-picker-framing"></p>
          <button id="invite-modal-picker-send-btn"></button>
          <ul id="invite-modal-picker-list"></ul>
        </div>
      </div>
    </div>
  `;
  openInviteModal({ scope: 'personal', userId: 'u1' });
  expect(document.getElementById('invite-modal-picker').classList.contains('hidden')).toBe(true);
});
```

- [ ] **Step 2: Run — verify failures**

```bash
npx jest tests/inviteModal.test.js -t "Section 2"
```

Expected: FAIL — the picker is always hidden because nothing shows it.

- [ ] **Step 3: Add the picker DOM to `index.template.html`**

Find the `invite-modal-manage` block:

```html
      <div id="invite-modal-manage" class="hidden">
        <div class="recovery-display">
          <code id="invite-modal-url" class="recovery-code-text"></code>
          <button id="invite-modal-regen-btn" class="rotate-btn" title="Generate new invite link" aria-label="Generate new invite link">↻</button>
          <button id="invite-modal-copy-btn" class="ghost-btn">Copy</button>
        </div>
        <div class="modal-actions">
          <button id="invite-modal-revoke-btn" class="ghost-btn">Revoke</button>
        </div>
      </div>
```

After it, add a new sibling block:

```html
      <div id="invite-modal-picker" class="hidden invite-picker">
        <p id="invite-modal-picker-framing" class="invite-picker-framing">Invite specific people directly into the group.</p>
        <button id="invite-modal-picker-send-btn" class="primary-btn">Invite</button>
        <ul id="invite-modal-picker-list" class="invite-picker-list"></ul>
      </div>
```

- [ ] **Step 4: Show / hide the picker based on scope in `js/inviteModal.js`**

In `openInviteModal`, after the existing block that toggles the label hint/input visibility based on `copy.needsLabel`, add:

```javascript
  // Section 2 (in-app picker) — group scope only.
  const pickerEl = document.getElementById('invite-modal-picker');
  if (pickerEl) {
    pickerEl.classList.toggle('hidden', scope !== 'group');
  }
```

- [ ] **Step 5: Run — verify passing**

```bash
npx jest tests/inviteModal.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add index.template.html js/inviteModal.js tests/inviteModal.test.js
git commit -m "feat(inviteModal): add Section 2 picker DOM container, scope-gated"
```

---

## Task 7: Build the invite picker — data source + rendering

**Files:**
- Create: `js/invitePicker.js`
- Create: `tests/invitePicker.test.js`

The picker module needs to:
1. Collect the inviter's followers + mutuals + current group members + current pending invitees for the group.
2. Render rows: mutuals first (by label, sorted), then non-mutual followers (by code, sorted). Exclude current group members.
3. Show "Invited" pill for rows that have a pending invite for this group; tap → un-invite.
4. Tap a non-Invited row to toggle a "selected" state.
5. "Invite" button sends to all selected; selected rows flip to "Invited" state, selection clears.

- [ ] **Step 1: Write the failing tests**

Create `tests/invitePicker.test.js`:

```javascript
// tests/invitePicker.test.js
jest.mock('../js/db.js', () => ({
  writePendingInvite: jest.fn().mockResolvedValue(undefined),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../js/db.js');
const { renderInvitePicker } = require('../js/invitePicker.js');

function makeContainer() {
  document.body.innerHTML = `
    <div>
      <button id="invite-modal-picker-send-btn"></button>
      <ul id="invite-modal-picker-list"></ul>
    </div>
  `;
}

beforeEach(() => {
  jest.clearAllMocks();
  makeContainer();
});

describe('renderInvitePicker', () => {
  test('renders mutuals first (by label), then non-mutual followers (by code)', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uMutA: 'codeA', uMutB: 'codeB', uFollC: 'codeC', uFollD: 'codeD' },
      mutuals: [{ userId: 'uMutB', label: 'Bea' }, { userId: 'uMutA', label: 'Alex' }],
      currentMemberUids: new Set(['someoneElse']),
      pendingInviteeUids: new Set(),
    });
    const rows = document.querySelectorAll('#invite-modal-picker-list .invite-picker-row');
    expect(rows.length).toBe(4);
    // Mutuals first, sorted by label: Alex, Bea
    expect(rows[0].dataset.uid).toBe('uMutA');
    expect(rows[1].dataset.uid).toBe('uMutB');
    // Non-mutual followers next, sorted by code: codeC, codeD
    expect(rows[2].dataset.uid).toBe('uFollC');
    expect(rows[3].dataset.uid).toBe('uFollD');
  });

  test('excludes followers who are already group members', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uA: 'codeA', uB: 'codeB' },
      mutuals: [],
      currentMemberUids: new Set(['uB']),
      pendingInviteeUids: new Set(),
    });
    const rows = document.querySelectorAll('.invite-picker-row');
    expect(rows.length).toBe(1);
    expect(rows[0].dataset.uid).toBe('uA');
  });

  test('rows with a pending invite show an Invited pill instead of selection indicator', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uA: 'codeA', uB: 'codeB' },
      mutuals: [],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(['uA']),
    });
    const rowA = document.querySelector('.invite-picker-row[data-uid="uA"]');
    const rowB = document.querySelector('.invite-picker-row[data-uid="uB"]');
    expect(rowA.querySelector('.invite-picker-pill-invited')).not.toBeNull();
    expect(rowB.querySelector('.invite-picker-pill-invited')).toBeNull();
  });

  test('tapping an unselected row toggles selection', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uA: 'codeA' },
      mutuals: [],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    const row = document.querySelector('.invite-picker-row[data-uid="uA"]');
    row.click();
    expect(row.classList.contains('selected')).toBe(true);
    row.click();
    expect(row.classList.contains('selected')).toBe(false);
  });

  test('Invite button writes pending invites for each selected row', async () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uA: 'codeA', uB: 'codeB' },
      mutuals: [],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    document.querySelector('.invite-picker-row[data-uid="uA"]').click();
    document.querySelector('.invite-picker-row[data-uid="uB"]').click();
    document.getElementById('invite-modal-picker-send-btn').click();
    // Let pending microtasks resolve
    await Promise.resolve();
    await Promise.resolve();
    expect(db.writePendingInvite).toHaveBeenCalledWith('me', 'uA', 'G1');
    expect(db.writePendingInvite).toHaveBeenCalledWith('me', 'uB', 'G1');
  });

  test('after Invite sends, the affected rows flip to Invited state and selection clears', async () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uA: 'codeA' },
      mutuals: [],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    const row = document.querySelector('.invite-picker-row[data-uid="uA"]');
    row.click();
    document.getElementById('invite-modal-picker-send-btn').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(row.classList.contains('selected')).toBe(false);
    expect(row.querySelector('.invite-picker-pill-invited')).not.toBeNull();
  });

  test('tapping an Invited pill deletes the pending invite and re-renders the row as selectable', async () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uA: 'codeA' },
      mutuals: [],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(['uA']),
    });
    const pill = document.querySelector('.invite-picker-row[data-uid="uA"] .invite-picker-pill-invited');
    pill.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(db.deletePendingInvite).toHaveBeenCalledWith('uA', 'G1');
    const row = document.querySelector('.invite-picker-row[data-uid="uA"]');
    expect(row.querySelector('.invite-picker-pill-invited')).toBeNull();
  });

  test('rendering shows mutuals by their local label; non-mutual followers by share code', () => {
    renderInvitePicker({
      inviterUid: 'me',
      groupId: 'G1',
      followers: { uMut: 'mutCode', uFoll: 'follCode' },
      mutuals: [{ userId: 'uMut', label: 'Bea' }],
      currentMemberUids: new Set(),
      pendingInviteeUids: new Set(),
    });
    const mutRow = document.querySelector('.invite-picker-row[data-uid="uMut"]');
    const follRow = document.querySelector('.invite-picker-row[data-uid="uFoll"]');
    expect(mutRow.querySelector('.invite-picker-name').textContent).toBe('Bea');
    expect(follRow.querySelector('.invite-picker-name').textContent).toBe('follCode');
  });
});
```

- [ ] **Step 2: Run — verify failures**

```bash
npx jest tests/invitePicker.test.js
```

Expected: ALL FAIL — `js/invitePicker.js` doesn't exist yet.

- [ ] **Step 3: Create `js/invitePicker.js`**

```javascript
// js/invitePicker.js
// Phase 3 in-app invite picker. Lives inside the unified invite modal's
// Section 2 for group-scope invites.
//
// Responsibilities:
//   - Render the merged list (mutuals first, then non-mutual followers)
//   - Filter out current group members and the inviter themself
//   - Show "Invited" pill on rows with a pending invite
//   - Multi-select state for unselected rows
//   - Invite button → writePendingInvite for each selected; flip rows to Invited
//   - Tap "Invited" pill → deletePendingInvite; flip row back to selectable
//
// Data is injected (followers map, mutuals list, current member set, pending
// invitee set) rather than fetched inside this module so callers can shape
// the data freely and tests don't need to mock subscriptions.

import { writePendingInvite, deletePendingInvite } from './db.js';

let _state = null;

export function renderInvitePicker({
  inviterUid, groupId, followers, mutuals, currentMemberUids, pendingInviteeUids,
}) {
  _state = {
    inviterUid, groupId,
    selected: new Set(),
    pendingInviteeUids: new Set(pendingInviteeUids || []),
  };

  // Build the rendered list of { uid, displayName }, mutuals first.
  const mutualLookup = new Map(mutuals.map((m) => [m.userId, m.label]));
  const mutualEntries = mutuals
    .filter((m) => followers[m.userId] && !currentMemberUids.has(m.userId) && m.userId !== inviterUid)
    .map((m) => ({ uid: m.userId, displayName: m.label }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const nonMutualEntries = Object.entries(followers)
    .filter(([uid]) => !mutualLookup.has(uid) && !currentMemberUids.has(uid) && uid !== inviterUid)
    .map(([uid, code]) => ({ uid, displayName: code }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const listEl = document.getElementById('invite-modal-picker-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  for (const entry of [...mutualEntries, ...nonMutualEntries]) {
    listEl.appendChild(buildRow(entry));
  }

  const sendBtn = document.getElementById('invite-modal-picker-send-btn');
  if (sendBtn) {
    // Remove any prior click handler to avoid double-binding across re-renders.
    const fresh = sendBtn.cloneNode(true);
    sendBtn.parentNode.replaceChild(fresh, sendBtn);
    fresh.addEventListener('click', () => sendSelected());
  }
}

function buildRow({ uid, displayName }) {
  const li = document.createElement('li');
  li.className = 'invite-picker-row';
  li.dataset.uid = uid;

  const dot = document.createElement('span');
  dot.className = 'invite-picker-dot';
  li.appendChild(dot);

  const name = document.createElement('span');
  name.className = 'invite-picker-name';
  name.textContent = displayName;
  li.appendChild(name);

  const trailing = document.createElement('span');
  trailing.className = 'invite-picker-trailing';
  li.appendChild(trailing);

  refreshTrailing(li, uid);

  li.addEventListener('click', (e) => {
    // Pill click handles itself; don't double-toggle the row.
    if (e.target.closest('.invite-picker-pill-invited')) return;
    if (_state.pendingInviteeUids.has(uid)) return; // pending rows aren't selectable
    li.classList.toggle('selected');
    if (li.classList.contains('selected')) _state.selected.add(uid);
    else _state.selected.delete(uid);
  });

  return li;
}

function refreshTrailing(li, uid) {
  const trailing = li.querySelector('.invite-picker-trailing');
  if (!trailing) return;
  trailing.innerHTML = '';
  if (_state.pendingInviteeUids.has(uid)) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'invite-picker-pill-invited';
    pill.textContent = 'Invited';
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      unInvite(uid, li);
    });
    trailing.appendChild(pill);
    li.classList.remove('selected');
  } else {
    const indicator = document.createElement('span');
    indicator.className = 'invite-picker-indicator';
    trailing.appendChild(indicator);
  }
}

async function sendSelected() {
  if (!_state) return;
  const uids = Array.from(_state.selected);
  if (uids.length === 0) return;
  await Promise.all(uids.map((uid) =>
    writePendingInvite(_state.inviterUid, uid, _state.groupId)
  ));
  // Flip selected rows to Invited; clear selection.
  for (const uid of uids) {
    _state.pendingInviteeUids.add(uid);
    _state.selected.delete(uid);
    const row = document.querySelector(`.invite-picker-row[data-uid="${uid}"]`);
    if (row) refreshTrailing(row, uid);
  }
}

async function unInvite(uid, li) {
  if (!_state) return;
  await deletePendingInvite(uid, _state.groupId);
  _state.pendingInviteeUids.delete(uid);
  refreshTrailing(li, uid);
}
```

- [ ] **Step 4: Run — verify passing**

```bash
npx jest tests/invitePicker.test.js
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/invitePicker.js tests/invitePicker.test.js
git commit -m "feat(invitePicker): in-app invite picker module"
```

---

## Task 8: Wire the picker into the invite modal for group scope

**Files:**
- Modify: `js/inviteModal.js` — call `renderInvitePicker` with live data when scope is `group`
- Test: `tests/inviteModal.test.js` (extend)

The modal needs to assemble the picker's input data from existing sources:
- `followers`: live snapshot from `watchFollowers` — already subscribed in `following.js`. To avoid creating a second subscription, the modal receives the current followers map as a parameter (callers pass it).
- `mutuals`: derived from `prefs.getFollowing()` (the user's following list, with `userId`/`code`/`label`).
- `currentMemberUids`: passed in by the caller (`groupContext.js` has the live member map).
- `pendingInviteeUids`: one-shot read via `readPendingInviteesForGroup` on modal open.

- [ ] **Step 1: Write the failing test**

Add to `tests/inviteModal.test.js`:

```javascript
test('openInviteModal in group scope calls renderInvitePicker with the supplied data', async () => {
  jest.resetModules();
  const renderInvitePickerMock = jest.fn();
  jest.doMock('../js/invitePicker.js', () => ({ renderInvitePicker: renderInvitePickerMock }));
  jest.doMock('../js/db.js', () => ({
    createPersonalInvite: jest.fn(),
    regeneratePersonalInvite: jest.fn(),
    revokePersonalInvite: jest.fn(),
    createGroupInvite: jest.fn(),
    regenerateGroupInvite: jest.fn(),
    revokeGroupInvite: jest.fn(),
    readPendingInviteesForGroup: jest.fn().mockResolvedValue(['existingInvitee']),
  }));
  const { openInviteModal } = require('../js/inviteModal.js');
  document.body.innerHTML = `
    <div id="invite-modal" class="modal-overlay hidden">
      <div class="modal-card">
        <h2 id="invite-modal-title"></h2>
        <p id="invite-modal-subtitle"></p>
        <div id="invite-modal-create"></div>
        <div id="invite-modal-manage"></div>
        <div id="invite-modal-picker" class="hidden">
          <p id="invite-modal-picker-framing"></p>
          <button id="invite-modal-picker-send-btn"></button>
          <ul id="invite-modal-picker-list"></ul>
        </div>
      </div>
    </div>
  `;
  await openInviteModal({
    scope: 'group',
    userId: 'me',
    groupId: 'G1',
    groupName: 'Family',
    followers: { uA: 'codeA' },
    mutuals: [],
    currentMemberUids: new Set(['someoneElse']),
  });
  expect(renderInvitePickerMock).toHaveBeenCalledTimes(1);
  const call = renderInvitePickerMock.mock.calls[0][0];
  expect(call.inviterUid).toBe('me');
  expect(call.groupId).toBe('G1');
  expect(call.followers).toEqual({ uA: 'codeA' });
  expect(call.pendingInviteeUids.has('existingInvitee')).toBe(true);
});
```

- [ ] **Step 2: Run — verify failure**

```bash
npx jest tests/inviteModal.test.js -t "renderInvitePicker"
```

Expected: FAIL — modal doesn't call `renderInvitePicker` yet.

- [ ] **Step 3: Update `js/inviteModal.js`**

At the top of the file, add the import:

```javascript
import { readPendingInviteesForGroup } from './db.js';
import { renderInvitePicker } from './invitePicker.js';
```

Inside `openInviteModal`, after the existing block that toggles the picker container's visibility, add:

```javascript
  // Section 2 — populate the picker for group scope only.
  if (scope === 'group') {
    const pendingInvitees = await readPendingInviteesForGroup(groupId);
    renderInvitePicker({
      inviterUid: userId,
      groupId,
      followers: arguments[0].followers || {},
      mutuals: arguments[0].mutuals || [],
      currentMemberUids: arguments[0].currentMemberUids || new Set(),
      pendingInviteeUids: new Set(pendingInvitees),
    });
  }
```

> **Note on style:** the `arguments[0]` usage avoids re-listing every modal option in the function signature for one optional field per scope. If you prefer, refactor the function signature to a single `opts` parameter and destructure inside.

Also change the function declaration to `async`:

```javascript
export async function openInviteModal({ scope, userId, activeInvite = null, groupId = null, groupName = null, followers = {}, mutuals = [], currentMemberUids = new Set() }) {
```

Now replace the `arguments[0].followers` etc. references inside the new block with the destructured names:

```javascript
  if (scope === 'group') {
    const pendingInvitees = await readPendingInviteesForGroup(groupId);
    renderInvitePicker({
      inviterUid: userId,
      groupId,
      followers,
      mutuals,
      currentMemberUids,
      pendingInviteeUids: new Set(pendingInvitees),
    });
  }
```

- [ ] **Step 4: Run — verify the new test passes**

```bash
npx jest tests/inviteModal.test.js -t "renderInvitePicker"
```

Expected: PASS.

- [ ] **Step 5: Run the full inviteModal test suite**

```bash
npx jest tests/inviteModal.test.js
```

Expected: all pass. Some pre-existing tests may have synchronous expectations against `openInviteModal`; if so, change those tests to `await openInviteModal(...)`.

- [ ] **Step 6: Commit**

```bash
git add js/inviteModal.js tests/inviteModal.test.js
git commit -m "feat(inviteModal): wire group-scope picker with live data"
```

---

## Task 9: Group settings — rename "Invite link" → "Invite"

**Files:**
- Modify: `index.template.html` (~line 226)
- Modify: `js/groupContext.js` — pass picker data to the modal
- Test: `tests/groupContext.test.js`

- [ ] **Step 1: Update the button label**

In `index.template.html`, find:

```html
                <button id="group-action-invite" class="ghost-btn hidden">Invite link</button>
```

Change to:

```html
                <button id="group-action-invite" class="ghost-btn hidden">Invite</button>
```

- [ ] **Step 2: Pass picker data to `openInviteModal` from the settings handler**

Open `js/groupContext.js`. Find the existing handler at ~line 816:

```javascript
  document.getElementById('group-action-invite').addEventListener('click', () => {
```

The handler currently does something like `openInviteModal({ scope: 'group', userId, groupId, groupName, activeInvite })`. Read the existing call site and extend it to also pass:

```javascript
  openInviteModal({
    scope: 'group',
    userId: callerUid,
    groupId,
    groupName,
    activeInvite,
    followers: getCurrentFollowersMap(),         // see Step 3
    mutuals: getCurrentMutuals(),                // see Step 3
    currentMemberUids: new Set(Object.keys(_members || {})),
  });
```

(Exact variable names — `callerUid`, `groupName`, `activeInvite`, `_members` — should match what's already in scope at the call site. Don't invent new names if the existing identifiers differ.)

- [ ] **Step 3: Add small helpers for `followers` and `mutuals`**

The followers map is in the live subscription, which is owned by `following.js`. The simplest path: export a small accessor.

In `js/following.js`, find where `latestFollowersSnapshot` is declared (~line 119). Below `updateFolloweeRow` or near the top-level helpers, add an export:

```javascript
// Snapshot accessor for callers that need the current followers + mutuals
// without setting up their own subscription. Currently used by the Phase 3
// invite picker.
export function getCurrentFollowersMap() {
  if (!latestFollowersSnapshot) return {};
  // Snapshot is an array of { userId, code }; convert to a map.
  const out = {};
  for (const f of latestFollowersSnapshot) out[f.userId] = f.code;
  return out;
}

export function getCurrentMutuals() {
  const followers = getCurrentFollowersMap();
  return getFollowing()
    .filter((f) => followers[f.userId])
    .map((f) => ({ userId: f.userId, label: f.label, code: f.code }));
}
```

Then in `js/groupContext.js`, add the import at the top:

```javascript
import { getCurrentFollowersMap, getCurrentMutuals } from './following.js';
```

- [ ] **Step 4: Write a regression test for the renamed button**

Add to `tests/groupContext.test.js`:

```javascript
test('group settings button reads "Invite" (Phase 3 rename from "Invite link")', () => {
  setupContextDom();
  const btn = document.getElementById('group-action-invite');
  expect(btn.textContent).toBe('Invite');
});
```

- [ ] **Step 5: Run — verify passing**

```bash
npx jest tests/groupContext.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add index.template.html js/groupContext.js js/following.js tests/groupContext.test.js
git commit -m "feat(groupContext): rename Invite link → Invite, pass picker data"
```

---

## Task 10: Add "+ Invite to group" row at top of group roster

**Files:**
- Modify: `js/groupContext.js` — render the row, owner-only, click → open invite modal
- Modify: `css/app.css` — minimal styling, mirror `.add-btn`
- Test: `tests/groupContext.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/groupContext.test.js`, add:

```javascript
test('group roster shows "+ Invite to group" row for the owner', () => {
  // Owner is "me"
  enterGroupContext('G1', 'me');
  cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
  // ... whatever the existing test helpers do to populate members
  const row = document.getElementById('group-roster-invite-row');
  expect(row).not.toBeNull();
  expect(row.classList.contains('hidden')).toBe(false);
});

test('group roster does NOT show "+ Invite to group" row for non-owner members', () => {
  enterGroupContext('G1', 'me');
  cbs.getMetaCb()({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
  const row = document.getElementById('group-roster-invite-row');
  expect(row === null || row.classList.contains('hidden')).toBe(true);
});

test('clicking the roster invite row opens the invite modal in group scope', () => {
  enterGroupContext('G1', 'me');
  cbs.getMetaCb()({ name: 'Family', ownerId: 'me', createdAt: 1 });
  const inviteModalMock = require('../js/inviteModal.js');
  document.getElementById('group-roster-invite-row').click();
  expect(inviteModalMock.openInviteModal).toHaveBeenCalledWith(
    expect.objectContaining({ scope: 'group', groupId: 'G1', groupName: 'Family' })
  );
});
```

(The test scaffolding mirrors the existing `describe('group roster render', ...)` and `describe('owner actions', ...)` blocks; reuse their `captureCallbacks`/`setupContextDom` helpers. If the existing test mock for `js/inviteModal.js` doesn't yet expose `openInviteModal` as a jest.fn(), add it to that mock.)

- [ ] **Step 2: Run — verify failure**

```bash
npx jest tests/groupContext.test.js -t "Invite to group"
```

Expected: FAIL — no such row in the DOM yet.

- [ ] **Step 3: Render the row in `renderRoster`**

Open `js/groupContext.js`. Find `renderRoster` (~line 107). At the top of the roster `<ul>` (immediately after `ul.innerHTML = ''` or equivalent), insert the row:

```javascript
function renderRoster(members, ownUserId) {
  const ul = document.getElementById('group-roster');
  if (!ul) return;
  ul.innerHTML = '';

  // Owner-only "+ Invite to group" row pinned at the top of the roster.
  const meta = /* read existing meta variable; if not in scope, fall through with feature flag */;
  const isOwner = meta && meta.ownerId === ownUserId;
  if (isOwner) {
    const inviteRow = document.createElement('li');
    inviteRow.id = 'group-roster-invite-row';
    inviteRow.className = 'roster-invite-row';
    inviteRow.innerHTML = `<button class="add-btn">+ Invite to group</button>`;
    inviteRow.querySelector('button').addEventListener('click', () => {
      openInviteModal({
        scope: 'group',
        userId: ownUserId,
        groupId: _currentGroupId,
        groupName: meta.name,
        activeInvite: _activeGroupInvite,
        followers: getCurrentFollowersMap(),
        mutuals: getCurrentMutuals(),
        currentMemberUids: new Set(Object.keys(members || {})),
      });
    });
    ul.appendChild(inviteRow);
  }

  // ...existing roster-member rendering follows...
}
```

(The existing `renderRoster` accesses ownerId via a captured variable; reuse it instead of re-deriving. If `meta` is not in scope, read from `_currentGroupMeta` or whatever the existing render uses.)

- [ ] **Step 4: Add minimal CSS**

In `css/app.css`, append:

```css
.roster-invite-row { list-style: none; padding: 0; margin: 0 0 0.5rem 0; }
.roster-invite-row .add-btn {
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px dashed var(--text-muted);
  color: var(--text-muted);
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  cursor: pointer;
}
.roster-invite-row .add-btn:hover { color: var(--text); border-color: var(--text); }
```

- [ ] **Step 5: Run — verify passing**

```bash
npx jest tests/groupContext.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add js/groupContext.js css/app.css tests/groupContext.test.js
git commit -m "feat(groupContext): owner-only '+ Invite to group' row at top of roster"
```

---

## Task 11: Inbox module — subscription, nav-row element, modal

**Files:**
- Create: `js/inbox.js`
- Create: `js/groupDisplayNamePrompt.js` — small extract of the existing in-app.js prompt so Inbox can reuse it
- Create: `tests/inbox.test.js`
- Modify: `index.template.html` — add Inbox modal DOM
- Modify: `js/app.js` — import the prompt from its new module instead of defining it locally

The Inbox module owns:
- The `watchPendingInvites` subscription
- A render of the Inbox button into `#nav-row-inbox-slot` (visible when ≥1 pending; hidden when 0)
- The Inbox modal that lists pending invites with per-row Join/Decline
- The Join handler — prompts for the invitee's group display name (reusing the existing `#group-displayname-screen`), checks membership, calls `joinGroup`, deletes the pending record, navigates
- The Decline handler — deletes the pending record

The displayName prompt for Inbox-Join uses the **same** `#group-displayname-screen` element that Flow A/B already use. To avoid duplicating the prompt logic, extract `showGroupDisplayNamePrompt` from `js/app.js` into a new tiny module and have both call sites import it.

- [ ] **Step 1: Extract `showGroupDisplayNamePrompt` to its own module**

Create `js/groupDisplayNamePrompt.js`:

```javascript
// js/groupDisplayNamePrompt.js
// Reusable "Your name in '{group}'" prompt screen. Wraps the static
// #group-displayname-screen DOM with a promise-based API. Used by:
//   - app.js boot-time link-join flow (Flow A in the groups design spec)
//   - inbox.js Inbox-Join flow (Flow C)

export function showGroupDisplayNamePrompt(groupName) {
  const screen = document.getElementById('group-displayname-screen');
  const framing = document.getElementById('group-displayname-framing');
  const input = document.getElementById('group-displayname-input');
  const errEl = document.getElementById('group-displayname-error');
  const submit = document.getElementById('group-displayname-submit-btn');

  framing.textContent = `Your name in '${groupName}'`;
  errEl.textContent = '';
  errEl.classList.add('hidden');
  input.value = '';
  screen.classList.remove('hidden');

  return new Promise((resolve, reject) => {
    function onSubmit() {
      const trimmed = (input.value || '').trim();
      if (!trimmed) { errEl.textContent = 'Please enter a name.'; errEl.classList.remove('hidden'); return; }
      if (trimmed.length > 40) { errEl.textContent = 'Name must be at most 40 characters.'; errEl.classList.remove('hidden'); return; }
      submit.removeEventListener('click', onSubmit);
      screen.classList.add('hidden');
      resolve(trimmed);
    }
    submit.addEventListener('click', onSubmit);
  });
}

export function cancelGroupDisplayNamePrompt() {
  const screen = document.getElementById('group-displayname-screen');
  if (screen) screen.classList.add('hidden');
}
```

Then update `js/app.js`: remove the inline `showGroupDisplayNamePrompt` function definition and replace with an import at the top:

```javascript
import { showGroupDisplayNamePrompt } from './groupDisplayNamePrompt.js';
```

Find the existing call sites of `showGroupDisplayNamePrompt(...)` in `app.js` — they continue to work unchanged because the function shape is identical.

- [ ] **Step 2: Add Inbox modal DOM to `index.template.html`**

Find the existing `#invite-modal` block and after its closing `</div>` (the outer `.modal-overlay`), add:

```html
  <div id="inbox-modal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="inbox-modal-title">
    <div class="modal-card">
      <h2 id="inbox-modal-title" class="modal-title">Inbox</h2>
      <ul id="inbox-modal-list" class="inbox-modal-list"></ul>
    </div>
  </div>
```

- [ ] **Step 3: Write the failing tests**

Create `tests/inbox.test.js`:

```javascript
// tests/inbox.test.js
jest.mock('../js/db.js', () => ({
  watchPendingInvites: jest.fn(),
  deletePendingInvite: jest.fn().mockResolvedValue(undefined),
  readGroup: jest.fn(),
  readMember: jest.fn().mockResolvedValue(null),
}));
jest.mock('../js/groups.js', () => ({
  joinGroup: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/groupNav.js', () => ({
  navigateToGroup: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/prefs.js', () => ({
  getFollowing: jest.fn(() => [
    { userId: 'uOwner1', code: 'codeOwn1', label: 'Owner One' },
    { userId: 'uOwner2', code: 'codeOwn2', label: 'Owner Two' },
  ]),
}));
jest.mock('../js/groupDisplayNamePrompt.js', () => ({
  showGroupDisplayNamePrompt: jest.fn().mockResolvedValue('My Group Name'),
}));

const db = require('../js/db.js');
const groups = require('../js/groups.js');
const groupNav = require('../js/groupNav.js');
const prompt = require('../js/groupDisplayNamePrompt.js');
const { initInbox, renderInboxNavSlot, openInboxModal, getPendingCount } = require('../js/inbox.js');

function setupDom() {
  document.body.innerHTML = `
    <div id="nav-row-inbox-slot"></div>
    <div id="inbox-modal" class="modal-overlay hidden">
      <div class="modal-card">
        <h2 id="inbox-modal-title"></h2>
        <ul id="inbox-modal-list"></ul>
      </div>
    </div>
    <div id="group-displayname-screen" class="hidden">
      <p id="group-displayname-framing"></p>
      <input id="group-displayname-input" />
      <p id="group-displayname-error" class="hidden"></p>
      <button id="group-displayname-submit-btn"></button>
    </div>
  `;
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDom();
});

describe('Inbox', () => {
  test('subscribes via watchPendingInvites on init', () => {
    initInbox('me');
    expect(db.watchPendingInvites).toHaveBeenCalledWith('me', expect.any(Function));
  });

  test('renders no button when there are zero pending invites', () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    initInbox('me');
    cb({});
    expect(document.querySelector('#nav-row-inbox-slot .inbox-btn')).toBeNull();
  });

  test('renders an Inbox button in the slot when ≥1 pending invite', () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } });
    expect(document.querySelector('#nav-row-inbox-slot .inbox-btn')).not.toBeNull();
  });

  test('opening the Inbox modal lists one row per pending invite', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockImplementation((gid) => Promise.resolve({ name: gid === 'G1' ? 'Family' : 'Work' }));
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 }, G2: { from: 'uOwner2', ts: 2 } });
    await openInboxModal();
    const rows = document.querySelectorAll('#inbox-modal-list .inbox-row');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Owner One');
    expect(rows[0].textContent).toContain('Family');
  });

  test('Join prompts for displayName, calls joinGroup, deletes pending, navigates', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockResolvedValue({ name: 'Family' });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } });
    await openInboxModal();
    const joinBtn = document.querySelector('#inbox-modal-list .inbox-row[data-group-id="G1"] .inbox-join-btn');
    joinBtn.click();
    // Allow promises in handleJoin to resolve
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(prompt.showGroupDisplayNamePrompt).toHaveBeenCalledWith('Family');
    expect(groups.joinGroup).toHaveBeenCalledWith('G1', 'me', 'My Group Name');
    expect(db.deletePendingInvite).toHaveBeenCalledWith('me', 'G1');
    expect(groupNav.navigateToGroup).toHaveBeenCalledWith('G1');
  });

  test('Join on a row where the user is already a member silently dismisses (no prompt, no joinGroup)', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockResolvedValue({ name: 'Family' });
    db.readMember.mockResolvedValueOnce({ role: 'member', displayName: 'Me', joinedAt: 1 });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } });
    await openInboxModal();
    const joinBtn = document.querySelector('#inbox-modal-list .inbox-row[data-group-id="G1"] .inbox-join-btn');
    joinBtn.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(prompt.showGroupDisplayNamePrompt).not.toHaveBeenCalled();
    expect(groups.joinGroup).not.toHaveBeenCalled();
    expect(db.deletePendingInvite).toHaveBeenCalledWith('me', 'G1');
  });

  test('Join on a row whose group has been deleted silently dismisses', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockResolvedValue(null);
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } });
    await openInboxModal();
    const joinBtn = document.querySelector('#inbox-modal-list .inbox-row[data-group-id="G1"] .inbox-join-btn');
    joinBtn.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(groups.joinGroup).not.toHaveBeenCalled();
    expect(db.deletePendingInvite).toHaveBeenCalledWith('me', 'G1');
  });

  test('Decline deletes the pending record without joining', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    db.readGroup.mockResolvedValue({ name: 'Family' });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } });
    await openInboxModal();
    const declineBtn = document.querySelector('#inbox-modal-list .inbox-row[data-group-id="G1"] .inbox-decline-btn');
    declineBtn.click();
    await Promise.resolve(); await Promise.resolve();
    expect(groups.joinGroup).not.toHaveBeenCalled();
    expect(db.deletePendingInvite).toHaveBeenCalledWith('me', 'G1');
  });

  test('Inbox modal dismisses on overlay click', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } });
    await openInboxModal();
    expect(document.getElementById('inbox-modal').classList.contains('hidden')).toBe(false);
    document.getElementById('inbox-modal').click();
    expect(document.getElementById('inbox-modal').classList.contains('hidden')).toBe(true);
  });

  test('Inbox modal does NOT dismiss on card click', async () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 } });
    await openInboxModal();
    document.querySelector('#inbox-modal .modal-card').click();
    expect(document.getElementById('inbox-modal').classList.contains('hidden')).toBe(false);
  });

  test('getPendingCount returns the current pending invite count', () => {
    let cb;
    db.watchPendingInvites.mockImplementation((_uid, fn) => { cb = fn; return () => {}; });
    initInbox('me');
    cb({ G1: { from: 'uOwner1', ts: 1 }, G2: { from: 'uOwner2', ts: 2 } });
    expect(getPendingCount()).toBe(2);
  });
});
```

- [ ] **Step 4: Run — verify all failures**

```bash
npx jest tests/inbox.test.js
```

Expected: all FAIL — `js/inbox.js` doesn't exist yet.

- [ ] **Step 5: Create `js/inbox.js`**

```javascript
// js/inbox.js
// Phase 3 invitee-side Inbox. Subscribes to pendingInvites/{ownUid}/ and
// renders a nav-row button (visible when ≥1 pending) plus a modal that lists
// all pending invites with per-row Join / Decline.

import { watchPendingInvites, deletePendingInvite, readGroup, readMember } from './db.js';
import { joinGroup } from './groups.js';
import { navigateToGroup } from './groupNav.js';
import { getFollowing } from './prefs.js';
import { showGroupDisplayNamePrompt } from './groupDisplayNamePrompt.js';

let _myUid = null;
let _pending = {};               // groupId → { from, ts }
let _unsubscribe = null;
let _overlayHandlerInstalled = false;

export function initInbox(uid) {
  _myUid = uid;
  if (_unsubscribe) _unsubscribe();
  _unsubscribe = watchPendingInvites(uid, (snap) => {
    _pending = snap || {};
    renderInboxNavSlot();
    refreshInboxModalIfOpen();
    if (getPendingCount() === 0) closeInboxModal();
  });
  installOverlayHandlerOnce();
}

export function getPendingCount() {
  return Object.keys(_pending).length;
}

export function renderInboxNavSlot() {
  const slot = document.getElementById('nav-row-inbox-slot');
  if (!slot) return;
  slot.innerHTML = '';
  if (getPendingCount() === 0) return;
  const btn = document.createElement('button');
  btn.className = 'inbox-btn';
  btn.type = 'button';
  btn.textContent = 'Inbox';
  btn.title = 'Pending invites';
  btn.addEventListener('click', () => openInboxModal());
  slot.appendChild(btn);
}

export async function openInboxModal() {
  const modal = document.getElementById('inbox-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  await renderInboxModalRows();
}

function closeInboxModal() {
  const modal = document.getElementById('inbox-modal');
  if (!modal) return;
  modal.classList.add('hidden');
}

async function refreshInboxModalIfOpen() {
  const modal = document.getElementById('inbox-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  await renderInboxModalRows();
}

async function renderInboxModalRows() {
  const list = document.getElementById('inbox-modal-list');
  if (!list) return;
  list.innerHTML = '';
  const following = getFollowing();
  const inviterLabelByUid = {};
  for (const f of following) inviterLabelByUid[f.userId] = f.label;

  const entries = Object.entries(_pending);
  for (const [groupId, record] of entries) {
    const inviterLabel = inviterLabelByUid[record.from] || record.from;
    const group = await readGroup(groupId);
    const groupName = group?.name || groupId;
    list.appendChild(buildInboxRow({ groupId, inviterLabel, groupName }));
  }
}

function buildInboxRow({ groupId, inviterLabel, groupName }) {
  const li = document.createElement('li');
  li.className = 'inbox-row';
  li.dataset.groupId = groupId;

  const text = document.createElement('span');
  text.className = 'inbox-row-text';
  text.textContent = `${inviterLabel} invited you to join '${groupName}'.`;
  li.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'inbox-row-actions';

  const joinBtn = document.createElement('button');
  joinBtn.type = 'button';
  joinBtn.className = 'inbox-join-btn primary-btn';
  joinBtn.textContent = 'Join';
  joinBtn.addEventListener('click', () => handleJoin(groupId, groupName));
  actions.appendChild(joinBtn);

  const declineBtn = document.createElement('button');
  declineBtn.type = 'button';
  declineBtn.className = 'inbox-decline-btn ghost-btn';
  declineBtn.textContent = 'Decline';
  declineBtn.addEventListener('click', () => handleDecline(groupId));
  actions.appendChild(declineBtn);

  li.appendChild(actions);
  return li;
}

async function handleJoin(groupId, groupName) {
  if (!_myUid) return;
  // Race protection 1: invitee may have joined this group via link already.
  const existingMember = await readMember(groupId, _myUid);
  if (existingMember) {
    await deletePendingInvite(_myUid, groupId);
    return;
  }
  // Race protection 2: group may have been deleted between invite and Join.
  const group = await readGroup(groupId);
  if (!group) {
    await deletePendingInvite(_myUid, groupId);
    return;
  }
  // Prompt for the invitee's per-group display name (mirrors Flow A/B).
  closeInboxModal();
  const displayName = await showGroupDisplayNamePrompt(groupName);
  await joinGroup(groupId, _myUid, displayName);
  await deletePendingInvite(_myUid, groupId);
  await navigateToGroup(groupId);
}

async function handleDecline(groupId) {
  if (!_myUid) return;
  await deletePendingInvite(_myUid, groupId);
}

function installOverlayHandlerOnce() {
  if (_overlayHandlerInstalled) return;
  _overlayHandlerInstalled = true;
  document.addEventListener('click', (e) => {
    const modal = document.getElementById('inbox-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (e.target === modal) closeInboxModal();
  });
}
```

- [ ] **Step 6: Run — verify passing**

```bash
npx jest tests/inbox.test.js
```

Expected: all pass.

- [ ] **Step 7: Run the full suite (the app.js extract may have broken something)**

```bash
npx jest
```

Expected: all pass. If existing Flow A/B tests broke, the extraction of `showGroupDisplayNamePrompt` may need either an updated import path in those tests or a mock.

- [ ] **Step 8: Commit**

```bash
git add js/inbox.js js/groupDisplayNamePrompt.js js/app.js tests/inbox.test.js index.template.html
git commit -m "feat(inbox): Phase 3 invitee Inbox with Join prompt + Decline"
```

---

## Task 12: Wire the Inbox button into the nav row (Direct mode)

**Files:**
- Modify: `js/groupNav.js` — render the Inbox slot before group cards in Direct mode
- Test: `tests/groupNav.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/groupNav.test.js`, find the `describe('Direct mode nav row', ...)` block (or equivalent — look for tests that exercise `renderNavRowDirectMode`). Add:

```javascript
test('renderNavRowDirectMode injects an inbox slot before the group cards', () => {
  // Whatever fixture the existing tests use to populate enumeration / meta
  // and to call renderNavRow in Direct mode — reuse it. After render:
  const row = document.getElementById('nav-row');
  const slot = row.querySelector('#nav-row-inbox-slot');
  expect(slot).not.toBeNull();
  // The slot is the first child of #nav-row (before any .group-card or .group-cards-plus).
  expect(row.firstElementChild).toBe(slot);
});
```

- [ ] **Step 2: Run — verify failure**

```bash
npx jest tests/groupNav.test.js -t "inbox slot"
```

Expected: FAIL — no inbox slot is rendered.

- [ ] **Step 3: Update `renderNavRowDirectMode`**

In `js/groupNav.js`, find `renderNavRowDirectMode(row)` (~line 222). At the very top of the function body (before the existing group-card loop), inject the slot:

```javascript
function renderNavRowDirectMode(row) {
  // Phase 3 Inbox slot — first position in the row. The Inbox button itself
  // is created/torn-down by js/inbox.js based on the pending-invite count;
  // the slot just guarantees the DOM anchor.
  const inboxSlot = document.createElement('div');
  inboxSlot.id = 'nav-row-inbox-slot';
  inboxSlot.className = 'nav-row-inbox-slot';
  row.appendChild(inboxSlot);

  // ...existing logic (group cards loop + plus button)...
}
```

After the function rewrites itself, the inbox slot is wiped on each render. `js/inbox.js` re-renders the button on every pendingInvites tick via `renderInboxNavSlot()`, but it doesn't re-render on every nav-row repaint. So after each `renderNavRow()` call, the slot is empty until the next pendingInvites callback fires. Fix that by calling `renderInboxNavSlot()` from groupNav after writing the slot:

```javascript
function renderNavRowDirectMode(row) {
  const inboxSlot = document.createElement('div');
  inboxSlot.id = 'nav-row-inbox-slot';
  inboxSlot.className = 'nav-row-inbox-slot';
  row.appendChild(inboxSlot);
  // Repopulate the Inbox button (idempotent; no-op when pending count is 0).
  renderInboxNavSlot();

  // ...existing logic...
}
```

Add the import at the top of `js/groupNav.js`:

```javascript
import { renderInboxNavSlot } from './inbox.js';
```

- [ ] **Step 4: Run — verify passing**

```bash
npx jest tests/groupNav.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/groupNav.js tests/groupNav.test.js
git commit -m "feat(groupNav): render Inbox slot first in Direct-mode nav row"
```

---

## Task 13: Boot init — call `initInbox` in `app.js`

**Files:**
- Modify: `js/app.js`
- Modify: `tests/me.test.js` (if it stubs the boot flow) — usually not needed since this is purely additive

- [ ] **Step 1: Add the init call**

Open `js/app.js`. At the top, add the import:

```javascript
import { initInbox } from './inbox.js';
```

Find the boot block where other module inits happen — `initPrefs`, `watchUserPrefs`, `initCodeDrawer`, `initHeader`, `initList`, `startCardsRowSubscriptions`, `initGroupRemovalDetector` (~app.js:482–483). After `initGroupRemovalDetector(userId);`, add:

```javascript
  initInbox(userId);
```

- [ ] **Step 2: Run the full test suite**

```bash
npx jest
```

Expected: all pass. `app.js` itself isn't covered by tests; modules it boots are tested in isolation.

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat(app): initInbox at boot for Phase 3"
```

---

## Task 14: CSS for picker rows, Invited pill, Inbox button + modal

**Files:**
- Modify: `css/app.css`

- [ ] **Step 1: Append the styles**

```css
/* ── Phase 3 invite picker (inside #invite-modal Section 2) ──────────────── */
.invite-picker { margin-top: 1rem; }
.invite-picker-framing { font-size: 0.875rem; color: var(--text-muted); margin: 0 0 0.5rem 0; }
.invite-picker-list {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0 0;
  max-height: 240px;
  overflow-y: auto;
}
.invite-picker-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.invite-picker-row:hover { background: rgba(255,255,255,0.04); }
.invite-picker-row.selected { background: rgba(99,102,241,0.18); }
.invite-picker-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--text-muted); flex-shrink: 0;
}
.invite-picker-name { flex: 1; font-size: 0.875rem; color: var(--text); }
.invite-picker-trailing { flex-shrink: 0; }
.invite-picker-indicator {
  display: inline-block;
  width: 16px; height: 16px;
  border: 1px solid var(--text-muted);
  border-radius: 4px;
}
.invite-picker-row.selected .invite-picker-indicator {
  background: var(--accent);
  border-color: var(--accent);
}
.invite-picker-pill-invited {
  background: transparent;
  border: 1px solid var(--accent);
  color: var(--accent);
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  cursor: pointer;
}
.invite-picker-pill-invited:hover { background: var(--accent); color: var(--text); }

/* ── Phase 3 Inbox nav element + modal ──────────────────────────────────── */
.nav-row-inbox-slot { flex-shrink: 0; }
.inbox-btn {
  /* Same shape and border as the create-group "+" button. Tweak if .group-cards-plus
     uses different class names. */
  height: 2rem;
  min-width: 2rem;
  padding: 0 0.5rem;
  border: 1px dashed var(--text-muted);
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.inbox-btn:hover { color: var(--text); border-color: var(--text); }

.inbox-modal-list { list-style: none; padding: 0; margin: 0; }
.inbox-row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--surface2);
}
.inbox-row:last-child { border-bottom: none; }
.inbox-row-text { font-size: 0.875rem; color: var(--text); }
.inbox-row-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
.inbox-join-btn, .inbox-decline-btn { padding: 0.25rem 0.75rem; font-size: 0.875rem; }
```

- [ ] **Step 2: Commit**

```bash
git add css/app.css
git commit -m "feat(css): styles for Phase 3 picker rows + Inbox"
```

---

## Task 15: Final integration sweep

**Files:** none modified directly — this is a verification task

- [ ] **Step 1: Run the full test suite**

```bash
npx jest
```

Expected: all pass.

- [ ] **Step 2: Build the dev bundle and ensure it compiles**

```bash
node scripts/dev-build.js
```

Expected: no errors. `esbuild` will catch unresolved imports.

- [ ] **Step 3: Sanity-check the wiring by reading through the boot path**

Open `js/app.js`. Confirm:
- `initInbox(userId)` runs after `initGroupRemovalDetector(userId)`
- Imports at top include `initInbox`

Open `js/groupNav.js`. Confirm:
- `renderNavRowDirectMode` appends the `#nav-row-inbox-slot` div first, then calls `renderInboxNavSlot()`
- `renderInboxNavSlot` is imported from `./inbox.js`

- [ ] **Step 4: Manual smoke test plan (when deploying to dev)**

This isn't an automatable step; it's the verification checklist to run after `npm run deploy:dev`:

- [ ] As Owner: enter a group → tap "Invite" in settings → modal opens titled "Invite to {group name}" with picker visible.
- [ ] Tap a mutual's row → row highlights → tap Invite button → row flips to "Invited" pill.
- [ ] Tap the "Invited" pill → row flips back to selectable.
- [ ] Tap outside the modal card → modal dismisses.
- [ ] Open a group's roster → "+ Invite to group" row visible at top (only for owner).
- [ ] As Invitee (second device or incognito): receive a pending invite → Inbox button appears in nav row.
- [ ] Tap Inbox → modal lists the invite with Join/Decline.
- [ ] Tap Join → user added to group, navigated in; Inbox disappears.
- [ ] As Owner: delete a group that had outstanding invites → invitee's Inbox row disappears in real time.

- [ ] **Step 5: Commit any final cleanup**

No commit if nothing changed. If the smoke test surfaces a bug, fix it in a follow-up commit referencing the failure.

---

## Self-review checklist (run before declaring done)

- [ ] Every section in spec §10 Flow C is covered by a task.
- [ ] Every "what ships" bullet in spec §16 Phase 3 maps to a task.
- [ ] Tap-outside-to-close is implemented for both the invite modal (Task 5) and the Inbox modal (Task 11).
- [ ] Picker filters: current members excluded (Task 7); already-pending invitees show Invited pill (Task 7); inviter themself excluded (Task 7).
- [ ] Owner-only enforcement: roster row hidden for non-owners (Task 10); settings button stays owner-only (existing behavior, unchanged).
- [ ] Race handling: Inbox accept checks `readMember` for existing membership (Task 11); also handles deleted-group case (Task 11).
- [ ] deleteGroup sweep wired (Task 3); rule for sweep index added (Task 4).
- [ ] All new `db.js` exports stubbed in every db-mocking test file (Task 2).
- [ ] No `Mike P.` or other real-name placeholder introduced anywhere — use `Alex K.` / generic names for any new example strings.
