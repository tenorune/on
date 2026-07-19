# KnockKnock — Session Handoff

> Forward-first. History lives in git, `docs/superpowers/plans/`, and `docs/archive/`.
> Prior handoffs (TS adoption + client-performance era) are archived at
> `docs/archive/HANDOFF-2026-07-17.md` — read only if you need that backstory.

## What this is

KnockKnock — a vanilla-TypeScript + Firebase (Hosting / RTDB / Cloud Functions) PWA
for ambient presence. Repo `tenorune/on`, working dir `/home/user/on`.

## What's next

**EXECUTE the location-sharing security-fix plan.** The security review is
DONE (findings → spec → plan, all on this branch). Next session works the
5-task TDD plan on branch `claude/knockknock-feature-dev-9a3ysy`. Realign first:

```
git fetch origin
git checkout -B claude/knockknock-feature-dev-9a3ysy origin/claude/knockknock-feature-dev-9a3ysy
git log --oneline -1   # must be THIS docs(handoff) commit atop plan tip e423228 — else STOP, origin is authoritative
```

- **Plan (execution source of truth):**
  `docs/superpowers/plans/2026-07-19-location-sharing-security-fixes.md` —
  5 tasks, each TDD red→green→commit, with complete rule diffs + handler bodies
  + test code. Use REQUIRED SUB-SKILL `superpowers:subagent-driven-development`
  (recommended: fresh subagent per task + two-stage review) or
  `superpowers:executing-plans` (inline, batch + checkpoints). Execution
  approach is unconfirmed — default to subagent-driven unless the operator says
  inline.
- **Spec (design source of truth):**
  `docs/superpowers/specs/2026-07-19-location-sharing-security-fixes.md` —
  the three findings, root causes, the deliberately out-of-scope persistence
  posture, and Fix 2's locked **option A** (with rejected B/C for the record).

**The three fixes (severity · what · where):**

1. **HIGH — precise-location gate forgery (rules-only).** `followers`/
   `followerNames` `.write` let the node owner fabricate inbound edges → any
   authed user reads anyone's exact GPS. Fix: narrow `auth.uid === $uid` to
   deletions (`&& !newData.exists()`). Plan Task 1.
2. **MEDIUM — self-join coarse-cell read (#288 widening), option A.** Self-join
   + own-cell publish → read every member's ~1 km cell. Fix: a server-brokered
   `joinGroup` callable (validates token/pending-invite) + tighten
   `members/$uid` `.write` to `(data.exists() || !newData.exists())` (blocks
   self-CREATE, preserves self-edit/leave) + client rewire. Plan Tasks 3→4→5
   (strictly ordered; deploy the callable before/with the rule).
3. **LOW — cell not revoked on membership loss (VibeSec lifecycle).** Fix:
   `onMemberRemoved` trigger deletes the coarse cell on any membership
   deletion. Plan Task 2.

**Deliberately out of scope (operator-approved, NOT defects — do not "fix"):**
last-known nodes outliving availability, readable by mutuals/co-members while
the owner is offline; "distance shows only on available cards" being a
client-side display gate (rules gate on reciprocity + mutuality/membership, not
availability). Detail in the spec.

**One open product decision (unchanged, still unruled, NOT part of the plan):**
revoking OS location permission on ONE device flips the ACCOUNT-WIDE opt-in off.
Deliberate fail-safe, debatable.

**Feature module map (for whoever executes the plan):** `shared/geo.js`
(+ mirror `functions/_shared/geo.js` via `npm run sync-shared` — NEVER hand-edit
the mirror) math/formatters · `database.rules.json` `locations/`+`locationCells/`
+ `users/*/followers` + `groups/*/members` blocks (all four touched by the
plan) · `functions/telegram.js` (`handleWhoGroup` + `/who`) admin-bypass mirrors
· `functions/index.js` callable/trigger registration (`resolveInvitePreview` is
the deps-injected pattern the new `joinGroup` callable mirrors) · `js/db/*.ts`
RTDB ops · `js/invites.ts` + `js/inbox.ts` + `js/groups.ts` group-join entry
paths (rewired in Task 4) · `js/firebase-config.ts` client callable wrappers.

**Known-deferred minors** (unrelated to the security fixes; none device-visible
in the smoke cycle): denied glyph state isn't sticky (repaints revert
denied→off) · 'unsupported' title says "check permissions" (wrong guidance when
no geolocation API) · `formatDistancePrecise` 999.6-999.99 m renders "1000
meters away" not "1.0 km away" · stale opted-in gids (kicked groups) produce a
harmless denied write every 60s · cross-device prompt-suppression relies on the
Permissions API (absent → pass-through).

Open follow-ups, triaged 2026-07-17 (parked): **#290** in-app-browser dead tap
· **#286** no invite revoke on Telegram surface · **#288** now addressed at the
root by Fix 2/option A (close it when the plan lands) ·
**closed-unreproduced** "revoked follow request still in inbox" (reopen only
with a repro).

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

**Verified green at `93bea22`:** web 1950/1950 (85 suites), functions 396/396,
rules 86/86 (emulator), both typechecks, prod build, zero TS suppressions. The
three commits since (`2ae2f79`, `9ca7fc6`, `e423228`) are **docs-only** (spec +
plan + this handoff) — no executable delta, so the green bar still holds. The
plan's own tasks are the next code to run through it.

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
- The stop-hook at turn end is the standing commit+push prompt — commit then,
  not unprompted mid-turn.

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
- **Mid-file `require` ≠ top-level instance after `jest.resetModules()`.** Known
  in `tests/following.test.js`; ALSO bites `tests/me.test.js` (a later describe
  resets modules — bind mocks at top level, not inside test bodies).
- **`jest.clearAllMocks()` doesn't clear `mockResolvedValue` implementations.**
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

Everything below shipped (location sharing on this feature branch; the rest on
`dev`). Detail is in git + plans + the archived handoff.

- **Location security review (2026-07-19, this branch, `93bea22..e423228`,
  docs-only):** ran `/security-review` + `vibesec-skill` over the 42-commit
  feature diff. Confirmed 2 findings (HIGH forgeable precise-location gate;
  MEDIUM self-join coarse-cell read) + 1 VibeSec lifecycle item (LOW). Wrote the
  fix spec (`docs/superpowers/specs/2026-07-19-…`, Fix 2 locked to option A) and
  the 5-task execution plan (`docs/superpowers/plans/2026-07-19-…`). No code
  changed — execution is "what's next" above.
- **Location device-smoke debugging cycle (2026-07-19, this branch,
  `7386957..93bea22`, operator-verified):** glyph → theme accent, 22px picker-
  matched size without row-height change, solid-pin ON state (evenodd +
  counter-wound hole for iOS PWA); last-known persistence model + per-context
  published/availability eligibility + boot seeding (replaced the old
  delete-on-unavailable model whose listener cancels caused spotty distances);
  group/Direct independence (override-aware publishing via statusStore) with
  the mutual precise cascade as the sole cross-context rule (app + bot);
  unavailable viewers see nothing (app + bot); Telegram init-once hang fix;
  60s label-refresh no longer wipes the suffix; denied-tap toast; distance on
  its own line, "meters away" wording, theme-muted color.
- **Location-sharing implementation (2026-07-19, `c2f6a2e..7386957`)** — 13
  plan tasks, subagent-driven, per-task + whole-branch reviews; the review
  fixes are in the commit history.
- **Boot/status polish batch (2026-07-17, PR #296 + merges)** — splash
  server-truth gating, optimistic Direct toggle, same-frame status swap.
- **UI-fix batch (2026-07-17, PR #294)** — six operator-reported defects.
- **TypeScript adoption (phase-0)** — full `js/` migration + strict `checkJs`.
- **Client-performance plan (2026-07-17)** — 8 tasks, plan at
  `docs/superpowers/plans/2026-07-17-client-performance.md`.
