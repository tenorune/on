# Smoke test — the followup queue + the security audit (2026-08-04)

**Status: NOT RUN.** Part A was exercised in a session container on a fake
credential (see each step); Parts B–E have never been run at all. Nothing here
is a passing row until an operator runs it and fills in the results table.

## What this is

`docs/operator-panel-smoke-test.md` is COMPLETE — its ten steps all pass, and it
is not superseded by this file. This document is the **next** run: it covers only
what shipped *after* those steps were exercised, namely

- the build queue closed 2026-08-03 — **G4, M12, M5, M4, M3, M8** — plus the
  G6-descended client work (**G6, G9, G10, M10, M11**) and **G8**;
- the eight items of `docs/security-audit-2026-08-04-roadmap.md` —
  **SEC-1 … SEC-8**.

Every one of those is verified by **jest, the rules emulator, or an offline SDK
probe only**. No session container has ever held a service-account credential, so
none of it has run against a live Firebase project. That is the gap this file
exists to close, and it is why "the suite is green" is not an answer to any step
below.

Read `functions/ops/README.md` (the runbook) and the "Before you start" section
of `docs/operator-panel-smoke-test.md` first — its preconditions (dev project
only, service-account JSON, `TELEGRAM_UID_SECRET`, Linux/macOS, seeded accounts)
all still apply and are not repeated here.

## Inventory — every item closed since the last smoke test

"Live run adds" is the honest question for each: some of these have nothing a
live run can tell you that the suite has not already settled.

| ID | What shipped | Verified so far | Live run adds | Step |
|---|---|---|---|---|
| **SEC-1** | `presence/code` charset rule; three admin sinks check `codeIndex` ownership | rules emulator + store mock | the rule is really deployed on dev; the ownership check on live data | D1, C6 |
| **SEC-2** | `requireUid`/`assertUid` at the edge and in the builders | jest (105 cases) | nothing — but it is free, and it pins the edge on your machine | A4 |
| **SEC-3** | port-less `Host`/`Origin` resolve to the scheme default | jest | nothing logically; confirms your build serves it | A2 |
| **SEC-4** | `rootUpdate` REFUSES a key with an empty segment | jest + offline `firebase-admin` probe | that no shipped caller regressed — a **regression** check, not a positive one | E1 |
| **SEC-5** | `.ops-audit/` unanchored; audit dir absolute | jest via `git check-ignore` | that dumps land there from *your* launch directory | A5 |
| **SEC-6** | `endSession` on merge + link-as-production | jest + headless Chromium on canned routes | **the revoke itself — explicitly UNVERIFIED-LIVE** | C1, C2 |
| **SEC-7** | CSP with per-response nonce, `X-Frame-Options` | jest + headless Chromium | that a real browser runs the panel under the nonce | A3, B0 |
| **SEC-8** | docs only — "G3" kept on the merge leg | n/a | nothing to run | — |
| **G4** | purge preview names predicted cascades | jest | **the block has never been rendered in a browser** | B1, C3 |
| **G6** | rules `.validate` on `following/$followee` + client gate | rules emulator | **live on dev, never exercised** | D2, D3 |
| **G8** | purge no longer refuses an account with no Auth record | jest + the run that found it | already observed live | — |
| **G9** | `rotateCode` drops a dead followee from its fan-out | jest | never device-observed | D4 |
| **G10** | redemption's refusable write runs first | jest | never device-observed | D5 |
| **M3** | `canvasUids` shared helper | jest | integrity still reports canvases correctly on live data | B4 |
| **M4** | non-`EEXIST` rethrow | jest, **fake fs only** | **the rethrow on a real filesystem** | C5 |
| **M5** | 100-attempt filename cap | jest, fake fs only | nothing practical — see "Nothing to smoke test" | — |
| **M8** | `adoptGroupNames` tick in the browser | jest + browser on **canned** responses | **the tick against a live merge** | B2, C4 |
| **M10** | jest pins the path `setFollowingEntry` builds | jest | nothing — it is a guard over two files | — |
| **M11** | revocation clear + follow write in one atomic update | jest + rules emulator | the atomicity against the real backend | D5 |
| **M12** | jest guard tying the rules predicate to `followeeExists` | jest | nothing — it is a guard over two files | — |

## Prerequisites, by part

| Part | Needs | Destroys data |
|---|---|---|
| **A** | nothing but the repo and node | no |
| **B** | dev project + service-account JSON | no |
| **C** | dev project + throwaway/fixture accounts | **yes, on purpose** |
| **D** | dev project + a real signed-in client (device or browser) | no (writes test data) |
| **E** | dev project with functions deployed | no |

Parts A and B are safe to run in any order. **Do not start C without reading
step C0.** D is independent of A–C and can be run by someone else.

---

# Part A — no Firebase project required

Everything in Part A refuses *before* the panel reads the database, so it runs
against a **well-formed but fake** service-account credential. This is the
cheapest tier and it covers four of the eight audit items.

**OBSERVED 2026-08-04** in a session container at `c42cd94`, on a generated fake
service account, panel on `:8787`. Re-run on the operator machine to confirm the
build being run there behaves the same — the point of a smoke test is the
machine, not the logic.

### A0. Start a panel with no real project

```bash
cd /path/to/on/functions
node -e '
const c=require("node:crypto"),{privateKey}=c.generateKeyPairSync("rsa",{modulusLength:2048});
require("node:fs").writeFileSync("/tmp/fake-sa.json",JSON.stringify({
  type:"service_account",project_id:"smoke-fake",private_key_id:"fake",
  private_key:privateKey.export({type:"pkcs8",format:"pem"}),
  client_email:"fake@smoke-fake.iam.gserviceaccount.com",client_id:"0",
  auth_uri:"https://accounts.google.com/o/oauth2/auth",token_uri:"https://oauth2.googleapis.com/token"}));'

GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat /tmp/fake-sa.json)" \
  node ops/server.js --project smoke-fake --prod-project other --port 8787
```

**Expect on stdout**, exactly three lines:

```
ops panel: http://127.0.0.1:8787  project=smoke-fake
TELEGRAM_UID_SECRET unset — provenance will read "unknown"
audit trail: /path/to/on/functions/.ops-audit/
```

No production banner (`--prod-project` names a different project). The panel
starts without ever contacting Google — `makeOpsDeps` builds the credential but
nothing reads until a route needs it.

⚠️ **This tier cannot test anything that reads.** `GET /api/snapshot`, the
integrity report and both merge previews all fail with a Google OAuth
`invalid_grant` error here. That is the fake credential, not a defect — see the
note under A4.

### A1. The production gate still fails closed (regression)

`server.js` changed substantially across SEC-2/3/5/6/7. Re-run the existing
step 2, because a gate that regressed is worth more than anything else on this
page:

```bash
# claim the target IS production
... node ops/server.js --project smoke-fake --prod-project smoke-fake --port 8789
# declare no production project at all
... node ops/server.js --project smoke-fake --port 8789
```

**Expect** both to refuse to start:

```
Error: smoke-fake is the production project — re-run with --i-know-this-is-prod if that is deliberate
Error: No production project is declared, so this panel cannot tell dev from production and assumes production. Set --prod-project <id> (or PROD_PROJECT) to name it, or re-run with --i-know-this-is-prod if that is deliberate.
```

**OBSERVED 2026-08-04**, both verbatim.

### A2. SEC-3 — the guard enforces the port, including when the header omits one

The pre-SEC-3 defect: a header carrying **no** port skipped the port comparison
entirely, so a page on `http://127.0.0.1` (port 80) was accepted by a panel on
`:8787`. Rows marked **SEC-3** are the new ones; the rest are the original step
6b, re-run as regression.

```bash
P=http://127.0.0.1:8787
probe () { printf '%-52s ' "$1"; shift; curl -sS -o /dev/null -w '%{http_code}\n' "$@" $P/; }

probe "baseline                            expect 200"
probe "Host: evil.example.com              expect 403" -H 'Host: evil.example.com'
probe "Host: 127.0.0.1:9999                expect 403" -H 'Host: 127.0.0.1:9999'
probe "Host: 127.0.0.1     SEC-3           expect 403" -H 'Host: 127.0.0.1'
probe "Host: localhost     SEC-3           expect 403" -H 'Host: localhost'
probe "Origin: http://127.0.0.1   SEC-3    expect 403" -H 'Origin: http://127.0.0.1'
probe "Origin: http://localhost   SEC-3    expect 403" -H 'Origin: http://localhost'
probe "Origin: https://127.0.0.1  SEC-3    expect 403" -H 'Origin: https://127.0.0.1'
probe "Origin: http://evil.example.com     expect 403" -H 'Origin: http://evil.example.com'
probe "Origin: null                        expect 403" -H 'Origin: null'
probe "Origin: http://127.0.0.1:8787       expect 200" -H 'Origin: http://127.0.0.1:8787'
probe "Host: localhost:8787                expect 200" -H 'Host: localhost:8787'
```

**Expect:** `200 403 403 403 403 403 403 403 403 403 200 200`.

The refusal body is plain text and names the reason, e.g.

```
refused: Host "127.0.0.1" is not this server's loopback address — this panel answers only to 127.0.0.1 / localhost on its own port (DNS-rebinding guard)
```

A `200` on any SEC-3 row means the fix is not in the build you are running.

**OBSERVED 2026-08-04**, all twelve.

**What this does NOT cover:** a panel genuinely listening on port 80 must still
*accept* a port-less header — the property the fix had to avoid breaking. That
case needs a privileged port and was not run here; it is pinned by jest
(`ops-server.test.js`).

### A3. SEC-7 — CSP and framing headers

```bash
# the PAGE
curl -sS -D - -o /dev/null http://127.0.0.1:8787/ \
  | grep -iE '^(content-security-policy|x-frame-options|content-type):'

# an API response
curl -sS -D - -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d '{"uid":"abc"}' http://127.0.0.1:8787/api/purge/preview \
  | grep -iE '^(content-security-policy|x-frame-options):'
```

**Expect on the page:**

```
Content-Type: text/html; charset=utf-8
X-Frame-Options: DENY
Content-Security-Policy: default-src 'none'; script-src 'nonce-<uuid>'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

**Expect on the API response** the strict base policy, with no exceptions:

```
X-Frame-Options: DENY
Content-Security-Policy: default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

Then the two properties a header dump alone does not show:

```bash
# 1. the nonce is fresh per response — two fetches, two different uuids
for i in 1 2; do curl -sS -D - -o /dev/null http://127.0.0.1:8787/ \
  | grep -io 'nonce-[0-9a-f-]*'; done

# 2. the header's nonce and the page body's nonce are the SAME uuid,
#    and no placeholder survives
curl -sS -D /tmp/h.txt http://127.0.0.1:8787/ > /tmp/b.html
grep -i '^content-security-policy' /tmp/h.txt | grep -o 'nonce-[0-9a-f-]*'
grep -o 'nonce="[0-9a-f-]*"' /tmp/b.html | head -1
grep -c '__CSP_NONCE__' /tmp/b.html   # expect 0
```

**Expect:** two different uuids from the first; identical uuids from the second;
`0` placeholders.

`connect-src 'self'` is the load-bearing departure from the audit's own
prescription — without it the panel's `fetch('/api/*')` dies and the page renders
empty. B0 is where you confirm it in a browser; a header dump cannot tell a
hardened panel from a broken one.

**OBSERVED 2026-08-04**: all four, including a header/body nonce match.

### A4. SEC-2 — a malformed uid is refused before any read

`"/"` is the dangerous one: the SDK collapses `users//` to the whole `users`
node, and the old "typo'd uid" guard read that back as a populated account.

```bash
P=http://127.0.0.1:8787
post () { printf '%-46s ' "$1"; curl -sS --max-time 10 -X POST \
  -H 'Content-Type: application/json' -d "$2" $P$3; echo; }

post 'purge/preview  uid="/"'   '{"uid":"/"}'   /api/purge/preview
post 'purge/preview  uid="//"'  '{"uid":"//"}'  /api/purge/preview
post 'purge/preview  uid=" "'   '{"uid":" "}'   /api/purge/preview
post 'purge/preview  uid="a/b"' '{"uid":"a/b"}' /api/purge/preview
post 'purge/preview  uid="a."'  '{"uid":"a."}'  /api/purge/preview
post 'purge/preview  uid=""'    '{"uid":""}'    /api/purge/preview
curl -sS "$P/api/detail?uid=%2F"; echo

post 'merge/execute'      '{"loserUid":"/","survivorUid":"a","confirmUid":"/","nonce":"x"}'   /api/merge/execute
post 'purge/execute'      '{"uid":"/","confirmUid":"/","nonce":"x"}'                          /api/purge/execute
post 'link/prod/execute'  '{"derivedUid":"/","phraseUid":"a","confirmUid":"/","nonce":"x"}'   /api/link/production/execute
```

**Expect** every line except the empty-string one to return

```json
{"error":"Error: <field> must be a Firebase uid: letters, digits, '-' or '_', 1-128 characters"}
```

with `<field>` being `uid`, `loserUid` or `derivedUid` as appropriate, and the
empty-string case returning `{"error":"Error: uid is required"}` — `requireString`
still owns the blank box, deliberately, so an empty field does not read
"malformed".

⚠️ **`POST /api/merge/preview` and `POST /api/link/production/preview` are the
exception, and it is ORDERING, not a defect.** Both call `current()` (a
read-only snapshot fetch) *before* the uid check runs — `server.js:776` precedes
`mergeOptions`'s `requireUid` at `:777`. On a **fake** credential you therefore
get a Google OAuth `invalid_grant` error instead of the uid refusal. **On the
real dev project in Part B these two return the uid refusal**, after a harmless
read. Check them there, not here. The execute routes have no such ordering —
`requireUid` runs ahead of `consumeConfirm` — and all three refused cleanly
above.

**OBSERVED 2026-08-04**: all seven preview/detail refusals and all three execute
refusals, with the ordering caveat confirmed by reading the route.

### A5. SEC-5 — the dump directory is ignored, and does not move with your shell

Two independent halves; the item existed because the rule and the writer
disagreed about where dumps go.

```bash
cd /path/to/on
for p in .ops-audit/x.json functions/.ops-audit/x.json \
         functions/ops/deeper/.ops-audit/x.json; do
  printf '%-46s ' "$p"
  git check-ignore -q "$p" && echo IGNORED || echo "NOT IGNORED"
done
printf '%-46s ' 'functions/ops/server.js (control)'
git check-ignore -q functions/ops/server.js && echo IGNORED || echo "NOT IGNORED"
```

**Expect:** the three dump paths `IGNORED`, the control `NOT IGNORED`. The rule
is `.ops-audit/` at `.gitignore:18` — unanchored, matching at any depth. Before
SEC-5 it read `functions/.ops-audit/` and the first and third came back
`NOT IGNORED`.

Then the writer half — **launch the panel from the repo root, not `functions/`**:

```bash
cd /path/to/on
GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat /tmp/fake-sa.json)" \
  node functions/ops/server.js --project smoke-fake --prod-project other --port 8788
```

**Expect** the audit line to name the same absolute directory as when launched
from `functions/`:

```
audit trail: /path/to/on/functions/.ops-audit/
```

Before SEC-5 this read `/path/to/on/.ops-audit/` — a real directory matched by no
ignore rule, holding push tokens, Telegram chat ids, coarse location cells and
(with the Auth-delete box) email. An explicit `--audit-dir` still wins; that is
by design, and the unanchored rule covers a custom location too.

**OBSERVED 2026-08-04**: both halves, including the root launch.

### A6. The socket is not reachable off-box

The one check in this family a container cannot answer: `BIND_ADDRESS` is
`127.0.0.1` and there is deliberately no `--host` flag, but "nothing else on the
network can reach it" is a property of the machine and its interfaces, not of the
code. This process holds a full database-admin credential and has **no login**, so
a reachable socket is a full compromise.

Carried over from the original smoke test's step 6c, which this page omitted in
its first draft.

**With the panel running**, from a second machine on the same network:

```bash
curl -sS --max-time 5 http://<the-panel-machine-lan-ip>:8787/api/snapshot
```

**Expect:** connection refused or timeout — not a response.

⚠️ **Run the control in the same sitting, or the result means nothing.** A panel
that is not running produces a *byte-identical* `Couldn't connect to server`. So
either side of the off-box probe, from the panel machine itself:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/   # expect 200
```

A `200` on loopback and a refusal off-box is the pass. A refusal on both means
the panel was down and the test did not run.

**What this does NOT distinguish:** a host firewall dropping the connection from
the bind address refusing it. Both are safe outcomes today, but only one is in
the code — a firewall rule can be changed by someone who does not know why it is
there. The code-level guarantee is `BIND_ADDRESS` plus the absent `--host` flag;
this step is consistent with it, not proof of it.

---

# Part B — dev project, panel, nothing written

Restart the panel with the **real** dev credential, exactly as step 1 of
`docs/operator-panel-smoke-test.md`. Everything in Part B is preview-only:
previews are inert (that is the original step 7, still true).

### B0. SEC-7 in a real browser

Open <http://127.0.0.1:8787> with devtools open, **Console** tab visible.

**Expect:** the account table renders, and the console shows **zero** entries —
no errors, and in particular no
`Refused to connect to … because it violates the following Content Security
Policy directive: "connect-src …"`.

**This is the step a header dump cannot replace.** A CSP that blocks the panel's
own `fetch` yields a page that looks like an empty project rather than a broken
one. If the table is empty, check the console before you conclude the project is
empty.

Also confirm framing: the page must refuse to load in an iframe. `X-Frame-Options:
DENY` plus `frame-ancestors 'none'` are on **every** response, not just the page.

### B1. G4 — the purge preview names the cascade it will trigger

**This block has never been rendered in a browser.** It needs an account that
**owns a group with at least one other member** — nothing is predicted otherwise,
and "none predicted" would be a passing-looking non-result.

The merge fixture already seeds exactly that shape, so use it rather than
hand-seeding:

```bash
cd functions
export GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)"
node ops/seed-merge-fixture.js --project $DEV --prod-project $PROD --tag g4v1        # dry run
node ops/seed-merge-fixture.js --project $DEV --prod-project $PROD --tag g4v1 --yes
```

`smk-g4v1-loser` owns group `smg-g4v1-owned`, whose other member is
`smk-g4v1-peer1` (`ops/merge-fixture.js`, GC). Refresh the panel, click into
`smk-g4v1-loser`, press **purge…**.

**Expect** in the preview, in its own amber-bordered block under the losses,
headed *"predicted client cascades — NOT in the write-set, and NOT in the
pre-image, so a restore cannot replay them"*:

```
PREDICTED CASCADE (client behaviour, NOT a write in this plan): deleting group
"<group name>" takes it out from under smk-g4v1-peer1, whose own clients then
delete users/smk-g4v1-peer1/groups/smg-g4v1-owned — an owner cannot clear another
member's record, so each client clears its own (js/groupNav.ts, js/groupContext.ts,
both via removeUserGroupsEntry). Nothing writes those paths here, so they are NOT
in the pre-image and a restore cannot replay them: the group comes back real and
invisible in those members' nav. ops/restore-preimage.js --heal-group-enumeration
rebuilds them from the restored member list, and integrity.js reports the un-healed
state as group-enumeration-missing.
```

Then check the two negative cases, which is where a hand-maintained model gets
caught being wrong:

- click into `smk-g4v1-peer2` (owns `smg-g4v1-shared`, which also has other
  members) → a cascade IS predicted;
- click into `smk-g4v1-follower` (owns nothing) and press **purge…** → the block
  reads exactly `none predicted`;
- press **merge into…** on `smk-g4v1-loser` → the block reads `none predicted`.
  A merge moves ownership rather than deleting the group, and `merge.js:434`
  returns `cascades: []` as a *claim*, not a placeholder.

**Do not execute.** Close the dialog; B1 is a rendering check.

**What this does NOT prove:** the cascade list is a hand-maintained model of
client behaviour. `none predicted` means none of the **modelled** cascades apply,
and nothing enforces that the model is complete. Confirming the cascade actually
*happens* is a device exercise, not this step.

### B2. M8 — the adopt tick appears and re-previews

Needs a **group both accounts are in** — the collision branch. The fixture's
`smg-g4v1-shared` (GB) is exactly that, with both `smk-g4v1-loser` and
`smk-g4v1-survivor` in it.

Click into `smk-g4v1-loser` → **merge into…** → survivor `smk-g4v1-survivor`.

**Expect** below the losses, headed *"per-group display names — tick to adopt the
LOSER's name in that group (each tick re-previews, so the plan above always
matches what will execute)"*, exactly **one** checkbox row, showing the
collision's detail and its current resolution.

Tick it. **Expect the whole preview to re-render** — this is the property that
matters, not the checkbox existing:

- the conflict's **resolution line changes** (the loser's per-group name is now
  adopted rather than the survivor's record kept);
- the **path list grows by one** write path.

Untick it and confirm both revert. A tick that is remembered locally without
re-previewing would show one plan and execute another; M8 re-previews on purpose,
and the server's own preview-to-execute check would refuse the mismatch anyway —
safely, but telling the operator nothing.

Before M8 this block did not exist: `panel.html` never sent `adoptGroupNames`, so
a collision previewed from the browser always resolved "survivor's record kept"
and the loser's name could not be adopted without POSTing by hand.

**Do not execute here** — see C4, and read its warning first.

### B3. SEC-6 — the session footnote is on the routes that gained the revoke

Purge has carried this paragraph since 2026-08-02. SEC-6 gave the other two
routes the revoke; the footnote is its operator-facing half, and before it a
merge said nothing at all about the session.

Open each preview and confirm the paragraph is present and names the **right**
account:

| Preview | Expect the footnote to say |
|---|---|
| **purge…** | "The account's session is revoked before the write either way" |
| **merge into…** | "The **loser**'s session is revoked before the write" |
| **link via merge…** | same as merge — it routes through `merge/execute` |
| **link as production…** | "The **derived account**'s session is revoked before the write" |

Each must also carry **"Close the \<who\>'s app before executing"** in bold, the
`~1h` measured window, and the note that the revoke does not retire the uid.

The survivor and the phrase account are never named — they are the point of the
operation and keep their sessions. A footnote naming the wrong side is the defect
to look for here.

### B4. SEC-2's two ordering exceptions, and M3

With the **real** credential, re-run the two routes A4 could not reach:

```bash
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"loserUid":"/","survivorUid":"abc"}' http://127.0.0.1:8787/api/merge/preview
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"derivedUid":"/","phraseUid":"abc"}' http://127.0.0.1:8787/api/link/production/preview
```

**Expect** the uid refusal — `loserUid must be a Firebase uid: …` and
`derivedUid must be a Firebase uid: …` — not an OAuth error and not a plan.

Then run the **integrity report** (original step 5) and check the canvas column
of the account table. M3 moved the canvas-key split into `canvasUids` in
`ops/project.js`; a wrong split misreports rather than mis-deletes, so the check
is that canvases you seeded still resolve to the right pair of uids in both the
table and any canvas-related finding.

---

# Part C — destructive, on data you are willing to lose

### C0. Read this before executing anything

- **Dev project only.** Confirm the banner from A0/step 1 says the project you
  think it does, and that no production banner is showing.
- **Close every client for the account being removed.** Still true, still the
  only mitigation, and still bounded rather than closed: the revoke does not
  evict a live session, because `database.rules.json` never checks
  `auth.token.auth_time` (**G3/#302**, measured at up to ~1h). Since SEC-6 this
  applies to **merge** and **link as production** as well as purge — before
  SEC-6 those two revoked nothing at all, so their window was not G3's bounded
  hour but unbounded.
- **Prefer synthetic fixture accounts.** Nothing `ops/seed-merge-fixture.js`
  writes was ever opened in a client, so G3 and G6 have no author on it. That is
  the pattern; `ops/merge-fixture.js`'s header is the reasoning.
- Every step below writes a pre-image to `.ops-audit/` first. If that write
  fails, nothing destructive is issued — which is C5.

### C1. SEC-6 — merge revokes the loser's session

**This is the highest-value step on this page.** SEC-6 is marked
**UNVERIFIED-LIVE** in its own entry: the revoke has never been observed against
real Firebase Auth on this route, and it inherits purge's 2026-08-02 measurement
only by sharing an implementation. That is an inference, not an observation.

Two halves, and they fail differently.

**C1a — the RTDB-only case (fixture accounts).** Seed and merge as the runbook
describes:

```bash
cd functions
node ops/seed-merge-fixture.js --project $DEV --prod-project $PROD --tag sec6a --yes
# refresh the panel · integrity report · merge smk-sec6a-loser → smk-sec6a-survivor
node ops/verify-merge.js --project $DEV --prod-project $PROD --tag sec6a
node ops/seed-merge-fixture.js --project $DEV --prod-project $PROD --tag sec6a --clean --yes
```

**Expect on execute** a browser `alert` carrying the server's `sessionNote`:

```
NO AUTH RECORD for smk-sec6a-loser — nothing to revoke, so no session can survive
this merge. The write proceeded. An RTDB-only account (a seeded fixture, or one
whose Auth record was already removed) is the expected case.
```

Two things pass here at once, and both matter:

1. **The merge is not refused.** A bare `revokeRefreshTokens` — the literal
   reading of "give merge the same revoke" — throws `auth/user-not-found` for a
   uid Firebase Auth has never seen, and would have refused the entire documented
   merge rehearsal. The G8 allowlist is what prevents that, and it matters more
   on merge than it ever did on purge.
2. **The note is surfaced at all.** The panel showed `sessionNote` on purge only
   before SEC-6, so an ordinary synthetic merge reported nothing.

Then `verify-merge` must still report **57 of 57** claims holding — the revoke
must not have changed the write-set.

**C1b — the Auth-backed case, the one never observed.** Needs an account that has
actually completed `signInWithCustomToken` on dev, so it has a real Auth record.

The observable is `tokensValidAfterTime` advancing across the merge. Read it
either side — Firebase console → Authentication, or an Admin-SDK read of
`auth.listUsers`.

⚠️ **Do not use `ops/verify-auth-delete.js` as the before-reader.** Its step 2
performs a revoke of its own, so running it first advances the very field you are
about to measure. It is the right tool for the purge/Auth-delete leg and the
wrong one here.

**Expect:** `tokensValidAfterTime` present and **later** after the merge than
before it, and the merge otherwise behaving as C1a. Record both timestamps.

**What this still does NOT prove:** that the revoke *evicts* anything. It does
not — that is G3, and it is parked. What you are checking is that the revoke
call happens on this route at all.

### C2. SEC-6 — link as production revokes the derived account

Same shape, different route and different uid: `link/production/execute` revokes
the **derived** account, never the phrase account.

Run one **link as production** on a throwaway derived account. **Expect** the
same `sessionNote` alert, worded for the operation — *"no session can survive
this production link"* — and confirm the phrase account's own session is
untouched (its `tokensValidAfterTime` must **not** move).

This route destroys the derived account exactly as production's `performLink`
does. Use "link via merge" instead whenever the impact verdict is lossy — that is
what the preview's verdict line is for.

### C3. G4 — the cascade survives preview-to-execute

Purge `smk-g4v1-loser` (the group owner from B1) for real, having read its
cascade block.

**Expect:**

- the execute is **not** refused — the digest comparison includes `cascades`, so
  a preview and execute that disagree about the prediction is itself a refusal
  (`server.js:608`). Agreement is the pass;
- afterwards, `users/smk-g4v1-peer1/groups/smg-g4v1-owned` is **still present**
  in the database. That is the point: the purge did *not* write it, the cascade
  is a prediction about a client that is not running here, and the fixture
  accounts have no clients;
- `ops/restore-preimage.js` against the dump, **no flags**, sweeps only paths the
  purge wrote — so that enumeration entry is **outside** the sweep. That boundary
  is G4 itself, not a gap in the sweep.

To see the cascade *happen* rather than be predicted you need a real client
signed in as a co-member, which is a Part D exercise and is not required here.

To force the refusal side deliberately: preview, then add a member to the owned
group in another window, then execute. **Expect** a refusal whose diff names a
`+ cascade:` line.

### C4. M8 — execute an adopted merge ⚠️ read the warning

**⚠️ `ops/verify-merge.js` does not know about adoption, and will report a false
failure if you tick.** Derived from the code on 2026-08-04, not from the docs:
`ops/merge-fixture.js:469` hard-codes the claim

```
groups/{GB}/members/{S}/displayName  equals  'S in GB'
  "the shared group is a collision and the survivor's record wins —
   panel.html sends no adoptGroupNames"
```

That rationale was written **before M8** and is now stale — `panel.html` does send
`adoptGroupNames`. `verify-merge.js` has no `--adopt` flag, so an adopted merge
makes exactly this one claim fail (expected `S in GB`, found `L in GB`), and
`57 of 57` becomes `56 of 57`.

So run C4 one of two ways, and say which in the results table:

- **Safe (recommended):** exercise the tick in **preview only** (B2), then untick
  and execute unticked. `verify-merge` must report **57 of 57**.
- **Full:** execute **with** the tick and expect **56 of 57**, with the single
  failure being `groups/smg-*-shared/members/smk-*-survivor/displayName`. Confirm
  by hand that the value is the loser's name — that is M8 working, not a merge
  defect. Anything else failing is a real finding.

Either way this is the first time `adoptGroupNames` has driven a **live** merge;
M8's browser exercise ran against canned responses with no database behind it.

**Filed as M13** in `docs/operator-panel-followups.md` (2026-08-04, unruled): the
fixture claim and its rationale should either gain an `--adopt` mode or have the
comment corrected. Which one — and whether it is worth doing at all — is the
operator's call, not this document's.

### C5. M4 — the audit rethrow on a real filesystem

Every M4/M5 test drives a **fake** fs. The non-`EEXIST` rethrow has never run
against a real one, and it guards the invariant the whole audit trail rests on:
no destructive write without a durable pre-image.

```bash
mkdir -p /tmp/ro-audit && chmod 500 /tmp/ro-audit
cd functions
GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)" \
  node ops/server.js --project $DEV --prod-project $PROD --audit-dir /tmp/ro-audit
```

Preview and execute a purge on a throwaway fixture account.

**Expect:** the execute **fails**, with an `EACCES`-derived error surfaced in the
panel's alert — and **the account is still fully present in the database**.
Confirm that second half in the Firebase console; a refusal that still wrote is
the failure mode this step exists to catch.

Then `chmod 700 /tmp/ro-audit`, re-run, and confirm the purge proceeds and the
dump lands — so the refusal was the permission, not a broken route.

**What this does NOT cover:** M5's 100-attempt cap. See "Nothing to smoke test".

### C6. SEC-1 — `codeIndex` is freed only for the account that owns it

Before SEC-1, three admin sinks acted on `codeIndex/{code}` using the account's
**own** `presence/code` value — so an account that had planted a *victim's* code
in its own field caused the victim's index entry to be deleted (purge, merge) or
repointed to the attacker (graduation). All three now check that
`codeIndex/{code}` actually resolves to the account being acted on.

Set this up with the Admin SDK (two throwaway accounts, V the victim and A the
attacker):

1. give **V** a share code and confirm `codeIndex/{V's code}` → `V`;
2. write **V's code** into `users/{A}/presence/code` (Admin SDK — a *client*
   cannot do this any more, which is D1);
3. **purge A** through the panel.

**Expect:** `codeIndex/{V's code}` is **untouched** and still resolves to `V`,
and V's own account is intact. Before SEC-1 the purge of A deleted it.

Repeat for **merge** (A as loser) — same expectation.

---

# Part D — the client fixes, on a real signed-in device

None of G6, G9, G10 or M11 was ever device-observed; all four were found by
reading, and all are verified by jest and the rules emulator only. The rules half
of G6 and the SEC-1 charset rule are **live on the dev project** (CI deploys
`database.rules.json` on every push to `dev`) and **absent on prod** until
`dev` → `main`.

These need a signed-in client on dev — the web app or the Mini App. Use the
browser console against the dev hosting site for the write attempts.

### D1. SEC-1 — the charset rule is really deployed on dev

As a signed-in dev user, attempt to write a bad share code to your **own**
`presence/code`:

```js
// browser console, signed in on the DEV site
await firebase.database().ref(`users/${uid}/presence/code`).set('/');        // expect PERMISSION_DENIED
await firebase.database().ref(`users/${uid}/presence/code`).set('abc');      // expect PERMISSION_DENIED (lowercase)
await firebase.database().ref(`users/${uid}/presence/code`).set('AB3XZ9');   // expect OK
```

**Expect** the first two rejected with `PERMISSION_DENIED` and the third to
succeed. The rule is `^[A-Z0-9]{1,32}$` at `database.rules.json:25`.

This checks **deployment**, not logic — the logic is already pinned by the rules
emulator. If the first two succeed, the rules on dev are older than `545dadf`.

⚠️ **Restore your own code afterwards** if you changed a real account's.

### D2. G6 — a follow entry may only name an account that exists

```js
// as signed-in user M, on DEV
await firebase.database().ref(`userPrefs/${M}/following/doesnotexist123`).set({ /* … */ });
```

**Expect** `PERMISSION_DENIED`. Three rules carry this, and it is worth writing a
value at each depth rather than only the first:

| Path | Rule | Expect |
|---|---|---|
| `userPrefs/{M}/following/{dangling}` | `.validate` at `database.rules.json:10` — `users/$followee/presence/code` must exist | denied |
| `userPrefs/{M}/following/{dangling}/label` | `$field`, same predicate, `:12` | denied |
| `userPrefs/{M}/following/{dangling}/a/b` | `$sub`, `.validate: false`, `:13` | denied |

The `$field` copy alone closed only the middle one; `$sub` (`e2dde4e`) is what
refuses a write two levels below a following entry.

Then the positive case: follow a **real** account normally through the UI and
confirm it still works. A guard that refuses valid follows is the failure mode
that matters more.

### D3. G6 — the client gate stops the republish

The scenario, which needs two devices or two profiles:

1. sign in as **M** on device 1 and follow **T**;
2. with the Admin SDK, empty `userPrefs/{M}/following` (simulating what a purge
   or merge of T's side clears);
3. reload M's client.

**Expect:** M's client does **not** re-push its cached following list back up,
provided it has previously seen a non-empty server list — `js/following.ts:1060`
marks that, and `:1068` gates the republish on `!hasSeenServerFollowing`.

Note what the gate deliberately does **not** cover: a device that has *never*
seen a server list still republishes, because that is the legitimate migration
path it exists to serve. The rules half (D2) is what binds every client
regardless.

### D4. G9 — `rotateCode` drops a dead followee from its fan-out

1. as **M**, follow **T**;
2. delete T's account (purge it through the panel, or null
   `users/{T}/presence/code` with the Admin SDK);
3. as M, **rotate your share code** in the UI.

**Expect:** the rotation succeeds, and **no** `users/{T}/followers/{M}` row is
re-created. Before G9 the fan-out mirrored the new code onto every followee
including the dead one, re-creating a followers row under a purged account.

The filter fails **open** on an inconclusive read (`js/db/social.ts:422`,
`.catch(() => true)`) — a network error keeps the followee rather than dropping
it. So a rotation done offline-ish is not a counter-example.

### D5. G10 + M11 — redemption's refusable write runs first, atomically

1. create an invite as **C**, then delete C's account;
2. as **R**, redeem C's now-dangling invite link.

**Expect:** the redemption **fails**, and leaves **nothing** behind — in
particular no `users/{C}/followers/{R}` row. Before G10 `registerAsFollower` ran
first and succeeded, leaving an asymmetric follower row pointing at a vanished
creator.

For **M11**, the atomicity half: `setFollowingEntryClearingRevocation` issues the
revocation clear and the following write as **one** multi-path update
(`js/db/social.ts:331-335`). So on the failed redemption above, confirm
`revocations/{R}/{C}` — if it existed — is **still there**. A non-atomic
implementation would clear the revocation and then fail the follow, dropping the
watcher's cleanup of a stale own-side follow.

The rules emulator already settled the assumption underneath this (RTDB rejects a
multi-path update **whole** when one path fails a `.validate`). What D5 adds is
that the deployed rules and the deployed client agree about it.

---

# Part E — the one deployed functions change

### E1. SEC-4 — `rootUpdate` refuses an empty-segment key

This is a **regression** check, not a positive one. The refusal fires on a
write-map no shipped caller produces — the expected production effect is **none**,
and "none" is currently an inference from the suite plus an offline SDK probe,
not from a live run. `telegram-shared.js` is a deployed Cloud Function module, so
it is live on dev.

Exercise the callers and confirm they still work:

- **`performLink`** — link a Telegram account to a phrase account through the
  real production path (not the panel's `link as production`);
- **graduation** — open the Mini App on a fresh Telegram account, then graduate
  it;
- **expunge** — reached via `performLink` above.

**Expect** all three to complete normally, with no
`rootUpdate: '<key>' has an empty segment` or `names the database ROOT` error in
the functions logs.

A positive test — proving the refusal actually refuses — is not reachable from
outside, because no caller can emit such a key: RTDB keys cannot contain `/`, and
every interpolated value is a uid, gid, tgId or token. That property is pinned by
jest and by the offline `firebase-admin` probe, and that is where it stays.

---

## Nothing to smoke test — and why

Recording these so nobody re-derives them as gaps.

| ID | Why a live run adds nothing |
|---|---|
| **M5** | The 100-attempt cap needs an fs answering `EEXIST` to 100 candidate names. The base name is `{ms-timestamp}-{op}-{uid}.json`, so the candidates cannot be pre-created without predicting the millisecond. Not reachable by hand; C5 covers the sibling branch (M4) that is. |
| **M10** | A jest guard that pins the path `setFollowingEntry` builds against the path the G6 rules suite hand-types. It is a guard over two files; there is no runtime behaviour to observe. |
| **M12** | Same shape — a guard deriving the rules predicate's node path and pinning `followeeExists` to it. Note it does **not** prove the rules and the client draw the same *conclusion*, and it deliberately leaves `getCreatorCode` untied. |
| **SEC-8** | Docs only. Confirm by reading that `ops/README.md`'s merge-leg paragraph and `docs/HANDOFF.md`'s preconditions still say **G3** — and say that the name became accurate only at SEC-6. |
| **G8** | Already observed live on 2026-08-03, by the run that found it. C1a exercises it again incidentally. |

## Two things found while deriving this page

Both came from reading the code against the docs, not from running anything.
**Both are now filed in `docs/operator-panel-followups.md` as M13 and M14**, with
their `file:line`, the evidence, and the candidate fixes. Neither is **ruled** —
that is the operator's call, and filing is not one. Cite the IDs rather than
re-describing them.

1. **M13 — `ops/verify-merge.js` encodes pre-M8 behaviour.**
   `merge-fixture.js:469` hard-codes "the survivor's record wins" with the
   rationale "panel.html sends no adoptGroupNames" — true when written, false
   since M8. There is no `--adopt` flag, so an adopted merge reports `56 of 57`
   with a false failure. Handled in C4; the fix is either a corrected comment or
   an adoption-aware expectation plus a flag.

2. **M14 — the merge fixture seeds `presence/code` values the SEC-1 rule
   forbids.** `fixtureCodes` builds `SMK{tag}{role}` and the tag is
   `^[a-z0-9]{1,16}$`, so every seeded code contains lowercase — e.g. `SMKrun1L`
   — while the rule shipped on 2026-08-04 is `^[A-Z0-9]{1,32}$`. Seeding works
   because the Admin SDK bypasses rules, and the merge leg is unaffected for the
   same reason. But the fixture now produces a database state no client could
   create, so it cannot be used to exercise any rules-validated client write
   against those accounts. Same pattern as the audit's own lesson, running the
   other way: a fixture written before a rule describes the world without it.
   ⚠️ The one-line fix changes every seeded code **and** every `--clean`
   derivation (`buildFixtureCleanup` nulls the seed's own write-set, which
   includes `codeIndex/{code}`), so do not apply it while a fixture is live on
   dev — clean first, or the old `codeIndex` entries strand.

## Results

Fill in as you go. **OBSERVED** means seen; an unfinished row is not a passing
row, and a row that owes something says so.

| # | Step | Result | Notes |
|---|---|---|---|
| A0 | Panel starts on a fake credential | **OBSERVED 2026-08-04** | session container, `c42cd94`; three-line banner verbatim |
| A1 | Prod gate refuses both ways | **OBSERVED 2026-08-04** | both messages verbatim |
| A2 | 12 origin/port probes | **OBSERVED 2026-08-04** | `200 403×9 200 200`; 5 of them SEC-3's new cases |
| A3 | CSP + framing, nonce fresh and pinned | **OBSERVED 2026-08-04** | header/body nonce matched; 0 placeholders left |
| A4 | uid refusals, 7 preview/detail + 3 execute | **OBSERVED 2026-08-04** | merge/link previews deferred to B4 — ordering, not a defect |
| A5 | gitignore at 3 depths + CWD-independent audit dir | **OBSERVED 2026-08-04** | launched from repo root; dir still absolute under `functions/` |
| A6 | Socket not reachable off-box | **OBSERVED 2026-08-04 — operator machine, CONTROL NOT RECORDED** | `curl` to `192.168.178.81:8787` → `Failed to connect … after 1004 ms`. Refusal is the expected result. ⚠️ The loopback `200` control was not recorded in the same sitting, and a panel that is down produces the identical error — so this row is one confirmation short of a PASS. Re-run with the control, or confirm the panel was serving at the time. |
| B0 | Panel runs under the CSP in a browser | | |
| B1 | G4 cascade block renders, and `none predicted` where it should | | |
| B2 | M8 tick appears and re-previews | | |
| B3 | SEC-6 footnote on all four previews, right account named | | |
| B4 | merge/link preview uid refusal; integrity + canvases | | |
| C1a | SEC-6 merge: `NO AUTH RECORD` note, merge not refused, 57/57 | | |
| C1b | SEC-6 merge: `tokensValidAfterTime` advances | | **the never-observed one** |
| C2 | SEC-6 link-as-production revokes the derived account only | | |
| C3 | G4 cascade agrees preview→execute; enumeration entry survives | | |
| C4 | M8 adopted merge (say which variant was run) | | ⚠️ read C4's warning first |
| C5 | M4 rethrow on a real fs; nothing written | | |
| C6 | SEC-1 `codeIndex` ownership on purge and merge | | |
| D1 | SEC-1 charset rule live on dev | | |
| D2 | G6 `.validate` refuses a dangling followee | | |
| D3 | G6 client gate stops the republish | | |
| D4 | G9 rotate drops the dead followee | | |
| D5 | G10 order + M11 atomicity | | |
| E1 | SEC-4: performLink / graduation / expunge unaffected | | |
