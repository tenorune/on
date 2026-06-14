# User Feature Toggles (Experimental) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user disable whole features (Palettes, Groups) for their own account by turning the build-time flags in `js/features.js` into per-user runtime overrides, synced across devices and applied on reload.

**Architecture:** A dependency-free `featureOverrides.js` owns a localStorage JSON of per-feature overrides. `features.js` reads it at module-eval and exports *effective* flag values (`buildDefault && override !== false`), so every existing `if (FLAG)` consumer is untouched (Approach 1). `prefs.js` writes overrides to localStorage + `userPrefs/{uid}/featureToggles/` and, on cross-device sync, fires an event that prompts a reload. A `featureSettings.js` module renders an "Experimental" toggle section inside the header `#code-drawer`, gated behind a `?features` query param. The groups handler-layer gating gap (subscriptions that ignore `GROUPS_ENABLED`) is closed in `app.js`.

**Tech Stack:** Vanilla ES modules, esbuild, Firebase RTDB (`userPrefs`), Jest + jsdom. Tests use CommonJS `require` + `jest.mock`.

---

## File Structure

- **Create** `js/featureOverrides.js` — localStorage read/write of the overrides JSON. Zero imports. Owns the storage key + shape.
- **Modify** `js/features.js` — import `readOverrides`, compute effective `PALETTES_ENABLED` / `PALETTE_INTERACTIONS_ENABLED` / `GROUPS_ENABLED`.
- **Modify** `js/prefs.js` — `getFeatureToggle` / `setFeatureToggle`, boot snapshot in `initPrefs`, `featureToggles` handling + `feature-toggles-synced` event in `syncFromServer`.
- **Create** `js/featureSettings.js` — render + wire the Experimental section; query-param gate; reload-on-change.
- **Modify** `index.template.html` — empty `#feature-settings` container inside `#code-drawer`.
- **Modify** `js/app.js` — call `initFeatureSettings`; listen for `feature-toggles-synced`; import `GROUPS_ENABLED`; wrap groups subscription inits.
- **Create** `tests/featureOverrides.test.js`, `tests/features.test.js`, `tests/featureSettings.test.js`.
- **Modify** `tests/prefs.test.js`, `tests/app-call-recovery.test.js`.
- **Modify** `docs/HANDOFF.md` — update §5 Feature flags.

Controlled keys this cut: **`palettes`** (bundles `PALETTES_ENABLED` + `PALETTE_INTERACTIONS_ENABLED`) and **`groups`** (`GROUPS_ENABLED`). Default for every feature is *enabled*; only the literal `false` disables; a user can never enable a build-disabled feature.

Run the web suite with `npx jest` from the repo root.

---

## Task 1: `featureOverrides.js` — storage primitive

**Files:**
- Create: `js/featureOverrides.js`
- Test: `tests/featureOverrides.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/featureOverrides.test.js
const { readOverrides, writeOverride } = require('../js/featureOverrides.js');

beforeEach(() => localStorage.clear());

test('readOverrides returns {} when nothing stored', () => {
  expect(readOverrides()).toEqual({});
});

test('readOverrides returns {} on malformed JSON', () => {
  localStorage.setItem('statusapp_feature_overrides', 'not json');
  expect(readOverrides()).toEqual({});
});

test('writeOverride persists a boolean and round-trips via readOverrides', () => {
  writeOverride('palettes', false);
  expect(readOverrides()).toEqual({ palettes: false });
  expect(localStorage.getItem('statusapp_feature_overrides'))
    .toBe(JSON.stringify({ palettes: false }));
});

test('writeOverride merges, does not clobber other keys, and coerces to boolean', () => {
  writeOverride('palettes', false);
  writeOverride('groups', 0); // truthy/falsy coercion → false
  expect(readOverrides()).toEqual({ palettes: false, groups: false });
  writeOverride('palettes', 'yes'); // → true
  expect(readOverrides()).toEqual({ palettes: true, groups: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/featureOverrides.test.js`
Expected: FAIL — `Cannot find module '../js/featureOverrides.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// js/featureOverrides.js
// Dependency-free localStorage store for per-user feature toggle overrides.
// Read at module-eval by js/features.js (must stay import-light) and at write
// time by js/prefs.js. Shape: { [featureKey]: boolean } where the value is the
// user's desired ENABLED state. A missing key means "use the build default".
// Only the literal false disables. The key is NOT uid-scoped — consistent with
// the other prefs.js localStorage caches; syncFromServer overwrites it for the
// current account.
const KEY = 'statusapp_feature_overrides';

export function readOverrides() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
  catch { return {}; }
}

export function writeOverride(key, enabled) {
  const ov = readOverrides();
  ov[key] = !!enabled;
  try { localStorage.setItem(KEY, JSON.stringify(ov)); }
  catch { /* quota — best effort */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/featureOverrides.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add js/featureOverrides.js tests/featureOverrides.test.js
git commit -m "feat: featureOverrides localStorage store for per-user feature toggles"
```

---

## Task 2: `features.js` — effective flags

**Files:**
- Modify: `js/features.js`
- Test: `tests/features.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/features.test.js
// NOTE: deliberately does NOT mock ../js/features.js — exercises the real
// eval-time override read. Uses jest.isolateModules so each case re-evaluates
// the module against fresh localStorage.

beforeEach(() => localStorage.clear());

function loadFeatures() {
  let mod;
  jest.isolateModules(() => { mod = require('../js/features.js'); });
  return mod;
}

test('all controllable flags default ON when no override is stored', () => {
  const f = loadFeatures();
  expect(f.PALETTES_ENABLED).toBe(true);
  expect(f.PALETTE_INTERACTIONS_ENABLED).toBe(true);
  expect(f.GROUPS_ENABLED).toBe(true);
});

test('palettes override=false disables BOTH palette flags (bundled)', () => {
  localStorage.setItem('statusapp_feature_overrides', JSON.stringify({ palettes: false }));
  const f = loadFeatures();
  expect(f.PALETTES_ENABLED).toBe(false);
  expect(f.PALETTE_INTERACTIONS_ENABLED).toBe(false);
  expect(f.GROUPS_ENABLED).toBe(true);
});

test('groups override=false disables only groups', () => {
  localStorage.setItem('statusapp_feature_overrides', JSON.stringify({ groups: false }));
  const f = loadFeatures();
  expect(f.GROUPS_ENABLED).toBe(false);
  expect(f.PALETTES_ENABLED).toBe(true);
});

test('override=true is a no-op (feature already on by build default)', () => {
  localStorage.setItem('statusapp_feature_overrides', JSON.stringify({ groups: true }));
  const f = loadFeatures();
  expect(f.GROUPS_ENABLED).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/features.test.js`
Expected: FAIL — flags are plain `true` consts, so the `palettes override=false` case fails (still `true`).

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `js/features.js` with:

```js
// js/features.js
//
// Build-time defaults, narrowed by per-user runtime overrides read at
// module-eval from js/featureOverrides.js. A user can only DISABLE a
// build-enabled feature (the buildDefault && ... short-circuit), never enable
// a build-disabled one. Overrides are evaluated once per page load — toggling
// applies on reload (see docs/superpowers/specs/2026-06-14-user-feature-toggles-design.md).
//
// Only 'palettes' and 'groups' are currently user-controllable; the rest are
// pure build constants. Keep this file import-light: featureOverrides.js is
// dependency-free on purpose.
import { readOverrides } from './featureOverrides.js';

const ov = readOverrides();
const eff = (buildDefault, key) => buildDefault && ov[key] !== false;

export const PALETTES_ENABLED             = eff(true, 'palettes');
export const PALETTE_INTERACTIONS_ENABLED = eff(true, 'palettes');
export const KNOCK_ENABLED                = true;
export const CALL_ENABLED                 = true;
export const GROUPS_ENABLED               = eff(true, 'groups');
export const NOTIFICATIONS_ENABLED        = true;
export const FOLLOW_REQUESTS_ENABLED      = true;
export const NOTIFY_DEBUG                 = false; // #156 — also opt-in via ?notifydebug=1
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/features.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify the full suite still passes (mocked suites are unaffected)**

Run: `npx jest`
Expected: PASS — every suite that `jest.mock('../js/features.js')` is unchanged; only the real-module path gained the override read.

- [ ] **Step 6: Commit**

```bash
git add js/features.js tests/features.test.js
git commit -m "feat: features.js reads per-user overrides at eval (effective flags)"
```

---

## Task 3: `prefs.js` — read/write toggle + cross-device sync

**Files:**
- Modify: `js/prefs.js` (import block ~14-25; `initPrefs` ~34-36; add new section; `syncFromServer` ~358)
- Test: `tests/prefs.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `tests/prefs.test.js`. First extend the destructured import from `../js/prefs.js` (the `require` near the top) to also pull `getFeatureToggle, setFeatureToggle`. Then append:

```js
// ── Feature toggles ──

test('getFeatureToggle defaults to true when nothing stored', () => {
  expect(getFeatureToggle('groups')).toBe(true);
  expect(getFeatureToggle('palettes')).toBe(true);
});

test('setFeatureToggle writes localStorage AND userPrefs when initialized', () => {
  initPrefs('uid1');
  setFeatureToggle('groups', false);
  expect(getFeatureToggle('groups')).toBe(false);
  expect(JSON.parse(localStorage.getItem('statusapp_feature_overrides')))
    .toEqual({ groups: false });
  expect(mergeUserPrefs).toHaveBeenCalledWith('uid1', { 'featureToggles/groups': false });
});

test('syncFromServer writes incoming featureToggles into localStorage (server wins)', () => {
  initPrefs('uid1');
  syncFromServer({ featureToggles: { palettes: false } });
  expect(getFeatureToggle('palettes')).toBe(false);
});

test('syncFromServer dispatches feature-toggles-synced when a key differs from boot', () => {
  initPrefs('uid1'); // boot snapshot: nothing stored → all enabled
  const handler = jest.fn();
  document.addEventListener('feature-toggles-synced', handler);
  syncFromServer({ featureToggles: { groups: false } });
  expect(handler).toHaveBeenCalledTimes(1);
  document.removeEventListener('feature-toggles-synced', handler);
});

test('syncFromServer does NOT dispatch when the synced value matches boot state', () => {
  localStorage.setItem('statusapp_feature_overrides', JSON.stringify({ groups: false }));
  initPrefs('uid1'); // boot snapshot now has groups:false
  const handler = jest.fn();
  document.addEventListener('feature-toggles-synced', handler);
  syncFromServer({ featureToggles: { groups: false } });
  expect(handler).not.toHaveBeenCalled();
  document.removeEventListener('feature-toggles-synced', handler);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/prefs.test.js`
Expected: FAIL — `getFeatureToggle is not a function`.

- [ ] **Step 3: Implement in `js/prefs.js`**

(3a) Add the import (alongside the existing `db.js` import near the top):

```js
import { readOverrides, writeOverride } from './featureOverrides.js';
```

(3b) Add a module-level boot-snapshot var and the controlled-key list near the top of the file (after `let _myUserId = null;`):

```js
// Feature toggles controllable by the user this cut. Snapshot of the override
// values in effect at boot (captured in initPrefs) so syncFromServer can tell
// when a cross-device change requires a reload to take effect.
const FEATURE_TOGGLE_KEYS = ['palettes', 'groups'];
let _bootFeatureToggles = {};
```

(3c) In `initPrefs`, capture the snapshot:

```js
export function initPrefs(userId) {
  _myUserId = userId;
  const ov = readOverrides();
  _bootFeatureToggles = {};
  for (const k of FEATURE_TOGGLE_KEYS) _bootFeatureToggles[k] = ov[k] !== false;
}
```

(3d) Add a new section (place it near the per-person notification prefs section, before the push-token registry):

```js
// ── Feature toggles (experimental per-user feature gates) ───────────────────
// Default ENABLED. Written to localStorage (read synchronously at boot by
// js/features.js) and mirrored to userPrefs/{uid}/featureToggles/{key} for
// cross-device sync. Applying a change requires a reload — see featureSettings.js.
export function getFeatureToggle(key) {
  return readOverrides()[key] !== false;
}

export function setFeatureToggle(key, enabled) {
  writeOverride(key, enabled);
  if (_myUserId) {
    mergeUserPrefs(_myUserId, { [`featureToggles/${key}`]: !!enabled }).catch(() => {});
  }
}
```

(3e) In `syncFromServer`, add a block (e.g. after the `notify` block, before the closing brace):

```js
  // Feature toggles. Server wins (write into the localStorage override cache).
  // If a controlled key now differs from the value in effect at boot, the
  // running session is stale for that feature — dispatch an event so app.js can
  // offer a reload (we never auto-reload mid-use).
  if (serverPrefs.featureToggles && typeof serverPrefs.featureToggles === 'object') {
    let changed = false;
    for (const key of FEATURE_TOGGLE_KEYS) {
      const v = serverPrefs.featureToggles[key];
      if (typeof v !== 'boolean') continue;
      writeOverride(key, v);
      if (v !== _bootFeatureToggles[key]) changed = true;
    }
    if (changed) document.dispatchEvent(new CustomEvent('feature-toggles-synced'));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/prefs.test.js`
Expected: PASS (all prior + 5 new).

- [ ] **Step 5: Commit**

```bash
git add js/prefs.js tests/prefs.test.js
git commit -m "feat: prefs feature-toggle read/write + cross-device reload signal"
```

---

## Task 4: `featureSettings.js` — Experimental section in the drawer

**Files:**
- Create: `js/featureSettings.js`
- Modify: `index.template.html` (inside `#code-drawer` `.drawer-inner`, ~line 183)
- Test: `tests/featureSettings.test.js`

- [ ] **Step 1: Add the container to `index.template.html`**

Inside `#code-drawer` `<div class="drawer-inner">`, after the `#rotate-error-msg` paragraph (~line 181-182), add:

```html
          <div id="feature-settings" class="feature-settings hidden"></div>
```

- [ ] **Step 2: Write the failing test**

```js
// tests/featureSettings.test.js
jest.mock('../js/prefs.js', () => ({
  getFeatureToggle: jest.fn(() => true),
  setFeatureToggle: jest.fn(),
}));

const { getFeatureToggle, setFeatureToggle } = require('../js/prefs.js');
const { initFeatureSettings, _setReloadForTests } = require('../js/featureSettings.js');

let reload;
beforeEach(() => {
  document.body.innerHTML = '<div id="feature-settings" class="feature-settings hidden"></div>';
  getFeatureToggle.mockReturnValue(true);
  setFeatureToggle.mockClear();
  reload = jest.fn();
  _setReloadForTests(reload);
  window.history.pushState({}, '', '/'); // no ?features
});

test('does nothing (section stays hidden) without the ?features query param', () => {
  initFeatureSettings('uid1');
  const el = document.getElementById('feature-settings');
  expect(el.classList.contains('hidden')).toBe(true);
  expect(el.children.length).toBe(0);
});

test('renders and reveals the section with ?features, one switch per feature', () => {
  window.history.pushState({}, '', '/?features');
  initFeatureSettings('uid1');
  const el = document.getElementById('feature-settings');
  expect(el.classList.contains('hidden')).toBe(false);
  expect(el.querySelector('#feature-toggle-palettes')).not.toBeNull();
  expect(el.querySelector('#feature-toggle-groups')).not.toBeNull();
});

test('switches reflect current toggle state', () => {
  window.history.pushState({}, '', '/?features');
  getFeatureToggle.mockImplementation((k) => k !== 'groups'); // groups off
  initFeatureSettings('uid1');
  expect(document.getElementById('feature-toggle-palettes').checked).toBe(true);
  expect(document.getElementById('feature-toggle-groups').checked).toBe(false);
});

test('flipping a switch writes the pref and reloads', () => {
  window.history.pushState({}, '', '/?features');
  initFeatureSettings('uid1');
  const sw = document.getElementById('feature-toggle-groups');
  sw.checked = false;
  sw.dispatchEvent(new Event('change'));
  expect(setFeatureToggle).toHaveBeenCalledWith('groups', false);
  expect(reload).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest tests/featureSettings.test.js`
Expected: FAIL — `Cannot find module '../js/featureSettings.js'`.

- [ ] **Step 4: Write the implementation**

```js
// js/featureSettings.js
// Experimental per-user feature toggles, rendered inside the header
// #code-drawer. Visibility is gated behind the ?features query param while the
// feature is experimental; ungate later by removing the guard in
// initFeatureSettings. Flipping a switch writes the pref and reloads — the
// gates in js/features.js are evaluated once at boot (reload-to-apply).
import { getFeatureToggle, setFeatureToggle } from './prefs.js';

// Injectable reload so jsdom tests don't hit the unimplemented navigation.
let _reload = () => window.location.reload();
export function _setReloadForTests(fn) { _reload = fn; }

const TOGGLES = [
  { key: 'palettes', label: 'Palettes', desc: 'Color picker, themes, favorites, and color adoption.' },
  { key: 'groups',   label: 'Groups',   desc: 'Group cards, group view, invites, and the Inbox.' },
];

export function initFeatureSettings() {
  if (!new URLSearchParams(window.location.search).has('features')) return;
  const root = document.getElementById('feature-settings');
  if (!root) return;

  root.innerHTML = '<h4 class="feature-settings-title">Experimental</h4>';
  for (const { key, label, desc } of TOGGLES) {
    const row = document.createElement('div');
    row.className = 'feature-settings-row';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `feature-toggle-${key}`;
    input.checked = getFeatureToggle(key);
    input.addEventListener('change', () => {
      setFeatureToggle(key, input.checked);
      _reload();
    });

    const text = document.createElement('label');
    text.setAttribute('for', input.id);
    text.className = 'feature-settings-label';
    text.innerHTML = `<span class="feature-settings-name">${label}</span>` +
                     `<span class="feature-settings-desc">${desc}</span>`;

    row.append(input, text);
    root.appendChild(row);
  }
  root.classList.remove('hidden');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/featureSettings.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Add minimal styles**

In `css/app.css`, append:

```css
/* Experimental feature toggles (header drawer) */
.feature-settings { margin-top: 0.75rem; padding-top: 0.5rem; border-top: 1px solid rgba(255,255,255,0.12); }
.feature-settings-title { margin: 0 0 0.5rem; font-size: 0.8rem; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.04em; }
.feature-settings-row { display: flex; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.5rem; }
.feature-settings-row input { margin-top: 0.2rem; }
.feature-settings-label { display: flex; flex-direction: column; }
.feature-settings-name { font-size: 0.9rem; }
.feature-settings-desc { font-size: 0.75rem; opacity: 0.6; }
```

- [ ] **Step 7: Commit**

```bash
git add js/featureSettings.js tests/featureSettings.test.js index.template.html css/app.css
git commit -m "feat: experimental feature-toggle section in header drawer (?features gated)"
```

---

## Task 5: Wire `featureSettings` + cross-device reload prompt into `app.js`

**Files:**
- Modify: `js/app.js` (imports; init near `initCodeDrawer` ~629; add event listener)
- Test: covered by `tests/app-call-recovery.test.js` mock updates in Task 6

- [ ] **Step 1: Add imports to `js/app.js`**

After the `initCodeDrawer` import line, add:

```js
import { initFeatureSettings } from './featureSettings.js';
import { showToast } from './groups.js';
```

- [ ] **Step 2: Initialize the section + the cross-device reload prompt**

In `main()`, right after `initCodeDrawer(userId, code);` (~line 629), add:

```js
  initFeatureSettings(userId);
  // Cross-device feature-toggle change: prefs.syncFromServer fires this when a
  // synced toggle differs from what booted. We never auto-reload mid-use — just
  // tell the user a reload is needed (the gates are read once at boot).
  document.addEventListener('feature-toggles-synced', () => {
    showToast('Feature settings changed on another device — reload to apply.');
  });
```

- [ ] **Step 3: Manual smoke (no automated step here — covered next task)**

Run: `node scripts/dev-build.js`
Expected: build succeeds (no import/syntax errors).

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat: wire feature-settings section + cross-device reload toast in app.js"
```

---

## Task 6: Close the groups handler-layer gating gap

`GROUPS_ENABLED` currently only gates rendering (inside `groupNav.js` — it hides
`#nav-row` when false — and `groupContext.js`). The groups *subscriptions* in
`app.js` run unconditionally. Gate them so "groups off" actually stops the
group enumeration, removal detector, Inbox, and follow-grants watchers.
`initNav` / `initNavRow` / `onContextChange` stay (they are the context
machinery the personal-invite redemption flow also uses; `groupNav` already
self-hides the cards row when `GROUPS_ENABLED` is false).

**Files:**
- Modify: `js/app.js` (features import ~line 8; groups inits ~646-651; `openInboxModal` deep-link ~673)
- Test: `tests/app-call-recovery.test.js`

- [ ] **Step 1: Write/extend the failing test**

In `tests/app-call-recovery.test.js`:

(1a) Add `GROUPS_ENABLED: false` to the `../js/features.js` mock (~line 130-136) so the suite is explicit:

```js
jest.mock('../js/features.js', () => ({
  PALETTES_ENABLED: false,
  PALETTE_INTERACTIONS_ENABLED: false,
  KNOCK_ENABLED: false,
  CALL_ENABLED: true,
  NOTIFICATIONS_ENABLED: false,
  GROUPS_ENABLED: false,
}));
```

(1b) Add a `featureSettings.js` mock and ensure the `groups.js` mock exposes `showToast` (add to the existing `jest.mock('../js/groups.js', ...)` block; if none exists, add one). Add near the other `jest.mock` calls:

```js
jest.mock('../js/featureSettings.js', () => ({ initFeatureSettings: jest.fn() }));
```

In the existing `../js/groups.js` mock, ensure these keys exist:

```js
  initGroupRemovalDetector: jest.fn(),
  showToast: jest.fn(),
```

(1c) Add a test asserting the groups subscriptions are skipped when `GROUPS_ENABLED` is false. Use the already-mocked modules:

```js
const { startCardsRowSubscriptions } = require('../js/groupNav.js');
const { initGroupRemovalDetector } = require('../js/groups.js');
const { initInbox } = require('../js/inbox.js');
const { initFollowGrants } = require('../js/followRequests.js');

test('groups subscriptions are skipped when GROUPS_ENABLED is false', async () => {
  await require('../js/app.js').main();
  expect(startCardsRowSubscriptions).not.toHaveBeenCalled();
  expect(initGroupRemovalDetector).not.toHaveBeenCalled();
  expect(initInbox).not.toHaveBeenCalled();
  expect(initFollowGrants).not.toHaveBeenCalled();
});
```

> If `main()` is not already exported/invoked by this suite, follow the suite's existing pattern for booting `main()` (it already drives the boot path for the call-recovery tests). Match whatever invocation the existing tests use rather than inventing a new one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/app-call-recovery.test.js`
Expected: FAIL — the inits are currently called unconditionally.

- [ ] **Step 3: Implement the gating in `js/app.js`**

(3a) Add `GROUPS_ENABLED` to the features import (~line 8):

```js
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED, KNOCK_ENABLED, CALL_ENABLED, NOTIFICATIONS_ENABLED, GROUPS_ENABLED } from './features.js';
```

(3b) Wrap the four group subscription inits (~lines 646-651):

```js
  if (GROUPS_ENABLED) {
    startCardsRowSubscriptions();
    initGroupRemovalDetector(userId);
    initInbox(userId, code);
    // Capture the follow-grants watcher unsub (it watches followGrants/{me} for
    // the page lifetime) so a future user-switch/teardown can drop it (#214 R2).
    _followGrantsUnsub = initFollowGrants(userId, code);
  }
```

(3c) Guard the cold-start Inbox deep-link (~line 673) so it can't open an Inbox that was never initialized:

```js
  if (wantInbox && GROUPS_ENABLED) openInboxModal();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/app-call-recovery.test.js`
Expected: PASS.

- [ ] **Step 5: Manual audit (record findings in the commit body)**

Build and load locally twice — once with groups off, once with palettes off:

Run: `npm run dev` then open the app.
- Set `?features`, turn **Groups** off (app reloads). Confirm: no group cards row, `#nav-row` hidden in Direct, no Inbox button, group context unreachable; Direct list, knock, call, and the **personal** invite link all still work.
- Turn **Palettes** off (app reloads). Confirm: swatch row hidden, status dot shows the plain `statusColor` (no theme glow), no favorites strip, theme vars at default; going available/unavailable still works.

Note any leaked behavior in the commit body. (Known accepted edge: opening a *group* invite link while groups are disabled is out of scope for this cut.)

- [ ] **Step 6: Commit**

```bash
git add js/app.js tests/app-call-recovery.test.js
git commit -m "fix: gate groups subscriptions behind GROUPS_ENABLED (handler-layer gate)"
```

---

## Task 7: Full suite + docs

**Files:**
- Modify: `docs/HANDOFF.md` (§5 Feature flags)

- [ ] **Step 1: Run the whole web suite**

Run: `npx jest`
Expected: PASS (all suites, including the 3 new test files).

- [ ] **Step 2: Run the rules + functions suites if touched**

This change touches neither RTDB rules nor Cloud Functions, so `cd functions && npm test` is not required. (`userPrefs/{uid}` already permits arbitrary owner-written children under the existing owner-scoped rule — `featureToggles/` needs no rule change. Confirm by reading the `userPrefs` rule in `database.rules.json` during the audit; if it uses a strict child allowlist, add `featureToggles` there.)

- [ ] **Step 3: Update `docs/HANDOFF.md` §5**

Replace the "These are compile-time constants. Changing means editing + redeploying." line with a note that `PALETTES_ENABLED`/`PALETTE_INTERACTIONS_ENABLED`/`GROUPS_ENABLED` are now **build defaults narrowed by per-user runtime overrides** (`js/featureOverrides.js` → `userPrefs/{uid}/featureToggles/`), surfaced as the experimental `?features` toggle section in the header drawer (`js/featureSettings.js`), applied on reload. Keep the "render-gate must match handler-gate" lesson and note the groups handler-gate was closed in this work.

- [ ] **Step 4: Commit**

```bash
git add docs/HANDOFF.md
git commit -m "docs: document per-user feature toggles in HANDOFF §5"
```

---

## Self-review notes (for the executor)

- **Spec coverage:** §1 data model → Tasks 1,3. §2 gate mechanic → Tasks 1,2. §3 sync + reload → Tasks 3,5. §4 UI → Task 4. §5 groups gating → Task 6. §6 testing → every task + Task 7. §7 rollout (ships dark behind `?features`) → Task 4 gate.
- **Type/name consistency:** `readOverrides`/`writeOverride` (Task 1) used in Tasks 2,3. `getFeatureToggle`/`setFeatureToggle` (Task 3) used in Task 4. `feature-toggles-synced` event (Task 3) consumed in Task 5. `initFeatureSettings` (Task 4) called in Task 5. `#feature-settings` container (Task 4 step 1) used by Task 4 step 4. `FEATURE_TOGGLE_KEYS` is prefs-internal (Task 3).
- **Mock discipline:** no new `js/db.js` exports, so the ~20 db-mock suites are untouched. New module mocks are needed only in `app-call-recovery.test.js` (Task 6) and `featureSettings.test.js` (Task 4, mocks `prefs.js`).
