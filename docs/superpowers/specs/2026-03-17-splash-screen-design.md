# Splash Screen Design

## Goal

Replace the bare sequential flash of default UI on first-time use and page reload with a full-screen welcome overlay that hides the UI while it initialises, then fades away once everything is ready.

---

## Observed problem

On both first-time use and page reload, the app briefly shows a grey dot, "Unavailable" label, empty list, and default palette colours before transitioning to the real state (available dot, correct label, user cards, custom theme). Each element settles at a different time, producing a visible sequence of UI changes.

---

## Desired experience

A full-screen splash overlay appears instantly, in the user's custom theme if one is saved, showing the text `k̸n̶o̸c̵k̵ ̶k̸n̷o̵c̸k̵` centred. The real UI loads behind it. When all elements are ready (or after a 3s maximum), the splash fades out over 0.5s.

---

## Section 1: Splash element and styling

### HTML (`index.html`)

Add `#splash` as the **first child of `<body>`**, before `#stale-screen`:

```html
<div id="splash">k&#x0338;n&#x0336;o&#x0338;c&#x0335;k&#x0335; &#x0336;k&#x0338;n&#x0337;o&#x0335;c&#x0338;k&#x0335;</div>
```

The text is hardcoded in HTML — no JS needed to show it on load.

### CSS (`css/app.css`)

```css
#splash {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg); color: var(--text);
  font-size: 1.25rem;
  transition: opacity 0.5s;
}
#splash.fading { opacity: 0; pointer-events: none; }
```

`z-index: 1000` is above `#stale-screen` (which has `z-index: 300`), so the splash covers everything on load.

### Dismissal

A `dismissSplash()` function in `app.js`:

1. If already dismissed (`splashDone === true`), returns immediately — safe to call multiple times.
2. Sets `splashDone = true`.
3. Adds `.fading` class to `#splash` → triggers the CSS opacity transition.
4. Listens for `transitionend` on `#splash` (filtered to `e.propertyName === 'opacity'`) → sets `display: none`.

### Stale screen interaction

In `main()`, the stale screen path is hit before `initSplash()` is ever called:

```js
let { identity, isNew } = await ensureIdentity();
if (!identity) {
  dismissSplash();          // ← safe: splashDone guard handles uninitialised state
  await showStaleScreen();
  ({ identity, isNew } = await ensureIdentity());
}
```

Because `dismissSplash()` checks `splashDone` first, it fires correctly — setting `splashDone = true` and fading the splash. After the user continues from the stale screen, `main()` proceeds normally — `initSplash` is **not** called again. All subsequent `signalReady()` calls from own-status and followee updates are no-ops because `splashDone` is already `true`.

---

## Section 2: Early palette application

At the top of `app.js`, before `main()`, a synchronous IIFE reads `statusapp_palette_state` from `localStorage` and applies theme CSS variables if an `activePaletteKey` is set:

```js
(function applyStoredTheme() {
  try {
    const raw = localStorage.getItem('statusapp_palette_state');
    if (!raw) return;
    const state = JSON.parse(raw);
    const key = state?.activePaletteKey;
    if (!key) return;
    const palette = getPaletteByKey(key);
    if (palette) applyThemeVars(palette.theme);
  } catch {}
})();
```

`applyThemeVars` expects a theme object, not a key string — use `getPaletteByKey(key).theme`. Both `getPaletteByKey` and `applyThemeVars` are already imported at the top of `app.js` and are available to the IIFE.

This runs synchronously before any Firebase call, so the splash renders in the user's theme on the very first paint. Users with no saved palette see the default `--bg`.

This replaces the existing mid-`main()` `applyThemeVars` call. The `applyPaletteVars` call for the swatch row selection remains in its current position in `main()`.

---

## Section 3: Readiness coordinator

### Counter initialisation

After `initList(userId, code)` is called in `main()`:

```js
const followeeCount = getFollowing().length;
initSplash(followeeCount);
```

`initSplash(n)` sets `splashCounter = 1 + n`:

- `1` for own status
- `n` for each followee's first status receipt

When `n === 0` (new user or user following nobody), `splashCounter = 1`. The single `signalReady()` call from `applyOwnStatus` decrements it to 0 and dismisses the splash. The 3s timeout is a safety net, not the primary path for zero-followee users.

`initSplash` also schedules: `setTimeout(dismissSplash, 3000)`. Using `dismissSplash` directly (not `signalReady`) guarantees the splash is gone after 3s regardless of how many followees have not yet reported in — a hard maximum.

### `signalReady()`

```js
let splashCounter = 0;
let splashDone = false;

function initSplash(followeeCount) {
  splashCounter = 1 + followeeCount;
  setTimeout(dismissSplash, 3000);
}

function signalReady() {
  if (splashDone) return;
  splashCounter--;
  if (splashCounter <= 0) {
    dismissSplash();
  }
}

function dismissSplash() {
  if (splashDone) return;
  splashDone = true;
  const el = document.getElementById('splash');
  if (!el) return;
  el.classList.add('fading');
  el.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'opacity') el.style.display = 'none';
  }, { once: true });
}
```

`splashDone` ensures `dismissSplash()` fires exactly once. `signalReady()` is safe to call before `initSplash()` (e.g. in the stale path) because `splashDone` short-circuits it after the first dismiss.

### Wiring — own status (`me.js`)

`applyOwnStatus` signals readiness on its **first invocation only**, unconditionally — before any branching (`firstUseActive` guard, `setAvailable`, `setUnavailable`, etc.):

```js
// at the very top of applyOwnStatus, before any other logic:
if (!ownStatusSignalled) {
  ownStatusSignalled = true;
  onOwnStatusReady?.();
}
```

The signal fires regardless of which branch is taken (first-use path, available path, unavailable path). `ownStatusSignalled` is a module-level boolean, reset to `false` inside `initHeader()`.

`app.js` injects the callback before subscribing to `watchStatus`:

```js
setOwnStatusReadyCallback(signalReady);
```

Export from `me.js`: `export function setOwnStatusReadyCallback(fn) { onOwnStatusReady = fn; }`

### Wiring — followee status (`following.js`)

`updateFolloweeRow` signals once per unique `entry.userId` on first status receipt. A module-level `Set` named `renderedFollowees` tracks fired IDs. The set is cleared at the start of `initList()`.

```js
// near the top of updateFolloweeRow:
if (!renderedFollowees.has(entry.userId)) {
  renderedFollowees.add(entry.userId);
  onFolloweeReady?.();
}
```

`app.js` injects the callback after `initList`:

```js
setFolloweeReadyCallback(signalReady);
```

Export from `following.js`: `export function setFolloweeReadyCallback(fn) { onFolloweeReady = fn; }`

---

## Files changed

| File | Change |
| --- | --- |
| `index.html` | Add `#splash` div as first child of `<body>` |
| `css/app.css` | Add `#splash` and `#splash.fading` rules |
| `js/app.js` | Add early theme IIFE; add `initSplash`, `signalReady`, `dismissSplash`; wire callbacks; call `dismissSplash` before stale screen; remove mid-`main()` `applyThemeVars` call |
| `js/me.js` | Add `ownStatusSignalled` flag (reset in `initHeader`); export `setOwnStatusReadyCallback`; fire callback at top of `applyOwnStatus` before any branching |
| `js/following.js` | Add `renderedFollowees` Set (cleared in `initList`); export `setFolloweeReadyCallback`; fire callback once per followee in `updateFolloweeRow` |
