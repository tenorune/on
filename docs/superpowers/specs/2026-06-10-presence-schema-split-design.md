# Presence Schema Split — Design

**Date:** 2026-06-10
**Status:** Approved (brainstormed 2026-06-10)
**Branch:** `presence-schema-split`
**Tracking:** #131 backlog perf #4 — "watchStatus reads the whole users/{uid} node for ~4 fields; a knock/follower write re-fires every watcher → narrower status path or split knocks/followers subtrees out." (L · High, schema)

## Problem

Every `watchStatus(uid)` subscription watches the WHOLE `users/{uid}` node, but
consumers read only presence fields (`status`, `availableUntil`, `statusColor`,
`paletteKey`, `code`, plus `callState`/`revokedFollowers` piggybacks). Two costs:

1. **Spurious re-fires.** A write to ANY child re-fires every watcher pointed at
   that node. The worst offenders: `knocks/{sender}` (every knock re-fires the
   recipient's own watcher + every follower's + every roster watcher) and
   `groups/{gid}/lastVisited` (every nav tap re-stamps it, re-firing all of that
   user's followers' watchers). following.js carries an explicit
   `skip-if-only-knocks-changed` guard as evidence.
2. **Oversized payload per tick.** Even a legitimate status flip ships the
   user's entire `followers` map, `invites`, and `groups` membership to every
   follower, every time.

Item #1 (re-fire frequency) is addressable by moving churn out; item #2 (payload
size) requires narrowing the watched PATH. This design does both — the
maximum-runtime-efficiency shape ("C-max").

## Decisions taken in brainstorming

- **Migration posture: flag-day** (option 1). New code reads/writes new paths
  only; a one-time admin migration runs at deploy; stale PWAs misbehave until
  they refresh (accepted — dev+prod are trusted-tester scale). Functions,
  hosting, and rules ship together.
- **Maximum runtime efficiency** chosen over the surgical options — narrow the
  watched path to a `presence/` subtree, not just relocate churn.
- **Call signaling: option 5(b)** — a callee mailbox (`calls/{calleeId}`),
  removing call traffic from the broadcast entirely, rather than parking
  `callState` inside `presence/`.

## 1. Target schema

```
users/{uid}/
  presence/                      ← THE watched path (all 3 watcher families)
    status, availableUntil, statusColor, paletteKey, code, lastSeen
  followers/{followerUid} = code ← social graph (no hot watcher; stays)
  invites/{token}                (stays)
  groups/{groupId}               (stays; lastVisited REMOVED from here)
  recovery fields                (stay)
  — DELETED: knocks/, callState, revokedFollowers,
             favorites, lastTimeoutMinutes, currentContext (legacy, long since
             migrated to userPrefs/)

knocks/{recipientId}/{senderId} = { count, ts, contextGroupId? }   ← moved out
calls/{uid} = { to: peerId, ts, answered? }     ← I am the caller
            | { from: peerId, ts, answered? }   ← I am being called / I answered
revocations/{revokedUid}/{revokerUid} = true   ← replaces revokedFollowers piggyback
userPrefs/{uid}/perGroup/{gid}/lastVisited     ← nav-sort hint (private, synced)
```

`code` stays inside `presence/` so the followee-watcher code-rotation self-heal
keeps working for free. `lastSeen` is one write per app-open — negligible churn,
and it belongs with presence.

## 2. Data-layer writers (db.js)

1:1 path remaps (signatures unchanged unless noted):

- `initUser` seeds `users/{uid}/presence/{status,availableUntil,code}`.
- `setStatus`, `writeBackExpired`, `setStatusColor`, `setPaletteKey`,
  `rotateCode`, `touchLastSeen` → write under `presence/`.
- `rotateCode` still fans the new code into each follower's
  `users/{followerUid}/followers/{me}` entry (unchanged) AND updates
  `presence/code`.
- `getUser`/`userExists` read `presence/` (or the node as needed — see consumer
  notes).
- `writeKnock`/`getKnocks`/`watchKnocksAdded`/`clearKnock` → `knocks/{recipient}`
  top-level.
- Call primitives (replacing `setCallState`/`clearCallState`) — every one a
  single atomic multi-path update over BOTH participants' mailboxes:
  - `startCall(callerId, calleeId)` → `calls/{callerId} = { to: calleeId, ts }`
    + `calls/{calleeId} = { from: callerId, ts }`.
  - `answerCall(calleeId, callerId)` → sets `answered: true` on both records.
  - `endCall(aUid, bUid)` → nulls both records. ONE primitive replaces today's
    three asymmetric clear paths (caller hangup, receiver decline, post-answer
    teardown).
  - `watchOwnCall(uid, cb)` → onValue on `calls/{uid}` (each party watches only
    its OWN mailbox).
- `removeFollower(myUid, followerUid)` → remove
  `users/{myUid}/followers/{followerUid}` AND set
  `revocations/{followerUid}/{myUid} = true` (was `revokedFollowers`).
- `registerAsFollower` → the load-bearing "remove revocation BEFORE writing
  followers entry" sequential ordering MOVES to `revocations/{me}/{target}`
  (remove) then `users/{target}/followers/{me}` (set). The comment's reasoning
  follows the data.
- `setLastVisited` → `userPrefs/{uid}/perGroup/{gid}/lastVisited` via
  mergeUserPrefs.
- New: `watchPresence(uid, cb)` (the narrowed `onValue` on
  `users/{uid}/presence`) and `watchRevocations(uid, cb)`. (`watchOwnCall` is
  defined with the call primitives above.)

## 3. Client consumers

- **The 3 watcher families narrow to `presence/`:** `ownStatus.js`
  (`watchStatus` → `watchPresence`), followee watchers in following.js, roster
  member watchers in groupContext.js. Per-tick payload ≈ 6 scalars; spurious
  re-fires ≈ zero. The `skip-if-only-knocks-changed` guard in following.js is
  **deleted** (the condition it guards can no longer occur).
- **Revocation:** a new app-lifetime `watchRevocations(myUid)` in following.js;
  on a revoker key appearing, run the existing auto-unfollow path (the logic
  that lived in each followee watcher's `revokedFollowers[me]` check moves here,
  once). Net: −N followees' revocation payload, +1 small listener.
- **Call signaling (5b) — the symmetric-mailbox state machine.** Each party
  watches only `calls/{me}`; all transitions write both records atomically:
  - *Initiate:* swipe-right (non-glowing) → `enterCallMode` keeps its local
    `callModeCalleeId` + pre-clears anyone ringing me (`endCall` per ring —
    today's clear-all loop) → `startCall(me, peer)`.
  - *Ring (callee side):* own-mailbox tick with `from: A` → module state
    `_incomingCall = { from }` → repaint A's row ("Calling you… swipe right to
    answer"); replaces the followee-watch `callState` sniffing, the
    `lastUserData.callState` reads, and the card-drawer-close repaint hook
    (which re-reads `_incomingCall` instead).
  - *Answer:* swipe-right on the glowing row → `answerCall(me, caller)` +
    `enterCanvas` (unchanged). *Caller detects the answer* via its OWN mailbox
    (`answered: true` appears) → `enterCanvas` — replacing the mutual-callState
    detection in `updateFolloweeRow`.
  - *Hangup/decline (either side, any phase):* `endCall(me, peer)`.
    *Peer-ended detection:* own mailbox goes null while in call-mode/canvas →
    today's "partner left" flow — moved OFF the own-presence watcher (app.js's
    `callModeHandled` block), which no longer carries call logic at all.
  - *Boot recovery:* the own mailbox IS the durable record (no userPrefs
    pointer). `to: B` at first tick → validate `calls/{B}.from === me` (one
    get; on mismatch self-clean via `endCall`) → `reEnterCallMode`;
    `from: A, answered` → re-enter callee-side canvas path; unanswered
    `from: A` → just renders as a live ring.
  - *Concurrency:* single-occupancy mailbox ⇒ LAST-RING-WINS when two callers
    ring one user (today: parallel rings). The displaced caller's stale `to`
    record self-cleans via the boot/hangup validation. Accepted at this scale.
  - The UI still only OFFERS calls to mutuals — unchanged; only detection
    topology changes. `lastUserData` stops carrying call state entirely; the
    followee-watch payload is pure presence.

## 4. Cloud Functions

- `onKnock` → `/knocks/{recipientId}/{senderId}` (handler params identical).
- `onCall` → `/calls/{uid}` (onValueWritten). Guard: notify only when the
  AFTER record is a fresh unanswered ring — `after.from` exists, `!after.answered`,
  and `before?.from !== after.from`. The same `startCall` update also fires this
  trigger for the caller's own `to`-record — skipped by the `from` check.
  Handler resolves the caller's name as today.
- `onAvailability` → `/users/{uid}/presence/availableUntil`; sibling reads in the
  handler (`status`) → `presence/status`.
- Notifier `getVal` remaps: `users/{uid}/status` → `presence/status`,
  `users/{uid}/code` → `presence/code`. `users/{uid}/followers` and
  `users/{uid}/groups` reads stay. `presence-core.js` is pure — untouched.
- `onMemberOverride` (groups) — unaffected (different subtree).

## 5. Rules

Add top-level honor-system entries for the new namespaces (the `$other`
default-deny would otherwise `permission_denied` them — the follow-requests
deploy already taught this lesson):

```
knocks/{$recipientUid}      → .read/.write true
calls/{$calleeUid}          → .read/.write true
revocations/{$revokedUid}   → .read/.write true
```

`presence/` is under `users/{uid}` (already covered). Phase-B tightening of all
honor-system paths remains tracked under #131 R1.

## 6. Migration (flag-day)

`scripts/migrate-presence.js` (admin SDK, service account, `--project <env>`),
idempotent:

- For each `users/{uid}`: copy `{status, availableUntil, statusColor,
  paletteKey, code, lastSeen}` into `presence/`; write any live
  `revokedFollowers/{r}` into `revocations/{r}/{uid}`; delete `knocks`,
  `callState`, `revokedFollowers`, `favorites`, `lastTimeoutMinutes`,
  `currentContext`, and `groups/{*}/lastVisited`.
- Old transient knocks are dropped (they expire unread anyway). `lastVisited`
  values are dropped (sort hint; rebuilds on first navigation).

**Deploy order per environment:** run the migration script, then the `dev` merge
ships functions + hosting + rules together via CI. `sw.js` `CACHE` bumps with the
deploy so clients refresh promptly. Stale PWAs write presence to the old path
(invisible to updated clients until refresh) — no corruption, just a refresh
incentive.

## 7. Testing

- **db.js:** path assertions for every remapped writer; a perf-guard test that
  knock writes touch nothing under `users/` and presence writes touch only
  `users/{uid}/presence/`.
- **Call flow (riskiest):** full transition matrix on the new seams —
  initiate writes both records; ring renders from the own-mailbox tick (incl.
  drawer-open suppression via `_incomingCall`); answer sets `answered` on both
  and caller's own-mailbox tick triggers canvas; `endCall` from each side at
  each phase (pre-answer hangup, receiver decline, post-answer teardown) nulls
  both and the peer's null tick drives "partner left"; boot recovery for all
  three mailbox shapes (`to`, `from`+answered, stale `to` self-clean);
  last-ring-wins overwrite; `onCall` guard (to-record skipped, same-caller
  overwrite no-op, answered write no-op, fresh ring pushes).
- **Revocation:** auto-unfollow fires on a `revocations/{me}` tick;
  `removeFollower` writes both records; re-follow ordering
  (`registerAsFollower` removes revocation before the followers set).
- **Watcher narrowing:** existing `watchStatus` mocks repoint to `watchPresence`
  (or `watchStatus` internally re-pointed — naming decided in the plan);
  assertions unchanged. Functions tests update `getVal` store keys to
  `presence/`.
- Full web + functions suites as backstop. Manual dev verification before the
  `dev` merge: knock → push → deep-link, and a full call round-trip (offer →
  detect → enter → clear), and a status flip propagating to a follower.

## Out of scope

- Phase-B rule tightening (#131 R1).
- Splitting `followers`/`invites`/`groups` off `users/{uid}` — they have no hot
  watcher after this change and a change there SHOULD repaint; moving them adds
  listeners to save nothing.
- The render-diffing and subscription-collapse items (already shipped).
