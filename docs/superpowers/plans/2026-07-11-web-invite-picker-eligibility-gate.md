# Web Invite-Picker Eligibility Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The group invite modal shows Section 2 (the in-app invite picker) only when at least one contact is actually eligible to invite; otherwise only the link create/manage UI shows.

**Architecture:** One gate in `openInviteModal` (`js/inviteModal.js`): compute `hasDisplayableInvitees(...)` — the predicate the Telegram skip-to-share shortcut already uses — synchronously before the modal paints, and drive Section 2's `hidden` class, the TG shortcut, and the async picker populate off that one value. No new modules, no markup changes.

**Tech Stack:** Vanilla ES modules, jest + jsdom (`tests/inviteModal.test.js`).

## Global Constraints

- Run web tests as `node_modules/.bin/jest` from the repo root (NOT bare `npx jest`).
- Spec: `docs/superpowers/specs/2026-07-11-web-invite-picker-eligibility-gate-design.md`.
- Do not push; the operator drives integration. Commit per unit of work.
- `index.html` is a gitignored build artifact — no build step is needed for this change (no template edits), but on-device verification requires the deploy to pick up the pushed branch later.

---

### Task 1: Gate Section 2 on invite eligibility

**Files:**
- Modify: `js/inviteModal.js:102-112` (gate), `js/inviteModal.js:248` (reuse value), `js/inviteModal.js:265-276` (skip populate when hidden)
- Test: `tests/inviteModal.test.js`

**Interfaces:**
- Consumes: `hasDisplayableInvitees({ followers, mutuals, currentMemberUids, inviterUid })` from `js/invitePicker.js` (already imported in `js/inviteModal.js`).
- Produces: no new exports; behavior change only.

- [ ] **Step 1: Update the two existing tests that encode the old behavior**

In `tests/inviteModal.test.js`, the test `'web group scope: create link UI shown, tg-share hidden, picker shown'` (inside `describe('openInviteModal — group scope')`) currently passes no followers yet asserts the picker visible. Make it exercise the new rule by passing one eligible follower:

```js
  test('web group scope with an eligible contact: create link UI shown, tg-share hidden, picker shown', async () => {
    await openInviteModal({
      scope: 'group', userId: 'uid1', groupId: 'G1', groupName: 'Family',
      followers: { 'follower-1': 'CODE-1' }, mutuals: [], currentMemberUids: new Set(),
    });
    expect(document.getElementById('invite-modal-create').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('invite-modal-tg-share').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('invite-modal-picker').classList.contains('hidden')).toBe(false);
  });
```

In `describe('openInviteModal — Section 2 (in-app picker)')`, the test `'Section 2 (in-app picker) renders when scope is group'` also passes no followers. Change only its name and the `openInviteModal` call (keep its DOM setup block as-is):

```js
    await openInviteModal({
      scope: 'group', userId: 'u1', groupId: 'G1', groupName: 'Family',
      followers: { 'follower-1': 'CODE-1' }, mutuals: [], currentMemberUids: new Set(),
    });
```

with the test renamed to `'Section 2 (in-app picker) renders when scope is group and a contact is eligible'`.

- [ ] **Step 2: Add the failing tests for the new rule**

Append inside `describe('openInviteModal — Section 2 (in-app picker)')` (they can use the file's top-level `setupDom()` helper):

```js
  test('web group scope, no displayable invitees → Section 2 hidden, link UI still shown', async () => {
    setupDom();
    await openInviteModal({
      scope: 'group', userId: 'u1', groupId: 'G1', groupName: 'Family',
      followers: {}, mutuals: [], currentMemberUids: new Set(),
    });
    expect(document.getElementById('invite-modal-picker').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('invite-modal-create').classList.contains('hidden')).toBe(false);
    // Hidden section is not populated: no pending-invitee fetch, no render.
    const { renderInvitePicker } = require('../js/invitePicker.js');
    expect(renderInvitePicker).not.toHaveBeenCalled();
  });

  test('web group scope, followers exist but all are already members → Section 2 hidden', async () => {
    setupDom();
    await openInviteModal({
      scope: 'group', userId: 'u1', groupId: 'G1', groupName: 'Family',
      followers: { uA: 'CODE-A' }, mutuals: [], currentMemberUids: new Set(['uA']),
    });
    expect(document.getElementById('invite-modal-picker').classList.contains('hidden')).toBe(true);
  });
```

Note: `renderInvitePicker` is the file-level jest mock from the top of the test file, and `jest.clearAllMocks()` runs in this describe's `beforeEach`, so the not-called assertion is clean.

Also extend the existing TG fall-through test `'TG group, no contacts, createGroupInvite rejects → modal opens with error'` (in `describe('openInviteModal — group scope')`) with one assertion at the end, before the `isTelegramContext.mockReturnValue(false)` line:

```js
    expect(document.getElementById('invite-modal-picker').classList.contains('hidden')).toBe(true);
```

- [ ] **Step 3: Run the suite to verify the new tests fail**

Run: `node_modules/.bin/jest tests/inviteModal.test.js`
Expected: FAIL — the two new Section-2 tests and the extended TG fall-through assertion fail on `hidden` being `false` (and `renderInvitePicker` having been called); the two updated Step-1 tests pass (they match current behavior with an eligible follower).

- [ ] **Step 4: Implement the gate in `js/inviteModal.js`**

Replace lines 102-112 (the `tgGroupShare` + picker-toggle block):

```js
  // Telegram group scope shares the deep link via a single "Share on Telegram"
  // button in place of the web-URL create/manage UI. Web (and personal) keep
  // the existing link flow. Both group surfaces show the picker below.
  const tgGroupShare = scope === 'group' && isTelegramContext();

  // Section 2 (in-app picker) — group scope only. Toggle visibility now;
  // populate it (async) AFTER the modal is shown, at the end of this function.
  const pickerEl = document.getElementById('invite-modal-picker');
  if (pickerEl) {
    pickerEl.classList.toggle('hidden', scope !== 'group');
  }
```

with:

```js
  // Telegram group scope shares the deep link via a single "Share on Telegram"
  // button in place of the web-URL create/manage UI. Web (and personal) keep
  // the existing link flow.
  const tgGroupShare = scope === 'group' && isTelegramContext();

  // Section 2 (in-app picker) — group scope, and only when someone is actually
  // eligible to invite (an empty picker is dead UI). Same predicate as the
  // TG skip-to-share shortcut below; decided synchronously from caller-passed
  // data so there's no post-paint flash. Populate (async) AFTER the modal is
  // shown, at the end of this function.
  const displayableInvitees = scope === 'group'
    && hasDisplayableInvitees({ followers, mutuals, currentMemberUids, inviterUid: userId });
  const pickerEl = document.getElementById('invite-modal-picker');
  if (pickerEl) {
    pickerEl.classList.toggle('hidden', !displayableInvitees);
  }
```

Replace the TG shortcut condition at line ~248:

```js
  if (tgGroupShare && !hasDisplayableInvitees({ followers, mutuals, currentMemberUids, inviterUid: userId })) {
```

with:

```js
  if (tgGroupShare && !displayableInvitees) {
```

Replace the populate condition at line ~266:

```js
  if (scope === 'group') {
```

with:

```js
  if (displayableInvitees) {
```

(The pending-invitee fetch only feeds picker rows, and rows are built solely from `followers`/`mutuals` — nothing to render when the predicate is false, so the fetch is skipped along with the render.)

- [ ] **Step 5: Run the modal suite, then the full suite**

Run: `node_modules/.bin/jest tests/inviteModal.test.js`
Expected: PASS (all tests, including the isolated `jest.doMock` test at the bottom — it passes `followers: { uA: 'codeA' }`, which stays displayable).

Run: `node_modules/.bin/jest`
Expected: PASS, 1688 + 3 new = 1691 total (count may differ if other suites changed; the requirement is zero failures).

- [ ] **Step 6: Commit**

```bash
git add js/inviteModal.js tests/inviteModal.test.js
git commit -m "feat(invites): hide the in-app picker when nobody is eligible to invite"
```
