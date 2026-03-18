# Favorites Strip — Design Spec
**Date:** 2026-03-18
**Status:** Approved

---

## Overview

A horizontally scrollable strip of palette+status-color combo pills, positioned between the status bar and the people list. Lets users quickly switch between saved combinations and recover a previous state after adopting a contact's theme.

---

## Visibility

The strip is hidden until a third combo has been saved (i.e., at least one entry in slots 3–16 exists). First-time users and users who have never changed their status or theme will not see the strip.

---

## Location

Between the status bar (availability header) and the people list (`#people-list`).

---

## Layout

- Horizontally scrollable row of pills
- Collapsible: collapses to a thin gradient line drawn using the saved status colors
- Tapping the collapsed line expands the strip
- Collapsed/expanded state persisted in localStorage

---

## Pill Shape

Each combo is represented as a two-half pill:
- **Left half:** status color
- **Right half:** theme background color

Both halves are always present. Combos without an active palette theme use the default slate background (`#0f172a`) as the right half — visually consistent with themed combos.

---

## Slots

### Slots 1 & 2 — Live Set Mirrors (always visible when strip is shown)

- **Slot 1:** Always reflects Set 1's current selected combo
- **Slot 2:** Always reflects Set 2's current selected combo
- Both are **interactive**: tapping the inactive slot switches to that set's combo (equivalent to the set toggle in the palette picker)
- The active slot (current UI) is rendered at full opacity; the inactive slot at reduced opacity to indicate it's an alternate

### Slots 3–16 — Saved History

- Newest first
- Maximum 14 entries
- When a 15th entry would be added, the oldest is dropped
- Duplicates are skipped silently — if the incoming combo matches slot 1 or slot 2 exactly, it is not saved
- Tapping a pill applies that combo, removes it from the history list (it is now reflected in slot 1 or 2), and the previously active slot's old combo shifts to slot 3

---

## Auto-Save Triggers

A combo is saved to the history (slots 3–16) in exactly two situations:

1. **User goes Available** — the current combo (status color + palette state) is captured and saved
2. **User long-presses a contact card (adoption)** — the current combo is saved *before* adoption is applied, so it can be recovered by tapping a pill

No other interactions trigger a save.

---

## Collapsed State Affordance

When collapsed, the strip renders as a thin horizontal gradient line spanning the full width, using the saved status colors as gradient stops. Tapping the line expands the strip.

---

## Tapping a Pill (Slots 3–16)

1. Apply the combo: call `switchSet(combo.activeSet)`, then `enterPaletteMode(combo.paletteKey)` if `paletteKey` is non-null, otherwise `exitPaletteMode()`, then `setStatusColor(myUserId, combo.statusColor)` and update `--my-status` / `--my-glow` CSS vars
2. Remove the pill from the history array (it is now the active combo, shown in slot 1 or 2)
3. The previously active slot's old combo is prepended to the history as slot 3

---

## Adoption Simplification

The long-press adoption feature is simplified:

- `adoptionSnapshot`, `revertAdoption`, and the same-card toggle logic in `triggerAdoption` are **removed**
- Long-press always applies the contact's combo (never reverts)
- Recovery from an unwanted adoption is done by tapping the pre-adoption pill that was auto-saved to slot 3

---

## Data

### New localStorage key: `statusapp_favorites`

An array of up to 14 objects, newest first:

```js
[
  {
    statusColor: '#818cf8',   // hex color string
    themeBg: '#1e1b4b',       // hex color string (default slate if no theme)
    paletteKey: 'iris',       // string | null
    activeSet: 1              // 1 | 2
  },
  ...
]
```

Slots 1 & 2 are derived live from `statusapp_palette_state` (existing key) and are not stored in `statusapp_favorites`.

---

## Files Changed

| File | Change |
|------|--------|
| `js/following.js` | Remove `adoptionSnapshot`, `revertAdoption`, toggle logic in `triggerAdoption`; save current combo before applying adoption |
| `js/me.js` | Save current combo when user goes Available |
| `js/store.js` | Add `getFavorites` / `setFavorites` helpers for `statusapp_favorites` |
| `js/favorites.js` | New module: strip rendering, pill interaction, save/dedup logic, collapsed state |
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
