# Call Display Text Design

## Problem

When a user is calling or receiving a call, the card status text still shows availability info ("Available for…"). It should instead reflect the call state, with onboarding hints for new users.

## Design

### Status Text Replacement

During call mode, the `.person-status` text in `updateFolloweeRow()` is replaced based on role:

| Role | Condition | Text |
|------|-----------|------|
| Caller | `madeCallCount` ≥ 4 | "Calling…" |
| Caller | `madeCallCount` < 4 | "Calling… (swipe left to hang up)" |
| Receiver | `answeredCallCount` ≥ 4 | "is calling you…" |
| Receiver | `answeredCallCount` < 4 | "is calling you… (swipe right to answer)" |

When call mode ends, the normal status text resumes on the next `updateFolloweeRow()` cycle.

### localStorage Counters

Two new keys managed via `store.js`:

- `answeredCallCount` — integer, incremented when the user swipes right to answer an incoming call
- `madeCallCount` — integer, incremented when the user initiates a call via swipe right

Each key has a getter (returns 0 if unset) and an increment function in `store.js`.

### Increment Points

- **`madeCallCount`**: incremented in `enterCallMode()` in `following.js` when the user initiates a call
- **`answeredCallCount`**: incremented in the swipe-right handler in `following.js` when the receiver swipes right on a glowing card to answer

### Files Changed

- `js/store.js` — add `getMadeCallCount()`, `incrementMadeCallCount()`, `getAnsweredCallCount()`, `incrementAnsweredCallCount()`
- `js/following.js` — add call-state text logic at top of status text section in `updateFolloweeRow()`; increment counters at call initiation and answer points
