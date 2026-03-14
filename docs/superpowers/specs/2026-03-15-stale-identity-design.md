# Stale Identity Detection & Recovery Design

## Problem

When a user opens the app, their `userId` and `code` are loaded from localStorage. The app currently trusts this data without verifying it against Firebase. If the Firebase record is gone (e.g. database reset, server migration), the user is stuck: their code is displayed but non-functional, and they have no way to recover without manually clearing browser storage.

## Goal

Detect a missing Firebase record on startup and silently recover — generating a fresh identity and informing the user with a brief, dismissable message.

## Approach

`ensureIdentity()` in `app.js` verifies an existing localStorage identity against Firebase before using it. If the record is missing, it clears localStorage and returns `null`. `main()` intercepts the `null`, shows the stale screen, waits for the user to dismiss it, then calls `ensureIdentity()` again to generate a fresh identity.

Network failures during verification are treated as "assume valid" — the app proceeds normally. Only a confirmed missing record triggers a reset.

---

## Components

### 1. `userExists(userId)` — `js/db.js`

A new exported async function that performs a one-time `get()` on `users/{userId}` and returns `true` if the record exists, `false` if it does not.

Uses the existing `get` and `ref` imports. No subscription, no side effects.

**Tests:** Two unit tests in a new `tests/db.test.js` file — one for a record that exists (returns `true`), one for a missing record (returns `false`). A separate file is required because `tests/status.test.js` mocks `firebase/database` as an empty object; `userExists` needs `get` to be a working mock, which would conflict with the existing setup.

### 2. `clearIdentity()` — `js/identity.js`

A new exported function that removes the identity key from localStorage. Mirrors the existing `saveIdentity` / `loadIdentity` pattern. Must be added to `identity.js`'s `module.exports` object (the file uses CommonJS; `app.js` imports it via Babel's interop).

### 3. Updated `ensureIdentity()` — `js/app.js`

After loading an existing identity from localStorage, calls `userExists(userId)`. If it returns `false`, calls `clearIdentity()` and returns `null`. If the Firebase call throws (offline/network error), catches the error and returns the existing identity unchanged.

If no identity is in localStorage, proceeds with normal new-user registration as before.

**Call site change required:** The current `main()` destructures the return value directly (`const { userId, code } = await ensureIdentity()`). This must be refactored to a null-check first, otherwise a `null` return throws a TypeError before `main()` can show the stale screen:

```js
const identity = await ensureIdentity();
if (!identity) { /* show stale screen */ }
const { userId, code } = identity;
```

### 4. Stale identity screen — `index.html` + `css/app.css`

A full-screen overlay element, hidden by default. Displays:
- A message: "Your previous session was not found. A new code has been generated for you."
- A single "Continue" button

Uses existing CSS custom properties (surface, text, button styles). No new design language.

### 5. `showStaleScreen()` — `js/app.js`

A small helper in `app.js` that unhides the overlay and returns a Promise that resolves when the user taps Continue. Called by `main()` when `ensureIdentity()` returns `null`.

---

## Flow

```
main()
  └── ensureIdentity()
        ├── loadIdentity() → null         → generate new identity (unchanged)
        └── loadIdentity() → {userId}
              └── userExists(userId)
                    ├── true              → return existing identity (unchanged)
                    ├── false             → clearIdentity(), return null
                    └── throws (offline)  → return existing identity (assume valid)

main() receives null
  └── showStaleScreen()     → user taps Continue
  └── ensureIdentity()      → localStorage empty → generates new identity
  └── app initialises normally
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Firebase confirms record missing | Reset: clear identity, show message, generate new |
| Firebase unreachable (offline) | Assume valid: proceed with existing identity |
| localStorage empty (new user) | Normal first-run registration, no message shown |

---

## Out of Scope

- Migrating or recovering a lost code
- Notifying followers that a user's identity has changed
- Detecting partial corruption (e.g. `codeIndex` entry exists but `users` entry does not)
- Cleaning up orphaned `codeIndex` entries left behind by reset identities (the old entry is harmless since the new identity will use a fresh code)
