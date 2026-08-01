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

Items 2 and 3 shipped on 2026-08-01 (`4dea508`, `16e5ae9`). One remains, and it
is the one that was never optional.

1. **The manual dev-project smoke test — STILL OWED.** No service-account
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

**Three of these were ruled "fix with the follow-up". The link-write follow-up
shipped (`16e5ae9`) and did NOT fix them** — it was scoped to making the write
block genuinely shared, and widening it to report wording would have mixed a
behaviour-preserving refactor of shipped code with report changes. They are
still open, and they no longer have a scheduled carrier.

| Where | What | Ruling |
|---|---|---|
| `merge.js` | The `telegram-relink` conflict is raised unconditionally *before* the mapping teardown is folded in, so when the teardown refuses, the operator sees two contradictory conflicts on the same `tgId`. | Both are shown, neither is silent. Wording. STILL OPEN. |
| `telegram-link-write.js` (was `ops/link-write.js`) | `buildMappingTeardown` takes no `ownUids`. In merge-with-repoint where the *survivor's* reverse index points at a mapping owned by the *loser*, it refuses, `users/{loser}` is nulled anyway, and the forward mapping is left pointing at a deleted uid — while the loss text claims "the forward mapping stays with its owner, whose Telegram keeps working". False in that one case. | Contrived, reported, and no partial write in the dangerous direction. STILL OPEN. |
| `audit.js` | The `fsyncDir` catch branch is the one behaviour added in the final fix wave with no test, though the fs is trivially mockable. | Fails closed; nothing builds on it. Park. |
| `purge.js` | The production-link plan asserts a stale forward mapping is "left pointing at {phraseUid}" as fact, but that ownership is *inferred* from the reverse index and never read. | The safety argument holds — nothing is written to that path, so no third party can be harmed. Wording; wants a `readMapping`. STILL OPEN. |

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
