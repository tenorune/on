# Operator panel — dev-project smoke test

**Status: NOT RUN.** No service-account credential has existed in any container
this panel was built in, so nothing below has been executed even once. This is a
script to follow, not a record of a passing run. Fill in the results table at the
bottom as you go.

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

Run one purge and one merge to completion on throwaway accounts.

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

## Results

| # | Step | Result | Notes |
|---|---|---|---|
| 1 | Starts, banner correct | | |
| 2 | Prod gate refuses both ways | | |
| 3 | Snapshot renders, canvases present | | |
| 4 | Detail + exact provenance | | |
| 5 | Integrity report runs | | |
| 6a | Panel's own POSTs allowed | | |
| 6b | 7 curl probes: 200/403/403/403/403/200/200 | | |
| 6c | Not reachable off-box | | |
| 7 | Preview writes nothing | | |
| 8 | Divergence refused | | |
| 9 | Execute: atomic, audited, residue gone | | |
| 10 | Pre-image reads back | | |

Record the outcome in `docs/HANDOFF.md` when done — that file currently states
these are unexercised, and it should not keep saying so once they are not.
