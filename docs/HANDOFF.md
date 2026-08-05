# KnockKnock — Session Handoff

> Forward-first. History lives in git, `docs/superpowers/plans/`, and `docs/archive/`.
> Prior handoffs (TS adoption + client-performance era) are archived at
> `docs/archive/HANDOFF-2026-07-17.md` — read only if you need that backstory.

## What this is

KnockKnock — a vanilla-TypeScript + Firebase (Hosting / RTDB / Cloud Functions) PWA
for ambient presence. Repo `tenorune/on`, working dir `/home/user/on`.

## What's next

**START HERE: nothing is owed, and nothing on the ledger is unruled.** The three
items that were unruled — **M13, M14 and M15** — were **put to the operator,
ruled DO, and built on 2026-08-05**. The live smoke test of everything closed
since the last one is **COMPLETE**: `docs/smoke-test-2026-08-04.md`, every step
run against the dev project across 2026-08-04/05. Parts A, B, C and E pass;
Part D passes except D5a, which is partial *by nature* rather than for want of
running (see below).

**What is open:**

| | |
|---|---|
| **G1, M1, M2, M6, M7** | **WON'T FIX**, ruled 2026-08-03. Raise it before working one, not after. |
| **G3 / #302** | **Parked**, and needs the operator's explicit in-session go-ahead — see the standing rule directly below. |

So the honest reading is unchanged from the last handoff, and closing three
items did not change it: **there is nothing on the ledger a session may start
on its own.** If that leaves the choice empty, the answer is to ask, not to
pick the biggest item. An emptier ledger is not a larger licence — it is the
normal state of this repo.

**What the three closures shipped** (full entries, including what each
deliberately does not claim, in `docs/operator-panel-followups.md`):

- **M13** — route **(b)**. `buildMergeAssertions` takes `adopt`; `verify-merge.js`
  takes `--adopt`. An adopted merge no longer reports a false `1 of 57`, and a
  failing run names that shape as a cause to rule out. The stale pre-M8
  rationale turned out to live at **four** sites, not the one the ledger named.
- **M14** — **both** halves. Seeded codes are upper-cased so they satisfy SEC-1,
  and a new guard derives the charset **from `database.rules.json`** instead of
  restating it. ⚠️ **This changes every seeded code and every code `--clean`
  nulls** — a fixture seeded by an older build must be cleaned by that build.
- **M15** — route **(a)**. The panel's column reads **`auth created`** and says
  on hover why it can disagree with the account's data. Route (b) had no field
  to show: there is no RTDB-derived per-account created time, and adding one
  means two deployed surfaces.

⚠️ **The generalisation worth carrying, from M13:** the ledger's own promotion
test — *does it affect the correctness of a destructive write?* — said **no**,
and the operator promoted it anyway on the `2dec78c` precedent. That test is the
default, not a ceiling: **the thing that certifies a destructive write counts
too.** A verifier that cries wolf on a correct write is worse than no verifier,
because the operator's next move is to hunt a defect that is not there.

**What the smoke test settled**, if you read nothing else about it — four items
stopped being jest-and-emulator-only:

- **SEC-6**'s revoke is **observed live on both routes and both sides** — the
  account being removed is revoked, the survivor is not. Its own roadmap entry
  had marked it UNVERIFIED-LIVE.
- **RTDB's all-or-nothing multi-path update** — the single assumption both
  **G10** and **M11** rest on — is confirmed against the real project, not just
  the rules emulator (step D5b).
- **M4**'s non-`EEXIST` rethrow ran on a real filesystem; every prior test drove
  a mock.
- **G4**'s cascade block and **M8**'s adopt tick were driven in a browser
  against live data for the first time.

**What it could NOT settle, and never will:** G10's reorder and M11's atomicity
only fire in a race window between `getCreatorCode`'s read of
`users/{C}/presence/code` and the write landing — a purged creator bails at
`creator-missing` first. Not hand-reachable; jest and the emulator are the right
level for them. That is recorded at D5, not a gap to re-derive.

🛑 **G3/#302 IS NOT AVAILABLE WORK. DO NOT START IT WITHOUT THE OPERATOR'S
EXPLICIT GO-AHEAD — no session, ever, for any reason.** It is the largest open
item in this repo and it reads like the obvious thing to pick up. That is
exactly the trap: being unruled is NOT permission. (As of 2026-08-05 it is not
even the only unruled item — M13, M14 and M15 are too — and that changes
nothing here.)
The go-ahead has to be given in the session, in the operator's own words, for
G3 specifically. Absent that, G3 is not a candidate — not to spec, not to
probe, not to "just look at what it would take". If you have read this far
looking for something to do, **G3 is not it**; go ask.

This is a standing rule, not a status line. It does not lapse when the ledger
empties, and nothing that happens to the other items promotes G3 into scope.
A session that finds nothing else to do is finished, not cleared to start G3.

**It has already happened once (2026-08-04).** A session opened with "nothing
is owed, you are choosing new work", read this file, found G3 the only unruled
item, and went straight to spec-and-probe on it without ever putting the choice
to the operator — stopped by the operator, not by the docs. Nothing was
committed and no repo file changed, but that is luck, not process. The wording
that recruited it was an earlier version of this very section, which called G3
"the largest real piece of work available". It is not available. That is why
this block is worded the way it is.

What it is, for reference only: RTDB rules never check `auth.token.auth_time`,
so a revoked session keeps writing until its ID token expires (measured on dev:
writes landing 33 min after the revoke, refused by 66). Every destructive route
in the operator panel now revokes, which bounds that window but cannot close it
— only the rules can. If the go-ahead is given, start from the measurement in
the followups doc, not from folklore.

**Branch status (2026-08-05, LATEST): `claude/knockknock-unruled-decisions-ak3gaa`
MERGED TO `dev` AND PUSHED, at the operator's explicit instruction.** Cut from
`origin/dev` at `59f1a51`, which had not moved when the merge was made. Four
commits — `2d35ef4` (**M13**), `20adac1` (**M14**), `b4574a4` (**M15**), and the
docs commit carrying this file, the ledger and the runbook — plus a `--no-ff`
merge commit matching `dev`'s own history; a fast-forward was available and
deliberately not taken. `dev` → `main` is the maintainer's; no PR was opened and
none was asked for. Working tree clean, nothing unpushed. The feature branch is
now fully contained in `dev` and is redundant — kept, not deleted, like its
predecessors.

⚠️ **The merge was made from a temporary branch at `origin/dev`, NOT by checking
out local `dev`.** Local `dev` is a shallow-clone artifact (see the landmine
below) and merging into it would have produced garbage. `git push origin
HEAD:dev` is the shape to reuse; local `dev` was left untouched.

⚠️ **That push fired `deploy-dev.yml` and it SHIPPED NOTHING.** Both halves
matter. The run at `a1d04e8` completed **success** (2026-08-05T23:19Z), because
CI deploys `hosting,database,functions` on every push to `dev` with no gate —
but every file in the merge is docs, `functions/ops/**` or `functions/test/**`.
Every file is under
`functions/ops/**` (excluded from the functions archive via `functions.ignore`),
`functions/test/**`, or `docs/**`. `database.rules.json`, `js/`, `.github/` and
the shipped `functions/*.js` are untouched — verified by filename before
committing, not inferred. Do not generalise that to the next merge: a push to
`dev` still fires `deploy-dev.yml` ungated, and it would ship whatever a
different change happens to touch.

**Prior branch status (2026-08-05): `claude/knockknock-dev-setup-u2cpr8`
MERGED TO `dev` AND PUSHED TWICE, at the operator's explicit instruction.**
`origin/dev` moved `c42cd94` → `a2b8c2d` (the smoke-test page, M13/M14), then
`a2b8c2d` → `38e4bc2` (the live results, M15, the SEC-6 roadmap correction).
Both are `--no-ff` merge commits matching `dev`'s own history; a fast-forward
was available each time and deliberately not taken. Working tree clean, nothing
unpushed, the branch fully contained in `dev` and now redundant — kept, not
deleted, like its predecessors. `dev` → `main` is the maintainer's; no PR was
opened and none was asked for.

⚠️ **Both pushes fired `deploy-dev.yml` and shipped NOTHING.** Every file in
both merges is under `docs/**`. `database.rules.json`, `functions/**`, `js/**`
and `.github/**` are untouched — verified by filename before each merge, not
inferred. Do not generalise that to the next merge.

### The security audit, for reference only

`docs/security-audit-2026-08-04-roadmap.md` is the source of truth and it stays
readable after closure by design — the *reasoning* is the reusable part. Two
things from it are worth carrying forward even if you never open it:

- **Four of its eight prescriptions were wrong** (SEC-4, SEC-5, SEC-7, SEC-8),
  each recorded in its own entry. The generalization, written down there: a
  prescription authored before its dependency was implemented describes the
  world *without* that dependency. Re-derive against the code you find. This is
  the single most useful thing that document now contains.
- **SEC-1 and SEC-4 were the only two that touched a deployed artifact**
  (`database.rules.json`, `functions/telegram-shared.js`); both are live on the
  dev project and gated on prod. Everything else was `ops/**` or docs, which
  ride no deploy.

**G3/#302 was not worked on by the SEC series and stays parked.** SEC-6 gave
merge and "link as production" the revoke purge already had, so those legs now
sit under G3's bounded window instead of an unbounded one — that is what put
them under G3, not any change to the rules. Do not read it as folding SEC-6
into #302: SEC-6 was the *absence* of a revoke, #302 is an issued token
*outliving* one.

---

### History — skip unless relevant

The build queue that preceded the audit: all six items ruled on 2026-08-03 —
G4, M12, M5, M4, M3, M8 — built, verified and merged to `dev` (`aa7322b`), which
the security-audit merges sit on top of. Kept as a record of what shipped, not
as work. Each row names what to read before starting it:

| | | |
|---|---|---|
| ~~**G4**~~ | ~~name the cascades the purge preview will trigger~~ — **DONE, `33d89ae`**: `plan.cascades` on all four destructive previews, compared preview-to-execute | the FIRST of that entry's two candidates was the one built — **not** the pre-image one |
| ~~**M12**~~ | ~~tie the G6 `presence/code` predicate to `followeeExists`~~ — **DONE**: a jest guard derives the node path from the rules `.validate` and pins `followeeExists` to it | the `shared/` constant route was NOT taken — the rules file is JSON and cannot import |
| ~~**M8**~~ | ~~make `adoptGroupNames` reachable from the browser~~ — **DONE**: a tick per colliding group, and ticking re-previews | driven in a real browser against canned responses; the harness is uncommitted |
| ~~**M5**~~ | ~~cap the audit filename-collision retry~~ — **DONE**: 100 attempts, then a refusal naming the cause | rode one commit with M4, as planned |
| ~~**M4**~~ | ~~test the non-`EEXIST` rethrow~~ — **DONE**: two cases, plus one for an error with no `code` at all | the branch was already correct; the tests were the item |
| ~~**M3**~~ | ~~take the canvas-key split from the shared helper~~ — **DONE**: `canvasUids` in `ops/project.js`, plus a guard against a fourth copy | the JOIN stays in `ops/merge.js`; the round trip between the two is pinned instead |

**WON'T FIX: G1, M1, M2, M6, M7.** Ruled, with the reason restated on each — not
open questions. Raise it before working one, not after.

**G3 IS PARKED** as [#302](https://github.com/tenorune/on/issues/302) —
spec-first work, not started, deliberately outside that queue. Picking it up is
**the operator's decision, not a session's** — it needs their explicit
go-ahead, and without one G3 is out of scope no matter how empty the queue is.

**THE SMOKE TEST IS COMPLETE. All ten steps of
`docs/operator-panel-smoke-test.md` pass, and S1 is CLOSED** — so nothing blocks
pointing the panel at production data any more. **No operator run is owed.**

**THE OPERATOR-FACING LIST IS EMPTY.** Every live merge path, every branch of
`buildMappingTeardown`, and both of the panel's last never-seen renderings ran on
dev across 2026-08-02/03. Nothing on `docs/operator-panel-smoke-test.md` is
unexercised, and no operator run is owed.

**G6 is CLOSED (`13cb18c`+`8a0ff62`), and G3 stands alone.** This section used
to read "G3 and G6 are the same fix — close G3 and G6 closes with it." That
was wrong, and so was "G6 has no mitigation": G3's author is the *revoked*
account's own client, writing inside its unexpired ID token's window, and a
revocation-time gate refuses that. G6's author is a **peer** — M, whose
session was never revoked, whose ID token renews hourly forever, writing its
own owner-only node (`userPrefs/{M}/following/{T}`). No revocation-time
comparison on M's token could ever have refused that write. The two items
share only a *sighting window*, not a mechanism. G6 got its own fix instead: a
`database.rules.json` `.validate` on `userPrefs/$uid/following/$followee`
requiring `presence/code` to exist (not `users/{T}` — that predicate is
forgeable, see the landmines below), plus a client-side gate in
`js/following.ts` that stops issuing the republish once a device has seen a
server list. Full reasoning:
`docs/superpowers/specs/2026-08-03-g6-peer-republish-design.md`;
`docs/operator-panel-followups.md`'s G6 entry carries the same correction.
**Verified against the rules emulator only** — nothing here was *exercised*
against a live project. It is nonetheless **deployed to the dev project**: the
merge to `dev` shipped `database.rules.json` via
`.github/workflows/deploy-dev.yml`. It is the fourth prod-undeployed behaviour
change (see the branch-status note below). Deployed is not verified, and
undeployed-to-prod is not undeployed — keep the two apart.

**G3 IS PARKED AS [#302](https://github.com/tenorune/on/issues/302)
(2026-08-03), so NO BUILD WORK IS OWED ON THIS REPO AT ALL.** It is spec-first
work that has not been started — no spec, no branch, no code. The section below
describes what it *is*, not something in flight;
`docs/operator-panel-followups.md`'s G3 entry stays the ledger of record and
the issue is its tracking half. 🛑 **And parked does not mean pick-up-able: G3
requires the operator's explicit go-ahead, every time, in-session.**

**What is left is G3, alone.** `database.rules.json` never checks
`auth.token.auth_time`, so a revoked session keeps writing for up to an hour
(**G3**, measured: writes landing 33 min after the revoke, refused by 66).
That is a spec-first piece of work, not an afternoon: it needs a rules-readable
place to store a per-uid revocation time, a decision about what a mid-session
client does when its token is refused, and it touches every write path in the
app. **If and when the operator green-lights #302, start with a spec, not
code** — the measurements are already in `docs/operator-panel-followups.md`, so
don't re-derive them. "If and when" is load-bearing: **the go-ahead is the
operator's to give and has not been given.** Reading this paragraph is not it.

⚠️ **THE QUEUE IS CLOSED AND MERGED — DO NOT RE-OPEN IT.** All six items are
built and on `dev` at `aa7322b`: **G4** (`33d89ae`, the purge preview names its
cascades — the first of its two candidates, not the second), **M12**
(`f730f34`, the rules predicate and `followeeExists` tied by a test that derives
one from the other), **M5 + M4** (`f7fa67d`, one commit as the queue planned),
**M3** (`787f6be`) and **M8** (`17945c3`). Their entries in
`docs/operator-panel-followups.md` carry what shipped, what each deliberately
does not claim, and the planted violations behind them.
**WON'T FIX: G1, M1, M2,
M6, M7** — ruled, not open questions; raise it before working one, not after.
**G3 is parked** as #302 and is not part of that queue. Nothing in the queue is
unruled, so a session picking it up does not need to re-litigate any of it.

Everything else in that file (**G1**, **M1**, **M2**, **M6**, **M7**) is a
deliberate deferral, each with its `file:line` and the reason. The test to
re-apply before promoting one: does it affect the correctness of a destructive
write? **M10 and M11 are now CLOSED** — both were G6-descended, and closing
them leaves the G6 wave with nothing open but two residuals the operator ruled
**out of scope** (the rest of §4.1's peer-writable family table, and sweeping
dangling entries already in production). Those two are recorded as decisions
inside G6's own entry, where no open-item count will surface them.
The residue is in the redeemer's own list, is visible to them, and self-corrects
on their next follow or unfollow of that uid — which is why it was filed rather
than fixed, but it is undocumented behaviour nowhere except its three recorded
places (`docs/operator-panel-followups.md`, the design spec's §4.2, and a
comment at `js/invites.ts`'s call site). **G9 and G10 are CLOSED** (`728180d`, `4780b1f`) — both were filed
2026-08-03 by the same review that closed out G6, found by reading rather than
by running the smoke test, and both got a small client-side fix the same day:
`rotateCode`'s fan-out (`js/db/social.ts`) now drops a followee whose
`presence/code` is gone before building its fan-out, and invite redemption
(`js/invites.ts`) now runs the refusable `setFollowingEntry` write before
`registerAsFollower` instead of after. **Verified by jest only** — no session
container has ever held a service-account credential, so neither fix has run
against a live project, and neither item was ever device-observed. Full
reasoning, including a correction to G10's original entry, is in
`docs/operator-panel-followups.md`.

**Step 9's purge side, OBSERVED across three runs (2026-08-02).** Run 3 closed it:
a purge with the **Auth-record box ticked**, `ops/verify-auth-delete.js` run
either side (record with empty `providerData` → `NO AUTH RECORD`), and the
residue sweep reporting `swept: 4`, all empty — **including an owned group's
whole `locationCells/{gid}` with another member's cell inside it**, which is the
claim the entire step existed to check.

**Step 9's merge leg, OBSERVED 2026-08-03.** One plain merge on a fixture seeded
by `ops/seed-merge-fixture.js --tag run2`: **57 of 57** read-back claims holding
under `ops/verify-merge.js`, the preview's conflicts and losses read before
executing, and an `ok` line for the merge in `.ops-audit/audit.jsonl`. It
exercised the `inviteIndex` `scope` fix (`2fcc51f`) and `merge.js`'s own
`pushTokens` carry on live data, neither of which had ever been observed.

**Link via merge, OBSERVED 2026-08-03.** The panel's non-lossy link ran on its
own `--telegram` fixture: **65 of 65** claims, covering all of `buildLinkWrites`
— mapping node, reverse index, and the prefs side where `telegram-prefs-disagree`
and `telegram-channel-unroutable` (both integrity ERRORS) live.

**Plain merge of a Telegram-linked loser, OBSERVED 2026-08-03.** The last
unexercised merge path — `merge.js:385-394`'s `buildMappingTeardown` branch, the
*opposite* branch of the same `if` link-via-merge takes (`:351`) — ran on its own
`--telegram` fixture (tag `tdn1`): **61 of 61** claims under
`ops/verify-merge.js --telegram`, no `--repoint`. There the mapping must come
**down** rather than repoint, or it points at a uid that no longer exists and the
next Mini App open bootstraps onto it. Integrity was clean either side (exactly
one `auth-missing` INFO per seeded uid before, nothing above INFO after), the
audit log carried an `ok` line, and the fixture was cleaned. **Every live merge
path has now been seen; none of them is proven** — one run each, one fixture
shape each.

**If you run the panel again, the preconditions still stand.** Close the Mini App
and any signed-in web client for the target account first (**G3**) — it is not
theoretical, it fired on 2026-08-02 and reappeared as a conflict at
`userPrefs/{uid}` on the way back out. **G3 is the accurate name for this on
the merge and link legs only since SEC-6** (`792b109`): before it, those two
routes revoked nothing, so the hazard there was not G3's bounded one-hour token
window but an unbounded one. Both now revoke the account they remove, as purge
has since 2026-08-02, which is what puts every leg under the same G3 window.
G3/#302 itself was **not** worked on and stays parked — it is the rules gap
that lets an issued token outlive its revoke, and no revoke closes it. And
closing the target's clients is not
sufficient (**G6**): a PEER's client republishes cross-user residue permanently.
**G6 now has a real fix** (`13cb18c`+`8a0ff62` — a rules `.validate` plus a
client gate). The rules half is **live on the dev project** — the merge to
`dev` deployed it via CI — and **absent on prod** until `dev` → `main`. So this
precondition still stands in full against a PROD target; against dev the guard
is active but has never been exercised, which is untested, not absent. Either
way the tool only detects the republish and prints a `PEER REPUBLISH` block.
The merge leg sidestepped both by seeding **synthetic** accounts no client ever
held — the reasoning is in `ops/merge-fixture.js`'s header and it is the pattern
to reuse.

**Everything found across this exercise came from RUNNING the panel, not from
reviewing it.** Four defects in shipped production code — G5, both halves of G7,
and the `inviteIndex` shape — surfaced by `integrity.js` on a live project, plus
a fifth in the merge leg's own verifier (`2dec78c`, it reported a CORRECT merge
as owed), all with a full green bar and four prior reviews having walked past
every one.

**Step 10 passed in its strongest form** — the dump was not merely read back but
used to restore the purged account. That is where `functions/ops/restore-preimage.js`
and **G4** came from. **G4 is now CLOSED** (`33d89ae`): purging an account that
owns a group still triggers the cascade, and the preview now names it before
you approve rather than leaving you to find it during a restore.

**What the panel is**, if you have not met it: `functions/ops/` is a local
Admin-SDK CLI plus a one-page browser UI — user list, merge, purge, Telegram
link-without-loss, integrity report. It binds `127.0.0.1` only, is excluded from
every deploy, and holds a full database-admin credential, which is why the
`Host`/`Origin` guard and the pre-image dump matter as much as they do. Built
across the 11 tasks of
`docs/superpowers/plans/2026-08-01-operator-control-panel.md`;
`functions/ops/README.md` is the runbook and
`docs/operator-panel-followups.md` carries every open item with a stable ID.
Read both before touching `functions/ops/` or `functions/telegram-auth.js`.

**What steps 1-8 already changed.** G2 ("auth-record deletion has no route") was
recorded as deferred-by-decision on the reading that a surviving Auth record is
inert. It is not — it keeps the purged account's session alive, and the client
republishes its cache into the nodes the purge just cleared. Purge now revokes
refresh tokens before the write, refuses outright if that fails, and takes an
opt-in `deleteAuthRecord` flag. **G2 is CLOSED**; `admin.auth().deleteUser` is
confirmed working on a custom-token uid, which was the original deferral's
question. The rules gap underneath it is filed as **G3**. Full reasoning and the
measurements live in `docs/operator-panel-followups.md`.

**Eleven open, twelve closed** — all ranked with stable IDs in the "at a
glance" table at the top of `docs/operator-panel-followups.md`. **S1 and M9 are
now CLOSED** (the smoke test ran to completion; M9's `op` guard shipped straight
after, because completing the leg is what made it urgent — a real merge dump now
sits in `.ops-audit/` beside the purge dumps). **G9 and G10 are now CLOSED**
too (`728180d`, `4780b1f`) — see "What's next" above. **M10 and M11 are now
CLOSED too**: M10 by three jest cases pinning the path `setFollowingEntry`
builds against the hand-typed path the G6 rules suite guards, M11 by folding
the revocation clear and the refusable following write into one atomic
multi-path update (`setFollowingEntryClearingRevocation`). **G4 is now CLOSED**
too (`33d89ae`) — the preview names the cascade the write-set only triggers;
the audit model is unchanged, and the cascade list is a hand-maintained model
of client behaviour rather than an enforced one. Open: G1 and **G3** (G3 is a
whole-app rules gap, not a panel item, and is now
parked as #302); and M1–M8
(deferred minors, each with its `file:line` and why it was left; none of them
affects the correctness of a destructive write, which is the test to
re-apply before promoting one).
**G6 is now CLOSED** too (`13cb18c`+`8a0ff62`+`e2dde4e`) — it does
NOT close with G3, contrary to what this file used to say; see "What's next"
above.
**G5 is closed** (`0f31553`) and stays in that table with its reasoning, like G2,
because *why it survived every review* is the useful part. **Its follow-up half
is DONE, not open** — this file described it as "deliberately not done" long
after it had shipped. `integrity.js` only catches residue families someone
remembered to add to it, so the guard that catches the NEXT relocation instead
of the last one is `functions/test/expunge-completeness.test.js` (`5f4dcd5`):
it reads the top-level node list out of `database.rules.json`, requires every
node to be classified into one of four buckets, and asserts every own-account
node really is nulled at `{node}/{uid}`. Verified by planting three violations,
not by passing. `docs/operator-panel-followups.md` has said "now DONE" since it
landed; this file was the stale one. Nothing else is owed on this branch.

**Branch status (2026-08-03, LATEST): `claude/knockknock-operator-queue-xycpd8`
MERGED TO `dev` AND PUSHED, at the operator's explicit instruction.**
`origin/dev` moved `b02dc47` → `aa7322b`, a `--no-ff` merge commit matching
`dev`'s own history (`dadb529`, `d47fbbb`, `8ad9ef0` are the same shape;
fast-forward was available and deliberately not taken). Ten commits — five
items and their docs: `33d89ae`+`8d8b128` (G4), `f730f34`+`3bc2e7c` (M12),
`f7fa67d`+`35e300e` (M5 + M4, one commit as the queue planned),
`787f6be`+`6c7bce9` (M3), `17945c3`+`d201bf2` (M8). Working tree clean, nothing
unpushed. The feature branch is fully contained in `dev` and is now redundant —
kept, not deleted, like its predecessors. `dev` → `main` is the maintainer's;
no PR was opened and none was asked for.

⚠️ **THAT PUSH FIRED `deploy-dev.yml`, AND IT SHIPPED NO BEHAVIOUR CHANGE.**
Both halves matter. CI deploys `hosting,database,functions` on every push to
`dev`, ungated, so the workflow ran — but every code file in this merge is
under `functions/ops/**` (excluded from the functions archive via
`functions.ignore`) or is a test. `database.rules.json` and the shipped
`functions/*.js` are untouched, and the only `js/` movement is comments, with
no statement moved. This is the first merge in a while where "nothing shipped"
is true of the artifacts rather than merely of the sessions — do not generalise
it to the next one.

**Prior branch status (2026-08-03): `claude/g3-revocation-timeout-eabaf4`
MERGED TO `dev` AND PUSHED, at the operator's explicit instruction.**
`origin/dev` moved `7e9a36b` → `dadb529`, a `--no-ff` merge commit matching
`dev`'s own history (`d47fbbb`, `8ad9ef0`, `d5c7a53` are the same shape;
fast-forward was available and deliberately not taken). Ten commits. Working
tree clean, nothing unpushed. The feature branch is fully contained in `dev` and
is now redundant — kept, not deleted, like its predecessors.

⚠️ **That push DEPLOYED to the dev project.** `deploy-dev.yml` fires on push to
`dev` and runs `firebase deploy --only hosting,database,functions`, ungated.
This merge moves `js/db/social.ts` and `js/invites.ts`, so **M11's atomic
revocation-clear is live on dev**. `database.rules.json` is unchanged by this
work — the rules movement was test-only — and `functions/` is unchanged.
Undeployed to **prod** until `dev` → `main`, which is the maintainer's and is
gated by `deploy-prod.yml`'s `environment: production` reviewer.

What the merge carried:

| | |
| --- | --- |
| `99cf3ea` | **G3** parked as #302; both docs cross-referenced |
| `93966c0` | the deploy framing corrected — CI ships `dev` on push, ungated |
| `4b991fe` | the G6 review's M-numbers disambiguated from the ledger's stable IDs |
| `a9c11cf`+`c837cb1` | **M10** + **M11** closed — see the verification bar below |
| `6ae0d4e` | M10/M11 recorded closed; the two G6 residuals ruled OUT OF SCOPE |
| `23d1cf1` | **G1**'s severity corrected DOWN; `statusOverride` named |
| `b3acd3a` | the doc-claim audit — **M12** filed, G9's claim retracted, two loose claims tightened |
| `870c3b0` | the operator's rulings on every open item, and the build queue |

**Prior branch status (2026-08-03): `claude/knockknock-g6-g9-fixes-lt02a8`
merged**, `origin/dev` `6c45ff5` → `d47fbbb`, then `7e9a36b` reconciled the
handoff. Everything below this line describes that earlier wave.

**Branch status (2026-08-03, earlier): MERGED TO `dev` AND PUSHED, at the operator's
explicit instruction.** `origin/dev` moved `22abc8a` → `8ad9ef0`, a `--no-ff`
merge commit matching `dev`'s own history (`d5c7a53` is the same shape;
fast-forward was available and deliberately not taken). Nothing uncommitted,
nothing unpushed, working tree back on the feature branch. **`dev` is now 81
ahead of `origin/main`**, and `dev` → `main` remains the maintainer's.

The merge carried **17** commits: the five below that
`claude/knockknock-operator-followups-1kyjy6` had left waiting (that branch is
at `edb528c`, is a verified ancestor of the merge, and is now fully contained in
`dev` — it needs no merge of its own), plus the twelve of the G6 work. The
branch was continued as `claude/knockknock-g3-g6-revocation-cy2i0n`, not
`claude/knockknock-operator-followups-1kyjy6` as this file named it previously:

| | |
| --- | --- |
| `53d4789` | the plain-merge teardown branch ran on dev — 61/61 |
| `1d3a235` | `--mapping-shape` on both merge-leg CLIs, +17 tests |
| `44dc688` | the four other mapping holders ran — 62/62, 62/62, 61/61, 61/61 |
| `864de74` | **G8**: purge no longer refuses an account with no Auth record |
| `edb528c` | hand off — operator list empty, G3/G6 filed as one fix (the reading this update corrects) |
| `bb41719` | spec: G6 — the peer republish, and why it does not close with G3 |
| `845293b` | plan: implementation for the G6 spec |
| `13cb18c` | rules guard — a follow entry may only name an account that exists (**G6**) |
| `f7ac8c7` | seeds the `ownership.test.js` followee the new guard caught was missing |
| `8620702` | store helpers — `hasSeenServerFollowing`/`markServerFollowingSeen` |
| `8a0ff62` | client gate — stop republishing a following list the server emptied (**G6**) |
| `94c9aa6` | classifies `statusapp_following_server_seen` as account-scoped in `js/cacheOwner.ts`, closing a drift-guard failure the six commits above it left open |
| `41a89d4` | the docs correction — G6 closed, the author named, "closes with G3" struck here and in the followups doc |
| `b595dcb` | **I1**: an undeliverable follow-grant is now told apart from a transient failure (`js/followRequests.ts`, `followeeExists` in `js/db/social.ts`) |
| `e2dde4e` | `$sub` refuses a write two levels below a following entry — `$field` alone closed only one |
| `10e7c0b` | **G9/G10/M10** filed; the spec's §6 table and the forgeable-predicate landmine corrected |
| `6ff93cb` | the G9 shift was twelve lines, not ten |
| `b1d55ed` | spec: G9 + G10 — client writes that name a followee who is gone |
| `ecc551d` | plan: G9 + G10 — implementation, TDD, four tasks |
| `728180d` | **G9**: `rotateCode` no longer mirrors a code onto a dead followee — client filter |
| `4780b1f` | **G10**: redemption writes reordered so the refusable one runs first |
| `4cea158` | test-isolation follow-up on `4780b1f` — one-shot mock rejection, not a persistent one |
| `38e95c6` | docs — G9 and G10 closed, the handoff reconciled |
| `da8a3a2` | final-review fix wave — `clearRevocation` extracted and hoisted ahead of the redemption's refusable write, the two ordering tests strengthened to pin resolution, spec §3/§4/§5 and this file corrected |
| `ad9aa29` | **M11** filed — what the `clearRevocation` hoist costs, recorded in the followups ledger, spec §4.2 and a comment at the call site |

**Those eight rows are now MERGED TO `dev` AND PUSHED**, at the operator's
explicit instruction. `origin/dev` moved `6c45ff5` → `d47fbbb`, a `--no-ff`
merge commit matching `dev`'s own history (`8ad9ef0` and `d5c7a53` are the same
shape; a fast-forward was available and deliberately not taken). The feature
branch is fully contained in `dev` and needs no merge of its own.

Two commits on it, `b1d55ed` and `ecc551d`, carry a `Co-Authored-By` trailer
naming a model, which collides with the standing rule that no model identifier
appears in a commit. Every later commit is clean. Left as-is by operator
decision rather than rewritten — recorded here so nobody re-derives it as a
finding.

`dev` → `main` is **the maintainer's**; no PR was opened, and none was asked
for. Older branches
(`claude/smoke-test-merge-leg-87l2w1`, `claude/operator-panel-step-9-z31g3w`,
`claude/knockknock-smoke-test-9-10-1zohil`,
`claude/knockknock-ui-improvements-7bm5o9`) carry nothing unique and are
redundant, and `claude/knockknock-operator-followups-1kyjy6`,
`claude/knockknock-g6-g9-fixes-lt02a8` and now
`claude/g3-revocation-timeout-eabaf4` join them.
**`dev` was 93 ahead of `origin/main` before this merge; it is now further
ahead by the ten commits above plus the merge commit.** The exact figure is
UNVERIFIED this session — `git fetch --unshallow origin` fails on proxy auth in
a fresh container, so `origin/main` is not fetched and no cross-branch count can
be computed. Do not quote a number you have not recomputed.

**These seventeen touch TWO deploy surfaces, and neither is the functions
one.** `ops/**` is excluded from the functions archive, so G8
(`ops/server.js`, `ops/panel.html`) and the merge-leg CLIs ride no deploy at
all, and the docs commits ride nothing.
⚠️ **"UNDEPLOYED" BELOW MEANS UNDEPLOYED TO *PROD*. Everything here is already
LIVE ON THE DEV PROJECT.** Pushing to `dev` triggers
`.github/workflows/deploy-dev.yml`, which runs
`firebase deploy --only hosting,database,functions` against the dev project
with **no approval gate**. This file used to read as though none of it had
shipped anywhere; that was wrong, and the deploy landmine below records why the
wording misled.
⚠️ **`13cb18c`+`e2dde4e` are a RULES change — live on dev, undeployed to
prod.** The fourth prod-undeployed behaviour change, and the only one on this
surface. It went live on dev with the `8ad9ef0` merge (deploy-dev run
2026-08-03T13:17:49Z, success).
⚠️ **`8620702`, `8a0ff62`, `94c9aa6`, `b595dcb`, and now `js/db/social.ts` and
`js/invites.ts` (G9 and G10, `728180d`+`4780b1f`) are CLIENT behaviour — live
on dev, undeployed to prod**, riding the next prod **hosting** deploy (G9/G10
went live on dev with the `d47fbbb` merge, run 2026-08-03T19:18:48Z): the
push-up gate, its
localStorage key and that key's account-scoped classification, I1's
undeliverable-grant handling, `rotateCode`'s dead-followee filter, and
invite redemption's write reorder. Do not read "only `js/`" as "no deploy" —
`js/` is exactly what Hosting serves.
⚠️ **G9 and G10 do NOT touch `database.rules.json`.** The rules surface is
**unchanged** by this branch: the rules commits (`13cb18c`+
`e2dde4e`) are exactly as they were, and remain the only RULES
change here. A reader who knows G6 will reasonably assume a G6-adjacent fix
moved the rules again — it did not; both G9 and G10 are client-only fixes.
The two surfaces are independent of each other and of the functions queue: the
rules guard is the half that actually closes G6 and it binds every client the
moment it ships, including ones nobody can update; the client half only ever
binds clients that have updated.
On PROD, rules can be deployed independently of hosting and functions
(`firebase deploy --only database`) and bind every client immediately,
including ones nobody can update. **Nothing deploys from a session — but CI
deploys on push**: `dev` ships all three surfaces to the dev project ungated,
and `main` ships them to prod behind `deploy-prod.yml`'s
`environment: production` required reviewer. `docs/DEPLOY-PROD.md` is the prod
runbook.

⚠️ **`dev` carries THREE production behaviour changes** on the `performLink` →
`expungeDerivedAccount` path, all riding the next **prod** functions deploy:
`pushTokens` cleanup (`0f31553`), the owned-group index releases (`1f639ee`),
and the `inviteIndex` shape fix (`2fcc51f`). All three are **already live on
the dev project** — CI deploys functions on every push to `dev`.
`docs/DEPLOY-PROD.md` is the prod runbook; no session deploys, but CI does. **The merge-leg work adds nothing to that list** —
`ops/merge-fixture.js`, `ops/seed-merge-fixture.js` and `ops/verify-merge.js` are
operator-machine tools under `ops/**`, excluded from every deploy.

What remains (G1, G3, M1, M2, M6, M7) is either an operator action
or explicitly deferred — none of it is unfinished build work. **G4, G6, G9,
G10, M3, M4, M5, M8, M10, M11 and M12 are all CLOSED**, and G3 is parked as #302.

Spec: `docs/superpowers/specs/2026-08-01-operator-control-panel-design.md` —
decisions D1–D6 and their rationale; §7 (merge family rules) and §8 (the
Telegram link case) matter most if you touch merge code.

⚠️ **THE CLONE IS SHALLOW, SO CROSS-BRANCH COUNTS AGAINST LOCAL `dev` ARE
MEANINGLESS.** `git rev-parse --is-shallow-repository` is `true`, there are
grafted commits, and `git merge-base origin/dev dev` returns **nothing** — the
shared ancestry is cut off. Local `dev` therefore reports as wildly diverged
(129 ahead / 134 behind at `361e65c`) and `git merge-base --is-ancestor 361e65c
origin/dev` answers **NO**, both of which are artifacts. **It is not divergence
and there is nothing to repair.** A session in this container mistook it for
real divergence once (2026-08-05) before checking. Work against `origin/dev`,
which is always correct; leave local `dev` alone. This is the same root cause as
the existing note that `git fetch --unshallow origin` fails on proxy auth.

⚠️ **Do not touch code without the operator's explicit say-so** — propose the
change and get approval BEFORE any edit. The operator drives; expect
hands-on iteration ("done" is their call).

## Where things stand (2026-08-02)

The operator control panel is built: all 10 code tasks of the 11-task plan
landed on `claude/knockknock-ui-improvements-7bm5o9` (subagent-driven,
per-task commits, each reviewed); this doc update is Task 11, the plan's
last. `functions/ops/` holds the local Admin-SDK CLI + page
(`server.js`, `panel.html`, `merge.js`, `purge.js`, `audit.js`, `integrity.js`,
`provenance.js`, `project.js`, `snapshot.js`, `deps.js`, `format.js`,
`verify-auth-delete.js`, `restore-preimage.js`) and its own
`README.md` runbook — read that before running it. **The panel is local-only
and has never been deployed and never will be**: it isn't part of the
Firebase Hosting or Cloud Functions deploy surface (excluded from the
functions archive via `functions.ignore`'s `ops/**`), it runs as a Node CLI
an operator starts by hand against a target project, and it binds `127.0.0.1`
only. **`dev` now carries it** (`3fe25c3`, merged at the operator's
instruction); `main` does not — that merge is the maintainer's.

**Owed before this is trusted with production data: NOTHING.** The smoke test is
complete — steps 1-8 and 10 on 2026-08-02, step 9's purge side the same day, its
merge leg on 2026-08-03. Three things to carry in anyway, none of them work
items: approvals are per-uid and held in memory, so the panel is single-operator
by construction — two people running it against the same project at once do not
share approval state; a purge is recoverable from its pre-image but **not
completely** (**G4**); and, as of this 2026-08-02 entry, **G6** had no
mitigation at all, so a peer's client could write permanent cross-user residue
during any purge or merge, including the `performLink` path in production
where no operator is present. **G6 is now CLOSED** (`13cb18c`+`8a0ff62`,
2026-08-03) — see "What's next" at the top of this file; this paragraph is
left as the historical snapshot it was written as.

Everything below is SHIPPED; nothing is uncommitted or unpushed. The commits
listed under "Branch status" are **merged to `dev` and pushed** — `dev` → `main`
is still the maintainer's.

- **v2.0.0 released.** `dev` → `main` merged by the maintainer (`main` =
  `731eed9`); tagged `v2.0.0` on GitHub at the release commit `ca1d1fa`.
  v2.0.0 = 352 commits since v1.3.0 — opt-in location/distance sharing, the
  Telegram Mini App + bot (beacon nudge + `/locoff`), two performance-audit
  passes + a security batch, the TypeScript migration, PWA auto-update
  hardening. Release notes (v1.3.0…v2.0.0) live on the GitHub release.
- **Release content (this session).** New `README.md` feature + data-model
  updates and refreshed About-page content for distance sharing and the
  Telegram commands (`76454d6`).
- **Direct status-text-color fix (this session, device-verified).**
  `js/following.ts` no longer overrides the "Available for…" text to the
  palette key color; it follows the member's `statusColor`, so the label
  agrees with the status dot (mirrors the group roster). Shipped to `dev` +
  `main` (`361e65c`). **NOT in the `v2.0.0` tag** — operator chose no new
  tag, so it rides the branch; the next tagged release (`v2.0.1`+) includes
  it.

**Deploy state:** merging `dev` → `main` may trigger the gated prod deploy
workflow (required-reviewer). If a prod deploy is still owed, the ordering is
the LOAD-BEARING `pushTokens` F6c sequence + a functions deploy (the Telegram
beacon batch touches `functions/`) — full runbook in `docs/DEPLOY-PROD.md`.
No session deploys anything; CI does, and the `dev` half is ungated (see the
deploy landmine).

`0f31553` adds to that functions deploy and touches the same F6c node, so read
the two together. It needs no migration ordering of its own: expunge nulls
`userPrefs/{uid}` wholesale (which takes the legacy
`userPrefs/{uid}/pushTokens` with it) *and* the new `pushTokens/{uid}`, and
graduation copies the prefs subtree wholesale *and* moves the new node — so
un-migrated and migrated accounts are both fully covered whichever side of the
migration they are on. Deploying it before or after the migration completes is
equally safe.

## Verification state

**M13 + M14 + M15 closure, green bar OBSERVED (2026-08-05)** on
`claude/knockknock-unruled-decisions-ak3gaa`, cut from `origin/dev` at
`59f1a51`, on a FRESH container after the documented `npm ci` — baseline
re-measured on that container before any edit (functions **1111/1111** in 33
suites), which is the control this bar is read against:

- functions **1123/1123** (**34** suites, **+1**) — **+12**: 4 in
  `ops-merge-fixture.test.js` (an adopted merge matching the adoption-aware
  claims end-to-end through the real `buildMergePlan`/`applyMergePlan`, the
  count of differing claims being exactly one, no claim explaining itself by
  denying the tick exists, and the seed notes naming `--adopt`), 3 in
  `ops-merge-cli.test.js` (a value after `--adopt` refused pre-credential, the
  bare flag accepted as far as the credential, and the call-site seam), 4 in
  the new `ops-merge-fixture-rules.test.js` (the parse control, every seeded
  leaf against every charset rule naming it, `codeIndex` agreeing with the
  accounts, and no legal tag producing an illegal code), 1 in
  `ops-server.test.js` (the column names the auth record and keeps its sort key)
- rules (emulator) **119/119** (12 suites) — **unchanged**;
  `database.rules.json` is untouched by this work
- web jest **2149/2149** (88 suites) — **unchanged**; nothing here touches `js/`
- `typecheck` + `typecheck:scripts` — clean; **zero** new suppressions, swept
  over the diff
- `node scripts/prod.js` — builds

**Ten violations planted across the three items, and every guard was verified by
watching it go red rather than by passing** — four for M13, three for M14, three
for M15; every production file byte-identical after every revert. The three that
carried the most information: dropping `adopt` at the call site (the
parsed-and-dropped-on-the-floor shape M8 was), **tightening the shipped rule so
the existing codes stop satisfying it** (the evidence M14's guard reads the
rules file live and would catch the NEXT rule rather than the last one), and
rewriting the `.validate` out of regex shape so the parser finds nothing (the
control firing instead of the suite passing vacuously).

**What that bar does NOT cover.** Jest only — no live project, no browser. No
session container has ever held a service-account credential, so: `--adopt` has
never been passed to a real run (the seam beyond the call site is pinned by a
source assertion, and the test says so); the upper-cased codes have never been
seeded; and the renamed column has not been RENDERED, only asserted in the
markup, since `panel.html` has no DOM harness.

**Live steps for all three are written and NOT RUN:**
`docs/smoke-test-2026-08-05-m13-m15.md`. Parts B and C are the pair that matters
— an adopted merge read back **with** `--adopt` (57/57) and **without** it
(exactly 1 owed), then a plain merge read both ways with the values reversed.
Either half alone would pass against a flag that does nothing. Part D's charset
checks are live; its realism claim is **not hand-reachable** and the file says
so rather than sending a session after it. Everything in that file is a
prediction derived from the code at `a1d04e8`, not a result.

**M14's one live precondition was met before the merge.** Whether a seeded
fixture was live on dev was UNKNOWN from a session container — there is no
credential here — so it was raised as the operator's to settle, and **they
reported the old fixtures cleaned up (2026-08-05) before instructing the
merge.** REPORTED, not observed by this session: nothing here can see the dev
project. ⚠️ **The constraint itself did not expire with those fixtures** — any
fixture seeded by a pre-M14 build must still be cleaned by that build, because
`--clean` derives the `codeIndex/` keys it nulls from `fixtureCodes`, which
now upper-cases. It is recorded at the function and in `ops/README.md`.

⚠️ **This work ships NOTHING.** Every changed file is under `functions/ops/**`
(excluded from the functions archive via `functions.ignore`), under
`functions/test/**`, or under `docs/**`. `database.rules.json`, `js/`,
`.github/` and the shipped `functions/*.js` are untouched — verified by
filename, not inferred. Do not generalise that to the next change.

**GREEN BAR OBSERVED ON THE MERGED RESULT at `38e4bc2` — `dev`'s tip, not the
branch's (2026-08-05):** functions **1111/1111** (33 suites) · rules (emulator)
**119/119** (12) · web jest **2149/2149** (88) · `typecheck` +
`typecheck:scripts` clean · `node scripts/prod.js` builds. Identical at
`a2b8c2d`. Every number matches the pre-merge baseline exactly, which is what a
docs-only merge should produce — the merges carry no code.


**GREEN BAR OBSERVED ON THE MERGED RESULT at `aa7322b` — `dev`'s tip, not the
branch's (2026-08-03):** web jest **2149/2149** (88 suites) · rules (emulator)
**118/118** (12 suites) · functions **964/964** (32 suites) · `typecheck` +
`typecheck:scripts` clean · `node scripts/prod.js` builds. Run after the merge
on purpose: a green run on the branch only proves the branch. The same five
were green at the branch tip `d201bf2` beforehand, on a fresh container after
the documented `npm ci`.

**M8 closure, green bar OBSERVED (2026-08-03) at `17945c3`** — functions
**964/964** (32 suites, **+5**: the collision conflict carrying its gid, an
execute whose adoption set was ADDED after the preview refused, the mirror where
one is DROPPED, and two source assertions over `panel.html`) · typechecks clean,
zero new suppressions · web and rules untouched.

**M8 is also the one item that was driven in a REAL BROWSER** — Chromium against
canned API responses, no credential and no database. Unticked: "survivor's
record kept" over a 3-path write-set. Ticked: "loser's displayName adopted" over
4 paths. Unticking goes back. The harness is a scratchpad script and is
deliberately NOT committed: it would drag a playwright dependency into a repo
with none, and it stubs the very server it would be checking.

⚠️ **Two planted violations initially stayed GREEN here, and that is the finding
worth carrying forward.** A source assertion that `panel.html` CONTAINS
`adoptBlock` still passes with the call site deleted, and one that the page
mentions `onChange` still passes with nothing installing the handler. Both were
strengthened to assert the call site and the wiring. A control that exists but
is never rendered is M8's own shape one layer over — the server accepted a flag
the page never sent — so the guard has to name the seam, not the symbol.

**M3 closure, green bar OBSERVED (2026-08-03) at `787f6be`** — functions
**959/959** (32 suites, **+4**: `canvasUids` returning both sides, the round
trip with `ops/merge.js`'s `canvasKeyFor` in either argument order, `canvasPeers`
reading its pair through it, and the source assertion that no other ops module
splits a key by hand) · typechecks clean, zero new suppressions · web and rules
untouched. Verified by planting three violations: integrity re-typing the split
inline (1 red), `canvasUids` dropping the second uid (**13** red across project,
integrity and merge — the evidence the helper is wired in rather than merely
present), and `canvasKeyFor` no longer sorting (6 red); all three files
byte-identical after the reverts.

**M5 + M4 closure, green bar OBSERVED (2026-08-03) at `f7fa67d`** — functions
**955/955** (32 suites, **+4**: the EACCES rethrow with exactly one attempt, an
error carrying no `code` taking the same path, the cap refusing with the base
name and the attempt count in its message, and five real collisions in a row
still finding free names) · `typecheck` + `typecheck:scripts` clean, zero new
suppressions. Web and rules untouched by this work. Verified by planting three
violations: the rethrow branch removed so a non-EEXIST error is retried (2 red),
the cap message stripped of the name it was reserving (1), the exhausted loop
returning instead of throwing (1); `ops/audit.js` byte-identical after the
reverts. **What it does NOT cover:** the cap has never been reached on real
hardware — every case drives a fake fs, and the condition it guards (an fs
answering EEXIST to 100 candidates) has never been observed.

**M12 closure, green bar OBSERVED (2026-08-03) at `f730f34`** on the same
branch — web jest **2149/2149** (88 suites, **+3**: `followeeExists` probing
the node the rules `.validate` names, the rules file's own two copies agreeing,
and the parser refusing a predicate that is no longer an existence chain) ·
rules (emulator) **118/118** (12, unchanged — `database.rules.json` is
untouched) · functions **951/951** (32, unchanged) · `typecheck` +
`typecheck:scripts` clean, zero new suppressions · `node scripts/prod.js`
builds. Verified by planting four violations, never by passing: the client
probing `presence` instead of `presence/code` (2 red), the rules keying on
`presence/status` (1), only the `$field` copy edited (1), the predicate
rewritten to `hasChild` (1); both files byte-identical after the reverts. **The
only `js/` movement is comments** — no statement moved.

**What that bar does NOT cover.** The guard proves the two copies name the same
node; it does not prove the rules and the client draw the same CONCLUSION from
it, and it says nothing about `getCreatorCode`, which reads the same node for
its value and is deliberately left untied (see M12's entry). Jest only.

**G4 closure, green bar OBSERVED (2026-08-03) at `33d89ae`** on
`claude/knockknock-operator-queue-xycpd8`, on a FRESH container after the
documented `npm ci` — baseline `b02dc47` re-measured on the same container
(functions 941/941 in 32 suites):

- functions **951/951** (32 suites, unchanged) — **+10**: 7 in
  `ops-purge.test.js` (the cascade's content, its remedy wording, the predicted
  path's absence from the write-set, the non-owned and solo-owner silences, an
  account owning no group, and the production link carrying the same cascades),
  1 in `ops-merge.test.js` (a merge predicts none, and no whole-group null
  appears in its writes), 2 in `ops-server.test.js` (the refusal diff names a
  `+ cascade:`, and every destructive preview renders the block)
- web jest **2146/2146** (88 suites) — **unchanged**; nothing here touches `js/`
- rules (emulator) **118/118** (12 suites) — **unchanged**;
  `database.rules.json` is untouched
- `typecheck` + `typecheck:scripts` — clean; **zero** new suppressions, all
  seven forms swept over the diff
- `node scripts/prod.js` — builds

Each new guard was verified by planting a violation, never by passing: the
cascade never pushed (6 red), the no-other-members guard dropped (2), the
production link dropping its cascades (1), the digest no longer comparing them
(1), merge claiming a cascade it does not have (1), one preview dropping the
block (1). All four production files byte-identical after every revert.

**What that bar does NOT cover.** Jest only. The cascade block has never been
rendered in a browser, and no session container has ever held a service-account
credential, so none of it has run against a live project. The cascade list is a
hand-maintained model of client behaviour — `none predicted` means none of the
MODELLED cascades apply, and nothing enforces that the model is complete.

**GREEN BAR OBSERVED ON THE MERGED RESULT at `dadb529` — `dev`'s tip, not the
branch's (2026-08-03):** web jest **2146/2146** (88 suites) · rules (emulator)
**118/118** (12 suites) · functions **941/941** (32 suites) · `typecheck` +
`typecheck:scripts` clean · `node scripts/prod.js` builds. Run after the merge
on purpose: a green run on the branch only proves the branch. The same five were
green at the branch tip `870c3b0` beforehand, on a fresh container after the
documented `npm ci`.

**M10 + M11 closure, green bar OBSERVED (2026-08-03)** on
`claude/g3-revocation-timeout-eabaf4`, on a FRESH container after the
documented `npm ci` — baseline `7e9a36b` (web 2139/2139 in 88 suites · rules
116/116 in 12 · functions 941/941 in 32):

- web jest **2146/2146** (88 suites, unchanged) — **+7**: 3 in `tests/db.test.js`
  for M10 (path, value shape, null label), 3 more there for M11's atomic write,
  and net +1 in `tests/invites.test.js` (one ordering test replaced by two)
- rules (emulator) **118/118** (12 suites, unchanged) — **+2**, both in
  `tests/rules/g6-following-referent.test.js`: a refused following path leaves
  `revocations/M/T` intact, and the same update lands whole once the followee
  exists
- functions **941/941** (32 suites) — **unchanged**
- `typecheck` + `typecheck:scripts` — clean; **zero** new suppressions, all
  seven forms swept over the diff
- `node scripts/prod.js` — builds

**`database.rules.json` is UNCHANGED by this work** — the rules movement is
test-only, so this adds **no** new deploy surface. `js/db/social.ts` and
`js/invites.ts` did move, so both ride the same **hosting** queue as the G9/G10
client changes: live on dev on merge, undeployed to prod.

**What that bar does NOT cover.** Every case is jest or the rules emulator. No
session container has ever held a service-account credential, so neither fix
has run against a live Firebase project, and M11's failure mode was never
device-observed — it was found by reading, in the re-review of G10's own fix.
What the emulator *does* settle, and jest could not, is the assumption the M11
fix rests on: that RTDB rejects a multi-path update whole when one path fails a
`.validate`. That is now pinned rather than assumed.

Each guard was verified by planting a violation, never by passing: M10's three
by path drift, a dropped label key and a mangled label value; M11's by
implementing the function as two sequential writes (all three cases red) and by
leaving `js/invites.ts` on the old call pair (7 red across the redemption
path). Production files are byte-identical after every revert.

Green bar OBSERVED on the MERGED result at `d47fbbb` — `dev`'s tip, not the
branch's (2026-08-03): web jest **2139/2139** (88 suites, unchanged) · rules
(emulator) **116/116** (12 suites, unchanged) · functions **941/941** (32
suites, unchanged) · `typecheck` + `typecheck:scripts` clean ·
`node scripts/prod.js` builds. Run after the merge on purpose: a green run on
the branch only proves the branch. The same five were green at the branch tip
`ad9aa29` beforehand.

Web movement from the `8ad9ef0` bar (2132/88): **+7**, all from the G9/G10 work
— 4 in `tests/db.test.js` (the fan-out filter: a dead followee omitted, a live
one carried, an inconclusive read failing open, and the reads preceding the
`codeIndex` reservation) and 3 in `tests/invites.test.js` (the write order, a
refused follow leaving nothing behind, and the revocation clear preceding the
refusable write). Suite count unchanged; no new test file. **Functions and rules
are unchanged, and that is the evidence this stayed a client-only change** — the
rules surface never moved.

**What that bar does NOT cover, and it is the whole point of this piece of
work:** nothing here was *exercised* against a live Firebase project — no
session container has ever held a service-account credential — so G6's fix is
verified against the **rules emulator and jest only**. It is nonetheless
**deployed to the dev project**: CI ships `database.rules.json` on every push to
`dev`. "Not verified live" and "not live" are different claims — on dev the
guard is active and untested; on prod it is absent until `dev` → `main`.

This bar was not green on the first pass at this tip minus one commit
(`8a0ff62`): `tests/cacheOwner.test.js`'s drift guard ("every statusapp_ key in
js/ is classified") failed, because `js/store.ts`'s new
`statusapp_following_server_seen` key (`8620702`) had never been added to
`js/cacheOwner.ts`'s classification lists. **The guard did exactly what it was
built for** — catching a new `statusapp_*` key that skipped its account/device
classification decision before it could leak an old account's cache across an
owner change, the same class of leak two of this repo's own reviews had
already walked past once (see the landmine below). Fixed in `94c9aa6`, ruled
**account-scoped**: the key records whether a given ACCOUNT's server-side
following list has been seen on this device, so it must clear alongside
`statusapp_following` on an owner change, or a newly-switched account inherits
the previous account's migration heuristic — exactly the inherited-cache leak
`js/cacheOwner.ts`'s header exists to prevent.

Web movement from the `864de74`/`edb528c` bar (2123/88): **+7** — 4 new cases
in `tests/following.test.js` (the client gate, exercised through the
`watchFollowing` callback, not the branch directly) and 3 in
`tests/store.test.js` (`hasSeenServerFollowing`/`markServerFollowingSeen`).
Suite count unchanged; no new test file. Rules movement: **+7**, all in the
new `tests/rules/g6-following-referent.test.js` (the 12-suite rules run was
not tracked in this file before this branch — 115/115 is this run's own
baseline, not a delta). Functions is **unchanged** at 941/941 (32 suites) —
nothing in this plan touches `functions/`.

**G9 + G10 closure, green bar OBSERVED on this feature branch (2026-08-03) at
the tip that closes both** — baseline `6c45ff5` (web 2132/2132 in 88 suites ·
functions 941/941 in 32 · rules 116/116 in 12 · typechecks clean · build OK):

- web jest **2138/2138** (88 suites, unchanged) — **+4** in `tests/db.test.js`
  (the three planted-violation regressions for the fan-out filter, fail-open
  read, and reservation ordering, plus one no-followees edge case) and **+2**
  in `tests/invites.test.js` (G10's write-order and refused-write
  regressions), net **+6** over the `6c45ff5` baseline
- functions **941/941** (32 suites) — **unchanged**, nothing here touches
  `functions/`
- rules (emulator) **116/116** (12 suites) — **unchanged**,
  `database.rules.json` is untouched
- `typecheck` + `typecheck:scripts` — clean
- `node scripts/prod.js` — builds

**Same scope note as G6's bar above:** this is jest and the rules emulator
only. No session container has ever held a service-account credential, so
neither G9's fix nor G10's fix has run against a live Firebase project, and
neither item was ever device-observed in the first place — both were found
by reading, in the review that closed out G6.

Functions movement from the `22abc8a` bar (919/31): **+12** in
`ops-merge-fixture.test.js` for the mapping shapes, **+5** in a new suite
(`ops-merge-cli.test.js`) that spawns both merge-leg CLIs, **+5** in
`ops-server.test.js` for G8. Web is untouched throughout that prior move.

Prior bars: `22abc8a` functions 919 (31). `2bf54b7` functions 916 (31). `2dec78c` functions 909 (31). `5f4dcd5` functions 879 (30). `0f31553` functions 857 (28).
`373b7ec` functions 842 (27).
`f38f5cb` functions 807 (26).

**Run the gates from the repo root.** A `cd functions` in an earlier command
lingers in the session shell, and from there `npx jest` runs the ROOT config
against the functions tree (27 suites "fail", 0 tests) while `npm run
typecheck` errors out as an unknown script. Worse, piping either to `tail`
returns tail's exit status, so an `&&` chain sails past the failure and prints
its own success line. Both traps fired in one command this session.

Movement from the `8f9ccd1` bar (2106/736), all from the six commits below:
+11 functions tests for `withEnvFile`; +28 for the panel's availability and
duration projections; +7 for the purge session handling; +13 for the Auth probe;
−5 as `humanDuration`'s cases moved into the shared fixture. Web +17: 15
`humanDuration` vectors plus 2 new rows on the existing formatter loop. Nothing
pre-existing changed shape.

**Shipped 2026-08-02, all on `dev`** (read the commit bodies, not this list —
each carries its evidence):

- `0c43518` the panel reads `GOOGLE_APPLICATION_CREDENTIALS_JSON` and
  `TELEGRAM_UID_SECRET` from `functions/.env`; command line still wins.
- `f0a8912` the accounts table shows real availability (the stored `status`
  string is not the answer — availability is timed) and legible ages.
- `db6bbb0` `humanDuration` moved to `shared/timeFormat.js`, pinned on both
  sides by `test-fixtures/time-format-vectors.json`.
- `2531164` purge ends the purged account's session; G2 closed.
- `bc5e91a` `ops/verify-auth-delete.js`, the Auth probe.
- `3fe25c3` narrowed what the session handling claims, to match what was
  measured; G3 filed.
- `71bb86c` `ops/restore-preimage.js` + 35 tests — undo a purge from its
  pre-image dump. Dry-run by default, one atomic update with `--yes`, its own
  `op: restore` audit dump.
- `373b7ec` the smoke-test results table, G4, the runbook section, and this
  file.
- `a0119a8` the restore's dry run now sweeps a purge for residue. Its transient
  branch had the live value in hand and discarded it; it now reports `gone` /
  `present` per path plus the surviving keys, and the CLI prints a
  `RESIDUE SWEEP` block. Restore behaviour is unchanged and the 35 pre-existing
  cases pin that. +8 tests.
- `0f31553` expunge and graduation now take `pushTokens/{uid}` with them — a
  real production defect, found by `integrity.js` on a live purge and filed as
  **G5**. +7 tests in a new file.
- `e5099d0` the relocation landmine corrected (it named readers only, which is
  what let G5 ship) and this file reconciled.
- `1f639ee` a purge now releases an owned group's `groupIdIndex` lock and the
  index rows of every invite issued in it — **G7**, found the same way. Also adds
  peer-republish detection to the restore's dry run — **G6**.
- `2fcc51f` `inviteIndex` keeps its `{scope, ownerPath, ownerUid}` shape through
  a graduation and a merge; both had been writing malformed entries that silently
  killed the invite preview. **This is where `telegram-auth.test.js`'s 0-line
  diff deliberately ended** — see the ⚠️ above.
- `ae467b3` the ops README's destroy table said the opposite of what purge does.
- `5f4dcd5` `functions/test/expunge-completeness.test.js` — the guard that fails
  when a new top-level node in `database.rules.json` is not classified against
  the expunge. Verified by planting three violations, not by passing.

**Shipped 2026-08-03, on `claude/knockknock-operator-followups-1kyjy6`** — pushed,
awaiting the maintainer's merge to `dev`:

- `53d4789` the plain-merge teardown branch ran on dev, 61/61 — docs only.
- `1d3a235` `--mapping-shape <loser|third-party|no-uid|absent|survivor>` on
  `ops/seed-merge-fixture.js` and `ops/verify-merge.js`, so the four holders of
  `telegramUsers/{tgId}` that `merge.js:389` REFUSES can be seeded and read back.
  The claims differ per shape; a mismatch would report a correct merge as owed,
  so a shape without `--telegram` or combined with `--repoint` is refused before
  the credential is read. +17 tests, verified by planting four violations —
  **one of which stayed green**, and its gap is recorded in the commit body.
- `44dc688` the four shapes ran on dev — 62/62, 62/62, 61/61, 61/61 — docs only.
- `864de74` **G8** fixed: `revokeRefreshTokens` throwing `auth/user-not-found` no
  longer refuses the purge. Also records the residue sweep's `✗` branch and the
  `PEER REPUBLISH` block, both run for the first time.

**Shipped 2026-08-03, all on `dev`** — the merge leg:

- `1aa6efa` `ops/merge-fixture.js` (pure: the seed write-set, the read-back
  assertions, one verdict function) plus two thin CLIs over it,
  `ops/seed-merge-fixture.js` and `ops/verify-merge.js`, and 26 tests in a new
  suite. The assertions are pinned by driving the fixture through the **real**
  `buildMergePlan`/`applyMergePlan`, so they cannot drift from `merge.js`.
  Verified by planting three violations, not by passing. Also documents **M8**
  (`adoptGroupNames` has no UI, which is why the per-group name carry must come
  from a loser-only group) in the README and the smoke test.
- `501dfb5` **M8** and **M9** filed in `docs/operator-panel-followups.md`, with
  M9 flagged as not belonging in the minors section it is filed under.
- `2dec78c` the verifier reported a CORRECT merge as owed — `equals` compared
  `JSON.stringify` output and RTDB returns keys in its own order. Now an
  order-insensitive deep compare for records, order-SENSITIVE for arrays, with
  sorted-key failure rendering. Found on the first live run, after a green suite.
- `3e1f0c8` the smoke test recorded complete; **S1 closed**.
- **The two telegram merge variants' assertions strengthened** — link via merge
  had only THREE claims against the plain merge's 57, so a green run would have
  been weakly earned. `buildLinkWrites` writes five paths and the prefs side is
  where the loud failures live (`telegram-prefs-disagree` and
  `telegram-channel-unroutable` are both integrity ERRORS), and none of it was
  checked. Now 65 claims for link via merge and 61 for plain-plus-telegram, with
  the runbook for each in `functions/ops/README.md`. Behaviour unchanged —
  `merge.js` was already right; the verifier was not looking.
- **M9 closed** — `restore-preimage.js` now refuses a dump whose `op` is not
  `purge` (`opGuard`, +7 tests). An **allowlist**, so an absent or unrecognised
  `op` is refused rather than assumed; it fires on a **dry run** too, because the
  dry run writes nothing but its verdicts and its `RESIDUE SWEEP` are the
  misleading part; override is `--i-know-this-is-not-a-purge`. Verified by
  planting two violations **and** by running the CLI against fabricated merge /
  purge / no-`op` dumps — the pure function having tests says nothing about the
  wiring, which is the mistake the `ops/**` import guard made twice.

⚠️ **`functions/test/telegram-auth.test.js`'s 0-line diff ENDED, deliberately,
with the `inviteIndex` fix.** Read this before concluding the file drifted.

For most of the branch it had a 0-line diff, and that was the standing proof the
`expungeDerivedAccount` split preserved shipped behaviour. It survived FOUR
deliberate changes to live expunge behaviour (`4dea508`, `0f31553`, `1f639ee`,
and the graduation move inside `0f31553`) because each time the new coverage went
into its own file — `crossref-locations.test.js`, `expunge-push-tokens.test.js`,
the additions to `ops-expunge-build.test.js`. **That is still the pattern to
follow**, and it is still the first thing to try.

It stopped working for the `inviteIndex` fix because the suite did not merely
fail to cover the behaviour — it **asserted the bug**. Line 580 read
`expect(deps.store['inviteIndex/TOK1']).toBe(NEW)`, pinning a bare-uid write
where the schema and `database.rules.json:56` require
`{ scope, ownerPath, ownerUid }`. No amount of new coverage elsewhere changes an
assertion that names the old value directly, so honouring the invariant would
have meant keeping a live production defect *because a test asserted it*.

**Exactly one assertion changed**, in the same commit as the behaviour, with the
reasoning in the commit body and the full write-up in
`functions/test/graduate-invite-index.test.js`. Nothing else in the file moved.

The rule going forward: the invariant is refactor-safety, not a freeze. A red in
that file still means "the refactor is wrong" **unless** you can show the
assertion itself encodes a defect — and then you change that one assertion, in
the behaviour's own commit, and say so here.

**What green does NOT cover:** no session container has ever held a
service-account credential, so nothing in a session has contacted a real
Firebase project — the panel, the Auth probe, `ops/restore-preimage.js` and the
merge-leg pair (`ops/seed-merge-fixture.js`, `ops/verify-merge.js`) are all
operator-machine tools, and their test numbers cover decision logic, not live
behaviour. That gap is not academic: the verifier passed 30 tests and still
reported a CORRECT merge as owed on its first live run (`2dec78c`).

What HAS been exercised on the operator's machine is **the whole smoke test**:
steps 1-8 and 10 plus step 9's purge side (2026-08-02), and step 9's merge leg
(2026-08-03). Concretely — `deps.js`, `panel.html` in a real browser, the
`Host`/`Origin` guard, three live purges (one with the Auth-record box ticked,
probed either side), one live restore driven from its pre-image, the
`RESIDUE SWEEP` clearing an owned group's whole cells node, the integrity report
over live data (which surfaced G5, G6 and G7), one live plain merge with 57/57
read-back claims holding, one live **link via merge** with 65/65, and one live
**plain merge of a Telegram-linked loser** with 61/61 — the two Telegram variants
being opposite branches of the same `if` (`merge.js:351` vs `:385`), so each
needed its own run.

**The teardown branch's four other mapping holders also ran (2026-08-03)**, via
the `--mapping-shape` flag added the same day: `third-party` 62/62, `no-uid`
62/62, `absent` 61/61, `survivor` 61/61. Three of the four are REFUSALS — the
mapping must survive — and each carried a `telegram-mapping-not-owned` conflict
in the preview with no loss line claiming a delete. Their pre-merge
`telegram-mapping-asymmetric` ERROR is the state being seeded, not a finding, and
both CLIs say so. This also settled a wiring question the tests could not reach:
had the flag been dropped between the CLI and the fixture, a `third-party` run
would have seeded the loser shape and come back owed. It did not.

**The last two renderings ran on 2026-08-03, and the list is now empty.** A
seeded fixture's loser was purged and two paths were replayed out of its own
pre-image: the dry run printed `RESIDUE SWEEP` with `swept: 7`, one `✗`
(`locations/smk-res1-loser`, `keys: lat, lng, updatedAt`), and a
`PEER REPUBLISH` block naming `smk-res1-follower`.

⚠️ **Rendering observed, causation NOT.** An operator credential wrote those
values back, not a peer's client in the G3 window — so the block's "that
account's own client put it back" is false in that run. It exercised the
classification, the attribution and the text; the live G6 sighting is still the
one from 2026-08-02, and this run must not be cited as a second.

## On-ramp

Read in this order; stop when you have what you need.

1. This file — the source of truth for "where things are."
2. `docs/operator-panel-followups.md` — every open item with a stable ID
   (**G1**, **G3**, **M1–M9**), each with `file:line` and why it
   was left, plus closed-but-instructive **S1**, **G2**, **G4**, **G5**, **G6**,
   **G7** and **G8**. Read **G6** before purging anything real: the rules guard that
   closes it is verified against the emulator only, is **live on dev** (CI
   deploys rules on every push to `dev`) and **absent on prod** until
   `dev` → `main` — so a prod purge or merge is exactly as exposed as before,
   and a dev one is covered by a guard nobody has exercised. Cite the IDs
   rather than re-describing the items.
3. `docs/operator-panel-smoke-test.md` — the ten-step script and its filled-in
   results table (**all ten pass**), "What a restore cannot recover", and the
   two merge variants the run did not cover.
4. `functions/ops/README.md` — the panel's runbook: how to start it, what each
   action destroys, why purge ends the session, how to read a pre-image back,
   how to restore from one (`ops/restore-preimage.js`, and the four things it
   will not do without an explicit flag), and how to seed and verify a merge
   (`ops/seed-merge-fixture.js`, `ops/verify-merge.js`).
5. `CLAUDE.md` (auto-loaded) holds the binding conventions — read it.

Per-feature detail: `docs/superpowers/plans/` and the matching git history.

## Environment

Commands (all from repo root unless noted):

| Purpose | Command |
|---|---|
| Web tests | `npx jest` (use `--maxWorkers=2` — default workers can OOM the container) |
| Cloud Functions tests | `cd functions && npm test` (return to repo root after!) |
| Rules tests (emulator) | `npm run test:rules` |
| Typecheck (strict) | `npm run typecheck && npm run typecheck:scripts` |
| Production build | `node scripts/prod.js` |
| Shared-code mirror | `npm run sync-shared` (shared/ → functions/_shared/) |
| Dev server (LAN, live-reload) | `node scripts/dev.js` |
| Operator panel | `cd functions && GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)" node ops/server.js --project <id> --prod-project <prod-id>` |
| Auth probe (revokes; `--yes-delete` deletes) | `cd functions && node ops/verify-auth-delete.js --project <id> --uid <uid> --prod-project <prod-id>` |
| Restore from a pre-image (dry run; `--yes` writes) | `cd functions && node ops/restore-preimage.js --file .ops-audit/<ts>-purge-<uid>.json --project <id> --prod-project <prod-id>` — **purge dumps only**, it refuses anything else (M9) |
| Seed a merge fixture (dry run; `--yes` writes, `--clean` removes) | `cd functions && node ops/seed-merge-fixture.js --project <id> --prod-project <prod-id> --tag <tag> [--telegram]` |
| Verify a merge (reads only; non-zero exit if anything is owed) | `cd functions && node ops/verify-merge.js --project <id> --prod-project <prod-id> --tag <tag> [--telegram] [--repoint]` |

The panel and the probe need a **service-account credential, which has never
existed in any container this was built in** — they are operator-machine tools.
`TELEGRAM_UID_SECRET` and the credential are both read from `functions/.env` if
present, so the inline prefix is optional; anything on the command line wins.

Fresh-container setup (deps aren't pre-installed):

```
apt-get update; apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
npm ci ; cd functions && npm ci
```

Use `;` not `&&` in the apt line — the deadsnakes/ondrej PPAs 403 behind the
proxy and would abort an `&&` chain. Functions deps are required for
`npm run typecheck`.

## Conventions

- `dev` is the integration branch. Cut feature branches from `dev`.
- Do feature work on the feature branch and push it; **the maintainer merges to
  `dev` (and `dev` → `main`)**. Don't merge to `dev`/`main` yourself, and don't
  create PRs, unless explicitly asked. (When asked, that authorization stands —
  ask *how*, then do it.)
- Zero TS suppressions. `typecheck` + `typecheck:scripts` must stay green.
  Sweep for **all** the forms, not just the TS-syntax ones — the ops-panel plan
  shipped two `/** @type {any} */` casts past reviews that grepped only for
  `as any`, one of them in production panel code:
  `as any`, `@ts-ignore`, `@ts-expect-error`, `@type {any}`, `{any}`, `: any`,
  `<any>`. The last three also match honest boundary annotations
  (`Promise<any>` on a raw RTDB read seam); read each hit, do not assume.
- Set committer identity first (`git config user.email noreply@anthropic.com &&
  git config user.name Claude`) or the stop-hook flags commits Unverified and
  forces amend+re-push.
- Never hand off red: run all four gates before wrapping.
- The stop-hook at turn end is the standing commit+push prompt — commit then,
  not unprompted mid-turn. (The plan's per-task commit steps are
  operator-sanctioned: committing at each task boundary IS the instruction.)

## Working style (operator)

- The operator drives the loop. Terse cues ("go", "a", "y") mean proceed — don't
  re-explain. Scale ceremony to stakes.
- Open action lines with a gerund ("Reading…", "Verifying…"), no first-person voice.
- At real forks, present bounded A/B/C choices with a recommendation; decide the
  rest yourself.
- Separate **OBSERVED** from **UNKNOWN**. Never call something done/fixed/working
  from a single run. "Done" is the operator's call — expect hands-on iteration on
  anything visual.
- Don't commit / push / merge / bump versions unprompted.

---

## Landmines (read before touching code)

- **A roadmap prescription is a hypothesis, not a spec — verify it before
  implementing it.** Three of the six security-audit items shipped differently
  from what `docs/security-audit-2026-08-04-roadmap.md` proposed, and each
  departure was found by *checking*, not by reading harder: SEC-7's suggested
  CSP (`default-src 'none'`) would have blocked the panel's own `fetch` and
  served a blank page; SEC-5's "Test: N/A (config)" was wrong (`git
  check-ignore` tests it directly); SEC-4's "normalize the key" would have left
  an empty uid writing a whole top-level node, so it ships as a refusal. The
  same doc is still the source of truth for what is OPEN — read the CLOSED
  entries first to calibrate how much its prescriptions are worth.
- **Two verification techniques worth reusing, both offline.**
  * *Real-SDK path probe.* `firebase-admin` validates `ref()`/`update()`
    arguments synchronously, before any network, so a plain node script with a
    fake `databaseURL` and no credential settles questions like "what path does
    `users//` actually name?" (`/users`) and "would the SDK reject this
    write-map?". This is how SEC-4 was confirmed rather than argued.
  * *Real-browser panel smoke.* Unit tests cannot tell a hardened panel from a
    broken one. Serving the real `panel.html` through the real
    `createHttpServer` in headless Chromium against canned routes catches a CSP
    that blanks the page. `playwright-core` is **not** a repo dependency —
    install it into a scratch dir (`npm install playwright-core --no-save`) and
    launch with `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`.
    Never add it to `package.json` for a one-off. And check the harness itself:
    plant the breakage and confirm the smoke goes red, or a green run proves
    nothing.
- **This repo's docs fail on claims about CONSEQUENCE, not on claims about
  MECHANISM — and no test catches either.** A 2026-08-03 audit checked the
  load-bearing factual claims in these docs against the code. Descriptions of
  *what code does* held up almost everywhere; the failures were all assertions
  about what that **means**, and each one would have changed a risk judgement:
  * "`13cb18c`+`e2dde4e` are an undeployed RULES change … a live project stays
    exactly as exposed to G6 as before" — CI deploys on push to `dev`; the guard
    had been live on dev for hours;
  * G1's "the survivor silently gains ownership of a shared group" — `role` is
    write-only, read by nothing; real ownership is `ownerId` and it IS covered;
  * G9's "reused rather than re-derived, so the two cannot drift apart" — two
    independent hand-written copies of the predicate (**M12**, since CLOSED by
    building the tie the claim assumed: a test that derives the client's node
    path from the rules' own `.validate`);
  * M10, found by a review rather than the audit, is the same shape: a guarded
    path nothing tied to what the client writes.
  Three of the four asserted **impossibility or equivalence** ("cannot drift",
  "exactly as exposed", "gains ownership"). That phrasing is the tell. Before
  writing one, ask what artifact enforces it — if the answer is "they agree
  today, by inspection", write *that* instead, or build the tie.
  A **fifth kind** turned up on 2026-08-03, and it is cheaper to make and harder
  to see: a summary sentence that names a category which is EMPTY. Both docs
  said what remained was "the five WON'T FIX rulings, the parked G3, and the
  deferred minors nobody promoted" — the third clause is the same four M-items
  as the first, so it invented a third pile of leftover work that does not
  exist. The operator caught it by asking which items it meant. A list in a
  summary is a claim: count it against the table before writing it.
  Line numbers are a lesser, separate problem: several citations had drifted
  10-100 lines (`ops/project.js:69`→`:88`, `ops/server.js:359,385`→`:462,664`,
  `merge.js:212-213`→`:221`) while being exactly right about the behaviour.
  Fix them when you touch the entry; do not trust one as a landmark.
- **"Nothing deploys from sessions" is TRUE and it is not the whole sentence —
  CI deploys on push, and `dev` is ungated.**
  `.github/workflows/deploy-dev.yml` fires on `push: branches: [dev]` and runs
  `firebase deploy --only hosting,database,functions` against the dev project.
  There is no `environment:` key on its deploy job, so nothing approves it.
  `deploy-prod.yml` is the same deploy on `main`, and *that* one carries
  `environment: production` — the required-reviewer gate everyone remembers.
  So merging a feature branch to `dev` **ships rules, hosting and functions to
  the dev project within minutes**, with no operator action at all.
  **This file said the opposite for a whole branch.** It described
  `13cb18c`+`e2dde4e` as "an undeployed RULES change" and told readers "a live
  project stays exactly as exposed to G6 as it was before this branch" — both
  written from "nothing deploys from sessions", which is true of *sessions* and
  silent about *CI*. The G6 rules guard had in fact been live on dev since the
  `8ad9ef0` merge (deploy-dev run 2026-08-03T13:17:49Z, success). The error was
  caught by the operator reading a summary, not by any check in the repo.
  **The rule: say which PROJECT.** "Undeployed" alone is not a state — write
  "live on dev, undeployed to prod". And keep **deployed** apart from
  **verified**: CI shipping a rules change proves the deploy ran, never that
  anyone exercised the guard. Before claiming an exposure still stands, check
  `git log origin/dev` for the commit and the workflow run for the push.
- **An invariant documented INSIDE a function can be a property of its CALL
  SITE, and reordering callers breaks it with that function untouched.**
  `registerAsFollower` (`js/db/social.ts`) clears `revocations/{me}/{target}`
  before setting the followers entry, and its own comment says why: the
  receiver's revocation watcher can fire on either write, and observing the
  followers set while the key is still there fires an auto-unfollow on the
  relationship just established. G10's fix reordered two *callers* in
  `js/invites.ts` — that function's body never changed, its internal ordering
  still held, and the invariant broke anyway, because what mattered was that
  the clear precede the *following* write, which now happened outside it. The
  design spec asserted "this does not touch it" and was wrong; only the
  whole-branch review caught it. **Fixed by extracting `clearRevocation` and
  hoisting it at the call site**, so the ordering is preserved by construction
  rather than by which function happens to run first. When you reorder calls,
  read the comments inside the functions being reordered and ask whether the
  ordering they promise is theirs to keep.
  **The hoist is gone, and so is what it cost (M11).** Hoisting made the clear
  precede a write the G6 guard can refuse, so a refused redemption dropped the
  key the redeemer's own watcher prunes on. Ordering could satisfy one
  constraint or the other, never both — the general lesson, worth more than the
  bug: when two constraints pull opposite ways on the ORDER of two writes, stop
  sequencing them and make them ONE write. `setFollowingEntryClearingRevocation`
  (`js/db/social.ts`) issues both paths in a single multi-path `update()`, so
  RTDB applies them together or not at all: the invariant holds by construction
  and a refusal rolls the clear back with it. The all-or-nothing behaviour is
  the load-bearing assumption and jest cannot see it — it is pinned on the rules
  emulator in `tests/rules/g6-following-referent.test.js`.
- **An existence check is only as strong as who can create the node it checks
  (G6).** `database.rules.json`'s new guard on
  `userPrefs/$uid/following/$followee` needed to answer "does this account
  exist," and a bare `users/{T}.exists()` would have been the obvious
  predicate — and worthless. There are **three** non-owner writers under
  `users/$uid`, not two (**G6-review finding M5** — that review's own
  numbering, NOT the followups ledger's stable **M5**, which is an unrelated
  `ops/audit.js` retry cap): `users/$uid/followers/$follower`
  and `followerNames/$follower` are writable BY the follower, so a peer's own
  `registerAsFollower` call creates the `users/{T}` node moments before
  `setFollowingEntry` runs (`following.ts:1518-1520`), satisfying the weak
  predicate every time with no real account behind it — and
  `users/$uid/invites/$token/redemptionsUsed` grants `.write: "auth != null"`
  to **any** signed-in uid, for any `$uid`/`$token` (`database.rules.json:34-38`),
  so redeeming someone else's invite link creates the same node with nothing
  more than a token guess behind it. (A sibling `.validate` at
  `database.rules.json:37` bounds a non-owner to writing exactly `prior + 1`,
  so the write is not unconstrained — but `1` into a node that does not exist
  passes, and **creating the node is the whole of what the forgery needs**.
  Named here because the `.write` alone reads more open than it is, and a
  reader who spots the `.validate` should not conclude the landmine is wrong.) The guard checks `presence/code` instead
  — no client can write another account's presence, so the owner-only
  ancestor rule on `users/$uid` actually holds there. Before adding a
  `.exists()` predicate to a rule, ask who else's write can plant the thing
  you're checking for.
- **A new `localStorage` key is not done when it's written and read — it also
  has to be classified.** `js/cacheOwner.ts`'s drift guard
  (`tests/cacheOwner.test.js`, "every statusapp_ key in js/ is classified")
  fails until every `statusapp_*` key found by scanning `js/**` is named in
  `ACCOUNT_SCOPED_KEYS`, `DEVICE_SCOPED_KEYS`, or one of their prefix lists —
  it exists precisely so a key that skips that decision fails loud instead of
  silently surviving an account switch. It caught exactly that on this branch:
  `statusapp_following_server_seen` (`8620702`) shipped three commits before
  anyone classified it, and the drift guard — not either of the reviews those
  three commits went through — is what surfaced it, fixed in `94c9aa6` as
  account-scoped (it records whether a given ACCOUNT's server list has been
  seen, so an owner change must clear it same as `statusapp_following`, or the
  new owner inherits the old account's migration heuristic). Classify a new
  `statusapp_*` key in the same commit that introduces it.
- **A fail-closed guard must say what the BENIGN absence is (G8).** The purge
  revoked refresh tokens before its write and refused if that threw — correct for
  an account whose session it could not end, and wrong for an account that has no
  session at all. `revokeRefreshTokens` throws `auth/user-not-found` for a uid
  Firebase Auth has never seen, so every RTDB-only account was refused: every
  `ops/seed-merge-fixture.js` account, and every synthetic account the runbook
  prescribes as the ONLY mitigation for G3 and G6. "Refuse unless the dangerous
  thing succeeded" and "refuse unless the dangerous thing was possible" look
  identical in code. Fixed with an allowlist of one code (`server.js:720`), like
  `opGuard`; `readAuthIdentity` already did this and the revoke did not, so the
  precedent was sitting two hundred lines away. **Nothing in a session can reach
  the Auth path** — no container has a service-account credential — so this class
  of defect is operator-run-only, every time.
- **RTDB returns an object's keys in ITS order, not the order you wrote them, so
  `JSON.stringify(live) === JSON.stringify(expected)` is a false-negative
  generator.** Cost a live run on 2026-08-03: `ops/verify-merge.js` reported
  `inviteIndex/{token}` owed against a merge that had written it exactly right —
  identical keys, identical values, shuffled order (`2dec78c`). Compare records
  with a deep, order-INSENSITIVE equality (`merge-fixture.js`'s `deepEqual`) and
  keep arrays order-sensitive. The general lesson is worth more than the bug: a
  verifier that cries wolf on a correct destructive write is worse than no
  verifier, because the operator's next move is to hunt a defect that is not
  there. A green test suite says nothing about this — 30 tests passed over it.
- **`ops/restore-preimage.js` reads PURGE dumps only (M9).** Every verdict in it
  assumes a purge nulled every path in its write-set. A merge dump breaks that in
  both directions, and `--yes` against one would partially resurrect the
  merged-away account. `opGuard` now refuses anything whose `op` is not `purge` —
  an allowlist, and it fires on a dry run too, because the dry run's verdicts and
  its `RESIDUE SWEEP` are the misleading part. Read other dumps with `jq`. There
  is **no merge equivalent of a restore**: plan a merge as one-way.
- **Testing a pure function proves nothing about whether it is wired in.** The
  `ops/**` import guard passed against a planted violation this way once, and
  M9's guard was verified against fabricated merge / purge / no-`op` dumps by
  running the CLI, not only by unit tests. When you add a guard, plant a
  violation AND exercise the entry point.
- **A purge does not survive a client that was open when you ran it (G3).** The
  panel revokes the account's refresh tokens before the write, but revocation
  does NOT evict a live session: an ID token already in the client's hands is
  honoured until it expires, because `database.rules.json` never checks
  `auth.token.auth_time`. Measured on dev 2026-08-02 — writes still landed 33
  minutes after the revoke and were refused by 66, bracketing the token's
  one-hour expiry. The window runs from the client's last open, so revoking
  sooner does not shorten it. **Close the account's clients before purging.**
  This is how the first step-9 run produced an hour of false residue:
  `userPrefs/{uid}` came back holding its cached `following` list after a purge
  that had correctly deleted it.
- **A pre-image undoes what the purge WROTE, never what it CAUSED (G4).** The
  dump is the purge's write-set, so a cascade the purge merely triggered is not
  in it and no restore can replay it. Live case, device-observed 2026-08-02:
  purging a group's OWNER nulls `groups/{gid}` wholesale, and every other
  member's client then deletes its own `users/{member}/groups/{gid}` entry
  (`js/groupNav.ts:250-258`, `js/groupContext.ts:1499-1508`) because an owner
  cannot write another user's record. Restore the group and it comes back real,
  membered, and **invisible in every other member's nav** — the owner sees the
  members, the members do not see the group. `integrity.js:103`
  (`group-enumeration-missing`) reports exactly that state.
  `ops/restore-preimage.js --heal-group-enumeration` rebuilds the entries from
  the restored member list; it is derived repair, not recovery, and says so.
- **Neither revoking nor deleting the Auth record retires a uid.** Telegram uids
  are `deriveTelegramUid(tgId, secret)` — deterministic — and the app mints a
  fresh custom token from initData on every open, so a token issued *after* the
  revocation time yields a valid new session. Confirmed: reopening produced a
  new Auth record under the same uid. `deleteAuthRecord` buys "an already-open
  client cannot republish its cache", nothing more.
- **The `outcome` field inside a per-op audit dump ALWAYS reads `pending`.** By
  design (`ops/audit.js:230-232`): the resolution is appended to
  `.ops-audit/audit.jsonl` as a second line correlated by `ts`, never written
  back into the dump. Read the outcome from the log. A dump saying "the
  destructive write has not been issued yet" says nothing about whether it was.
- **`ops/audit.jsonl` records `uids` (an array), not `uid`.** `jq '{uid}'`
  silently yields null on every line and reads like a bug in the audit trail.
- **Hosting serves Cloud Functions source today.** `hosting.ignore` omits
  `functions/**` while `hosting.public` is `"."`, and Firebase Hosting does
  NOT auto-exclude the functions source dir — it uploads everything under
  `public` minus `ignore`. Confirmed live 2026-08-01 (200 on
  `/functions/telegram-auth.js`). Not a secret leak (public repo, secrets in
  env) but it is server-side code on a public URL. Ops-panel plan Task 1
  fixes it and pins both lists with a test. **Related trap:** specifying
  `functions.ignore` **replaces** the CLI defaults — re-list `node_modules`,
  `.git`, `firebase-debug.log`, `firebase-debug.*.log` or the deploy archive
  balloons.
- **`crossRefRenderers` in `functions/telegram-auth.js` is the ONE residue
  enumerator.** Expunge and graduation share it deliberately so a new
  cross-user residue family can't be added to one and missed by the other
  (the reason `followerNames` had to land in both). The ops panel's merge
  becomes its third consumer. Add new families THERE, never in a consumer.
  Pinned by the parity test in `functions/test/ops-merge.test.js`
  ("parity with the shared residue enumerator").
- **`crossRefRenderers` now enumerates the location families and the
  unjoined-invite entries (`4dea508`) — the old "known gap" is CLOSED.** It
  emits `locations/{u}`, `locationCells/{gid}/{u}` for each member gid, and
  `pendingInvitesByGroup/{gid}/{u}` for gids taken from the account's own
  `pendingInvites/{uid}` mailbox (groups it was invited to but never joined —
  `groups` cannot see those). Both `buildExpungeWrites` and
  `graduateAccountData` read that mailbox now. Three consequences to know:
  (a) expunge DELETES a location fix and graduation MOVES it, where both
  previously left it behind — live behaviour changed, covered by
  `functions/test/crossref-locations.test.js`, NOT by
  `functions/test/telegram-auth.test.js` (whose 0-line diff is preserved);
  (b) the new families are appended AFTER the pre-existing ones so the
  graduation walker's move order — which its consumed-source dedup depends on
  — is untouched; (c) an owned group is deleted wholesale, which would strand
  *other* members' cells, so `buildExpungeWrites`' owned-group block nulls
  `locationCells/{gid}` entirely, beside the `pendingInvitesByGroup/{gid}`
  null already there. `rootUpdate` drops the enumerator's per-uid nulls under
  it as redundant deletes.
- **Shipped `functions/*.js` may NEVER import from `functions/ops/` at
  runtime.** `functions.ignore` excludes `ops/**` from the deploy archive, so
  such an import deploys cleanly and then dies at cold start on a missing
  module, taking whatever callable it backs down with it — with every
  repo-side test green, because the file is present in the repo. This is why
  the shared Telegram mapping builder lives at
  `functions/telegram-link-write.js` and not under `ops/` (`16e5ae9`), and
  why the documented "make `performLink` call `ops/link-write.js`" follow-up
  could not be executed as written. Pinned per-file by
  `tests/firebaseConfig.test.js` ("shipped functions code never imports the
  ops panel"). A JSDoc `import('./ops/types.js')` is a TYPE reference, erased
  before it runs, and is allowed — the guard skips comment lines. **Do not
  "simplify" that guard into a block-comment regex strip:** the first version
  did exactly that and passed against a planted violation, because the `/*`
  inside the prose `` `ops/**` `` opened a match that ran to the next `*/` and
  ate the import statements in between.
- **The ops panel binds `127.0.0.1` only** (`functions/ops/server.js`). It
  holds a service-account credential in-process for the life of the run —
  never bind it to `0.0.0.0`, pass `--host`, or put it behind a tunnel or
  reverse proxy; there is no such flag on purpose. Loopback binding alone
  doesn't stop DNS rebinding, which is why the server also checks `Host` and
  `Origin` on every request (see `functions/ops/README.md`).
- **`uid = sha256(phrase)` is one-way, so "has a phrase" is not observable.**
  It's inferable: uids come from exactly three paths (web `initUser`,
  Telegram bootstrap via `deriveTelegramUid`, graduation), so not-derived ⇒
  phrase-born. And graduated-vs-linked is a **heuristic** —
  `userPrefs/{uid}/telegram/linkedAt < telegramUsers/{tgId}.linkedAt` means
  graduated, because `performLink` writes both in the same update while
  graduation copies the prefs subtree wholesale. It reads "linked" for a
  graduated account that later re-links. Don't present it as fact.
- **Production's Telegram link DESTROYS a derived account.** `performLink`
  calls `expungeDerivedAccount` on a standalone derived account
  (`functions/telegram-auth.js:210`), and the only warning
  (`redeemTelegramLinkTokenHandler`) counts just followers/following/groups —
  silent about owned groups (deleted for ALL members), canvases, and invite
  tokens. "contacts: 0, groups: 0" can still be a lossy link.
- **Direct available-text color follows `statusColor`, NOT the palette key color.** `js/following.ts`'s palette card branch must not re-set `.status-available`'s color to `palette.color`: the fuzzy-time label follows the member's status color so it agrees with the status dot, mirroring `groupContext.ts` ("fuzzy time follows status color, not theme"). Re-adding the override reintroduces the 2026-07-31 mismatch (dot one color, label the palette/border color) — visible whenever a member's `statusColor` differs from their palette's key color. Pinned by `tests/following.test.js` ("available span … keeps statusColor").
- **RTDB rules: a granted ancestor `.write` cannot be revoked by a child
  `.write`.** Under `users/$uid` (blanket self `.write`), enforcement must be
  `.validate` (doesn't cascade, skipped on delete) — that's why the
  `followers`/`followerNames` guards are `.validate` and the sibling `.write`
  narrowing is inert decoration. Same reason under `userPrefs/$uid`, which is
  why G6's `following/$followee` referential guard is `.validate` too. Under
  `groups/$gid` (owner-only ancestor), child `.write` narrowing IS
  load-bearing. Check the ancestor chain before judging or editing any rule.
- **Shallow clone → false "unrelated histories."** Fresh containers clone shallow
  (`.git/shallow`). Run `git fetch --unshallow origin` **before** any cross-branch
  merge/compare/ancestry check.
- **`cd functions` lingers.** Compound shell commands that `cd functions` leave
  the session cwd there — later `npx jest`/`npm run typecheck` silently run
  against the wrong package ("No tests found" / npm errors). Always
  `cd /home/user/on` first.
- **Location: distance-listener attaches MUST be gated on the own node existing.**
  The reciprocity rules make a listen that attaches before the viewer's own node
  exists get denied and **permanently cancelled** (the SDK never retries). That's
  what the per-context `_publishedContexts` set in `js/locationShare.ts` encodes
  (set on landed publish or boot-probe, cleared only on deletion paths) and why
  the surfaces' `reconcileDistanceSubs` passes key off `isContextPublished`.
  Dispatching eligibility before a write lands re-creates "distances silently
  dead."
- **Location: `evaluateAvailability()` is the single availability authority**
  (primary tick, per-gid statusStore tick, opt-in change, 60s tick head). Don't
  add availability dispatches elsewhere; don't remove the tick-head call — time
  lapses arrive with no data tick.
- **Location: never delete nodes on availability flaps.** Last-known is the
  feature; a delete cancels every peer listener via rules re-evaluation. Deletes
  belong to glyph-off / revocation / reset only. `toggleContext` off-branch
  orderings are load-bearing (gid snapshots BEFORE pref flips; group-off uses
  cells-only clear so the raw point never transiently vanishes). Regression
  tests pin all of this — trust a red test over a "simplification."
- **Location tests mock the db barrel** — jsdom suites can't see attach-time
  rules denials or listener cancellation; real-infra behavior differs. Debug
  "distance missing on device but tests green" at the rules/attach layer first.
- **Telegram `LocationManager.init()` calls back only on the FIRST init per
  session** (device-observed). `getPositionOnce` must keep the `isInited` fast
  path or every later read hangs forever (glyph un-retoggleable, ticks dead).
- **`shared/` is mirrored into `functions/_shared/` by `npm run sync-shared`** —
  never edit the mirror by hand; edit `shared/` and re-sync (jest + the
  fixture `test-fixtures/geo-vectors.json` pin parity).
- **Relocating an RTDB path requires sweeping every reader, every writer, AND
  every DELETE/MOVE path.** This landmine used to say "every reader", and that
  wording is exactly what let **G5** ship. F6c moved `pushTokens` off the
  `userPrefs` watch; the plan named only the notifier as reader, but review found
  TWO more (`functions/telegram.js` `/notifications` gate, `js/notifyChannel.ts`
  `accountHasPushTokens` pill) that read the old path. All three now dual-read
  (new-then-legacy) during the migration window; a later cleanup commit drops the
  fallbacks together. The reader sweep was done properly — and it was the wrong
  half of the job.
  **What it missed:** `pushTokens` used to live INSIDE `userPrefs/{uid}`, so
  `buildExpungeWrites`' wholesale `userPrefs/{uid}` null destroyed it for free
  and no code ever named it. After the move, nothing deleted it: every purge
  stranded `pushTokens/{uid}` under a dead uid, and `graduateAccountData` — which
  copies `users`/`userPrefs` wholesale — left a graduated account's devices
  registered to the OLD uid with no `pushTokens` node on the new one. Both
  reached PRODUCTION, since `performLink` calls `expungeDerivedAccount`
  (`telegram-auth.js:210`). Fixed in `0f31553`; the reasoning is G5 in
  `docs/operator-panel-followups.md`.
  **The rule, corrected:** when you move a node, grep the WHOLE tree (`js/` AND
  `functions/`) for the old path, and then separately ask *what used to delete
  this by accident* — anything that was destroyed as a side effect of a wholesale
  parent null now needs naming explicitly. A node that was never mentioned in the
  code is the dangerous case, because grep for the old path finds nothing.
  **How it was caught:** `integrity.js:187`'s `push-tokens-dangling`, on a live
  dev project. Not by tests (all green), not by four reviews, and not by the
  pre-image residue sweep — a path the purge never wrote is not in the dump, so
  the sweep is structurally blind to it (G4's boundary).
  **There is now a guard for the next one:**
  `functions/test/expunge-completeness.test.js` reads the top-level node list out
  of `database.rules.json` and fails until every node is classified and every
  own-account node is provably nulled at `{node}/{uid}`. If you add a top-level
  node, that test goes red until you say where the expunge stands on it — and
  `NOT_ACCOUNT_DATA` is not the bucket for making the red go away. It only sees
  the TOP level, so a stale field inside a record that still resolves (the
  group-scoped `ownerUid` case in G7) is still nobody's alarm.
- **One trigger `onMemberWritten` now owns the whole `groups/{gid}/members/{uid}`
  node** (`functions/index.js`): deletion → cell revocation, `statusOverride`
  change → co-member notify, gated by `statusOverrideChanged` (`notifier.js`,
  compares `enabled`/`status`/`statusColor`/`availableUntil`). Any NEW
  `statusOverride` field that affects availability must be added to that compare
  or a change to it silently skips the notify path. Don't re-add a separate
  leaf-path trigger — that's the F7 double-invocation this merge removed.
- **Mid-file `require` ≠ top-level instance after `jest.resetModules()`.** Known
  in `tests/following.test.js`; ALSO bites `tests/me.test.js` (a later describe
  resets modules — bind mocks at top level, not inside test bodies).
- **`jest.clearAllMocks()` doesn't clear `mockResolvedValue` implementations.**
- **This repo's Jest uses `--testPathPatterns` (PLURAL)** — the singular
  `--testPathPattern` is rejected. And `jest.isolateModules()` does NOT reset
  Jest's file-content cache keyed by absolute path, so a test that stamps a
  template into a temp file and `require()`s it must use a **unique** temp
  filename per call or it silently replays the prior stamp.
- **Splash gating has two modes** (`js/app.ts`): warm boots gate on the LOCAL
  followee count; any boot that calls `rearmSplash()` gates on SERVER truth.
  Don't re-introduce local-cache reads into the cold path.
- **Direct header setters are optimistic + idempotent** (`js/me.ts`): paint
  first, background write, echo absorbed by DOM-keyed guards. Don't re-add an
  `await` before paint.
- **`js/features.js`, the `about-*.js` trio stay `.js`** — read as source text /
  served raw. Decided; do not convert.
- **`sw.template.js` is loaded raw by `tests/sw.test.js`** — placeholders must
  stay filter-safe unsubstituted.
- **CSP pins inline-script hashes** in `firebase.json`. Do NOT add or modify
  inline `<script>` blocks in the HTML templates. Inline SVG is fine.
- **Hosting serves the repo root** (`"public": "."`). `dist/`, `index.html`,
  `sw.js` are gitignored build artifacts — never commit them; edit
  `index.template.html`.
- **`sw.js` must stay `Cache-Control: no-store` and registered with
  `updateViaCache: 'none'`** (both pinned by tests) — iOS WebKit
  device-observed (2026-07-21) answering the SW update check from stale
  revalidation state for days under plain `no-cache`. And never cache-bust
  the registration URL: a script-URL change forces install+reload even for
  byte-identical workers. Full write-up: `docs/pwa-auto-update.md` piece 4.
- **Prod build needs `.env.production`** or preconnect + Firebase config
  silently no-op.
- **Run typechecks from the repo root.**

---

## History — skip unless relevant

Everything below shipped. Detail is in git + plans + the archived handoff.

- **This session (2026-08-01) — the four parked residuals closed
  (`c1b2cf9`, docs `62beeaa`/`7cc17e1`/`8f9ccd1`).** R1 the merge relink
  conflict now fires only when the teardown actually deleted (it used to
  contradict the teardown's own refusal on the same tgId); R2
  `buildMappingTeardown` gained `ownUids`, so a mapping held by a merge's LOSER
  is torn down instead of refused with a loss line promising its owner's
  Telegram keeps working — false, since `users/{loser}` is nulled moments
  later; R3 the `fsyncDir` catch branch got the two tests it never had (both
  passed first run — missing coverage, not a defect); R4 the production-link
  plan now READS who holds a stale mapping instead of inferring it from the
  reverse index. Also: `docs/operator-panel-smoke-test.md` written (never run),
  and `docs/operator-panel-followups.md` restructured around an at-a-glance
  index with stable IDs.
- **This session (2026-08-01) — two ops-panel follow-ups, TDD
  (`4dea508`, `16e5ae9` on `claude/knockknock-ui-improvements-7bm5o9`).**
  Operator ruled both onto this branch rather than cutting new ones.
  (1) `crossRefRenderers` gained `locations/{u}`, `locationCells/{gid}/{u}`
  and the unjoined-invite `pendingInvitesByGroup/{gid}/{u}` entries; the local
  copies in `merge.js`/`purge.js` are gone; the owned-group orphan case is a
  wholesale `locationCells/{gid}` null in the owned-group block. Changes live
  expunge + graduation behaviour; new coverage in its own file so
  `telegram-auth.test.js` keeps its 0-line diff. (2) The Telegram mapping
  write-block became genuinely shared: the documented plan (`performLink`
  importing `ops/link-write.js`) was found UNDEPLOYABLE — `functions.ignore`
  excludes `ops/**`, so it would have shipped a function that dies at cold
  start with all tests green — so the builder moved to
  `functions/telegram-link-write.js`, gained an optional pre-read `prior`, and
  `performLink` now calls it, keeping only its expunge branch. The old parity
  tests became tautological (they compared the builder with itself) and were
  rewritten against literal oracles. New per-file guard pins the deploy
  surface; its first version passed against a planted violation (a `/*` inside
  the prose `` `ops/**` `` opened a phantom block comment) and was rewritten
  and re-verified by planting the violation again.
- **This session (2026-08-01) — ops-panel design + plan, docs only
  (`39b4980`, `27719fd` on `claude/knockknock-ui-improvements-7bm5o9`).**
  Brainstormed to an approved spec, then a TDD plan. No code written; gates
  re-verified green at the branch tip. Decisions recorded in the spec: local
  Node CLI under `functions/ops/` bound to `127.0.0.1` (the RTDB rules are
  owner-scoped, so no browser client can enumerate accounts — the panel goes
  through the Admin SDK); `.js` + JSDoc, not `.ts`, since nothing compiles it
  and `tsconfig` already strict-checks `functions/**/*.js`; purge reuses the
  shipped `expungeDerivedAccount` while merge is the one new primitive
  (`graduateAccountData` refuses a live target); "link via merge" does what
  production cannot — link a Telegram-derived account to a phrase account
  with nothing lost. Found and confirmed the hosting-serves-functions
  exposure (now a landmine, fixed by plan Task 1). Deferred deliberately:
  D5's Auth-record deletion, until `admin.auth().deleteUser` behaviour on a
  custom-token uid is verified on dev.
- **This session (2026-07-31) — release content + Direct status-color fix.** New README/about distance+Telegram content (`76454d6`). Removed the Direct available-text `palette.color` override so the label follows `statusColor` (`361e65c`, TDD, device-verified). Maintainer merged `dev` → `main`; `v2.0.0` tagged on GitHub at `ca1d1fa` (release notes cover v1.3.0→v2.0.0). The status-color fix is post-tag on `main` — no new tag (operator call).
- **This session (2026-07-22c) — Telegram beacon nudge + /locoff, TDD, on
  `claude/knockknock-polish-pass-8kb77v`:** operator-spec'd over three
  design rounds (feasibility → response-case enumeration → operator-authored
  copy). `formatAgeFuzzy` in `shared/timeFormat.js` (fixture gained an `age`
  column + day-scale rows; floors on purpose — an age nudge must understate).
  `functions/telegram.js`: beacon suffix helpers (opt-in ON + node with
  numeric `updatedAt`, read from the same `userPrefs/{uid}/location` branch
  the app's glyph sync writes) wired into the global `/status` confirm, the
  `/start` returning-available line, and `setGroupPresence` via an optional
  `suffixFor` hook (confirm + globalOn only — globalOff means the cell isn't
  peer-visible; `/off` passes nothing). `/locoff [group]`: opt-in flip + node
  delete in one atomic `rootUpdate`; group flavor rides `resolveGroupArg`
  (B#3 retry idiom). Copy ruled: "/off … to go unavailable." everywhere the
  confirms said "to stop." Client (`js/locationShare.ts`): the prefs-echo
  handler now unmarks published contexts whose opt-in dropped — without it
  the surfaces held/re-opened subs against the bot-deleted node (also a
  latent sibling-device glyph-off bug). NOTE: first functions-touching
  change since the audit-2 batch (deploy note in What's next).
  `00c88dd..4ac099c` on `claude/knockknock-polish-pass-8kb77v` (cut from
  `9a3ysy` at `837ee8a`), all TDD:**
  - `00c88dd` **fix(geo):** `formatDistancePrecise` meters/km watershed moved
    from 1000 to 999.5 — 999.6–999.99 m rendered the never-valid "1000 meters
    away". Fixture vectors pin both sides in web + functions suites
    (`npm run sync-shared` applied).
  - `880c54d` **fix(location-ui):** (1) sticky denied glyph — locationShare
    exports `isPermissionDenied()` (set on code-1 prove reject + revocation
    teardown; cleared on delivered fix / successful prove / reset); both
    surfaces' repaint paths (prefs-synced, opt-in-changed, band render)
    consult it via per-surface state helpers (`directGlyphState` in me.ts,
    `groupGlyphState` in groupContext.ts — deliberately duplicated:
    groupContext's tests mock me.js wholesale, importing would make the group
    coverage vacuous). Previously the teardown's own opt-in-changed dispatch
    washed the denied paint back to off. (2) `paintLocationGlyph` gained an
    'unsupported' state — same `.denied` visual, own title ("Location
    unavailable — not supported on this device"); tap handlers pass
    `toggleContext`'s result straight through. (3) `_watchGeneration` guard:
    a code-1 watch error delivered synchronously (allowed by the
    getPositionOnce contract) ran the teardown before `startGeoWatch`'s id
    assignment, resurrecting a dead watch — the next glyph prove parked
    forever. Surfaced by the sticky-denied test's denied→re-prove leg.
  - `4ac099c` **chore(location):** `[LOCDBG]` instrumentation stripped (the
    release gate) — helper, ring buffer, all call sites; capture citations
    normalized to "device trace 2026-07-21". Stale cell-publish catch comment
    updated (error shape WAS emulator-verified 2026-07-20).
  canvas 0×0 fix, 4 commits `7364a80..86504e6` on `9a3ysy`, all pushed:**
  Bug report: distance froze at last-known after backgrounding the PWA;
  reload didn't recover, glyph off/on did. Method: `[LOCDBG]` extended with a
  localStorage ring buffer (`7364a80`) so untethered reproductions survive
  the Web Inspector detaching; two device captures then isolated THREE
  stacked causes, each fixed TDD:
  - `7a37887` **permission-gate reload freeze:** iOS WebKit answers a FRESH
    `permissions.query` with `'prompt'` after every reload until the session
    uses geolocation — every tick skipped at the gate until a glyph toggle.
    Fix: device-local proof marker `statusapp_geo_grant_proven` (set on any
    delivered watch fix, cleared on real code-1 revocation; device-scoped in
    `cacheOwner`) lets the gate pass a lying `'prompt'`; never-proven devices
    (cross-device-synced opt-in, spec §5) keep the no-surprise-prompt gate.
  - `8e3f17e` **suspension-killed watch (the tram freeze proper):** iOS kills
    the `watchPosition` stream on suspend with NO error callback — dead
    `_watchId` looked live, `getPositionOnce` served the frozen `_lastFix` at
    any age, ticks republished/suppressed the same point for 10+ min
    (buffer-trace-observed). Fix: ticks refuse a fix older than one tick
    interval (restart the watch, stay parked for a real fix);
    visibility→visible rebuilds the watch before the catch-up tick; a cached
    PermissionStatus is only trusted when it says granted (WebKit flips
    retained objects spuriously around resume). Plus resume double-fire
    dedupe: one watch restart (10s window), one tick in flight (age-bounded
    so a wedged tick can't silence the loop). Recovery device-verified:
    fresh moved fix + publish within ~30ms of resume.
  - `86504e6` **canvas first-entry 0×0** (regression from audit-2 N10,
    `cea4593`): `enterCanvas` sized the canvas synchronously after injecting
    the on-demand canvas.css — the inline `display:none` boot guard was
    still in force, so first entry per page load got a 0×0 backing store
    (invisible strokes, transparent overlay); re-entry worked, which made it
    look intermittent. Fix: `ensureCanvasCss` resolves when the sheet has
    APPLIED (guard's display flips; 3s cap degrades to old behavior), entry
    awaits it before measuring.
- **This session (2026-07-21b) — 3 fixes on `9a3ysy` atop the audit-2 batch,
  systematic-debugging + TDD, all pushed:**
  - `1633be5` **fix(redeem):** the inbox Join Direct-flash guard (`a9223c2`)
    only covered the in-app flow; the "Redeem an invite" form's group-join
    (`handleRedeemInvite` in `js/following.ts`) reached `navigateToGroup` by the
    other door with no guard. Wrapped its brokered redeem in
    `beginGroupEntryTransition`/`endGroupEntryTransition`. +3 tests.
  - **location-glyph no-op/stuck-OFF (macOS/iOS PWA):** two dead ends first —
    `81e5664` primed the tick permission-gate cache from the live prove (wrong
    layer; **reverted** in `85f8031`, which also added the dormant `[LOCDBG]`
    trace). Device trace then showed the real cause: **`getCurrentPosition`
    hangs on repeated WebKit calls → code-3 timeout** (frozen distance +
    stuck-OFF). `5b40a1d` **fix(location):** browser path now streams from ONE
    `watchPosition` into a `_lastFix` cache; `getPositionOnce` serves it (same
    contract), never a per-read cold call. Accuracy-tiered (high for Direct,
    coarse for cells); code-1 → teardown, code-2/3 keep last-known. Telegram
    path untouched. **Device-verified.** `locationShare.test.js` reworked to a
    `watchPosition` mock (`fireWatch`/`fireWatchError`); +2 regression guards.
    `[LOCDBG]` still in for continued debugging — strip before dev merge.
- **Audit-2 perf-fix batch executed (2026-07-21, `0ce40fa..cea4593` + cleanup
  `75eeade`, built on `claude/session-yjbet1`, fast-forward-merged to
  `claude/knockknock-feature-dev-9a3ysy`, both pushed):** the 10-task
  `2026-07-21-performance-fixes-audit2.md` plan via subagent-driven
  development — fresh implementer per task, per-task spec+quality review,
  final whole-branch opus review ("ready to merge", zero Critical/Important).
  N1 canvas lazy-split restored (dropped stray static import → chunk emits) ·
  N2 stale-membership 10-min probe window so the sweep fires for a kicked
  *stationary* user (`STALE_MEMBERSHIP_PROBE_MS`; `_lastPublished` gained
  `landedAt`) · N4 `statusOverrideChanged`→`availabilityRelevantOverrideChange`
  (appearance-only override edits skip the notify gate + its presence read) ·
  N7 availability sender's `presence/code` resolved once, threaded through the
  group fan-out · N8 countdown-label visibilitychange catch-up (+ a me.test
  mock-fidelity fix: restored the `< 1m` branch) · N3 `classifyMembersTick`
  appearance-only roster fast path (client analogue of N4; fails safe to
  'full') · N5a lazy-load groupContext (largest client module) via serialized
  `withGroupContext` · N5b lazy-load the four Telegram-webview-only flow
  modules (`tgFirstRun` threaded through `BootSession`) · N9 per-stroke canvas
  derivations (per-segment ctx assignments preserved) · N10 on-demand
  canvas.css (JS-injected `<link>` + inline `<style>` flow guard, CSP-safe —
  no `onload`). Three review loops caught real issues: N8's mock was silently
  vacuous (flat `'2h'`) → made value-sensitive; N5a left a required favorites
  test-flush uncommitted (red-in-isolation) → folded into the commit; N5b's
  brief mis-assumed one function scope → adapted via `BootSession` threading.
  Cross-task parity verified (server N4 ↔ client N3 gate agree on
  appearance-vs-availability fields; N5a+N5b compose cleanly on `js/app.ts`).
  Gates green at `75eeade` (web 2056 · functions 436 · typechecks clean · build
  emits all lazy chunks · zero new suppressions). N6 (SW precache-all) stayed
  PARKED as a product call — the only audit-2 finding without a plan task.
  DEPLOY pending (client + functions only, no ordering constraints; see Deploy
  ordering).
- **Audit #2 + planning session (2026-07-21, docs-only `8d3d354..8d58960`):**
  second performance audit over the branch (4 parallel read-only agents +
  session-side verification of every claim; prior 26 fixes independently
  re-verified intact, zero regressions). 10 new findings (N1–N10), all
  source-verified with corrections recorded inline (N2 exposure narrowed to
  mid-session kicks; N5's telegramOnramp is web-facing, not webview-only;
  N10's deferral hazard is layout shift, not a flash; N6 exclusion is free
  on repeats thanks to the immutable headers). Operator ruled: plan
  N1–N5+N7–N10 (the 10-task plan above), park N6 as a product decision.
  Notable verified-clean: trigger topology has zero overlaps and the
  high-frequency client writes (location publishes, palette echoes,
  presence leaves) fire no functions; CSS runtime animations all
  state-gated; SDK imports fully modular. N4 broadcast question answered
  in-source: color reaches peers via RTDB listener fan-out, never via the
  notifier (push payloads are title/body only) — the narrowed gate removes
  a read that always preceded a no-op.
- **Post-smoke fix session (2026-07-21, `8d83e3a..a9223c2`):** four
  operator-reported issues root-caused and fixed test-first. (1) `8d83e3a` —
  group roster lost a mutual's coarse distance the moment the viewer enabled
  Direct: precise-tier eligibility (mutual + primary-available) excluded the
  cell sub on mere *eligibility*, but a mutual with Direct off publishes no
  raw point, so precise emitted null forever with no fallback; the exclusion
  is now data-driven (only a DELIVERED precise number displaces the cell sub;
  the precise callback re-runs the reconcile on number↔null transitions) —
  Task 2's one-listen-per-mutual contract revised accordingly. (2) `eeef878`
  — #156 panel gained `SW reg` (registration lifecycle) and `sw.js served`
  (no-store probe: served cache-version + status + MIME, warns when it
  differs from the controlling worker's). (3) `5d8b3b8` — iOS PWA never saw
  deployed sw.js updates: cornered via cabled Web Inspector (healthy
  registration, device on old cache version, server serving new,
  `update()` resolving with no updatefound; a fresh-URL registration
  unstuck it); local Chromium+emulator repro had already proven the whole
  four-piece update cycle sound, exonerating the code pattern and Task 7's
  headers (live-channel curls confirmed `no-cache`+etag correct). Fix:
  `/sw.js` served `no-store` + `updateViaCache:'none'` at register, doc
  updated. (4) `a9223c2` — inbox Join flashed Direct + the new group's
  backend code in the nav row during the now-slow brokered joinGroup
  callable (Fix 2b widened an always-present race window); exported
  begin/endGroupEntryTransition guard (the create-group modal's suspend
  dance, reusable), name seeded via setLastKnownGroupName.
- **Verification pass + on-device smoke + iOS glyph fix (2026-07-20,
  `45d7bec`):** all 26 tasks of the three perf plans verified against source
  by three parallel read-only agents with coordinator spot-checks — 26/26
  faithful, all documented deviations confirmed, no undocumented drift.
  Operator ran the on-device smoke checklist: most verified; deploy-gated and
  a few hard-to-stage items deferred. One regression found and fixed:
  iOS PWA glyph-on published nothing because T8's PermissionStatus cache
  froze a pre-grant `'prompt'` object (WebKit never updates a retained
  status; fresh query returned `'granted'` — device-probed). `45d7bec`
  caches only granted statuses; red-green regression test in
  `tests/locationShare.test.js` ("a 'prompt' status is never cached").
- **Tier 3 performance fixes (2026-07-20, `d4be799..eca3c0e`, built on
  `claude/knockknock-perf-fixes-tier3-2j9hj9`, fast-forward-merged to
  `claude/knockknock-feature-dev-9a3ysy`, both pushed):** executed
  `2026-07-20-performance-fixes-tier3.md` (14 low-severity tasks) via
  subagent-driven development — fresh implementer per task, per-task spec+quality
  review, final whole-branch review ("ready"). T1 roster repaint-only-the-ticking-
  row (two-signal flip check deliberately keeps T2's distance-reconcile alive) ·
  T2 one distance sub per mutual (cell closes while precise is live) · T3 sweep
  stale gid opt-ins on a denied cell write (fixes the old "denied write every 60s"
  minor; error shape emulator-verified) · T4 knock buffer/drain on
  drawer-close/canvas-exit instead of full re-init, + cross-context stash fix ·
  T5 fire-and-forget lastVisited + hoisted prefs read · T6 hidden-tab timer guards
  (label/countdown/peek) · T7 raw-string parse memos (favorites/notify/location) ·
  T8 cached geolocation PermissionStatus · T9 O(1) row-lookup maps (isConnected
  fail-safe) · T10 in-place canvas preview append + malformed-base clamp · T11
  removed leaked capture-phase pointerdown listener · T12 single
  `watchUserGroups` listen (removal detector rides groupNav's enumeration) · T13
  inbox null-cache + `/start` no-op skip + `lastSeen` throttle · T14 ownStatus →
  presenceHub. Two per-task reviews caught real Important issues (T4 dropped
  cross-context held knocks; T10 threw RangeError on a malformed peer `base`) —
  both fixed + re-reviewed. Cleanup (`eca3c0e`): knock →visible double-present
  dedup, extracted `stashCrossContextKnock`, fixed a stale roster comment. Gates
  green at `eca3c0e` (web 2037 · functions 432 · rules 108 · typechecks clean ·
  0 suppressions). DEPLOY pending (client-only; see Deploy ordering).
- **Pre-existing performance fixes (2026-07-20, `611daf3..9f434d0`, pushed
  fast-forward onto `claude/knockknock-feature-dev-9a3ysy`):** executed
  `2026-07-20-performance-fixes-preexisting.md` (F3/F6/F8) via
  subagent-driven-development — fresh implementer per task, per-task spec+quality
  review, final whole-branch review (opus, "ready to merge"). F3 `watchGroupMeta`
  → two leaf listens (`name`+`ownerId`; the membership-gated ownerId-cancel is
  the delete/kick "gone" signal, name leaf just delivers renames) · F6a boot
  reads the `currentContext` leaf not the whole prefs node · F6c `pushTokens` →
  top-level owner-only node + dual-read + one-shot migration
  (`functions/migrate-push-tokens.js`) · F6b favorites/notify sync events
  diff-gated · F8 directed notifier handlers → parallel read phases (send
  decisions unchanged; accepted broadened-reject trade on gated exits — triggers
  are `retry:false`). The Task 3 review caught a second AND third un-migrated
  reader of the relocated node (fix `6532e38`); a final cleanup (`9f434d0`)
  addressed doc/test minors and added the DEPLOY-PROD.md pushTokens runbook.
  DEPLOY still pending (see Deploy ordering above). Tier 3 shipped atop this
  (see the top of History).
- **Branch-introduced performance fixes (2026-07-20, `5463888..d73deb3` + hardening
  `135a166`, merged into `claude/knockknock-feature-dev-9a3ysy` fast-forward):**
  executed `2026-07-20-performance-fixes.md` (F1/F2/F4/F5/F7/F10/F9) via
  subagent-driven development — fresh implementer per task, per-task spec+quality
  review, final whole-branch review (opus, "ready to merge"). T1 no-op publish
  suppression · T2 tiered/coarse GPS · T3 distance-emission dedupe · T4
  prefs-echo diff + probe skip · T5 merged `onMemberOverride`+`onMemberRemoved`
  → `onMemberWritten` (gated by new `statusOverrideChanged`; +additive
  `statusColor` on `PresenceNode`) · T6 `/who` own-followers/group-cell prefetch ·
  T7 immutable `dist/chunks/**` header + SW cross-deploy chunk carry-over. T1's
  suppression outdated 8 pre-existing tests: the 1 the plan named was inverted;
  the other 7 were LIVENESS proxies (loop-alive / tier-fires / manager-works /
  hidden-ticks) — resolved by MOVING the fixture position so a real publish still
  proves liveness, never by weakening the assertion. Operator-added the `status`
  field to `statusOverrideChanged` (`135a166`) as defense-in-depth (unreachable
  with today's writers). DEPLOY still pending (nothing deploys from sessions): T5
  deletes two functions; T7 needs a post-deploy `curl -I /dist/chunks/<hash>.js`
  → `immutable` while `/dist/bundle.js` stays `no-cache` (commit bodies carry the
  notes). `2026-07-20-performance-fixes-tier3.md` shipped (top of History).
- **Performance audit (2026-07-20, this branch, docs-only,
  `32b280d`+`8cc04f2`):** four-domain parallel audit vs main (location client,
  boot/render, functions, data model + load); Tier 1&2 findings source-verified
  (one agent correction: /who reads are parallel, N+1 in read count only);
  findings spec + three fix plans under `docs/superpowers/`. Security-fix
  execution details (the two reviewed plan deviations: Fix 1's load-bearing
  `.validate` gate vs inert `.write` narrowing; joinGroup transacting the full
  invite object) live in the spec/plan named below and the commit bodies.
- **Security-fix execution + hardening (2026-07-20, this branch,
  `b995fb7..7488947`):** executed the 5-task plan via subagent-driven
  development (fresh implementer per task, per-task spec+quality review, final
  whole-branch review — verdict "ready to merge"): Fix 1 `.validate` forgery
  gate (`129a4dc`) · Fix 3 `onMemberRemoved` cell revocation (`b084d7f`) ·
  Fix 2 callable + client rewire + member-rule tighten
  (`79a079b`/`4df0774`/`b0c0d86`+`05d7fe6`). Then operator-ordered: ownerId
  takeover guard (`757acf3`), owner-only `redemptionsUsed` (`8790dde`), polish
  (`34899ac`), dead-helper cleanup (`934712b`), and the `origin/dev` merge
  (`7488947` — call-escape fix + `sweepStaleCalls`; one import conflict in
  `functions/index.js`, both sides kept). Expected test fallout (pre-existing
  tests asserting now-outlawed behavior) was inverted, never weakened —
  rationale in the commit bodies.
- **Location security review (2026-07-19, this branch, docs-only):**
  `/security-review` + `vibesec-skill` over the feature diff → findings → spec
  → plan (the two docs under `docs/superpowers/`).
- **Location device-smoke debugging cycle (2026-07-19, `7386957..93bea22`,
  operator-verified):** glyph/pin UI, last-known persistence model,
  per-context eligibility, group/Direct independence, Telegram init-once fix,
  distance rendering.
- **Location-sharing implementation (2026-07-19, `c2f6a2e..7386957`)** — 13
  plan tasks, subagent-driven, per-task + whole-branch reviews.
- **Boot/status polish batch (2026-07-17, PR #296)** · **UI-fix batch
  (2026-07-17, PR #294)** · **TypeScript adoption (phase-0)** ·
  **Client-performance plan (2026-07-17)** —
  `docs/superpowers/plans/2026-07-17-client-performance.md`.
