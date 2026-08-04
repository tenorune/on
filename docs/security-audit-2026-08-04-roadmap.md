# Security audit — remaining-fix roadmap (2026-08-04)

Itemized follow-ups from the security review of the `origin/main` (`731eed9`) →
`dev` (`d53968c`) diff — the operator panel (`functions/ops/**`) and all work
descended from it (71 files, +20,864/−262, merge base `361e65c`).

Method: four identification passes (ops HTTP server/panel · ops destructive CLI ·
shipped Telegram functions · RTDB rules + client) and two secure-coding-checklist
passes (delivery/client · server-side API), each candidate then run through one
adversarial refute-by-default filter, and the load-bearing SDK behaviours probed
offline against the installed `@firebase/database`.

> **Classification matters and is kept explicit.** Not every item here is a
> *security* finding. Two are **robustness/data-safety** defects reachable only
> by the authorized operator, one is **hardening/parity**, one is **docs
> hygiene**. Blurring the line is how "one-line fix closes everything" overclaims
> get made — the same failure mode the codeIndex item below was itself an example
> of. Each item states its class.

> **Line numbers drift** (a standing landmine in this repo). Every citation below
> also names the *function/anchor*; trust the anchor, re-find the line.

## Verification bar this audit could and could not reach

Everything was checked by static analysis, the RTDB **rules emulator**, the
functions **store-mock**, and **offline** SDK path-parser probes. **No session
container has ever held a service-account credential**, so nothing ran against a
live Firebase project. Where a conclusion depends on live backend behaviour it is
marked **UNVERIFIED-LIVE** below.

## What is left (2026-08-04)

**Nothing.** All eight are CLOSED and merged to `dev` — six at `545dadf`, then
SEC-6 and SEC-8 at `06a4136` (branch `claude/sec-6-sec-8-audit-l8b66s`, kept,
merged on the maintainer's explicit instruction; the standing convention is
still that they merge, not the agent).

The entries stay below because the *reasoning* is the reusable part — and
because **four of the eight shipped differently from what this document
prescribed** (SEC-4, SEC-5, SEC-7, SEC-8 — each says so in its own entry).
SEC-8's is the sharpest case: its prescription did not merely miss a detail, it
inverted once sequenced behind SEC-6 as this document itself required. Half of
these prescriptions were wrong. Treat any prescription here as a hypothesis and
re-derive it against the code you actually find.

## At a glance

| ID | Item | Class | Severity | Confidence | Status |
|----|------|-------|----------|-----------|--------|
| SEC-1 | `presence/code` → `codeIndex` charset + ownership | Security | Critical (A) / High (B) | 8 | **CLOSED** |
| SEC-2 | `uid:"/"` collapses purge/merge paths, defeats the "typo'd uid" guard | Robustness / data-safety | High (robustness); **not** a security finding | 9 (mechanism) | **CLOSED** |
| SEC-3 | Ops `Origin` guard does not enforce the port | Security (defense-in-depth) | Medium | 10 (defect) / 3 (exploit) | **CLOSED** |
| SEC-4 | `rootUpdate` overlap check disagrees with the SDK on collapsed paths | Security (defense-in-depth) | Medium | 8 | **CLOSED** |
| SEC-5 | `.ops-audit/` git-ignore rule is path-anchored | Data exposure (repo) | Low | 7 | **CLOSED** |
| SEC-6 | `merge` / `link-as-production` execute without revoking the session | Hardening / parity | Low; **not** a security finding | 8 | **CLOSED** |
| SEC-7 | Ops panel serves no CSP / framing headers | Security (defense-in-depth) | Low | 6 | **CLOSED** |
| SEC-8 | Docs label the merge-leg client hazard "G3" (wrong ID) | Docs hygiene | Trivial | 9 | **CLOSED** — the prescription inverted; see its entry |
| — | G3 / [#302](https://github.com/tenorune/on/issues/302): revoked-session write window | Security | — | — | **Parked** (out of scope) |

**Deploy reality:** everything under `functions/ops/**` is
excluded from the functions archive (`firebase.json` `functions.ignore: ops/**`)
and rides **no deploy**. `.gitignore` and `docs/**` ride nothing. Exactly two of
the eight ever touched a live surface — **SEC-1** (`database.rules.json`) and
**SEC-4** (`telegram-shared.js`, a deployed Cloud Function module) — and both
are already merged to `dev`, so they deployed there on `545dadf`. **SEC-6 and
SEC-8 ship nothing**: `ops/**` plus docs. Merging any rules/functions change to
`dev` deploys it to the dev project **ungated** (`deploy-dev.yml`); prod is the
maintainer's, gated.

---

## SEC-1 — `presence/code` charset + `codeIndex` ownership — CLOSED

Recorded for context; **no action owed**. Closed on
`claude/knockknock-revoked-sessions-im20og` in two commits.

- **Root cause.** `presence/code` is the account's **own** field (rules gate only
  `auth.uid === $uid` and, formerly, length ≤ 32 — no charset). Its value was
  interpolated into an **Admin-SDK** update key `codeIndex/{code}`, where security
  rules do not apply.
- **Variant B** (`code = "/"`): the key `codeIndex//` collapses to the whole
  `codeIndex` node in the SDK path parser, so a `null` there would wipe the index.
  UNVERIFIED-LIVE whether the RTDB *backend* collapses identically; the charset
  rule closes the **plant** regardless.
- **Variant A** (`code = {victim's code}`): a well-formed code no charset rule can
  refuse; three admin sinks then acted on the victim's entry —
  `buildExpungeWrites` and `buildMergePlan` **deleted** it, and
  `graduateAccountData` **repointed** it to the attacker's new uid (a code
  *takeover*, worse than the delete).
- **Fix shipped.**
  - `1ae38a8` — `database.rules.json` `presence/code` `.validate` tightened to
    `matches(/^[A-Z0-9]{1,32}$/)` (mirrors the `contextGroupId` precedent). Closes
    Variant B at the source. Rules emulator 119/119 (+1 guard).
  - `e9e6dd6` — all three admin sinks now free/repoint `codeIndex/{code}` only
    when `getVal('codeIndex/{code}')` resolves to the acted-on account.
    `claimShareCode` was confirmed safe (server-generated, transactional).
    Functions 969/969 (+5 guards), typechecks clean, zero new suppressions.
- **Boundary.** Emulator + store-mock + offline probes only; no live project.

---

## SEC-2 — `uid:"/"` collapses whole-node paths and defeats the purge/merge guard — CLOSED

- **Class: robustness / data-safety. NOT a security finding.** The only actor who
  can send it is the authorized operator at their own terminal, who already holds
  an unrestricted admin credential and could destroy the same data in one line. It
  crosses no privilege boundary. It is nonetheless a **High-severity safety
  defect**: one hand-crafted request (or a paste error) can null every account
  record.
- **Where.** `requireString` (`functions/ops/server.js:331`) rejects only
  non-strings and `""`; `"/"` passes. `readOwn` → `buildPurgePlan`
  (`functions/ops/purge.js`, the `if (!own) throw` guard) then issues
  `getVal('users//')`, which the SDK collapses to a read of the **entire `users`
  node** — non-empty, so the "typo'd uid" guard passes. The resulting write-set
  nulls `users//`, `userPrefs//`, `pushTokens//`, `locations//` and the six
  mailbox nodes, each collapsing to a whole top-level node.
  `buildMergePlan` (`functions/ops/merge.js`) has the same defeated guard, but the
  SDK rejects its write-set on a populated database (mailbox descendants collide
  with the collapsed ancestor), so merge aborts except against an empty store.
- **Verified.** Reproduced end-to-end against the real modules + installed SDK
  (offline). Blast radius is `/users`, `/userPrefs`, `/pushTokens`, `/locations`
  and the mailboxes — **not** the whole database (`groups`, `canvases`,
  `codeIndex`, `inviteIndex` survive). Recoverable: `audit.js` normalizes the path
  and captures the collapsed node in the pre-image before the write.
- **Fix.**
  1. Add a `requireUid(value, field)` in `server.js` enforcing
     `/^[A-Za-z0-9_-]{1,128}$/`, and use it for every uid-typed body field
     (`uid`, `loserUid`, `survivorUid`, `derivedUid`, `phraseUid`).
  2. Defence in depth at the plan builders (both are independently importable):
     assert the same pattern at the top of `buildPurgePlan` and `buildMergePlan`
     before the first `getVal`.
  3. Make the "no account" guard **positive**: check `own.presence` (a per-account
     field), not truthy `own`, so a whole-node read cannot masquerade as an
     account.
- **Test.** New cases in `functions/test/ops-server.test.js` /
  `ops-purge.test.js` / `ops-merge.test.js`: `"/"`, `"//"`, `" "`, `"a/b"`, `"a."`
  each refused before any plan is built; a normal uid still builds. Plant the
  violation (drop the regex) to confirm red.
- **Deploy surface.** `ops/**` — **no deploy**.
- **Depends on / relates to:** SEC-4 (the same path-collapse class; fixing
  `rootUpdate` is the systemic backstop). SEC-2 closes the *plant* at this
  panel's two entry layers; it does **not** make `rootUpdate` agree with the
  SDK, so SEC-4 is still owed on its own terms.
- **Fix shipped** (all three parts, as planned above).
  - `functions/ops/uid.js` — new: `UID_PATTERN` (`/^[A-Za-z0-9_-]{1,128}$/`)
    and `assertUid(value, field)`, ONE definition rather than three, since a
    charset that drifts between the edge and the builders is the defect
    re-introduced.
  - `server.js` — `requireUid` (= `requireString` + `assertUid`) on **every**
    uid-typed field: `uid`, `loserUid`, `survivorUid`, `derivedUid`,
    `phraseUid`, across detail / merge / purge / link, preview and execute.
    `requireString` still owns the empty case, so a blank box still reads
    "uid is required" rather than "malformed".
  - `purge.js` / `merge.js` — `assertUid` at the top of `buildPurgePlan`,
    `buildMergePlan`, `buildLinkImpact` and `buildProductionLinkPlan`, before
    the first `getVal`. Independently importable is the whole point: the CLIs
    import them directly.
  - Positive guards: `if (!own?.presence)` in `buildPurgePlan` /
    `buildLinkImpact`, `if (!loser?.presence)` in `buildMergePlan`. The
    survivor side was already positive (it must have a share code).
- **Behaviour change worth knowing.** The positive guard also refuses a
  `users/{uid}` node that is REAL but carries no `presence` — residue a peer
  wrote under a uid with no account (the appendix's `followers/$follower`
  ancestor-skip is one way to get one). Such a node was purgeable before and is
  not now. It is the correct default (this tool must not treat a non-account
  node as an account) and no such node is known to exist, but if residue
  cleanup is wanted the guard is the thing to relax, deliberately.
- **Verification.** Functions **1074/1074** (32 suites; +105 cases, baseline
  969). Each layer confirmed RED before the fix by planting the violation, not
  merely green after: with no fix at all, `buildPurgePlan(deps, '/')` *resolved*
  to a plan nulling `users//`, `userPrefs//`, `pushTokens//`, `locations//` and
  the six mailboxes (103 failures). Planting out **only** the edge check leaves
  32 red — `GET /api/detail` and the three `execute` routes, where the edge is
  the only check that runs before `consumeConfirm`; the preview routes stay
  green because the builders' own `assertUid` catches them, which is the
  defence-in-depth working, and means those preview cases pin the *behaviour*,
  not the edge layer specifically. Planting out the builder checks leaves 17
  red. Rules 119/119, typechecks clean (zero new suppressions), web 2149/2149
  unchanged (no `js/` change).

## SEC-3 — Ops `Origin` guard does not enforce the port — CLOSED

- **Class: security (defense-in-depth).** Code defect certain (confidence 10);
  practical exploitability low (confidence 3) — the destructive chain dies at the
  nonce, see below.
- **Where.** `isLoopbackAuthority` (`functions/ops/server.js:267`) skips the port
  comparison when the authority carries none:
  `if (parsed.port !== null && localPort != null && parsed.port !== localPort) return false;`
  (`:272`). `splitAuthority` (`:255`) makes the port group optional, so a browser
  origin `http://127.0.0.1` (default port 80, omitted on serialisation) is
  accepted by a panel on `:8787`, while `http://127.0.0.1:3000` is correctly
  refused. `functions/ops/README.md` documents the invariant as loopback "on
  **that same port**" — a genuine docs-vs-code mismatch.
- **Why exploitability is low.** The server emits **no** `Access-Control-Allow-*`
  header, and every destructive route requires a `randomUUID` nonce delivered only
  in a preview **response body** the cross-origin script cannot read
  (`http://127.0.0.1` ≠ `http://127.0.0.1:8787`). So a page on loopback:80 can
  *send* preview/execute but cannot obtain the nonce — blind writes only, and
  there are no blind destructive routes. It does **not** compose with SEC-2 for
  the same reason.
- **Fix.** In `isLoopbackAuthority`, resolve an absent port to the scheme default
  and always compare:
  `const effective = parsed.port === null ? 80 : parsed.port; if (localPort != null && effective !== localPort) return false;`
  Thread the scheme through from the `Origin` branch so `https://127.0.0.1`
  defaults to 443. Fix the README wording in the same change (see SEC-8's spirit).
- **Test.** `functions/test/ops-server.test.js` currently covers only a *wrong*
  port (`:9999`); add `host: '127.0.0.1'` (no port), `origin: 'http://127.0.0.1'`
  and `origin: 'http://localhost'` → refused. That gap is why this survived
  review round 1.
- **Deploy surface.** `ops/**` — **no deploy**.
- **Fix shipped, as planned above.** `isLoopbackAuthority` takes a
  `defaultPort` and always compares: `const port = parsed.port === null ?
  defaultPort : parsed.port`. `originRefusal` passes 80 for `Host`
  (`createHttpServer` speaks plain http and binds loopback — there is no TLS,
  so a port-less Host can only mean 80) and, for `Origin`, threads the captured
  scheme: `https` → 443, `http` → 80.
- **README.** No correction was owed after all: the file already said "on that
  same port", so the mismatch was code-vs-docs with the *docs* in the right.
  The `ops/README.md` edit in this change **adds** the rule that a port-less
  header means the scheme's default rather than any port, and documents SEC-7's
  headers.
- **Verification.** Three new cases, each confirmed RED before the fix:
  port-less `Host`/`Origin` on a `:8787` panel now refused; `https://127.0.0.1`
  resolves to 443 (refused on a port-80 panel, accepted on a 443 one); and — the
  property the fix must NOT break — a panel genuinely listening on 80 still
  accepts the port-less header, which was green before and after by design.

## SEC-4 — `rootUpdate` overlap check disagrees with the SDK on collapsed paths — CLOSED

- **Class: security (defense-in-depth).** The systemic backstop under SEC-2 and
  the codeIndex `"/"` collapse (SEC-1 Variant B): `rootUpdate` decides whether a
  multi-path update is conflict-free, and it decides it **differently** from the
  SDK it feeds.
- **Where.** `rootUpdate` (`functions/telegram-shared.js:41`) detects ancestor
  overlaps by **raw-string prefix**: `if (key.startsWith(`${keys[j]}/`))` (`:52`).
  The SDK, by contrast, first strips empty path segments (`a//b` → `a/b`) and then
  runs its own ancestor check on the collapsed form. So a key like `codeIndex//`
  or `users//` passes `rootUpdate` untouched while the SDK treats it as
  `/codeIndex` / `/users` — the two disagree about what path a key *is*.
- **Fix.** Normalize each key (collapse `/+/` → `/`, strip leading/trailing `/`)
  **before** the overlap check and before emitting the write, so `rootUpdate`
  can never pass a key that the SDK will re-target to a broader node than the
  caller wrote. Reject a key that normalizes to empty (root).
- **Test.** `functions/test/telegram-shared.test.js`: `{'a//': null, 'a/b': null}`
  must be detected as an overlap (today it is not); `'x//y'` must normalize to
  `x/y`; a key of `"/"`/`""` must be refused.
- **Deploy surface.** `telegram-shared.js` is a **deployed** Cloud Function
  module — this is the one remaining item that ships to a live surface. Treat its
  review accordingly.
- **Fix shipped — REFUSES rather than normalizes.** The prescription above
  (collapse the key, then compare) makes `rootUpdate` agree with the SDK, which
  is all the *disagreement* strictly requires. It is not enough. A collapsed key
  is still written: `users/${uid}` built from an empty uid becomes a write to
  the whole `users` node, and after normalization the overlap analysis nods
  along instead of catching it — the same catastrophe SEC-2 closed at the ops
  edge, re-admitted at the shared backstop. So a key whose parsed path differs
  from the key itself is refused, and the whole write-map with it (these
  updates are atomic; half a destructive write-set is worse than none). A key
  that parses to empty — `"/"`, `""`, `"//"` — is refused as the root write it
  is. Every surviving key then IS its own path, so the existing raw-string
  ancestor check is right by construction and was left alone.
- **Evidence the refusal is safe for shipped callers.** Planted the refusal and
  ran the **whole** functions suite: only the four SEC-4 cases being written
  failed; all 32 other suites — every `rootUpdate` caller in `telegram.js`,
  `telegram-auth.js` and `ops/merge.js`, including expunge, graduation and the
  merge write-sets — stayed green. No shipped caller emits a key with an empty
  segment, and none can: RTDB keys cannot contain `/`, and every interpolated
  value is a uid, gid, tgId or token.
- **Verification against the real SDK, not only the mock.** Probed offline
  against the installed `firebase-admin`: `ref('a//b')` → `/a/b`,
  `ref('users//')` → `/users`, `ref('/')` → root, and
  `update('/', {'a//': null, 'a/b': null})` is **rejected** for the ancestor
  overlap `rootUpdate` had just certified absent, while `{'x//y': 1}` is
  **accepted and silently retargeted** to `/x/y` — both halves of the defect,
  confirmed. After the fix, the two well-formed write-maps still pass the SDK's
  own argument validation and the two malformed ones never reach it. Five new
  cases, RED first. Functions 1100/1100; rules 119/119, typechecks clean, web
  2149/2149 unchanged.
- **Deploy note for the maintainer.** This is the one change in the SEC series
  that alters a **deployed** artifact. Merging it to `dev` deploys it ungated.
  Its behaviour change is a new *refusal* on a write-map no caller produces, so
  the expected production effect is none — but "none" is an inference from the
  suite and the SDK probe, not from a live run.

## SEC-5 — `.ops-audit/` git-ignore rule is path-anchored — CLOSED

- **Class: data exposure (repository). Low, confidence 7.**
- **Where.** `.gitignore:18` is `functions/.ops-audit/` — anchored, so it only
  matches when the panel is launched with CWD = `functions/`. The self-invocation
  guard (`server.js`, `argv[1].endsWith('ops/server.js')`) also permits
  `node functions/ops/server.js` from the repo root, which writes dumps to
  `/home/user/on/.ops-audit/` — matched by **no** ignore rule. A purge/merge
  pre-image dump contains full account data (push tokens, Telegram chat id, coarse
  location cells, and — with the Auth-delete box — email). An `git add -A` then
  commits it; a push to `dev` deploys ungated.
  (Hosting would not *serve* it — `**/.*` excludes dot-dirs — so the exposure is
  repository history, not the web.)
- **Fix.** Unanchor to `.ops-audit/` (matches at any depth). Optionally also
  resolve `auditDir` against `HERE` in `server.js` so the location does not depend
  on the operator's CWD.
- **Test.** N/A (config); a one-line note in `README.md`'s run section that the
  dump dir is ignored regardless of launch directory.
- **Deploy surface.** `.gitignore` — **no deploy**.
- **Fix shipped, both halves** (the "optional" one was taken — a rule and a
  writer that disagree about where dumps go is how this item happened).
  - `.gitignore` — `functions/.ops-audit/` → `.ops-audit/`, matching at any
    depth.
  - `server.js` — the default `--audit-dir` is now `DEFAULT_AUDIT_DIR`,
    `join(HERE, '..', '.ops-audit')`, so the location is a property of the
    module rather than of the operator's shell. An explicit `--audit-dir` still
    wins. (The stray second `const HERE` further down the file went with it.)
  - `ops/README.md` — the flag table's default and a note on both facts.
- **Test — it turned out NOT to be N/A.** `functions/test/ops-audit-dir.test.js`
  asks **git itself** (`git check-ignore`, the CLI-spawning precedent set by
  `ops-merge-cli.test.js`) whether a dump is ignored at the repo root, under
  `functions/`, and one level deeper, plus that an ordinary tracked file is
  still not ignored; and pins the default audit dir as absolute and anchored to
  `functions/`. Confirmed RED first: the repo-root and deeper paths came back
  *not ignored*, which is the defect, and the default dir came back relative.
  Functions 1090/1090 (+7).

## SEC-6 — `merge` / `link-as-production` execute without revoking the session — CLOSED

- **Class: hardening / parity. NOT a security finding.** Filed here so it is not
  re-derived. The adversary is the account's own owner (merge's documented use is
  consolidating one person's two accounts; abuse cleanup is *purge*, which already
  revokes). And revoking would not close the durable half anyway: uids are
  re-derivable (`validateRecovery` / `deriveTelegramUid`) so the account returns on
  next open — a fact already documented for purge.
- **Where.** `revokeRefreshTokens` is called only at
  `functions/ops/server.js:738`, inside `POST /api/purge/execute` (`:704`).
  `POST /api/merge/execute` (`:681`) and `POST /api/link/production/execute`
  (`:783`) destroy the account with no revoke. `README.md`'s "What each action
  destroys" table (`:473`) states the revoke for **purge** only; the merge / link
  rows are silent, and `mergePreview` (`functions/ops/panel.html:199`) renders
  conflicts/losses but says nothing about the session.
- **Fix (parity, not a new mechanism).** Give `merge/execute` and
  `link/production/execute` the same `revokeRefreshTokens(loserUid)` /
  `(derivedUid)` **before** the write, reusing purge's fail-closed guard and
  `sessionNote` wording verbatim so the three routes cannot drift. Add the
  "close the loser's clients first" line to the merge dialog and the merge/link
  rows in `README.md`.
- **Test.** `functions/test/ops-server.test.js`: merge/link execute call
  `auth.revokeRefreshTokens` with the removed uid and refuse when it throws
  anything but `auth/user-not-found`.
- **Deploy surface.** `ops/**` + docs — **no deploy**.
- **Fix shipped, as prescribed — with the "verbatim" part taken as a shared
  function rather than a copy.** The entry above asks for purge's guard and
  `sessionNote` wording "verbatim so the three routes cannot drift". Copied
  text drifts; a copied *guard* drifts silently. So the revoke is now ONE
  function — `endSession(auth, uid, op)` in `ops/server.js` — and purge's own
  route was folded onto it rather than left as the original. The messages take
  the operation's name, so a merge reads "no session can survive this merge"
  instead of "…this purge"; that is the only thing that varies, and a test
  pins it.
  - `merge/execute` revokes `loserUid`, `link/production/execute` revokes
    `derivedUid` — always the account being **removed**, never the survivor or
    the phrase account, which are the point of the operation and keep their
    sessions. "Link via merge" comes through `merge/execute`, so it revokes
    too: it loses no *data*, but that uid's session still ends, and the
    README's row now says so.
  - The **G8 allowlist matters more here than it ever did on purge**, and the
    entry above did not note it: every account `ops/seed-merge-fixture.js`
    writes is RTDB-only, and the merge leg of the smoke test runs against
    exactly those. A bare `revokeRefreshTokens` — the literal reading of "the
    same revoke" — would have refused the entire documented merge rehearsal.
    Every other failure still refuses, fail-closed, with nothing written.
  - The panel gained purge's footnote, worded per route, and now surfaces the
    server's `sessionNote` after a merge and a production link. It was
    purge-only, so a `NO AUTH RECORD` merge — the ordinary synthetic case —
    reported nothing at all.
- **Verification.** Eleven new cases, each confirmed **RED before the fix** and
  for the defect itself, not fixture noise: `revokeRefreshTokens` called **zero
  times** and the destructive write resolving `{ok: true}`. Functions
  **1111/1111** (33 suites, baseline 1100); rules 119/119, web 2149/2149
  unchanged, typechecks clean, zero new suppressions. The panel half was driven
  through the **real** `createHttpServer` and the **real** `panel.html` in
  headless Chromium (SEC-7's technique): both dialogs render their footnote,
  both executes surface the note, no console output and no CSP violation — and
  the harness was itself falsified by planting the breakage (footnote and alert
  removed), which took it to four failures. Harness uncommitted, in the session
  scratchpad.
- **Boundary — UNVERIFIED-LIVE.** No session has ever held a service-account
  credential, so the revoke has never been observed against real Firebase Auth
  on these two routes. Purge's revoke *was* measured on dev (2026-08-02); these
  two inherit that measurement by sharing its implementation, which is an
  inference, not an observation.

## SEC-7 — Ops panel serves no CSP / framing headers — CLOSED

- **Class: security (defense-in-depth). Low, confidence 6.**
- **Where.** `server.js`'s response writer sets `Content-Type` only; the panel
  HTML is served with no `Content-Security-Policy` and no
  `X-Frame-Options`/`frame-ancestors`. The page's script can call every `/api/*`
  route same-origin.
- **Why low.** No click-only destructive path exists — every destructive action
  needs a **typed** uid checked server-side against a preview nonce, and a
  cross-origin frame can neither read the uid to type nor supply it. The value is
  purely as a backstop: if a DOM-XSS is ever introduced in `panel.html`, a CSP is
  the last line of defence.
- **Fix.** Add `Content-Security-Policy: default-src 'none'; style-src
  'unsafe-inline'` (or hashed) and `X-Frame-Options: DENY` to the panel HTML
  response in `server.js`. Cheap; do it alongside SEC-3.
- **Deploy surface.** `ops/**` — **no deploy**.
- **Fix shipped — and the header above is NOT the one that shipped.** Sent
  verbatim it would have served a blank panel: `default-src 'none'` blocks the
  page's own `fetch('/api/*')`, and the file's one inline `<script>` needs a
  source of its own. Two deliberate departures:
  - `connect-src 'self'` — without it the CSP does not harden the panel, it
    disables it.
  - `script-src 'nonce-<per-response uuid>'`, **not** `'unsafe-inline'`. The
    DOM-XSS this backstops arrives through `innerHTML`, where the executable
    form is an inline event handler (`<img onerror=…>`) — precisely what
    `'unsafe-inline'` permits. A nonce refuses it. `panel.html` carries
    `nonce="__CSP_NONCE__"` (exported as `CSP_NONCE_PLACEHOLDER`), substituted
    per response.
  `style-src 'unsafe-inline'` was kept as suggested (a style injection cannot
  reach the API), plus `base-uri`/`form-action`/`frame-ancestors 'none'`.
  `X-Frame-Options: DENY` and the bare `default-src 'none'` policy go on
  **every** response, not just the page, so no future route can forget them.
- **Verification.** Six new cases (framing, the default-deny + the three
  exceptions, nonce-not-unsafe-inline with the header and the page body pinned
  to each other, per-response freshness, API responses, and a source assertion
  that `panel.html` still carries the placeholder on its one script tag), all
  RED before the fix. Unit tests cannot tell a hardened panel from a broken
  one, so the **real** `panel.html` was also driven through the **real**
  `createHttpServer` in headless Chromium against canned routes: inline script
  executed under the nonce, `/api/snapshot` fetched, row rendered, zero console
  or CSP-violation output. That harness was then itself checked by planting a
  CSP with `connect-src` removed — it correctly went to 0 rows with two CSP
  violations logged, so a green run means something. (Harness is uncommitted,
  in the session scratchpad, per the repo's precedent for browser smokes.)

## SEC-8 — Docs label the merge-leg client hazard "G3" (wrong ID) — CLOSED

- **Class: docs hygiene. Trivial, confidence 9.**
- **Where.** `functions/ops/README.md` (the merge-leg "a client is a hazard"
  paragraph) and `docs/HANDOFF.md` (the merge-leg preconditions) both label the
  *merge-leg* client-republish hazard **"G3"**. G3/#302 is specifically the
  *revoked-session* rules window; the merge hazard is the SEC-6 parity gap. This
  is the same conflation the repo already caught and corrected once for G6 ("G6
  does not close with G3") — recurring in two live documents, and exactly the
  "docs fail on claims about consequence" landmine.
- **Fix.** Rename the hazard in both places to the merge-revoke-parity item
  (SEC-6), keeping G3 for the rules window only. Do it when SEC-6 is worked.
- **Deploy surface.** docs — **no deploy**.
- **Fix shipped — and it is the OPPOSITE of the rename prescribed above. The
  fourth of this document's own prescriptions to be wrong**, after SEC-4,
  SEC-5 and SEC-7.
  - The diagnosis holds: "G3" *was* wrong on the merge leg, and for a sharper
    reason than this entry gives. The README sentence reads "**G3** (a revoked
    session keeps writing for up to an hour)" — a parenthetical describing a
    session that **was revoked**. On the merge and link legs none was, so the
    window it named as an hour was in fact **unbounded**. The label was not
    merely the wrong ID; it understated the hazard.
  - But the fix inverts, precisely because this document required SEC-8 to be
    sequenced *behind* SEC-6 ("do it when SEC-6 is worked"). Once merge and the
    production link revoke, their residual hazard **is** G3 — the same bounded
    token window purge carries, for the same reason: `database.rules.json`
    never checks `auth.token.auth_time`. Renaming to "SEC-6" would have stamped
    two live runbooks with an item closed by the same commit, and struck a
    reference that had just become true.
  - **So G3 stays**, in `ops/README.md`'s merge-leg paragraph and in
    `docs/HANDOFF.md`'s preconditions, each gaining a short passage recording
    that the name became accurate only at SEC-6 and that the window was
    unbounded before it. `ops/README.md` also renames "Why purge ends the
    session" to "Why a destroy ends the session" and states the shared revoke
    there, and its "What each action destroys" table now states the revoke on
    the merge, link-via-merge and link-as-production rows — which was SEC-6's
    docs half.
  - **G3/#302 was not worked on and stays parked.** Nothing in this change
    touches `database.rules.json`. The park's own instruction below — do not
    fold SEC-6 into #302 — still holds and is not what happened: SEC-6 was the
    *absence* of a revoke, #302 is an issued token *outliving* one, and closing
    the first is exactly what made the second the correct name for what is
    left. The two-mechanism distinction this entry exists to protect is
    preserved; only which mechanism the merge leg sits under has changed.
- **The transferable lesson**, since this is now a pattern rather than an
  accident: **a prescription written before its dependency was implemented
  describes the world without the dependency.** Four of eight entries here were
  written that way and four were wrong. Re-derive the prescription against the
  state the code is in when you reach it, not the state the audit found.

---

## Parked — out of scope

- **G3 / [#302](https://github.com/tenorune/on/issues/302)** — `database.rules.json`
  never checks `auth.token.auth_time`, so a revoked session keeps writing for up
  to an hour. Whole-app, spec-first, deliberately deferred. The ledger of record
  is `docs/operator-panel-followups.md`'s G3 entry. **Do not fold any item above
  into it** — SEC-6 in particular is a *different* mechanism (no revoke at all vs
  an honoured unexpired token), which is why SEC-8 exists.
  🛑 **G3 also requires the operator's explicit go-ahead before any session
  works it** — see the standing rule in `docs/HANDOFF.md`'s "What's next".

## Appendix — pre-existing, outside this diff (not introduced here)

Inspected during the review; present identically on `origin/main`. Recorded so a
future reader does not attribute them to this work. Storage-injection / nuisance
class, not privilege gain — promote only against the test the ledger uses (does it
affect the correctness of a destructive write?).

- `database.rules.json` `users/$uid/invites/$token/redemptionsUsed` grants
  `.write: "auth != null"`, and `.validate` is skipped for writes *below* it.
- `users/$uid/followers/$follower` (and `followerNames/$follower`) let a follower
  write an unvalidated subtree at `users/{V}/followers/{me}/x` (ancestor-skip).

## Suggested sequencing

1. ~~**SEC-4**~~ — **DONE** (last, not first: the operator asked for the
   no-deploy items ahead of it). Shipped as a refusal, not the normalization
   this doc proposed — see its entry for why, and for the evidence that no
   shipped caller is affected.
2. ~~**SEC-2**~~ — **DONE** (`requireUid` + the builder asserts + the positive
   guards, bundled as one change, as planned). It did not close SEC-4; item 1
   still stands on its own.
3. ~~**SEC-3 + SEC-7**~~ — **DONE**, together as planned (both `server.js`).
   Note SEC-7 did not ship the header this doc suggested; see its entry.
4. ~~**SEC-5**~~ — **DONE**. Not quite the advertised one-liner: the writer's
   CWD-relative default was taken with it, and the "N/A (config)" test note was
   wrong — `git check-ignore` tests it directly.
5. ~~**SEC-6 + SEC-8**~~ — **DONE**, together as planned, and that sequencing
   is what exposed the error: SEC-8's doc-ID correction inverts once SEC-6's
   revoke lands, so G3 stayed rather than being renamed. See both entries.

None of SEC-2..SEC-8 rides a deploy except SEC-4. A branch carrying all of them
ships nothing to a live project until it reaches `dev`, and only SEC-4 changes a
deployed artifact even then.
