# Boot-Stage Decomposition (Roadmap Task 2.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the ~343-line `main()` (`app.js:590-933`) into named boot stages where every "must run before" comment becomes an actual data dependency — a stage cannot be called without a value only the prior stage produces — with the three existing boot suites passing unmodified.

**Architecture:** Five stage functions inside `app.ts` (no new files — the file already has the "extracted from main() for readability" precedent at `app.js:935`). Each stage takes the previous stage's typed return value as a parameter; the ordering invariants currently defended by comments (`app.js:646-657, 669-679, 804-810`) are enforced by the type system via branded stage tokens. `main()` shrinks to a ~20-line pipeline.

**Tech Stack:** TypeScript (strict), Jest + jsdom.

## Global Constraints

- **Prerequisites:** roadmap Phase 1 complete (`app.ts` exists) and Task 2.3 (status-store migration) landed. Sequencing note: Task 2.3 does not change `main()`; this plan slots `initStatusStore` into the stores stage, which is what lets `ownStatus.ts`'s registration-order fan-out contract (`ownStatus.ts:10-15`) begin to retire — see Task 4.
- **The behavioral net:** `tests/app-boot-cacheOwner.test.js`, `tests/app-first-follow.test.js`, `tests/app-call-recovery.test.js` must pass **unmodified**. They drive boot via `require('../js/app')` (module side effect runs `main()`, e.g. `app-boot-cacheOwner.test.js:257`) with every dependency mocked — a pure-internal restructuring is invisible to them. Any needed test edit means the refactor changed behavior: stop and fix the refactor.
- **No export changes.** `app.ts` exports nothing today except the side-effectful boot; keep it that way.
- **Every deleted ordering comment must be replaced by a data dependency first.** Rule of exchange: a comment saying "X must run before Y because Z" may be deleted only in the same commit that makes Y's stage take a parameter produced by X's stage (and the commit message names Z).
- **Move, don't edit.** Stage extraction commits move statements verbatim (plus the `function`/parameter wrapper). Behavior-affecting edits are out of scope for this plan entirely.
- Gates per task: `npx jest tests/app-boot-cacheOwner.test.js tests/app-first-follow.test.js tests/app-call-recovery.test.js`, then full `npx jest` + `npm run typecheck`. Commit per task; no merges/PRs unless asked.

## Target shape (the contract every task builds toward)

```ts
// Branded stage tokens: zero-cost proof-of-ordering. A stage's parameter list
// IS its dependency declaration; the old comments become types.
type BootIntent = {
  pendingInviteToken: string | null;
  wantInbox: boolean;
  wantDirect: boolean;
  pinDirect: boolean;
};
type BootSession = {
  userId: string;
  code: string;
  isNew: boolean;
  pendingInviteToken: string | null;   // may be updated by the Telegram gate
  tgInvite: { token: string } | null;
};
type StoresReady = { readonly __storesReady: true };
type Landing = { landedInGroup: boolean };

async function main() {
  if (await maybeRunDevReset()) return;
  const intent = parseBootIntent();                    // Stage 0 (may redirect → null)
  if (!intent) return;
  const session = await resolveIdentity(intent);       // Stage 1 (may halt boot → null)
  if (!session) return;
  const stores = initStores(session);                  // Stage 2
  const landing = await resolveEntryContext(session, intent, stores);  // Stage 3
  startSubscriptions(session, landing);                // Stage 4
  await initSurfaces(session, intent, landing);        // Stage 5
}
```

Mapping of current `main()` lines → stages (exhaustive; every line of `app.js:590-933` lands in exactly one stage):

| Stage | Current lines | Contents |
|---|---|---|
| 0 `parseBootIntent` | 592-620 | invite token extraction, boot-redirect decision (`location.replace` + return null), inbox/direct intent + URL cleaning |
| 1 `resolveIdentity` | 621-644 | `ensureIdentity`, Telegram chrome, `ensureCacheOwner`+`resetThemeVars`, `runLinkArrival` (halt → null), `telegramInviteGate` (may set `pendingInviteToken`) |
| 2 `initStores` | 646-679 | `initOwnStatus`, [`initStatusStore` — new], `initNav`, `initNavRow`, `onContextChange` wiring, `initPrefs` |
| 3 `resolveEntryContext` | 681-810 | the invite-redemption block, the returning-user context prefetch, the `pinDirect` force-write |
| 4 `startSubscriptions` | 812-847 | `touchLastSeen`, `watchUserPrefs` (+ its 3 sync fan-outs), the `current-context-synced` listener, `initInstallAffordance`/`initPushNotifications`/`initTelegramOnramp` gate |
| 5 `initSurfaces` | 849-932 | code drawer, first-run, header, splash, `initList`, hints, knocks, call recovery, cards row, removal detector, inbox, follow grants, reveal block, `wantInbox` modal, first-use mode, palette boot, `initOwnStatusSync`, new-user `setStatus`, SW registration |

Ordering comments → data dependencies:
- "Wire navigation BEFORE the invite-redemption block" (`:646-648`) → `resolveEntryContext` requires the `StoresReady` token only `initStores` returns.
- "initPrefs BEFORE the redemption block … watchUserPrefs stays below so echoes don't fire mid-redemption" (`:669-679`) → `initPrefs` lives in Stage 2 (before 3); `watchUserPrefs` lives in Stage 4, which requires `Landing` — only produced by Stage 3.
- "pinDirect force-write BEFORE watchUserPrefs starts" (`:804-810`) → the force-write is the last statement of Stage 3; Stage 4 requires Stage 3's return.
- "initOwnStatus FIRST … keep before initNav" (`:649-657`) → intra-stage: first statements of `initStores`, with the surviving one-line comment (see Task 4 for how much of the original rationale can be deleted).

---

### Task 1: Characterize, then extract Stages 0–1

**Files:**
- Modify: `js/app.ts`
- Test: none new — the three boot suites are the net.

**Interfaces:**
- Produces: `parseBootIntent(): BootIntent | null`, `resolveIdentity(intent: BootIntent): Promise<BootSession | null>`, and the `BootIntent`/`BootSession` types above — consumed by every later task.

- [ ] **Step 1: Baseline.** Run: `npx jest tests/app-boot-cacheOwner.test.js tests/app-first-follow.test.js tests/app-call-recovery.test.js` → record PASS (all green) as the characterization baseline.
- [ ] **Step 2: Extract Stage 0.** Move `app.js:592-620` into `parseBootIntent()` above `main()`. The boot-redirect branch keeps its `window.location.replace(...)` and returns `null`; the happy path returns the four fields. One subtlety moved verbatim: `pendingInviteToken` is `let` today because Stage 1's Telegram gate reassigns it (`:643`) — in the new shape Stage 0 returns it in `BootIntent`, and Stage 1 copies it into `BootSession` (possibly updated). `main()` body now starts `const intent = parseBootIntent(); if (!intent) return;` followed by the original line 621 onward, reading `intent.pendingInviteToken` etc. via a temporary `let pendingInviteToken = intent.pendingInviteToken;` shim (removed in Step 3).
- [ ] **Step 3: Extract Stage 1.** Move `:621-644` into `resolveIdentity(intent)`. The `runLinkArrival` early-return becomes `return null`. Returns `{ userId, code, isNew, pendingInviteToken, tgInvite }` — the shim `let` from Step 2 dies here; downstream code (still inline in `main()`) reads `session.userId`, `session.pendingInviteToken`, `session.tgInvite`. Note `identity.userId`/`identity.code` appear inside the redemption block (`:705, 720`) — replace with `session.userId`/`session.code` (identical values; `const { userId, code } = identity` at `:623` established that).
- [ ] **Step 4:** Boot suites → PASS unmodified; full `npx jest` + `npm run typecheck`.
- [ ] **Step 5: Commit.** `git commit -m "refactor(boot): extract parseBootIntent + resolveIdentity stages (verbatim moves)"`

---

### Task 2: Extract Stage 2 (`initStores`) and Stage 3 (`resolveEntryContext`)

**Files:**
- Modify: `js/app.ts`

**Interfaces:**
- Consumes: `BootSession` from Task 1.
- Produces: `initStores(session: BootSession): StoresReady`, `resolveEntryContext(session: BootSession, intent: BootIntent, stores: StoresReady): Promise<Landing>`.

- [ ] **Step 1: Extract `initStores`.** Move `:658-667` + `:679` (`initOwnStatus`, `initNav`, `initNavRow`, the `onContextChange` wiring, `initPrefs`) into `initStores(session)`, returning `{ __storesReady: true } as const`. Insert `initStatusStore(session.userId)` immediately after `initOwnStatus(session.userId)` (Task 2.3's store must exist before any subscriber — groupNav's `startCardsRowSubscriptions` in Stage 5 and groupContext on group-enter both consume it). **Comment exchange:** the big block comment at `:646-657` shrinks to its two surviving facts — `initOwnStatus` before `initNav` for replay determinism (still intra-stage order, still a comment), and the `inDirectCtx`-gate cross-reference; the "BEFORE the invite-redemption block, otherwise navigateToGroup writes to users/null" sentence is DELETED in this commit because `resolveEntryContext(…, stores: StoresReady)` now cannot be called first (name the invariant in the commit message). Same exchange for the `initPrefs` comment `:669-678`: the "before redemption" half dies (type-enforced), the "watchUserPrefs stays below so echoes don't fire mid-redemption" half moves to Stage 4's extraction (Task 3).
- [ ] **Step 2: Extract `resolveEntryContext`.** Move `:681-810` wholesale into `resolveEntryContext(session, intent, stores)`. Internal references: `pendingInviteToken` → `session.pendingInviteToken`, `tgInvite` → `session.tgInvite`, `isNew` → `session.isNew`, `pinDirect` → `intent.pinDirect`. `landedInGroup` (`:699`) becomes the return value: `return { landedInGroup };` — note the returning-user branch and the no-invite path never set it; initialize `let landedInGroup = false` at function top (it already is, `:699` — the variable just widens scope from the if-block to the function; the reveal block that reads context in Stage 5 is unaffected because it re-derives from `getCurrentContext()` at `:903`, not from this flag). The `pinDirect` force-write (`:804-810`) stays as the function's last statement; its comment's "BEFORE watchUserPrefs starts" clause is deleted in Task 3 when the type dependency lands, not here.
- [ ] **Step 3:** Boot suites → PASS unmodified; full suite + typecheck.
- [ ] **Step 4: Commit.** `git commit -m "refactor(boot): extract initStores + resolveEntryContext; stores-before-entry now type-enforced"`

---

### Task 3: Extract Stage 4 (`startSubscriptions`) and Stage 5 (`initSurfaces`)

**Files:**
- Modify: `js/app.ts`

**Interfaces:**
- Consumes: `BootSession`, `BootIntent`, `Landing`.
- Produces: `startSubscriptions(session: BootSession, landing: Landing): void`, `initSurfaces(session: BootSession, intent: BootIntent, landing: Landing): Promise<void>` — and the final ~20-line `main()`.

- [ ] **Step 1: Extract `startSubscriptions`.** Move `:812-847` (`touchLastSeen`, the `watchUserPrefs` block with its three `sync*` fan-outs, the `!isTelegramContext()` install/push/onramp gate, the `current-context-synced` listener). The `landing` parameter is unused inside — that is intentional and gets a one-line comment:

```ts
// `landing` is deliberately required and unused: watchUserPrefs's first echo
// must not fire mid-redemption (it would yank a just-joined invitee out of
// their group) — requiring resolveEntryContext's return makes early
// subscription unrepresentable. Replaces the old ordering comments at the
// pinDirect force-write and initPrefs sites.
```

Delete the now-encoded comment halves: `:815-818` ("Started here, after redemption, so its echoes can't reset context mid-flow") and the "BEFORE watchUserPrefs starts" clause of `:804-810`.
- [ ] **Step 2: Extract `initSurfaces`.** Move `:849-932` verbatim. References: `userId`/`code` → `session.*`, `isNew` → `session.isNew`, `wantInbox` → `intent.wantInbox`, splash/`_followGrantsUnsub` module-level state untouched. The `initList` options callback and the reveal block move as-is.
- [ ] **Step 3: Verify the final `main()`** matches the target shape (§ Target shape) modulo naming. Run: `awk '/^async function main/,/^}/' js/app.ts | wc -l` → expected ≤ 25.
- [ ] **Step 4:** Boot suites → PASS unmodified; full quartet. Commit: `git commit -m "refactor(boot): extract startSubscriptions + initSurfaces — main() is now a typed 6-stage pipeline"`

---

### Task 4: Ordering-comment audit + `ownStatus` fan-out contract review

**Files:**
- Modify: `js/app.ts`, `js/ownStatus.ts` (comments only)

- [ ] **Step 1: Sweep for orphaned ordering comments.** Run: `grep -n "BEFORE\|must come before\|must run\|order" js/app.ts js/ownStatus.ts`. For each hit, classify: (a) now type-enforced → delete; (b) intra-stage ordering still real (e.g. `initOwnStatus` before `initNav`, `initNavRow` before the `onContextChange` wiring, `if (isNew) enterFirstUseMode()` before the status write) → keep, but rewrite to name the stage: "intra-initStores order:" / "intra-initSurfaces order:". No comment may survive claiming an ordering the types already guarantee.
- [ ] **Step 2: Re-scope the `ownStatus.ts` ORDERING INVARIANT header** (`ownStatus.ts:10-15`). Post-2.3, groupContext's theme reaction rides the statusStore, and app.js's Direct-theme write is guarded by `inDirectCtx` (`app.js:965-987`) — the header's "groupContext's handler must win on the SAME tick" clause describes a consumer that no longer registers here. Verify with: `grep -rn "subscribeOwnStatus" js/ --include='*.ts'` — if groupContext no longer appears, rewrite the header to name the remaining consumers (groupNav, app.js's `initOwnStatusSync`) and the `inDirectCtx` gate as the real guarantee. If groupContext STILL subscribes directly (2.3 kept it for `_ownPrimary`), leave the header intact and record that in the commit message instead — do not force the cleanup.
- [ ] **Step 3:** Full quartet. Commit: `git commit -m "docs(boot): ordering comments — delete type-enforced, re-scope survivors to their stage"`

---

### Task 5: Behavioral spot-check (manual, no code)

The boot suites mock everything; the risky paths are the ones they only partially exercise. Using `npm run dev`, walk each boot shape once: (1) fresh new user, (2) returning user whose last context was a group (expect: no Direct flash, lands in group with real name), (3) invite-link redemption into a group, (4) `?direct=1` cold-start pin, (5) reload mid-call (call recovery). Watch the console for `users/null/` write errors — the historical failure mode the stores-before-entry invariant guards (`app.js:647`).

- [ ] Walkthrough done; observations noted in the PR/commit description.

## Self-review notes

- Stage 4 vs 5 boundary judgment: `initInstallAffordance`/`initPushNotifications`/`initTelegramOnramp` sit at `:836-840` between the prefs watch and the listener wiring; they are grouped into Stage 4 by position (verbatim-move rule) even though they are surface-ish. Moving them to Stage 5 would be an edit, not a move — explicitly out of scope.
- `dismissSplash()` inside the redemption block and the splash wiring in Stage 5 interact across stages via module state (`splashDone`, `app.js:70-116`) — untouched by design; unifying splash state is not this plan's business.
- The `_followGrantsUnsub` dead capture (`app.js:72,895`, "#214 R2") moves verbatim into `initSurfaces`. Deleting it is a one-line judgment for the executing engineer to raise, not to take.
