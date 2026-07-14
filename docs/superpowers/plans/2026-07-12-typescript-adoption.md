# Gradual TypeScript Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The executing agent is assumed to be an opus-class model; per-task implementers get only their own task — the Interfaces blocks carry the cross-task contracts.

**Goal:** Static type coverage across the client (`js/` — gradual `.ts` conversion via esbuild) and Cloud Functions (`functions/` — JSDoc + `@ts-check`, no build step), with a blocking `npm run typecheck` in CI, at zero runtime/deploy change.

**Architecture:** Erasure-only TypeScript per the spec (`docs/superpowers/2026-07-11-stack-analysis-and-migration-roadmaps.md`, Document 1). esbuild already compiles `.ts` natively and resolves `import './x.js'` to `x.ts`, so the bundle pipeline does not change. Type-checking is a separate `tsc --noEmit` command — never in the build or the red→green test loop. Two tracks: client files convert to `.ts` (strict); functions files stay `.js` with `// @ts-check` + JSDoc because they deploy source-as-is to Node 22 with no compile step.

**Tech Stack:** `typescript` (noEmit), `@babel/preset-typescript` (Jest transform), esbuild (unchanged), Jest `moduleNameMapper` for `.js`→`.ts` specifier resolution.

## Global Constraints

- **Baseline / branch (as-executed, supersedes the original "cut from `dev`"):** the work runs on `claude/typescript-adoption-phase-0-ayufgd`, cut from the shared-package branch `claude/shared-package-migration-t39ls8` (tip `6fcd5ec`) — NOT from `dev`. Rationale: `dev` lacks the shared-package Tasks 1–2 that `js/utils.js` + `js/notifyRouting.js` conversions hard-depend on; that ordering is satisfied only on this branch (see `docs/HANDOFF.md`). Do not merge to `dev`/`main`; do not open PRs. The maintainer merges `t39ls8`→`dev`→`main` separately.
- **TypeScript version — pinned to 7.x (DECISION 2026-07-13, operator-approved):** `npm install typescript` resolves to `7.0.2`, the native (Go) compiler. The project uses it checker-only (`tsc --noEmit`; esbuild owns emit), which is the native port's most mature surface — it exited 0 on the Phase-0 scaffold. Adopting the current major now avoids a later 5→7 migration for this greenfield TS work. WATCH: the strict annotations in Tasks 2–7 were authored against classic `tsc`; the native compiler targets behavioral parity but is younger, so treat any surprising strict-mode diagnostic as possibly a compiler quirk, not only a source bug — the first real signal lands at Task 3's conversion. Pinning back to `typescript@5` is a one-line `package.json` change if drift shows up. `@babel/preset-typescript` is pinned to `^7` (its `latest` 8.x demands `@babel/core@^8`; this repo is on Babel 7).
- **Ordering with the shared-package plan** (`2026-07-12-shared-package-migration.md`): that plan runs FIRST in full (hard requirement for `js/utils.js` and `js/notifyRouting.js`, whose converted forms below assume the shared imports exist). `shared/` files are **never converted to `.ts`** — they must stay plain `.js` because `functions/_shared/` runs on bare Node ESM (spec wargame W7); they get types via JSDoc in Task 5's pass.
- **Test commands:** web suite = `node_modules/.bin/jest` from repo root (NOT bare `npx jest`); functions suite = `cd functions && npm test`. All green before every commit; `npm run build` clean where a task says so; `npm run typecheck` clean from Task 1 onward.
- **Conversion commits are type-only.** If the checker exposes a genuine behavioral bug, STOP, report it to the operator, and leave the fix out of the conversion commit (spec wargame W4). Never fix-and-convert in one diff.
- **Frozen files — never convert:** `js/features.js` (`scripts/build.js:111-118 readTelegramEnabled()` reads its SOURCE TEXT with a silent fail-closed `catch` — renaming the file would silently disable the Telegram CTA on the built about page, with no build error). Also never touch the CSP-hashed inline `<head>` script in `about.template.html` (not bundled; changing its bytes breaks the CSP hash in `firebase.json`).
- **Per-file strictness demotion is allowed** (spec wargame W3): if a conversion's own errors exceed a session's budget, keep the file `.js` with `// @ts-check` + targeted `// @ts-expect-error` markers and move on — the ratchet is monotonic, not per-file-perfect.
- Fresh container setup: `apt-get update && apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev` before `npm ci`; then `cd functions && npm ci`.

---

### Task 1: Phase 0 — toolchain scaffold (zero source changes)

**Files:**
- Create: `tsconfig.json`
- Modify: `package.json` (devDependencies + `typecheck` script)
- Modify: `babel.config.js`
- Modify: `jest.config.js`
- Modify: `tests/cacheOwner.test.js:~121` (drift-scan walk gains `.ts`)
- Modify: `.github/workflows/deploy-dev.yml` and `.github/workflows/deploy-prod.yml` (test job gains a typecheck step)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run typecheck` (→ `tsc --noEmit`, blocking in CI); a Jest config that transforms `.ts` and resolves `./x.js` specifiers to `x.ts`; a drift-scan that cannot go blind on converted files. Every later task assumes these exist.

**This is the highest-blast-radius commit of the plan (spec wargame W1) — which is exactly why it contains no source changes: if anything breaks, the diff to inspect is a handful of config lines.**

> **DONE 2026-07-13 — committed `150cf99`, pushed to `origin/claude/typescript-adoption-phase-0-ayufgd`.** All 7 steps below complete; four-command gate green (typecheck exit 0, web 1720/1720, functions 358/358, build clean). `typescript@7.0.2` + `@babel/preset-typescript@^7` installed (see the version-decision Global Constraint). Next session starts at Task 2.

- [x] **Step 1: Install dev dependencies and add the script**

Run: `npm install --save-dev typescript "@babel/preset-typescript@^7"` (pin the preset to 7.x — Babel-7 peer; `typescript` resolves to 7.x per the version decision above).

In `package.json` `"scripts"`, add:

```json
    "typecheck": "tsc --noEmit"
```

- [x] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowJs": true,
    "checkJs": false,
    "noEmit": true,
    "strict": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "lib": ["es2022", "dom", "dom.iterable"]
  },
  "include": ["js/**/*", "shared/**/*", "types/**/*"]
}
```

Rationale pinned here so nobody "improves" it later: `checkJs: false` means un-annotated `.js` is parsed but not checked — files opt in with `// @ts-check` (the gradual ratchet); `strict: true` applies in full to every `.ts` file from day one; `isolatedModules` keeps everything esbuild-compilable (no const-enum/namespace tricks); `noEmit` because esbuild owns output. `functions/` is deliberately NOT included yet — Task 5 adds it.

- [x] **Step 3: Teach Babel and Jest about `.ts`**

Replace `babel.config.js` with:

```js
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-typescript',
  ],
};
```

Replace `jest.config.js` with:

```js
module.exports = {
  testEnvironment: 'jsdom',
  transform: { '^.+\\.(js|ts)$': 'babel-jest' },
  // ESM source uses extensionful relative specifiers (./x.js). esbuild resolves
  // ./x.js to x.ts once a module converts; this mapper makes Jest do the same:
  // strip the .js and let the resolver try .js then .ts (moduleFileExtensions
  // covers both by default). JSON/fixture imports are untouched (.json).
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  passWithNoTests: true,
  // functions/ has its own node-env Jest config; keep the two toolchains separate.
  // tests/rules/ uses the database emulator (jest.rules.config.js); keep it out of the default suite.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/functions/', '/tests/rules/'],
  setupFilesAfterEnv: ['./tests/setup-globals.js'],
};
```

(The functions suite — `functions/jest.config.js`, `transform: {}` bare Node ESM — is NOT touched; the mapper lives only in the root config.)

- [x] **Step 4: Un-blind the cacheOwner drift-scan (spec Doc 1 landmine #2)**

In `tests/cacheOwner.test.js`, in the `walk` inside the `'every statusapp_ key in js/ is classified (no silent drift)'` test, change:

```js
    return e.isFile() && e.name.endsWith('.js') ? [full] : [];
```

to:

```js
    return e.isFile() && /\.(js|ts)$/.test(e.name) ? [full] : [];
```

This MUST land in Phase 0, before any file converts: a scan that silently skips `.ts` files is a guard that goes blind with no red test (the worst failure class — false green).

- [x] **Step 5: Make typecheck blocking in CI**

In BOTH `.github/workflows/deploy-dev.yml` and `.github/workflows/deploy-prod.yml`, in the `test` job, after the `- run: npm run test:rules` step, add:

```yaml
      - run: npm run typecheck
```

(The `test` job already gates the `deploy` job via `needs: test` — typecheck failures now block deploys with zero pipeline redesign.)

- [x] **Step 6: Verify everything is exactly as green as before**

Run: `npm run typecheck`
Expected: exits 0, no output (no `.ts` files exist; `.js` files are parsed, not checked).

Run: `node_modules/.bin/jest`
Expected: ALL tests pass — same count as before this task. Any new failure is a mapper/transform collision (spec wargame W1): inspect whether a test uses `jest.mock('./x.js')`-style exact specifiers and fix the config, not the test.

Run: `cd functions && npm test`
Expected: all green, untouched.

Run: `npm run build`
Expected: clean. (Config-only change — the bundle input set is identical.)

- [x] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json babel.config.js jest.config.js tests/cacheOwner.test.js .github/workflows/deploy-dev.yml .github/workflows/deploy-prod.yml
git commit -m "chore(ts): typecheck toolchain scaffold — tsc noEmit, babel/jest ts support, CI gate"
```

---

### Task 2: Phase 1 — ambient contract types + `@ts-check` on the drift seams

**Files:**
- Create: `types/app.d.ts`
- Modify: `js/notifySuppression.js`, `js/notifyChannel.js`, `js/prefs.js`, `js/inviteFlow.js` (add `// @ts-check` + JSDoc; no behavior)

**Interfaces:**
- Consumes: Task 1's toolchain.
- Produces: global ambient types `UserPrefs`, `PresenceNode`, `StatusOverride` usable from JSDoc as `{UserPrefs}` etc. in any file (`.d.ts` with no top-level import/export = global ambient). Later tasks annotate against these names.

> **DONE 2026-07-13 — committed `124c31c`.** All 6 steps complete; four-command gate green. `types/app.d.ts` carries the three planned interfaces PLUS the Step-1 extension fields `js/prefs.js syncFromServer` reads (hints/counters/favorites/paletteState/perGroup/notify — a `NotifyPrefsEntry` interface was added for the per-target notify records), and a narrow `declare const process` for the esbuild-define seam (`js/inviteFlow.js` — the native tsc 7 did not auto-include `@types/node` until Task 5's include-widening, and the narrow declaration is the honest type for browser code either way; no conflict appeared when node types later loaded).

- [x] **Step 1: Verify the shapes before writing them down**

The typedefs below were drafted from `js/notifySuppression.js`, `js/notifyChannel.js`, and `functions/notifier.js` at planning time. Before creating the file, confirm each field against the live source:

Run: `grep -rn "prefs\.\|prefs?\." js/notifyChannel.js js/notifySuppression.js js/prefs.js | grep -o "prefs?*\.[a-zA-Z]*" | sort -u`
Expected fields to account for: `notifyChannel`, `telegram`, `pushTokens` (plus whatever `js/prefs.js` reads — extend the typedef with any extra fields found, typed from how they're used).

- [ ] **Step 2: Create `types/app.d.ts`**

```ts
// types/app.d.ts — ambient shapes for the RTDB contract seams. Global (no
// import/export at top level) so plain-JS files can reference them from JSDoc
// as {UserPrefs} etc. without importing. These document the WIRE shapes —
// everything is optional/nullable because RTDB nodes can be absent.

/** users/{uid}/userPrefs — the cross-device account prefs node. */
interface UserPrefs {
  /** Linked-Telegram marker: non-null iff the account is linked (set on link,
   * cleared on unlink). The three-reader notify contract keys off this plus
   * notifyChannel — see shared/notifyDelivery.js. */
  telegram?: object | null;
  /** Delivery channel. MISSING/unknown reads as 'telegram' for a linked
   * account (only an explicit 'push' opts out) — shared/notifyDelivery.js. */
  notifyChannel?: string | null;
  /** Registered web-push registrations, keyed by token id. */
  pushTokens?: Record<string, unknown> | null;
}

/** users/{uid}/presence-shaped nodes (primary presence, and the presence half
 * of a group statusOverride). */
interface PresenceNode {
  status?: string | null;
  /** Epoch ms end of the availability window; null/absent = open-ended on the
   * client, NOT-available to the server notifier — the pinned divergence in
   * tests/presencePredicateParity.test.js. */
  availableUntil?: number | null;
}

/** groups/{gid}/members/{uid}/statusOverride — per-audience status. */
interface StatusOverride extends PresenceNode {
  /** The bot/server only honor the override when enabled === true. */
  enabled?: boolean | null;
}
```

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Enable `@ts-check` on the two known seams (concrete annotations)**

In `js/notifySuppression.js`: add `// @ts-check` as the very first line, and annotate `botDelivered`:

```js
/** @param {UserPrefs | null | undefined} prefs */
export function botDelivered(prefs) {
```

and `syncBotDelivery`:

```js
/** @param {UserPrefs | null | undefined} prefs */
export function syncBotDelivery(prefs) {
```

In `js/notifyChannel.js`: add `// @ts-check` as the first line, annotate module state and the seam functions:

```js
/** @type {UserPrefs | null} */
let lastPrefs = null;
```

```js
/** @param {UserPrefs | null | undefined} prefs */
function isLinked(prefs) {
```

```js
/**
 * @param {string} userId
 * @param {UserPrefs} prefs
 */
export function syncNotifyChannel(userId, prefs) {
```

Run: `npm run typecheck` after each file.
Expected: errors will surface (DOM nullability, event-target casts). Resolve them with JSDoc types and `/** @type {...} */` casts ONLY — zero behavior change. If an error reveals a genuine bug (a truly-impossible branch, a misspelled property), STOP and report per the Global Constraints.

- [ ] **Step 4: Enable `@ts-check` on `js/prefs.js` and `js/inviteFlow.js`**

Same procedure: `// @ts-check` first line; annotate every exported function's params/returns with JSDoc, using the ambient types where prefs/presence shapes flow through; add local `@type` casts until `npm run typecheck` is clean. These two files weren't fully enumerated at planning time — read them first; if either exceeds ~20 unresolvable errors, apply the demotion policy (targeted `// @ts-expect-error` with a one-line reason each) rather than stalling.

- [ ] **Step 5: Full suites + build (annotations are comments — nothing may move)**

Run: `node_modules/.bin/jest` && `cd functions && npm test` && `npm run build` && `npm run typecheck`
Expected: all green, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add types/app.d.ts js/notifySuppression.js js/notifyChannel.js js/prefs.js js/inviteFlow.js
git commit -m "chore(ts): ambient contract types + @ts-check on the notify/prefs/invite seams"
```

---

### Task 3: Phase 2 — first `.ts` conversion, fully worked (`js/notifyRouting.js`)

> **DONE 2026-07-13 — committed `94927e7`.** `git mv` + type-only edit; `tests/idFormats.test.js` path reads updated `.js`→`.ts` in the same commit. Four-command gate green; SW cache hash unchanged (`knockknock-5184e1543935`), confirming byte-identical emit after type-strip. Native tsc 7 raised no strict-mode surprises on the first real conversion.

**Files:**
- Rename: `js/notifyRouting.js` → `js/notifyRouting.ts` (git mv, then edit)
- Test: existing `tests/notifyRouting.test.js` (unchanged)

**Interfaces:**
- Consumes: Task 1's toolchain; the shared-package plan's Task 5 (`notifyRouting` imports `GROUP_ID_RE` from `../shared/idFormats.js` — this plan runs after that one).
- Produces: `js/notifyRouting.ts` exporting `routeNotificationClick(data, deps): void` with the exact same runtime behavior; the template for every later conversion (the recipe in Task 4 refers to the steps here by structure, and repeats them in full).

- [ ] **Step 1: Sweep for source-path readers BEFORE renaming (spec Doc 1 landmine #3)**

Run: `grep -rn "notifyRouting" tests/ scripts/ functions/ js/ sw.template.js firebase.json 2>/dev/null`
Expected: importers using `./notifyRouting.js` specifiers (fine — esbuild and the Jest mapper resolve them to `.ts`) and test imports. If ANY hit reads the file as a PATH (`readFileSync`, a fixture list, a build script), that reader must be updated in this same commit — list every such hit in the task notes before proceeding.

- [ ] **Step 2: Rename and type**

Run: `git mv js/notifyRouting.js js/notifyRouting.ts`

Then edit the file to (complete converted content — body unchanged, types added):

```ts
// js/notifyRouting.ts
// Warm-path routing for a tapped notification (the SW postMessages the click to
// a focused client; see sw.template.js). Kept dependency-injected and pure so it
// can be unit-tested without booting app.js.
//
// Invite / follow-request taps land the user in Direct first, THEN open the
// Inbox — so closing the modal returns to Direct rather than the (possibly
// group) context they were in. This mirrors the cold-start path, where boot
// skips the last-context restore and opens the Inbox over Direct.
// Direct-scope activity (a knock/call/availability with no contextGroupId) also
// returns to Direct, where that activity surfaces (#144). Group activity (a
// contextGroupId) navigates into the group; unknown types are a no-op.
// Group ids are exactly 8 chars of [A-Z0-9] (groups.js generateGroupId). The
// notification payload is attacker-controllable (forged RTDB writes), so reject
// anything that doesn't match before using it as a navigation target — a forged
// id falls back to Direct rather than reaching navigateToGroup (#164 R3c).
import { GROUP_ID_RE } from '../shared/idFormats.js';

type NotificationData = {
  type?: string;
  contextGroupId?: string;
};

type RouteDeps = {
  navigateToDirect: () => void;
  navigateToGroup: (gid: string) => void;
  openInboxModal: () => void;
};

export function routeNotificationClick(
  data: NotificationData | null | undefined,
  { navigateToDirect, navigateToGroup, openInboxModal }: RouteDeps,
): void {
  const type = data?.type;
  if (type === 'invite' || type === 'followRequest') {
    navigateToDirect();
    openInboxModal();
    return;
  }
  const gid = data?.contextGroupId;
  if (gid && GROUP_ID_RE.test(gid)) { navigateToGroup(gid); return; }
  if (type === 'knock' || type === 'call' || type === 'availability') navigateToDirect();
}
```

(If the file's current content differs from this planning-time snapshot — e.g. the shared-package plan changed the comment trim — preserve the live comments/body verbatim and add ONLY the type syntax. The rule for every conversion: the JS emitted after type-stripping must be the code that was already there.)

- [ ] **Step 3: Verify — typecheck, suites, build**

Run: `npm run typecheck` → exits 0.
Run: `node_modules/.bin/jest` → all green — `tests/notifyRouting.test.js` passes UNCHANGED through the `.js`→`.ts` mapper; `tests/idFormats.test.js`'s source-scan of `js/notifyRouting.js`… **will FAIL** — it reads the file by path. This is the Step-1 sweep in action: update `tests/idFormats.test.js` in this commit — change both `read('js/notifyRouting.js')` occurrences to `read('js/notifyRouting.ts')`.
Re-run: `node_modules/.bin/jest` → all green.
Run: `npm run build` → clean (esbuild picks up the `.ts` transparently).

- [ ] **Step 4: Commit**

```bash
git add js/notifyRouting.ts tests/idFormats.test.js
git commit -m "refactor(ts): convert js/notifyRouting to TypeScript"
```

(`git mv` + edit shows as rename in the diff; `js/notifyRouting.js` is gone.)

---

### Task 4: Phase 2 — leaf-module conversion batch

> **DONE 2026-07-13 — commits `4ddd45e`..`utils`.** Freeze guard `tests/featuresFreeze.test.js` landed first (`4ddd45e`). Converted one commit each: inviteText, telegramLinkCopy, hintRotation, palettes, inviteBootGate, utils. **`js/wordlist.js` DEMOTED, not converted** (`f`-commit): it's CommonJS (`module.exports`, consumed via `require` from `js/identity.js`), so a `.ts` rename would force an ESM rewrite the type-only rule forbids — kept `.js` + `// @ts-check`, and `scripts/gen-wordlist.js` now emits the pragma so a regen can't strip it. `js/features.js` untouched (frozen). Full gate + functions suite green at batch end.

**Files (one commit per module, in this order):**
- Rename: `js/inviteText.js` → `.ts`
- Rename: `js/telegramLinkCopy.js` → `.ts`
- Rename: `js/hintRotation.js` → `.ts`
- Rename: `js/wordlist.js` → `.ts`
- Rename: `js/palettes.js` → `.ts`
- Rename: `js/inviteBootGate.js` → `.ts`
- Rename: `js/utils.js` → `.ts`
- Create: `tests/featuresFreeze.test.js` (the `features.js` freeze guard)
- NEVER rename: `js/features.js` (frozen — Global Constraints)

**Interfaces:**
- Consumes: Tasks 1–3 (toolchain, ambient types, the conversion pattern proven in Task 3).
- Produces: seven converted leaf modules with unchanged public APIs; a guard test that makes the `features.js` freeze enforceable instead of tribal knowledge.

- [ ] **Step 1: Add the `features.js` freeze guard FIRST**

Create `tests/featuresFreeze.test.js`:

```js
/** @jest-environment node */
// js/features.js is FROZEN as .js: scripts/build.js readTelegramEnabled()
// reads its SOURCE TEXT with a silent fail-closed catch — if the file is
// renamed (e.g. a TypeScript conversion) or the flag line is reworded, the
// build does NOT fail; it silently disables the Telegram CTA on the built
// about page. This test turns that silent failure into a red suite.
const fs = require('fs');
const path = require('path');

test('js/features.js exists as .js and spells TELEGRAM_ENABLED the way scripts/build.js parses it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'features.js'), 'utf8');
  // The EXACT regex from scripts/build.js readTelegramEnabled():
  expect(src).toMatch(/export const TELEGRAM_ENABLED = (true|false)/);
});
```

Run: `node_modules/.bin/jest tests/featuresFreeze.test.js` → PASS.
Commit:

```bash
git add tests/featuresFreeze.test.js
git commit -m "test(ts): freeze guard — features.js must stay parseable by scripts/build.js"
```

- [ ] **Step 2: Convert the modules, one commit each, using this exact recipe**

For EACH module `X` in the Files order above:

1. **Sweep for path readers:** `grep -rn "X" tests/ scripts/ functions/ js/ sw.template.js 2>/dev/null | grep -v "from '\./"` — any `readFileSync`/path-literal hit gets updated in the same commit (this is how Task 3 caught `tests/idFormats.test.js`; expect `tests/presencePredicateParity.test.js` to import `../js/utils.js` — the Jest mapper resolves that to `utils.ts` automatically, imports are NOT path-reads).
2. **Rename:** `git mv js/X.js js/X.ts`
3. **Add types only:** annotate exported function signatures, module-level `let`/`const` state, and internal helpers; use the ambient `UserPrefs`/`PresenceNode` types where those shapes flow through; `strict` applies. The stripped output must be the code that was already there — no logic edits, no "while I'm here" cleanups (spec wargame W6).
4. **Typecheck:** `npm run typecheck` → 0.
5. **Full web suite:** `node_modules/.bin/jest` → all green.
6. **Build:** `npm run build` → clean.
7. **Commit:** `git add -A js/ tests/ && git commit -m "refactor(ts): convert js/X to TypeScript"`

Module-specific notes (read before converting each):
- `js/utils.js`: converts ONLY after the shared-package plan is fully landed (its formatters are already re-exports of `../shared/timeFormat.js` by then — the import specifier keeps its `.js` extension and keeps pointing at the real `.js` shared file: correct in both esbuild and Jest). `tests/presencePredicateParity.test.js` and `tests/sharedMirror.test.js` must stay green.
- `js/inviteBootGate.js`: pure by design (per its header) but large decision-tree — if annotation friction exceeds the session budget, demote per Global Constraints rather than half-typing it.
- `js/wordlist.js` / `js/palettes.js`: mostly data — near-mechanical; type the exported structures precisely (`readonly string[]`, palette record shapes) since downstream conversions will lean on these types.
- `cd functions && npm test` once at the END of the batch (client-only renames can't affect it, but the gate is cheap): all green.

---

### Task 5: Phase 4 — functions track (`@ts-check` + JSDoc, no build step)

> **DONE 2026-07-13 — commits through `@ts-check functions/index`.** tsconfig `include` widened to `functions/*.js`; `shared/` annotated + `npm run sync-shared` mirrored (both guards green). All 8 functions source files carry `// @ts-check` + JSDoc (order: presence-core, telegram-shared, notifier, invites, auth, telegram-auth, telegram, index). NOTE: widening the include pulled `@types/node` into the program, which retyped `setTimeout` — `js/hintRotation.ts` timer casts moved to `ReturnType<typeof setTimeout>` (committed with the shared/tsconfig change). `functions/telegram.js` got an HONEST `TelegramBotDeps` typedef (only the webhook members index.js actually provides), NOT a re-use of `TelegramAuthDeps`. Byte-identical build verified via worktree rebuild at HEAD (bundle/index/manifest all `cmp`-equal). Functions files still `.js`, deploy-path unchanged. Non-source `functions/*.js` (migrate-presence, repair-user-groups, jest.config) deliberately NOT annotated — not in the include glob.

**Files:**
- Modify: `tsconfig.json` (include functions source)
- Modify, in order: `functions/presence-core.js`, `functions/telegram-shared.js`, `functions/notifier.js`, `functions/invites.js`, `functions/auth.js`, `functions/telegram-auth.js`, `functions/telegram.js`, `functions/index.js` (add `// @ts-check` + JSDoc, one commit per file or per pair)
- Modify: `shared/*.js` (JSDoc annotations — then `npm run sync-shared`)

**Interfaces:**
- Consumes: Tasks 1–2 (toolchain + ambient types).
- Produces: typechecked functions source with ZERO deploy-path change — files stay `.js`, `functions/package.json` untouched, `firebase deploy` ships the same bytes-modulo-comments.

- [ ] **Step 1: Widen the tsconfig include**

In `tsconfig.json`, change the `include` to:

```json
  "include": ["js/**/*", "shared/**/*", "types/**/*", "functions/*.js"]
```

(`functions/*.js` — source files only. NOT `functions/test/**` — the tests use import attributes and heavy mocks; typechecking them buys little and costs much. NOT `functions/_shared/**` — it's a byte-mirror of `shared/`, which is already included; double-checking it would only produce duplicate-symbol noise.)

Run: `npm run typecheck`
Expected: exits 0 — `checkJs: false` means the newly-included files are parsed, not checked, until they opt in.

- [ ] **Step 2: Annotate `shared/` first (both runtimes lean on these types)**

Add `// @ts-check` and JSDoc to each `shared/*.js` file. Complete annotations for the four existing modules:

`shared/timeFormat.js`: above each export:

```js
/** @param {number} ms @returns {string} */
```

`shared/notifyDelivery.js`:

```js
/** @param {string | null | undefined} notifyChannel @returns {boolean} */
export function telegramPreferred(notifyChannel) {
```

`shared/limits.js`:

```js
/** @type {(s: unknown) => string} */
export const clampLabel = (s) => String(s ?? '').slice(0, NAME_CAP);
/** @type {(s: unknown) => string} */
export const clampName = (s) => clampLabel(s).trim();
```

`shared/idFormats.js`: regex consts need no annotation (inferred `RegExp`).

Then: `npm run sync-shared` (JSDoc comments are bytes — the mirror must follow), `npm run typecheck` → 0, both mirror guard tests green.

Commit: `git add tsconfig.json shared/ functions/_shared/ && git commit -m "chore(ts): @ts-check shared/ + include functions source in typecheck"`

- [ ] **Step 3: `@ts-check` the functions files, in the listed order**

Per file: add `// @ts-check` line 1; annotate exported handlers and helpers (`firebase-admin`/`firebase-functions` ship their own types — `skipLibCheck: true` keeps their internals out of scope); use the ambient `UserPrefs`/`PresenceNode`/`StatusOverride` for RTDB payloads; `/** @type {...} */` casts for `snapshot.val()` results. Run `npm run typecheck` after each file; demotion policy applies per file. After each file or pair:

```bash
cd functions && npm test        # all green
cd .. && npm run typecheck      # exits 0
git add functions/<file>.js && git commit -m "chore(ts): @ts-check functions/<file>"
```

Order rationale: `presence-core`/`telegram-shared` are small and mostly re-exports post-shared-migration (cheap wins that seed types for the rest); `notifier` is the delivery spine (annotate carefully, change NOTHING); `telegram.js` is the largest — last, with the demotion policy in easy reach.

- [ ] **Step 4: Full gate**

Run: `node_modules/.bin/jest` && `cd functions && npm test` && `npm run build` && `npm run typecheck`
Expected: all green. `git diff main --stat -- functions/` shows comment-only changes to functions source (plus the Task-5 mirror sync).

---

### Task 6: Phase 3 — db layer + stateful modules (multi-session recipe)

> **IN PROGRESS — session 3, 2026-07-13, commits `7c67a67..588bfc2` (pushed).** db-layer + core stateful trio done, one commit per module: `js/db/canvas.ts`, `js/db/groups.ts`, `js/db/social.ts` converted (type-only; `social.ts` tightened `readPushTokens`' return to the pushTokens-registry shape so `prefs.js`'s `selectStalePushTokens` consumer stays green — no `prefs.js` logic edit). **`js/store.js` + `js/identity.js` DEMOTED, not converted** (`.js`+`// @ts-check`+JSDoc): both are CommonJS (`module.exports`, `require()`d by tests), so a `.ts` rename forces an ESM rewrite the type-only rule forbids — same decision + commit style as `js/wordlist.js` in Task 4 (`chore(ts): @ts-check js/<mod> (demoted…)`). Store's palette/favorites exports stay loose (`any`/`unknown`) because `js/palettes.ts`/`js/prefs.ts` cast at use-sites — narrowing them there breaks those checked consumers. `js/prefs.js` → `js/prefs.ts` (was `@ts-check`+JSDoc; faithful JSDoc→inline translation, identical type program). Full gate green at session end (web 1721, functions 358, build clean, typecheck 0).
>
> **STILL IN PROGRESS — session 4, 2026-07-14, commits `aa99ceb..78d000c` (pushed).** 17 more modules converted (one commit each, all type-only) + 1 prep commit. Converted, in order: `inviteFlow`, `invites`, `favorites`, `firstRun`, `cacheOwner` (drift-scan re-verified green), `notifySuppression`, `notifyChannel`, `graduationPhrase`, `hints`, `telegramLinkArrival`, `phraseReminder`, `telegramEscapeHatch`, `regenFlash`, `notifyDebug`, `installGuidance`, `groupDisplayNamePrompt`, `telegramOnramp`. Prep commit `c0f5a13` (`chore(ts): type showConfirmModal options for .ts consumers`) added a JSDoc `@param` to `js/promptModal.js`'s `showConfirmModal` so `.ts` consumers infer the right options type (its `busyLabel=null`/`onConfirm=null` defaults were inferring as `null`-only) — unblocks every future `.ts` consumer of the shared confirm modal; `promptModal.js` itself stays unchecked. Recurring type-only idioms this session: db reads returning `Record<string, unknown>`/`{}` get cast at the boundary to a local record interface; DOM `querySelector`→`.style`/`.dataset`/`.onclick`/`.value`/`.disabled`/`.offsetWidth` use `querySelector<HTMLElement>` (or `as HTMLElement`/`as HTMLInputElement`/`as HTMLButtonElement`); `null`-initialized `let`s get an explicit union; the `!claimed`-loop token invariant uses `let token!: string`; `catch (e)` accesses use `(e as { code?: string })`; `navigator.standalone` (Safari-only, not in lib.dom) uses `(navigator as Navigator & { standalone?: boolean })`. When narrowing a param type, checked (`.ts`) consumers were verified first (e.g. `hints.shouldShowSwatchWave` kept an `unknown` param + internal cast because `palettes.ts startSwatchHints` passes `unknown`). Full gate green (web 1721, functions 358, build clean, typecheck 0). **NEW LANDMINE — `js/about-*.js` MUST stay `.js`:** `about-invite.js` / `about-cta.js` / `about-telegram.js` are raw `<script src="js/…">` page scripts on `about.html`, OUTSIDE the `js/app.js` esbuild bundle with NO transpile step — renaming to `.ts` would 404 the `/about` page. A distinct "accepted `.js`" reason, like `shared/`. **NEXT unconverted (bundled) feature modules, by ascending DOM-coupling:** the heavier `js/mycode.js` (246L) and `js/me.js` (265L), plus `js/inbox.js`, `js/knock.js`, `js/ownStatus.js`, `js/presenceHub.js`, `js/reconcile.js`, `js/telegramSettings.js`, `js/telegramChrome.js`, `js/telegramFirstRun.js`, `js/notifyBell.js`, `js/notifyPrompt.js`, `js/installAffordance.js`, `js/cardDrawer.js`, `js/recoveryModal.js`, `js/invitePicker.js`, `js/inviteModal.js`, `js/followRequests.js`, `js/graduation.js`, `js/auth.js`, `js/devReset.js`, `js/promptModal.js` (now has typed `showConfirmModal`). **Check each remaining `js/*.js` for `module.exports` FIRST — CJS ones demote, don't `.ts` (`js/installPrompt.js` still CJS).**
>
> **DONE — session 5, 2026-07-14, commits `48e1cf3..02d30f0` (pushed).** Task 6 COMPLETE. Converted the remaining 22 feature modules (one type-only commit each): `mycode`, `me`, `inbox`, `knock`, `ownStatus`, `presenceHub`, `reconcile`, `telegramSettings`, `telegramChrome`, `telegramFirstRun`, `notifyBell`, `notifyPrompt`, `installAffordance`, `cardDrawer`, `recoveryModal`, `invitePicker`, `inviteModal`, `followRequests`, `graduation`, `auth`, `devReset`, `promptModal`. **DEMOTED `js/installPrompt.js`** (CJS → `.js`+`// @ts-check`+JSDoc, kept `module.exports`). Prep commit `48e1cf3` JSDoc-typed `openInviteModal` for the first `.ts` caller (`mycode`); both it and the session-4 `c0f5a13` promptModal bridge are now SUPERSEDED by inline types in `inviteModal.ts`/`promptModal.ts`. New idiom this session: the native checker drops control-flow guard narrowing inside nested functions/closures (`const el = getElementById(...); if (!el) return; …closure uses el`) → assert `el!` at the closure use (the runtime guard still holds). Gate green (web 1721, functions 358, build clean, typecheck 0). Every `js/*.js` that should be `.ts` now is; the remaining `.js` are the Task 7 blockers (see below).

**Files (recipe applies per module; one commit each; sessions may end between modules):**
- Convert, in order: `js/db/*.js` (each file), `js/store.js`, `js/identity.js`, `js/prefs.js` (already `@ts-check` — now full `.ts`), then feature modules by ascending DOM-coupling: `js/inviteFlow.js`, `js/invites.js`, `js/favorites.js`, `js/firstRun.js`, `js/cacheOwner.js`, `js/notifySuppression.js`, `js/notifyChannel.js`, …
- May stay `@ts-check`-JSDoc indefinitely (legitimate end-state, spec Phase 3): `js/app.js`, `js/following.js`, `js/groupNav.js`, `js/canvas.js`, `js/groups.js`

**Interfaces:**
- Consumes: everything above; the Task 4 recipe verbatim.
- Produces: typed core; each module conversion is independently shippable and revertable.

- [ ] **Step 1 (repeated per module): run the Task 4 Step-2 recipe exactly** — sweep for path readers (the `cacheOwner` drift-scan reads `js/` recursively but by CONTENT match, already `.ts`-aware from Task 1; the `statusapp_*` classification lists live in `js/cacheOwner.js` — when converting THAT file, re-run `node_modules/.bin/jest tests/cacheOwner.test.js` with extra attention), rename, type, `npm run typecheck`, full web suite, `npm run build`, commit `refactor(ts): convert js/<module> to TypeScript`.

- [ ] **Step 2 (once per session working this task): end-of-session gate** — full four-command gate (both suites, build, typecheck) from a clean tree; update the plan checkboxes; note the next unconverted module in the session handoff.

---

### Task 7: Phase 5 — ratchet close-out + docs

**Files:**
- Modify: `tsconfig.json` (flip `checkJs` once the exempt list is empty)
- Modify: `docs/HANDOFF.md` (landmines + conventions)
- Modify: `README.md` (Tech Stack)

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: the end-state policy, written down where the next session finds it.

- [~] **Step 1: Flip the ratchet IF AND ONLY IF every remaining `.js` under `js/` and `functions/*.js` carries `// @ts-check` and is clean** — change `"checkJs": false` to `"checkJs": true` in `tsconfig.json` and delete the now-redundant per-file `// @ts-check` pragmas. If ANY file still relies on being unchecked, skip this step and record which files block it. Run the full four-command gate either way.
  > **SKIPPED — session 5, 2026-07-14. Precondition NOT met, so `checkJs` stays `false`.** 13 `js/*.js` + 3 `functions/*.js` are still plain unchecked `.js` with no `// @ts-check`; flipping `checkJs:true` would check all of them and fail. BLOCKERS (each needs `@ts-check` + a clean pass first): `js/app.js`, `js/following.js`, `js/groupNav.js`, `js/canvas.js`, `js/groups.js` (the "accepted-`@ts-check`-forever" set — the pragma was never actually added), `js/groupContext.js`, `js/db.js`, `js/telegram.js`, `js/firebase-config.js`, `js/features.js` (FROZEN as `.js`, but a `// @ts-check` comment is safe), `js/about-cta.js`/`js/about-invite.js`/`js/about-telegram.js` (MUST stay `.js`; `@ts-check` is fine); `functions/jest.config.js`, `functions/migrate-presence.js`, `functions/repair-user-groups.js`. These are unconverted core files OUTSIDE Task 6's feature-module scope — a distinct, non-trivial follow-up. Gate re-run green either way (web 1721, functions 358, build clean, typecheck 0).

- [ ] **Step 2: Guard-test disposition — keep them all.** Explicit review outcome expected by the spec (Phase 5): `time-format-vectors.json` (pins shared behavior), `notify-channel-vectors.json` (same), `tests/name-cap-invariant.test.js` + `tests/idFormats.test.js` (span into `database.rules.json`, which types cannot see), `tests/sharedMirror.test.js` + twin (byte-mirror freshness), `tests/cacheOwner.test.js` drift-scan (content contract, not shape), `tests/featuresFreeze.test.js` (build-script text contract), `tests/presencePredicateParity.test.js` (cross-runtime behavior pin). None of these is subsumed by types; retiring any of them requires an operator decision, not a cleanup commit.

- [ ] **Step 3: Document the conventions**

`docs/HANDOFF.md` landmine additions:

```markdown
- TypeScript is erasure-only: esbuild compiles .ts directly; `npm run typecheck` (tsc --noEmit) is the checker and blocks CI's deploy job. New client modules are .ts; functions stay .js + `// @ts-check` (they deploy source-as-is). `js/features.js` is FROZEN as .js (scripts/build.js parses its source text, fail-closed silently — guarded by tests/featuresFreeze.test.js). shared/ stays .js + JSDoc forever (the functions mirror runs bare Node ESM).
```

`README.md` Tech Stack: change the first bullet to:

```markdown
- **Vanilla JS + gradual TypeScript** (ES modules, bundled with esbuild — no framework; `tsc --noEmit` typecheck in CI)
```

- [ ] **Step 4: Final gate + commit**

Run: `node_modules/.bin/jest` && `cd functions && npm test` && `npm run build` && `npm run typecheck` → all green.

```bash
git add tsconfig.json js/ docs/HANDOFF.md README.md
git commit -m "chore(ts): checkJs ratchet close-out + conventions documented"
```

---

## Plan-wide done criteria

- Tasks 1–5 fully complete; Task 6 may span sessions (each module independently done); Task 7 closes the ratchet.
- Zero runtime behavior change across the whole plan — any bug the checker surfaces is reported to the operator and fixed OUTSIDE conversion commits.
- Push the branch; the maintainer merges (never merge to `dev`/`main` from a session).
