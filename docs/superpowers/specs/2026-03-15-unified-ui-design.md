# Unified UI Design Spec

## Goal

Replace the three-tab layout (Me / Following / My Code) with a single scrollable screen. The header always shows the user's own status controls; a merged list below shows all social connections in one view.

## Approach

Refactor in-place: keep `me.js`, `following.js`, and `mycode.js` as separate modules, each targeting new DOM IDs in the unified layout. A coordinator in `app.js` calls all three init functions at startup. Firebase subscriptions for followees open at load time (no lazy tab init).

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
        <span id="time-remaining" class="hidden"></span>
      </div>
      <div id="header-chips" class="hidden">
        <button id="time-chip" class="chip time-chip">2 hours</button>
        <button id="mycode-chip" class="chip">My Code</button>
      </div>
    </div>
  </div>
  <div id="code-drawer" class="hidden">
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

The `#stale-screen` overlay and `#offline-banner` remain unchanged (fixed position, no tab dependency).

---

## Section 2: Header & Drawer Behavior

### Status header

- `#my-dot` — 48px circle; taps to toggle available ↔ unavailable (same logic as current dot)
- `#my-status-label` — "Available" or "Unavailable"; color fades green ↔ muted grey on transition
- `#time-remaining` — shown inline when available, e.g. "· 2 hours left"; hidden when unavailable
- `#header-chips` — hidden when unavailable; fades + slides down into view when available (staggered: label row animates first, chips 80ms later); reverses on going unavailable

### Time chip (`#time-chip`)

Fixed width (148px). Displays the current duration in full text. Values cycle on each tap:

```
30 minutes → 1 hour → 1 hour 30 minutes → 2 hours → 3 hours → 4 hours → 6 hours → 8 hours → (wrap to 30 minutes)
```

Tapping the chip while available:
1. Advances to next duration
2. Calls `setStatus(userId, 'available', newAvailableUntil)` immediately
3. Updates `#time-remaining` inline text
4. Persists new duration via `setLastTimeout` (existing store function)

The chip is only visible when available. There is no pre-set when unavailable.

### My Code chip (`#mycode-chip`)

Text only, no icon. Taps to toggle `#code-drawer` open/closed. When open, chip appears active (accent border or background). Tapping again closes the drawer.

### Code drawer (`#code-drawer`)

Slides down below the header row using a `max-height` CSS transition (0 → auto via JS-measured height). Contains:
- `#my-code-display` — 6-char code in large monospace
- `#rotate-code-btn` — rotate button (existing confirmation sheet + spinner + fade animation behavior)
- `#copy-code-btn` — copy to clipboard (existing behavior)
- `#rotate-error-msg` — error display
- Help text paragraph

---

## Section 3: Merged List

`#people-list` is a single `<ul>` rendered by `following.js`. Entries are divided into three labeled groups rendered in order: **Mutuals → Following → Followers**. A group is omitted entirely (no label, no rows) if it has no entries.

Section labels are `<li class="list-section-label">` items inserted before each group's rows.

### Mutual status determination

At render time, `following.js` computes mutuals by intersecting:
- `getFollowing()` — array of `{ userId, code, label }` from localStorage
- The live Firebase followers snapshot — `{ [followerId]: code }`

A user is a **Mutual** if they appear in both. A user is **Following-only** if they appear only in `getFollowing()`. A user is **Follower-only** if they appear only in the followers snapshot.

### Row layouts

**Mutual row:**
```
[dot 32px] [name (label)] [status text]          [× btn]
```

**Following-only row:** same as Mutual.

**Follower-only row:**
```
[+ btn 32px] [code monospace]                    [× btn]
```
Row is dimmed (opacity 0.6). The `+` button is a circle outline in the accent color. Tapping it pre-fills `#add-code-input` with the follower's code and opens the Add Person form.

### Actions

**× button (Mutuals / Following):** Opens existing confirmation sheet → calls `unregisterAsFollower` + removes from localStorage (existing unfollow flow).

**× button (Followers):** Opens existing confirmation sheet → calls `removeFollower` (existing remove-follower flow).

**Inline rename:** Tapping a name label on a Mutual or Following row activates inline rename (existing behavior, same as current following tab).

### Add Person (bottom of list)

`#add-person-btn` is a dashed-border row below the list. Tapping it hides the button and shows `#add-person-form` inline. The form has code + label inputs, Follow + Cancel buttons. Behavior identical to the existing add-person form in `following.js`. Cancel hides the form and shows the button again.

---

## Section 4: CSS Changes

### Remove
- `.bottom-nav`, `.nav-btn`, `.nav-icon`, `.nav-label` rules
- `.tab-panel`, `.tab-panel.active` rules

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
}

#time-remaining {
  color: var(--text-muted);
  font-size: 14px;
}

#header-chips {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

/* Transition: chips fade+slide */
#header-chips {
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

/* Code drawer slide */
#code-drawer {
  overflow: hidden;
  max-height: 0;
  transition: max-height 0.3s ease;
  margin-top: 0;
}
#code-drawer.open {
  max-height: 200px; /* sufficiently large */
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

/* Follower-only row dimming */
.person-list li.follower-only {
  opacity: 0.6;
}

/* Follow-back button */
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

### Update
- `main` — remove `calc(100vh - 64px)` offset; use `min-height: 100dvh` with padding-top matching header height, or let sticky header handle it naturally.
- `#my-dot` (`.dot`) — reduce to 48px (from 100px current)
- `#my-status-label` (`.status-label`) — keep existing color transition

---

## Section 5: JS Module Changes

### `app.js`

Replace `initTabs()` call with direct calls to all three init functions at startup. No lazy tab switching. No bottom-nav event listeners.

```js
// Replace:
initTabs();
// ...
initMeTab(myUserId);
initFollowingTab(myUserId, myCode);
initMyCodeTab(myUserId, myCode);

// With (same calls, different function names):
initHeader(myUserId);
initList(myUserId, myCode);
initCodeDrawer(myUserId, myCode);
```

Remove `initTabs()` function entirely.

### `me.js`

- Rename `initMeTab(userId)` → `initHeader(userId)`
- Replace slider DOM targets with chip DOM targets:
  - `#slider-wrap` / `#timeout-slider` / `#slider-value` → `#time-chip`
  - `#my-status-label` — same ID, keep
  - `#my-dot` — same ID, keep
- Replace slider value logic with chip cycle logic:
  - `getLastTimeout()` maps to nearest chip value on init
  - Tapping chip advances index, calls `setStatus`, calls `setLastTimeout`
- Add `#mycode-chip` click handler to toggle `#code-drawer` open/closed class
- Add `#time-remaining` text update logic (same content as current `#slider-value` countdown)
- `applyOwnStatus(status, availableUntil)` export — keep, update to show/hide `#header-chips` and `#time-remaining` instead of `#slider-wrap`

### `mycode.js`

- Rename `initMyCodeTab(userId, code)` → `initCodeDrawer(userId, code)`
- Targets `#my-code-display`, `#rotate-code-btn`, `#copy-code-btn`, `#rotate-error-msg` (same IDs, just moved into drawer)
- Remove `renderFollowers` export — follower rendering moves to `following.js`
- Remove `watchFollowers` call — moved to `following.js`

### `following.js`

- Rename `initFollowingTab(userId, code)` → `initList(userId, code)`
- Add `renderList(userId, followingEntries, followersSnapshot)` — renders all three sections into `#people-list`
  - Calls `watchFollowers(userId, ...)` to get live followers snapshot (moved from `mycode.js`)
  - Determines mutual/following/follower-only groupings
  - Renders section label `<li>` items and person rows
- Follower-only rows: `+` button triggers `addFollowingEntry` pre-filled with the follower's code
- `renderFollowers` (from `mycode.js`) is absorbed here — logic for showing follower names on mutual rows applies to the Mutuals section
- Add Person form logic (existing) — targets new IDs `#add-person-btn`, `#add-person-form`, `#add-code-input`, `#add-label-input`, `#add-submit-btn`, `#add-cancel-btn`, `#add-error`
- `sortFollowingList()` is replaced by the section-label approach (Mutuals always first, then Following, then Followers — no within-section sort required initially)

### Unchanged modules
`store.js`, `db.js`, `identity.js`, `utils.js` — no changes.

---

## Section 6: Testing

### Updated test fixtures

Each test file's `document.body.innerHTML` fixture changes from tab-scoped IDs to the new unified IDs. No mock changes needed.

**`me.test.js`** — update fixture to include `#my-dot`, `#my-status-label`, `#time-remaining`, `#header-chips`, `#time-chip`, `#mycode-chip`. Update tests for `initHeader` (renamed from `initMeTab`) and `applyOwnStatus` to assert against new DOM elements.

**`mycode.test.js`** — update fixture to include `#my-code-display`, `#rotate-code-btn`, `#copy-code-btn`, `#rotate-error-msg`. Update tests for `initCodeDrawer` (renamed from `initMyCodeTab`). Remove `renderFollowers` tests (function deleted).

**`following.test.js`** — update fixture to include `#people-list`, `#add-person-btn`, `#add-person-form`. Add tests for:
- Mutual detection: user in both `getFollowing()` and followers snapshot → Mutual section
- Following-only: user in `getFollowing()` only → Following section
- Follower-only: user in followers snapshot only → Followers section, dimmed row, `+` button
- Section labels present only when section is non-empty
- `renderFollowers` name display behavior (moved from `mycode.test.js`)

### Unchanged test files
`db.test.js`, `store.test.js`, `identity.test.js` — no changes.
