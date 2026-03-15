# Unified UI Design Spec

## Goal

Replace the three-tab layout (Me / Following / My Code) with a single scrollable screen. The header always shows the user's own status controls; a merged list below shows all social connections in one view.

## Approach

Refactor in-place: keep `me.js`, `following.js`, and `mycode.js` as separate modules, each targeting new DOM IDs in the unified layout. A coordinator in `app.js` calls all three init functions at startup (in order: `initCodeDrawer` first, then `initHeader`, then `initList`) so the drawer DOM is ready before the chip click handler is attached. Firebase subscriptions for followees open at load time (no lazy tab init).

---

## Section 1: HTML Structure

Remove: `<section id="tab-me">`, `<section id="tab-following">`, `<section id="tab-mycode">`, `<nav class="bottom-nav">`.

Replace `<main>` content with:

```html
<header id="app-header">
  <div id="header-row">
    <div id="my-dot" class="dot"></div>
    <div id="header-text">
      <div id="header-status-row">
        <span id="my-status-label">Unavailable</span>
        <span id="time-remaining"></span>
      </div>
      <div id="header-chips">
        <button id="time-chip" class="chip time-chip">2 hours</button>
        <button id="mycode-chip" class="chip">My Code</button>
      </div>
    </div>
  </div>
  <div id="code-drawer">
    <p class="code-card-label">Your code</p>
    <div class="code-display-row">
      <span id="my-code-display" class="code-display"></span>
      <button id="rotate-code-btn" class="rotate-btn" title="Generate new code">↻</button>
      <button id="copy-code-btn" class="ghost-btn">Copy</button>
    </div>
    <p id="rotate-error-msg" class="error-msg hidden"></p>
    <p class="hint">Share this so others can follow your status.</p>
  </div>
</header>

<main id="main-list">
  <ul id="people-list" class="person-list"></ul>
  <p id="empty-list-msg" class="hidden">Add someone below to get started.</p>
  <button id="add-person-btn" class="add-btn">+ Add person</button>
  <div id="add-person-form" class="add-form hidden">
    <label class="field-label">Code</label>
    <input id="add-code-input" class="code-input" maxlength="6" />
    <label class="field-label">Name (optional)</label>
    <input id="add-label-input" class="text-input" />
    <p id="add-error" class="error-msg hidden"></p>
    <div style="display:flex;gap:8px">
      <button id="add-submit-btn" class="primary-btn">Follow</button>
      <button id="add-cancel-btn" class="ghost-btn">Cancel</button>
    </div>
  </div>
</main>
```

Note: `#header-chips` and `#code-drawer` have no `hidden` class in HTML — their visibility is controlled entirely by CSS classes (`.visible` and `.open` respectively) to allow CSS transitions to work. See Section 4.

The `#stale-screen` overlay and `#offline-banner` remain unchanged (fixed position, no tab dependency).

---

## Section 2: Header & Drawer Behavior

### Status header

- `#my-dot` — 48px circle; taps to toggle available ↔ unavailable (same logic as current dot)
- `#my-status-label` — text is "Available" or "Unavailable" only (never includes time); color fades green ↔ muted grey on transition
- `#time-remaining` — shown inline when available (e.g. "· 2 hours left") via JS setting `textContent`; cleared and hidden when unavailable. This is a separate element from `#my-status-label` — the two elements sit side by side in `#header-status-row`.
- `#header-chips` — controlled via `.visible` class (see Section 4). When going available: set `display: flex` then on the next animation frame add `.visible`. When going unavailable: remove `.visible`, then listen for `transitionend` on `#mycode-chip` filtered to `e.propertyName === 'opacity'` (it is the last element to finish due to its 80ms delay), then set `display: none`. This sequences the display change to allow the CSS opacity/transform transition to run completely.
- Chips animate in with stagger: `#time-chip` transitions immediately; `#mycode-chip` transitions 80ms later (via `transition-delay`).

### Time chip (`#time-chip`)

Duration is stored and handled in **minutes** (integer). The chip sequence is:

| Index | Minutes | Display text |
| ----- | ------- | ------------ |
| 0 | 30 | "30 minutes" |
| 1 | 60 | "1 hour" |
| 2 | 90 | "1 hour 30 minutes" |
| 3 | 120 | "2 hours" (default) |
| 4 | 180 | "3 hours" |
| 5 | 240 | "4 hours" |
| 6 | 360 | "6 hours" |
| 7 | 480 | "8 hours" |

Fixed width (148px), text-align center. Tapping the chip while available:

1. Advances to next index (wraps from 7 → 0)
2. Calls `setStatus(userId, 'available', Date.now() + minutes * 60000)`
3. Updates `#time-remaining` text
4. Calls `setLastTimeout(minutes)` to persist

**Init:** `getLastTimeout()` always returns an integer (the store defaults to `2` when nothing is stored, never null). If the returned value is ≤ 12, treat it as the old hours format and multiply by 60 to get minutes. Snap to the nearest chip value: find the chip `minutes` value closest to the computed minutes. On a tie (equidistant between two chips), prefer the lower duration. The default store value of `2` (old format) becomes 120 minutes, which is exactly index 3 — the spec default. Set `#time-chip` text to the matching display text. No separate null/undefined branch is needed.

### My Code chip (`#mycode-chip`)

Text only, no icon. Taps to toggle `#code-drawer` open/closed by adding/removing the `.open` class. When open, chip gets `.active` class (accent border). Tapping again closes the drawer and removes `.active`.

### Code drawer (`#code-drawer`)

Hidden by default via CSS (`max-height: 0; overflow: hidden`). Opens via `.open` class (`max-height: 200px`). Contains:

- `#my-code-display` — 6-char code in large monospace
- `#rotate-code-btn` — rotate button (existing confirmation sheet + spinner + fade animation behavior)
- `#copy-code-btn` — copy to clipboard (existing behavior)
- `#rotate-error-msg` — error display
- Help text paragraph

---

## Section 3: Merged List

`#people-list` is a single `<ul>` rendered by `following.js`. Entries are divided into three labeled groups in order: **Mutuals → Following → Followers**. A group is omitted entirely (no label row, no person rows) when it has no entries. When all three groups are empty, `#empty-list-msg` is shown and `#people-list` is hidden.

Section labels are `<li class="list-section-label">` items inserted before each group's rows.

### Mutual status determination

Mutuals are determined by joining on **`userId`**:

- `getFollowing()` returns `[{ userId, code, label }]` from localStorage
- The live Firebase followers snapshot is `{ [followerId]: followerCode }` where the key is the follower's userId

A user is a **Mutual** if their `userId` appears as a key in the followers snapshot AND in `getFollowing()`.
A user is **Following-only** if their `userId` appears in `getFollowing()` but not in the followers snapshot.
A user is **Follower-only** if their `userId` appears as a key in the followers snapshot but not in `getFollowing()`.

Matching is always on `userId`, not on `code` (codes can change via rotation).

### Row sort order

Within each section, rows are sorted: available-first, then alphabetically by label (or code for follower-only rows). This preserves the existing sort behavior from `sortFollowingList()`.

### Row layouts

**Mutual row:**

```text
[dot 32px] [label] [status text]          [× btn]
```

If the user's label from `getFollowing()` is non-empty, it is shown as the primary name. Below the name, a `.person-follower-name` element shows their code in muted text (same pattern as the current follower name display in `mycode.js`).

**Following-only row:** identical to Mutual row.

**Follower-only row:**

```text
[+ btn 32px] [code monospace]             [× btn]
```

Row has `class="follower-only"` (opacity 0.6). The `+` button is `.follow-back-btn` (circle outline in accent color). Tapping it:

1. Pre-fills `#add-code-input` with the follower's code
2. Clears `#add-label-input` (user must enter name if they want one; label is optional)
3. Shows the Add Person form (same as tapping `#add-person-btn`)

### Actions

**× on Mutual / Following row:** Opens confirmation sheet with title "Unfollow [name]?" → on confirm: calls `unregisterAsFollower(targetUserId, myUserId)` + `removeFollowing(targetUserId)` from store (existing unfollow flow).

**× on Follower-only row:** Opens confirmation sheet with title "Remove follower [code]?" → on confirm: calls `removeFollower(myUserId, followerUserId)` (existing remove-follower flow).

**Inline rename:** Tapping a name label on a Mutual or Following row activates inline rename (existing behavior). Follower-only rows show a monospace code with no tap behavior — tapping the code does nothing.

### Add Person (bottom of list)

`#add-person-btn` is a dashed-border row below the list. Tapping it (or activating it via the follow-back `+` button) hides `#add-person-btn` and shows `#add-person-form` inline. The form has code + label inputs, Follow + Cancel buttons. Cancel hides the form and shows the button again. The label field is optional — blank label is allowed. The code field is required; if submitted with a blank code, show error: "Please enter a code." Behavior otherwise identical to the existing add-person form.

---

## Section 4: CSS Changes

### Remove

- `.bottom-nav`, `.nav-btn`, `.nav-icon`, `.nav-label` rules
- `.tab-panel`, `.tab-panel.active` rules
- `.slider-wrap`, `.slider-header`, `.slider-title`, `.slider-value`, `.slider`, `.slider-ticks` rules

### Update

- `main` — remove `calc(100vh - 64px)` height constraint; set `padding: 16px`
- `.dot` — set size to 48px (down from 100px); remove tap-to-toggle size animation if any

### Add

```css
#app-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--surface);
  padding: 16px;
  border-bottom: 1px solid var(--surface2);
}

#header-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

#header-text {
  flex: 1;
}

#header-status-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
}

#time-remaining {
  color: var(--text-muted);
  font-size: 14px;
}

/* Chips — hidden by default, shown via JS class toggle */
#header-chips {
  display: none; /* JS sets display:flex before adding .visible */
  gap: 8px;
  margin-top: 8px;
  opacity: 0;
  transform: translateY(-6px);
  transition: opacity 0.25s ease, transform 0.25s ease;
}
#header-chips.visible {
  opacity: 1;
  transform: translateY(0);
}

.chip {
  background: var(--surface2);
  border: 1px solid var(--surface2);
  color: var(--text);
  border-radius: 999px;
  padding: 4px 14px;
  font-size: 13px;
  cursor: pointer;
}
.chip.active {
  border-color: var(--accent);
  color: var(--accent);
}
.time-chip {
  width: 148px;
  text-align: center;
}
/* Stagger: mycode-chip animates 80ms after time-chip */
#mycode-chip {
  transition-delay: 80ms;
}

/* Code drawer slide */
#code-drawer {
  overflow: hidden;
  max-height: 0;
  transition: max-height 0.3s ease, margin-top 0.3s ease;
  margin-top: 0;
}
#code-drawer.open {
  max-height: 200px;
  margin-top: 12px;
}

/* List section labels */
.list-section-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-muted);
  padding: 12px 0 4px;
  list-style: none;
}

/* Follower-only row */
.person-list li.follower-only {
  opacity: 0.6;
}

/* Follow-back button (occupies same left slot as status dot) */
.follow-back-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1.5px solid var(--accent);
  color: var(--accent);
  background: transparent;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}
```

---

## Section 5: JS Module Changes

### `app.js`

Remove `initTabs()` and bottom-nav event listeners. Init order:

```js
initCodeDrawer(myUserId, myCode);  // first: drawer DOM ready
initHeader(myUserId);              // second: chip handler attaches to ready drawer
initList(myUserId, myCode);        // third: list subscribes to followers
```

### `me.js`

- Rename `initMeTab(userId)` → `initHeader(userId)`
- Remove all slider DOM references (`#slider-wrap`, `#timeout-slider`, `#slider-value`, `.slider-ticks`)
- Replace slider logic with time chip logic:
  - On init: read `getLastTimeout()`, apply old-format migration (if ≤ 12 multiply by 60), snap to nearest chip value, set `#time-chip` text
  - On chip click: advance index (wrap), call `setStatus`, update `#time-remaining`, call `setLastTimeout(minutes)`
- Add `#mycode-chip` click handler: toggles `.open` on `#code-drawer` and `.active` on `#mycode-chip`
- `applyOwnStatus(status, availableUntil)` — update to:
  - Set `#my-status-label` text to "Available" or "Unavailable" (status text only, no time appended)
  - Set `#my-status-label` color class (`.available` → green, else muted)
  - Show/hide `#time-remaining`: when available, set `textContent` to `"· " + formatTimeRemaining(timeRemainingMs(availableUntil))`; when unavailable, clear and hide
  - Show/hide `#header-chips`: when available, set `display: flex` then rAF → add `.visible`; when unavailable, remove `.visible` → on `transitionend` set `display: none`
- Existing `updateCountdownLabel` function is replaced by the `#time-remaining` update logic above. The countdown timer (updates every 30s) now writes to `#time-remaining` only.

### `store.js`

- `setLastTimeout(n)` — `n` is now **minutes** (integer). Accepted values: 30, 60, 90, 120, 180, 240, 360, 480.
- `getLastTimeout()` — returns stored integer. Callers (only `me.js`) apply the old-format migration: if returned value ≤ 12, multiply by 60.
- No other changes to `store.js`.

### `mycode.js`

- Rename `initMyCodeTab(userId, code)` → `initCodeDrawer(userId, code)`
- Targets `#my-code-display`, `#rotate-code-btn`, `#copy-code-btn`, `#rotate-error-msg` (same IDs, now inside drawer)
- Remove `renderFollowers` export entirely — follower rendering moves to `following.js`
- Remove `watchFollowers` call — moved to `following.js`

### `following.js`

- Rename `initFollowingTab(userId, code)` → `initList(userId, code)`
- Replace all `#following-list` references with `#people-list` throughout (including the `doUnfollow` DOM removal)
- **`watchFollowers` call (moved from `mycode.js`):** Store the returned unsubscribe function in a module-level variable (`let unsubFollowers = null`). Call it only once from `initList`. In the `watchFollowers` callback, store the latest snapshot in a module-level variable (`let latestFollowersSnapshot = {}`) and call `renderList`.
- **`renderList(userId)` (no parameters — reads `getFollowing()` and `latestFollowersSnapshot` from module scope):**
  - Computes mutual/following/follower-only groupings (join on userId as described in Section 3)
  - Clears `#people-list`, renders section label `<li>` items and person rows
  - Shows `#empty-list-msg` and hides `#people-list` when all sections are empty; reverses when non-empty
  - Sorts rows within each section: available-first, then alphabetical
  - For each Mutual/Following entry, calls `subscribeToFollowee(entry, userId)` (existing behavior) so real-time status updates continue to work
- **`renderList` triggers:** called from (1) the `watchFollowers` callback whenever the followers snapshot changes, and (2) after any action that modifies `getFollowing()` (add person, unfollow) so the sections recompute with the updated following list
- **`updateFolloweeRow`** (existing function) — keep for incremental DOM updates when a followee's status changes; retarget to `#people-list` row lookup by `data-user-id` attribute
- Absorbs `renderFollowers` name-display logic from `mycode.js`: on Mutual rows, if `getFollowing()` has a matching entry with a non-empty label, show `<div class="person-follower-name">` with the followee's code in muted text
- **Confirmation for Follower-only ×:** The pending-action object must capture `{ userId: followerUserId, code: followerCode }` from the snapshot at render time. The confirmation sheet title is "Remove follower [code]?" where `[code]` is the captured code. On confirm: calls `removeFollower(myUserId, followerUserId)`.
- Follower-only rows: `.follow-back-btn` click pre-fills `#add-code-input` with the follower's code, hides `#add-person-btn`, shows `#add-person-form`
- Add Person form logic (existing) retargeted to new IDs: `#add-person-btn`, `#add-person-form`, `#add-code-input`, `#add-label-input`, `#add-submit-btn`, `#add-cancel-btn`, `#add-error`; label field is optional (remove the `!label` check from validation; only require non-empty code, error message: "Please enter a code.")
- `sortFollowingList()` is replaced by the sort logic inside `renderList` (sort per section, not as a global DOM operation)

### Unchanged modules

`db.js`, `identity.js`, `utils.js` — no changes.

---

## Section 6: Testing

### `me.test.js`

Rewrite fixture to include new header IDs. Remove `#slider-wrap`, `#timeout-slider`, `#slider-value` from fixture. Add: `#my-dot`, `#my-status-label`, `#time-remaining`, `#header-chips`, `#time-chip`, `#mycode-chip`, `#code-drawer`.

Update tests for `initHeader` (renamed from `initMeTab`) and `applyOwnStatus`:

- `applyOwnStatus('available', ...)` → `#my-status-label` text is "Available" (not "Available · Xh left"); `#time-remaining` receives the time text; `#header-chips` becomes visible
- `applyOwnStatus('unavailable', ...)` → `#my-status-label` text is "Unavailable"; `#time-remaining` is empty; `#header-chips` is hidden
- Old-format migration: `getLastTimeout` returning `2` → `#time-chip` text is "2 hours"
- Time chip cycle: clicking chip advances text and calls `setStatus` with updated `availableUntil`

### `mycode.test.js`

Update fixture to drawer IDs: `#my-code-display`, `#rotate-code-btn`, `#copy-code-btn`, `#rotate-error-msg`. Update tests for `initCodeDrawer` (renamed from `initMyCodeTab`). Remove all `renderFollowers` tests (function deleted from `mycode.js`).

### `following.test.js`

Update fixture: replace `#following-list` with `#people-list`. Add `#empty-list-msg`. Update `initList` call (renamed from `initFollowingTab`).

Add tests for `renderList`:

- **Mutual detection:** user in both `getFollowing()` and followers snapshot → row appears under "Mutuals" label
- **Following-only:** user in `getFollowing()` but not followers snapshot → row under "Following" label
- **Follower-only:** user in followers snapshot but not `getFollowing()` → row under "Followers" label, has `.follower-only` class, has `.follow-back-btn`
- **Empty section suppression:** if no mutuals, no "Mutuals" label `<li>` is rendered
- **All empty:** all three groups empty → `#empty-list-msg` shown, `#people-list` hidden
- **Name display (moved from `mycode.test.js`):** Mutual row where `getFollowing()` entry has a non-empty label → `.person-follower-name` element present with code text; row without label → no `.person-follower-name` element
- **XSS escaping (moved from `mycode.test.js`):** Mutual row where `getFollowing()` entry label contains `<script>` → label text is HTML-escaped in the rendered row

### Unchanged test files

`db.test.js`, `store.test.js`, `identity.test.js` — no changes.
