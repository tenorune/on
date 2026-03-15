# Code Rotation Design

## Overview

Users can generate a new 6-character code from the open code drawer. The old code is immediately invalidated for new discovery. Mutuals receive the new code automatically via their existing Firebase subscription. Non-mutual followers retain the old code in their local storage but continue to see status updates uninterrupted (their subscription runs on userId, not code). Every person the user follows has their `followers/{myUserId}` entry updated to the new code, so the user's current code is always accurate in other users' Followers lists.

## Goal

Allow a user to rotate their code without disrupting existing follows, and without notifying non-mutual followers of the change.

## Scope

- **In scope:** ↻ button in the code drawer, confirmation sheet, Firebase writes, mutual localStorage sync, follower-entry updates, error handling, offline guard.
- **Out of scope:** Notifying any users of the change, removing followers, rate-limiting rotations, audit history of past codes.

## UI

### Code drawer (UMV1)

A small ↻ button sits inline to the right of the code characters. It is disabled when the app is offline (`!navigator.onLine`).

Tapping the ↻ button raises the existing confirm-sheet component with:

> **Generate a new code?**
> Your current code will no longer work for new people to find you.
> [Cancel] [Generate]

On confirm:
1. The ↻ button is replaced by a spinner and the Generate button is disabled for the duration of the writes.
2. The code characters in the drawer fade out briefly, then the new code fades in.
3. The Copy button is temporarily disabled during the write, then re-enabled.
4. The drawer remains open so the user immediately sees the result.

On error, an error message appears below the code: *"Couldn't generate a new code. Please try again."* Local state is not updated; the old code remains valid.

## Data Changes on Rotation

Four writes execute in sequence. If any write throws, the operation aborts and the error state is shown. Local state is only updated after all writes succeed.

### 1. Reserve the new code

Transaction on `codeIndex/{newCode}`:

```js
runTransaction(codeRef, (current) => {
  if (current !== null) return; // abort — code taken, retry
  return userId;
});
```

If the transaction does not commit (collision), generate a fresh code and retry. Same pattern as `initUser`.

### 2. Release the old code

```js
remove(ref(db, `codeIndex/${oldCode}`));
```

### 3. Update the user record

```js
update(ref(db, `users/${userId}`), { code: newCode });
```

### 4. Update follower entries

For every entry in `getFollowing()` (every person the user follows), update the user's entry in that person's followers list:

```js
for (const entry of getFollowing()) {
  await set(ref(db, `users/${entry.userId}/followers/${userId}`), newCode);
}
```

This ensures the user's code is always current in other users' Followers lists — including for people the user follows who do not follow back (e.g. ALICE follows BOB; BOB sees ALICE's updated code in his Followers list automatically).

### 5. Update local identity

```js
saveIdentity(userId, newCode);
```

Called only after all Firebase writes succeed.

## Mutual Sync

No extra writes are needed. When step 3 fires, every mutual's `watchStatus` subscription on this user receives `userData` with the updated `code` field. The `subscribeToFollowee` callback in `following.js` detects when `userData.code` differs from the stored `entry.code` and calls a new `updateFollowingCode(userId, newCode)` function in `store.js` to update the localStorage entry.

Non-mutual followers are unaffected: their Firebase subscription (on userId) continues delivering status updates; their stored code becomes stale but causes no errors.

## New Functions

### `db.js` — `rotateCode(userId, oldCode)`

Encapsulates all four Firebase writes. Returns the new code string on success. Throws on any write failure.

```js
export async function rotateCode(userId, oldCode) {
  let newCode, committed;
  do {
    newCode = generateCode();
    const result = await runTransaction(ref(db, `codeIndex/${newCode}`), (current) => {
      if (current !== null) return;
      return userId;
    });
    committed = result.committed;
  } while (!committed);

  await remove(ref(db, `codeIndex/${oldCode}`));
  await update(ref(db, `users/${userId}`), { code: newCode });

  for (const entry of getFollowing()) {
    await set(ref(db, `users/${entry.userId}/followers/${userId}`), newCode);
  }

  return newCode;
}
```

`rotateCode` imports `getFollowing` from `store.js` (same CommonJS interop pattern used elsewhere).

### `store.js` — `updateFollowingCode(userId, newCode)`

Updates the `code` field on a following entry in localStorage:

```js
function updateFollowingCode(userId, newCode) {
  saveFollowing(getFollowing().map((e) =>
    e.userId === userId ? { ...e, code: newCode } : e
  ));
}
```

### `identity.js` — already exports `saveIdentity`

No new function needed. Called with `(userId, newCode)` after writes succeed.

## Error Handling

| Scenario | Behaviour |
|---|---|
| Offline at tap | ↻ button disabled; no sheet shown |
| Firebase write fails | Abort, show error in drawer, old code remains valid |
| Code collision | Transparent retry with new generated code |
| Double-tap | Generate button disabled during writes |

## Testing

### `tests/db.test.js` — `rotateCode`

Mock `runTransaction`, `remove`, `update`, `set`, `getFollowing`.

- **Happy path:** All writes called in order; new code returned.
- **Collision retry:** First transaction does not commit; second does; new code returned.
- **Following entries written:** `set` called once per entry in `getFollowing()` with correct path and new code.

### `tests/store.test.js` — `updateFollowingCode`

- Updates matching entry's `code` field; leaves other entries unchanged.

### `tests/following.test.js` — mutual code sync

- When `watchStatus` callback fires with `userData.code !== entry.code`, `updateFollowingCode` is called with the new code.
- When `userData.code === entry.code`, `updateFollowingCode` is not called.
