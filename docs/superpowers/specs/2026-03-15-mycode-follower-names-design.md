# My Code Tab — Follower Name Display

## Overview

On the My Code tab, each follower is currently shown as a raw code string (e.g. `XY9K2M`) with a Remove button. For followers who the user is also following back (a mutual/bidirectional relationship), the user has assigned a custom label in the Following tab. This spec adds the display of that custom label as a muted subtitle beneath the follower's code.

## Goal

When a follower's `userId` matches an entry in the user's following list, show their custom name below their code in muted text. Followers with no corresponding following entry continue to show code only.

## Scope

- **In scope:** Display custom name in `renderFollowers` for matched followers.
- **Out of scope:** Sorting or grouping by mutual status, real-time name sync during a session, any badge or accent colour treatment.

## Data Flow

No new network calls. All data is already available at render time:

- `watchFollowers(myUserId, callback)` — provides `{ userId, code }[]` from Firebase in real time.
- `getFollowing()` — returns `{ userId, code, label }[]` from localStorage.

For each follower, a `getFollowing().find(f => f.userId === follower.userId)` lookup returns the matching entry (or `undefined`). If found, `entry.label` is the display name.

The follower list re-renders on every `watchFollowers` callback. Name changes made on the Following tab are persisted to localStorage immediately; navigating back to My Code triggers a re-render that picks up the updated label.

## Changes

### `js/mycode.js`

- Add `getFollowing` to the imports from `./store.js`. `mycode.js` does not currently import from `store.js`, so add a new import line: `import { getFollowing } from './store.js';`
  Note: `store.js` uses CommonJS (`module.exports`), not ES module `export` syntax. The bundler handles the interop — this import form works exactly as it does in `following.js` line 7 (`import { getFollowing, ... } from './store.js'`). Only `getFollowing` is needed here.
- In `renderFollowers`, for each follower build the lookup:

  ```js
  const followingEntry = getFollowing().find((f) => f.userId === userId);
  ```

- If `followingEntry` exists **and** `followingEntry.label` is a non-empty string, insert a `<div class="person-follower-name">` as a second child inside `.person-info`, after the code element. The interpolation must use `escapeHtml`:

  ```html
  <div class="person-info">
    <div class="person-label" style="letter-spacing:2px;font-size:13px">${escapeHtml(code)}</div>
    <div class="person-follower-name">${escapeHtml(followingEntry.label)}</div>
  </div>
  ```

  If `followingEntry` is `undefined`, or if `followingEntry.label` is falsy or empty string, omit the `.person-follower-name` div entirely.

- No other changes to the function.

### `css/app.css`

- Add one rule immediately after the `.followers-section { … }` rule (before `/* Utilities */`):

  ```css
  .person-follower-name { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
  ```

## Visual Design

Matches Option A from the brainstorming mockup:

```text
┌──────────────────────────────────┐
│  XY9K2M                [Remove]  │
│  Alice                           │
└──────────────────────────────────┘
┌──────────────────────────────────┐
│  Q3ZP7R                [Remove]  │
└──────────────────────────────────┘
```

The name (`Alice`) is rendered in `--text-muted` at 12px, directly below the code. Followers without a matching entry show no name line.

## Testing

Create `tests/mycode.test.js` (new file, CommonJS `require()` style, consistent with other test files).

`renderFollowers` is currently a plain function declaration. To make it testable, change its declaration to `export function renderFollowers` (same form as `initMyCodeTab`). Import it in the test using `require` — this works because the project's Babel config handles ES module → CommonJS interop for Jest, as confirmed by `tests/me.test.js` line 13 which does the same for `me.js`:

```js
const { renderFollowers } = require('../js/mycode.js');
```

`getFollowing` reads from `localStorage`. Mock the entire module at the top of the test file:

```js
jest.mock('../js/store.js', () => ({ getFollowing: jest.fn() }));
const { getFollowing } = require('../js/store.js');
```

The factory returns a plain object. `getFollowing` is a `jest.fn()` so `.mockReturnValue(...)` is available. Set the return value inside each `test()` body (not in `beforeEach`).

The test requires a minimal DOM. Reset both DOM and mock in `beforeEach`:

```js
beforeEach(() => {
  document.body.innerHTML = '<ul id="followers-list"></ul><p id="no-followers-msg"></p>';
  getFollowing.mockReset();
});
```

The first argument to `renderFollowers` is `myUserId`. It is required by the function signature (passed to the Remove button click handler) but does not affect the name-display logic. Pass any string, e.g. `'myUserId'`.

**Test 1** — `'shows custom name for a followed-back follower, and no name for an unknown follower'`:

Given `getFollowing` returns `[{ userId: 'u1', code: 'XY9K2M', label: 'Alice' }]`, call:

```js
renderFollowers('myUserId', [
  { userId: 'u1', code: 'XY9K2M' },
  { userId: 'u2', code: 'Q3ZP7R' },
]);
```

Assert:

- The first `li` contains a `.person-follower-name` element with `textContent` `'Alice'`.
- The second `li` has no `.person-follower-name` element.

**Test 2** — `'does not show name when label is empty string'`:

Given `getFollowing` returns `[{ userId: 'u1', code: 'XY9K2M', label: '' }]`, call `renderFollowers('myUserId', [{ userId: 'u1', code: 'XY9K2M' }])`.

Assert: the `li` has no `.person-follower-name` element.

Existing behaviour (code display, Remove button) is verified to be unaffected by test 1.

## Security

The label value is passed through `escapeHtml` before insertion into innerHTML, consistent with how labels are rendered elsewhere in the codebase.
