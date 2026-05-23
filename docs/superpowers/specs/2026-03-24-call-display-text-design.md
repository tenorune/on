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

### Role Detection in `updateFolloweeRow()`

The existing variables `isCallee` and `isCallModeReceiver` (currently computed around line 653) determine the user's role. These must be moved earlier in the function — before the `if (isAvail)` status text block at line 602 — so the call-state text can short-circuit the normal availability logic.

- `isCallee` = I initiated the call to this person (I am the caller)
- `isCallModeReceiver` = this person called me (I am the receiver)

### localStorage Counters

Two new keys managed via `store.js`, following the existing `statusapp_` prefix convention:

- `statusapp_made_call_count` — integer, incremented when the user initiates a call via swipe right
- `statusapp_answered_call_count` — integer, incremented when the user swipes right to answer an incoming call

Each key has a getter (returns 0 if unset) and an increment function in `store.js`. New functions must be added to `module.exports` (line 119) and imported in `following.js`.

### Increment Points

- **`madeCallCount`**: incremented in `enterCallMode()` in `following.js` when the user initiates a call (not in `reEnterCallMode()` which handles reconnection on reload)
- **`answeredCallCount`**: incremented in the swipe-right answer handler in `following.js` (around line 451) when the receiver swipes right on a glowing card to answer

### Files Changed

- `js/store.js` — add `getMadeCallCount()`, `incrementMadeCallCount()`, `getAnsweredCallCount()`, `incrementAnsweredCallCount()`
- `js/following.js` — add call-state text logic at top of status text section in `updateFolloweeRow()`; increment counters at call initiation and answer points
