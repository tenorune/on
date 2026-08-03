# G9 + G10 — client writes that name a followee who is gone

**Date:** 2026-08-03
**Status:** IMPLEMENTED — G9 by `728180d`, G10 by `4780b1f`. Verification is
jest-only, against the emulator-free client suites (`tests/db.test.js`,
`tests/invites.test.js`) — neither fix has run against a live project.
**Items:** G9 (`docs/operator-panel-followups.md:619`) and G10 (`:663`), both
filed 2026-08-03 by the review that closed out G6's fix wave.
**Predecessor:** `docs/superpowers/specs/2026-08-03-g6-peer-republish-design.md`
— G6's rules guard is load-bearing for G10 and is the source of the predicate
G9 reuses.
**Scope chosen by the operator:** G9 and G10 together, client-side only. No
`database.rules.json` change, no sweep of residue already in a database.

## 1. Problem

Both items are the same shape as G6 and neither is reached by G6's fix: a live
client writes a path that names an account which no longer exists, and nothing
downstream will ever delete it.

**G9 — `rotateCode`'s fan-out** (`js/db/social.ts:359-363`). Rotating a share
code rewrites `users/{T}/followers/{me}` for **every** entry `getFollowing()`
returns, straight from the local cache:

```ts
const updates: Record<string, unknown> = { [`users/${userId}/presence/code`]: newCode };
for (const entry of getFollowing()) {
  updates[`users/${entry.userId}/followers/${userId}`] = newCode;
}
await update(ref(db), updates);
```

An entry for a followee purged, merged or graduated since the cache last synced
is written like any other. That row lands under **T's own subtree**, so it is
not cross-user residue: `crossRefRenderers`
(`functions/telegram-auth.js:443`) does not enumerate it, the G6 spec's §4.1
family table does not cover it, and `integrity.js` has no census for it.
Nothing sweeps it, ever.

It is G6's permanence class made **automatic**. A user rotates their code for
reasons having nothing to do with any followee, and one pass of the fan-out
writes a row for every stale entry the cache is holding.

**G10 — invite redemption** (`js/invites.ts:211-212`). `registerAsFollower`
runs before `setFollowingEntry`:

```ts
await registerAsFollower(creatorUid, redeemerUid, redeemerCode, redeemerName);
await setFollowingEntry(redeemerUid, creatorUid, creatorCode, followLabel);
await incrementInviteRedemptions(creatorUid, token);
```

`redeemPersonalInvite` already reads the creator's `presence/code` at `:201`
and returns `creator-missing` when it is absent (`:202`), so an
already-purged creator never reaches these lines. The window is narrower: the
creator must be purged **between** that read succeeding and `setFollowingEntry`
landing. In it, `registerAsFollower` writes `users/{creator}/followers/{redeemer}`
plus its `followerNames` sibling, and only then does `setFollowingEntry` meet
the G6 guard and get refused — leaving the creator holding a follower row for
someone who is not, and can never become, following them.

### 1.1 A correction to the G10 entry

The followups entry states that "the redemption counter still increments
(`:213`)". **Source says otherwise.** `incrementInviteRedemptions` sits at
`:213`, after the `await` on `setFollowingEntry` at `:212`, so a refused follow
throws before it runs. The residue is the `followers` row and its
`followerNames` sibling, and nothing else. §5 pins this with a test rather than
leaving either reading to inspection.

### 1.2 What is OBSERVED and what is not

Both items were found by **reading**, in the review that closed G6. Neither has
been device-observed, and nothing here re-derives a live sighting. The G6
sighting they are modelled on (dev, 2026-08-02) is real; the inference that
these two paths behave the same way is an argument from the same rules and the
same client, not a second observation.

## 2. Why the fix is client-side only

The obvious mirror of G6 would be a `.validate` on
`users/$uid/followers/$follower` requiring the followee's `presence/code` to
exist. **It was rejected, and the reason is specific to G9's call shape.**

`rotateCode` issues **one atomic root update** carrying the user's own
`presence/code` alongside every follower mirror (`:363`). RTDB refuses the
whole update if any single path fails validation — so one stale cache entry
would stop the user rotating their code **at all**, with no client-side
recovery and no diagnosis available to them. That is a worse defect than the
one being fixed, and it is the same shape as I1, the regression this fix wave's
predecessor introduced and caught in its own final review (`b595dcb`): a guard
that turns a dead referent into a permanently retried, permanently failing
operation.

Adding the rules guard *behind* the client filter does not rescue it either.
The filter makes the guard unreachable for updated clients, so the only
population it would bind is un-updated clients — exactly the population that
would then be unable to rotate a code.

The trade this accepts, stated plainly: **the fix binds only clients that have
updated.** Rules bind every client on deploy and this does not. For G9 that is
the correct trade because the alternative breaks a working feature; for G10 the
rules half already exists — G6's guard is what refuses the write, and this
change only stops a row being written before that refusal arrives.

## 3. G9 — filter the fan-out before building it

Ahead of the code reservation in `rotateCode`:

```ts
const checked = await Promise.all(getFollowing().map(async (entry) => ({
  entry,
  live: await followeeExists(entry.userId).catch(() => true),
})));
const following = checked.filter((c) => c.live).map((c) => c.entry);
```

The fan-out loop then reads `following` instead of calling `getFollowing()`.

Four decisions inside that:

- **The predicate is `followeeExists`** (`js/db/social.ts:330-333`), which reads
  `users/{T}/presence/code` — literally the predicate G6's rules guard uses.
  Reusing the function rather than re-reading the path means the client filter
  and the rules guard cannot drift apart, and the forgeable-predicate reasoning
  in G6's §5 (three non-owner writers can plant `users/{T}`, none can plant
  `presence/code`) carries over without restating it.
- **Placement is before step 1, not between the reservation and the publish.**
  The reservation transacts `codeIndex/{newCode}` and the publish makes it live;
  inserting N network reads into that gap widens the window in which a crash
  orphans a reserved code. Before the reservation, the reads cost nothing but
  latency on an action already behind a deliberate 500 ms fade
  (`js/mycode.ts:87-89`).
  **The consequence, recorded rather than discovered later:** the placement also
  moves the `getFollowing()` snapshot earlier. The old code read the cache at
  fan-out time, *after* the reservation round-trip; it is now read before it. A
  followee added during that round-trip — a concurrent redemption or follow-grant
  on another device — is therefore excluded from the fan-out, so their
  `users/{T}/followers/{me}` mirror keeps the **old** code, which step 4 then
  releases from `codeIndex`. That is the same harm §3.1 argues fail-open exists
  to prevent, arriving through the placement instead. The pre-change window was
  narrower but non-zero, so this widens an existing window rather than opening a
  new class of one, and the reservation is normally a single transaction. The
  trade is deliberate: a wider "followee added mid-rotation" window in exchange
  for a narrower orphaned-`codeIndex` window.
- **Reads are parallel**, and N is the followee count.
- **Zero followees issues zero reads.** `Promise.all([])` resolves immediately,
  so the existing happy-path coverage is untouched.

### 3.1 Fail open on an inconclusive read

`followeeExists` throws on network error by contract ("the caller decides how
to treat an inconclusive read", `:326-329`). Here the caller decides to
**include** the entry.

The two failure directions are not symmetric. Dropping a **live** followee
leaves their `users/{T}/followers/{me}` mirror holding the **old** code: that
contact silently stops resolving, nothing retries, and the user has no signal
that it happened. Including a **dead** one writes a single row that would have
been written anyway before this change. A flaky connection during a rotation
must not cost a real relationship in order to avoid one row of residue.

### 3.2 Not in scope: cleaning up

The filter refuses to add; it does not sweep. A ghost entry reaches the cache
two ways, and neither is healed here:

- *T was purged.* The purge also nulled `userPrefs/{me}/following/{T}`, so the
  local cache is merely stale and `syncFollowingFromServer`
  (`js/following.ts:1085`) replaces it with server truth on the next tick.
- *A dangling `following` entry already in the database.* G6's guard refuses new
  ones and explicitly does not sweep old ones; the cache keeps being
  repopulated from the server, so every later rotation meets the same ghost —
  and, after this change, correctly declines to write for it.

Pruning the local cache would make `rotateCode` mutate store state, which
nothing in the db layer does. Deleting the dangling `following` entry would
make pressing "regenerate" silently remove contacts from the user's own list.
Sweeping residue already in a database remains the operator call G6 left open.

## 4. G10 — swap the two writes

`redeemPersonalInvite`'s two relationship writes (`js/invites.ts`), reordered so
`setFollowingEntry` runs first and `registerAsFollower` second — with the
revocation clear hoisted ahead of both, per §4.1.

The G6 rules guard then detects a creator who vanished after `:201`, and it
refuses **before** anything is written into the creator's subtree. No new read
is introduced: a second existence check could disagree with the guard, and the
guard is the authority.

**A refused write keeps throwing.** It is deliberately not converted into
`{ ok: false, reason: 'creator-missing' }`: this module already draws that
distinction explicitly (the W1 J#1 contract note above `resolveInvitePreview`
— "that invite is dead" and "couldn't check" are different answers), and
reporting a network failure as `creator-missing` would erase it.

### 4.1 The revocation clear moves too

`registerAsFollower` opens by clearing `revocations/{me}/{target}` and only then
sets the followers entry, and its comment names that ordering as load-bearing
against a silent auto-unfollow: the redeemer's own revocation watcher
(`js/following.ts:323-333`) drops from the local following list any uid still
present in `revocations/{me}`, and that key survives every revoke — the watcher
tears down watches but never deletes it.

**That invariant is a property of the call-site ordering, not of
`registerAsFollower`'s internals.** An earlier draft of this section claimed the
swap "does not touch it"; the claim was false. Any caller that establishes the
relationship *before* the clear opens the same window, and hoisting
`setFollowingEntry` — the write that puts the creator **into** the watched list —
ahead of `registerAsFollower` did exactly that. Left uncorrected it reproduces
G10's own asymmetry for a **live** creator: the watcher fires inside the window,
deletes the just-written following entry, `registerAsFollower` then completes,
and `users/{creator}/followers/{redeemer}` survives with no matching follow.

So the redemption path clears the revocation itself, ahead of the refusable
write:

```ts
await clearRevocation(redeemerUid, creatorUid);
await setFollowingEntry(redeemerUid, creatorUid, creatorCode, followLabel);
await registerAsFollower(creatorUid, redeemerUid, redeemerCode, redeemerName);
```

Three things make that safe rather than a trade:

- **The clear is compatible with G10's goal.** It writes only to
  `revocations/{redeemer}/{creator}` — the **redeemer's own** mailbox. A creator
  purged between the `:201` read and these writes leaves the clear with nothing
  to show for it in the creator's subtree, which is the entire property G10
  exists to protect. Running a refusable write after an already-completed clear
  costs nothing.
- **`registerAsFollower`'s internal ordering is preserved by construction, not by
  luck.** The `remove` was extracted into `clearRevocation`
  (`js/db/social.ts`) and `registerAsFollower` now calls it rather than inlining
  the path — so the clear still precedes its followers write on every path, and
  the redemption path's earlier call simply makes the second one an idempotent
  no-op. Extracting rather than hand-copying the path into `js/invites.ts`
  follows the repo's standing rule: a path family reaching a second module is
  the signal to share it.
- **It is pinned by a test, not by this paragraph.** `tests/invites.test.js`
  asserts the clear *resolves* before `setFollowingEntry` is entered, and the
  ordering was verified by planting the violation (clear moved back after
  `setFollowingEntry`) and confirming that test — and only that test — goes red.

Everything else about G10 is unchanged: `setFollowingEntry` still runs before
`registerAsFollower`, no second existence check is introduced, and a refused
write still throws.

### 4.2 What the hoist costs — filed as M11

The hoist is not free, and the cost is recorded rather than discovered later.

Clearing `revocations/{redeemer}/{creator}` ahead of a write that **can be
refused** means a *failed* redemption — creator purged between the
`presence/code` read at `js/invites.ts:201` and `setFollowingEntry` landing —
has already dropped the key. The redeemer's revocation watcher
(`js/following.ts`) prunes a stale `following/{creator}` entry from the local
list off exactly that key, so that cleanup no longer happens for this uid.

The residue is a stale entry in the redeemer's **own** list: visible to them,
and self-correcting on the next successful follow or unfollow of that uid. Set
against the alternatives, the trade is not close — leaving the clear inside
`registerAsFollower` reintroduces the silent auto-unfollow §4.1 exists to
prevent, and reverting the G10 swap re-opens a permanent cross-user write under
an account that no longer exists, which nothing sweeps.

Filed as **M11** in `docs/operator-panel-followups.md` rather than fixed here:
closing it means either having the refusal path restore the key, or having the
watcher prune on a predicate other than the revocation key, and each is its own
change with its own blast radius on the follow lifecycle.

## 5. Testing

**`tests/db.test.js`**, in the existing `rotateCode` describe:

1. a followee whose `presence/code` is absent is **not** in the update payload,
   while the rotating user's own `presence/code` write still is;
2. a live followee **is** in the payload;
3. an existence read that **rejects** leaves its followee in the payload, and
   the rotation completes and returns the new code;
4. zero followees issues no existence read at all;
5. placement — the existence reads **resolve** before the reservation is
   entered. The mock records `begin`/`end` around an awaited tick rather than
   comparing `invocationCallOrder`, because invocation order alone stays green
   under a `Promise.all([<the filter>, <the reservation>])` refactor, which
   violates the placement rule §3 argues for. Resolution ordering catches it.

**`tests/invites.test.js`**:

6. call order — `setFollowingEntry` **resolves** before `registerAsFollower` is
   entered, recorded with the same `begin`/`end` idiom and for the same reason:
   an entry-order assertion survives `Promise.all([setFollowingEntry(…),
   registerAsFollower(…)])`, which re-opens G10 exactly, since
   `registerAsFollower`'s write would be issued before the guard's refusal could
   arrive. (Test 7 below independently catches that refactor too — it was the
   coverage that actually held while this test pinned only entry order.);
7. a rejected `setFollowingEntry` leaves **both** `registerAsFollower` and
   `incrementInviteRedemptions` uncalled — this is also what settles §1.1;
8. §4.1's ordering — `clearRevocation` resolves before `setFollowingEntry`, and
   is called with the redeemer's own uid first;
9. the happy path is unchanged.

Mock implementations in these ordering tests are one-shot
(`mockImplementationOnce`). `jest.clearAllMocks()` does not clear a persistent
`mockImplementation`, so it leaks into every later test in the file — the same
hazard class the mock-rejection follow-up fixed one commit earlier.

**Every guard is verified by planting a violation** — remove the filter,
un-swap the writes, move the revocation clear back after `setFollowingEntry`,
recombine a sequenced pair into a `Promise.all` — and confirming the intended tests go red, per the repo's
standing rule that passing on the first run proves nothing. The related rule
("testing a pure function proves nothing about whether it is wired in") is
satisfied here by construction: both changes are inside the shipped call path
rather than in a new helper, and `js/mycode.ts:87` already drives `rotateCode`
end to end.

No rules test moves: there is no rules change. **M10 is untouched** and stays
open — the G6 rules suite still types its guarded path by hand.

## 6. Deploy surface

**Hosting only.** `js/db/social.ts` and `js/invites.ts` are both client code,
so this rides the same undeployed hosting queue as `8620702`, `8a0ff62`,
`94c9aa6` and `b595dcb`. It adds nothing to the rules surface
(`13cb18c`+`e2dde4e`) and nothing to the functions queue. Nothing deploys from
a session; `docs/DEPLOY-PROD.md` is the runbook.

Until it ships, both items are exactly as open as they are today.

## 7. What this does not close

- **Residue already written.** Every `users/{T}/followers/{me}` row a past
  rotation wrote under a dead T is still there, and nothing enumerates it.
- **The rest of G6's §4.1 family table** — `canvases/{T}_{peer}`,
  `groups/{gid}/members/{T}`, `pendingInvitesByGroup/{gid}/{T}`, and the
  `knocks`/`calls`/`followRequests`/`followGrants`/`pendingInvites`/`revocations`
  mailboxes. Each still needs a human to act on a ghost row before residue can
  form, which is why none was promoted here or in G6.
- **Un-updated clients**, per §2. Both fixes bind on hosting deploy plus client
  update; G10's refusal binds every client already, via the G6 rules guard,
  but the follower row it leaves behind does not.
- **G3**, unchanged and untouched.
