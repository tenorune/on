# Location-Sharing — Security-Review Fix Spec

> Status: **proposed** (not yet implemented). Source: `/security-review` +
> `vibesec-skill` pass on branch `claude/knockknock-feature-dev-9a3ysy`
> (feature tip `93bea22`, 42 commits over base `c2f6a2e`). Scope is the
> location-sharing feature only. Work stays on this branch; no dev/main pushes,
> no PRs unless asked.

## Findings this spec closes

| # | Sev | Conf | Title | Locus |
|---|-----|------|-------|-------|
| 1 | HIGH | 9/10 | Precise-location reciprocity gate is forgeable — any authed user can read anyone's exact GPS | `database.rules.json:179` rooted on `:34` |
| 2 | MEDIUM | 9/10 | Self-join grants coarse-cell reads of a group's members (#288 widening) — fix locked to **option A** (CF-brokered join) | `database.rules.json:191` rooted on `:83` |
| 3 | LOW | — | Membership loss doesn't authoritatively revoke a published coarse cell (VibeSec lifecycle lens) | `database.rules.json:191–192`, `js/db/groups.ts:139` |

Deliberately **out of scope** (operator-approved product posture, not defects):
last-known nodes outliving availability; "distance shows only on available
cards" being a client-side display gate. Do not "fix" these.

---

## Fix 1 — Precise-location gate: stop trusting owner-fabricated follower edges

### Root cause

The read gate on `locations/$uid` (`database.rules.json:179`) treats two
follower edges as proof of a genuine mutual follow:

```
auth.uid === $uid
|| ( root.child('users').child($uid).child('followers').child(auth.uid).exists()   // (a) attacker follows victim
  && root.child('users').child(auth.uid).child('followers').child($uid).exists()    // (b) victim follows attacker
  && root.child('locations').child(auth.uid).exists() )                             // (c) attacker publishing
```

Edge (b) — "victim follows attacker" — lives at
`users/{attacker}/followers/{victim}`, i.e. under the **attacker's own** uid.
The follower write rule (`database.rules.json:34`) is:

```
".write": "auth != null && (auth.uid === $follower || auth.uid === $uid)",
".validate": "newData.isString() && newData.val().length <= 16"
```

The `auth.uid === $uid` clause lets a user write **arbitrary entries into their
own followers list**, fabricating "victim follows me" with no involvement from
the victim. Edge (a) is a legitimate unilateral "I follow victim" (following is
open by design); edge (c) is the attacker self-publishing. Chain complete →
attacker reads `locations/{victim}` and gets exact lat/lng whenever the victim
has Direct sharing on. `locations/` did not exist in `origin/dev`; this branch
made those forgeable edges load-bearing for precise-GPS confidentiality.

### Why the `auth.uid === $uid` clause exists (and why it can be narrowed)

Audited every writer of `users/*/followers/*` (`js/db/social.ts:212,267,272,318`,
`js/inviteModal.ts`, plus Admin-SDK writers in `functions/` which bypass rules):

- **Follower self-registers / unfollows** — `registerAsFollower`
  (`social.ts:212`) and self-unfollow (`social.ts:267`) write as `$follower`.
- **Code rotation** — `social.ts:318` writes the rotating presence code into
  each target's list at the `$follower` slot (writer is `$follower`).
- **Target removes a follower** (block/revoke) — `social.ts:272` `remove(...)`
  where the target is `$uid`; this is a **delete** (`newData` does not exist).

No legitimate flow ever has the target (`$uid`) **create** a follower entry.
The `auth.uid === $uid` clause is only needed for the target to *delete*.

### The change

`database.rules.json` — `users/$uid/followers/$follower` `.write`:

```diff
- ".write": "auth != null && (auth.uid === $follower || auth.uid === $uid)",
+ ".write": "auth != null && (auth.uid === $follower || (auth.uid === $uid && !newData.exists()))",
```

Post-fix, edge (b) `users/{attacker}/followers/{victim}` can be created **only
by the victim** (`auth.uid === $follower` where `$follower` = victim). The
attacker can no longer forge it, so the mutual-follow the gate checks is real.

Apply the identical narrowing to `followerNames/$follower` `.write`
(`database.rules.json:39`) for consistency — a fabricated display name is not
security-load-bearing, but the same asymmetry should not linger.

### Bot mirror

`functions/telegram.js` (`:485–491`, `:605–611`) re-implements the same gate via
the Admin SDK. It reads the *same* edges, so once forged edges can no longer
exist, the bot gate becomes sound with **no bot code change**. Add a mirror
regression test anyway (below) so a future rule regression is caught on both
surfaces.

### Preserved-flow checklist (must stay green)

- [ ] `registerAsFollower` — create as `$follower` ✓ (`auth.uid === $follower`)
- [ ] self-unfollow — delete as `$follower` ✓
- [ ] target blocks/removes a follower — delete as `$uid` ✓ (`&& !newData.exists()`)
- [ ] code rotation into followers' lists — write as `$follower` ✓

### Tests (TDD — red before green)

`tests/rules/locations.test.js` currently seeds follower edges via the Admin SDK
(bypassing rules), so it never exercised a client self-forging edge (b). Add:

- [ ] **Denies** a client writing `users/{other}/followers/{other}` created by
      `auth.uid` (target-fabricated inbound edge) — the exact forgery.
- [ ] **Denies** the full read exploit end-to-end: attacker writes edge (a) +
      attempts edge (b) + publishes own node → read of `locations/{victim}` is
      denied because edge (b) never lands.
- [ ] **Allows** the four preserved flows above (regression guard).
- [ ] Bot mirror: a `functions/test/telegram.test.js` case asserting `/who`
      precise tier is withheld when only edge (a) exists (no genuine reciprocity).

---

## Fix 2 — Self-join coarse-cell read (#288 widening)

### Root cause

`locationCells/$gid/$uid` `.read` (`database.rules.json:191`) gates on
membership + own-published-cell:

```
root.child('groups').child($gid).child('members').child(auth.uid).exists()
&& root.child('locationCells').child($gid).child(auth.uid).exists()
```

Membership is self-grantable (issue #288): `groups/$gid/members/$uid` `.write`
(`database.rules.json:83`) allows `auth.uid === $uid` with **no** invite/approval
precondition. So: self-join → publish own cell → read every member's ~1 km cell.
The `locationCells` subtree is new on this branch; #288 is pre-existing, but the
feature is what turns membership into a location-read capability.

### The design fork (needs an operator call)

An airtight fix means requiring **invite-backed membership**, but groups are
joined two ways — per-user `pendingInvites` **and** shared invite-link **tokens**
(`groups/$gid/invites/$token`, redeemed by a not-yet-member). A rules-only
predicate can't see "this joiner redeemed a valid, non-revoked token" because the
member write doesn't carry the token.

### Decision: **Option A — Cloud-Function-brokered join** (operator-chosen, 2026-07-19)

Rejected alternatives, kept for the record:
- **B — rules-gated on a `pendingInvites/{uid}/{gid}` marker.** Breaks
  link-token joins (no per-user pending invite) unless redemption first writes a
  marker; partial and needs re-plumbing anyway.
- **C — accept + monitor.** Leans on non-enumerable CSPRNG gids
  (`js/groups.ts:31–37`, 36⁸ keyspace, `groupIdIndex` parent unreadable) to
  bound exposure; leaves self-join readable, unrevocably, by anyone who ever
  learned the gid. Rejected — real residual.

A is the only option that closes the read for an attacker who knows the gid, and
it fixes #288 at the root instead of papering over it.

### Current join flow (what A replaces)

Joins are entirely client-side today — the client writes the member node
directly, so no rule can bind membership to a validated invite:

- **Link/token redeem:** `redeemGroupInvite` (`js/invites.ts`) validates the
  token client-side, bumps `redemptionsUsed` via a client transaction
  (`js/db/groups.ts:210`), then calls `joinGroup`.
- **Pending-invite accept:** `js/inbox.ts:347` calls `joinGroup`.
- **`joinGroup`** (`js/groups.ts:115`) → `writeMember` → `set(groups/{gid}/members/{uid})`
  with the default `statusOverride` seed. This direct member write is the #288
  surface.

### Decided design

**1. New callable `joinGroup`** in `functions/`, mirroring the existing
`resolveInvitePreview` deps pattern (`functions/index.js:211`,
`functions/invites.js`). Register in `functions/index.js` as
`export const joinGroup = httpsOnCall((request) => joinGroupHandler(request, deps))`.
Handler (Admin SDK, bypasses rules) does, atomically, server-side:
  - Authn: reject if `request.auth` is absent.
  - Validate entitlement — **either** a live invite token
    (`groups/{gid}/invites/{token}`: exists ∧ not `revoked` ∧ redemption budget
    remaining) **or** a pending invite for the caller
    (`pendingInvites/{callerUid}/{gid}` exists). Reject otherwise.
  - Write `groups/{gid}/members/{callerUid}` with the default-override seed
    (moved verbatim from client `joinGroup`), **only if** the member doesn't
    already exist (idempotent re-redeem stays a no-op — preserves the current
    `if (!existing)` guard).
  - Bump `redemptionsUsed` server-side (move the transaction off the client so a
    blocked-from-member-write client can't desync the counter).
  - Consume the pending invite / `pendingInvitesByGroup` entry on the
    pending-accept path.
  - Return the result shape the client flows read (mirror
    `redeemGroupInvite`/`inbox` expectations).

**2. Tighten the member `.write` rule.** `database.rules.json:83`,
`groups/$gid/members/$uid`:
```diff
- ".write": "auth != null && (auth.uid === $uid || data.parent().parent().child('ownerId').val() === auth.uid)"
+ ".write": "auth != null && ((auth.uid === $uid && (data.exists() || !newData.exists())) || data.parent().parent().child('ownerId').val() === auth.uid)"
```
The self-branch now permits a write **only** when `data.exists()` (updating an
existing membership) **or** `!newData.exists()` (deleting). The single blocked
case is `!data.exists() && newData.exists()` — self-*create* from nothing, i.e.
the self-join. The callable creates via Admin SDK (rules bypassed), so real
joins still land.

> **Correctness note (supersedes the earlier `&& !newData.exists()` sketch):**
> a bare `!newData.exists()` would have blocked legitimate self-*edits*. Members
> self-write their own node for display-name edits (`setMemberDisplayName`,
> `js/db/groups.ts:147`) and statusOverride toggles (`setStatusOverride` /
> `clearStatusOverride`, `js/db/groups.ts:163–183`) — both update an **existing**
> membership. The `(data.exists() || !newData.exists())` form preserves those.

**3. Rewire clients** to call the callable instead of writing the member node:
`redeemGroupInvite` (`js/invites.ts`) and the pending-accept in
`js/inbox.ts:347`. Client `joinGroup` (`js/groups.ts:115`) loses its
`writeMember` call and the client-side `redemptionsUsed` transaction; it keeps
the local-only bits (`clearGroupPaletteState`, `writeUserGroupsEntry` — both under
the caller's own self-writable tree). Preserve the "skip duplicate reads" opts
and the fresh-vs-existing branch semantics.

### Preserved self-write checklist (must stay green)

- [ ] `setMemberDisplayName` — self update of existing member ✓ (`data.exists()`)
- [ ] `setStatusOverride` / `clearStatusOverride` — self update ✓ (`data.exists()`)
- [ ] `removeMember` self-leave — self delete ✓ (`!newData.exists()`)
- [ ] owner add / owner remove — owner branch ✓
- [ ] **denied:** any client self-*create* of a member node ✓ (the #288 close)

### Tests

- [ ] Rules: **deny** `groups/{gid}/members/{self}` self-*create* from nothing.
- [ ] Rules: **allow** self display-name update + self statusOverride write on an
      existing membership (the regression the `!newData.exists()` sketch broke).
- [ ] Rules: **allow** owner add + self-leave delete — regression guard.
- [ ] Function: `joinGroupHandler` — accepts a valid non-revoked token with
      budget; accepts a caller with a pending invite; **rejects** absent/revoked/
      budget-exhausted token and no-pending-invite; idempotent on re-redeem;
      unauthenticated request rejected.
- [ ] Rules: **deny** `locationCells/{gid}/{member}` read by a forged
      (non-brokered) member — the Finding-2 exploit, now blocked at the join.
- [ ] Bot: `handleWhoGroup` coarse tier withheld for a non-member requester.
- [ ] Client: `redeemGroupInvite` + inbox-accept drive the callable and no longer
      write the member node directly (mock the callable; assert no client
      `set(members/...)`).

---

## Fix 3 — Revoke coarse cell on membership loss (VibeSec lifecycle)

### Root cause

`removeMember` (`js/db/groups.ts:139–143`) already nulls the member record and
`locationCells/{gid}/{uid}` atomically, and the rules' delete carve-out
(`database.rules.json:192`, `|| !newData.exists()`) lets that null pass — so the
in-app leave/remove path revokes the cell correctly today. The gap is that the
**rules don't enforce** it: any membership-null that bypasses `removeMember`
(a future owner-kick that writes only the member node; a console edit) orphans a
cell that stays readable by remaining members, and the departed user can no
longer self-clear it (they've lost membership → lost write). VibeSec's "revoke
all access immediately on removal" argues for a server-authoritative sweep.

### The change

Add a Cloud Function trigger on `groups/{gid}/members/{uid}` deletion that
deletes `locationCells/{gid}/{uid}` via the Admin SDK. Register in
`functions/index.js` alongside the existing `onMemberOverride` / `onInvite`
triggers. This makes cell revocation independent of which client path removed
the member, and is the durable backstop complementing Fix 2 (option A closes the
self-join *read*; Fix 3 guarantees the *cell* is gone on any membership loss).

### Tests

- [ ] Function: deleting a member node fires the trigger and the cell is gone.
- [ ] Function: no-op when the deleted member had no published cell.

---

## Cross-cutting gates (every commit)

- Rules changes are TDD: add the denying test first, watch it fail, then edit
  `database.rules.json`. Trust a red rules test over a "simplification."
- `shared/geo.js` is untouched by these fixes; if any shared code changes, run
  `npm run sync-shared` (never hand-edit `functions/_shared/`).
- Green bar before handoff: `npx jest --maxWorkers=2` · `cd functions &&
  npm test` (return to root!) · `npm run test:rules` · `npm run typecheck &&
  npm run typecheck:scripts`. Never hand off red.
- Deploy surfaces if shipped: RTDB **rules** (Fix 1 + the Fix 2 member-rule
  tightening) + **Functions** (Fix 2 `joinGroup` callable, Fix 3 trigger). Fix 1
  is rules-only. Fix 2 needs rules **and** the callable deployed together — ship
  the callable before (or with) the rule tighten, or in-flight joins break.
- Do not commit/push/merge unprompted; leave staged for the operator's call.

## Suggested sequencing

1. **Fix 1** first — highest severity, smallest/safest change (one rule clause),
   rules-only deploy.
2. **Fix 3** next — small, self-contained, valuable regardless of Fix 2 depth.
3. **Fix 2 (option A)** last — largest blast radius: new `joinGroup` callable +
   member-rule tighten + client rewire, deployed atomically (callable first, or
   with the rule) so no join window breaks.
