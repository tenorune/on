# KnockKnock — stack & architecture analysis + migration roadmaps

*2026-07-11 · analysis at tip `e013a0c` (branch `claude/knockknock-pwa-next-846uue` = `t1r1jp`). Companion: `2026-07-11-stack-analysis-and-migration-roadmaps.html`.*

Three parts:

1. **Stack & architecture analysis** — the chosen stack, architecture, and languages in light of the built features, user needs, and the app's goals, with an opinionated best-fit recommendation.
2. **Document 1** — a detailed roadmap for gradual TypeScript adoption, with risk/blast-radius analysis, wargamed.
3. **Document 2** — a detailed specification for migrating duplicated code to shared packages consumed by both `js/` and `functions/`, with risk/blast-radius analysis, wargamed.

Everything is grounded in the repo as it stands at `e013a0c`: esbuild bundling from `js/app.js`, babel-jest/jsdom for the 1688 web tests, bare-Node-ESM Jest (`transform: {}`) for the 357 functions tests, `firebase deploy --only hosting,database,functions` from CI with `"source": "functions"`, and the existing duplication seams between `js/`, `functions/`, and `database.rules.json`.

---

# Part 1 — Stack & architecture analysis

## What the app is, in one line

A real-time ambient-presence app for a small personal graph — "let the people who matter know when you're free" — delivered as an installable PWA and, lately, a Telegram Mini App, built explicitly as a sandbox for agent-assisted development (per the README's Author's Note: experimental, discovery-oriented, "not for everybody").

## The stack as found

| Layer | Choice | Size |
|---|---|---|
| Client | Vanilla JS ES modules, no framework, esbuild bundle | ~22k lines across 65+ modules |
| Styling | Hand-written CSS + custom properties (16 full UI themes) | ~1.8k lines |
| Backend | Firebase: RTDB + security rules, Auth (custom tokens), Cloud Functions (Node 22), FCM, Hosting | ~2.2k lines of functions, ~400 lines of rules |
| Identity | 4-word phrase → `sha256(phrase)` = uid, exchanged for a custom token server-side | — |
| Tests | Jest + jsdom (1688 web), separate Jest suite (357 functions), rules suite via emulator | — |

Runtime dependency count on the client: **one** (`firebase`). Everything else is dev tooling.

## Fit against the app's actual needs

**Real-time presence is RTDB's native sport.** The core loop — tiny status writes fanned out to a handful of listeners with sub-second latency, connection-state semantics, per-pair canvases — is exactly the workload RTDB was built for and prices well (per-connection, not per-read). Firestore would be the wrong trade here: higher read costs for chatty presence updates, worse latency, no gain for a dataset this shape. The rules language is the weak spot — awkward to express cross-user invariants (issue #288's self-join-by-gid hole is a symptom), which pushes trust logic into Cloud Functions — but the repo already treats that correctly (server-only subtrees, callables for anything cross-account, a dedicated rules test suite).

**Phrase-based identity is the most opinionated and most load-bearing choice.** No email, no OAuth, no vendor identity — a 4-word phrase, hashed, exchanged for a custom token. For a product whose pitch is "close friends, zero signup friction," this is a genuinely good fit that a conventional auth stack would actively damage. Its costs (phrase = full credential, plaintext vault in localStorage, the whole duplicate-account class of bugs the last three sessions closed) are real but known, documented, and accepted in the security review.

**No-framework vanilla JS: unfashionable, and correct — for *this* app.** The usual argument for React/Vue/Svelte is coordinating complex derived UI state across a team. Here: the state model is "RTDB listener fires → update a card," there's effectively one screen plus a drawer, the team is one operator plus agents, and the delivery targets (installable PWA, Telegram webview, in-app-browser escape flows) reward a small fast-booting bundle above almost everything else. The single runtime dependency also means near-zero supply-chain and upgrade-treadmill surface — which matters a lot for a solo experimental project that goes through intense burst development and then rests. The 1688 jsdom tests do the regression-safety job a framework's declarative layer would otherwise do.

That said, the history shows where the no-framework choice *bleeds*: the recurring class of work around competing surfaces (toast vs. promo vs. install nudge vs. guidance banner needing a `#bottom-stack` one-at-a-time arbiter, promos deferring to first-run resolution, pre-paint config selection to kill flashes) is hand-rolled UI-state orchestration — precisely what a reactive view layer gives you for free. It's been handled with discipline (explicit arbiters, change-events, guard tests), but it's the tax being paid.

## Where the friction genuinely is

1. **No static types.** 22k lines of dynamically-typed JS with heavy cross-module contracts (`prefs.telegram != null` read identically in three places, byte-identical formatter copies). The repo compensates with fixture-pinned "drift-scan" tests — which is clever, but it's hand-building what a type system provides.
2. **Client/functions code sharing is by disciplined duplication.** `presence-core.js` formatters and classification lists are duplicated and guard-tested rather than shared, because there's no workspace/package structure spanning `js/` and `functions/`.
3. **Rules expressiveness** (above) — mitigated, not solved.

None of these are architecture failures; all three are the predictable costs of the chosen stack, currently paid down by test discipline.

## Recommendation (opinionated)

**Keep the current stack. It is the right one — not by default, but on the merits.** Firebase RTDB + custom-token phrase auth + Cloud Functions matches the workload (presence fan-out, tiny social graph, no ops budget); vanilla JS + esbuild matches the delivery constraints (webviews, PWA boot, one-person maintenance) and the project's stated goal of being an agent-development playground where the whole surface stays legible. A framework rewrite or a backend migration would burn months to solve problems this app doesn't have, and would forfeit the near-zero dependency surface, the boot speed, and 2000+ passing tests.

Two incremental amendments worth their cost, in priority order:

- **Adopt TypeScript gradually (or at minimum JSDoc `@ts-check`).** esbuild already compiles TS natively — zero new build machinery. Start with the contract-heavy seams (`prefs`/`notifyChannel` readers, `inviteFlow`, the db layer) and the functions. This directly retires friction #1 and would have caught the class of cross-reader drift the fixture tests exist to police. This is the single highest-value change available. → **Document 1.**
- **Introduce a small shared package** (consumed by both `js/` and `functions/`) for the duplicated units. Retires friction #2 and its guard-test scaffolding. → **Document 2.**

Explicitly *not* recommended: a view framework. If the surface-arbitration tax keeps growing, the proportionate response is a ~1kB reactive primitive (signals or lit-html for the banner/toast/promo layer only), not a framework adoption — and even that isn't warranted yet.

OBSERVED: everything above about code size, dependencies, features, and past friction comes from the repo and its handoff history. UNKNOWN: runtime economics (Firebase bill, actual user count) and any maintainer appetite for TS — both could shift the amendment priorities, neither changes the headline verdict.

---

# Document 1 — Gradual TypeScript adoption roadmap

## Ground truth the roadmap must respect

1. **esbuild already compiles TS natively.** `scripts/prod.js` / `dev.js` bundle `js/app.js`; adding `.ts` files requires zero build-machinery change. esbuild also resolves `import './x.js'` to `x.ts` (TS-compat resolution), so converted modules don't force import-specifier churn in their importers.
2. **TS is erasure-only here.** No runtime artifact changes shape; `dist/bundle.js` remains the deploy unit. There is no version-skew or deploy dimension to this migration at all — the entire blast radius is **build + test infrastructure and developer workflow**.
3. **The functions side has no build step.** `functions/` deploys as-is (plain ESM, Node 22) and its Jest runs bare Node ESM with `transform: {}`. Full TS there requires introducing a compile step into the deploy path — a qualitatively bigger change than anything on the client.
4. **Several things read `.js` source text or paths literally** (the landmine list below). These, not type errors, are where a naive rename breaks production.

## Strategy

**Two tracks.** Client (`js/`): full gradual TS via esbuild, strict-by-default for converted files. Functions (`functions/`): JSDoc + `@ts-check` only — full type coverage, zero build-step change, zero deploy-path change. Revisit full-TS for functions only if Document 2's Option C (bundled functions) is ever adopted, which it is not recommended to be.

**One shared `tsconfig.json`**, `noEmit: true`, `allowJs: true`, `checkJs: false` globally (opt in per-file with `// @ts-check`), `strict: true` (applies fully to `.ts` files). Type-checking is a separate command (`npm run typecheck` → `tsc --noEmit`), never in the esbuild path — the red→green TDD loop stays exactly as fast as today.

## Phases

**Phase 0 — Scaffold (no source change, ~1 session).**
Add `typescript` devDependency, `tsconfig.json`, `npm run typecheck`, and a `typecheck` step in both CI workflows *after* the test steps. Update the web Jest transform to `'^.+\\.(js|ts)$': 'babel-jest'` plus `@babel/preset-typescript`, and add `moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' }` so `.js` specifiers resolve to future `.ts` files under Jest the way they already do under esbuild. **Gate: 1688/1688 web + 357/357 functions green with zero source edits, `npm run build` byte-comparable output.** This commit deliberately isolates the highest-blast-radius infra change from any actual conversion.

**Phase 1 — Ambient contract types (~1 session).**
Create `types/` with `.d.ts` declarations for the load-bearing shapes: `UserPrefs` (incl. `telegram`, `notifyChannel`), presence/`statusOverride`, invite records, identity, the RTDB paths' value shapes. No renames. Turn on `// @ts-check` + JSDoc imports in the contract-seam files where cross-module drift has historically cost real sessions: `js/notifyChannel.js`, `js/notifySuppression.js`, `js/prefs.js`, `js/inviteFlow.js`. This is where types start paying before any file is `.ts`.

**Phase 2 — Leaf conversions (2–3 sessions, mechanical).**
Convert pure, dependency-light modules: `utils.js`†, `features.js`†, `inviteText.js`, `palettes.js`, `wordlist.js`, `hintRotation.js`, `notifyRouting.js`, `inviteBootGate.js` (pure by design), `telegramLinkCopy.js`. † = landmine-listed below; convert only with their coupled fixes in the same commit. Policy: **conversion commits are type-only** — if the checker exposes a real bug, it gets its own commit (or issue) first; never fix-and-convert in one diff.

**Phase 3 — The `db/` layer and stateful modules (3–4 sessions).**
`js/db/*`, `store.js`, `identity.js`, `prefs.js`, then the feature modules. DOM-heavy orchestrators (`app.js`, `following.js`, `groupNav.js`, `canvas.js`) go last — they're where `strict` DOM nullability is noisiest and where the payoff is smallest. It is legitimate to leave the worst of these as `@ts-check` JSDoc indefinitely.

**Phase 4 — Functions track (parallel, any time after Phase 1).**
`// @ts-check` + JSDoc across `functions/*.js`, sharing the `types/` shapes via JSDoc `@typedef` imports. `tsconfig` gets a second project reference or an `include` that covers `functions/`. No deploy change, no `functions/package.json` change.

**Phase 5 — Ratchet and guard retirement.**
CI typecheck is already blocking from Phase 0; the ratchet is the shrinking `checkJs`-exempt list. Retire guard tests **only** where types fully subsume them (e.g. an internal shape assertion). Keep every fixture that pins behavior across runtimes or into `database.rules.json` (`time-format-vectors.json`, `notify-channel-vectors.json`, `name-cap-invariant.test.js`) — types cannot see the rules file or prove two implementations behave identically.

## Landmines (things that break on rename, not on types)

| Landmine | What breaks | Fix policy |
|---|---|---|
| `scripts/build.js:113` reads `js/features.js` **source text** to gate `__TELEGRAM_APP_LINK__` (fail-closed) | Renaming to `features.ts` → `readFileSync` throws → build fails loudly (good), or worse: a future "graceful" fallback would silently disable Telegram links | Update `build.js` in the same commit; the fail-closed design means the failure mode is loud, but verify `npm run build` in that commit's gate |
| `tests/cacheOwner*.test.js:118` filesystem drift-scan walks `js/` for `statusapp_*` keys | Scan filtering on `.js` silently stops scanning converted files → drift guard goes blind (false green) | Extend the walk to `.ts` in Phase 0, before any conversion — a guard that can go silently blind is the worst class of breakage |
| `tests/name-cap-invariant.test.js` and similar read specific source paths across `js/`/`functions/`/rules | Red test on rename (loud, safe) | Update paths in the conversion commit |
| The CSP-hashed inline `<head>` script in `about.template.html` | Not bundled, not affected — **out of scope; never TS-ify template inline scripts** | Explicit non-goal |
| Gitignored build artifacts + deploy-from-origin | Unchanged pipeline; a converted file that's pushed but not rebuilt behaves exactly like today's stale-bundle landmine | No new exposure, note only |

## Wargames

**W1 — The Phase-0 transform flip breaks a swath of tests.** `moduleNameMapper` stripping `.js` could collide with mocks registered by exact specifier (`jest.mock('./x.js')`) or with the fixture JSON imports. *Play it out:* the failure is immediate and loud across the suite; because the commit contains zero source changes, the diff to inspect is nine lines of config. Mitigation is the phase design itself. Rollback: revert one commit. Residual risk: low.

**W2 — `utils.js` conversion vs. the functions duplicate.** `formatTimeRemaining`/`Fuzzy` exist twice (`js/utils.js:88`, `functions/presence-core.js`), pinned by shared fixture vectors. Converting the client copy to TS makes the two copies *textually* divergent forever, entrenching duplication-by-fixture. *Play it out:* nothing breaks — the vectors still pin behavior — but the Document 2 migration gets harder because "move the file" becomes "move and down-compile". **Sequencing rule: run Document 2's extraction of any shared unit *before* Phase 2/3 touches its client copy.** This is the one hard ordering constraint between the two documents.

**W3 — Strictness flood.** A converted mid-graph module (`store.js`) surfaces 60 errors in its still-JS callers. *Play it out:* `checkJs: false` means JS callers aren't checked, so the flood can't happen from below; errors appear only inside the converted file. If a converted file's own errors exceed a session's budget, demote it to `@ts-check` + `@ts-expect-error` markers and move on — the ratchet is monotonic, not per-file-perfect.

**W4 — The checker finds a real latent bug mid-conversion** (probable in the `prefs`/notify seams — that's why they're Phase 1). *Play it out:* the temptation is to fix inline; that turns a "type-only, behavior-identical" commit into one needing on-device verification. Policy above: separate commit, own test, own walkthrough item. Conversion commits must stay skimmable-as-safe.

**W5 — Agent/TDD workflow drag.** Typecheck as a separate command means an agent can go red→green without fighting types, then reconcile. The realistic failure is agents *forgetting* `npm run typecheck` locally and CI catching it late; acceptable — CI is the ratchet's teeth, and it blocks deploy (the test job gates the deploy job in both workflows).

**W6 — Behavior drift hidden in a conversion.** Enum-narrowing or a default-parameter change slips in. *Detection:* run unminified dev builds before/after and diff — for a faithful conversion the output diff is near-empty and reviewable. Worth doing for Phase 3 modules; overkill for Phase 2 leaves.

## Blast radius summary

Runtime: **zero by construction** (erasure + unchanged pipeline). Test infra: one loud, isolated Phase-0 commit. Build: one landmine (`build.js`/`features`) with a loud failure mode. Deploy/CSP/rules/service-worker: untouched. Rollback at every phase is `git revert` of self-contained commits; no artifact, schema, or data migration ever occurs. The real cost is sustained attention across ~6–9 sessions and the W2 ordering constraint with Document 2.

---

# Document 2 — Shared-package specification (`js/` ⇄ `functions/`)

## The problem, precisely

Six units exist in two or three places, kept honest today by fixture tests and cross-reference comments:

| # | Unit | Client copy | Functions copy | Third copy | Guard today |
|---|---|---|---|---|---|
| 1 | Time formatters (`formatTimeRemaining`, `…Fuzzy`) | `js/utils.js:88` | `functions/presence-core.js` | — | `test-fixtures/time-format-vectors.json`, both suites |
| 2 | Notify-channel delivery predicate (`channel !== 'push'` ⇒ bot) | `js/notifyChannel.js`, `js/notifySuppression.js` | `functions/notifier.js` | — | `test-fixtures/notify-channel-vectors.json`, 3 readers + cross-ref comments |
| 3 | 40-char name cap | `js/telegram.js:32` (`TG_NAME_CAP`) | `functions/` `clampName` | `database.rules.json` | `tests/name-cap-invariant.test.js` |
| 4 | Id formats (`GROUP_ID_RE`, `UID_RE`) | `js/notifyRouting.js:17`, `js/groups.js` (generator), `js/identity.js` (uid derivation) | `functions/telegram-shared.js:13` | `database.rules.json` | comments only |
| 5 | Availability predicates | `js/` has its own `isAvailable` (different shape) | `functions/presence-core.js` (`primaryAvailable`, `effectiveAvailable`) | — | **semantic** duplicate only — not textual |
| 6 | Status-circle / time copy for bot parity | palette color names | `functions/presence-core.js` `statusCircle` | — | fixture |

OBSERVED: #1–#4 are true duplicates. UNKNOWN until migration-time inspection: whether #5's client and server predicates are actually behavior-identical (they were written independently against the same model) — treat #5 as a *verification* task, not a mechanical move.

## The constraint that shapes everything

`firebase deploy --only functions` archives the `functions/` directory (`"source": "functions"`) and installs `functions/package.json` dependencies in the cloud. **Anything outside `functions/` does not ship.** Three architectures:

- **Option A — committed mirror.** `shared/` is the single source of truth; a script (`scripts/sync-shared.js`) copies it byte-for-byte to `functions/_shared/`; the mirror is **committed**; guard tests in *both* suites assert byte-equality. Client imports `../shared/x.js` directly (esbuild and babel-jest both resolve it trivially); functions import `./_shared/x.js`.
- **Option B — npm workspaces + `file:` dependency.** Real package semantics, but the Firebase CLI's handling of local/workspace deps is version-sensitive and has a long history of monorepo breakage; it makes the *deploy* — the least observable, least testable stage, and the one that runs `--force` from CI — the failure point. Also would drag `isolate-package`-style tooling into a repo whose whole character is one runtime dependency.
- **Option C — esbuild-bundle `functions/` into a self-contained artifact.** Solves sharing as a side effect, but converts every deploy into shipping a novel artifact, complicates stack traces for `firebase-admin`-adjacent failures, and rebuilds the deploy pipeline to deduplicate ~300 lines. Wildly disproportionate.

**Recommendation: Option A.** It is unglamorous, but it is testable at the test stage (not the deploy stage), requires zero new dependencies, matches the repo's existing idiom (generated-artifact scripts + loud guard tests, exactly like the CSP-hash guard and the `cacheOwner` drift-scan), and keeps `functions/` self-contained so *nothing* about deploy, the emulator, the A5 runbook, or the dev-push-wipes-functions landmine changes. The mirror-staleness risk it introduces is fully covered by a byte-equality guard that runs in the CI test job, which already gates the deploy job.

## Specification

**Layout.** `shared/` at repo root: plain `.js` ESM, extensionful relative imports, **zero imports from `js/`, `functions/`, or node_modules** — pure, dependency-free modules only (the same discipline `functions/presence-core.js` already declares in its header). Files: `shared/timeFormat.js`, `shared/notifyDelivery.js`, `shared/limits.js` (name cap), `shared/idFormats.js`, and eventually `shared/presence.js`.

**Sync.** `scripts/sync-shared.js` — recursive byte-identical copy `shared/` → `functions/_shared/`. No generated-file header is prepended (it would break byte-equality checking and tempt hand-edits anyway); instead the provenance note lives *in* the source files in `shared/` ("consumed by js/ directly and by functions/ via the committed `functions/_shared/` mirror"). Add `npm run sync-shared`. The mirror is committed, not gitignored — this is the load-bearing choice: deploy-from-origin needs no build hook, and staleness is caught by tests rather than by production.

**Guards.** One test in the web suite and one in the functions suite, both trivially: read every file in `shared/`, read its counterpart in `functions/_shared/`, assert byte-equal, and assert no orphans in the mirror. Failure message says exactly `run: npm run sync-shared`. A second guard in the web suite asserts `shared/*.js` contains no `import` from outside `shared/` (the purity fence — see W4).

**Consumption pattern: re-export, don't rewire.** `js/utils.js` keeps exporting `formatTimeRemaining` — its body becomes `export { formatTimeRemaining, formatTimeRemainingFuzzy } from '../shared/timeFormat.js'`. Likewise `functions/presence-core.js` re-exports from `./_shared/timeFormat.js`. Zero import churn across the ~65 client modules and the functions call sites; every existing test keeps passing *through* the re-export, which means the existing suites verify the plumbing for free. Direct imports of `shared/` can happen organically in new code.

**What explicitly stays duplicated.** `database.rules.json` cannot import JavaScript — the 40-cap and id-format copies there remain, and `tests/name-cap-invariant.test.js` (and a new id-format sibling) remain as the *only* mechanism spanning into rules. The fixture vector files also remain: after migration they pin the *shared* implementation's behavior, which is still worth pinning (they're the spec; the byte-guard only proves the two runtimes run the same bytes).

## Migration plan (one unit per commit, TDD-shaped)

1. **T1 — Scaffold**: `shared/` (empty-ish), sync script, both freshness guards, purity-fence guard, npm script. Gate: both suites green, `npm run build` clean.
2. **T2 — Time formatters** (#1; lowest risk, best-guarded): move into `shared/timeFormat.js`, re-export from both current homes, sync, run fixtures. Gate additionally: an unminified bundle diff shows only the re-export plumbing.
3. **T3 — Notify predicate** (#2): extract `botDelivered(prefs)`-equivalent into `shared/notifyDelivery.js`; all three readers re-export/consume; retire the three-way cross-ref comments in favor of one pointer each; vectors retained.
4. **T4 — Name cap** (#3): `shared/limits.js` with `NAME_CAP = 40` + `clampName`; client `TG_NAME_CAP` and functions `clampName` consume; invariant test now checks shared-vs-rules (two-way instead of three-way).
5. **T5 — Id formats** (#4): `shared/idFormats.js`; `js/notifyRouting.js` + `functions/telegram-shared.js` consume; add the missing fixture-style test; `js/groups.js`'s generator asserts against the shared regex in its test.
6. **T6 — Presence predicates** (#5): *verification first* — table client `isAvailable` vs. functions `primaryAvailable`/`effectiveAvailable` behavior over a written vector set; unify **only if identical**; if they differ, the difference is either a latent bug (file it) or intentional (document it, don't unify).
7. **T7 — Docs**: HANDOFF landmine entry ("edit `shared/`, never `functions/_shared/`; sync before commit"), README stack note.

Each of T2–T6 is independently revertable; the re-export pattern means a revert touches two files plus the mirror.

## Wargames

**W1 — Stale mirror reaches deploy.** Someone edits `shared/timeFormat.js`, forgets to sync, pushes. *Play it out:* web-suite freshness guard is red → CI test job fails → deploy job never runs (both workflows gate deploy on tests). The nastier variant: someone edits `functions/_shared/` **directly** — functions tests pass against the edited mirror (false confidence), but the byte-guard is still red because source ≠ mirror, and the guard's message points at `shared/` as truth. Residual hole: an operator deploying manually with tests skipped — same hole that exists today for everything else; no new exposure.

**W2 — The deploy assumption is wrong.** The spec assumes the Firebase CLI archives arbitrary files inside `functions/`. It does — `_shared/*.js` are ordinary source files, not dependencies — but *verify before relying*: T1's gate should include one emulator boot (`firebase emulators:exec`) of a function importing from `_shared/`, and T2 should ride to production alongside an otherwise-planned deploy (A5 is pending anyway) with a smoke check of one bot `/status` reply (exercises `formatTimeRemainingFuzzy` server-side). UNKNOWN until then; the emulator makes it a cheap known.

**W3 — Highest-value target = highest blast radius.** The notify predicate (T3) sits in `functions/notifier.js` — get it wrong and *notifications silently stop* for telegram-routed users (the worst failure class: invisible). Mitigations: T3 is a re-export with the 10-case vector file unchanged and all three readers' existing tests unchanged; the vectors were built precisely to pin this cliff. Still: T3's done-gate is the operator observing one real knock → Telegram message and one → push, post-deploy. Not green suites.

**W4 — Shared becomes a junk drawer / grows dependencies.** Someone adds a `shared/` helper that imports `js/store.js`, and now `functions/` transitively mirrors client state code, or worse, the `firebase` client SDK. The purity-fence guard test (no imports leaving `shared/`) makes this a red test instead of a code-review catch. Policy corollary: when client and server needs for a shared unit *diverge* (e.g., the bot wants a different fuzzy-time voice), the answer is to fork that unit back out deliberately — never to grow config flags inside `shared/`.

**W5 — Import-cycle regression.** `functions/telegram-shared.js` exists specifically to break a `telegram.js` ↔ `telegram-auth.js` cycle. Moving its regexes to `_shared/` preserves that (leaf moves further down); but if T6 ever pulls something from `presence-core.js` that `notifier.js` *and* `telegram.js` reach differently, cycles could reappear. Cheap insurance: `shared/` files import nothing (W4's fence), so they can never participate in a cycle.

**W6 — Sync-script defects.** Partial copy, CRLF mangling, a deleted shared file leaving an orphan in the mirror. All three are exactly what the byte-equality + no-orphan guard catches; the script can be dumb because the guard is strict.

**W7 — Interaction with the TS roadmap (Document 1, W2 mirror-image).** If `shared/` ever became `.ts`, the mirror would need compilation (functions run bare Node ESM — no types allowed) and byte-equality stops being meaningful. **Decision: `shared/` stays plain `.js` with JSDoc types permanently.** It's a few hundred lines of pure functions; JSDoc + `@ts-check` gives them full type coverage under Document 1's Phase 4 machinery with zero build implications. And sequence T2 before Document 1 Phase 2 touches `js/utils.js`.

**W8 — The A5 / branch-only-functions landmine.** Unchanged: a `dev` push still wipes branch-only Telegram functions until redeploy. The mirror rides inside `functions/`, so it deploys and gets wiped in exactly the same motion as everything else. No new interaction — but T2+'s first production exercise should ride the already-pending A5 redeploy rather than trigger its own.

## Blast radius summary

Client: near-zero (re-exports; bundle content changes are the moved bytes themselves; SW cache hash re-stamps automatically per the build). Functions: the real surface — T3 touches the notification-delivery spine and T5 touches the bot's attacker-controllable-input validation; both are re-export-shaped and vector-pinned, with post-deploy on-device checks as the done-gate. Deploy pipeline: **zero changes** (the committed mirror is the entire trick). Rules: untouched. Rollback: per-commit revert, at most three files each. Steady-state cost: one habit ("edit `shared/`, run sync") enforced by a loud guard, replacing today's cost (N copies + cross-ref comments + remembering they exist).

---

# Recommended combined sequencing

1. Doc 2 T1–T2 (scaffold + formatters)
2. Doc 1 Phase 0–1 (TS scaffold + ambient types)
3. Doc 2 T3–T5
4. Doc 1 Phase 2+ (leaf conversions, now free to touch `utils.js`)
5. Doc 2 T6 (predicate verification, benefiting from types)
6. Doc 1 Phases 3–5 at leisure

The only hard ordering constraint is *shared-extraction before TS-conversion for any unit appearing in both plans*; everything else is parallelizable across sessions.
