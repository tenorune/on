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

Fourteen items. One blocks production use; the rest are ranked by whether
anything downstream depends on them. IDs are stable — cite them rather than
re-describing the item.

| ID | Item | Where | Weight |
|---|---|---|---|
| **S1** | The manual dev-project smoke test | whole panel | **Blocks production use** |
| **G1** | Divergence check compares paths, not write values | `ops/merge.js:212-213` | Known gap, bounded |
| **G2** | Auth-record deletion has no route (D5) | `ops/server.js` | Deferred by decision |
| **R1** | Contradictory `telegram-relink` + teardown conflicts on one `tgId` | `ops/merge.js` | Report wording |
| **R2** | `buildMappingTeardown` takes no `ownUids`; loss text false in one case | `telegram-link-write.js` | Report wording |
| **R3** | `fsyncDir` catch branch has no test | `ops/audit.js` | Untested, fails closed |
| **R4** | Stale-mapping ownership asserted as fact, never read | `ops/purge.js` | Report wording |
| **M1** | Snapshot type collapses "absent" and "empty" | `ops/types.d.ts:26-38` | Minor |
| **M2** | Detail lookup builds and sorts every row to find one | `ops/project.js:69` | Minor |
| **M3** | Canvas-key split inlined rather than shared | `ops/integrity.js:190` | Minor |
| **M4** | Non-`EEXIST` rethrow untested | `ops/audit.js:167` | Minor |
| **M5** | Audit filename retry loop has no attempt cap | `ops/audit.js:181-189` | Minor |
| **M6** | Approvals have no TTL, and detail-view overwrites a pending one | `ops/server.js:359,385` | Minor |
| **M7** | Production banner does not name the project inline | `ops/server.js:690-692` | Minor |

**Standing constraints, not work items** — these are decisions, and nothing is
owed against them: the panel is single-operator by construction (approvals are
per-uid and in memory, so two operators do not share them), and it requires
Linux/macOS or WSL (the audit dump fsyncs its directory, which throws `EISDIR`
on Windows — a portable skip would silently downgrade durability on the one
platform nothing exercises).

**Shipped since this file was written:** the `locations`/`locationCells`
enumerator follow-up (`4dea508`) and the link-write fold (`16e5ae9`), both
detailed below. Neither is owed any more.

---

## Owed before the panel is pointed at production data

Items 2 and 3 shipped on 2026-08-01 (`4dea508`, `16e5ae9`). One remains, and it
is the one that was never optional.

1. **S1 — the manual dev-project smoke test — STILL OWED.** No service-account
   credential existed in any container this work ran in, so `deps.js`,
   `panel.html`'s browser behaviour, and the `Host`/`Origin` guard as seen from
   a real browser are all **unexercised**. Every green test number covers the
   wiring, not the live system. That guard is now the panel's *sole*
   authentication boundary — the server holds full database admin and has no
   login.

   The checklist for it is `docs/operator-panel-smoke-test.md`. Writing it did
   not exercise anything — it is a script, and its own header says so.

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
- **G2 — auth-record deletion is deferred deliberately.** `admin.auth().deleteUser`
  on a custom-token uid is unverified against dev, so there is no route and no
  checkbox. **S1 is the natural place to settle this**: once the panel is in
  front of a dev project, verifying that call is minutes of work, and it is the
  only thing standing between here and a decision.

---

## Parked residuals

Real, ruled non-blocking, none load-bearing — no later work builds on them and
none reveals a design defect. Three of the four are report *wording* that
overstates what happens in a contrived state; all are reported to the operator
rather than silent.

**Three of these were ruled "fix with the follow-up". The link-write follow-up
shipped (`16e5ae9`) and did NOT fix them** — it was scoped to making the write
block genuinely shared, and widening it to report wording would have mixed a
behaviour-preserving refactor of shipped code with report changes. They are
still open, and they no longer have a scheduled carrier.

| ID | Where | What | Ruling |
|---|---|---|---|
| **R1** | `ops/merge.js` | The `telegram-relink` conflict is raised unconditionally *before* the mapping teardown is folded in, so when the teardown refuses, the operator sees two contradictory conflicts on the same `tgId`. | Both are shown, neither is silent. Wording. STILL OPEN. |
| **R2** | `telegram-link-write.js` (was `ops/link-write.js`) | `buildMappingTeardown` takes no `ownUids`. In merge-with-repoint where the *survivor's* reverse index points at a mapping owned by the *loser*, it refuses, `users/{loser}` is nulled anyway, and the forward mapping is left pointing at a deleted uid — while the loss text claims "the forward mapping stays with its owner, whose Telegram keeps working". False in that one case. | Contrived, reported, and no partial write in the dangerous direction. STILL OPEN. |
| **R3** | `ops/audit.js` | The `fsyncDir` catch branch is the one behaviour added in the final fix wave with no test, though the fs is trivially mockable. | Fails closed; nothing builds on it. Park — but it is the cheapest item on this page, and M4 is the same file and the same afternoon. |
| **R4** | `ops/purge.js` | The production-link plan asserts a stale forward mapping is "left pointing at {phraseUid}" as fact, but that ownership is *inferred* from the reverse index and never read. | The safety argument holds — nothing is written to that path, so no third party can be harmed. Wording; wants a `readMapping`. STILL OPEN. |

R1, R2 and R4 are all *report wording* in the Telegram-mapping area and all
touch `ops/` only. They are one small change together, and doing them together
is the reason they were grouped under a single carrier in the first place.

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
destructive write** — that is the shared reason all seven were deferred, and it
is the test to re-apply if you are tempted to promote one. They are listed
individually because a paragraph of seven clauses is not a list anyone can act
on or check off.

| ID | Where | What | Why it was left |
|---|---|---|---|
| **M1** | `ops/types.d.ts:26-38` | Snapshot nodes are typed `Record<string, any>` and never optional, so "the node is absent" and "the node is present but empty" are the same type. | Consumers do not trust the type here — they use a runtime key-count check. Tightening it would be a type-level improvement over code that already guards at runtime. |
| **M2** | `ops/project.js:69` | The detail lookup calls `buildRows(...)` — which builds and sorts *every* row — and then `.find()`s the one uid it wants. | O(n log n) for a single-account read, on an operator tool with one user and an account list that fits in memory. Real, and invisible at this scale. |
| **M3** | `ops/integrity.js:190` | The canvas-key split (`key.split('_')`) is written inline rather than taken from the shared helper. | It is the read-only report module: a wrong split misreports, it cannot mis-delete. The shared-helper rule earns its severity from write paths. |
| **M4** | `ops/audit.js:167` | The non-`EEXIST` rethrow has no test, though the fs is trivially mockable. | Fails closed with a named cause. Same family as R3 below, which is the one worth doing first. |
| **M5** | `ops/audit.js:181-189` | The filename-collision retry is `for (;;)` with no attempt cap — it appends `-2`, `-3`, … indefinitely. | It terminates as soon as one name is free, and the loop only spins on genuine collisions in a directory one operator writes to. A cap would be cheap insurance rather than a fix. |
| **M6** | `ops/server.js:359,385` | Approvals live in a `Map` with no TTL, and `GET /api/detail` issues a nonce through the same `approvals.set(uid, …)` that previews use — so opening a detail view **overwrites a pending approval** for that uid. | It fails toward refusal, never toward an unapproved write: the overwriting nonce carries `approved: null`, so an execute against it is rejected and the operator previews again. Annoying, not dangerous. |
| **M7** | `ops/server.js:690-692` | The production banner does not name the project inline. | The startup line immediately above it does (`project=<id>`). Duplication, not absence. |

**One review-method note worth keeping:** grepping for `as any` alone is
insufficient — `/** @type {any} */` is the same escape hatch in JSDoc and slipped
past two reviews. Sweep for `as any`, `@ts-ignore`, `@ts-expect-error`,
`@type {any}`, `{any}`, `: any`, `<any>`, and read each hit rather than trusting
the count.
