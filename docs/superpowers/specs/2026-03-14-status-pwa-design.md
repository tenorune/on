# Status PWA — Design Spec

**Date:** 2026-03-14

## Overview

A Progressive Web App that lets users share their availability status with others. Each user controls their own on/off status, optionally with a timed expiry. Users follow each other by exchanging short codes — no accounts, no logins.

---

## Core Concepts

- **User identity**: Generated silently on first open. A permanent user ID and a 6-character alphanumeric shareable code are stored in localStorage. The user is anonymous — no name, no account.
- **Following**: You follow someone by entering their code and giving them a label of your choosing (e.g. "Partner", "Mom"). Labels are stored locally only and never shared.
- **Status**: Binary — available or unavailable. Available can have an optional timeout; unavailable has no timeout.
- **Timeout**: When setting available, the user picks a duration via a slider: 1h minimum, 12h maximum. Status always auto-expires to unavailable when the timeout elapses — there is no indefinite option.
- **Scale**: Up to 30 users in total across the system (not a per-room limit; the system is designed for light use).

---

## Screens

### 1. My Status (default tab)
- Large glowing dot in the centre. Green with glow = available. Dark grey = unavailable.
- Tapping the dot toggles status.
- When turning **on**: a timeout slider appears below the dot.
  - Range: 1h to 12h in 1-hour steps (12 positions total).
  - Default: last-used slider position (stored as `lastTimeout` in localStorage), or position 2 (2h) on first use.
  - Label updates live as the slider moves (e.g. "1h", "3h", "12h").
  - On confirm (tap dot or separate confirm), writes `status: "available"` and `availableUntil: Date.now() + hours*3600000` to Firebase.
- When turning **off** (manually): writes `status: "unavailable"` and `availableUntil: null` to Firebase. The timestamp is always cleared on manual turn-off to prevent stale data from being misread by followers.
- Slider is hidden when status is unavailable.
- Current status label shown below the dot ("Available · 3h left" or "Unavailable").
- Expiry countdown ("3h left", "45m left") counts down in real-time on the client.

### 2. Following (second tab)
- Scrollable list of all followed users.
- Each row: coloured dot (green/dark) + user's label + status text ("Available · 45m left" or "Unavailable").
- Status is read from Firebase in real-time. On read, if `availableUntil` is non-null and `availableUntil < Date.now()`, the status is treated and displayed as unavailable, and a client-side write-back sets `status: "unavailable"` and `availableUntil: null` on that user's Firebase record (only the first follower to detect expiry performs this write; subsequent writes are idempotent).
- "Add person" button at the bottom opens an inline form:
  - Field: their code (6 characters, uppercase, auto-uppercased on input)
  - Field: label (free text, stored locally)
  - Submit: "Follow" — on success, resolves the code to a userId via `codeIndex`, writes the follower's own code to `/users/{theirUserId}/followers/{myUserId}`, and saves the entry to localStorage.
  - **Error states:**
    - Unknown code (not found in `codeIndex`): show "Code not found. Check the code and try again."
    - Own code: show "That's your own code."
    - Already following: show "You're already following someone with that code." (label shown)
    - Empty fields: standard required-field validation before submit.
- Rows are sorted: available users first, then unavailable, each group alphabetical by label.
- **Offline**: the list shows last-known values with a subtle "Offline" banner at the top. No data is written while offline.

### 3. My Code (third tab)
Two sections on this screen:

#### Your Code

- Displays the user's 6-character code in large type.
- "Copy" button copies the code to clipboard.
- Brief instructional text: "Share this code so others can follow your status."

#### Followers

- Scrollable list of everyone currently following you (i.e. everyone who has added your code and has not been revoked).
- Each row shows the follower's code (their identifier, since users are anonymous) and a "Remove" button.
- Removing a follower:
  1. Removes them from `/users/{myUserId}/followers`.
  2. Writes `true` to `/users/{myUserId}/revokedFollowers/{theirUserId}`.
  3. The removed follower's client detects this on next read of your record and automatically removes you from their following list (silent removal, no error shown to them).
- If no followers yet: show "No one is following you yet."

---

## Navigation

Bottom tab bar with three tabs: **Me**, **Following**, **My Code**. App opens on the Me tab.

---

## Identity Initialisation Flow

On first open:

1. Generate a UUID as `myUserId`.
2. Generate a random 6-character alphanumeric code as `myCode`.
3. Attempt to write `{ code: myCode, status: "unavailable", availableUntil: null }` to `/users/{myUserId}` and `myUserId` to `/codeIndex/{myCode}` in a single Firebase transaction.
4. If the code is already taken (collision in `codeIndex`), generate a new code and retry. Collisions are astronomically rare (6-char alphanumeric = ~2.2B combinations, ≤30 users) but must be handled.
5. On success, persist `myUserId` and `myCode` to localStorage.

On subsequent opens, read `myUserId` and `myCode` directly from localStorage — no Firebase write needed.

---

## Data Model (Firebase Realtime Database)

```
/users/{userId}/
  code: string                        // 6-char alphanumeric, unique
  status: "available" | "unavailable"
  availableUntil: number | null       // Unix timestamp ms; null only when unavailable
  followers/{followerId}: string      // followerId → their code (written when they follow you)
  revokedFollowers/{followerId}: true // set when you revoke a follower

/codeIndex/{code}: userId             // lookup userId by code
```

- `availableUntil` is always set to a future timestamp when turning available. It is never `null` while status is available.
- Expiry is enforced client-side on read: if `availableUntil !== null && availableUntil < Date.now()`, treat as unavailable.
- When a follower detects expiry, it performs a write-back to clear the status. No Cloud Function required.
- When user A follows user B, A writes their own code to `/users/{B}/followers/{A-userId}`.
- When user B revokes user A: removes `/users/{B}/followers/{A-userId}` and writes `true` to `/users/{B}/revokedFollowers/{A-userId}`.
- When A's client reads B's record and finds A's own userId in `revokedFollowers`, A's client silently removes B from A's local following list.

---

## Local Storage

```
myUserId: string
myCode: string
following: [{ code, label, userId }]
lastTimeout: number   // last slider position (1–12), default 2
```

---

## PWA Requirements

- Manifest with name, short name, theme colour, and icons (192×192 and 512×512 minimum).
- Service worker for offline shell (app loads without network; live status data requires connection).
- `display: standalone` so it installs cleanly on iOS and Android.

---

## Tech Stack

- **Frontend**: Vanilla JS + HTML/CSS (no framework)
- **Backend**: Firebase Realtime Database (free Spark plan sufficient)
- **Hosting**: Firebase Hosting or any static host

---

## Out of Scope

- Push notifications
- User accounts or authentication
- Groups or rooms
- Status history or audit log
- Admin controls
- Maskable icons (deferred to v2)
