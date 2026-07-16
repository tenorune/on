# Status-Store Migration (Roadmap Task 2.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the own-override state machinery shared by `groupNav` and `groupContext` into `statusStore.ts`, so the bidirectional import cycle and the symmetric optimistic-push pair (`applyOptimisticOverride` / `applyOptimisticAppearance`) disappear, and the object-spread echo-preservation hacks collapse into one merge implemented once.

**Architecture:** `statusStore.ts` (landed dark in roadmap Task 2.2) becomes the single owner of the per-group own-override subscriptions currently managed inside `groupNav`'s `syncMetaSubs`. Both modules subscribe to the store; optimistic updates go through one `pushOptimistic` that merges partials into the cached override (the semantics today's scattered `{ ...existing, … }` spreads implement by hand). Group *meta* subscriptions stay in `groupNav` — meta is not status, and a one-directional `groupContext → groupNav` import is not a cycle.

**Tech Stack:** TypeScript (strict), Jest + jsdom, existing `reconcile.ts`/`presenceHub.ts` patterns.

## Global Constraints

- **Prerequisites:** roadmap Phase 1 Wave B complete (`groupNav.ts`, `groupContext.ts` exist) and Tasks 2.1 (`js/status.ts`: `effectiveStatus`, `EffectiveStatus`) + 2.2 (`js/statusStore.ts` base API) landed. File names below use post-Phase-1 `.ts` names; quoted code is from the current source (line refs cite today's `.js` files — content is unchanged by the Phase 1 renames, only syntax).
- Exit contract (pinned by the roadmap, verbatim): `groupContext` no longer imports `applyOptimisticAppearance`/`subscribeOwnOverride` from `groupNav`; `groupNav` no longer imports `applyOptimisticOverride` from `groupContext`; the spread hacks at `groupNav.js:395-404`, `groupContext.js:1186-1190,1203-1205,1255-1257` are deleted; `tests/groupNav.test.js` / `tests/groupContext.test.js` keep passing with mocks pointed at `statusStore`.
- `groupContext`'s imports of `navigateToDirect` and `subscribeGroupMeta` from `groupNav` **remain** — the contract names only the two status functions, and meta subscription is out of scope.
- **Synchronous fan-out is load-bearing.** Today's optimistic paths paint before the first `await` yields (`groupNav.js:551-556` relies on `navigateToGroup`'s synchronous `emit()`; the toggle handler renders then writes). `pushOptimistic` MUST fan out synchronously to all subscribers.
- **Replay must never fabricate `null`.** Preserve `groupNav`'s ticked-guard semantics (`_overrideTicked`, `groupNav.js:137-141,639-641`): a subscriber gets a replay only after the underlying watch has delivered ≥1 value.
- **Last-writer-wins with the server.** A `watchOwnMemberOverride` tick replaces the cached override wholesale and fans out — optimistic values are meant to be overwritten by their own echo (that is why the spreads exist: to make the optimistic value byte-match what `mergeStatusOverride` leaves on the server). Do not build a pending/ack layer.
- Gates per task: `npx jest tests/statusStore.test.js tests/groupNav.test.js tests/groupContext.test.js` then full `npx jest` + `npm run typecheck`. Zero suppressions. Commit per task; no merges/PRs unless asked.

---

### Task 1: Extend `statusStore.ts` with the raw-override surface

Task 2.2's pinned base API (`initStatusStore`, `subscribeOwnStatus(groupId|null, cb)`, `pushOptimistic`, `_resetStatusStoreForTests`) covers merged snapshots. The migration additionally needs the RAW override (click handlers read `enabled`/`statusColor` fields directly, e.g. `groupNav.js:399-404`, `groupContext.js:1182-1184`) and enumeration-driven watch management (today: `overrideWantIds()` = enumerated groups ∪ consumer-registered groups, `groupNav.js:204-206`).

**Files:**
- Modify: `js/statusStore.ts`
- Test: `tests/statusStore.test.js`

**Interfaces:**
- Consumes: `watchOwnMemberOverride(groupId, uid, cb)` from `./db.js`; `EffectiveStatus`/`effectiveStatus` from `./status.js`.
- Produces (exact signatures Tasks 2–4 rely on):

```ts
// Additions to js/statusStore.ts
export function setWatchedGroups(groupIds: string[]): void;
// Union rule: underlying watchOwnMemberOverride subs exist for
// setWatchedGroups(...) ∪ {groupIds with ≥1 subscribeOwnOverride consumer}.
// (Mirrors overrideWantIds() in groupNav.js:204-206 — the deep-link boot race
// needs a consumer-kept sub for a group not yet enumerated.)

export function subscribeOwnOverride(
  groupId: string,
  cb: (override: StatusOverride | null) => void,
): () => void;
// Replays the cached raw value ONLY if the underlying sub has ticked.

export function getOwnOverride(groupId: string): StatusOverride | null;
// Synchronous read of the cache (optimistic-merged). For click handlers.

export function pushOptimistic(
  groupId: string | null,
  partial: Partial<StatusOverride>,
): void;
// groupId null = Direct (primary) — no-op for now (no Direct consumer in this
// task; the signature stays per the roadmap pin). For a group: cache =
// { ...(cache ?? {}), ...partial }; then SYNCHRONOUS fan-out to that group's
// subscribeOwnOverride and subscribeOwnStatus subscribers. Marks the group
// ticked (an optimistic write is a legitimate first value — the create-group
// seed happens before any server tick, groupNav.js:543-547).
```

- [ ] **Step 1: Write the failing tests** in `tests/statusStore.test.js` (extend the Task 2.2 suite; keep its `jest.mock('../js/db.js', …)` harness where `watchOwnMemberOverride` is a `jest.fn()` returning an unsub and the test captures the callback):

```js
describe('raw override surface', () => {
  test('pushOptimistic merges partials — statusColor survives a status flip', () => {
    // Simulate the server tick first: override with color.
    fireOverrideTick('G1', { enabled: true, status: 'available', availableUntil: 99, statusColor: '#abc' });
    pushOptimistic('G1', { status: 'unavailable', availableUntil: null });
    expect(getOwnOverride('G1')).toEqual(
      { enabled: true, status: 'unavailable', availableUntil: null, statusColor: '#abc' });
  });

  test('pushOptimistic fans out synchronously', () => {
    const seen = [];
    subscribeOwnOverride('G1', (o) => seen.push(o));
    fireOverrideTick('G1', { enabled: false });
    pushOptimistic('G1', { enabled: true, status: 'unavailable', availableUntil: null });
    expect(seen).toHaveLength(2);            // tick replay/fan-out + optimistic fan-out
    expect(seen[1].enabled).toBe(true);       // delivered before pushOptimistic returned
  });

  test('server tick overwrites optimistic wholesale (last-writer-wins)', () => {
    pushOptimistic('G1', { enabled: true, statusColor: '#abc' });
    fireOverrideTick('G1', { enabled: true, status: 'unavailable', availableUntil: null });
    expect(getOwnOverride('G1')).toEqual({ enabled: true, status: 'unavailable', availableUntil: null });
  });

  test('no replay before first tick; replay after (never a fabricated null)', () => {
    const seen = [];
    subscribeOwnOverride('G2', (o) => seen.push(o));
    expect(seen).toHaveLength(0);             // not ticked → no replay
    fireOverrideTick('G2', null);
    const late = [];
    subscribeOwnOverride('G2', (o) => late.push(o));
    expect(late).toEqual([null]);             // real null replays fine
  });

  test('optimistic write before any server tick marks the group ticked', () => {
    pushOptimistic('G3', { enabled: true, status: 'unavailable', availableUntil: null });
    const seen = [];
    subscribeOwnOverride('G3', (o) => seen.push(o));
    expect(seen).toHaveLength(1);             // create-group seed path
  });

  test('setWatchedGroups ∪ consumers drives underlying subs', () => {
    setWatchedGroups(['A', 'B']);
    expect(watchOwnMemberOverride).toHaveBeenCalledTimes(2);
    const unsub = subscribeOwnOverride('C', () => {});   // consumer-only group
    expect(watchOwnMemberOverride).toHaveBeenCalledTimes(3);
    setWatchedGroups(['A']);                  // B dropped, C kept (consumer)
    expect(unsubsCalledFor()).toEqual(['B']);
    unsub();                                  // C's last consumer leaves
    expect(unsubsCalledFor()).toEqual(['B', 'C']);
  });
});
```

(`fireOverrideTick(groupId, value)` and `unsubsCalledFor()` are suite helpers over the captured mock callbacks/unsubs — the Task 2.2 suite already has the pattern; add them there if absent.)

- [ ] **Step 2:** `npx jest tests/statusStore.test.js` → new tests FAIL (functions undefined).
- [ ] **Step 3: Implement** in `statusStore.ts`. Internal state mirrors what leaves `groupNav` in Task 2: `_overrideSubs: Record<groupId, unsub>`, `_overrideCache: Record<groupId, StatusOverride | null>`, `_overrideConsumers: Record<groupId, Set<cb>>`, `_ticked: Set<groupId>`, `_watched: Set<groupId>`. `syncOverrideSubs()` reimplements the want-set diff from `groupNav.js:246-269` against `_watched ∪ keys(_overrideConsumers)`. Fan-out copies the consumer set before iterating and try/catches per consumer (house rule — `ownStatus.ts:35-38`, `presenceHub.ts:43-44`). `initStatusStore`/`_resetStatusStoreForTests` clear all of it.
- [ ] **Step 4:** `npx jest tests/statusStore.test.js` → PASS; full suite + typecheck.
- [ ] **Step 5: Commit.** `git commit -m "feat(statusStore): raw own-override surface — watched-groups union, merge-based pushOptimistic, ticked replay"`

---

### Task 2: Move `groupNav`'s override plumbing onto the store

`groupNav` stops owning `watchOwnMemberOverride` subs and consumes the store. Its render cache `_overrideByGroupId` remains as a plain paint cache, now fed by store subscriptions.

**Files:**
- Modify: `js/groupNav.ts`
- Test: `tests/groupNav.test.js`

**Interfaces:**
- Consumes: `setWatchedGroups`, `subscribeOwnOverride`, `getOwnOverride`, `pushOptimistic` from `./statusStore.js` (Task 1).
- Produces: `subscribeOwnOverride(groupId, cb)` **removed from groupNav's exports** (Task 3 repoints its one consumer); everything else groupNav exports is unchanged.

- [ ] **Step 1: Repoint the test mocks.** In `tests/groupNav.test.js`, the suite currently drives override state through the captured `watchOwnMemberOverride` callback (mocked on `../js/db.js`) and mocks `../js/groupContext.js`'s `applyOptimisticOverride`. Add a `jest.mock('../js/statusStore.js', …)` exposing `setWatchedGroups`/`subscribeOwnOverride`/`getOwnOverride`/`pushOptimistic` as fns backed by a tiny in-suite cache (10 lines: a Map plus consumer Sets, mirroring the real merge), and migrate the assertions that fired `watchOwnMemberOverride` callbacks to fire the store-mock's consumers instead. Assertions about `applyOptimisticOverride` being called become assertions on `pushOptimistic(gid, expectedPartial)`. Run: suite FAILS (groupNav still on old wiring) — that is the point; the updated suite is the spec for this task.
- [ ] **Step 2: Rewire `startCardsRowSubscriptions`.** Delete the override half of the teardown block (`groupNav.js:169-174` lines touching `_overrideSubs`/`_overrideByGroupId`/`_overrideTicked`/`_overrideLastTick`) and the override half of `syncMetaSubs` (`groupNav.js:246-269`), `overrideWantIds` (`:204-206`), and the module state `_overrideSubs`, `_overrideConsumers`, `_overrideTicked`, `_overrideLastTick` (`:126-142`). Keep `_overrideByGroupId` as the paint cache. In the `watchUserGroups` callback (`:184-188`) add `setWatchedGroups(Object.keys(_enumeration))` before `renderNavRow()`, and maintain one store subscription per enumerated group feeding the cache:

```ts
// groupNav.ts — inside the enumeration callback, after setWatchedGroups(...)
syncOverrideConsumers();
```

```ts
const _overrideStoreUnsubs: Record<string, () => void> = {};
function syncOverrideConsumers() {
  const want = new Set(Object.keys(_enumeration));
  for (const gid of Object.keys(_overrideStoreUnsubs)) {
    if (!want.has(gid)) {
      _overrideStoreUnsubs[gid]();
      delete _overrideStoreUnsubs[gid];
      delete _overrideByGroupId[gid];
    }
  }
  for (const gid of want) {
    if (!_overrideStoreUnsubs[gid]) {
      _overrideStoreUnsubs[gid] = storeSubscribeOwnOverride(gid, (override) => {
        if (override) _overrideByGroupId[gid] = override;
        else delete _overrideByGroupId[gid];
        renderNavRow();
      });
    }
  }
}
```

(`import { subscribeOwnOverride as storeSubscribeOwnOverride, … } from './statusStore.js'`.) Tear `_overrideStoreUnsubs` down in the `startCardsRowSubscriptions` reset block.

- [ ] **Step 3: Rewire the toggle click handler** (`groupNav.js:390-408`). Replace the body's cache mutation + cross-module call:

```ts
toggle.addEventListener('click', () => {
  // Persistent node: read LIVE state at click time, never the render-time
  // closure (the toggle outlives the render that painted it).
  const gid = _state.groupId as string;
  const existing = getOwnOverride(gid) || {};
  const nextEnabled = !(existing.enabled === true);
  // pushOptimistic merges into the cached override, so statusColor/paletteKey
  // survive the flip without hand-spreading (store owns that invariant), and
  // the synchronous fan-out repaints this nav row AND groupContext's
  // own-status row before toggleStatusOverride's write round-trips.
  pushOptimistic(gid, nextEnabled
    ? { enabled: true, status: 'unavailable', availableUntil: null }
    : { enabled: false, status: null, availableUntil: null });
  toggleStatusOverride(gid, _myUserId as string, nextEnabled).catch(() => {});
});
```

Note what is GONE: the direct `_overrideByGroupId[gid] = nextState` (the store subscription in Step 2 updates the cache via fan-out), the explicit `renderNavRow()` (same), the `applyOptimisticOverride(nextState)` cross-call, and the 5-line spread-rationale comment (`:394-398`). Delete `import { applyOptimisticOverride } from './groupContext.js'` (`groupNav.js:12`) — **this line is the cycle**; its removal is the task's core deliverable.

- [ ] **Step 4: Rewire the create-modal seed** (`groupNav.js:543-547, 556-557`). Replace the direct cache write and post-navigate cross-call with one pre-navigate push:

```ts
_lastKnownNames[result.groupId] = name;
// Seed the override before navigateToGroup's emit: pushOptimistic marks the
// group ticked, so enterGroupContext's store subscription replays this seed
// synchronously — replacing the old applyOptimisticOverride call that had to
// run AFTER navigateToGroup to repaint the row enterGroupContext reset.
pushOptimistic(result.groupId, { enabled: true, status: 'unavailable', availableUntil: null });
_suspendRenderNavRow = false;
const navPromise = navigateToGroup(result.groupId);
openInviteModal({ /* unchanged */ });
```

- [ ] **Step 5: Delete `applyOptimisticAppearance`** (`groupNav.js:286-303`) — WAIT: only after Task 3 Step 4 repoints `groupContext`'s call. Mark this step deferred; execute it as Task 3 Step 6. (Listed here so the reader of this task knows the export's fate.)
- [ ] **Step 6:** `npx jest tests/groupNav.test.js` → PASS; full suite + typecheck. Commit: `git commit -m "refactor(groupNav): own-override state via statusStore — cycle-forming groupContext import removed"`

---

### Task 3: Move `groupContext` onto the store; delete the optimistic pair

**Files:**
- Modify: `js/groupContext.ts`, `js/groupNav.ts` (the deferred deletion)
- Test: `tests/groupContext.test.js`

**Interfaces:**
- Consumes: `subscribeOwnOverride`, `getOwnOverride`, `pushOptimistic` from `./statusStore.js`.
- Produces: `applyOptimisticOverride` **removed from groupContext's exports**; `applyAdoptedComboInGroup` keeps its signature (external callers in `palettes.ts`/`favorites.ts` are untouched).

- [ ] **Step 1: Repoint test mocks.** In `tests/groupContext.test.js`: the `jest.mock('../js/groupNav.js', …)` factory drops `applyOptimisticAppearance`/`subscribeOwnOverride` (keep `navigateToDirect`, `subscribeGroupMeta`, and the rest); add the same `../js/statusStore.js` mock harness as Task 2 Step 1. Override-state fixtures that previously fired the groupNav-mock's `subscribeOwnOverride` callback now fire the store mock's. Assertions on `applyOptimisticAppearance(gid, fields)` become `pushOptimistic(gid, fields)`. Suite FAILS — spec for this task.
- [ ] **Step 2: Repoint the subscription** (`groupContext.js:1143-1166`): `_ownOverrideUnsub = subscribeOwnOverride(groupId, (data) => { … })` keeps its callback body verbatim, but the import at `groupContext.js:13` shrinks to `import { navigateToDirect, subscribeGroupMeta } from './groupNav.js'`, with the override functions imported from `./statusStore.js`. The color-seed write-back inside the callback (`:1152-1158`) changes one line: `_ownOverride = { ..._ownOverride, statusColor: seed }` → `pushOptimistic(groupId, { statusColor: seed })` and drop the local reassignment (the store fan-out re-enters this same callback with the merged value — the `if (!_ownOverride.statusColor)` guard prevents a loop, same as today's echo path).
- [ ] **Step 3: Rewire the dot + chip click handlers.** In the dot handler (`groupContext.js:1181-1226`), both branches replace local-mutation-plus-render with a push. Available branch (`:1185-1192`):

```ts
if (currentlyAvailable) {
  pushOptimistic(groupId, { status: 'unavailable', availableUntil: null });
  setOverrideStatusUnavailable(groupId, userId).catch(() => {});
}
```

Unavailable branch (`:1200-1224`) — the push replaces the `_ownOverride = { ..._ownOverride, … }; renderOwnStatusRow();` pair (`:1205-1206`); `saveCombo(buildGroupCombo({ ownOverride: getOwnOverride(groupId), … }))` reads the store cache instead of the module var, since the module var now updates via the subscription fan-out (which has already run — synchronous — by the time this line executes). Chip handler (`:1252-1260`): same one-line substitution. Delete all three "Spread preserves statusColor/paletteKey" comments (`:1186-1189, 1203-1204, 1255-1256`) — the invariant now lives in the store and its Task 1 test.
- [ ] **Step 4: Rewire `applyAdoptedComboInGroup`** (`groupContext.js:1347-1355`). The optimistic block becomes:

```ts
// Optimistic local mutation: one push covers both this module's own-status
// row (via the store subscription) and groupNav's card border — the two
// renders the old applyOptimisticOverride + applyOptimisticAppearance pair
// did separately.
pushOptimistic(groupId, { statusColor: adoptedColor, paletteKey: adoptedPaletteKey });
applyEffectivePalette();                // CSS vars in group context
```

- [ ] **Step 5: Delete `applyOptimisticOverride`** (`groupContext.js:1321-1331`) and its doc comment.
- [ ] **Step 6: Execute Task 2 Step 5** — delete `applyOptimisticAppearance` from `groupNav.ts` (`groupNav.js:286-303`).
- [ ] **Step 7: Verify the cycle is gone.**

Run: `grep -n "from './groupContext" js/groupNav.ts; grep -n "applyOptimistic\|subscribeOwnOverride" js/groupContext.ts js/groupNav.ts`
Expected: first grep empty; second shows only `./statusStore.js` imports and store-internal names.

- [ ] **Step 8:** Full quartet (`npx jest`, `cd functions && npm test`, `npm run test:rules`, `npm run typecheck`). Commit: `git commit -m "refactor(groupContext): own-override via statusStore; delete applyOptimisticOverride/applyOptimisticAppearance pair"`

---

### Task 4: Behavioral spot-check (manual, no code)

The suites cover state and paint logic, but the optimistic UX is timing-sensitive. Using the `/run` flow (or `npm run dev`): create a group with a color set, toggle the chain icon off/on and confirm the dot NEVER flashes back to the Direct color; tap the dot available→unavailable→available; long-press-adopt a member's combo in group context and confirm the nav-row card border updates before the network round-trip (throttle to Slow 3G in devtools to make the window visible).

- [ ] Walkthrough done; observations noted in the PR/commit description (what was checked, on what browser).

## Self-review notes

- The four `effectiveStatus` merge call sites are Task 2.1's scope, not this plan's — this plan deliberately does not touch `paintNavCard`/`renderOwnStatusRow` merge logic beyond what the subscription rewiring requires.
- `me.ts`'s `clearFirstUsePulse` re-install and the clone-and-replace teardown in `enterGroupContext` (`groupContext.js:1173-1180, 1237-1238`) are untouched: they concern listener lifecycle, not status state, and are out of contract.
- Known judgment call, surfaced deliberately: Step 2 of Task 3 re-enters the subscription callback via the store's synchronous fan-out on the seed write. Today's code does the equivalent via the RTDB echo (asynchronous). The `!_ownOverride.statusColor` guard terminates both. If the executing engineer finds a test proving otherwise, stop and re-surface rather than adding a re-entrancy flag.
