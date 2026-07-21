# Performance Fixes — Audit #2 Batch (N1, N2, N4, N7, N8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the operator-selected batch from `docs/superpowers/specs/2026-07-21-performance-audit-2-findings.md`: restore the canvas lazy-split (N1), let the stale-membership sweep fire without movement (N2), stop paying a presence read for color-only override edits (N4), read the availability sender's code once instead of per group (N7), catch the countdown label up on return-to-visible (N8) — plus the 2026-07-21 fold-in: appearance-only roster fast path (N3), lazy-load `groupContext` and the Telegram-context-only flows (N5), per-stroke canvas derivations (N9), and on-demand `canvas.css` (N10).

**Architecture:** Ten independent, individually-shippable tasks — client hot-path fixes (N2, N3, N8, N9), client build/boot fixes (N1, N5×2, N10), two Cloud Functions read reductions (N4, N7). No schema changes, no rules changes, no reviewed-decision territory. Ordered by leverage; any subset can ship. Tasks 7 and 8 both edit `js/app.ts` — execute them in order, not in parallel. N5 scope revisions found during planning verification: the inbox split is dropped (its heavy imports — `groups`, `groupNav`, `groupDisplayNamePrompt` — are already-eager core modules, and `renderInboxNavSlot` is pinned into the eager nav reconcile, so the split is a real refactor for ~400 own-lines of savings); `telegramOnramp`/`telegramEscapeHatch` stay eager (web-facing — see the spec's N5 corrections).

**Tech Stack:** vanilla TS + esbuild (ESM code-splitting already on), Firebase RTDB web SDK, Cloud Functions v2 (plain JS + JSDoc), Jest (web at repo root, functions in `functions/`).

## Global Constraints

- Zero TS suppressions (`@ts-ignore`/`@ts-expect-error`/`as any`) — repo-wide standing rule.
- Do NOT touch `/sw.js` caching (`no-store` + `updateViaCache: 'none'` are deliberate and test-pinned) or the SW registration URL.
- This repo's Jest uses `--testPathPatterns` (plural). Web: `npx jest --maxWorkers=2` at repo root. Functions: `cd functions && npm test` — then `cd /home/user/on` back (the lingering-cwd landmine).
- Typecheck: `npm run typecheck` at repo root.
- Never edit `functions/_shared/*` directly — it mirrors `shared/` via `npm run sync-shared`. (No task below touches either.)
- Maintainer merges to dev/main — no merges, no PRs.
- Fresh container: `apt-get update; apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev` (use `;` — PPAs 403), then `npm ci ; cd functions && npm ci ; cd /home/user/on`.

---

### Task 1: N1 — restore the canvas lazy-split (drop the static import)

**Files:**
- Modify: `js/following.ts:31` (delete), `js/following.ts:357-358`, `js/following.ts:912-914`
- Test: existing `tests/following.test.js`, `tests/canvas.test.js`, `tests/canvas-screenshot.test.js` (no new tests — behavior is unchanged; the deliverable is the build output)

**Interfaces:**
- Consumes: `canvas.ts`'s existing exports `enterCanvas`, `exitCanvas`, `showPeerLeftDialog` (signatures unchanged).
- Produces: nothing new — later tasks don't depend on this one.

**Why:** `js/following.ts:31` statically imports `./canvas.js` while `:503` dynamically imports it. esbuild folds any statically-referenced module into the importer's chunk, so the ~950-line canvas engine (+ `canvasDelta.ts`) lands in the entry bundle for every visitor and the dynamic import resolves in-bundle — no chunk is ever emitted. `following.ts:31` is the **only** static importer in `js/` (verified 2026-07-21). Only `enterCanvas` (two call sites) actually uses the static binding; the `exitCanvas`/`showPeerLeftDialog` static bindings are shadowed dead weight (`:503-504` uses its own dynamically-imported pair).

- [ ] **Step 1: Re-verify the import situation** (guards against drift since the audit)

Run: `grep -rn "from './canvas.js'" js/`
Expected: exactly one hit — `js/following.ts:31`. If more appear, STOP and re-scope.

- [ ] **Step 2: Delete the static import**

In `js/following.ts`, delete line 31:

```ts
import { enterCanvas, exitCanvas, showPeerLeftDialog } from './canvas.js';
```

- [ ] **Step 3: Convert the answered-call site (was :357-358)**

Replace:

```ts
        enterCanvas(peerId, resolveDisplayName(entry), myUserId, myColor, peerColor, peerSurface, () => exitCallMode(myUserId))
          .catch((err) => console.error('enterCanvas (answered) failed:', err));
```

with:

```ts
        // Lazy chunk: the canvas engine loads on first call entry, not at boot
        // (audit-2 N1 — a stray static import defeated the split).
        import('./canvas.js')
          .then(({ enterCanvas }) => enterCanvas(peerId, resolveDisplayName(entry), myUserId, myColor, peerColor, peerSurface, () => exitCallMode(myUserId)))
          .catch((err) => console.error('enterCanvas (answered) failed:', err));
```

(The surrounding synchronous state mutations — `callModeCalleeId = peerId; _incomingCall = null;` — stay before the import, unchanged. The single `.catch` now also covers a failed chunk fetch.)

- [ ] **Step 4: Convert the answer-swipe site (was :912-914)**

Replace:

```ts
          enterCanvas(entry.userId, resolveDisplayName(entry), myUserId, myColor, peerColor, peerSurface, () => {
            exitCallMode(myUserId);
          }).catch(err => console.error('enterCanvas failed:', err));
```

with:

```ts
          import('./canvas.js')
            .then(({ enterCanvas }) => enterCanvas(entry.userId, resolveDisplayName(entry), myUserId, myColor, peerColor, peerSurface, () => {
              exitCallMode(myUserId);
            }))
            .catch(err => console.error('enterCanvas failed:', err));
```

Leave `:503` (`handlePeerEnded`) exactly as it is — it is already the correct pattern.

- [ ] **Step 5: Typecheck + run the affected suites**

Run: `npm run typecheck && npx jest --maxWorkers=2 --testPathPatterns "following|canvas"`
Expected: typecheck clean (the two dead static bindings are gone, so no unused-import noise); all tests PASS. Note `tests/following.test.js:1627` runs `enterCanvas` unmocked in jsdom — babel-jest compiles `import()` to `require`, so the call stays effectively synchronous under Jest and the existing assertions hold.

- [ ] **Step 6: Verify the split in real build output**

Run: `npm run build && ls dist/chunks/ && grep -c "chunks/canvas" index.html`
Expected: a new `canvas-<hash>.js` chunk in `dist/chunks/`; `grep -c` prints `0` (the modulepreload flattener correctly excludes lazy chunks — `scripts/build.js:96-136`). The SW `__CHUNK_LIST__` picks the chunk up automatically (precache-all is the current contract; revisiting it is audit-2 N6, out of scope here).

- [ ] **Step 7: Full web suite**

Run: `npx jest --maxWorkers=2`
Expected: all green (2049 baseline).

- [ ] **Step 8: Commit**

```bash
git add js/following.ts
git commit -m "perf(boot): lazy-load the canvas engine — drop the static import that defeated the split"
```

---

### Task 2: N2 — stale-membership probe: let the sweep fire without movement

**Files:**
- Modify: `js/locationShare.ts:50-60` (`_lastPublished` type + new constant), `:273-294` (tick's direct + cell branches)
- Modify: `docs/superpowers/specs/2026-07-21-performance-audit-2-findings.md` (N2 severity nuance — Step 6)
- Test: `tests/locationShare.test.js`

**Interfaces:**
- Consumes: existing `publishLocationCell` mock harness and `_resetLocationShare` in `tests/locationShare.test.js`.
- Produces: `_lastPublished: Map<string, { lat: number; lng: number; landedAt: number }>` (internal), `STALE_MEMBERSHIP_PROBE_MS = 600000` (internal). No exported API changes.

**Why:** The no-op suppression (`:291`, audit F1 fix) skips the cell write whenever the snapped cell is unchanged — but the stale-membership sweep (`:295-311`, audit Tier-3 fix) lives in that write's `.catch` and needs a `PERMISSION_DENIED` rejection to fire. A member kicked **mid-session** keeps the landed cell in `_lastPublished` and a stale gid snapshot in `_gidSnapshots`, so while stationary the write — and the sweep — never happens, and the 60s loop plus its GPS fix can't idle. (A fresh boot self-heals: `_lastPublished` starts empty, so the first tick writes, gets denied, and sweeps — the exposure is bounded to the remainder of the session in which the kick happened. Step 6 records this correction to the spec.) Fix: let an unchanged cell write through once per 10-minute probe window; a landed probe re-arms the window, a denied probe fires the existing sweep unchanged.

- [ ] **Step 1: Write the failing probe test**

Append to `tests/locationShare.test.js`:

```js
test('an unchanged cell is re-attempted once the stale-membership probe window lapses (audit-2 N2)', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 7200000 });
  await toggleContext('G1');
  await flush();
  expect(db.publishLocationCell).toHaveBeenCalledTimes(1); // initial cell landed
  db.publishLocationCell.mockClear();
  // Stationary: the next nine 60s ticks are all no-op-suppressed (audit F1).
  for (let i = 0; i < 9; i++) { jest.advanceTimersByTime(60000); await flush(); }
  expect(db.publishLocationCell).not.toHaveBeenCalled();
  // The tenth tick crosses the 10-min probe window: the unchanged cell is
  // written once anyway, so a stale membership can be caught (the sweep keys
  // off this write's rejection — audit-2 N2).
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.publishLocationCell).toHaveBeenCalledTimes(1);
  db.publishLocationCell.mockClear();
  // A landed probe re-arms the window: the following tick suppresses again.
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.publishLocationCell).not.toHaveBeenCalled();
});

test('a kicked, stationary member is swept by the probe write without crossing a cell boundary (audit-2 N2)', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 7200000 });
  await toggleContext('G1');
  await flush();
  expect(db.publishLocationCell).toHaveBeenCalledTimes(1);
  // Kick happens server-side: the client keeps the opt-in, the landed cell in
  // _lastPublished, and the (now stale) gid status fallback. All later cell
  // writes are rules-denied.
  db.publishLocationCell.mockRejectedValue({ code: 'PERMISSION_DENIED' });
  db.publishLocationCell.mockClear();
  const seen = [];
  document.addEventListener('location-optin-changed', (e) => seen.push(e.detail.context));
  // Stationary — no cell boundary is ever crossed. Nine suppressed ticks…
  for (let i = 0; i < 9; i++) { jest.advanceTimersByTime(60000); await flush(); }
  expect(db.publishLocationCell).not.toHaveBeenCalled();
  // …then the probe tick attempts the write; the denial fires the existing sweep.
  jest.advanceTimersByTime(60000);
  await flush();
  await flush();
  expect(prefs.getLocationOptIn('G1')).toBe(false);
  expect(db.clearLocationCells).toHaveBeenCalledWith('me', ['G1']);
  expect(seen).toEqual(['G1']);
  // Sweep idled the loop: nothing publishes on the next advance.
  db.publishLocationCell.mockClear();
  jest.advanceTimersByTime(60000);
  await flush();
  expect(db.publishLocationCell).not.toHaveBeenCalled();
});
```

(Harness notes: `share()`, `flush()`, `prefs`, `ownStatus`, `db` all exist at the top of the file; modern fake timers advance `Date.now()`, which the probe-window math relies on. The statusStore mock never fires a G1 snapshot in these tests, so `contextAvailable('G1')` runs on the primary-presence fallback — exactly the stale-membership shape.)

- [ ] **Step 2: Run to verify both fail**

Run: `npx jest --maxWorkers=2 --testPathPatterns locationShare`
Expected: FAIL — first test's probe tick publishes nothing (suppression is unconditional today); second test's sweep assertions fail the same way.

- [ ] **Step 3: Implement the probe window**

In `js/locationShare.ts`, extend the `_lastPublished` declaration (`:59`) and add the constant directly below it:

```ts
const _lastPublished = new Map<string, { lat: number; lng: number; landedAt: number }>();
const RAW_REPUBLISH_MIN_METERS = 10;
// Audit-2 N2: the no-op skip above must not permanently silence the write the
// stale-membership sweep keys off. A mid-session kick leaves the landed cell
// in _lastPublished (nothing clears it client-side) while the gid still looks
// available via the status fallback — a stationary user would never attempt
// the denied write that fires the sweep, and the loop (plus its per-minute
// GPS fix) could not idle until a ~1.1km cell boundary was crossed. Let an
// unchanged cell through once per probe window; a landed probe re-arms it.
const STALE_MEMBERSHIP_PROBE_MS = 600000;
```

In `tick()`, update the direct branch's resolve hook (`:277-280`) to record `landedAt` (kept for type uniformity; the direct skip stays distance-only — the Direct node is the user's own, no membership to go stale):

```ts
      publishLocation(uid, pos.lat, pos.lng, now).then(() => {
        _lastPublished.set('direct', { lat: pos.lat, lng: pos.lng, landedAt: now });
        markPublished('direct');
      }).catch(() => {});
```

And the cell loop's skip + resolve hook (`:290-294`):

```ts
    const last = _lastPublished.get(gid);
    if (last && last.lat === cell.lat && last.lng === cell.lng
        && now - last.landedAt < STALE_MEMBERSHIP_PROBE_MS) continue;
    publishLocationCell(gid, uid, pos.lat, pos.lng, now).then(() => {
      _lastPublished.set(gid, { lat: cell.lat, lng: cell.lng, landedAt: now });
      markPublished(gid);
    }).catch((err) => {
```

(The `.catch` sweep body is untouched. `unmarkPublished`/`revokePermissionTeardown` already delete/clear whole entries, so the shape change needs no further edits.)

- [ ] **Step 4: Run the new tests + the whole locationShare suite**

Run: `npx jest --maxWorkers=2 --testPathPatterns locationShare && npm run typecheck`
Expected: PASS (including the pre-existing F1 suppression tests — nine minutes of suppression is well inside their one-or-two-tick windows) and a clean typecheck.

- [ ] **Step 5: Full web suite**

Run: `npx jest --maxWorkers=2`
Expected: all green.

- [ ] **Step 6: Record the severity correction in the audit spec**

In `docs/superpowers/specs/2026-07-21-performance-audit-2-findings.md`, in the N2 section, replace the sentence:

```
Meanwhile the cancelled override watch's primary fallback keeps `contextAvailable(gid)` true, so `anyPublishable()` holds and the 60s loop plus its coarse GPS fix run indefinitely for a phantom membership — exactly the never-idle cost `d079d55` was written to eliminate, surviving in the stationary case. Sweep fires only on physically crossing a cell boundary.
```

with:

```
Meanwhile the stale gid still evaluates available (stale snapshot, then the primary fallback), so `anyPublishable()` holds and the 60s loop plus its coarse GPS fix keep running for a phantom membership — the never-idle cost `d079d55` was written to eliminate, surviving in the stationary case. Scope correction (implementation session): a FRESH boot self-heals — `_lastPublished` starts empty, so the first tick writes, is denied, and sweeps; the exposure is the remainder of the session in which the kick happened (real on long-lived installed-PWA sessions), plus a cell-boundary crossing at any time. Fixed by a 10-min probe window on the no-op skip (`STALE_MEMBERSHIP_PROBE_MS`).
```

- [ ] **Step 7: Commit**

```bash
git add js/locationShare.ts tests/locationShare.test.js docs/superpowers/specs/2026-07-21-performance-audit-2-findings.md
git commit -m "perf(location): probe unchanged cells every 10min so a stale membership sweeps without movement"
```

---

### Task 3: N4 — gate the override notify path on availability-relevant fields only

**Files:**
- Modify: `functions/notifier.js:319-333` (rename + narrow the comparator), `functions/index.js:158-173` (import + gate + comment)
- Test: `functions/test/notifier.test.js:868-885` (existing describe block)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `availabilityRelevantOverrideChange(a, b): boolean` exported from `functions/notifier.js`, replacing `statusOverrideChanged` (deleted — `functions/index.js` and the test file are its only consumers, verified 2026-07-21).

**Why:** `statusOverrideChanged` returns true on `statusColor` diffs, but `effectiveAvailable` (`functions/presence-core.js:56-59`) reads only `enabled`/`status`/`availableUntil` — so a color-only override write (group complement-color tap, `js/groups.ts:294-304` `setOverrideAppearance`) passes the gate, and `handleGroupOverrideChange` burns a full `users/{uid}/presence` read to compute a guaranteed `wasOn === isOn` no-op. This is the hottest function-triggering client path. (`paletteKey`-only writes already skip — the comparator never compared it.)

- [ ] **Step 1: Update the tests first**

In `functions/test/notifier.test.js`: in the import at `:2`, replace `statusOverrideChanged` with `availabilityRelevantOverrideChange`. Replace the describe block at `:868` with:

```js
describe('availabilityRelevantOverrideChange (merged member-trigger gate)', () => {
  test('absent on both sides is not a change', () => {
    expect(availabilityRelevantOverrideChange(null, undefined)).toBe(false);
    expect(availabilityRelevantOverrideChange(undefined, undefined)).toBe(false);
  });
  test('appearing or vanishing is a change', () => {
    expect(availabilityRelevantOverrideChange(null, { enabled: true })).toBe(true);
    expect(availabilityRelevantOverrideChange({ enabled: true }, null)).toBe(true);
  });
  test('availability-relevant field diffs are changes', () => {
    const a = { enabled: true, status: 'available', statusColor: 'blue', availableUntil: 99 };
    expect(availabilityRelevantOverrideChange(a, { ...a })).toBe(false);
    expect(availabilityRelevantOverrideChange(a, { ...a, enabled: false })).toBe(true);
    expect(availabilityRelevantOverrideChange(a, { ...a, status: 'unavailable' })).toBe(true);
    expect(availabilityRelevantOverrideChange(a, { ...a, availableUntil: 100 })).toBe(true);
  });
  test('appearance-only diffs are NOT changes — effectiveAvailable never reads them (audit-2 N4)', () => {
    const a = { enabled: true, status: 'available', statusColor: 'blue', availableUntil: 99 };
    expect(availabilityRelevantOverrideChange(a, { ...a, statusColor: 'red' })).toBe(false);
    expect(availabilityRelevantOverrideChange(a, { ...a, paletteKey: 'sunset' })).toBe(false);
  });
});
```

(Preserve any assertions from the old block not shown here by porting them under the new name with the same expected values — except the `statusColor` case, which flips to `false` by design.)

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm test`
Expected: FAIL — `availabilityRelevantOverrideChange` is not exported.

- [ ] **Step 3: Rename and narrow the comparator**

In `functions/notifier.js`, replace the `statusOverrideChanged` export (`:319-333`, including its doc comment) with:

```js
// Availability-relevant field-compare of two statusOverride values. The merged
// member-node trigger (index.js onMemberWritten) uses this to skip the notify
// path — and its presence read — when a member write couldn't have changed
// effectiveAvailable: displayName/join writes, and appearance-only override
// edits (statusColor/paletteKey, written per group palette tap — audit-2 N4).
// effectiveAvailable (presence-core.js) reads only enabled/status/availableUntil.
// null and undefined both mean "absent".
/**
 * @param {StatusOverride | null | undefined} a
 * @param {StatusOverride | null | undefined} b
 */
export function availabilityRelevantOverrideChange(a, b) {
  if (a == null || b == null) return (a ?? null) !== (b ?? null);
  return a.enabled !== b.enabled
    || a.status !== b.status
    || a.availableUntil !== b.availableUntil;
}
```

In `functions/index.js`: update the import of `statusOverrideChanged` to `availabilityRelevantOverrideChange`, change the gate at `:170` to `if (availabilityRelevantOverrideChange(beforeOv, afterOv)) {`, and in the trigger's comment block (`:160-162`) extend "so displayName/join writes skip the notify path (and its presence read)" to "so displayName/join writes and appearance-only override edits skip the notify path (and its presence read)".

- [ ] **Step 4: Run the functions suite**

Run: `npm test` (still in `functions/`), then `cd /home/user/on`
Expected: PASS (432 baseline). The existing `handleGroupOverrideChange` behavior tests are unaffected — the function body is untouched; only its gate narrowed.

- [ ] **Step 5: Commit**

```bash
git add functions/notifier.js functions/index.js functions/test/notifier.test.js
git commit -m "perf(functions): skip the override notify gate (and its presence read) on appearance-only edits"
```

---

### Task 4: N7 — resolve the availability sender's code once, thread it through the group fan-out

**Files:**
- Modify: `functions/notifier.js:126-137` (`resolveGroupMemberName`), `:257` + `:263-264` (`notifyGroupAvailability`), `:401-406` (`handleAvailability` sender fallback), `:443` (group-pass call)
- Test: `functions/test/notifier.test.js` (extend `resolveGroupMemberName` + `handleAvailability` describes)

**Interfaces:**
- Consumes: nothing from other tasks (independent of Task 3's rename).
- Produces: `resolveGroupMemberName(deps, groupId, uid, fallback = null)` — new optional 4th param; `notifyGroupAvailability(deps, groupId, memberUid, now, alreadyNotified = null, senderFallback = null)` — new optional 6th param. Both default to the current behavior; `handleGroupOverrideChange`'s call (`:315`) intentionally keeps the defaults.

**Why:** `handleAvailability` resolves the sender's `users/{uid}/presence/code` once (`:404-406`) for the Direct pass, but the group pass calls `notifyGroupAvailability` → `resolveGroupMemberName` per override-off group, and that helper re-reads the very same leaf every time (`:130-133`, `memberUid === uid` here). G override-off groups → G duplicate reads of one already-held value per availability broadcast.

- [ ] **Step 1: Write the failing tests**

In `functions/test/notifier.test.js`, add to the `resolveGroupMemberName` describe (`:227`):

```js
  test('a precomputed fallback skips the presence/code read entirely (audit-2 N7)', async () => {
    const deps = makeDeps({ store: { 'users/u/presence/code': 'ABC123' } });
    expect(await resolveGroupMemberName(deps, 'g1', 'u', 'K7Q2ZP')).toBe('K7Q2ZP');
    expect(deps.getVal).toHaveBeenCalledTimes(1);
    expect(deps.getVal).toHaveBeenCalledWith('groups/g1/members/u/displayName');
  });
  test('displayName still wins over a precomputed fallback', async () => {
    const deps = makeDeps({ store: { 'groups/g1/members/u/displayName': 'Bobby' } });
    expect(await resolveGroupMemberName(deps, 'g1', 'u', 'K7Q2ZP')).toBe('Bobby');
  });
```

And to the `handleAvailability` describe:

```js
  test('group fan-out reads users/{uid}/presence/code exactly once across groups (audit-2 N7)', async () => {
    const deps = makeDeps({ store: {
      'users/star/presence/status': 'available',
      'users/star/presence/code': 'STARCODE',
      'users/star/groups': { g1: true, g2: true, g3: true },
      'groups/g1/members': { star: {}, m1: {} },
      'groups/g2/members': { star: {}, m2: {} },
      'groups/g3/members': { star: {}, m3: {} },
      'notifierState/availability/star': null,
    }});
    await handleAvailability(deps, 'star', null, FUTURE);
    const codeReads = deps.getVal.mock.calls.filter(([p]) => p === 'users/star/presence/code').length;
    expect(codeReads).toBe(1);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm test`
Expected: FAIL — the precomputed-fallback test sees 2 `getVal` calls; the fan-out test counts 3 code reads (one per group; the sender has no followers, so today's conditional Direct-pass read never happens).

- [ ] **Step 3: Implement the threading**

`functions/notifier.js` — `resolveGroupMemberName` (`:126-137`):

```js
/**
 * @param {NotifierDeps} deps
 * @param {string} groupId
 * @param {string} uid
 * @param {string | null} [fallback]
 */
export async function resolveGroupMemberName(deps, groupId, uid, fallback = null) {
  // A precomputed fallback (the member's code resolved once by the caller)
  // skips the per-group re-read of users/{uid}/presence/code — the availability
  // group fan-out otherwise re-reads the same leaf once per override-off group
  // (audit-2 N7). Precedence unchanged: displayName > code > 'Someone'.
  if (fallback !== null) {
    const displayName = await deps.getVal(`groups/${groupId}/members/${uid}/displayName`);
    return displayName || fallback;
  }
  const [displayName, code] = await Promise.all([
    deps.getVal(`groups/${groupId}/members/${uid}/displayName`),
    deps.getVal(`users/${uid}/presence/code`),
  ]);
  if (displayName) return displayName;
  if (code) return code;
  return 'Someone';
}
```

`notifyGroupAvailability` (`:257`, `:263-264`): add the param and pass it through —

```js
export async function notifyGroupAvailability(deps, groupId, memberUid, now, alreadyNotified = null, senderFallback = null) {
```

```js
    resolveGroupMemberName(deps, groupId, memberUid, senderFallback),
```

(JSDoc: add `@param {string | null} [senderFallback]`.)

`handleAvailability` (`:401-406`): make the sender read unconditional (it now serves both passes — net −(G−1) reads whenever override-off groups exist; +1 only for a sender with zero followers and zero override-off groups):

```js
  // Resolve the sender's shared fallback name once (code → 'Someone') for BOTH
  // the Direct pass and the group fan-out; only the per-viewer following label
  // (and per-group displayName) varies. Threading it into notifyGroupAvailability
  // collapses the per-group re-read of this same leaf (audit-2 N7).
  const senderFallback = ((await deps.getVal(`users/${uid}/presence/code`)) || 'Someone');
```

And the group-pass call (`:443`):

```js
    await notifyGroupAvailability(deps, gids[i], uid, now, notified, senderFallback);
```

`handleGroupOverrideChange`'s call at `:315` stays as-is — a single-group event has no duplication to collapse, and its default-`null` path preserves today's exact reads.

- [ ] **Step 4: Run the functions suite**

Run: `npm test` (in `functions/`), then `cd /home/user/on`
Expected: PASS — existing `handleAvailability` tests are insensitive to the read becoming unconditional (`getVal` on an absent store key resolves `undefined` → `'Someone'`).

- [ ] **Step 5: Commit**

```bash
git add functions/notifier.js functions/test/notifier.test.js
git commit -m "perf(notifier): resolve the availability sender's code once — thread it through the group fan-out"
```

---

### Task 5: N8 — countdown label catch-up on return-to-visible

**Files:**
- Modify: `js/me.ts:13-17` (state), `startCountdown` (`:203-216`), `setUnavailable` (`:274-276` block)
- Test: `tests/me.test.js` (after the Task-6 hidden-tab test at `:204`)

**Interfaces:**
- Consumes: existing `timeRemainingMs` / `formatTimeRemaining` already imported by `me.ts`.
- Produces: nothing external — module-internal handler only.

**Why:** `fd6a540` gave the 30s countdown the hidden-tab skip but not the `visibilitychange` catch-up its sibling (the 60s label refresh, `js/following.ts:392-396`) got in the same commit — so `#time-remaining` sits up to ~30s stale after the tab returns to visible. Cosmetic (expiry still fires hidden), but the asymmetry is a needless UX papercut.

- [ ] **Step 1: Write the failing test**

In `tests/me.test.js`, after the hidden-tab-guard tests (below `:229`):

```js
test('returning to visible catches the countdown label up immediately (audit-2 N8)', () => {
  applyOwnStatus('available', Date.now() + 7200000);
  jest.advanceTimersByTime(250);
  const el = document.getElementById('time-remaining');
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  jest.advanceTimersByTime(3600000); // an hour passes hidden — every 30s tick skips the write
  const stale = el.textContent;      // still shows ~2h
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(el.textContent).not.toBe(stale); // caught up (~1h) without waiting for the next tick
  expect(el.textContent).toMatch(/left$/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest --maxWorkers=2 --testPathPatterns me.test`
Expected: FAIL — `el.textContent` unchanged after the visibility event (no handler exists).

- [ ] **Step 3: Implement the catch-up handler**

In `js/me.ts`, next to the countdown state (`:13-17`):

```ts
let _countdownVisHandler: (() => void) | null = null;
```

In `startCountdown`, after the `setInterval` assignment (`:216`):

```ts
  // Hidden-tab ticks skip the label write (paint-only; the expiry transition
  // above still fires) — catch the label up the moment the tab is visible
  // again, else it sits up to ~30s stale (audit-2 N8; mirrors following.ts's
  // 60s label refresh from the same fix batch).
  if (_countdownVisHandler) document.removeEventListener('visibilitychange', _countdownVisHandler);
  _countdownVisHandler = () => {
    if (document.visibilityState !== 'visible' || _countdownUntil == null) return;
    const ms = timeRemainingMs(_countdownUntil);
    if (ms > 0) document.getElementById('time-remaining')!.textContent = formatTimeRemaining(ms) + ' left';
  };
  document.addEventListener('visibilitychange', _countdownVisHandler);
```

In `setUnavailable`, alongside the existing teardown (`_countdownUntil = null; … clearInterval(...)` at `:274-276`):

```ts
  if (_countdownVisHandler) { document.removeEventListener('visibilitychange', _countdownVisHandler); _countdownVisHandler = null; }
```

(The remove-before-add in `startCountdown` keeps restarts — `setAvailable` re-entry, time-chip retargets — from stacking handlers.)

- [ ] **Step 4: Run the suite + typecheck**

Run: `npx jest --maxWorkers=2 --testPathPatterns me.test && npm run typecheck`
Expected: PASS, clean typecheck. The pre-existing hidden-tab tests at `:204`/`:221` must still pass (the handler fires only on `visible`).

- [ ] **Step 5: Commit**

```bash
git add js/me.ts tests/me.test.js
git commit -m "fix(me): catch the countdown label up on return-to-visible (hidden-tab skip symmetry)"
```

---

### Task 6: N3 — appearance-only fast path for the open-group roster

**Files:**
- Modify: `js/groupContext.ts` (new helper near `renderRoster`; members-watch callback at `:1275-1291`; `_lastMembers` reset at group entry `:1272-1274`)
- Test: `tests/groupContext.test.js`

**Interfaces:**
- Consumes: existing `paintRosterRow(uid, node?)` (row lookup via `_rowByUid` with querySelector fallback), `renderRoster`, `syncStatusSubscriptions`.
- Produces: `classifyMembersTick(prev, next): 'full' | 'appearance' | 'none'` (module-internal).

**Why:** The open group's `watchGroupMembers` callback has zero change detection: every co-member `statusOverride` write (per swatch/palette tap) re-runs the full pass — `_membersOverrides` rebuild, `renderRoster` (→ `reconcileDistanceSubs` walking every member with fresh Sets, `reconcileChildren` repainting every row, `refreshHints`), and `syncStatusSubscriptions` — for every viewer in the group. This is the client analogue of Task 3's server-side gate: appearance fields (`statusColor`/`paletteKey`) can't change membership, names, ordering, distance eligibility, or the status-sub set, so those passes are guaranteed no-ops.

- [ ] **Step 1: Re-verify the `_lastMembers` lifecycle** (correctness precondition for the fast path)

Run: `grep -n "_lastMembers" js/groupContext.ts`
Confirm where `_lastMembers` is reset. If `enterGroupContext` does NOT null it before subscribing, the first tick of a new group could be classified against the *previous* group's map — Step 3 adds the explicit reset regardless; this step is to confirm no other consumer relies on it surviving group exit (expected consumers: `syncRosterOrder`, the location-event re-renders — all roster-scoped).

- [ ] **Step 2: Write the failing tests**

In `tests/groupContext.test.js`, using the file's existing members-watch harness (`db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; })` — same pattern as the existing tests at `:377`/`:393`, and the MutationObserver technique from the Tier-3 Task-1 repaint test):

```js
test('a statusColor-only override tick repaints only the touched row (audit-2 N3)', async () => {
  let membersCb;
  db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
  enterGroupContext('G1', 'me');
  const base = {
    me: { displayName: 'Me' },
    u2: { displayName: 'Bea', statusOverride: { enabled: true, status: 'available', statusColor: '#111111', availableUntil: null } },
    u3: { displayName: 'Cal' },
  };
  membersCb(base);
  await Promise.resolve();
  const rowU3 = document.querySelector('[data-user-id="u3"]');
  const mo = new MutationObserver(() => {});
  mo.observe(rowU3, { childList: true, characterData: true, subtree: true, attributes: true, attributeOldValue: true });
  membersCb({ ...base, u2: { ...base.u2, statusOverride: { ...base.u2.statusOverride, statusColor: '#222222' } } });
  await Promise.resolve();
  expect(mo.takeRecords().length).toBe(0); // untouched row: zero DOM work
  // The touched row DID repaint — assert the same observable paintRosterRow
  // effect the file's existing repaint tests assert (dot/border color for u2).
});

test('a membership change still runs the full reconcile after an appearance tick', async () => {
  let membersCb;
  db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
  enterGroupContext('G1', 'me');
  const base = { me: { displayName: 'Me' }, u2: { displayName: 'Bea' } };
  membersCb(base);
  await Promise.resolve();
  membersCb({ ...base, u4: { displayName: 'Dex' } }); // join
  await Promise.resolve();
  expect(document.querySelector('[data-user-id="u4"]')).not.toBeNull();
});

test('an override enabled-flip is NOT the fast path (ordering may change)', async () => {
  let membersCb;
  db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
  enterGroupContext('G1', 'me');
  const ov = { enabled: true, status: 'available', statusColor: '#111111', availableUntil: null };
  const base = { me: { displayName: 'Me' }, u2: { displayName: 'Bea', statusOverride: ov } };
  membersCb(base);
  await Promise.resolve();
  membersCb({ ...base, u2: { ...base.u2, statusOverride: { ...ov, enabled: false } } });
  await Promise.resolve();
  // Full pass ran: assert whatever ordering/paint effect the file's existing
  // availability-flip tests assert for a row leaving the available cohort.
});
```

(Where a comment says "assert the same observable effect as the file's existing tests", copy those exact assertions — they pin `paintRosterRow`'s current markup; do not invent new selectors.)

- [ ] **Step 3: Run to verify failure**

Run: `npx jest --maxWorkers=2 --testPathPatterns groupContext`
Expected: FAIL — the first test's MutationObserver sees records on `u3`'s row (full reconcile repaints every row today).

- [ ] **Step 4: Implement**

In `js/groupContext.ts`, add above `renderRoster`:

```ts
// Audit-2 N3 — client analogue of the notifier's availability-relevant gate.
// Classifies a members tick against the previous map: 'appearance' means the
// maps differ ONLY in override appearance fields (statusColor/paletteKey) —
// same uid set, same non-override member fields, same enabled/status/
// availableUntil — so membership, ordering, distance eligibility, and the
// status-sub set are all guaranteed unchanged and only touched rows need a
// repaint. 'none' is a byte-equivalent echo. Anything else (join/leave,
// rename, an availability-affecting override change, an unknown new member
// field — the structural compare fails safe) is 'full'.
function classifyMembersTick(prev: Record<string, MemberEntry>, next: Record<string, MemberEntry>): 'full' | 'appearance' | 'none' {
  const nextKeys = Object.keys(next);
  if (Object.keys(prev).length !== nextKeys.length) return 'full';
  let sawAppearance = false;
  for (const uid of nextKeys) {
    const a = prev[uid];
    const b = next[uid];
    if (!a) return 'full';
    if (JSON.stringify({ ...a, statusOverride: null }) !== JSON.stringify({ ...b, statusOverride: null })) return 'full';
    const oa = a.statusOverride || null;
    const ob = b.statusOverride || null;
    if ((oa === null) !== (ob === null)) return 'full';
    if (oa && ob) {
      if (oa.enabled !== ob.enabled || oa.status !== ob.status || oa.availableUntil !== ob.availableUntil) return 'full';
      if (oa.statusColor !== ob.statusColor || oa.paletteKey !== ob.paletteKey) sawAppearance = true;
    }
  }
  return sawAppearance ? 'appearance' : 'none';
}
```

At group entry, alongside the roster clear (`:1272-1273`), add the reset so a new group's first tick can never classify against the previous group's map:

```ts
  const rosterListEl = document.getElementById('group-roster');
  if (rosterListEl) rosterListEl.innerHTML = '';
  _lastMembers = null;
```

Replace the members-watch callback body (`:1275-1291`):

```ts
  _membersUnsub = watchGroupMembers(groupId, (members) => {
    const typed = ((members as Record<string, MemberEntry>) || {});
    const prev = _lastMembers;
    const prevOverrides = _membersOverrides;
    _lastMembers = typed;
    _membersOverrides = {};
    for (const [uid, m] of Object.entries(typed)) {
      _membersOverrides[uid] = m.statusOverride || null;
    }
    _ownDisplayName = typed?.[userId]?.displayName || null;
    const kind = prev === null ? 'full' : classifyMembersTick(prev, typed);
    if (kind === 'appearance') {
      // Hot path (audit-2 N3): a co-member's swatch/palette tap. Repaint just
      // the touched rows — membership and availability are identical, so the
      // reconcile/distance/status-sub passes would all be no-ops.
      for (const uid of Object.keys(typed)) {
        const po = prevOverrides[uid] || null;
        const no = _membersOverrides[uid];
        if (po && no && (po.statusColor !== no.statusColor || po.paletteKey !== no.paletteKey)) paintRosterRow(uid);
      }
    } else if (kind === 'full') {
      renderRoster(typed, userId);
      syncStatusSubscriptions(new Set(Object.keys(typed)));
    } // 'none': byte-equivalent echo — nothing to do.
    // Replay any knocks that arrived while the user wasn't in this group.
    // Wait for the first members tick so the roster lis exist before drain
    // tries to look them up; one-shot per enterGroupContext call.
    if (!drainedKnocksOnEntry) {
      drainedKnocksOnEntry = true;
      drainPendingKnocks(groupId);
    }
  });
```

- [ ] **Step 5: Run the suite + typecheck**

Run: `npx jest --maxWorkers=2 --testPathPatterns groupContext && npm run typecheck`
Expected: PASS — including every pre-existing roster test (join/leave, availability flips, invite-row, drawer survival). If any pre-existing test fails, the classification is too aggressive — fix the classifier, do not weaken the test.

- [ ] **Step 6: Full web suite, then commit**

Run: `npx jest --maxWorkers=2`

```bash
git add js/groupContext.ts tests/groupContext.test.js
git commit -m "perf(roster): appearance-only member ticks repaint touched rows, skip the full reconcile"
```

---

### Task 7: N5a — lazy-load `groupContext` (break both entry-chunk pins)

**Files:**
- Modify: `js/app.ts:25` (delete import; add `withGroupContext` helper; convert `:701-702`)
- Modify: `js/favorites.ts:9` (delete import), `:456` (dynamic call)
- Test: existing suites (`tests/groupContext.test.js` requires the module directly — unaffected; boot/nav tests may need a microtask flush, see Step 4)

**Interfaces:**
- Consumes: `groupContext.ts`'s existing exports (`enterGroupContext`, `exitGroupContext`, `applyAdoptedComboInGroup`) — signatures unchanged.
- Produces: `withGroupContext(fn)` (app.ts-internal serialized loader).

**Why:** `groupContext.ts` (1,643 lines — the largest client module) is pinned into the entry chunk by exactly two static importers (verified): `app.ts:25` and `favorites.ts:9`. Direct-first boots parse all of it for nothing. `buildGroupCombo` has no external importers (test-only export); no other module imports the file; it has no top-level `document`/`window` listeners (verified — its listeners are armed inside `enterGroupContext`), so deferring the module defers nothing but its own definition cost.

- [ ] **Step 1: Delete the static imports**

Remove `js/app.ts:25` (`import { enterGroupContext, exitGroupContext } from './groupContext.js';`) and `js/favorites.ts:9` (`import { applyAdoptedComboInGroup } from './groupContext.js';`).

- [ ] **Step 2: Add the serialized loader and convert the context-change site**

In `js/app.ts`, near the other boot helpers:

```ts
// groupContext (~1.6k lines) is the largest client module and only group
// sessions need it — lazy chunk (audit-2 N5). Serialized through one promise
// chain so a rapid group→direct→group flip can never interleave enter/exit
// out of order once the chunk is in flight.
let _gcChain: Promise<unknown> = Promise.resolve();
function withGroupContext(fn: (m: typeof import('./groupContext.js')) => void): void {
  _gcChain = _gcChain
    .then(() => import('./groupContext.js'))
    .then(fn)
    .catch((err) => console.error('groupContext load failed:', err));
}
```

Convert `:701-702` (inside the `onContextChange` handler — capture `ctx` fields before the async hop):

```ts
    if (ctx.context === 'group') {
      const gid = ctx.groupId as string;
      withGroupContext((m) => m.enterGroupContext(gid, userId));
    } else {
      withGroupContext((m) => m.exitGroupContext());
    }
```

- [ ] **Step 3: Convert the favorites adopt site**

`js/favorites.ts:456` — this fires from a tap while *in* group context, so the chunk is already loaded and the import resolves from cache:

```ts
    import('./groupContext.js')
      .then(({ applyAdoptedComboInGroup }) => applyAdoptedComboInGroup(combo.statusColor, combo.paletteKey ?? null))
      .catch(() => {});
```

- [ ] **Step 4: Typecheck + full web suite**

Run: `npm run typecheck && npx jest --maxWorkers=2`
Expected: typecheck clean (`typeof import('./groupContext.js')` in type position is erased at build — no runtime pin). Under Jest, babel compiles `import()` to `require`, so module resolution is synchronous but the `.then` still defers one microtask: a test that drives a context change and asserts group DOM *synchronously* may now need an `await Promise.resolve()` (or the file's existing flush helper) before its assertions. Fix such tests by adding the flush — the semantics under test are unchanged; do NOT re-add a static import to appease a test.

- [ ] **Step 5: Verify the split in build output**

Run: `npm run build && ls dist/chunks/`
Expected: a `groupContext-<hash>.js` chunk appears; `dist/bundle.js` shrinks materially. `grep -c "chunks/groupContext" index.html` prints `0` (lazy chunks excluded from modulepreload).

- [ ] **Step 6: Commit**

```bash
git add js/app.ts js/favorites.ts
git commit -m "perf(boot): lazy-load groupContext — Direct-first boots stop parsing the largest client module"
```

**Device-smoke note (post-deploy):** a group-context boot now fetches the chunk before the roster appears (SW-precached, so instant after first visit); verify the boot-into-group path and a rapid Direct↔group flip on device.

---

### Task 8: N5b — lazy-load the Telegram-context-only flow modules

**Files:**
- Modify: `js/app.ts:34-36` (delete three imports), `:602` + `:665` (type positions), `:652`, `:667-672`, `:776`, `:937`, `:942`
- Test: existing suites (Telegram module tests import their modules directly — unaffected)

**Interfaces:**
- Consumes: existing exports of `telegramChrome.ts`, `telegramFirstRun.ts`, `telegramLinkArrival.ts`, `telegramSettings.ts` — signatures unchanged.
- Produces: `tgFirstRun` (a function-scoped module handle alongside `tgInvite` in the boot flow).

**Why:** `telegramChrome` (119), `telegramFirstRun` (176), `telegramSettings` (160), and `telegramLinkArrival` (78) run only inside the Telegram webview, and every `app.ts` call site is already behind `isTelegramContext()` (verified: `:652`, `:666`, `:937`, `:942`) — yet all four parse at boot for every web visitor (the majority). Keep eager: `telegram.ts` + `telegramBridge.ts` (they ARE the gate), `telegramOnramp`/`telegramEscapeHatch` (web-facing — spec N5 corrections). `telegramFirstRun` statically imports `telegramSettings`, so those two share a lazy graph — fine, both are Telegram-only.

- [ ] **Step 1: Delete the static imports; fix the type positions**

Remove `js/app.ts:34-36`:

```ts
import { initTelegramChrome } from './telegramChrome.js';
import { telegramInviteGate, stampInviteOutcome, redemptionConsumedToken } from './telegramFirstRun.js';
import { runLinkArrival } from './telegramLinkArrival.js';
```

At `:602` and `:665`, replace the type `Awaited<ReturnType<typeof telegramInviteGate>>` with:

```ts
Awaited<ReturnType<typeof import('./telegramFirstRun.js').telegramInviteGate>>
```

(Type-position dynamic import — erased at compile, no chunk pin, no suppression.)

- [ ] **Step 2: Convert the chrome site (`:652`)**

```ts
  if (isTelegramContext()) {
    import('./telegramChrome.js')
      .then(({ initTelegramChrome }) => initTelegramChrome())
      .catch((err) => console.error('telegramChrome load failed:', err));
  }
```

- [ ] **Step 3: Convert the boot-gate block (`:665-672`) with a scoped module handle**

`tgInvite` at `:665` and its consumer at `:776` share one function scope (verified), so capture the module once — the `:776` site stays synchronous and its ordering with `cleanInviteParamFromUrl()` is preserved:

```ts
  let tgInvite: Awaited<ReturnType<typeof import('./telegramFirstRun.js').telegramInviteGate>> = null;
  let tgFirstRun: typeof import('./telegramFirstRun.js') | null = null;
  if (!pendingInviteToken && isTelegramContext()) {
    const { runLinkArrival } = await import('./telegramLinkArrival.js');
    if (await runLinkArrival({ dismissSplash })) return null; // onramp link handled — reboots on success
    tgFirstRun = await import('./telegramFirstRun.js');
    tgInvite = await tgFirstRun.telegramInviteGate({
      linked: isTelegramLinked(),
      isNew,
      dismissSplash,
    });
```

(The block is already inside an async function — the awaits are legal and splash-gated.)

- [ ] **Step 4: Convert the redemption-stamp site (`:776`)**

```ts
      if (tgInvite && tgFirstRun && tgFirstRun.redemptionConsumedToken(result)) tgFirstRun.stampInviteOutcome(tgInvite.token, 'redeemed');
```

- [ ] **Step 5: Convert the settings sites (`:937`, `:942`)**

```ts
  if (isTelegramContext()) {
    import('./telegramSettings.js')
      .then(({ initTelegramSettings }) => initTelegramSettings(userId))
      .catch((err) => console.error('telegramSettings load failed:', err));
  }
```

And the `onLink` callback (`showLinkScreen` takes no arguments — verified `telegramSettings.ts:96`):

```ts
    onLink: isTelegramContext()
      ? () => { import('./telegramSettings.js').then(({ showLinkScreen }) => showLinkScreen()).catch(() => {}); }
      : null,
```

- [ ] **Step 6: Typecheck + full web suite**

Run: `npm run typecheck && npx jest --maxWorkers=2`
Expected: clean + green. Same microtask caveat as Task 7 Step 4 for any boot test that drives the Telegram path synchronously.

- [ ] **Step 7: Verify the split in build output**

Run: `npm run build && ls dist/chunks/`
Expected: new lazy chunk(s) covering telegramChrome / telegramFirstRun+telegramSettings / telegramLinkArrival (esbuild may merge them — any arrangement is fine as long as they are NOT in `dist/bundle.js`: `grep -c initTelegramChrome dist/bundle.js` prints `0`).

- [ ] **Step 8: Commit**

```bash
git add js/app.ts
git commit -m "perf(boot): lazy-load Telegram-context flow modules — web visitors stop parsing webview-only code"
```

**Device-smoke note (post-deploy):** verify inside the Telegram Mini App — chrome init, first-run interstitial, deep-linked invite, link screen from first-run empty state.

---

### Task 9: N9 — per-stroke canvas derivations

**Files:**
- Modify: `js/canvas.ts` (module vars near `:29-30`; `onPointerDown` `:876-877`; `onPointerMove` `:901-902`)
- Test: existing `tests/canvas.test.js`, `tests/canvas-screenshot.test.js` (behavior-preserving refactor — the existing stroke tests are the pin)

**Interfaces:** module-internal only (`_strokeCss`, `_strokeWidthPx`).

**Why:** `onPointerMove` recomputes `safeCssColor(_penColor)` (regex + string alloc) and `_thickness * _canvas.width` on every pointermove at input-device rate, though neither input can change mid-stroke (toolbox taps land between strokes). The per-segment ctx *assignments* are load-bearing — a concurrent peer `renderStroke` mutates shared ctx state (in-code comment at `:897-900`) — so only the derivations move.

- [ ] **Step 1: Add the stroke-constant module vars**

Near the pen state (`js/canvas.ts:29-30`):

```ts
// Stroke-constant derivations, computed once per stroke (onPointerDown):
// safeCssColor is a regex + string alloc and the width a float derive; neither
// input can change mid-stroke (toolbox taps land between strokes), so deriving
// them per pointermove was pure per-event allocation (audit-2 N9). The
// per-segment ctx ASSIGNMENTS stay — a concurrent peer renderStroke mutates
// shared ctx state (see onPointerMove's comment).
let _strokeCss = '';
let _strokeWidthPx = 0;
```

- [ ] **Step 2: Derive once in `onPointerDown` (`:876-877`)**

```ts
  _strokeCss = safeCssColor(_penColor);
  _strokeWidthPx = _thickness * _canvas.width;
  _ctx.strokeStyle = _strokeCss;
  _ctx.lineWidth = _strokeWidthPx;
```

- [ ] **Step 3: Consume in `onPointerMove` (`:901-902`)**

Replace:

```ts
  _ctx.strokeStyle = safeCssColor(_penColor);
  _ctx.lineWidth = _thickness * _canvas.width;
```

with:

```ts
  _ctx.strokeStyle = _strokeCss;
  _ctx.lineWidth = _strokeWidthPx;
```

(Leave `lineCap`/`lineJoin`/`beginPath`/`moveTo`/`lineTo`/`stroke` untouched.)

- [ ] **Step 4: Run the canvas suites + typecheck, then commit**

Run: `npx jest --maxWorkers=2 --testPathPatterns canvas && npm run typecheck`
Expected: PASS (refactor is observationally identical per stroke).

```bash
git add js/canvas.ts
git commit -m "perf(canvas): derive stroke color/width once per stroke, not per pointermove"
```

---

### Task 10: N10 — on-demand `canvas.css` with an inline flow guard

**Files:**
- Modify: `index.template.html:30` (replace the link with an inline guard)
- Modify: `js/canvas.ts` (add `ensureCanvasCss`; call at the top of `enterCanvas`)
- Modify: `tests/sw.test.js:42` (comment only — the SHELL assertion is unchanged)
- Test: `tests/canvas.test.js`

**Interfaces:** `ensureCanvasCss()` (canvas.ts-internal).

**CSP constraint (why not `onload`):** `script-src` is hash-allowlisted with no `unsafe-inline` (`firebase.json:27` + the meta at `index.template.html:17`), so the classic `media="print" onload="this.media='all'"` trick is **blocked** — an `onload` attribute is an inline event handler. `style-src` HAS `unsafe-inline`, so an inline `<style>` guard is fine. Hence: JS-injected stylesheet + inline style guard.

**Why the guard is mandatory:** `#canvas-screen` is hidden by `opacity:0; pointer-events:none` on `position:fixed` (`canvas.css:4-16`) — the div holds a bare `<canvas>` (`index.template.html:325-327`), so without canvas.css loaded the unstyled ~300×150 canvas box enters normal flow at the top of `<body>` and shifts the entire layout. The guard's `display:none` keeps it out of flow until the sheet lands; canvas.css's own `display:flex` (same specificity, later in cascade order once the link is appended) overrides the guard, at which point `opacity` takes over.

- [ ] **Step 1: Write the failing test**

In `tests/canvas.test.js`, using the file's existing `enterCanvas` fixture (reuse the exact arguments its existing entry tests pass):

```js
test('enterCanvas injects the canvas stylesheet once (audit-2 N10)', async () => {
  // <same enterCanvas invocation as the file's existing entry test>
  // <enter a second time / re-enter per the file's existing re-entry pattern>
  expect(document.querySelectorAll('link[data-canvas-css]').length).toBe(1);
  expect(document.querySelector('link[data-canvas-css]').getAttribute('href')).toBe('dist/css/canvas.css');
});
```

Run: `npx jest --maxWorkers=2 --testPathPatterns canvas` — expected: FAIL (no such link is injected today).

- [ ] **Step 2: Replace the head link with the guard**

`index.template.html:30` — replace:

```html
  <link rel="stylesheet" href="dist/css/canvas.css" />
```

with:

```html
  <!-- canvas.css is injected on demand by js/canvas.ts (audit-2 N10). This
       guard keeps the bare #canvas-screen <canvas> out of document flow until
       that sheet lands (its display:flex, later in the cascade, overrides).
       Inline style is CSP-legal (style-src 'unsafe-inline'); an onload
       attribute on a link would NOT be (script-src has no unsafe-inline). -->
  <style>#canvas-screen{display:none}</style>
```

- [ ] **Step 3: Inject from `enterCanvas`**

In `js/canvas.ts`, add near the top-level helpers:

```ts
// canvas.css styles only the #canvas-screen overlay; shipping it render-
// blocking in <head> taxed first paint for every visitor (audit-2 N10). The
// SW still precaches it (sw SHELL), so this load is instant after the first
// visit and works offline. No load-await needed: index.html's inline
// #canvas-screen{display:none} guard hides the screen until the sheet
// applies, then the .active opacity transition takes over.
function ensureCanvasCss() {
  if (document.querySelector('link[data-canvas-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'dist/css/canvas.css';
  link.setAttribute('data-canvas-css', '1');
  document.head.appendChild(link);
}
```

Add `ensureCanvasCss();` as the first statement of `enterCanvas`.

- [ ] **Step 4: Update the stale test comment**

`tests/sw.test.js:42` — the comment "dist/css/canvas.css is loaded by index.template.html" becomes "dist/css/canvas.css is injected on demand by canvas.ts; precached so entry is instant and works offline". The `arrayContaining(['/dist/css/canvas.css'])` assertion itself is UNCHANGED — the file stays in the SW SHELL deliberately.

- [ ] **Step 5: Run suites + typecheck + build**

Run: `npx jest --maxWorkers=2 --testPathPatterns "canvas|sw" && npm run typecheck && npm run build`
Expected: all green; build succeeds (`scripts/build.js` references canvas.css only for the CSS build and the SW hash — both still apply; verify `grep -c canvas.css index.html` prints `0` for a `<link>` and the inline guard is present).

- [ ] **Step 6: Full web suite, then commit**

Run: `npx jest --maxWorkers=2`

```bash
git add index.template.html js/canvas.ts tests/sw.test.js tests/canvas.test.js
git commit -m "perf(paint): load canvas.css on demand — inline guard keeps the overlay out of flow (CSP-safe)"
```

**Device-smoke note (post-deploy):** first-ever draw-session entry on a cold cache — confirm no flash/layout shift and the overlay fades in normally.

---

## Final verification (after all tasks)

- [ ] `npx jest --maxWorkers=2` — all green (baseline 2049 + new tests)
- [ ] `cd functions && npm test && cd /home/user/on` — all green (baseline 432 + new tests)
- [ ] `npm run typecheck` — clean, zero suppressions added
- [ ] `npm run build` — succeeds; `dist/chunks/` contains lazy chunks for canvas, groupContext, and the Telegram flow modules; `dist/bundle.js` contains none of them (`grep -c enterGroupContext dist/bundle.js` → `0` is a quick smoke)
- [ ] `npm run test:rules` only if rules were touched (they are not in this plan)

## Coverage vs the selection

N1 → Task 1 · N2 → Task 2 (incl. spec severity correction) · N4 → Task 3 · N7 → Task 4 · N8 → Task 5 · N3 → Task 6 · N5 → Tasks 7+8 (scope revisions: inbox split dropped — slot pinned into eager nav, heavy deps already eager; onramp/escapeHatch stay eager as web-facing) · N9 → Task 9 · N10 → Task 10.
Remaining out of scope: N6 (precache-all — pending the operator's offline-completeness call).
