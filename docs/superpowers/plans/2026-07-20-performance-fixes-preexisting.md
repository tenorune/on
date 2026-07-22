# Performance Fixes (Pre-existing Tier 1 & 2 Findings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the three PRE-EXISTING Tier 1 & 2 inefficiencies from the 2026-07-20 performance audit: the whole-`groups/{gid}` meta listens (F3), the wholesale-`userPrefs` boot/echo amplification (F6), and the notifier's sequential read chains (F8).

**Architecture:** F3 narrows `watchGroupMeta` to two leaf listens (no schema change, no rules change — read grants cascade down). F6 splits into three independent sub-fixes: a boot leaf-read, diff-gated sync events, and relocating `pushTokens` to a top-level path (the only schema + rules + migration work in this plan). F8 restructures the four directed notifier handlers into parallel read phases with gate semantics preserved.

**Tech Stack:** vanilla TypeScript (web, jest+jsdom), Firebase RTDB rules (emulator tests), Cloud Functions gen-2 (ESM JS), one operator-run migration script.

**Source findings:** `docs/superpowers/specs/2026-07-20-performance-audit-findings.md` (F3, F6, F8). Companion plans: branch-introduced fixes in `2026-07-20-performance-fixes.md`; Tier 3 in `2026-07-20-performance-fixes-tier3.md`.

## Global Constraints

- Zero TS suppressions; `npm run typecheck && npm run typecheck:scripts` green (repo root).
- Web tests `npx jest --maxWorkers=2` (root) · functions `cd functions && npm test` then **`cd /home/user/on`** · rules `npm run test:rules`.
- RTDB rules landmine: a granted ancestor `.write` cannot be revoked by a child `.write`; read grants cascade DOWN (a member can read any child of `groups/{gid}`). Check the ancestor chain before judging any rule edit.
- Task 3 (pushTokens) is the ONLY task allowed to touch `database.rules.json`; its deploy ordering is load-bearing — keep the ordering note in the commit body.
- Set committer identity first: `git config user.email noreply@anthropic.com && git config user.name Claude`.
- Never hand off red: all four gates before wrapping.

---

### Task 1: Narrow `watchGroupMeta` to leaf listens (F3)

**Files:**
- Modify: `js/db/groups.ts:87-113` (`watchGroupMeta`)
- Test: `tests/` — extend the suite that currently exercises `watchGroupMeta` consumers (`tests/groupNav.test.js` mocks the db barrel, so its contract tests keep passing untouched); add a new `tests/watchGroupMeta.test.js` for the leaf-listen behavior

**Interfaces:**
- Consumes: `onValue`, `ref` from `firebase/database` (already imported in the file).
- Produces: unchanged external contract — `watchGroupMeta(groupId, callback)` still calls `callback({ name?, ownerId? } | null)` and returns an unsubscribe; `null` still means "group gone for me" (deleted OR kicked).

Design (verified against consumers): `groupNav.ts` reads only `meta.name` (`GroupMeta = { name?: string }`, paint sites `groupNav.ts:322, 383`); `groupContext.ts:1364-1380` reads `meta.name` + `meta.ownerId`. `createdAt`/`color`/`paletteKey` have **zero** consumers — group card theming comes from overrides/presence, not meta. So two leaf listens replace the whole-node listen:

- `groups/{gid}/ownerId` — membership-gated (inherits the root read rule `data.child('members').child(auth.uid).exists()`, `database.rules.json:64`). Its **cancel callback is the "gone for me" signal**: group deletion nulls the node so the rule evaluates against nothing → PERMISSION_DENIED cancel; a kick removes the member → same cancel. Identical semantics to today's whole-node cancel.
- `groups/{gid}/name` — has its own `.read: "auth != null"` (`database.rules.json:66`), so it survives a kick; it exists purely to deliver name updates while the sentinel governs lifecycle.

What this removes: the full `members/` subtree (every member's `displayName`/`joinedAt`/hot `statusOverride`) and `invites/` from G permanent per-group listens — every co-member swatch tap stops waking every member's nav callback, and boots stop downloading G rosters.

- [ ] **Step 1: Confirm the dead fields are dead**

Run: `grep -rn "meta\.\(color\|paletteKey\|createdAt\)\|\['color'\]\|\['paletteKey'\]" js/ --include="*.ts" | grep -iv "presence\|override\|palettes\.ts"`
Expected: no consumer of group-meta color/paletteKey/createdAt. If one surfaces, add that field as a third leaf listen in Step 4 (same pattern as `name`).

- [ ] **Step 2: Write the failing test**

Create `tests/watchGroupMeta.test.js`:

```js
// Leaf-listen contract for watchGroupMeta (audit F3): two exact-path listens
// (name, ownerId) instead of one whole-node listen; the membership-gated
// ownerId listen's cancel is the "gone for me" signal.
const paths = [];
const cbs = new Map();    // path → value callback
const cancels = new Map(); // path → cancel callback
jest.mock('firebase/database', () => ({
  ref: jest.fn((_db, path) => ({ path })),
  onValue: jest.fn((r, cb, cancel) => {
    paths.push(r.path);
    cbs.set(r.path, cb);
    cancels.set(r.path, cancel);
    return () => { cbs.delete(r.path); cancels.delete(r.path); };
  }),
  set: jest.fn(), update: jest.fn(), get: jest.fn(),
  push: jest.fn(), remove: jest.fn(), onChildAdded: jest.fn(),
  query: jest.fn(), orderByKey: jest.fn(), startAfter: jest.fn(),
  runTransaction: jest.fn(), onDisconnect: jest.fn(),
}));
jest.mock('../js/firebase-config.js', () => ({ db: {} }));

const { watchGroupMeta } = require('../js/db/groups.js');
const snap = (val) => ({ exists: () => val !== null && val !== undefined, val: () => val });

beforeEach(() => { paths.length = 0; cbs.clear(); cancels.clear(); });

test('attaches exactly two leaf listens — never the group root', () => {
  watchGroupMeta('G1', jest.fn());
  expect(paths.sort()).toEqual(['groups/G1/name', 'groups/G1/ownerId']);
});

test('emits merged meta as leaves tick, and name updates re-emit', () => {
  const cb = jest.fn();
  watchGroupMeta('G1', cb);
  cbs.get('groups/G1/ownerId')(snap('alice'));
  cbs.get('groups/G1/name')(snap('Hikers'));
  expect(cb).toHaveBeenLastCalledWith({ name: 'Hikers', ownerId: 'alice' });
  cbs.get('groups/G1/name')(snap('Peak Crew'));
  expect(cb).toHaveBeenLastCalledWith({ name: 'Peak Crew', ownerId: 'alice' });
});

test('ownerId cancel (deletion / kick) emits null, exactly once', () => {
  const cb = jest.fn();
  watchGroupMeta('G1', cb);
  cbs.get('groups/G1/name')(snap('Hikers'));
  cancels.get('groups/G1/ownerId')();
  expect(cb).toHaveBeenLastCalledWith(null);
});

test('unsubscribe detaches both listens', () => {
  const un = watchGroupMeta('G1', jest.fn());
  un();
  expect(cbs.size).toBe(0);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest tests/watchGroupMeta.test.js --maxWorkers=2`
Expected: FAIL — one listen at `groups/G1`, not two leaves.

- [ ] **Step 4: Implement**

Replace `watchGroupMeta` in `js/db/groups.ts` (delete the now-unused `GROUP_META_FIELDS` const):

```ts
// Meta subscription as LEAF listens, not a whole-node listen (audit F3): the
// group root carries members/ (incl. hot statusOverride, rewritten on every
// swatch tap) and invites/ — a root listen re-delivered all of it to every
// member's nav for every appearance write, and every boot downloaded G full
// rosters. Consumers only use name + ownerId (verified: groupNav paints name;
// groupContext reads name + ownerId). Read grants cascade down, so a member
// may read any child — no rules change.
//
// Lifecycle sentinel: groups/{gid}/ownerId inherits the membership-gated root
// read rule, so owner-deletes-group AND member-kicked both fire its CANCEL
// (never a null tick) — same "gone for me" semantics the old root listen had.
// The name leaf is auth-readable (survives a kick) and exists purely to
// deliver name updates; it must NOT drive deletion (its null/cancel behavior
// differs).
export function watchGroupMeta(groupId: string, callback: (meta: Record<string, unknown> | null) => void): () => void {
  const meta: Record<string, unknown> = {};
  let gone = false;
  const emit = () => { if (!gone) callback({ ...meta }); };
  const emitGone = () => {
    if (gone) return;
    gone = true;
    callback(null);
  };
  const unName = onValue(ref(db, `groups/${groupId}/name`), (snap) => {
    if (snap.exists()) meta.name = snap.val(); else delete meta.name;
    emit();
  }, () => { /* name leaf cancel is not a lifecycle signal */ });
  const unOwner = onValue(ref(db, `groups/${groupId}/ownerId`), (snap) => {
    if (!snap.exists()) { emitGone(); return; } // node deleted under a still-open listen
    meta.ownerId = snap.val();
    emit();
  }, emitGone);
  return () => { unName(); unOwner(); };
}
```

Note the one deliberate contract refinement: the callback can now fire more than once at attach (one tick per leaf) — `groupNav`'s handler is idempotent (`renderNavRow` + map assignment) and `groupContext`'s re-wires idempotently; the old code also re-fired on every root change, so consumers already tolerate repeats.

- [ ] **Step 5: Run the new test, the consumer suites, and typecheck**

Run: `npx jest tests/watchGroupMeta.test.js tests/groupNav.test.js tests/groupContext.test.js --maxWorkers=2` → PASS.
Run: `npm run typecheck && npm run typecheck:scripts` → clean.

- [ ] **Step 6: Full web suite gate + commit**

Run: `npx jest --maxWorkers=2` → green.

```bash
git add js/db/groups.ts tests/watchGroupMeta.test.js
git commit -m "perf(groups): watch meta as name+ownerId leaves, not the group root

Audit F3: one permanent whole-node listen per enumerated group shipped the
full members/ subtree (incl. hot statusOverride) and invites/ to every
member's nav — every swatch tap woke every member's meta callback, and every
boot downloaded G rosters. Consumers only use name and ownerId; watch those
leaves. The membership-gated ownerId listen's cancel preserves the exact
'gone for me' (delete/kick) semantics of the old root-listen cancel; the
auth-readable name leaf just delivers renames. No rules change — read
grants cascade down."
```

---

### Task 2: Boot reads only `currentContext`, not the whole prefs node (F6a)

**Files:**
- Modify: `js/db/social.ts` (add `getCurrentContextPref`; keep `getUserPrefs` for other callers if any — verify)
- Modify: `js/app.ts:831` (the returning-user prefetch)
- Test: `tests/` — the suite covering the boot prefetch (locate with `grep -rln "getUserPrefs" tests/`)

**Interfaces:**
- Produces: `getCurrentContextPref(userId: string): Promise<string | null>` in `js/db/social.ts`, exported through the `js/db.ts` barrel.

- [ ] **Step 1: Verify the boot read's only consumer**

Run: `grep -rn "getUserPrefs" js/ --include="*.ts"`
Expected: `js/app.ts:831` is the only call site (the watch path uses `watchUserPrefs`). If others exist, leave `getUserPrefs` in place; this task only rewires the boot site.

- [ ] **Step 2: Write the failing test**

In the suite located above (or a new `tests/bootPrefs.test.js` if none mocks this path), assert the boot prefetch reads the leaf:

```js
test('returning-user boot resolves currentContext from the leaf, not the whole prefs node (audit F6)', async () => {
  // Using the suite's existing db-barrel mock:
  db.getCurrentContextPref.mockResolvedValue('group:G1');
  // ...drive the boot path the suite already drives...
  expect(db.getCurrentContextPref).toHaveBeenCalledWith('me');
  expect(db.getUserPrefs).not.toHaveBeenCalled();
});
```

(Bind to the harness that file already uses to drive `resolveEntryContext`/boot; the assertions are the contract.)

- [ ] **Step 3: Implement**

In `js/db/social.ts`, next to `getUserPrefs`:

```ts
// Boot-time leaf read: the prefetch only needs currentContext, and the full
// node carries pushTokens/following/perGroup — the whole-subtree get doubled
// the boot download that watchUserPrefs performs seconds later (audit F6).
export async function getCurrentContextPref(userId: string): Promise<string | null> {
  const snap = await get(ref(db, `userPrefs/${userId}/currentContext`));
  return snap.exists() ? (snap.val() as string) : null;
}
```

Export it through `js/db.ts` alongside `getUserPrefs`. In `js/app.ts`, replace the prefetch:

```ts
      const cc = await getCurrentContextPref(userId);
      if (typeof cc === 'string' && cc.startsWith('group:')) {
```

(delete the `prefsSnap` line; update the import). Keep the surrounding comment, amended: "currentContext leaf only — the full node is downloaded once, by watchUserPrefs (Stage 4)."

- [ ] **Step 4: Run suites + typecheck + commit**

Run: `npx jest --maxWorkers=2` and `npm run typecheck && npm run typecheck:scripts` → green/clean.

```bash
git add js/db/social.ts js/db.ts js/app.ts tests/
git commit -m "perf(boot): read currentContext leaf instead of the whole prefs node

Audit F6: the returning-user prefetch downloaded the full userPrefs subtree
(pushTokens with UA strings, following, perGroup palette state) to extract
one string, then watchUserPrefs re-downloaded it all seconds later. Leaf
read replaces the node read; the watch remains the single full download."
```

---

### Task 3: Move `pushTokens` out of the watched prefs node (F6c)

**Files:**
- Modify: `database.rules.json` (new top-level `pushTokens` path)
- Modify: `js/prefs.ts:304-344` (`addPushToken`, `touchPushToken`, `cullStalePushTokens`, `removePushToken`)
- Modify: `js/db/social.ts:192-194` (`readPushTokens`) + new write helpers; `js/db.ts` barrel
- Modify: `functions/notifier.js:54, 96` (`sendToUser` token read + failed-token prune)
- Create: `functions/migrate-push-tokens.js` (operator-run one-shot)
- Test: `tests/rules/` (new), `tests/prefs.test.js`, `functions/test/notifier.test.js`

**Interfaces:**
- New RTDB path: `pushTokens/{uid}/{token} = { createdAt, lastSeen, ua }` — owner read/write, invisible to the `userPrefs` watch.
- New client helpers in `js/db/social.ts`: `writePushToken(uid, token, record)`, `touchPushTokenDb(uid, token, now)`, `removePushTokenDb(uid, token)`, `readPushTokens(uid)` re-pointed to the new path.
- `sendToUser` dual-reads: new path first, legacy `userPrefs/{uid}/pushTokens` fallback until migration completes (removal of the fallback is a follow-up commit after the operator confirms migration).

- [ ] **Step 1: Write the failing rules tests**

Add to a new `tests/rules/pushTokens.test.js` (mirror the harness style of the existing `tests/rules/*.test.js` suites):

```js
test('owner can write and read their own pushTokens node', async () => {
  await assertSucceeds(setAs('alice', 'pushTokens/alice/tok1', { createdAt: 1, lastSeen: 1, ua: 'UA' }));
  await assertSucceeds(getAs('alice', 'pushTokens/alice'));
});
test('non-owner can neither read nor write another user\'s pushTokens', async () => {
  await assertFails(setAs('bob', 'pushTokens/alice/tok2', { createdAt: 1, lastSeen: 1, ua: 'x' }));
  await assertFails(getAs('bob', 'pushTokens/alice'));
});
```

- [ ] **Step 2: Add the rules**

In `database.rules.json`, add above `"notifierState"` (top-level; the `$other` deny stays last):

```json
    "pushTokens": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && auth.uid === $uid",
        "$token": {
          ".validate": "newData.hasChildren(['createdAt', 'lastSeen'])",
          "createdAt": { ".validate": "newData.isNumber()" },
          "lastSeen": { ".validate": "newData.isNumber()" },
          "ua": { ".validate": "newData.isString() && newData.val().length <= 512" },
          "$other": { ".validate": false }
        }
      }
    },
```

Run: `npm run test:rules` → the new tests pass; all 106 existing pass (nothing else touched).

- [ ] **Step 3: Client write/read paths**

In `js/db/social.ts` (replace `readPushTokens`' path and add writers):

```ts
// FCM push-token registry, relocated to a TOP-LEVEL node (audit F6): the
// records embed navigator.userAgent and live outside userPrefs so the
// wholesale prefs watch stops downloading them every boot and re-delivering
// them on every prefs echo. Owner-only; the notifier reads it server-side.
export async function readPushTokens(userId: string): Promise<Record<string, { createdAt?: number; lastSeen?: number } | null> | null> {
  const snap = await get(ref(db, `pushTokens/${userId}`));
  return snap.exists() ? snap.val() : null;
}
export async function writePushToken(userId: string, token: string, record: { createdAt: number; lastSeen: number; ua: string }): Promise<void> {
  await set(ref(db, `pushTokens/${userId}/${token}`), record);
}
export async function touchPushTokenDb(userId: string, token: string, now: number): Promise<void> {
  await update(ref(db, `pushTokens/${userId}/${token}`), { lastSeen: now });
}
export async function removePushTokenDb(userId: string, token: string): Promise<void> {
  await set(ref(db, `pushTokens/${userId}/${token}`), null);
}
```

Export all through `js/db.ts`. In `js/prefs.ts` rewire the four functions to the new helpers (drop their `mergeUserPrefs` pushToken writes; `cullStalePushTokens`'s bulk delete becomes one `update(ref(db, 'pushTokens/${uid}'), nulls)`-shaped helper or per-token `removePushTokenDb` — prefer a `removePushTokens(uid, tokens[])` multi-null helper, same one-op shape as today). Update `tests/prefs.test.js` mocks accordingly (the db barrel mock gains the new fns).

- [ ] **Step 4: Functions dual-read + prune**

In `functions/notifier.js` `sendToUser`, replace the tokens read (`:54`) with a dual-read that prefers the new path:

```js
  const tokensPromise = deps.getVal(`pushTokens/${uid}`)
    .then((v) => v ?? deps.getVal(`userPrefs/${uid}/pushTokens`)); // legacy fallback until migration completes
  tokensPromise.catch(() => {});
```

and point the failed-token prune (`:96`) at `pushTokens/${uid}` (legacy copies are removed by the migration, not the prune). Extend `functions/test/notifier.test.js`: a token under the new path is used; a legacy-only user still receives (fallback); prune writes to the new path.

- [ ] **Step 5: Migration script**

Create `functions/migrate-push-tokens.js` modeled on `functions/repair-user-groups.js` (read all `userPrefs`, build ONE multi-path update moving each user's `pushTokens` subtree to `pushTokens/{uid}` and nulling the old location, print a dry-run summary unless `--apply`). Batched single `update` — not per-user writes.

- [ ] **Step 6: Full gates + commit (deploy ordering in body)**

All four gates green, then:

```bash
git add database.rules.json js/prefs.ts js/db/social.ts js/db.ts functions/notifier.js functions/migrate-push-tokens.js tests/
git commit -m "perf(prefs): relocate pushTokens to a top-level owner-only node

Audit F6: token records (each embedding navigator.userAgent) lived inside
the wholesale-watched userPrefs node — downloaded every boot and re-delivered
on every prefs echo, while their only reader is the server-side notifier and
the one-shot cull. New top-level pushTokens/{uid} path (owner read/write);
client writers re-pointed; sendToUser dual-reads new-then-legacy until the
one-shot migration script moves existing records.

DEPLOY ORDER (load-bearing): 1) rules (new path writable), 2) functions
(dual-read), 3) hosting (clients write new path), 4) run
migrate-push-tokens --apply, 5) later cleanup commit drops the legacy
fallback read."
```

---

### Task 4: Diff-gate the remaining prefs sync events (F6b)

**Files:**
- Modify: `js/prefs.ts` `syncFromServer` — the `favorites` branch (`:444-482`) and the `notify` branch (`:517-526`)
- Test: `tests/prefs.test.js`

**Interfaces:** none new — `favorites-synced` / `notify-prefs-synced` now fire only when the persisted value actually changed. (The `location` branch is handled in the branch-introduced plan, Task 4; `current-context-synced` and the per-group events already carry change semantics their consumers rely on — out of scope.)

- [ ] **Step 1: Write the failing tests**

Append to `tests/prefs.test.js`:

```js
test('favorites-synced fires only when the merged list actually changed (audit F6)', () => {
  const seen = jest.fn();
  document.addEventListener('favorites-synced', seen);
  syncFromServer({ favorites: [{ statusColor: 'green', surface2: 'a' }] });
  expect(seen).toHaveBeenCalledTimes(1);
  syncFromServer({ favorites: [{ statusColor: 'green', surface2: 'a' }] }); // identical echo
  expect(seen).toHaveBeenCalledTimes(1);
  syncFromServer({ favorites: [{ statusColor: 'red', surface2: 'a' }] });
  expect(seen).toHaveBeenCalledTimes(2);
  document.removeEventListener('favorites-synced', seen);
});

test('notify-prefs-synced fires only when a per-person pref actually changed', () => {
  const seen = jest.fn();
  document.addEventListener('notify-prefs-synced', seen);
  syncFromServer({ notify: { u1: { knock: true, call: false, availability: false } } });
  expect(seen).toHaveBeenCalledTimes(1);
  syncFromServer({ notify: { u1: { knock: true, call: false, availability: false } } });
  expect(seen).toHaveBeenCalledTimes(1);
  syncFromServer({ notify: { u1: { knock: false, call: false, availability: false } } });
  expect(seen).toHaveBeenCalledTimes(2);
  document.removeEventListener('notify-prefs-synced', seen);
});
```

- [ ] **Step 2: Implement**

Favorites branch — compare the computed `merged` against the current store before dispatching (the merge logic is untouched):

```ts
    const merged = [...pendingHead, ...serverDeduped].slice(0, 8);
    const unchanged = JSON.stringify(merged) === JSON.stringify(local);
    storeSetFavorites(merged);
    // Dispatch only on real change: syncFromServer runs on every prefs echo
    // (each group swatch tap), and favorites exist forever once created — the
    // unconditional dispatch rebuilt both strip containers per echo (audit F6).
    if (!unchanged) document.dispatchEvent(new CustomEvent('favorites-synced'));
```

(`local` is the `storeGetFavorites()` array already read by the merge; array-of-small-objects stringify is the established comparison idiom in this codebase — `js/following.ts:1029`.)

Notify branch — same shape:

```ts
  if (serverPrefs.notify && typeof serverPrefs.notify === 'object') {
    const map = readNotifyCache();
    let changed = false;
    for (const [targetUid, prefs] of Object.entries(serverPrefs.notify)) {
      const next = { knock: !!prefs?.knock, call: !!prefs?.call, availability: !!prefs?.availability };
      const cur = map[targetUid];
      if (!cur || cur.knock !== next.knock || cur.call !== next.call || cur.availability !== next.availability) changed = true;
      map[targetUid] = next;
    }
    writeNotifyCache(map);
    if (changed) document.dispatchEvent(new CustomEvent('notify-prefs-synced'));
  }
```

- [ ] **Step 3: Run + typecheck + commit**

Run: `npx jest tests/prefs.test.js tests/favorites.test.js --maxWorkers=2` → PASS (if a favorites test pinned the unconditional dispatch, invert with rationale). Typechecks clean.

```bash
git add js/prefs.ts tests/prefs.test.js
git commit -m "perf(prefs): dispatch favorites/notify sync events only on real change

Audit F6: both events fired on every userPrefs echo once their node existed,
rebuilding the favorites strips (and notify consumers) per unrelated prefs
write. Compare against the local cache before dispatching."
```

---

### Task 5: Parallelize the directed notifier handlers (F8)

**Files:**
- Modify: `functions/notifier.js` — `resolveName` (`:107`), `resolveGroupMemberName` (`:120`), `handleKnock` (`:134`), `handleInvite` (`:165`), `handleFollowRequest` (`:190`), `handleCall` (`:282`)
- Test: `functions/test/notifier.test.js`

**Interfaces:** no export changes. Gate semantics preserved exactly: an opted-out knock/call recipient still costs only the prefs+cooldown reads (those two parallelize with each other, nothing else); a cooled-down event does no name/group reads. Trade accepted and documented: the name resolvers now read the code fallback in parallel with the label (one extra tiny read when the label exists) — halving their latency on the miss path.

- [ ] **Step 1: Write the failing behavior-shape test**

Append to `functions/test/notifier.test.js` (using that file's deps fixture):

```js
test('opted-out knock still reads only prefs + cooldown (audit F8 gate preservation)', async () => {
  const reads = [];
  const deps = mkDeps({ getVal: (p) => { reads.push(p); return Promise.resolve(null); } }); // null prefs → not opted in
  await handleKnock(deps, 'r1', 's1', {});
  expect(reads.sort()).toEqual([
    'notifierState/knockCooldown/r1/s1',
    'userPrefs/r1/notify/s1',
  ]);
  expect(deps.send).not.toHaveBeenCalled();
});
```

(Adapt `mkDeps` to the fixture's actual constructor; the read-set assertion is the contract — prefs AND cooldown may both be read (parallel phase), but nothing else.)

- [ ] **Step 2: Implement — two-phase handlers**

`handleKnock`:

```js
export async function handleKnock(deps, recipientId, senderId, record) {
  const now = deps.now();
  // Phase 1 — the two gates, in parallel (they were sequential; both are
  // always needed unless the FIRST fails, and the cooldown read is tiny).
  const [prefs, cooldown] = await Promise.all([
    deps.getVal(`userPrefs/${recipientId}/notify/${senderId}`),
    deps.getVal(`notifierState/knockCooldown/${recipientId}/${senderId}`),
  ]);
  if (!wantsKnock(prefs)) return;
  if (withinCooldown(cooldown, now, KNOCK_COOLDOWN_MS)) return;
  const groupId = record && record.contextGroupId;
  if (groupId) {
    // Phase 2 — name + group name in parallel.
    const [name, group] = await Promise.all([
      resolveGroupMemberName(deps, groupId, senderId),
      deps.getVal(`groups/${groupId}/name`),
    ]);
    await sendToUser(deps, recipientId,
      buildMessage('knock', name, { group: group || undefined }),
      { type: 'knock', targetUid: senderId, contextGroupId: groupId });
  } else {
    const name = await resolveName(deps, recipientId, senderId);
    await sendToUser(deps, recipientId, buildMessage('knock', name),
      { type: 'knock', targetUid: senderId });
  }
  await deps.update(`notifierState/knockCooldown/${recipientId}`, { [senderId]: now });
}
```

`handleCall` — same phase-1 shape (`wantsCall` + `callCooldown`), then `resolveName` → send → cooldown write.

`resolveName` and `resolveGroupMemberName` — parallelize the fallback read (one extra tiny read when the primary hits, ~half the latency when it misses):

```js
export async function resolveName(deps, viewerUid, targetUid) {
  const [follow, code] = await Promise.all([
    deps.getVal(`userPrefs/${viewerUid}/following/${targetUid}`),
    deps.getVal(`users/${targetUid}/presence/code`),
  ]);
  if (follow && follow.label) return follow.label;
  if (code) return `Your contact ${code}`; // B#10: a bare code reads like a glitch in chat
  return 'Someone';
}

export async function resolveGroupMemberName(deps, groupId, uid) {
  const [displayName, code] = await Promise.all([
    deps.getVal(`groups/${groupId}/members/${uid}/displayName`),
    deps.getVal(`users/${uid}/presence/code`),
  ]);
  if (displayName) return displayName;
  if (code) return code;
  return 'Someone';
}
```

`handleInvite` — cooldown + follow-label + group name in one phase (all three always needed unless cooled; the cooled case pays two wasted tiny reads, accepted for ~3× fewer round-trips on the common path):

```js
export async function handleInvite(deps, inviteeUid, groupId, record) {
  if (!record || !record.from) return;
  const now = deps.now();
  const [cooldown, follow, group] = await Promise.all([
    deps.getVal(`notifierState/inviteCooldown/${inviteeUid}/${record.from}`),
    deps.getVal(`userPrefs/${inviteeUid}/following/${record.from}`),
    deps.getVal(`groups/${groupId}/name`),
  ]);
  if (withinCooldown(cooldown, now, INVITE_COOLDOWN_MS)) return;
  const name = (follow && follow.label) || await resolveGroupMemberName(deps, groupId, record.from);
  await sendToUser(deps, inviteeUid,
    buildMessage('invite', name, { group: group || undefined }),
    { type: 'invite', targetUid: record.from, groupId });
  await deps.update(`notifierState/inviteCooldown/${inviteeUid}`, { [record.from]: now });
}
```

`handleFollowRequest` — identical shape (`followReqCooldown`, `following/{requester}`, conditional `groups/{record.groupId}/name` inside the `Promise.all` as `record.groupId ? deps.getVal(...) : Promise.resolve(null)`).

- [ ] **Step 3: Run the functions suite**

Run: `cd functions && npm test` (then `cd /home/user/on`)
Expected: PASS. Existing tests assert values/paths, not read ordering; any test that pinned strict sequential read order should be adjusted to assert the read SET (adjustment, not weakening — the set is unchanged for gated exits, documented in the commit).

- [ ] **Step 4: Commit**

```bash
git add functions/notifier.js functions/test/notifier.test.js
git commit -m "perf(notifier): parallel read phases in the directed handlers

Audit F8: knock/call/invite/follow-request handlers awaited 5-8 independent
reads sequentially — the full chain is billed function wall-clock on the
highest-frequency user-visible events. Two-phase shape: gates in parallel,
then names/group-name in parallel; resolveName/resolveGroupMemberName fetch
their fallback concurrently. Gate semantics preserved: opted-out recipients
still cost only the prefs+cooldown reads; cooled events do no name reads
(invite/follow-request accept two wasted tiny reads on the rare cooled path
for ~3x fewer round-trips on the common one)."
```

---

## Final gate (after all tasks)

- [ ] `npx jest --maxWorkers=2` green (root) · `cd functions && npm test` green (then back to root) · `npm run test:rules` green (Task 3 adds ~2) · `npm run typecheck && npm run typecheck:scripts` clean
- [ ] Task 3's deploy-ordering note is in its commit body; the legacy-fallback removal is logged as a follow-up, NOT included here
- [ ] Whole-branch review per superpowers:requesting-code-review before handoff

## Self-review notes

- **Coverage:** F3→Task 1, F6→Tasks 2/3/4, F8→Task 5. F6's `watchFollowing` child-listen overlap is deliberately untouched: it is wire-coalesced by the SDK under the parent watch, and after Task 3 the parent node is small — remaining cost is negligible.
- **Sequencing:** Tasks are independent except that Task 3 should land before any future decision to split `watchUserPrefs` (it removes the main reason to split). Task 1 is the highest-leverage single change in this plan.
- **Risk ledger:** Task 1 changes attach-time callback cardinality (one per leaf tick) — consumers verified idempotent. Task 3 has a real deploy-ordering dependency and a migration; do not fold its steps into other commits. Task 5 trades a few wasted tiny reads on gated exits for latency — quantified in the commit message.
