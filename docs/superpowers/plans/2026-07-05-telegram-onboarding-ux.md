# Telegram Onboarding & UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Telegram onramp (deep-link invites + first-run interstitial, bot `/start` funnel, guided empty state) and UX polish (unlink confirm + landings, drawer regroup, Telegram chrome), per the approved spec `docs/superpowers/specs/2026-07-05-telegram-onboarding-ux-design.md`.

**Architecture:** Approach B — dedicated modules with thin boot hooks, mirroring the §21 installGuidance/installAffordance pattern. New client modules: `js/inviteFlow.js` (invite link construction + share seam), `js/firstRun.js` (guided empty state + landing banners, web AND Telegram), `js/telegramFirstRun.js` (start_param invite gate + interstitial), `js/telegramChrome.js` (back button, swipes, closing confirmation, color re-sync), `js/recoveryModal.js` (recovery modal extracted from app.js, with graduation knobs). Server: `/start` branching in `functions/telegram.js`; synthetic Auth email at bootstrap in `functions/telegram-auth.js`. Graduation itself (`graduateTelegram`, the drawer button) is **NOT in this plan** — design-only per spec §7; only its enablers land (modal knobs, Account section layout).

**Tech Stack:** Vanilla JS ES modules (esbuild `define` for env), Firebase RTDB + Cloud Functions v2 (ESM), raw Telegram Bot API + `Telegram.WebApp` bridge, Jest (jsdom for web, node for functions).

## Global Constraints

- Branch: `claude/telegram-onboarding-ux-sk15hw`. Commit after every task. Do not merge to `dev`/`main`; do not create PRs.
- **No new npm dependencies** (client or functions).
- **No RTDB rules changes and no new RTDB nodes** anywhere in this plan (spec §8).
- `TELEGRAM_ENABLED` stays `true` on this branch. All Telegram client code no-ops outside Telegram; all server code stays inert without `TELEGRAM_BOT_TOKEN`.
- New client config: `TELEGRAM_APP_LINK` env var (root `.env.local` / `.env.production`), delivered to the bundle via esbuild `define` as `process.env.TELEGRAM_APP_LINK`, **empty string when unset** (never `REPLACE_ME`). Empty ⇒ graceful fallback to web URLs.
- Approved copy — use **verbatim**:
  - Interstitial link button: `I have a secret phrase`
  - Account-section graduation button (layout reserved only, NOT built): `I also want to use the app outside of Telegram`
  - Graduation modal intro (knob lands, unused this session): `To use the app outside Telegram you get a secret phrase — it opens this same account in any browser.`
  - Graduation modal warning (knob lands, unused this session): `Save this somewhere safe. It's how you sign in outside Telegram, and the only way to restore your account if you lose access to Telegram. We can't recover it for you.`
- Draft copy in tasks below is implement-as-written (the maintainer tunes wording later).
- Test commands: web `npx jest` (repo root), functions `cd functions && npm test`. Rules suite untouched.
- The `kk-landing` sessionStorage key is deliberately NOT account-scoped and NOT in `js/cacheOwner.js`'s wipe list (transient cross-account handoff — spec §5). Do not add it there.
- jsdom cannot verify layout; on-device checks are batched in the A9 checklist (Task 11).

---

### Task 1: `TELEGRAM_APP_LINK` config + `js/inviteFlow.js` + invite-modal share routing

**Files:**
- Modify: `scripts/build.js` (define block, ~line 36)
- Create: `js/inviteFlow.js`
- Modify: `js/inviteModal.js:168-175` (share button)
- Test: `tests/inviteFlow.test.js`

**Interfaces:**
- Produces: `buildTelegramInviteLink(token) → string|null` and `shareInviteLink(invite, text?) → void` (from `js/inviteFlow.js`) — consumed by Tasks 4, 7, and the invite modal.
- Consumes: `openTelegramShare(url, text)` from `js/telegram.js` (exists).

- [ ] **Step 1: Add the define entry**

In `scripts/build.js`, directly after the `FIREBASE_KEYS.forEach(...)` block:

```js
// Optional Mini App deep-link base, e.g. "https://t.me/knockknock_test_bot/app".
// Empty (not REPLACE_ME) when unset so client code can feature-detect it.
define['process.env.TELEGRAM_APP_LINK'] = JSON.stringify(env.TELEGRAM_APP_LINK || '');
```

(`scripts/dev-build.js` imports `define` from `build.js`, so it inherits this.)

- [ ] **Step 2: Write the failing tests**

Create `tests/inviteFlow.test.js`:

```js
/** @jest-environment jsdom */
const mockShare = jest.fn();
jest.mock('../js/telegram.js', () => ({
  isTelegramContext: jest.fn(() => true),
  openTelegramShare: (...a) => mockShare(...a),
}));

describe('inviteFlow', () => {
  beforeEach(() => { jest.resetModules(); mockShare.mockClear(); });

  test('buildTelegramInviteLink: configured → t.me deep link', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/kk_bot/app';
    const { buildTelegramInviteLink } = require('../js/inviteFlow.js');
    expect(buildTelegramInviteLink('AbC123def456ghi789jk22'))
      .toBe('https://t.me/kk_bot/app?startapp=AbC123def456ghi789jk22');
  });

  test('buildTelegramInviteLink: unconfigured or no token → null', () => {
    process.env.TELEGRAM_APP_LINK = '';
    const { buildTelegramInviteLink } = require('../js/inviteFlow.js');
    expect(buildTelegramInviteLink('AbC123def456ghi789jk22')).toBeNull();
    process.env.TELEGRAM_APP_LINK = 'https://t.me/kk_bot/app';
    jest.resetModules();
    const fresh = require('../js/inviteFlow.js');
    expect(fresh.buildTelegramInviteLink('')).toBeNull();
  });

  test('shareInviteLink: deep link when configured, web URL fallback when not', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/kk_bot/app';
    const { shareInviteLink } = require('../js/inviteFlow.js');
    shareInviteLink({ token: 'T'.repeat(22), url: 'https://app/?i=x' }, 'Join me');
    expect(mockShare).toHaveBeenCalledWith(`https://t.me/kk_bot/app?startapp=${'T'.repeat(22)}`, 'Join me');

    process.env.TELEGRAM_APP_LINK = '';
    jest.resetModules();
    const fresh = require('../js/inviteFlow.js');
    fresh.shareInviteLink({ token: 'T'.repeat(22), url: 'https://app/?i=x' });
    expect(mockShare).toHaveBeenLastCalledWith('https://app/?i=x', 'Follow me on KnockKnock');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest tests/inviteFlow.test.js`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `js/inviteFlow.js`**

```js
// js/inviteFlow.js — the single invite entry point (spec §4).
// Layer 1: link construction — pure, build-time-configured, works on web too
// (a future web "Share to Telegram" affordance costs one caller, spec §4).
// Layer 2: per-surface share presentation (TG share sheet; web keeps the modal).
import { openTelegramShare } from './telegram.js';

// esbuild `define` injects this; '' when the env var is unset (never REPLACE_ME).
const TELEGRAM_APP_LINK = process.env.TELEGRAM_APP_LINK || '';

// t.me Mini App deep link carrying the invite token as start_param.
// Null when unconfigured or tokenless — callers fall back to invite.url.
export function buildTelegramInviteLink(token) {
  if (!TELEGRAM_APP_LINK || !token) return null;
  return `${TELEGRAM_APP_LINK}?startapp=${token}`;
}

// Open Telegram's share sheet for an invite, preferring the Mini App deep link.
export function shareInviteLink(invite, text = 'Follow me on KnockKnock') {
  const url = buildTelegramInviteLink(invite.token) || invite.url;
  openTelegramShare(url, text);
}
```

- [ ] **Step 5: Route the invite modal's Share button through it**

In `js/inviteModal.js` replace the import of `openTelegramShare` with:

```js
import { isTelegramContext } from './telegram.js';
import { shareInviteLink } from './inviteFlow.js';
```

and the share handler body (line ~173) with:

```js
    on(shareBtn, 'click', () => {
      if (!currentInvite) return;
      const text = scope === 'group' ? `Join ${groupName} on KnockKnock` : 'Follow me on KnockKnock';
      shareInviteLink(currentInvite, text);
    });
```

- [ ] **Step 6: Run tests**

Run: `npx jest tests/inviteFlow.test.js tests/invites.test.js`
Expected: PASS. Then `npx jest` — full suite green.

- [ ] **Step 7: Commit**

```bash
git add scripts/build.js js/inviteFlow.js js/inviteModal.js tests/inviteFlow.test.js
git commit -m "feat(telegram): inviteFlow — t.me deep-link construction + share seam"
```

---

### Task 2: Bot `/start` — stranger funnel vs returning status

**Files:**
- Modify: `functions/telegram.js:77-89`
- Test: `functions/test/telegram.test.js`

**Interfaces:**
- Consumes: `ensureTelegramUser`, `isFutureMs`, `openAppKeyboard`, `HELP_TEXT` (all exist in/imported by `functions/telegram.js`).
- Produces: no new exports — behavior change only.

- [ ] **Step 1: Write the failing tests**

In `functions/test/telegram.test.js` (uses the existing `makeBotDeps`/`msgUpdate`/`seedUser` helpers) add:

```js
describe('/start first contact vs returning', () => {
  test('stranger: funnel message, no command list, Open button', async () => {
    const deps = makeBotDeps({});
    await handleUpdate(deps, msgUpdate('/start'));
    const [, text, extra] = deps.tg.sendMessage.mock.calls[0];
    expect(text).toMatch(/^Welcome to KnockKnock — see when the people who matter are free/);
    expect(text).toContain('Everything starts in the app');
    expect(text).toContain('/help shows how');
    expect(text).not.toContain('/who');       // no command dump
    expect(text).not.toContain('/status [');
    expect(extra.reply_markup.inline_keyboard[0][0].web_app.url).toBe(deps.appUrl);
  });

  test('returning + available: compact status reply with remaining time', async () => {
    const deps = makeBotDeps({});
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/presence`] = { code: 'AAAAAA', status: 'available', availableUntil: deps.now() + 30 * 60000 };
    await handleUpdate(deps, msgUpdate('/start'));
    const [, text] = deps.tg.sendMessage.mock.calls[0];
    expect(text).toBe("You're available for another 30m. /off to stop.");
  });

  test('returning + unavailable: compact status reply', async () => {
    const deps = makeBotDeps({});
    seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/start'));
    const [, text] = deps.tg.sendMessage.mock.calls[0];
    expect(text).toBe("You're unavailable right now. /status to go available.");
  });

  test('stranger /start still bootstraps mapping + chat route', async () => {
    const deps = makeBotDeps({});
    await handleUpdate(deps, msgUpdate('/start'));
    expect(deps.store['telegramUsers/42']).toBeTruthy();
    expect(deps.store['telegramUsers/42/chatId']).toBe('42');
  });
});
```

Also update any existing `/start` test asserting the old command-dump message to expect the new stranger copy.

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm test -- telegram.test.js`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement the branch**

Replace the `/start` block in `functions/telegram.js` (lines 77-89) with:

```js
  if (cmd === '/start') {
    // First-contact detection must precede ensureTelegramUser (which creates
    // the mapping). ensure stays: idempotent, and bot commands need the
    // account to exist even before the Mini App is ever opened.
    const known = !!(await deps.getVal(`telegramUsers/${String(msg.from.id)}`));
    const { uid } = await ensureTelegramUser(deps, msg.from);
    // Keep the chat route current (first /start after a Mini-App-only signup,
    // or Telegram reassigning chat ids) — sendToUser reads telegramByUid.
    await deps.update(`telegramUsers/${String(msg.from.id)}`, { chatId });
    await deps.update(`telegramByUid/${uid}`, { chatId });
    if (!known) {
      // Stranger: funnel, no command list (spec §2). /help keeps the full list.
      await reply(
        'Welcome to KnockKnock — see when the people who matter are free, and let them know when you are.\n\n'
        + 'Everything starts in the app — tap below.\n\n'
        + "Once you're set up, you can also knock and set your status right from this chat — /help shows how.",
        openAppKeyboard(deps.appUrl),
      );
      return;
    }
    // Returning: compact live status, duration-based (no server-side timezone).
    const presence = await deps.getVal(`users/${uid}/presence`);
    const on = presence?.status === 'available' && isFutureMs(presence.availableUntil, deps.now());
    if (on) {
      const mins = Math.max(1, Math.round((presence.availableUntil - deps.now()) / 60000));
      const dur = mins >= 60 ? `${Math.round((mins / 60) * 10) / 10}h` : `${mins}m`;
      await reply(`You're available for another ${dur}. /off to stop.`, openAppKeyboard(deps.appUrl));
    } else {
      await reply("You're unavailable right now. /status to go available.", openAppKeyboard(deps.appUrl));
    }
    return;
  }
```

(If `isFutureMs` is file-local further down, no import needed; it is already used at line 164.)

- [ ] **Step 4: Run tests**

Run: `cd functions && npm test`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "feat(telegram-bot): /start funnels strangers, compact status for returning users"
```

---

### Task 3: Synthetic Auth email at derived-account bootstrap

**Files:**
- Modify: `functions/telegram-auth.js:65-87` (`ensureTelegramUser`)
- Modify: `functions/index.js` (deps wiring for `validateTelegram` and the webhook bot deps)
- Test: `functions/test/telegram-auth.test.js`

**Interfaces:**
- Produces: new **optional** dep `setAuthEmail(uid, email) → Promise` on the telegram deps object. Handlers must work when it is absent (`deps.setAuthEmail?.`).

- [ ] **Step 1: Write the failing tests**

In `functions/test/telegram-auth.test.js`, in the `ensureTelegramUser` describe block (reuse its existing deps factory; add `setAuthEmail: jest.fn(async () => {})` to it):

```js
  test('first bootstrap stamps the anonymous synthetic Auth email', async () => {
    const deps = makeDeps({});
    deps.setAuthEmail = jest.fn(async () => {});
    const { uid } = await ensureTelegramUser(deps, { id: 42 });
    expect(deps.setAuthEmail).toHaveBeenCalledTimes(1);
    expect(deps.setAuthEmail).toHaveBeenCalledWith(uid, `tg-${uid}@telegram.invalid`);
  });

  test('existing mapping → no email stamp', async () => {
    const deps = makeDeps({});
    deps.setAuthEmail = jest.fn(async () => {});
    deps.store['telegramUsers/42'] = { uid: 'u-existing', chatId: '42' };
    deps.store['users/u-existing/presence'] = { code: 'AAAAAA', status: 'unavailable', availableUntil: null };
    await ensureTelegramUser(deps, { id: 42 });
    expect(deps.setAuthEmail).not.toHaveBeenCalled();
  });

  test('email stamp failure is non-fatal', async () => {
    const deps = makeDeps({});
    deps.setAuthEmail = jest.fn(async () => { throw new Error('auth down'); });
    const { uid, created } = await ensureTelegramUser(deps, { id: 42 });
    expect(uid).toBeTruthy();
    expect(created).toBe(true);
  });

  test('setAuthEmail absent → bootstrap still works', async () => {
    const deps = makeDeps({});
    delete deps.setAuthEmail;
    const { created } = await ensureTelegramUser(deps, { id: 42 });
    expect(created).toBe(true);
  });
```

Also (spec §8 "stays pinned"): if no existing test asserts that `unlinkTelegramHandler` writes `{ telegram: null, notifyChannel: 'push' }` to the prior linked account's `userPrefs` (`functions/telegram-auth.js:223`), add one to the unlink describe block — it pins already-shipped behavior, so it passes immediately.

(Adapt `makeDeps` to whatever the file's existing deps factory is named; the store/`getVal`/`set`/`update`/`transaction` shape matches `makeBotDeps` in `telegram.test.js`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm test -- telegram-auth.test.js`
Expected: FAIL (email never stamped).

- [ ] **Step 3: Implement**

In `ensureTelegramUser` (`functions/telegram-auth.js`), inside the `if (!mapping)` branch, after the `userPrefs` update:

```js
    // Console differentiation (spec §8): stamp the Auth record with an
    // ANONYMOUS synthetic email — derived from the app uid only, never the
    // Telegram handle or numeric id (zero new information in Auth records).
    // Non-fatal: a console nicety must never break account bootstrap.
    try {
      await deps.setAuthEmail?.(derivedUid, `tg-${derivedUid}@telegram.invalid`);
    } catch (e) {
      console.error('[telegram] setAuthEmail failed (non-fatal):', e);
    }
```

- [ ] **Step 4: Wire the real dep in `functions/index.js`**

Locate the deps objects passed to `validateTelegram`/`linkTelegram`/`unlinkTelegram` handlers and to `handleUpdate` (webhook). Both call `ensureTelegramUser` paths, so add to the shared telegram deps:

```js
  // Create-or-update: the Auth record doesn't exist until the client's first
  // signInWithCustomToken, so pre-create it; later re-bootstraps hit update.
  setAuthEmail: async (uid, email) => {
    const auth = getAuth();
    try {
      await auth.updateUser(uid, { email });
    } catch (e) {
      if (e?.code === 'auth/user-not-found') await auth.createUser({ uid, email });
      else throw e;
    }
  },
```

Use the same `getAuth` import `functions/index.js` already uses for `createCustomToken` (`firebase-admin/auth`).

- [ ] **Step 5: Run tests**

Run: `cd functions && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/telegram-auth.js functions/index.js functions/test/telegram-auth.test.js
git commit -m "feat(telegram): anonymous synthetic Auth email at derived-account bootstrap"
```

---

### Task 4: `js/firstRun.js` — guided empty state

**Files:**
- Create: `js/firstRun.js`
- Modify: `index.template.html:239` (replace `#empty-list-msg`)
- Modify: `js/following.js:391-410` (signal instead of owning the message)
- Modify: `js/mycode.js` (export `openPersonalInviteModal`)
- Modify: `js/app.js` (boot hook)
- Modify: `css/app.css` (panel + demotion styles)
- Test: `tests/firstRun.test.js`; update `tests/following.test.js`

**Interfaces:**
- Produces (from `js/firstRun.js`):
  - `initFirstRun({ onInvite, onLink })` — boot hook (no userId needed; actions close over it at the call site)
  - `setListEmpty(isEmpty: boolean)` — called by `following.js`
  - `isFirstRunActive() → boolean` — consumed by Task 6
  - `first-run-change` CustomEvent on `document` on every state flip — consumed by Task 6
- Produces (from `js/mycode.js`): `openPersonalInviteModal() → Promise<void>` — consumed here and by Task 7.
- Consumes: `isTelegramContext`, `telegramLinkState` from `js/telegram.js`; `showLinkScreen` from `js/telegramSettings.js` (exported in Task 5 — until then `onLink` is only wired for TG in Task 5's step; pass `onLink: null` from app.js in this task).

- [ ] **Step 1: Replace the empty-message markup**

In `index.template.html`, replace `<p id="empty-list-msg" class="hidden"></p>` with:

```html
      <div id="first-run-panel" class="first-run-panel hidden">
        <p class="first-run-lede">KnockKnock shows your people when you're free — and shows you when they are.</p>
        <p class="first-run-sub">No one's here yet.</p>
        <button id="first-run-invite-btn" class="primary-btn">Invite your people</button>
        <p id="first-run-link-line" class="hint hidden">Already use KnockKnock?
          <button id="first-run-link-btn" class="ghost-btn" type="button">Link your account</button></p>
      </div>
```

- [ ] **Step 2: Write the failing tests**

Create `tests/firstRun.test.js`:

```js
/** @jest-environment jsdom */
const mockTelegram = { isTelegramContext: jest.fn(() => false), telegramLinkState: jest.fn(() => null) };
jest.mock('../js/telegram.js', () => mockTelegram);

const FIXTURE = `
  <main id="main-list">
    <ul id="people-list"></ul>
    <div id="first-run-panel" class="first-run-panel hidden">
      <p class="first-run-lede">KnockKnock shows your people when you're free — and shows you when they are.</p>
      <p class="first-run-sub">No one's here yet.</p>
      <button id="first-run-invite-btn" class="primary-btn">Invite your people</button>
      <p id="first-run-link-line" class="hint hidden">Already use KnockKnock?
        <button id="first-run-link-btn" class="ghost-btn" type="button">Link your account</button></p>
    </div>
    <div id="add-person-area"><button id="add-person-btn" class="add-btn">Add a person</button></div>
  </main>`;

let firstRun;
beforeEach(() => {
  jest.resetModules();
  document.body.innerHTML = FIXTURE;
  mockTelegram.isTelegramContext.mockReturnValue(false);
  mockTelegram.telegramLinkState.mockReturnValue(null);
  firstRun = require('../js/firstRun.js');
});

test('setListEmpty(true): panel shows, add button demotes to "Add by code"', () => {
  firstRun.setListEmpty(true);
  expect(document.getElementById('first-run-panel').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('add-person-area').classList.contains('first-run-demoted')).toBe(true);
  expect(document.getElementById('add-person-btn').textContent).toBe('Add by code');
  expect(firstRun.isFirstRunActive()).toBe(true);
});

test('setListEmpty(false): panel hides, add button reverts', () => {
  firstRun.setListEmpty(true);
  firstRun.setListEmpty(false);
  expect(document.getElementById('first-run-panel').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('add-person-area').classList.contains('first-run-demoted')).toBe(false);
  expect(document.getElementById('add-person-btn').textContent).toBe('Add a person');
  expect(firstRun.isFirstRunActive()).toBe(false);
});

test('link line: only in TG when unlinked', () => {
  firstRun.setListEmpty(true);
  expect(document.getElementById('first-run-link-line').classList.contains('hidden')).toBe(true); // web
  mockTelegram.isTelegramContext.mockReturnValue(true);
  mockTelegram.telegramLinkState.mockReturnValue({ linked: false });
  firstRun.setListEmpty(true);
  expect(document.getElementById('first-run-link-line').classList.contains('hidden')).toBe(false);
  mockTelegram.telegramLinkState.mockReturnValue({ linked: true });
  firstRun.setListEmpty(true);
  expect(document.getElementById('first-run-link-line').classList.contains('hidden')).toBe(true);
});

test('every flip dispatches first-run-change', () => {
  const seen = jest.fn();
  document.addEventListener('first-run-change', seen);
  firstRun.setListEmpty(true);
  firstRun.setListEmpty(false);
  expect(seen).toHaveBeenCalledTimes(2);
});

test('initFirstRun wires the invite and link buttons', () => {
  const onInvite = jest.fn(); const onLink = jest.fn();
  firstRun.initFirstRun({ userId: 'u1', onInvite, onLink });
  document.getElementById('first-run-invite-btn').click();
  expect(onInvite).toHaveBeenCalled();
  document.getElementById('first-run-link-btn').click();
  expect(onLink).toHaveBeenCalled();
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest tests/firstRun.test.js`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `js/firstRun.js`**

```js
// js/firstRun.js — surface-agnostic first-run affordances (spec §3, §5).
// Owns the guided-empty-state DOM (following.js only signals emptiness) and
// the one-time landing banners. Used by web AND Telegram.
import { isTelegramContext, telegramLinkState } from './telegram.js';

let _active = false;
let _onInvite = null;
let _onLink = null;

export function initFirstRun({ onInvite, onLink = null } = {}) {
  _onInvite = onInvite;
  _onLink = onLink;
  document.getElementById('first-run-invite-btn')
    ?.addEventListener('click', () => _onInvite?.());
  document.getElementById('first-run-link-btn')
    ?.addEventListener('click', () => _onLink?.());
}

// True while the guided empty state is mounted. installAffordance defers its
// toast on this (one teaching surface at a time — spec §3).
export function isFirstRunActive() {
  return _active;
}

// Called by following.js's renderList isEmpty branch. Idempotent per state.
export function setListEmpty(isEmpty) {
  const panel = document.getElementById('first-run-panel');
  if (!panel) return;
  _active = !!isEmpty;
  panel.classList.toggle('hidden', !isEmpty);
  // Demote the code-entry form to the secondary role while the panel shows —
  // presentation only: same element, ids, and behavior (spec §3).
  document.getElementById('add-person-area')?.classList.toggle('first-run-demoted', !!isEmpty);
  const addBtn = document.getElementById('add-person-btn');
  if (addBtn) addBtn.textContent = isEmpty ? 'Add by code' : 'Add a person';
  // "Link your account" only where linking is possible and not already done.
  const linkLine = document.getElementById('first-run-link-line');
  if (linkLine) {
    const show = !!isEmpty && isTelegramContext() && telegramLinkState()?.linked !== true;
    linkLine.classList.toggle('hidden', !show);
  }
  document.dispatchEvent(new CustomEvent('first-run-change'));
}
```

- [ ] **Step 5: Signal from `following.js`**

In `js/following.js`:
- Add import: `import { setListEmpty } from './firstRun.js';`
- In `renderList`'s empty branch (lines 391-410): delete the two `emptyMsg` lines and the `const emptyMsg` lookup; after `list.style.display = 'none';` add `setListEmpty(true);` and in the non-empty path replace `emptyMsg.classList.add('hidden');` with `setListEmpty(false);`.

- [ ] **Step 6: Export `openPersonalInviteModal` from `js/mycode.js`**

In `js/mycode.js`, find the existing `#invite-link-btn` click handler (it calls `openInviteModal({ scope: 'personal', userId: _myUserId, activeInvite: ... })` using the module's watched invite state). Extract its body into:

```js
export async function openPersonalInviteModal() {
  // ...exact body of the current #invite-link-btn click handler...
}
```

and have the `#invite-link-btn` listener call `openPersonalInviteModal()`. No behavior change.

- [ ] **Step 7: Boot hook in `js/app.js`**

Next to the existing `if (isTelegramContext()) initTelegramSettings(userId);` (line ~807) add:

```js
  initFirstRun({ onInvite: () => openPersonalInviteModal() });
```

with imports `import { initFirstRun } from './firstRun.js';` and `import { openPersonalInviteModal } from './mycode.js';` (mycode is already imported for `initCodeDrawer` — extend that import). `onLink` is wired in Task 5.

- [ ] **Step 8: CSS**

In `css/app.css` (near the `#add-person-area` rules):

```css
/* Guided empty state (firstRun.js owns this DOM) */
.first-run-panel { text-align: center; padding: 2rem 1rem 1rem; }
.first-run-lede { color: var(--text); margin-bottom: .25rem; }
.first-run-sub { color: var(--text-dim, #888); margin-bottom: 1rem; }
.first-run-panel .hint { margin-top: .75rem; }
/* Demoted code-entry while the panel is up: quieter, reads as secondary. */
#add-person-area.first-run-demoted .add-btn { opacity: .7; font-size: .9em; }
```

(Match existing variable names in `css/app.css` — if `--text-dim` doesn't exist, use the file's muted-text variable.)

- [ ] **Step 9: Update `tests/following.test.js`**

- Add at top: `jest.mock('../js/firstRun.js', () => ({ setListEmpty: jest.fn() }));`
- In its DOM fixture, replace the `<p id="empty-list-msg">...` line with `<div id="first-run-panel" class="hidden"></div>`.
- Rewrite the two empty-state tests: "all groups empty" now asserts `require('../js/firstRun.js').setListEmpty` was last called with `true` (and `#people-list` hidden); "non-empty list" asserts last call `false`.

- [ ] **Step 10: Run tests**

Run: `npx jest tests/firstRun.test.js tests/following.test.js && npx jest`
Expected: PASS; full suite green (app-boot suites that import app.js may need `jest.mock('../js/firstRun.js', ...)` added to their module mocks — pattern-match `tests/app-boot-cacheOwner.test.js`).

- [ ] **Step 11: Commit**

```bash
git add index.template.html js/firstRun.js js/following.js js/mycode.js js/app.js css/app.css tests/firstRun.test.js tests/following.test.js
git commit -m "feat(onboarding): guided empty state owned by firstRun.js (web + Telegram)"
```

---

### Task 5: Landing banners + unlink confirmation

**Files:**
- Modify: `js/firstRun.js` (landing API)
- Modify: `js/telegramSettings.js` (export `showLinkScreen`; unlink confirm; landing stamps)
- Modify: `js/app.js` (show notice at boot; wire `onLink`)
- Modify: `css/app.css` (banner + danger button)
- Test: `tests/firstRun.test.js`, `tests/telegramSettings.test.js`

**Interfaces:**
- Produces (from `js/firstRun.js`): `stampLanding(kind: 'linked'|'unlinked'|'graduated')`, `showLandingNotice()`.
- Produces (from `js/telegramSettings.js`): named export `showLinkScreen()` (was file-internal) — consumed by app.js `onLink` and Task 9.

- [ ] **Step 1: Write the failing tests**

Append to `tests/firstRun.test.js`:

```js
describe('landing notices', () => {
  test('stampLanding + showLandingNotice renders once and clears the key', () => {
    firstRun.stampLanding('unlinked');
    firstRun.showLandingNotice();
    const notice = document.getElementById('landing-notice');
    expect(notice.textContent).toContain('Telegram unlinked');
    expect(sessionStorage.getItem('kk-landing')).toBeNull();
    firstRun.showLandingNotice(); // second boot: nothing
    expect(document.querySelectorAll('.landing-notice').length).toBe(1);
  });

  test('dismiss removes the banner', () => {
    firstRun.stampLanding('linked');
    firstRun.showLandingNotice();
    document.getElementById('landing-notice-dismiss').click();
    expect(document.getElementById('landing-notice')).toBeNull();
  });

  test('no key → no banner; unknown kind → no banner', () => {
    firstRun.showLandingNotice();
    expect(document.getElementById('landing-notice')).toBeNull();
    sessionStorage.setItem('kk-landing', 'bogus');
    firstRun.showLandingNotice();
    expect(document.getElementById('landing-notice')).toBeNull();
  });
});
```

In `tests/telegramSettings.test.js` (reuse its existing DOM fixture + reload stub pattern) add:

```js
  test('unlink: first tap expands confirm, does not call unlinkTelegram', async () => {
    // mount as the existing tests do…
    document.getElementById('tg-unlink-btn').click();
    expect(document.getElementById('tg-unlink-confirm').classList.contains('hidden')).toBe(false);
    expect(mockCallUnlinkTelegram).not.toHaveBeenCalled();
  });

  test('unlink: cancel collapses confirm', async () => {
    document.getElementById('tg-unlink-btn').click();
    document.getElementById('tg-unlink-cancel-btn').click();
    expect(document.getElementById('tg-unlink-confirm').classList.contains('hidden')).toBe(true);
  });

  test('unlink: confirm stamps kk-landing and calls unlinkTelegram', async () => {
    document.getElementById('tg-unlink-btn').click();
    document.getElementById('tg-unlink-confirm-btn').click();
    await Promise.resolve(); await Promise.resolve();
    expect(mockCallUnlinkTelegram).toHaveBeenCalled();
    expect(sessionStorage.getItem('kk-landing')).toBe('unlinked');
  });

  test('link success stamps kk-landing=linked before reload', async () => {
    // drive showLinkScreen's submit exactly as the existing link test does,
    // then: expect(sessionStorage.getItem('kk-landing')).toBe('linked');
  });
```

(Adapt mock names to the file's existing `callUnlinkTelegram`/`callLinkTelegram` mocks.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/firstRun.test.js tests/telegramSettings.test.js`
Expected: FAIL.

- [ ] **Step 3: Landing API in `js/firstRun.js`**

Append:

```js
// ── One-time landing banners (spec §5) ──────────────────────────────────────
// The marker survives the link/unlink location.reload() in sessionStorage.
// DELIBERATELY not account-scoped and NOT in cacheOwner's wipe list: it is a
// transient cross-account handoff. If the webview drops sessionStorage across
// the reload, the banner silently doesn't show (accepted degradation).
const LANDING_KEY = 'kk-landing';
const LANDING_COPY = {
  linked: 'Linked — this Telegram now opens your KnockKnock account.',
  unlinked: 'Telegram unlinked. Your account is still yours — sign in with your secret phrase in a browser. This is a fresh Telegram-only account.',
  graduated: 'This account now works in any browser too.',
};

export function stampLanding(kind) {
  try { sessionStorage.setItem(LANDING_KEY, kind); } catch { /* storage denied */ }
}

export function showLandingNotice() {
  let kind = null;
  try {
    kind = sessionStorage.getItem(LANDING_KEY);
    sessionStorage.removeItem(LANDING_KEY);
  } catch { return; }
  const text = LANDING_COPY[kind];
  if (!text) return;
  const main = document.getElementById('main-list');
  if (!main || document.getElementById('landing-notice')) return;
  const el = document.createElement('div');
  el.id = 'landing-notice';
  el.className = 'landing-notice';
  const span = document.createElement('span');
  span.textContent = text;
  const btn = document.createElement('button');
  btn.id = 'landing-notice-dismiss';
  btn.className = 'ghost-btn';
  btn.type = 'button';
  btn.textContent = 'OK';
  btn.addEventListener('click', () => el.remove());
  el.append(span, btn);
  main.insertBefore(el, main.firstChild); // above the guided empty state
}
```

- [ ] **Step 4: `js/telegramSettings.js` — confirm block, stamps, export**

- Change `function showLinkScreen()` to `export function showLinkScreen()`.
- In `showLinkScreen`'s `onSubmit`, before `window.location.reload()`: `stampLanding('linked');` (import from `./firstRun.js`).
- Replace the instant unlink handler (lines 32-40) with an expanding confirm. In the `row.innerHTML` template, after the buttons div, add:

```html
    <div id="tg-unlink-confirm" class="hidden">
      <p class="hint">Your account stays yours — sign in with your secret phrase in any browser. This Telegram will start over with a fresh, empty account.</p>
      <div class="tg-settings-btns">
        <button id="tg-unlink-confirm-btn" class="danger-btn" type="button">Unlink</button>
        <button id="tg-unlink-cancel-btn" class="ghost-btn" type="button">Cancel</button>
      </div>
    </div>
```

and the handlers:

```js
  row.querySelector('#tg-unlink-btn').addEventListener('click', () => {
    row.querySelector('#tg-unlink-confirm').classList.remove('hidden');
  });
  row.querySelector('#tg-unlink-cancel-btn').addEventListener('click', () => {
    row.querySelector('#tg-unlink-confirm').classList.add('hidden');
  });
  row.querySelector('#tg-unlink-confirm-btn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await callUnlinkTelegram(tgWebApp().initData);
      stampLanding('unlinked');
      window.location.reload(); // reboot as a fresh derived account
    } catch {
      e.target.disabled = false;
    }
  });
```

- [ ] **Step 5: Boot + onLink wiring in `js/app.js`**

- Extend the Task 4 hook: `initFirstRun({ onInvite: () => openPersonalInviteModal(), onLink: isTelegramContext() ? showLinkScreen : null });` (import `showLinkScreen` from `./telegramSettings.js`).
- Immediately after that line add `showLandingNotice();` (import from `./firstRun.js`).

- [ ] **Step 6: CSS**

```css
.landing-notice { display: flex; gap: .75rem; align-items: center; justify-content: space-between; padding: .75rem 1rem; margin: .5rem 0; border-radius: 8px; background: color-mix(in srgb, var(--accent) 12%, transparent); }
.danger-btn { background: #b3392f; color: #fff; border: none; border-radius: 6px; padding: .4rem .9rem; }
```

(If `color-mix` clashes with the file's conventions, use the pattern the offline-banner uses.)

- [ ] **Step 7: Run tests**

Run: `npx jest tests/firstRun.test.js tests/telegramSettings.test.js && npx jest`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add js/firstRun.js js/telegramSettings.js js/app.js css/app.css tests/firstRun.test.js tests/telegramSettings.test.js
git commit -m "feat(telegram): unlink confirmation + one-time link/unlink landing banners"
```

---

### Task 6: Install-toast deferral while the empty state shows

**Files:**
- Modify: `js/installAffordance.js`
- Test: `tests/installAffordance.test.js`

**Interfaces:**
- Consumes: `isFirstRunActive()` + the `first-run-change` document event (Task 4).

- [ ] **Step 1: Write the failing tests**

In `tests/installAffordance.test.js` add a mock at top (alongside its existing mocks): `jest.mock('../js/firstRun.js', () => ({ isFirstRunActive: jest.fn(() => false) }));` then:

```js
  test('toast defers to the corner icon while first-run is active (not dismissed)', () => {
    const { isFirstRunActive } = require('../js/firstRun.js');
    isFirstRunActive.mockReturnValue(true);
    // arrange an installable lane exactly as the existing installable-lane test does
    initInstallAffordance();
    expect(document.getElementById('install-toast').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('install-fab').classList.contains('hidden')).toBe(false);
  });

  test('first-run-change re-applies: toast resumes when the empty state clears', () => {
    const { isFirstRunActive } = require('../js/firstRun.js');
    isFirstRunActive.mockReturnValue(true);
    initInstallAffordance();
    isFirstRunActive.mockReturnValue(false);
    document.dispatchEvent(new CustomEvent('first-run-change'));
    expect(document.getElementById('install-toast').classList.contains('hidden')).toBe(false);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/installAffordance.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `js/installAffordance.js`:
- Import: `import { isFirstRunActive } from './firstRun.js';`
- In `apply()`, change the dismissed branch condition to defer (not cancel) during first-run:

```js
    if (dismissed || isFirstRunActive()) {
      // First-run defers the toast without consuming the lead-in: one teaching
      // surface at a time (spec §3). The quiet corner icon stays available.
      toast.classList.add('hidden');
      fab.classList.remove('hidden');
    } else {
```

- At the end of `initInstallAffordance()` (next to `onInstallPromptChange(apply)`): `document.addEventListener('first-run-change', apply);`

- [ ] **Step 4: Run tests**

Run: `npx jest tests/installAffordance.test.js && npx jest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/installAffordance.js tests/installAffordance.test.js
git commit -m "feat(onboarding): defer install toast while the guided empty state is up"
```

---

### Task 7: Drawer regroup — Invite / Account / Notifications

**Files:**
- Modify: `index.template.html:209-227` (drawer sections; pill row stays put)
- Modify: `js/telegramSettings.js` (mount into section slots)
- Modify: `js/mycode.js` (wire `#drawer-invite-btn`; drop `#invite-link-btn`)
- Modify: `css/app.css` (section labels)
- Test: `tests/telegramSettings.test.js` (+ any suite referencing `#invite-link-btn`)

**Interfaces:**
- Consumes: `openPersonalInviteModal` (Task 4).
- Produces: stable slot ids `#tg-account-slot`, `#tg-notify-slot`, `#drawer-section-account`, `#drawer-section-notifications` — the graduation follow-on mounts into `#tg-account-slot`.

**Fidelity note:** `#recovery-pill-row` does NOT move (it sits outside `#code-drawer` today; spec §4 "web: unchanged" is honored by leaving its placement byte-identical). The Account section carries TG content only this session.

- [ ] **Step 1: Restructure the drawer markup**

Replace `#code-drawer`'s inner markup (lines 209-220) with:

```html
      <div id="code-drawer">
        <div class="drawer-inner">
          <div class="drawer-section" id="drawer-section-invite">
            <p class="drawer-section-label">Invite</p>
            <button id="drawer-invite-btn" class="primary-btn" type="button">Invite your people</button>
            <div class="code-row">
              <span id="my-code-display" class="code-display"></span>
              <button id="rotate-code-btn" class="rotate-btn" title="Generate new code">↻</button>
              <button id="copy-code-btn" class="ghost-btn">Copy</button>
            </div>
            <p id="rotate-error-msg" class="error-msg hidden"></p>
            <p class="hint">Or share this code so others can follow your status.</p>
          </div>
          <div class="drawer-section hidden" id="drawer-section-account">
            <p class="drawer-section-label">Account</p>
            <div id="tg-account-slot"></div>
          </div>
          <div class="drawer-section hidden" id="drawer-section-notifications">
            <p class="drawer-section-label">Notifications</p>
            <div id="tg-notify-slot"></div>
          </div>
        </div>
      </div>
```

Note: `#invite-link-btn` ("Create invite link") is removed — `#drawer-invite-btn` replaces it as the section's primary action.

- [ ] **Step 2: Update the failing tests**

In `tests/telegramSettings.test.js`: update the fixture to the new drawer markup; assert `initTelegramSettings` (a) unhides `#drawer-section-account` and `#drawer-section-notifications`, (b) renders link state + buttons inside `#tg-account-slot`, (c) renders the channel chip inside `#tg-notify-slot`. Grep for `invite-link-btn` across `tests/` and update any fixture/assertion to `drawer-invite-btn`.

Run: `npx jest tests/telegramSettings.test.js` — expected: FAIL.

- [ ] **Step 3: `js/telegramSettings.js` mounts into slots**

In `initTelegramSettings`, replace the `drawer.appendChild(row)` flow: build the account row (link-state `<p>`, link btn, unlink btn + confirm block from Task 5) and append it to `#tg-account-slot`; build the channel chip and append to `#tg-notify-slot`; remove `.hidden` from both `#drawer-section-account` and `#drawer-section-notifications`. Keep all element ids unchanged (`#tg-link-state`, `#tg-link-btn`, `#tg-unlink-btn`, `#tg-channel-btn`, `#tg-unlink-confirm`, …) so Task 5's handlers/tests carry over verbatim. `document.getElementById('recovery-pill-row')?.classList.add('hidden')` stays.

- [ ] **Step 4: Wire `#drawer-invite-btn` in `js/mycode.js`**

In `initCodeDrawer`, replace the old `#invite-link-btn` listener registration with:

```js
  document.getElementById('drawer-invite-btn')?.addEventListener('click', () => openPersonalInviteModal());
```

- [ ] **Step 5: CSS**

```css
.drawer-section { padding: .5rem 0; }
.drawer-section + .drawer-section { border-top: 1px solid var(--border, rgba(128,128,128,.25)); }
.drawer-section-label { font-size: .75em; text-transform: uppercase; letter-spacing: .06em; color: var(--text-dim, #888); margin: 0 0 .4rem; }
#drawer-invite-btn { margin-bottom: .6rem; }
```

- [ ] **Step 6: Run tests**

Run: `npx jest`
Expected: PASS (fix any suite whose fixture still carries `#invite-link-btn`).

- [ ] **Step 7: Commit**

```bash
git add index.template.html js/telegramSettings.js js/mycode.js css/app.css tests/
git commit -m "feat(drawer): regroup into Invite / Account / Notifications sections"
```

---

### Task 8: Extract the recovery modal with graduation knobs

**Files:**
- Create: `js/recoveryModal.js`
- Modify: `js/app.js` (remove local `showRecoveryCodeModal`, import instead)
- Modify: `js/utils.js` (move `setButtonBusy`/`clearButtonBusy` here, exported)
- Modify: `index.template.html:134-154` (intro `<p>`, warning id, cancel button)
- Test: `tests/recoveryModal.test.js`

**Interfaces:**
- Produces: `showRecoveryCodeModal(initialCode, onConfirm, { intro = null, warning = null, cancellable = false } = {}) → Promise<string|null>` from `js/recoveryModal.js` (resolves the confirmed phrase; `null` on cancel). Also `setButtonBusy`/`clearButtonBusy` exported from `js/utils.js`.
- Consumers: `js/app.js` `createNewAccount` (unchanged call `showRecoveryCodeModal(initial, onConfirm)` — defaults render byte-identical); the graduation follow-on passes all three knobs.

- [ ] **Step 1: Markup knobs**

In `#recovery-modal` (`index.template.html`):
- After `<h3>This is your secret phrase</h3>` add: `<p id="recovery-modal-intro" class="modal-subtitle hidden"></p>`
- Give the warning an id: `<p id="recovery-modal-warning" class="recovery-warning">Save this somewhere safe. It's the only way to restore your account if you lose this browser. We can't recover it for you.</p>`
- After the keychain `<form>` add: `<button id="recovery-cancel-btn" class="ghost-btn hidden" type="button">Cancel</button>`

- [ ] **Step 2: Write the failing tests**

Create `tests/recoveryModal.test.js` (fixture = the exact `#recovery-modal` markup from Step 1; mock `../js/regenFlash.js` and `../js/identity.js`'s `generateRecoveryCode`):

```js
/** @jest-environment jsdom */
jest.mock('../js/regenFlash.js', () => ({ flashRegenerated: jest.fn() }));
jest.mock('../js/identity.js', () => ({ generateRecoveryCode: jest.fn(() => 'new-phrase-goes-here') }));
const { showRecoveryCodeModal } = require('../js/recoveryModal.js');

const DEFAULT_WARNING = "Save this somewhere safe. It's the only way to restore your account if you lose this browser. We can't recover it for you.";
const GRAD_INTRO = 'To use the app outside Telegram you get a secret phrase — it opens this same account in any browser.';
const GRAD_WARNING = "Save this somewhere safe. It's how you sign in outside Telegram, and the only way to restore your account if you lose access to Telegram. We can't recover it for you.";

beforeEach(() => { document.body.innerHTML = /* Step 1 markup */; });

test('defaults render byte-identical to web signup: no intro, stock warning, no cancel', () => {
  showRecoveryCodeModal('a-b-c-d', null);
  expect(document.getElementById('recovery-modal-intro').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('recovery-modal-warning').textContent).toBe(DEFAULT_WARNING);
  expect(document.getElementById('recovery-cancel-btn').classList.contains('hidden')).toBe(true);
});

test('graduation knobs: intro + warning + cancel visible', () => {
  showRecoveryCodeModal('a-b-c-d', null, { intro: GRAD_INTRO, warning: GRAD_WARNING, cancellable: true });
  expect(document.getElementById('recovery-modal-intro').textContent).toBe(GRAD_INTRO);
  expect(document.getElementById('recovery-modal-warning').textContent).toBe(GRAD_WARNING);
  expect(document.getElementById('recovery-cancel-btn').classList.contains('hidden')).toBe(false);
});

test('cancel resolves null and hides the modal', async () => {
  const p = showRecoveryCodeModal('a-b-c-d', null, { cancellable: true });
  document.getElementById('recovery-cancel-btn').click();
  await expect(p).resolves.toBeNull();
  expect(document.getElementById('recovery-modal').classList.contains('hidden')).toBe(true);
});

test('onConfirm failure keeps the modal up; success resolves the phrase', async () => {
  const onConfirm = jest.fn()
    .mockRejectedValueOnce(new Error('collision'))
    .mockResolvedValueOnce(undefined);
  const p = showRecoveryCodeModal('a-b-c-d', onConfirm);
  document.getElementById('recovery-saved-btn').click();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(document.getElementById('recovery-modal').classList.contains('hidden')).toBe(false); // stayed up
  document.getElementById('recovery-saved-btn').click();
  await expect(p).resolves.toBe('a-b-c-d');
});
```

Run: `npx jest tests/recoveryModal.test.js` — expected: FAIL.

- [ ] **Step 3: Move the helpers**

Move `setButtonBusy`/`clearButtonBusy` from `js/app.js:45-53` to `js/utils.js` as exports (verbatim). In `js/app.js` import them from `./utils.js` (the restore screen at line ~398 keeps using them).

- [ ] **Step 4: Create `js/recoveryModal.js`**

Move `showRecoveryCodeModal` (js/app.js:302-~380) verbatim into the new module, plus the knobs:

```js
// js/recoveryModal.js — the secret-phrase reveal ceremony, shared by web
// signup (defaults) and the Telegram graduation flow (knobs). Spec §7.
import { generateRecoveryCode } from './identity.js';
import { flashRegenerated } from './regenFlash.js';
import { setButtonBusy, clearButtonBusy } from './utils.js';

const DEFAULT_WARNING = "Save this somewhere safe. It's the only way to restore your account if you lose this browser. We can't recover it for you.";
```

Signature: `export function showRecoveryCodeModal(initialCode, onConfirm, { intro = null, warning = null, cancellable = false } = {})`. Inside, after the existing element lookups add:

```js
  const introEl = document.getElementById('recovery-modal-intro');
  if (introEl) {
    introEl.textContent = intro || '';
    introEl.classList.toggle('hidden', !intro);
  }
  const warnEl = document.getElementById('recovery-modal-warning');
  if (warnEl) warnEl.textContent = warning || DEFAULT_WARNING;
  const cancelBtn = document.getElementById('recovery-cancel-btn');
  if (cancelBtn) cancelBtn.classList.toggle('hidden', !cancellable);
```

and in the Promise body register (and clean up in both exits):

```js
    function onCancel() {
      rotateBtn.removeEventListener('click', onRotate);
      copyBtn.removeEventListener('click', onCopy);
      savedBtn.removeEventListener('click', onSaved);
      cancelBtn.removeEventListener('click', onCancel);
      window.removeEventListener('popstate', onPopState);
      if (kcForm) kcForm.removeEventListener('submit', onKcSubmit);
      el.classList.add('hidden');
      resolve(null);
    }
    if (cancellable && cancelBtn) cancelBtn.addEventListener('click', onCancel);
```

(mirror the exact listener-teardown list the existing `onSaved` uses, adding `cancelBtn`). In `js/app.js`: delete the moved function, add `import { showRecoveryCodeModal } from './recoveryModal.js';`, and remove now-unused local imports if any (`flashRegenerated` stays if the restore screen uses it — check before removing).

- [ ] **Step 5: Run tests**

Run: `npx jest tests/recoveryModal.test.js tests/recovery.test.js && npx jest`
Expected: PASS — `tests/recovery.test.js` (web signup path) must pass untouched; if it stubs `showRecoveryCodeModal` via app.js internals, point its mock at `../js/recoveryModal.js`.

- [ ] **Step 6: Commit**

```bash
git add js/recoveryModal.js js/app.js js/utils.js index.template.html tests/recoveryModal.test.js tests/recovery.test.js
git commit -m "refactor(onboarding): extract recovery modal with intro/warning/cancel knobs"
```

---

### Task 9: `js/telegramFirstRun.js` — start_param invite gate + interstitial

**Files:**
- Create: `js/telegramFirstRun.js`
- Modify: `index.template.html` (interstitial markup, after `#welcome-screen`)
- Modify: `js/app.js:600-630` (gate wiring), `js/app.js:701-704` (already-following suppression + silent-redeem toast)
- Test: `tests/telegramFirstRun.test.js`

**Interfaces:**
- Produces: `telegramInviteGate({ linked, dismissSplash }) → Promise<{ token, preview, silent } | null>` and `extractStartParamToken() → string|null`.
- Consumes: `tgWebApp`, `isTelegramContext` (`js/telegram.js`); `resolveInvitePreview` (`js/invites.js` — returns `{ scope:'personal', label } | { scope:'group', groupName, groupId } | null`); `showLinkScreen` (`js/telegramSettings.js`, Task 5); `showToast` (`js/groups.js`).
- Redemption itself stays in app.js's existing `pendingInviteToken` block — the gate only decides whether a token enters it.

- [ ] **Step 1: Interstitial markup**

In `index.template.html`, after `#welcome-screen` (line ~58):

```html
  <div id="tg-invite-screen" class="welcome-screen hidden">
    <span class="brand-mark welcome-brand">k&#x0338;n&#x0336;o&#x0338;c&#x0335;k&#x0335; &#x0336;k&#x0338;n&#x0337;o&#x0335;c&#x0338;k&#x0335;</span>
    <p id="tg-invite-framing" class="welcome-invite-framing"></p>
    <p class="hint">KnockKnock shows your people when you're free — and shows you when they are.</p>
    <div class="welcome-btns">
      <button id="tg-invite-accept-btn" class="primary-btn" type="button">Accept &amp; get started</button>
      <button id="tg-invite-phrase-btn" class="ghost-btn" type="button">I have a secret phrase</button>
      <button id="tg-invite-dismiss-btn" class="ghost-btn" type="button">Not now</button>
    </div>
  </div>
```

- [ ] **Step 2: Write the failing tests**

Create `tests/telegramFirstRun.test.js`:

```js
/** @jest-environment jsdom */
const mockWa = { initDataUnsafe: {} };
jest.mock('../js/telegram.js', () => ({
  isTelegramContext: jest.fn(() => true),
  tgWebApp: jest.fn(() => mockWa),
}));
jest.mock('../js/invites.js', () => ({ resolveInvitePreview: jest.fn() }));
jest.mock('../js/telegramSettings.js', () => ({ showLinkScreen: jest.fn() }));
jest.mock('../js/groups.js', () => ({ showToast: jest.fn() }));

const { resolveInvitePreview } = require('../js/invites.js');
const { showLinkScreen } = require('../js/telegramSettings.js');
const { isTelegramContext } = require('../js/telegram.js');
const { telegramInviteGate, extractStartParamToken } = require('../js/telegramFirstRun.js');

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const SCREEN = `
  <div id="tg-invite-screen" class="welcome-screen hidden">
    <p id="tg-invite-framing"></p>
    <button id="tg-invite-accept-btn"></button>
    <button id="tg-invite-phrase-btn"></button>
    <button id="tg-invite-dismiss-btn"></button>
  </div>`;

beforeEach(() => {
  document.body.innerHTML = SCREEN;
  mockWa.initDataUnsafe = {};
  jest.clearAllMocks();
  isTelegramContext.mockReturnValue(true);
});

test('extractStartParamToken: valid token / garbage / missing / outside TG', () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  expect(extractStartParamToken()).toBe(TOKEN);
  mockWa.initDataUnsafe = { start_param: 'nope nope!' };
  expect(extractStartParamToken()).toBeNull();
  mockWa.initDataUnsafe = {};
  expect(extractStartParamToken()).toBeNull();
  isTelegramContext.mockReturnValue(false);
  mockWa.initDataUnsafe = { start_param: TOKEN };
  expect(extractStartParamToken()).toBeNull();
});

test('no token → null, preview never fetched', async () => {
  expect(await telegramInviteGate({ linked: false, dismissSplash: jest.fn() })).toBeNull();
  expect(resolveInvitePreview).not.toHaveBeenCalled();
});

test('invalid/revoked token (null preview) → null, no interstitial', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue(null);
  expect(await telegramInviteGate({ linked: false, dismissSplash: jest.fn() })).toBeNull();
  expect(document.getElementById('tg-invite-screen').classList.contains('hidden')).toBe(true);
});

test('linked → silent token, no interstitial', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue({ scope: 'personal', label: 'Ana' });
  const got = await telegramInviteGate({ linked: true, dismissSplash: jest.fn() });
  expect(got).toEqual({ token: TOKEN, preview: { scope: 'personal', label: 'Ana' }, silent: true });
  expect(document.getElementById('tg-invite-screen').classList.contains('hidden')).toBe(true);
});

test('unlinked: interstitial with personal framing; Accept resolves the token', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue({ scope: 'personal', label: 'Ana' });
  const dismissSplash = jest.fn();
  const p = telegramInviteGate({ linked: false, dismissSplash });
  await Promise.resolve(); await Promise.resolve();
  expect(dismissSplash).toHaveBeenCalled();
  expect(document.getElementById('tg-invite-screen').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('tg-invite-framing').textContent).toBe('Ana invited you to follow them.');
  document.getElementById('tg-invite-accept-btn').click();
  const got = await p;
  expect(got.token).toBe(TOKEN);
  expect(got.silent).toBe(false);
  expect(document.getElementById('tg-invite-screen').classList.contains('hidden')).toBe(true);
});

test('group framing text', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue({ scope: 'group', groupName: 'Buddies', groupId: 'g1' });
  const p = telegramInviteGate({ linked: false, dismissSplash: jest.fn() });
  await Promise.resolve(); await Promise.resolve();
  expect(document.getElementById('tg-invite-framing').textContent).toBe("You've been invited to join Buddies.");
  document.getElementById('tg-invite-dismiss-btn').click();
  await p;
});

test('"I have a secret phrase" → showLinkScreen, resolves null', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue({ scope: 'personal', label: 'Ana' });
  const p = telegramInviteGate({ linked: false, dismissSplash: jest.fn() });
  await Promise.resolve(); await Promise.resolve();
  document.getElementById('tg-invite-phrase-btn').click();
  expect(await p).toBeNull();
  expect(showLinkScreen).toHaveBeenCalled();
});

test('"Not now" → resolves null, nothing redeemed', async () => {
  mockWa.initDataUnsafe = { start_param: TOKEN };
  resolveInvitePreview.mockResolvedValue({ scope: 'personal', label: 'Ana' });
  const p = telegramInviteGate({ linked: false, dismissSplash: jest.fn() });
  await Promise.resolve(); await Promise.resolve();
  document.getElementById('tg-invite-dismiss-btn').click();
  expect(await p).toBeNull();
});
```

Run: `npx jest tests/telegramFirstRun.test.js` — expected: FAIL.

- [ ] **Step 3: Implement `js/telegramFirstRun.js`**

```js
// js/telegramFirstRun.js — Telegram start_param invite gate (spec §1).
// Decides whether a deep-linked invite token enters app.js's existing
// pendingInviteToken redemption flow, showing the first-run interstitial
// to unlinked arrivals first. Redemption itself stays in app.js.
import { isTelegramContext, tgWebApp } from './telegram.js';
import { resolveInvitePreview } from './invites.js';
import { showLinkScreen } from './telegramSettings.js';

// start_param rides the SIGNED initData (tamper-proof, reload-proof). Invite
// tokens are 22 base64url chars; accept a lenient 10..64 of that alphabet.
export function extractStartParamToken() {
  if (!isTelegramContext()) return null;
  const p = tgWebApp()?.initDataUnsafe?.start_param;
  return (typeof p === 'string' && /^[A-Za-z0-9_-]{10,64}$/.test(p)) ? p : null;
}

function framingText(preview) {
  return preview.scope === 'group'
    ? `You've been invited to join ${preview.groupName}.`
    : `${preview.label || 'Someone'} invited you to follow them.`;
}

function showInterstitial(preview) {
  const el = document.getElementById('tg-invite-screen');
  if (!el) return Promise.resolve('dismiss');
  document.getElementById('tg-invite-framing').textContent = framingText(preview);
  el.classList.remove('hidden');
  return new Promise((resolve) => {
    const accept = document.getElementById('tg-invite-accept-btn');
    const phrase = document.getElementById('tg-invite-phrase-btn');
    const dismiss = document.getElementById('tg-invite-dismiss-btn');
    function pick(choice) {
      accept.removeEventListener('click', onAccept);
      phrase.removeEventListener('click', onPhrase);
      dismiss.removeEventListener('click', onDismiss);
      el.classList.add('hidden');
      resolve(choice);
    }
    function onAccept() { pick('accept'); }
    function onPhrase() { pick('phrase'); }
    function onDismiss() { pick('dismiss'); }
    accept.addEventListener('click', onAccept);
    phrase.addEventListener('click', onPhrase);
    dismiss.addEventListener('click', onDismiss);
  });
}

// Returns { token, preview, silent } to feed pendingInviteToken, or null.
//  - linked account: silent redeem (caller toasts on success) — no interstitial
//  - unlinked: interstitial; Accept → redeem; phrase → link flow (its reload
//    re-runs this gate with linked=true → silent redeem into the right
//    account); Not now → proceed unredeemed (the empty state catches them).
export async function telegramInviteGate({ linked, dismissSplash }) {
  const token = extractStartParamToken();
  if (!token) return null;
  const preview = await resolveInvitePreview(token); // null → invalid/revoked/expired
  if (!preview) return null;
  if (linked) return { token, preview, silent: true };
  dismissSplash();
  const choice = await showInterstitial(preview);
  if (choice === 'accept') return { token, preview, silent: false };
  if (choice === 'phrase') showLinkScreen(); // reloads on success; cancel falls through
  return null;
}
```

- [ ] **Step 4: Wire into `js/app.js`**

- Change line 600 `const pendingInviteToken = ...` to `let pendingInviteToken = ...` and add below the `ensureCacheOwner` block (line ~629):

```js
  // Telegram deep-linked invite (t.me ...?startapp=<token>): gate before the
  // normal redemption flow. Linked accounts redeem silently; unlinked arrivals
  // get the first-run interstitial (spec §1).
  let tgInvite = null;
  if (!pendingInviteToken && isTelegramContext()) {
    tgInvite = await telegramInviteGate({
      linked: telegramLinkState()?.linked === true,
      dismissSplash,
    });
    if (tgInvite) pendingInviteToken = tgInvite.token;
  }
```

Imports: `telegramInviteGate` from `./telegramFirstRun.js`; `telegramLinkState` from `./telegram.js`; `showToast` from `./groups.js` (check for an existing groups import to extend).

- In the redemption block, wrap the result handling (line ~702):

```js
    if (result) {
      // A re-tapped Telegram deep link lands here as already-following: spec
      // says show nothing (the contact is already in the list).
      const silentNoop = tgInvite && result.ok === false && result.reason === 'already-following';
      if (!silentNoop) handleInviteRedemptionResult(result);
      if (result.ok && tgInvite?.silent) {
        showToast(tgInvite.preview.scope === 'group'
          ? `You joined ${tgInvite.preview.groupName}.`
          : `You're now following ${tgInvite.preview.label}.`);
      }
      // ... existing cleanInviteParamFromUrl() and landing logic unchanged
```

(`cleanInviteParamFromUrl` is a URL no-op for start_param tokens — harmless.)

- [ ] **Step 5: Run tests**

Run: `npx jest tests/telegramFirstRun.test.js && npx jest`
Expected: PASS. App-boot suites (`tests/app-call-recovery.test.js`, `tests/app-boot-cacheOwner.test.js`, `tests/recovery.test.js`) may need `jest.mock('../js/telegramFirstRun.js', () => ({ telegramInviteGate: jest.fn(async () => null) }))` added alongside their existing mocks.

- [ ] **Step 6: Commit**

```bash
git add index.template.html js/telegramFirstRun.js js/app.js tests/telegramFirstRun.test.js tests/
git commit -m "feat(telegram): start_param invite gate + first-run interstitial"
```

---

### Task 10: `js/telegramChrome.js` — back button, swipes, closing confirmation, color re-sync

**Files:**
- Create: `js/telegramChrome.js`
- Modify: `js/telegram.js` (remove `initTelegramChrome` — it moves)
- Modify: `js/app.js:621` (import swap)
- Modify: `js/inviteModal.js` (export `closeInviteModal`), `js/inbox.js` (export `closeInboxModal`), `js/notifyBell.js` (export `dismissNotifyPopover`)
- Test: `tests/telegramChrome.test.js` (+ move any `initTelegramChrome` assertions out of `tests/telegram.test.js`)

**Interfaces:**
- Produces: `initTelegramChrome()` (same name, new home) and pure `resolveBackAction(doc?) → (() => void) | null`.
- Consumes: `isCardDrawerOpen`/`closeCardDrawer` (`js/cardDrawer.js`, exist); `isNotifyPopoverOpen` (`js/notifyBell.js`, exists) + new `dismissNotifyPopover`; new `closeInviteModal`/`closeInboxModal`; `navigateToDirect` (`js/groupNav.js:57`, exists); `getCurrentContext` (same module app.js imports it from); `getCallModeCalleeId`/`getIncomingCallFrom` (`js/following.js`, exist — hintRotation.js already imports them; the import cycle is runtime-safe, same precedent).

- [ ] **Step 1: Export the three close functions**

- `js/inviteModal.js`: `export function closeModal()` → rename export to `export function closeInviteModal()` (keep an internal alias if the file references `closeModal`).
- `js/inbox.js`: locate the internal routine its overlay-click handler uses to hide `#inbox-modal` and extract/export it as `export function closeInboxModal()`.
- `js/notifyBell.js`: `closeOpenPopover` is internal (used at line 48) — add `export function dismissNotifyPopover() { closeOpenPopover(); }`.

- [ ] **Step 2: Write the failing tests**

Create `tests/telegramChrome.test.js`:

```js
/** @jest-environment jsdom */
const mocks = {
  cardOpen: jest.fn(() => false), closeCard: jest.fn(),
  popOpen: jest.fn(() => false), dismissPop: jest.fn(),
  closeInvite: jest.fn(), closeInbox: jest.fn(),
  ctx: jest.fn(() => ({ context: 'direct' })), toDirect: jest.fn(),
  callee: jest.fn(() => null), incoming: jest.fn(() => null),
};
jest.mock('../js/cardDrawer.js', () => ({ isCardDrawerOpen: (...a) => mocks.cardOpen(...a), closeCardDrawer: (...a) => mocks.closeCard(...a) }));
jest.mock('../js/notifyBell.js', () => ({ isNotifyPopoverOpen: (...a) => mocks.popOpen(...a), dismissNotifyPopover: (...a) => mocks.dismissPop(...a) }));
jest.mock('../js/inviteModal.js', () => ({ closeInviteModal: (...a) => mocks.closeInvite(...a) }));
jest.mock('../js/inbox.js', () => ({ closeInboxModal: (...a) => mocks.closeInbox(...a) }));
jest.mock('../js/groupNav.js', () => ({ navigateToDirect: (...a) => mocks.toDirect(...a) }));
jest.mock('../js/following.js', () => ({ getCallModeCalleeId: (...a) => mocks.callee(...a), getIncomingCallFrom: (...a) => mocks.incoming(...a) }));
// mock the getCurrentContext module with { getCurrentContext: (...a) => mocks.ctx(...a) }
// using the SAME path app.js imports it from.
jest.mock('../js/telegram.js', () => ({ tgWebApp: jest.fn(() => null), isTelegramContext: jest.fn(() => true) }));

const { resolveBackAction } = require('../js/telegramChrome.js');

const SHELL = `
  <div id="restore-screen" class="hidden"><button id="restore-cancel-btn"></button></div>
  <div id="tg-invite-screen" class="hidden"></div>
  <div id="recovery-modal" class="hidden"></div>
  <div id="invite-modal" class="hidden"></div>
  <div id="create-group-modal" class="hidden"><button id="create-group-cancel-btn"></button></div>
  <div id="inbox-modal" class="hidden"></div>
  <div id="invite-failure-overlay" class="hidden"><button id="invite-failure-continue"></button></div>
  <div id="code-drawer"><button id="mycode-chip"></button></div>
  <div id="add-person-form"><button id="add-cancel-btn"></button></div>`;

beforeEach(() => { document.body.innerHTML = SHELL; jest.clearAllMocks();
  mocks.cardOpen.mockReturnValue(false); mocks.popOpen.mockReturnValue(false);
  mocks.ctx.mockReturnValue({ context: 'direct' }); });

const show = (id) => document.getElementById(id).classList.remove('hidden');

test('nothing open, direct context → null', () => {
  expect(resolveBackAction()).toBeNull();
});

test('restore screen wins over everything → clicks its cancel', () => {
  show('restore-screen'); show('invite-modal'); mocks.ctx.mockReturnValue({ context: 'group', groupId: 'g' });
  const cancelSpy = jest.fn();
  document.getElementById('restore-cancel-btn').addEventListener('click', cancelSpy);
  resolveBackAction()();
  expect(cancelSpy).toHaveBeenCalled();
});

test('interstitial and recovery modal → null (Telegram default / history trap)', () => {
  show('tg-invite-screen');
  expect(resolveBackAction()).toBeNull();
  document.getElementById('tg-invite-screen').classList.add('hidden');
  show('recovery-modal');
  expect(resolveBackAction()).toBeNull();
});

test('modals in priority order: invite → create-group → inbox → failure overlay', () => {
  show('invite-modal');
  resolveBackAction()();
  expect(mocks.closeInvite).toHaveBeenCalled();
  document.getElementById('invite-modal').classList.add('hidden');
  show('inbox-modal');
  resolveBackAction()();
  expect(mocks.closeInbox).toHaveBeenCalled();
});

test('popover, card drawer, add form, code drawer', () => {
  mocks.popOpen.mockReturnValue(true);
  resolveBackAction()();
  expect(mocks.dismissPop).toHaveBeenCalled();
  mocks.popOpen.mockReturnValue(false);

  mocks.cardOpen.mockReturnValue(true);
  resolveBackAction()();
  expect(mocks.closeCard).toHaveBeenCalled();
  mocks.cardOpen.mockReturnValue(false);

  document.getElementById('add-person-form').classList.add('open');
  const addCancel = jest.fn();
  document.getElementById('add-cancel-btn').addEventListener('click', addCancel);
  resolveBackAction()();
  expect(addCancel).toHaveBeenCalled();
  document.getElementById('add-person-form').classList.remove('open');

  document.getElementById('code-drawer').classList.add('open');
  const chip = jest.fn();
  document.getElementById('mycode-chip').addEventListener('click', chip);
  resolveBackAction()();
  expect(chip).toHaveBeenCalled();
});

test('group context → navigateToDirect', () => {
  mocks.ctx.mockReturnValue({ context: 'group', groupId: 'g1' });
  resolveBackAction()();
  expect(mocks.toDirect).toHaveBeenCalled();
});
```

Run: `npx jest tests/telegramChrome.test.js` — expected: FAIL.

- [ ] **Step 3: Implement `js/telegramChrome.js`**

```js
// js/telegramChrome.js — Telegram webview chrome integration (spec §6).
// Back button, vertical-swipe disable, closing confirmation during calls,
// and chrome color re-sync. Everything version-guarded and inert outside
// Telegram. Haptics deliberately out of scope.
import { tgWebApp } from './telegram.js';
import { isCardDrawerOpen, closeCardDrawer } from './cardDrawer.js';
import { isNotifyPopoverOpen, dismissNotifyPopover } from './notifyBell.js';
import { closeInviteModal } from './inviteModal.js';
import { closeInboxModal } from './inbox.js';
import { navigateToDirect } from './groupNav.js';
import { getCallModeCalleeId, getIncomingCallFrom } from './following.js';
// import getCurrentContext from the SAME module js/app.js imports it from.

const visible = (doc, id) => {
  const el = doc.getElementById(id);
  return !!el && !el.classList.contains('hidden');
};

// Pure, ordered checklist over EXISTING close paths. Returns the action for
// the top-most closeable surface, or null (button hidden; Telegram default).
//  - tg-invite-screen: pre-consent — back should leave the app, not skip it.
//  - recovery-modal: guards an unsaved phrase with its own history trap;
//    a back affordance that discards it would be worse than none.
export function resolveBackAction(doc = document) {
  if (visible(doc, 'restore-screen')) return () => doc.getElementById('restore-cancel-btn')?.click();
  if (visible(doc, 'tg-invite-screen')) return null;
  if (visible(doc, 'recovery-modal')) return null;
  if (visible(doc, 'invite-modal')) return () => closeInviteModal();
  if (visible(doc, 'create-group-modal')) return () => doc.getElementById('create-group-cancel-btn')?.click();
  if (visible(doc, 'inbox-modal')) return () => closeInboxModal();
  if (visible(doc, 'invite-failure-overlay')) return () => doc.getElementById('invite-failure-continue')?.click();
  if (isNotifyPopoverOpen()) return () => dismissNotifyPopover();
  if (isCardDrawerOpen()) return () => closeCardDrawer();
  if (doc.getElementById('add-person-form')?.classList.contains('open')) {
    return () => doc.getElementById('add-cancel-btn')?.click();
  }
  if (doc.getElementById('code-drawer')?.classList.contains('open')) {
    return () => doc.getElementById('mycode-chip')?.click(); // real toggle path
  }
  if (getCurrentContext().context === 'group') return () => navigateToDirect();
  return null;
}

let _backAction = null;

function inCall() {
  return !!(getCallModeCalleeId() || getIncomingCallFrom());
}

function updateChromeState() {
  const wa = tgWebApp();
  if (!wa) return;
  // Back button hidden during calls: accidental hangup is worse than no back
  // button — leaving a call stays an explicit in-app action (spec §6).
  _backAction = inCall() ? null : resolveBackAction();
  try {
    if (wa.BackButton) (_backAction ? wa.BackButton.show() : wa.BackButton.hide());
    if (wa.enableClosingConfirmation && wa.disableClosingConfirmation) {
      (inCall() ? wa.enableClosingConfirmation() : wa.disableClosingConfirmation());
    }
  } catch { /* chrome sugar must never break the app */ }
}

function syncChromeColor() {
  const wa = tgWebApp();
  if (!wa) return;
  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) {
      wa.setHeaderColor?.(bg);
      wa.setBackgroundColor?.(bg);
    }
  } catch { /* ignore */ }
}

function debounce(fn, ms = 80) {
  let t = null;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

export function initTelegramChrome() {
  const wa = tgWebApp();
  if (!wa) return;
  try {
    wa.ready();
    wa.expand();
    // Global: list overscroll collapses the webview too, not just canvas
    // strokes; the header stays the platform-normal minimize affordance.
    if (wa.isVersionAtLeast?.('7.7')) wa.disableVerticalSwipes?.();
    wa.BackButton?.onClick?.(() => { _backAction?.(); });
    syncChromeColor();
    // One debounced observer drives back button + closing confirmation
    // (overlay opens/closes, call-mode classes) and the chrome color
    // (documentElement style writes) — same pattern the hint engine's
    // pause detection proved out.
    const onMutate = debounce(() => { updateChromeState(); syncChromeColor(); });
    new MutationObserver(onMutate).observe(document.documentElement, {
      attributes: true, attributeFilter: ['class', 'style', 'open'], subtree: true, childList: true,
    });
    updateChromeState();
  } catch { /* chrome sugar must never block boot */ }
}
```

(Resolve the `getCurrentContext` import path by copying it from `js/app.js`'s import list.)

- [ ] **Step 4: Move-out and rewire**

- Delete `initTelegramChrome` from `js/telegram.js` (keep `tgWebApp`, `isTelegramContext`, `telegramLinkState`, `ensureTelegramIdentity`, `openTelegramShare`).
- `js/app.js:621`: import `initTelegramChrome` from `./telegramChrome.js` instead of `./telegram.js`.
- Move/adjust any `initTelegramChrome` tests from `tests/telegram.test.js` into `tests/telegramChrome.test.js`.

- [ ] **Step 5: Run tests**

Run: `npx jest tests/telegramChrome.test.js tests/telegram.test.js && npx jest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/telegramChrome.js js/telegram.js js/app.js js/inviteModal.js js/inbox.js js/notifyBell.js tests/telegramChrome.test.js tests/telegram.test.js
git commit -m "feat(telegram): chrome integration — back button, swipes, close-confirm, color re-sync"
```

---

### Task 11: Docs (setup runbook, A9 checklist, env) + full verification

**Files:**
- Modify: `docs/telegram-setup.md`
- Modify: `.env.example` if present at repo root (else document in telegram-setup.md only)

**Interfaces:** none (docs).

- [ ] **Step 1: `TELEGRAM_APP_LINK` documentation**

In `docs/telegram-setup.md` Part A (dev), where the Mini App is registered with BotFather (`/newapp`), add: the resulting link `https://t.me/<bot_username>/<app_short_name>` goes into the **root** `.env.local` as `TELEGRAM_APP_LINK=` (and `.env.production` at launch — add this line to the "Merge prep" checklist). Note explicitly: this is a **client build** variable (root `.env.*`), NOT `functions/.env`; unset ⇒ invite shares fall back to web URLs.

- [ ] **Step 2: BotFather descriptions**

Add an operator step (Part A and mirrored in Part B):

```
/setdescription  → KnockKnock — see when the people who matter are free, and let them know when you are. Open the app to get started.
/setabouttext    → Ambient availability for your closest people. No feeds, no messages — just who's free right now.
```

(Draft copy; maintainer may tune in BotFather without a code change.)

- [ ] **Step 3: A9 on-device checklist**

Append to the runbook's smoke-test section:

```
A9 — onboarding & chrome smoke test (dev preview channel + test bot)
 1. Deep-link invite (fresh TG account): create invite in app A → share via
    Telegram → tap in account B → interstitial shows inviter framing →
    Accept & get started → contact present, no empty state.
 2. "I have a secret phrase" from the interstitial: link → reload → silent
    redeem toast → invite contact present in the LINKED account.
 3. Re-tap the same deep link → nothing shown (no failure overlay).
 4. Cold /start from a never-seen account → funnel message (no command list);
    /start again → compact status line.
 5. Fresh account, no invite → guided empty state; Invite your people →
    share sheet carries t.me link; Add by code demoted; link line present.
 6. Unlink: confirm step → landing banner over the empty state; notifications
    chip reads Push after relink.
 7. Link: landing banner "Linked —"; theme correct (no stale vars).
 8. Back button: open card drawer / inbox / invite modal / group context —
    back closes top-most each time; back with nothing open exits the app;
    back hidden during a call.
 9. Vertical swipe: draw on the canvas + overscroll the list — webview must
    not collapse (Bot API ≥7.7 client).
10. Call close-confirm: start a call, swipe down → Telegram asks to confirm.
11. Change theme/palette → Telegram header/background follows without reboot.
12. Web (browser): empty account shows the guided empty state; install toast
    stays away until the first contact exists, then appears; corner icon
    visible throughout.
```

- [ ] **Step 4: Full verification**

Run: `npx jest` (expect 47+ suites green, count grown from 1265) and `cd functions && npm test` (expect 6 suites green, count grown from 149). Fix anything red before committing.

- [ ] **Step 5: Commit**

```bash
git add docs/telegram-setup.md
git commit -m "docs(telegram): TELEGRAM_APP_LINK setup, BotFather descriptions, A9 checklist"
```

---

## Deferred to the follow-on session (designed in spec §7, NOT here)

- `graduateTelegram` callable + the shared account-walker refactor of `expungeDerivedAccount` (delete vs rewrite actions, write ordering: copy → rewrite refs → repoint mapping → delete old).
- The Account section's "I also want to use the app outside of Telegram" button (its slot `#tg-account-slot` and the recovery-modal knobs are the enablers that land here).
- The `graduated` landing banner is already wired (Task 5) and simply unused until then.
