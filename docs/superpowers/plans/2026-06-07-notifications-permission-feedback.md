# Notifications Permission Feedback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bell's silent permission call with an `ensureNotificationsReady()` flow that always gives feedback (prompt / blocked / install-guidance) by reusing the existing promo banner, so toggling a bell never fails silently.

**Architecture:** One new exported function in `js/notifyPrompt.js` that branches on `detectNotifyCapability()`: when supported it runs the existing `requestPermissionAndRegister()`, otherwise (or on denial) it explicitly shows the `#notify-promo` banner for that capability state via the existing private `renderBanner()`, bypassing the engagement/dismissal gating. The two bell call sites (`following.js`, `groupContext.js`) swap their `onNeedPermission` from `requestPermissionAndRegister` to `ensureNotificationsReady`.

**Tech Stack:** Vanilla ES modules, Jest + jsdom.

**Spec:** `docs/superpowers/specs/2026-06-07-notifications-permission-feedback-design.md`.

---

## File structure
- **Modify:** `js/notifyPrompt.js` — add `ensureNotificationsReady()` + private `showBannerForState()`.
- **Modify:** `js/following.js`, `js/groupContext.js` — point the bell's `onNeedPermission` at `ensureNotificationsReady`.
- **Test:** `tests/notifyPrompt.test.js` (new tests + mock `installGuidance.js`), `tests/following.test.js` + `tests/groupContext.test.js` (update the `notifyPrompt` mock).

---

## Task 1: `ensureNotificationsReady()` in `notifyPrompt.js`

**Files:**
- Modify: `js/notifyPrompt.js`
- Test: `tests/notifyPrompt.test.js`

- [ ] **Step 1: Add the installGuidance mock + failing tests**

At the top of `tests/notifyPrompt.test.js`, add a mock for `installGuidance.js` (alongside the existing `jest.mock` calls). This is safe — the existing `shouldShowPromo` / `requestPermissionAndRegister` / `refreshPushToken` tests don't call `detectNotifyCapability`/`guidanceCopyFor`:

```js
jest.mock('../js/installGuidance.js', () => ({
  detectNotifyCapability: jest.fn(),
  guidanceCopyFor: jest.fn((s) => ({ body: `copy-for-${s}` })),
}));
```

Then append the test block:

```js
const { ensureNotificationsReady } = require('../js/notifyPrompt.js');
const { detectNotifyCapability } = require('../js/installGuidance.js');

function mountBanner() {
  document.body.innerHTML =
    '<div id="notify-promo" class="notify-promo hidden">' +
    '<span id="notify-promo-text"></span>' +
    '<button id="notify-promo-action" class="primary-btn hidden"></button>' +
    '<button id="notify-promo-dismiss"></button></div>';
}

describe('ensureNotificationsReady', () => {
  beforeEach(() => {
    addPushToken.mockClear(); getToken.mockReset(); getMessagingIfSupported.mockReset();
    detectNotifyCapability.mockReset();
    mountBanner();
    global.Notification = { permission: 'default', requestPermission: jest.fn().mockResolvedValue('granted') };
    global.navigator.serviceWorker = { ready: Promise.resolve({ id: 'reg' }) };
    getMessagingIfSupported.mockResolvedValue({});
    getToken.mockResolvedValue('tok-1');
  });

  test('supported → runs the permission/register flow, no banner', async () => {
    detectNotifyCapability.mockReturnValue({ state: 'supported', supported: true });
    await ensureNotificationsReady();
    expect(addPushToken).toHaveBeenCalledWith('tok-1');
    expect(document.getElementById('notify-promo').classList.contains('hidden')).toBe(true);
  });

  test('already denied → shows blocked banner, no permission request, no token', async () => {
    detectNotifyCapability.mockReturnValue({ state: 'denied', supported: false });
    await ensureNotificationsReady();
    expect(global.Notification.requestPermission).not.toHaveBeenCalled();
    expect(addPushToken).not.toHaveBeenCalled();
    const banner = document.getElementById('notify-promo');
    expect(banner.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('notify-promo-text').textContent).toBe('copy-for-denied');
  });

  test('needs-install (iOS) → shows install-guidance banner', async () => {
    detectNotifyCapability.mockReturnValue({ state: 'needs-install-ios', supported: false });
    await ensureNotificationsReady();
    expect(addPushToken).not.toHaveBeenCalled();
    const banner = document.getElementById('notify-promo');
    expect(banner.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('notify-promo-text').textContent).toBe('copy-for-needs-install-ios');
  });

  test('supported but the user denies the prompt → shows blocked banner', async () => {
    detectNotifyCapability
      .mockReturnValueOnce({ state: 'supported', supported: true })   // initial check
      .mockReturnValueOnce({ state: 'denied', supported: false });    // re-check after denial
    global.Notification.requestPermission = jest.fn().mockResolvedValue('denied');
    await ensureNotificationsReady();
    expect(addPushToken).not.toHaveBeenCalled();
    expect(document.getElementById('notify-promo').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('notify-promo-text').textContent).toBe('copy-for-denied');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/notifyPrompt.test.js -t ensureNotificationsReady`
Expected: FAIL — `ensureNotificationsReady is not a function`.

- [ ] **Step 3: Implement in `js/notifyPrompt.js`**

Append (after `refreshPushToken` / `dismissPromoForever`). It reuses the existing private `renderBanner(banner, capState)` and the existing `requestPermissionAndRegister`:

```js
// Explicitly show the promo banner for a capability state, bypassing the
// engagement/dismissal gating used by the passive promo — the user just asked
// for notifications, so we always show how to get them.
function showBannerForState(capState) {
  const banner = document.getElementById('notify-promo');
  if (!banner) return;
  renderBanner(banner, capState);
  banner.classList.remove('hidden');
}

// Called when a user turns a per-person bell on. Always gives feedback: prompts
// when push is available, otherwise (or on denial) surfaces the right guidance.
export async function ensureNotificationsReady() {
  const cap = detectNotifyCapability();
  if (cap.state === 'supported') {
    const ok = await requestPermissionAndRegister();
    if (!ok) showBannerForState(detectNotifyCapability().state);
    return;
  }
  showBannerForState(cap.state);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/notifyPrompt.test.js`
Expected: PASS (whole file — the 4 new tests plus the existing ones).

- [ ] **Step 5: Commit**

```bash
git add js/notifyPrompt.js tests/notifyPrompt.test.js
git commit -m "feat(notifyPrompt): ensureNotificationsReady — always-feedback enable flow"
```

---

## Task 2: Point the bells at `ensureNotificationsReady`

**Files:**
- Modify: `js/following.js`, `js/groupContext.js`
- Test: `tests/following.test.js`, `tests/groupContext.test.js`

- [ ] **Step 1: Update the test mocks (RED)**

In **both** `tests/following.test.js` and `tests/groupContext.test.js`, change the `notifyPrompt` mock from `requestPermissionAndRegister` to `ensureNotificationsReady`:

```js
jest.mock('../js/notifyPrompt.js', () => ({ ensureNotificationsReady: jest.fn() }));
```

- [ ] **Step 2: Run to verify the suites still load**

Run: `npx jest tests/following.test.js tests/groupContext.test.js`
Expected: PASS — `createNotifyBell` is mocked in both suites, so the `onNeedPermission` lambda is never invoked; this step just confirms the mock swap doesn't break loading. (It already passes; the real change is the source edit below, which has no behavioral test because the callback only runs against real DOM in the browser.)

- [ ] **Step 3: Update `js/following.js`**

Change the import (it currently imports `requestPermissionAndRegister` from `./notifyPrompt.js`):

```js
import { ensureNotificationsReady } from './notifyPrompt.js';
```

And the bell's callback inside `createFolloweeRow`:

```js
    const bell = createNotifyBell(entry.userId, {
      onNeedPermission: () => { ensureNotificationsReady().catch(() => {}); },
    });
```

- [ ] **Step 4: Update `js/groupContext.js`**

Same two changes — import:

```js
import { ensureNotificationsReady } from './notifyPrompt.js';
```

And the bell's callback inside `renderRoster`:

```js
      const bell = createNotifyBell(uid, {
        onNeedPermission: () => { ensureNotificationsReady().catch(() => {}); },
      });
```

> If the actual import/callback text differs slightly from above, match the existing `requestPermissionAndRegister` references and replace them with `ensureNotificationsReady`.

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: PASS (no regressions; count unchanged except Task 1's new tests).

- [ ] **Step 6: Commit**

```bash
git add js/following.js js/groupContext.js tests/following.test.js tests/groupContext.test.js
git commit -m "feat(notifications): bells use ensureNotificationsReady (no silent permission failure)"
```

---

## Deploy note
Changes `dist/bundle.js` (shell asset) → **recommend** an `sw.js` `CACHE` bump (currently `knockknock-v5`) at deploy — recommend, not auto.
