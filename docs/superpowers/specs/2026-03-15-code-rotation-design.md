# Code Rotation Design

## Overview

Users can generate a new 6-character code from the open code drawer. The old code is immediately invalidated for new discovery. Mutuals receive the new code automatically via their existing Firebase subscription. Non-mutual followers retain the old code in their local storage but continue to see status updates uninterrupted (their subscription runs on userId, not code). Every person the user follows has their `followers/{myUserId}` entry updated to the new code, so the user's code is always current in other users' Followers lists — including for people the user follows who do not follow back.

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

Five operations execute in sequence: four Firebase writes followed by one localStorage write. Local state (`saveIdentity`) is only updated after all four Firebase writes succeed. If any Firebase write throws, the operation aborts (see **Error Handling** for compensating action) and the error state is shown without touching localStorage.

The old code is deleted **last** — only after the new code is fully established — so a failure at any earlier step leaves the old code intact and the user always has a valid discoverable code.

### 1. Reserve the new code (Firebase)

Transaction on `codeIndex/{newCode}`:

```js
runTransaction(ref(db, `codeIndex/${newCode}`), (current) => {
  if (current !== null) return; // abort — code taken, retry
  return userId;
});
```

If the transaction does not commit (collision), generate a fresh code and retry. Same pattern as `initUser`.

### 2. Update the user record (Firebase)

```js
await update(ref(db, `users/${userId}`), { code: newCode });
```

### 3. Update follower entries (Firebase)

For every entry in `getFollowing()` (every person the user follows), update the user's entry in that person's followers list:

```js
for (const entry of getFollowing()) {
  await set(ref(db, `users/${entry.userId}/followers/${userId}`), newCode);
}
```

This ensures the user's code is always current in other users' Followers lists — including for non-mutual cases (e.g. ALICE follows BOB; BOB sees ALICE's updated code in his Followers list automatically).

### 4. Release the old code (Firebase)

```js
await remove(ref(db, `codeIndex/${oldCode}`));
```

Executed last. If this step fails, both old and new codes exist in `codeIndex` simultaneously — the new code is active in `users/{userId}`, so this is a harmless orphan. No compensating action needed.

### 5. Update local identity (localStorage)

```js
saveIdentity(userId, newCode);
```

Called in `mycode.js` only after `rotateCode` resolves successfully.

## New and Changed Functions

### `db.js` — `rotateCode(userId, oldCode)`

New exported function. Encapsulates the four Firebase writes. Returns the new code string on success. Throws on unrecoverable failure.

`rotateCode` needs `generateCode` from `identity.js` and `getFollowing` from `store.js`. Both use the same ES module `import` syntax that works throughout the codebase via bundler interop (same pattern as `following.js` importing from `store.js`):

```js
import { generateCode } from './identity.js';
import { getFollowing } from './store.js';
```

Full function:

```js
export async function rotateCode(userId, oldCode) {
  // Step 1: reserve new code (collision-safe)
  let newCode, committed;
  do {
    newCode = generateCode();
    const result = await runTransaction(ref(db, `codeIndex/${newCode}`), (current) => {
      if (current !== null) return; // abort on collision
      return userId;
    });
    committed = result.committed;
  } while (!committed);

  // Steps 2–3: establish new code. If either throws, new code is orphaned in
  // codeIndex but old code remains valid — user retries and the orphan is harmless.
  await update(ref(db, `users/${userId}`), { code: newCode });
  for (const entry of getFollowing()) {
    await set(ref(db, `users/${entry.userId}/followers/${userId}`), newCode);
  }

  // Step 4: release old code last. If this throws, both codes exist briefly —
  // new code is already active, so old code is a harmless orphan. No rollback needed.
  await remove(ref(db, `codeIndex/${oldCode}`)).catch(() => {});

  return newCode;
}
```

### `store.js` — `updateFollowingCode(userId, newCode)`

New function added inside `store.js` (alongside existing functions, giving it access to the private `saveFollowing`). Added to `module.exports`.

```js
function updateFollowingCode(userId, newCode) {
  saveFollowing(getFollowing().map((e) =>
    e.userId === userId ? { ...e, code: newCode } : e
  ));
}
```

Export line becomes:

```js
module.exports = { getFollowing, addFollowing, removeFollowing, isFollowing, getLastTimeout, setLastTimeout, renameFollowing, updateFollowingCode };
```

### `following.js` — `subscribeToFollowee` code-change detection

The `watchStatus` callback in `subscribeToFollowee` currently receives `userData` which includes `userData.code`. When a followed user rotates their code, this callback fires with the new code. Add a guard immediately after the expiry write-back block and before the `lastUserData.set` call:

```js
const unsub = watchStatus(entry.userId, (userData) => {
  if (!userData) return;

  // Revocation check
  if (userData.revokedFollowers && userData.revokedFollowers[myUserId]) {
    // ... existing revocation handling
  }

  // Expiry write-back
  if (userData.status === 'available' && isExpired(userData.availableUntil)) {
    // ... existing expiry handling
  }

  // Code change sync — update localStorage if the followed user rotated their code
  if (userData.code && userData.code !== entry.code) {
    entry.code = userData.code;           // update in-memory entry to stay consistent
    updateFollowingCode(entry.userId, userData.code);
  }

  lastUserData.set(entry.userId, userData);
  if (editingSet.has(entry.userId)) return;
  updateFolloweeRow(entry, userData, myUserId);
  sortFollowingList();
});
```

`entry.code` is updated in place so the in-memory reference stays consistent with localStorage for the lifetime of this subscription. Import `updateFollowingCode` from `./store.js` alongside the existing store imports.

### `identity.js` — no changes

`generateCode` and `saveIdentity` are already exported. No modification needed.

## Error Handling

| Scenario | Behaviour |
| --- | --- |
| Offline at tap | ↻ button disabled; confirm sheet not shown |
| Steps 2–3 fail (user record or follower entries) | New code orphaned in `codeIndex` (harmless); old code still active in `users/{userId}`; show error; user retries |
| Step 4 fails (old code deletion) | Both codes exist briefly; new code already active; old code harmless orphan; silently swallowed (`.catch(() => {})`) |
| Code collision in step 1 | Transparent retry with freshly generated code |
| Double-tap / re-entry | Generate button disabled during writes |

## Testing

### `tests/db.test.js` — `rotateCode`

Mock: `runTransaction`, `remove`, `update`, `set` from `firebase/database`; `generateCode` from `identity.js`; `getFollowing` from `store.js`.

- **Happy path:** Transaction commits; `remove`, `update`, and `set` (once per following entry) called in correct order with correct paths; new code returned.
- **Collision retry:** First transaction does not commit; second does; `generateCode` called twice; new code from second attempt returned.
- **Following entries written:** `set` called once per entry returned by `getFollowing()`, each with path `users/{entry.userId}/followers/{userId}` and value `newCode`.
- **Failure path (step 2 or 3 throws):** The write rejects; no compensation call is made; `codeIndex/{newCode}` is left as a harmless orphan (the user's active code in `users/{userId}` was not yet updated, so the old code remains valid); the returned promise rejects; `saveIdentity` is NOT called (it lives in `mycode.js` and is only called on resolution).

### `tests/store.test.js` — `updateFollowingCode`

- Updates matching entry's `code` field; leaves other entries unchanged.
- Non-matching entries are not modified.

### `tests/following.test.js` — mutual code sync in `subscribeToFollowee`

Mock `watchStatus` to call its callback with controlled `userData`.

- When `userData.code` differs from `entry.code`: `updateFollowingCode` is called with the new code; `entry.code` is updated in place.
- When `userData.code` equals `entry.code`: `updateFollowingCode` is not called.
- When `userData.code` is absent (undefined): `updateFollowingCode` is not called.
