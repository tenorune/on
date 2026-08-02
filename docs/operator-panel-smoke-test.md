# Operator panel — dev-project smoke test

**Status: RUN on the dev project, 2026-08-02.** Steps 1-8 passed. Step 9 ran
**partially** — one purge executed, with the Auth-record box left OFF — and step
10 passed, in the strongest available form: the dump was read back and turned
into a working restore of the purged account. The results table at the bottom
records what was observed and, just as importantly, what each step still owes.
Read it before treating any row as settled.

The run is also what produced `functions/ops/restore-preimage.js`. Step 10 asks
whether the artifact every safety property here rests on can be read; the
honest answer turned out to be "yes, and reading it is not the hard part" —
see "What a restore cannot recover" below.

`functions/ops/README.md` is the runbook — what the panel is, what each action
destroys, what every flag means. This file is narrower: it is the ordered
checklist that turns the three **unexercised** pieces into observed ones.

## What this exists to exercise

Every green test number on this branch covers wiring, not the live system. Three
things have no coverage at all:

1. **`functions/ops/deps.js`** — the Admin-SDK wiring. Deliberately logic-free
   and the one ops module with no tests, so its correctness rests entirely on
   this run. Note `listCanvasKeys` builds a REST URL by hand
   (`deps.js:52-57`) and `listAuthUsers` pages `auth.listUsers` — neither has
   ever contacted Google.
2. **`functions/ops/panel.html`** — behaviour in a real browser.
3. **The `Host` / `Origin` guard** (`server.js:222`) as a browser actually
   drives it. This matters most: the server holds a full-database admin
   credential in-process and **has no login**. That guard is its only
   authentication boundary.

## Before you start

- **Use a dev/staging Firebase project. Never production.** Steps 7–9 destroy
  data on purpose.
- Have a service-account JSON for that project with database + auth admin.
- Know the project's `TELEGRAM_UID_SECRET`. Without it provenance degrades to a
  heuristic (README "Environment") — that is a legitimate thing to smoke-test,
  but check the exact-provenance path at least once.
- Linux or macOS. The audit dump fsyncs its containing directory and throws
  `EISDIR` on Windows; that is a documented requirement, not a bug to work
  around.
- Seed the project with at least: two accounts with a share code, one following
  the other; one group with two members; one account with a Telegram mapping;
  one canvas between two accounts; one account with a `locations/{uid}` node and
  a `locationCells/{gid}/{uid}` entry. Steps 3–6 are much weaker without them.

## The run

### 1. Start it

```bash
cd /path/to/on/functions
GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)" \
TELEGRAM_UID_SECRET="<the dev project's uid secret>" \
node ops/server.js --project <dev-project-id> --prod-project <prod-project-id>
```

**Expect on stdout:** `ops panel: http://127.0.0.1:8787  project=<dev-project-id>`,
then the audit-trail line. **No** production banner, because `--prod-project`
names a different project.

**Expect NOT to see:** `TELEGRAM_UID_SECRET unset`. If you do, the secret did not
reach the process and provenance results in step 4 are meaningless.

If the secret is already in `functions/.env`, drop that line from the command —
the panel reads those two variables from that file and says so on stdout
(`loaded from functions/.env: …`). A value passed on the command line still
wins. Note the shell trap this replaces: a `\` with a **trailing space** ends the
line instead of continuing it, so the assignment binds to an empty command and
never reaches `node`; the same happens if the variable is assigned on its own
line without `export`. In both cases the process starts and reports the secret
as unset, which is what the check above is for.

This is the first moment `deps.js` runs. A malformed credential surfaces here as
a `JSON.parse` or `cert()` throw.

### 2. Confirm the production gate before trusting anything else

```bash
# same env, but claim the dev project IS production
... node ops/server.js --project <dev-project-id> --prod-project <dev-project-id>
```

**Expect:** refusal to start, naming the project and telling you to re-run with
`--i-know-this-is-prod`. Then drop `--prod-project` entirely:

```bash
... node ops/server.js --project <dev-project-id>
```

**Expect:** also a refusal — the gate fails closed when production is *undeclared*,
not just when it matches. If either of these starts the server, stop the smoke
test; the gate is the thing standing between this tool and production.

Restart with the step-1 command before continuing.

### 3. The page loads and the snapshot is real

Open <http://127.0.0.1:8787> in a browser.

**Expect:** the account table renders with your seeded accounts — real uids,
share codes, contact/group counts that match what you seeded. This is
`GET /api/snapshot` end to end: `deps.js` reads, `snapshot.js` projects,
`panel.html` renders.

**Specifically check the canvas column**, because `listCanvasKeys` is the
hand-built REST call. If canvases you seeded do not appear, suspect the
`databaseURL`/region derivation before suspecting the panel.

### 4. Detail view and provenance

Click into an account you know the origin of — ideally the Telegram-linked one.

**Expect:** the detail pane opens, and the origin badge reads exactly (not in the
"inexact" style) for the Telegram-derived account, since `TELEGRAM_UID_SECRET` is
set. An account you created via the web should read phrase-born.

Remember graduated-vs-linked is a **heuristic** even with the secret (HANDOFF
landmine) — do not treat that distinction as a failure.

### 5. Integrity report

Open the integrity view.

**Expect:** it completes and lists findings by severity. On a clean dev project
the interesting outcome is few or no findings; the point of this step is that the
report *runs* over live data without throwing.

If you seeded a `locationCells/{gid}/{uid}` entry for a **non-member**, expect a
`location-cell-non-member` warning.

### 6. The guard — the important part

Two halves. Do both; they fail differently.

**6a. From the browser.** With the panel open, run any preview through the UI. It
must work. Per the Fetch standard a browser attaches `Origin` to every non-GET
request *including same-origin ones*, so the panel's own `POST`s arrive carrying
one and must be **allowed**. A guard that blocks these is broken in the direction
that makes the tool unusable — and that is why the rule is "an `Origin`, when
present, must be a loopback origin on this port" rather than "reject any request
carrying `Origin`".

**6b. From curl.** These simulate what a hostile page can do. Run each; the
expected result is a **403 with a plain-text reason**.

```bash
# baseline — must SUCCEED (curl sends Host: 127.0.0.1:8787)
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/api/snapshot

# DNS rebinding: the browser would send the name it resolved
curl -sS -w '\n%{http_code}\n' -H 'Host: evil.example.com' \
  http://127.0.0.1:8787/api/snapshot

# right host, wrong port — the guard compares against the real socket
curl -sS -w '\n%{http_code}\n' -H 'Host: 127.0.0.1:9999' \
  http://127.0.0.1:8787/api/snapshot

# ordinary cross-origin POST
curl -sS -w '\n%{http_code}\n' -H 'Origin: http://evil.example.com' \
  http://127.0.0.1:8787/api/snapshot

# a sandboxed / file: document
curl -sS -w '\n%{http_code}\n' -H 'Origin: null' \
  http://127.0.0.1:8787/api/snapshot

# same-origin Origin — must SUCCEED
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Origin: http://127.0.0.1:8787' \
  http://127.0.0.1:8787/api/snapshot

# the other accepted loopback spellings — must SUCCEED
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: localhost:8787' \
  http://127.0.0.1:8787/api/snapshot
```

Expected: `200`, `403`, `403`, `403`, `403`, `200`, `200`, in that order.

A `200` where a `403` is expected means the panel will answer a hostile page, and
the panel must not be pointed at anything you care about until it is fixed.

**Also confirm the socket is not reachable off-box.** From another machine on the
same network:

```bash
curl -sS --max-time 5 http://<the-panel-machine-ip>:8787/api/snapshot
```

**Expect:** connection refused/timeout — not a response. `BIND_ADDRESS` is
`127.0.0.1` and there is deliberately no `--host` flag.

### 7. A preview writes nothing

Pick a throwaway account. Run a **purge preview**.

**Expect:** a loss report naming what dies. Then verify in the Firebase console
that the account is **still there** and unchanged. Preview must be inert.

### 8. Divergence refusal

With a preview on screen, change the account in another window — add a follower,
join a group. Now press execute.

**Expect:** a refusal with a diff, and nothing written. Preview again and confirm
the new plan reflects the change.

This is the check that the execute path re-reads rather than trusting the
snapshot. Note its documented limit: write *values* are not compared, so the
`role` `member`→`owner` case in the README's merge note will not be caught.

### 9. Execute, on data you are willing to lose

**Close the Mini App and any signed-in web client for the account you are about
to purge, before you press execute.** This is not hygiene — it is the only
reliable mitigation. Purge revokes that account's refresh tokens first, but
revocation does not evict a live session: measured on dev 2026-08-02, a client
kept writing for **at least 33 minutes** after the revoke and had stopped by
**66**, the cut-off being its ID token's own one-hour expiry. The window runs
from when the client last opened, so a client opened just before a purge has
close to a full hour in which it can put back what the purge deleted — and what
it writes looks exactly like residue the purge missed. The first run of this step
lost an hour to that: `userPrefs/{uid}` came back with its cached `following`
list after a purge that had correctly deleted it.

Run one purge and one merge to completion on throwaway accounts. Do the purge
twice if you have the accounts for it — once with the **delete the Auth record**
box left off, once with it ticked — and check `auth.listUsers` (or the Firebase
console) for the record either surviving or being gone.

For the Auth side, `functions/ops/verify-auth-delete.js` does the scripted part
and prints the fields rather than leaving you reading console screenshots
(README, "Proving the Auth calls on a custom-token uid"). Three of its checks
are yours, not the script's:

- **the revoke window** — MEASURED 2026-08-02: writes kept landing 33 min after
  the revoke and were refused by 66, bracketing the ID token's one-hour expiry.
  Re-measure only if the rules gain an `auth.token.auth_time` check or the token
  lifetime changes.
- **the uid coming back** — CONFIRMED 2026-08-02: after `--yes-delete`, reopening
  the Mini App produced a new Auth record under the **same** uid. Telegram uids
  are derived deterministically and the app mints a fresh custom token on every
  open, so neither the revoke nor the delete retires the account.

One artifact to expect if you probe an **un-purged** account: the recreated Auth
record has no `tg-<uid>@telegram.invalid` identifier. That stamp is applied only
on the no-mapping bootstrap branch (`telegram-auth.js:127-147`), and the probe
leaves `telegramUsers/{tgId}` intact, so the branch is skipped. A real purge
deletes the mapping, so the stamp is reapplied. Not a defect — but an unstamped
record loses the "(telegram-derived)" label in the `auth-orphan` integrity
finding (`integrity.js:207`).

**Expect after each:**

- the write lands as **one** atomic update — the account and its residue go
  together, no half-state;
- `.ops-audit/` contains the pre-image dump and a log line;
- the residue really is gone. Check the families that this branch changed most
  recently, because they have never been observed live:
  `locations/{uid}`, `locationCells/{gid}/{uid}` for each of its groups, and —
  if the purged account **owned** a group — that `locationCells/{gid}` is gone
  **entirely**, including cells belonging to other members.
- if the account held a Telegram mapping, `telegramUsers/{tgId}` is gone; if it
  pointed at a mapping owned by someone *else*, that mapping is **untouched**
  and the report said so.

### 10. Recover a pre-image

Follow the README's "Reading a pre-image back" on the dump from step 9 and
confirm it round-trips. An audit trail nobody has ever read back is not an audit
trail.

`functions/ops/restore-preimage.js` is the scripted form of that README section
— dry-run by default, one verdict per path, one atomic update with `--yes`. It
exists because this step ran for real: the dump was not only read but used to
put a purged account back.

### What a restore cannot recover

Learned by doing it, 2026-08-02. Reading a pre-image back is easy; knowing what
it does **not** contain is the part worth writing down.

- **Canvas strokes.** Never captured. Only `bg` is recoverable.
- **Anything the purge did not itself write.** The dump is the purge's
  write-set, so a CASCADE the purge merely *triggered* is outside it. The live
  case: purging a group's owner deletes `groups/{gid}` wholesale, and every
  other member's client then deletes its own `users/{member}/groups/{gid}`
  entry (`js/groupNav.ts:250-258`, `js/groupContext.ts:1499-1508`), because an
  owner has no permission to clear another user's record. Restoring the group
  therefore leaves it real, membered, and **invisible in every other member's
  nav** — exactly `integrity.js:103`'s `group-enumeration-missing`.
  Device-observed, then repaired with `--heal-group-enumeration`, which rebuilds
  those entries from the restored member list. Filed as **G4**.
- **A live client's republish is not residue.** If the account's client was open
  at purge time it puts its cached state back (G3), and on the way *in* that
  reads as residue the purge missed — on the way *out* it reads as a conflict at
  `userPrefs/{uid}`. Restoring over it wholesale would drop whatever the client
  wrote after the purge; `--merge-account` keeps it.

## Results

Recorded 2026-08-02 from the operator's run. **OBSERVED** means seen; a row that
still owes something says so, and an unfinished row is not a passing row.

| # | Step | Result | Notes |
|---|---|---|---|
| 1 | Starts, banner correct | PASS | |
| 2 | Prod gate refuses both ways | PASS | |
| 3 | Snapshot renders, canvases present | PASS | |
| 4 | Detail + exact provenance | PASS | |
| 5 | Integrity report runs | PASS | |
| 6a | Panel's own POSTs allowed | PASS | |
| 6b | 7 curl probes: 200/403/403/403/403/200/200 | PASS | |
| 6c | Not reachable off-box | PASS | |
| 7 | Preview writes nothing | PASS | |
| 8 | Divergence refused | PASS | |
| 9 | Execute: atomic, audited, residue gone | **PARTIAL** | One purge, Auth box **OFF**. The dump was written and the deletes landed — the restore's dry run re-read every dumped path and found all but one empty, which is direct evidence the purge's write-set was applied. **Still owed:** the second purge with the Auth box **ticked**, a **merge** to completion, and the residue sweep over `locations/{uid}`, `locationCells/{gid}/{uid}` and an owned group's whole `locationCells/{gid}` — the restore skips those families as transient, so it says nothing about them. |
| 10 | Pre-image reads back | **PASS** | Strongest form: all four README read-back commands run verbatim, and the dump was used to restore the account. See "What a restore cannot recover" — the gap found is G4, not a defect in the dump. |

Two things the run changed elsewhere: `functions/ops/restore-preimage.js`
(+ `functions/test/ops-restore.test.js`) and **G4** in
`docs/operator-panel-followups.md`.
