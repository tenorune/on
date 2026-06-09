# Request-to-follow a group co-member (Groups §11)

**Date:** 2026-06-09
**Status:** Approved design

## Goal

Let a user in a group send a **1:1 follow request** to a co-member they don't already
follow, so they can become a follower (and use Direct-context primitives, see status
outside the group, etc.). Mirrors Groups spec §11. The resulting follow is
**independent of group membership** — it persists if either party later leaves the group.

In MVP today this affordance does not exist: a non-mutual co-member can knock (a one-shot
ping, no follow-back) but has no path to bridge to a follow relationship.

## Decisions (from brainstorming)

1. **Two-phase mailboxes (Phase-B-clean).** The requester doesn't have the target's share
   code (the roster only exposes uid + displayName), and exposing codes preemptively crosses
   the §5 privacy line. So a request mailbox conveys consent; a grant mailbox conveys the
   target's code back; the requester completes the follow itself. Each party writes only its
   own prefs / mailboxes / self-entry — survives the future Phase-B auth/rules rewrite (R1,
   issue #131) with no rework, and mirrors the existing `pendingInvites` pattern.
2. **⋮ card-drawer affordance** on group roster rows (consistent with Direct), since the row
   already overloads tap=knock and long-press=palette-adoption.
3. **Extend the Inbox** for approve/decline (it's the "addressed to me" mailbox).
4. **Notify the target only** on request ("X wants to follow you"); decline and accept do not
   push the requester (spec step 2). Accept completes silently via the requester's grant watcher.
5. **localStorage-only "Requested" state** (per-device), to avoid the button reverting to
   "Request to follow" between asking and approval. No new RTDB record or rules surface.

## Data model (RTDB)

Two top-level mailboxes, same shape/rationale as `pendingInvites`:

```
followRequests/{targetUid}/{requesterUid} = { from: requesterUid, groupId, ts }
followGrants/{requesterUid}/{targetUid}   = { from: targetUid, code: targetCode, ts }
```

- `followRequests` — written by the **requester**. `groupId` is the group the request was
  initiated from; used to resolve the requester's display name in the notification + Inbox.
  Only the target reads/deletes.
- `followGrants` — written by the **target** on accept; carries the **target's share code** so
  the requester can complete the follow. Only the requester reads/deletes.

The follow itself is written by the **requester** on receiving the grant, using the existing
add-person primitives (exactly what `following.handleAddPerson` does today):

- `setFollowingEntry(requesterUid, targetUid, targetCode, '')` → `userPrefs/{requester}/following/{target}`
- `registerAsFollower(targetUid, requesterUid, requesterCode)` → `users/{target}/followers/{requester} = requesterCode`

Result: a one-directional follow `requester → target`. (The target is **not** auto-following
back; they now have the requester's code in their followers list, so a normal follow-back is
possible later.)

## Flow

1. **Requester** opens the roster member's ⋮ drawer → taps "Request to follow" →
   `requestToFollow(myUid, targetUid, groupId)` writes `followRequests/...`, adds `targetUid`
   to the local requested-set, and the drawer button shows a disabled "Requested".
2. **Target** receives a push ("*{name} wants to follow you*") and the request appears in their
   Inbox (the nav button glows — same unseen cue as invites).
3. **Target** Approve → `writeFollowGrant(requesterUid, myUid, myCode)` + `deleteFollowRequest`.
   Decline → `deleteFollowRequest` only (no notification).
4. **Requester's** grant watcher (`initFollowGrants`, started at boot) sees the grant →
   `setFollowingEntry` + `registerAsFollower` → `deleteFollowGrant` → removes `targetUid` from
   the local requested-set. The new follow appears in Direct; the roster affordance for that
   member disappears (now following). Durable: if the requester was offline, it completes on
   next load.

## Modules

Cohesive split mirroring the invitee/inviter sides of `pendingInvites`:

- **`js/followRequests.js`** (NEW — requester side):
  - `requestToFollow(myUid, targetUid, groupId)` — writes the request; marks local requested-set.
  - `isRequested(targetUid)` — reads the local requested-set.
  - `createRequestFollowButton(myUid, targetUid, groupId)` — returns a `<button>` showing
    "Request to follow" (or disabled "Requested" if `isRequested`), wired to `requestToFollow`.
    Its own `click`/`pointerdown` stopPropagation so it doesn't trigger the row's knock (same
    guard the bell uses).
  - `initFollowGrants(myUid, myCode)` — `watchFollowGrants(myUid)`; on each grant, complete the
    follow (the two primitives above) + `deleteFollowGrant` + clear local requested-set entry.
  - Local requested-set persisted in `localStorage['statusapp_follow_requested']` (per-device).
- **`js/inbox.js`** (EXTENDED — target side):
  - Also `watchFollowRequests(myUid)`; holds `_followRequests` alongside `_pending`.
  - Nav button visible / unseen-glow when **either** mailbox is non-empty (combined seen-keys).
  - Modal renders both row types: invite rows (`Join`/`Decline`, unchanged) and follow-request
    rows ("{name} wants to follow you", `Approve`/`Decline`).
  - Approve → `writeFollowGrant` + `deleteFollowRequest`. Decline → `deleteFollowRequest`.
  - Requester-name resolution: viewer's following label for them → their group displayName via
    `record.groupId` (`readMember`) → "Someone" (same tiering the invite rows now use).
- **`js/groupContext.js`** (`renderRoster`):
  - Build the row's right-side **actions** array: the notify bell (when enabled, non-self) and
    `createRequestFollowButton` (when non-self and **not already following** — `getFollowing()`).
  - ≥2 actions → `createCardDrawer(actions)` (the ⋮ toggle), like Direct. Exactly 1 → append it
    directly (already-followed members keep the bare bell, as today). 0 → nothing.
- **`js/app.js`**: `initFollowGrants(userId, code)` at boot (alongside `initInbox`); route
  `type:'followRequest'` notification clicks to `openInboxModal()` (same as `type:'invite'`).
- **`functions/`**:
  - `presence-core.js`: `buildMessage('followRequest', name)` → "*{name} wants to follow you*"
    (no group variant needed).
  - `notifier.js`: `handleFollowRequest(deps, targetUid, requesterUid, record)` — resolve name
    (`userPrefs/{target}/following/{requester}` label → `resolveGroupMemberName(record.groupId,
    requester)` → code → "Someone"), `sendToUser(target, msg, { type:'followRequest', from:
    requesterUid })`. Unconditional (directed/consensual, like invites — no pref gate).
  - `index.js`: `onFollowRequest = onValueCreated('/followRequests/{targetUid}/{requesterUid}')`.
    `onValueCreated` (not Written) so a re-request overwrite doesn't re-fire; a re-request after
    a decline (key deleted then recreated) does.
- **`js/db.js`** (NEW primitives): `writeFollowRequest`, `watchFollowRequests`,
  `deleteFollowRequest`, `writeFollowGrant`, `watchFollowGrants`, `deleteFollowGrant`. Each new
  export must be stubbed in every db-mocking test file (the "db-mock tax" — ~a dozen files).

## Eligibility / dedup / edge cases

- **Eligibility:** the "Request to follow" action is offered only when `targetUid !== myUid` and
  the viewer is **not already following** the target (`getFollowing()`).
- **Requested state (local):** while `targetUid` is in the local requested-set the button reads
  disabled "Requested". Cleared when the follow completes (grant). **Accepted edge:** a
  *declined* request leaves a stale per-device "Requested" (the requester is never told of
  declines); it clears only when the follow eventually completes or localStorage is cleared.
- **No notification spam on re-request:** `onValueCreated` means re-writing the same key doesn't
  re-fire the push (same as invites).
- **Offline accept:** the grant sits in `followGrants/{requester}/{target}` and completes on the
  requester's next load.
- **Idempotent completion:** if the requester already follows the target by the time the grant
  arrives, `setFollowingEntry`/`registerAsFollower` are `set()`s of the same value — harmless.
- **Self / already-following:** affordance hidden (eligibility check).
- **Grant orphan:** a grant the requester never returns to consume is a benign orphan; not pruned
  in MVP.

## Testing

- `db.js` primitives (read/write/delete paths) + stubs added to db-mock test files.
- `presence-core`: `buildMessage('followRequest', name)` title.
- `notifier`: `handleFollowRequest` name-resolution tiers; no record / no `from` → no send.
- `followRequests.js`: `requestToFollow` writes the request + marks local set; `isRequested`
  reflects it; `createRequestFollowButton` renders "Request to follow" vs disabled "Requested";
  `initFollowGrants` on a grant completes the follow (asserts `setFollowingEntry` +
  `registerAsFollower`) + deletes the grant + clears the local set.
- `inbox.js`: follow-request rows render with Approve/Decline; Approve writes the grant +
  deletes the request; Decline deletes the request; unseen-glow covers follow requests; combined
  count drives the nav button.
- `groupContext.js`: roster row offers the request action only for eligible members; ≥2 actions
  collapse into the ⋮ drawer; already-followed members keep the bare bell; the request button's
  tap doesn't trigger a knock.

## Out of scope (follow-ups)

- Persistent/cross-device "Requested" + sent-requests view (the `userPrefs/{me}/sentFollowRequests`
  mirror — same shape as #124). MVP is localStorage-only, per-device.
- Notifying the requester on accept/decline.
- Pruning orphaned grants.
- Phase-B rules for the two new mailboxes land with R1 (#131); the design is already shaped for it.
