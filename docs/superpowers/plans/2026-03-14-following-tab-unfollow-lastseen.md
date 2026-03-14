# Following Tab: Unfollow & Last Seen Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an unfollow button to each followee row, a confirmation sheet, and replace the status line with a combined natural-language sentence that includes fuzzy last-seen info for stale entries.

**Architecture:** Four independent changes that stack cleanly — (1) a new pure function `formatLastSeen` in `db.js`; (2) `setStatus` writes a `lastSeen` timestamp and a new `unregisterAsFollower` function is added; (3) CSS for the confirm overlay and unfollow button; (4) `following.js` gains a × button, confirm sheet, and updated status text.

**Tech Stack:** Vanilla JS (ES modules), Firebase Realtime Database, Jest (CommonJS via Babel), CSS custom properties.

---

## Chunk 1: Pure function and Firebase helpers

### Task 1: `formatLastSeen` — tests first, then implementation

**Files:**
- Modify: `tests/status.test.js`
- Modify: `js/db.js`

- [ ] **Step 1: Add failing tests to `tests/status.test.js`**

Append these tests after the existing `formatTimeRemainingFuzzy` tests:

```js
// formatLastSeen
const { formatLastSeen } = require('../js/db');

test('formatLastSeen returns null for null input', () => {
  expect(formatLastSeen(null)).toBeNull();
});

test('formatLastSeen returns null for undefined input', () => {
  expect(formatLastSeen(undefined)).toBeNull();
});

test('formatLastSeen returns null when last seen less than 7 days ago', () => {
  const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;
  expect(formatLastSeen(sixDaysAgo)).toBeNull();
});

test('formatLastSeen returns null for exactly 0ms elapsed (just now)', () => {
  expect(formatLastSeen(Date.now())).toBeNull();
});

test('formatLastSeen returns "over a week ago" when last seen 7–13 days ago', () => {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000 - 1;
  expect(formatLastSeen(sevenDaysAgo)).toBe('over a week ago');
});

test('formatLastSeen returns "over a week ago" when last seen 13 days ago', () => {
  const thirteenDaysAgo = Date.now() - 13 * 24 * 60 * 60 * 1000;
  expect(formatLastSeen(thirteenDaysAgo)).toBe('over a week ago');
});

test('formatLastSeen returns "over two weeks ago" when last seen 14–27 days ago', () => {
  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000 - 1;
  expect(formatLastSeen(fourteenDaysAgo)).toBe('over two weeks ago');
});

test('formatLastSeen returns "over a month ago" when last seen 28+ days ago', () => {
  const twentyEightDaysAgo = Date.now() - 28 * 24 * 60 * 60 * 1000 - 1;
  expect(formatLastSeen(twentyEightDaysAgo)).toBe('over a month ago');
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern=status.test.js
```

Expected: 8 failures like `TypeError: formatLastSeen is not a function`

- [ ] **Step 3: Implement `formatLastSeen` in `js/db.js`**

Add this export after `formatTimeRemainingFuzzy`:

```js
export function formatLastSeen(lastSeenMs) {
  if (lastSeenMs == null) return null;
  const elapsed = Date.now() - lastSeenMs;
  const days = elapsed / (24 * 60 * 60 * 1000);
  if (days < 7) return null;
  if (days < 14) return 'over a week ago';
  if (days < 28) return 'over two weeks ago';
  return 'over a month ago';
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=status.test.js
```

Expected: all tests pass, no warnings

- [ ] **Step 5: Commit**

```bash
git add tests/status.test.js js/db.js
git commit -m "feat: add formatLastSeen pure function with tests"
```

---

### Task 2: `setStatus` writes `lastSeen` + add `unregisterAsFollower`

**Files:**
- Modify: `js/db.js`

No new unit tests — these are thin Firebase wrappers (integration tested manually).

- [ ] **Step 1: Update `setStatus` to write `lastSeen`**

Find the existing `setStatus` function in `js/db.js`:

```js
export async function setStatus(userId, status, availableUntil) {
  await update(ref(db, `users/${userId}`), {
    status,
    availableUntil: availableUntil ?? null,
  });
}
```

Replace it with:

```js
export async function setStatus(userId, status, availableUntil) {
  await update(ref(db, `users/${userId}`), {
    status,
    availableUntil: availableUntil ?? null,
    lastSeen: Date.now(),
  });
}
```

- [ ] **Step 2: Add `unregisterAsFollower` to `js/db.js`**

Add this export after `registerAsFollower`:

```js
// Called when the follower wants to stop following targetUserId.
// Only removes the followers entry — does NOT write to revokedFollowers.
export async function unregisterAsFollower(targetUserId, myUserId) {
  await remove(ref(db, `users/${targetUserId}/followers/${myUserId}`));
}
```

`remove` is already imported at the top of the file.

- [ ] **Step 3: Run tests to confirm nothing broke**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add js/db.js
git commit -m "feat: setStatus writes lastSeen timestamp, add unregisterAsFollower"
```

---

### Task 3: CSS for unfollow button and confirm sheet

**Files:**
- Modify: `css/app.css`

No tests for CSS.

- [ ] **Step 1: Add styles to `css/app.css`**

Append after the `.rename-input` rule at the bottom of the file:

```css
/* Unfollow button (icon-only × on followee rows) */
.unfollow-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.2rem;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  align-self: flex-start;
  transition: color 0.15s;
}
.unfollow-btn:hover { color: var(--error-text); }

/* Status text: available portion */
.status-available { color: var(--green); font-weight: 500; }

/* Confirm overlay (unfollow sheet) */
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 200;
  padding-bottom: 2rem;
}
.confirm-sheet {
  background: var(--surface);
  border-radius: 14px;
  padding: 1.25rem;
  width: calc(100% - 2rem);
  max-width: 380px;
  text-align: center;
}
.confirm-sheet h4 { font-size: 1rem; margin-bottom: 0.35rem; }
.confirm-sheet p  { font-size: 0.82rem; color: var(--text-muted); margin-bottom: 1rem; }
.confirm-btns { display: flex; gap: 0.6rem; }
.confirm-btns button {
  flex: 1;
  padding: 0.65rem;
  border-radius: 8px;
  border: none;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}
.confirm-btn-cancel { background: var(--surface2); color: var(--text-muted); }
.confirm-btn-remove { background: var(--error-bg); color: var(--error-text); }
```

- [ ] **Step 2: Run tests to confirm nothing broke**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add css/app.css
git commit -m "feat: add unfollow button and confirm sheet CSS"
```

---

### Task 4: Unfollow button and confirm sheet in `following.js`

**Files:**
- Modify: `js/following.js`

- [ ] **Step 1: Add `unregisterAsFollower` to the import line in `js/following.js`**

Find:

```js
import {
  lookupCode, watchStatus, registerAsFollower,
  isExpired, writeBackExpired, formatTimeRemainingFuzzy, timeRemainingMs,
} from './db.js';
```

Replace with:

```js
import {
  lookupCode, watchStatus, registerAsFollower, unregisterAsFollower,
  isExpired, writeBackExpired, formatTimeRemainingFuzzy, timeRemainingMs,
  formatLastSeen,
} from './db.js';
```

- [ ] **Step 2: Inject the confirm sheet into the DOM inside `initFollowingTab`**

At the top of `initFollowingTab`, before the `renderFollowingList` call, add:

```js
// Inject confirm sheet once
const confirmEl = document.createElement('div');
confirmEl.id = 'unfollow-confirm';
confirmEl.className = 'confirm-overlay hidden';
confirmEl.innerHTML = `
  <div class="confirm-sheet">
    <h4 id="unfollow-confirm-title">Unfollow?</h4>
    <p>They won't be notified. You can re-add them later using their code.</p>
    <div class="confirm-btns">
      <button class="confirm-btn-cancel" id="unfollow-cancel-btn">Cancel</button>
      <button class="confirm-btn-remove" id="unfollow-do-btn">Unfollow</button>
    </div>
  </div>`;
document.body.appendChild(confirmEl);

// Dismiss on backdrop click or Escape
confirmEl.addEventListener('click', (e) => {
  if (e.target === confirmEl) dismissConfirm();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') dismissConfirm();
});
document.getElementById('unfollow-cancel-btn').addEventListener('click', dismissConfirm);
```

- [ ] **Step 3: Add confirm sheet state and helpers as module-level variables/functions**

Add these after the existing `const lastUserData = new Map();` line:

```js
let pendingUnfollow = null; // { entry, myUserId }

function showConfirm(entry, myUserId) {
  pendingUnfollow = { entry, myUserId };
  document.getElementById('unfollow-confirm-title').textContent = `Unfollow ${entry.label}?`;
  document.getElementById('unfollow-confirm').classList.remove('hidden');
}

function dismissConfirm() {
  document.getElementById('unfollow-confirm').classList.add('hidden');
  pendingUnfollow = null;
}

async function doUnfollow() {
  if (!pendingUnfollow) return;
  const { entry, myUserId } = pendingUnfollow;
  dismissConfirm();

  // 1. Unsubscribe first so the Firebase deletion echo doesn't re-trigger the callback
  const unsub = unsubscribers.get(entry.userId);
  if (unsub) unsub();
  unsubscribers.delete(entry.userId);
  lastUserData.delete(entry.userId);

  // 2. Remove from Firebase followers list (self-initiated — does not write revokedFollowers)
  await unregisterAsFollower(entry.userId, myUserId);

  // 3. Remove from localStorage
  removeFollowing(entry.userId);

  // 4. Remove row from DOM; show empty state if list is now empty
  const li = document.getElementById(`followee-${entry.userId}`);
  if (li) li.remove();

  const list = document.getElementById('following-list');
  if (getFollowing().length === 0) {
    list.innerHTML = '<li style="color:var(--text-muted);font-size:13px;padding:12px 0;list-style:none">You\'re not following anyone yet.</li>';
  }
}
```

- [ ] **Step 4: Wire the "Unfollow" button in `initFollowingTab`**

After the `document.getElementById('unfollow-cancel-btn').addEventListener` line, add:

```js
document.getElementById('unfollow-do-btn').addEventListener('click', doUnfollow);
```

- [ ] **Step 5: Add the × button to `updateFolloweeRow`**

In `updateFolloweeRow`, find the `li.innerHTML = ...` block (the `!li` branch that creates a new row). The current template ends with `</div></div>`. Add a × button after the closing `.person-info` div and before the final `` ` ``:

Current (the new-row branch):
```js
li.innerHTML = `
  <div class="person-dot${isAvail ? ' available' : ''}"></div>
  <div class="person-info">
    <div class="person-label">${escapeHtml(entry.label)}</div>
    <div class="person-status${isAvail ? ' available' : ''}">${statusText}</div>
  </div>`;
```

Replace with:
```js
li.innerHTML = `
  <div class="person-dot${isAvail ? ' available' : ''}"></div>
  <div class="person-info">
    <div class="person-label">${escapeHtml(entry.label)}</div>
    <div class="person-status">${statusText}</div>
  </div>
  <button class="unfollow-btn" title="Unfollow" data-userid="${entry.userId}">×</button>`;
```

Then, still in the `!li` branch, after setting `list.appendChild(li)`, wire the × button:

```js
li.querySelector('.unfollow-btn').addEventListener('click', () => {
  showConfirm(entry, myUserId);
});
```

**Note:** `myUserId` must be passed into `updateFolloweeRow`. Update the function signature:

```js
function updateFolloweeRow(entry, userData, myUserId) {
```

And update both call sites:
- In `subscribeToFollowee`: `updateFolloweeRow(entry, userData, myUserId);` — `myUserId` is already in scope there.
- In the 60s interval in `initFollowingTab`: pass `myUserId` — it is already in scope via the `initFollowingTab` parameter. Change the interval callback to:

```js
setInterval(() => {
  getFollowing().forEach((entry) => {
    const userData = lastUserData.get(entry.userId);
    if (!userData || userData.status !== 'available') return;
    if (editingSet.has(entry.userId)) return;
    updateFolloweeRow(entry, userData, myUserId);
    sortFollowingList();
  });
}, 60000);
```

- [ ] **Step 6: Run tests to confirm nothing broke**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add js/following.js
git commit -m "feat: add unfollow button and confirm sheet to following tab"
```

---

### Task 5: Combined status text in `following.js`

**Files:**
- Modify: `js/following.js`

- [ ] **Step 1: Update `updateFolloweeRow` to use combined status text**

In `updateFolloweeRow`, replace the `statusText` computation:

Current:
```js
const statusText = isAvail ? formatTimeRemainingFuzzy(ms) : 'Unavailable';
```

Replace with:
```js
let statusText;
if (isAvail) {
  statusText = `<span class="status-available">Available for ${formatTimeRemainingFuzzy(ms).replace(/ left$/, '')}</span>`;
} else {
  const lastSeenPhrase = formatLastSeen(userData.lastSeen ?? null);
  statusText = lastSeenPhrase ? `Last seen ${lastSeenPhrase}` : 'Unavailable';
}
```

**Note:** `formatTimeRemainingFuzzy` returns strings like "About 2 hours left". Stripping " left" gives "About 2 hours" so the full sentence reads "Available for about 2 hours". The `.replace(/ left$/, '')` handles this.

- [ ] **Step 2: Switch from `textContent` to `innerHTML` for the status element in the update branch**

In the `else` branch of `updateFolloweeRow` (the update-existing-row path), find:

```js
statusEl.className = `person-status${isAvail ? ' available' : ''}`;
statusEl.textContent = statusText;
```

Replace with:

```js
statusEl.className = 'person-status';
statusEl.innerHTML = statusText;
```

- [ ] **Step 3: Run tests to confirm nothing broke**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 4: Build and do a quick visual smoke test**

```bash
npm run build
```

Open the app locally (or on device). Verify:
- Available followees show green "Available for about X hours" (no "left" suffix)
- Unavailable followees with recent activity show grey "Unavailable"
- Stale followees show grey "Last seen over a week ago" / "over two weeks ago" / "over a month ago"
- × button appears on each row; tapping shows confirm sheet
- Backdrop tap, Escape, and Cancel all dismiss without unfollowing
- Confirming removes the row; if last person, empty-state message appears
- Inline rename still works (click label → type → Enter)

- [ ] **Step 5: Commit**

```bash
git add js/following.js
git commit -m "feat: combined status text with fuzzy last-seen on following tab"
```
