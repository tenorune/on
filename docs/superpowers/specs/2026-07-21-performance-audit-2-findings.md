# Performance & Efficiency Audit #2 — Findings

**Branch:** `claude/knockknock-feature-dev-9a3ysy` @ `b51ca36` · **Baseline:** merge-base with `main` = `56f93af`
**Date:** 2026-07-21 · **Session:** operator-directed audit (investigate/report only)
**Prior audit:** `docs/superpowers/specs/2026-07-20-performance-audit-findings.md` (26 findings, all fixed and 26/26 verified before this pass)

## Method

Four parallel read-only audit agents over independent domains — (1) the post-audit commits themselves (perf batches + the 2026-07-21 post-smoke quartet) checked for regressions the fixes introduced, (2) client hot paths with fresh eyes (DOM/layout, memory/listener lifecycle, allocation churn, RTDB watch overlap, CSS), (3) Cloud Functions trigger topology + rules + data model, (4) bundle/SW/network load path. Each agent was seeded with the prior findings spec as an exclusion list; only new items, residuals, or regressions qualify. Every Tier 1/2 claim below was then directly source-verified in the coordinating session (✓ OBSERVED).

**Prior-fix regression check: 26/26 CLEAN.** Three agents independently spot-verified the prior fixes in current source (leaf meta listens, `_lastPublished` dedupe, coarse cell fixes, distance memo, merged member trigger, immutable chunks + SW carry-over, hidden-tab guards, row maps, knock drain, pushTokens relocation, etc.). No fix found regressed. The only defect *introduced by* a fix is N2 below (an interaction between two of them).

**Verification ledger:** N1–N5 and N7–N10 directly source-verified (OBSERVED; N5 and N10 verified 2026-07-21 with corrections noted inline). N6 is agent-reported with citations, spot-consistent but not independently re-verified. No build was run (no `node_modules` in the audit env) — bundle-size claims derive from the import graph and file sizes, not measured output. No runtime profiling; severities are code-derived estimates.

---

## Tier 1 — highest impact

### N1 ✓ · Canvas code-split silently defeated by one static import — entry bundle ships the draw engine to every visitor — BRANCH, MED-HIGH (client boot)

`js/following.ts:31` statically imports `enterCanvas, exitCanvas, showPeerLeftDialog` from `./canvas.js`, while `js/following.ts:503` dynamically `import('./canvas.js')`s the same module — clear evidence the lazy-load was intended. esbuild bundles any statically-referenced module into the importer's chunk, and `following.ts` is statically imported by `app.ts`, so `canvas.ts` (~950 lines) + `canvasDelta.ts` land in the entry bundle; the dynamic import at :503 resolves in-bundle and produces no separate chunk. `following.ts:31` is the only static importer (grep-confirmed). Every visitor downloads and parses the full draw-together engine at boot; only an active call/draw session uses it.
**Direction:** drop the static import; convert the three call sites (`:357`, `:912` — both already promise-chained — and `:503`) to dynamic import. esbuild then emits a real lazy canvas chunk. Pair with N6/N10.

### N2 ✓ · No-op cell-publish suppression defeats the stale-gid sweep — a kicked, stationary user's tick loop never idles — BRANCH (fix interaction), MED (battery)

`5463888` added `if (last && last.lat === cell.lat && last.lng === cell.lng) continue;` (`js/locationShare.ts:291`); `d079d55`'s stale-membership sweep lives in the *write's* `.catch` (`:295-311`) and fires only when a cell write actually rejects `PERMISSION_DENIED`. A member kicked server-side while opted in keeps their last-landed cell in `_lastPublished` (nothing clears it on a kick), so while they stay inside the same ~1.1 km cell every tick hits the `continue` and the denied write — and thus the sweep — never happens. Meanwhile the stale gid still evaluates available (stale snapshot, then the primary fallback), so `anyPublishable()` holds and the 60s loop plus its coarse GPS fix keep running for a phantom membership — the never-idle cost `d079d55` was written to eliminate, surviving in the stationary case. Scope correction (implementation session): a FRESH boot self-heals — `_lastPublished` starts empty, so the first tick writes, is denied, and sweeps; the exposure is the remainder of the session in which the kick happened (real on long-lived installed-PWA sessions), plus a cell-boundary crossing at any time. Fixed by a 10-min probe window on the no-op skip (`STALE_MEMBERSHIP_PROBE_MS`).
**Direction:** let the sweep run without requiring a landed write — e.g. bypass the no-op guard for a gid whose override watch is in the cancelled state, or probe stale membership once on the first tick after an enumeration/override-cancel event.

---

## Tier 2 — meaningful, bounded

### N3 ✓ · Open-group roster runs the full reconcile on every co-member `statusOverride` write — PRE-EXISTING structure (branch-era machinery), LOW-MED

`js/groupContext.ts:1275-1291`: `watchGroupMembers` covers the whole members subtree — which contains hot `statusOverride` (rewritten per swatch tap) — and its callback has no change detection: every co-member palette tap re-runs `_membersOverrides` rebuild, `renderRoster()` (→ `reconcileDistanceSubs` walking every member with fresh Sets, `reconcileChildren` with per-row `paintRosterRow` innerHTML, `refreshHints()`), and `syncStatusSubscriptions()` — across every viewer currently in the group, for a change that alters neither membership nor ordering. This is the members-subtree analogue of fixed F3 (which narrowed only the *meta* listen). Bounded to the open group; DOM reconcile avoids node churn — hence LOW-MED.
**Direction:** diff incoming membership key-set + per-uid overrides against the previous tick; when only overrides changed, repaint affected rows and skip `reconcileDistanceSubs`/`syncStatusSubscriptions`.

### N4 ✓ · Color-only override edits pay a wasted presence read in `onMemberWritten` — BRANCH (residual of F7 fix), LOW-MED

`functions/notifier.js:326-332` (`statusOverrideChanged`) diffs `enabled`/`status`/`statusColor`/`availableUntil`; `functions/index.js:170` uses it as the sole gate for `handleGroupOverrideChange`, which unconditionally reads full `users/{memberUid}/presence` (`notifier.js:310`). But `effectiveAvailable` (`presence-core.js:56-59`) never depends on `statusColor` — so a `statusColor`-only write (group complement-color tap via `setOverrideAppearance`, `js/groups.ts:294-304`) triggers the presence read and then computes a guaranteed `wasOn === isOn` no-op. This sits on the hottest function-triggering client path. (A `paletteKey`-only write is already skipped — `statusOverrideChanged` doesn't compare it.)
**Direction:** gate the notify path on an availability-relevant compare (`enabled`/`status`/`availableUntil` only).

### N5 ✓ · Large feature modules eagerly bundled into the entry chunk — PRE-EXISTING, LOW-MED (verified, with corrections)

`js/app.ts:1-45` statically imports ~46 modules; the only dynamic import in the file is `firebase/messaging` (`:1153`) — besides that and the wordlist, nothing splits. Verified eager and splittable: `groupContext.ts` (1643 lines — dead for Direct-first boots; pinned into the entry both by `app.ts:25` and by `favorites.ts:9` `applyAdoptedComboInGroup`), `inbox.ts` (397 lines, used only on inbox open), and the Telegram-context-only flow modules — `telegramChrome` (119) gated at `app.ts:652`, `telegramFirstRun` (176) gated at `:666`, `telegramSettings` (160) gated at `:937`, `telegramLinkArrival` (78) — ~533 lines cleanly behind existing `isTelegramContext()` gates.
**Corrections to the agent report:** (a) `telegramOnramp.ts` (144 lines) is a *web-visitor* feature, not Telegram-only — `telegramOnrampEnabled()` requires `!isTelegramContext()` (`telegramOnramp.ts:14-16`; `app.ts:914-917` inits it only outside Telegram) — it stays eager for web boots (it is instead dead weight *inside* Telegram); (b) `telegram.ts` (83) + `telegramBridge.ts` (25) must stay eager — they ARE the gate (and `locationShare.ts` imports `isTelegramContext` too); (c) one real cross-import to untangle: `installAffordance.ts:19` imports `isOnrampPromoActive` from `telegramOnramp.ts` (other apparent cross-references are comments only).
**Direction:** dynamic-import `telegramChrome/FirstRun/Settings/LinkArrival` behind their existing `isTelegramContext()` gates; defer `inbox`; for `groupContext` also break the `favorites.ts` pin (move or lazy the single `applyAdoptedComboInGroup` call). Boot is splash-gated, so the added awaits are invisible.

### N6 ✓ · SW precaches rarely-used lazy chunks on first install — BRANCH-amplified (residual of F9), LOW-MED (verified, with a cost nuance)

Verified: `scripts/build.js:151-155` enumerates **every** `.js` in `dist/chunks/` into `__CHUNK_LIST__` with no exclusion list; the install handler (`sw.template.js:17-35`) checks `caches.match` per chunk — on a **first** install there is no prior cache, so every chunk lands in `missing` and `cache.addAll(SHELL.concat(missing))` downloads the full set, including the wordlist chunk (77,725 B raw at the 07-17 baseline; gzipped smaller — not measured in this env) used only by account-creation/phrase-restore/graduation. After N1 lands, the canvas chunk joins the list. The fetch handler (`:48-64`) is cache-first read-only — no `cache.put` on miss.
**Cost nuance (verified 2026-07-21):** F9's `max-age=31536000, immutable` header on `dist/chunks/**` means an on-demand (non-precached) chunk would still be durably cached by the browser HTTP cache after first use — the SW fetch-miss falls through to `fetch()`, which the HTTP cache serves from disk on repeats. So excluding a chunk from precache costs nothing on repeat loads; the only loss is **offline** availability of that flow before its first use (e.g. offline phrase-restore on a fresh install). The trade is first-install bytes vs offline completeness — operator decision.
**Direction:** if offline-first-install for the restore flow is not required, exclude the wordlist (and canvas) chunks from precache; optionally add a same-origin chunk `cache.put` on fetch-miss for offline coverage after first use.

---

## Tier 3 — low severity, batch opportunistically

- **N7 ✓ · Availability group fan-out re-reads the sender's own `presence/code` per override-off group** (`functions/notifier.js:404-406` resolves `senderFallback` once; `notifyGroupAvailability` → `resolveGroupMemberName` `:263`, `:130-133` re-reads the same leaf per group). G duplicate reads per availability broadcast. RESIDUAL of F8's parallel refactor. **Direction:** thread the precomputed fallback down.
- **N8 ✓ · 30s countdown hidden-tab skip lacks the visibility catch-up its sibling has** (`js/me.ts:208-215` skips DOM writes while hidden with no `visibilitychange` handler; `following.ts:392-396` from the same commit pairs skip + catch-up). Up to ~30 s stale `#time-remaining` on return-to-visible; cosmetic (the `setUnavailable` transition still fires hidden). BRANCH (`fd6a540`). **Direction:** mirror `following.ts`.
- **N9 ✓ · Per-`pointermove` color/width derivation in the draw loop** (`js/canvas.ts:901-902`): `safeCssColor(_penColor)` (regex + string alloc) and `_thickness * _canvas.width` recomputed per event, though neither can change mid-stroke. NOTE the per-segment ctx-state *assignments* are load-bearing (concurrent peer `renderStroke` mutates shared ctx state — in-code comment `:897-900`) — cache only the derivations, computed once in `onPointerDown`. BRANCH-era. 
- **N10 ✓ · `canvas.css` render-blocking in `<head>`** for a feature invisible until a draw session (`index.template.html:30` — plain `<link>`, no `media`/`onload` deferral). Verified with a mechanism correction: `#canvas-screen` is hidden by `opacity:0; pointer-events:none` + `position:fixed` (`canvas.css:13-14`, `.active` flips it at `:17`), NOT `display:none` — and the div contains a bare `<canvas>` (`index.template.html:325-327`), so naive deferral wouldn't just flash it: the unstyled ~300×150 canvas box would enter normal flow at the top of `<body>` and shift the whole layout until the CSS arrived. Deferral must pair with an inline `#canvas-screen{display:none}` guard (or equivalent). Cost is small — 252 lines (~1-2 KB gz), same-origin, SW-cached after first visit — first-uncached-load only. PRE-EXISTING, LOW.

---

## Confirmed clean (no action)

- **Trigger topology:** 7 RTDB triggers, zero path overlap post-F7-fix; the highest-frequency client writes (60 s location publishes, pref/palette echoes, presence leaf writes) fire **zero** functions; no cascades beyond the accepted call-reaper no-ops; no missing `.indexOn`.
- **Rules:** no `root.child()` chains on the hot `statusOverride` write path; the `locationCells` membership check is security-required.
- **Client memory:** all traced Maps/subscription registries have symmetric teardown; no unbounded growth found.
- **CSS runtime:** all infinite `box-shadow` pulse animations are state-gated to single elements; no `will-change` abuse; layout-animating transitions are one-shot. Nothing multiplies across rows.
- **Load path:** hosting headers correct per-path (immutable chunks / no-cache shell / no-store `sw.js` — deliberate, test-pinned); Firebase SDK imports fully modular; no web fonts; preconnects + modulepreload chain-flattening present; icons/sourcemap off the critical path.
- **Post-smoke quartet** (8d83e3a, eeef878, 5d8b3b8, a9223c2) and the remaining perf-batch commits individually re-audited: clean apart from N2/N8 above; the SW-diagnostics probes are debug-gated to zero cost for normal users.
