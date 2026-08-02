# KnockKnock operator panel

A local, single-operator web panel over the Realtime Database: read the whole
account graph, run an integrity report, and perform the three destructive
operations (merge, purge, Telegram link) with a preview, a typed-uid
confirmation and a pre-image dump on disk.

It is a tool, not a product surface. There is no auth, no session, no
multi-user story — the process holds a service-account credential in memory and
therefore **binds `127.0.0.1` only**. Anything reachable off-box is a full
database compromise. Do not put it behind a tunnel, a reverse proxy, or
`--host`; there is no such flag on purpose.

## Platform

**Linux or macOS.** Every destructive route fsyncs the audit directory itself
before issuing the write, and opening a directory is POSIX-only — on Windows
`openSync(dir, 'r')` fails with `EISDIR`/`EPERM`, which fails the audit write,
which by design fails the whole operation. The panel is therefore unusable on a
Windows box, and that is not degraded silently: the error names the platform
requirement and points here. A directory entry that is not flushed is a
pre-image that may not survive the crash it exists for, and the pre-image is the
only path back from an irreversible write, so the guarantee is not relaxed to
gain a platform. (Run it under WSL if the operator box is Windows.)

## Running it

```bash
cd /path/to/on/functions
GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)" \
TELEGRAM_UID_SECRET="<the target project's uid secret>" \
node ops/server.js --project <firebase-project-id> --prod-project <prod-project-id>
```

Then open <http://127.0.0.1:8787>.

### Environment

| Variable | Required | Effect when missing |
| --- | --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | **yes** | the server refuses to start |
| `TELEGRAM_UID_SECRET` | no | **provenance degrades** — see below |

Either may come from `functions/.env` instead of the command line — that file is
where `functions/.env.example` already tells you to keep `TELEGRAM_UID_SECRET`,
and the panel now reads it rather than reporting a secret you did set as
`unset`. **Anything passed on the command line wins**, so a one-off run can
still point at another project's secret without editing the file. Whatever is
taken from the file is named on stdout at startup:

```
loaded from functions/.env: TELEGRAM_UID_SECRET
```

Only those two variables are read from it. The panel holds a database-admin
credential, so letting a file set anything else in this process — `PROD_PROJECT`
decides the production gate — would be a wider blast radius than the confusion
it removes. `functions/.env.<projectId>` is **not** consulted: those files are
committed, and a secret does not belong in one.

`TELEGRAM_UID_SECRET` is the HMAC secret `deriveTelegramUid` uses. With it, the
panel can recompute a Telegram-derived uid from a `tgId` and say *exactly* how
an account was created. Without it, the origin column falls back to a
`linkedAt` heuristic, every badge is rendered in the "inexact" style, and some
accounts simply read `unknown`. It is not a redaction toggle and it changes
nothing about what the panel can write.

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--project <id>` | (`GCLOUD_PROJECT`) | required; the target Firebase project |
| `--port <n>` | `8787` | must be an integer 1–65535; junk is refused, not coerced |
| `--region <r>` | `europe-west1` | only used to derive the RTDB host |
| `--database-url <url>` | derived | overrides the derived RTDB host |
| `--prod-project <id>` | (`PROD_PROJECT`) | which project is production |
| `--i-know-this-is-prod` | off | acknowledge a production target |
| `--audit-dir <dir>` | `.ops-audit` | where pre-images and the log land |

## The production gate fails closed

The gate refuses to start when the target *is* production and the
acknowledgement flag is absent. Critically, **an undeclared production project
counts as production**: if `--prod-project` / `PROD_PROJECT` is unset, empty or
whitespace, the panel cannot tell dev from prod, and "we do not know" resolves
to "assume production", never to "assume safe".

So there are exactly two ways to start:

* declare production and point somewhere else — `--project dev --prod-project prod`
* acknowledge — `--i-know-this-is-prod`

The same rule drives the red banner in the page: it is on whenever the target
is production *or* undeclared.

## The audit trail

Every destructive route writes to `--audit-dir` (default `functions/.ops-audit/`,
which is gitignored — **never commit its contents**):

* `<ts>-<op>-<uid>.json` — the **pre-image**: the current value of every path
  in the plan's write-set, captured and `fsync`ed **before** the destructive
  update is issued. If this file cannot be written the write does not happen at
  all. It is created with `wx`, so a same-millisecond collision gets a `-2`
  suffix rather than clobbering the only copy.
* `audit.jsonl` — two lines per operation: a `pending` line written *before*
  the update, and an `ok` / `failed: …` line written after. Both carry the same
  `ts`/`op`/`uids` and the same `preImageFile`, so a `pending` line with no
  resolution normally means the process died mid-write and the pre-image is the
  record of what was there. The one other way to get a bare `pending` line is an
  outcome-append that itself failed — in that case the panel pops a warning
  saying **the write succeeded**, and the operation is still reported as `ok`.
  A completed destructive write is never reported as a failure; an operator who
  believed it failed would run it again.

Two caveats the file states for itself:

* `canvases/*/strokes` is **never** captured. A destroyed canvas is recorded as
  its metadata plus an explicit "strokes not captured" marker. Drawing history
  is not recoverable from a pre-image.
* The dumped key set is the **preview** write-set, which is a superset of the
  wire payload — `rootUpdate` drops a null already covered by an ancestor null.
  That is deliberate: the dropped descendants are exactly the values that die
  with no other record.

### Why purge ends the session

Observed on dev, 2026-08-02: a purge deleted `userPrefs/{uid}` and the account's
still-signed-in client put the node straight back, holding the same `following`
keys and none of its other fields. The Auth record survives a purge, so the
custom-token session stays valid, and the rules let that session write
`users/{uid}`, `userPrefs/{uid}` **and its own rows in every peer's
`followers`/`followerNames`** — so a live client can undo the cross-user cleanup
as well as its own account.

Purge therefore revokes the account's refresh tokens **before** issuing the
write. Revoking afterwards would leave the same race in a smaller window. If the
revoke fails the purge is refused outright: a purge that will be undone is worse
than one that did not happen, because the operator walks away believing it
worked.

**What revoking does NOT do — measured on dev, 2026-08-02.** Revocation does not
evict a live session. An already-issued ID token stays valid until it expires,
and `database.rules.json` never checks `auth.token.auth_time`, so the client
keeps writing. Timed against a Mini App left open across a revoke:

| | |
| --- | --- |
| client opened, token issued | 15:19 |
| refresh tokens revoked | 15:20 |
| last **successful** write | 15:53 (+33 min) |
| first **failed** write | 16:26 (+66 min) |

The cut-off is the ID token's own expiry, not the revoke — a one-hour token
issued at 15:19 dies at 16:19, inside that bracket. **The window is measured
from when the client last got a token, so a client opened moments before a purge
has close to a full hour of write capability.** Revoking earlier does not shorten
it, and `deleteAuthRecord` does not either: deleting a record no more invalidates
an outstanding ID token than revoking does.

The only reliable mitigation is the one in smoke-test step 9: **close the
account's clients before executing.** Closing the rules gap properly would mean
checking `auth.token.auth_time` in `database.rules.json` — a whole-app change,
not a panel one, and not attempted here.

**And neither call retires the uid.** Telegram uids are
`deriveTelegramUid(tgId, secret)` — deterministic — and the app mints a fresh
custom token from Telegram's initData on every open. A token issued *after* the
revocation time produces a perfectly valid new session, so reopening the Mini App
defeats both the revoke and the delete: confirmed on dev, a new Auth record
appeared under the same uid. What the session handling buys is precise and
narrow — **a client that was already open at purge time cannot republish its
cached state.** It is not "the account is gone for good".

### Proving the Auth calls on a custom-token uid

`ops/verify-auth-delete.js` settles what D5 was originally deferred pending. A
custom-token uid is not a special kind of record — after one
`signInWithCustomToken` it is an ordinary Auth user, marked only by an empty
`providerData` and a `creationTime` equal to that first sign-in.

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)" \
node ops/verify-auth-delete.js --project <dev-project-id> --uid <uid> \
  --prod-project <prod-project-id> [--yes-delete]
```

Without `--yes-delete` it reads and revokes only — both recoverable. It refuses
to run against the declared production project at all.

It cannot prove everything. **The revoke window** (an already-issued ID token
stays valid until it expires) and **whether the uid comes back** are device
observations, not API ones — smoke-test steps 3, 4 and 6. Expect the uid to come
back: it is `deriveTelegramUid(tgId, secret)`, deterministic, so the next Mini
App open mints a token for the same uid and a new record appears under it.
Deleting the record ends the session; it does not retire the uid.

### Reading a pre-image back

**The `outcome` field in the per-op file always reads `pending`.** That is by
design (`audit.js:230-232`) — the resolution is appended to `audit.jsonl` as a
second line correlated by `ts`, never written back into the dump. Read the
outcome from the log, not the dump:

```bash
jq -c 'select(.ts == <ts>) | {ts,op,uids,outcome}' .ops-audit/audit.jsonl
```

There is no automated restore, on purpose. To inspect one:

```bash
cd functions
jq -r '.op, (.preImage | keys[])' .ops-audit/<file>.json             # what was touched
jq '.preImage["users/<uid>"]' .ops-audit/<file>.json                 # one node's old value
tail -5 .ops-audit/audit.jsonl | jq .                                # recent operations
```

Restoring is a hand-written `update()` built from `.preImage`, run after you
have decided which subtrees should come back. A blind replay would resurrect
paths that other operations have legitimately changed since.

`ops/restore-preimage.js` is that update, scripted — the decisions are still
yours, it just does the arithmetic and refuses the traps:

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)" \
node ops/restore-preimage.js --file .ops-audit/<ts>-purge-<uid>.json \
  --project <dev-project-id> --prod-project <prod-project-id>
```

**Dry run by default**: it reads every dumped path as it stands *now*, prints a
verdict per path — `restore`, `conflict`, `folded`, `already-there`,
`skip-canvas`, `skip-transient`, `skip-absent` — and writes nothing. `--yes`
issues one atomic root update, preceded by its own `op: restore` pre-image dump,
so undoing a purge is as auditable as the purge was. The production gate is the
same one the panel uses, including "undeclared counts as production".

Four things it will not do on its own, each with an opt-in flag:

| Situation | Default | Flag |
| --- | --- | --- |
| a canvas: the dump holds `bg` plus a *marker string* where the strokes were, so replaying the node writes that sentence into the database | skipped | `--restore-canvas-bg` (the `bg` leaf only) |
| `locations`, `locationCells`, `knocks`, `calls` — stale within seconds, and clients republish them | skipped | `--restore-transient` |
| `users/{uid}` or `userPrefs/{uid}` exists again because a client republished after the purge (G3) | conflict | `--merge-account` (captured values win, anything written since is kept) or `--replace-account` (wholesale) |
| a restored group whose other members' nav entries their own clients deleted (**G4**) | not attempted | `--heal-group-enumeration` |

Two refusals worth knowing, both of which reached a live run before they were
caught:

* **Nested paths.** A purged owner's write-set contains `groups/{gid}` *and*
  `groups/{gid}/members/{uid}`; RTDB rejects an update naming both. The purge
  survives it because `rootUpdate` drops the redundant nulls, so a restore does
  the mirror-image collapse — folding the descendant into the ancestor, which
  also carries the *other* members' rows. If the two captured values disagree it
  refuses rather than dropping one.
* **A global index held by someone else.** `codeIndex`, `inviteIndex`,
  `telegramUsers`, `telegramByUid` are never taken back automatically. A mapping
  that already points at the restored account (the deterministic-uid bootstrap
  re-stamping it) is reported as already-there, not as a hijack.

Restoring is not symmetrical with purging, and the asymmetry is G4: the dump
holds what the purge *wrote*, never what it merely *caused*. See
`docs/operator-panel-followups.md`.

### Sweeping a purge for residue

The dry run is also how you check that a purge's deletes actually landed, which
is what smoke-test step 9 asks for and the one thing no other tool answers.

Run it with **no flags** — it writes nothing and needs no intent to restore:

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)" \
node ops/restore-preimage.js --file .ops-audit/<ts>-purge-<uid>.json \
  --project <dev-project-id> --prod-project <prod-project-id>
```

Under the verdict list it prints a `RESIDUE SWEEP` block covering the families it
refuses to restore — `locations/{uid}`, `locationCells/{gid}/{uid}`, and, when
the purged account **owned** a group, that group's whole `locationCells/{gid}`
including cells belonging to *other* members. Those are the families
`crossRefRenderers` gained most recently, and they are the ones a restore's
verdicts are silent about, because "skipped" says nothing about whether the path
is empty. The sweep reports each as empty or still holding data, and names the
surviving keys — for a whole-group cells node, that key list *is* the other
members.

Two limits, both structural rather than fixable:

* **It sweeps only paths the purge wrote.** A family the purge never touched is
  not in the write-set, so it is not in the dump and the sweep cannot speak to
  it. Same boundary as G4. `integrity.js` is the cross-account census; this is
  not.
* **A path holding data is not proof of a missed delete.** A client that was
  open at purge time republishes its cache for up to its ID token's remaining
  hour (**G3**), and that is indistinguishable from residue on the way in. Close
  the account's clients before purging; if you did not, re-run the sweep once the
  window has passed rather than reading the first result as a defect.

### Seeding and verifying a merge

The purge side of smoke-test step 9 has the residue sweep above. The **merge**
side has its own pair, because the sweep cannot serve it: `restore-preimage.js`
is purge-shaped — its whole verdict model rests on "a purge NULLED every path in
its write-set", and a merge's write-set is mostly non-null *carries* onto the
survivor. It now **refuses** a non-purge dump rather than leaving that to
discipline (**M9**): the refusal fires on a dry run too, since the dry run's
verdicts and its `RESIDUE SWEEP` are the misleading part. Read a merge dump with
`jq` instead, or override with `--i-know-this-is-not-a-purge` and believe none of
what it prints.

```bash
cd functions
export GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)"

# 1. seed — dry run first; it prints the write-set and touches nothing
node ops/seed-merge-fixture.js --project <dev-id> --prod-project <prod-id> --tag run1
node ops/seed-merge-fixture.js --project <dev-id> --prod-project <prod-id> --tag run1 --yes

# 2. refresh the panel, run the integrity report, then merge L → S through the UI

# 3. read it back — one line per claim, non-zero exit if anything is owed
node ops/verify-merge.js --project <dev-id> --prod-project <prod-id> --tag run1

# 4. remove everything the fixture owns, including what the merge created
node ops/seed-merge-fixture.js --project <dev-id> --prod-project <prod-id> --tag run1 --clean --yes
```

Add `--telegram` to seed a mapping on the loser; add `--repoint` to `verify-merge`
when the merge was run as **link via merge** rather than as a plain merge.

**The link-via-merge variant** — the link this README tells you to *prefer* and
the one production's `performLink` shadows. **Exercised on dev 2026-08-03, 65/65:**

```bash
node ops/seed-merge-fixture.js --project $DEV --prod-project $PROD --tag lvm1 --telegram --yes
# refresh · integrity · click the LOSER row → "link via merge…" (NOT "merge into…")
#   → paste the SURVIVOR uid → read the plan → type the LOSER uid back
node ops/verify-merge.js --project $DEV --prod-project $PROD --tag lvm1 --telegram --repoint
node ops/seed-merge-fixture.js --project $DEV --prod-project $PROD --tag lvm1 --clean --yes
```

**65 claims**, against the plain merge's 57 — the extra eight are the whole link,
not just the mapping node. `buildLinkWrites` writes five paths and the prefs side
is where the loud failures live: `telegram-prefs-disagree` (prefs `tgId`
disagreeing with the reverse index) and `telegram-channel-unroutable`
(`notifyChannel: telegram` with no mapping behind it) are both integrity
**errors**. The remaining 57 are the plain merge's, unchanged, which is the claim
"non-lossy" actually makes: everything a merge carries, plus the link.

**The plain-plus-telegram variant. Exercised on dev 2026-08-03, 61/61:**

```bash
node ops/seed-merge-fixture.js --project $DEV --prod-project $PROD --tag tdn1 --telegram --yes
# refresh · integrity · click the LOSER row → "merge into…" (NOT "link via merge…")
node ops/verify-merge.js --project $DEV --prod-project $PROD --tag tdn1 --telegram
node ops/seed-merge-fixture.js --project $DEV --prod-project $PROD --tag tdn1 --clean --yes
```

Run the **plain** merge with `--telegram` (no `--repoint`, 61 claims) and you are
checking the opposite property — that the mapping comes *down* rather than
transferring, and that the survivor is not switched onto a channel it cannot
receive on. Both are seeded by the same flag; only the panel button and the
`--repoint` flag differ. **They take opposite branches of the same `if`**
(`merge.js:351` vs `:385`), so a green run of one says nothing about the other —
which is why each carries its own date and claim count above. Both have now been
run against a live project, once each.

#### Who holds the mapping — `--mapping-shape`

The 61/61 run above covered one case: the **loser** holds `telegramUsers/{tgId}`,
so the teardown deletes it. `merge.js:389` passes **no `ownUids`**, so every other
holder lands in the builder's refusal (`telegram-link-write.js:100`) and the
mapping must **survive** the merge. Pass the same shape to both CLIs:

| `--mapping-shape` | Who holds the mapping | What must happen | Run live? |
|---|---|---|---|
| `loser` (default) | the loser | torn down | **PASS 2026-08-03**, 61/61 |
| `third-party` | `P2`, not in the merge | **refused**; P2's Telegram keeps working | **PASS 2026-08-03**, 62/62 |
| `no-uid` | a mapping node with no `uid` | **refused** — no provable owner, so no delete on a guess | **PASS 2026-08-03**, 62/62 |
| `absent` | nobody; the reverse index points at nothing | nulled anyway (a no-op) | **PASS 2026-08-03**, 61/61 |
| `survivor` | the survivor | **refused**, and correctly — `S` is still here | **PASS 2026-08-03**, 61/61 |

**All five ran on dev, 2026-08-03.** On each of the three refusal shapes the
preview carried a `telegram-mapping-not-owned` conflict and **no** loss line
claiming the mapping was dropped; `absent` raised no conflict at all. Integrity
before each merge showed the expected `telegram-mapping-asymmetric` ERROR (plus
`telegram-mapping-dangling`, WARN, on `no-uid` only) and nothing above INFO
after. Every tag was cleaned. **Observed once each, on one fixture per shape** —
which is coverage of the branch, not proof of it.

```bash
node ops/seed-merge-fixture.js --project $DEV --prod-project $PROD --tag tp1 --telegram --mapping-shape third-party --yes
# refresh · integrity · LOSER row → "merge into…" · READ THE PREVIEW: a
#   telegram-mapping-not-owned conflict must be there, and NO loss line saying
#   the mapping was dropped
node ops/verify-merge.js --project $DEV --prod-project $PROD --tag tp1 --telegram --mapping-shape third-party
node ops/seed-merge-fixture.js --project $DEV --prod-project $PROD --tag tp1 --clean --yes
```

Three things this changes about the checklist above:

* **A refusal shape seeds a deliberately inconsistent account**, so the "no
  errors before the merge" rule does not hold for it: expect
  `telegram-mapping-asymmetric` (ERROR) against the loser, and for `no-uid` a
  `telegram-mapping-dangling` (WARN) as well. That is the state being tested.
  Both CLIs say so in their notes.
* **Verify with the shape you seeded.** The claims differ per shape — `loser`
  asserts the mapping is GONE, three of the others assert it is still there — so
  a mismatch reports a correct merge as owed, which is the `2dec78c` failure
  deliberately re-created. A shape without `--telegram`, or combined with
  `--repoint`, is refused rather than coerced, before the credential is read.
* **`absent` reads back identically to `loser`** — a null over a path that held
  nothing leaves the same tree. What differs is the preview's loss line, which
  no read-back can see; read it on the panel or the run says nothing.

All five action buttons render unconditionally, so `link via merge…` is offered
for a synthetic account like any other. Note the origin badge will read
*inexact*: these uids are not `deriveTelegramUid(tgId, secret)`, so provenance
degrades to the heuristic. That is cosmetic here and blocks nothing.

Four things worth knowing before the first run:

* **The accounts are synthetic, and that is the point.** `merge.js` reads RTDB
  and nothing else, so an app-born account exercises no path a seeded one misses
  — while an app-born account brings a *client*, and on this leg a client is a
  hazard: **G3** (a revoked session keeps writing for up to an hour) and **G6**
  (a *peer's* client republishes cross-user residue permanently, with no
  mitigation). Nothing seeded here is ever opened in a client, so on this leg
  both have no author.
* **Expect exactly one integrity finding per seeded uid** — `auth-missing`,
  severity INFO, an RTDB user with no Auth record. The seed is otherwise
  self-consistent by construction, so the report should be clean of errors and
  warnings *before* the merge. That makes `integrity.js` a second verifier:
  anything worse than INFO afterwards belongs to the merge.
* **Refresh the panel after seeding.** The canvas key list comes from the
  snapshot's shallow REST read, not from the live re-read, so a canvas seeded
  after the last refresh is invisible to the plan and never moves.
* **The merge's own dump is not restorable with this panel.** `restore-preimage.js`
  refuses it (**M9**), and there is no merge equivalent — a merge is not undone by
  replaying a write-set, because the survivor's own prior state is entangled with
  what was carried onto it. Plan a merge as one-way.
* **`adoptGroupNames` has no UI.** `server.js` accepts it and `merge.js`
  implements it, but `panel.html` never sends it — so a `group-member-collision`
  previewed from the browser always resolves *"survivor's record kept"*. The
  per-group displayName **carry** comes from the group the loser is in and the
  survivor is not (`merge.js:220-221`), which is why the fixture seeds one of
  each. To exercise the adopt branch you have to POST the route directly.

The seed's shape and every read-back claim live in `ops/merge-fixture.js` as
plain values; `functions/test/ops-merge-fixture.test.js` drives that write-set
through the **real** `buildMergePlan`/`applyMergePlan` and checks each assertion
against the resulting tree, so the two lists cannot drift away from `merge.js`.

## What each action destroys

| Action | What it destroys |
| --- | --- |
| **purge** | the account and everything the shared expunge enumerator nulls: `users/{uid}`, prefs, **its push tokens**, its code-index entry, its invite tokens (and their index rows), its rows in every peer's follower/following lists, groups it **owns for every member**, its shared canvases, its durable mailboxes, its location nodes and its Telegram mapping. For a group it owned it also releases that group's **id-index lock** and the index rows of **every invite issued in it, whoever issued them** — the records die with the group either way. It **revokes the account's refresh tokens** before the write. With `deleteAuthRecord`, the Auth record goes too — opt-in, and the one thing here no pre-image can undo. Neither the revoke nor the delete prevents the account existing again at the same uid on next app open; both only stop an already-open client republishing its cache. See "Why purge ends the session". |
| **merge** | the loser account. Contacts, group memberships and per-group display names, canvases, durable mailboxes and push tokens are carried to the survivor; `knocks`/`calls` are dropped as transient. Conflicts (a group both are in, a per-group name on both sides) are listed in the preview with the resolution the plan will take. |
| **link via merge** | **nothing.** This is the non-lossy link: the same merge path with the Telegram mapping repointed at the survivor, so contacts, groups, per-group names and canvases all transfer. **Prefer it.** |
| **link as production** | the Telegram-derived account, exactly as the shipped `performLink` would — expunge, then link. Production's own gate only counts followers/following/groups, so it is silent about owned groups, canvases, redeemed invite tokens and durable mailboxes. Use it only when the impact report says `safe`. |

The panel's impact report is deliberately stricter than production's gate:
`safe` requires contacts, groups, canvases, invite tokens, durable mailboxes and
non-default prefs *all* to be zero.

Deleting the Firebase **Auth record** alongside a purge is an **opt-in checkbox**
(`deleteAuthRecord`). It was originally deferred pending whether
`admin.auth().deleteUser` behaves on a custom-token uid; it does, verified on dev
and again on 2026-08-02 with `ops/verify-auth-delete.js` run either side of a
real purge — a record with empty `providerData` before, `NO AUTH RECORD` after.
**G2 is closed.**

What ticking it buys is narrow, and worth being precise about: it stops an
already-open client republishing its cache. It does **not** retire the uid. A
Telegram uid is `deriveTelegramUid(tgId, secret)` — deterministic — so the next
Mini App open mints a fresh token for the *same* uid and a new record appears
under it. Leaving the box unticked leaves the record behind, and a surviving
record is not inert: it keeps the purged account's session alive, which is how
the first step-9 run produced an hour of false residue. See "Why purge ends the
session" and **G3**.

## "canvases were not examined" is not "no canvases"

Canvas keys come from a shallow REST read, because `canvases/{pair}/strokes` is
the only unbounded node in the database and must never be loaded. If that read
fails the panel does **not** take itself down and does **not** report zero
canvases. It marks the list as not examined: the canvas column shows `?`
instead of `—`, a banner explains why, and every purge / link report says the
canvases could not be enumerated instead of quietly giving a clean bill of
health. Approving a destructive write on a `?` means approving an unknown
canvas loss.

## Routes

| Route | Effect |
| --- | --- |
| `GET /` | the page |
| `GET /api/snapshot` | re-reads everything; rows + banner state |
| `GET /api/detail?uid=` | one account, and issues a nonce |
| `GET /api/integrity` | findings over the cached snapshot |
| `POST /api/merge/preview` | plan + nonce; writes nothing |
| `POST /api/merge/execute` | **destructive** |
| `POST /api/purge/preview` | plan + nonce; writes nothing |
| `POST /api/purge/execute` | **destructive** |
| `POST /api/link/impact` | verdict + losses/keeps; writes nothing |
| `POST /api/link/production/preview` | plan + nonce; writes nothing |
| `POST /api/link/production/execute` | **destructive** |

Every execute route requires the uid typed back *and* a nonce, burns that
approval on use, re-reads the database rather than trusting the minutes-old
snapshot the preview was built from, **checks the re-derived plan against the
one you approved**, dumps and flushes the pre-image, and only then issues one
atomic `update()`.

Two details worth being precise about:

* **Nonces are keyed by uid, not by operation.** A nonce is a random UUID
  scoped to an account, so it is not "the nonce from *this* preview" in any
  stronger sense than "the most recent approval recorded for that uid". What
  makes an approval specific is the plan stored beside it: a nonce issued by
  `GET /api/detail` carries no plan and cannot execute anything, and a nonce
  issued by a purge preview will not carry a merge, because the merge's plan
  will not match the purge's.
* **Re-reading can change the plan, and that is a refusal, not an
  auto-correct.** The execute rebuilds the plan against fresh data and compares
  its write paths, its losses and its conflicts to what you actually read. If
  anything differs — a new follower, a group that appeared, a conflict that
  resolved — the request is refused with a diff and nothing is written. Preview
  again and read the new plan. Write *values* are not compared, because merge
  and the production link stamp the current time into what they write; those
  values are captured in full by the pre-image dump instead.

  One documented gap this leaves: at `merge.js:212-213`, when the survivor is
  not yet a member of a group, the whole `loserMember` record is copied to
  `groups/{gid}/members/{S}` as-is. If the loser's `role` flips
  `member`→`owner` between preview and execute *without* `ownerId` changing,
  the path set, losses and conflicts are all identical — the divergence check
  does not fire, and the survivor silently gains owner in that group. The
  operator is not misled about anything they actually read: that `role` value
  is never displayed in the preview, and the pre-image still captures the
  prior value, so it is recoverable after the fact. It just isn't caught at
  execute time — written down here rather than left to be rediscovered.

## The server answers only to itself

Loopback binding alone does not stop **DNS rebinding**: a page you are browsing
can resolve an attacker-controlled name to `127.0.0.1`, become same-origin with
this server, and then read `/api/snapshot` (every uid, share code and tgId) and
drive the execute routes — a cross-origin POST without custom headers is a
"simple request" and is delivered whatever the response says.

So every request is checked before it is routed, the page included:

* the `Host` header must be `127.0.0.1`, `localhost` or `[::1]`, on the port
  this process is actually listening on;
* an `Origin` header, if present, must be a loopback origin on that same port.

Anything else gets a `403` and is never routed. (`Origin` cannot be blanket-
rejected: browsers attach it to every same-origin POST too, so the panel's own
preview and execute calls carry one.)

If you see `refused: Host "…"` in the browser, you reached the panel through a
hostname rather than through `http://127.0.0.1:<port>` — use the literal
address.
