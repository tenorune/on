# KnockKnock — Session Handoff

> Forward-first. History lives in git, `docs/superpowers/plans/`, and `docs/archive/`.
> Prior handoffs (TS adoption + client-performance era) are archived at
> `docs/archive/HANDOFF-2026-07-17.md` — read only if you need that backstory.

## What this is

KnockKnock — a vanilla-TypeScript + Firebase (Hosting / RTDB / Cloud Functions) PWA
for ambient presence. Repo `tenorune/on`, working dir `/home/user/on`.

## What's next

**The Tier 3 performance-fix batch is DONE and merged to this feature branch.**
All 14 tasks of `docs/superpowers/plans/2026-07-20-performance-fixes-tier3.md`
plus a review-minor cleanup shipped via subagent-driven-development (fresh
implementer per task, per-task spec+quality review, final whole-branch review —
verdict "ready"; see History for the per-task list). Tip is `eca3c0e` on BOTH
`claude/knockknock-perf-fixes-tier3-2j9hj9` (where it was built) and
`claude/knockknock-feature-dev-9a3ysy` (fast-forward merge, operator-directed).
Both pushed; `origin/*` == local. Realign:

```
git fetch origin
git checkout -B claude/knockknock-feature-dev-9a3ysy origin/claude/knockknock-feature-dev-9a3ysy
```

Tip must be `eca3c0e` — else STOP, origin is authoritative.

**Next actions (nothing deploys from sessions):**

1. Maintainer merges `claude/knockknock-feature-dev-9a3ysy` → `dev` (and
   `dev` → `main`).
2. DEPLOY the accumulated branch work (security fixes + all three perf batches)
   per the Deploy ordering below — the LOAD-BEARING `pushTokens` (F6c) sequence
   is the one that bites.
3. No unstarted plan remains on this branch. Next feature work starts from a
   fresh brainstorm/plan.

**Verification state:** green bar OBSERVED at `eca3c0e` (web jest 2037/2037 ·
functions 432/432 · rules 108/108 · typechecks clean · zero TS suppressions).

**Audit docs (sources of truth):**

- Findings: `docs/superpowers/specs/2026-07-20-performance-audit-findings.md`
  (Tier 1&2 source-verified; Tier 3 agent-reported). ALL Tier 1&2 findings
  (F1–F10) are now DONE (see History); Tier 3 is the plan above.

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

- **#288** — root-caused and fixed on this branch (self-join blocked, joins
  brokered); close the issue once this branch merges and deploys.
- One open product decision (unruled, not part of any plan): revoking OS
  location permission on ONE device flips the ACCOUNT-WIDE opt-in off —
  deliberate fail-safe, debatable.
- Known-deferred minors (unrelated to security, none device-visible): denied
  glyph state isn't sticky · 'unsupported' title says "check permissions" ·
  `formatDistancePrecise` 999.6–999.99 m renders "1000 meters away" ·
  cross-device prompt-suppression relies on the Permissions API. (The old
  "stale opted-in gids → harmless denied write every 60s" minor is FIXED by
  Tier 3 T3 — the loop now sweeps the orphaned opt-in and can idle.)
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
- **Prod build needs `.env.production`** or preconnect + Firebase config
  silently no-op.
- **Run typechecks from the repo root.**

---

## History — skip unless relevant

Everything below shipped. Detail is in git + plans + the archived handoff.

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
