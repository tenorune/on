# KnockKnock — Session Handoff

> Forward-first. History lives in git, `docs/superpowers/plans/`, and `docs/archive/`.
> Prior handoffs (TS adoption + client-performance era) are archived at
> `docs/archive/HANDOFF-2026-07-17.md` — read only if you need that backstory.

## What this is

KnockKnock — a vanilla-TypeScript + Firebase (Hosting / RTDB / Cloud Functions) PWA
for ambient presence. Repo `tenorune/on`, working dir `/home/user/on`.

## What's next

**Execute the location-sharing implementation plan** —
`docs/superpowers/plans/2026-07-18-location-sharing.md` (13 TDD tasks; approved
spec beside it in `specs/2026-07-18-location-sharing-design.md`). Work happens ON
the existing branch `claude/knockknock-feature-dev-9a3ysy` (origin tip `903d02f` =
spec + plan + merge of `dev`'s canvas-screenshot batch; all green: 1830 web /
360 functions / both typechecks / prod build). Do NOT cut a new branch and do
NOT build off `dev` — realign to origin first:

```
git fetch origin
git checkout -B claude/knockknock-feature-dev-9a3ysy origin/claude/knockknock-feature-dev-9a3ysy
git log --oneline -8 | grep 903d02f   # location spec+plan history present — empty output = STOP
```

(The `-B` realign is deliberate: a prior container's local copy of this branch
may be stale/diverged; origin is authoritative.)

The feature in one line: opt-in location sharing, distance on existing cards —
precise for sharing mutuals, coarse ("<1 km" floor) for sharing group
co-members, nothing for everyone else; glyph-next-to-time-remaining is the only
control; publish tied to availability. The plan is self-contained (exact files,
code, commands per task); execution mode (subagent-driven vs inline) was left
undecided — ask the operator if unclear.

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

---

## History — skip unless relevant

Everything below shipped and is on `dev`. Detail is in git + plans + the archived handoff.

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
