# Presence Notifications — Client Opt-in Surface — Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the entire user-facing opt-in surface for PWA push notifications — feature flag, per-person notification preferences, push-token registration, the platform-aware promo, install guidance, the per-person bell UI, and the service-worker push/click handlers — all testable in the existing jsdom harness, behind `NOTIFICATIONS_ENABLED`.

**Architecture:** Pure-logic modules (capability detection, prompt-state decisions, payload shaping) are unit-tested directly; the thin FCM/permission/SW glue mirrors them. Notification prefs + push tokens route through the existing `prefs.js` → `mergeUserPrefs` pipeline (no new `db.js` export, so no db-mock churn). A shared `notifyBell.js` component is consumed by both the Direct list (`following.js`) and the group roster (`groupContext.js`).

**Tech Stack:** Vanilla ES modules, esbuild, Firebase modular SDK (`firebase/messaging` v12.10.0, already installed), Jest + jsdom, babel-jest.

**Companion spec:** `docs/superpowers/specs/2026-06-05-presence-notifications-design.md`. This is Plan 1 of 2; Plan 2 (`/functions` server delivery) is written separately.

---

## File structure

**Create:**
- `js/installGuidance.js` — platform/capability detection + A2HS guidance copy. **Not** feature-gated.
- `js/notifyPrompt.js` — promo banner state machine + permission request + FCM token registration.
- `js/notifyBell.js` — shared per-person bell + 3-switch popover component.
- `tests/installGuidance.test.js`, `tests/notifyPrompt.test.js`, `tests/notifyBell.test.js`, `tests/sw.test.js`

**Modify:**
- `js/features.js` — add `NOTIFICATIONS_ENABLED`.
- `js/prefs.js` — notify-pref + push-token API + `notify-prefs-synced` sync.
- `js/firebase-config.js` — export `app`; add a guarded messaging handle.
- `js/following.js:437-571` — bell in `createFolloweeRow`.
- `js/groupContext.js:121-184` — bell in `renderRoster`.
- `js/app.js:455-469, 633-635` — init prompt, capture SW registration, foreground `onMessage`.
- `index.template.html:247-250 area` — promo banner markup.
- `sw.js` — `push` + `notificationclick` handlers.
- `css/app.css` — bell, popover, banner styles.
- `scripts/build.js:24-32` — add `FIREBASE_VAPID_KEY`.
- `tests/prefs.test.js`, `tests/following.test.js`, `tests/groupContext.test.js` — extend.

---

## Task 1: Add the `NOTIFICATIONS_ENABLED` feature flag

**Files:**
- Modify: `js/features.js`

- [ ] **Step 1: Add the flag (default off)**

Append after the `GROUPS_ENABLED` line in `js/features.js`:

```js
export const NOTIFICATIONS_ENABLED = false; // Plan 1/2 gate; flip to true at deploy time once the server (Plan 2) is live.
```

- [ ] **Step 2: Verify the suite is unaffected**

Run: `npx jest`
Expected: PASS (current count). Adding an export breaks nothing; partial `features.js` mocks resolve the new flag to `undefined`/falsy until a test opts in.

- [ ] **Step 3: Commit**

```bash
git add js/features.js
git commit -m "feat: add NOTIFICATIONS_ENABLED feature flag (default off)"
```

---

## Task 2: `prefs.js` — per-person notification preferences

**Files:**
- Modify: `js/prefs.js`
- Test: `tests/prefs.test.js`

Notify prefs cache as a single JSON map in localStorage so reads stay synchronous; writes hit `userPrefs/{uid}/notify/{targetUid}/{type}` via the existing `mergeUserPrefs`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/prefs.test.js` (it already `jest.mock('../js/db.js', ...)` with `mergeUserPrefs: jest.fn()`):

```js
const {
  initPrefs, getNotifyPrefs, setNotifyPref, syncFromServer,
} = require('../js/prefs.js');
const { mergeUserPrefs } = require('../js/db.js');

describe('notify prefs', () => {
  beforeEach(() => { localStorage.clear(); mergeUserPrefs.mockClear(); initPrefs('me123'); });

  test('default is all-off for an unknown target', () => {
    expect(getNotifyPrefs('alex')).toEqual({ knock: false, call: false, availability: false });
  });

  test('setNotifyPref updates the local cache synchronously', () => {
    setNotifyPref('alex', 'knock', true);
    expect(getNotifyPrefs('alex')).toEqual({ knock: true, call: false, availability: false });
  });

  test('setNotifyPref writes the single field to userPrefs/notify/{target}/{type}', () => {
    setNotifyPref('alex', 'availability', true);
    expect(mergeUserPrefs).toHaveBeenCalledWith('me123', { 'notify/alex/availability': true });
  });

  test('syncFromServer repopulates the cache and dispatches notify-prefs-synced', () => {
    const handler = jest.fn();
    document.addEventListener('notify-prefs-synced', handler);
    syncFromServer({ notify: { bea: { knock: true, call: false, availability: true } } });
    expect(getNotifyPrefs('bea')).toEqual({ knock: true, call: false, availability: true });
    expect(handler).toHaveBeenCalled();
    document.removeEventListener('notify-prefs-synced', handler);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/prefs.test.js -t "notify prefs"`
Expected: FAIL — `getNotifyPrefs is not a function`.

- [ ] **Step 3: Implement in `js/prefs.js`**

Add near the other localStorage key constants:

```js
const NOTIFY_KEY = 'statusapp_notify_prefs';

function readNotifyCache() {
  try { return JSON.parse(localStorage.getItem(NOTIFY_KEY)) || {}; }
  catch { return {}; }
}
function writeNotifyCache(map) {
  try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(map)); } catch { /* quota */ }
}

export function getNotifyPrefs(targetUid) {
  const t = readNotifyCache()[targetUid] || {};
  return { knock: !!t.knock, call: !!t.call, availability: !!t.availability };
}

export function setNotifyPref(targetUid, type, on) {
  const map = readNotifyCache();
  map[targetUid] = { ...getNotifyPrefs(targetUid), [type]: !!on };
  writeNotifyCache(map);
  if (_myUserId) mergeUserPrefs(_myUserId, { [`notify/${targetUid}/${type}`]: !!on }).catch(() => {});
}
```

Also extend the `HINT_KEYS` map (prefs.js line ~36) so the promo's "don't show again" hint resolves (without this, `markHintSeen('notifyPromo')` / `isHintSeen('notifyPromo')` are no-ops):

```js
  notifyPromo: 'statusapp_seen_notify_promo',
```

Inside `syncFromServer`, before the closing `}` (current line 315), add:

```js
  // Notification preferences (per-person knock/call/availability)
  if (serverPrefs.notify && typeof serverPrefs.notify === 'object') {
    const map = readNotifyCache();
    for (const [targetUid, prefs] of Object.entries(serverPrefs.notify)) {
      map[targetUid] = {
        knock: !!prefs?.knock, call: !!prefs?.call, availability: !!prefs?.availability,
      };
    }
    writeNotifyCache(map);
    document.dispatchEvent(new CustomEvent('notify-prefs-synced'));
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/prefs.test.js -t "notify prefs"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/prefs.js tests/prefs.test.js
git commit -m "feat(prefs): per-person notification preferences with cross-device sync"
```

---

## Task 3: `prefs.js` — push-token registry

**Files:**
- Modify: `js/prefs.js`
- Test: `tests/prefs.test.js`

- [ ] **Step 1: Write the failing tests**

```js
const { addPushToken, removePushToken, getRegisteredPushToken } = require('../js/prefs.js');

describe('push tokens', () => {
  beforeEach(() => { localStorage.clear(); mergeUserPrefs.mockClear(); initPrefs('me123'); });

  test('addPushToken writes the token record and records it locally', () => {
    addPushToken('tok-abc');
    expect(mergeUserPrefs).toHaveBeenCalledWith('me123',
      expect.objectContaining({ 'pushTokens/tok-abc': expect.objectContaining({ createdAt: expect.any(Number) }) }));
    expect(getRegisteredPushToken()).toBe('tok-abc');
  });

  test('removePushToken nulls the path and clears the local record', () => {
    addPushToken('tok-abc'); mergeUserPrefs.mockClear();
    removePushToken('tok-abc');
    expect(mergeUserPrefs).toHaveBeenCalledWith('me123', { 'pushTokens/tok-abc': null });
    expect(getRegisteredPushToken()).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/prefs.test.js -t "push tokens"`
Expected: FAIL — `addPushToken is not a function`.

- [ ] **Step 3: Implement in `js/prefs.js`**

```js
const PUSH_TOKEN_KEY = 'statusapp_push_token';

export function getRegisteredPushToken() {
  return localStorage.getItem(PUSH_TOKEN_KEY) || null;
}

export function addPushToken(token) {
  if (!token) return;
  try { localStorage.setItem(PUSH_TOKEN_KEY, token); } catch { /* quota */ }
  if (_myUserId) {
    mergeUserPrefs(_myUserId, {
      [`pushTokens/${token}`]: { createdAt: Date.now(), ua: navigator.userAgent || '' },
    }).catch(() => {});
  }
}

export function removePushToken(token) {
  if (!token) return;
  if (localStorage.getItem(PUSH_TOKEN_KEY) === token) localStorage.removeItem(PUSH_TOKEN_KEY);
  if (_myUserId) mergeUserPrefs(_myUserId, { [`pushTokens/${token}`]: null }).catch(() => {});
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/prefs.test.js -t "push tokens"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/prefs.js tests/prefs.test.js
git commit -m "feat(prefs): push-token registry helpers"
```

---

## Task 4: `installGuidance.js` — capability detection

**Files:**
- Create: `js/installGuidance.js`
- Test: `tests/installGuidance.test.js`

Detection returns one capability state. **This module is never gated by `NOTIFICATIONS_ENABLED`.**

- [ ] **Step 1: Write the failing tests**

Create `tests/installGuidance.test.js`:

```js
// tests/installGuidance.test.js
const { detectNotifyCapability } = require('../js/installGuidance.js');

function setUA(ua) {
  Object.defineProperty(global.navigator, 'userAgent', { value: ua, configurable: true });
}
function setStandalone(matches) {
  global.window.matchMedia = () => ({ matches });
}
beforeEach(() => {
  setStandalone(false);
  global.window.PushManager = function () {};
  global.window.Notification = { permission: 'default' };
  global.navigator.serviceWorker = {};
  delete global.navigator.standalone;
});

test('desktop Chrome with Push API → supported', () => {
  setUA('Mozilla/5.0 (Windows NT 10.0) Chrome/120');
  expect(detectNotifyCapability().state).toBe('supported');
});

test('permission already denied → denied', () => {
  setUA('Mozilla/5.0 (Windows NT 10.0) Chrome/120');
  global.window.Notification = { permission: 'denied' };
  expect(detectNotifyCapability().state).toBe('denied');
});

test('iOS Safari tab (no Push API, not standalone) → needs-install-ios', () => {
  setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari');
  delete global.window.PushManager;
  expect(detectNotifyCapability().state).toBe('needs-install-ios');
});

test('iOS Chrome (CriOS) → ios-use-safari', () => {
  setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/120 Mobile');
  delete global.window.PushManager;
  expect(detectNotifyCapability().state).toBe('ios-use-safari');
});

test('iOS Safari installed (standalone, Push API present) → supported', () => {
  setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari');
  setStandalone(true);
  expect(detectNotifyCapability().state).toBe('supported');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/installGuidance.test.js`
Expected: FAIL — cannot find module `../js/installGuidance.js`.

- [ ] **Step 3: Implement `js/installGuidance.js`**

```js
// js/installGuidance.js
// Platform/capability detection + Add-to-Home-Screen guidance.
// NOT gated by NOTIFICATIONS_ENABLED — installing is valuable on its own.

export function isStandalone() {
  if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
  try { return window.matchMedia('(display-mode: standalone)').matches; }
  catch { return false; }
}

export function isPushApiAvailable() {
  return typeof window !== 'undefined'
    && 'PushManager' in window
    && 'Notification' in window
    && typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator;
}

function ua() { return (typeof navigator !== 'undefined' && navigator.userAgent) || ''; }
function isIos() { return /iPhone|iPad|iPod/.test(ua()) || (/Macintosh/.test(ua()) && 'ontouchend' in (typeof document !== 'undefined' ? document : {})); }
function isIosThirdParty() { return isIos() && /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua()); }

// Returns { state, supported } where state is one of:
// 'supported' | 'denied' | 'needs-install-ios' | 'ios-use-safari' | 'unsupported'
export function detectNotifyCapability() {
  if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'denied') {
    return { state: 'denied', supported: false };
  }
  if (isPushApiAvailable()) return { state: 'supported', supported: true };
  if (isIosThirdParty()) return { state: 'ios-use-safari', supported: false };
  if (isIos() && !isStandalone()) return { state: 'needs-install-ios', supported: false };
  return { state: 'unsupported', supported: false };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/installGuidance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/installGuidance.js tests/installGuidance.test.js
git commit -m "feat: installGuidance capability detection (platform matrix)"
```

---

## Task 5: `installGuidance.js` — guidance copy

**Files:**
- Modify: `js/installGuidance.js`
- Test: `tests/installGuidance.test.js`

- [ ] **Step 1: Write the failing test**

```js
const { guidanceCopyFor } = require('../js/installGuidance.js');

test('guidanceCopyFor maps each state to a non-empty message', () => {
  expect(guidanceCopyFor('needs-install-ios').body).toMatch(/Home Screen/i);
  expect(guidanceCopyFor('ios-use-safari').body).toMatch(/Safari/i);
  expect(guidanceCopyFor('denied').body).toMatch(/settings/i);
});

test('iOS install copy includes the secret-phrase reminder flag', () => {
  expect(guidanceCopyFor('needs-install-ios').remindPhrase).toBe(true);
  expect(guidanceCopyFor('denied').remindPhrase).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/installGuidance.test.js -t guidanceCopyFor`
Expected: FAIL — `guidanceCopyFor is not a function`.

- [ ] **Step 3: Implement (append to `js/installGuidance.js`)**

```js
const COPY = {
  'needs-install-ios': {
    title: 'Add to Home Screen',
    body: 'On iPhone, notifications need the app on your Home Screen. Tap the Share button, then “Add to Home Screen.”',
    remindPhrase: true,
  },
  'ios-use-safari': {
    title: 'Open in Safari',
    body: 'On iPhone, notifications only work from Safari. Open this app in Safari, then tap Share → “Add to Home Screen.”',
    remindPhrase: true,
  },
  'denied': {
    title: 'Notifications are blocked',
    body: 'Notifications are turned off for this site. Re-enable them in your browser settings to use them here.',
    remindPhrase: false,
  },
  'unsupported': {
    title: 'Notifications unavailable',
    body: 'This browser doesn’t support web notifications.',
    remindPhrase: false,
  },
};

export function guidanceCopyFor(state) {
  return COPY[state] || COPY.unsupported;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/installGuidance.test.js -t guidanceCopyFor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/installGuidance.js tests/installGuidance.test.js
git commit -m "feat: installGuidance A2HS guidance copy + phrase reminder flag"
```

---

## Task 6: `firebase-config.js` — export app + messaging handle

**Files:**
- Modify: `js/firebase-config.js`

No unit test (thin SDK wiring; covered indirectly by Task 8's mocks).

- [ ] **Step 1: Implement**

Change line 15 and add a guarded messaging accessor:

```js
import { getMessaging, isSupported } from 'firebase/messaging';
// ...
export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

let _messaging = null;
// Returns a Messaging instance, or null where unsupported (e.g. iOS Safari tab).
export async function getMessagingIfSupported() {
  try {
    if (_messaging) return _messaging;
    if (!(await isSupported())) return null;
    _messaging = getMessaging(app);
    return _messaging;
  } catch { return null; }
}
```

- [ ] **Step 2: Verify the build still compiles**

Run: `node scripts/dev-build.js`
Expected: build completes with no esbuild errors (it will substitute `REPLACE_ME` for missing env without `.env.local`; that's fine).

- [ ] **Step 3: Commit**

```bash
git add js/firebase-config.js
git commit -m "feat(firebase-config): export app + guarded messaging accessor"
```

---

## Task 7: `notifyPrompt.js` — banner-state decision (pure)

**Files:**
- Create: `js/notifyPrompt.js`
- Test: `tests/notifyPrompt.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/notifyPrompt.test.js`. The mocks at the top are mandatory even for the pure test: `notifyPrompt.js` imports `./prefs.js` and `./firebase-config.js` at module load, and `firebase-config.js` calls `initializeApp` — mocking these prevents real Firebase init during the test.

```js
// tests/notifyPrompt.test.js
jest.mock('../js/prefs.js', () => ({
  isHintSeen: jest.fn(() => false),
  markHintSeen: jest.fn(),
  addPushToken: jest.fn(),
}));
jest.mock('../js/firebase-config.js', () => ({ getMessagingIfSupported: jest.fn() }));
jest.mock('firebase/messaging', () => ({ getToken: jest.fn() }));

const { shouldShowPromo } = require('../js/notifyPrompt.js');

test('hidden when feature flag off', () => {
  expect(shouldShowPromo({ enabled: false, hintSeen: false, engaged: true, capState: 'supported', permission: 'default' })).toBe(false);
});
test('hidden when hint already dismissed forever', () => {
  expect(shouldShowPromo({ enabled: true, hintSeen: true, engaged: true, capState: 'supported', permission: 'default' })).toBe(false);
});
test('hidden until the user is engaged', () => {
  expect(shouldShowPromo({ enabled: true, hintSeen: false, engaged: false, capState: 'supported', permission: 'default' })).toBe(false);
});
test('hidden when permission already granted', () => {
  expect(shouldShowPromo({ enabled: true, hintSeen: false, engaged: true, capState: 'supported', permission: 'granted' })).toBe(false);
});
test('hidden when permission is denied (no nagging)', () => {
  expect(shouldShowPromo({ enabled: true, hintSeen: false, engaged: true, capState: 'denied', permission: 'denied' })).toBe(false);
});
test('shown for an engaged, unseen, supported, ungranted user', () => {
  expect(shouldShowPromo({ enabled: true, hintSeen: false, engaged: true, capState: 'supported', permission: 'default' })).toBe(true);
});
test('shown for iOS-install state (install nudge counts)', () => {
  expect(shouldShowPromo({ enabled: true, hintSeen: false, engaged: true, capState: 'needs-install-ios', permission: 'default' })).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/notifyPrompt.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the pure decision in `js/notifyPrompt.js`**

```js
// js/notifyPrompt.js
import { NOTIFICATIONS_ENABLED } from './features.js';
import { isHintSeen, markHintSeen, addPushToken } from './prefs.js';
import { detectNotifyCapability, guidanceCopyFor } from './installGuidance.js';
import { getMessagingIfSupported } from './firebase-config.js';

const PROMO_HINT = 'notifyPromo';

// Pure: decide whether the promo banner should be shown.
export function shouldShowPromo({ enabled, hintSeen, engaged, capState, permission }) {
  if (!enabled) return false;
  if (hintSeen) return false;
  if (!engaged) return false;
  if (permission === 'granted') return false;
  if (capState === 'denied') return false;
  if (capState === 'unsupported') return false;
  return true; // 'supported' | 'needs-install-ios' | 'ios-use-safari'
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/notifyPrompt.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/notifyPrompt.js tests/notifyPrompt.test.js
git commit -m "feat(notifyPrompt): pure banner-state decision"
```

---

## Task 8: `notifyPrompt.js` — permission request + token registration

**Files:**
- Modify: `js/notifyPrompt.js`
- Test: `tests/notifyPrompt.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `tests/notifyPrompt.test.js` (the `jest.mock` calls for `prefs.js`, `firebase-config.js`, and `firebase/messaging` are already at the top of the file from Task 7 — do not duplicate them):

```js
const { requestPermissionAndRegister } = require('../js/notifyPrompt.js');
const { addPushToken } = require('../js/prefs.js');
const { getMessagingIfSupported } = require('../js/firebase-config.js');
const { getToken } = require('firebase/messaging');

describe('requestPermissionAndRegister', () => {
  beforeEach(() => {
    addPushToken.mockClear(); getToken.mockReset(); getMessagingIfSupported.mockReset();
    global.Notification = { requestPermission: jest.fn().mockResolvedValue('granted') };
    global.navigator.serviceWorker = { ready: Promise.resolve({ id: 'reg' }) };
  });

  test('grants, fetches a token, and registers it', async () => {
    getMessagingIfSupported.mockResolvedValue({});
    getToken.mockResolvedValue('tok-xyz');
    const ok = await requestPermissionAndRegister();
    expect(ok).toBe(true);
    expect(addPushToken).toHaveBeenCalledWith('tok-xyz');
  });

  test('returns false and registers nothing when permission denied', async () => {
    global.Notification.requestPermission.mockResolvedValue('denied');
    const ok = await requestPermissionAndRegister();
    expect(ok).toBe(false);
    expect(addPushToken).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/notifyPrompt.test.js -t requestPermissionAndRegister`
Expected: FAIL — `requestPermissionAndRegister is not a function`.

- [ ] **Step 3: Implement (append to `js/notifyPrompt.js`)**

```js
import { getToken } from 'firebase/messaging';

const VAPID_KEY = process.env.FIREBASE_VAPID_KEY;

// Requests OS permission, obtains an FCM token against the existing SW, registers it.
// Returns true on success.
export async function requestPermissionAndRegister() {
  if (typeof Notification === 'undefined') return false;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  const messaging = await getMessagingIfSupported();
  if (!messaging) return false;
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) return false;
  addPushToken(token);
  return true;
}

export function dismissPromoForever() { markHintSeen(PROMO_HINT); }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/notifyPrompt.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add js/notifyPrompt.js tests/notifyPrompt.test.js
git commit -m "feat(notifyPrompt): permission request + FCM token registration"
```

---

## Task 9: `notifyBell.js` — shared per-person bell + popover

**Files:**
- Create: `js/notifyBell.js`
- Test: `tests/notifyBell.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/notifyBell.test.js`:

```js
// tests/notifyBell.test.js
jest.mock('../js/prefs.js', () => ({
  getNotifyPrefs: jest.fn(() => ({ knock: false, call: false, availability: false })),
  setNotifyPref: jest.fn(),
}));
const { createNotifyBell } = require('../js/notifyBell.js');
const { getNotifyPrefs, setNotifyPref } = require('../js/prefs.js');

beforeEach(() => {
  document.body.innerHTML = '';
  getNotifyPrefs.mockReturnValue({ knock: false, call: false, availability: false });
  setNotifyPref.mockClear();
});

test('renders a focusable button (not a div)', () => {
  const bell = createNotifyBell('alex', {});
  expect(bell.tagName).toBe('BUTTON');
  expect(bell.classList.contains('notify-bell')).toBe(true);
});

test('clicking the bell opens a popover with three switches', () => {
  const bell = createNotifyBell('alex', {});
  document.body.appendChild(bell);
  bell.click();
  const popover = document.querySelector('.notify-popover');
  expect(popover).not.toBeNull();
  expect(popover.querySelectorAll('button[role="switch"]').length).toBe(3);
});

test('toggling a switch writes the pref', () => {
  const bell = createNotifyBell('alex', {});
  document.body.appendChild(bell);
  bell.click();
  document.querySelector('[data-type="knock"]').click();
  expect(setNotifyPref).toHaveBeenCalledWith('alex', 'knock', true);
});

test('turning a switch on calls onNeedPermission', () => {
  const onNeedPermission = jest.fn();
  const bell = createNotifyBell('alex', { onNeedPermission });
  document.body.appendChild(bell);
  bell.click();
  document.querySelector('[data-type="call"]').click();
  expect(onNeedPermission).toHaveBeenCalled();
});

test('bell shows active state when any pref is on', () => {
  getNotifyPrefs.mockReturnValue({ knock: true, call: false, availability: false });
  const bell = createNotifyBell('alex', {});
  expect(bell.classList.contains('active')).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/notifyBell.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `js/notifyBell.js`**

```js
// js/notifyBell.js
// Shared per-person notification bell + 3-switch popover.
// Consumed by following.js (Direct) and groupContext.js (group roster).
import { getNotifyPrefs, setNotifyPref } from './prefs.js';

const TYPES = [
  { type: 'knock', label: 'Knocks' },
  { type: 'call', label: 'Calls' },
  { type: 'availability', label: 'Available' },
];

let _openPopover = null;
let _outsideHandler = null;

function closeOpenPopover() {
  if (_openPopover) { _openPopover.remove(); _openPopover = null; }
  if (_outsideHandler) { document.removeEventListener('click', _outsideHandler); _outsideHandler = null; }
}

function paintBell(bell, targetUid) {
  const p = getNotifyPrefs(targetUid);
  bell.classList.toggle('active', p.knock || p.call || p.availability);
}

export function createNotifyBell(targetUid, { onNeedPermission } = {}) {
  const bell = document.createElement('button');
  bell.className = 'notify-bell';
  bell.type = 'button';
  bell.setAttribute('aria-label', 'Notification settings');
  bell.textContent = '\u{1F514}'; // 🔔
  paintBell(bell, targetUid);

  bell.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_openPopover && _openPopover.dataset.target === targetUid) { closeOpenPopover(); return; }
    closeOpenPopover();

    const popover = document.createElement('div');
    popover.className = 'notify-popover';
    popover.dataset.target = targetUid;
    const prefs = getNotifyPrefs(targetUid);
    for (const { type, label } of TYPES) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'notify-switch';
      row.setAttribute('role', 'switch');
      row.setAttribute('aria-checked', String(prefs[type]));
      row.dataset.type = type;
      row.textContent = label;
      row.classList.toggle('on', prefs[type]);
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const next = !(getNotifyPrefs(targetUid)[type]);
        setNotifyPref(targetUid, type, next);
        row.setAttribute('aria-checked', String(next));
        row.classList.toggle('on', next);
        paintBell(bell, targetUid);
        if (next && typeof onNeedPermission === 'function') onNeedPermission();
      });
      popover.appendChild(row);
    }
    bell.insertAdjacentElement('afterend', popover);
    _openPopover = popover;

    // Outside-tap dismiss (mirrors groupContext settings handler).
    _outsideHandler = (ev) => {
      if (popover.contains(ev.target) || bell.contains(ev.target)) return;
      closeOpenPopover();
    };
    document.addEventListener('click', _outsideHandler);
  });

  document.addEventListener('notify-prefs-synced', () => paintBell(bell, targetUid));
  return bell;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/notifyBell.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/notifyBell.js tests/notifyBell.test.js
git commit -m "feat: shared notifyBell per-person 3-switch popover"
```

---

## Task 10: Integrate the bell into the Direct list (`following.js`)

**Files:**
- Modify: `js/following.js` (imports near line 20; `createFolloweeRow` near line 452)
- Test: `tests/following.test.js`

- [ ] **Step 1: Extend the test setup + write the failing test**

In `tests/following.test.js`: (a) add `NOTIFICATIONS_ENABLED: true` to the existing `jest.mock('../js/features.js', ...)` factory (line ~25); (b) add a mock for the new module near the other `jest.mock` calls:

```js
jest.mock('../js/notifyBell.js', () => ({
  createNotifyBell: jest.fn(() => {
    const b = document.createElement('button');
    b.className = 'notify-bell';
    return b;
  }),
}));
jest.mock('../js/notifyPrompt.js', () => ({ requestPermissionAndRegister: jest.fn() }));
```

> The `notifyPrompt.js` mock is required: `following.js` imports `requestPermissionAndRegister`, and the real `notifyPrompt.js` transitively loads `firebase-config.js` (`initializeApp`). Mocking it keeps the suite isolated.

Then add a test (mirror the file's existing render-test setup for building a mutual row):

```js
const { createNotifyBell } = require('../js/notifyBell.js');

test('renders a notification bell on a contact row when NOTIFICATIONS_ENABLED', () => {
  // (use the suite's existing helper to render a followee row into #people-list)
  renderMutualRowForTest({ userId: 'alex', code: 'alex-code', label: 'Alex K.' });
  const li = document.querySelector('#people-list li[data-user-id="alex"]');
  expect(createNotifyBell).toHaveBeenCalledWith('alex', expect.any(Object));
  expect(li.querySelector('.notify-bell')).not.toBeNull();
});
```

> Note for the implementer: reuse whatever render entry point the suite already exercises for `createFolloweeRow`; `renderMutualRowForTest` is a placeholder name for that existing helper/flow — do not invent a new one.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/following.test.js -t "notification bell"`
Expected: FAIL — no `.notify-bell` in the row.

- [ ] **Step 3: Implement**

Add to the imports (after line 22):

```js
import { NOTIFICATIONS_ENABLED } from './features.js';
import { createNotifyBell } from './notifyBell.js';
import { requestPermissionAndRegister } from './notifyPrompt.js';
```

> `NOTIFICATIONS_ENABLED` joins the existing `./features.js` import on line 20 — merge it into that line rather than re-importing.

In `createFolloweeRow`, after the `.unfollow-btn` listener block (after line 461), add:

```js
  if (NOTIFICATIONS_ENABLED) {
    const bell = createNotifyBell(entry.userId, {
      onNeedPermission: () => { requestPermissionAndRegister().catch(() => {}); },
    });
    li.appendChild(bell);
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/following.test.js`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add js/following.js tests/following.test.js
git commit -m "feat(following): per-contact notification bell (gated)"
```

---

## Task 11: Integrate the bell into the group roster (`groupContext.js`)

**Files:**
- Modify: `js/groupContext.js` (imports near line 25; `renderRoster` near line 144)
- Test: `tests/groupContext.test.js`

- [ ] **Step 1: Extend setup + write the failing test**

In `tests/groupContext.test.js`: add `NOTIFICATIONS_ENABLED: true` to its `jest.mock('../js/features.js', ...)` factory, and add:

```js
jest.mock('../js/notifyBell.js', () => ({
  createNotifyBell: jest.fn(() => {
    const b = document.createElement('button'); b.className = 'notify-bell'; return b;
  }),
}));
jest.mock('../js/notifyPrompt.js', () => ({ requestPermissionAndRegister: jest.fn() }));
```

> The `notifyPrompt.js` mock is required for the same reason as Task 10 — `groupContext.js` imports `requestPermissionAndRegister`, which transitively loads `firebase-config.js`.

```js
const { createNotifyBell } = require('../js/notifyBell.js');

test('renders a notification bell on each roster member when NOTIFICATIONS_ENABLED', () => {
  // (use the suite's existing roster-render helper with one member uid 'bea')
  renderRosterForTest({ bea: { displayName: 'Bea' } });
  const li = document.querySelector('#group-roster [data-user-id="bea"]');
  expect(li.querySelector('.notify-bell')).not.toBeNull();
  expect(createNotifyBell).toHaveBeenCalledWith('bea', expect.any(Object));
});
```

> `renderRosterForTest` is a placeholder for the suite's existing roster render flow — reuse it.

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/groupContext.test.js -t "notification bell"`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add imports (after line 25):

```js
import { NOTIFICATIONS_ENABLED } from './features.js';
import { createNotifyBell } from './notifyBell.js';
import { requestPermissionAndRegister } from './notifyPrompt.js';
```

> Merge `NOTIFICATIONS_ENABLED` into the existing line-25 `./features.js` import.

In `renderRoster`, after `li.appendChild(info);` (line 144) and before the `KNOCK_ENABLED` block, add:

```js
    if (NOTIFICATIONS_ENABLED && uid !== ownUserId) {
      const bell = createNotifyBell(uid, {
        onNeedPermission: () => { requestPermissionAndRegister().catch(() => {}); },
      });
      li.appendChild(bell);
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/groupContext.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "feat(groupContext): per-member notification bell (gated)"
```

---

## Task 12: Service-worker `push` + `notificationclick` handlers

**Files:**
- Modify: `sw.js`
- Test: `tests/sw.test.js`

`sw.js` is a plain (non-bundled) file; the test loads it under a mocked `self`.

- [ ] **Step 1: Write the failing test**

Create `tests/sw.test.js`:

```js
// tests/sw.test.js
function loadSwWithMockSelf() {
  const handlers = {};
  const showNotification = jest.fn();
  const matchAll = jest.fn().mockResolvedValue([]);
  const mockSelf = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: jest.fn(),
    clients: { claim: jest.fn(), matchAll, openWindow: jest.fn() },
    registration: { showNotification },
  };
  global.self = mockSelf;
  global.caches = { open: jest.fn().mockResolvedValue({ addAll: jest.fn() }), keys: jest.fn().mockResolvedValue([]) };
  jest.isolateModules(() => { require('../sw.js'); });
  return { handlers, showNotification, matchAll, mockSelf };
}

function pushEvent(data) {
  return { data: { json: () => data }, waitUntil: (p) => p };
}

test('push with no focused client shows a notification', async () => {
  const { handlers, showNotification } = loadSwWithMockSelf();
  await handlers.push(pushEvent({ type: 'knock', title: 'Bea knocked', body: '', targetUid: 'bea' }));
  expect(showNotification).toHaveBeenCalledWith('Bea knocked', expect.objectContaining({ data: expect.objectContaining({ targetUid: 'bea' }) }));
});

test('push is suppressed when a focused client exists (foreground de-dupe)', async () => {
  const { handlers, showNotification, matchAll } = loadSwWithMockSelf();
  matchAll.mockResolvedValue([{ focused: true, visibilityState: 'visible' }]);
  await handlers.push(pushEvent({ type: 'knock', title: 'Bea knocked', body: '', targetUid: 'bea' }));
  expect(showNotification).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/sw.test.js`
Expected: FAIL — `handlers.push is not a function` (no push handler yet).

- [ ] **Step 3: Implement (append to `sw.js`, before EOF)**

```js
self.addEventListener('push', (e) => {
  if (!e.data) return;
  let payload = {};
  try { payload = e.data.json(); } catch { return; }
  e.waitUntil((async () => {
    const focused = (await self.clients.matchAll({ type: 'window' }))
      .some((c) => c.focused || c.visibilityState === 'visible');
    if (focused) return; // foreground de-dupe: the live in-app UI already handled it
    await self.registration.showNotification(payload.title || 'KnockKnock', {
      body: payload.body || '',
      tag: payload.type ? `${payload.type}:${payload.targetUid || ''}` : undefined,
      data: { type: payload.type, targetUid: payload.targetUid, contextGroupId: payload.contextGroupId },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const url = data.contextGroupId ? `/?group=${encodeURIComponent(data.contextGroupId)}` : '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => 'focus' in c);
    if (client) { client.postMessage({ kind: 'notification-click', data }); return client.focus(); }
    return self.clients.openWindow(url);
  })());
});
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/sw.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add sw.js tests/sw.test.js
git commit -m "feat(sw): push + notificationclick handlers with foreground de-dupe"
```

---

## Task 13: App wiring — promo init, SW registration capture, foreground messages

**Files:**
- Modify: `js/app.js` (SW register near line 633; prefs wiring near line 460)

No new unit test (integration glue exercised by the module tests above + manual verification).

- [ ] **Step 1: Implement — capture the SW registration**

Replace lines 633–635:

```js
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      window.__swRegistration = reg;
    }).catch(console.error);
  }
```

- [ ] **Step 2: Implement — init the promo + foreground onMessage**

Add imports near the top of `js/app.js`:

```js
import { NOTIFICATIONS_ENABLED } from './features.js';
import { initNotifyPrompt } from './notifyPrompt.js';
import { getMessagingIfSupported } from './firebase-config.js';
```

> Reuse the existing `./features.js` import if one is already present; merge the flag in.

After the `watchUserPrefs` wiring block (after line 463), add:

```js
  if (NOTIFICATIONS_ENABLED) {
    initNotifyPrompt(userId);
    getMessagingIfSupported().then((messaging) => {
      if (!messaging) return;
      import('firebase/messaging').then(({ onMessage }) => {
        onMessage(messaging, () => { /* foreground: in-app UI already reflects it; no OS toast */ });
      });
    });
  }
```

- [ ] **Step 3: Implement `initNotifyPrompt` in `js/notifyPrompt.js`**

Append:

```js
let _engaged = false;
export function markEngaged() { _engaged = true; maybeShowBanner(); }

let _userId = null;
export function initNotifyPrompt(userId) {
  _userId = userId;
  // Engagement = second session onward (avoid first-ever-load nag).
  const k = 'statusapp_session_seen';
  if (localStorage.getItem(k) === '1') _engaged = true; else localStorage.setItem(k, '1');
  maybeShowBanner();
}

function maybeShowBanner() {
  const cap = detectNotifyCapability();
  const permission = (typeof Notification !== 'undefined' && Notification.permission) || 'default';
  const show = shouldShowPromo({
    enabled: NOTIFICATIONS_ENABLED, hintSeen: isHintSeen(PROMO_HINT),
    engaged: _engaged, capState: cap.state, permission,
  });
  const banner = document.getElementById('notify-promo');
  if (!banner) return;
  if (!show) { banner.classList.add('hidden'); return; }
  renderBanner(banner, cap.state);
  banner.classList.remove('hidden');
}

function renderBanner(banner, capState) {
  const textEl = banner.querySelector('#notify-promo-text');
  const actionEl = banner.querySelector('#notify-promo-action');
  if (capState === 'supported') {
    textEl.textContent = 'Get notified about knocks, calls, and people coming online.';
    actionEl.textContent = 'Enable';
    actionEl.classList.remove('hidden');
    actionEl.onclick = async () => {
      const ok = await requestPermissionAndRegister();
      if (ok) banner.classList.add('hidden');
    };
  } else {
    const copy = guidanceCopyFor(capState);
    textEl.textContent = copy.body;
    actionEl.classList.add('hidden');
  }
  banner.querySelector('#notify-promo-dismiss').onclick = () => {
    dismissPromoForever();
    banner.classList.add('hidden');
  };
}
```

- [ ] **Step 4: Run the suite**

Run: `npx jest`
Expected: PASS (no regressions).

- [ ] **Step 5: Commit**

```bash
git add js/app.js js/notifyPrompt.js
git commit -m "feat(app): wire notify promo, capture SW registration, foreground onMessage"
```

---

## Task 14: Promo banner markup + bell/popover/banner CSS

**Files:**
- Modify: `index.template.html` (after the `group-removal-toast`, ~line 250)
- Modify: `css/app.css`

No unit test (markup/styles; verified via the build + manual smoke).

- [ ] **Step 1: Add the banner markup**

After the `#group-removal-toast` block (line 250) in `index.template.html`:

```html
  <div id="notify-promo" class="notify-promo hidden" role="region" aria-label="Notifications">
    <span id="notify-promo-text"></span>
    <button id="notify-promo-action" class="primary-btn hidden"></button>
    <button id="notify-promo-dismiss" class="ghost-btn" aria-label="Don't show again">Don't show again</button>
  </div>
```

- [ ] **Step 2: Add styles**

Append to `css/app.css`:

```css
.notify-bell { background: none; border: 0; cursor: pointer; font-size: 1rem; opacity: 0.45; padding: 0.25rem; }
.notify-bell.active { opacity: 1; }
.notify-popover { position: absolute; z-index: 50; background: var(--surface, #fff); border: 1px solid rgba(0,0,0,0.15);
  border-radius: 0.5rem; padding: 0.25rem; display: flex; flex-direction: column; gap: 0.125rem; box-shadow: 0 4px 16px rgba(0,0,0,0.2); }
.notify-switch { display: flex; justify-content: space-between; gap: 1rem; background: none; border: 0; cursor: pointer;
  padding: 0.4rem 0.6rem; border-radius: 0.375rem; font: inherit; text-align: left; }
.notify-switch.on { background: rgba(34,197,94,0.18); font-weight: 600; }
.notify-promo { position: fixed; left: 50%; transform: translateX(-50%); bottom: 1rem; max-width: 560px; width: calc(100% - 2rem);
  display: flex; align-items: center; gap: 0.75rem; background: var(--surface, #fff); border: 1px solid rgba(0,0,0,0.15);
  border-radius: 0.75rem; padding: 0.75rem 1rem; box-shadow: 0 6px 24px rgba(0,0,0,0.25); z-index: 60; }
.notify-promo.hidden { display: none; }
.notify-promo #notify-promo-text { flex: 1; font-size: 0.9rem; }
```

- [ ] **Step 3: Verify the build**

Run: `node scripts/dev-build.js`
Expected: build succeeds; `index.html` contains `id="notify-promo"`.

- [ ] **Step 4: Commit**

```bash
git add index.template.html css/app.css
git commit -m "feat: notify promo banner markup + bell/popover/banner styles"
```

---

## Task 15: Plumb the VAPID key through the build

**Files:**
- Modify: `scripts/build.js:24-32`

- [ ] **Step 1: Add the key**

Add `'FIREBASE_VAPID_KEY',` to the `FIREBASE_KEYS` array (after `'FIREBASE_APP_ID'`).

- [ ] **Step 2: Verify the build**

Run: `node scripts/dev-build.js`
Expected: build succeeds. Without `.env.local`, `process.env.FIREBASE_VAPID_KEY` substitutes `'REPLACE_ME'` (token fetch will no-op locally — expected; real value comes from `.env.local` / the `FIREBASE_CONFIG_DEV` secret at deploy).

- [ ] **Step 3: Commit**

```bash
git add scripts/build.js
git commit -m "build: plumb FIREBASE_VAPID_KEY into client config"
```

---

## Task 16: Full suite + lint pass

- [ ] **Step 1: Run everything**

Run: `npx jest`
Expected: PASS, suite count increased by 4 new files (`installGuidance`, `notifyPrompt`, `notifyBell`, `sw`).

- [ ] **Step 2: Build**

Run: `node scripts/dev-build.js`
Expected: clean build.

- [ ] **Step 3: Commit any final fixups, then stop for review.**

---

## Deferred to Plan 2 (server)
RTDB-triggered Cloud Functions, `presence-core` decision logic, FCM send + token hygiene, `notifierState` debounce, `database.rules.json` (`notifierState` deny), CSP FCM endpoints in `firebase.json`, CI `--only ...,functions`, and the emulator/`firebase-functions-test` toolchain. **Notifications do not fire end-to-end until Plan 2 ships**; Plan 1 is independently testable and mergeable behind `NOTIFICATIONS_ENABLED = false`.

## Deploy note
Plan 1 touches `sw.js`, `index.html`, `css/app.css` → **recommend** bumping `sw.js`'s `CACHE` (`knockknock-v2`) at deploy time — recommend, not auto.
