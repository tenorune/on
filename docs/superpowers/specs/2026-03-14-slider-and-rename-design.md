# Slider While Available + Inline Rename Design

## Goal

Two UX improvements: (1) show the timeout slider only when the user is available, where it reflects remaining time and is interactive; (2) allow users to rename followed people inline.

## Architecture

Both changes are isolated to the frontend. No Firebase schema changes. No new files — changes touch `me.js`, `following.js`, `store.js`, `css/app.css`, and `tests/store.test.js`.

---

## Feature 1: Slider While Available

### Behavior

- **When unavailable:** slider is hidden.
- **Tap dot to go available:** slider appears. Its position is set to remaining hours (rounded to nearest integer, clamped 1–12). The countdown label and slider position both update every 30 seconds.
- **Drag slider while available:** `sliderValue` label updates immediately. Firebase write is debounced 500ms. After a successful write, the countdown timer is restarted with the new `availableUntil` so the interval stays in sync.
- **Tap dot to go unavailable:** slider hides.
- **Countdown reaches zero while available:** label is set to "Unavailable", `available` class removed from label, and slider is hidden. The dot class is not updated — pre-existing behavior left out of scope.

### Changes to `js/me.js`

**Replace the existing `input` listener:**

Remove the original `slider.addEventListener('input', ...)` (lines 18–21 of current code). Replace with a single listener. Since the slider is hidden when unavailable, the `else` branch is a defensive guard only — a user cannot interact with a hidden slider in normal usage:

```js
let dragDebounce = null;
slider.addEventListener('input', () => {
  if (dot.classList.contains('available')) {
    sliderValue.textContent = `${slider.value}h`;
    setLastTimeout(parseInt(slider.value, 10)); // persist synchronously so it's saved even if debounce never fires
    clearTimeout(dragDebounce);
    dragDebounce = setTimeout(async () => {
      const hours = parseInt(slider.value, 10);
      const newUntil = Date.now() + hours * 3600000;
      await setStatus(myUserId, 'available', newUntil);
      // Restart the countdown timer so it stays in sync with the new availableUntil
      clearInterval(countdownTimer);
      updateCountdownLabel(label, newUntil);
      countdownTimer = setInterval(() => updateCountdownLabel(label, newUntil), 30000);
    }, 500);
  } else {
    sliderValue.textContent = `${slider.value}h`;
    setLastTimeout(parseInt(slider.value, 10));
  }
});
```

**Swap slider visibility:**

The current code (lines 52 and 63) is inverted — it hides on available and shows on unavailable. Make these exact changes:

- In `setAvailable`: change `sliderWrap.classList.add('hidden')` → `sliderWrap.classList.remove('hidden')`.
- In `setUnavailable`: change `sliderWrap.classList.remove('hidden')` → `sliderWrap.classList.add('hidden')`.

**Sync slider position when going available:**

`setAvailable` is a module-level function outside `initMeTab`'s closure. Access `slider` inside it via `document.getElementById('timeout-slider')` — a local variable scoped to `setAvailable`, distinct from but referencing the same element as the `slider` closure variable in `initMeTab`. `timeRemainingMs` is already imported at the top of `me.js` and is in scope. No signature changes to `setAvailable` or `applyOwnStatus` are needed.

After making the slider visible in `setAvailable`, add:

```js
const slider = document.getElementById('timeout-slider');
slider.value = Math.max(1, Math.min(12, Math.round(timeRemainingMs(availableUntil) / 3600000)));
```

**Update `updateCountdownLabel` to sync slider and hide on expiry:**

The signature stays `updateCountdownLabel(label, availableUntil)` — no call-site changes. Inside, access `slider` and `sliderWrap` via `document.getElementById`. On expiry the slider is hidden; the `countdownTimer` interval continues running but each call is harmless (ms stays ≤ 0). The dot's `available` class is intentionally not cleared here — left out of scope, consistent with existing behaviour. An implementer should not add dot cleanup to this function:

```js
function updateCountdownLabel(label, availableUntil) {
  const slider = document.getElementById('timeout-slider');
  const sliderWrap = document.getElementById('slider-wrap');
  const ms = timeRemainingMs(availableUntil);
  if (ms <= 0) {
    label.textContent = 'Unavailable';
    label.classList.remove('available');
    sliderWrap.classList.add('hidden');
  } else {
    label.textContent = `Available · ${formatTimeRemaining(ms)} left`;
    slider.value = Math.max(1, Math.min(12, Math.round(ms / 3600000)));
  }
}
```

---

## Feature 2: Inline Rename

### Rename Behavior

- Tapping a person's name in the following list turns it into a text input pre-filled with the current label.
- **Confirm:** Enter key or blur saves the new label if non-empty, restores label text, removes from `editingSet`.
- **Cancel:** Escape key restores the original label without saving, removes from `editingSet`.
- **Empty input on confirm:** rejected — input stays open, no save.
- **During edit:** Firebase real-time updates skip the label-update and sort for that specific row only. Revocation detection and expiry write-back continue to run unaffected.

### Changes to `js/store.js`

Add `renameFollowing(userId, newLabel)` and include it in the `module.exports` object. The `.map` implementation renames all entries matching `userId` (in practice there is always at most one):

```js
function renameFollowing(userId, newLabel) {
  const list = getFollowing().map((e) =>
    e.userId === userId ? { ...e, label: newLabel } : e
  );
  saveFollowing(list);
}

module.exports = { getFollowing, addFollowing, removeFollowing, isFollowing, getLastTimeout, setLastTimeout, renameFollowing };
```

### Changes to `js/following.js`

- Add `renameFollowing` to the named import from `./store.js`. `following.js` uses ES module `import` syntax while `store.js` uses `module.exports` — this mismatch already exists in the codebase and is handled by the esbuild bundler. Follow the same pattern as the existing imports.
- Add `const editingSet = new Set()` at module level.
- In `subscribeToFollowee`, place the guard **immediately before the `updateFolloweeRow` call** — after revocation detection and expiry write-back, which must continue to run even during edits:

  ```js
  if (editingSet.has(entry.userId)) return;
  updateFolloweeRow(entry, userData);
  sortFollowingList();
  ```

- Add `getLabelText` helper and update `sortFollowingList` to use it, so rows being renamed sort by the in-progress value rather than empty string:

  ```js
  function getLabelText(li) {
    const labelEl = li.querySelector('.person-label');
    const input = labelEl.querySelector('.rename-input');
    return input ? input.value : labelEl.textContent;
  }
  ```

  In `sortFollowingList`, replace both `.querySelector('.person-label').textContent` reads with `getLabelText(a)` and `getLabelText(b)`.

- In `updateFolloweeRow`, attach a click handler to `.person-label` **only when creating a new `li`** (inside the `if (!li)` branch, after `list.appendChild(li)`). The handler persists for steady-state status updates. When `renderFollowingList` rebuilds the DOM (e.g., after revocation), a fresh `li` is created with a new handler — no leak:

  ```js
  li.querySelector('.person-label').addEventListener('click', () => {
    activateRename(entry, li.querySelector('.person-label'));
  });
  ```

- Add `activateRename` as a module-level function:

  ```js
  function activateRename(entry, labelEl) {
    const original = entry.label;
    editingSet.add(entry.userId);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rename-input';
    input.value = original; // assigned directly — no HTML injection risk
    labelEl.textContent = '';
    labelEl.appendChild(input);
    input.focus();
    input.select();

    function confirm() {
      const val = input.value.trim();
      if (!val) return; // reject empty — input stays open
      renameFollowing(entry.userId, val);
      entry.label = val; // keep in-memory reference in sync: if user clicks the label again
      // before any re-render, activateRename re-uses this same entry object, so the
      // mutation ensures `original` captures the latest saved label, not the pre-rename value.
      editingSet.delete(entry.userId); // MUST come before labelEl.textContent assignment
      labelEl.textContent = val;
      // Note: setting labelEl.textContent removes the input from the DOM,
      // which fires a blur event. The editingSet.delete above ensures the
      // blur handler's guard (editingSet.has check) prevents a second confirm().
    }

    function cancel() {
      editingSet.delete(entry.userId); // MUST come before labelEl.textContent assignment
      labelEl.textContent = original;
      // Note: same as confirm — setting textContent fires blur, and the guard prevents
      // a spurious confirm() call.
    }

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
      if (e.key === 'Escape') { cancel(); }
    });
    input.addEventListener('blur', () => {
      if (editingSet.has(entry.userId)) confirm();
    });
  }
  ```

### Changes to `css/app.css`

Add a style for `.rename-input`:

```css
.rename-input {
  font: inherit;
  color: inherit;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--green);
  outline: none;
  width: 100%;
  padding: 0;
  box-sizing: border-box;
}
```

### Changes to `tests/store.test.js`

Add tests for `renameFollowing`:

- Renames an existing entry's label by userId; other fields (code, userId) are unchanged.
- Leaves other entries in the list unchanged.
- Does nothing (no error; saved list is identical to input) if userId not found.

Automated DOM tests for `following.js` logic (editingSet, activateRename) are out of scope — consistent with the existing test structure which covers only pure logic modules.

---

## Error Handling

- Empty label on rename confirm: input stays open, no save.
- Slider drag below 1h remaining: slider sits at minimum (1), label shows actual remaining time.
- Slider drag to extend beyond 12h: clamped by slider `max` attribute.

## Testing

- `store.test.js`: 3 unit tests for `renameFollowing`.
- Manual: toggle available/unavailable — verify slider shows only when available. Go available, verify slider position matches remaining hours. Drag slider, verify `sliderValue` label updates immediately, Firebase write fires after 500ms, countdown timer resets to the new value. Let countdown expire, verify slider hides. Tap a name, rename with Enter, rename with blur, attempt empty confirm (should stay open), cancel with Escape.
