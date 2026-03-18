# Long-press Palette Adoption — Design Spec

**Date:** 2026-03-18
**Feature flag:** `PALETTES_ENABLED`
**Branch:** new worktree from main

---

## Overview

A long press on any Mutuals or Following card adopts that user's palette theme and status color into the local UI. Long pressing the same card again reverts to the pre-adoption state. Followers-only rows (no `statusColor` or `paletteKey`) do not receive the long press handler. The feature is fully gated behind `PALETTES_ENABLED`.

---

## Architecture

All new logic lives in `js/following.js`. No new files. Three new private functions (`applyAdoption`, `revertAdoption`, `triggerAdoption`) and one new module-level state variable (`adoptionSnapshot`).

`adoptionSnapshot` is reset to `null` in `initList` alongside the other module-level state resets.

---

## Module State

```js
let adoptionSnapshot = null;
// Shape when set:
// {
//   fromUserId: string,        // which card triggered adoption
//   activeSet: number,         // ps.activeSet at adoption time
//   activePaletteKey: string | null,
//   selectedKey: string,
//   statusColor: string,       // hex of --my-status at adoption time
//   glowColor: string,         // hex of --my-glow at adoption time
// }
```

All fields are read at adoption time. `statusColor` and `glowColor` are read from the `--my-status` / `--my-glow` CSS variables via `getComputedStyle`, which always reflect the current effective values. `activeSet` and `activePaletteKey` come from `getPaletteState()`. `selectedKey` is captured for completeness but is not mutated by adoption and does not need explicit restoration. Note: `switchSet` in revert step 1 reads `selectedKey` directly from the store (not from the snapshot) as a side-effect, but the resulting intermediate CSS var values are overwritten by revert steps 2–4 before any frame is painted.

`activeSet` is captured so the revert can restore the correct set even if the user switches sets between adoption and revert. Because `enterPaletteMode` and `exitPaletteMode` always operate on `state.activeSet` at call time, the revert must call `switchSet(snapshot.activeSet, userId)` before calling either function.

---

## Long Press Detection

Attached per-card inside `createFolloweeRow` (not `createFollowerOnlyRow`), gated by `PALETTES_ENABLED`. Uses pointer events so it works on both touch and mouse.

- **Trigger delay:** 500 ms
- **Cancel threshold:** pointer moves > 8 px from press origin (allows scrolling to cancel cleanly; also cancels the timer for swipe gestures before they complete, preventing accidental adoption on slow swipes)
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

**Interaction with call mode swipe gesture:** The existing `CALL_ENABLED` swipe handler also attaches `pointerdown` to the same `<li>`. Both listeners fire independently. A swipe gesture will generate `pointermove` events beyond the 8 px threshold before 500 ms elapses, cancelling the long-press timer. The two gestures do not interfere in normal use.

---

## Adoption Flow (`applyAdoption`)

1. If `adoptionSnapshot` is already set (adopted from a different card), call `revertAdoption(myUserId)` first.
2. Snapshot current state:

   ```js
   const ps = getPaletteState();
   const activeSet = String(ps.activeSet);
   const style = getComputedStyle(document.documentElement);
   adoptionSnapshot = {
     fromUserId: entry.userId,
     activeSet: ps.activeSet,
     activePaletteKey: ps.sets[activeSet].activePaletteKey,
     selectedKey: ps.sets[activeSet].selectedKey,
     statusColor: style.getPropertyValue('--my-status').trim(),
     glowColor:   style.getPropertyValue('--my-glow').trim(),
   };
   ```

3. If `targetData.paletteKey` exists → `enterPaletteMode(targetData.paletteKey, myUserId)` (sets `activePaletteKey` in store, applies theme vars, writes `setPaletteKey` to Firebase, re-renders swatch row).
4. If `targetData.statusColor` exists → `setStatusColor(myUserId, targetData.statusColor)` (Firebase write) and set CSS vars:

   ```js
   const glow = getGlowForColor(targetData.statusColor); // Forest fallback for unrecognised hex
   document.documentElement.style.setProperty('--my-status', targetData.statusColor);
   document.documentElement.style.setProperty('--my-glow', glow);
   ```

   `--my-status` mirrors what the swatch complement tap handler in `palettes.js` sets. `--my-glow` is additionally set here (the complement handler does not set it). Both are local-only — no additional Firebase write.
5. Add `adopted-from` CSS class to the target `<li>` as a visual indicator.

---

## Revert Flow (`revertAdoption`)

1. `switchSet(snapshot.activeSet, myUserId)` — restores the active set so that `enterPaletteMode`/`exitPaletteMode` operate on the correct set. Note: `switchSet` has three side-effects — it calls `applyPaletteVars` (sets `--my-status`/`--my-glow`), `setStatusColor` (Firebase write), and `applyThemeVars`/`resetThemeVars` (sets theme vars). The CSS vars and Firebase color write are overwritten by steps 3–4. The theme vars are overwritten by step 2 (`enterPaletteMode` calls `applyThemeVars`; `exitPaletteMode` calls `resetThemeVars`). All `switchSet` side-effects are therefore harmless intermediates.
2. If `snapshot.activePaletteKey` was non-null → `enterPaletteMode(snapshot.activePaletteKey, myUserId)` (writes `setPaletteKey` to Firebase, applies theme, re-renders swatches); else → `exitPaletteMode(myUserId)` (writes `setPaletteKey(null)` to Firebase, resets theme, re-renders swatches). Both functions already handle the Firebase write internally; no additional `setPaletteKey` call is needed.
3. Restore CSS vars directly from snapshot (must come after `switchSet` / palette mode calls, which also write these vars):

   ```js
   document.documentElement.style.setProperty('--my-status', snapshot.statusColor);
   document.documentElement.style.setProperty('--my-glow', snapshot.glowColor);
   ```

   Using the snapshotted raw values (rather than re-deriving via `applyPaletteVars` or `getGlowForColor`) ensures complement colors and their glows are restored exactly.
4. `setStatusColor(myUserId, snapshot.statusColor)` — Firebase write restoring original color.
5. Remove `adopted-from` class from any `<li>` that has it.
6. Set `adoptionSnapshot = null`.

---

## Visual Indicator

`.adopted-from` class on the source card — a subtle persistent indicator (e.g. accent border or icon) showing which card is currently adopted. Exact styling TBD in implementation.

---

## Edge Cases

| Scenario | Behavior |
| --- | --- |
| Target has no `paletteKey` | Skip `enterPaletteMode`; still adopt `statusColor` |
| Target has no `statusColor` | Skip statusColor steps; `setStatusColor` not called; CSS vars unchanged |
| Long press same card while adopted | Revert |
| Long press different card while adopted | Revert old, adopt new |
| User switches palette set between adoption and revert | `switchSet(snapshot.activeSet)` in revert step 1 restores the correct set before palette mode calls |
| `PALETTES_ENABLED: false` | No handler attached; `adoptionSnapshot` never set |
| Followers-only rows | No long press handler attached (no `statusColor` / `paletteKey` available) |
| `initList` called while adopted | `adoptionSnapshot` reset to `null`; no revert writes triggered |

---

## Tests

- Long press fires adoption after 500 ms
- Long press cancelled at 499 ms does not fire adoption
- `pointermove` > 8 px cancels — adoption not called
- `pointerup` before 500 ms cancels — adoption not called
- Long press same card while adopted → revert called
- Long press different card while adopted → `revertAdoption` called before new `applyAdoption` (order verified)
- Target with no `paletteKey` → `enterPaletteMode` not called, statusColor still adopted
- Target with no `statusColor` → `setStatusColor` not called, CSS vars unchanged
- `PALETTES_ENABLED: false` → no handler attached
- `revertAdoption` calls `switchSet` with snapshot's `activeSet` before palette mode calls
- `revertAdoption` calls `setStatusColor` with original statusColor after `switchSet` (not before)
- `revertAdoption` sets `--my-status` / `--my-glow` from snapshot after `switchSet` / palette mode calls
- `revertAdoption` clears `adoptionSnapshot`
- `applyAdoption` adds `.adopted-from` class to target `<li>`
- `revertAdoption` removes `.adopted-from` class

---

## Files Changed

| File | Change |
| --- | --- |
| `js/following.js` | `adoptionSnapshot` state, `applyAdoption`, `revertAdoption`, `triggerAdoption`, long press handler in `createFolloweeRow`, reset in `initList` |
| `css/app.css` | `.adopted-from` indicator style |
| `tests/following.test.js` | New tests for all adoption scenarios |
