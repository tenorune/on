# Performance Fixes (Tier 3 Findings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Batch-fix the actionable Tier 3 (low-severity) findings from the 2026-07-20 performance audit — render-churn, timer-hygiene, cache-memo, listener-hygiene, and no-op-write items.

**Architecture:** Fourteen small, independent tasks grouped by surface (group roster, location subsystem, Direct list, boot, timers, canvas, misc). Each is a contained change with its own test cycle; none touches schema or reviewed security semantics. Tasks are ordered roughly by leverage; any subset can ship.

**Tech Stack:** vanilla TypeScript (web, jest+jsdom), Cloud Functions gen-2 (ESM JS), one HTML template.

**Source findings:** Tier 3 of `docs/superpowers/specs/2026-07-20-performance-audit-findings.md`. Companion plans: `2026-07-20-performance-fixes.md` (branch T1&2), `2026-07-20-performance-fixes-preexisting.md` (pre-existing T1&2).

## Global Constraints

- Zero TS suppressions; `npm run typecheck && npm run typecheck:scripts` green (repo root).
- Web tests `npx jest --maxWorkers=2` (root) · functions `cd functions && npm test` then **`cd /home/user/on`**.
- Location landmines apply to Tasks 3/6/7: never delete nodes on availability flaps; `evaluateAvailability()` stays the single availability authority; distance attaches stay gated on `isContextPublished`.
- Tier 3 findings were agent-reported and NOT individually re-verified — each task's first step re-verifies its finding against the working tree; if the code differs, STOP that task and report instead of forcing the change.
- Set committer identity first: `git config user.email noreply@anthropic.com && git config user.name Claude`.

## Deliberately NOT planned (accepted / skipped — do not implement)

- `sweepStaleCalls` full-`/calls` read and the 2 no-op trigger invocations per clean hangup — accepted in-code; escape hatch (`orderByChild('ts')` + `.indexOn`) documented at `functions/call-cleanup.js:39`.
- `migrate-presence` per-user sequential writes — operator-run one-shot, near-zero frequency.
- Functions single-module deployment / eager singletons — modest absolute weight, helps warm latency; revisit only if cold starts become measurable.
- SW `'/'` + `'/index.html'` double precache entry — trivial bytes; removing one entangles SPA offline navigation fallback. Accepted.
- `/knock` group-reach roster download (`functions/telegram.js:533-544`) — interactive-miss path only; revisit if rosters grow.

---

### Task 1: Group roster — repaint only the ticking member's row (highest-leverage Tier 3)

**Files:** Modify `js/groupContext.ts` (`syncStatusSubscriptions:939-965`, `renderRoster` update path `:395-424`, `refreshHints` call `:511`) · Test `tests/groupContext.test.js`

**Re-verify first:** `js/groupContext.ts:960-962` — the presence callback calls `syncRosterOrder()` (full re-sort + repaint of every row) on EVERY member presence tick, including `lastSeen`-only writes (stamped on every peer app-open, `js/db/social.ts:293`); `paintRosterRow` ends in `refreshHints()` (`:511`), so a full pass runs the hint scan once **per row**.

**Design:** mirror Direct's discipline (`js/following.ts:1093-1102` — repaint the row; resort only when effective availability flips):
1. In the `subscribePresence` callback, compute the member's effective availability before and after the tick (`memberEffectiveAvailable` with the stored vs incoming primary). If it flipped → `syncRosterOrder()`. Otherwise → `paintRosterRow(uid)` only.
2. Move `refreshHints()` out of `paintRosterRow`; call it once at the end of `renderRoster` and once after a lone `paintRosterRow` in the presence callback (two call sites, per-pass not per-row).

**Test (write first, expect fail):** in `tests/groupContext.test.js`, drive a `lastSeen`-only presence tick for one member of a 3-member roster and assert the other two rows' DOM nodes are not repainted (spy on `innerHTML` setter via a MutationObserver helper or assert `paintRosterRow`'s observable effect only on the ticking row), and that an availability flip still reorders. Follow the file's existing harness for driving presence ticks.

**Commit:** `perf(roster): repaint only the ticking member; resort only on availability flips` — body cites the audit item and the Direct parallel.

---

### Task 2: Group roster — drop the redundant cell sub for precise-active mutuals

**Files:** Modify `js/groupContext.ts:319-352` (`reconcileDistanceSubs`) · Test `tests/groupContext.test.js`

**Re-verify first:** `cellEligible` is the full member set (`:319`); mutuals in `preciseEligible` keep both subs — 2 wire listens per mutual, the cell one re-delivering every peer cell write for a tier that never renders (precise wins at paint).

**Design:** exclude precise-active uids from the cell set, after `preciseEligible` is computed:

```ts
  for (const uid of preciseEligible) cellEligible.delete(uid);
```

(`cellEligible` must become a mutable copy: `const cellEligible = new Set(eligible ? memberUids : [])`.) The existing reconcile loops then close the redundant cell subs and reopen them when a mutual's precise eligibility lapses — reopen is cancel-free because the peer's cell node persists (last-known model) and the viewer's own-cell gate (`isContextPublished(groupId)`) is part of `cellEligible`'s guard already. On precise flip-off the cell sub reopens on the next reconcile pass (member presence ticks trigger it — same trigger that flipped precise off).

**Test:** with a mutual both cell- and precise-eligible, assert only the precise sub is open (`_activeLocationWatchCount` or the file's sub-map test hooks); flip the mutual's primary off and assert the cell sub reopens.

**Commit:** `perf(roster): one distance sub per mutual — cell closes while precise is live`.

---

### Task 3: locationShare — self-heal stale opted-in gids on denied cell writes

**Files:** Modify `js/locationShare.ts` (tick's cell-publish `.catch`) · Test `tests/locationShare.test.js`

**Re-verify first:** audit Tier 3 elaboration — a kicked-group gid stays opted-in forever: a denied `publishLocationCell` every tick, a denied probe per prefs echo, a permanently-cancelled override watch whose primary-fallback (`:109`) keeps `anyPublishable()` true, so the loop (and its GPS fix) can never idle. The pref's no-membership-filter is deliberate for CLEAR paths (`js/prefs.ts:393-396`) — the sweep must therefore clear the orphaned cell before dropping the pref.

**Design:** in `tick()`, replace the cell publish's empty `.catch(() => {})`:

```ts
    publishLocationCell(gid, uid, pos.lat, pos.lng, now).then(() => markPublished(gid)).catch((err) => {
      // A PERMISSION_DENIED cell write means stale membership (kicked while
      // opted in) — the rules' delete-only carve-out still allows clearing.
      // Sweep: clear the orphaned cell, drop the opt-in, and let the normal
      // teardown paths idle the loop. Anything else stays a silent failed
      // tick (Decision 3).
      if (!/permission.denied/i.test(String((err as { code?: string; message?: string })?.code ?? (err as { message?: string })?.message ?? ''))) return;
      clearLocationCells(uid, [gid]).catch(() => {});
      setLocationOptIn(gid, false);
      unmarkPublished([gid]);
      syncGroupStatusSubs();
      evaluateAvailability();
      document.dispatchEvent(new CustomEvent('location-optin-changed', { detail: { context: gid } }));
    });
```

(Verify the actual rejection shape the web SDK produces for a rules-denied `set` — `error.code === 'PERMISSION_DENIED'` / message contains `permission_denied`; pin whichever the mocked/denied write yields, and note that the emulator behavior was not device-verified.)

**Test:** make `publishLocationCell` reject with `{ code: 'PERMISSION_DENIED' }` for `G1`; after one tick assert `prefs.getLocationOptIn('G1') === false`, `clearLocationCells` called with `['G1']`, one `location-optin-changed` for `G1`, and — with no other context opted in — the loop stopped (no publish on the next 60s advance). Also assert a network-style rejection (`{ code: 'unavailable' }`) changes nothing.

**Commit:** `perf(location): sweep stale gid opt-ins on denied cell writes` — body notes this resolves the known-deferred "harmless denied write every 60s" and the never-idle loop elaboration.

---

### Task 4: knocks — buffer while away instead of full re-init on drawer close / canvas exit

**Files:** Modify `js/knock.ts` (listener drop site ~`:99`, trigger wiring `:483-508`) · Test `tests/knock.test.js` (or the suite covering knocks — locate with `grep -rln "initKnocks" tests/`)

**Re-verify first:** the live `onChildAdded` handler returns early (dropping the event) when `document.visibilityState !== 'visible'`, relying on the next `initKnocks` (fresh `getKnocks` + listener re-attach, up to 5 retries) to re-read from the server; `card-drawer-close` and `canvas-exited` both trigger that full re-init even though the tab never left the foreground and the listener never died.

**Design:**
1. Add a module-level `const _heldWhileAway = new Map<string, KnockPayload>();`. In the live handler, replace the drop (`if (document.visibilityState !== 'visible') return;`) with `{ _heldWhileAway.set(sid, payload); return; }` (same for the on-canvas condition if it guards separately).
2. Add `function drainHeldKnocks() { for (const [sid, payload] of _heldWhileAway) { /* the same deferred-presentation path initKnocks uses for snapshot knocks */ } _heldWhileAway.clear(); }` — route each held knock through the existing deferred-knock presentation helper (locate the function the snapshot path calls; reuse it, do not duplicate).
3. Rewire: `card-drawer-close` and `canvas-exited` call `drainHeldKnocks()` instead of `initKnocks(...)`. `visibilitychange`→visible KEEPS the full `initKnocks` (a genuinely backgrounded tab may have missed events the throttled listener never delivered; the server re-read is the safety net there) but drains the buffer first.

**Test:** simulate a knock arriving while `visibilityState` is mocked non-visible → no float; dispatch `card-drawer-close` → the knock presents, and `getKnocks` was NOT called again; dispatch `visibilitychange` visible → `initKnocks` full path still runs.

**Commit:** `perf(knocks): drain in-memory buffer on drawer-close/canvas-exit instead of re-init`.

---

### Task 5: Boot — stop awaiting the lastVisited write; start the prefs read earlier

**Files:** Modify `js/groupNav.ts` (`navigateToGroup:78`), `js/app.ts:829-847` · Test: existing boot/nav suites (`grep -rln "navigateToGroup" tests/`)

**Re-verify first:** `navigateToGroup` awaits `setLastVisited` (a WRITE) while its UI emit already ran synchronously (`:76`) — so the boot chain (`js/app.ts:847` `await navigateToGroup(groupId)`) holds Stage 4 subscriptions behind a write round-trip; the prefetch chain above it is fully serialized.

**Design:**
1. In `navigateToGroup`, fire-and-forget the write: `setLastVisited(userId, groupId).catch(() => {});` (drop the `await`; keep the function `async` for callers). The write is advisory (last-visited restore) — a lost write costs one wrong restore, same as a crash before it landed today.
2. In `js/app.ts`'s returning-user branch, start the leaf read before the DOM-hiding work: hoist `const ccPromise = getCurrentContextPref(userId);` (or `getUserPrefs` if the preexisting-plan Task 2 hasn't landed) above the `directEl`/`navRowEl` manipulation, and `const cc = await ccPromise;` where the read result is first needed.

**Test:** assert `navigateToGroup` resolves without waiting on a never-resolving `setLastVisited` mock (`jest.fn(() => new Promise(() => {}))`) — the emit/UI observable still happens.

**Commit:** `perf(boot): advisory lastVisited write no longer blocks the boot chain`.

---

### Task 6: Hidden-tab timer hygiene (labels, countdown, favorites peek)

**Files:** Modify `js/following.ts:374` (interval body), `js/me.ts:208-216` (countdown body), `js/favorites.ts:377-431` (`doPeek` head) · Test: the respective suites

**Re-verify first:** all three run DOM work while `document.visibilityState === 'hidden'` (browsers throttle but don't stop them); `js/hintRotation.ts:223-228` is the in-repo pattern done right.

**Design (cheapest correct form — guard, don't re-plumb):**
- `following.ts`: `refreshInterval = setInterval(() => { if (document.visibilityState === 'hidden') return; _refreshTimeLabels(myUserId); }, 60000);` and add a `visibilitychange`→visible catch-up call to `_refreshTimeLabels(myUserId)` where the file already handles visibility (`:478-505` region handles float drains — add the label refresh there).
- `me.ts` `startCountdown`: same guard at the interval head; the existing presence-driven repaints already correct the label on return. The `ms <= 0 → setUnavailable()` branch must run even when hidden (state transition, not paint) — guard only the `textContent` write.
- `favorites.ts` `doPeek`: at function head, `if (document.visibilityState === 'hidden') { setTimeout(doPeek, 6000); return; }` — keeps the schedule alive without style churn.

**Test:** with mocked `visibilityState: 'hidden'`, advance timers and assert no DOM mutation (label text unchanged); flip visible + dispatch `visibilitychange`, assert one catch-up refresh. For `me.ts`, assert expiry still calls `setUnavailable` while hidden.

**Commit:** `perf(timers): skip hidden-tab DOM work in label/countdown/peek loops`.

---

### Task 7: Memoize the remaining hot localStorage parses

**Files:** Modify `js/store.ts:140-151` (`getFavorites`), `js/prefs.ts:260-265` (`readNotifyCache`), `js/prefs.ts:369-375` (`readLocationCache`) · Test `tests/store.test.js`, `tests/prefs.test.js`

**Re-verify first:** `getFavorites` parses per call (called per row-paint via `updateFolloweeRow:1206`); the notify/location caches parse per reconcile pass. The branch's own `_followingRaw` memo (`js/store.ts:24-45`) is the established pattern — raw string re-read and compared every call, so cross-tab writes are still seen.

**Design:** apply the identical raw-string memo to each:

```ts
let _favoritesRaw: string | null = null;
let _favoritesParsed: any[] = [];
function getFavorites(): any[] {
  const raw = localStorage.getItem(FAVORITES_KEY);
  if (raw !== null && raw === _favoritesRaw) return _favoritesParsed.slice();
  let parsed: any[] = [];
  try {
    const p = JSON.parse(raw || '[]');
    if (Array.isArray(p)) parsed = p;
  } catch { /* malformed → [] */ }
  _favoritesRaw = raw;
  _favoritesParsed = parsed;
  return parsed.slice();
}
```

Same shape for `readNotifyCache`/`readLocationCache` (memo the parsed map; return a shallow copy where callers mutate — `readNotifyCache`'s caller in `syncFromServer` mutates the returned map, so return `{ ..._parsed }`).

**Test:** spy on `JSON.parse`; two consecutive `getFavorites()` calls with an unchanged store parse once; a `localStorage.setItem` (cross-tab simulation) re-parses. Mirror for the prefs caches; assert `syncFromServer`'s mutate-then-write path still round-trips correctly.

**Commit:** `perf(cache): raw-string memos for favorites and notify/location prefs parses`.

---

### Task 8: locationShare — one Permissions API query, tracked via change event

**Files:** Modify `js/locationShare.ts:207-217` (`tickPermissionGranted`), `_resetLocationShare` · Test `tests/locationShare.test.js`

**Design:** query once, cache the `PermissionStatus`, subscribe to its `change` event; the tick reads the cached state synchronously. Falls back to per-tick query when `status.addEventListener` is unavailable. Clear the cached status in `_resetLocationShare`.

```ts
let _geoPermStatus: { state: string; addEventListener?: (t: string, l: () => void) => void } | null = null;
async function tickPermissionGranted(): Promise<boolean> {
  if (isTelegramContext()) return true;
  const perms = (navigator as Navigator & {
    permissions?: { query?: (d: { name: string }) => Promise<{ state: string; addEventListener?: (t: string, l: () => void) => void }> };
  }).permissions;
  if (!perms?.query) return true;
  if (_geoPermStatus) return _geoPermStatus.state === 'granted';
  try {
    const status = await perms.query({ name: 'geolocation' });
    if (typeof status.addEventListener === 'function') _geoPermStatus = status; // else keep per-tick queries
    return status.state === 'granted';
  } catch { return true; }
}
```

(`change` needs no handler beyond keeping `state` live — the browser mutates the retained object; an explicit listener is only needed if a revocation should proactively tear down, which the existing code-1 handling on the next tick already covers.)

**Test:** mock `navigator.permissions.query`; two ticks → one query. Reset → re-queries.

**Commit:** `perf(location): cache the geolocation PermissionStatus across ticks`.

---

### Task 9: uid→row-element maps for the two hot lists

**Files:** Modify `js/following.ts:73-75` (`followeeRow`) and its render pass; `js/groupContext.ts:426` (`paintRosterRow` default arg) and `renderRoster` · Test: existing suites

**Re-verify first:** both helpers run an attribute-selector scan per row repaint; with per-minute distance/presence ticks this is O(rows²)/min. Trivial at current sizes — do this task only as part of this batch, not standalone.

**Design:** maintain `const _rowByUid = new Map<string, HTMLElement>()` per surface: populate in the reconcile `create` hook, refresh in `update` (node is passed in), delete in `onRemove`, clear on full teardown (`initList` head / `exitGroupContext`). `followeeRow` / `paintRosterRow`'s default become map lookups with the querySelector as fallback (`_rowByUid.get(uid) ?? document.querySelector(...)` — the fallback covers rows created outside reconcile, e.g. float restores).

**Test:** after a render pass, `followeeRow` returns the same node without a live `querySelector` (spy on `document.querySelector` and assert not called for a mapped uid); unfollow removes the map entry (no stale node reuse).

**Commit:** `perf(lists): O(1) row lookup maps for Direct list and group roster`.

---

### Task 10: canvasDelta — reuse the preview buffer

**Files:** Modify `js/canvasDelta.ts:17-27` (`applyDrawingPayload`), its caller in `js/canvas.ts:453-458` · Test `tests/canvasDelta.test.js` (or wherever `applyDrawingPayload` is covered — `grep -rln "applyDrawingPayload" tests/`)

**Re-verify first:** the append path copies the whole buffer per 80 ms tick (`buffer.slice(0, base).concat(points)`).

**Design:** mutate in place on the append path; keep the copy semantics only where the payload replaces the buffer:

```ts
export function applyDrawingPayload(
  buffer: number[][] | null,
  p: { points?: number[][]; base?: number },
): number[][] {
  const points = p.points ?? [];
  const base = p.base;
  if (base === undefined || base === 0 || !buffer) return points.slice();
  // In-place append: truncate to base (coalesced-write gap joins as before)
  // and push the tail — the old slice().concat() copied the whole stroke
  // every 80ms tick. Callers hold the same array identity across ticks.
  buffer.length = Math.min(base, buffer.length);
  for (const pt of points) buffer.push(pt);
  return buffer;
}
```

Verify the `js/canvas.ts` caller treats the return value as the new buffer (it does today — assignment) and nothing else aliases the pre-call array expecting immutability (`grep -n "applyDrawingPayload" js/`).

**Test:** existing behavior tests must pass unchanged; add one asserting array identity is preserved on append (`expect(result).toBe(buffer)`) and that the legacy full-replace path still returns a fresh array.

**Commit:** `perf(canvas): in-place preview-buffer append in applyDrawingPayload`.

---

### Task 11: canvas — remove the leaked capture-phase pointerdown listener

**Files:** Modify `js/canvas.ts:269-277` (`buildFloatingUI`), `exitCanvas` teardown (`:544-567` region) · Test: the canvas suite

**Re-verify first:** `buildFloatingUI` adds a capture-phase `pointerdown` to the persistent container on every `enterCanvas`; `exitCanvas` removes gesture/touch/pointer listeners (`:553-567`) but not this one — each call session leaks one closure over that session's toolbox.

**Design:** hoist the handler to a module-level named function bound to the CURRENT toolbox via a module variable (`let _activeToolbox: HTMLElement | null`), register it once per `enterCanvas` and remove it in `exitCanvas` alongside `gesturestart`/`touchmove`:

```ts
const _onScreenPointerDownCapture = (e: PointerEvent) => {
  const toolbox = _activeToolbox;
  if (!toolbox) return;
  if (!toolbox.contains(e.target as Node | null) && toolbox.classList.contains('open')) {
    animateToolbox(toolbox, false);
    const undo = document.getElementById('canvas-undo');
    if (undo) undo.style.display = '';
    e.stopPropagation();
    _isDrawing = false;
  }
};
```

`buildFloatingUI` sets `_activeToolbox = toolbox; container.addEventListener('pointerdown', _onScreenPointerDownCapture, true);` — `exitCanvas` adds `screen.removeEventListener('pointerdown', _onScreenPointerDownCapture, true); _activeToolbox = null;`.

**Test:** enter/exit canvas twice; assert the outside-tap close fires exactly once per pointerdown (count `animateToolbox` calls or the `_isDrawing` flip), not once per past session.

**Commit:** `fix(canvas): remove capture pointerdown listener on exit (leak per session)`.

---

### Task 12: Single `watchUserGroups` listen — removal detector rides groupNav's enumeration

**Files:** Modify `js/groupNav.ts` (export a small enumeration subscription), `js/groups.ts:154-166` (`initGroupRemovalDetector`) · Test: the groups/groupNav suites

**Re-verify first:** two independent `onValue`s on `users/{uid}/groups` (`groupNav.ts:175`, `groups.ts:157`). SDK-coalesced at the wire, but every enumeration change is processed twice and the two consumers can disagree transiently.

**Design:** in `groupNav.ts`, add alongside `subscribeGroupMeta`:

```ts
// Enumeration fan-out so other modules (groups.ts removal detector) don't
// open their own users/{uid}/groups listen. Replays the current enumeration
// to a late subscriber only after the first server tick (_enumTicked).
const _enumConsumers = new Set<(collection: Record<string, unknown>) => void>();
export function subscribeGroupEnumeration(cb: (collection: Record<string, unknown>) => void): () => void {
  _enumConsumers.add(cb);
  if (_enumTicked) { try { cb({ ..._enumeration }); } catch { /* replay threw */ } }
  return () => { _enumConsumers.delete(cb); };
}
```

Fan out inside the existing `watchUserGroups` callback (after `renderNavRow()`): `for (const cb of [..._enumConsumers]) { try { cb({ ..._enumeration }); } catch { /* consumer threw */ } }` — and clear `_enumConsumers` in the same reset block that clears `_metaConsumers`. `initGroupRemovalDetector` swaps `watchUserGroups(myUserId, ...)` for `subscribeGroupEnumeration(...)`; its `_prevEnum === null` first-tick skip logic is unchanged.

**Boot-order check (step, not assumption):** confirm `initNav` runs before `initGroupRemovalDetector` in `js/app.ts` (grep both); if the detector can init first, the replay-after-first-tick semantics above make it safe (it just waits for the first fan-out) — document which case holds.

**Test:** drive one enumeration tick; assert the detector saw it without opening a second db watch (`db.watchUserGroups` called once across both modules).

**Commit:** `perf(groups): removal detector consumes groupNav's enumeration (one listen)`.

---

### Task 13: Small no-op-write / cache batch (three one-liners)

**Files:** `js/inbox.ts:146-151` · `functions/telegram.js:198-204` · `js/db/social.ts:293-295` + its `js/app.ts` call site · Tests: respective suites

**13a — inbox: cache null group-name results.** `cachedReadGroupName` only stores truthy results, so a deleted group's name is re-fetched on every modal render. Change `if (group) _groupNameCache.set(groupId, group);` → `_groupNameCache.set(groupId, group ?? null);` (the `has()` check already handles stored nulls).

**13b — telegram `/start`: skip the route write when unchanged.** Wrap the `rootUpdate` (`telegram.js:201-204`): `if (!known || known.chatId !== chatId) { await rootUpdate(...) }` — `known` is the mapping read `resolveTelegramUid` already performed; both route sides are always written together (same multi-path update), so the one-sided check is sound. Keep the existing comment; add "skipped when the chat id is already current".

**13c — throttle `touchLastSeen`.** Every app open stamps `lastSeen`, ticking F followers' presence watchers. In `js/app.ts` `startSubscriptions`, gate the call with a per-device localStorage stamp:

```ts
  const LAST_SEEN_TOUCH_KEY = 'statusapp_lastseen_touched';
  const lastTouch = Number(localStorage.getItem(LAST_SEEN_TOUCH_KEY) || 0);
  if (Date.now() - lastTouch > 30 * 60 * 1000) {
    touchLastSeen(userId).catch(() => {});
    try { localStorage.setItem(LAST_SEEN_TOUCH_KEY, String(Date.now())); } catch { /* quota */ }
  }
```

(30 min: `formatLastSeen`'s display granularity is far coarser than per-open precision; `setStatus` still stamps on every real status write.)

**Tests:** 13a — two renders with a deleted group hit `readGroupName` once. 13b — repeat `/start` with same chatId performs no `rootUpdate` (assert on the deps fixture); changed chatId still writes both paths. 13c — two boots inside the window call `touchLastSeen` once.

**Commit:** `perf: null-cache inbox group names; skip no-op /start route write; throttle lastSeen touch`.

---

### Task 14: ownStatus rides presenceHub (hygiene)

**Files:** Modify `js/ownStatus.ts:29` (`initOwnStatus`) · Test `tests/ownStatus.test.js` (locate: `grep -rln "initOwnStatus" tests/`)

**Re-verify first:** `initOwnStatus` opens `watchPresence(uid, ...)` directly while `statusStore.ensurePrimaryWatch` opens the same path through `presenceHub` — SDK-coalesced at the wire (negligible; audit resolved this as local-only duplication), so this is hygiene: one hub, one dedupe layer, one cancel policy.

**Design:** swap the direct watch for the hub (`import { subscribePresence } from './presenceHub.js';`):

```ts
  _unsub = subscribePresence(uid, (data) => {
    _last = data;
    ...unchanged fan-out...
  });
```

**ORDERING INVARIANT (from the file header — must survive):** callbacks fire in registration order; app.js's Direct-theme write must precede groupContext's override-theme re-apply on the same tick. `presenceHub`'s replay/fan-out semantics differ from a raw `onValue` (cached synchronous replay to late subscribers) — verify with the existing ownStatus ordering test (there is one pinning the invariant; if not, WRITE it before the swap) that the observable order is unchanged. If presenceHub's replay changes first-tick ordering for any consumer, STOP and report — do not force this task.

**Commit:** `refactor(ownStatus): route own-presence watch through presenceHub`.

---

## Final gate (after whichever tasks ship)

- [ ] `npx jest --maxWorkers=2` green · `cd functions && npm test` green (then back to root) · `npm run typecheck && npm run typecheck:scripts` clean · `npm run test:rules` green (no rules touched here — regression gate only)
- [ ] Every task that shipped re-verified its finding first (per Global Constraints); any STOPped task is reported, not half-landed

## Self-review notes

- **Coverage vs Tier 3 list:** roster repaint→T1 · dual subs→T2 · stale gid→T3 · initKnocks→T4 · boot serialization→T5 · hidden timers→T6 · localStorage parses→T7 · Permissions query→T8 · selector scans→T9 · canvasDelta copy→T10 · canvas leak→T11 · watchUserGroups→T12 · inbox null-cache + /start write + touchLastSeen→T13 · ownStatus→T14. Explicitly skipped items are listed at the top with reasons.
- **Highest leverage:** T1 (roster churn) and T3 (loop can idle again) — do these first if the batch is cut short.
- **Risk callouts:** T4 touches a carefully-ordered event pipeline (held/deferred knocks) — reuse the existing deferred-presentation helper, never a parallel path. T14 has an explicit STOP condition on the ordering invariant. T3 pins an SDK error shape that was not device-verified — the task says so.
- **Tier 3 items were not individually re-verified by the audit session** — hence the mandatory per-task re-verify step.
