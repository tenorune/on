# Design: PALETTE_INTERACTIONS_ENABLED Feature Flag

**Date:** 2026-03-19
**Milestone:** v0.6
**Status:** Approved

## Overview

Introduces `PALETTE_INTERACTIONS_ENABLED` as a second palette-related feature flag in `js/features.js`, gating the two v0.6 additions — the favorites strip and long-press palette adoption — independently of the base palette system (`PALETTES_ENABLED`).

**Default:** `false` (opt-in).

## Motivation

`PALETTES_ENABLED` gates all palette behavior (swatches, palette sets, card colors). The v0.6 interactive layers (favorites history strip, long-press adoption) are complete but may need to be toggled independently during development or for staged rollout. A separate flag allows the base palette UI to remain active while the interaction features are disabled.

## Flag Definition

**File:** `js/features.js` — post-change state:

```js
module.exports = {
  PALETTES_ENABLED: true,
  PALETTE_INTERACTIONS_ENABLED: false,
  KNOCK_ENABLED: false,
  CALL_ENABLED: true,
};
```

`PALETTE_INTERACTIONS_ENABLED: true` is only meaningful when `PALETTES_ENABLED: true`. The guard pattern at each v0.6 call site is `PALETTES_ENABLED && PALETTE_INTERACTIONS_ENABLED` — compound because long press and favorites are sub-features of the palette system.

## Affected Call Sites

### `js/features.js`

Add `PALETTE_INTERACTIONS_ENABLED: false` to the exports object.

### `js/favorites.js`

Import updated:

```js
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED } from './features.js';
```

`saveFavorite()` early-return guard:

```js
// Before
if (!PALETTES_ENABLED) return;

// After
if (!PALETTES_ENABLED || !PALETTE_INTERACTIONS_ENABLED) return;
```

### `js/app.js`

Import updated:

```js
// Before
import { PALETTES_ENABLED, KNOCK_ENABLED, CALL_ENABLED } from './features.js';

// After
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED, KNOCK_ENABLED, CALL_ENABLED } from './features.js';
```

`initFavoritesStrip()` call inside the `if (PALETTES_ENABLED)` block (currently the last statement in that block):

```js
// Before
if (PALETTES_ENABLED) {
  document.getElementById('swatch-row').style.display = '';
  const paletteState = getPaletteState();
  const activeSetKey = String(paletteState.activeSet);
  const { selectedKey, activePaletteKey } = paletteState.sets[activeSetKey];
  // Apply status color vars before first paint
  applyPaletteVars(selectedKey);
  initSwatches(userId);
  initFavoritesStrip(userId);
}

// After — only the last line changes
if (PALETTES_ENABLED) {
  document.getElementById('swatch-row').style.display = '';
  const paletteState = getPaletteState();
  const activeSetKey = String(paletteState.activeSet);
  const { selectedKey, activePaletteKey } = paletteState.sets[activeSetKey];
  // Apply status color vars before first paint
  applyPaletteVars(selectedKey);
  initSwatches(userId);
  if (PALETTE_INTERACTIONS_ENABLED) initFavoritesStrip(userId);
}
```

### `js/following.js`

Import updated:

```js
// Before
import { PALETTES_ENABLED, KNOCK_ENABLED, CALL_ENABLED } from './features.js';

// After
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED, KNOCK_ENABLED, CALL_ENABLED } from './features.js';
```

Long-press handler attachment inside `createFolloweeRow`:

```js
// Before (line 433)
if (PALETTES_ENABLED) {
  // attach long press handler
}

// After
if (PALETTES_ENABLED && PALETTE_INTERACTIONS_ENABLED) {
  // attach long press handler
}
```

`triggerAdoption` calls `saveFavorite(true)` — no additional guard needed; once `saveFavorite`'s own guard is updated (per the `favorites.js` change above), it returns early when either flag is false.

## When Flag is False

- `#favorites-strip` remains hidden (CSS `display: none` default; `initFavoritesStrip` is never called).
- No favorites are written to `localStorage`.
- No long-press handlers are attached to followee rows. Cards behave as before v0.6 on pointer events.
- `PALETTES_ENABLED: true` still applies: swatches, palette sets, palette card colors, and status dot colors all function normally.

## Tests

### Mock updates

Every `jest.mock('../js/features.js', ...)` call in a v0.6 test file must add `PALETTE_INTERACTIONS_ENABLED: true`.

**`tests/favorites.test.js`** — 5 mock calls total:

| Location | Current mock | Updated mock |
| --- | --- | --- |
| Line 37 (top-level) | `{ PALETTES_ENABLED: true }` | `{ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }` |
| Line 92 (`saveFavorite` describe `beforeEach`) | `{ PALETTES_ENABLED: true }` | `{ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }` |
| Line 230 (`renderStrip / initFavoritesStrip` describe `beforeEach`) | `{ PALETTES_ENABLED: true }` | `{ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }` |
| Line 337 (`slot tap interactions` describe `beforeEach`) | `{ PALETTES_ENABLED: true }` | `{ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }` |
| Line 403 (`history pill tap interactions` describe `beforeEach`) | `{ PALETTES_ENABLED: true }` | `{ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }` |

**`tests/following.test.js`** — 3 mock calls affected:

| Location | Current mock | Updated mock |
| --- | --- | --- |
| Line 14 (top-level) | `{ PALETTES_ENABLED: true, KNOCK_ENABLED: true, CALL_ENABLED: true }` | `{ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true, KNOCK_ENABLED: true, CALL_ENABLED: true }` |
| Line 1252 (`PALETTES_ENABLED: false` isolation) | `{ PALETTES_ENABLED: false, KNOCK_ENABLED: true, CALL_ENABLED: true }` | `{ PALETTES_ENABLED: false, PALETTE_INTERACTIONS_ENABLED: false, KNOCK_ENABLED: true, CALL_ENABLED: true }` |
| Line 1271 (restore after isolation) | `{ PALETTES_ENABLED: true, KNOCK_ENABLED: true, CALL_ENABLED: true }` | `{ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true, KNOCK_ENABLED: true, CALL_ENABLED: true }` |

### New tests

**`favorites.test.js`:** Add a test verifying `PALETTE_INTERACTIONS_ENABLED: false` → `saveFavorite()` returns without calling `setFavorites`.

**`following.test.js`:** Add a test verifying `PALETTE_INTERACTIONS_ENABLED: false` (with `PALETTES_ENABLED: true`) → no long-press handler attached to followee rows.

## Out of Scope

- No changes to `PALETTES_ENABLED` guards.
- No changes to palette rendering, swatch rows, or Firebase sync.
- No UI toggle for the flag; it is compile-time only via `features.js`.
