# Wave W3-A: Client Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the five headliner client consolidations from the Telegram feature analysis (CL#1–CL#5): a `setListEmpty` change guard, deferred script loading, one `isTelegramLinked()` predicate, the unlink confirm consolidated onto `showConfirmModal`, and one t.me share-URL builder.

**Architecture:** Pure client-side consolidation — no behavior changes except the two measurable performance fixes (Tasks 1–2). New shared capability lives where its state lives (`js/telegram.js` owns link state and the share-URL builder; `js/promptModal.js` owns the confirm modal; `js/utils.js` already owns the busy pair). Spec: `docs/superpowers/specs/2026-07-08-telegram-w3-client-consolidation-design.md`.

**Tech Stack:** Vanilla ES modules, esbuild, jest + jsdom.

## Global Constraints

- **Branch/sequencing — UPDATE 2026-07-08: W1 (+W2) has LANDED.** Baseline is `claude/telegram-app-adaptation-t1r1jp` tip `97482f0` (HANDOFF §37–§40), on-device verified. Tasks 5–6's W1 Task 13/14 baselines are now OBSERVED in landed source, re-verified at the tip; the pre-W1 fallbacks recorded in earlier drafts no longer apply. Cut the execution branch from that tip (or its descendant).
- **Line numbers** in this plan were re-verified against `97482f0`; still anchor on the quoted code if the tip has moved again.
- **Scope fence:** `js/`, `index.template.html`, `tests/` only. NO `functions/`, NO `css/app.css`, no fixing other analysis findings in passing (CL#6–CL#13 are wave W3-B).
- **Contract landmine:** in `js/notifyChannel.js`, ONLY the Telegram arm of `isLinked(prefs)` changes (Task 3). The web arm `prefs?.telegram != null` is one of THREE cross-referenced readers of the notify-channel default (`js/notifySuppression.js`, `functions/notifier.js`) and stays byte-for-byte, comment intact.
- **Tests:** web suite `npx jest` from repo root (baseline **1446** green at tip `97482f0`; functions 281 — untouched by this wave).
- **Copy:** straight apostrophes; "Try again." voice. New copy in this wave: `Couldn't finish that right now. Try again.` (generic onConfirm failure) — everything else reuses existing strings verbatim.
- **Commit identity:** `git config user.email noreply@anthropic.com && git config user.name Claude` before the first commit.
- **Acceptance:** green suites are necessary, not sufficient — the operator's on-device walkthrough (Telegram webview + plain web) is the gate, focused on Tasks 2 and 6.

---

### Task 1: `setListEmpty` change guard (CL#1)

**Files:**
- Modify: `js/firstRun.js` (`setListEmpty`, ~line 32)
- Test: `tests/firstRun.test.js`

**Interfaces:**
- Produces: no API change. Contract change: `setListEmpty(isEmpty)` is a **no-op when the emptiness state is unchanged** (was: full re-sync + `first-run-change` dispatch on every call). Sole event consumer `js/installAffordance.js:110` treats the event as a change signal — unaffected.

- [x] **Step 1: Write the failing test**

Add to `tests/firstRun.test.js` (uses the file's existing `mockTelegram` + `FIXTURE` setup):

```js
test('same-state re-call is a no-op: no dispatch, no DOM re-sync (W3-A CL#1)', () => {
  firstRun.setListEmpty(true);
  const seen = jest.fn();
  document.addEventListener('first-run-change', seen);
  // Sentinel: a re-sync would overwrite this back to 'Add by code'.
  document.getElementById('add-person-btn').textContent = 'sentinel';
  firstRun.setListEmpty(true);
  expect(seen).not.toHaveBeenCalled();
  expect(document.getElementById('add-person-btn').textContent).toBe('sentinel');
  // A genuine transition still syncs + dispatches.
  firstRun.setListEmpty(false);
  expect(seen).toHaveBeenCalledTimes(1);
  expect(document.getElementById('add-person-btn').textContent).toBe('Add a person');
});
```

And rework the one existing test that depends on same-state re-sync — `'link line: only in TG when unlinked'` (it calls `setListEmpty(true)` three times with changed link mocks). Replace its body with state flips between assertions:

```js
test('link line: only in TG when unlinked', () => {
  firstRun.setListEmpty(true);
  expect(document.getElementById('first-run-link-line').classList.contains('hidden')).toBe(true); // web
  firstRun.setListEmpty(false); // flip so the next call re-syncs (CL#1 guard)
  mockTelegram.isTelegramContext.mockReturnValue(true);
  mockTelegram.telegramLinkState.mockReturnValue({ linked: false });
  firstRun.setListEmpty(true);
  expect(document.getElementById('first-run-link-line').classList.contains('hidden')).toBe(false);
  firstRun.setListEmpty(false); // flip again
  mockTelegram.telegramLinkState.mockReturnValue({ linked: true });
  firstRun.setListEmpty(true);
  expect(document.getElementById('first-run-link-line').classList.contains('hidden')).toBe(true);
});
```

(Every other test in the file already flips state between calls or runs once per `jest.resetModules()`; `'every flip dispatches first-run-change'` asserts two dispatches for a true→false pair, which still holds.)

- [x] **Step 2: Run to verify failure**

Run: `npx jest tests/firstRun.test.js`
Expected: the new test FAILS (dispatch fires and the sentinel is overwritten); the reworked link-line test passes both before and after the guard.

- [x] **Step 3: Implement**

`js/firstRun.js` — add the module-level guard above `setListEmpty`, early-return at its top, and reuse the normalized `empty` throughout (the function already computes `const empty = !!isEmpty;` mid-body — it moves to the top):

```js
// Last emptiness state actually applied. setListEmpty is called from every
// renderList tick (presence flips, watcher ticks, a 60s interval) but its ~10
// DOM writes + the first-run-change fan-out only matter on a genuine
// empty↔non-empty transition — everything else it reads (isTelegramContext,
// telegramLinkState) is static within a session (link/unlink/graduation all
// reload). Same-state re-calls are no-ops (W3-A CL#1).
let _appliedEmpty = null;

// Called by following.js's renderList isEmpty branch. No-op per unchanged state.
export function setListEmpty(isEmpty) {
  const panel = document.getElementById('first-run-panel');
  if (!panel) return;
  const empty = !!isEmpty;
  if (_appliedEmpty === empty) return;
  _appliedEmpty = empty;
  _active = empty;
  panel.classList.toggle('hidden', !empty);
```

Then, in the rest of the function body, replace the remaining reads of the parameter with `empty` (they are equivalent forms of the same boolean):
- `document.getElementById('add-person-area')?.classList.toggle('first-run-demoted', !!isEmpty);` → `…, empty);`
- `if (addBtn) addBtn.textContent = isEmpty ? 'Add by code' : 'Add a person';` → `empty ? …`
- delete the now-duplicate mid-body line `const empty = !!isEmpty;`
- in the link-line block: `const show = !!isEmpty && isTelegramContext() && …` → `const show = empty && isTelegramContext() && …`

Everything else (drawer toggles, chip label, dispatch) already uses `empty` and is unchanged.

- [x] **Step 4: Run to verify pass**

Run: `npx jest tests/firstRun.test.js` — green, all tests.
Then `npx jest tests/installAffordance.test.js tests/following.test.js` (if the latter exists in the suite run it; otherwise skip) — green: the guard changes dispatch frequency only.

- [x] **Step 5: Commit**

```bash
git add js/firstRun.js tests/firstRun.test.js
git commit -m "perf(web): setListEmpty no-ops on unchanged state instead of re-syncing every render tick"
```

---

### Task 2: Defer the Telegram bridge + bundle scripts (CL#2)

**Files:**
- Modify: `index.template.html` (the `telegram-web-app.js` script in `<head>`, line 19 at `97482f0`; the `dist/bundle.js` script at end of body, line 406)

**Interfaces:**
- Produces: no API change. Ordering guarantee: `defer` scripts execute in document order after parse, so `window.Telegram` exists before the bundle runs; the inline theme-restore script (line 25, not deferrable) now runs before any network script.

- [x] **Step 1: No unit surface — record the acceptance gate**

There is no jsdom test for script-tag loading semantics. The acceptance is the operator's on-device walkthrough: (a) Telegram webview boot — Mini App still auto-signs-in (`isTelegramContext()` detected), (b) plain-web boot — app boots normally and first paint no longer waits on telegram.org. Worst-case rollback: remove the two attributes.

- [x] **Step 2: Implement**

`index.template.html` — the head comment + script (replace the whole block):

```html
  <!-- Telegram Mini App bridge. Inert outside Telegram (defines window.Telegram
       with empty initData). Deferred so first paint doesn't wait on telegram.org
       (W3-A CL#2): defer preserves document order, so this still executes before
       the (also deferred) bundle and isTelegramContext() sees window.Telegram at
       boot. Keep BOTH defer attributes or neither — order is the guarantee. -->
  <script src="https://telegram.org/js/telegram-web-app.js" defer></script>
```

And the bundle tag at end of body:

```html
  <script src="dist/bundle.js" defer></script>
```

- [x] **Step 3: Verify the build + suite**

Run: `npm run build` — completes without error (template is copied/processed by `scripts/prod.js`).
Run: `npx jest` — green (no test reads the script tags).

- [x] **Step 4: Commit**

```bash
git add index.template.html
git commit -m "perf(web): defer telegram-web-app.js and the bundle — first paint off the telegram.org critical path"
```

---

### Task 3: One `isTelegramLinked()` predicate (CL#3)

**Files:**
- Modify: `js/telegram.js` (below `telegramLinkState`), `js/app.js` (gate call + import), `js/firstRun.js` (2 sites + import), `js/notifyChannel.js` (`isLinked` Telegram arm + import), `js/telegramSettings.js` (`initTelegramSettings` + import)
- Test: `tests/telegram.test.js`; mock updates in `tests/firstRun.test.js`, `tests/notifyChannel.test.js`, `tests/telegramSettings.test.js`, `tests/app-boot-cacheOwner.test.js`

**Interfaces:**
- Produces: `isTelegramLinked(): boolean` exported from `js/telegram.js` — true iff the session's `ensureTelegramIdentity` reported `linked: true`. `telegramLinkState()` stays exported (it is the underlying accessor).

- [x] **Step 1: Write the failing test**

Add to `tests/telegram.test.js` (uses its existing `setTelegramGlobal` + mocked `callValidateTelegram`):

```js
test('isTelegramLinked: false before boot and for an unlinked session; true for a linked one (W3-A CL#3)', async () => {
  setTelegramGlobal();
  let tg = require('../js/telegram.js');
  expect(tg.isTelegramLinked()).toBe(false); // no link state yet
  await tg.ensureTelegramIdentity(); // mock: linked: false
  expect(tg.isTelegramLinked()).toBe(false);

  jest.resetModules();
  setTelegramGlobal();
  require('../js/firebase-config.js').callValidateTelegram
    .mockResolvedValueOnce({ token: 'tok', uid: 'tg-uid', linked: true, created: false });
  tg = require('../js/telegram.js');
  await tg.ensureTelegramIdentity();
  expect(tg.isTelegramLinked()).toBe(true);
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx jest tests/telegram.test.js`
Expected: FAIL — `isTelegramLinked` is not exported.

- [x] **Step 3: Implement the predicate**

`js/telegram.js`, directly below `telegramLinkState()`:

```js
// THE "is this Telegram session linked" predicate — the one place the linked
// definition is spelled (W3-A CL#3). Static within a session: link, unlink,
// and graduation all reload. NOTE: js/notifyChannel.js isLinked's WEB arm
// (prefs?.telegram != null) is a different, prefs-driven signal and part of
// the three-reader notify-channel contract — it deliberately does NOT use this.
export function isTelegramLinked() {
  return _linkState?.linked === true;
}
```

- [x] **Step 4: Switch the five call sites**

`js/app.js` — import line (line 29 at `97482f0`) gains `isTelegramLinked`; the gate call (line 560) becomes:

```js
    tgInvite = await telegramInviteGate({
      linked: isTelegramLinked(),
      isNew,
      dismissSplash,
    });
```

Then `grep -n telegramLinkState js/app.js` — if the gate was its only use, drop `telegramLinkState` from the import.

`js/firstRun.js` — import becomes `import { isTelegramContext, isTelegramLinked } from './telegram.js';`; the two sites (post-Task-1 shape):

```js
  const tgLinked = isTelegramContext() && isTelegramLinked();
```
```js
    const show = empty && isTelegramContext() && !isTelegramLinked();
```

`js/notifyChannel.js` — import becomes `import { isTelegramContext, isTelegramLinked } from './telegram.js';`; in `isLinked(prefs)` ONLY the Telegram arm changes. Keep the whole comment block above it (three-reader cross-reference) AND the trailing note below it added post-W1 (`// Note: the notifier additionally falls back to the bot when channel IS 'push' …` — `js/notifyChannel.js:38-40` at `97482f0`):

```js
function isLinked(prefs) {
  if (isTelegramContext()) return isTelegramLinked();
  return prefs?.telegram != null;
}
```

(The §39 pill-honesty guards further down the file — `accountHasPushTokens`, `permissionGranted`, the deny/revert paths — are NOT touched by this task.)

`js/telegramSettings.js` — import becomes `import { tgWebApp, isTelegramLinked } from './telegram.js';`; in `initTelegramSettings`:

```js
  const linked = isTelegramLinked();
```

- [x] **Step 5: Update the wholesale telegram.js mocks**

Each of these files mocks `../js/telegram.js` as a whole; add `isTelegramLinked` and convert linked-state arranging (`telegramLinkState` stays in the mocks — extra keys are harmless and W1-era tests may still reference it):

- `tests/firstRun.test.js` — mock object becomes:
  ```js
  const mockTelegram = {
    isTelegramContext: jest.fn(() => false),
    telegramLinkState: jest.fn(() => null),
    isTelegramLinked: jest.fn(() => false),
  };
  ```
  `beforeEach` adds `mockTelegram.isTelegramLinked.mockReturnValue(false);`. Then replace every arranging call `mockTelegram.telegramLinkState.mockReturnValue({ linked: X })` in this file with `mockTelegram.isTelegramLinked.mockReturnValue(X)` (find them: `grep -n 'telegramLinkState.mockReturnValue' tests/firstRun.test.js`).
- `tests/notifyChannel.test.js` — add `isTelegramLinked: jest.fn(() => false)` to the mock and `isTelegramLinked.mockReturnValue(false)` to `beforeEach`; import it alongside the others; same mechanical replacement (`grep -n 'telegramLinkState.mockReturnValue' tests/notifyChannel.test.js` — six hits at `97482f0`, covering W1 Task 7's AND §39's pill tests).
- `tests/telegramSettings.test.js` — the mock (top of file) gains `isTelegramLinked: jest.fn(() => false)`; same replacement for every `telegramLinkState.mockReturnValue({ linked: true })`.
- `tests/app-boot-cacheOwner.test.js` — its telegram.js mock (around line 247) gains `isTelegramLinked: jest.fn(() => false)`; same replacement if any arranging call exists (`grep -n 'telegramLinkState' tests/app-boot-cacheOwner.test.js`).

- [x] **Step 6: Run to verify pass**

Run: `npx jest tests/telegram.test.js tests/firstRun.test.js tests/notifyChannel.test.js tests/telegramSettings.test.js tests/app-boot-cacheOwner.test.js` — green.

- [x] **Step 7: Commit**

```bash
git add js/telegram.js js/app.js js/firstRun.js js/notifyChannel.js js/telegramSettings.js tests/
git commit -m "refactor(web): one isTelegramLinked() predicate replaces five spelled-out link checks"
```

---

### Task 4: One t.me share-URL builder (CL#5)

**Files:**
- Modify: `js/telegram.js` (`openTelegramShare` + new `buildTelegramShareUrl`), `js/inviteFlow.js` (delete local builder; re-export; `shareInviteToTelegramWeb`)
- Test: `tests/telegram.test.js`, `tests/inviteFlow.test.js`

**Interfaces:**
- Produces: `buildTelegramShareUrl(url, text = '', { platform } = {})` exported from `js/telegram.js` (re-exported from `js/inviteFlow.js`). Caption rule folded in: non-empty `text` on any platform other than `'ios'` (including absent/undefined — the web caller) gets a leading `\n`.
- Consumes: nothing from earlier tasks (independent of Tasks 1–3).

- [x] **Step 1: Write the failing tests**

Add to `tests/telegram.test.js`:

```js
describe('buildTelegramShareUrl — the one share-intent builder (W3-A CL#5)', () => {
  const build = () => require('../js/telegram.js').buildTelegramShareUrl;
  test('encodes url + text; empty text → no text param', () => {
    expect(build()('https://t.me/kk_bot/app?startapp=TOK', 'Follow me', { platform: 'ios' }))
      .toBe('https://t.me/share/url?url=https%3A%2F%2Ft.me%2Fkk_bot%2Fapp%3Fstartapp%3DTOK&text=Follow%20me');
    expect(build()('https://x', '')).toBe('https://t.me/share/url?url=https%3A%2F%2Fx');
  });
  test('non-iOS platform gets the newline separator', () => {
    expect(build()('https://x', 'Follow me', { platform: 'macos' }))
      .toContain(`text=${encodeURIComponent('\nFollow me')}`);
  });
  test('absent platform (web caller) defaults to the separated form', () => {
    expect(build()('https://x', 'Follow me'))
      .toContain(`text=${encodeURIComponent('\nFollow me')}`);
  });
});
```

And update `tests/inviteFlow.test.js`:
- The telegram.js mock gains a faithful stub the URL assertions can see through (the real module can't be `requireActual`'d here — it drags in firebase):
  ```js
  jest.mock('../js/telegram.js', () => ({
    isTelegramContext: jest.fn(() => true),
    openTelegramShare: (...a) => mockShare(...a),
    // Faithful stub of the shared builder (exactness is covered in telegram.test.js).
    buildTelegramShareUrl: (url, text = '', { platform } = {}) => {
      const caption = text && platform !== 'ios' ? `\n${text}` : text;
      return `https://t.me/share/url?url=${encodeURIComponent(url)}${caption ? `&text=${encodeURIComponent(caption)}` : ''}`;
    },
  }));
  ```
- DELETE the test `'buildTelegramShareUrl: t.me share intent with encoded url + text'` (its subject moved to `telegram.test.js` above; requiring it from `inviteFlow.js` now resolves to the mock).
- The `shareInviteToTelegramWeb` URL test keeps passing unchanged — the stub reproduces the `\nFollow me` caption for the platform-less web call.

- [x] **Step 2: Run to verify failure**

Run: `npx jest tests/telegram.test.js`
Expected: FAIL — `buildTelegramShareUrl` not exported from `js/telegram.js`.

- [x] **Step 3: Implement**

`js/telegram.js` — replace `openTelegramShare` with the builder + a thin opener:

```js
// The ONE t.me share-intent builder (W3-A CL#5). Caption-spacing rule folded
// in: desktop clients (e.g. macOS) concatenate the shared url and caption with
// no separator, so the link butts straight against the text; iOS inserts one.
// Non-iOS AND unknown/absent platform (the web share opens in whatever client
// the recipient runs) get a leading newline — never worse than today.
export function buildTelegramShareUrl(url, text = '', { platform } = {}) {
  const caption = text && platform !== 'ios' ? `\n${text}` : text;
  return `https://t.me/share/url?url=${encodeURIComponent(url)}${caption ? `&text=${encodeURIComponent(caption)}` : ''}`;
}

// Open Telegram's native share sheet for a link (invite links, share code).
// Silent no-op outside Telegram or on old clients without openTelegramLink.
export function openTelegramShare(url, text = '') {
  const wa = tgWebApp();
  if (!wa?.openTelegramLink) return;
  wa.openTelegramLink(buildTelegramShareUrl(url, text, { platform: wa.platform }));
}
```

`js/inviteFlow.js`:
- import line becomes `import { openTelegramShare, buildTelegramShareUrl } from './telegram.js';`
- DELETE the local `buildTelegramShareUrl` function; in its place, the re-export (keeps the existing import surface working):
  ```js
  // The builder lives with the platform knowledge in telegram.js (W3-A CL#5);
  // re-exported here for existing importers.
  export { buildTelegramShareUrl } from './telegram.js';
  ```
- `shareInviteToTelegramWeb` — the caption rule moves into the builder (platform-less call = separated form):
  ```js
  export function shareInviteToTelegramWeb(invite, text = 'Follow me on KnockKnock') {
    const deepLink = buildTelegramInviteLink(invite.token);
    if (!deepLink || typeof window === 'undefined' || !window.open) return false;
    // No platform arg: the recipient's client is unknown from the web, so the
    // builder uses the separated (non-iOS) form — same output as before.
    return !!window.open(buildTelegramShareUrl(deepLink, text), '_blank', 'noopener');
  }
  ```
  (Delete the old local `caption` line and its comment.)

- [x] **Step 4: Run to verify pass**

Run: `npx jest tests/telegram.test.js tests/inviteFlow.test.js tests/inviteModal.test.js` — green (inviteModal mocks `inviteFlow.js` wholesale, unaffected).

- [x] **Step 5: Commit**

```bash
git add js/telegram.js js/inviteFlow.js tests/telegram.test.js tests/inviteFlow.test.js
git commit -m "refactor(web): one t.me share-URL builder with the caption-spacing rule folded in"
```

---

### Task 5: `showConfirmModal` gains async `onConfirm` (CL#4, modal half)

**Files:**
- Modify: `js/promptModal.js` (`showConfirmModal`), `index.template.html` (`#confirm-modal` markup, lines 164-172 at `97482f0`)
- Test: `tests/promptModal.test.js`

**Interfaces:**
- Consumes: `setButtonBusy`/`clearButtonBusy` from `js/utils.js:8-18`.
- Produces: `showConfirmModal({ title, message?, confirmLabel?, busyLabel?, onConfirm? })`. Without `onConfirm`: byte-identical behavior. With it: confirm tap goes busy (`busyLabel || confirmLabel`), cancel/overlay/Escape inert while in flight, resolve → `finish(true)`, throw → inline error (`e.userMessage || "Couldn't finish that right now. Try again."`) in `#confirm-modal-error`, modal stays open. Task 6 consumes this exact signature.

- [x] **Step 1: Write the failing tests**

Add to `tests/promptModal.test.js`. First extend `setupDom()`'s `#confirm-modal` block with the error line (between the message and the buttons):

```html
        <p id="confirm-modal-message"></p>
        <p id="confirm-modal-error" class="error-msg hidden"></p>
```

Then the new describe (add `const flush = () => new Promise((r) => setTimeout(r, 0));` near the top of the file):

```js
describe('showConfirmModal with async onConfirm (W3-A CL#4)', () => {
  test('busy label while pending; resolves true and closes on success', async () => {
    let release;
    const onConfirm = jest.fn(() => new Promise((r) => { release = r; }));
    const p = showConfirmModal({ title: 'Unlink?', confirmLabel: 'Unlink', busyLabel: 'Unlinking…', onConfirm });
    const btn = document.getElementById('confirm-modal-confirm-btn');
    btn.click();
    await Promise.resolve();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Unlinking…');
    release();
    await expect(p).resolves.toBe(true);
    expect(btn.disabled).toBe(false);
    expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(true);
  });

  test('failure shows the inline userMessage, stays open, retry resolves', async () => {
    const onConfirm = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { userMessage: "Couldn't unlink right now. Try again." }))
      .mockResolvedValueOnce(undefined);
    const p = showConfirmModal({ title: 'Unlink?', confirmLabel: 'Unlink', busyLabel: 'Unlinking…', onConfirm });
    const btn = document.getElementById('confirm-modal-confirm-btn');
    btn.click();
    await flush();
    const err = document.getElementById('confirm-modal-error');
    expect(err.classList.contains('hidden')).toBe(false);
    expect(err.textContent).toBe("Couldn't unlink right now. Try again.");
    expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(false);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('Unlink');
    btn.click(); // retry
    await expect(p).resolves.toBe(true);
  });

  test('failure without userMessage shows the generic copy; cancel afterwards resolves false', async () => {
    const onConfirm = jest.fn().mockRejectedValue(new Error('network'));
    const p = showConfirmModal({ title: 'x', confirmLabel: 'Go', onConfirm });
    document.getElementById('confirm-modal-confirm-btn').click();
    await flush();
    expect(document.getElementById('confirm-modal-error').textContent)
      .toBe("Couldn't finish that right now. Try again.");
    document.getElementById('confirm-modal-cancel-btn').click();
    await expect(p).resolves.toBe(false);
  });

  test('cancel / overlay / Escape are inert while onConfirm is in flight', async () => {
    let release;
    const onConfirm = () => new Promise((r) => { release = r; });
    const p = showConfirmModal({ title: 'x', busyLabel: 'Working…', onConfirm });
    document.getElementById('confirm-modal-confirm-btn').click();
    await Promise.resolve();
    document.getElementById('confirm-modal-cancel-btn').click();
    document.getElementById('confirm-modal').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(false);
    release();
    await expect(p).resolves.toBe(true);
  });

  test('error and stale idleLabel are scrubbed on open', async () => {
    // Prior modal leaves an error + a stashed idle label behind.
    const failing = showConfirmModal({ title: 'a', confirmLabel: 'Del', busyLabel: 'Deleting…', onConfirm: jest.fn().mockRejectedValue(new Error('x')) });
    const btn = document.getElementById('confirm-modal-confirm-btn');
    btn.click();
    await flush();
    document.getElementById('confirm-modal-cancel-btn').click();
    await failing;
    // Next modal with a DIFFERENT confirm label: no leftover error, and a
    // failed busy cycle reverts to THIS modal's label, not the prior one's.
    const p = showConfirmModal({ title: 'b', confirmLabel: 'Unlink', busyLabel: 'Unlinking…', onConfirm: jest.fn().mockRejectedValue(new Error('y')) });
    expect(document.getElementById('confirm-modal-error').classList.contains('hidden')).toBe(true);
    btn.click();
    await flush();
    expect(btn.textContent).toBe('Unlink');
    document.getElementById('confirm-modal-cancel-btn').click();
    await expect(p).resolves.toBe(false);
  });
});
```

- [x] **Step 2: Run to verify failure**

Run: `npx jest tests/promptModal.test.js`
Expected: new tests FAIL (options ignored, no error element handling); the two pre-existing `showConfirmModal` tests still pass.

- [x] **Step 3: Implement**

`index.template.html` — inside `#confirm-modal`'s `.confirm-sheet` (lines 165-171 at `97482f0`), add the error line after `#confirm-modal-message`:

```html
      <p id="confirm-modal-message"></p>
      <p id="confirm-modal-error" class="error-msg hidden"></p>
```

`js/promptModal.js` — add the import at the top:

```js
import { setButtonBusy, clearButtonBusy } from './utils.js';
```

Replace `showConfirmModal` in full:

```js
// showConfirmModal({ title, message?, confirmLabel?, busyLabel?, onConfirm? })
//   → Promise<boolean>
// Resolves true on confirm, false on cancel / overlay-tap / Escape.
// With an async `onConfirm` (W3-A CL#4): the confirm tap runs it with the
// button busy (`busyLabel`, else the confirm label) and the modal stays up;
// cancel/overlay/Escape are inert while it runs — a destructive action must
// not be dismissible mid-round-trip. Resolve → true + close. Throw → inline
// error (e.userMessage or a generic) and the modal stays open for retry or
// cancel. Same onConfirm/userMessage convention as recoveryModal.
export function showConfirmModal({ title, message = '', confirmLabel = 'Confirm', busyLabel = null, onConfirm = null }) {
  const overlay = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-modal-title');
  const messageEl = document.getElementById('confirm-modal-message');
  const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
  const cancelBtn = document.getElementById('confirm-modal-cancel-btn');
  const errEl = document.getElementById('confirm-modal-error');

  titleEl.textContent = title;
  messageEl.textContent = message;
  // Scrub prior-modal residue: the error line, and the busy pair's stashed
  // idle label (setButtonBusy stashes once per element — a stale stash from a
  // different confirmLabel would resurface on this modal's busy revert).
  if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
  delete confirmBtn.dataset.idleLabel;
  confirmBtn.textContent = confirmLabel;
  overlay.classList.remove('hidden');

  let busy = false;
  return new Promise((resolve) => {
    function cleanup() {
      confirmBtn.removeEventListener('click', onConfirmTap);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
    }
    function finish(result) {
      cleanup();
      overlay.classList.add('hidden');
      resolve(result);
    }
    async function onConfirmTap() {
      if (busy) return;
      if (!onConfirm) { finish(true); return; }
      if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
      busy = true;
      setButtonBusy(confirmBtn, busyLabel || confirmLabel);
      try {
        await onConfirm();
      } catch (e) {
        busy = false;
        clearButtonBusy(confirmBtn);
        if (errEl) {
          errEl.textContent = e?.userMessage || "Couldn't finish that right now. Try again.";
          errEl.classList.remove('hidden');
        }
        return; // stays open for retry or cancel
      }
      busy = false;
      clearButtonBusy(confirmBtn);
      finish(true);
    }
    function onCancel() { if (!busy) finish(false); }
    function onOverlay(e) { if (!busy && e.target === overlay) finish(false); }
    function onKey(e) { if (!busy && e.key === 'Escape') finish(false); }
    confirmBtn.addEventListener('click', onConfirmTap);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
}
```

(`showTextPrompt` is untouched. Deduping the two harnesses is wave W3-B's E1.)

- [x] **Step 4: Run to verify pass**

Run: `npx jest tests/promptModal.test.js` — green, including all pre-existing tests. Then `npx jest tests/groups.test.js tests/groupContext.test.js` if those exist in the suite (existing `showConfirmModal` callers) — or simply note the whole-suite run in Task 7 covers them.

- [x] **Step 5: Commit**

```bash
git add js/promptModal.js index.template.html tests/promptModal.test.js
git commit -m "feat(web): showConfirmModal optional async onConfirm — busy, inline error, stay-open retry"
```

---

### Task 6: Unlink confirm rides `showConfirmModal`; bespoke sheet deleted (CL#4, caller half)

**Files:**
- Modify: `js/telegramSettings.js` (delete `ensureUnlinkConfirmModal` + `doUnlink`; new unlink handler), `js/telegramChrome.js` (drop the `#tg-unlink-confirm` back entry W1 Task 13 added)
- Test: `tests/telegramSettings.test.js`, `tests/telegramChrome.test.js`

**Interfaces:**
- Consumes: Task 5's `showConfirmModal` (with `busyLabel`/`onConfirm`); `callUnlinkTelegram` (existing); `tgWebApp` (existing).
- Baseline (OBSERVED at `97482f0`): the landed `js/telegramSettings.js` — W1 Task 14 gave the bespoke sheet a `#tg-unlink-error` line, `setButtonBusy(btn, 'Unlinking…')`, and error-clear-on-open (`ensureUnlinkConfirmModal` at `:46-69`, `doUnlink` at `:71-86`). ALL of that is deleted here; the shared modal now carries those behaviors.

- [x] **Step 1: Write the failing tests**

`tests/telegramSettings.test.js` — first, `mountDom()` needs the shared confirm-modal markup (it was never in this fixture); append inside the template string:

```html
    <div id="confirm-modal" class="confirm-overlay hidden">
      <div class="confirm-sheet">
        <h4 id="confirm-modal-title"></h4>
        <p id="confirm-modal-message"></p>
        <p id="confirm-modal-error" class="error-msg hidden"></p>
        <div class="confirm-btns">
          <button id="confirm-modal-cancel-btn"></button>
          <button id="confirm-modal-confirm-btn"></button>
        </div>
      </div>
    </div>
```

Then REPLACE the bespoke-sheet unlink tests — `'linked state shows unlink instead; confirmed unlink calls the callable'`, `'unlink confirm is a modal overlay on the body, not inline in the account section'`, `'unlink: first tap opens the confirm modal, does not call unlinkTelegram'`, `'unlink: cancel closes the confirm modal'`, `'unlink: confirm calls unlinkTelegram and does NOT stamp a landing banner'`, and W1 Task 14's `'unlink failure shows the inline error and re-enables the button (W1 J#7)'` — with these (same arrange style: linked mock + `initTelegramSettings('u1')`; post-Task-3 that arrange is `isTelegramLinked.mockReturnValue(true)`):

```js
test('unlink: first tap opens the shared confirm modal with the unlink copy, no callable yet', async () => {
  isTelegramLinked.mockReturnValue(true);
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-unlink-btn').click();
  expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('confirm-modal-title').textContent).toBe('Unlink this Telegram?');
  expect(document.getElementById('confirm-modal-message').textContent)
    .toBe('Your account stays yours — sign in with your secret phrase in any browser. This Telegram will start over with a fresh, empty account.');
  expect(document.getElementById('confirm-modal-confirm-btn').textContent).toBe('Unlink');
  expect(callUnlinkTelegram).not.toHaveBeenCalled();
  // No bespoke sheet is injected any more (W3-A CL#4).
  expect(document.getElementById('tg-unlink-confirm')).toBeNull();
});

test('unlink: cancel closes without calling the callable', async () => {
  isTelegramLinked.mockReturnValue(true);
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-unlink-btn').click();
  document.getElementById('confirm-modal-cancel-btn').click();
  await flush();
  expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(true);
  expect(callUnlinkTelegram).not.toHaveBeenCalled();
});

test('unlink: confirm goes busy, calls the callable, does NOT stamp a landing banner', async () => {
  isTelegramLinked.mockReturnValue(true);
  let release;
  callUnlinkTelegram.mockImplementation(() => new Promise((r) => { release = r; }));
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-unlink-btn').click();
  const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
  confirmBtn.click();
  await flush();
  expect(callUnlinkTelegram).toHaveBeenCalledWith('signed-init-data');
  expect(confirmBtn.disabled).toBe(true);
  expect(confirmBtn.textContent).toBe('Unlinking…');
  release();
  await flush();
  expect(sessionStorage.getItem('kk-landing')).toBeNull();
});

test('unlink failure: inline error in the shared modal, stays open for retry (carries W1 J#7 over)', async () => {
  isTelegramLinked.mockReturnValue(true);
  callUnlinkTelegram.mockRejectedValue(new Error('network'));
  const { initTelegramSettings } = require('../js/telegramSettings.js');
  initTelegramSettings('u1');
  await flush();
  document.getElementById('tg-unlink-btn').click();
  const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
  confirmBtn.click();
  await flush();
  const err = document.getElementById('confirm-modal-error');
  expect(err.classList.contains('hidden')).toBe(false);
  expect(err.textContent).toBe("Couldn't unlink right now. Try again.");
  expect(document.getElementById('confirm-modal').classList.contains('hidden')).toBe(false);
  expect(confirmBtn.disabled).toBe(false);
  expect(confirmBtn.textContent).toBe('Unlink');
});
```

(`isTelegramLinked` is required from the mocked `../js/telegram.js` at the top of the file, alongside `telegramLinkState` — Task 3 added it. jsdom's `window.location.reload` is a non-throwing no-op here — same note as `tests/graduation.test.js:69-71` — so the success path needs no reload stub.)

`tests/telegramChrome.test.js` — in the landed `test.each` table (`describe('back button covers the W1 overlays (C#1)')`, row at line 127 at `97482f0`), DELETE the row `['tg-unlink-confirm', 'tg-unlink-cancel-btn']` and its `#tg-unlink-confirm` fixture line (line 32). The `#confirm-modal` row — already the table's first — now covers unlink; the `unfollow-confirm`/`rotate-confirm` rows added by `8c34d99` are untouched.

- [x] **Step 2: Run to verify failure**

Run: `npx jest tests/telegramSettings.test.js`
Expected: new tests FAIL (bespoke `#tg-unlink-confirm` still injected; shared modal never opens).

- [x] **Step 3: Implement `telegramSettings.js`**

- Imports: add `import { showConfirmModal } from './promptModal.js';`. W1 Task 14's `setButtonBusy, clearButtonBusy` import becomes unused by the unlink path — remove it unless `showLinkScreen` already uses the pair (it does after W3-B E2; check with `grep -n 'setButtonBusy' js/telegramSettings.js` and keep the import if any use remains).
- DELETE the entire `ensureUnlinkConfirmModal()` function, the `doUnlink()` function, and the `ensureUnlinkConfirmModal();` call inside `initTelegramSettings`.
- Replace the unlink button wiring (post-W1 it clears `#tg-unlink-error` and unhides the sheet) with:

```js
  accountSlot.querySelector('#tg-unlink-btn').addEventListener('click', async () => {
    // Confirm + round-trip in the shared modal (W3-A CL#4): busy label on the
    // confirm button, inline error + stay-open on failure — the behaviors the
    // bespoke sheet carried (W1 J#7), now without a second modal implementation
    // or a permanent document keydown listener.
    const ok = await showConfirmModal({
      title: 'Unlink this Telegram?',
      message: 'Your account stays yours — sign in with your secret phrase in any browser. This Telegram will start over with a fresh, empty account.',
      confirmLabel: 'Unlink',
      busyLabel: 'Unlinking…',
      onConfirm: async () => {
        try {
          await callUnlinkTelegram(tgWebApp().initData);
        } catch (e) {
          throw Object.assign(e instanceof Error ? e : new Error('unlink failed'), {
            userMessage: "Couldn't unlink right now. Try again.",
          });
        }
      },
    });
    if (ok) window.location.reload(); // reboot as a fresh derived account
  });
```

- [x] **Step 4: Implement `telegramChrome.js`**

In `resolveBackAction`, DELETE the line W1 Task 13 added (`js/telegramChrome.js:30` at `97482f0`):

```js
  if (visible(doc, 'tg-unlink-confirm')) return () => doc.getElementById('tg-unlink-cancel-btn')?.click();
```

(`#confirm-modal` stays first in the checklist and now covers unlink; the neighboring `unfollow-confirm`/`rotate-confirm` entries from `8c34d99` are untouched. Back during an in-flight unlink clicks a cancel that Task 5 made inert — correct.)

- [x] **Step 5: Run to verify pass**

Run: `npx jest tests/telegramSettings.test.js tests/telegramChrome.test.js tests/promptModal.test.js` — green.

- [x] **Step 6: Commit**

```bash
git add js/telegramSettings.js js/telegramChrome.js tests/telegramSettings.test.js tests/telegramChrome.test.js
git commit -m "refactor(web): unlink confirm rides showConfirmModal — bespoke sheet and its keydown listener deleted"
```

---

### Task 7: Whole-suite verification + docs

**Files:**
- Modify: `docs/HANDOFF.md` (top block + new rundown section), this plan's checkboxes

- [x] **Step 1: Run the full web suite**

Run: `npx jest` — all green (1446 baseline + this wave's additions). Fix any cross-suite fallout before proceeding (likely candidates: other fixtures embedding `#confirm-modal` markup without the error line — harmless since the code null-guards `errEl`, but verify).

- [x] **Step 2: Grep the scope fence**

`git diff <first-W3A-commit>^..HEAD --stat` — confirm only `js/`, `index.template.html`, `tests/`, `docs/` paths changed. `grep -rn "telegramLinkState()?.linked" js/` → no hits left. `grep -n "prefs?.telegram != null" js/notifyChannel.js` → exactly one hit, untouched.

- [x] **Step 3: Update HANDOFF.md**

Top block + new rundown section: W3-A implemented (list CL#1–CL#5), test counts, UNVERIFIED on-device — the operator's walkthrough (Telegram webview boot, plain-web first paint, unlink happy/failure paths, back-button over the shared modal) is the acceptance gate.

- [x] **Step 4: Commit**

```bash
git add docs/HANDOFF.md docs/superpowers/plans/2026-07-08-telegram-w3a-client-consolidation.md
git commit -m "docs(handoff): wave W3-A implemented — pending on-device verification"
```

---

## Self-Review (completed at authoring)

- **Spec coverage:** D1 → Task 1; D2 → Task 2; D3 → Task 3; D5 → Task 4; D4 → Tasks 5–6; spec Testing section → per-task steps + Task 7. No spec requirement without a task.
- **Placeholders:** none — every code step carries the actual code; the two mechanical mock sweeps in Task 3 Step 5 name the exact grep and the exact replacement mapping.
- **Type consistency:** `isTelegramLinked(): boolean` (T3) consumed by T6's tests; `buildTelegramShareUrl(url, text, { platform })` (T4) matches the T4 test stub and both callers; `showConfirmModal({ …, busyLabel, onConfirm })` (T5) consumed by T6 with matching fields; error element id `confirm-modal-error` consistent across T5 template/fixture/code and T6 fixture/tests.
- **W1 coupling:** T6 names its W1 Task 13/14 baselines and the pre-W1 fallback; T3 Step 5 covers W1 Task 7's test arranging.
