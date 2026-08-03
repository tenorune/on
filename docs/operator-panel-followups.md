# Operator control panel — open items after the build

Distilled from the implementation session's review ledger (2026-08-01). The
panel itself is built and reviewed; `functions/ops/README.md` is the runbook and
`docs/HANDOFF.md` is the general on-ramp. This file exists so the findings that
were *deliberately deferred* survive the session that found them — nothing here
blocks the *branch*, and nothing here is a surprise. One item (**S1**) does block
pointing the panel at production data; the rest do not block anything.

Nothing in this list was discovered by guesswork: each item came out of a
task-scoped review, the final whole-branch review, or an adversarial probe, and
each was ruled on rather than dropped.

---

## Everything still open, at a glance

Fourteen open, seven closed. **G8 is the newest closed item** — found on
2026-08-03 by running the residue recipe, and closed the same day. **G9, G10
and M10 are the newest open items** — filed 2026-08-03 by the review that
closed out G6's fix wave, from reading rather than from running the smoke
test; see their entries below and in "Deferred minors judged fine to leave".
**S1 is closed** — the smoke test ran to completion
across 2026-08-02 and 2026-08-03, all ten steps — so nothing here blocks pointing
the panel at production data any more. **M9 is closed** too, and it was never
really a minor: it was the one entry that could drive a bad destructive write,
and closing it was the first thing the completed smoke test made urgent. The rest
are ranked by whether anything downstream depends on them. IDs are stable — cite
them rather than re-describing the item. **R1-R4 are closed** (`c1b2cf9`) and
detailed under "Parked residuals" below; their IDs are retired, not reused.
**G2 is closed** too, and stays in the table with its reasoning because *why*
the deferral was wrong is the useful part. **G4, G5, G6 and G7 are new**
(2026-08-02) and all four came out of *running* the smoke test rather than out of
a review. G5 and G7 are real defects in shipped production code that four reviews
and a full green bar had walked past; both were found by the panel's integrity
report, not by the residue sweep, and both have the same shape — a wholesale
parent null destroys a record and strands the global key that resolves to it.
**G6 is now closed too** (`13cb18c`+`8a0ff62`) — it stays in the table, like
G2/G5/G7, because *why* "closes with G3" survived in this file and in
`docs/HANDOFF.md` is the useful part: it doesn't, and never did — see below.

| ID | Item | Where | Weight |
|---|---|---|---|
| **S1** | ~~The manual dev-project smoke test~~ | whole panel | **CLOSED** — all ten steps pass; see below for the two variants it did not cover |
| **G1** | Divergence check compares paths, not write values | `ops/merge.js:212-213` | Known gap, bounded |
| **G2** | ~~Auth-record deletion has no route (D5)~~ | `ops/server.js` | **CLOSED** — the deferral was wrong; see below |
| **G3** | Revoked sessions keep writing for up to an hour | `database.rules.json` | Known gap, **whole-app** |
| **G4** | A pre-image cannot undo a cascade the purge only triggered | `ops/audit.js` (model, not a bug) | Known gap, bounded; mitigated |
| **G5** | ~~Expunge and graduation stranded `pushTokens/{uid}`~~ | `functions/telegram-auth.js` | **CLOSED** — F6c relocated the node and the deletion path never followed |
| **G6** | ~~A peer's client republishes cross-user residue, permanently~~ | `database.rules.json` + `js/following.ts` | **CLOSED** (`13cb18c`+`8a0ff62`) — does NOT close with G3; see below |
| **G7** | ~~Expunge stranded `groupIdIndex` + group-scoped `inviteIndex`~~ | `functions/telegram-auth.js` | **CLOSED** — indexes pointing into a wholesale-deleted group |
| **G8** | ~~Purge refused any account with no Auth record~~ | `ops/server.js:720` | **CLOSED** — it refused the safest case, and blocked the G3/G6 mitigation |
| **G9** | `rotateCode`'s fan-out re-creates a followers row for a purged followee | `js/db/social.ts:359-363` | Known gap, whole-app; same permanence class as G6, and the more serious of the three filed alongside it |
| **G10** | Invite redemption can leave an asymmetric follower row for a vanished creator | `js/invites.ts:211-212` | Known gap, narrow |
| **M1** | Snapshot type collapses "absent" and "empty" | `ops/types.d.ts:26-38` | Minor |
| **M2** | Detail lookup builds and sorts every row to find one | `ops/project.js:69` | Minor |
| **M3** | Canvas-key split inlined rather than shared | `ops/integrity.js:190` | Minor |
| **M4** | Non-`EEXIST` rethrow untested | `ops/audit.js:167` | Minor |
| **M5** | Audit filename retry loop has no attempt cap | `ops/audit.js:181-189` | Minor |
| **M6** | Approvals have no TTL, and detail-view overwrites a pending one | `ops/server.js:359,385` | Minor |
| **M7** | Production banner does not name the project inline | `ops/server.js:690-692` | Minor |
| **M8** | `adoptGroupNames` is unreachable from the browser | `ops/panel.html:207,228` | Minor |
| **M9** | ~~`restore-preimage.js` has no guard on the dump's `op`~~ | `ops/restore-preimage.js` | **CLOSED** — the one entry here that could drive a bad destructive write |
| **M10** | The G6 rules test types the guarded path by hand, untied to what `setFollowingEntry` writes | `tests/rules/g6-following-referent.test.js:22` | Minor |

**Standing constraints, not work items** — these are decisions, and nothing is
owed against them: the panel is single-operator by construction (approvals are
per-uid and in memory, so two operators do not share them), and it requires
Linux/macOS or WSL (the audit dump fsyncs its directory, which throws `EISDIR`
on Windows — a portable skip would silently downgrade durability on the one
platform nothing exercises).

**Shipped since this file was written:** the `locations`/`locationCells`
enumerator follow-up (`4dea508`), the link-write fold (`16e5ae9`), and all four
parked residuals R1-R4 (`c1b2cf9`). None is owed any more.

---

## Owed before the panel is pointed at production data

**Nothing.** All three items are done: items 2 and 3 shipped on 2026-08-01
(`4dea508`, `16e5ae9`), and S1 closed on 2026-08-03.

1. **S1 — the manual dev-project smoke test — CLOSED (2026-08-02 / 2026-08-03).**
   All ten steps pass against the dev project. `deps.js`, `panel.html` in a real
   browser and the `Host`/`Origin` guard — the panel's *sole* authentication
   boundary, on a server holding full database admin with no login — are no
   longer unexercised.

   **Step 9's purge side** closed across three runs on 2026-08-02, the last with
   the Auth-record box ticked and probed either side, and a residue sweep
   reporting `swept: 4`, all empty, including an owned group's whole
   `locationCells/{gid}` with another member's cell inside it.

   **Step 9's merge leg** closed on 2026-08-03: one plain merge on a fixture
   seeded by `ops/seed-merge-fixture.js`, **57 of 57** read-back claims holding
   under `ops/verify-merge.js`, the preview's conflicts and losses read before
   executing, and an `ok` line in `.ops-audit/audit.jsonl`.

   **Link via merge** — the panel's non-lossy link — ran the same day on its own
   `--telegram` fixture: **65 of 65** claims, covering all of `buildLinkWrites`
   including the prefs side, where `telegram-prefs-disagree` and
   `telegram-channel-unroutable` (both integrity ERRORS) live.

   **Plain merge of a Telegram-linked loser** — the last unexercised merge path —
   ran the same day on tag `tdn1`: **61 of 61** claims under
   `ops/verify-merge.js --telegram`, no `--repoint`. That is
   `merge.js:385-394`'s `buildMappingTeardown` branch, the *opposite* branch of
   the same `if` link-via-merge takes (`:351`), so it needed its own run — there
   the mapping must come **down** rather than repoint, or it points at a uid that
   no longer exists and the next Mini App open bootstraps onto it. Integrity was
   clean either side (one `auth-missing` INFO per seeded uid before, nothing above
   INFO after) and the audit log carried an `ok` line.

   **And the teardown's other four mapping holders ran the same day**, on the
   `--mapping-shape` flag added for them: `third-party` 62/62, `no-uid` 62/62,
   `absent` 61/61, `survivor` 61/61. Three are REFUSALS, where the mapping must
   survive and the preview must say so — the property R2 exists to protect, since
   a wrong delete here unlinks an account the operation was never touching.
   **Every live merge path and every teardown branch has now been seen**; each
   was seen once, on one fixture, which is observed rather than proven.

   The checklist and the filled results table are in
   `docs/operator-panel-smoke-test.md`. Running it produced: three new tools
   (`ops/restore-preimage.js` with its residue sweep, plus
   `ops/seed-merge-fixture.js` and `ops/verify-merge.js`), one gap that is a
   property of the model (**G4**), one that had no mitigation at the time
   (**G6** — since closed; see its entry below), two real
   defects in shipped production code (**G5**, **G7**), the `inviteIndex` shape
   fix, and one defect in the leg's own verifier (`2dec78c`). Every one of them
   came from *running* it. None came from a review.

2. ~~**The `locations`/`locationCells` enumerator follow-up.**~~ Done in
   `4dea508`, all four parts in one change. Both families and the
   unjoined-invite `pendingInvitesByGroup` entries are in `crossRefRenderers`;
   the local handling is out of `merge.js` and `purge.js`; the owned-group case
   was decided (null `locationCells/{gid}` wholesale, symmetric with the
   `pendingInvitesByGroup/{gid}` null already in the owned-group block); the
   merge/purge asymmetry is gone because the enumerator is now handed the
   `pendingInvites` mailbox. Live expunge and graduation behaviour changed, so
   the coverage went into `functions/test/crossref-locations.test.js` rather
   than into `telegram-auth.test.js`, whose 0-line diff still holds.

3. ~~**Fold the shipped copy of the link-write block.**~~ Done in `16e5ae9` —
   but **not the way this file described it**. Making `performLink` import
   `functions/ops/link-write.js` is undeployable: `functions.ignore` excludes
   `ops/**`, so the deployed function would die at cold start on a missing
   module while every repo-side test stayed green. The builder moved to
   `functions/telegram-link-write.js` instead; `performLink` calls it, keeping
   only the branch the builder cannot express (expunging a Telegram-derived
   prior holder, passed as `ownUids` so the builder skips its reset). The
   parity test became a tautology — it compared the builder against a
   `performLink` that now calls it — and was rewritten to assert literal
   expected write-sets. `tests/firebaseConfig.test.js` now pins the deploy
   surface per file.

---

## Known gaps, with the reasoning

### ~~`crossRefRenderers` does not enumerate location data~~ — CLOSED (`4dea508`)

Kept because the reasoning still explains the shape of the fix. The enumerator
now emits `locations/{u}`, `locationCells/{gid}/{u}` per member gid, and
`pendingInvitesByGroup/{gid}/{u}` for gids read from the account's own
`pendingInvites/{uid}` mailbox. All four parts landed together.

Two decisions worth not re-deriving:

- **The owned-group case** is handled by nulling `locationCells/{gid}`
  wholesale in `buildExpungeWrites`' owned-group block, not by enumerating
  co-members. The group is being deleted, so its entire cell node is dead, and
  this is exactly symmetric with the `pendingInvitesByGroup/{gid}` null that
  already sat there. `rootUpdate` drops the enumerator's per-uid nulls beneath
  it as redundant deletes. The alternative — relying on the `onMemberWritten`
  trigger to revoke each cell as the ancestor delete removes each member — was
  rejected: whether RTDB fires wildcard child triggers on an ancestor delete
  was never established, and a cleanup invisible to the preview is not a
  cleanup the operator approved.
- **New families are appended after the existing ones** in the renderer list,
  so the graduation walker's move order — which its consumed-source dedup
  depends on for the self-follow canvas case — is bit-for-bit unchanged.

Live expunge and graduation behaviour DID change (expunge now deletes a
location fix; graduation moves it), so the coverage lives in
`functions/test/crossref-locations.test.js`. `telegram-auth.test.js` was not
touched and its 0-line diff still holds.

### G1 — the preview/execute divergence check compares paths, not values

Execute re-reads the database and refuses if the plan diverged from the one
previewed. The comparison covers paths, losses and conflicts — **not write
values**. The one case this misses, constructed during review: if a loser's
group `role` flips `member` → `owner` between preview and execute *without*
`ownerId` changing, the path set, losses and conflicts are all identical, the
refusal does not fire, and the survivor silently gains ownership of a shared
group.

Bounded on purpose: that value is never displayed in the preview, so the
operator is not misled about anything they read, and the pre-image dump captures
the prior value, so it is recoverable.

### Operational shape

The first two are **standing constraints** — decisions, with nothing owed
against them. Only the third is an open item.

- **Single-operator by construction.** Approvals are per-uid and held in memory;
  two people running the panel at once do not share approval state.
- **Platform.** The audit dump fsyncs its containing directory, which throws
  `EISDIR` on Windows. Documented as a requirement (Linux/macOS, or WSL) rather
  than skipped, because a portable skip would silently downgrade durability on
  the one platform nothing here exercises. It fails closed with a named cause.
- **G2 — the deferral was WRONG, and S1 proved it.** This entry sat under
  "standing constraints" on the reading that a surviving Auth record is inert
  leftovers — a tidiness item worth a checkbox one day. It is not. It is what
  keeps the purged account's session alive.

  Observed on dev, 2026-08-02, during the first real step 9: a purge correctly
  deleted `userPrefs/{uid}` — the path was in the plan, the pre-image proves it,
  `rootUpdate` could not have pruned it, and `audit.jsonl` says `ok` — and the
  account's still-signed-in client put the node straight back with its cached
  `following` keys and none of its other fields. Only a session authenticated as
  that uid may write there (`database.rules.json`), and that session survived
  because purge never touched the Auth record. The rules also let it write
  `users/{peer}/followers/{uid}` and `followerNames`, so a live client can undo
  the *cross-user* cleanup too, not just its own account.

  Closed by revoking the account's refresh tokens **before** the write, refusing
  the purge outright if that fails, plus an opt-in `deleteAuthRecord` flag for
  the record itself — off by default, because it is the one destruction no
  pre-image can undo.

  **Verified against dev, 2026-08-02** (`ops/verify-auth-delete.js`), and the
  result narrows what the fix claims. `deleteUser` works on a custom-token uid —
  the original deferral's question — but neither call does as much as the name
  suggests:

  - Revocation does not evict a live session. Timed: writes still landed 33 min
    after the revoke, were refused by 66, bracketing the ID token's own one-hour
    expiry. The window runs from the client's last open, not from the revoke, so
    a client opened just before a purge has nearly an hour to undo it. Closing
    it properly needs `auth.token.auth_time` in `database.rules.json` — a
    whole-app change, not a panel one.
  - Deleting the record does not retire the uid. Telegram uids are derived
    deterministically and the app mints a fresh custom token on every open, so
    reopening produced a new Auth record under the same uid.

  So the honest claim is narrow: **a client already open at purge time cannot
  republish its cache.** Closing the account's clients before executing remains
  the only reliable mitigation, and it is now step 9's stated precondition. The
  underlying rules gap is tracked separately as **G3**.

- **G3 — a revoked session keeps writing for up to an hour.** Fell out of
  closing G2, and it is NOT a panel item: `database.rules.json` never checks
  `auth.token.auth_time`, so an ID token already in the client's hands is
  honoured until it expires no matter what the Admin SDK was told. Measured on
  dev, 2026-08-02: writes still landed 33 minutes after `revokeRefreshTokens`
  and were refused by 66, bracketing the token's own one-hour expiry. The window
  runs from the client's last open, so revoking sooner does not shorten it.

  **Why it is not fixed here.** The fix is a rules change — record a revocation
  time per uid and compare `auth.token.auth_time` against it on every write — and
  that touches every write path in the app, not the panel's. It also needs a
  place to store the revocation time that the rules can read, and a decision
  about what happens to a client mid-session when its token is rejected. That is
  its own piece of work with its own blast radius, and bolting it onto an
  operator-tool branch would be the wrong place to get it wrong.

  **What holds in the meantime:** close the account's clients before purging
  (smoke-test step 9). That is stated wherever the purge is described — README,
  the panel's own confirm dialog, and the smoke test — rather than left as
  folklore. Anyone picking G3 up should start from the measurement above rather
  than re-deriving it.

  The general lesson is worth more than the item: a deferral is only as good as
  the reading it rests on, and this one had never been in front of live data.

### G4 — a pre-image cannot undo a cascade the purge only triggered

Found by actually restoring an account, 2026-08-02 (smoke-test step 10), not by
review. It is a property of the audit model rather than a bug in it, which is
why it is written down instead of fixed.

**The dump is the purge's write-set.** Everything the purge deleted is in it and
comes back. But a purge also *causes* deletions it never writes, and those are
invisible to the dump — nothing captured them, so nothing can replay them.

The live case, device-observed: purging a group's OWNER nulls `groups/{gid}`
wholesale (`buildExpungeWrites`' owned-group block). Every other member's client
then deletes its own `users/{member}/groups/{gid}` enumeration entry, because
the group's meta went null and **an owner has no permission to clear another
user's record** — `js/groupNav.ts:250-258` and `js/groupContext.ts:1499-1508`
both do it, deliberately. The purge never touched those paths, so they were
never in the write-set, so they are not in the pre-image. Restore the group and
it comes back real, with its member list intact, and **invisible in every other
member's nav**: the owner sees the members, the members do not see the group.
`integrity.js:103` already reports that state as `group-enumeration-missing` at
error severity, which is the fastest way to spot it.

**Mitigated, not closed.** `ops/restore-preimage.js --heal-group-enumeration`
rebuilds those entries from the *restored* member list — derived repair, labelled
as such in its output, never presented as recovery. It writes `true` (the
default shape, `js/db/groups.ts:23-26`) only where no entry exists, so a member
who still has one keeps their `lastVisited`. Device-verified 2026-08-02.

**What is still open** is the general shape: this is the cascade we know about.
Any future client-side "the thing I was watching disappeared, clean up after
myself" reaction has the same property. Two candidates for whoever picks this
up: teach the purge preview to *name* the cascades it will trigger, so an
operator sees them before approving; or have the pre-image capture them, which
means the panel has to model client behaviour and is probably the wrong trade.
Naming them is the cheaper half and would have turned this from a discovery
into a line of preview text.

### G5 — expunge and graduation stranded `pushTokens/{uid}` — CLOSED

Found on dev 2026-08-02, during the second run at smoke-test step 9. Kept here
because *how it survived every review* is the useful part.

**What was wrong.** `buildExpungeWrites` nulled two own-account nodes,
`users/{uid}` and `userPrefs/{uid}`. Push tokens used to live *inside* the
second one, at `userPrefs/{uid}/pushTokens`, so the wholesale null destroyed
them for free and nothing named them. **F6c relocated them** to a top-level
owner-only `pushTokens/{uid}` node — so `watchUserPrefs` would stop downloading
them on every boot — and the deletion path never followed. `graduateAccountData`
had the same hole from the same cause: it copies `users`/`userPrefs` wholesale,
so the tokens used to ride along inside the prefs subtree, and afterwards they
did not.

Two consequences, both confirmed against source before the fix:

* every purge left `pushTokens/{uid}` under a uid with no user record — **and
  not only in the panel**, since production's `performLink` calls
  `expungeDerivedAccount` on a standalone derived account
  (`telegram-auth.js:210`);
* a graduated account's devices stayed registered to the *old* uid and the new
  one had no `pushTokens` node at all. Pre-migration accounts were masked by
  `notifier.js:55`'s legacy `userPrefs/{uid}/pushTokens` fallback, which is
  exactly the kind of accident that hides a bug until the migration completes.

**Why the reviews missed it.** The HANDOFF landmine for F6c says relocating a
watched path means sweeping every **reader**, and that sweep was done properly —
it found three (`notifier.js`, `functions/telegram.js`, `js/notifyChannel.ts`),
all dual-reading. Nobody swept the **deleter**. The rule as written names the
wrong half of the problem: a relocated node needs its writers, readers *and*
its delete/move paths swept.

**Why no amount of smoke-testing step 9 would have found it either.**
`pushTokens/{uid}` was not in the purge's write-set, so it was not in the
pre-image dump, so the residue sweep is structurally blind to it — that is
**G4's boundary**, printed by the tool itself. `integrity.js:187`'s
`push-tokens-dangling` is what surfaced it, which is the division of labour
working as designed: the sweep audits what the purge wrote, the integrity report
is the cross-account census.

**Fixed** by adding `pushTokens/{uid}` to the expunge null-set beside
`users`/`userPrefs`, and moving it old→new in graduation. Deliberately **not**
routed through `crossRefRenderers`, despite that enumerator being the standing
home for "a new residue family": it renders paths under *other* users' subtrees,
and this is the account's own top-level node. Coverage in
`functions/test/expunge-push-tokens.test.js` — its own file, so
`telegram-auth.test.js` keeps the 0-line diff that pins the
`expungeDerivedAccount` split.

**The follow-up this left — now DONE.** `integrity.js` was the only thing that
would have caught G5, and it only catches families someone thought to add to it.
`functions/test/expunge-completeness.test.js` is the guard that closes that:
it reads the top-level node list out of `database.rules.json` — the canonical
inventory, since the root `$other` denies anything unlisted — and requires every
node to be classified into exactly one of four buckets, then asserts that every
own-account node really is nulled at `{node}/{uid}`.

The classification is explicit rather than inferred from the wildcard name,
because those names do not discriminate: the uid-keyed mailboxes are spelled
`$recipient`, `$target`, `$invitee`, `$revoked` and `$requester`, so a heuristic
keyed on `$uid` would have skipped five of them — the same blind spot the guard
exists to close.

It is a guard, so passing on the first run proves nothing. Verified by planting
three violations and confirming each is named in the failure: a new unclassified
top-level node (`deviceSessions`), the G5 regression itself (the
`pushTokens/{uid}` null removed), and a stale classification entry naming a node
the rules file no longer has. Same discipline the `ops/**` import guard needed
after its first version passed against a planted violation.

**What it still cannot see:** anything below the top level. The group-scoped
`ownerUid` case at the end of G7 is exactly that shape — a stale field inside a
record that resolves fine — and no top-level inventory will catch it.

### G7 — expunge stranded the indexes pointing into a deleted group — CLOSED

Found on dev 2026-08-02 by the integrity report, in the same run as G6:
`group-id-index-dangling` on both groups the purged account owned, and
`invite-index-dangling` on two tokens issued in them. **Same shape as G5** — a
wholesale parent null destroys a record and strands the global key that resolves
to it — and the same blind spot: neither path was in the write-set, so the
pre-image residue sweep could not see them (G4's boundary).

**`groupIdIndex/{gid}`** is a bare `true` existence lock, keyed by the same gid
as `groups/{gid}` (`js/db/groups.ts:12-21`), claimed transactionally at creation
and released nowhere. `grep` found **zero** references to it anywhere in
`functions/`. Left behind, it outlives the group permanently and **burns that
group code**: allocation can never reclaim it.

**`inviteIndex/{token}`** is `{scope, ownerPath, ownerUid}`
(`js/db/social.ts:44-54`), and `ownerPath` is **either**
`users/{uid}/invites/{token}` **or** `groups/{gid}/invites/{token}`.
`buildExpungeWrites` only ever enumerated the first, from the account's own
`users/{uid}/invites` — so a group-scoped token was structurally invisible to it.
When the owned group is nulled wholesale the invite records die and their index
entries survive, resolving to nothing.

**Fixed** in the owned-group block, which now also nulls `groupIdIndex/{gid}` and
every `inviteIndex/{token}` found under `groups/{gid}/invites` — **including
tokens a different member issued**, since the records die with the group either
way. Exactly the reasoning already applied to `locationCells/{gid}`, which also
takes other members' rows.

Two deliberate non-changes:

* **A group owned by someone else keeps both.** The group survives, so its lock
  and its invite records still resolve. Only groups being deleted release them.
* **Graduation needs nothing.** `groupIdIndex` carries no uid, and a graduated
  account's owned groups are not deleted.

**Found while checking this, and fixed after it — `inviteIndex` had drifted to
THREE shapes across three writers:**

| Writer | Was | Preview worked? |
| --- | --- | --- |
| `claimInviteToken` (`js/db/social.ts:44-54`) | `{scope, ownerPath, ownerUid}` | yes — this is the schema |
| `ops/merge.js:256` | `{ownerPath, ownerUid}` | **no** — `scope` missing |
| `graduateAccountData:539-541` | `newUid`, a bare **string** | **no**, and it violates `database.rules.json:56` |

`resolveInvitePreviewHandler` (`functions/invites.js:27,35`) branches on
`index.scope` and returns `{ preview: null }` for anything else, so both broken
shapes silently killed the invite's welcome-screen framing while the token itself
kept resolving. Graduation's also broke the rules' own invariant — it landed only
because the Admin SDK bypasses validation — and stranded `ownerUid` at the dead
uid, which gates index DELETION (`database.rules.json:55`), so the graduated
account could never release its own token.

The bare-uid line was `codeIndex/{code} = newUid` from the line directly above,
copied onto an index with a different shape. Both writers now emit the full
`{scope, ownerPath, ownerUid}`; `scope` is `personal` by construction in both,
since each reads the account's *own* `invites` node and group-scoped tokens live
under `groups/{gid}/invites`.

⚠️ Fixing graduation required changing **one assertion** in
`functions/test/telegram-auth.test.js`, which had been pinning the malformed
write — the first break in that file's 0-line diff, done deliberately and
recorded in `docs/HANDOFF.md`. New coverage is in
`functions/test/graduate-invite-index.test.js`.

**Still open, and it is the same question G5 left:** nothing enumerates the
group-scoped tokens an account created in groups it does *not* own. Their
`ownerUid` still names the dead uid after a purge or graduation, so nobody can
release them. Not dangling — the records resolve — so the integrity report will
not flag it.

### G6 — a PEER's client republishes cross-user residue, permanently — CLOSED

Device-observed on dev 2026-08-02, during the second step-9 run. **This is a
whole-app gap, a sibling of G3 — not a panel item.** It no longer lacks a
mitigation (below), but the entry originally on file here said the mitigation
was G3's. That was wrong; see "The correction" below.

**What happened.** A purge nulled `userPrefs/{M}/following/{T}` as part of its
36-path atomic update. Afterwards the path was live again, holding the captured
value. The integrity report flagged it as `follow-dangling`.

**Why it is not an enumerator bug.** Five observations close the chain:

1. the audit log recorded `outcome: ok`, 72 ms after capture — the update landed;
2. the path was among the 36 in the write-set (`.preImage` keys confirm it);
3. the restore's dry run returned **`already-there`** — the live value is
   *byte-identical* to the pre-purge capture;
4. **no Cloud Function writes `following/`** — all five references in
   `functions/` are `getVal` reads;
5. `userPrefs/$uid` is **owner-only write** (`database.rules.json:6`).

4 and 5 leave exactly one possible author: **M's own client**, replaying its
cached `{code, label}` inside the G3 token window. `crossRefRenderers` rendered
the path correctly and the purge deleted it correctly.

**Why it is worse than G3 as written.** G3 says revoked sessions keep writing for
up to an hour, which reads as a problem that expires with the window. This one
does not. The purged account's own republish lands in nodes belonging to a uid
that no longer exists — ugly but self-contained. A *peer's* republish is
**permanent**: `userPrefs/{M}/following/{T}` now points at a dead uid, and
nothing will ever remove it. T is gone, so no future purge, unfollow or cascade
touches that path again. The window is when the damage is written; the damage
does not expire.

**And the documented mitigation does not reach it.** "Close the account's clients
before purging" is achievable. "Close every peer's client" is not — not on dev,
and certainly not in production, where `performLink` runs the same expunge with
no operator present at all.

**Relationship to G4.** Same mechanism, opposite sign. G4 is a purge causing
peers to DELETE things (`users/{member}/groups/{gid}`); G6 is a purge causing
peers to RE-CREATE things. The group case has a client-side cleanup path, which
is exactly what makes it G4; the follow case has none, which is what makes G6
permanent.

**The author, named.** `js/following.ts`'s `syncFollowingFromServer` — the
callback of the `watchFollowing` subscription — carries an empty-server
migration branch (`:1068-1073`) that pushes every local `following` entry back
up via `setFollowingEntry` whenever the server's list is empty and the
device's is not. It writes `{ code, label }`, the exact shape `getFollowing()`
holds in `localStorage`, which is why the restore's dry run reported
`already-there`: the republished value is byte-identical to what the purge had
just deleted, because it is the same cache writing itself back. The other
three `setFollowingEntry` call sites are ruled out: `:1140` sits inside
`subscribePresence`, guarded by `if (!userData) return`, so a purged `T` with
no `users/{T}` record left returns before it ever writes; `:1355` (a label
rename) and `:1520` (an explicit follow) are both user actions, not automatic
republish.

**The correction: G6 does not close with G3.** This entry and
`docs/HANDOFF.md` both said the real fix was G3's — put
`auth.token.auth_time` in `database.rules.json` and G6 closes with it. **That
does not hold.** G3's author is the *revoked* account's own client, writing
inside its unexpired ID token's window; a revocation-time gate refuses that.
G6's author is **M — a peer whose session was never revoked.** M's refresh
token works, M's ID token renews hourly forever, and `userPrefs/{M}` is M's own
owner-only node. No revocation-time comparison on M's token can refuse that
write, because there is nothing wrong with M's token. The two items share a
*sighting window* — both surfaced in the hour after the same purge — and that
is the whole of what they share. Full reasoning:
`docs/superpowers/specs/2026-08-03-g6-peer-republish-design.md`, §2-3.

**The fix, both halves.** `database.rules.json` now guards
`userPrefs/$uid/following/$followee`:

```json
".validate": "root.child('users').child($followee).child('presence').child('code').exists()"
```

Read: *a follow entry may only name an account that exists.* The predicate is
`presence/code`, not `users/{T}` — a bare `users/{T}.exists()` would be
forgeable, because `users/$uid/followers/$follower` is writable by the
follower, so a peer's own follower row creates the `users/{T}` node before any
presence write ever lands. `presence/code` carries no such override; the
owner-only ancestor rule on `users/$uid` applies to it untouched. That half
closes G6 for every client, including ones nobody can update — rules bind on
deploy, not on client update. The second half is defence in depth:
`js/following.ts`'s `syncFollowingFromServer` now gates the push-up on
`hasSeenServerFollowing`/`markServerFollowingSeen` (`js/store.ts`), so it fires
only for a device that has never seen a server list for this account; if
`localStorage` is unavailable the gate degrades to noise (the guard refuses
the write) rather than residue. `13cb18c` (the rules guard) + `f7ac8c7` (which
also caught `tests/rules/ownership.test.js` writing a `following` entry for a
uid it never seeded — the new guard's first catch) + `8620702` (the store
helpers) + `8a0ff62` (the client gate). Verified against
`tests/rules/g6-following-referent.test.js` (7 cases) on the **rules emulator
only** — no session here has ever held a service-account credential, and
`database.rules.json` is not deployed by anything in a session, so this closes
the emulator-verified gap, not a live-verified one.

**What remains open.** The rest of §4.1's peer-writable family table in the
design spec — `canvases/{T}_{peer}`, `groups/{gid}/members/{T}`,
`pendingInvitesByGroup/{gid}/{T}`, and the
`knocks`/`calls`/`followRequests`/`followGrants`/`pendingInvites`/`revocations`
mailboxes — is deliberately untouched: unlike `following`'s automatic
republish, each of those needs a human to act on a ghost row before residue
can form, so none is promoted here. And dangling entries already sitting in
production are untouched too — the guard refuses new writes, it does not
sweep old ones. `integrity.js`'s `follow-dangling` still enumerates them, and
`ops/restore-preimage.js`'s `PEER REPUBLISH` block (`0f31553`+) still
attributes one on sight; sweeping them is an operator call, not made here.

### G8 — purge refused any account with no Auth record — CLOSED

Found on dev 2026-08-03, while running the residue-sweep recipe: purging a
seeded fixture account failed with `There is no user record corresponding to the
provided identifier.` and wrote nothing.

**What was wrong.** `server.js:720` called `auth.revokeRefreshTokens(uid)`
unguarded, ahead of the destructive write. Firebase Auth throws
`auth/user-not-found` for a uid it has never seen, so the purge aborted — and it
aborted on the **safest possible case**: no Auth record means no session, so
there is nothing to outlive the write and nothing to republish a cache. The
guard existed to stop a purge that *cannot* end a live session; it also stopped
every purge that had no session to end.

**Why it mattered more than it looked.** Every account
`ops/seed-merge-fixture.js` writes is RTDB-only — that is the whole point of the
synthetic-fixture pattern, and it is **the one documented mitigation for G3 and
G6**. So the panel could not purge exactly the accounts the runbook tells you to
seed, and the recipe for observing the residue sweep's `present` branch was
unrunnable. Every live purge in the smoke test used an app-born account, which
is why nine months of green tests and a completed smoke test never met it.

**Why no test caught it.** No session container has ever held a service-account
credential, so nothing in a session reaches the Auth path at all; the route's
tests stubbed `revokeRefreshTokens` as succeeding, because that is what it does
for an account that exists. The stub was right about the case it modelled and
silent about the one nobody had thought of.

**Closed** by an allowlist of one code, the same shape as `opGuard`:
`auth/user-not-found` proceeds and returns a `sessionNote` naming what happened;
**every other failure still refuses**, because that is the G2 case and unchanged.
`readAuthIdentity` (`server.js:520-529`) already applied this principle to the
Auth *delete* — "already absent is not a failure" — so the fix made the revoke
agree with its own neighbour. Two consequences handled with it: ticking the
Auth-delete box on such an account no longer calls `deleteUser` on a record that
was never there (it would have warned about failing to delete nothing), and
`panel.html` surfaces the note rather than dropping it. Verified by planting
three violations — an allowlist removed, the refusal restored, and the panel line
deleted — which turn 2, 16 and 1 tests red respectively.

**The general lesson**, which outlives the bug: a fail-closed guard needs to say
what the benign absence is. "Refuse unless the dangerous thing succeeded" and
"refuse unless the dangerous thing was possible" read identically in code and
differ completely in effect.

### G9 — `rotateCode`'s fan-out re-creates a followers row for a purged followee

Filed 2026-08-03 by the G6 fix-wave review (final-review finding M4). Found by
reading, not by running the smoke test — **UNKNOWN** whether this has been
device-observed; nothing here re-derives a live sighting.

`js/db/social.ts:359-363`, `rotateCode`'s code-rotation fan-out (line numbers as
of this fix wave — `followeeExists`, added just above by finding I1, shifted
this block down by twelve lines from where the review found it at `:347-351`):

```ts
const updates: Record<string, unknown> = { [`users/${userId}/presence/code`]: newCode };
for (const entry of getFollowing()) {
  updates[`users/${entry.userId}/followers/${userId}`] = newCode;
}
await update(ref(db), updates);
```

It rewrites `users/{T}/followers/{me}` for **every** cached followee, including
one that has been purged, merged or graduated since the cache was last pruned.
That write lands under **T's own subtree** — a dead account's own residue, not a
cross-user one — so it is invisible to `crossRefRenderers`
(`functions/telegram-auth.js:443`) and outside the spec's §4.1 family table,
which is scoped to what that enumerator covers. Nothing will ever sweep it.

**This is the most serious of the three items filed alongside it (G10, M10
below).** It is the same permanence class as G6 — a live client writing a path
that names a dead uid, and nothing downstream ever deletes it — except automatic
rather than user-driven: a user rotates their code once, for reasons unrelated
to any particular followee, and the fan-out hits every cached entry in one pass,
ghost rows included. The client-side prune (`syncFollowingFromServer`) makes it
unlikely in practice — a ghost row normally disappears from the local cache on
the next tick, before the next rotation — but an offline or stale device can
still hold a dead entry across a code rotation.

**Why not fixed here.** Out of scope for the G6 branch, whose §4.1 table was
deliberately scoped to `crossRefRenderers` families (residue in *peers'*
subtrees), and this is a client writing back into the *purged account's own*
subtree — a question that table never asks. Filed as its own item rather than
folded into G6 because the fix (skip a followee whose `presence/code` is gone,
mirroring the guard's own predicate) touches a different function with a
different call shape (a fan-out `update()`, not a single `setFollowingEntry`),
and deserves its own review rather than riding in on this one's diff.

### G10 — invite redemption can leave an asymmetric follower row for a vanished creator

Filed 2026-08-03 by the G6 fix-wave review (final-review finding M2). Same
scope note as G9: found by reading, not device-observed.

`js/invites.ts:211-212`: `registerAsFollower` runs **before** the now-refusable
`setFollowingEntry` in the invite-redemption path. `redeemInvite` already reads
the creator's `presence/code` at `:201` and bails out with `creator-missing` if
it is absent (`:202`), so an already-purged creator is caught before either
write runs — the window this opens is narrower than that: the creator must be
purged **between** that read succeeding and `setFollowingEntry`'s write landing,
a few awaits later in the same function. In that window,
`registerAsFollower` (`:211`) still succeeds — the creator keeps a
`followers/{redeemer}` row for someone who is not, and can never become,
following them — the redemption counter still increments (`:213`), and only
then does `setFollowingEntry` (`:212`, run before the counter increment but
after `registerAsFollower`) hit the rules guard and get refused. The redeemer
ends up with no entry in their own `following` list, but the creator's
`users/{creator}/followers` node carries a phantom relationship.

Narrower than G9: it requires a purge landing in the brief window between one
read and two writes inside a single async function, rather than firing on an
ordinary user action (a code rotation) against an already-stale cache. Noted
beside **I1** in the final review (a `js/followRequests.ts` finding fixed on
this branch) because both are instances of the same shape — a write ordered
before the now-refusable `setFollowingEntry` runs to completion regardless of
it.

**Why not fixed here.** Filed rather than fixed per the final review's own
ruling: reordering `js/invites.ts`'s two writes (or gating the first on the
same existence check I1 added) is a small, independent change with its own
blast radius on the invite-redemption path, and bundling it into this fix wave
would mean touching a third client call site's ordering without the review
cycle the other two got.

## Parked residuals — ALL FOUR CLOSED (`c1b2cf9`)

Kept for the reasoning. Each was real, each was ruled non-blocking, and none was
load-bearing — which is exactly why they survived two follow-ups without being
fixed, and why they are recorded here rather than quietly dropped.

| ID | Where | What it was | How it was closed |
|---|---|---|---|
| **R1** | `ops/merge.js` | The `telegram-relink` conflict was raised unconditionally *before* the mapping teardown was folded in, so when the teardown refused, the operator saw two conflicts on the same `tgId` saying opposite things — "its mapping is dropped" beside "left untouched". | The conflict is now raised only when the teardown actually produced the delete, conditioned on the same `writes[...] === null` check the loss line already used. A refusal now stands alone. |
| **R2** | `telegram-link-write.js` | `buildMappingTeardown` took no `ownUids`, so a mapping held by a merge's LOSER was refused as though it belonged to an uninvolved third party — and the refusal promised "the forward mapping stays with its owner, whose Telegram keeps working" while the caller nulled `users/{loser}` moments later. False in exactly that case. | The teardown takes `ownUids` (like `buildLinkWrites` always did) and tears down a mapping held by an account the operation is already destroying. A holder outside `owner` + `ownUids` is still refused — pinned by a test at both the builder and merge levels. |
| **R3** | `ops/audit.js` | The `fsyncDir` catch branch — the one behaviour added in the final fix wave — had no test. | Two tests: the raised error names the platform requirement, and it carries the original fs error as `cause`. **The branch was already correct**; this was missing coverage, not a defect, and both tests passed on first run. |
| **R4** | `ops/purge.js` | The production-link plan asserted a stale forward mapping was "left pointing at {phraseUid}" as fact, but that ownership was *inferred* from the reverse index and never read — and the reverse index is precisely what `telegram-mapping-asymmetric` exists to flag. | The plan now `readMapping`s the stale `tgId` and names the real holder, distinguishing "already gone" from "a mapping node carrying no uid" from a named third party. |

R2 is the only one that changed behaviour rather than words. It is confined to
the ops panel: `buildMappingTeardown` lives in a shipped file but shipped
`performLink` does not call it — only `ops/merge.js` and `ops/purge.js` do, and
only merge passes `ownUids`.

---

## Why the enumerator rule exists

`crossRefRenderers` is the one place cross-user residue paths are enumerated.
Expunge and graduation drifted apart once before over `followerNames`, which is
why it was extracted. **A new residue family goes there, never in a consumer.**

This same shape — one concept transcribed into several places — was the source
of three separate defects during this build: the mailbox list, the canvas field
list, and the Telegram link-write block. The last one was the serious one: the
mapping write existed in three hand-written copies that had already diverged
three ways, and two of them deleted a forward mapping **without checking who
owned it**. Because `telegramUsers` is keyed by Telegram id rather than uid, and
the integrity report raises `telegram-mapping-asymmetric` at error severity for
exactly that state, the tool could have destroyed an uninvolved live account
while reporting it had destroyed the target's. Fixed by the shared builder plus
an executing parity test.

If you find yourself copying a path family into a second module, that is the
signal to extract it instead.

---

## Deferred minors judged fine to leave

Recorded so nobody re-derives them. **None affects the correctness of a
destructive write** — that is the shared reason M1-M8 were deferred, and it is
the test to re-apply if you are tempted to promote one. They are listed
individually because a paragraph of nine clauses is not a list anyone can act
on or check off. **M10 is new** (2026-08-03, filed by the G6 fix-wave review) —
outside `ops/` like G9 and G10 above, but the same test applies: it is a test's
own wiring gap, not a destructive write's correctness.

⚠️ **M9 never passed that test — it was the one entry here that could drive a bad
destructive write, and it is now CLOSED.** It is kept below because *why it was
mis-filed* is the useful part: it was recorded as a minor because that was the
namespace it arrived in, not because anyone judged it one, and the row said so
rather than letting the section heading stand as a verdict.

| ID | Where | What | Why it was left |
|---|---|---|---|
| **M1** | `ops/types.d.ts:26-38` | Snapshot nodes are typed `Record<string, any>` and never optional, so "the node is absent" and "the node is present but empty" are the same type. | Consumers do not trust the type here — they use a runtime key-count check. Tightening it would be a type-level improvement over code that already guards at runtime. |
| **M2** | `ops/project.js:69` | The detail lookup calls `buildRows(...)` — which builds and sorts *every* row — and then `.find()`s the one uid it wants. | O(n log n) for a single-account read, on an operator tool with one user and an account list that fits in memory. Real, and invisible at this scale. |
| **M3** | `ops/integrity.js:190` | The canvas-key split (`key.split('_')`) is written inline rather than taken from the shared helper. | It is the read-only report module: a wrong split misreports, it cannot mis-delete. The shared-helper rule earns its severity from write paths. |
| **M4** | `ops/audit.js:167` | The non-`EEXIST` rethrow has no test, though the fs is trivially mockable. | Fails closed with a named cause. Same family as R3 below, which is the one worth doing first. |
| **M5** | `ops/audit.js:181-189` | The filename-collision retry is `for (;;)` with no attempt cap — it appends `-2`, `-3`, … indefinitely. | It terminates as soon as one name is free, and the loop only spins on genuine collisions in a directory one operator writes to. A cap would be cheap insurance rather than a fix. |
| **M6** | `ops/server.js:359,385` | Approvals live in a `Map` with no TTL, and `GET /api/detail` issues a nonce through the same `approvals.set(uid, …)` that previews use — so opening a detail view **overwrites a pending approval** for that uid. | It fails toward refusal, never toward an unapproved write: the overwriting nonce carries `approved: null`, so an execute against it is rejected and the operator previews again. Annoying, not dangerous. |
| **M7** | `ops/server.js:690-692` | The production banner does not name the project inline. | The startup line immediately above it does (`project=<id>`). Duplication, not absence. |
| **M8** | `ops/panel.html:207,228` | `adoptGroupNames` is accepted by `server.js:623` and implemented by `merge.js:229-231`, but **`panel.html` never sends it** — both merge buttons post only `{loserUid, survivorUid}` (+`telegramRepoint`). So a `group-member-collision` previewed from the browser always resolves *"survivor's record kept"*, and the loser's per-group `displayName` can never be adopted without POSTing the route by hand. | It fails toward the conservative resolution: the survivor's own record is what survives, which is the safe half of the choice, and the preview states that resolution honestly rather than promising an adoption that will not happen. A capability gap, not a correctness one. Worth knowing when reading the merge leg's results — it is why the per-group name **carry** has to come from a group only the loser is in (`merge.js:220-221`), which is what `ops/merge-fixture.js` seeds. |
| **M9** — **CLOSED** | `ops/restore-preimage.js` (`opGuard`) | The dump was read for `preImage` and its `op` printed but never checked. Every judgement in that module rests on **"a purge NULLED every path in its write-set"** (`:204`) — true for a purge, false for a merge, whose write-set is mostly non-null *carries* onto the survivor. So the verdicts, the `RESIDUE SWEEP` and the `PEER REPUBLISH` block were all built on an assumption that does not hold for a merge dump, and the `restore` verdict on the paths the merge *did* null would **partially resurrect the merged-away account**. A restore's own dump has the mirror problem: it holds the PRE-restore state, so replaying it undoes the restore. | **Closed** by `opGuard`. It is an **allowlist** — an absent, empty or unrecognised `op` is refused rather than assumed to be a purge, because the assumption *is* the risk. It fires on a **dry run** too: the dry run writes nothing, but its verdicts and its sweep are the misleading part, and `jq` reads a dump of any shape without pretending to interpret it. The override is `--i-know-this-is-not-a-purge`, named so it cannot be typed by reflex, and it prints what it is overriding. Deferring stopped being tenable on 2026-08-03, when the merge leg put a real merge dump in `.ops-audit/` beside the purge dumps, one tab-complete from the familiar command. Verified by planting two violations (an always-ok guard, and the allowlist turned into a denylist) **and** by running the CLI against fabricated merge / purge / no-`op` dumps — tests on the pure function prove nothing about the wiring, which is the mistake the `ops/**` import guard made twice. |
| **M10** | `tests/rules/g6-following-referent.test.js:22` | The G6 rules suite's guarded path (`userPrefs/M/following/T`) is typed by hand in the test, with nothing tying it to the path `js/db/social.ts:287`'s `setFollowingEntry` actually writes. The design spec's §7 asked for that specific case to be "exercised through `setFollowingEntry` itself" — the client half honoured the equivalent requirement (through the `watchFollowing` callback), the rules half did not. | Today the two agree, verified by inspection, and the rules suite is green. But a refactor of that one line in `js/db/social.ts` would leave the guard sitting on a path nothing writes, with the suite still green and nobody told. Filed (final-review finding M6) rather than fixed on this branch: closing it means adding a jest assertion on the ref path `setFollowingEntry` itself builds, which is a client-side (jest) addition to a rules-emulator suite and deserves its own small review rather than riding in on this wave's rules/client split. |

**One review-method note worth keeping:** grepping for `as any` alone is
insufficient — `/** @type {any} */` is the same escape hatch in JSDoc and slipped
past two reviews. Sweep for `as any`, `@ts-ignore`, `@ts-expect-error`,
`@type {any}`, `{any}`, `: any`, `<any>`, and read each hit rather than trusting
the count.
