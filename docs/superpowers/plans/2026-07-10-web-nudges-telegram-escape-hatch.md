# Web Nudges: Telegram Escape Hatch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer "link Telegram" as an actionable escape hatch on every dead-end web-push nudge surface, and make the reprompt banner outrank the onramp promo.

**Architecture:** A new leaf module `js/telegramEscapeHatch.js` (the `phraseReminder.js` idiom: shared HTML block + wiring) is consumed by `notifyPrompt.js` and `installAffordance.js`. Two coordination flags (`isTelegramLinkedWeb`, `isRepromptActive`) ride the existing `notifySuppression.js` state pattern, keeping the import graph acyclic: telegramOnramp → notifySuppression; notifyPrompt → {notifySuppression, telegramEscapeHatch}; telegramEscapeHatch → {telegramOnramp, notifySuppression}.

**Tech Stack:** Vanilla ES modules, Jest (jsdom, babel-CJS transform), esbuild.

**Spec:** `docs/superpowers/specs/2026-07-10-web-nudges-telegram-escape-hatch-design.md`

## Global Constraints

- Branch: `claude/telegram-app-adaptation-t1r1jp` (current). Commit per task, push after each commit: `git push -u origin claude/telegram-app-adaptation-t1r1jp`.
- Web tests: `node_modules/.bin/jest <file>` from repo root (NOT bare `npx jest` — it can fetch a network jest). Full suite must stay green (1558+ at start).
- No changes under `functions/`, `database.rules.json`, or `index.template.html`.
- The escape-hatch copy string, verbatim everywhere (single source in telegramEscapeHatch.js): `Or link Telegram to get notified there — no install or browser permission needed.` Button label: `Link Telegram`.
- The hatch never appears on: the `installable` toast lane, the supported-state banner, the onboarding install step, the pre-account in-app-browser redirect.
- Untouched invariants: the three-reader `channel !== 'push'` predicate; `test-fixtures/notify-channel-vectors.json`; the 40-char name cap.
- Comment style: match surrounding files — constraint-stating comments, no narration.

---

### Task 1: notifySuppression.js — coordination flags

**Files:**
- Modify: `js/notifySuppression.js`
- Test: `tests/notifySuppression.test.js`

**Interfaces:**
- Consumes: nothing new (already receives full prefs via `syncBotDelivery`).
- Produces (later tasks rely on these exact names):
  - `isTelegramLinkedWeb(): boolean` — web-only "account is linked" (`prefs.telegram != null`), recorded on every `syncBotDelivery` tick.
  - `setRepromptActive(active: boolean): void` — records the reprompt banner's visibility; dispatches a `reprompt-change` document CustomEvent only on value change.
  - `isRepromptActive(): boolean`
  - `__resetBotDeliveryForTests()` — now also resets both new flags.

- [ ] **Step 1: Write the failing tests** — append to `tests/notifySuppression.test.js`:

```js
const {
  isTelegramLinkedWeb, setRepromptActive, isRepromptActive,
} = require('../js/notifySuppression.js');

describe('isTelegramLinkedWeb (5th reader of the linked marker)', () => {
  test('starts false; follows prefs.telegram across syncBotDelivery ticks', () => {
    expect(isTelegramLinkedWeb()).toBe(false);
    syncBotDelivery(LINKED_PUSH);            // linked but channel push
    expect(isTelegramLinkedWeb()).toBe(true); // linked ≠ botDelivered
    expect(isBotDelivered()).toBe(false);
    syncBotDelivery({ notifyChannel: 'push' }); // unlinked
    expect(isTelegramLinkedWeb()).toBe(false);
  });

  test('Telegram context → not recorded (web-only concern)', () => {
    isTelegramContext.mockReturnValue(true);
    syncBotDelivery(LINKED_TG);
    expect(isTelegramLinkedWeb()).toBe(false);
  });
});

describe('setRepromptActive / isRepromptActive', () => {
  test('starts false; flips and dispatches reprompt-change only on change', () => {
    const seen = jest.fn();
    document.addEventListener('reprompt-change', seen);
    expect(isRepromptActive()).toBe(false);
    setRepromptActive(true);
    expect(isRepromptActive()).toBe(true);
    setRepromptActive(true);   // same value — no second dispatch
    setRepromptActive(false);
    expect(isRepromptActive()).toBe(false);
    expect(seen).toHaveBeenCalledTimes(2);
    document.removeEventListener('reprompt-change', seen);
  });
});
```

Also extend the existing top-of-file `require` destructure to include the three new names (single require statement, as the file already does).

- [ ] **Step 2: Run to verify failure**

Run: `node_modules/.bin/jest tests/notifySuppression.test.js`
Expected: FAIL — `isTelegramLinkedWeb is not a function` (and the new describes fail).

- [ ] **Step 3: Implement** — in `js/notifySuppression.js`:

Add module state + exports after the existing `suppressed` declaration:

```js
let linkedWeb = false;
let repromptActive = false;

// Web-only "this account is linked" (prefs.telegram != null) — the linked
// marker's 5th reader, recorded on the same tick as botDelivered so
// telegramEscapeHatch can gate without importing prefs. See the reader list
// in the botDelivered comment above.
export function isTelegramLinkedWeb() { return linkedWeb; }

// Reprompt-banner visibility, fed by notifyPrompt refreshPromoVisibility.
// telegramOnramp reads it at decision time (promo defers to the reprompt —
// concrete unmet intent beats a passive promo) and re-runs on 'reprompt-change'.
export function setRepromptActive(active) {
  const next = !!active;
  if (next === repromptActive) return;
  repromptActive = next;
  document.dispatchEvent(new CustomEvent('reprompt-change'));
}
export function isRepromptActive() { return repromptActive; }
```

In `syncBotDelivery`, after the `isTelegramContext()` early return, record the linked flag before the change-compare:

```js
export function syncBotDelivery(prefs) {
  // Web-only concern: in Telegram the whole install/web-push machinery is
  // already gated off at init (app.js) and inside notifyPrompt.
  if (isTelegramContext()) return;
  linkedWeb = prefs?.telegram != null;
  const next = botDelivered(prefs);
  if (next === suppressed) return;
  suppressed = next;
  document.dispatchEvent(new CustomEvent('bot-delivery-change'));
}
```

Extend the reset:

```js
export function __resetBotDeliveryForTests() {
  suppressed = false; linkedWeb = false; repromptActive = false;
}
```

Update the reader-list comment above `botDelivered`: the existing block ends with the 4th reader (telegramOnramp `syncTelegramOnramp`); append: `A FIFTH reader, js/telegramEscapeHatch.js, consumes the linked half via isTelegramLinkedWeb() below (recorded from the same prefs tick).`

- [ ] **Step 4: Run to verify pass**

Run: `node_modules/.bin/jest tests/notifySuppression.test.js`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit + push**

```bash
git add js/notifySuppression.js tests/notifySuppression.test.js
git commit -m "feat(nudges): notifySuppression carries linked + reprompt coordination flags"
git push -u origin claude/telegram-app-adaptation-t1r1jp
```

---

### Task 2: telegramOnramp.js — nudge starter + promo defers to reprompt

**Files:**
- Modify: `js/telegramOnramp.js`
- Test: `tests/telegramOnramp.test.js`

**Interfaces:**
- Consumes: `isRepromptActive` from `js/notifySuppression.js` (Task 1).
- Produces: `startTelegramOnrampFromNudge(btn?: HTMLButtonElement): Promise<void>` — disables `btn` in flight, arms the linked success beat on success. Task 3's `wireEscapeHatch` calls it.

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe('telegramOnramp', …)` in `tests/telegramOnramp.test.js` (real `notifySuppression` module; `jest.resetModules()` in the existing beforeEach gives a fresh instance per test):

```js
  function promoDom() {
    document.body.innerHTML = `
      <div id="tg-onramp-promo" class="hidden">
        <button id="tg-onramp-action"></button>
        <button id="tg-onramp-dismiss"></button>
      </div>
      <div id="tg-onramp-drawer" class="hidden">
        <button id="tg-onramp-drawer-btn"></button>
      </div>
      <div id="drawer-section-account" class="hidden"></div>`;
  }

  test('startTelegramOnrampFromNudge disables the button in flight and arms the success beat', async () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    let release;
    mockMint.mockReturnValue(new Promise((r) => { release = () => r({ token: 'tok_xyz' }); }));
    const open = jest.spyOn(window, 'open').mockReturnValue({});
    const mod = require('../js/telegramOnramp.js');
    const btn = document.createElement('button');
    const flight = mod.startTelegramOnrampFromNudge(btn);
    expect(btn.disabled).toBe(true);
    release(); await flight;
    expect(btn.disabled).toBe(false);
    // Success beat: the linked echo now toasts (same as the promo CTA path).
    mod.syncTelegramOnramp({ telegram: { linkedAt: 1 } });
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('Linked'));
    open.mockRestore();
  });

  test('startTelegramOnrampFromNudge on mint failure re-enables and does NOT arm the beat', async () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    mockMint.mockRejectedValue(new Error('nope'));
    const mod = require('../js/telegramOnramp.js');
    const btn = document.createElement('button');
    await mod.startTelegramOnrampFromNudge(btn);
    expect(btn.disabled).toBe(false);
    mockToast.mockClear();
    mod.syncTelegramOnramp({ telegram: { linkedAt: 1 } });
    expect(mockToast).not.toHaveBeenCalled(); // no beat armed by the failed tap
  });

  test('promo defers while the reprompt is active and resumes on reprompt-change', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    localStorage.clear();   // the promo's dismissed flag persists across tests in jsdom
    promoDom();
    const { setRepromptActive } = require('../js/notifySuppression.js');
    const mod = require('../js/telegramOnramp.js');
    setRepromptActive(true);
    mod.initTelegramOnramp();
    mod.syncTelegramOnramp({});          // unlinked
    const promo = document.getElementById('tg-onramp-promo');
    expect(promo.classList.contains('hidden')).toBe(true);   // reprompt holds it
    expect(mod.isOnrampPromoActive()).toBe(false);
    setRepromptActive(false);            // fires reprompt-change → refresh()
    expect(promo.classList.contains('hidden')).toBe(false);  // resumes
    expect(mod.isOnrampPromoActive()).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `node_modules/.bin/jest tests/telegramOnramp.test.js`
Expected: FAIL — `startTelegramOnrampFromNudge is not a function`; defer test fails (promo visible).

- [ ] **Step 3: Implement** — in `js/telegramOnramp.js`:

Add import:

```js
import { isRepromptActive } from './notifySuppression.js';
```

Export the nudge starter (place after `startTelegramOnramp`); it is the same semantics the promo/drawer CTA had, now shared:

```js
// Shared CTA handler for every surface that starts the onramp from a nudge
// (promo banner, drawer card, telegramEscapeHatch): disable the button in
// flight; arm the success beat only when the deep link actually opened (U1.7).
export async function startTelegramOnrampFromNudge(btn) {
  if (btn) btn.disabled = true;
  try {
    if (await startTelegramOnramp()) _ctaTapped = true;
  } finally { if (btn) btn.disabled = false; }
}
```

In `initTelegramOnramp`, delete the local `go` closure and rewire the two handlers:

```js
  document.getElementById('tg-onramp-action')?.addEventListener('click', (e) => startTelegramOnrampFromNudge(e.currentTarget));
  document.getElementById('tg-onramp-drawer-btn')?.addEventListener('click', (e) => startTelegramOnrampFromNudge(e.currentTarget));
```

In `refresh()`, extend the promo gate (comment included):

```js
  // The PROMO — but not the drawer card — defers during the guided empty state
  // (U2.2) AND while the reprompt banner is up (concrete unmet intent beats a
  // passive promo): one teaching surface at a time (spec §3), same rule
  // installAffordance follows. The drawer card is opt-in and stays reachable.
  const promoActive = show && !bannerDismissed() && !isFirstRunActive() && !isRepromptActive();
```

Rename the listener guard `_firstRunBound` → `_listenersBound` (declaration and both uses) and bind both events under it:

```js
  if (!_listenersBound) {
    document.addEventListener('first-run-change', refresh);
    document.addEventListener('reprompt-change', refresh);
    _listenersBound = true;
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `node_modules/.bin/jest tests/telegramOnramp.test.js tests/notifySuppression.test.js`
Expected: PASS.

- [ ] **Step 5: Commit + push**

```bash
git add js/telegramOnramp.js tests/telegramOnramp.test.js
git commit -m "feat(nudges): shared onramp nudge starter; promo defers to the reprompt banner"
git push -u origin claude/telegram-app-adaptation-t1r1jp
```

---

### Task 3: telegramEscapeHatch.js — shared block + CSS

**Files:**
- Create: `js/telegramEscapeHatch.js`
- Modify: `css/app.css`
- Test: `tests/telegramEscapeHatch.test.js` (new)

**Interfaces:**
- Consumes: `telegramOnrampEnabled`, `startTelegramOnrampFromNudge` from `js/telegramOnramp.js` (Task 2); `isTelegramLinkedWeb` from `js/notifySuppression.js` (Task 1).
- Produces (Tasks 4–5 rely on these exact names):
  - `escapeHatchAvailable(): boolean`
  - `escapeHatchHtml(): string` — `''` when unavailable, so callers append unconditionally.
  - `wireEscapeHatch(container: Element): void` — no-op when the block isn't in `container`.

- [ ] **Step 1: Write the failing test** — `tests/telegramEscapeHatch.test.js`:

```js
/** @jest-environment jsdom */
// Shared "link Telegram instead" block for dead-end web-push nudges.
const mockStartFromNudge = jest.fn(async () => {});
const mockEnabled = jest.fn(() => true);
const mockLinked = jest.fn(() => false);
jest.mock('../js/telegramOnramp.js', () => ({
  telegramOnrampEnabled: (...a) => mockEnabled(...a),
  startTelegramOnrampFromNudge: (...a) => mockStartFromNudge(...a),
}));
jest.mock('../js/notifySuppression.js', () => ({
  isTelegramLinkedWeb: (...a) => mockLinked(...a),
}));
const {
  escapeHatchAvailable, escapeHatchHtml, wireEscapeHatch,
} = require('../js/telegramEscapeHatch.js');

beforeEach(() => {
  mockStartFromNudge.mockClear();
  mockEnabled.mockReturnValue(true);
  mockLinked.mockReturnValue(false);
});

describe('escapeHatchAvailable', () => {
  test('true only when the onramp is enabled AND the account is unlinked', () => {
    expect(escapeHatchAvailable()).toBe(true);
    mockLinked.mockReturnValue(true);
    expect(escapeHatchAvailable()).toBe(false);   // linked (incl. linked+push) — excluded
    mockLinked.mockReturnValue(false);
    mockEnabled.mockReturnValue(false);
    expect(escapeHatchAvailable()).toBe(false);   // unconfigured / Telegram context
  });
});

describe('escapeHatchHtml', () => {
  test('renders the shared copy + Link Telegram button when available', () => {
    const html = escapeHatchHtml();
    expect(html).toContain('Or link Telegram to get notified there — no install or browser permission needed.');
    expect(html).toContain('Link Telegram');
    expect(html).toContain('tg-escape-hatch-btn');
  });
  test('empty string when unavailable (callers append unconditionally)', () => {
    mockEnabled.mockReturnValue(false);
    expect(escapeHatchHtml()).toBe('');
  });
});

describe('wireEscapeHatch', () => {
  test('click fires the shared nudge starter with the button', () => {
    const box = document.createElement('div');
    box.innerHTML = escapeHatchHtml();
    wireEscapeHatch(box);
    const btn = box.querySelector('.tg-escape-hatch-btn');
    btn.click();
    expect(mockStartFromNudge).toHaveBeenCalledWith(btn);
  });
  test('no-op when the block is absent', () => {
    const box = document.createElement('div');
    box.innerHTML = '<span>no hatch here</span>';
    expect(() => wireEscapeHatch(box)).not.toThrow();
    expect(mockStartFromNudge).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node_modules/.bin/jest tests/telegramEscapeHatch.test.js`
Expected: FAIL — cannot find module `../js/telegramEscapeHatch.js`.

- [ ] **Step 3: Implement** — `js/telegramEscapeHatch.js`:

```js
// js/telegramEscapeHatch.js — the "link Telegram instead" block appended to
// dead-end web-push nudges (spec 2026-07-10-web-nudges-telegram-escape-hatch):
// the notify guidance banner's hard lanes and the install toast's hard lanes.
// Same idiom as phraseReminder.js: an html string + wiring, so notifyPrompt and
// installAffordance share one copy source and one gate. All app-controlled
// markup — no user input.
import { telegramOnrampEnabled, startTelegramOnrampFromNudge } from './telegramOnramp.js';
import { isTelegramLinkedWeb } from './notifySuppression.js';

// Escape-hatch posture: offered only to accounts that could link and haven't.
// Linked accounts on channel 'push' chose push explicitly — excluded.
export function escapeHatchAvailable() {
  return telegramOnrampEnabled() && !isTelegramLinkedWeb();
}

export function escapeHatchHtml() {
  if (!escapeHatchAvailable()) return '';
  return '<span class="tg-escape-hatch">Or link Telegram to get notified there — no install or browser permission needed.'
    + ' <button type="button" class="ghost-btn tg-escape-hatch-btn">Link Telegram</button></span>';
}

export function wireEscapeHatch(container) {
  const btn = container?.querySelector?.('.tg-escape-hatch-btn');
  if (!btn) return;
  btn.addEventListener('click', () => { startTelegramOnrampFromNudge(btn); });
}
```

Append to `css/app.css` (near the existing `.notify-promo` rules):

```css
/* "Link Telegram instead" escape hatch appended to dead-end notify/install
   nudges (telegramEscapeHatch.js owns the markup). */
.tg-escape-hatch { display: block; margin-top: .6rem; }
.tg-escape-hatch .tg-escape-hatch-btn { display: inline-block; margin-top: .35rem; }
```

- [ ] **Step 4: Run to verify pass**

Run: `node_modules/.bin/jest tests/telegramEscapeHatch.test.js`
Expected: PASS.

- [ ] **Step 5: Commit + push**

```bash
git add js/telegramEscapeHatch.js tests/telegramEscapeHatch.test.js css/app.css
git commit -m "feat(nudges): shared Telegram escape-hatch block (copy + CTA, single gate)"
git push -u origin claude/telegram-app-adaptation-t1r1jp
```

---

### Task 4: notifyPrompt.js — feed the reprompt flag + hatch on dead-end banners

**Files:**
- Modify: `js/notifyPrompt.js`
- Test: `tests/notifyPrompt.test.js`

**Interfaces:**
- Consumes: `setRepromptActive` (Task 1); `escapeHatchHtml`, `wireEscapeHatch` (Task 3).
- Produces: nothing new for later tasks (Task 5 is independent).

- [ ] **Step 1: Write the failing tests** — in `tests/notifyPrompt.test.js`, add the module mock beside the existing mocks at the top:

```js
const mockHatchHtml = jest.fn(() => '<span class="tg-escape-hatch"><button class="tg-escape-hatch-btn">Link Telegram</button></span>');
const mockWireHatch = jest.fn();
jest.mock('../js/telegramEscapeHatch.js', () => ({
  escapeHatchHtml: (...a) => mockHatchHtml(...a),
  wireEscapeHatch: (...a) => mockWireHatch(...a),
}));
```

Append the new describes (banner fixture matches the template ids):

```js
describe('escape hatch on dead-end banners', () => {
  const { ensureNotificationsReady } = require('../js/notifyPrompt.js');
  const { detectNotifyCapability, guidanceCopyFor } = require('../js/installGuidance.js');

  function bannerDom() {
    document.body.innerHTML = `
      <div id="notify-promo" class="hidden">
        <span id="notify-promo-text"></span>
        <button id="notify-promo-dismiss"></button>
        <button id="notify-promo-action" class="hidden"></button>
      </div>`;
  }
  beforeEach(() => {
    bannerDom();
    mockHatchHtml.mockClear(); mockWireHatch.mockClear();
    guidanceCopyFor.mockImplementation((s) => ({ body: `copy-for-${s}` }));
    delete global.Notification;
  });

  test.each(['needs-install-ios', 'needs-install-macos', 'in-app-browser', 'denied', 'unsupported'])(
    'guidance state %s appends the hatch and wires it', async (state) => {
      detectNotifyCapability.mockReturnValue({ state });
      await ensureNotificationsReady();
      const textEl = document.getElementById('notify-promo-text');
      expect(textEl.innerHTML).toContain(`copy-for-${state}`);
      expect(textEl.innerHTML).toContain('tg-escape-hatch');
      expect(mockWireHatch).toHaveBeenCalledWith(textEl);
    });

  test('unavailable hatch (empty string) leaves guidance copy unchanged', async () => {
    mockHatchHtml.mockReturnValue('');
    detectNotifyCapability.mockReturnValue({ state: 'needs-install-ios' });
    await ensureNotificationsReady();
    const textEl = document.getElementById('notify-promo-text');
    expect(textEl.innerHTML).not.toContain('tg-escape-hatch');
  });

  test('supported state never renders the hatch (web push is one tap away)', async () => {
    detectNotifyCapability.mockReturnValue({ state: 'supported' });
    global.Notification = { requestPermission: jest.fn().mockResolvedValue('granted') };
    global.navigator.serviceWorker = { ready: Promise.resolve({}) };
    const { getMessagingIfSupported } = require('../js/firebase-config.js');
    getMessagingIfSupported.mockResolvedValue(null); // registration fails → failure surface
    await ensureNotificationsReady();
    const textEl = document.getElementById('notify-promo-text');
    // Registration-failed IS a dead end — hatch expected there:
    expect(textEl.textContent).toContain("Couldn't turn on notifications");
    expect(textEl.innerHTML).toContain('tg-escape-hatch');
    expect(mockWireHatch).toHaveBeenCalledWith(textEl);
  });
});

describe('reprompt visibility feeds setRepromptActive', () => {
  const { initNotifyPrompt } = require('../js/notifyPrompt.js');
  const { isRepromptActive, __resetBotDeliveryForTests } = require('../js/notifySuppression.js');
  const { hasAnyNotifyPrefEnabled } = require('../js/prefs.js');
  const { detectNotifyCapability } = require('../js/installGuidance.js');

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="notify-promo" class="hidden">
        <span id="notify-promo-text"></span>
        <button id="notify-promo-dismiss"></button>
        <button id="notify-promo-action" class="hidden"></button>
      </div>`;
    __resetBotDeliveryForTests();
    localStorage.clear();
    global.Notification = { permission: 'default' };
  });

  test('banner shown → flag true; hidden → flag false', () => {
    detectNotifyCapability.mockReturnValue({ state: 'supported' });
    hasAnyNotifyPrefEnabled.mockReturnValue(true);   // unmet intent → reprompt
    initNotifyPrompt('u1');
    expect(isRepromptActive()).toBe(true);
    hasAnyNotifyPrefEnabled.mockReturnValue(false);  // intent gone
    document.dispatchEvent(new CustomEvent('notify-prefs-synced'));
    expect(isRepromptActive()).toBe(false);
  });
});
```

Note: `tests/notifyPrompt.test.js` uses the REAL `notifySuppression.js` (it already does — only `telegram.js` under it is mocked), so `isRepromptActive` reflects the real feed.

- [ ] **Step 2: Run to verify failure**

Run: `node_modules/.bin/jest tests/notifyPrompt.test.js`
Expected: FAIL — hatch not in innerHTML; `isRepromptActive()` stays false.

- [ ] **Step 3: Implement** — in `js/notifyPrompt.js`:

Add imports:

```js
import { isBotDelivered, setRepromptActive } from './notifySuppression.js';
import { escapeHatchHtml, wireEscapeHatch } from './telegramEscapeHatch.js';
```

(The `isBotDelivered` import line already exists — extend it.)

`refreshPromoVisibility()` — feed the flag on every exit. The three hide paths and the show path become:

```js
function refreshPromoVisibility() {
  const banner = document.getElementById('notify-promo');
  if (!banner) return;
  // Never surface the web-push promo/reprompt in Telegram — the bot is the
  // notification channel there (spec §9); web-push framing would only mislead.
  if (isTelegramContext()) { setRepromptActive(false); banner.classList.add('hidden'); return; }
  // Bot-delivered: the reprompt's premise ("your on-bells deliver nothing on
  // this device") is false — the bot delivers them. Re-evaluated on
  // bot-delivery-change, so switching to push revives the reprompt live.
  if (isBotDelivered()) { setRepromptActive(false); banner.classList.add('hidden'); return; }
  const cap = detectNotifyCapability();
  const permission = (typeof Notification !== 'undefined' && Notification.permission) || 'default';
  const reprompt = shouldReprompt({
    enabled: NOTIFICATIONS_ENABLED, hasEnabledPrefs: hasAnyNotifyPrefEnabled(),
    permission, capState: cap.state, deviceDismissed: isRepromptDismissedOnDevice(),
  });
  // The onramp promo defers while the reprompt is up (concrete unmet intent
  // beats a passive promo) — notifySuppression carries the flag.
  setRepromptActive(reprompt);
  if (!reprompt) { banner.classList.add('hidden'); return; }
  renderBanner(banner, cap.state, () => {
    dismissRepromptOnDevice(); setRepromptActive(false); banner.classList.add('hidden');
  });
  banner.classList.remove('hidden');
}
```

`renderBanner` guidance branch — append the hatch after the phrase reminder and wire it:

```js
  } else {
    const copy = guidanceCopyFor(capState);
    let html = copy.body;
    if (copy.remindPhrase) html += phraseReminderHtml();
    html += escapeHatchHtml();   // '' when unavailable — dead-end lanes offer Telegram
    textEl.innerHTML = html;
    wirePhraseCopyButton(textEl);
    wireEscapeHatch(textEl);
    actionEl.classList.add('hidden');
  }
```

`showRegistrationFailed` — a dead end too (permission granted, token setup failed):

```js
function showRegistrationFailed(banner) {
  const textEl = banner.querySelector('#notify-promo-text');
  const actionEl = banner.querySelector('#notify-promo-action');
  if (textEl) {
    textEl.innerHTML = "Couldn't turn on notifications on this device — it may not fully support web push. You can try again."
      + escapeHatchHtml();
    wireEscapeHatch(textEl);
  }
  if (actionEl) actionEl.classList.remove('hidden');
  banner.classList.remove('hidden');
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node_modules/.bin/jest tests/notifyPrompt.test.js tests/notifySuppression.test.js tests/telegramOnramp.test.js`
Expected: PASS.

- [ ] **Step 5: Commit + push**

```bash
git add js/notifyPrompt.js tests/notifyPrompt.test.js
git commit -m "feat(nudges): guidance banner feeds reprompt flag + offers the Telegram escape hatch"
git push -u origin claude/telegram-app-adaptation-t1r1jp
```

---

### Task 5: installAffordance.js — hatch on the hard toast lanes

**Files:**
- Modify: `js/installAffordance.js`
- Test: `tests/installAffordance.test.js`

**Interfaces:**
- Consumes: `escapeHatchHtml`, `wireEscapeHatch` (Task 3).
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing tests** — in `tests/installAffordance.test.js`, add the mock beside the existing `telegramOnramp` mock at the top:

```js
const mockHatchHtml = jest.fn(() => '<span class="tg-escape-hatch"><button class="tg-escape-hatch-btn">Link Telegram</button></span>');
const mockWireHatch = jest.fn();
jest.mock('../js/telegramEscapeHatch.js', () => ({
  escapeHatchHtml: (...a) => mockHatchHtml(...a),
  wireEscapeHatch: (...a) => mockWireHatch(...a),
}));
```

Append inside `describe('install affordance rendering', …)` (reuses its `dom()` / `setUA` / `setStandalone` helpers and beforeEach; add `mockHatchHtml.mockClear(); mockWireHatch.mockClear();` to that beforeEach):

```js
  test('push-in-tab lane (Firefox desktop) appends the hatch', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko Firefox/125.0');
    initInstallAffordance();
    const text = document.getElementById('install-toast-text');
    expect(text.innerHTML).toContain('even when your browser is closed'); // existing copy kept
    expect(text.innerHTML).toContain('tg-escape-hatch');
    expect(mockWireHatch).toHaveBeenCalledWith(text);
  });

  test('ios-install lane appends the hatch after the phrase reminder (FAB → toast)', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1');
    initInstallAffordance();               // iOS lands dismissed → FAB only
    document.getElementById('install-fab').click();  // open the toast
    const text = document.getElementById('install-toast-text');
    expect(text.innerHTML).toContain('tg-escape-hatch');
    expect(mockWireHatch).toHaveBeenCalledWith(text);
  });

  test('installable lane never gets the hatch (headline path untouched)', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64) Chrome/125.0');
    window.onbeforeinstallprompt = null;   // capability present
    initInstallAffordance();
    const text = document.getElementById('install-toast-text');
    expect(text.innerHTML).not.toContain('tg-escape-hatch');
    expect(mockWireHatch).not.toHaveBeenCalled();
  });

  test('unavailable hatch (empty string) leaves lanes at current behavior', () => {
    mockHatchHtml.mockReturnValue('');
    setUA('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko Firefox/125.0');
    initInstallAffordance();
    const text = document.getElementById('install-toast-text');
    expect(text.innerHTML).not.toContain('tg-escape-hatch');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `node_modules/.bin/jest tests/installAffordance.test.js`
Expected: FAIL — hatch absent on push-in-tab / ios lanes.

- [ ] **Step 3: Implement** — in `js/installAffordance.js`:

Add import:

```js
import { escapeHatchHtml, wireEscapeHatch } from './telegramEscapeHatch.js';
```

`fillToast` — hard lanes append the hatch; `installable` untouched:

```js
  } else if (lane === 'ios-install' || lane === 'macos-install') {
    // Same Add-to-Home-Screen / Add-to-Dock content as the onboarding install
    // modal, plus the save-your-phrase reminder (the toast is shown to a signed-in
    // user, so Copy works here). No button — install is manual via the Share/File
    // menu. Dead-end lane: the Telegram escape hatch rides along ('' when
    // unavailable).
    textEl.innerHTML = installStepBodyHtml(lane) + phraseReminderHtml() + escapeHatchHtml();
    wirePhraseCopyButton(textEl);
    wireEscapeHatch(textEl);
    actionEl.classList.add('hidden');
  } else { // push-in-tab — no in-app install possible, so no button; the hatch
    // is the only actionable path ('' when unavailable).
    textEl.innerHTML = pushInTabCopy() + escapeHatchHtml();
    wireEscapeHatch(textEl);
    actionEl.classList.add('hidden');
  }
```

(`pushInTabCopy()` is app-controlled copy — safe as HTML; matches how the other lanes already use `innerHTML`.)

- [ ] **Step 4: Run to verify pass**

Run: `node_modules/.bin/jest tests/installAffordance.test.js`
Expected: PASS (existing lane/deferral tests included).

- [ ] **Step 5: Commit + push**

```bash
git add js/installAffordance.js tests/installAffordance.test.js
git commit -m "feat(nudges): install toast hard lanes offer the Telegram escape hatch"
git push -u origin claude/telegram-app-adaptation-t1r1jp
```

---

### Task 6: Integration verification

**Files:**
- No source changes expected. Fix regressions here if the suite surfaces any.

**Interfaces:** none.

- [ ] **Step 1: Full web suite**

Run: `node_modules/.bin/jest`
Expected: all suites PASS (1558 at start + the new tests). Pay attention to `tests/app-boot-cacheOwner.test.js` and `tests/notifyChannel.test.js` (import-graph changes) — any failure there means a mock needs the new exports added, not a source change.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean esbuild output, no unresolved imports.

- [ ] **Step 3: Invariant suites untouched-check**

Run: `node_modules/.bin/jest tests/notifyChannel.test.js tests/notifySuppression.test.js tests/name-cap-invariant.test.js`
Expected: PASS — the three-reader predicate and vectors unchanged.

- [ ] **Step 4: Commit + push (only if fixes were needed)**

```bash
git add -A
git commit -m "test(nudges): integration fixes from full-suite run"
git push -u origin claude/telegram-app-adaptation-t1r1jp
```

---

## Self-review notes (spec coverage)

- Spec §1 escape-hatch module → Task 3. §2 nudge starter + promo gate → Task 2. §3 flags → Task 1. §4 notifyPrompt (guidance states + registration-failed + feed) → Task 4. §5 install toast lanes → Task 5. Copy string verbatim in Task 3 code and Global Constraints. Non-goals enforced by Task 5's `installable` test and Task 4's supported-state expectations. Error handling: Task 2 failure test (re-enable, no beat) + existing mint-failure toast. Testing section fully mapped.
- Known edge (accepted in design): a linked-but-push account that links *while* a hatch-bearing banner is on screen keeps the stale hatch until the next banner re-render; clicking it routes into the existing relink-confirm flow — safe.
