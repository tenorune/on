# Following Tab: Unfollow & Last Seen Design

**Date:** 2026-03-14
**Status:** Approved

## Problem

Users accumulate "zombie" followees — people whose Firebase accounts are unreachable because they lost their identity cookie or the server reset. There is currently no way to remove a followee, and no indication of how long ago they were last active.

## Design

### 1. lastSeen timestamp

A `lastSeen` Unix timestamp (ms) is written to `users/{userId}/lastSeen` in Firebase every time a user sets their status via `setStatus`. It must NOT be written by `writeBackExpired` — that function only resets `status` and `availableUntil`, and adding `lastSeen` there would corrupt the value by attributing activity to an automated expiry write.

`watchStatus` already delivers the full user object; `lastSeen` is included automatically once written. For accounts that predate this change, `lastSeen` will be absent (`undefined`); callers must treat absent/null/undefined `lastSeen` as unknown and show no last-seen text.

### 2. Unfollow

Each followee row gains a small `×` button on the right, styled with the existing `.remove-btn` class (or a scoped variant if the visual needs differ). Tapping it opens a bottom-sheet confirmation:

> **Unfollow [Name]?**
> They won't be notified. You can re-add them later using their code.
> [Cancel] [Unfollow]

The sheet is dismissed by tapping the backdrop overlay, pressing Escape, or tapping Cancel — all three are equivalent to cancelling. Confirming unfollows:

1. **Unsubscribe first** — call `unsubscribers.get(userId)()` and delete from `unsubscribers`. This must happen before any Firebase write so that the deletion echo from step 2 does not re-trigger the callback.
2. Call `unregisterAsFollower(targetUserId, myUserId)` — removes `users/{targetUserId}/followers/{myUserId}` from Firebase. This is a self-initiated unfollow and must NOT write to `revokedFollowers` (that node is only written by `removeFollower`, which is the owner revoking someone — a different, server-side operation).
3. Call `removeFollowing(userId)` — removes the entry from localStorage.
4. Remove the row from the DOM. If the list is now empty, show an empty-state message: "You're not following anyone yet."

`unregisterAsFollower(targetUserId, myUserId)` is a new function in `db.js` — it only removes the followers entry, nothing else. It must not be confused with `removeFollower(myUserId, followerUserId)`, which takes arguments in the opposite order and is for the account owner revoking a follower.

### 3. Combined status text

The `.person-status` line becomes a single natural-language string. All status text is grey (`#64748b`) except "Available for …" which is green.

A new pure function `formatLastSeen(lastSeenMs)` is added to `db.js`:

- Input: a Unix timestamp in ms, or `null`/`undefined` (unknown).
- Returns: a string, or `null` if no last-seen text should be shown.
- Boundary convention: thresholds are exclusive on the lower bound (`< 7 days` means strictly less than 7 × 86400 × 1000 ms elapsed).

| `lastSeenMs` age   | `formatLastSeen` returns  |
| ------------------ | ------------------------- |
| null / undefined   | `null`                    |
| < 7 days           | `null`                    |
| ≥ 7 and < 14 days  | `"over a week ago"`       |
| ≥ 14 and < 28 days | `"over two weeks ago"`    |
| ≥ 28 days          | `"over a month ago"`      |

`updateFolloweeRow` assembles the status string:

| Condition                                      | `.person-status` text               |
| ---------------------------------------------- | ----------------------------------- |
| Available                                      | `Available for [fuzzyTime]` (green) |
| Unavailable, `formatLastSeen` returns `null`   | `Unavailable` (grey)                |
| Unavailable, `formatLastSeen` returns a string | `Last seen [string]` (grey)         |

The fuzzy time for available users uses the existing `formatTimeRemainingFuzzy` function.

### 4. Sorting

Available entries first (alphabetical), then unavailable (alphabetical). The existing `sortFollowingList` already implements this; no change needed.

### 5. Retained behaviours

- Inline rename: clicking the person's label activates the rename input (Enter/blur confirms, Escape cancels). Unchanged.
- 60-second refresh timer for available entries. Unchanged.
- Revocation detection (`revokedFollowers` check). Unchanged.

## Files changed

| File | Change |
|------|--------|
| `js/db.js` | `setStatus` writes `lastSeen: Date.now()`; add `unregisterAsFollower(targetUserId, myUserId)`; add `formatLastSeen(lastSeenMs)` |
| `js/following.js` | `updateFolloweeRow` uses combined status text; adds × button and confirm sheet; unfollow handler (unsubscribe-first sequence) |
| `css/app.css` | Confirm overlay/sheet styles; tweak `.remove-btn` if needed for icon-only × button |
| `tests/status.test.js` | Tests for `formatLastSeen` covering null, < 7 days, each threshold, and exact boundary at 7 days |

## Out of scope

- Sorting unavailable entries by staleness (alphabetical is sufficient).
- Auto-removing zombies without user action.
- Showing last-seen info for available users.
- Writing `lastSeen` in `writeBackExpired`.
