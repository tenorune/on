# Web Nudge Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide install/web-push nudges in web sessions of Telegram-linked accounts whose notification channel is telegram, reactively, with an immediate permission flow on switch-to-push.

**Architecture:** A new tiny state module (`js/notifySuppression.js`) holds a "bot-delivered" flag derived from `userPrefs` (`prefs.telegram != null && prefs.notifyChannel !== 'push'`), fed from the `watchUserPrefs` tick and optimistically from the channel pill, broadcasting a `bot-delivery-change` document event. The install affordance and notify-promo modules read the flag at decision time and re-run on the event; `ensureNotificationsReady` early-returns on it; the pill's push-click triggers the permission flow.

**Tech Stack:** Vanilla JS ES modules, Jest + jsdom (repo-root suite: `npx jest`).

**Spec:** `docs/superpowers/specs/2026-07-07-web-nudge-suppression-design.md`

## Global Constraints

- Web test suite is `npx jest` at the REPO ROOT (jsdom is the default environment; no `@jest-environment` header needed). Do NOT run the functions suite; nothing in `functions/` changes.
- The predicate must mirror the pill's semantics exactly (`js/notifyChannel.js` `isLinked` + default-to-telegram): `prefs?.telegram != null && prefs?.notifyChannel !== 'push'`. Comments in both files must cross-reference each other.
- `js/` is native-dialog-free; no new UI is added anywhere in this plan — only visibility gating.
- No first-person voice in commit messages; gerund/imperative style matching repo history (`fix(ui): …`, `feat(web): …`).
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (committer email must be `noreply@anthropic.com`; run `git config user.email noreply@anthropic.com` if unset).
- Work directly on branch `claude/telegram-app-adaptation-t1r1jp`. Commit per task; do NOT push (the operator's session flow handles pushes).

---

### Task 1: `js/notifySuppression.js` — state module

**Files:**
- Create: `js/notifySuppression.js`
- Create: `tests/notifySuppression.test.js`

**Interfaces:**
- Consumes: `isTelegramContext()` from `js/telegram.js` (existing).
- Produces (used by Tasks 2–5):
  - `botDelivered(prefs) → boolean` — pure predicate.
  - `syncBotDelivery(prefs) → void` — updates the flag, dispatches `bot-delivery-change` on `document` only when the value changes; no-op in Telegram context.
  - `isBotDelivered() → boolean` — current flag.
  - `__resetBotDeliveryForTests() → void` — test-only reset (same pattern as `__resetInstallPromptForTests` in `js/installPrompt.js`).

- [ ] **Step 1: Write the failing test**

Create `tests/notifySuppression.test.js`:

```js
// tests/notifySuppression.test.js
// "Notifications are bot-delivered" state for web sessions of linked accounts —
// the predicate, the change-only event, and the Telegram-context no-op.
jest.mock('../js/telegram.js', () => ({ isTelegramContext: jest.fn(() => false) }));
const { isTelegramContext } = require('../js/telegram.js');
const {
  botDelivered, isBotDelivered, syncBotDelivery, __resetBotDeliveryForTests,
} = require('../js/notifySuppression.js');

const LINKED_TG = { telegram: { linkedAt: 1 }, notifyChannel: 'telegram' };
const LINKED_PUSH = { telegram: { linkedAt: 1 }, notifyChannel: 'push' };

beforeEach(() => {
  isTelegramContext.mockReturnValue(false);
  __resetBotDeliveryForTests();
});

describe('botDelivered (pure predicate)', () => {
  test('linked + telegram channel → true', () => {
    expect(botDelivered(LINKED_TG)).toBe(true);
  });
  test('linked + push channel → false', () => {
    expect(botDelivered(LINKED_PUSH)).toBe(false);
  });
  test('linked + missing channel → true (defaults to telegram, mirroring the pill)', () => {
    expect(botDelivered({ telegram: { linkedAt: 1 } })).toBe(true);
  });
  test('unlinked → false regardless of channel', () => {
    expect(botDelivered({ notifyChannel: 'telegram' })).toBe(false);
  });
  test('null/undefined/empty prefs → false (fail open to current behavior)', () => {
    expect(botDelivered(null)).toBe(false);
    expect(botDelivered(undefined)).toBe(false);
    expect(botDelivered({})).toBe(false);
  });
});

describe('syncBotDelivery / isBotDelivered', () => {
  test('starts false', () => {
    expect(isBotDelivered()).toBe(false);
  });

  test('flips the flag and dispatches bot-delivery-change only on change', () => {
    const seen = jest.fn();
    document.addEventListener('bot-delivery-change', seen);
    syncBotDelivery(LINKED_TG);
    expect(isBotDelivered()).toBe(true);
    syncBotDelivery(LINKED_TG);       // same value — no second dispatch
    syncBotDelivery(LINKED_PUSH);     // change back
    expect(isBotDelivered()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    document.removeEventListener('bot-delivery-change', seen);
  });

  test('Telegram context → no-op: flag stays false, no event', () => {
    isTelegramContext.mockReturnValue(true);
    const seen = jest.fn();
    document.addEventListener('bot-delivery-change', seen);
    syncBotDelivery(LINKED_TG);
    expect(isBotDelivered()).toBe(false);
    expect(seen).not.toHaveBeenCalled();
    document.removeEventListener('bot-delivery-change', seen);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (repo root): `npx jest tests/notifySuppression.test.js`
Expected: FAIL — `Cannot find module '../js/notifySuppression.js'`

- [ ] **Step 3: Write minimal implementation**

Create `js/notifySuppression.js`:

```js
// js/notifySuppression.js — "notifications are bot-delivered" state for web
// sessions. When a linked account's channel is telegram, the bot delivers every
// notification, so web install/web-push nudges have a void premise and hide
// (spec 2026-07-07-web-nudge-suppression). Fed from the watchUserPrefs tick
// (server truth: link/unlink/channel switches from any device) and
// optimistically from the channel pill; consumers read isBotDelivered() at
// decision time and re-run on the 'bot-delivery-change' document event.
import { isTelegramContext } from './telegram.js';

let suppressed = false;

// Pure. Mirrors the pill's isLinked + default-channel semantics
// (js/notifyChannel.js): on web the telegram marker means linked, and a linked
// account with no stored channel reads as telegram. The two must never disagree.
export function botDelivered(prefs) {
  return prefs?.telegram != null && prefs?.notifyChannel !== 'push';
}

export function isBotDelivered() { return suppressed; }

export function syncBotDelivery(prefs) {
  // Web-only concern: in Telegram the whole install/web-push machinery is
  // already gated off at init (app.js) and inside notifyPrompt.
  if (isTelegramContext()) return;
  const next = botDelivered(prefs);
  if (next === suppressed) return;
  suppressed = next;
  document.dispatchEvent(new CustomEvent('bot-delivery-change'));
}

export function __resetBotDeliveryForTests() { suppressed = false; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/notifySuppression.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add js/notifySuppression.js tests/notifySuppression.test.js
git commit -m "feat(web): bot-delivered notification state module

botDelivered(prefs) predicate + change-only bot-delivery-change event,
mirroring the channel pill's linked/default-channel semantics. First
piece of the web nudge suppression spec (2026-07-07).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Install affordance hides when bot-delivered

**Files:**
- Modify: `js/installAffordance.js` (import; `apply()` at :73-95; listener wiring at :106)
- Test: `tests/installAffordance.test.js` (extend)

**Interfaces:**
- Consumes: `isBotDelivered()`, and in tests `syncBotDelivery(prefs)` + `__resetBotDeliveryForTests()`, from `js/notifySuppression.js` (Task 1).
- Produces: nothing new — visibility behavior only.

- [ ] **Step 1: Write the failing tests**

In `tests/installAffordance.test.js`, add to the END of the `describe('install affordance rendering', …)` block (before its closing `});`) — and note the real `js/notifySuppression.js` is used deliberately (integration through the event; `isTelegramContext` is naturally false in jsdom):

```js
  describe('bot-delivered suppression (linked account, telegram channel)', () => {
    const { syncBotDelivery, __resetBotDeliveryForTests } = require('../js/notifySuppression.js');
    const LINKED_TG = { telegram: { linkedAt: 1 }, notifyChannel: 'telegram' };
    const LINKED_PUSH = { telegram: { linkedAt: 1 }, notifyChannel: 'push' };
    const toast = () => document.getElementById('install-toast');
    const fab = () => document.getElementById('install-fab');

    beforeEach(() => {
      __resetBotDeliveryForTests();
      setUA('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko Firefox/125.0'); // push-in-tab lane
    });
    afterAll(() => __resetBotDeliveryForTests());

    test('suppressed at init: toast AND fab hidden in an otherwise-showing lane', () => {
      syncBotDelivery(LINKED_TG);
      initInstallAffordance();
      expect(toast().classList.contains('hidden')).toBe(true);
      expect(fab().classList.contains('hidden')).toBe(true);
    });

    test('suppression arriving after init hides a visible toast (prefs tick landed late)', () => {
      initInstallAffordance();
      expect(toast().classList.contains('hidden')).toBe(false);
      syncBotDelivery(LINKED_TG); // bot-delivery-change → apply()
      expect(toast().classList.contains('hidden')).toBe(true);
      expect(fab().classList.contains('hidden')).toBe(true);
    });

    test('suppression lifting (switch to push) revives the affordance without re-init', () => {
      syncBotDelivery(LINKED_TG);
      initInstallAffordance();
      expect(toast().classList.contains('hidden')).toBe(true);
      syncBotDelivery(LINKED_PUSH);
      expect(toast().classList.contains('hidden')).toBe(false);
      expect(fab().classList.contains('hidden')).toBe(true); // toast leads, as usual
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/installAffordance.test.js`
Expected: the three new tests FAIL (toast visible where hidden is expected); all pre-existing tests still PASS.

- [ ] **Step 3: Implement**

In `js/installAffordance.js`:

Add the import after the `firstRun.js` import (line 17):

```js
import { isBotDelivered } from './notifySuppression.js';
```

In `apply()` change the `relevant` computation (lines 74-76) from:

```js
    const lane = currentLane();
    const relevant = !isAppInstalled()
      && (lane === 'installable' || lane === 'push-in-tab' || lane === 'ios-install' || lane === 'macos-install');
```

to:

```js
    const lane = currentLane();
    // Bot-delivered accounts (linked, telegram channel) hide the whole install
    // affordance: its copy is notification-framed, and the bot already delivers
    // (spec 2026-07-07-web-nudge-suppression). Reactive via bot-delivery-change.
    const relevant = !isAppInstalled() && !isBotDelivered()
      && (lane === 'installable' || lane === 'push-in-tab' || lane === 'ios-install' || lane === 'macos-install');
```

Add the listener next to the `first-run-change` one (line 106):

```js
  document.addEventListener('first-run-change', apply);
  document.addEventListener('bot-delivery-change', apply);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/installAffordance.test.js`
Expected: PASS (all, including the 3 new)

- [ ] **Step 5: Commit**

```bash
git add js/installAffordance.js tests/installAffordance.test.js
git commit -m "feat(web): hide install toast/fab for bot-delivered accounts

The affordance's copy is notification-framed; a linked account on the
telegram channel already gets those via the bot. Reactive through the
bot-delivery-change event, same pattern as first-run-change.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Notify prompt suppression (banner + bell permission flow)

**Files:**
- Modify: `js/notifyPrompt.js` (import; `ensureNotificationsReady` at :107; `refreshPromoVisibility` at :143; listener wiring in `initNotifyPrompt` at :124)
- Test: `tests/notifyPrompt.test.js` (extend)

**Interfaces:**
- Consumes: `isBotDelivered()`, `syncBotDelivery(prefs)`, `__resetBotDeliveryForTests()` from `js/notifySuppression.js` (Task 1). Note: `tests/notifyPrompt.test.js` mocks `../js/telegram.js` at the top — the real `notifySuppression.js` picks up that mock, so `isTelegramContext` is false by default there.
- Produces: `ensureNotificationsReady()` now early-returns when bot-delivered — Task 4's pill click relies on it being safe to call unconditionally.

- [ ] **Step 1: Write the failing tests**

Append to the END of `tests/notifyPrompt.test.js`:

```js
const { initNotifyPrompt } = require('../js/notifyPrompt.js');
const { syncBotDelivery, __resetBotDeliveryForTests } = require('../js/notifySuppression.js');

describe('bot-delivered suppression (linked account, telegram channel)', () => {
  const LINKED_TG = { telegram: { linkedAt: 1 }, notifyChannel: 'telegram' };
  const LINKED_PUSH = { telegram: { linkedAt: 1 }, notifyChannel: 'push' };
  const banner = () => document.getElementById('notify-promo');

  beforeEach(() => {
    __resetBotDeliveryForTests();
    addPushToken.mockClear();
    detectNotifyCapability.mockReset();
    detectNotifyCapability.mockReturnValue({ state: 'supported', supported: true });
    hasAnyNotifyPrefEnabled.mockReturnValue(true); // reprompt conditions all hold…
    localStorage.clear();                          // …and no device dismissal
    mountBanner();
    global.Notification = { permission: 'default', requestPermission: jest.fn().mockResolvedValue('granted') };
    global.navigator.serviceWorker = { ready: Promise.resolve({ id: 'reg' }) };
    getMessagingIfSupported.mockResolvedValue({});
    getToken.mockResolvedValue('tok-1');
  });
  afterAll(() => __resetBotDeliveryForTests());

  test('ensureNotificationsReady no-ops when suppressed: no prompt, no token, no banner', async () => {
    syncBotDelivery(LINKED_TG);
    await ensureNotificationsReady();
    expect(global.Notification.requestPermission).not.toHaveBeenCalled();
    expect(addPushToken).not.toHaveBeenCalled();
    expect(banner().classList.contains('hidden')).toBe(true);
  });

  test('reprompt banner stays hidden when suppressed even though every reprompt condition holds', () => {
    syncBotDelivery(LINKED_TG);
    initNotifyPrompt('u1');
    expect(banner().classList.contains('hidden')).toBe(true);
  });

  test('reprompt banner revives when suppression lifts (channel switched to push)', () => {
    syncBotDelivery(LINKED_TG);
    initNotifyPrompt('u1');
    expect(banner().classList.contains('hidden')).toBe(true);
    syncBotDelivery(LINKED_PUSH); // bot-delivery-change → refreshPromoVisibility
    expect(banner().classList.contains('hidden')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/notifyPrompt.test.js`
Expected: the three new tests FAIL (permission requested / banner visible where suppression is expected); all pre-existing tests still PASS.

- [ ] **Step 3: Implement**

In `js/notifyPrompt.js`:

Add the import after the `telegram.js` import (line 5):

```js
import { isBotDelivered } from './notifySuppression.js';
```

In `ensureNotificationsReady()` add after the `isTelegramContext()` return (line 112):

```js
  if (isTelegramContext()) return;
  // Bot-delivered on web (linked account, telegram channel): bells just write
  // prefs — the notifier routes them to the bot (functions/notifier.js), so
  // there is no web-push permission to demand (spec 2026-07-07-web-nudge-suppression).
  if (isBotDelivered()) return;
```

In `refreshPromoVisibility()` add after the Telegram check (line 148):

```js
  if (isTelegramContext()) { banner.classList.add('hidden'); return; }
  // Bot-delivered: the reprompt's premise ("your on-bells deliver nothing on
  // this device") is false — the bot delivers them. Re-evaluated on
  // bot-delivery-change, so switching to push revives the reprompt live.
  if (isBotDelivered()) { banner.classList.add('hidden'); return; }
```

In `initNotifyPrompt()` add the listener inside the existing `_repromptListenerWired` guard (after line 129):

```js
    document.addEventListener('notify-prefs-synced', maybeRepromptForMissingPermission);
    document.addEventListener('bot-delivery-change', maybeRepromptForMissingPermission);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/notifyPrompt.test.js`
Expected: PASS (all, including the 3 new)

- [ ] **Step 5: Commit**

```bash
git add js/notifyPrompt.js tests/notifyPrompt.test.js
git commit -m "feat(web): suppress web-push banner and bell permission flow for bot-delivered accounts

The reprompt's premise is false for a linked telegram-channel account —
its bells deliver via the bot. Bell toggles now just write prefs; the
banner re-evaluates on bot-delivery-change so a switch to push revives it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Channel pill feeds suppression; switch-to-push runs the permission flow

**Files:**
- Modify: `js/notifyChannel.js` (imports; module-level `lastPrefs`; click handler at :47-56; `syncNotifyChannel` at :63)
- Test: `tests/notifyChannel.test.js` (extend)

**Interfaces:**
- Consumes: `syncBotDelivery(prefs)` (Task 1), `ensureNotificationsReady()` (Task 3 behavior; import is cycle-free — `notifyPrompt.js` does not import `notifyChannel.js`).
- Produces: on every successful channel write, suppression state is updated optimistically (before the server echo), and a switch to `push` triggers the permission flow.

- [ ] **Step 1: Write the failing tests**

In `tests/notifyChannel.test.js`, add these mocks after the existing `jest.mock` calls (lines 5-9):

```js
jest.mock('../js/notifyPrompt.js', () => ({ ensureNotificationsReady: jest.fn() }));
jest.mock('../js/notifySuppression.js', () => ({ syncBotDelivery: jest.fn() }));
```

and these requires after the existing ones (line 12):

```js
const { ensureNotificationsReady } = require('../js/notifyPrompt.js');
const { syncBotDelivery } = require('../js/notifySuppression.js');
```

(The outer `beforeEach` already runs `jest.clearAllMocks()`, which covers the new mocks.)

Append to the END of the file:

```js
describe('channel switch feeds suppression and prompts on push', () => {
  test('switch to push: optimistic syncBotDelivery with the merged prefs, then the permission flow', async () => {
    syncNotifyChannel('u1', LINKED('telegram'));
    document.querySelector('[data-channel="push"]').click();
    await flush();
    expect(syncBotDelivery).toHaveBeenCalledWith({ telegram: { linkedAt: 1 }, notifyChannel: 'push' });
    expect(ensureNotificationsReady).toHaveBeenCalledTimes(1);
  });

  test('switch to telegram: optimistic suppression, no permission flow', async () => {
    syncNotifyChannel('u1', LINKED('push'));
    document.querySelector('[data-channel="telegram"]').click();
    await flush();
    expect(syncBotDelivery).toHaveBeenCalledWith({ telegram: { linkedAt: 1 }, notifyChannel: 'telegram' });
    expect(ensureNotificationsReady).not.toHaveBeenCalled();
  });

  test('merge failure: no suppression change, no permission flow (matches the visual revert)', async () => {
    mergeUserPrefs.mockRejectedValue(new Error('offline'));
    syncNotifyChannel('u1', LINKED('telegram'));
    document.querySelector('[data-channel="push"]').click();
    await flush();
    expect(syncBotDelivery).not.toHaveBeenCalled();
    expect(ensureNotificationsReady).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/notifyChannel.test.js`
Expected: the three new tests FAIL (`syncBotDelivery`/`ensureNotificationsReady` never called); all pre-existing tests still PASS.

- [ ] **Step 3: Implement**

In `js/notifyChannel.js`:

Add imports after the existing ones (line 11):

```js
import { syncBotDelivery } from './notifySuppression.js';
import { ensureNotificationsReady } from './notifyPrompt.js';
```

Add module state after the `OTHER` constant (line 13):

```js
// Latest prefs this pill was synced with — the click handler needs them to
// feed suppression optimistically without waiting for the watchUserPrefs echo.
let lastPrefs = null;
```

In the click handler (lines 47-56), change the `try` block from:

```js
      try {
        await mergeUserPrefs(userId, { notifyChannel: next });
      } catch {
        setActive(pill, OTHER[next]); // revert; no echo will arrive to correct it
      }
```

to:

```js
      try {
        await mergeUserPrefs(userId, { notifyChannel: next });
        // Optimistic: flip web nudge suppression now (the echo confirms later).
        // For a switch TO push, run the permission flow immediately — the user
        // just asked for web push; a permissionless device would otherwise go
        // silent until some later prefs event. Inert in Telegram context
        // (ensureNotificationsReady early-returns there).
        syncBotDelivery({ ...(lastPrefs || {}), notifyChannel: next });
        if (next === 'push') ensureNotificationsReady();
      } catch {
        setActive(pill, OTHER[next]); // revert; no echo will arrive to correct it
      }
```

In `syncNotifyChannel()` record the prefs as the first line (line 63):

```js
export function syncNotifyChannel(userId, prefs) {
  lastPrefs = prefs;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/notifyChannel.test.js`
Expected: PASS (all, including the 3 new)

- [ ] **Step 5: Commit**

```bash
git add js/notifyChannel.js tests/notifyChannel.test.js
git commit -m "feat(web): channel pill feeds nudge suppression; switch-to-push prompts immediately

A successful channel write optimistically flips the bot-delivered flag,
and switching to push runs ensureNotificationsReady on the spot — the
one moment a suppressed user re-enters the web-push world.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Boot wiring + full-suite verification

**Files:**
- Modify: `js/app.js` (import near line 35; the `watchUserPrefs` tick at :722-728)

**Interfaces:**
- Consumes: `syncBotDelivery(serverPrefs)` (Task 1).
- Produces: the server-truth feed — link/unlink and cross-device channel switches update suppression live.

Note: this is boot glue with no direct unit test, matching the precedent of the adjacent `syncNotifyChannel` call (also untested in `app.js`); its behavior is covered by the module tests in Tasks 1–4. Verification here is the full suite.

- [ ] **Step 1: Implement the wiring**

In `js/app.js`, add the import next to the `syncNotifyChannel` import (line 35):

```js
import { syncNotifyChannel } from './notifyChannel.js';
import { syncBotDelivery } from './notifySuppression.js';
```

In the `watchUserPrefs` tick (lines 722-728), add the call beside `syncNotifyChannel`:

```js
  watchUserPrefs(userId, (serverPrefs) => {
    syncPrefsFromServer(serverPrefs);
    // Notification-channel pill reconciles live on every prefs change — link/
    // unlink (userPrefs.telegram) and cross-device channel switches — on both web
    // and Telegram, so neither needs a reload to reflect the current state.
    syncNotifyChannel(userId, serverPrefs);
    // Web nudge suppression rides the same tick (no-op in Telegram context):
    // install/web-push nudges hide while the bot delivers notifications.
    syncBotDelivery(serverPrefs);
  });
```

- [ ] **Step 2: Run the FULL web suite**

Run (repo root): `npx jest`
Expected: ALL suites pass; total test count = previous total + 9 (Task 1) + 3 + 3 + 3 = previous + 18. Zero failures, no new console errors in output.

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat(web): feed nudge suppression from the userPrefs tick

Link, unlink, and cross-device channel switches now flip web nudge
suppression live, completing the 2026-07-07 web-nudge-suppression spec.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
