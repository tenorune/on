# Telegram W4 — client copy + CSS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sweep the client copy voice into consistency, fix two real CSS bugs, and land two small behavior fixes on the invite + graduation surfaces.

**Architecture:** Four independent commits on one branch: (1) pure string edits, (2) CSS token/hit-area fix, (3) an empty-picker share shortcut behind one new pure predicate, (4) rebuild the graduation dialog on the existing `.confirm-overlay` primitive. Each is independently reviewable and independently reversible.

**Tech Stack:** Vanilla ES modules (`js/`), plain CSS (`css/app.css`), Jest + jsdom (repo root, baseline **1461** passing).

## Global Constraints

- Do NOT touch the three-reader notify predicate `channel !== 'push'` (`js/notifyChannel.js`, `js/notifySuppression.js`, `functions/notifier.js`) — byte-identical contract (landmine).
- Do NOT merge to `dev`/`main` or open a PR (maintainer integrates).
- TDD red-before-green; keep `npx jest` green (1461 baseline) after every task.
- Commit identity is already set (`user.email noreply@anthropic.com`).
- Analysis line numbers have drifted — **locate edits by element id / exact string, not by line number.**
- Green suites are necessary, not sufficient: commits 2–4 each need the operator's on-device / web walkthrough before "done."

---

### Task 1: Copy sweep (C#4, C#9, C#13, C#14)

Pure string edits, one commit. No behavior change.

**Files:**
- Modify: `index.template.html` (chip default `#mycode-chip` ~:273; first-run link `#first-run-link-btn` ~:324)
- Modify: `js/inbox.js` (error strings; group-name quoting ~:206)
- Modify: `js/inviteModal.js` (error strings `Could not …` at the create/regen/revoke/tg-share catch sites)
- Modify: `js/notifyPrompt.js` (curly apostrophe ~:91)
- Modify: `js/app.js` (welcome framing group-name quoting ~:275)
- Modify: `js/groupContext.js` (`Delete '…'?` ~:908, `Leave '…'?` ~:925 + add Leave explanatory message)
- Modify: `js/following.js` (reference only — the unfollow confirm's explanatory message is the model for the Leave message)
- Test: `tests/invites.test.js` (:583 quoted-name assertion), `tests/firstRun.test.js` (:17,:21 fixtures), plus any groupContext/inbox test asserting a changed string.

**Interfaces:**
- Consumes: nothing.
- Produces: no new symbols; string-only.

- [ ] **Step 1: C#4 — entry label.** In `index.template.html`, change `#first-run-link-btn` text from `Link your account` to `I have a secret phrase`. Leave the submit button (`js/telegramSettings.js` submit `Link account`) and the already-correct `#tg-invite-phrase-btn` / stale / welcome buttons unchanged.

- [ ] **Step 2: C#4 — fix the test fixture.** In `tests/firstRun.test.js:17`, update the `#first-run-link-btn` fixture text `Link your account` → `I have a secret phrase` so the fixture mirrors real markup. (No behavior assertion depends on the old text.)

- [ ] **Step 3: C#9 — error voice.** Normalize to `Couldn't … Try again.` with a straight apostrophe:
  - `js/inbox.js` — both `Could not … Please try again.` → `Couldn't … Try again.`
  - `js/inviteModal.js` — every `Could not create invite. Try again.` / `Could not regenerate invite. Try again.` / `Could not revoke invite. Try again.` (the `showError(err.message || …)` catch fallbacks) → `Couldn't create/regenerate/revoke invite. Try again.`
  - `js/notifyPrompt.js` — curly `Couldn’t` → straight `Couldn't`.
  - LEAVE `js/app.js` boot string `Couldn't start KnockKnock. Please try again in a moment.` (decided exception).

- [ ] **Step 4: C#13 — bare group names.** Remove the surrounding straight single quotes:
  - `js/inbox.js` `invited you to join 'X'.` → `invited you to join X.`
  - `js/app.js` welcome framing `'X'` → `X`.
  - `js/groupContext.js` `Delete 'X'?` → `Delete X?`, `Leave 'X'?` → `Leave X?`.

- [ ] **Step 5: C#13 — Leave confirm gains an explanatory message.** In `js/groupContext.js`, the `Leave X?` confirm currently passes no `message`. Add a one-line explanatory message mirroring the sibling confirms — Delete uses `This cannot be undone.` and the unfollow sheet (`js/following.js:119`) has its own. Use a Leave-appropriate line, e.g. `message: "You'll stop seeing this group. You can be re-invited later."` Match the exact `showConfirmModal({ title, message, confirmLabel })` shape already used at the Delete site.

- [ ] **Step 6: C#14 — chip boot label.** In `index.template.html`, change the `#mycode-chip` default text from `Share code` to `Levers & knobs` (the majority steady-state label; the code-only empty state still renames to `Share code` at runtime via `js/firstRun.js`). Update the `tests/firstRun.test.js:21` fixture text to match. The four runtime-state tests (`firstRun.test.js:164-185`) already assert the rendered label per state and must stay green unchanged.

- [ ] **Step 7: Update quoted-name assertions.** In `tests/invites.test.js:583`, change `expect(framing.textContent).toContain("join 'Family'")` → `toContain('join Family')`. Then grep for any other test asserting a now-bare string:

Run: `grep -rn "join '\|Delete '\|Leave '\|Could not \|Please try again\|Couldn’t\|>Link your account<" tests/`
Expected after edits: no hits except intentional generic-input cases (`tests/promptModal.test.js:80,82`, which pass a quoted title as arbitrary input — leave them).

- [ ] **Step 8: Run the suite.**

Run: `npx jest`
Expected: PASS, 1461 (any delta only in the fixtures/assertions edited above, net still green).

- [ ] **Step 9: Commit.**

```bash
git add index.template.html js/inbox.js js/inviteModal.js js/notifyPrompt.js js/app.js js/groupContext.js tests/invites.test.js tests/firstRun.test.js
git commit -m "fix(web): unify W4 copy voice — one link label, error tone, bare group names, chip boot label"
```

---

### Task 2: CSS token fix + touch target (C#10, C#12)

**Files:**
- Modify: `css/app.css` (`.drawer-section` / `.drawer-section-label` ~:320-321; the `?` help badge `.help-badge` ~:1461-1469)

**Interfaces:**
- Consumes: existing tokens `--surface2`, `--text-muted` (defined `css/app.css:4-25`).
- Produces: nothing.

- [ ] **Step 1: C#10 — swap to real tokens.** In `.drawer-section`, change `border-top` from `1px solid var(--border, rgba(128,128,128,.25))` to `1px solid var(--surface2)`. In `.drawer-section-label`, change `color` from `var(--text-dim, #888)` to `var(--text-muted)`. (`--border` and `--text-dim` are defined nowhere, so the static fallbacks were always rendering.)

- [ ] **Step 2: C#12 — grow the `?` hit area.** In the help-badge rule (~:1461-1469), keep the `1.15rem` visual size but enlarge the tap target toward the ~28px neighbors. Add padding + negative margin (hit-slop) so layout is unchanged, e.g.:

```css
.help-badge {
  /* keep existing 1.15rem visual box + centering */
  padding: 0.4rem;
  margin: -0.4rem;
  box-sizing: content-box;
}
```

Verify the badge still visually reads at ~18px (padding/margin cancel in layout) at both placements (`#first-run-graduate-help`, and the drawer Account-section `?` from `js/telegramSettings.js`).

- [ ] **Step 3: Run the suite (no regressions).**

Run: `npx jest`
Expected: PASS 1461 (CSS is not unit-covered; this confirms nothing else broke).

- [ ] **Step 4: Commit.**

```bash
git add css/app.css
git commit -m "fix(web): .drawer-section uses real theme tokens; grow the ? help-badge hit area"
```

**On-device gate (operator):** with a palette swap, the drawer-section border/label re-theme; the `?` is comfortably tappable on a phone. No jest coverage — visual acceptance only.

---

### Task 3: C#5 — empty-picker share shortcut

No label changes. New pure predicate + one branch in `openInviteModal`.

**Files:**
- Modify: `js/invitePicker.js` (extract `hasDisplayableInvitees`, use it in `renderInvitePicker`)
- Modify: `js/inviteModal.js` (TG group path shortcut ~:120-134, :247-260)
- Test: `tests/invitePicker.test.js` (new predicate cases), `tests/inviteModal.test.js` (shortcut behavior)

**Interfaces:**
- Consumes: `createGroupInvite(userId, groupId)`, `shareInviteLink({token,url}, caption)`, `shareCaption('group', groupName)` (existing).
- Produces: `export function hasDisplayableInvitees({ followers, mutuals, currentMemberUids, inviterUid }): boolean` in `js/invitePicker.js`.

- [ ] **Step 1: Write the failing predicate test.** In `tests/invitePicker.test.js`:

```js
import { hasDisplayableInvitees } from '../js/invitePicker.js';

describe('hasDisplayableInvitees', () => {
  const base = { inviterUid: 'me', currentMemberUids: new Set() };
  test('true when a non-member follower exists', () => {
    expect(hasDisplayableInvitees({ ...base, followers: { a: 'CODE-A' }, mutuals: [] })).toBe(true);
  });
  test('true when a mutual (present in followers) exists', () => {
    expect(hasDisplayableInvitees({ ...base, followers: { a: 'CODE-A' }, mutuals: [{ userId: 'a', label: 'Ana' }] })).toBe(true);
  });
  test('false when the only follower is already a member', () => {
    expect(hasDisplayableInvitees({ ...base, followers: { a: 'CODE-A' }, mutuals: [], currentMemberUids: new Set(['a']) })).toBe(false);
  });
  test('false when the only follower is self', () => {
    expect(hasDisplayableInvitees({ ...base, followers: { me: 'CODE-ME' }, mutuals: [] })).toBe(false);
  });
  test('false when followers is empty', () => {
    expect(hasDisplayableInvitees({ ...base, followers: {}, mutuals: [] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npx jest tests/invitePicker.test.js -t hasDisplayableInvitees`
Expected: FAIL — `hasDisplayableInvitees is not a function`.

- [ ] **Step 3: Extract the predicate and reuse it in the render.** In `js/invitePicker.js`, factor the two existing filters (the `mutualEntries` + `nonMutualEntries` builders, ~:32-43) so the eligibility rule lives in one place:

```js
export function hasDisplayableInvitees({ followers, mutuals, currentMemberUids, inviterUid }) {
  const mutualLookup = new Map(mutuals.map((m) => [m.userId, m.label]));
  const mutualHit = mutuals.some(
    (m) => followers[m.userId] && !currentMemberUids.has(m.userId) && m.userId !== inviterUid,
  );
  const nonMutualHit = Object.keys(followers).some(
    (uid) => !mutualLookup.has(uid) && !currentMemberUids.has(uid) && uid !== inviterUid,
  );
  return mutualHit || nonMutualHit;
}
```

Leave `renderInvitePicker`'s row construction as-is (it already produces exactly this union); the predicate mirrors its filters so the two cannot disagree. (Optional tidy: have `renderInvitePicker` early-return when the union is empty — not required for this task.)

- [ ] **Step 4: Run the predicate test to verify it passes.**

Run: `npx jest tests/invitePicker.test.js -t hasDisplayableInvitees`
Expected: PASS.

- [ ] **Step 5: Write the failing modal-shortcut test.** In `tests/inviteModal.test.js`, in the Telegram-group describe block (near :247), add:

```js
test('TG group, no displayable contacts → skip modal, share directly', async () => {
  isTelegramContext.mockReturnValue(true);
  // followers empty ⇒ hasDisplayableInvitees false
  await openInviteModal({ scope: 'group', userId: 'me', groupId: 'g1', groupName: 'Divers',
    followers: {}, mutuals: [], currentMemberUids: new Set() });
  expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(true);
  expect(createGroupInvite).toHaveBeenCalledWith('me', 'g1');
  expect(shareInviteLink).toHaveBeenCalled();
});

test('TG group, has displayable contacts → modal shows as today', async () => {
  isTelegramContext.mockReturnValue(true);
  await openInviteModal({ scope: 'group', userId: 'me', groupId: 'g1', groupName: 'Divers',
    followers: { a: 'CODE-A' }, mutuals: [], currentMemberUids: new Set() });
  expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(false);
});

test('TG group, no contacts, createGroupInvite rejects → modal opens with error', async () => {
  isTelegramContext.mockReturnValue(true);
  createGroupInvite.mockRejectedValueOnce(new Error('offline'));
  await openInviteModal({ scope: 'group', userId: 'me', groupId: 'g1', groupName: 'Divers',
    followers: {}, mutuals: [], currentMemberUids: new Set() });
  expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(false);
});
```

Match the existing describe's mock setup for `createGroupInvite` / `shareInviteLink` (add them to the mock surface if not already mocked; the block already stubs `isTelegramContext` and the invite flow).

- [ ] **Step 6: Run it to verify it fails.**

Run: `npx jest tests/inviteModal.test.js -t "no displayable contacts"`
Expected: FAIL — modal currently always shows.

- [ ] **Step 7: Implement the shortcut.** In `js/inviteModal.js`, before the synchronous `document.getElementById('invite-modal').classList.remove('hidden')`, add the TG-group short-circuit:

```js
if (tgGroupShare && !hasDisplayableInvitees({ followers, mutuals, currentMemberUids, inviterUid: userId })) {
  try {
    const { token, url } = await createGroupInvite(userId, groupId);
    shareInviteLink({ token, url }, shareCaption('group', groupName));
    return; // never paint the modal
  } catch {
    // fall through to open the modal so its inline error surface shows
  }
}
```

Import `hasDisplayableInvitees` from `./invitePicker.js`. Ensure `followers`, `mutuals`, `currentMemberUids` are in scope at this point (they are the same values passed to `renderInvitePicker`). Leave the existing modal path untouched for every other case.

- [ ] **Step 8: Run the modal tests to verify they pass.**

Run: `npx jest tests/inviteModal.test.js`
Expected: PASS (new cases green, existing group/web cases unchanged).

- [ ] **Step 9: Full suite.**

Run: `npx jest`
Expected: PASS 1461 + the new tests.

- [ ] **Step 10: Commit.**

```bash
git add js/invitePicker.js js/inviteModal.js tests/invitePicker.test.js tests/inviteModal.test.js
git commit -m "feat(web): TG group invite with no eligible contacts shares directly, skipping the modal"
```

**On-device gate (operator):** in Telegram, open a group invite with zero eligible followers → native share sheet opens directly; with eligible followers → the modal shows as before.

---

### Task 4: C#11 — graduation dialog on the confirm primitive

**Files:**
- Modify: `js/graduation.js` (`showGraduationInfo` / `ensureInfoToast` ~:18-40)
- Modify: `css/app.css` (retire `.graduation-toast` ~:1474-1483)
- Test: `tests/graduation.test.js`

**Interfaces:**
- Consumes: the shared confirm primitive (`showConfirmModal` from `js/promptModal.js`, as used by `js/telegramSettings.js:43-64`) — reuse its exact call shape.
- Produces: `showGraduationInfo()` unchanged signature; now renders `.confirm-overlay`.

- [ ] **Step 1: Read the confirm primitive's contract.** Confirm the `showConfirmModal({ title, message, confirmLabel, cancelLabel? })` signature and the `.confirm-overlay` id/classes from `js/promptModal.js` and its usage in `js/telegramSettings.js:43-64`. The primitive already provides backdrop-tap, Escape, and returns a promise / invokes a callback on confirm.

- [ ] **Step 2: Write the failing test.** In `tests/graduation.test.js`, replace the toast-shape expectations with:

```js
test('showGraduationInfo mounts a confirm-overlay, not a graduation-toast', () => {
  showGraduationInfo();
  expect(document.querySelector('.confirm-overlay')).not.toBeNull();
  expect(document.getElementById('graduation-info-toast')).toBeNull();
});

test('confirming "I want an account" starts graduation', async () => {
  const spy = jest.spyOn(mod, 'startGraduation').mockResolvedValue();
  showGraduationInfo();
  document.querySelector('.confirm-overlay [data-role="confirm"]').click(); // match primitive's confirm button hook
  expect(spy).toHaveBeenCalled();
});

test('Escape / backdrop dismisses without starting graduation', () => {
  showGraduationInfo();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(document.querySelector('.confirm-overlay')).toBeNull();
});
```

Align the confirm-button selector and dismissal mechanics with what `promptModal` actually exposes (read it in Step 1; adjust selectors to the real ones rather than the placeholder `[data-role="confirm"]`).

- [ ] **Step 3: Run it to verify it fails.**

Run: `npx jest tests/graduation.test.js`
Expected: FAIL — still renders `#graduation-info-toast`.

- [ ] **Step 4: Rebuild on the primitive.** In `js/graduation.js`, replace `ensureInfoToast()` + `showGraduationInfo()` with a call into the shared confirm modal:

```js
export function showGraduationInfo() {
  showConfirmModal({
    title: '',
    message: INFO_TEXT,
    confirmLabel: 'I want an account',
    cancelLabel: 'Close',
  }).then((ok) => { if (ok) startGraduation(); });
}
```

Match the actual `showConfirmModal` return/callback contract from Step 1 (promise-of-boolean vs onConfirm callback — use whichever `telegramSettings.js` uses). Remove `ensureInfoToast`, the manual `role="dialog"` element, and its `INFO_TEXT` inline markup (keep the `INFO_TEXT` constant). Keep `startGraduation` and the recovery-modal ceremony untouched.

- [ ] **Step 5: Retire the dead CSS.** Delete the `.graduation-toast` / `.graduation-toast-btns` rules (`css/app.css:1474-1483`) once nothing references them.

Run: `grep -rn "graduation-toast" js/ css/ index.template.html`
Expected: no hits.

- [ ] **Step 6: Run the graduation tests to verify they pass.**

Run: `npx jest tests/graduation.test.js`
Expected: PASS.

- [ ] **Step 7: Full suite.**

Run: `npx jest`
Expected: PASS 1461 baseline reconciled with the graduation-test changes.

- [ ] **Step 8: Commit.**

```bash
git add js/graduation.js css/app.css tests/graduation.test.js
git commit -m "fix(web): graduation decision uses the confirm-overlay primitive (backdrop/Escape/back)"
```

**On-device gate (operator):** the graduation `?` opens a proper dialog with a backdrop, dismissable by backdrop-tap, Escape, and the Telegram back button; "I want an account" still starts the phrase ceremony.

---

## Self-Review

**Spec coverage:** C#4 (T1 s1-2), C#9 (T1 s3), C#13 bare names + Leave message (T1 s4-5), C#14 (T1 s6), C#10 (T2 s1), C#12 (T2 s2), C#5 reframed shortcut (T3), C#11 (T4). `app.js:118` exception honored (T1 s3). All spec sections mapped.

**Placeholder scan:** The confirm-button selector `[data-role="confirm"]` in T4 s2 is explicitly flagged to be replaced with the real `promptModal` selector after reading it in T4 s1 — not a silent placeholder. No other TODO/TBD.

**Type consistency:** `hasDisplayableInvitees({ followers, mutuals, currentMemberUids, inviterUid })` — same shape in the predicate (T3 s3), its tests (T3 s1), and the call site (T3 s7). `showConfirmModal` contract deliberately deferred to T4 s1 read, then matched in s2/s4.

**Known drift caveat:** locate every edit by id/string, not the ~line numbers (analysis lines are stale).
