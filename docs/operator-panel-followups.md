# Operator control panel — open items after the build

Distilled from the implementation session's review ledger (2026-08-01). The
panel itself is built and reviewed; `functions/ops/README.md` is the runbook and
`docs/HANDOFF.md` is the general on-ramp. This file exists so the findings that
were *deliberately deferred* survive the session that found them — nothing here
blocks the branch, and nothing here is a surprise.

Nothing in this list was discovered by guesswork: each item came out of a
task-scoped review, the final whole-branch review, or an adversarial probe, and
each was ruled on rather than dropped.

---

## Owed before the panel is pointed at production data

Ranked. The first is not optional.

1. **The manual dev-project smoke test.** No service-account credential existed
   in any container this work ran in, so `deps.js`, `panel.html`'s browser
   behaviour, and the `Host`/`Origin` guard as seen from a real browser are all
   **unexercised**. Every green test number covers the wiring, not the live
   system. That guard is now the panel's *sole* authentication boundary — the
   server holds full database admin and has no login.

2. **The `locations`/`locationCells` enumerator follow-up.** Its own branch;
   details under "Known gaps" below.

3. **Fold the shipped copy of the link-write block into
   `functions/ops/link-write.js`.** Two implementations of the Telegram mapping
   write remain — the shipped one in `performLink`
   (`functions/telegram-auth.js:207-224`) and the shared ops one. A parity test
   (`functions/test/ops-link-write.test.js`) *executes* `performLink` and
   compares write-maps, so drift turns the suite red — but it is a **tripwire,
   not a fix**. Nothing makes the two share code. Folding it in means having
   `performLink` call `buildLinkWrites`, after which the parity test is
   redundant. Touches shipped Cloud Functions code, so it needs its own branch
   and review.

---

## Known gaps, with the reasoning

### `crossRefRenderers` does not enumerate location data

`crossRefRenderers` (`functions/telegram-auth.js`) is the single enumerator of
cross-user residue paths, shared by expunge, graduation, merge and purge. It
does **not** emit `locations/{uid}` or `locationCells/{gid}/{uid}`.

Consequences, all confirmed: `expungeDerivedAccount` leaves both behind when it
tears down a Telegram-derived account; graduation does not move them; `merge.js`
and `purge.js` each handle the two families locally instead. This predates the
panel — the refactor that split `expungeDerivedAccount` was proven
behaviour-preserving, so it did not introduce the gap. The integrity report
surfaces the residue (spec §333-334).

The follow-up must do all four parts in **one** change, or it lands half-done:

- add both families to `crossRefRenderers`;
- remove the now-redundant local handling from `merge.js` and `purge.js`;
- decide the owned-group case — deleting a group wholesale orphans *other*
  members' `locationCells/{gid}/{m}`, and the purge implementation deliberately
  declined to invent that delete;
- fix the `pendingInvitesByGroup` asymmetry — merge nulls entries for gids the
  account is invited-to-but-not-a-member-of (the enumerator cannot see those),
  purge does not.

Part one changes **live expunge behaviour**, so the behaviour-preservation
guarantee stops covering `telegram-auth.js` and both expunge and graduation need
new tests.

### The preview/execute divergence check compares paths, not values

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

- **Single-operator by construction.** Approvals are per-uid and held in memory;
  two people running the panel at once do not share approval state.
- **Platform.** The audit dump fsyncs its containing directory, which throws
  `EISDIR` on Windows. Documented as a requirement (Linux/macOS, or WSL) rather
  than skipped, because a portable skip would silently downgrade durability on
  the one platform nothing here exercises. It fails closed with a named cause.
- **Auth-record deletion is deferred deliberately.** `admin.auth().deleteUser`
  on a custom-token uid is unverified against dev, so there is no route and no
  checkbox.

---

## Parked residuals

Real, ruled non-blocking, none load-bearing — no later work builds on them and
none reveals a design defect. Three of the four are report *wording* that
overstates what happens in a contrived state; all are reported to the operator
rather than silent.

| Where | What | Ruling |
|---|---|---|
| `merge.js` | The `telegram-relink` conflict is raised unconditionally *before* the mapping teardown is folded in, so when the teardown refuses, the operator sees two contradictory conflicts on the same `tgId`. | Both are shown, neither is silent. Wording. Fix with the follow-up. |
| `link-write.js` | `buildMappingTeardown` takes no `ownUids`. In merge-with-repoint where the *survivor's* reverse index points at a mapping owned by the *loser*, it refuses, `users/{loser}` is nulled anyway, and the forward mapping is left pointing at a deleted uid — while the loss text claims "the forward mapping stays with its owner, whose Telegram keeps working". False in that one case. | Contrived, reported, and no partial write in the dangerous direction. Park; fix the wording with the follow-up. |
| `audit.js` | The `fsyncDir` catch branch is the one behaviour added in the final fix wave with no test, though the fs is trivially mockable. | Fails closed; nothing builds on it. Park. |
| `purge.js` | The production-link plan asserts a stale forward mapping is "left pointing at {phraseUid}" as fact, but that ownership is *inferred* from the reverse index and never read. | The safety argument holds — nothing is written to that path, so no third party can be harmed. Wording. Add a `readMapping` in the follow-up. |

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

Recorded so nobody re-derives them: the snapshot type collapsing "absent" and
"empty" (consumers use a runtime key-count check); an O(n log n) detail lookup;
an inline canvas-key split in the read-only integrity module; an untested
non-EEXIST rethrow and a missing attempt cap in the audit writer; approval TTL
and the detail-view overwriting a pending approval; the production banner not
naming the project inline. None affects correctness of a destructive write.

**One review-method note worth keeping:** grepping for `as any` alone is
insufficient — `/** @type {any} */` is the same escape hatch in JSDoc and slipped
past two reviews. Sweep for `as any`, `@ts-ignore`, `@ts-expect-error`,
`@type {any}`, `{any}`, `: any`, `<any>`, and read each hit rather than trusting
the count.
