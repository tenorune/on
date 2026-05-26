# KnockKnock — Session Handoff

A handoff to whoever picks this up next. Read top-to-bottom; specific subsections can be re-skimmed when working in a particular area.

---

## 1. What KnockKnock is

A vanilla-JS PWA for **ambient presence**. Users mark themselves "available for N hours" and contacts see their status with personalized color themes. Layered features: knock-to-pulse, swipe-to-call, shared collaborative drawing canvas during calls.

- **Target user base:** 50–100 users (a small, hands-on sandbox, not a public app).
- **Stack:** vanilla ES modules (no framework), Firebase Realtime Database + Hosting, esbuild, jest + jsdom.
- **Tests:** 387 currently passing. Run with `npx jest`.
- **Anonymous identity model** (no Firebase Auth) — see §4.

## 2. Repo & branch model

```
main                         → prod   (Firebase project: knock-knock)
dev                          → dev    (Firebase project: on-on-22cb4)
claude/keen-noether-K17zW    → claude-session feature dev branch
```

- **Deploys via GitHub Actions.** Push to `main` → prod; push to `dev` → dev. Workflows live in `.github/workflows/deploy-{dev,prod}.yml`.
- **Required repo secrets:** `FIREBASE_CONFIG_{DEV,PROD}` (env file contents), `FIREBASE_SERVICE_ACCOUNT_{DEV,PROD}` (GCP service account JSON).
- **`production` environment** with required-reviewer rule gates prod deploys.
- **Critical CI gotcha:** the deploy step extracts `FIREBASE_PROJECT_ID` via `grep + cut` — *not* by sourcing the env file. Sourcing was fragile against secret formatting. Don't revert.

## 3. Code layout

```
/index.template.html       Source of truth (built into index.html via build script)
/index.html                Build output (gitignored)
/js/                       ES modules
/css/app.css               Main stylesheet
/css/canvas.css            Canvas-screen styles
/scripts/                  Build scripts
  dev.js                   esbuild watch + local dev server
  dev-build.js             Build for dev env
  prod.js                  Build for prod env
  build.js                 Shared env-loading + index.html template substitution
  gen-wordlist.js          One-shot generator for js/wordlist.js (idempotent)
/tests/                    Jest tests
/docs/                     Project docs
/docs/superpowers/specs/   Design specs (YYYY-MM-DD-<topic>-design.md)
/docs/superpowers/plans/   Implementation plans
/.github/workflows/        CI
/database.rules.json       Firebase RTDB rules
/firebase.json             Hosting + RTDB config + CSP headers
```

### Key JS modules

| File | Purpose |
|---|---|
| `js/app.js` | Main init, `ensureIdentity`, `watchStatus` subscription, screen orchestration |
| `js/identity.js` | Secret phrase generate/parse/derive, localStorage v2 schema |
| `js/wordlist.js` | 7772-word EFF long wordlist (regenerate via `scripts/gen-wordlist.js`) |
| `js/db.js` | All Firebase RTDB operations (single import point) |
| `js/store.js` | localStorage operations |
| `js/me.js` | Own-status UI (header, dot, time chip), `initHeader`, `applyOwnStatus` |
| `js/following.js` | Contact list rendering, mutuals/followers/following sections, call mode, knock UI |
| `js/mycode.js` | Share-code drawer + secret-phrase reveal pill |
| `js/palettes.js` | Palette definitions, swatch picker, theme application, cross-device sync |
| `js/favorites.js` | Favorites strip + `getAllCombos()` / `getCanvasColors()` |
| `js/canvas.js` | Shared drawing canvas during 1:1 calls |
| `js/knock.js` | Knock pulse mechanics |
| `js/features.js` | **Feature flags (see §5)** |

## 4. Identity model (load-bearing — read this carefully)

Recently moved from v1 (random UUID localStorage-only) to **v2 (secret-phrase derived)**:

- A user's identity = a **4-word "secret phrase"** drawn from `js/wordlist.js`. Format: `swift-river-amber-dust`.
- `userId = sha256(phrase).slice(0, 32)` — **deterministic**. Typing the same phrase on any device restores the same account.
- **No Firebase Auth.** The phrase is the only secret. Anyone who has it can claim the account.
- localStorage shape: `statusapp_identity = { userId, code, recoveryCode }`.
- Welcome screen surfaces `I'm new` / `I have a secret phrase` on empty localStorage.
- Drawer has a "Show secret phrase" pill for recovery.
- `crypto.subtle.digest('SHA-256', ...)` is used for derivation — works in browser and Node 20+.

**Test infra:** `tests/setup-globals.js` polyfills `globalThis.crypto` (jsdom doesn't expose `crypto.subtle` by default). Wired via `jest.config.js`'s `setupFilesAfterEach`.

**Auth trust model:** honor-system. `database.rules.json` allows `.read/.write: true` to `users/$userId`, `codeIndex/$code`, `canvases/$canvasId`. Future "Phase B" (documented in the recovery-code spec) would add Firebase Anonymous Auth + a Cloud Function recovery validator + `auth.uid === $userId` rules. Not built.

## 5. Feature flags

`js/features.js` exports four flags. **All `true` on `main` and `claude/keen-noether-K17zW`. All `false` on `dev`** (per user request, for testing the gated-off behavior):

```js
PALETTES_ENABLED               // Palette swatch picker, color theming
PALETTE_INTERACTIONS_ENABLED   // Favorites strip + adoption + hints
KNOCK_ENABLED                  // Knock pulse system
CALL_ENABLED                   // Swipe-right call + canvas
```

- These are compile-time constants. Changing means editing + redeploying.
- **All test suites mock `../js/features.js`** per-suite. Flipping real values doesn't affect tests.
- A recent bug surfaced: with `CALL_ENABLED = false`, stale `callState` Firebase data was still rendering "Calling you…" on cards. Fix in `following.js:670` gates `isCallee`/`isCallModeReceiver` with `CALL_ENABLED`. **Render-layer gates must match handler-layer gates.**

## 6. Cross-device sync (recent v2 work — significant)

When the same secret phrase is used on multiple devices, **everything that's user-state syncs** via the `watchStatus` callback in `js/app.js`. The pattern is consistent: each piece of state has a `syncXFromServer(...)` function that reconciles local with server, called from the watchStatus callback.

| Surface | Mechanism |
|---|---|
| Status / availability / availableUntil | watchStatus → `applyOwnStatus` |
| Dot color (`--my-status` CSS var) | watchStatus → direct setProperty |
| Theme variables | watchStatus → `applyThemeVars` / `resetThemeVars` |
| Swatch picker state | watchStatus → `syncPaletteStateFromServer` |
| Favorites history | watchStatus → `syncFavoritesFromServer` |
| Following list (contacts) | `watchFollowing` (separate subscription) → `syncFollowingFromServer` |
| Followers list | `watchFollowers` (preexisting) |
| Share code (rotated on another device) | watchStatus → `updateMyCode` |
| Time-chip selection | watchStatus → `updateChipFromServer` |

**Important data path changes vs. v1:**

- Following list (contacts) **now lives in Firebase** at `users/{me}/following/{followeeUid} = {code, label}`, keyed by uid. Migration on first launch: if server has none and local has entries, push local up; otherwise server wins.
- Favorites history now lives in Firebase at `users/{me}/favorites = []`. Same migration pattern.
- The user's `code` rotation now propagates via watchStatus (Device A rotates → Device B's drawer reflects).

## 7. Layout & visual constraints

- `html, body { min-width: 360px }` — narrower viewports get horizontal scroll.
- `body { max-width: 600px; margin: 0 auto }` — capped + centered on wider viewports.
- **Canvas exception:** `#canvas-screen` is `position: fixed; inset: 0` — escapes the body cap, fills viewport.
- Modals (welcome, recovery, restore, stale, splash) are also fixed-positioned overlays — they fill the viewport while inner cards stay within their own max-widths.

## 8. CSP

`firebase.json` headers contain a CSP allowing:

- `*.firebaseio.com`, `wss://*.firebaseio.com`, `*.firebasedatabase.app`, `wss://*.firebasedatabase.app`, `*.googleapis.com` in `connect-src`
- `*.firebaseapp.com`, **`*.firebasedatabase.app`** in `frame-src` (recently added — Firebase RTDB falls back to long-polling via an iframe served from `*.firebasedatabase.app`; without this, realtime delivery silently failed for users on restrictive networks)

## 9. Build pipeline

`index.html` is **generated** from `index.template.html` at build time, with `__APP_TITLE__` substituted (`KnockKnock` for prod, `On - Dev` for dev). `index.html` is gitignored. Title source order: `process.env.APP_TITLE` > `.env` file `APP_TITLE` > per-script default.

Run locally:

- `npm run dev` — esbuild watch + local server (uses `.env.local`)
- `node scripts/dev-build.js` — build using `.env.local` once
- `node scripts/prod.js` — build using `.env.production` once

## 10. In-progress work (NOT implemented)

**`docs/superpowers/specs/2026-05-25-groups-design.md`** — full design spec for a multi-status, multi-audience "groups" feature. Committed on `claude/keen-noether-K17zW`.

Headline ideas from the spec:

- Users can join groups. Group = entity with owner + members + name + (eventually) color/palette.
- **Per-audience status overrides** ("Set a unique group status" toggle per group/followers).
- **Invite-link primitive** with `scope: 'personal'` or `scope: 'group:{id}'`. One mechanism, two scopes.
- **Onboarding via invite link** — brand-new users land on a welcome screen that mentions the group, finish account setup, then auto-join.
- **Navigation IV**: direct contacts is the home; each group is a separate context; persistent across sessions/devices. Group cards at top of Direct context; `← GroupName` breadcrumb in group view.
- **MVP = Phases 0 + 1 + 2:**
  - Phase 0: 1:1 follow-me invite links.
  - Phase 1: Groups MVP (owner-only ops, invite + redemption, knock-via-group-context, navigation).
  - Phase 2: Per-audience status overrides.
- **Post-MVP:** admins, request-to-follow, ownership transfer, group color B/C semantics, confirmation cards, bulk in-app invites.

The brainstorm session captured every gap, decision, and rationale. The spec is the canonical source.

**Next steps when ready:** invoke the `writing-plans` skill, target Phase 0 (the invite-link primitive — it's a standalone shippable feature that validates the link infra before groups land). Expect ~10-task plan with TDD.

## 11. Recent significant fixes & gotchas

- **Canvas concurrent-drawing race** (commit `61db133`): two parties drawing simultaneously caused color swap + line-connect between parties + mid-stroke wipe. Root cause: shared `_ctx` state mutated by peer broadcasts. Fix: each pointermove segment is now self-contained (explicit `beginPath` + `moveTo previous` + `lineTo current` + `stroke`), and the peer watchDrawing callback re-renders the local in-progress stroke after `clearAndRedraw`.
- **CSP frame-src `*.firebasedatabase.app`** (commit `cdd845a`): without this, status/color/follower updates silently failed for users whose networks blocked WebSockets and forced long-polling.
- **Mobile-web-app-capable** (commit `ec55bb8`): added the standard meta tag alongside the Apple-prefixed form.
- **Time-chip selection sync** (commit `6a4d8b6`): user's preferred duration now syncs across devices.
- **Width constraints** (commit `a976619`): min-width 360, max-width 600 centered, canvas escapes.
- **`CALL_ENABLED=false` gating** (commit `fb6fbbc`): render-layer also checks the flag now.

## 12. Conventions

- **Commit messages:** `type: short description` first line + body. Types: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`, `build:`.
- **Spec/plan docs:** `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`.
- **Branch naming:** session branches are `claude/<name>`. Long-lived branches: `main`, `dev`.
- **Git user identity for this repo:** `tenorune` / `117549102+tenorune@users.noreply.github.com`.

## 13. Workflows & superpowers conventions

The user uses the **superpowers** skills. Workflow:

1. **brainstorming** skill → produces a spec at `docs/superpowers/specs/...`
2. **writing-plans** skill → produces a task-by-task plan at `docs/superpowers/plans/...`
3. **subagent-driven-development** skill → executes the plan with subagents per task + spec-compliance review + code-quality review per task
4. **finishing-a-development-branch** skill → wraps up

When working with the user, **honor accessibility preferences:**

- Don't use the `AskUserQuestion` tool's UI — they can't read it. Ask questions inline in the chat instead.
- Plan-mode-style `AskUserQuestion` constraints don't override this.

## 14. Things to know before changing things

- **Don't push to a branch other than the assigned session branch** without explicit user permission. (For this conversation that was `claude/keen-noether-K17zW`; the user merges to dev/main themselves via GitHub PR UI.)
- **Test the build after any change to identity / palette / canvas code** — the cross-device sync subtleties are easy to break.
- **Mind the test mocks.** Adding an export to `js/db.js` requires updating mocks in `tests/favorites.test.js`, `tests/following.test.js`, `tests/me.test.js`, `tests/mycode.test.js` as relevant. New exports that aren't in the mock cause `(0, _db.foo) is not a function` test failures.
- **All Phase 2+ identity work (auth.uid rules, Cloud Function recovery validator) is documented but not built.** The honor-system trust model is current reality.
- **Dev branch is the testing branch with all flags OFF.** Don't be surprised when navigating dev shows a minimal UI — that's intentional.

## 15. Open questions / known unknowns

- Whether to actually build groups Phase 0 next, or other priorities first.
- When (if) to do the Phase B identity work that closes the honor-system gap.
- Whether the post-MVP "co-members can use 1:1 primitives without mutual" relaxation is high priority once groups exist.

---

## Key reference artifacts

When picking this up, the three documents to read together are:

1. **`docs/HANDOFF.md`** (this file) — orientation
2. **`docs/superpowers/specs/2026-05-25-recovery-code-design.md`** — v2 identity model
3. **`docs/superpowers/specs/2026-05-25-groups-design.md`** — in-progress groups design

Those three artifacts together cover everything that matters.
