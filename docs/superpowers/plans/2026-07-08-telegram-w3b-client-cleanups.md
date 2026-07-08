# Wave W3-B: Client Cleanups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the eight remaining client findings from the Telegram feature analysis (CL#6–CL#13): a shared modal harness, the link-screen busy pair, one personal-invite flow entry, a trimmed/capped `telegramFirstName`, a `copyWithFeedback` helper, recoveryModal teardown dedup, one `shareCaption`, and the landing-notice collapse.

**Architecture:** Behavior-preserving consolidations plus two deliberate micro-changes called out in their tasks (E4 trim-before-cap; E2 stale-idleLabel scrub). Spec: `docs/superpowers/specs/2026-07-08-telegram-w3b-client-cleanups-design.md`.

**Tech Stack:** Vanilla ES modules, esbuild, jest + jsdom.

## Global Constraints

- **Branch/sequencing — UPDATE 2026-07-08: W1 (+W2) has LANDED** on `claude/telegram-app-adaptation-t1r1jp` tip `97482f0` (HANDOFF §37–§40, on-device verified; web 1446, functions 281). Execute **after W3-A** (`docs/superpowers/plans/2026-07-08-telegram-w3a-client-consolidation.md`): Task 8 (E1) hard-depends on W3-A Task 5; Task 6 (E7) soft-depends on W3-A Task 4 (same file). Task 7 (E2)'s W1 Task 9 baseline is OBSERVED in landed source — no fallback needed.
- **Line numbers** were re-verified against `97482f0` where cited; W3-A will shift some — anchor on the quoted code.
- **Scope fence:** `js/`, `tests/` only. NO `functions/`, NO `css/app.css`, NO `index.template.html` change needed in this wave; no fixing other findings in passing.
- **Tests:** web suite `npx jest` from repo root, all green before starting.
- **Copy:** no new user-facing strings in this wave — every string is moved, not changed.
- **Commit identity:** `git config user.email noreply@anthropic.com && git config user.name Claude` before the first commit.
- **Acceptance:** green suites are necessary, not sufficient — the operator's on-device walkthrough is the gate, focused on the link-screen failure path (Task 7) and the copy buttons inside the Telegram webview (Task 3).

---

### Task 1: `startPersonalInviteFlow()` (CL#8 / E3)

**Files:**
- Modify: `js/mycode.js` (drawer button handler + new export), `js/app.js` (import line 7 + `initFirstRun` onInvite)
- Test: `tests/mycode.test.js`

**Interfaces:**
- Produces: `startPersonalInviteFlow(): void|Promise` exported from `js/mycode.js` — the ONE surface dispatch for the personal-invite CTA.

- [x] **Step 1: Write the failing test**

Add to `tests/mycode.test.js` (the file already mocks `../js/telegram.js` with `telegramFirstName` + `isTelegramContext`, and `../js/inviteModal.js` with `openInviteModal`; `shareInviteLink` comes from its `../js/inviteFlow.js` mock — check the top of the file and reuse the existing handles):

```js
describe('startPersonalInviteFlow (W3-B CL#8)', () => {
  test('web: opens the invite modal', async () => {
    isTelegramContext.mockReturnValue(false);
    const mycode = require('../js/mycode.js');
    await mycode.startPersonalInviteFlow();
    expect(openInviteModal).toHaveBeenCalledWith(expect.objectContaining({ scope: 'personal' }));
  });

  test('Telegram: goes straight to the share sheet path (no modal)', async () => {
    isTelegramContext.mockReturnValue(true);
    telegramFirstName.mockReturnValue('Ana');
    const mycode = require('../js/mycode.js');
    await mycode.startPersonalInviteFlow();
    expect(openInviteModal).not.toHaveBeenCalled();
    // sharePersonalInvite ran: it shares via shareInviteLink (inviteFlow mock).
    expect(shareInviteLink).toHaveBeenCalled();
  });
});
```

(If `shareInviteLink` isn't already destructured from the `inviteFlow.js` mock at the top of the file, add it to the mock: `jest.mock('../js/inviteFlow.js', () => ({ shareInviteLink: jest.fn(), … }))` — mirror the file's existing mock shape exactly. Arrange whatever `createPersonalInvite` mock resolution the file's existing `sharePersonalInvite` tests use so the share path completes.)

- [x] **Step 2: Run to verify failure**

Run: `npx jest tests/mycode.test.js`
Expected: FAIL — `startPersonalInviteFlow` is not exported.

- [x] **Step 3: Implement**

`js/mycode.js` — add the export next to `openPersonalInviteModal`/`sharePersonalInvite`, and route the drawer button through it:

```js
// THE personal-invite CTA dispatch (W3-B CL#8): Telegram shares the deep link
// straight to the native share sheet (spec §3/§4); web opens the invite modal.
// Both surfaces (first-run primary, drawer button) call this — a change to one
// CTA can't silently miss the other.
export function startPersonalInviteFlow() {
  return isTelegramContext() ? sharePersonalInvite() : openPersonalInviteModal();
}
```

The drawer wiring (currently the inline ternary) becomes:

```js
  document.getElementById('drawer-invite-btn')?.addEventListener('click', () => {
    startPersonalInviteFlow();
  });
```

`js/app.js` — import line 7 becomes:

```js
import { initCodeDrawer, updateMyCode, startPersonalInviteFlow } from './mycode.js';
```

(Drop `openPersonalInviteModal` and `sharePersonalInvite` from the import if `grep -n 'openPersonalInviteModal\|sharePersonalInvite' js/app.js` shows the onInvite ternary was their only use.) The `initFirstRun` call becomes:

```js
  initFirstRun({
    onInvite: startPersonalInviteFlow,
    onLink: isTelegramContext() ? showLinkScreen : null,
    onGraduateInfo: isTelegramContext() ? showGraduationInfo : null,
  });
```

- [x] **Step 4: Run to verify pass**

Run: `npx jest tests/mycode.test.js tests/app-boot-cacheOwner.test.js` — green.

- [x] **Step 5: Commit**

```bash
git add js/mycode.js js/app.js tests/mycode.test.js
git commit -m "refactor(web): one startPersonalInviteFlow() — the invite-CTA surface fork spelled once"
```

---

### Task 2: `telegramFirstName()` returns the trimmed, capped name (CL#9 / E4)

**Files:**
- Modify: `js/telegram.js` (`telegramFirstName`), `js/app.js` (redeemerName), `js/mycode.js` (2 sites)
- Test: `tests/telegram.test.js`

**Interfaces:**
- Produces: `telegramFirstName(): string` now display-ready — trimmed, capped at 40 (`TG_NAME_CAP`, module-private). Still `''` outside Telegram / when the client withholds the user object.

- [x] **Step 1: Write the failing test**

In `tests/telegram.test.js`, extend the existing `telegramFirstName` test (same `jest.resetModules()` pattern the file uses):

```js
test('telegramFirstName: trimmed and capped at 40 (mirrors the DB creatorLabel cap, W3-B CL#9)', () => {
  window.Telegram = { WebApp: { initData: 'x', initDataUnsafe: { user: { first_name: `  ${'x'.repeat(50)}  ` } } } };
  const name = require('../js/telegram.js').telegramFirstName();
  expect(name).toBe('x'.repeat(40)); // trim first, then cap
  jest.resetModules();
  window.Telegram = { WebApp: { initData: 'x', initDataUnsafe: { user: { first_name: '  Ana  ' } } } };
  expect(require('../js/telegram.js').telegramFirstName()).toBe('Ana');
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx jest tests/telegram.test.js`
Expected: FAIL — raw padded/overlong value returned.

- [x] **Step 3: Implement**

`js/telegram.js`:

```js
// Mirrors the 40-char creatorLabel cap in database.rules.json / functions
// validation — keep the three in step (W3-B CL#9).
const TG_NAME_CAP = 40;

// The Telegram user's first name (from the unsigned initDataUnsafe),
// display-ready: trimmed, capped to the DB label limit. Used as the default
// label when auto-creating a personal invite and as the redeemer name.
// Empty string outside Telegram or when the client withholds the user object.
export function telegramFirstName() {
  return (tgWebApp()?.initDataUnsafe?.user?.first_name || '').trim().slice(0, TG_NAME_CAP);
}
```

Drop the ad hoc suffixes at the three call sites:
- `js/app.js` (redeemerName, line 627 at `97482f0`): `redeemerName: telegramFirstName(),`
- `js/mycode.js` (`sharePersonalInvite`, both sites):
  ```js
    const label = telegramFirstName() || 'Someone';
  ```
  ```js
    const current = telegramFirstName();
  ```
  (The surrounding comments stay; the `|| 'Someone'` fallback and the skip-when-unchanged logic are untouched.)

- [x] **Step 4: Run to verify pass**

Run: `npx jest tests/telegram.test.js tests/mycode.test.js tests/app-boot-cacheOwner.test.js` — green (both suites mock `telegramFirstName` wholesale with already-short names, so the contract change is invisible to them).

- [x] **Step 5: Commit**

```bash
git add js/telegram.js js/app.js js/mycode.js tests/telegram.test.js
git commit -m "refactor(web): telegramFirstName returns the trimmed, 40-capped name — cap spelled once beside the DB rule"
```

---

### Task 3: `copyWithFeedback` in utils (CL#10 / E5)

**Files:**
- Modify: `js/utils.js` (new helper), `js/inviteModal.js` (2 sites), `js/recoveryModal.js` (`onCopy`), `js/phraseReminder.js` (copy button), `js/mycode.js` (comment only)
- Test: `tests/utils.test.js`

**Interfaces:**
- Produces: `copyWithFeedback(btn, text, { done = 'Copied!', idle = 'Copy' } = {}): Promise<void>` in `js/utils.js`. Clipboard failure = no label change. No timer dedup (matches every current site).

- [x] **Step 1: Write the failing test**

`tests/utils.test.js` currently runs in the default (node) environment — add the jsdom docblock as the FIRST line of the file (existing pure-function tests are unaffected):

```js
/** @jest-environment jsdom */
```

Then add:

```js
describe('copyWithFeedback (W3-B CL#10)', () => {
  const { copyWithFeedback } = require('../js/utils.js');
  let btn;
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '<button id="b">Copy</button>';
    btn = document.getElementById('b');
    Object.assign(navigator, { clipboard: { writeText: jest.fn(async () => {}) } });
  });
  afterEach(() => jest.useRealTimers());

  test('writes the text, swaps to done, reverts to idle after 1.5s', async () => {
    await copyWithFeedback(btn, 'the-text');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('the-text');
    expect(btn.textContent).toBe('Copied!');
    jest.advanceTimersByTime(1500);
    expect(btn.textContent).toBe('Copy');
  });

  test('custom labels', async () => {
    await copyWithFeedback(btn, 'x', { done: 'Link copied!', idle: 'Share to Telegram' });
    expect(btn.textContent).toBe('Link copied!');
    jest.advanceTimersByTime(1500);
    expect(btn.textContent).toBe('Share to Telegram');
  });

  test('clipboard failure: label untouched', async () => {
    navigator.clipboard.writeText.mockRejectedValue(new Error('denied'));
    await copyWithFeedback(btn, 'x');
    expect(btn.textContent).toBe('Copy');
  });

  test('missing clipboard API: label untouched, no throw', async () => {
    delete navigator.clipboard;
    await expect(copyWithFeedback(btn, 'x')).resolves.toBeUndefined();
    expect(btn.textContent).toBe('Copy');
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx jest tests/utils.test.js`
Expected: FAIL — `copyWithFeedback` is not exported.

- [x] **Step 3: Implement the helper**

`js/utils.js`, below `clearButtonBusy`:

```js
// Copy-to-clipboard with transient button feedback (W3-B CL#10): label → `done`,
// reverted to `idle` after 1.5s. A denied/failed/missing clipboard changes
// nothing — silent, like every call site before consolidation. No timer dedup:
// rapid re-taps queue reverts, same as the inlined blocks did. (mycode.js's
// recovery pill keeps its bespoke block — its copied-timer chains into the
// reveal panel's idle state machine.)
export async function copyWithFeedback(btn, text, { done = 'Copied!', idle = 'Copy' } = {}) {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    return; // clipboard denied/blocked — no feedback, matching prior behavior
  }
  if (!navigator.clipboard) return; // no API at all: writeText never ran
  btn.textContent = done;
  setTimeout(() => { btn.textContent = idle; }, 1500);
}
```

- [x] **Step 4: Convert the four sites**

`js/inviteModal.js` — add `copyWithFeedback` to an import from `./utils.js` (the file has none yet: `import { copyWithFeedback } from './utils.js';`). Copy button handler (currently `invite-modal-copy-btn` with inline writeText/swap/revert):

```js
  on(document.getElementById('invite-modal-copy-btn'), 'click', async () => {
    if (!currentInvite) return;
    await copyWithFeedback(document.getElementById('invite-modal-copy-btn'), currentInvite.url);
  });
```

Share-fallback block inside the share handler (the blocked-popup branch):

```js
      if (!shareInviteToTelegramWeb(currentInvite, text)) {
        const deepLink = buildTelegramInviteLink(currentInvite.token);
        if (deepLink) await copyWithFeedback(shareBtn, deepLink, { done: 'Link copied!', idle: 'Share to Telegram' });
      }
```

`js/recoveryModal.js` — import: `import { setButtonBusy, clearButtonBusy, copyWithFeedback } from './utils.js';`; `onCopy` becomes:

```js
    async function onCopy() {
      await copyWithFeedback(copyBtn, current);
    }
```

`js/phraseReminder.js` — import: `import { copyWithFeedback } from './utils.js';`; the click handler becomes:

```js
  copyBtn.onclick = async () => {
    const phrase = loadIdentity()?.recoveryCode;
    if (!phrase) return;
    await copyWithFeedback(copyBtn, phrase, { idle: 'Copy to clipboard' });
  };
```

`js/mycode.js` — one comment line above `initRecoveryPill`'s copy handler:

```js
  // Deliberately NOT utils.copyWithFeedback: this copied-timer chains into the
  // reveal panel's toIdle() state machine (W3-B CL#10 exclusion).
```

- [x] **Step 5: Run to verify pass**

Run: `npx jest tests/utils.test.js tests/inviteModal.test.js tests/recoveryModal.test.js tests/mycode.test.js` — green. (If an inviteModal/recoveryModal test asserts the 1500ms revert with real timers, it still passes — the helper's timing is identical.)

- [x] **Step 6: Commit**

```bash
git add js/utils.js js/inviteModal.js js/recoveryModal.js js/phraseReminder.js js/mycode.js tests/utils.test.js
git commit -m "refactor(web): copyWithFeedback in utils — four copy-with-Copied! sites converge"
```

---

### Task 4: `recoveryModal` shared teardown (CL#11 / E6)

**Files:**
- Modify: `js/recoveryModal.js` (`onSaved`/`onCancel`)
- Test: `tests/recoveryModal.test.js`

**Interfaces:**
- Produces: no API change. Internal: one `teardown()` closure both exit paths call.

- [x] **Step 1: Write the failing test (listener hygiene on the cancel path)**

Add to `tests/recoveryModal.test.js` (uses the file's existing fixture):

```js
test('cancel tears everything down: a later saved-btn click is dead (W3-B CL#11)', async () => {
  const onConfirm = jest.fn(async () => {});
  const p = showRecoveryCodeModal('a-b-c-d', onConfirm, { cancellable: true });
  document.getElementById('recovery-cancel-btn').click();
  await expect(p).resolves.toBeNull();
  document.getElementById('recovery-saved-btn').click();
  await Promise.resolve();
  expect(onConfirm).not.toHaveBeenCalled(); // saved listener was removed
});
```

(This passes on the current code too — it pins the behavior the refactor must preserve. The refactor's real acceptance is Step 4's full-file green with no other test edits.)

- [x] **Step 2: Run to verify it passes pre-refactor**

Run: `npx jest tests/recoveryModal.test.js` — green (baseline pinned).

- [x] **Step 3: Implement**

`js/recoveryModal.js` — inside the `return new Promise((resolve) => { … })`, hoist the shared teardown and shrink both exit paths (removing a never-added listener is a spec'd no-op, so no `cancellable` guard):

```js
    // One teardown for every exit path (W3-B CL#11): a future listener can't
    // be forgotten on one of them.
    function teardown() {
      rotateBtn.removeEventListener('click', onRotate);
      copyBtn.removeEventListener('click', onCopy);
      savedBtn.removeEventListener('click', onSaved);
      if (cancelBtn) cancelBtn.removeEventListener('click', onCancel);
      window.removeEventListener('popstate', onPopState);
      if (kcForm) kcForm.removeEventListener('submit', onKcSubmit);
      el.classList.add('hidden');
    }
```

`onSaved`'s tail (after the `onConfirm` block) becomes:

```js
      teardown();
      resolve(current);
```

`onCancel` becomes:

```js
    function onCancel() {
      teardown();
      resolve(null);
    }
```

(Delete the two inline removeEventListener sequences those replace. `onPopState`, `onRotate`, `onCopy`, the history push, and the listener adds are untouched. Note `teardown` must be defined before `onSaved`/`onCancel` reference it at call time — function declarations hoist, so placement anywhere inside the Promise executor works; put it above `onSaved` for readability.)

- [x] **Step 4: Run to verify pass**

Run: `npx jest tests/recoveryModal.test.js` — green, the whole file, with no test edits beyond Step 1's addition.

- [x] **Step 5: Commit**

```bash
git add js/recoveryModal.js tests/recoveryModal.test.js
git commit -m "refactor(web): recoveryModal exit paths share one teardown"
```

---

### Task 5: Landing-notice collapse (CL#13 / E8)

**Files:**
- Modify: `js/firstRun.js` (delete `LANDING_COPY`; rename the pair), `js/graduation.js` (producer), `js/app.js` (consumer)
- Test: `tests/firstRun.test.js`, `tests/graduation.test.js`

**Interfaces:**
- Produces: `stampGraduationNotice(): void` and `consumeGraduationNotice(): string|null` exported from `js/firstRun.js`, REPLACING `stampLanding(kind)` / `consumeLandingNotice()`. Storage key/value unchanged (`kk-landing` = `'graduated'`).

- [x] **Step 1: Write the failing tests**

`tests/firstRun.test.js` — REPLACE the two landing tests (`'stampLanding + consumeLandingNotice returns the copy once, then clears'` and the removed-kinds test around lines 171-182) with:

```js
test('stampGraduationNotice + consumeGraduationNotice: copy once, then clears (W3-B CL#13)', () => {
  firstRun.stampGraduationNotice();
  expect(sessionStorage.getItem('kk-landing')).toBe('graduated'); // key/value unchanged across the rename
  expect(firstRun.consumeGraduationNotice()).toContain('works in any browser');
  expect(sessionStorage.getItem('kk-landing')).toBeNull();
  expect(firstRun.consumeGraduationNotice()).toBeNull(); // second boot: nothing
});

test('a foreign marker value consumes to null', () => {
  sessionStorage.setItem('kk-landing', 'linked'); // pre-collapse residue
  expect(firstRun.consumeGraduationNotice()).toBeNull();
  expect(sessionStorage.getItem('kk-landing')).toBeNull(); // still cleared
});
```

`tests/graduation.test.js` — the `../js/firstRun.js` mock and its assertions rename:

```js
jest.mock('../js/firstRun.js', () => ({ stampGraduationNotice: jest.fn() }));
```
```js
const { stampGraduationNotice } = require('../js/firstRun.js');
```
and in the two `startGraduation onConfirm` tests: `expect(stampGraduationNotice).toHaveBeenCalledWith()` becomes `expect(stampGraduationNotice).toHaveBeenCalled();` / `expect(stampGraduationNotice).not.toHaveBeenCalled();` (the doc-comment about location.reload stays).

- [x] **Step 2: Run to verify failure**

Run: `npx jest tests/firstRun.test.js tests/graduation.test.js`
Expected: FAIL — renamed exports missing.

- [x] **Step 3: Implement**

`js/firstRun.js` — replace the landing block (keep the surviving comments about the cross-account reload handoff / not-in-cacheOwner / accepted sessionStorage degradation verbatim above the key):

```js
const LANDING_KEY = 'kk-landing';
// Only graduation stamps a landing (the post-link/post-unlink banners were
// removed on-device); the kind-keyed LANDING_COPY map that once served them is
// collapsed (W3-B CL#13). Key and stored value stay 'kk-landing'/'graduated'
// so a stamp written before this deploy still reads after it.
const GRADUATED_COPY = 'This account now works in any browser too.';

export function stampGraduationNotice() {
  try { sessionStorage.setItem(LANDING_KEY, 'graduated'); } catch { /* storage denied */ }
}

// Read-and-clear the marker, returning the copy to surface (or null). The
// caller decides the surface — boot routes it through the shared toast.
export function consumeGraduationNotice() {
  let kind = null;
  try {
    kind = sessionStorage.getItem(LANDING_KEY);
    sessionStorage.removeItem(LANDING_KEY);
  } catch { return null; }
  return kind === 'graduated' ? GRADUATED_COPY : null;
}
```

(`stampLanding`, `consumeLandingNotice`, and `LANDING_COPY` are deleted.)

`js/graduation.js` — import line 9 and the call:

```js
import { stampGraduationNotice } from './firstRun.js';
```
```js
    stampGraduationNotice(); // boot reads this and toasts the confirmation
```

`js/app.js` — import line 38 and the consumer (~line 757):

```js
import { initFirstRun, consumeGraduationNotice } from './firstRun.js';
```
```js
  const landingMsg = consumeGraduationNotice();
  if (landingMsg) showToast(landingMsg);
```

Then `grep -rn 'stampLanding\|consumeLandingNotice' js/ tests/` — zero hits outside this diff.

- [x] **Step 4: Run to verify pass**

Run: `npx jest tests/firstRun.test.js tests/graduation.test.js tests/telegramSettings.test.js tests/app-boot-cacheOwner.test.js` — green (telegramSettings asserts `kk-landing` stays null on link/unlink — unaffected).

- [x] **Step 5: Commit**

```bash
git add js/firstRun.js js/graduation.js js/app.js tests/firstRun.test.js tests/graduation.test.js
git commit -m "refactor(web): collapse the landing-notice kind map to stamp/consumeGraduationNotice"
```

---

### Task 6: One `shareCaption(scope, groupName)` (CL#12 / E7)

**Files:**
- Modify: `js/inviteFlow.js` (new export + the two `text` defaults), `js/inviteModal.js` (2 sites)
- Test: `tests/inviteFlow.test.js`

**Interfaces:**
- Consumes: the post-W3-A `js/inviteFlow.js` (W3-A Task 4 moved `buildTelegramShareUrl` out; `shareInviteLink`/`shareInviteToTelegramWeb` remain here).
- Produces: `shareCaption(scope, groupName): string` exported from `js/inviteFlow.js`.

- [x] **Step 1: Write the failing test**

Add to `tests/inviteFlow.test.js` (inside the existing describe):

```js
test('shareCaption: the one place captions are spelled (W3-B CL#12)', () => {
  const { shareCaption } = require('../js/inviteFlow.js');
  expect(shareCaption('personal')).toBe('Follow me on KnockKnock');
  expect(shareCaption('group', 'Family')).toBe('Join Family on KnockKnock');
  expect(shareCaption(undefined)).toBe('Follow me on KnockKnock'); // scopeless invite (minted {token,url}) reads personal
});

test('shareInviteLink default caption comes from the invite scope', () => {
  process.env.TELEGRAM_APP_LINK = '';
  jest.resetModules();
  const fresh = require('../js/inviteFlow.js');
  fresh.shareInviteLink({ token: 'T'.repeat(22), url: 'https://app/?i=x', scope: 'group', groupName: 'Family' });
  expect(mockShare).toHaveBeenLastCalledWith('https://app/?i=x', 'Join Family on KnockKnock');
});
```

(The existing `shareInviteLink` default-caption assertion — `'Follow me on KnockKnock'` for a scopeless invite — keeps passing unchanged.)

- [x] **Step 2: Run to verify failure**

Run: `npx jest tests/inviteFlow.test.js`
Expected: FAIL — `shareCaption` not exported; group-scoped default still 'Follow me on KnockKnock'.

- [x] **Step 3: Implement**

`js/inviteFlow.js`:

```js
// The ONLY place share captions are spelled (W3-B CL#12) — W4's copy sweep has
// one string per caption to touch. A scopeless invite (e.g. a freshly minted
// { token, url }) reads as personal, matching the old per-function defaults.
export function shareCaption(scope, groupName) {
  return scope === 'group' ? `Join ${groupName} on KnockKnock` : 'Follow me on KnockKnock';
}
```

The two signatures' defaults change (bodies untouched):

```js
export function shareInviteLink(invite, text = shareCaption(invite.scope, invite.groupName)) {
```
```js
export function shareInviteToTelegramWeb(invite, text = shareCaption(invite.scope, invite.groupName)) {
```

`js/inviteModal.js` — add `shareCaption` to the `./inviteFlow.js` import; the two explicit sites:

- group tg-share button (currently `` shareInviteLink({ token, url }, `Join ${groupName} on KnockKnock`) ``):
  ```js
        shareInviteLink({ token, url }, shareCaption('group', groupName));
  ```
- the share-button handler (currently `` const text = scope === 'group' ? `Join ${groupName} on KnockKnock` : 'Follow me on KnockKnock'; ``):
  ```js
      const text = shareCaption(scope, groupName);
  ```

Update `tests/inviteModal.test.js`'s `../js/inviteFlow.js` mock: add `shareCaption: (scope, groupName) => (scope === 'group' ? `Join ${groupName} on KnockKnock` : 'Follow me on KnockKnock'),` (faithful stub — the file mocks the module wholesale).

Then `grep -rn 'on KnockKnock' js/` — hits only in `js/inviteFlow.js` (`shareCaption`).

- [x] **Step 4: Run to verify pass**

Run: `npx jest tests/inviteFlow.test.js tests/inviteModal.test.js tests/mycode.test.js` — green.

- [x] **Step 5: Commit**

```bash
git add js/inviteFlow.js js/inviteModal.js tests/inviteFlow.test.js tests/inviteModal.test.js
git commit -m "refactor(web): one shareCaption — invite captions spelled once"
```

---

### Task 7: `showLinkScreen` uses the shared busy pair (CL#7 remainder / E2)

**Files:**
- Modify: `js/telegramSettings.js` (`showLinkScreen`)
- Test: `tests/telegramSettings.test.js`

**Interfaces:**
- Consumes: `setButtonBusy`/`clearButtonBusy` from `js/utils.js:8-18`. Baseline (OBSERVED at `97482f0`): the landed W1-Task-9 `showLinkScreen` (`js/telegramSettings.js:93-146` — promise-returning, resolves `false` on cancel / `true` before reload) with the four hand-rolled busy lines at `:120-121`/`:125-126`.
- Produces: no API change.

- [x] **Step 1: Write the failing test**

Add to `tests/telegramSettings.test.js`:

```js
test('link submit: shared busy pair + stale idleLabel from the restore flow cannot leak (W3-B CL#7)', async () => {
  const { initTelegramSettings, showLinkScreen } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  const submit = document.getElementById('restore-submit-btn');
  // A prior showRestoreScreen busy cycle leaves its stashed idle label behind.
  submit.dataset.idleLabel = 'Paste & Sign in';
  callLinkTelegram.mockRejectedValue(new Error('network'));
  showLinkScreen();
  document.getElementById('restore-input').value = 'abacus-abdomen-abdominal-abide';
  submit.click();
  expect(submit.disabled).toBe(true);
  expect(submit.textContent).toBe('Linking…');
  await flush();
  // Failure reverts to THIS screen's label, not the restore flow's stash.
  expect(submit.disabled).toBe(false);
  expect(submit.textContent).toBe('Link account');
  expect(document.getElementById('restore-error').classList.contains('hidden')).toBe(false);
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx jest tests/telegramSettings.test.js`
Expected: FAIL — after the rejected call the button reads `'Paste & Sign in'`? No: the current hand-rolled revert sets `'Link account'` directly, so this test PASSES pre-change on the label but the point is pinning it before the busy-pair swap. Verify instead that it fails AFTER a naive swap without the scrub: proceed to Step 3, and if the test passed in Step 2, treat it as the pinned baseline (same pattern as Task 4) — the swap below must keep it green.

- [x] **Step 3: Implement**

`js/telegramSettings.js` — imports gain the pair (if Task 6 of W3-A removed it, re-add): `import { setButtonBusy, clearButtonBusy } from './utils.js';`

In `showLinkScreen`'s open sequence (before `submit.textContent = 'Link account';`), add the scrub:

```js
  // Scrub the busy pair's stash: #restore-submit-btn is shared with
  // showRestoreScreen, and setButtonBusy stashes idleLabel only once — a stale
  // stash from the restore flow would resurface on a failed link (W3-B CL#7).
  delete submit.dataset.idleLabel;
  submit.textContent = 'Link account';
  submit.disabled = false;
```

In `onSubmit` (post-W1-Task-9 body), the four hand-rolled lines become the pair:

```js
    async function onSubmit() {
      const normalized = parseRecoveryCode(input.value);
      if (!normalized) { showError("That doesn't look like a secret phrase."); return; }
      setButtonBusy(submit, 'Linking…');
      try {
        await callLinkTelegram(tgWebApp().initData, normalized);
      } catch (e) {
        clearButtonBusy(submit);
        showError(/not-found/.test(e?.code || '') ? 'No account found with that phrase.' : "Couldn't link right now. Try again.");
        return;
      }
      teardown();
      resolve(true); // observable in tests; the reload ends the session
      window.location.reload(); // reboot via initData into the linked account
    }
```

(Only the busy/revert lines changed; error copy, teardown, resolve, reload identical to the W1 Task 9 shape.)

- [x] **Step 4: Run to verify pass**

Run: `npx jest tests/telegramSettings.test.js` — green, whole file.

- [x] **Step 5: Commit**

```bash
git add js/telegramSettings.js tests/telegramSettings.test.js
git commit -m "refactor(web): showLinkScreen uses the shared busy pair, with the cross-flow idleLabel scrub"
```

---

### Task 8: One internal modal harness in `promptModal.js` (CL#6 / E1)

**Files:**
- Modify: `js/promptModal.js` (internal refactor only)
- Test: `tests/promptModal.test.js` — **no changes permitted**

**Interfaces:**
- Consumes: the POST-W3-A-Task-5 `showConfirmModal` (busy/inert/error machinery). Pre-W3-A fallback: dedupe the two original harnesses; the helper below simply loses its busy branch.
- Produces: no exported API change. Internal `runModal` only.

- [x] **Step 1: Pin the baseline**

Run: `npx jest tests/promptModal.test.js` — green (this exact file must stay green with ZERO edits; that is the whole acceptance).

- [x] **Step 2: Implement**

`js/promptModal.js` — add the internal helper and rewrite both public functions onto it. Complete post-refactor module body (imports and file-top comment unchanged):

```js
// runModal(overlay, { confirmBtn, cancelBtn, cancelValue, onConfirmTap }) — the
// one promise/cleanup/overlay-tap/Escape harness both modals ride (W3-B CL#6).
// onConfirmTap({ finish, setBusy, clearBusy, showError, clearError }) decides
// per tap whether to finish; cancel / overlay-tap / Escape → finish(cancelValue),
// inert while a busy round-trip runs.
function runModal(overlay, { confirmBtn, cancelBtn, cancelValue, onConfirmTap }) {
  let busy = false;
  return new Promise((resolve) => {
    function cleanup() {
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
    }
    function finish(result) {
      cleanup();
      overlay.classList.add('hidden');
      resolve(result);
    }
    function onConfirm() {
      if (busy) return;
      onConfirmTap({
        finish,
        setBusy(label) { busy = true; setButtonBusy(confirmBtn, label); },
        clearBusy() { busy = false; clearButtonBusy(confirmBtn); },
      });
    }
    function onCancel() { if (!busy) finish(cancelValue); }
    function onOverlay(e) { if (!busy && e.target === overlay) finish(cancelValue); }
    function onKey(e) { if (!busy && e.key === 'Escape') finish(cancelValue); }
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
}

export function showTextPrompt({ title, value = '', confirmLabel = 'Save', maxLength = 40, placeholder = '' }) {
  const overlay = document.getElementById('text-prompt-modal');
  const titleEl = document.getElementById('text-prompt-title');
  const input = document.getElementById('text-prompt-input');
  const errEl = document.getElementById('text-prompt-error');
  const confirmBtn = document.getElementById('text-prompt-confirm-btn');
  const cancelBtn = document.getElementById('text-prompt-cancel-btn');

  titleEl.textContent = title;
  confirmBtn.textContent = confirmLabel;
  input.value = value;
  input.maxLength = maxLength;
  input.placeholder = placeholder;
  errEl.textContent = '';
  errEl.classList.add('hidden');
  overlay.classList.remove('hidden');
  if (input.focus) input.focus();

  return runModal(overlay, {
    confirmBtn,
    cancelBtn,
    cancelValue: null,
    onConfirmTap({ finish }) {
      const trimmed = (input.value || '').trim();
      if (!trimmed) { errEl.textContent = 'Please enter a value.'; errEl.classList.remove('hidden'); return; }
      if (trimmed.length > maxLength) { errEl.textContent = `Must be at most ${maxLength} characters.`; errEl.classList.remove('hidden'); return; }
      finish(trimmed);
    },
  });
}

export function showConfirmModal({ title, message = '', confirmLabel = 'Confirm', busyLabel = null, onConfirm = null }) {
  const overlay = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-modal-title');
  const messageEl = document.getElementById('confirm-modal-message');
  const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
  const cancelBtn = document.getElementById('confirm-modal-cancel-btn');
  const errEl = document.getElementById('confirm-modal-error');

  titleEl.textContent = title;
  messageEl.textContent = message;
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
  delete confirmBtn.dataset.idleLabel; // scrub a prior modal's busy stash
  confirmBtn.textContent = confirmLabel;
  overlay.classList.remove('hidden');

  return runModal(overlay, {
    confirmBtn,
    cancelBtn,
    cancelValue: false,
    async onConfirmTap({ finish, setBusy, clearBusy }) {
      if (!onConfirm) { finish(true); return; }
      if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
      setBusy(busyLabel || confirmLabel);
      try {
        await onConfirm();
      } catch (e) {
        clearBusy();
        if (errEl) {
          errEl.textContent = e?.userMessage || "Couldn't finish that right now. Try again.";
          errEl.classList.remove('hidden');
        }
        return; // stays open for retry or cancel
      }
      clearBusy();
      finish(true);
    },
  });
}
```

(Keep each function's existing doc comments — `showTextPrompt`'s contract comment and W3-A Task 5's `showConfirmModal` comment — above their definitions.)

- [x] **Step 3: Run to verify pass**

Run: `npx jest tests/promptModal.test.js` — green with `git diff tests/promptModal.test.js` EMPTY. Then `npx jest tests/telegramSettings.test.js tests/telegramChrome.test.js` — green (the unlink caller and back-button behavior ride the same public surface).

- [x] **Step 4: Commit**

```bash
git add js/promptModal.js
git commit -m "refactor(web): one internal runModal harness under showTextPrompt and showConfirmModal"
```

---

### Task 9: Whole-suite verification + docs

**Files:**
- Modify: `docs/HANDOFF.md` (top block + new rundown section), this plan's checkboxes

- [x] **Step 1: Run the full web suite**

Run: `npx jest` — all green (1446 at `97482f0` + W3-A's additions + this wave's).

- [x] **Step 2: Grep the scope fence + dedup proofs**

`git diff <first-W3B-commit>^..HEAD --stat` — only `js/`, `tests/`, `docs/`. Spot-checks: `grep -rn 'slice(0, 40)' js/` → no hits; `grep -rn 'on KnockKnock' js/` → only `shareCaption`; `grep -rn "textContent = 'Copied!'" js/` → only `js/mycode.js` (the documented exclusion); `grep -rn 'stampLanding' js/ tests/` → none.

- [x] **Step 3: Update HANDOFF.md**

Top block + new rundown section: W3-B implemented (list CL#6–CL#13 with the two operator-decided exclusions: no restore-screen factoring, `initRecoveryPill` kept bespoke), test counts, UNVERIFIED on-device — the operator's walkthrough (link-screen failure path, webview copy buttons, graduation toast after the rename) is the acceptance gate.

- [x] **Step 4: Commit**

```bash
git add docs/HANDOFF.md docs/superpowers/plans/2026-07-08-telegram-w3b-client-cleanups.md
git commit -m "docs(handoff): wave W3-B implemented — pending on-device verification"
```

---

## Self-Review (completed at authoring)

- **Spec coverage:** E3 → Task 1; E4 → Task 2; E5 → Task 3; E6 → Task 4; E8 → Task 5; E7 → Task 6; E2 → Task 7; E1 → Task 8; spec Testing section → per-task steps + Task 9. Ordering matches the spec (independents first, prerequisite-coupled tail last).
- **Placeholders:** none — Task 8 carries the complete post-refactor module body; Tasks 1/6 name the exact mock shapes to mirror.
- **Type consistency:** `startPersonalInviteFlow()` (T1) matches both call sites; `copyWithFeedback(btn, text, { done, idle })` (T3) matches all four conversions; `stampGraduationNotice`/`consumeGraduationNotice` (T5) match producer/consumer/tests; `shareCaption(scope, groupName)` (T6) matches both defaults and both explicit sites; `runModal`'s `onConfirmTap({ finish, setBusy, clearBusy })` (T8) reproduces W3-A Task 5's observable behavior exactly.
- **Two pinned-baseline tasks** (T4 Step 1, T7 Step 2) are deliberate: the change is a refactor whose bar is "existing behavior preserved", so the test pins the behavior rather than failing first — noted inline where it happens.
