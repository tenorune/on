# Performance Fixes (Branch-Introduced Findings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the branch-introduced steady-state waste found by the 2026-07-20 performance audit — no-op location republishes, per-tick GPS wakeups, identical-distance repaints, prefs-echo amplification, doubled member-trigger invocations, `/who` N+1 reads, and full-shell cache invalidation.

**Architecture:** Seven independent, contained fixes. Client fixes live in the location subsystem (`locationShare`/`locationHub`/`prefs`); server fixes merge two RTDB triggers into one and prefetch shared maps in the Telegram bot; hosting fixes add immutable caching for content-hashed chunks and chunk carry-over in the service worker. No schema changes; no rules changes.

**Tech Stack:** vanilla TypeScript (web, jest+jsdom), Firebase Cloud Functions gen-2 (ESM JS, node test via jest), Firebase Hosting + service worker.

**Source findings:** `docs/superpowers/specs/2026-07-20-performance-audit-findings.md` — Tasks map to F1, F2, F4, F5, F7, F10, F9 in that order. F3/F6/F8 are PRE-EXISTING and deliberately **out of scope** here (schema/listener refactors to be planned separately).

## Global Constraints

- Zero TS suppressions (`@ts-ignore` / `@ts-expect-error` / `as any`); `npm run typecheck && npm run typecheck:scripts` must stay green (run from repo root).
- Web tests: `npx jest --maxWorkers=2` from repo root. Functions tests: `cd functions && npm test`, then **return to repo root** (`cd /home/user/on`) — a lingering cwd silently breaks later commands.
- Do NOT touch `database.rules.json`, the `joinGroup` transaction scope, or any reviewed security semantics.
- Do NOT edit `functions/_shared/` (mirror) — no `shared/` edits are needed in this plan (imports only).
- `sw.template.js` is loaded raw by `tests/sw.test.js` — placeholders (`__CACHE_VERSION__`, `__CHUNK_LIST__`) must stay filter-safe unsubstituted.
- No new inline `<script>` blocks in HTML templates (CSP pins hashes).
- Set committer identity before the first commit: `git config user.email noreply@anthropic.com && git config user.name Claude`.
- Where a fix outlaws behavior an existing test pins (noted in Task 1), INVERT the test deliberately with rationale in the commit body — never weaken it.
- Deploy notes belong in commit bodies (branch convention). Nothing is deployed from sessions.

---

### Task 1: Skip unchanged location publishes (F1)

**Files:**
- Modify: `js/locationShare.ts` (tick pipeline, `unmarkPublished`, `revokePermissionTeardown`, `_resetLocationShare`)
- Test: `tests/locationShare.test.js`

**Interfaces:**
- Consumes: `snapToCell`, `haversineMeters` from `shared/geo.js` (already mirrored; import only).
- Produces: no API change. New module-private state `_lastPublished: Map<string, {lat,lng}>` keyed by context (`'direct'` | gid); raw tier stores raw coords, group tiers store the **snapped cell**. Cleared per-context wherever the context's node is deleted.

Behavioral contract: a tick whose position would write byte-identical data (cell tier) or has moved less than 10 m (raw tier) publishes **nothing** for that context. `updatedAt` consequently stops refreshing on no-op ticks — verified unread by any consumer (audit F1). First publish after boot/glyph-on always goes through (`_lastPublished` empty for that context).

- [ ] **Step 1: Write the failing tests**

Append to `tests/locationShare.test.js` (uses the file's existing harness: `share()`, `flush()`, `ownStatus.__fireOwnStatus`, `POS`, `geoBehavior`):

```js
describe('no-op publish suppression (audit F1)', () => {
  test('stationary user: the 60s tick republishes neither the raw point nor the cell', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await toggleContext('direct');
    await flush();
    await toggleContext('G1');
    await flush();
    db.publishLocation.mockClear();
    db.publishLocationCell.mockClear();
    jest.advanceTimersByTime(60000); // same POS as the first publish
    await flush();
    expect(db.publishLocation).not.toHaveBeenCalled();
    expect(db.publishLocationCell).not.toHaveBeenCalled();
  });

  test('a >=10m move republishes the raw point; an in-cell move does not republish the cell', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await toggleContext('direct');
    await flush();
    await toggleContext('G1');
    await flush();
    db.publishLocation.mockClear();
    db.publishLocationCell.mockClear();
    // ~0.0005° lat ≈ 55 m: leaves the 10 m raw threshold, stays in the 0.01° cell.
    geoBehavior = (ok) => ok({ coords: { latitude: 52.5205, longitude: 13.405 } });
    jest.advanceTimersByTime(60000);
    await flush();
    expect(db.publishLocation).toHaveBeenCalledTimes(1);
    expect(db.publishLocationCell).not.toHaveBeenCalled();
  });

  test('a cross-cell move republishes the cell', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await toggleContext('G1');
    await flush();
    db.publishLocationCell.mockClear();
    geoBehavior = (ok) => ok({ coords: { latitude: 52.54, longitude: 13.405 } }); // ≥2 cells away
    jest.advanceTimersByTime(60000);
    await flush();
    expect(db.publishLocationCell).toHaveBeenCalledTimes(1);
  });

  test('glyph off then on republishes even when stationary (cache invalidated on delete)', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await toggleContext('direct');
    await flush();
    await toggleContext('direct'); // off — node deleted
    await flush();
    db.publishLocation.mockClear();
    await toggleContext('direct'); // on again, same POS
    await flush();
    expect(db.publishLocation).toHaveBeenCalledTimes(1);
  });

  test('a failed publish does not poison the cache — the next tick retries', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    db.publishLocation.mockRejectedValueOnce(new Error('offline'));
    await toggleContext('direct');
    await flush();
    db.publishLocation.mockClear();
    jest.advanceTimersByTime(60000); // same POS — but the first write never landed
    await flush();
    expect(db.publishLocation).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Invert the now-outdated pinned test**

The existing test `'direct opt-in + available publishes raw point immediately and every 60s'` pins per-tick republishing of an unchanged position — behavior this task outlaws. Change its tail (after `db.publishLocation.mockClear();`) from expecting a publish to expecting suppression, and rename it:

```js
test('direct opt-in + available publishes raw point immediately; an unchanged 60s tick is suppressed', async () => {
  // ...unchanged setup and first-publish assertions...
  db.publishLocation.mockClear();
  jest.advanceTimersByTime(60000);
  await flush();
  // Audit F1: a stationary tick writes nothing — the last-known node stands.
  expect(db.publishLocation).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run the suite to verify the new tests fail**

Run: `npx jest tests/locationShare.test.js --maxWorkers=2`
Expected: the five new tests FAIL (publishes still happen every tick); the inverted test FAILS.

- [ ] **Step 4: Implement**

In `js/locationShare.ts`:

Add the import and state (near the other module state):

```ts
import { snapToCell, haversineMeters } from '../shared/geo.js';

// Last value actually WRITTEN per context ('direct' → raw coords, gid → the
// snapped cell). A tick that would rewrite the same data skips the set()
// entirely: the write burns a rules evaluation + fans a changed-value tick to
// every attached peer listener, for zero rendered change (audit F1 — the cell
// grid is ~1.1km, so stationary users otherwise rewrite every minute).
// Entries are recorded only when the write RESOLVES (a failed write must
// retry), and dropped wherever the context's node is deleted so re-enable
// republishes. updatedAt stops refreshing on suppressed ticks — nothing reads
// it (spec v1: "nothing gates on it").
const _lastPublished = new Map<string, { lat: number; lng: number }>();
const RAW_REPUBLISH_MIN_METERS = 10;
```

Replace the publish block at the end of `tick()`:

```ts
  const now = Date.now();
  if (direct) {
    const uid = _userId;
    const last = _lastPublished.get('direct');
    if (!last || haversineMeters(last.lat, last.lng, pos.lat, pos.lng) >= RAW_REPUBLISH_MIN_METERS) {
      publishLocation(uid, pos.lat, pos.lng, now).then(() => {
        _lastPublished.set('direct', { lat: pos.lat, lng: pos.lng });
        markPublished('direct');
      }).catch(() => {});
    }
  }
  // One write per cell, NOT multipath with the raw point — a stale-membership
  // cell denial must not take the precise tier down with it (db/location.js).
  // Only in-group-available gids publish; an unavailable group's cell simply
  // stays at last-known (never deleted here).
  const cell = snapToCell(pos.lat, pos.lng);
  for (const gid of gids) {
    const uid = _userId;
    const last = _lastPublished.get(gid);
    if (last && last.lat === cell.lat && last.lng === cell.lng) continue;
    publishLocationCell(gid, uid, pos.lat, pos.lng, now).then(() => {
      _lastPublished.set(gid, cell);
      markPublished(gid);
    }).catch(() => {});
  }
```

(`const uid = _userId;` inside each branch keeps the non-null narrowing across the async closure exactly as the current code relies on; if the current code passes `_userId` directly and typechecks, keep that form instead — match what compiles with zero suppressions.)

Invalidate on every node-deletion path:

In `unmarkPublished` add cache cleanup alongside the set delete:

```ts
function unmarkPublished(contexts: string[]) {
  let changed = false;
  for (const context of contexts) {
    _lastPublished.delete(context);
    changed = _publishedContexts.delete(context) || changed;
  }
  if (changed) dispatchPublishingChanged();
}
```

In `revokePermissionTeardown`, next to `_publishedContexts.clear();` add `_lastPublished.clear();`.
In `_resetLocationShare`, next to `_publishedContexts.clear();` add `_lastPublished.clear();`.

- [ ] **Step 5: Run the file's full suite, then typecheck**

Run: `npx jest tests/locationShare.test.js --maxWorkers=2` → all PASS.
Run: `npm run typecheck && npm run typecheck:scripts` → clean.

- [ ] **Step 6: Commit**

```bash
git add js/locationShare.ts tests/locationShare.test.js
git commit -m "perf(location): skip no-op publishes on the 60s tick

Audit F1: every tick rewrote locations/{uid} and every opted-in cell with a
fresh updatedAt even when stationary — each write costing a rules evaluation
and a changed-value fan-out to every attached peer listener, for zero
rendered change (the cell grid is ~1.1km; nothing reads updatedAt in v1).
Cache the last-landed value per context; suppress raw republish under 10m of
movement and cell republish inside the same snapped cell. Cache entries are
recorded only on write resolution and dropped on every node-deletion path.
Inverted the 'publishes every 60s' pin deliberately — it asserted the
now-outlawed no-op republish."
```

---

### Task 2: Cheaper GPS fixes — accuracy by tier, cache-friendly maximumAge (F2)

**Files:**
- Modify: `js/locationShare.ts` (`getPositionOnce`, `tick`)
- Test: `tests/locationShare.test.js`

**Interfaces:**
- Consumes: Task 1's tick structure (independent — applies cleanly either order).
- Produces: `getPositionOnce(opts?: { highAccuracy?: boolean; maximumAge?: number })` — defaults preserve today's behavior (`highAccuracy: true`, `maximumAge: 30000`) for the glyph-tap prove path.

Behavioral contract: a tick that will publish the precise tier (`direct`) keeps today's options. A cell-only tick (Direct off or Direct-unavailable) requests coarse accuracy and accepts a fix up to 90 s old — the cell is quantized to ~1.1 km, so high-accuracy per-minute GPS wakeups buy nothing there. The Telegram path is unchanged (LocationManager has no accuracy/age API). Note: this is the conservative half of F2 — Direct publishers still take a fix per tick; dropping that requires a cadence/product decision (out of scope).

- [ ] **Step 1: Write the failing tests**

Append to `tests/locationShare.test.js`:

```js
describe('GPS options by tier (audit F2)', () => {
  const lastGeoOpts = () =>
    navigator.geolocation.getCurrentPosition.mock.calls.at(-1)[2];

  test('a tick publishing the precise tier requests a high-accuracy, fresh fix', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await toggleContext('direct');
    await flush();
    expect(lastGeoOpts()).toMatchObject({ enableHighAccuracy: true, maximumAge: 30000 });
  });

  test('a cell-only tick requests a coarse fix and accepts one up to 90s old', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => (prefs.getLocationOptIn('G1') ? ['G1'] : []));
    ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
    await toggleContext('G1'); // direct never opted in → cell-only ticks
    await flush();
    // The toggle's prove-read keeps the default (explicit-intent) options; the
    // loop tick that follows is what must go coarse.
    jest.advanceTimersByTime(60000);
    await flush();
    expect(lastGeoOpts()).toMatchObject({ enableHighAccuracy: false, maximumAge: 90000 });
  });

  test('the glyph-tap prove read keeps explicit-intent defaults', async () => {
    const { initLocationShare, toggleContext } = share();
    initLocationShare('me', () => []);
    ownStatus.__fireOwnStatus({ status: 'unavailable', availableUntil: null });
    await toggleContext('direct'); // prove-read fires even while unavailable
    expect(lastGeoOpts()).toMatchObject({ enableHighAccuracy: true, maximumAge: 30000 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/locationShare.test.js --maxWorkers=2 -t "GPS options"`
Expected: the cell-only test FAILS (options are the hard-coded defaults).

- [ ] **Step 3: Implement**

In `js/locationShare.ts`, change `getPositionOnce`'s signature and browser branch (Telegram branch untouched):

```ts
// One position read, browser or Telegram. Rejects with the underlying error;
// callers map code 1 (PERMISSION_DENIED) to the denied state. Options apply
// to the browser path only (Telegram's LocationManager has no accuracy/age
// API): the precise tier and the glyph-tap prove keep a fresh high-accuracy
// fix; cell-only ticks take a coarse fix up to 90s old — the ~1.1km cell
// quantization makes a per-minute high-accuracy GPS wakeup pure battery
// burn (audit F2).
const CELL_FIX_MAX_AGE_MS = 90000;

function getPositionOnce(opts?: { highAccuracy?: boolean; maximumAge?: number }): Promise<{ lat: number; lng: number }> {
```

and in the browser `getCurrentPosition` call:

```ts
      { enableHighAccuracy: opts?.highAccuracy ?? true, timeout: 20000, maximumAge: opts?.maximumAge ?? 30000 },
```

In `tick()`, pass tier-appropriate options (the `direct`/`gids` gating already computed above the read):

```ts
  let pos;
  try {
    pos = await getPositionOnce(direct
      ? { highAccuracy: true, maximumAge: 30000 }
      : { highAccuracy: false, maximumAge: CELL_FIX_MAX_AGE_MS });
  }
```

`toggleContext`'s prove call stays `await getPositionOnce();` — defaults.

- [ ] **Step 4: Run the full file suite + typecheck**

Run: `npx jest tests/locationShare.test.js --maxWorkers=2` → all PASS.
Run: `npm run typecheck && npm run typecheck:scripts` → clean.

- [ ] **Step 5: Commit**

```bash
git add js/locationShare.ts tests/locationShare.test.js
git commit -m "perf(location): coarse cached GPS fixes for cell-only ticks

Audit F2: every 60s tick forced enableHighAccuracy with maximumAge 30s —
a window the 60s cadence can never satisfy, so the GPS radio woke every
minute even when only ~1.1km grid cells would publish. Cell-only ticks now
request coarse accuracy and accept a fix up to 90s old; the precise tier
and the glyph-tap prove keep today's fresh high-accuracy read."
```

---

### Task 3: Dedupe distance emissions in locationHub (F4)

**Files:**
- Modify: `js/locationHub.ts` (`combine`)
- Test: `tests/locationHub.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: no API change. `subscribeDistance`/`subscribeCellDistance` callbacks now fire only when the computed meters value actually changes (first emission always fires).

Behavioral contract: consumers (`following.ts` row updates, `groupContext.ts` roster paints) currently rebuild `innerHTML` on every emission; deduping at the hub stops the once-a-minute identical repaint of every row without touching either consumer. Repeated `null` emissions are also collapsed (the first still delivers).

- [ ] **Step 1: Write the failing test**

Append to `tests/locationHub.test.js`:

```js
test('identical recomputed distance is not re-emitted (audit F4)', () => {
  const cb = jest.fn();
  subscribeDistance('me', 'peer', cb);
  fire('me', { lat: 52.52, lng: 13.405, updatedAt: 1 });
  fire('peer', { lat: 52.5205, lng: 13.4055, updatedAt: 1 });
  const calls = cb.mock.calls.length;
  // Same coordinates re-published (e.g. an updatedAt-only rewrite from an
  // old client): distance recomputes to the same value — no re-emit.
  fire('peer', { lat: 52.5205, lng: 13.4055, updatedAt: 2 });
  fire('me', { lat: 52.52, lng: 13.405, updatedAt: 2 });
  expect(cb.mock.calls.length).toBe(calls);
  // A real move still emits.
  fire('peer', { lat: 52.53, lng: 13.42, updatedAt: 3 });
  expect(cb.mock.calls.length).toBe(calls + 1);
});

test('repeated null states collapse to one emission', () => {
  const cb = jest.fn();
  subscribeDistance('me', 'peer', cb);
  fire('me', { lat: 1, lng: 1, updatedAt: 1 }); // peer still unknown → null
  fire('me', { lat: 1.0001, lng: 1, updatedAt: 2 }); // still null — no re-emit
  expect(cb).toHaveBeenCalledTimes(1);
  expect(cb).toHaveBeenLastCalledWith(null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/locationHub.test.js --maxWorkers=2`
Expected: both new tests FAIL (every emission calls back).

- [ ] **Step 3: Implement**

In `js/locationHub.ts`, memoize inside `combine`:

```ts
function combine(
  subA: (cb: LocCb) => () => void,
  subB: (cb: LocCb) => () => void,
  cb: (meters: number | null) => void,
): () => void {
  let a: LocationNode | null = null;
  let b: LocationNode | null = null;
  // Emit only on a CHANGED result: the own node feeds every pair, so one own
  // publish otherwise wakes every row on screen into an identical repaint
  // (audit F4). undefined = nothing emitted yet, so the first result — even
  // null — always delivers.
  let last: number | null | undefined;
  const emit = () => {
    let next: number | null = null;
    if (a && b && typeof a.lat === 'number' && typeof a.lng === 'number'
      && typeof b.lat === 'number' && typeof b.lng === 'number') {
      next = haversineMeters(a.lat, a.lng, b.lat, b.lng);
    }
    if (next === last) return;
    last = next;
    cb(next);
  };
  const unA = subA((v) => { a = v; emit(); });
  const unB = subB((v) => { b = v; emit(); });
  return () => { unA(); unB(); };
}
```

- [ ] **Step 4: Run the file suite + typecheck**

Run: `npx jest tests/locationHub.test.js --maxWorkers=2` → all PASS.
Run: `npm run typecheck` → clean.

- [ ] **Step 5: Run the two consumer suites (regression sweep)**

Run: `npx jest tests/following.test.js tests/groupContext.test.js --maxWorkers=2`
Expected: PASS. (If a test pinned per-emission callback counts, evaluate whether it pinned the no-op re-emit — if so, invert with rationale; do not weaken a real assertion.)

- [ ] **Step 6: Commit**

```bash
git add js/locationHub.ts tests/locationHub.test.js
git commit -m "perf(location): emit distances only on change

Audit F4: combine() called back on every node emission, and the own node
feeds every pair — so each own publish woke every mutual row and roster row
into an innerHTML rebuild of identical text once a minute. Memoize the last
computed meters per subscription and skip unchanged results (first
emission, including null, still delivers)."
```

---

### Task 4: Dispatch `location-prefs-synced` only on real change; skip redundant seed probes (F5)

**Files:**
- Modify: `js/prefs.ts` (`syncFromServer` location branch)
- Modify: `js/locationShare.ts` (`seedPublishedFromServer`)
- Test: `tests/prefs.test.js`, `tests/locationShare.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: no API change. `location-prefs-synced` now fires only when the normalized opt-in map actually differs from the local cache. `seedPublishedFromServer` never re-probes a context already in `_publishedContexts`.

Behavioral contract: today the event fires on **every** `userPrefs` echo once `location` exists (F5), triggering full `renderList()` + roster re-render + glyph repaints + one RTDB `get()` probe per opted-in context. Own-write echoes become no-ops (the local cache was already written by `setLocationOptIn`; the toggle path runs its own sync/evaluate directly). A genuine cross-device flip still dispatches — including the first-ever sync into an empty cache.

- [ ] **Step 1: Write the failing prefs test**

Append to `tests/prefs.test.js` (file already imports `syncFromServer`):

```js
test('syncFromServer dispatches location-prefs-synced only on a real opt-in change (audit F5)', () => {
  const seen = jest.fn();
  document.addEventListener('location-prefs-synced', seen);
  syncFromServer({ location: { direct: true, groups: { G1: true } } });
  expect(seen).toHaveBeenCalledTimes(1); // first sync into an empty cache
  syncFromServer({ location: { direct: true, groups: { G1: true } } });
  expect(seen).toHaveBeenCalledTimes(1); // identical echo — no dispatch
  syncFromServer({ location: { direct: true, groups: { G1: true }, extra: 1 } });
  expect(seen).toHaveBeenCalledTimes(1); // unknown keys don't count as change
  syncFromServer({ location: { direct: false, groups: { G1: true } } });
  expect(seen).toHaveBeenCalledTimes(2); // real flip
  syncFromServer({ location: { direct: false, groups: { G1: true, G2: true } } });
  expect(seen).toHaveBeenCalledTimes(3); // new gid
  document.removeEventListener('location-prefs-synced', seen);
});
```

- [ ] **Step 2: Write the failing locationShare test**

Append to `tests/locationShare.test.js`:

```js
test('a prefs echo does not re-probe contexts already marked published (audit F5)', async () => {
  const { initLocationShare, toggleContext } = share();
  initLocationShare('me', () => []);
  ownStatus.__fireOwnStatus({ status: 'available', availableUntil: Date.now() + 3600000 });
  await toggleContext('direct');
  await flush(); // publish landed → 'direct' is in _publishedContexts
  db.hasLocationNode.mockClear();
  document.dispatchEvent(new CustomEvent('location-prefs-synced'));
  await flush();
  expect(db.hasLocationNode).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest tests/prefs.test.js tests/locationShare.test.js --maxWorkers=2 -t "audit F5"`
Expected: both FAIL (dispatch fires every time; probe re-issued).

- [ ] **Step 4: Implement the prefs diff**

In `js/prefs.ts`, replace the location branch of `syncFromServer` (currently the `if (serverPrefs.location && ...)` block dispatching unconditionally):

```ts
  // Location-sharing opt-ins (per context). Dispatch only on a REAL change:
  // syncFromServer runs on every userPrefs echo (each sibling-device swatch
  // tap), and once `location` exists it exists forever — an unconditional
  // dispatch re-ran two full list renders plus per-context server probes per
  // echo (audit F5). Own-write echoes are no-ops here because setLocationOptIn
  // already wrote the cache before the server round-trip.
  if (serverPrefs.location && typeof serverPrefs.location === 'object') {
    const next = {
      direct: !!serverPrefs.location.direct,
      groups: { ...(serverPrefs.location.groups || {}) },
    };
    const cur = readLocationCache();
    const curGroups = cur.groups || {};
    const gids = new Set([...Object.keys(curGroups), ...Object.keys(next.groups)]);
    const changed = !!cur.direct !== next.direct
      || [...gids].some((gid) => !!curGroups[gid] !== !!next.groups[gid]);
    writeLocationCache(next);
    if (changed) document.dispatchEvent(new CustomEvent('location-prefs-synced'));
  }
```

- [ ] **Step 5: Implement the probe skip**

In `js/locationShare.ts` `seedPublishedFromServer`, gate each probe on the published set (extend the function's comment: "contexts already known-published skip the probe — markPublished would be a guaranteed no-op"):

```ts
  if (getLocationOptIn('direct') && !_publishedContexts.has('direct')) probe('direct', hasLocationNode(uid));
  for (const gid of _getOptedInGids()) {
    if (!_publishedContexts.has(gid)) probe(gid, hasLocationCell(gid, uid));
  }
```

- [ ] **Step 6: Run both file suites + typecheck**

Run: `npx jest tests/prefs.test.js tests/locationShare.test.js --maxWorkers=2` → all PASS.
Run: `npm run typecheck && npm run typecheck:scripts` → clean.

- [ ] **Step 7: Commit**

```bash
git add js/prefs.ts js/locationShare.ts tests/prefs.test.js tests/locationShare.test.js
git commit -m "perf(location): fire location-prefs-synced only on real opt-in changes

Audit F5: the event dispatched whenever serverPrefs.location existed — true
forever after first opt-in — on every userPrefs echo, amplifying each
sibling-device swatch tap into a full renderList + roster re-render + glyph
repaints + per-context server probes. Diff the normalized opt-in map against
the local cache before dispatching, and skip boot/echo probes for contexts
already marked published."
```

---

### Task 5: Merge the two member-node triggers (F7)

**Files:**
- Modify: `functions/index.js` (replace `onMemberOverride` + `onMemberRemoved` with one `onMemberWritten`)
- Modify: `functions/notifier.js` (add exported `statusOverrideChanged` helper)
- Test: `functions/test/notifier.test.js`

**Interfaces:**
- Consumes: existing `handleMemberRemoved(deps, groupId, memberUid, beforeVal, afterVal)` (`functions/group-cleanup.js`) and `handleGroupOverrideChange(deps, groupId, memberUid, before, after)` (`functions/notifier.js:264`) — both unchanged.
- Produces: `statusOverrideChanged(a, b): boolean` exported from `functions/notifier.js`; a single deployed function `onMemberWritten` replacing the two.

Semantic-parity notes (verify while implementing, do not change):
- The old narrow `onMemberOverride` ALSO fired on member deletion (deleting the member node deletes the `statusOverride` child) — the merged trigger preserves that by passing `before?.statusOverride ?? null` / `after?.statusOverride ?? null`, which a deletion makes a change.
- `handleGroupOverrideChange` already no-ops on `before == null` (join blast guard) — unchanged.
- A displayName-only edit previously invoked `onMemberOverride` **zero** times; the `statusOverrideChanged` gate preserves that (no presence read).

Invocation math (commit-body material): override writes drop from 2 invocations to 1; joins/displayName edits stay at 1; deletions stay at 1 (both handlers run in it).

- [ ] **Step 1: Write the failing helper tests**

Append to `functions/test/notifier.test.js` (ESM imports at top: add `statusOverrideChanged` to the existing `from '../notifier.js'` import):

```js
describe('statusOverrideChanged (merged member-trigger gate)', () => {
  test('absent on both sides — null vs undefined — is unchanged', () => {
    expect(statusOverrideChanged(null, undefined)).toBe(false);
    expect(statusOverrideChanged(undefined, undefined)).toBe(false);
  });
  test('appearing or disappearing is a change', () => {
    expect(statusOverrideChanged(null, { enabled: true })).toBe(true);
    expect(statusOverrideChanged({ enabled: true }, null)).toBe(true);
  });
  test('field flips are changes; identical values are not', () => {
    const a = { enabled: true, statusColor: 'green', availableUntil: 5 };
    expect(statusOverrideChanged(a, { ...a })).toBe(false);
    expect(statusOverrideChanged(a, { ...a, enabled: false })).toBe(true);
    expect(statusOverrideChanged(a, { ...a, statusColor: 'red' })).toBe(true);
    expect(statusOverrideChanged(a, { ...a, availableUntil: 9 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm test -- --testPathPattern=notifier` (then `cd /home/user/on`)
Expected: FAIL — `statusOverrideChanged` is not exported.

- [ ] **Step 3: Implement the helper**

In `functions/notifier.js`, next to `handleGroupOverrideChange`:

```js
// Field-compare of two statusOverride values. The merged member-node trigger
// (index.js onMemberWritten) uses this to skip the notify path — and its
// presence read — when a member write (displayName edit, join) didn't touch
// the override. null and undefined both mean "absent".
/**
 * @param {StatusOverride | null | undefined} a
 * @param {StatusOverride | null | undefined} b
 */
export function statusOverrideChanged(a, b) {
  if (a == null || b == null) return (a ?? null) !== (b ?? null);
  return a.enabled !== b.enabled
    || a.statusColor !== b.statusColor
    || a.availableUntil !== b.availableUntil;
}
```

- [ ] **Step 4: Run helper tests to verify pass**

Run: `cd functions && npm test -- --testPathPattern=notifier` (then `cd /home/user/on`)
Expected: PASS.

- [ ] **Step 5: Merge the triggers in index.js**

In `functions/index.js`: add `statusOverrideChanged` to the notifier import; delete the `onMemberOverride` export (`:152-164`) and the `onMemberRemoved` export (`:166-177`); add in their place:

```js
// A group membership node was written — ONE trigger for the whole member
// node. RTDB triggers match any write at or below their path, so the previous
// split (an override-leaf trigger + a member-node trigger) doubled every
// statusOverride write into a second, no-op invocation (audit F7).
//  - deletion (leave / kick / teardown): revoke the departed member's coarse
//    location cell so it can't outlive membership (handleMemberRemoved no-ops
//    on create/update);
//  - statusOverride transition: notify opted-in co-members. Gated on a real
//    override change so displayName/join writes skip the notify path (and its
//    presence read) — matching the old leaf trigger, which also fired on
//    member deletion (the leaf vanishes with the node), preserved here.
export const onMemberWritten = onValueWritten('/groups/{groupId}/members/{memberUid}', async (event) => {
  const before = event.data.before.val();
  const after = event.data.after.val();
  const { groupId, memberUid } = event.params;
  await handleMemberRemoved(makeDbDeps(), groupId, memberUid, before, after);
  const beforeOv = (before && before.statusOverride) || null;
  const afterOv = (after && after.statusOverride) || null;
  if (statusOverrideChanged(beforeOv, afterOv)) {
    await handleGroupOverrideChange(makeDeps(), groupId, memberUid, beforeOv, afterOv);
  }
});
```

- [ ] **Step 6: Run the full functions suite + typecheck**

Run: `cd functions && npm test` (then `cd /home/user/on`) → all PASS (handler tests in `group-cleanup.test.js` and `notifier.test.js` exercise the unchanged handlers; nothing imports the deleted exports).
Run: `npm run typecheck && npm run typecheck:scripts` → clean.

- [ ] **Step 7: Commit (deploy note in body)**

```bash
git add functions/index.js functions/notifier.js functions/test/notifier.test.js
git commit -m "perf(functions): merge member-node triggers into onMemberWritten

Audit F7: onValueWritten fires on any write at or below its path, so the
override-leaf trigger (onMemberOverride) and the member-node trigger
(onMemberRemoved) BOTH ran on every statusOverride write — one of the hotter
write families — with the second a billed no-op. One member-node trigger now
routes deletion → cell revocation and override change → co-member notify,
gated by statusOverrideChanged so displayName/join writes stay read-free.
Old leaf-trigger semantics preserved (it also fired on member deletion).

DEPLOY: functions-only. The deploy prompts to DELETE onMemberOverride and
onMemberRemoved — confirm; onMemberWritten replaces both in the same pass.
No rules interplay, no ordering constraint."
```

---

### Task 6: Prefetch shared maps in `/who` (F10)

**Files:**
- Modify: `functions/telegram.js` (`handleWhoGroup`, bare-`/who` branch of `handleSocialCommand`)
- Test: `functions/test/telegram.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: no export change. Read pattern per command becomes: `users/{uid}/followers` once (+ `locationCells/{gid}` once in the group variant when the coarse tier is live) instead of one child read per listed member.

The per-member reads that legitimately differ per member stay: `users/{mid}/presence`, `locations/{mid}`, `users/{mid}/followers/{uid}` (the OTHER edge). Reads remain parallel across members (audit correction: they already were).

- [ ] **Step 1: Write the failing test**

Append to `functions/test/telegram.test.js`, inside/alongside the existing `/who` distance describe blocks, reusing that block's deps/store fixture (wrap whatever deps object those tests build — the assertion is on read *paths*, so it composes with any fixture):

```js
test('group /who reads own-followers and the group cell map once, not per member (audit F10)', async () => {
  // Build the same deps the existing group-/who distance test uses (available
  // co-members, requester cell + raw point present), then spy on read paths.
  const paths = [];
  const spied = { ...deps, getVal: (p) => { paths.push(p); return deps.getVal(p); } };
  await handleUpdate(spied, msgUpdate('/who Hikers'));
  const uid = 'u1'; // the fixture requester uid
  expect(paths).toContain(`users/${uid}/followers`);
  expect(paths.filter((p) => p.startsWith(`users/${uid}/followers/`))).toEqual([]);
  expect(paths.filter((p) => /^locationCells\/[^/]+\/.+$/.test(p))).toEqual([]);
});
```

(Bind `deps`, `msgUpdate`, the group name, and `uid` to the fixture actually used by the neighboring `/who` tests in that file — the assertions themselves are the contract. Add the mirrored bare-`/who` assertion: `paths.filter((p) => p.startsWith('users/u1/followers/')).toEqual([])` after a bare `/who` update.)

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm test -- --testPathPattern=telegram` (then `cd /home/user/on`)
Expected: new test FAILS on the per-member child reads.

- [ ] **Step 3: Implement — group variant**

In `functions/telegram.js` `handleWhoGroup`, after `myLoc` is resolved and before the `coMembers.map`, prefetch once:

```js
  // One read each of the requester's own followers map and this group's cell
  // map replaces a per-member child read of both (audit F10) — the map loop
  // below only indexes into them.
  const myFollowers = myLoc ? ((await deps.getVal(`users/${uid}/followers`)) || {}) : {};
  const groupCells = myCell ? ((await deps.getVal(`locationCells/${match.gid}`)) || {}) : null;
```

then inside the member mapper replace the precise-tier block:

```js
    if (myLoc && primaryAvailable(presence, deps.now()) && myFollowers[mid]) {
      const [theirLoc, followerOfThem] = await Promise.all([
        deps.getVal(`locations/${mid}`),
        deps.getVal(`users/${mid}/followers/${uid}`),
      ]);
      if (theirLoc && followerOfThem) {
        dist = ` · ${formatDistancePrecise(haversineMeters(myLoc.lat, myLoc.lng, theirLoc.lat, theirLoc.lng))}`;
      }
    }
    if (!dist && myCell && groupCells) {
      const theirCell = groupCells[mid];
      if (theirCell) {
        dist = ` · ${formatDistanceCoarse(haversineMeters(myCell.lat, myCell.lng, theirCell.lat, theirCell.lng))}`;
      }
    }
```

Keep the existing comment block about mirroring rules explicitly (Admin SDK bypasses rules) — it still applies; `myFollowers[mid]` IS the `users/{uid}/followers/{mid}` gate, just read from the prefetched map.

- [ ] **Step 4: Implement — bare `/who` variant**

In `handleSocialCommand`'s `/who` branch, after `myLoc` is resolved, add the same prefetch:

```js
    const myFollowers = myLoc ? ((await deps.getVal(`users/${uid}/followers`)) || {}) : {};
```

and in the per-entry precise block replace the three-way `Promise.all` (`locations/{entry.userId}`, `users/{uid}/followers/{entry.userId}`, `users/{entry.userId}/followers/{uid}`) with the two remaining per-member reads gated on `myFollowers[entry.userId]`:

```js
      if (myLoc && myFollowers[entry.userId]) {
        const [theirLoc, followerOfThem] = await Promise.all([
          deps.getVal(`locations/${entry.userId}`),
          deps.getVal(`users/${entry.userId}/followers/${uid}`),
        ]);
        if (theirLoc && followerOfThem) {
          dist = ` · ${formatDistancePrecise(haversineMeters(myLoc.lat, myLoc.lng, theirLoc.lat, theirLoc.lng))}`;
        }
      }
```

(Preserve the existing "Explicit gates — Admin SDK bypasses rules" comment.)

- [ ] **Step 5: Run the telegram suite + full functions suite**

Run: `cd functions && npm test` (then `cd /home/user/on`)
Expected: all PASS — existing distance assertions still hold (the store fixture serves parent-map reads identically); the new path-shape tests pass.

- [ ] **Step 6: Commit**

```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "perf(telegram): prefetch own-followers and group cells in /who

Audit F10: both /who variants read users/{uid}/followers/{mid} — a child of
the requester's own fixed map — once per listed member, and the group variant
read locationCells/{gid}/{mid} per member. One prefetch of each map replaces
the N child reads; the genuinely per-member reads (peer presence, peer
followers edge, peer raw point) are untouched and stay parallel."
```

---

### Task 7: Immutable chunk caching — hosting header + SW carry-over (F9)

**Files:**
- Modify: `firebase.json` (headers)
- Modify: `sw.template.js` (install handler)
- Test: `tests/sw.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `dist/chunks/**` served with `Cache-Control: public, max-age=31536000, immutable` (chunk filenames are content-hashed by `scripts/prod.js:18`; the unhashed `dist/bundle.js`, `index.html`, `sw.js` stay `no-cache` via the `**` rule). SW install re-uses previous-cache copies of chunk URLs instead of re-fetching them.

- [ ] **Step 1: Add the hosting header**

In `firebase.json`, append a second entry to the existing `"headers"` array, AFTER the `"source": "**"` entry (Firebase applies all matching header blocks; for a duplicate key the later matching definition wins — keep this ordering):

```json
      {
        "source": "/dist/chunks/**",
        "headers": [
          { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
        ]
      }
```

- [ ] **Step 2: Write the failing SW test**

Append to `tests/sw.test.js`. The raw template filters `CHUNKS` to `[]`, so the carry-over path needs a stamped copy — mirror the build's two `.replace` calls (`scripts/build.js:163-165`):

```js
describe('chunk carry-over on install (audit F9)', () => {
  const fsx = require('fs');
  function loadStampedSw(chunkList, { priorMatch } = {}) {
    const handlers = {};
    const addAll = jest.fn().mockResolvedValue(undefined);
    const put = jest.fn().mockResolvedValue(undefined);
    global.self = {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      skipWaiting: jest.fn(),
      clients: { claim: jest.fn(), matchAll: jest.fn().mockResolvedValue([]) },
      registration: { showNotification: jest.fn() },
      location: { origin: 'https://app.example' },
    };
    global.fetch = jest.fn().mockResolvedValue('network-response');
    global.caches = {
      open: jest.fn().mockResolvedValue({ addAll, put }),
      keys: jest.fn().mockResolvedValue([]),
      match: jest.fn((url) => Promise.resolve(priorMatch ? priorMatch(url) : undefined)),
    };
    const src = fsx.readFileSync(path.join(__dirname, '..', 'sw.template.js'), 'utf8')
      .replace(/__CACHE_VERSION__/g, 'knockknock-test')
      .replace('__CHUNK_LIST__', chunkList.join(','));
    const tmp = path.join(__dirname, 'tmp-sw-stamped.js');
    fsx.writeFileSync(tmp, src);
    jest.isolateModules(() => { require(tmp); });
    fsx.unlinkSync(tmp);
    return { handlers, addAll, put };
  }

  test('a chunk present in a previous cache is copied, not re-fetched', async () => {
    const prior = { cached: true };
    const { handlers, addAll, put } = loadStampedSw(
      ['/dist/chunks/wordlist-abc123.js', '/dist/chunks/new-def456.js'],
      { priorMatch: (url) => (url === '/dist/chunks/wordlist-abc123.js' ? prior : undefined) },
    );
    const waited = [];
    handlers.install({ waitUntil: (p) => waited.push(p) });
    await Promise.all(waited);
    expect(put).toHaveBeenCalledWith('/dist/chunks/wordlist-abc123.js', prior);
    const fetched = addAll.mock.calls[0][0];
    expect(fetched).not.toContain('/dist/chunks/wordlist-abc123.js'); // carried over
    expect(fetched).toContain('/dist/chunks/new-def456.js');          // genuinely new
    expect(fetched).toContain('/dist/bundle.js');                     // shell always re-fetched
  });

  test('with no previous caches every chunk is fetched (fresh install)', async () => {
    const { handlers, addAll, put } = loadStampedSw(['/dist/chunks/a-1.js']);
    const waited = [];
    handlers.install({ waitUntil: (p) => waited.push(p) });
    await Promise.all(waited);
    expect(put).not.toHaveBeenCalled();
    expect(addAll.mock.calls[0][0]).toContain('/dist/chunks/a-1.js');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest tests/sw.test.js --maxWorkers=2`
Expected: the two new tests FAIL (`put` never called; addAll gets all chunks). Pre-existing tests must still PASS (they exercise the unsubstituted template where `CHUNKS` is `[]`).

- [ ] **Step 4: Implement the install carry-over**

In `sw.template.js`, replace the install handler:

```js
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // Chunk filenames are content-hashed — a URL that exists in a previous
      // version's cache is byte-identical, so copy it across instead of
      // re-fetching the whole set on every deploy (activate deletes the old
      // cache afterwards, which used to throw all unchanged chunks away).
      // The shell proper (unhashed URLs) is always re-fetched.
      const missing = [];
      await Promise.all(CHUNKS.map((url) =>
        caches.match(url).then((prior) => {
          if (prior) return cache.put(url, prior);
          missing.push(url);
          return undefined;
        }),
      ));
      await cache.addAll(SHELL.concat(missing));
    }),
  );
  self.skipWaiting();
});
```

(The `activate` handler is untouched — old caches are deleted only after install copied what it needed; `caches.match` with no cache name searches all live caches.)

- [ ] **Step 5: Run the SW suite + typecheck**

Run: `npx jest tests/sw.test.js --maxWorkers=2` → all PASS.
Run: `npm run typecheck && npm run typecheck:scripts` → clean (sw.template.js is plain JS but the scripts config may include it — confirm no regression).

- [ ] **Step 6: Commit (deploy note in body)**

```bash
git add firebase.json sw.template.js tests/sw.test.js
git commit -m "perf(shell): immutable caching for hashed chunks; SW carries chunks across deploys

Audit F9: the '**' no-cache header applied to content-hashed dist/chunks/*
(immutable by construction), and the SW's activate deleted the whole previous
cache while install re-fetched every entry — so any one-line deploy re-shipped
the entire shell including the unchanged ~78KB wordlist chunk. Serve
/dist/chunks/** with max-age=31536000+immutable (unhashed bundle.js/index.html/
sw.js stay no-cache via '**'), and copy previous-cache chunk entries into the
new SW cache at install instead of re-fetching them.

DEPLOY: hosting-only. Verify post-deploy: curl -I an existing chunk URL →
Cache-Control: public, max-age=31536000, immutable; curl -I /dist/bundle.js →
no-cache. Firebase applies the later matching headers block for a duplicate
key — the chunks rule must stay AFTER the '**' rule in firebase.json."
```

---

## Final gate (after all tasks)

- [ ] `cd /home/user/on && npx jest --maxWorkers=2` → full web suite green (baseline 1957; Tasks 1–4/7 add ~13 and invert 1)
- [ ] `cd functions && npm test` → full functions suite green (baseline 419; Tasks 5–6 add ~5) — then `cd /home/user/on`
- [ ] `npm run test:rules` → 106 green (nothing here touches rules; run as regression gate)
- [ ] `npm run typecheck && npm run typecheck:scripts` → clean, zero suppressions
- [ ] Request whole-branch review per superpowers:requesting-code-review before handing back to the operator

## Self-review notes

- **Coverage:** F1→Task 1, F2→Task 2, F4→Task 3, F5→Task 4, F7→Task 5, F10→Task 6, F9→Task 7. Excluded by scope rule (PRE-EXISTING): F3, F6, F8.
- **Known deliberate interactions:** Task 1 makes peer listeners quiet for stationary publishers, which reduces how often Task 3's dedupe fires — they are complementary (Task 3 still covers own-publish wakes and old-client `updatedAt`-only rewrites). Task 2's cell-only coarse fix can shift the raw-vs-cell position by up to the coarse-accuracy error; the cell grid (~1.1 km) absorbs it.
- **Fixture-binding caveat:** Task 6 Step 1's test binds to the existing `/who` fixture in `functions/test/telegram.test.js` — the implementer must lift the fixture's actual uids/group name; the path-shape assertions are the contract.
- **Task 5 deletes two deployed functions** — the commit body carries the deploy confirmation note; nothing in-repo references the removed export names (verified: only `index.js` exported them).
