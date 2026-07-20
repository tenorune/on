# Performance & Efficiency Audit — Findings

**Branch:** `claude/knockknock-feature-dev-9a3ysy` @ `4d96d76` · **Baseline:** merge-base with `main` = `56f93af` (262 commits, ~200 files)
**Date:** 2026-07-20 · **Session:** operator-directed audit (investigate/report only)
**Fix plan (Tier 1 & 2 branch/branch-amplified items):** `docs/superpowers/plans/2026-07-20-performance-fixes.md`

## Method

Four parallel read-only audit agents over independent domains — (1) the new location-sharing client subsystem, (2) client boot/render hot paths, (3) Cloud Functions, (4) RTDB data model + page load — followed by direct source verification of every Tier 1 and Tier 2 claim in the coordinating session (marked ✓ OBSERVED). Reviewed decisions from `docs/HANDOFF.md` were excluded up front and are **not** findings: last-known node persistence across availability flaps, the `.validate`-vs-`.write` rules structure, one-write-per-cell (non-multipath) publishes, `evaluateAvailability()` as single authority, the full-invite-object `joinGroup` transaction, splash gating modes, optimistic header setters.

Severity is real-world impact weighted by frequency × cost. `BRANCH` = introduced on this branch; `PRE-EXISTING` = present at merge-base.

**Verification ledger:** Tier 1 and Tier 2 are all directly source-verified (OBSERVED). Tier 3 items are agent-reported with citations, spot-consistent but not individually re-verified. No runtime profiling or device measurement was performed — severities are code-derived estimates, not measured wall-clock/battery numbers.

---

## Tier 1 — highest real-world impact

### F1 ✓ · 60s tick republishes unchanged data to every context, with peer fan-out — BRANCH, HIGH

`js/locationShare.ts:236-246` unconditionally calls `publishLocation` plus one `publishLocationCell` per available opted-in gid, always with a fresh `updatedAt: Date.now()` (`js/db/location.ts:13-20`). Nothing anywhere reads `updatedAt` (grep-confirmed independently by two agents; the design spec itself says nothing gates on it in v1). The cell tier is snapped to a ~1.1 km grid (`snapToCell`), so for a stationary or slow-moving user virtually every cell write differs *only* in the unused `updatedAt` — yet each write costs a rules evaluation (with `root.child` membership/reciprocity reads, `database.rules.json:179-192`), upstream bandwidth, and a changed-value fan-out to every attached peer listener. With N members and V viewers per group: O(N×V) listener wakeups per minute delivering zero rendered change.
**Direction:** cache last-published `{lat,lng}`/snapped cell per context; skip the `set()` when unchanged; stop bumping `updatedAt` on no-ops.

### F2 ✓ · High-accuracy GPS fix forced every 60s; `maximumAge: 30000` can never satisfy the 60s cadence — BRANCH, MED (battery-dominant)

`js/locationShare.ts:87-91`: `enableHighAccuracy: true` with `maximumAge: 30000` against `TICK_MS = 60000` — the cached-fix window expires before every tick, so the GPS radio powers up once a minute for the whole session, including ticks where only ~1.1 km grid cells publish and coarse accuracy would do.
**Direction:** raise `maximumAge` to ≥ tick interval for coarse ticks; request high accuracy only when the precise `'direct'` tier will publish this tick.

### F3 ✓ · Permanent whole-`groups/{gid}` listens for every enumerated group — PRE-EXISTING, HIGH

`js/db/groups.ts:91-113` (`watchGroupMeta`) listens on the group **root** and strips to 5 meta fields client-side; `js/groupNav.ts` (`syncMetaSubs`) keeps one open per enumerated group for the whole session. The node carries the full `members/` subtree (including hot `statusOverride`, written on every member's swatch tap) and `invites/`. Every boot downloads G full group nodes (rosters + invite tokens); every co-member override flip in any group fires the meta callback → `renderNavRow()`; for the open group the same change also arrives via `watchGroupMembers` (`js/groupContext.ts:1191`) — double delivery. The client-side field-stripping is itself the evidence the listen is too wide.
**Direction:** move meta to a `groups/{gid}/meta` leaf or per-field listens (keeping the cancel-callback deletion detection on the leaf); reserve the wide listen for the active context. Schema change — plan deliberately.

### F4 ✓ · No distance dedupe in `locationHub.combine` — every row repaints per minute on identical text — BRANCH, MED

`js/locationHub.ts:52-70` calls `cb(meters)` on every underlying emission with no previous-value comparison. The *own* node feeds every pair, so the own 60s publish (F1) wakes every mutual row (`js/following.ts:138-142` → `updateFolloweeRow` `innerHTML` rebuild) and every roster row (`js/groupContext.ts:348-365` → `paintRosterRow`) simultaneously — byte-identical strings destroyed and recreated per minute.
**Direction:** memoize last-emitted meters in `combine` and emit only on change.

---

## Tier 2 — meaningful, bounded

### F5 ✓ · `location-prefs-synced` fires on every `userPrefs` echo, not on location changes — BRANCH, MED

`js/prefs.ts:528-534` dispatches whenever `serverPrefs.location` merely *exists* — permanently true after first opt-in — and `syncFromServer` runs on every `userPrefs` tick (every sibling-device swatch tap, every own-write echo; the file's own comment at `:465-470` says this fires "constantly" in group use). Each dispatch triggers a full `renderList()`, a full roster re-render, two glyph repaints, and `seedPublishedFromServer`'s per-context RTDB `get()` probes (`js/locationShare.ts:308-318`) — including contexts already in `_publishedContexts`, for which `markPublished` is a guaranteed no-op.
**Direction:** diff the incoming location map against the cache and dispatch only on real change; skip probes for already-published contexts.

### F6 ✓ · `userPrefs/{uid}` watched wholesale while carrying churny and heavy leaves — PRE-EXISTING, MED

`js/db/social.ts:175-188`: both `watchUserPrefs` and `getUserPrefs` hit the node root. The watched subtree includes `pushTokens/*` (each embedding the full `navigator.userAgent`, `js/prefs.ts:310` — only ever read by the one-shot cull via the targeted `readPushTokens`, `js/db/social.ts:192-194`), `following/`, and `perGroup/*/paletteState` (written per swatch tap). Boot double-reads the full subtree (`js/app.ts:831` one-shot solely for `currentContext`, then the watch in `startSubscriptions`); `touchPushToken` bumps `lastSeen` every load and echoes back through the watch; `favorites-synced` dispatches unconditionally whenever favorites exist (`js/prefs.ts:444-482`) with no change comparison → `renderStrip` innerHTML rebuild per unrelated prefs write; `watchFollowing` overlaps as a child of the watched parent.
**Direction:** read only `currentContext` at boot; move `pushTokens` out of the watched node; dispatch sync events only on changed values.

### F7 ✓ · `onMemberRemoved` doubles trigger invocations on the group-presence write family — BRANCH, MED

`functions/index.js:169` registers `onValueWritten('/groups/{groupId}/members/{memberUid}')` alongside `onMemberOverride` (`:156`) watching the `statusOverride` child of the same path. RTDB triggers fire on any write at or below the watched path, so every `statusOverride` write (bot `/status`/`/off`, client toggles/re-ups, displayName edits) invokes **both** functions; the removal guard (`functions/group-cleanup.js:14`) makes the second a pure no-op — a full billed invocation (plus potential cold start) per group-presence change.
**Direction:** fold removal detection and override transition into a single member-node trigger.

### F8 ✓ · Notifier handlers are deep sequential read chains; availability fan-out uncapped — PRE-EXISTING, MED (partially improved on this branch)

Directed handlers are fully sequential where most reads are independent: `handleKnock` (`functions/notifier.js:134-152`) is ~6 awaited round-trips (prefs → cooldown → name → group name → send → cooldown write); similarly `handleInvite`, `handleFollowRequest`, `handleCall`. `handleAvailability` (`:299-382`) is already half-optimized on this branch — `Promise.all` across followers (`:347`), sender fallback resolved once (`:341-343`), group overrides prefetched (`:377`) — but keeps a ~3-hop sequential chain per follower, a deliberately-sequential per-group pass (shared dedup set), and no cap on recipient count (accepted in-code for a 50–100-user app).
**Direction:** `Promise.all` the independent reads inside each handler; consider a fan-out cap.

### F9 ✓ · `no-cache` on immutable hashed chunks + full-shell invalidation per deploy — PRE-EXISTING header, BRANCH-amplified (chunk precache is new), MED

`firebase.json` applies `Cache-Control: no-cache` via `source: "**"` to everything, including content-hashed `dist/chunks/[name]-[hash].js` (immutable by construction, `scripts/prod.js:18`). `sw.template.js:23-30` deletes every non-current cache on activate while `install` re-adds the whole shell + all chunks — so a one-line app change re-fetches/revalidates the entire shell including the ~78 KB wordlist chunk whose hashed URL didn't change.
**Direction:** `max-age=31536000, immutable` for `dist/chunks/**`; carry unchanged-URL chunk entries over from the previous SW cache.

### F10 ✓ · Telegram `/who` N+1 reads on the webhook path — BRANCH, LOW-MED (corrected)

`functions/telegram.js:485-489, 605-609`: per listed member, reads a child of the requester's *own* fixed followers map (`users/{uid}/followers/{mid}`), and per-member `locationCells/{gid}/{mid}` (`:495`) where one read of the whole map/group node would do. **Correction to the agent report:** these reads are inside `Promise.all` per member and across members — parallel, not sequential — so the cost is admin-SDK read multiplication and connection pressure, not stacked user-facing latency. Severity downgraded MED → LOW-MED.
**Direction:** prefetch `users/{uid}/followers` (and `locationCells/{gid}` when the coarse tier is live) once per command.

---

## Tier 3 — low severity, batch opportunistically (agent-reported, not individually re-verified)

- **Group roster full re-render on every member presence tick**, per-row `refreshHints()`, no change detection (`js/groupContext.ts:951-963, 398-424`); Direct already repaints only the ticking row (`js/following.ts:1093-1102`). PRE-EXISTING.
- **Mutual co-members hold cell + precise subs simultaneously** (`js/groupContext.ts:335-368`) — 2 wire listens per mutual; the redundant cell sub receives F1's churn. BRANCH.
- **Stale-gid cost elaboration** (known-deferred item, now better costed): beyond the denied 60s write, a stale gid keeps a permanently-cancelled override watch whose primary-fallback makes `anyPublishable()` true whenever Direct-available (`js/locationShare.ts:106-111, 270-273`) — the tick loop (and per-minute GPS fix) can never fully idle. BRANCH.
- **`initKnocks` full re-init** (fresh `get()` + resubscribe) on every card-drawer close / canvas exit / foreground (`js/knock.ts:483-508`). PRE-EXISTING.
- **Boot serialization**: ~5 sequential RTTs for a returning group user — `userExists` → full `getUserPrefs` → group-name read → awaited `setLastVisited` write blocking stage 4/5 (`js/app.ts:829-847`, `js/groupNav.ts:78`). PRE-EXISTING.
- **Hidden-tab timers keep running**: 60s `_refreshTimeLabels` (`js/following.ts:374`), 30s countdown (`js/me.ts:208-216`), favorites peek loop (`js/favorites.ts:377-431`); `hintRotation` does this right. PRE-EXISTING.
- **Un-memoized localStorage JSON parses in paint paths**: `getFavorites` per row-paint (`js/store.ts:145-151`), notify/location caches per reconcile pass (`js/prefs.ts:260-265, 369-374`); branch added raw-string memos for following/paletteState — same pattern applies. PRE-EXISTING, branch-amplified by distance ticks.
- **Fresh Permissions API query per tick** (`js/locationShare.ts:207-217`). BRANCH.
- **Per-repaint `querySelector` row lookups** — O(rows²)/min combined with F4 (`js/following.ts:73-75`, `js/groupContext.ts:426`). PRE-EXISTING.
- **`canvasDelta` full-buffer copy per 80 ms stroke tick** (`js/canvasDelta.ts:17-27`). BRANCH (the delta model itself is the fix for the old O(n²) wire).
- **Leaked capture-phase `pointerdown` per `enterCanvas`** (`js/canvas.ts:269-277`) — removed on exit for other listeners, not this one. PRE-EXISTING.
- **Duplicate `watchUserGroups` listens** (`js/groupNav.ts:175` + `js/groups.ts:157`). PRE-EXISTING.
- **Hourly `sweepStaleCalls` full-`/calls` read** (acknowledged in-code; the documented `orderByChild('ts')` escape hatch would need a `".indexOn": ["ts"]` under `calls` that doesn't exist yet) and 2 extra no-op trigger invocations per clean hangup (loop-breaker by design). BRANCH, accepted.
- **`/knock` group-reach fallback downloads full rosters** of all the user's groups on a failed Direct match (`functions/telegram.js:533-544`) — low frequency. BRANCH.
- **Per-boot `touchLastSeen`** ticks all followers' presence watchers (`js/db/social.ts:293-295`). PRE-EXISTING (product-legitimate; frequency is the amplifier).
- **`/start` writes the chat route even when unchanged** (`functions/telegram.js:201-204`). BRANCH, cosmetic.
- **`migrate-presence` per-user sequential root updates** (`functions/migrate-presence.js:62-88`) — operator-run one-shot. PRE-EXISTING.
- **telegram.org bridge script fetched for all visitors** (`index.template.html:25`). PRE-EXISTING (branch changed `defer`→`async`).
- **`/` and `/index.html` precached as separate SW entries** (`sw.template.js:10`). PRE-EXISTING, trivial.
- **Single functions module: 19 exports share one module graph** with eager `getDatabase()`/`getMessaging()` — modest absolute weight (only dep is firebase-admin/functions); eager singletons help warm latency. PRE-EXISTING, nothing urgent.
- **Resolved agent conflict:** the apparent duplicate own-presence watch (`js/ownStatus.ts:29` raw vs statusStore via presenceHub) is coalesced by the Firebase SDK to a single wire listen — local-only duplication, negligible; routing `ownStatus` through `presenceHub` is a hygiene nicety only.

---

## Confirmed clean (non-findings)

- Location publish path triggers **zero** Cloud Function invocations (nothing watches `locations`/`locationCells`).
- `onAvailability` correctly narrowed to the `availableUntil` leaf; re-ups exit after one read.
- Group-availability notification N+1 already fixed on this branch (roster/name resolved once; overrides prefetched).
- Webhook replies ride the HTTP response (one Bot API method per update); webhook always 200s — no redelivery storms. No repeated `getUser`/mapping reads on the webhook path.
- Hub multiplexers (`presenceHub`, `locationHub`, `statusStore`, `ownStatus`) are working anti-amplification layers; listener/timer teardown verified on every traced glyph-off/group-leave/unfollow/sign-out path; all location listens are shallow exact-node paths.
- Keyed reconciliation (`js/reconcile.ts`) in all hot lists; no innerHTML rebuilds on data ticks in the main lists; `canvasDelta` used on send and receive paths with `startAfter(lastKey)`; no per-move forced layout in the draw path.
- No `orderByChild`/`orderByValue` query anywhere lacking an index (none needed today; zero `.indexOn` entries required).
- The branch's build pipeline is a net improvement: minify + ESM + code-split, stale-chunk purge, modulepreload chain-flattening, fail-closed preconnects, linked-only prod sourcemap.
- Multi-path atomic updates for all delete fan-outs (expunge/graduation/unlink/invite-accept/sweep); notifier cooldowns cap fan-out abuse; no retry/idempotency waste in functions.
- The 60s loop genuinely stops when nothing is publishable; the `visibilitychange` catch-up tick is guarded; `toggleContext` double-read is absorbed by `maximumAge` in browsers.
- Direct list re-sorts only on availability flips, coalesced through a microtask; `_refreshTimeLabels` is label-only for unchanged rows.
- `shared/` mirrors are pure and dependency-free; location write payloads are schema-capped (`$other: .validate false`).

## Reading of the whole

The branch's new location subsystem is architecturally sound (hubs, teardown, gating all verified clean) but its steady-state loop is wasteful in three compounding ways — republish-unchanged (F1), GPS-per-tick (F2), no-dedupe-repaint (F4) — which together account for most of the per-minute cost and battery draw. The largest *pre-existing* inefficiencies are structural data-model ones: the whole-`groups/{gid}` meta listen (F3) and the wholesale `userPrefs` watch (F6). F1+F2+F4 are small, contained fixes with outsized effect; F3 and F6 are schema/listener refactors best planned deliberately as their own effort.
