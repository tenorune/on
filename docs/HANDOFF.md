# KnockKnock — Session Handoff

> Forward-first. History lives in git, `docs/superpowers/plans/`, and `docs/archive/`.
> Prior handoffs (TS adoption + client-performance era) are archived at
> `docs/archive/HANDOFF-2026-07-17.md` — read only if you need that backstory.

## What this is

KnockKnock — a vanilla-TypeScript + Firebase (Hosting / RTDB / Cloud Functions) PWA
for ambient presence. Repo `tenorune/on`, working dir `/home/user/on`.

## What's next

**Device-smoke feedback + debugging for the location-sharing feature.** The
feature is FULLY IMPLEMENTED and review-approved on branch
`claude/knockknock-feature-dev-9a3ysy` (origin tip `7386957`, 27 commits over
base `c2f6a2e`; final whole-branch review verdict: ready to merge, pending the
operator's visual sign-off). Work stays ON this branch. Realign first:

```
git fetch origin
git checkout -B claude/knockknock-feature-dev-9a3ysy origin/claude/knockknock-feature-dev-9a3ysy
git log --oneline -1   # must show 7386957 — anything else = STOP, origin is authoritative
```

The feature in one line: opt-in location sharing, distance on existing cards —
precise for sharing mutuals, coarse ("<1 km" floor via 0.01° grid snap) for
sharing group co-members, nothing for everyone else; the glyph next to
time-remaining (Direct header `#location-glyph`, group band
`#group-location-glyph`) is the only control; publishing tied to availability,
60 s foreground refresh.

**Operator's smoke checklist** (visual "done" is the operator's call): glyph
on/off/denied in both headers · permission prompt on first tap only · distance
on a mutual card within ~1 min of both sides opting in while available · coarse
text in a shared group · distances vanish when either side goes unavailable ·
Telegram Mini App glyph + `/who` lines.

**Verified at `7386957` (this session):** web 1929/1929 (85 suites), functions
388/388, rules 86/86 (emulator), both typechecks, prod build, zero TS
suppressions. Rules suite: `npm run test:rules` (manages the RTDB emulator
itself).

**Feature module map** (for debugging): `shared/geo.js` (+ mirror
`functions/_shared/geo.js`) math/formatters · `database.rules.json`
`locations/`+`locationCells/` blocks · `js/db/location.ts` RTDB ops (cancel
callbacks emit null) · `js/locationHub.ts` multiplexed distance watches ·
`js/locationShare.ts` capture loop + `toggleContext` + publish-keyed eligibility
(`isPublishingAvailable`) · glyphs in `js/me.ts` / `js/groupContext.ts` · card
suffixes in `js/following.ts` / `js/groupContext.ts` (`reconcileDistanceSubs`
passes) · bot fragments in `functions/telegram.js`.

**One open product decision (surface to operator):** revoking OS location
permission on ONE device flips the ACCOUNT-WIDE opt-in off (stops other devices
too). Deliberate but debatable — change to device-scoped if the operator says so.

**Known-deferred minors** (recorded at final review; none affect
correctness/privacy — candidates if smoke feedback matches): denied glyph state
isn't sticky (repaints revert denied→off); 'unsupported' title says "check
permissions" (wrong guidance when no geolocation API); `formatDistancePrecise`
999.6-999.99 m renders "1000 m" not "1.0 km"; stale opted-in gids (kicked
groups) produce a harmless denied write every 60 s (publish path is deliberately
unfiltered — filter publish only, keep clears unfiltered); cross-device
second-context enable race via `location-prefs-synced` (two-client, self-heals
on next availability flap); Telegram `LocationManager` path has no test
coverage; `locationCells` validators lack negative-write tests.

Open follow-ups, triaged 2026-07-17 (parked behind the location feature):

- **#290** — "Continue in browser" dead tap in the Instagram/FB in-app browser
  (`js/about-cta.js` escape schemes silently cancelled). Candidate fixes A/B/C
  are enumerated in the issue.
- **#286** — no revoke/regenerate/rename for invites on the Telegram surface.
  Feature-sized (new drawer affordance).
- **#288** — RTDB rule weakness (self-join any group by gid). Security, not UI;
  the issue says the fix is the maintainer's call.
- **Device smoke pending:** the same-frame Direct status swap (`d2d4aa8` — the
  200ms label crossfade removed at the operator's call) merged to `dev`
  unverified on device. Earlier fixes in the same batch (splash gating on
  restore + invite arrival, optimistic Direct toggle) ARE device-verified.
- **Closed-unreproduced (2026-07-17): "revoked follow request still in inbox."**
  The one surface that provably keeps a stale request visible is the recipient's
  Telegram bot chat (lazy resolve on tap, `functions/telegram.js:749-763`); a
  proactive fix needs message-id storage + an `onValueDeleted` trigger. Reopen
  only with a repro recipe.

## On-ramp

- This file is the source of truth for "where things are."
- `CLAUDE.md` (auto-loaded) holds the binding conventions — read it.
- Per-feature detail: `docs/superpowers/plans/` and the matching git history.

## Environment

Commands (all from repo root unless noted):

| Purpose | Command |
|---|---|
| Web tests | `npx jest` |
| Cloud Functions tests | `cd functions && npm test` |
| Typecheck (strict) | `npm run typecheck && npm run typecheck:scripts` |
| Production build | `node scripts/prod.js` |
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
- Unsigned commits are fine — ignore the "Unverified" stop-hook.
- Never hand off red: run both test suites + typecheck before wrapping.

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

- **Shallow clone → false "unrelated histories."** Fresh containers clone shallow
  (`.git/shallow`). Run `git fetch --unshallow origin` **before** any cross-branch
  merge/compare/ancestry check.
- **Splash gating has two modes** (`js/app.ts`): warm boots gate on the LOCAL
  followee count; any boot that calls `rearmSplash()` (fresh-device restore,
  invite-redemption boots landing in Direct) sets `coldSplashGating` and gates on
  SERVER truth — first following-list tick + per-followee presence + group set
  with names (one-shot callbacks in `following.ts` / `groupNav.ts`). Don't
  re-introduce local-cache reads into the cold path, and don't dismiss the splash
  early in the redemption branch — a fast no-prompt outcome reverses the fade
  mid-transition (device-visible artifact, fixed 2026-07-17).
- **Direct header setters are optimistic + idempotent** (`js/me.ts`): paint first,
  background write, and the RTDB echo is absorbed by DOM-keyed guards
  (`setAvailable` skips on same window via `_countdownUntil`; `setUnavailable`
  skips when dot off + chips faded). Re-adding an `await` before paint or
  removing the guards re-creates the "UI is thinking" double-render.
- **`tests/following.test.js` uses `jest.resetModules()` mid-file** — a
  `require('../js/following.js')` inside a later test body returns a DIFFERENT
  module instance than the top-level destructure. Bind new exports at
  describe-eval time (see the notes inside that file).
- **`js/features.js` stays `.js`** — `scripts/build.js` reads it as *source text*
  (regex for `TELEGRAM_ENABLED`), so it can't be a `.ts`/bundled module.
- **The `about-*.js` trio stays `.js`** — served raw / source-text-read. Decided; do
  not convert.
- **`sw.template.js` is loaded raw by `tests/sw.test.js`.** Its `__CHUNK_LIST__`
  placeholder must stay filter-safe (unsubstituted → `[]`). Same for any new
  build-substituted placeholder you add to it.
- **CSP pins inline-script hashes** in `firebase.json`. Do NOT add or modify inline
  `<script>` blocks in the HTML templates — the hash won't match and the script is
  blocked. External same-origin scripts and `<link>` tags are fine.
- **Hosting serves the repo root** (`"public": "."`). Anything a page references must
  exist on disk *after* `node scripts/prod.js`. `dist/`, `index.html`, `sw.js` are
  gitignored build artifacts — never commit them.
- **Prod build needs `.env.production` present** or preconnect hints + Firebase
  config silently no-op (fail-closed). CI passes these via the build step's `env:`.
- **`structuredClone` in product code** (`js/store.ts`) sets a Safari 15.4 / iOS 15.4
  floor. Fine per the es2022 target; revisit only if pre-15.4 iOS users surface.
- **Run typechecks from the repo root** — a lingering `cd functions` breaks them.
- **`jest.clearAllMocks()` doesn't clear `mockResolvedValue` implementations.**
- **Location: distance-sub attaches MUST be gated on a landed publish.** The
  reciprocity rules make an RTDB listen that attaches before the own node exists
  get denied and **permanently cancelled** (the SDK never retries). That's why
  `isPublishingAvailable()` in `js/locationShare.ts` includes the `_published`
  flag (set on the tick's publish resolution, cleared on every teardown path) and
  why the surfaces' `reconcileDistanceSubs` passes key off it. Dispatching
  eligibility events before a write lands re-creates "distances silently dead."
- **Location tests mock the db barrel** — jsdom suites can't see attach-time
  rules denials or listener cancellation; real-infra behavior differs. Debug
  "distance missing on device but tests green" at the rules/attach layer first
  (the final review found the whole class this way).
- **`js/locationShare.ts` toggleContext off-branch orderings are load-bearing:**
  gid snapshots are taken BEFORE pref flips (a flip changes what
  `getOptedInGids()` returns), and the group-off path uses `clearLocationCells`
  (cells-only) so the raw point is never transiently deleted (a transient delete
  cancels every peer listener via rules re-evaluation). Regression tests pin all
  of this — trust a red test over a "simplification."

---

## History — skip unless relevant

Everything below shipped (location sharing is on the feature branch; the rest is
on `dev`). Detail is in git + plans + the archived handoff.

- **Location-sharing implementation (2026-07-19, this branch, `c2f6a2e..7386957`)** —
  all 13 plan tasks executed subagent-driven with per-task spec+quality reviews.
  Review process caught and fixed (each with regression tests): direct-off
  privacy leak + first-enable double-publish (Task 6, in the plan's own reference
  code); distance-sub eligibility leaks on rendered rows (Task 9); then at final
  whole-branch review: publishing continuing after availability expiry,
  rules-cancelled listeners stranding stale coordinates, permission-revocation
  teardown, leave-group cell deletion, launch-time stale-row sweep, cross-device
  prompt suppression, bot mutuality half-gate, and the attach-vs-publish race
  family (closed by construction — every attach gated on a landed write). Full
  RED/GREEN detail was in the container-local review reports (gone with the
  container); the commits and their tests are the durable record.

- **Boot/status polish batch (2026-07-17, session 2; PR #296 + direct merges to
  `2e6b696`)** — five TDD fixes: (1) post-restore splash gates on server truth,
  not the empty local cache (regression of the June `aac5e24` fix, exposed by the
  ownStatus synchronous replay); (2) invite-redemption boots landing in Direct
  re-arm the splash over the reveal; (3) already-member short-circuits before the
  group displayname prompt; (4) splash stays solid through no-prompt redemptions
  (mid-fade reversal artifact); (5) Direct status toggle is optimistic with
  echo-absorbing setters, then the 200ms label crossfade removed entirely
  (same-frame swap). Suite `tests/app-restore-splash.test.js` pins the gating.
  All device-verified except the crossfade removal (see What's next).
- **UI-fix batch (2026-07-17, PR #294)** — six operator-reported defects
  (tap-zoom kill, popover flip, follow-request confirms + copy, title-bar color).
  Detail in the 7 commit messages on the PR.
- **TypeScript adoption (phase-0)** — full `js/*.js` → `js/*.ts` migration + strict
  `checkJs`; `about-*.js` and `features.js` deliberately left `.js` (see Landmines).
- **Client-performance plan (2026-07-17)** — 8 tasks, plan at
  `docs/superpowers/plans/2026-07-17-client-performance.md`: CSS minify,
  preconnect, ESM code-splitting (lazy wordlist/messaging/canvas), store parse
  memoization, label-only 60s refresh. Eager boot JS 509,669 B min / 142,478 B gz.
