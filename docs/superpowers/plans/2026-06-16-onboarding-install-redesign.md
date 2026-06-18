# Onboarding & PWA Install Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make account creation + PWA install simple and platform-tailored: a capability-driven lane selector routes each browser/OS to the right install path, iOS gains a Keychain-save → standalone restore-primed handoff, and a persistent install affordance lets users install when it actually helps.

**Architecture:** A pure `onboardingLane()` selector (in `js/installGuidance.js`) classifies the environment. New small modules handle `beforeinstallprompt` capture (`js/installPrompt.js`) and the corner-icon/toast affordance (`js/installAffordance.js`). The existing phrase-reminder copy is extracted from `js/notifyPrompt.js` into a shared renderer reused by the onboarding install step. `js/app.js` gains standalone-launch routing, an inline install step, an early Safari redirect, and a restore-primed screen. No backend changes — restore reuses the existing `validateRecovery` path.

**Tech Stack:** Vanilla JS ES modules, esbuild bundling, Jest + jsdom (`npx jest` from repo root), Firebase RTDB. Build: `npm run build` (prod) / `npm run dev` (watch+serve on :8080).

**Spec:** `docs/superpowers/specs/2026-06-16-onboarding-install-redesign-design.md`

**Conventions to honor (from spec):**
- New copytext must match existing app tone; value is *being notified* (knocks, calls, availability — and on desktop, even when the browser's closed), never the icon.
- The phrase-reminder block is a single shared component reused verbatim.
- Notifications behavior is unchanged — do not touch the bell/permission flow.

---

## File Structure

**New files:**
- `js/installPrompt.js` — captures/exposes the `beforeinstallprompt` event (single-use prompt, `appinstalled` clear, change listeners).
- `js/installAffordance.js` — bottom-left corner icon + toast; chooses content by lane.
- `tests/installPrompt.test.js`, `tests/installAffordance.test.js`, plus additions to `tests/installGuidance.test.js` and `tests/notifyPrompt.test.js`, and new `tests/onboardingFlow.test.js`.

**Modified files:**
- `js/installGuidance.js` — add `isFirefoxDesktop()`, `isStandalone` export, `onboardingLane()`.
- `js/notifyPrompt.js` — extract `phraseReminderHtml()` + `wirePhraseCopyButton()`; reuse them in `renderBanner`.
- `js/app.js` — standalone-launch routing, install step, Safari redirect, restore-primed options.
- `index.template.html` — `#install-fab`, `#install-toast`, `#install-step`, `#safari-redirect`, restore-screen additions, recovery-modal Keychain form fields, restore-input autocomplete.
- `css/app.css` — styles for the fab/toast/new screens; `.visually-hidden` helper.
- `docs/SMOKE-TEST.md`, `docs/HANDOFF.md`.

---

## Phase 1 — Lane selector (`onboardingLane`)

Pure logic, no UX change. Foundation for everything else.

### Task 1: `isFirefoxDesktop()` + export `isStandalone`

**Files:**
- Modify: `js/installGuidance.js`
- Test: `tests/installGuidance.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/installGuidance.test.js` (mirror the existing `setUA`/`setStandalone` helpers already at the top of that file):

```javascript
const { isFirefoxDesktop, isStandalone } = require('../js/installGuidance.js');

describe('isFirefoxDesktop', () => {
  test('true for desktop Firefox', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0');
    expect(isFirefoxDesktop()).toBe(true);
  });
  test('false for Firefox on Android', () => {
    setUA('Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0');
    expect(isFirefoxDesktop()).toBe(false);
  });
  test('false for Firefox on iOS (FxiOS)', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) FxiOS/125.0 Mobile/15E148 Safari/605');
    expect(isFirefoxDesktop()).toBe(false);
  });
  test('false for Chrome', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36');
    expect(isFirefoxDesktop()).toBe(false);
  });
});

describe('isStandalone (exported)', () => {
  test('true when display-mode standalone matches', () => {
    setStandalone(true);
    expect(isStandalone()).toBe(true);
  });
  test('false otherwise', () => {
    setStandalone(false);
    delete global.navigator.standalone;
    expect(isStandalone()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/installGuidance.test.js -t "isFirefoxDesktop"`
Expected: FAIL — `isFirefoxDesktop is not a function`.

- [ ] **Step 3: Implement**

In `js/installGuidance.js`, change `function isStandalone()` (line 5) to `export function isStandalone()`. Then add after `isMacSafari()` (after line 34):

```javascript
// Desktop Firefox: push works in-tab but there is no PWA install. Exclude
// mobile Firefox (Android) and Firefox-on-iOS (FxiOS), which behave differently.
export function isFirefoxDesktop() {
  const u = ua();
  return /Firefox/.test(u) && !/Mobile|Android|iPhone|iPad|iPod|FxiOS/.test(u);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/installGuidance.test.js -t "isFirefoxDesktop"` then `-t "isStandalone (exported)"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/installGuidance.js tests/installGuidance.test.js
git commit -m "feat(onboarding): add isFirefoxDesktop, export isStandalone"
```

### Task 2: `onboardingLane()`

**Files:**
- Modify: `js/installGuidance.js`
- Test: `tests/installGuidance.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
const { onboardingLane } = require('../js/installGuidance.js');

describe('onboardingLane', () => {
  const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
  const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605 CriOS/120 Mobile/15E148 Safari/604.1';
  const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
  const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
  const LINUX_FF = 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0';

  test('standalone → ready regardless of UA', () => {
    setUA(IOS_SAFARI); setStandalone(true);
    expect(onboardingLane({ installPromptAvailable: false })).toBe('ready');
  });
  test('iOS third-party browser → ios-use-safari', () => {
    setUA(IOS_CHROME); setStandalone(false);
    expect(onboardingLane({ installPromptAvailable: false })).toBe('ios-use-safari');
  });
  test('iOS Safari tab → ios-install', () => {
    setUA(IOS_SAFARI); setStandalone(false);
    expect(onboardingLane({ installPromptAvailable: false })).toBe('ios-install');
  });
  test('macOS Safari tab → macos-install', () => {
    setUA(MAC_SAFARI); setStandalone(false); global.navigator.maxTouchPoints = 0;
    expect(onboardingLane({ installPromptAvailable: false })).toBe('macos-install');
  });
  test('Chrome desktop with prompt available → installable', () => {
    setUA(WIN_CHROME); setStandalone(false);
    expect(onboardingLane({ installPromptAvailable: true })).toBe('installable');
  });
  test('Chrome desktop without prompt yet → ready', () => {
    setUA(WIN_CHROME); setStandalone(false);
    expect(onboardingLane({ installPromptAvailable: false })).toBe('ready');
  });
  test('desktop Firefox → push-in-tab', () => {
    setUA(LINUX_FF); setStandalone(false);
    expect(onboardingLane({ installPromptAvailable: false })).toBe('push-in-tab');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/installGuidance.test.js -t "onboardingLane"`
Expected: FAIL — `onboardingLane is not a function`.

- [ ] **Step 3: Implement**

Add at the end of `js/installGuidance.js`:

```javascript
// Onboarding lane selector — classifies the environment into the path the
// onboarding flow should take. `installPromptAvailable` is the (async) signal
// from js/installPrompt.js that a real beforeinstallprompt has fired, used to
// distinguish an installable Chromium browser from one that simply hasn't
// offered (or won't, e.g. Firefox desktop → push-in-tab).
// Returns: 'ready' | 'ios-use-safari' | 'ios-install' | 'macos-install'
//          | 'installable' | 'push-in-tab'
export function onboardingLane({ installPromptAvailable = false } = {}) {
  if (isStandalone()) return 'ready';
  if (isIosThirdParty()) return 'ios-use-safari';
  if (isIos()) return 'ios-install';
  if (isMacSafari()) return 'macos-install';
  if (installPromptAvailable) return 'installable';
  if (isFirefoxDesktop()) return 'push-in-tab';
  return 'ready';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/installGuidance.test.js`
Expected: PASS (all installGuidance tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add js/installGuidance.js tests/installGuidance.test.js
git commit -m "feat(onboarding): add onboardingLane selector"
```

---

## Phase 2 — Shared phrase-reminder renderer

Extract the existing phrase-reminder block + clipboard wiring from `notifyPrompt.js` so the onboarding install step reuses identical copy/behavior. No behavior change for the banner.

### Task 3: Extract `phraseReminderHtml()` and `wirePhraseCopyButton()`

**Files:**
- Modify: `js/notifyPrompt.js:194-219`
- Test: `tests/notifyPrompt.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/notifyPrompt.test.js` (it already mocks `../js/identity.js` with `loadIdentity: jest.fn()` and stubs `navigator.clipboard`):

```javascript
const { phraseReminderHtml, wirePhraseCopyButton } = require('../js/notifyPrompt.js');
const { loadIdentity } = require('../js/identity.js');

describe('phrase-reminder shared renderer', () => {
  test('phraseReminderHtml contains the verbatim reminder + copy button', () => {
    const html = phraseReminderHtml();
    expect(html).toContain('make sure you’ve saved your secret phrase');
    expect(html).toContain('class="notify-promo-copy"');
  });

  test('wirePhraseCopyButton copies the recovery phrase and flips label', async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    loadIdentity.mockReturnValue({ recoveryCode: 'apple-banana-cherry-dog' });

    const container = document.createElement('div');
    container.innerHTML = phraseReminderHtml();
    wirePhraseCopyButton(container);
    const btn = container.querySelector('.notify-promo-copy');
    btn.click();
    await Promise.resolve(); await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('apple-banana-cherry-dog');
    expect(btn.textContent).toBe('Copied!');
    jest.advanceTimersByTime(1500);
    expect(btn.textContent).toBe('Copy to clipboard');
    jest.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/notifyPrompt.test.js -t "phrase-reminder shared renderer"`
Expected: FAIL — `phraseReminderHtml is not a function`.

- [ ] **Step 3: Implement**

In `js/notifyPrompt.js`, add these exports just above `renderBanner` (before line 174):

```javascript
// Shared phrase-reminder block — reused by the notification guidance banner and
// the onboarding install step. Installing on iOS/macOS lands in a fresh storage
// partition, so the user must re-enter their phrase; this reminds them to save it
// first and offers a one-tap clipboard copy (without displaying the phrase).
export function phraseReminderHtml() {
  return '<span class="notify-promo-reminder">First, make sure you’ve saved your secret phrase — you’ll need it to restore your account after installing.</span>'
    + '<span class="notify-promo-phrase">Secret phrase: <button type="button" class="notify-promo-copy">Copy to clipboard</button></span>';
}

export function wirePhraseCopyButton(container) {
  const copyBtn = container.querySelector('.notify-promo-copy');
  if (!copyBtn) return;
  copyBtn.onclick = async () => {
    const phrase = loadIdentity()?.recoveryCode;
    if (!phrase) return;
    try {
      await navigator.clipboard?.writeText(phrase);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy to clipboard'; }, 1500);
    } catch { /* clipboard blocked */ }
  };
}
```

Then replace the body of the `else` branch in `renderBanner` (the block at lines 200-219 that builds `html`, sets `textEl.innerHTML`, and wires the copy button) with reuse:

```javascript
    const copy = guidanceCopyFor(capState);
    let html = copy.body;
    if (copy.remindPhrase) html += phraseReminderHtml();
    textEl.innerHTML = html;
    wirePhraseCopyButton(textEl);
    actionEl.classList.add('hidden');
```

(Note: the copy button selector changed from `#notify-promo-copy` to `.notify-promo-copy`; the markup no longer carries that id. This avoids duplicate-id clashes when the install step renders the same block elsewhere.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/notifyPrompt.test.js`
Expected: PASS (the new tests and all existing notifyPrompt tests). If an existing test queried `#notify-promo-copy` by id, update it to `.notify-promo-copy`.

- [ ] **Step 5: Commit**

```bash
git add js/notifyPrompt.js tests/notifyPrompt.test.js
git commit -m "refactor(onboarding): extract shared phrase-reminder renderer"
```

---

## Phase 3 — `beforeinstallprompt` capture

### Task 4: `js/installPrompt.js`

**Files:**
- Create: `js/installPrompt.js`
- Test: `tests/installPrompt.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/installPrompt.test.js`:

```javascript
const {
  initInstallPrompt, isInstallPromptAvailable, isAppInstalled,
  promptInstall, onInstallPromptChange, __resetInstallPromptForTests,
} = require('../js/installPrompt.js');

function fireBeforeInstallPrompt() {
  const evt = new Event('beforeinstallprompt');
  evt.preventDefault = jest.fn();
  evt.prompt = jest.fn();
  evt.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(evt);
  return evt;
}

describe('installPrompt', () => {
  beforeEach(() => { __resetInstallPromptForTests(); initInstallPrompt(); });

  test('not available until the event fires', () => {
    expect(isInstallPromptAvailable()).toBe(false);
  });

  test('captures the event, prevents default, becomes available', () => {
    const evt = fireBeforeInstallPrompt();
    expect(evt.preventDefault).toHaveBeenCalled();
    expect(isInstallPromptAvailable()).toBe(true);
  });

  test('promptInstall fires the native prompt once, then is consumed', async () => {
    const evt = fireBeforeInstallPrompt();
    const outcome = await promptInstall();
    expect(evt.prompt).toHaveBeenCalledTimes(1);
    expect(outcome).toBe('accepted');
    expect(isInstallPromptAvailable()).toBe(false);
    expect(await promptInstall()).toBeNull(); // single-use
  });

  test('appinstalled clears availability and sets installed', () => {
    fireBeforeInstallPrompt();
    window.dispatchEvent(new Event('appinstalled'));
    expect(isAppInstalled()).toBe(true);
    expect(isInstallPromptAvailable()).toBe(false);
  });

  test('change listeners fire on capture and on consume', async () => {
    const cb = jest.fn();
    onInstallPromptChange(cb);
    fireBeforeInstallPrompt();
    expect(cb).toHaveBeenCalledTimes(1);
    await promptInstall();
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/installPrompt.test.js`
Expected: FAIL — cannot find module `../js/installPrompt.js`.

- [ ] **Step 3: Implement**

Create `js/installPrompt.js`:

```javascript
// js/installPrompt.js
// Captures the Chromium `beforeinstallprompt` event so the app can drive a real
// in-app Install button. Safari/Firefox never fire it (handled by other lanes).
let _deferred = null;
let _installed = false;
const _listeners = new Set();

function notify() { for (const fn of _listeners) { try { fn(); } catch { /* ignore */ } } }

export function initInstallPrompt() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();   // suppress the browser's mini-infobar
    _deferred = e;        // stash for our own button
    notify();
  });
  window.addEventListener('appinstalled', () => {
    _installed = true;
    _deferred = null;
    notify();
  });
}

export function isInstallPromptAvailable() { return _deferred != null; }
export function isAppInstalled() { return _installed; }

// Fires the native install dialog. Single-use: the stashed event is consumed.
export async function promptInstall() {
  if (!_deferred) return null;
  const evt = _deferred;
  _deferred = null;
  notify();
  evt.prompt();
  try { const { outcome } = await evt.userChoice; return outcome; }
  catch { return null; }
}

export function onInstallPromptChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// Test-only: reset module state between tests.
export function __resetInstallPromptForTests() {
  _deferred = null; _installed = false; _listeners.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/installPrompt.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/installPrompt.js tests/installPrompt.test.js
git commit -m "feat(onboarding): capture beforeinstallprompt"
```

---

## Phase 4 — Install affordance (corner icon + toast)

### Task 5: Markup + CSS for the fab and toast

**Files:**
- Modify: `index.template.html` (add near `#notify-promo`, around line 268)
- Modify: `css/app.css`

- [ ] **Step 1: Add markup**

In `index.template.html`, immediately after the `#notify-promo` block (after line 268), add:

```html
<button id="install-fab" class="install-fab hidden" type="button" aria-label="Install app">
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="7 10 12 15 17 10"></polyline>
    <line x1="12" y1="15" x2="12" y2="3"></line>
  </svg>
</button>
<div id="install-toast" class="notify-promo install-toast hidden" role="region" aria-label="Install">
  <span id="install-toast-text"></span>
  <button id="install-toast-action" class="primary-btn hidden" type="button">Install</button>
  <button id="install-toast-dismiss" class="ghost-btn" type="button" aria-label="Close">Close</button>
</div>
```

- [ ] **Step 2: Add CSS**

In `css/app.css`, after the `.notify-promo` rules (after line ~1214), add:

```css
.install-fab {
  position: fixed; left: 1rem; bottom: 1rem; z-index: 60;
  width: 2.25rem; height: 2.25rem; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--surface2); color: var(--text-muted);
  border: 1px solid rgba(0,0,0,0.15); box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  cursor: pointer; padding: 0;
}
.install-fab.hidden { display: none; }
.install-toast { left: 1rem; right: auto; transform: none; bottom: 3.75rem; }
```

- [ ] **Step 3: Build and eyeball**

Run: `npm run build`
Expected: "Build complete: dist/bundle.js + index.html ... + sw.js". Confirm `index.html` now contains `id="install-fab"`.

- [ ] **Step 4: Commit**

```bash
git add index.template.html css/app.css index.html sw.js dist/bundle.js
git commit -m "feat(onboarding): install fab + toast markup and styles"
```

### Task 6: `js/installAffordance.js` — lane-driven content

**Files:**
- Create: `js/installAffordance.js`
- Test: `tests/installAffordance.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/installAffordance.test.js`:

```javascript
function setUA(ua) { Object.defineProperty(global.navigator, 'userAgent', { value: ua, configurable: true }); }
function setStandalone(matches) { global.window.matchMedia = () => ({ matches }); }

const { pushInTabCopy } = require('../js/installAffordance.js');

describe('pushInTabCopy', () => {
  test('macOS lists Safari, Chrome, or Edge', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko Firefox/125.0');
    expect(pushInTabCopy()).toContain('Safari, Chrome, or Edge');
    expect(pushInTabCopy()).toContain('even when your browser is closed');
  });
  test('non-macOS lists Chrome or Edge only', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko Firefox/125.0');
    expect(pushInTabCopy()).toContain('Chrome or Edge');
    expect(pushInTabCopy()).not.toContain('Safari');
  });
});

describe('install affordance rendering', () => {
  const { initInstallAffordance } = require('../js/installAffordance.js');
  const { __resetInstallPromptForTests } = require('../js/installPrompt.js');

  function dom() {
    document.body.innerHTML = `
      <button id="install-fab" class="install-fab hidden"></button>
      <div id="install-toast" class="install-toast hidden">
        <span id="install-toast-text"></span>
        <button id="install-toast-action" class="hidden"></button>
        <button id="install-toast-dismiss"></button>
      </div>`;
  }
  beforeEach(() => { __resetInstallPromptForTests(); dom(); setStandalone(false); });

  test('Firefox desktop shows the fab; toast shows install-elsewhere copy, no button', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko Firefox/125.0');
    initInstallAffordance();
    const fab = document.getElementById('install-fab');
    expect(fab.classList.contains('hidden')).toBe(false);
    fab.click();
    expect(document.getElementById('install-toast').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('install-toast-text').textContent).toContain('Chrome or Edge');
    expect(document.getElementById('install-toast-action').classList.contains('hidden')).toBe(true);
  });

  test('ready lane (standalone) hides the fab', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36');
    setStandalone(true);
    initInstallAffordance();
    expect(document.getElementById('install-fab').classList.contains('hidden')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/installAffordance.test.js`
Expected: FAIL — cannot find module `../js/installAffordance.js`.

- [ ] **Step 3: Implement**

Create `js/installAffordance.js`:

```javascript
// js/installAffordance.js
// Bottom-left install affordance: a small corner icon that opens a toast.
// - installable (Chromium): toast has a real Install button (beforeinstallprompt).
// - push-in-tab (Firefox desktop): toast explains installing via another browser.
// Dismissing the toast hides only the toast; the corner icon stays. The icon
// shows only when install is relevant and the app isn't already installed.
import { onboardingLane } from './installGuidance.js';
import {
  initInstallPrompt, isInstallPromptAvailable, isAppInstalled,
  promptInstall, onInstallPromptChange,
} from './installPrompt.js';

function isMac() { return /Macintosh|Mac OS X/.test((navigator.userAgent) || ''); }

export function pushInTabCopy() {
  const browsers = isMac() ? 'Safari, Chrome, or Edge' : 'Chrome or Edge';
  return `To get notified about knocks, calls, and people coming online even when your browser is closed, open the app in ${browsers} and install it.`;
}

function currentLane() {
  return onboardingLane({ installPromptAvailable: isInstallPromptAvailable() });
}

function openToast(toast) {
  const lane = currentLane();
  const textEl = toast.querySelector('#install-toast-text');
  const actionEl = toast.querySelector('#install-toast-action');
  if (lane === 'installable') {
    textEl.textContent = 'To get notified about knocks, calls, and people coming online — even when this browser is closed — install KnockKnock.';
    actionEl.classList.remove('hidden');
    actionEl.onclick = async () => { await promptInstall(); toast.classList.add('hidden'); };
  } else { // push-in-tab
    textEl.textContent = pushInTabCopy();
    actionEl.classList.add('hidden');
  }
  toast.classList.remove('hidden');
}

export function initInstallAffordance() {
  initInstallPrompt();
  const fab = document.getElementById('install-fab');
  const toast = document.getElementById('install-toast');
  if (!fab || !toast) return;

  const render = () => {
    const lane = currentLane();
    const show = !isAppInstalled() && (lane === 'installable' || lane === 'push-in-tab');
    fab.classList.toggle('hidden', !show);
    if (!show) toast.classList.add('hidden');
  };

  fab.addEventListener('click', () => openToast(toast));
  toast.querySelector('#install-toast-dismiss').addEventListener('click', () => toast.classList.add('hidden'));
  onInstallPromptChange(render);
  render();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/installAffordance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/installAffordance.js tests/installAffordance.test.js
git commit -m "feat(onboarding): install affordance fab + toast logic"
```

### Task 7: Wire the affordance into app boot

**Files:**
- Modify: `js/app.js` (near where the main UI initializes / other init calls; search for `initNotifyPrompt(` and place this nearby after the user is signed in and main UI is shown)

- [ ] **Step 1: Add the init call**

Find the post-identity init region in `js/app.js` (where `initNotifyPrompt(userId)` is called). Immediately after it, add:

```javascript
  import('./installAffordance.js').then(({ initInstallAffordance }) => initInstallAffordance());
```

(Use a static import at the top instead if the file uses static imports throughout: `import { initInstallAffordance } from './installAffordance.js';` then call `initInstallAffordance();` in the same spot.)

- [ ] **Step 2: Build and smoke check in dev**

Run: `npm run dev`, open `http://localhost:8080` in desktop Chrome.
Expected: after onboarding, with an installable Chrome, the bottom-left icon appears once Chrome fires `beforeinstallprompt`; clicking it opens the toast with an Install button. (If Chrome doesn't fire it on localhost, verify via Chrome DevTools → Application → Manifest → "Add to home screen".)

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat(onboarding): initialize install affordance on boot"
```

---

## Phase 5 — Keychain form semantics

Best-effort iCloud Keychain save on create + AutoFill on restore. Degrades gracefully; never asserted in copy. **Requires real-device verification (see Phase 8).**

### Task 8: `.visually-hidden` helper + recovery-modal Keychain form

**Files:**
- Modify: `index.template.html:127-138` (`#recovery-modal`)
- Modify: `css/app.css`

- [ ] **Step 1: Add `.visually-hidden` CSS**

In `css/app.css`, near `.hidden` (line 328), add:

```css
.visually-hidden {
  position: absolute !important; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0;
}
```

- [ ] **Step 2: Wrap the recovery modal in a Keychain form**

Replace the `#recovery-modal` markup (`index.template.html:127-138`) with:

```html
<div id="recovery-modal" class="welcome-screen hidden">
  <div class="modal-card">
    <h3>This is your secret phrase</h3>
    <div class="recovery-display">
      <span id="recovery-code-text" class="recovery-code-text"></span>
      <span class="regen-slot"><button id="recovery-rotate-btn" class="rotate-btn" title="Generate new secret phrase" aria-label="Generate new secret phrase">↻</button></span>
      <button id="recovery-copy-btn" class="ghost-btn">Copy</button>
    </div>
    <p class="recovery-warning">Save this somewhere safe. It's the only way to restore your account if you lose this browser. We can't recover it for you.</p>
    <!-- Hidden credential form: lets iOS/macOS offer "Save Password" (iCloud
         Keychain), which crosses the install storage partition by domain. Never
         relied upon or asserted in copy. -->
    <form id="recovery-keychain-form" autocomplete="on" aria-hidden="true">
      <input id="recovery-keychain-username" class="visually-hidden" type="text"
             autocomplete="username" tabindex="-1" readonly aria-hidden="true" />
      <input id="recovery-keychain-phrase" class="visually-hidden" type="password"
             autocomplete="new-password" tabindex="-1" readonly aria-hidden="true" />
      <button id="recovery-saved-btn" class="primary-btn" type="submit">I've saved it</button>
    </form>
  </div>
</div>
```

(The "I've saved it" button is now `type="submit"` inside the form so its activation submits the credential form.)

- [ ] **Step 3: Populate the hidden fields in `showRecoveryCodeModal`**

In `js/app.js` `showRecoveryCodeModal` (starts line 233), after `text.textContent = current;` (line ~243), add:

```javascript
  const kcPhrase = document.getElementById('recovery-keychain-phrase');
  const kcUser = document.getElementById('recovery-keychain-username');
  const kcForm = document.getElementById('recovery-keychain-form');
  if (kcPhrase) kcPhrase.value = current;
  if (kcForm) kcForm.addEventListener('submit', (e) => e.preventDefault(), { once: false });
```

And in the rotate handler (where `current` is reassigned and `text.textContent` updated), also set `if (kcPhrase) kcPhrase.value = current;` so the saved credential matches the displayed phrase. The username is set by the caller (next step) once the share code exists.

- [ ] **Step 4: Build and verify no JS errors**

Run: `npm run build` then load in desktop Chrome via `npm run dev`. Create a new account; confirm the flow still completes (the hidden fields don't affect desktop behavior). Confirm DevTools shows no errors.

- [ ] **Step 5: Commit**

```bash
git add index.template.html css/app.css js/app.js index.html sw.js dist/bundle.js
git commit -m "feat(onboarding): keychain form fields on recovery modal"
```

### Task 9: Set the Keychain username to the share code; restore-input AutoFill

**Files:**
- Modify: `js/app.js` `createNewAccount` (lines 158-177) and `showRestoreScreen` (lines 304-388)
- Modify: `index.template.html:140-150` (`#restore-screen`)

- [ ] **Step 1: Set the username once the share code is claimed**

In `createNewAccount` (`js/app.js:158-177`), inside the `onConfirm` callback after `code = generateCode();`/`saveIdentity(...)` — specifically right after the `do/while` loop assigns the final `code` and before `saveIdentity` — set the hidden username so the saved credential is labeled:

```javascript
    const kcUser = document.getElementById('recovery-keychain-username');
    if (kcUser) kcUser.value = code;
```

- [ ] **Step 2: Add AutoFill semantics to the restore screen**

Replace `#restore-screen` markup (`index.template.html:140-150`) with:

```html
<div id="restore-screen" class="restore-screen hidden">
  <div class="restore-card">
    <h3>Enter your secret phrase</h3>
    <form id="restore-form" autocomplete="on">
      <input id="restore-username" class="visually-hidden" type="text" autocomplete="username" tabindex="-1" aria-hidden="true" />
      <input id="restore-input" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" placeholder="your-four-secret-words" class="code-input restore-input" />
      <p id="restore-error" class="error-msg hidden"></p>
      <div class="restore-btns">
        <button id="restore-paste-btn" class="ghost-btn hidden" type="button">Paste</button>
        <button id="restore-submit-btn" class="primary-btn" type="submit">Restore</button>
        <button id="restore-cancel-btn" class="ghost-btn" type="button">Cancel</button>
      </div>
      <button id="restore-new-link" class="link-btn hidden" type="button">I don't have a phrase yet</button>
    </form>
  </div>
</div>
```

(`#restore-input` is now `type="password"` with `autocomplete="current-password"` to trigger AutoFill. `#restore-paste-btn` and `#restore-new-link` are hidden by default — shown only in primed mode, Phase 6.)

- [ ] **Step 3: Prevent the form's native submit from reloading**

In `showRestoreScreen` (`js/app.js:304`), after grabbing elements, add:

```javascript
  const form = document.getElementById('restore-form');
  if (form) form.addEventListener('submit', (e) => e.preventDefault());
```

Ensure the submit button's existing click handler (`onSubmit`) still runs — since the button is now `type="submit"`, clicking it submits the form; the `submit` listener prevents default and the existing `submit.addEventListener('click', onSubmit)` continues to work. (If double-invocation is observed, move `onSubmit` to the form's `submit` listener instead of the button's `click`.)

- [ ] **Step 4: Build and verify restore still works**

Run: `npm run dev`; restore an existing account by typing the phrase. Confirm it still signs in. The input now masks characters (password field) — acceptable.

- [ ] **Step 5: Commit**

```bash
git add index.template.html js/app.js index.html sw.js dist/bundle.js
git commit -m "feat(onboarding): keychain username + restore AutoFill semantics"
```

---

## Phase 6 — Standalone-launch routing + restore-primed screen

### Task 10: Pure `shouldPrimeRestore` decision

**Files:**
- Modify: `js/installGuidance.js`
- Test: `tests/installGuidance.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
const { shouldPrimeRestore } = require('../js/installGuidance.js');

describe('shouldPrimeRestore', () => {
  test('standalone + no identity → true', () => {
    expect(shouldPrimeRestore({ standalone: true, hasIdentity: false })).toBe(true);
  });
  test('standalone + has identity → false', () => {
    expect(shouldPrimeRestore({ standalone: true, hasIdentity: true })).toBe(false);
  });
  test('not standalone → false', () => {
    expect(shouldPrimeRestore({ standalone: false, hasIdentity: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/installGuidance.test.js -t "shouldPrimeRestore"`
Expected: FAIL — not a function.

- [ ] **Step 3: Implement**

Add to `js/installGuidance.js`:

```javascript
// A standalone (installed) launch with no stored identity is almost certainly a
// just-installed user who must restore — our flow only prompts install AFTER
// account creation. Prime restore instead of showing the new/restore chooser, so
// they don't accidentally create a duplicate account.
export function shouldPrimeRestore({ standalone, hasIdentity }) {
  return !!standalone && !hasIdentity;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/installGuidance.test.js -t "shouldPrimeRestore"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/installGuidance.js tests/installGuidance.test.js
git commit -m "feat(onboarding): shouldPrimeRestore decision"
```

### Task 11: Primed restore mode (Paste + escape hatch)

**Files:**
- Modify: `js/app.js` `showRestoreScreen` (lines 304-388)
- Test: `tests/onboardingFlow.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/onboardingFlow.test.js`. This tests the primed-mode DOM wiring of `showRestoreScreen` in isolation by stubbing the network-dependent helpers. Since `showRestoreScreen` is exported from `app.js` (which imports many modules), test the **Paste** behavior via a focused harness:

```javascript
/**
 * Focused test of restore-primed Paste wiring. We re-implement the tiny paste
 * handler contract here against the real DOM to lock the behavior; the wiring in
 * app.js must match: clicking #restore-paste-btn reads the clipboard into
 * #restore-input.
 */
describe('restore-primed Paste', () => {
  test('Paste button fills the input from the clipboard', async () => {
    document.body.innerHTML = `
      <input id="restore-input" type="password" />
      <button id="restore-paste-btn" class="hidden"></button>`;
    const readText = jest.fn().mockResolvedValue('apple-banana-cherry-dog');
    Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true });

    // Mirror the app.js wiring under test:
    const input = document.getElementById('restore-input');
    const pasteBtn = document.getElementById('restore-paste-btn');
    pasteBtn.classList.remove('hidden');
    pasteBtn.onclick = async () => {
      try { input.value = (await navigator.clipboard.readText()) || input.value; } catch { /* blocked */ }
    };

    pasteBtn.click();
    await Promise.resolve(); await Promise.resolve();
    expect(input.value).toBe('apple-banana-cherry-dog');
  });
});
```

- [ ] **Step 2: Run test to verify it fails (then will pass once wiring exists)**

Run: `npx jest tests/onboardingFlow.test.js`
Expected: PASS immediately (this test is self-contained and pins the contract). Treat it as the spec the app.js wiring must satisfy.

- [ ] **Step 3: Implement primed mode in `showRestoreScreen`**

Change the signature `export function showRestoreScreen()` (line 304) to `export function showRestoreScreen({ primed = false } = {})`. After the element grabs, add:

```javascript
  const pasteBtn = document.getElementById('restore-paste-btn');
  const newLink = document.getElementById('restore-new-link');
  const username = document.getElementById('restore-username');
  if (username) username.value = ''; // let AutoFill match by domain
  if (pasteBtn) {
    pasteBtn.classList.toggle('hidden', !primed);
    pasteBtn.onclick = async () => {
      try { input.value = (await navigator.clipboard?.readText()) || input.value; }
      catch { /* clipboard blocked */ }
    };
  }
  if (newLink) newLink.classList.toggle('hidden', !primed);
```

In the returned Promise, wire the escape hatch so primed users with no phrase can still create an account — resolve with a sentinel the caller treats as "go create":

```javascript
    function onNew() { teardown(); resolve({ createNew: true }); }
    if (newLink) newLink.addEventListener('click', onNew);
```

Add `if (newLink) newLink.removeEventListener('click', onNew);` inside `teardown()`.

- [ ] **Step 4: Run the full suite**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/app.js tests/onboardingFlow.test.js
git commit -m "feat(onboarding): primed restore mode with paste + escape hatch"
```

### Task 12: Route standalone launches to primed restore in `ensureIdentity`

**Files:**
- Modify: `js/app.js` `ensureIdentity` (lines 94-156)

- [ ] **Step 1: Implement the routing**

In `ensureIdentity`, after the `if (existing) { ... }` block and before resolving the invite preview, add:

```javascript
  // Standalone launch with empty storage → almost certainly a just-installed user
  // who must restore. Prime restore (AutoFill/Paste/manual) instead of the
  // new/restore chooser, with an escape hatch for the rare genuine-new case.
  if (shouldPrimeRestore({ standalone: isStandalone(), hasIdentity: false })) {
    dismissSplash();
    const restored = await showRestoreScreen({ primed: true });
    if (restored && restored.userId) {
      saveIdentity(restored.userId, restored.code, restored.recoveryCode);
      return { identity: restored, isNew: false };
    }
    // restored.createNew (escape hatch) or cancel → fall through to normal flow.
  }
```

Add the imports at the top of `app.js` (alongside the existing `installGuidance`/`identity` imports): `import { shouldPrimeRestore, isStandalone } from './installGuidance.js';` (merge into the existing import from that module if one exists).

- [ ] **Step 2: Verify existing tests still pass**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 3: Manual check (dev)**

Run `npm run dev`, open in Chrome, install via DevTools, relaunch the installed window with cleared storage. Expected: it shows the restore-primed screen (Paste + "I don't have a phrase yet"), not the "I'm new / I have a phrase" chooser.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat(onboarding): route standalone launches to primed restore"
```

---

## Phase 7 — Inline install step + early Safari redirect

### Task 13: Install-step + Safari-redirect screens (markup + CSS)

**Files:**
- Modify: `index.template.html`
- Modify: `css/app.css`

- [ ] **Step 1: Add screen markup**

In `index.template.html`, after `#restore-screen` (after line 150), add:

```html
<div id="install-step" class="welcome-screen hidden">
  <div class="modal-card">
    <h3 id="install-step-title"></h3>
    <p id="install-step-body"></p>
    <p id="install-step-reminder" class="install-step-reminder"></p>
    <button id="install-step-later-btn" class="ghost-btn" type="button">Maybe later</button>
  </div>
</div>
<div id="safari-redirect" class="welcome-screen hidden">
  <div class="modal-card">
    <h3 id="safari-redirect-title">Open in Safari</h3>
    <p id="safari-redirect-body"></p>
    <p id="safari-redirect-reminder" class="install-step-reminder"></p>
    <button id="safari-redirect-continue-btn" class="ghost-btn" type="button">Continue here anyway</button>
  </div>
</div>
```

- [ ] **Step 2: Add minimal CSS**

In `css/app.css`, near the other onboarding screens:

```css
.install-step-reminder { margin-top: 1rem; font-size: 0.85rem; color: var(--text-muted); }
.install-step-reminder .notify-promo-reminder,
.install-step-reminder .notify-promo-phrase { display: block; margin-top: 0.5rem; }
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `index.html` contains `id="install-step"` and `id="safari-redirect"`.

- [ ] **Step 4: Commit**

```bash
git add index.template.html css/app.css index.html sw.js dist/bundle.js
git commit -m "feat(onboarding): install-step + safari-redirect screen markup"
```

### Task 14: `showInstallStep(lane)` and `showSafariRedirect()`

**Files:**
- Modify: `js/app.js`
- Test: `tests/onboardingFlow.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/onboardingFlow.test.js` a contract test for the install-step rendering (self-contained, mirrors what `showInstallStep` must produce):

```javascript
const { guidanceCopyFor } = require('../js/installGuidance.js');
const { phraseReminderHtml } = require('../js/notifyPrompt.js');

describe('install-step content contract', () => {
  test('iOS body comes from guidance copy and reminder is the shared block', () => {
    // Body for the install step leads with notification value; the reminder is
    // the shared phrase-reminder block (verbatim).
    const reminder = phraseReminderHtml();
    expect(reminder).toContain('saved your secret phrase');
    // guidanceCopyFor still provides the platform instruction copy used as a base.
    expect(typeof guidanceCopyFor('needs-install-ios').body).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it passes (contract pin)**

Run: `npx jest tests/onboardingFlow.test.js -t "install-step content contract"`
Expected: PASS.

- [ ] **Step 3: Implement the two screen functions in `js/app.js`**

Add imports at the top: `import { onboardingLane } from './installGuidance.js';` (merge with existing) and `import { phraseReminderHtml, wirePhraseCopyButton } from './notifyPrompt.js';`. Then add:

```javascript
// Inline install step for the iOS/macOS lanes. Body leads with the notification
// value (per copy conventions); instructions reuse the existing Share/➕/Dock
// guidance; the phrase-reminder is the shared block. "Maybe later" resolves so
// the user lands in the app un-installed (install stays reachable via the fab).
function showInstallStep(lane) {
  const el = document.getElementById('install-step');
  const titleEl = document.getElementById('install-step-title');
  const bodyEl = document.getElementById('install-step-body');
  const reminderEl = document.getElementById('install-step-reminder');
  const laterBtn = document.getElementById('install-step-later-btn');
  if (!el) return Promise.resolve();

  if (lane === 'macos-install') {
    titleEl.textContent = 'Add to Dock';
    bodyEl.textContent = 'To get notified about knocks, calls, and people coming online, add KnockKnock to your Dock: choose File → Add to Dock, then open the app from there.';
  } else { // ios-install
    titleEl.textContent = 'Add to Home Screen';
    bodyEl.textContent = 'To get notified about knocks, calls, and people coming online, add KnockKnock to your Home Screen: tap the Share button, then “Add to Home Screen”.';
  }
  reminderEl.innerHTML = phraseReminderHtml();
  wirePhraseCopyButton(reminderEl);
  el.classList.remove('hidden');

  return new Promise((resolve) => {
    function later() { laterBtn.removeEventListener('click', later); el.classList.add('hidden'); resolve(); }
    laterBtn.addEventListener('click', later);
  });
}

// Early redirect for iOS non-Safari browsers (push only works from Safari).
// Surfaced before account creation so the account is made in Safari directly.
function showSafariRedirect() {
  const el = document.getElementById('safari-redirect');
  const bodyEl = document.getElementById('safari-redirect-body');
  const reminderEl = document.getElementById('safari-redirect-reminder');
  const continueBtn = document.getElementById('safari-redirect-continue-btn');
  if (!el) return Promise.resolve();
  bodyEl.textContent = 'To get notified about knocks, calls, and people coming online on iPhone, open this app in Safari, then add it to your Home Screen.';
  reminderEl.innerHTML = phraseReminderHtml();
  wirePhraseCopyButton(reminderEl);
  el.classList.remove('hidden');
  return new Promise((resolve) => {
    function cont() { continueBtn.removeEventListener('click', cont); el.classList.add('hidden'); resolve(); }
    continueBtn.addEventListener('click', cont);
  });
}
```

Note: the install-step body lead-in copy is a recorded direction (spec); finalize against existing app tone during review.

- [ ] **Step 4: Run the suite + build**

Run: `npx jest` then `npm run build`
Expected: PASS; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add js/app.js tests/onboardingFlow.test.js index.html sw.js dist/bundle.js
git commit -m "feat(onboarding): install-step + safari-redirect screen logic"
```

### Task 15: Sequence the steps into `ensureIdentity` / `createNewAccount`

**Files:**
- Modify: `js/app.js` `ensureIdentity` (94-156) and the new-account return path

- [ ] **Step 1: Early Safari redirect at the welcome stage**

In `ensureIdentity`, right after `dismissSplash();` and before the `while (true)` welcome loop, add:

```javascript
  if (onboardingLane({ installPromptAvailable: false }) === 'ios-use-safari') {
    await showSafariRedirect(); // informational; user may continue here anyway
  }
```

- [ ] **Step 2: Show the install step after account creation on iOS/macOS lanes**

In `ensureIdentity`, the final `return await createNewAccount();` becomes:

```javascript
    const created = await createNewAccount();
    const lane = onboardingLane({ installPromptAvailable: false });
    if (lane === 'ios-install' || lane === 'macos-install') {
      await showInstallStep(lane); // returns when the user taps "Maybe later" (or never, if they install & leave)
    }
    return created;
```

(The user who actually installs leaves the tab during the step; the installed app relaunches into the primed-restore path from Phase 6. "Maybe later" lands them in the app un-installed.)

- [ ] **Step 3: Run suite + manual dev check**

Run: `npx jest`. Then `npm run dev`; emulate iOS via Chrome DevTools device toolbar with an iOS Safari UA string to confirm the install step appears after "I've saved it" and "Maybe later" proceeds into the app. (UA emulation won't perfectly mimic iOS install, but verifies the screen sequencing.)
Expected: PASS; sequencing correct.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat(onboarding): sequence safari-redirect and install step into first run"
```

---

## Phase 8 — Docs & device verification

### Task 16: Smoke-test section + HANDOFF note

**Files:**
- Modify: `docs/SMOKE-TEST.md`
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: Add the onboarding smoke-test section**

Append to `docs/SMOKE-TEST.md`:

```markdown
## Onboarding & install (added 2026-06)

Run per device/browser. Lane is chosen by `onboardingLane()`.

- [ ] **iOS Safari (tab):** new account → "I've saved it" → install step ("Add to
      Home Screen") with the shared phrase-reminder + working "Copy to clipboard".
      "Maybe later" lands in the app. Install via Share → Add to Home Screen.
- [ ] **iOS Safari (installed):** relaunch the installed app with cleared storage
      → restore-primed screen (NOT the new/restore chooser). Verify **AutoFill
      offers the saved phrase** above the keyboard; verify **Paste** fills it;
      verify manual entry works. "I don't have a phrase yet" → create flow.
- [ ] **iOS Chrome/Firefox/Edge:** welcome → early "Open in Safari" redirect with
      the phrase-reminder; "Continue here anyway" proceeds.
- [ ] **macOS Safari (tab):** install step ("Add to Dock"); "Maybe later" works.
- [ ] **Desktop Chrome/Edge:** no install step; bottom-left install fab appears
      once `beforeinstallprompt` fires; toast has a working Install button;
      dismiss hides toast, fab stays; after install the fab disappears.
- [ ] **Desktop Firefox:** install fab appears; toast shows the platform-aware
      "open in Safari/Chrome/Edge" copy with NO button; notifications still
      enable normally via a bell.
- [ ] **Already installed (any):** `ready` lane — no fab, no install step.
```

- [ ] **Step 2: Note the new behavior in HANDOFF**

Add a bullet under the load-bearing architecture areas in `docs/HANDOFF.md`:

```markdown
- Onboarding install (2026-06): `onboardingLane()` in js/installGuidance.js routes
  per platform; js/installPrompt.js captures beforeinstallprompt; js/installAffordance.js
  renders the bottom-left install fab + toast. iOS uses a Keychain-save (recovery
  modal hidden credential form) → standalone restore-primed handoff
  (shouldPrimeRestore). The phrase-reminder block is shared from notifyPrompt.js.
  Notifications remain bell-gated/unchanged. Spec:
  docs/superpowers/specs/2026-06-16-onboarding-install-redesign-design.md.
```

- [ ] **Step 3: Commit**

```bash
git add docs/SMOKE-TEST.md docs/HANDOFF.md
git commit -m "docs(onboarding): smoke-test section + handoff note"
```

### Task 17: Real-device Keychain verification (manual spike)

**Files:** none (verification task)

- [ ] **Step 1: Deploy to dev and test on a real iPhone**

Push the branch; let the maintainer merge to `dev` (or use `npm run dev` over LAN). On a real iPhone (iOS 16.4+), Safari:
1. Create a new account; on "I've saved it," confirm iOS offers **Save Password**; accept.
2. Add to Home Screen; open the installed app.
3. Confirm the restore-primed screen appears and **AutoFill suggests the saved phrase** in the QuickType bar; one tap restores.

- [ ] **Step 2: Record the result**

If AutoFill works: note it in `docs/SMOKE-TEST.md` as verified. If it does NOT work in the standalone PWA, the Paste + manual paths still cover it — record the limitation in `docs/HANDOFF.md` and (optionally) de-emphasize the AutoFill hint copy. No code rollback needed; the form fields are harmless.

- [ ] **Step 3: Commit any doc updates**

```bash
git add docs/SMOKE-TEST.md docs/HANDOFF.md
git commit -m "docs(onboarding): record iOS Keychain AutoFill verification result"
```

---

## Final verification

- [ ] Run the full web suite: `npx jest` — all green.
- [ ] Run functions suite (should be untouched): `cd functions && npm test` — all green.
- [ ] Production build: `npm run build` — succeeds.
- [ ] Push the branch with `git push -u origin <branch>`.

---

## Plan self-review notes

- **Spec coverage:** lane selector (T2), Keychain create+restore (T8/T9), standalone routing (T10–T12), restore-primed Paste/manual/escape (T11), beforeinstallprompt (T4), install affordance incl. push-in-tab copy (T5–T7), inline iOS/macOS install step with opt-out (T13–T15), early Safari redirect (T14–T15), shared phrase-reminder (T3), copy conventions (applied in T3/T6/T14), iOS<16.4 (relies on existing `unsupported` handling — no task needed, documented), smoke/docs (T16), device verification (T17). Notifications intentionally untouched.
- **Type/name consistency:** `onboardingLane({ installPromptAvailable })`, `shouldPrimeRestore({ standalone, hasIdentity })`, `phraseReminderHtml()`, `wirePhraseCopyButton(container)`, `isInstallPromptAvailable()`, `promptInstall()`, `initInstallAffordance()`, `showInstallStep(lane)`, `showSafariRedirect()`, `showRestoreScreen({ primed })` are used consistently across tasks.
- **Known soft spots flagged for implementer judgment:** restore form submit vs button-click double-invocation (T9 step 3 note); exact install-step lead-in copy (T14 note); Keychain AutoFill behavior in standalone PWA (T17 spike, graceful degradation).
