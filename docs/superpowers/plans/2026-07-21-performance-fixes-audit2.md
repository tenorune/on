# Performance Fixes — Audit #2 Batch (N1, N2, N4, N7, N8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the operator-selected batch from `docs/superpowers/specs/2026-07-21-performance-audit-2-findings.md`: restore the canvas lazy-split (N1), let the stale-membership sweep fire without movement (N2), stop paying a presence read for color-only override edits (N4), read the availability sender's code once instead of per group (N7), and catch the countdown label up on return-to-visible (N8).

**Architecture:** Five independent, individually-shippable tasks — two client hot-path fixes (N2, N8), one client build/boot fix (N1), two Cloud Functions read reductions (N4, N7). No schema changes, no rules changes, no reviewed-decision territory. Ordered by leverage; any subset can ship.

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

## Final verification (after all tasks)

- [ ] `npx jest --maxWorkers=2` — all green (baseline 2049 + new tests)
- [ ] `cd functions && npm test && cd /home/user/on` — all green (baseline 432 + new tests)
- [ ] `npm run typecheck` — clean, zero suppressions added
- [ ] `npm run build` — succeeds; `dist/chunks/` contains a `canvas-<hash>.js` chunk
- [ ] `npm run test:rules` only if rules were touched (they are not in this plan)

## Coverage vs the C-batch selection

N1 → Task 1 · N2 → Task 2 (incl. spec severity correction) · N4 → Task 3 · N7 → Task 4 · N8 → Task 5. Deliberately out of scope: N3 (roster diffing — larger reconcile surgery, plan separately), N5/N6 (bundle/pre-cache policy — operator decision on precache-all first), N9/N10 (canvas micro-alloc + CSS deferral — batch with the next canvas work).
