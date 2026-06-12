# R1 — Server-side auth + RTDB rules hardening (design)

**Status:** approved design, pre-implementation.
**Issue:** #164 (R1 — the security launch gate).
**Supersedes:** the Phase B sketch in `docs/superpowers/specs/2026-05-23-recovery-code-design.md` (§ "Phase B"), which this fully specifies.

## Problem

`database.rules.json` is `.read/.write: true` on every collection, and there is no
Firebase Auth (`auth` is `null`), so the rules enforce nothing: anyone can read,
write, or forge any user's data — prefs, push tokens, presence, knocks, calls,
group membership, `pendingInvites.from`, follow requests/grants, canvases. This
is the gate before any public/real users.

## Decisions (made during brainstorming)

- **Auth model: Firebase custom tokens** (not anonymous — the uid must equal
  `sha256(recoveryCode)`, and anonymous auth hands out a random uid). Zero data
  migration: the `userId = sha256(code)` formula is preserved.
- **Read scope: knowable-uid, no listing** ("model a"). Any signed-in user may
  read `users/{knownUid}` (presence + group enumeration); collections are never
  enumerable. In practice "readable if you were given the code."
- **Rule strictness: ownership + sender-identity** ("(a) lighter"). Enforce
  per-path ownership and that mailbox sender keys equal `auth.uid` (no forging
  `from`); minimal payload-shape validation.
- **Group join: lighter** — writing `groups/{gid}/members/{your-uid}` requires
  only `auth.uid == $memberUid`. Anyone holding the 8-char (random, non-enumerable)
  group id can self-join; the invite flow is the app-level gate. *Accepted risk.*
- **Canvases: participant-scoped** — you must be one of the two ids in the
  canvas id (`[a,b].sort().join('_')`), checked exactly as
  `$canvasId.beginsWith(auth.uid + '_') || $canvasId.endsWith('_' + auth.uid)`
  (delimiter-anchored to avoid substring false-matches). Free + closes
  third-party snoop/vandalize.
- **Single combined R1, flag-day** rollout (no two-phase split).

## Architecture

### 1. Auth — `validateRecovery` Cloud Function + client sign-in

**Function** (`onCall`, callable **unauthenticated** — the user isn't signed in yet):
1. Normalize the recovery code; reject if not 4 words all in the wordlist.
2. `uid = sha256(normalizedCode).slice(0, 32)` (matches `identity.js`).
3. `admin.auth().createCustomToken(uid)` → return `{ token }`.
4. **No "record exists" check** — it would break new-account creation
   (chicken-and-egg: you must be authed to write `users/{uid}`, which doesn't
   exist yet). It's also unnecessary: a token for `uid=sha256(code)` only grants
   acting *as* that uid, which already requires knowing the code (preimage
   resistance).
5. **Rate-limit** per source IP (e.g. 10/min) as defense-in-depth. Recovery codes
   are 4 words from the wordlist (~10¹²–10¹³ combinations), so online brute-force
   is already infeasible.

**Client lifecycle:**
- Firebase Auth persists the session locally (SDK default). At boot, **reuse a
  cached session** if present — no function call. Call `validateRecovery` only on
  first-ever sign-in, a restored device, or a lost session. The SDK auto-refreshes
  the ID token via the refresh token thereafter.
- **Boot gates on auth**: sign in before any RTDB op. On failure (offline /
  rate-limited / function error) → retry-with-backoff + a clear error screen.
  (First-ever sign-in while offline is inherently impossible.)
- **New-account / restore order**: generate/derive uid → `validateRecovery(code)`
  → `signInWithCustomToken` → *then* `initUser` writes `users/{uid}` (now permitted
  by `auth.uid == uid`).

### 2. Rules model

Read/write is granted only at the `/{id}` child level, never at a collection
root, so **nothing is enumerable**. By category:

| Collection | `.read` | `.write` |
|---|---|---|
| `userPrefs/{uid}` | `auth.uid == $uid` | `auth.uid == $uid` |
| `users/{uid}` | `auth != null` | `auth.uid == $uid` |
| `users/{uid}/followers/{follower}` | (inherits) | `auth.uid == $follower` ‖ `auth.uid == $uid` |
| `codeIndex/{code}` | `auth != null` | set: `newData.val() == auth.uid`; delete: `data.val() == auth.uid` |
| `inviteIndex/{token}` | `auth != null` | authed creator owns it (group invites also require membership — fields nailed in the plan) |
| `groupIdIndex/{gid}` | `auth != null` | claim if `!data.exists()` (first-writer-wins) |
| `groups/{gid}` (meta) | member: `groups/{gid}/members/{auth.uid}` exists | owner: `auth.uid == data.child('ownerId')` |
| `groups/{gid}/members/{uid}` | (member) | `auth.uid == $uid` ‖ owner |
| `knocks/{recipient}/{sender}` | `auth.uid == $recipient` | `auth.uid == $sender` |
| `revocations/{revoked}/{revoker}` | `auth.uid == $revoked` | `auth.uid == $revoker` |
| `followRequests/{target}/{requester}` | `auth.uid == $target` | `auth.uid == $requester` |
| `followGrants/{requester}/{target}` | `auth.uid == $requester` | `auth.uid == $target` |
| `pendingInvites/{invitee}/{group}` | `auth.uid == $invitee` | `auth.uid == newData.child('from')` **and** inviter is a member of `$group` |
| `pendingInvitesByGroup/{group}/{invitee}` | member of `$group` | member of `$group` |
| `calls/{uid}` | `auth.uid == $uid` | `auth.uid == $uid` ‖ writer is the named `from`/`to` peer (create/update/delete) |
| `canvases/{canvasId}` | `auth != null && ($canvasId.beginsWith(auth.uid+'_') ‖ $canvasId.endsWith('_'+auth.uid))` | same |
| `notifierState` | `false` | `false` (functions use the admin SDK, which bypasses rules) |
| `$other` (any unlisted) | `false` | `false` |

**Co-write cases** (the two non-trivial ones):
- `calls/{uid}` is touched by *both* call participants (`startCall`/`answerCall`/
  `endCall` each write both mailboxes). The write rule allows the owner *or* the
  writer named as `from`/`to` in the new (create/update) or existing (delete) data.
- `users/{uid}/followers/{follower}` is written by the *follower* on
  register/unregister (`auth.uid == $follower`) and removed by the owner
  (`auth.uid == $uid`).

### 3. Rollout — flag-day (operational steps go in `docs/DEPLOY-PROD.md`)

1. Deploy `validateRecovery` **first** (additive; no behavior change).
2. Deploy the new **client + rules together**. On landing, any client not running
   the new code (not signed in) is locked out until it reloads; cached sessions
   mean only never-signed-in clients are affected.
3. **dev**: land as its own deploy, coordinate the (few, trusted) testers to
   reload. The **prod cutover** then carries it via the `dev→main` deploy.

**Prereqs** (added to `docs/DEPLOY-PROD.md`, for dev *and* prod):
- Enable **Firebase Authentication** on the project.
- Grant the functions' runtime SA **`roles/iam.serviceAccountTokenCreator` on
  itself** — `createCustomToken()` fails without it.

### 4. Testing

- **RTDB rules unit tests** via `@firebase/rules-unit-testing` against the
  emulator — one assertion per category: owner-only writes; can't-forge-`from`;
  membership-gated invites; the two co-write cases; participant-scoped canvases;
  and **no listing**. Adds the **Firebase emulator** as a new test/CI dependency.
- **`validateRecovery`** jest unit test: valid code → token for derived uid; bad
  format → reject; rate-limit path.
- **Client**: update boot tests for sign-in-before-RTDB, new-account signs-in-
  before-`initUser`, and the restore flow (mock auth + `validateRecovery`).

## Accepted risks / deferred

- **Group-id leak ⇒ joinable** (lighter join) — accepted.
- **`users/{uid}` knowable-read** exposes your group enumeration to anyone holding
  your uid — accepted under model (a).
- **Recovery code transits to `validateRecovery`** over HTTPS (re-derived to mint
  the token; never stored) — architecturally forced, like a password login.
- **Deferred:** Firebase **App Check** on `validateRecovery` (abuse-resistance
  beyond rate-limiting). Note, don't build now.

## Out of scope

Phase C (QR multi-device pairing) — separate spec.
