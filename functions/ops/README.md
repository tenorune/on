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

**Caveat to confirm on your own project:** revocation does not invalidate an
already-issued ID token — Firebase honours those until they expire unless the
rules check `auth.token.auth_time`. `database.rules.json` does not, so expect a
window after the revoke in which an active client can still write. Deleting the
Auth record does not close that window either.

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

## What each action destroys

| Action | What it destroys |
| --- | --- |
| **purge** | the account and everything the shared expunge enumerator nulls: `users/{uid}`, prefs, its code-index entry, its invite tokens (and their index rows), its rows in every peer's follower/following lists, groups it **owns for every member**, its shared canvases, its durable mailboxes, its location nodes and its Telegram mapping. It also **revokes the account's refresh tokens** before the write. Push tokens are left behind as residue but stop working. With `deleteAuthRecord`, the Auth record goes too — opt-in, and the one thing here no pre-image can undo. |
| **merge** | the loser account. Contacts, group memberships and per-group display names, canvases, durable mailboxes and push tokens are carried to the survivor; `knocks`/`calls` are dropped as transient. Conflicts (a group both are in, a per-group name on both sides) are listed in the preview with the resolution the plan will take. |
| **link via merge** | **nothing.** This is the non-lossy link: the same merge path with the Telegram mapping repointed at the survivor, so contacts, groups, per-group names and canvases all transfer. **Prefer it.** |
| **link as production** | the Telegram-derived account, exactly as the shipped `performLink` would — expunge, then link. Production's own gate only counts followers/following/groups, so it is silent about owned groups, canvases, redeemed invite tokens and durable mailboxes. Use it only when the impact report says `safe`. |

The panel's impact report is deliberately stricter than production's gate:
`safe` requires contacts, groups, canvases, invite tokens, durable mailboxes and
non-default prefs *all* to be zero.

Deleting the Firebase **Auth record** alongside a purge is deferred on purpose —
`admin.auth().deleteUser` has not been verified against a custom-token uid — so
there is no checkbox for it. A purged account leaves its Auth record behind.

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
