# G6 — a peer's client republishes cross-user residue, permanently

**Date:** 2026-08-03
**Status:** IMPLEMENTED. Rules guard `13cb18c`, client gate `8a0ff62`
(store helpers `8620702`); `f7ac8c7` seeds the followee the new guard caught
`tests/rules/ownership.test.js` missing. Verified against the rules emulator
only (`tests/rules/g6-following-referent.test.js`, 7 cases) — no session has
ever held a service-account credential, and `database.rules.json` is not
deployed by anything in a session. Scope chosen by the operator: G6 alone,
ahead of G3 (see §2).
**Item:** G6 in `docs/operator-panel-followups.md:452`. Sibling: G3 (`:244`).

## 1. Problem

Purging (or graduating, or merging) an account **T** deletes the cross-user
residue T left in other accounts' subtrees. One of those paths is
`userPrefs/{M}/following/{T}`, in peer **M**'s own prefs.

Device-observed on dev 2026-08-02: after a purge whose atomic update included
that path, the path was live again holding a byte-identical value, and
`integrity.js` reported `follow-dangling`. It is permanent — T no longer exists,
so no future purge, unfollow or cascade will ever touch that path again.

The existing entry closes the authorship chain to "M's own client" from five
observations (audit `ok`, the path in the write-set, restore verdict
`already-there`, no Cloud Function writes `following/`, and `userPrefs/$uid` is
owner-only write). This spec adds the missing sixth: **which line of M's client
wrote it, and why.**

## 2. The correction: G6 does not close with G3

`docs/HANDOFF.md` and the G6 entry both say the real fix is G3's — put
`auth.token.auth_time` in `database.rules.json`, and G6 closes with it. **That
does not hold.**

G3's author is the *revoked* account's own client, writing inside its unexpired
ID token's window. A revocation-time gate refuses it.

G6's author is **M — a peer who was never revoked**. M's session is valid, its
refresh token works, its ID token renews hourly forever, and `userPrefs/{M}` is
M's own node. No revocation-time comparison on M's token can refuse that write,
because there is nothing wrong with M's token. G3's fix leaves G6 exactly where
it is.

The two items share a *sighting window* — both were seen in the hour after a
purge — and that is the whole of what they share. G6 is not a symptom of the
token window; it is a client that re-creates a record the server deleted.

**OBSERVED:** the mechanism above, from the rules and the client source.
**UNKNOWN:** nothing here re-measures the 2026-08-02 sighting. That run was not
instrumented, and it is not re-run for this spec.

## 3. The author

`js/following.ts:1068-1073`, in `syncFollowingFromServer` — the callback of the
`watchFollowing` subscription:

```ts
if (serverFollowing.length === 0 && localFollowing.length > 0) {
  for (const entry of localFollowing) {
    setFollowingEntry(myUserId, entry.userId, entry.code, entry.label ?? '').catch(() => {});
  }
  return;
}
```

A local-cache write-back, commented "push local up (migration)". It fires when
the server's list is empty and the device's is not — which is exactly what a
purge of M's **only** followee produces.

Everything below that branch already handles *partial* deletes correctly:
`setFollowing(serverFollowing)` prunes the local list, `teardownFolloweeWatches`
drops the watcher, `renderList()` repaints. Server wins. The empty case is the
one that inverts.

The three other `setFollowingEntry` call sites cannot be the author:

| site | why not |
|---|---|
| `js/following.ts:1140` | inside `subscribePresence`, guarded by `if (!userData) return` — a purged uid has no `users/{T}` record, so it returns before writing |
| `js/following.ts:1355` | label rename, user action |
| `js/following.ts:1520` | explicit follow, user action |

The written value is `{ code, label }` — the shape `getFollowing()` holds in
`localStorage` — which is why the restore's dry run said `already-there`.

**OBSERVED:** this is the only path that writes `userPrefs/{M}/following/{*}`
without a user action.
**UNKNOWN:** that this branch fired in the 2026-08-02 run. Nothing logged it, and
it additionally requires M's list to have gone empty.

## 4. Scope

**In scope.** The `following` family: a rules guard that refuses the write for
any client, and the client change that stops issuing it.

**Out of scope.** G3 (the revocation-time gate) entirely — separate spec,
separate blast radius. Cleaning up dangling entries already in production: this
stops new ones, it does not sweep old ones (`integrity.js`'s `follow-dangling`
is how they are found; the sweep is an operator action).

### 4.1 The family class, with per-family verdict

Every family `crossRefRenderers` (`functions/telegram-auth.js:443`) enumerates,
against who `database.rules.json` permits to write it, and whether any client
writes it with no user action:

| path family | peer may write | automatic writer | verdict |
|---|---|---|---|
| `userPrefs/{peer}/following/{T}` | yes — owner-write | **yes** — `following.ts:1070` | **fixed here** |
| `canvases/{T}_{peer}`, `{peer}_{T}` | yes — `.write` matches either side of the id | no — `setDrawingState` needs the canvas opened (`canvas.ts:737`) | deferred, detection only |
| `groups/{gid}/members/{T}` | yes — owner may write another member's row | no — `writeMember` only ever writes the caller's own row (`groups.ts:56`, `:147`) | deferred |
| `pendingInvitesByGroup/{gid}/{T}` | yes — any member | no — sending an invite is a user action | deferred |
| `knocks|calls|followRequests|followGrants|pendingInvites|revocations/{T}/…` | yes — the counterpart writes the dead uid's mailbox | no — all user actions | deferred |
| `users/{peer}/followers/{T}`, `followerNames/{T}` | **no** — `.validate` requires `auth.uid === $follower` | — | G3's window, not G6 |
| `locations/{T}`, `locationCells/{gid}/{T}` | **no** — owner-only | — | not reachable |

The deferred rows are all "a human would have to act on a ghost row to create
residue" — and §6's local prune is what removes the ghost row. They are recorded
so the next one is not a rediscovery. Promoting one is the same test the
followups doc uses: does it affect the correctness of a destructive write?

## 5. Design part 1 — the rules guard (load-bearing)

Clients in the field do not update on our schedule; rules apply to every client
the moment they deploy. **This half is what closes G6.**

Add to `database.rules.json`, under `userPrefs/$uid`:

```json
"following": {
  "$followee": {
    ".validate": "root.child('users').child($followee).child('presence').child('code').exists()",
    "$field": {
      ".validate": "root.child('users').child($followee).child('presence').child('code').exists()"
    }
  }
}
```

Read: *a follow entry may only name an account that exists.*

Five properties this rests on:

1. **`.validate` is the only enforcement available here.** `userPrefs/$uid`
   grants a blanket self `.write`, and a granted ancestor `.write` cannot be
   revoked by a child `.write` — the landmine at `docs/HANDOFF.md`'s rules entry.
   Same reason `followers`/`followerNames` are guarded with `.validate`.
2. **`.validate` is skipped on delete.** Unfollowing a dangling entry, and the
   purge's own cross-ref null, both keep working. This is required, not
   incidental: a guard that blocked deletes would strand residue permanently by
   itself.
3. **`root` in a rule ignores `.read` rules,** so the lookup works even though
   `users/$uid` is owner-read.
4. **The predicate is `presence/code`, not `users/{T}`.** A bare
   `users/{T}.exists()` is forgeable, and by more than one path — **there are
   three non-owner writers under `users/$uid`, not two**, and any one of them
   creates the `users/{T}` node (M5 in the final review, which found the
   third): `followers/$follower` and `followerNames/$follower` are writable by
   the follower, so a peer's own follower row **creates** the `users/{T}`
   node — `registerAsFollower` runs before `setFollowingEntry` in
   `following.ts:1518-1520` and would satisfy the weak predicate every time —
   and `invites/$token/redemptionsUsed` grants `.write: "auth != null"` to
   **any** signed-in uid, for any `$uid`/`$token` (`database.rules.json:34-38`),
   so redeeming someone else's invite link creates the node with no
   relationship behind it at all. `presence/code` has no such `.write`
   override — the owner-only ancestor rule applies — and both account types
   write it: `initUser` (`js/db/social.ts:26`) and the Telegram bootstrap
   (`functions/telegram-auth.js:150-154`).
5. **`.validate` does not run on ancestors of the written path.** A write at
   `following/{T}/label` would skip a guard placed only at `$followee`; the
   `$field` copy closes that one level. `$field` itself only closes that one
   level too — a write at `following/{T}/label/x`, two levels below the entry,
   would skip both copies, which is why `$field` also carries a `$sub: {
   ".validate": false }` refusing outright anything deeper (M1 in the final
   review; no code writes that deep today, and the node is the writer's own).

**What it does not do.** It does not remove entries already dangling in
production; it refuses *writes*, so a stale entry sits untouched until something
deletes it. It does not stop the peer-writable families in §4.1. It does not
touch anything the Admin SDK does — graduation, merge and expunge bypass rules.

### 5.1 Regression risks

- **A follow issued in the window inside `initUser`.** `initUser` claims
  `codeIndex/{code}` transactionally and *then* writes presence, so for one
  round-trip a code resolves to a uid with no presence record, and a follow
  landing in that window is now refused where it previously succeeded. Reaching
  it requires the follower to type a code the new account has not yet seen on
  its own screen. Judged acceptable; the alternative — swapping the two writes —
  would let a code resolve to an account that failed to claim it, which is worse.
- **A follow of an account whose presence write failed.** Previously succeeded
  and produced a dangling entry; now refused. That is the guard working, but the
  failure is silent (`setFollowingEntry(...).catch(() => {})`, `following.ts:1520`)
  and the row is already in the local list via `addFollowing`. Named in §8 as an
  open question rather than fixed here — surfacing swallowed write failures is a
  change of its own.
- **Updating an existing dangling entry** — a label rename on a contact whose
  account is gone — is refused. Intended.

## 6. Design part 2 — the client (defence in depth, and the ghost row)

Gate the push-up on evidence that this device has **never** seen a server list
for this account:

- A new `localStorage` key, `statusapp_following_server_seen`, holding **the uid**
  it applies to (matching the `statusapp_*` convention in `js/store.ts:2-8`).
  Storing the uid rather than a boolean makes it self-invalidating on an identity
  switch.
- Set it in `syncFollowingFromServer` on any tick where
  `serverFollowing.length > 0`.
- Push up only when `serverFollowing.length === 0 && localFollowing.length > 0
  && stored !== myUserId`. Otherwise fall through to the existing path, which
  prunes the local list, tears down watchers and repaints.

This fires for a device that never migrated, and for no other. M's device — list
non-empty for months before the purge — carries the uid and prunes.

Chosen over deleting the branch or freezing it, on user-visible behaviour:

| situation | gate (chosen) | delete the branch | freeze |
|---|---|---|---|
| never-migrated device | contacts reach the server, as today | **whole contact list disappears, silently and possibly for good** | contacts stay on one device, invisible on every other |
| G6: only contact purged | ghost row disappears | same | a contact that can never be available sits there until removed by hand |
| unfollowed everyone elsewhere | converges | same | the two devices disagree forever |
| first follow's write was swallowed | repaired next tick — but only for a device that has never seen a server list. For an established device whose server list had gone empty (unfollowed everyone), the entry is pruned on the next tick instead: silently indistinguishable from rows 2-3's dead-entry and convergence cases, which need the exact same "empty server list is trusted" read to work (M3, final review) — not a new failure mode, the accepted cost of the other two | follow silently did not take | contact never reaches the server |

If `localStorage` is unavailable, the flag reads absent, the push-up fires, and
the rules guard refuses it. Degrades to noise, not residue — which is the point
of ordering the two halves this way.

## 7. Verification

**Rules, `tests/rules/` (emulator, `npm run test:rules`).** New cases:

1. peer writes `userPrefs/M/following/T` with `users/T/presence/code` present → **allowed**
2. same write with `users/T` absent → **denied**
3. same write with `users/T` present but holding only `followers/M` (the forgeable
   shape from §5 property 4) → **denied**
4. delete of an existing dangling entry → **allowed** (validate skipped on delete)
5. write at `following/T/label` with `users/T` absent → **denied** (pins `$field`)
6. an unrelated `userPrefs/M` update (`notifyChannel`) while a dangling entry
   exists elsewhere in the tree → **allowed** (validate covers written data only)
7. a non-owner writing `userPrefs/M/following/T` → still **denied** (unchanged)

**Client, `tests/following.test.js` (jsdom).** Empty server tick with local
entries and no stored uid → pushes up; with the stored uid → prunes, no write;
non-empty tick → sets the key; partial delete → unchanged from today.

**The wiring, not just the units.** Per the standing landmine — testing a pure
function proves nothing about whether it is wired in — case 2 must also be
exercised through `setFollowingEntry` itself, and the client gate through the
`watchFollowing` callback, not by calling the branch directly. Plant a violation
in each half and confirm it goes red before believing either.

**What cannot be verified in this container.** No session has ever held a
service-account credential, so no run here touches a real project. The emulator
is the rules engine's stand-in, not production. A live re-sighting of G6 is not
reproducible on demand and is not attempted.

## 8. Open questions

- **Swallowed write failures.** Every `setFollowingEntry` call site discards its
  rejection. With the guard in place, a refused follow now looks to the user like
  a follow that worked and then vanished on the next device. Worth its own item;
  not fixed here.
- **Existing dangling entries in production.** Unknown count. `integrity.js`'s
  `follow-dangling` enumerates them; whether to sweep them, and with what, is an
  operator call after the guard lands.
- **Deploy ordering.** Rules deploy independently of hosting and functions and
  bind every client immediately. Land the emulator suite green first; the client
  half can follow at any time, in either order.

## 9. Follow-ups this spec creates

- `docs/operator-panel-followups.md:452` (G6) and `docs/HANDOFF.md` both assert
  "close G3 and G6 closes with it". Both need correcting per §2 — G6 gets its own
  mechanism, its own author, and stops being described as having no mitigation.
- G3's entry keeps its own framing; nothing here changes its measurements or its
  standing mitigation (close the account's clients before purging).
