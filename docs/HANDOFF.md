# KnockKnock — Session Handoff

> Forward-first. History lives in git, `docs/superpowers/plans/`, and `docs/archive/`.
> Prior handoffs (TS adoption + client-performance era) are archived at
> `docs/archive/HANDOFF-2026-07-17.md` — read only if you need that backstory.

## What this is

KnockKnock — a vanilla-TypeScript + Firebase (Hosting / RTDB / Cloud Functions) PWA
for ambient presence. Repo `tenorune/on`, working dir `/home/user/on`.

## What's next

**The operator control panel is built and reviewed** — all 11 tasks of
`docs/superpowers/plans/2026-08-01-operator-control-panel.md` landed on
`claude/knockknock-ui-improvements-7bm5o9` (per-task commits, each reviewed).
`functions/ops/` is the local Admin-SDK CLI (user list, merge, purge,
Telegram link-without-loss, integrity report); its own `README.md` is the
runbook. See "Where things stand" below for what's still owed before it's
trusted with production data.

**`docs/operator-panel-followups.md` is the companion to this section** — it
carries the parked residuals, the reasoning behind each known gap, and the
deferred minors, distilled from the implementation session's review ledger.
Read it before touching `functions/ops/` or `functions/telegram-auth.js`.

Of the three follow-ups this branch owed, **two are done** (2026-08-01, see
History) and one remains:

1. **The manual dev-project smoke test — STILL OWED, still the first thing.**
   No service-account credential has existed in any container this work ran
   in, so `deps.js`, `panel.html`'s browser behavior, and the Host/Origin
   guard as seen from a real browser are all unexercised. Do this before the
   panel touches production. Every green number below covers the wiring, not
   the live system.

Done, on this branch:

- ~~The `crossRefRenderers` locations follow-up~~ — `4dea508`. Both location
  families and the unjoined-invite `pendingInvitesByGroup` entries are in the
  shared enumerator; the local copies in `merge.js`/`purge.js` are gone; the
  owned-group orphan case is handled by a wholesale `locationCells/{gid}` null
  beside the `pendingInvitesByGroup/{gid}` null already in the owned-group
  block. This CHANGED live expunge and graduation behaviour and is covered by
  `functions/test/crossref-locations.test.js`.
- ~~Fold the shipped link-write copy~~ — `16e5ae9`. The plan as written was
  undeployable (see the `ops/**` landmine below); the shared builder moved to
  `functions/telegram-link-write.js` instead and `performLink` now calls it.

Spec: `docs/superpowers/specs/2026-08-01-operator-control-panel-design.md` —
decisions D1–D6 and their rationale; §7 (merge family rules) and §8 (the
Telegram link case) matter most if you touch merge code. `dev`/`main` are
unaffected — the maintainer merges this branch when ready.

⚠️ **Do not touch code without the operator's explicit say-so** — propose the
change and get approval BEFORE any edit. The operator drives; expect
hands-on iteration ("done" is their call).

## Where things stand (2026-08-01)

The operator control panel is built: all 10 code tasks of the 11-task plan
landed on `claude/knockknock-ui-improvements-7bm5o9` (subagent-driven,
per-task commits, each reviewed); this doc update is Task 11, the plan's
last. `functions/ops/` holds the local Admin-SDK CLI + page
(`server.js`, `panel.html`, `merge.js`, `purge.js`, `audit.js`, `integrity.js`,
`provenance.js`, `project.js`, `snapshot.js`, `deps.js`) and its own
`README.md` runbook — read that before running it. **The panel is local-only
and has never been deployed and never will be**: it isn't part of the
Firebase Hosting or Cloud Functions deploy surface (excluded from the
functions archive via `functions.ignore`'s `ops/**`), it runs as a Node CLI
an operator starts by hand against a target project, and it binds `127.0.0.1`
only. `dev` and `main` are unchanged and tree-identical; the maintainer
merges, so the branch stays open.

**Owed before this is trusted with production data:** a manual smoke test
against a real dev Firebase project. No service-account credential has
existed in any container this work ran in, so `deps.js`, `panel.html`'s
browser behavior, and the Host/Origin guard as seen from an actual browser
are all UNEXERCISED — every green test below covers the wiring, not the live
system. Also worth knowing: approvals are per-uid and held in memory, so the
panel is single-operator by construction — two people running it against the
same project at once do not share approval state.

Everything below is SHIPPED and merged; no pending uncommitted/unpushed work.

- **v2.0.0 released.** `dev` → `main` merged by the maintainer (`main` =
  `731eed9`); tagged `v2.0.0` on GitHub at the release commit `ca1d1fa`.
  v2.0.0 = 352 commits since v1.3.0 — opt-in location/distance sharing, the
  Telegram Mini App + bot (beacon nudge + `/locoff`), two performance-audit
  passes + a security batch, the TypeScript migration, PWA auto-update
  hardening. Release notes (v1.3.0…v2.0.0) live on the GitHub release.
- **Release content (this session).** New `README.md` feature + data-model
  updates and refreshed About-page content for distance sharing and the
  Telegram commands (`76454d6`).
- **Direct status-text-color fix (this session, device-verified).**
  `js/following.ts` no longer overrides the "Available for…" text to the
  palette key color; it follows the member's `statusColor`, so the label
  agrees with the status dot (mirrors the group roster). Shipped to `dev` +
  `main` (`361e65c`). **NOT in the `v2.0.0` tag** — operator chose no new
  tag, so it rides the branch; the next tagged release (`v2.0.1`+) includes
  it.

**Deploy state:** merging `dev` → `main` may trigger the gated prod deploy
workflow (required-reviewer). If a prod deploy is still owed, the ordering is
the LOAD-BEARING `pushTokens` F6c sequence + a functions deploy (the Telegram
beacon batch touches `functions/`) — full runbook in `docs/DEPLOY-PROD.md`.
Nothing deploys from sessions.

## Verification state

Green bar OBSERVED at `16e5ae9` (2026-08-01, ops-panel branch tip, after the
two residue/link-write follow-ups): web jest **2106/2106** (88 suites) ·
functions **726/726** (24 suites) · `typecheck` + `typecheck:scripts` clean ·
`node scripts/prod.js` builds. Movement from the `b59add9` bar (2089/713):
+11 functions tests for the enumerator's new families, +2 for the
`buildLinkWrites` pre-read seam, +17 web tests from the per-file
`ops/**` import guard (one case per top-level `functions/*.js`). Nothing
pre-existing changed shape.

`functions/test/telegram-auth.test.js` has a **0-line diff across the entire
branch** — that is the standing proof the `expungeDerivedAccount` split
preserved shipped behaviour. Do not edit it; if it goes red, the refactor is
wrong. It survived both follow-ups, including the one that deliberately
changed live expunge behaviour: the new coverage went in its own file
(`functions/test/crossref-locations.test.js`) precisely so the invariant would
stay meaningful.

**What green does NOT cover:** the panel has never run against a real Firebase
project — no service-account credential existed in any container this work ran
in. `deps.js`, `panel.html`'s browser behaviour, and the `Host`/`Origin` guard
from a real browser are unexercised, and that guard is the panel's only
authentication boundary.

## On-ramp

- This file is the source of truth for "where things are."
- `CLAUDE.md` (auto-loaded) holds the binding conventions — read it.
- Per-feature detail: `docs/superpowers/plans/` and the matching git history.

## Environment

Commands (all from repo root unless noted):

| Purpose | Command |
|---|---|
| Web tests | `npx jest` (use `--maxWorkers=2` — default workers can OOM the container) |
| Cloud Functions tests | `cd functions && npm test` (return to repo root after!) |
| Rules tests (emulator) | `npm run test:rules` |
| Typecheck (strict) | `npm run typecheck && npm run typecheck:scripts` |
| Production build | `node scripts/prod.js` |
| Shared-code mirror | `npm run sync-shared` (shared/ → functions/_shared/) |
| Dev server (LAN, live-reload) | `node scripts/dev.js` |

Fresh-container setup (deps aren't pre-installed):

```
apt-get update; apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
npm ci ; cd functions && npm ci
```

Use `;` not `&&` in the apt line — the deadsnakes/ondrej PPAs 403 behind the
proxy and would abort an `&&` chain. Functions deps are required for
`npm run typecheck`.

## Conventions

- `dev` is the integration branch. Cut feature branches from `dev`.
- Do feature work on the feature branch and push it; **the maintainer merges to
  `dev` (and `dev` → `main`)**. Don't merge to `dev`/`main` yourself, and don't
  create PRs, unless explicitly asked. (When asked, that authorization stands —
  ask *how*, then do it.)
- Zero TS suppressions. `typecheck` + `typecheck:scripts` must stay green.
  Sweep for **all** the forms, not just the TS-syntax ones — the ops-panel plan
  shipped two `/** @type {any} */` casts past reviews that grepped only for
  `as any`, one of them in production panel code:
  `as any`, `@ts-ignore`, `@ts-expect-error`, `@type {any}`, `{any}`, `: any`,
  `<any>`. The last three also match honest boundary annotations
  (`Promise<any>` on a raw RTDB read seam); read each hit, do not assume.
- Set committer identity first (`git config user.email noreply@anthropic.com &&
  git config user.name Claude`) or the stop-hook flags commits Unverified and
  forces amend+re-push.
- Never hand off red: run all four gates before wrapping.
- The stop-hook at turn end is the standing commit+push prompt — commit then,
  not unprompted mid-turn. (The plan's per-task commit steps are
  operator-sanctioned: committing at each task boundary IS the instruction.)

## Working style (operator)

- The operator drives the loop. Terse cues ("go", "a", "y") mean proceed — don't
  re-explain. Scale ceremony to stakes.
- Open action lines with a gerund ("Reading…", "Verifying…"), no first-person voice.
- At real forks, present bounded A/B/C choices with a recommendation; decide the
  rest yourself.
- Separate **OBSERVED** from **UNKNOWN**. Never call something done/fixed/working
  from a single run. "Done" is the operator's call — expect hands-on iteration on
  anything visual.
- Don't commit / push / merge / bump versions unprompted.

---

## Landmines (read before touching code)

- **Hosting serves Cloud Functions source today.** `hosting.ignore` omits
  `functions/**` while `hosting.public` is `"."`, and Firebase Hosting does
  NOT auto-exclude the functions source dir — it uploads everything under
  `public` minus `ignore`. Confirmed live 2026-08-01 (200 on
  `/functions/telegram-auth.js`). Not a secret leak (public repo, secrets in
  env) but it is server-side code on a public URL. Ops-panel plan Task 1
  fixes it and pins both lists with a test. **Related trap:** specifying
  `functions.ignore` **replaces** the CLI defaults — re-list `node_modules`,
  `.git`, `firebase-debug.log`, `firebase-debug.*.log` or the deploy archive
  balloons.
- **`crossRefRenderers` in `functions/telegram-auth.js` is the ONE residue
  enumerator.** Expunge and graduation share it deliberately so a new
  cross-user residue family can't be added to one and missed by the other
  (the reason `followerNames` had to land in both). The ops panel's merge
  becomes its third consumer. Add new families THERE, never in a consumer.
  Pinned by the parity test in `functions/test/ops-merge.test.js`
  ("parity with the shared residue enumerator").
- **`crossRefRenderers` now enumerates the location families and the
  unjoined-invite entries (`4dea508`) — the old "known gap" is CLOSED.** It
  emits `locations/{u}`, `locationCells/{gid}/{u}` for each member gid, and
  `pendingInvitesByGroup/{gid}/{u}` for gids taken from the account's own
  `pendingInvites/{uid}` mailbox (groups it was invited to but never joined —
  `groups` cannot see those). Both `buildExpungeWrites` and
  `graduateAccountData` read that mailbox now. Three consequences to know:
  (a) expunge DELETES a location fix and graduation MOVES it, where both
  previously left it behind — live behaviour changed, covered by
  `functions/test/crossref-locations.test.js`, NOT by
  `functions/test/telegram-auth.test.js` (whose 0-line diff is preserved);
  (b) the new families are appended AFTER the pre-existing ones so the
  graduation walker's move order — which its consumed-source dedup depends on
  — is untouched; (c) an owned group is deleted wholesale, which would strand
  *other* members' cells, so `buildExpungeWrites`' owned-group block nulls
  `locationCells/{gid}` entirely, beside the `pendingInvitesByGroup/{gid}`
  null already there. `rootUpdate` drops the enumerator's per-uid nulls under
  it as redundant deletes.
- **Shipped `functions/*.js` may NEVER import from `functions/ops/` at
  runtime.** `functions.ignore` excludes `ops/**` from the deploy archive, so
  such an import deploys cleanly and then dies at cold start on a missing
  module, taking whatever callable it backs down with it — with every
  repo-side test green, because the file is present in the repo. This is why
  the shared Telegram mapping builder lives at
  `functions/telegram-link-write.js` and not under `ops/` (`16e5ae9`), and
  why the documented "make `performLink` call `ops/link-write.js`" follow-up
  could not be executed as written. Pinned per-file by
  `tests/firebaseConfig.test.js` ("shipped functions code never imports the
  ops panel"). A JSDoc `import('./ops/types.js')` is a TYPE reference, erased
  before it runs, and is allowed — the guard skips comment lines. **Do not
  "simplify" that guard into a block-comment regex strip:** the first version
  did exactly that and passed against a planted violation, because the `/*`
  inside the prose `` `ops/**` `` opened a match that ran to the next `*/` and
  ate the import statements in between.
- **The ops panel binds `127.0.0.1` only** (`functions/ops/server.js`). It
  holds a service-account credential in-process for the life of the run —
  never bind it to `0.0.0.0`, pass `--host`, or put it behind a tunnel or
  reverse proxy; there is no such flag on purpose. Loopback binding alone
  doesn't stop DNS rebinding, which is why the server also checks `Host` and
  `Origin` on every request (see `functions/ops/README.md`).
- **`uid = sha256(phrase)` is one-way, so "has a phrase" is not observable.**
  It's inferable: uids come from exactly three paths (web `initUser`,
  Telegram bootstrap via `deriveTelegramUid`, graduation), so not-derived ⇒
  phrase-born. And graduated-vs-linked is a **heuristic** —
  `userPrefs/{uid}/telegram/linkedAt < telegramUsers/{tgId}.linkedAt` means
  graduated, because `performLink` writes both in the same update while
  graduation copies the prefs subtree wholesale. It reads "linked" for a
  graduated account that later re-links. Don't present it as fact.
- **Production's Telegram link DESTROYS a derived account.** `performLink`
  calls `expungeDerivedAccount` on a standalone derived account
  (`functions/telegram-auth.js:210`), and the only warning
  (`redeemTelegramLinkTokenHandler`) counts just followers/following/groups —
  silent about owned groups (deleted for ALL members), canvases, and invite
  tokens. "contacts: 0, groups: 0" can still be a lossy link.
- **Direct available-text color follows `statusColor`, NOT the palette key color.** `js/following.ts`'s palette card branch must not re-set `.status-available`'s color to `palette.color`: the fuzzy-time label follows the member's status color so it agrees with the status dot, mirroring `groupContext.ts` ("fuzzy time follows status color, not theme"). Re-adding the override reintroduces the 2026-07-31 mismatch (dot one color, label the palette/border color) — visible whenever a member's `statusColor` differs from their palette's key color. Pinned by `tests/following.test.js` ("available span … keeps statusColor").
- **RTDB rules: a granted ancestor `.write` cannot be revoked by a child
  `.write`.** Under `users/$uid` (blanket self `.write`), enforcement must be
  `.validate` (doesn't cascade, skipped on delete) — that's why the
  `followers`/`followerNames` guards are `.validate` and the sibling `.write`
  narrowing is inert decoration. Under `groups/$gid` (owner-only ancestor),
  child `.write` narrowing IS load-bearing. Check the ancestor chain before
  judging or editing any rule.
- **Shallow clone → false "unrelated histories."** Fresh containers clone shallow
  (`.git/shallow`). Run `git fetch --unshallow origin` **before** any cross-branch
  merge/compare/ancestry check.
- **`cd functions` lingers.** Compound shell commands that `cd functions` leave
  the session cwd there — later `npx jest`/`npm run typecheck` silently run
  against the wrong package ("No tests found" / npm errors). Always
  `cd /home/user/on` first.
- **Location: distance-listener attaches MUST be gated on the own node existing.**
  The reciprocity rules make a listen that attaches before the viewer's own node
  exists get denied and **permanently cancelled** (the SDK never retries). That's
  what the per-context `_publishedContexts` set in `js/locationShare.ts` encodes
  (set on landed publish or boot-probe, cleared only on deletion paths) and why
  the surfaces' `reconcileDistanceSubs` passes key off `isContextPublished`.
  Dispatching eligibility before a write lands re-creates "distances silently
  dead."
- **Location: `evaluateAvailability()` is the single availability authority**
  (primary tick, per-gid statusStore tick, opt-in change, 60s tick head). Don't
  add availability dispatches elsewhere; don't remove the tick-head call — time
  lapses arrive with no data tick.
- **Location: never delete nodes on availability flaps.** Last-known is the
  feature; a delete cancels every peer listener via rules re-evaluation. Deletes
  belong to glyph-off / revocation / reset only. `toggleContext` off-branch
  orderings are load-bearing (gid snapshots BEFORE pref flips; group-off uses
  cells-only clear so the raw point never transiently vanishes). Regression
  tests pin all of this — trust a red test over a "simplification."
- **Location tests mock the db barrel** — jsdom suites can't see attach-time
  rules denials or listener cancellation; real-infra behavior differs. Debug
  "distance missing on device but tests green" at the rules/attach layer first.
- **Telegram `LocationManager.init()` calls back only on the FIRST init per
  session** (device-observed). `getPositionOnce` must keep the `isInited` fast
  path or every later read hangs forever (glyph un-retoggleable, ticks dead).
- **`shared/` is mirrored into `functions/_shared/` by `npm run sync-shared`** —
  never edit the mirror by hand; edit `shared/` and re-sync (jest + the
  fixture `test-fixtures/geo-vectors.json` pin parity).
- **Relocating a watched RTDB path requires sweeping EVERY reader.** F6c moved
  `pushTokens` off the `userPrefs` watch; the plan named only the notifier as
  reader, but review found TWO more (`functions/telegram.js` `/notifications`
  gate, `js/notifyChannel.ts` `accountHasPushTokens` pill) that read the old
  path. All three now dual-read (new-then-legacy) during the migration window; a
  later cleanup commit drops the fallbacks together. When you move a node, grep
  the WHOLE tree (`js/` AND `functions/`) for the old path before trusting the
  plan's readers list.
- **One trigger `onMemberWritten` now owns the whole `groups/{gid}/members/{uid}`
  node** (`functions/index.js`): deletion → cell revocation, `statusOverride`
  change → co-member notify, gated by `statusOverrideChanged` (`notifier.js`,
  compares `enabled`/`status`/`statusColor`/`availableUntil`). Any NEW
  `statusOverride` field that affects availability must be added to that compare
  or a change to it silently skips the notify path. Don't re-add a separate
  leaf-path trigger — that's the F7 double-invocation this merge removed.
- **Mid-file `require` ≠ top-level instance after `jest.resetModules()`.** Known
  in `tests/following.test.js`; ALSO bites `tests/me.test.js` (a later describe
  resets modules — bind mocks at top level, not inside test bodies).
- **`jest.clearAllMocks()` doesn't clear `mockResolvedValue` implementations.**
- **This repo's Jest uses `--testPathPatterns` (PLURAL)** — the singular
  `--testPathPattern` is rejected. And `jest.isolateModules()` does NOT reset
  Jest's file-content cache keyed by absolute path, so a test that stamps a
  template into a temp file and `require()`s it must use a **unique** temp
  filename per call or it silently replays the prior stamp.
- **Splash gating has two modes** (`js/app.ts`): warm boots gate on the LOCAL
  followee count; any boot that calls `rearmSplash()` gates on SERVER truth.
  Don't re-introduce local-cache reads into the cold path.
- **Direct header setters are optimistic + idempotent** (`js/me.ts`): paint
  first, background write, echo absorbed by DOM-keyed guards. Don't re-add an
  `await` before paint.
- **`js/features.js`, the `about-*.js` trio stay `.js`** — read as source text /
  served raw. Decided; do not convert.
- **`sw.template.js` is loaded raw by `tests/sw.test.js`** — placeholders must
  stay filter-safe unsubstituted.
- **CSP pins inline-script hashes** in `firebase.json`. Do NOT add or modify
  inline `<script>` blocks in the HTML templates. Inline SVG is fine.
- **Hosting serves the repo root** (`"public": "."`). `dist/`, `index.html`,
  `sw.js` are gitignored build artifacts — never commit them; edit
  `index.template.html`.
- **`sw.js` must stay `Cache-Control: no-store` and registered with
  `updateViaCache: 'none'`** (both pinned by tests) — iOS WebKit
  device-observed (2026-07-21) answering the SW update check from stale
  revalidation state for days under plain `no-cache`. And never cache-bust
  the registration URL: a script-URL change forces install+reload even for
  byte-identical workers. Full write-up: `docs/pwa-auto-update.md` piece 4.
- **Prod build needs `.env.production`** or preconnect + Firebase config
  silently no-op.
- **Run typechecks from the repo root.**

---

## History — skip unless relevant

Everything below shipped. Detail is in git + plans + the archived handoff.

- **This session (2026-08-01) — two ops-panel follow-ups, TDD
  (`4dea508`, `16e5ae9` on `claude/knockknock-ui-improvements-7bm5o9`).**
  Operator ruled both onto this branch rather than cutting new ones.
  (1) `crossRefRenderers` gained `locations/{u}`, `locationCells/{gid}/{u}`
  and the unjoined-invite `pendingInvitesByGroup/{gid}/{u}` entries; the local
  copies in `merge.js`/`purge.js` are gone; the owned-group orphan case is a
  wholesale `locationCells/{gid}` null in the owned-group block. Changes live
  expunge + graduation behaviour; new coverage in its own file so
  `telegram-auth.test.js` keeps its 0-line diff. (2) The Telegram mapping
  write-block became genuinely shared: the documented plan (`performLink`
  importing `ops/link-write.js`) was found UNDEPLOYABLE — `functions.ignore`
  excludes `ops/**`, so it would have shipped a function that dies at cold
  start with all tests green — so the builder moved to
  `functions/telegram-link-write.js`, gained an optional pre-read `prior`, and
  `performLink` now calls it, keeping only its expunge branch. The old parity
  tests became tautological (they compared the builder with itself) and were
  rewritten against literal oracles. New per-file guard pins the deploy
  surface; its first version passed against a planted violation (a `/*` inside
  the prose `` `ops/**` `` opened a phantom block comment) and was rewritten
  and re-verified by planting the violation again.
- **This session (2026-08-01) — ops-panel design + plan, docs only
  (`39b4980`, `27719fd` on `claude/knockknock-ui-improvements-7bm5o9`).**
  Brainstormed to an approved spec, then a TDD plan. No code written; gates
  re-verified green at the branch tip. Decisions recorded in the spec: local
  Node CLI under `functions/ops/` bound to `127.0.0.1` (the RTDB rules are
  owner-scoped, so no browser client can enumerate accounts — the panel goes
  through the Admin SDK); `.js` + JSDoc, not `.ts`, since nothing compiles it
  and `tsconfig` already strict-checks `functions/**/*.js`; purge reuses the
  shipped `expungeDerivedAccount` while merge is the one new primitive
  (`graduateAccountData` refuses a live target); "link via merge" does what
  production cannot — link a Telegram-derived account to a phrase account
  with nothing lost. Found and confirmed the hosting-serves-functions
  exposure (now a landmine, fixed by plan Task 1). Deferred deliberately:
  D5's Auth-record deletion, until `admin.auth().deleteUser` behaviour on a
  custom-token uid is verified on dev.
- **This session (2026-07-31) — release content + Direct status-color fix.** New README/about distance+Telegram content (`76454d6`). Removed the Direct available-text `palette.color` override so the label follows `statusColor` (`361e65c`, TDD, device-verified). Maintainer merged `dev` → `main`; `v2.0.0` tagged on GitHub at `ca1d1fa` (release notes cover v1.3.0→v2.0.0). The status-color fix is post-tag on `main` — no new tag (operator call).
- **This session (2026-07-22c) — Telegram beacon nudge + /locoff, TDD, on
  `claude/knockknock-polish-pass-8kb77v`:** operator-spec'd over three
  design rounds (feasibility → response-case enumeration → operator-authored
  copy). `formatAgeFuzzy` in `shared/timeFormat.js` (fixture gained an `age`
  column + day-scale rows; floors on purpose — an age nudge must understate).
  `functions/telegram.js`: beacon suffix helpers (opt-in ON + node with
  numeric `updatedAt`, read from the same `userPrefs/{uid}/location` branch
  the app's glyph sync writes) wired into the global `/status` confirm, the
  `/start` returning-available line, and `setGroupPresence` via an optional
  `suffixFor` hook (confirm + globalOn only — globalOff means the cell isn't
  peer-visible; `/off` passes nothing). `/locoff [group]`: opt-in flip + node
  delete in one atomic `rootUpdate`; group flavor rides `resolveGroupArg`
  (B#3 retry idiom). Copy ruled: "/off … to go unavailable." everywhere the
  confirms said "to stop." Client (`js/locationShare.ts`): the prefs-echo
  handler now unmarks published contexts whose opt-in dropped — without it
  the surfaces held/re-opened subs against the bot-deleted node (also a
  latent sibling-device glyph-off bug). NOTE: first functions-touching
  change since the audit-2 batch (deploy note in What's next).
  `00c88dd..4ac099c` on `claude/knockknock-polish-pass-8kb77v` (cut from
  `9a3ysy` at `837ee8a`), all TDD:**
  - `00c88dd` **fix(geo):** `formatDistancePrecise` meters/km watershed moved
    from 1000 to 999.5 — 999.6–999.99 m rendered the never-valid "1000 meters
    away". Fixture vectors pin both sides in web + functions suites
    (`npm run sync-shared` applied).
  - `880c54d` **fix(location-ui):** (1) sticky denied glyph — locationShare
    exports `isPermissionDenied()` (set on code-1 prove reject + revocation
    teardown; cleared on delivered fix / successful prove / reset); both
    surfaces' repaint paths (prefs-synced, opt-in-changed, band render)
    consult it via per-surface state helpers (`directGlyphState` in me.ts,
    `groupGlyphState` in groupContext.ts — deliberately duplicated:
    groupContext's tests mock me.js wholesale, importing would make the group
    coverage vacuous). Previously the teardown's own opt-in-changed dispatch
    washed the denied paint back to off. (2) `paintLocationGlyph` gained an
    'unsupported' state — same `.denied` visual, own title ("Location
    unavailable — not supported on this device"); tap handlers pass
    `toggleContext`'s result straight through. (3) `_watchGeneration` guard:
    a code-1 watch error delivered synchronously (allowed by the
    getPositionOnce contract) ran the teardown before `startGeoWatch`'s id
    assignment, resurrecting a dead watch — the next glyph prove parked
    forever. Surfaced by the sticky-denied test's denied→re-prove leg.
  - `4ac099c` **chore(location):** `[LOCDBG]` instrumentation stripped (the
    release gate) — helper, ring buffer, all call sites; capture citations
    normalized to "device trace 2026-07-21". Stale cell-publish catch comment
    updated (error shape WAS emulator-verified 2026-07-20).
  canvas 0×0 fix, 4 commits `7364a80..86504e6` on `9a3ysy`, all pushed:**
  Bug report: distance froze at last-known after backgrounding the PWA;
  reload didn't recover, glyph off/on did. Method: `[LOCDBG]` extended with a
  localStorage ring buffer (`7364a80`) so untethered reproductions survive
  the Web Inspector detaching; two device captures then isolated THREE
  stacked causes, each fixed TDD:
  - `7a37887` **permission-gate reload freeze:** iOS WebKit answers a FRESH
    `permissions.query` with `'prompt'` after every reload until the session
    uses geolocation — every tick skipped at the gate until a glyph toggle.
    Fix: device-local proof marker `statusapp_geo_grant_proven` (set on any
    delivered watch fix, cleared on real code-1 revocation; device-scoped in
    `cacheOwner`) lets the gate pass a lying `'prompt'`; never-proven devices
    (cross-device-synced opt-in, spec §5) keep the no-surprise-prompt gate.
  - `8e3f17e` **suspension-killed watch (the tram freeze proper):** iOS kills
    the `watchPosition` stream on suspend with NO error callback — dead
    `_watchId` looked live, `getPositionOnce` served the frozen `_lastFix` at
    any age, ticks republished/suppressed the same point for 10+ min
    (buffer-trace-observed). Fix: ticks refuse a fix older than one tick
    interval (restart the watch, stay parked for a real fix);
    visibility→visible rebuilds the watch before the catch-up tick; a cached
    PermissionStatus is only trusted when it says granted (WebKit flips
    retained objects spuriously around resume). Plus resume double-fire
    dedupe: one watch restart (10s window), one tick in flight (age-bounded
    so a wedged tick can't silence the loop). Recovery device-verified:
    fresh moved fix + publish within ~30ms of resume.
  - `86504e6` **canvas first-entry 0×0** (regression from audit-2 N10,
    `cea4593`): `enterCanvas` sized the canvas synchronously after injecting
    the on-demand canvas.css — the inline `display:none` boot guard was
    still in force, so first entry per page load got a 0×0 backing store
    (invisible strokes, transparent overlay); re-entry worked, which made it
    look intermittent. Fix: `ensureCanvasCss` resolves when the sheet has
    APPLIED (guard's display flips; 3s cap degrades to old behavior), entry
    awaits it before measuring.
- **This session (2026-07-21b) — 3 fixes on `9a3ysy` atop the audit-2 batch,
  systematic-debugging + TDD, all pushed:**
  - `1633be5` **fix(redeem):** the inbox Join Direct-flash guard (`a9223c2`)
    only covered the in-app flow; the "Redeem an invite" form's group-join
    (`handleRedeemInvite` in `js/following.ts`) reached `navigateToGroup` by the
    other door with no guard. Wrapped its brokered redeem in
    `beginGroupEntryTransition`/`endGroupEntryTransition`. +3 tests.
  - **location-glyph no-op/stuck-OFF (macOS/iOS PWA):** two dead ends first —
    `81e5664` primed the tick permission-gate cache from the live prove (wrong
    layer; **reverted** in `85f8031`, which also added the dormant `[LOCDBG]`
    trace). Device trace then showed the real cause: **`getCurrentPosition`
    hangs on repeated WebKit calls → code-3 timeout** (frozen distance +
    stuck-OFF). `5b40a1d` **fix(location):** browser path now streams from ONE
    `watchPosition` into a `_lastFix` cache; `getPositionOnce` serves it (same
    contract), never a per-read cold call. Accuracy-tiered (high for Direct,
    coarse for cells); code-1 → teardown, code-2/3 keep last-known. Telegram
    path untouched. **Device-verified.** `locationShare.test.js` reworked to a
    `watchPosition` mock (`fireWatch`/`fireWatchError`); +2 regression guards.
    `[LOCDBG]` still in for continued debugging — strip before dev merge.
- **Audit-2 perf-fix batch executed (2026-07-21, `0ce40fa..cea4593` + cleanup
  `75eeade`, built on `claude/session-yjbet1`, fast-forward-merged to
  `claude/knockknock-feature-dev-9a3ysy`, both pushed):** the 10-task
  `2026-07-21-performance-fixes-audit2.md` plan via subagent-driven
  development — fresh implementer per task, per-task spec+quality review,
  final whole-branch opus review ("ready to merge", zero Critical/Important).
  N1 canvas lazy-split restored (dropped stray static import → chunk emits) ·
  N2 stale-membership 10-min probe window so the sweep fires for a kicked
  *stationary* user (`STALE_MEMBERSHIP_PROBE_MS`; `_lastPublished` gained
  `landedAt`) · N4 `statusOverrideChanged`→`availabilityRelevantOverrideChange`
  (appearance-only override edits skip the notify gate + its presence read) ·
  N7 availability sender's `presence/code` resolved once, threaded through the
  group fan-out · N8 countdown-label visibilitychange catch-up (+ a me.test
  mock-fidelity fix: restored the `< 1m` branch) · N3 `classifyMembersTick`
  appearance-only roster fast path (client analogue of N4; fails safe to
  'full') · N5a lazy-load groupContext (largest client module) via serialized
  `withGroupContext` · N5b lazy-load the four Telegram-webview-only flow
  modules (`tgFirstRun` threaded through `BootSession`) · N9 per-stroke canvas
  derivations (per-segment ctx assignments preserved) · N10 on-demand
  canvas.css (JS-injected `<link>` + inline `<style>` flow guard, CSP-safe —
  no `onload`). Three review loops caught real issues: N8's mock was silently
  vacuous (flat `'2h'`) → made value-sensitive; N5a left a required favorites
  test-flush uncommitted (red-in-isolation) → folded into the commit; N5b's
  brief mis-assumed one function scope → adapted via `BootSession` threading.
  Cross-task parity verified (server N4 ↔ client N3 gate agree on
  appearance-vs-availability fields; N5a+N5b compose cleanly on `js/app.ts`).
  Gates green at `75eeade` (web 2056 · functions 436 · typechecks clean · build
  emits all lazy chunks · zero new suppressions). N6 (SW precache-all) stayed
  PARKED as a product call — the only audit-2 finding without a plan task.
  DEPLOY pending (client + functions only, no ordering constraints; see Deploy
  ordering).
- **Audit #2 + planning session (2026-07-21, docs-only `8d3d354..8d58960`):**
  second performance audit over the branch (4 parallel read-only agents +
  session-side verification of every claim; prior 26 fixes independently
  re-verified intact, zero regressions). 10 new findings (N1–N10), all
  source-verified with corrections recorded inline (N2 exposure narrowed to
  mid-session kicks; N5's telegramOnramp is web-facing, not webview-only;
  N10's deferral hazard is layout shift, not a flash; N6 exclusion is free
  on repeats thanks to the immutable headers). Operator ruled: plan
  N1–N5+N7–N10 (the 10-task plan above), park N6 as a product decision.
  Notable verified-clean: trigger topology has zero overlaps and the
  high-frequency client writes (location publishes, palette echoes,
  presence leaves) fire no functions; CSS runtime animations all
  state-gated; SDK imports fully modular. N4 broadcast question answered
  in-source: color reaches peers via RTDB listener fan-out, never via the
  notifier (push payloads are title/body only) — the narrowed gate removes
  a read that always preceded a no-op.
- **Post-smoke fix session (2026-07-21, `8d83e3a..a9223c2`):** four
  operator-reported issues root-caused and fixed test-first. (1) `8d83e3a` —
  group roster lost a mutual's coarse distance the moment the viewer enabled
  Direct: precise-tier eligibility (mutual + primary-available) excluded the
  cell sub on mere *eligibility*, but a mutual with Direct off publishes no
  raw point, so precise emitted null forever with no fallback; the exclusion
  is now data-driven (only a DELIVERED precise number displaces the cell sub;
  the precise callback re-runs the reconcile on number↔null transitions) —
  Task 2's one-listen-per-mutual contract revised accordingly. (2) `eeef878`
  — #156 panel gained `SW reg` (registration lifecycle) and `sw.js served`
  (no-store probe: served cache-version + status + MIME, warns when it
  differs from the controlling worker's). (3) `5d8b3b8` — iOS PWA never saw
  deployed sw.js updates: cornered via cabled Web Inspector (healthy
  registration, device on old cache version, server serving new,
  `update()` resolving with no updatefound; a fresh-URL registration
  unstuck it); local Chromium+emulator repro had already proven the whole
  four-piece update cycle sound, exonerating the code pattern and Task 7's
  headers (live-channel curls confirmed `no-cache`+etag correct). Fix:
  `/sw.js` served `no-store` + `updateViaCache:'none'` at register, doc
  updated. (4) `a9223c2` — inbox Join flashed Direct + the new group's
  backend code in the nav row during the now-slow brokered joinGroup
  callable (Fix 2b widened an always-present race window); exported
  begin/endGroupEntryTransition guard (the create-group modal's suspend
  dance, reusable), name seeded via setLastKnownGroupName.
- **Verification pass + on-device smoke + iOS glyph fix (2026-07-20,
  `45d7bec`):** all 26 tasks of the three perf plans verified against source
  by three parallel read-only agents with coordinator spot-checks — 26/26
  faithful, all documented deviations confirmed, no undocumented drift.
  Operator ran the on-device smoke checklist: most verified; deploy-gated and
  a few hard-to-stage items deferred. One regression found and fixed:
  iOS PWA glyph-on published nothing because T8's PermissionStatus cache
  froze a pre-grant `'prompt'` object (WebKit never updates a retained
  status; fresh query returned `'granted'` — device-probed). `45d7bec`
  caches only granted statuses; red-green regression test in
  `tests/locationShare.test.js` ("a 'prompt' status is never cached").
- **Tier 3 performance fixes (2026-07-20, `d4be799..eca3c0e`, built on
  `claude/knockknock-perf-fixes-tier3-2j9hj9`, fast-forward-merged to
  `claude/knockknock-feature-dev-9a3ysy`, both pushed):** executed
  `2026-07-20-performance-fixes-tier3.md` (14 low-severity tasks) via
  subagent-driven development — fresh implementer per task, per-task spec+quality
  review, final whole-branch review ("ready"). T1 roster repaint-only-the-ticking-
  row (two-signal flip check deliberately keeps T2's distance-reconcile alive) ·
  T2 one distance sub per mutual (cell closes while precise is live) · T3 sweep
  stale gid opt-ins on a denied cell write (fixes the old "denied write every 60s"
  minor; error shape emulator-verified) · T4 knock buffer/drain on
  drawer-close/canvas-exit instead of full re-init, + cross-context stash fix ·
  T5 fire-and-forget lastVisited + hoisted prefs read · T6 hidden-tab timer guards
  (label/countdown/peek) · T7 raw-string parse memos (favorites/notify/location) ·
  T8 cached geolocation PermissionStatus · T9 O(1) row-lookup maps (isConnected
  fail-safe) · T10 in-place canvas preview append + malformed-base clamp · T11
  removed leaked capture-phase pointerdown listener · T12 single
  `watchUserGroups` listen (removal detector rides groupNav's enumeration) · T13
  inbox null-cache + `/start` no-op skip + `lastSeen` throttle · T14 ownStatus →
  presenceHub. Two per-task reviews caught real Important issues (T4 dropped
  cross-context held knocks; T10 threw RangeError on a malformed peer `base`) —
  both fixed + re-reviewed. Cleanup (`eca3c0e`): knock →visible double-present
  dedup, extracted `stashCrossContextKnock`, fixed a stale roster comment. Gates
  green at `eca3c0e` (web 2037 · functions 432 · rules 108 · typechecks clean ·
  0 suppressions). DEPLOY pending (client-only; see Deploy ordering).
- **Pre-existing performance fixes (2026-07-20, `611daf3..9f434d0`, pushed
  fast-forward onto `claude/knockknock-feature-dev-9a3ysy`):** executed
  `2026-07-20-performance-fixes-preexisting.md` (F3/F6/F8) via
  subagent-driven-development — fresh implementer per task, per-task spec+quality
  review, final whole-branch review (opus, "ready to merge"). F3 `watchGroupMeta`
  → two leaf listens (`name`+`ownerId`; the membership-gated ownerId-cancel is
  the delete/kick "gone" signal, name leaf just delivers renames) · F6a boot
  reads the `currentContext` leaf not the whole prefs node · F6c `pushTokens` →
  top-level owner-only node + dual-read + one-shot migration
  (`functions/migrate-push-tokens.js`) · F6b favorites/notify sync events
  diff-gated · F8 directed notifier handlers → parallel read phases (send
  decisions unchanged; accepted broadened-reject trade on gated exits — triggers
  are `retry:false`). The Task 3 review caught a second AND third un-migrated
  reader of the relocated node (fix `6532e38`); a final cleanup (`9f434d0`)
  addressed doc/test minors and added the DEPLOY-PROD.md pushTokens runbook.
  DEPLOY still pending (see Deploy ordering above). Tier 3 shipped atop this
  (see the top of History).
- **Branch-introduced performance fixes (2026-07-20, `5463888..d73deb3` + hardening
  `135a166`, merged into `claude/knockknock-feature-dev-9a3ysy` fast-forward):**
  executed `2026-07-20-performance-fixes.md` (F1/F2/F4/F5/F7/F10/F9) via
  subagent-driven development — fresh implementer per task, per-task spec+quality
  review, final whole-branch review (opus, "ready to merge"). T1 no-op publish
  suppression · T2 tiered/coarse GPS · T3 distance-emission dedupe · T4
  prefs-echo diff + probe skip · T5 merged `onMemberOverride`+`onMemberRemoved`
  → `onMemberWritten` (gated by new `statusOverrideChanged`; +additive
  `statusColor` on `PresenceNode`) · T6 `/who` own-followers/group-cell prefetch ·
  T7 immutable `dist/chunks/**` header + SW cross-deploy chunk carry-over. T1's
  suppression outdated 8 pre-existing tests: the 1 the plan named was inverted;
  the other 7 were LIVENESS proxies (loop-alive / tier-fires / manager-works /
  hidden-ticks) — resolved by MOVING the fixture position so a real publish still
  proves liveness, never by weakening the assertion. Operator-added the `status`
  field to `statusOverrideChanged` (`135a166`) as defense-in-depth (unreachable
  with today's writers). DEPLOY still pending (nothing deploys from sessions): T5
  deletes two functions; T7 needs a post-deploy `curl -I /dist/chunks/<hash>.js`
  → `immutable` while `/dist/bundle.js` stays `no-cache` (commit bodies carry the
  notes). `2026-07-20-performance-fixes-tier3.md` shipped (top of History).
- **Performance audit (2026-07-20, this branch, docs-only,
  `32b280d`+`8cc04f2`):** four-domain parallel audit vs main (location client,
  boot/render, functions, data model + load); Tier 1&2 findings source-verified
  (one agent correction: /who reads are parallel, N+1 in read count only);
  findings spec + three fix plans under `docs/superpowers/`. Security-fix
  execution details (the two reviewed plan deviations: Fix 1's load-bearing
  `.validate` gate vs inert `.write` narrowing; joinGroup transacting the full
  invite object) live in the spec/plan named below and the commit bodies.
- **Security-fix execution + hardening (2026-07-20, this branch,
  `b995fb7..7488947`):** executed the 5-task plan via subagent-driven
  development (fresh implementer per task, per-task spec+quality review, final
  whole-branch review — verdict "ready to merge"): Fix 1 `.validate` forgery
  gate (`129a4dc`) · Fix 3 `onMemberRemoved` cell revocation (`b084d7f`) ·
  Fix 2 callable + client rewire + member-rule tighten
  (`79a079b`/`4df0774`/`b0c0d86`+`05d7fe6`). Then operator-ordered: ownerId
  takeover guard (`757acf3`), owner-only `redemptionsUsed` (`8790dde`), polish
  (`34899ac`), dead-helper cleanup (`934712b`), and the `origin/dev` merge
  (`7488947` — call-escape fix + `sweepStaleCalls`; one import conflict in
  `functions/index.js`, both sides kept). Expected test fallout (pre-existing
  tests asserting now-outlawed behavior) was inverted, never weakened —
  rationale in the commit bodies.
- **Location security review (2026-07-19, this branch, docs-only):**
  `/security-review` + `vibesec-skill` over the feature diff → findings → spec
  → plan (the two docs under `docs/superpowers/`).
- **Location device-smoke debugging cycle (2026-07-19, `7386957..93bea22`,
  operator-verified):** glyph/pin UI, last-known persistence model,
  per-context eligibility, group/Direct independence, Telegram init-once fix,
  distance rendering.
- **Location-sharing implementation (2026-07-19, `c2f6a2e..7386957`)** — 13
  plan tasks, subagent-driven, per-task + whole-branch reviews.
- **Boot/status polish batch (2026-07-17, PR #296)** · **UI-fix batch
  (2026-07-17, PR #294)** · **TypeScript adoption (phase-0)** ·
  **Client-performance plan (2026-07-17)** —
  `docs/superpowers/plans/2026-07-17-client-performance.md`.
