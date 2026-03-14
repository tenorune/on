# Slider While Available + Inline Rename Design

## Goal

Two UX improvements: (1) show the timeout slider only when the user is available, where it reflects remaining time and is interactive; (2) allow users to rename followed people inline.

## Architecture

Both changes are isolated to the frontend. No Firebase schema changes. No new files — changes touch `me.js`, `following.js`, `store.js`, and `tests/store.test.js`.

---

## Feature 1: Slider While Available

### Behavior

- **When unavailable:** slider is hidden (existing behavior preserved).
- **Tap dot to go available:** slider appears. Its position is set to remaining hours (rounded to nearest integer, clamped 1–12). The countdown label and slider position both update every 30 seconds.
- **Drag slider while available:** updates `availableUntil = Date.now() + slider.value * 3600000` in Firebase. Write is debounced 500ms to avoid spamming on drag.
- **Tap dot to go unavailable:** slider hides. Next time user goes available, `availableUntil` is calculated from the last-used timeout value (already persisted in localStorage via `setLastTimeout`).

### Changes to `js/me.js`

- Remove `sliderWrap.classList.add('hidden')` from `setAvailable`.
- Remove `sliderWrap.classList.remove('hidden')` from `setUnavailable` — instead add `sliderWrap.classList.add('hidden')` there.
- In `setAvailable`, sync slider position: `slider.value = Math.max(1, Math.min(12, Math.round(timeRemainingMs(availableUntil) / 3600000)))`.
- In `updateCountdownLabel`, also update slider position the same way.
- Add a debounced drag handler on the slider `input` event. When status is available, after 500ms of no input, call `setStatus(myUserId, 'available', Date.now() + slider.value * 3600000)` and update `setLastTimeout(slider.value)`.
- The existing `slider.addEventListener('input', ...)` (which updates the label and saves last timeout) is retained for the unavailable state. When available, the label shows countdown text instead of "Xh", so the `sliderValue` text element update only fires when unavailable.

### Debounce

A simple `setTimeout`/`clearTimeout` debounce inside `me.js`. No new utility needed.

---

## Feature 2: Inline Rename

### Behavior

- Tapping a person's name in the following list turns it into a `<input type="text">` pre-filled with the current label.
- **Confirm:** Enter key or blur saves the new label (if non-empty) to localStorage and updates the DOM.
- **Cancel:** Escape key restores the original label without saving.
- **Empty input on confirm:** rejected — input remains open (no save, no close).
- **During edit:** Firebase real-time updates for that row skip updating the label, to avoid overwriting in-progress edits. A module-level `Set<userId>` (`editingSet`) tracks which rows are being edited.

### Changes to `js/store.js`

Add `renameFollowing(userId, newLabel)`:
```js
function renameFollowing(userId, newLabel) {
  const list = getFollowing().map((e) =>
    e.userId === userId ? { ...e, label: newLabel } : e
  );
  saveFollowing(list);
}
```
Export it alongside existing functions.

### Changes to `js/following.js`

- Add `const editingSet = new Set()` at module level.
- In `updateFolloweeRow`, when creating a new `li`, attach a click handler to `.person-label` that activates inline edit mode.
- In `updateFolloweeRow`, when updating an existing `li`, skip updating the label text if `editingSet.has(entry.userId)`.
- Inline edit activation:
  1. Add `entry.userId` to `editingSet`.
  2. Replace `.person-label` content with `<input type="text" class="rename-input" value="<current label>">`.
  3. Focus and select the input.
- On `keydown`: Enter → confirm, Escape → cancel.
- On `blur` → confirm.
- Confirm: if value non-empty, call `renameFollowing(entry.userId, newValue)`, update `entry.label` in memory, restore label text, remove from `editingSet`.
- Cancel: restore original label text, remove from `editingSet`.

### Changes to `tests/store.test.js`

Add tests for `renameFollowing`:
- Renames an existing entry by userId.
- Leaves other entries unchanged.
- Does nothing if userId not found.

---

## Error Handling

- Empty label on rename confirm: input stays open, no save.
- Slider drag below remaining time to < 1h: slider sits at minimum (1), label shows actual remaining. Firebase write uses `slider.value * 3600000` so minimum extension is 1h.
- Slider drag to extend beyond 12h: clamped by slider max.

## Testing

- `store.test.js`: unit tests for `renameFollowing` (3 cases).
- Manual: toggle available/unavailable, verify slider shows/hides. Go available, wait, verify slider position decrements. Drag slider, verify Firebase update and countdown reset. Tap a name, rename, confirm with Enter and blur, cancel with Escape.
