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

**File:** `js/features.js`

```js
module.exports = {
  PALETTES_ENABLED: true,
  PALETTE_INTERACTIONS_ENABLED: false,
  KNOCK_ENABLED: false,
  CALL_ENABLED: true,
};
```

`PALETTE_INTERACTIONS_ENABLED: true` is only meaningful when `PALETTES_ENABLED: true`. The guard pattern at each call site is `PALETTES_ENABLED && PALETTE_INTERACTIONS_ENABLED`, matching the existing convention used for `KNOCK_ENABLED` and `CALL_ENABLED`.

## Affected Call Sites

### `js/favorites.js`

`saveFavorite()` early-return guard:

```js
// Before
if (!PALETTES_ENABLED) return;

// After
if (!PALETTES_ENABLED || !PALETTE_INTERACTIONS_ENABLED) return;
```

Import updated to include the new flag:

```js
import { PALETTES_ENABLED, PALETTE_INTERACTIONS_ENABLED } from './features.js';
```

### `js/app.js`

`initFavoritesStrip()` is called inside the `if (PALETTES_ENABLED)` block. The condition is tightened:

```js
// Before
if (PALETTES_ENABLED) {
  ...
  initFavoritesStrip(userId);
}

// After
if (PALETTES_ENABLED) {
  ...
  if (PALETTE_INTERACTIONS_ENABLED) initFavoritesStrip(userId);
}
```

### `js/following.js`

Long-press handler attachment inside `createFolloweeRow`:

```js
// Before
if (PALETTES_ENABLED) {
  // attach long press handler
}

// After
if (PALETTES_ENABLED && PALETTE_INTERACTIONS_ENABLED) {
  // attach long press handler
}
```

Import updated to include the new flag.

`triggerAdoption` calls `saveFavorite(true)` — no additional guard needed; `saveFavorite` already returns early when either flag is false.

## When Flag is False

- `#favorites-strip` remains hidden (CSS `display: none` default; `initFavoritesStrip` is never called).
- No favorites are written to `localStorage`.
- No long-press handlers are attached to followee rows. Cards behave as before v0.6 on pointer events.
- `PALETTES_ENABLED: true` still applies: swatches, palette sets, palette card colors, and status dot colors all function normally.

## Tests

All `jest.mock('../js/features.js', ...)` calls that test v0.6 behavior add `PALETTE_INTERACTIONS_ENABLED: true`:

| File | Current mock | Updated mock |
|---|---|---|
| `tests/favorites.test.js` (top-level) | `{ PALETTES_ENABLED: true }` | `{ PALETTES_ENABLED: true, PALETTE_INTERACTIONS_ENABLED: true }` |
| `tests/favorites.test.js` (inner isolations) | same | same |
| `tests/following.test.js` (adoption section) | `{ PALETTES_ENABLED: true, KNOCK_ENABLED: true, CALL_ENABLED: true }` | add `PALETTE_INTERACTIONS_ENABLED: true` |
| `tests/following.test.js` (`PALETTES_ENABLED: false` test) | unchanged | add `PALETTE_INTERACTIONS_ENABLED: false` (already implied but explicit) |

A new test in `following.test.js` verifies: `PALETTE_INTERACTIONS_ENABLED: false` → no long-press handler attached (even when `PALETTES_ENABLED: true`).

A new test in `favorites.test.js` verifies: `PALETTE_INTERACTIONS_ENABLED: false` → `saveFavorite()` returns without calling `setFavorites`.

## Out of Scope

- No changes to `PALETTES_ENABLED` guards.
- No changes to palette rendering, swatch rows, or Firebase sync.
- No UI toggle for the flag; it is compile-time only via `features.js`.
