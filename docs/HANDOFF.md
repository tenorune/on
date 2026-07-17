# KnockKnock — Session Handoff

> Forward-first. History lives in git, `docs/superpowers/plans/`, and `docs/archive/`.
> Prior handoffs (TS adoption + client-performance era) are archived at
> `docs/archive/HANDOFF-2026-07-17.md` — read only if you need that backstory.

## What this is

KnockKnock — a vanilla-TypeScript + Firebase (Hosting / RTDB / Cloud Functions) PWA
for ambient presence. Repo `tenorune/on`, working dir `/home/user/on`.

## What's next

**No queued work** — the 2026-07-17 UI-fix batch (PR #294) is merged to `dev`.
Next scope comes from the operator. Branch off `dev`.

Open follow-ups, triaged 2026-07-17:

- **#290** — "Continue in browser" dead tap in the Instagram/FB in-app browser
  (`js/about-cta.js` escape schemes silently cancelled). Best next UI fix;
  candidate fixes A/B/C are enumerated in the issue.
- **#286** — no revoke/regenerate/rename for invites on the Telegram surface.
  Feature-sized (new drawer affordance).
- **#288** — RTDB rule weakness (self-join any group by gid). Security, not UI;
  the issue says the fix is the maintainer's call.
- **Closed-unreproduced (2026-07-17): "revoked follow request still in inbox."**
  Investigation on record: the web revoke path is live by construction
  (sender-cancel deletes the exact `followRequests/{target}/{requester}` node the
  recipient's inbox watches, `js/inbox.ts:65-74`). The one surface that provably
  keeps a stale request visible is the recipient's **Telegram bot chat** — the
  "[Approve][Decline]" DM persists after cancel and only resolves lazily on tap
  ("This request is gone.", `functions/telegram.js:749-763`); a proactive fix
  needs message-id storage at notify time + an `onValueDeleted` trigger. Reopen
  only with a repro recipe (surface, device, backgrounded-or-not).
- **Device walkthrough pending** on the PR #294 visual fixes: real-Safari tap
  behavior, popover flip on a phone bottom, desktop-PWA title-bar repaint —
  jsdom can't prove those; the operator smokes them.

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
  (`.git/shallow`), which truncates history so `git merge-base` finds no common
  ancestor and merges refuse with *"refusing to merge unrelated histories."* Run
  `git fetch --unshallow origin` **before** any cross-branch merge/compare/ancestry
  check. (Cost a full false-alarm investigation on 2026-07-17.)
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

---

## History — skip unless relevant

Everything below shipped and is on `dev`. Detail is in git + plans + the archived handoff.

- **UI-fix batch (2026-07-17, PR #294)** — six operator-reported defects, TDD:
  app-wide double-tap-zoom kill (`touch-action: manipulation` on body, pinch kept),
  notify-popover flip-above-bell when clipping, confirm modals on follow-request
  send AND cancel, "(Name) in (group) wants to follow you" copy on all three
  surfaces, desktop-PWA title-bar color via a live `theme-color` meta mirror.
  Detail in the 7 commit messages on the PR.
- **TypeScript adoption (phase-0)** — full `js/*.js` → `js/*.ts` migration + strict
  `checkJs` across `scripts/` and `functions/`, code-analysis roadmap executed and
  audited. History in git; `about-*.js` and `features.js` deliberately left `.js`
  (see Landmines).
- **Client-performance plan (2026-07-17)** — 8 tasks, plan at
  `docs/superpowers/plans/2026-07-17-client-performance.md`, execution ledger at
  `.superpowers/sdd/progress.md`: CSS minify → dist/css, preconnect hints, ESM
  code-splitting (lazy 78 KB wordlist), lazy firebase/messaging, async Telegram
  bridge, delta canvas live-draw, store parse memoization, label-only 60s refresh,
  plus modulepreload for the eager chunk chain. Eager boot JS **509,669 B min /
  142,478 B gz** (from a 592,530 / 175,089 baseline); wordlist + messaging + canvas
  now load as lazy chunks. Device-smoked; Telegram app-URL revert + functions
  redeploy done.
