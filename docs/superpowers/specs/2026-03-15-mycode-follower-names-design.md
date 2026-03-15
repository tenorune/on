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

- Add import: `import { getFollowing } from './store.js';`
- In `renderFollowers`, for each follower build the lookup:
  ```js
  const followingEntry = getFollowing().find((f) => f.userId === userId);
  ```
- If `followingEntry` exists, append a `<div class="person-follower-name">` containing `escapeHtml(followingEntry.label)` below the code element.
- No other changes to the function.

### `css/app.css`

- Add one rule:
  ```css
  .person-follower-name { font-size: 12px; color: var(--text-muted); margin-top: 3px; }
  ```

## Visual Design

Matches Option A from the brainstorming mockup:

```
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

One new test in `tests/mycode.test.js`:

- **Given** a followers array where one entry's `userId` matches a following entry (with label `"Alice"`), and one entry that does not match:
  - The matched follower's rendered `li` contains a `.person-follower-name` element with text `"Alice"`.
  - The unmatched follower's rendered `li` has no `.person-follower-name` element.

Existing behaviour (code display, Remove button) is verified to be unaffected.

## Security

The label value is passed through `escapeHtml` before insertion into innerHTML, consistent with how labels are rendered elsewhere in the codebase.
