# Favorites Strip — Design Spec

**Date:** 2026-03-18
**Status:** Approved

---

## Overview

A horizontally scrollable strip of palette+status-color combo pills, positioned between the status bar and the people list. Lets users quickly switch between saved combinations and recover a previous state after adopting a contact's theme.

---

## Visibility

The strip is hidden when `statusapp_favorites` is empty; shown when it contains at least one entry. First-time users and users who have never changed their status or theme will not see the strip.

If `PALETTES_ENABLED` is false, the strip is never shown and no saves occur. If `PALETTES_ENABLED` is later toggled back to true, any pre-existing `statusapp_favorites` data in localStorage will cause the strip to reappear as-is.

The collapsed/expanded state is persisted in localStorage. If the strip becomes hidden (favorites array emptied), the collapsed-state key is left as-is; when the strip reappears it will use whatever state was last persisted — this is acceptable.

---

## Location

Between the status bar (availability header) and the people list (`#people-list`).

---

## Layout

- Horizontally scrollable row of pills
- Collapsible: collapses to a thin horizontal gradient line spanning the full width
- Tapping the collapsed line expands the strip
- Collapsed/expanded state persisted in localStorage

---

## Pill Shape

Each combo is represented as a two-half pill:

- **Left half:** status color
- **Right half:** theme background color

Both halves are always present. Combos without an active palette theme use the default slate background (`#0f172a`) as the right half — visually consistent with themed combos.

`themeBg` is derived from `getPaletteByKey(paletteKey)?.theme.bg` when `paletteKey` is non-null, or `#0f172a` otherwise.

---

## Slots

### Slots 1 & 2 — Live Set Mirrors (always visible when strip is shown)

- **Slot 1:** Always reflects Set 1's current selected combo (derived live from `statusapp_palette_state`)
- **Slot 2:** Always reflects Set 2's current selected combo (derived live from `statusapp_palette_state`)
- If the user has never interacted with a set, that set's slot shows its default combo (e.g., Volt+slate for Set 2)
- `state.activeSet` is always 1 or 2 — one slot is always rendered as active regardless of the user's availability status
- Both are **interactive**:
  - Tapping the **inactive** slot switches to that set's combo (equivalent to the set toggle in the palette picker)
  - Tapping the **active** slot is a no-op
- The active slot is rendered at full opacity; the inactive slot at reduced opacity

### Slots 3–16 — Saved History

- Newest first
- Maximum 14 entries (stored in `statusapp_favorites`)
- When a 15th entry would be added, the oldest is dropped
- **Dedup rule:** before saving, compare the incoming combo against both slot 1 and slot 2 (regardless of which set is active). A match is defined as all four fields being equal: `statusColor`, `paletteKey`, `selectedKey`, and `activeSet`. If it matches either, skip the save silently. This check applies to both auto-save triggers. Note: this means a combo that happens to match Set 2's default (e.g., volt+no-theme) will never be saved to history even when the user is on Set 1 — this is the intended behavior.
- Tapping a pill applies that combo (see "Tapping a Pill" section), removes it from the history list, and conditionally prepends the previously active slot's old combo to history as slot 3 (see step 5 of "Tapping a Pill")

---

## Auto-Save Triggers

A combo is saved to the history (slots 3–16) in exactly two situations. Both triggers only fire when `PALETTES_ENABLED` is true.

1. **User goes Available** — capture and save the active set's current combo at the very top of `setAvailable()` in `me.js`, before the first `setTimeout` call. The save must be guarded: only fire when this is a fresh user-initiated transition, not a page-load Firebase restore of an already-available status. `applyOwnStatus` in `me.js` calls `setAvailable` on page load when the user is already available — `saveFavorite` must not fire in that path. The guard should check whether the dot is already in the `available` state before calling `setAvailable` (i.e., skip the save if the UI was already showing available). `me.js` does not currently import palette state; it should call a `saveFavorite` function imported from `favorites.js`, which handles reading `getPaletteState()`, building the combo object, applying the dedup check, and writing to `statusapp_favorites`. Only the active set's combo is saved, not both sets.

2. **User long-presses a contact card (adoption)** — the save is placed in `triggerAdoption` (not `applyAdoption`) immediately before the call to `applyAdoption`, so it fires only on the long-press path. It saves the active set's current combo before adoption is applied.

In both cases, the dedup rule is applied before saving.

No other interactions trigger a save.

---

## Collapsed State Affordance

When collapsed, the strip renders as a thin horizontal gradient line spanning the full width, using the status colors from all visible pills (slots 1, 2, and 3+) as gradient stops, in left-to-right order. Tapping the line expands the strip.

---

## Tapping a Pill (Slots 3–16)

**Before beginning:** snapshot the active slot's current combo now, before any state changes. This snapshot is used in step 5 — if deferred until after step 0, it will reflect already-mutated state.

Steps must be performed in order. Steps 0 and 1 are order-dependent: `enterPaletteMode` and `exitPaletteMode` read `state.activeSet` internally, so `switchSet` (step 1) must run first to set the correct active set before step 2 executes.

0. Write `combo.selectedKey` back to `state.sets[String(combo.activeSet)].selectedKey` in `statusapp_palette_state` before calling `switchSet`. This step is load-bearing for two reasons: (a) the swatch row reads `selectedKey` from localStorage to highlight the correct swatch, and (b) `switchSet` itself reads `selectedKey` from localStorage to derive the color it passes to its internal `setStatusColor` call — if step 0 is skipped, `switchSet` fires the wrong color to Firebase in step 1.
1. Call `switchSet(combo.activeSet, myUserId)`. Note: `switchSet` applies theme vars based on the target set's stored `activePaletteKey` and calls `setStatusColor` with `selectedKey`'s color. Step 2 immediately overwrites the theme vars (expected, brief visual transition), and step 3 unconditionally overrides the status color — `combo.statusColor` is always the canonical color. Two `setStatusColor` Firebase writes fire in rapid succession (step 1 and step 3); this is a known accepted round-trip.
2. If `combo.paletteKey` is non-null, call `enterPaletteMode(combo.paletteKey, myUserId)`; otherwise call `exitPaletteMode(myUserId)`. These functions apply all theme CSS vars (`--bg`, `--surface`, `--surface2`, etc.) via `applyThemeVars` / `resetThemeVars`, overwriting what `switchSet` applied in step 1 — no additional theme var writes are needed in step 3. Both functions also fire a Firebase `paletteKey` write as a side effect — this is intentional.
3. Call `setStatusColor(myUserId, combo.statusColor)` and set `document.documentElement.style.setProperty('--my-status', combo.statusColor)` and `document.documentElement.style.setProperty('--my-glow', getGlowForColor(combo.statusColor))`.
4. Remove the pill from the history array.
5. Using the snapshot captured before step 0: prepend it to history as slot 3, but only if it does not match the new slot 1 or slot 2 state after the synchronous local state updates in steps 0–3. A match is defined as all four fields equal: `statusColor`, `paletteKey`, `selectedKey`, and `activeSet`. Firebase Promises need not resolve before this check; only local `statusapp_palette_state` is consulted.

---

## Adoption Simplification

The long-press adoption feature is simplified:

- `adoptionSnapshot`, `revertAdoption`, and the same-card toggle logic in `triggerAdoption` are **removed**
- The `if (adoptionSnapshot) revertAdoption(myUserId)` guard at the top of `applyAdoption` must also be removed when `revertAdoption` is deleted
- Long-press always applies the contact's combo (never reverts)
- Recovery from an unwanted adoption is done by tapping the pre-adoption pill that was auto-saved to slot 3

---

## Data

### New localStorage key: `statusapp_favorites`

An array of up to 14 objects, newest first:

```js
[
  {
    statusColor: '#818cf8',   // hex color string — the --my-status CSS var at time of save
    themeBg: '#1e1b4b',       // hex color string — getPaletteByKey(paletteKey)?.theme.bg,
                              //   or '#0f172a' if paletteKey is null.
                              //   Used only as a rendering hint for the pill right-half;
                              //   NOT used during the restore sequence (enterPaletteMode
                              //   derives the theme from paletteKey at restore time).
                              //   Staleness risk if palette definitions change is accepted.
    paletteKey: 'iris',       // string | null — snapshot of state.sets[activeSetKey].activePaletteKey
    selectedKey: 'iris',      // string — snapshot of state.sets[activeSetKey].selectedKey;
                              //   restored to state before calling switchSet on pill-tap
                              //   so the swatch row highlights the correct swatch
    activeSet: 1              // 1 | 2 — which set was active at time of save;
                              //   used by pill-tap to call switchSet(combo.activeSet)
                              //   before enterPaletteMode/exitPaletteMode
  },
  ...
]
```

Slots 1 & 2 are derived live from `statusapp_palette_state` (existing key) and are not stored in `statusapp_favorites`.

---

## Files Changed

| File | Change |
|------|--------|
| `js/following.js` | Remove `adoptionSnapshot`, `revertAdoption`, toggle logic in `triggerAdoption`; call `saveFavorite` in `triggerAdoption` before `applyAdoption` |
| `js/me.js` | Import `saveFavorite` from `favorites.js`; call it at top of `setAvailable()` before first `setTimeout` |
| `js/store.js` | Add `getFavorites` / `setFavorites` helpers for `statusapp_favorites` |
| `js/favorites.js` | New module: strip rendering, pill interaction, `saveFavorite`, dedup logic, collapsed state |
| `js/app.js` | Import and initialize `favorites.js` |
| `css/app.css` | Strip and pill styles, collapsed gradient line, opacity for inactive slot |
| `index.html` | Add strip container element between status bar and `#people-list` |
| `tests/favorites.test.js` | New test file for favorites module |
| `tests/following.test.js` | Update adoption tests to reflect removal of revert logic |

---

## Out of Scope

- Pill deletion (manual) — oldest auto-dropped at 16 total; no per-pill delete
- Naming or labeling saved combos
- Syncing favorites to Firebase
- Animation on pill disappear (noted as future work)
