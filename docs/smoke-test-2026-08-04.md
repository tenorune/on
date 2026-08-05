# Smoke test — the followup queue + the security audit (2026-08-04)

**Status (2026-08-05): PARTS A, B AND C ALL PASS. D AND E UNRUN.**

- **Part A** — A0–A5 exercised in a session container on a fake credential;
  **A6** run on the operator machine, and it is the only one that needed to be.
- **Part B** — all five run by the operator against the dev project. That is the
  first time G4's cascade block and M8's adopt tick have been seen in a browser
  against live data rather than canned responses.
- **Part C — ALL SIX STEPS PASS** (C1a, C1b, C2, C3, C4, C5, C6). Every
  destructive check on this page has now run against the dev project.
  **SEC-6 is now fully exercised live, on both routes and both sides**: the
  account being removed is revoked (merge 2026-08-04, link-as-production
  2026-08-05) and the one that survives is not. That is the item its own roadmap
  entry marked UNVERIFIED-LIVE.
- **Parts D and E have never been run at all.**

Nothing is a passing row until the results table at the bottom says so.

## What this is

`docs/operator-panel-smoke-test.md` is COMPLETE — its ten steps all pass, and it
is not superseded by this file. This document is the **next** run: it covers only
what shipped *after* those steps were exercised, namely

- the build queue closed 2026-08-03 — **G4, M12, M5, M4, M3, M8** — plus the
  G6-descended client work (**G6, G9, G10, M10, M11**) and **G8**;
- the eight items of `docs/security-audit-2026-08-04-roadmap.md` —
  **SEC-1 … SEC-8**.

**When this page was written**, every one of those was verified by **jest, the
rules emulator, or an offline SDK probe only** — no session container has ever
held a service-account credential, so none of it had run against a live Firebase
project. That was the gap this file existed to close, and it is why "the suite is
green" is not an answer to any step below.

**As of 2026-08-05 that gap is mostly closed.** Parts A, B and C have all been
run on the dev project. What is left is **Part D** (the client fixes — G6, G9,
G10, M11, and SEC-1's charset rule as deployed), which needs a real signed-in
client, and **Part E** (the SEC-4 regression). Those five items are still
jest-and-emulator only, and the inventory table below marks each one.

Read `functions/ops/README.md` (the runbook) and the "Before you start" section
of `docs/operator-panel-smoke-test.md` first — its preconditions (dev project
only, service-account JSON, `TELEGRAM_UID_SECRET`, Linux/macOS, seeded accounts)
all still apply and are not repeated here.

## Inventory — every item closed since the last smoke test

"Live run adds" is the honest question for each: some of these have nothing a
live run can tell you that the suite has not already settled.

| ID | What shipped | Verified so far | Live run adds | Step |
|---|---|---|---|---|
| **SEC-1** | `presence/code` charset rule; three admin sinks check `codeIndex` ownership | rules emulator + store mock; **ownership check OBSERVED on live data 2026-08-05 (C6)** | only that the charset rule is really deployed on dev | D1 |
| **SEC-2** | `requireUid`/`assertUid` at the edge and in the builders | jest (105 cases); **every refusal exercised over HTTP 2026-08-04, incl. the two ordering cases on a real project (B4)** | nothing further | A4, B4 |
| **SEC-3** | port-less `Host`/`Origin` resolve to the scheme default | jest; **12 probes run 2026-08-04** | nothing further | A2 |
| **SEC-4** | `rootUpdate` REFUSES a key with an empty segment | jest + offline `firebase-admin` probe | that no shipped caller regressed — a **regression** check, not a positive one | E1 |
| **SEC-5** | `.ops-audit/` unanchored; audit dir absolute | jest via `git check-ignore`; **both halves run 2026-08-04** | nothing further | A5 |
| **SEC-6** | `endSession` on merge + link-as-production | **OBSERVED LIVE on BOTH routes, both sides** — merge 2026-08-04, link-as-production 2026-08-05 | nothing further; the item is fully exercised | C1, C2 |
| **SEC-7** | CSP with per-response nonce, `X-Frame-Options` | jest + headless Chromium; **headers checked and the panel driven in a real browser 2026-08-04/05** | nothing further | A3, B0 |
| **SEC-8** | docs only — "G3" kept on the merge leg | n/a | nothing to run | — |
| **G4** | purge preview names predicted cascades | jest; **rendered in a browser and driven preview→execute 2026-08-05** | nothing further; fully exercised | B1, C3 |
| **G6** | rules `.validate` on `following/$followee` + client gate | rules emulator | **live on dev, never exercised** | D2, D3 |
| **G8** | purge no longer refuses an account with no Auth record | jest + the run that found it | already observed live | — |
| **G9** | `rotateCode` drops a dead followee from its fan-out | jest | never device-observed | D4 |
| **G10** | redemption's refusable write runs first | jest | never device-observed | D5 |
| **M3** | `canvasUids` shared helper | jest; **integrity run over live data 2026-08-05** | nothing further | B4 |
| **M4** | non-`EEXIST` rethrow | jest (fake fs); **OBSERVED on a real filesystem 2026-08-05** | nothing further; fully exercised | C5 |
| **M5** | 100-attempt filename cap | jest, fake fs only | nothing practical — see "Nothing to smoke test" | — |
| **M8** | `adoptGroupNames` tick in the browser | jest + browser on canned responses; **OBSERVED against a live merge 2026-08-05** | nothing further; fully exercised | B2, C4 |
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
service account, panel on `:8787`.

⚠️ **Do not re-run A0–A5 on the operator machine; it tells you nothing.** Every
one of them is pure in-process logic over the same source tree — argument
parsing, a hand-rolled authority comparison, a template string, a regex,
`git check-ignore` against a committed file, and an audit path resolved from
`HERE` rather than the CWD. None can differ between machines at the same commit,
so a second run is a tautology, not an observation. **A6 is the exception** and
is the only step in this part that had to be run on real hardware: "nothing else
on the network can reach this socket" is a property of the machine, not of the
code. What *would* reopen A0–A5 is a different commit — not a different machine.

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
its first draft — and then strengthened, because 6c's off-box form proves less
than it looks like it does.

**Run the on-host variant first. It is the decisive one.** With the panel
running, from the **panel machine itself**, against that machine's own LAN IP:

```bash
ip -4 addr show scope global | grep -oP 'inet \K[\d.]+'   # confirm the IP is this machine's
curl -sS -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n' --max-time 5 http://127.0.0.1:8787/
curl -sS -v --max-time 5 http://<that-lan-ip>:8787/
```

**Expect:** `HTTP 200` on loopback, and `Connection refused` on the LAN IP.

**Why this beats the off-box form.** The packet never leaves the host — no
switch, no access point, no router — so with the host firewall off there is
nothing left in the path that *could* refuse it except the socket. A refusal
here is attributable to `BIND_ADDRESS` and to nothing else. An off-box refusal
is equally consistent with AP client isolation or a router rule, which is why
the original 6c could never separate "correctly bound" from "network in the
way".

The two facts together are the proof: the panel **serves** on `127.0.0.1:8787`,
and the same host **refuses** `<lan-ip>:8787`. That is what loopback-only
binding looks like from outside the process.

**Then the off-box form**, as a supplementary — it adds the network path, which
the on-host run deliberately excludes:

```bash
curl -sS --max-time 5 http://<the-panel-machine-lan-ip>:8787/api/snapshot
```

⚠️ **Read the errno, not curl's summary line.** `curl: (7) … Couldn't connect to
server` is generic and is printed for several different causes; only `-v` names
the real one, on the line above:

| `-v` says | Means | Verdict |
|---|---|---|
| `Connection refused` | TCP RST — nothing bound to that address | ✅ the pass |
| `Connection timed out`, or hangs to `--max-time` | SYN dropped — firewall DROP or AP isolation | ❌ inconclusive; the bind address was never reached |
| `No route to host` | ARP/routing failed — wrong IP, or machine offline | ❌ the test did not run |

⚠️ **The panel must be running, and say so in the record.** A panel that is down
produces a byte-identical `Couldn't connect to server`, so the loopback `200`
above is a required control, not a nicety.

A first off-box attempt against a cold ARP cache can take ~1s before the RST
comes back; a second run should be near-instant. Slow is not by itself a
failure — the errno is what decides.

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

The observable is `tokensValidAfterTime` advancing across the merge.

⚠️ **Nothing in this repo reads that field without also changing it, and the
Firebase console does not show it at all.** `ops/verify-auth-delete.js` is the
only tool that reports it, and its step 2 performs a **revoke of its own** — so
running it as the "before" reader advances the very field you are about to
measure. It is the right tool for the purge/Auth-delete leg and the wrong one
here. The console's Authentication tab shows created and last-signed-in, not
`tokensValidAfterTime`.

So use a **read-only** reader. It has to live under `functions/` — Node resolves
ESM imports relative to the file, not the shell, so a copy in `/tmp` fails with
`ERR_MODULE_NOT_FOUND` before it reaches Firebase:

```bash
cd /path/to/on/functions
cat > read-auth.mjs <<'SCRIPT'
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
const [projectId, uid] = process.argv.slice(2);
if (!projectId || !uid) { console.error('usage: node read-auth.mjs <project-id> <uid>'); process.exit(2); }
initializeApp({ credential: cert(JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)), projectId });
try {
  const u = await getAuth().getUser(uid);
  console.log(JSON.stringify({
    uid: u.uid,
    tokensValidAfterTime: u.tokensValidAfterTime ?? null,
    validSinceEpochSec: u.tokensValidAfterTime ? Date.parse(u.tokensValidAfterTime) / 1000 : null,
    providerCount: u.providerData.length,
    lastRefreshTime: u.metadata.lastRefreshTime ?? null,
  }, null, 2));
} catch (e) {
  console.log(e.code === 'auth/user-not-found' ? 'NO AUTH RECORD' : `ERROR ${e.code || e}`);
}
SCRIPT

export GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)"
node read-auth.mjs $DEV <loser-uid>     # BEFORE the merge
# ... run the merge through the panel ...
node read-auth.mjs $DEV <loser-uid>     # AFTER
rm read-auth.mjs                        # it is untracked and must not be committed
```

It reads and writes nothing. `NO AUTH RECORD` means you picked an RTDB-only
account and are in case C1a, not C1b.

**Expect:** `tokensValidAfterTime` present and **later** after the merge than
before it, and the merge otherwise behaving as C1a. Record both timestamps.

⚠️ **Read the SURVIVOR either side too — it is half the claim.** SEC-6 revokes
the account being **removed** and never the one that survives; the survivor is
the point of the operation and keeps its session. An advance on the loser alone
only shows the route revokes *something*. The pass is both rows:

| Account | `tokensValidAfterTime` across the merge |
|---|---|
| **loser** (`loserUid`) | **advances** |
| **survivor** (`survivorUid`) | **unchanged** |

A survivor whose timestamp also moved is a real finding — it would mean the
route revokes the wrong side, or both.

⚠️ **The merge must be the only revoking operation between the two reads.**
`tokensValidAfterTime` records the most recent revoke from *any* source: another
purge, a second panel action, or a run of `ops/verify-auth-delete.js` (which
revokes as its own step 2) all move it. If anything else ran in between, the
advance is not attributable to the merge.

**The account here is app-born, not a fixture** — it has to be, or it has no
Auth record. So unlike the merge-leg rehearsal, **G3 and G6 do have an author on
this run**: close the loser's clients first, per C0.

**OBSERVED 2026-08-04 — the first live sighting of SEC-6's revoke.**
uid `d92925e118aa87b925b525e2af33e71c` (32 hex, app-derived, `providerCount: 0`
— a custom-token account with a real Auth record, so this is C1b and not C1a):

```
before   tokensValidAfterTime  Mon, 03 Aug 2026 11:17:32 GMT   (1785755852)
after    tokensValidAfterTime  Tue, 04 Aug 2026 20:37:13 GMT   (1785875833)
                                                        +119,981 s (~33h20m)
```

The field advanced across the merge, which is the only observable
`revokeRefreshTokens` has.

**The survivor was read after the merge and its `tokensValidAfterTime` PREDATES
the merge**, so it was never revoked. ⚠️ Note this needed only ONE read, and the
reasoning is worth reusing: a revoke can only move the field *forward*, to at
least the instant it happened. So a single post-merge read that is **older than
the merge** already proves no revoke occurred — a "before" reading adds nothing
on the survivor side. (The exact survivor value was not recorded; only that it
predates `Tue, 04 Aug 2026 20:37:13 GMT`.)

**Both rows of the pass condition are therefore met — loser advances, survivor
unchanged — and SEC-6 is no longer UNVERIFIED-LIVE on the merge route.**

**Verification of the reader itself, 2026-08-04:** run in a session container
against a deliberately fake service account, it reached `getUser` and reported
`ERROR app/invalid-credential` through its own catch — so the wiring, the
argument parsing and the error path are exercised. It has **never** run against
a real project, and the JSON branch above is therefore unexercised.

An alternative if you would rather not paste a script: `npx firebase auth:export`
carries the same value as `validSince` (epoch seconds). ⚠️ It exports **every
user's** auth record to a file — write it outside the repo, since no `.gitignore`
rule covers it and this is exactly the shape SEC-5 was about.

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

**OBSERVED 2026-08-05 — SEC-6's revoke on the SECOND route.** Both rows met:

```
derived  64b7c129152d3bf511d595c55faf928c   providerCount: 0
  before  tokensValidAfterTime  Mon, 03 Aug 2026 10:09:56 GMT  (1785751796)
  after   tokensValidAfterTime  Wed, 05 Aug 2026 19:49:09 GMT  (1785959349)
                                                        +207,553 s — ADVANCED

phrase   c45849d73f37c3252a27a8f2a37ad04b   providerCount: 0
  after   tokensValidAfterTime  Mon, 03 Aug 2026 10:23:25 GMT  (1785752605)
                                          predates the link — NEVER REVOKED
```

**The phrase side is stronger here than a bare "unchanged".** Its
`lastRefreshTime` is `Wed, 05 Aug 2026 19:41:36 GMT` — about **7½ minutes
before** the link's revoke — so that account had a client actively refreshing
tokens across the operation and **kept its session anyway**. This is not merely
"the route did not touch it"; it is "the route did not touch a session that was
demonstrably live."

**Incidental, and worth reading before C3:** the derived account's
`lastRefreshTime` is `Tue, 04 Aug 2026 18:55:12 GMT`, ~25 h before the link — so
its ID token had long since expired and there was no G3 window to speak of on
this run. `lastRefreshTime` is a proxy for "a client was recently alive", not
proof of one, but a 25-hour-old refresh against a ~1 h token lifetime is about as
clear as that proxy gets.

### C3. G4 — the cascade survives preview-to-execute

Purge `smk-g4v1-loser` (the group owner from B1) for real, having read its
cascade block.

⚠️ **This CONSUMES the fixture's loser, so C3 is the last step that can use the
B1 tag.** C4 needs `smk-{tag}-loser` alive as its merge loser and therefore
seeds its own — do not carry `g4v1` forward into it.

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

### C4. M8 — execute an adopted merge ⚠️ read all of this first

**C4 SEEDS ITS OWN FIXTURE. Do not reuse B1/B2's.** C3 purges
`smk-{tag}-loser`, which is exactly the account this step needs as its *loser*,
so C3 and C4 cannot share a tag — the account is gone by the time you get here.
Earlier drafts of this page did not say so and reused `g4v1` throughout; that
was a defect in the document, not in the panel.

```bash
cd /path/to/on/functions
export GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)"

node ops/seed-merge-fixture.js --project $DEV --prod-project $PROD --tag c4v1        # dry run
node ops/seed-merge-fixture.js --project $DEV --prod-project $PROD --tag c4v1 --yes
```

Refresh the panel. Then, and **check the pair against this line before you
press execute**:

> click **`smk-c4v1-loser`** → **merge into…** → survivor **`smk-c4v1-survivor`**

⚠️ **`verify-merge` only ever checks `smk-{tag}-loser` → `smk-{tag}-survivor`.**
It derives the pair from `--tag`; there is no flag to point it anywhere else. So
merging any other pair from this fixture — including one of the peers — produces
a large, meaningless owed count against claims describing a merge that never
happened. **A big number here is far more likely to be the wrong pair than a
real defect.** Read the pair out of `.ops-audit/audit.jsonl` before diagnosing
anything:

```bash
tail -1 .ops-audit/audit.jsonl | python3 -m json.tool
```

`uids` is `[loser, survivor]` (`ops/server.js`, the `execute('merge', …)` call).
If it is not `["smk-c4v1-loser", "smk-c4v1-survivor"]`, the run is void — clean,
re-seed on a new tag, and start again.

Now the adoption itself.

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
  failure being `groups/smg-c4v1-shared/members/smk-c4v1-survivor/displayName`.
  Confirm by hand that the value is the **loser's** name (`L in GB`) — that is M8
  working, not a merge defect. Anything else failing is a real finding.

```bash
node ops/verify-merge.js --project $DEV --prod-project $PROD --tag c4v1
```

Either way this is the first time `adoptGroupNames` has driven a **live** merge;
M8's browser exercise ran against canned responses with no database behind it.

**OBSERVED 2026-08-05 — the FULL variant, and it landed exactly as derived.**
`verify-merge --tag c4v1` reported **56 of 57**, the single owed claim being:

```
1 OF 57 CLAIM(S) OWED:
  ✗ groups/smg-c4v1-shared/members/smk-c4v1-survivor/displayName
      — want "S in GB", got "L in GB"
```

Two results in one line, and they are worth separating:

- **M8 works live.** `got "L in GB"` is the **loser's** per-group display name
  sitting on the survivor's member record. That is what ticking the box is for,
  and before M8 it was unreachable from the browser at all — `panel.html` never
  sent `adoptGroupNames`, so this outcome could not be produced without POSTing
  the route by hand. **First time adoption has driven a live merge.**
- **M13 is confirmed, and is no longer a derived claim.** It was filed on
  2026-08-04 from reading `merge-fixture.js` against `panel.html`, with the
  false failure never having been seen. It has now been seen: the predicted
  path, the predicted expected value, the predicted actual value, and a count of
  exactly one. Nothing else was owed, which is the part that matters — it means
  the adoption changed precisely the record it should have and nothing else.

**Clean up**, and run the integrity report afterwards:

```bash
node ops/seed-merge-fixture.js --project $DEV --prod-project $PROD --tag c4v1 --clean --yes
```

⚠️ `buildFixtureCleanup` derives its null-set assuming the survivor is
`smk-{tag}-survivor`. If a merge on this fixture used any other survivor, paths
the merge created under *that* account can fall outside what `--clean` nulls —
so check integrity rather than assuming the tag is gone.

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

**OBSERVED 2026-08-05 — the refusal half, on a real filesystem.** Purging
`smk-c4v1-follower` against a `chmod 500` audit dir failed with

```
Error: Error: EACCES: permission denied, open '/tmp/ro-audit/1785961312210-purge-smk-c4v1-follower.json'
```

and **the account was still fully present afterwards**. That is the half the
step exists for: `writeAuditRecord` (`ops/server.js:662`) runs before
`apply(plan)` (`:680`), so a pre-image that cannot be written stops the
destructive write rather than preceding it.

It also pins M4's branch on real hardware for the first time. `isEexist` tests
`err.code === 'EEXIST'`; `EACCES` is not, so `writeExclusive` rethrows
immediately after **one** attempt — no retry, no filename bumping. Every prior
test of that branch drove a fake fs.

**The control passed on the second attempt, and the first attempt at it is the
trap worth recording.** `chmod 700` had been typed into the terminal the panel
was running in the **foreground** of, so it went to the node process's stdin and
the shell never ran it — no error, and the directory stayed at mode `500`
(`ls -ld` read `dr-x------`, owner matching `id -un`, which is what proved it:
a chmod by the owner cannot fail). Re-run from a second terminal, the purge
proceeded and `smk-c4v1-follower` was purged.

⚠️ **Run the `chmod` in a different terminal, or stop the panel first.** A
restart is *not* needed for the permission change itself — permissions are
evaluated at `open(2)` and nothing here caches them — but a foreground panel
will silently swallow the command.

**The dump necessarily landed**, and this needs no separate check:
`writeAuditRecord` throws on failure and runs *before* `apply(plan)`, so a purge
that proceeded is a purge whose pre-image was written first. That is the same
ordering the refusal half demonstrated, observed from the other side.

⚠️ **Clean up afterwards.** `/tmp/ro-audit/` now holds a real pre-image — full
account data, the same content SEC-5 was about. It is outside the repo so no
`.gitignore` rule applies to it; delete it rather than leaving it in `/tmp`.

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

### D0. The console harness — run this first

⚠️ **The browser console cannot use this app's Firebase SDK.** The app is on the
**modular** SDK, nothing is exposed on `window`, and the config is baked into the
bundle by esbuild. Any snippet calling `firebase.database()` — the **v8 compat**
namespace — dies with `firebase is not defined`. Two earlier drafts of Part D
did exactly that.

What the console *can* do is read the ID token Firebase Auth persists in
IndexedDB and drive the RTDB **REST API** with it. Rules apply to REST requests
carrying `?auth=<ID token>` exactly as they do to the SDK, so this tests the
real thing.

**Reload the page first.** An ID token lives about an hour, and an expired one
makes every write fail identically — which reads as a pass.

```js
// paste once per console session, on the DEV site, signed in
globalThis.__rec = await new Promise((resolve, reject) => {
  const open = indexedDB.open('firebaseLocalStorageDb');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const all = open.result.transaction('firebaseLocalStorage', 'readonly')
      .objectStore('firebaseLocalStorage').getAll();
    all.onerror = () => reject(all.error);
    all.onsuccess = () => resolve(all.result.find(r => String(r.fbase_key).startsWith('firebase:authUser:')));
  };
});
if (!__rec) throw new Error('no signed-in user on this origin');
globalThis.UID = __rec.value.uid;
globalThis.TOKEN = __rec.value.stsTokenManager.accessToken;
globalThis.DB = 'https://<project>-default-rtdb.<region>.firebasedatabase.app';
globalThis.rtdb = async (path, method = 'GET', value) => {
  const r = await fetch(`${DB}/${path}.json?auth=${TOKEN}`,
    method === 'GET' ? {} : { method, body: JSON.stringify(value) });
  const body = await r.text();
  return (method === 'GET' && r.ok) ? JSON.parse(body) : `${r.status} ${body}`;
};
console.log('uid', UID, '· expires', new Date(__rec.value.stsTokenManager.expirationTime), '· rtdb is', typeof rtdb);
```

**Confirm it took before running any step below** — the last line must print
`rtdb is function`. `rtdb is not defined` in a later step means this block was
never run in *this* console, or was run on a different origin/tab.

⚠️ **No wrapping braces, and no top-level `const`, both deliberate.** A pasted
block starting with `{` can be parsed as an object literal by the DevTools REPL,
and top-level `const` throws on a re-paste after a token expiry. Everything
lands on `globalThis`, so this is safe to run as many times as you need.

Set `DB` to your project and region — the same URL shape `ops/server.js` derives
(`https://{project}-default-rtdb.{region}.firebasedatabase.app`, or
`…-default-rtdb.firebaseio.com` for `us-central1`). The block is wrapped in
braces and assigns to `globalThis`, so it can be re-pasted after a token expiry
without redeclaration errors.

**A refused write returns `401 {"error":"Permission denied"}`.** Every step below
reports `<status> <body>`.

⚠️ **Every step in Part D needs a control** — a write that must SUCCEED. Without
one, a bad or expired token produces the same refusals as a working guard and
you have proved nothing. This has already caught three steps on this page (A6's
loopback control, C5's `chmod`, D1's write-back). The controls below are all
chosen to mutate nothing: they write back a value that is already there.

### D1. SEC-1 — the charset rule is really deployed on dev

⚠️ **An earlier draft of this step was unrunnable.** It said to call
`firebase.database().ref(...)` from the browser console — that is the **v8 compat
namespace**, and this app uses the **modular SDK**. There is no global
`firebase`, nothing is exposed on `window`, and the config is baked into the
bundle at build time by esbuild, so the console cannot reach the app's Firebase
instance at all. Both routes below avoid it.

**This step checks DEPLOYMENT, not logic.** The rule's behaviour is already
pinned by the rules emulator; what is unknown is whether the deployed dev
project is running rules newer than `545dadf`.

#### Route A — read the deployed rules (recommended, decisive, no writes)

The Admin credential can read `/.settings/rules.json` over REST, which returns
the rules the project is *actually running*. Same technique `ops/deps.js` uses
for its shallow canvas read (`credential.getAccessToken()` → `?access_token=`).

Write it under `functions/` — Node resolves ESM imports relative to the file, so
a copy in `/tmp` fails with `ERR_MODULE_NOT_FOUND` before reaching Firebase:

```bash
cd /path/to/on/functions
cat > read-rules.mjs <<'SCRIPT'
import { cert } from 'firebase-admin/app';
const [projectId, region = 'europe-west1'] = process.argv.slice(2);
if (!projectId) { console.error('usage: node read-rules.mjs <project-id> [region]'); process.exit(2); }
const databaseURL = process.env.DATABASE_URL || (region === 'us-central1'
  ? `https://${projectId}-default-rtdb.firebaseio.com`
  : `https://${projectId}-default-rtdb.${region}.firebasedatabase.app`);
try {
  const credential = cert(JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON));
  const token = await credential.getAccessToken();
  const res = await fetch(`${databaseURL}/.settings/rules.json?access_token=${token.access_token}`);
  if (!res.ok) { console.error(`rules read failed: ${res.status} ${await res.text()}`); process.exit(1); }
  const text = await res.text();
  console.log(`# deployed rules from ${databaseURL}\n`);
  for (const line of text.split('\n')) {
    if (/presence|code|following/.test(line)) console.log(line.trim());
  }
} catch (e) { console.error(`ERROR ${e.code || e}`); process.exit(1); }
SCRIPT

export GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat ~/sa-dev.json)"
node read-rules.mjs $DEV
rm read-rules.mjs        # untracked; do not commit
```

The region default matches `ops/server.js`'s (`europe-west1`); pass a second
argument or set `DATABASE_URL` if yours differs.

**Expect** the `presence/code` line to carry the SEC-1 charset:

```
"code": { ".validate": "newData.isString() && newData.val().matches(/^[A-Z0-9]{1,32}$/)" },
```

If it still reads a bare length check, the dev project is running rules older
than `545dadf` and **D2 cannot pass either** — the G6 `.validate` shipped in the
same file. Check this before diagnosing D2.

#### Route B — prove ENFORCEMENT from a signed-in client (stronger, optional)

Route A shows the rule is deployed; this shows the backend enforces it. Uses the
**D0 harness** above.

```js
const url = `users/${UID}/presence/code`;
const current = await rtdb(url);          // read FIRST — it is the control
console.log('current', current);

console.log(await rtdb(url, 'PUT', '/'));       // expect 401 Permission denied
console.log(await rtdb(url, 'PUT', 'abc'));     // expect 401 (lowercase)
console.log(await rtdb(url, 'PUT', current));   // expect 200 — control, and a NO-OP
```

**Expect** `401 {"error":"Permission denied"}` for the first two and `200` for
the third.

⚠️ **The control is the third line and it must not be skipped.** Two denials on
their own are equally consistent with a bad or expired token, in which case you
have proved nothing — the same trap as A6's missing loopback control and C5's
`chmod`. Writing the account's **current** code back is a control that mutates
nothing: if it is a well-formed `[A-Z0-9]` code the rule must accept it, and the
value is unchanged either way.

⚠️ **Do not write an arbitrary new code.** `presence/code` and `codeIndex/{code}`
are maintained together by `claimShareCode`; setting the code directly changes
one and not the other, and `integrity.js` will report the account afterwards.
That is exactly why the control writes back what was already there.

### D2. G6 — a follow entry may only name an account that exists

Uses the **D0 harness**. Write at all three depths — the guard is three rules,
and `$field` alone closed only the middle one.

```js
const DEAD = `doesnotexist${Date.now()}`;
console.log(await rtdb(`userPrefs/${UID}/following/${DEAD}`,       'PUT', { code: 'ZZZZZZ', label: 'x' }));
console.log(await rtdb(`userPrefs/${UID}/following/${DEAD}/label`, 'PUT', 'x'));
console.log(await rtdb(`userPrefs/${UID}/following/${DEAD}/a/b`,   'PUT', 1));
```

| Path | Rule | Expect |
|---|---|---|
| `userPrefs/{me}/following/{dead}` | `.validate` at `database.rules.json:10` — `users/$followee/presence/code` must exist | `401 Permission denied` |
| `…/{dead}/label` | `$field`, same predicate, `:12` | `401 Permission denied` |
| `…/{dead}/a/b` | `$sub`, `.validate: false`, `:13` | `401 Permission denied` |

The `$field` copy alone closed only the middle row; `$sub` (`e2dde4e`) is what
refuses a write two levels below a following entry.

**The control — a follow the rule must ACCEPT.** Write an existing following
entry back unchanged; it mutates nothing, and it fails if the guard is refusing
valid follows, which is the more damaging direction:

```js
const following = await rtdb(`userPrefs/${UID}/following`);
const live = Object.keys(following || {})[0];
console.log(live
  ? await rtdb(`userPrefs/${UID}/following/${live}`, 'PUT', following[live])   // expect 200
  : 'NO FOLLOWEES — follow a real account through the UI instead, as the control');
```

⚠️ **If all four lines refuse**, the token is stale or `DB` is wrong — re-run D0
after reloading. ⚠️ **If D1 Route A showed rules older than `545dadf`**, this
step cannot pass: the G6 `.validate` ships in the same file.

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
| A6 | Socket not reachable off-box | **PASS — OBSERVED 2026-08-04, operator machine** | Panel confirmed running. Off-box `curl` to `192.168.178.81:8787` → `Failed to connect … after 1004 ms`, and **the same command on the panel machine itself, against its own LAN IP, refused identically** with the host firewall **off**. That on-host run is what makes it conclusive: no switch, AP or router in the path, so nothing but `BIND_ADDRESS` can account for the refusal. Reproduced in a session container the same day (`Connection refused`, 0 ms) to confirm the message shape. ⚠️ Not separately recorded: the literal `-v` errno on the operator machine, and that `192.168.178.81` is an address on that host. Neither changes the verdict — an on-host refusal with the firewall off has no other explanation — but the errno is the thing to capture next time. |
| B0 | Panel runs under the CSP in a browser | **PASS — OBSERVED 2026-08-04** | operator machine, dev project |
| B1 | G4 cascade block renders, and `none predicted` where it should | **PASS — OBSERVED 2026-08-04** | first time the cascade block has been rendered in a browser |
| B2 | M8 tick appears and re-previews | **PASS — OBSERVED 2026-08-04** | first time the tick has driven a live preview rather than canned responses |
| B3 | SEC-6 footnote on all four previews, right account named | **PASS — OBSERVED 2026-08-04** | |
| B4 | merge/link preview uid refusal; integrity + canvases | **PASS — OBSERVED 2026-08-04** | closes A4's deferred ordering case on a real project |
| C1a | SEC-6 merge: `NO AUTH RECORD` note, merge not refused, 57/57 | **PASS — OBSERVED 2026-08-05** | reported verified by the operator; per-claim output not captured here |
| C1b | SEC-6 merge: `tokensValidAfterTime` advances | **PASS — OBSERVED 2026-08-04, both rows** | **Loser** `d92925e1…e71c` (`providerCount: 0`): `Mon 03 Aug 11:17:32 GMT` → `Tue 04 Aug 20:37:13 GMT`, +119,981 s. **Survivor**: read post-merge, timestamp predates the merge → never revoked (one read suffices; a revoke only moves the field forward). **First live sighting of SEC-6's revoke**, which was UNVERIFIED-LIVE in its own roadmap entry. ⚠️ Residual assumption: that no other revoking operation ran between the loser's two reads. |
| C2 | SEC-6 link-as-production revokes the derived account only | **PASS — OBSERVED 2026-08-05, both rows** | **Derived** `64b7c129…928c`: `03 Aug 10:09:56` → `05 Aug 19:49:09 GMT`, +207,553 s. **Phrase** `c45849d7…d04b`: post-link value `03 Aug 10:23:25 GMT`, predates the link → never revoked, *and* its `lastRefreshTime` is 7½ min before the revoke, so a demonstrably live session survived. Completes SEC-6 across **both** routes. |
| C3 | G4 cascade agrees preview→execute; enumeration entry survives | **PASS — OBSERVED 2026-08-05** | reported verified by the operator; per-claim output not captured here |
| C4 | M8 adopted merge (say which variant was run) | **PASS — OBSERVED 2026-08-05, FULL variant (ticked)** | **56 of 57**, sole owed claim `groups/smg-c4v1-shared/members/smk-c4v1-survivor/displayName` — want `"S in GB"`, got `"L in GB"`. That is M8 adopting the loser's name (working) and M13's false failure (expected), exactly as derived. Nothing else owed. |
| C5 | M4 rethrow on a real fs; nothing written | **PASS — OBSERVED 2026-08-05, both halves** | **Refusal:** `EACCES` on the pre-image write, rethrown after one attempt (M4's branch on real hardware for the first time), `smk-c4v1-follower` still fully present. **Control:** after a `chmod 700` that actually ran, the same purge proceeded and the account was purged — so the refusal was the permission, not a broken panel. The directory being verifiably `dr-x------` at the OS level is independent corroboration. |
| C6 | SEC-1 `codeIndex` ownership on purge and merge | **PASS — OBSERVED 2026-08-05** | reported verified by the operator; the victim's `codeIndex` entry survived a purge and a merge of the account that had planted their code. Per-step output not captured here. |
| D1 | SEC-1 charset rule live on dev | **PASS — OBSERVED 2026-08-05, both routes** | **Route A**: deployed `/.settings/rules.json` carries the SEC-1 charset, so the dev project runs rules at or after `545dadf`. **Route B**: enforcement confirmed from a signed-in client over the REST API, including the write-back control that rules out a stale token. |
| D2 | G6 `.validate` refuses a dangling followee | | |
| D3 | G6 client gate stops the republish | | |
| D4 | G9 rotate drops the dead followee | | |
| D5 | G10 order + M11 atomicity | | |
| E1 | SEC-4: performLink / graduation / expunge unaffected | | |
