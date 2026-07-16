# Code-Analysis Recommendations Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Altitude note:** This is a *roadmap* spanning four workstreams. Phases 0, 1, and 3 are specified to execution depth and can be run directly from this document. Phase 2 (reactive store) locks in the interfaces and migration order, but Tasks 2.3–2.4 touch the two most stateful modules in the codebase — write a dedicated plan (superpowers:writing-plans) for each before executing, using the interface contracts pinned here.

**Goal:** Implement the four recommendations from the 2026-07-16 code-based analysis: close the SW precache gap, finish the client TypeScript conversion, consolidate the hand-synchronized status-propagation layer into one subscribable store, and extend typecheck coverage to the backend — without a framework migration and without touching the Firebase data model.

**Architecture:** Incremental, test-protected refactors on the existing vanilla-TS + Firebase stack. Every phase leaves the app shippable and is gated by the existing CI quartet. No new runtime dependencies; the one new abstraction (status store) is hand-rolled in-house, modeled on the existing `presenceHub.ts` pattern.

**Tech Stack:** TypeScript (strict, `checkJs`), esbuild, Jest + jsdom, Firebase RTDB/Functions/FCM, `@firebase/rules-unit-testing`.

## Global Constraints

- Branching: cut feature branches from `dev`; the maintainer merges (CLAUDE.md). Exception: Phase 1 (TS adoption) builds off `claude/typescript-adoption-phase-0-009izp` — that branch is the designated TS workstream.
- Gate for every task: `npx jest` AND `npm run typecheck` green. Gate for every phase: additionally `cd functions && npm test` AND `npm run test:rules` (needs Java for the RTDB emulator).
- Zero `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` — the codebase has none today; keep it that way.
- No behavior changes in rename/conversion tasks. A conversion commit must not change any test expectation.
- Pinned-JS files that MUST NOT be renamed to `.ts`:
  - `js/features.js` — read as source text by `readTelegramEnabled()` in `scripts/build.js:117-125` via regex; guarded by `tests/featuresFreeze.test.js`.
  - `js/about-cta.js`, `js/about-invite.js`, `js/about-telegram.js` — served raw and unbundled via `<script src>` from `about.template.html:169-175`; the browser cannot execute `.ts`.
- Jest already maps extensionful relative imports to extensionless (`jest.config.js:8` `'^(\\.{1,2}/.*)\\.js$': '$1'`), and esbuild resolves `./x.js` → `x.ts` under `moduleResolution: "bundler"` — so **importers never change** when a module flips `.js` → `.ts`. Verify this per file; do not edit import specifiers.
- Commit per completed task with a conventional message (`refactor(ts): …`, `fix(sw): …`). Do not merge to `dev`/`main`; do not open PRs unless asked (CLAUDE.md).

## Sequencing & dependencies

```
Phase 0 (SW fix)          — independent, do first, ~1 short session
Phase 1 (client TS)       — independent of 0; Wave A before Wave B; app.js last
Phase 2 (status store)    — AFTER Phase 1 Wave B (the files it refactors should be .ts first)
Phase 3 (backend checkJs) — independent, can run parallel to any phase
Phase 4 (non-goals)       — no work; decision record only
```

---

## Phase 0 — Close the service-worker precache gap

The shell loads `css/canvas.css` (`index.template.html:28`) but it is neither in the SW `SHELL` precache list (`sw.template.js:9`) nor in the cache-version hash inputs (`scripts/build.js:77`). Consequence in code: offline shell renders the canvas unstyled, and a canvas-CSS-only change ships no SW update.

### Task 0.1: Precache and hash `css/canvas.css`

**Files:**
- Modify: `sw.template.js:9`
- Modify: `scripts/build.js:77`
- Test: `tests/sw.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Write the failing test.** In `tests/sw.test.js`, locate the existing describe block that asserts on `SHELL`/install behavior and add:

```js
test('SHELL precaches every stylesheet the shell loads', () => {
  // css/canvas.css is loaded by index.template.html; a shell asset missing
  // from SHELL renders unstyled offline and ships no SW update when it changes.
  expect(SHELL).toContain('/css/canvas.css');
});

test('cache-version hash covers every SHELL stylesheet', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'build.js'), 'utf8');
  expect(src).toMatch(/css\/canvas\.css/);
});
```

Adapt the `SHELL` access to however `sw.test.js` currently captures the template's constants (it loads the template via `jest.isolateModules` and asserts against the literal `__CACHE_VERSION__` placeholder — reuse that harness; add `fs`/`path` requires if the file lacks them).

- [ ] **Step 2: Run to verify both fail.** `npx jest tests/sw.test.js` → 2 failures.
- [ ] **Step 3: Fix the template.** `sw.template.js:9`:

```js
const SHELL = ['/', '/index.html', '/css/app.css', '/css/canvas.css', '/dist/bundle.js', '/manifest.json'];
```

Also update the stale comment at `sw.template.js:4` listing the hash inputs.

- [ ] **Step 4: Fix the hash inputs.** `scripts/build.js:77`:

```js
for (const f of ['dist/bundle.js', 'css/app.css', 'css/canvas.css', 'index.html', 'manifest.json']) {
```

- [ ] **Step 5: Verify.** `npx jest tests/sw.test.js` → all pass; then full `npx jest` and `npm run typecheck`.
- [ ] **Step 6: Commit.** `git add sw.template.js scripts/build.js tests/sw.test.js && git commit -m "fix(sw): precache css/canvas.css and include it in the cache-version hash"`

---

## Phase 1 — Finish the client TypeScript conversion

13 of the 17 remaining `.js` files convert (the 4 pinned files stay). All 17 are already strict-`checkJs`-clean, so conversion is mechanical: rename, replace JSDoc typedefs/casts with TS syntax, convert the 4 CommonJS files to ESM. Two waves: leaves first, then the heavy orchestrators, `app.js` last (it imports from 46 modules — converting it last means it never needs interim casts).

**Recipe for every file in this phase** (each per-file checklist item below expands to these steps):
1. `git mv js/<name>.js js/<name>.ts`
2. Delete the `// @ts-check` pragma (implied for `.ts`).
3. Replace `/** @typedef {…} */` with `type`/`interface`; `/** @param {T} x */` with parameter annotations; inline `/** @type {T} */ (expr)` casts with `expr as T`.
4. For CommonJS files only: `module.exports = { a, b }` → `export { a, b }` (or per-symbol `export function`); `const x = require('./y.js')` → `import { … } from './y.js'` (keep the `.js` specifier — see Global Constraints).
5. `npm run typecheck` → 0 errors. `npx jest` → suite green, **no test file edits** (the moduleNameMapper absorbs the rename; if a test breaks, the conversion changed behavior — stop and fix the conversion, not the test).
6. Commit: `git commit -m "refactor(ts): convert js/<name> to TypeScript"` — one commit per file, so any regression bisects to a single rename.

### Task 1.1: Wave A — leaves and CommonJS stragglers (7 files)

**Files:** Convert in this order (dependencies first):
- [ ] `js/wordlist.js` → `.ts` (CJS; consumed by `identity.js` — convert before identity)
- [ ] `js/store.js` → `.ts` (CJS; the `FollowingEntry`/`PaletteState` typedefs at `store.js:11-15` become exported `type`s — `prefs.ts` re-exports its getters and can then drop local shims)
- [ ] `js/identity.js` → `.ts` (CJS; imports wordlist)
- [ ] `js/installPrompt.js` → `.ts` (CJS)
- [ ] `js/firebase-config.js` → `.ts` (reads the `process.env` esbuild-define seam typed by `types/app.d.ts:12` — verify typecheck still resolves it without `@types/node`)
- [ ] `js/telegram.js` → `.ts`
- [ ] `js/db.js` → `js/db.ts` (pure re-export barrel; trivial, but confirm every `jest.mock('../js/db.js', …)` in `tests/` still intercepts — the mapper rewrites the mock path too; run the three biggest consumers explicitly: `npx jest tests/following.test.js tests/db.test.js tests/knock.test.js`)

**Interfaces:**
- Consumes: nothing.
- Produces: `store.ts` exports `type FollowingEntry = { userId: string; code: string; label?: string }` and `type PaletteState = { activeSet: number; sets: Record<string, any> }` — Wave B files annotate against these.

- [ ] **Phase gate + commit per file** (see recipe).

### Task 1.2: Wave B — heavy orchestrators (6 files)

The value wave: these are the flag-heavy modules where real types retire complexity. Same recipe, plus one type-hardening rule per file, listed below. Order matters — later files import earlier ones.

- [ ] `js/groups.js` → `.ts` — type the group-meta and member shapes against `types/app.d.ts`'s wire types; keep `_forTests` exports (`groups.js:275-292`) but mark them with a `/** test-only */` doc comment.
- [ ] `js/groupNav.js` → `.ts` — replace the module-global soup (`_myUserId`, `_state`, `_enumeration`, `_metaSubs`, `groupNav.js:39-150`) with typed module state: define `type NavState = { groupId: string | null }` etc. No structural change — just names and types.
- [ ] `js/groupContext.js` → `.ts` — same treatment for `_currentGroupId`, `_ownOverride`, `_memberPrimaries` (`groupContext.js:79-125`). The `null`-through-`unknown` cast at `groupContext.js:90-91` becomes an honest `string | null` with narrowing at use sites.
- [ ] `js/canvas.js` → `.ts` — the ~20 nullable session singletons (`canvas.js:25-61`) become one typed `type CanvasSession = { … } | null` where practical; if that widens the diff beyond a rename, defer the consolidation to a follow-up and convert with per-variable types only. Do not touch sync logic.
- [ ] `js/following.js` → `.ts` — type the call-state pair explicitly: `let callModeCalleeId: string | null` and `let _incomingCall: { from: string } | null` (`following.js:90-92`); type `lastUserData` as `Map<string, PresenceNode>`. This is the largest file (1,389 lines) — budget a full session; run `npx jest tests/following.test.js tests/app-call-recovery.test.js` before the full suite.
- [ ] `js/app.js` → `.ts` — convert LAST. Also delete the stale comment at `app.js:867-872` (the temporary `any` seam for `initList` options — following.js is typed by now; replace the `any` cast with the real options type exported from `following.ts`).

**Interfaces:**
- Consumes: `FollowingEntry`, `PaletteState` from Task 1.1; ambient wire types from `types/app.d.ts`.
- Produces: `following.ts` exports its `initList` options type (name it `InitListOptions`) — consumed by `app.ts` in the final step. `groupNav.ts`/`groupContext.ts` keep their current export names verbatim (Phase 2 renames nothing).

- [ ] **Phase gate:** full quartet (`npx jest`, `cd functions && npm test`, `npm run test:rules`, `npm run typecheck`). Commit per file.

### Task 1.3: Pin the must-stay-JS survivors

**Files:**
- Modify: `js/about-cta.js:1`, `js/about-invite.js:1`, `js/about-telegram.js:1` (header comments only)
- Test: `tests/about-page.test.js`

`features.js` is already tripwired by `featuresFreeze.test.js`. Give the about trio the same protection so a future TS sweep doesn't break the unbundled `/about` page silently.

- [ ] **Step 1: Failing test** in `tests/about-page.test.js`:

```js
test('about-page scripts stay plain .js — served raw, never bundled', () => {
  // about.template.html loads these via <script src>; a rename to .ts 404s in prod.
  for (const f of ['about-cta.js', 'about-invite.js', 'about-telegram.js']) {
    expect(fs.existsSync(path.resolve(__dirname, '..', 'js', f))).toBe(true);
  }
  const tpl = fs.readFileSync(path.resolve(__dirname, '..', 'about.template.html'), 'utf8');
  expect(tpl).toMatch(/src="js\/about-cta\.js"/);
});
```

- [ ] **Step 2:** Run (passes immediately — it's a tripwire, like `featuresFreeze`); add a one-line "must stay .js — served unbundled, see tests/about-page.test.js" note at the top of each file.
- [ ] **Step 3: Fix the stale flag comment** (audit intake, 2026-07-16). `js/features.js:11` still reads "TRUE on the feature branch only; flip to false at merge," but Telegram already launched ON on mainline — the flip never happened and is no longer intended. Replace the trailing comment with current reality, keeping the declaration byte-pattern intact (`tests/featuresFreeze.test.js` regexes `export const TELEGRAM_ENABLED = (true|false)` — only the comment may change):

```js
export const TELEGRAM_ENABLED = true; // Live on mainline since the Telegram launch. Spec: docs/superpowers/specs/2026-07-02-telegram-adaptation-design.md
```

Verify: `npx jest tests/featuresFreeze.test.js` → PASS.

- [ ] **Step 4: Commit.** `git commit -m "test(about): tripwire unbundled about scripts as permanent .js; fix stale TELEGRAM_ENABLED comment"`

### Task 1.4: Cheap tail — strip the now-redundant `// @ts-check` pragmas

Deferred cosmetic cleanup from the TS-adoption workstream (audit intake, 2026-07-16): after the global `checkJs: true` flip, per-file `// @ts-check` pragmas are redundant in every file `tsconfig.json` includes. They were deliberately left in place at flip time; remove them in one mechanical sweep now that Wave A/B have shrunk the `.js` population to the pinned survivors.

**Files:**
- Modify: every remaining `.js` under `js/` and `shared/` carrying the pragma (post-Wave-B that is the 4 pinned files plus `shared/*.js`)

- [ ] **Step 1: Enumerate.** `grep -rln "^// @ts-check" js/ shared/ --include='*.js'`
- [ ] **Step 2: Remove the pragma line from each file.** For `shared/*.js`, re-sync the functions mirror afterward: `npm run sync-shared` (the byte-equality guards `tests/sharedMirror.test.js` and `functions/test/shared-mirror.test.js` fail otherwise).
- [ ] **Step 3: Verify** the sweep changed nothing semantically: `npm run typecheck` → 0 errors (checkJs covers these files regardless of pragma); `npx jest` and `cd functions && npm test` → green.
- [ ] **Step 4: Commit.** `git add -A && git commit -m "chore(types): drop redundant per-file @ts-check pragmas (global checkJs covers them)"`

---

## Phase 2 — Consolidate status propagation into one store

The code-level problem (from the analysis): the "effective status = override-on ? override : primary" merge is hand-duplicated in **four** places — `groupNav.paintNavCard` (`groupNav.js:362-366`), `groupContext.memberEffectiveAvailable` (`:131-138`), `groupContext.paintRosterRow` (`:391-403`), `groupContext.renderOwnStatusRow` (`:482-486`); `groupNav` ↔ `groupContext` is a bidirectional import cycle carrying the symmetric optimistic-push pair `applyOptimisticOverride`/`applyOptimisticAppearance`; and the CHIP_VALUES table is copy-pasted between `me.ts:9-40` and `groupContext.js:53-77`. The fix is the codebase's own established pattern: a ref-counted subscribable cache, exactly like `presenceHub.ts`.

### Task 2.1: Extract the pure selector + dedupe CHIP_VALUES

**Files:**
- Create: `js/status.ts`
- Create: `tests/status.test.js`
- Modify: `js/groupNav.ts` (post-Phase-1 name), `js/groupContext.ts`, `js/me.ts`

**Interfaces:**
- Consumes: `PresenceNode`, `StatusOverride` ambient types from `types/app.d.ts`.
- Produces (later tasks and all four call sites rely on these exact signatures):

```ts
// js/status.ts
export type EffectiveStatus = {
  available: boolean;
  statusColor: string | null;
  paletteKey: string | null;
  availableUntil: number | null;
};

// The single merge: override wins iff override.on && !expired(override.availableUntil);
// otherwise primary. Mirrors the client isAvailable predicate (js/utils.ts:86-91) —
// NOT the server's fail-closed variant; the divergence is tripwired by
// tests/presencePredicateParity.test.js and must not be "fixed" here.
export function effectiveStatus(
  primary: PresenceNode | null,
  override: StatusOverride | null,
  now?: number,
): EffectiveStatus;

export const CHIP_VALUES: readonly number[];   // single copy, moved from me.ts:9-40
export function chipIndexForMinutes(minutes: number): number;
```

- [ ] **Step 1: Failing tests.** Table-driven in `tests/status.test.js`: primary-only available/expired/absent; override-on wins including its color/palette; override-on-but-expired falls back to primary; override-off ignored; both-null → all-null/false. Pin one vector per current call site's observable behavior *before* refactoring (read each of the four sites and encode what it does today — if the four disagree, STOP and surface the disagreement rather than picking one).
- [ ] **Step 2: Implement `js/status.ts`.** Move (not copy) `CHIP_VALUES`/`chipIndexForMinutes` from `me.ts`; delete the copy in `groupContext`.
- [ ] **Step 3: Replace the four merge sites** with `effectiveStatus(...)` calls, one commit per site, full `npx jest` between each.
- [ ] **Step 4: Phase gate + commit.**

### Task 2.2: Build `statusStore.ts` (subscribable own-status + per-group overrides)

**Files:**
- Create: `js/statusStore.ts`
- Create: `tests/statusStore.test.js`

**Interfaces:**
- Consumes: `watchPresence` (via `presenceHub.ts`), `watchOwnMemberOverride` (`js/db/groups.ts`), `effectiveStatus` from Task 2.1.
- Produces:

```ts
// js/statusStore.ts — modeled on presenceHub.ts: ref-counted underlying
// watches, last-value cache, async replay to late subscribers, _forTests reset.
export type StatusSnapshot = EffectiveStatus & { source: 'primary' | 'override' };

export function initStatusStore(myUserId: string): void;
export function subscribeOwnStatus(
  groupId: string | null,                          // null = Direct context
  cb: (snap: StatusSnapshot) => void,
): () => void;                                     // returns unsubscribe
export function pushOptimistic(
  groupId: string | null,
  partial: Partial<StatusSnapshot>,
): void;                                           // local echo until server tick confirms
export function _resetStatusStoreForTests(): void;
```

- [ ] **Step 1: Failing tests** — subscribe/replay/refcount semantics copied from `tests/presenceHub`-style coverage: late subscriber gets cached value async; last unsubscribe tears down the underlying watch; `pushOptimistic` fires subscribers immediately and is superseded by the next server tick; re-entrancy (a subscriber that unsubscribes mid-fan-out) doesn't skip peers — mirror `presenceHub.ts:43-44`'s copy-the-set guard.
- [ ] **Step 2: Implement.** ~120 lines; no new dependency.
- [ ] **Step 3: Phase gate + commit.** Store exists but nothing consumes it yet — intentionally a standalone, reviewable unit.

### Task 2.3: Migrate the optimistic pair onto the store; break the groupNav ↔ groupContext cycle

⚠️ **Write a dedicated plan before executing** (superpowers:writing-plans). Contract pinned here: after this task, `groupContext` no longer imports `applyOptimisticAppearance`/`subscribeOwnOverride` from `groupNav`, and `groupNav` no longer imports `applyOptimisticOverride` from `groupContext` — both call `subscribeOwnStatus`/`pushOptimistic` instead; the object-spread echo-preservation hacks (`groupNav.js:395-404`, `groupContext.js:1186-1190,1203-1205,1255-1257`) are deleted (the store's optimistic layer owns that concern); existing tests in `tests/groupNav.test.js`/`tests/groupContext.test.js` keep passing with mocks pointed at `statusStore` instead of the cross-module functions.

- [ ] Dedicated plan written and executed; cycle gone (verify: `grep -n "from './groupContext" js/groupNav.ts` and inverse return only type imports or nothing).

### Task 2.4: Decompose `app.js main()` boot ordering

⚠️ **Write a dedicated plan before executing.** Contract: the ~343-line `main()` (`app.js:590-933`) becomes explicit named stages (`resolveIdentity → initStores → redeemInvites → startSubscriptions → initSurfaces`), where every "must run before" comment (`app.js:646-657, 669-679, 804-810`) is replaced by an actual data dependency (a stage consumes the previous stage's return value). `initStatusStore` runs in `initStores`, which is what lets `initOwnStatus`'s registration-order fan-out (`ownStatus.ts:10-15`) retire. Existing boot tests (`tests/app-boot-cacheOwner.test.js`, `tests/app-first-follow.test.js`, `tests/app-call-recovery.test.js`) must pass unmodified.

- [ ] Dedicated plan written and executed.

---

## Phase 3 — Extend typecheck coverage to the backend and build scripts

Functions stay JavaScript. **Decision record:** `functions/` runs Node directly (`"type":"module"`, no build step); converting to `.ts` would add a compile step to two deploy workflows and the emulator path for marginal gain — the handler code is already dependency-injected and heavily tested. Strict `checkJs` delivers most of the type value at zero deploy risk. Revisit only if a functions-side type bug escapes to prod.

### Task 3.1: Bring `functions/` subdirs and `scripts/` under `tsc --noEmit`

**Files:**
- Modify: `tsconfig.json:15`
- Modify: whichever `functions/**` and `scripts/*.js` files surface errors (annotation-only changes)

- [ ] **Step 1: Widen include** — `tsconfig.json`:

```json
"include": ["js/**/*", "shared/**/*", "types/**/*", "functions/**/*.js", "scripts/**/*.js"],
"exclude": ["functions/node_modules", "functions/test", "node_modules"]
```

(`functions/test` excluded first pass — mock-heavy test files are the noisiest; fold them in as a follow-up if the error count is manageable.)

- [ ] **Step 2:** `npm run typecheck`; triage. Expect errors concentrated in `functions/telegram*.js` (largest surface) and the one-off scripts (`migrate-presence.js`, `repair-user-groups.js`, `audit-available-null.js`). Fix with JSDoc annotations only — zero behavior changes, zero suppressions. If a one-off migration script is genuinely dead, deleting it is preferable to annotating it — but confirm with the maintainer before deleting anything not created in this workstream.
- [ ] **Step 3:** Do NOT add `// @ts-check` pragmas to files gaining coverage — global `checkJs` already applies to every included file, and Task 1.4 strips the redundant pragmas repo-wide (any pragma landing in `functions/_shared/` would also break the byte-equality mirror guard against a pragma-free `shared/`). Full quartet, commit per file-cluster: `git commit -m "chore(types): extend strict checkJs to functions subdirs and scripts"`

---

## Phase 4 — Explicit non-goals (decision record, no work)

Recorded so future sessions don't relitigate:

- **No framework migration** (React/Svelte/Solid/lit). The reconciler + 23.5k LOC of jsdom tests + the `db.js` mock seam are working assets; Phase 2 addresses the actual pain (derived-state propagation) at ~1% of the cost. Revisit trigger: a major new UI surface (e.g., a feed or editor) that the reconciler pattern can't express.
- **No canvas sync rework.** The 80ms cumulative rebroadcast and O(strokes) redraw are fine for two-person sessions. Revisit trigger: measured jank in a real session or >2 participants per canvas.
- **No backend replacement.** The transaction/rules/emulator-test investment is the most battle-hardened part of the codebase. Revisit trigger: sustained scale beyond small-graph usage (per-follower fan-out cost) — a product decision, not a tech one.
- **No rules-side `available ⇒ availableUntil` invariant** (audit intake, 2026-07-16). `database.rules.json` does not enforce that `status: 'available'` implies a numeric `availableUntil`; this is an accepted decision, not an omission. The divergent input is unreachable from shipped writers, the server predicate fails closed on it (`functions/presence-core.js`), and `tests/presencePredicateParity.test.js` is the standing tripwire that fires loudly if any writer ever emits `available` with a null `availableUntil`. Revisit trigger: that tripwire firing, or a new presence writer added outside the current client/functions code paths.

---

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| A `.js`→`.ts` rename silently changes `jest.mock` interception | 1 | moduleNameMapper covers it, but run the file's biggest consumer tests explicitly per rename; one commit per file for clean bisection |
| Conversion "improves" logic and shifts behavior | 1 | Hard rule: no test-file edits in conversion commits; any red test reverts the conversion step |
| The four merge sites *disagree* today (latent bug) | 2.1 | Step 1 pins current behavior per site before unifying; a disagreement halts the task and gets surfaced, not silently resolved |
| Store migration destabilizes the optimistic-echo UX | 2.3 | Store lands dark in 2.2 (no consumers); 2.3 has its own plan + the existing groupNav/groupContext suites as a behavioral net |
| Widened tsconfig floods typecheck with functions errors | 3 | `functions/test` excluded first pass; annotation-only fixes; cluster commits |
| `main()` decomposition breaks an undocumented ordering dependency | 2.4 | The three boot test files gate it; every ordering comment must map to an explicit data dependency in the new structure before the old comment is deleted |

## Effort estimate (PR-sized units)

- Phase 0: 1 small PR.
- Phase 1: 13 rename commits + 2 cheap-tail tasks (1.3 tripwire/comment fix, 1.4 pragma sweep) ≈ 2–4 sessions (Wave A ~1, Wave B ~2–3; `following.js` and `app.js` are half a session each; 1.3/1.4 minutes each). Ships as 2–3 PRs (per wave, cheap tail riding along).
- Phase 2: 2.1 + 2.2 ≈ 1 session each; 2.3 + 2.4 ≈ 1–2 sessions each *after* their dedicated plans. 3–4 PRs.
- Phase 3: 1 session, 1 PR.
- Total: roughly 8–11 working sessions across ~7–9 PRs, each independently shippable.
