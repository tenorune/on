# KnockKnock — Session Handoff

> Forward-first. History lives in git, `docs/superpowers/plans/`, and `docs/archive/`.
> Prior handoffs (TS adoption + client-performance era) are archived at
> `docs/archive/HANDOFF-2026-07-17.md` — read only if you need that backstory.

## What this is

KnockKnock — a vanilla-TypeScript + Firebase (Hosting / RTDB / Cloud Functions) PWA
for ambient presence. Repo `tenorune/on`, working dir `/home/user/on`.

## What's next

**Maintainer merge + deploy — the audit-2 perf-fix batch is DONE, tested,
and pushed.** All ten tasks of
`docs/superpowers/plans/2026-07-21-performance-fixes-audit2.md` (findings
N1–N5 + N7–N10) shipped 2026-07-21 via subagent-driven development —
implementer + spec/quality review per task, whole-branch opus review at the
end ("ready to merge", zero Critical/Important). Detail in History below and
in the commit bodies `0ce40fa..cea4593` (+ cleanup `75eeade`).

Tip is `75eeade` on `claude/knockknock-feature-dev-9a3ysy`, pushed; `origin`
== local. The identical batch is also on `claude/session-yjbet1` (the
session branch it was built on) at `75eeade` — both remotes equal. Code tip
is now `cea4593` (the batch's last code commit); `75eeade` is the test/comment
cleanup atop it. Realign a fresh session:

```
git fetch origin
git checkout -B claude/knockknock-feature-dev-9a3ysy origin/claude/knockknock-feature-dev-9a3ysy
```

`git log --oneline -1` must show `75eeade` (chore cleanup) — else STOP,
origin is authoritative.

**Next actions (nothing deploys from sessions):**

1. Maintainer merges `claude/knockknock-feature-dev-9a3ysy` → `dev` (and
   `dev` → `main`). The audit-2 batch is now part of the accumulated branch
   work.
2. DEPLOY the accumulated branch work (security fixes + all three prior perf
   batches + the four 2026-07-21 fixes + this audit-2 batch) per the Deploy
   ordering below — the LOAD-BEARING `pushTokens` (F6c) sequence is the one
   that bites. The audit-2 batch adds NO ordering constraints (client +
   functions only — no rules, no schema), so it rides the same deploy train.
3. Post-deploy: run the deferred smoke items (`docs/DEPLOY-PROD.md` verify
   steps), plus the prior-session device checks: iOS PWA glyph-on publishes
   within a tick when a prior session's opt-in was already on (the `45d7bec`
   scenario) · the group roster keeps a mutual's coarse distance after the
   viewer enables Direct (the `8d83e3a` scenario) · inbox Join shows
   prompt → dark → group with no Direct/nav-code flash (`a9223c2`) · the
   #156 panel's `SW reg` / `sw.js served` rows. PLUS the audit-2
   device-smoke notes (from the plan's per-task footers): boot-into-group +
   rapid Direct↔group flip now fetch the groupContext chunk (N5a) · Telegram
   Mini App chrome/first-run/deep-link/link-screen still work as lazy chunks
   (N5b) · first-ever cold-cache draw-session entry shows no flash/layout
   shift as canvas.css loads on demand (N10).
4. **iOS auto-update needs a TWO-deploy verification** (`5d8b3b8`): deploy 1
   ships the fix but devices still fetch it via the old, stale-prone check
   (a stuck device may need one manual `reg.update()` nudge via Web
   Inspector); only deploy 2 — the next shell change after that — tests the
   claim, by landing on the iOS PWA organically (relaunch, no inspector).

**Verification state:** green bar OBSERVED at `75eeade` (the current tip on
both feature branches) — web jest 2056/2056 · functions 432→436/436 · both
typechecks (`typecheck` + `typecheck:scripts`) clean · production build
emits lazy chunks for canvas + groupContext + the four Telegram flow modules
(`enterGroupContext` absent from `dist/bundle.js`). Zero NEW TS suppressions
in the batch (one PRE-EXISTING `as any` at `js/telegram.ts:17`, untouched).
Rules suite (108) not re-run — the batch touched no rules. All suites run in
this container with deps installed (Environment below).

**Audit docs (sources of truth):**

- **Audit 2 (SHIPPED — all ten fixes landed, see History):** findings
  `docs/superpowers/specs/2026-07-21-performance-audit-2-findings.md` (all
  ten source-verified, corrections inline; N2 severity correction applied by
  the fix) · plan
  `docs/superpowers/plans/2026-07-21-performance-fixes-audit2.md` (10 tasks,
  complete code per step). N6 remains parked (Open items).
- Audit 1 (all 26 findings FIXED, see History):
  `docs/superpowers/specs/2026-07-20-performance-audit-findings.md`.

**Deploy ordering (recorded in commit bodies + `docs/DEPLOY-PROD.md`; nothing
deploys from sessions):**

- **`pushTokens` relocation (F6c) — LOAD-BEARING:** rules → functions →
  hosting → `node functions/migrate-push-tokens.js --apply` → later a **separate
  cleanup commit** drops the legacy fallback in all three dual-readers
  (`sendToUser`, `functions/telegram.js`, `js/notifyChannel.ts`). Full runbook:
  `docs/DEPLOY-PROD.md` → "Addendum — pushTokens relocation (audit F6c)".
- **Security fixes:** Fix 1 rules-only · Fix 3 functions-only · the `joinGroup`
  callable must deploy **before or with** the members `.write` tighten and the
  `redemptionsUsed` owner-only rule (old cached clients get permission-denied on
  direct member writes until reload — intended trade-off).
- **Branch perf fixes:** T5 deletes two functions
  (`onMemberOverride`/`onMemberRemoved` → `onMemberWritten`); T7 needs a
  post-deploy `curl -I /dist/chunks/<hash>.js` → `immutable` while
  `/dist/bundle.js` stays `no-cache`.
- **Tier 3 perf batch:** client-only (render/timer/cache/listener hygiene); the
  one functions touch is a no-op `/start` route-write skip
  (`functions/telegram.js`, T13b) — ships with the normal functions deploy, no
  ordering dependency. **T3's stale-gid sweep** keys off the RTDB rules-denied
  `set()` rejection shape — VERIFIED against the database emulator with the real
  SDK (2026-07-20): `err.code === "PERMISSION_DENIED"`, `err.message ===
  "PERMISSION_DENIED: Permission denied"`, and T3's `/permission.denied/i` guard
  (on `code ?? message`) matches. No longer an unverified caveat. (Recipe if you
  need to re-check: temp probe under `tests/rules/` mirroring
  `locations.test.js`'s "non-member cannot write a cell" denial, dump `err` to a
  file, `npm run test:rules`, delete the probe.)

**Open items (parked, operator-ruled only):**

- **Audit-2 N6 — SW precaches ALL chunks on first install** (incl. the ~78 KB
  wordlist; canvas joins after Task 1). Verified: exclusion costs nothing on
  repeat loads (immutable chunk headers → browser HTTP cache), so the trade
  is purely first-install bytes vs OFFLINE availability of a flow before its
  first use (e.g. offline phrase-restore on a fresh install). Product call —
  the only audit-2 finding without a plan task.

- **Self-heal for auto-update-stuck devices** (option B from the 2026-07-21
  iOS investigation, parked): devices running a pre-`5d8b3b8` build carry the
  stale SW-update-check exposure until they take one update; if stuck prod
  users surface post-rollout, a page-side probe (no-store fetch of `/sw.js`,
  compare vs `caches.keys()`, escalate) is designable — needs care around
  reload loops.
- **`?notifydebug=1` cannot reach the installed iOS PWA** (no URL bar;
  Safari-tab localStorage is partitioned from the PWA's). Chosen path for
  iOS diagnosis: macOS Safari → Develop → cabled device Web Inspector. A
  prefs-synced opt-in (enable from any device, syncs via userPrefs) was
  considered and not built.

- **#288** — root-caused and fixed on this branch (self-join blocked, joins
  brokered); close the issue once this branch merges and deploys.
- One open product decision (unruled, not part of any plan): revoking OS
  location permission on ONE device flips the ACCOUNT-WIDE opt-in off —
  deliberate fail-safe, debatable.
- Known-deferred minors (unrelated to security, none device-visible): denied
  glyph state isn't sticky · 'unsupported' title says "check permissions" ·
  `formatDistancePrecise` 999.6–999.99 m renders "1000 meters away" ·
  cross-device prompt-suppression relies on the Permissions API (a fresh
  session whose opt-in synced from elsewhere stays silent while the state is
  genuinely `'prompt'` — designed, no surprise prompts) · stale comment at the
  cell-publish catch in `js/locationShare.ts` (~:294) still says "Error shape
  not device-verified" though the shape was emulator-verified — one-line doc
  fix whenever convenient. (The old "stale opted-in gids → harmless denied
  write every 60s" minor is FIXED by Tier 3 T3 — the loop now sweeps the
  orphaned opt-in and can idle.)
- Follow-ups triaged 2026-07-17: **#290** in-app-browser dead tap · **#286** no
  invite revoke on Telegram surface · closed-unreproduced "revoked follow
  request still in inbox" (reopen only with a repro).

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
- Zero TS suppressions (`@ts-ignore` / `@ts-expect-error` / `as any`). `typecheck`
  + `typecheck:scripts` must stay green.
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
