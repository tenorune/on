# Long-press Palette Adoption — Design Spec

**Date:** 2026-03-18
**Feature flag:** `PALETTES_ENABLED`
**Branch:** new worktree from main

---

## Overview

A long press on any card in the Mutuals or Following list adopts that user's palette theme and status color into the local UI. Long pressing the same card again reverts to the pre-adoption state. The feature is fully gated behind `PALETTES_ENABLED`.

---

## Architecture

All new logic lives in `js/following.js`. No new files. Two new private functions (`applyAdoption`, `revertAdoption`) and one new module-level state variable (`adoptionSnapshot`).

---

## Module State

```js
let adoptionSnapshot = null;
// Shape when set:
// {
//   fromUserId: string,        // which card triggered adoption
//   activePaletteKey: string | null,
//   selectedKey: string,
//   statusColor: string        // hex, e.g. '#22c55e'
// }
```

`activePaletteKey` and `selectedKey` are read from `getPaletteState()` at adoption time. `statusColor` is read from the `--my-status` CSS variable, which is always current because `applyPaletteVars` keeps it in sync.

---

## Long Press Detection

Attached per-card inside `renderListItem`, gated by `PALETTES_ENABLED`. Uses pointer events so it works on both touch and mouse.

- **Trigger delay:** 500 ms
- **Cancel threshold:** pointer moves > 8 px from press origin (allows scrolling and swipe gestures to cancel cleanly)
- **Cancel events:** `pointerup`, `pointercancel`, `pointermove` beyond threshold

```js
let pressTimer = null;
let pressStartX, pressStartY;

li.addEventListener('pointerdown', (e) => {
  pressStartX = e.clientX;
  pressStartY = e.clientY;
  pressTimer = setTimeout(() => triggerAdoption(entry, myUserId), 500);
});
li.addEventListener('pointermove', (e) => {
  if (pressTimer && (Math.abs(e.clientX - pressStartX) > 8 ||
                     Math.abs(e.clientY - pressStartY) > 8)) {
    clearTimeout(pressTimer); pressTimer = null;
  }
});
['pointerup', 'pointercancel'].forEach(ev =>
  li.addEventListener(ev, () => { clearTimeout(pressTimer); pressTimer = null; })
);
```

`triggerAdoption(entry, myUserId)` checks: if `adoptionSnapshot?.fromUserId === entry.userId` → `revertAdoption(myUserId)`; else → `applyAdoption(entry, myUserId)`.

---

## Adoption Flow (`applyAdoption`)

1. If `adoptionSnapshot` is already set (adopted from a different card), call `revertAdoption(myUserId)` first.
2. Snapshot current state:
   ```js
   const ps = getPaletteState();
   const activeSet = String(ps.activeSet);
   adoptionSnapshot = {
     fromUserId: entry.userId,
     activePaletteKey: ps.sets[activeSet].activePaletteKey,
     selectedKey: ps.sets[activeSet].selectedKey,
     statusColor: getComputedStyle(document.documentElement)
                    .getPropertyValue('--my-status').trim(),
   };
   ```
3. If `targetData.paletteKey` exists → `enterPaletteMode(targetData.paletteKey, myUserId)` (applies theme vars, writes `setPaletteKey` to Firebase, re-renders swatch row).
4. `setStatusColor(myUserId, targetData.statusColor)` — Firebase write.
5. Set `--my-status` and `--my-glow` CSS vars directly on `document.documentElement` to match `targetData.statusColor`.
6. Add `adopted-from` CSS class to the target `<li>` as a visual indicator.

---

## Revert Flow (`revertAdoption`)

1. If `snapshot.activePaletteKey` was non-null → `enterPaletteMode(snapshot.activePaletteKey, myUserId)`; else → `exitPaletteMode(myUserId)`.
2. `applyPaletteVars(snapshot.selectedKey)` — restores `--my-status` / `--my-glow` visuals.
3. `setStatusColor(myUserId, snapshot.statusColor)` — Firebase write restoring original color.
4. Remove `adopted-from` class from any `<li>` that has it.
5. Set `adoptionSnapshot = null`.

---

## Visual Indicator

`.adopted-from` class on the source card — a subtle persistent indicator (e.g. accent border or icon) showing which card is currently adopted. Exact styling TBD in implementation.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| Target has no `paletteKey` | Skip `enterPaletteMode`; still adopt `statusColor` |
| Long press same card while adopted | Revert |
| Long press different card while adopted | Revert old, adopt new |
| `PALETTES_ENABLED: false` | No handler attached; `adoptionSnapshot` never set |
| Target `statusColor` is absent | Skip statusColor adoption (no-op) |

---

## Tests

- Long press fires `applyAdoption` after 500 ms
- `pointermove` > 8 px cancels — `applyAdoption` not called
- Long press same card while adopted → `revertAdoption` called
- Long press different card while adopted → revert old, adopt new
- Target with no `paletteKey` → `enterPaletteMode` not called, statusColor still adopted
- `PALETTES_ENABLED: false` → no handler attached
- `revertAdoption` restores snapshot state and clears `adoptionSnapshot`

---

## Files Changed

| File | Change |
|---|---|
| `js/following.js` | `adoptionSnapshot` state, `applyAdoption`, `revertAdoption`, `triggerAdoption`, long press handler in `renderListItem` |
| `css/app.css` | `.adopted-from` indicator style |
| `tests/following.test.js` | New tests for all adoption scenarios |
