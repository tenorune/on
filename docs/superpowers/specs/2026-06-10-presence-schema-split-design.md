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
calls/{calleeId} = { callerId, ts }            ← caller writes; callee watches own
revocations/{revokedUid}/{revokerUid} = true   ← replaces revokedFollowers piggyback
userPrefs/{uid}/perGroup/{gid}/lastVisited     ← nav-sort hint (private, synced)
userPrefs/{uid}/activeCall = { calleeId, ts }  ← caller's own boot-recovery pointer
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
- `setCallState(callerId, calleeId)` → ONE multi-path update writing
  `calls/{calleeId} = { callerId, ts }` AND
  `userPrefs/{callerId}/activeCall = { calleeId, ts }`.
- `clearCallState(callerId)` → clears BOTH `calls/{calleeId}` AND
  `userPrefs/{callerId}/activeCall`. The calleeId is resolved by reading
  `userPrefs/{callerId}/activeCall` first (one get), then a multi-path update
  nulls both paths. (Resolving from the pointer rather than a new param keeps
  every existing `clearCallState(uid)` call site unchanged — there are several,
  in error/teardown paths that don't all have the calleeId in hand.) A null/absent
  pointer means no active call → clear is a no-op.
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
  `users/{uid}/presence`), `watchRevocations(uid, cb)`, `watchIncomingCalls(uid,
  cb)` (on `calls/{uid}`).

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
- **Call signaling (5b):** callee detection moves from the followee watchers
  sniffing `callState` to ONE `watchIncomingCalls(myUid)` → resolve `callerId`
  against the contacts list → existing incoming-call UI. Caller boot-recovery
  reads `userPrefs/{me}/activeCall` (userPrefs is already watched at boot — no
  new listener) instead of own `callState`; `reEnterCallMode`/`clearCallState`
  keep their semantics on the new paths (teardown clears both the `calls/`
  mailbox and the `activeCall` pointer). The UI still only OFFERS calls to
  mutuals — unchanged; only the detection topology changes.

## 4. Cloud Functions

- `onKnock` → `/knocks/{recipientId}/{senderId}` (handler params identical).
- `onCall` → `/calls/{calleeId}`; the "new call only" before/after dedup keys on
  `callerId`; handler resolves the caller's name as today.
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
- **Call flow (riskiest):** incoming-call detection via `calls/{me}` mailbox;
  boot-recovery via `activeCall` (re-enter when callee data valid, clear when
  gone — the `callModeHandled` matrix re-pinned on new seams); teardown clears
  both records; `onCall` dedup (same-caller overwrite no-ops, new call pushes).
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
