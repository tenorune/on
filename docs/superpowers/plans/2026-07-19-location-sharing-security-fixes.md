# Location-Sharing Security Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three security-review findings on the location-sharing branch — the forgeable precise-location reciprocity gate (HIGH), the self-join coarse-cell read (MEDIUM, option A), and the un-enforced cell revocation on membership loss (LOW).

**Architecture:** Findings 1 and the member-rule half of Finding 2 are RTDB-rules tightenings tested with the emulator. Finding 2's join brokering and Finding 3's revocation are Cloud Functions using the repo's deps-injected handler pattern (a pure handler + a thin `httpsOnCall`/trigger registration that supplies Admin-SDK deps), so handlers are unit-tested with mock deps. The client's group-join path is rewired to call the new callable instead of writing the member node directly.

**Tech Stack:** Firebase RTDB security rules; Firebase Cloud Functions v2 (ESM, `firebase-functions/v2`); vanilla TypeScript client (`js/`, strict `checkJs`); Jest (web at repo root, functions under `functions/`); `@firebase/rules-unit-testing` emulator suite.

## Global Constraints

- Design source of truth: `docs/superpowers/specs/2026-07-19-location-sharing-security-fixes.md`. Fix 2 is locked to **option A** (CF-brokered join).
- Work stays on branch `claude/knockknock-feature-dev-9a3ysy`. No merges to `dev`/`main`, no PRs unless asked.
- Zero TS suppressions (`@ts-ignore` / `@ts-expect-error` / `as any`). `npm run typecheck && npm run typecheck:scripts` must stay green.
- TDD: write the failing test, watch it fail, then implement. Trust a red rules test over a "simplification."
- `shared/geo.js` is untouched here; if any `shared/` code changes, run `npm run sync-shared` (never hand-edit `functions/_shared/`). Not expected in this plan.
- Commands (all from repo root; **`cd` back to repo root** after any `cd functions`):
  - Web tests: `npx jest --maxWorkers=2`
  - Functions tests: `cd functions && npm test` (then `cd /home/user/on`)
  - Rules tests: `npm run test:rules`
  - Typecheck: `npm run typecheck && npm run typecheck:scripts`
- Green bar before handoff: all four of the above. Never hand off red.
- Do not commit/push unprompted mid-turn; the stop-hook at turn end is the standing commit+push prompt. (Each task below ends with a commit step — stage it; the operator triggers the push.)
- **Deploy ordering (record in commit bodies, do not deploy from here):** Fix 1 is rules-only. Fix 3 is Functions-only. Fix 2 needs the callable deployed **before or with** the member-rule tighten, or in-flight joins break.

---

### Task 1: Fix 1 — precise-location gate (narrow forgeable follower writes)

Blocks the target (`$uid`) from *fabricating* inbound follower edges while preserving the follower's own writes and the target's ability to *remove* a follower. This alone closes the HIGH precise-GPS read; the bot mirror reads the same edges, so it becomes sound with no bot code change — a regression test pins that.

**Files:**
- Modify: `database.rules.json` — `users/$uid/followers/$follower` `.write` (line 34); `users/$uid/followerNames/$follower` `.write` (line 40)
- Test: `tests/rules/locations.test.js` (add a `describe('users/{uid}/followers — forgery guard')` block)
- Test: `functions/test/telegram.test.js` (add a precise-tier reciprocity case)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing rules tests**

Add to `tests/rules/locations.test.js`:

```js
describe('users/{uid}/followers — forgery guard (Fix 1)', () => {
  test('target CANNOT fabricate an inbound follower edge (create as $uid)', async () => {
    // mallory tries to claim "victim follows me" by writing into her OWN list.
    await assertFails(dbAs(env, 'mallory').ref('users/mallory/followers/victim').set('VICCOD'));
  });

  test('follower CAN still self-register (create as $follower)', async () => {
    await assertSucceeds(dbAs(env, 'mallory').ref('users/victim/followers/mallory').set('MALCOD'));
  });

  test('target CAN still remove a follower (delete as $uid)', async () => {
    await seed(env, async (db) => { await db.ref('users/victim/followers/mallory').set('MALCOD'); });
    await assertSucceeds(dbAs(env, 'victim').ref('users/victim/followers/mallory').remove());
  });

  test('forged-edge read exploit is blocked end-to-end', async () => {
    // mallory follows victim (legit, self as $follower) + publishes own node,
    // but CANNOT forge "victim follows mallory", so the mutual gate fails.
    await seed(env, async (db) => {
      await db.ref('users/victim/followers/mallory').set('MALCOD'); // mallory→victim
      await db.ref('locations/victim').set(LOC);
      await db.ref('locations/mallory').set(LOC);
    });
    await assertFails(dbAs(env, 'mallory').ref('users/mallory/followers/victim').set('VICCOD'));
    await assertFails(dbAs(env, 'mallory').ref('locations/victim').get());
  });

  test('followerNames: target cannot fabricate an inbound name either', async () => {
    await assertFails(dbAs(env, 'mallory').ref('users/mallory/followerNames/victim').set('Victim'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:rules`
Expected: the new `forgery guard` tests FAIL (current rule allows `auth.uid === $uid` to create).

- [ ] **Step 3: Narrow the two write rules**

In `database.rules.json`, `users/$uid/followers/$follower` `.write` (line 34):

```diff
-            ".write": "auth != null && (auth.uid === $follower || auth.uid === $uid)",
+            ".write": "auth != null && (auth.uid === $follower || (auth.uid === $uid && !newData.exists()))",
```

`users/$uid/followerNames/$follower` `.write` (line 40):

```diff
-            ".write": "auth != null && (auth.uid === $follower || auth.uid === $uid)",
+            ".write": "auth != null && (auth.uid === $follower || (auth.uid === $uid && !newData.exists()))",
```

- [ ] **Step 4: Run the rules tests to verify they pass**

Run: `npm run test:rules`
Expected: PASS — the new guard tests plus all pre-existing `locations/` and `locationCells/` cases (86+ tests).

- [ ] **Step 5: Add + run the bot-mirror regression test**

Add to `functions/test/telegram.test.js`, inside the existing `/who`-precise describe (mirror its `deps`/`getVal` mock shape — reuse the file's existing helpers; assert the precise distance is withheld when only one follower edge exists):

```js
test('precise tier withheld when reciprocity is one-way (no forged edge)', async () => {
  // requester uid follows target mid, but mid does NOT follow uid back.
  const deps = makeWhoDeps({
    'locations/mid': { lat: 52.52, lng: 13.40, updatedAt: 1 },
    'locations/uid': { lat: 52.53, lng: 13.41, updatedAt: 1 },
    'users/mid/followers/uid': 'UIDCOD',   // uid → mid
    // 'users/uid/followers/mid' absent → mid → uid missing
  });
  const out = await renderWhoPrecise(deps, 'uid', 'mid'); // use the file's existing call shape
  expect(out).not.toMatch(/meters away|km away/);
});
```

> If `functions/test/telegram.test.js` already has an equivalent one-way case, skip this step and note it in the commit. Match the file's actual helper names (`makeWhoDeps`/`renderWhoPrecise` are placeholders for whatever it uses).

Run: `cd functions && npm test && cd /home/user/on`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck && npm run typecheck:scripts`
Expected: PASS.

```bash
git add database.rules.json tests/rules/locations.test.js functions/test/telegram.test.js
git commit -m "fix(rules): block target-side fabrication of follower edges (Fix 1)

Narrows users/*/followers/\$follower and followerNames/\$follower .write so
the node owner (\$uid) can only DELETE, not CREATE, inbound edges. Closes the
forgeable precise-location reciprocity gate — an attacker can no longer forge
'victim follows me' to satisfy the mutual-follow read on locations/{victim}.
Bot mirror reads the same edges, so it is sound with no code change (pinned by
a one-way reciprocity test). Rules-only deploy."
```

---

### Task 2: Fix 3 — revoke coarse cell on membership loss

Server-authoritative backstop: whenever a `groups/{gid}/members/{uid}` node is deleted, delete `locationCells/{gid}/{uid}`. Independent of which client path removed the member, so an orphaned readable cell can't outlive membership.

**Files:**
- Create: `functions/group-cleanup.js` (pure handler)
- Modify: `functions/index.js` — import + register trigger (near `onMemberOverride`, line 138)
- Test: `functions/test/group-cleanup.test.js`

**Interfaces:**
- Consumes: the `makeDbDeps()` adapter (`functions/index.js:52`) providing `set(path, value)`.
- Produces: `handleMemberRemoved(deps, groupId, memberUid, beforeVal, afterVal): Promise<void>` — deletes the cell only on a true deletion (before existed, after null).

- [ ] **Step 1: Write the failing handler test**

Create `functions/test/group-cleanup.test.js`:

```js
import { jest } from '@jest/globals';
import { handleMemberRemoved } from '../group-cleanup.js';

describe('handleMemberRemoved', () => {
  const mkDeps = () => ({ set: jest.fn(() => Promise.resolve()) });

  test('deletes the member cell on a real removal (before set, after null)', async () => {
    const deps = mkDeps();
    await handleMemberRemoved(deps, 'G1', 'bob', { role: 'member' }, null);
    expect(deps.set).toHaveBeenCalledWith('locationCells/G1/bob', null);
  });

  test('no-op when this is not a deletion (after still present)', async () => {
    const deps = mkDeps();
    await handleMemberRemoved(deps, 'G1', 'bob', { role: 'member' }, { role: 'admin' });
    expect(deps.set).not.toHaveBeenCalled();
  });

  test('no-op when there was no member before (spurious create/no-op)', async () => {
    const deps = mkDeps();
    await handleMemberRemoved(deps, 'G1', 'bob', null, null);
    expect(deps.set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd functions && npm test -- group-cleanup && cd /home/user/on`
Expected: FAIL — `Cannot find module '../group-cleanup.js'`.

- [ ] **Step 3: Write the handler**

Create `functions/group-cleanup.js`:

```js
// functions/group-cleanup.js
// When a group membership is removed, delete the departed member's coarse
// location cell so it can't outlive membership (readable by remaining members).
// Pure handler: deps.set(path, value) injected for testability.
/**
 * @param {{ set: (path: string, value: unknown) => Promise<void> }} deps
 * @param {string} groupId
 * @param {string} memberUid
 * @param {unknown} beforeVal  member node before the write (null if absent)
 * @param {unknown} afterVal   member node after the write (null on delete)
 */
export async function handleMemberRemoved(deps, groupId, memberUid, beforeVal, afterVal) {
  // Only act on a genuine deletion: the member existed and is now gone.
  if (beforeVal == null || afterVal != null) return;
  await deps.set(`locationCells/${groupId}/${memberUid}`, null);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd functions && npm test -- group-cleanup && cd /home/user/on`
Expected: PASS (3 tests).

- [ ] **Step 5: Register the trigger**

In `functions/index.js`, add the import near the other handler imports (top, after line 11):

```js
import { handleMemberRemoved } from './group-cleanup.js';
```

Register the trigger just after `onMemberOverride` (line 138 block). `onValueWritten` fires on create/update/delete; the handler filters to deletions:

```js
// A group membership node was written. On DELETION (leave / kick / group
// teardown), revoke the departed member's coarse location cell so it can't
// outlive membership. Handler no-ops on create/update.
export const onMemberRemoved = onValueWritten('/groups/{groupId}/members/{memberUid}', (event) => {
  return handleMemberRemoved(
    makeDbDeps(),
    event.params.groupId,
    event.params.memberUid,
    event.data.before.val(),
    event.data.after.val(),
  );
});
```

- [ ] **Step 6: Run the full functions suite + typecheck**

Run: `cd functions && npm test && cd /home/user/on`
Expected: PASS (all functions tests, including the new file).
Run: `npm run typecheck && npm run typecheck:scripts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/group-cleanup.js functions/index.js functions/test/group-cleanup.test.js
git commit -m "feat(functions): revoke coarse cell on group membership removal (Fix 3)

New onMemberRemoved trigger on /groups/{gid}/members/{uid}: on deletion it
deletes locationCells/{gid}/{uid} via the Admin SDK, so an orphaned readable
cell can't outlive membership regardless of which client path removed the
member. Handler no-ops on create/update. Functions-only deploy."
```

---

### Task 3: Fix 2a — `joinGroup` callable handler (server-authoritative join)

The authoritative half of option A: a pure handler that validates a join entitlement (a live invite token **or** a pending invite for the caller) and, via Admin-SDK deps, writes the member node and bumps redemptions. No rules change here; the client still writes members until Task 5 tightens the rule, so the repo stays green at each task boundary.

**Files:**
- Create: `functions/group-join.js` (pure handler)
- Test: `functions/test/group-join.test.js`

**Interfaces:**
- Consumes: nothing from other tasks (deps are injected; real deps wired in Task 4).
- Produces: `joinGroupHandler(request, deps)` where
  - `request = { auth?: { uid: string }, data: { groupId: string, displayName: string, token?: string } }`
  - `deps = { now(): number, getVal(path): Promise<any>, set(path, value): Promise<void>, transaction(path, fn): Promise<{committed: boolean}> }` (the `makeDbDeps()` quintet)
  - returns `{ ok: true, groupId, alreadyMember?: boolean } | { ok: false, reason: 'unauthenticated'|'invalid-argument'|'not-found'|'revoked'|'expired'|'cap'|'no-entitlement' }`
  - side effects on success (fresh member): writes `groups/{groupId}/members/{uid}` with `{ role:'member', displayName, joinedAt, statusOverride:{ enabled:true, status:'available', availableUntil: now + 7200000 } }`; on the token path bumps `groups/{groupId}/invites/{token}/redemptionsUsed`.

- [ ] **Step 1: Write the failing handler tests**

Create `functions/test/group-join.test.js`:

```js
import { jest } from '@jest/globals';
import { joinGroupHandler } from '../group-join.js';

const NOW = 1_752_800_000_000;
const mkReq = (data, uid = 'joiner') => ({ auth: uid ? { uid } : undefined, data });

function mkDeps(map) {
  const store = { ...map };
  return {
    now: () => NOW,
    getVal: jest.fn((path) => Promise.resolve(store[path] ?? null)),
    set: jest.fn((path, value) => { store[path] = value; return Promise.resolve(); }),
    transaction: jest.fn((path, fn) => {
      store[path] = fn(store[path] ?? null);
      return Promise.resolve({ committed: true });
    }),
    _store: store,
  };
}

describe('joinGroupHandler', () => {
  test('rejects unauthenticated', async () => {
    const deps = mkDeps({});
    const res = await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }, null), deps);
    expect(res).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(deps.set).not.toHaveBeenCalled();
  });

  test('rejects a missing groupId / displayName', async () => {
    const deps = mkDeps({});
    expect((await joinGroupHandler(mkReq({ displayName: 'Jo', token: 'T' }), deps)).reason).toBe('invalid-argument');
    expect((await joinGroupHandler(mkReq({ groupId: 'G1', token: 'T' }), deps)).reason).toBe('invalid-argument');
  });

  test('token path: valid non-revoked token → writes member + bumps redemptions', async () => {
    const deps = mkDeps({
      'groups/G1/name': 'Family',
      'groups/G1/invites/T': { revoked: false, redemptionsUsed: 2, redemptionCap: 10 },
    });
    const res = await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }), deps);
    expect(res).toEqual({ ok: true, groupId: 'G1' });
    expect(deps._store['groups/G1/members/joiner']).toMatchObject({
      role: 'member', displayName: 'Jo', joinedAt: NOW,
      statusOverride: { enabled: true, status: 'available', availableUntil: NOW + 7200000 },
    });
    expect(deps._store['groups/G1/invites/T'].redemptionsUsed).toBe(3);
  });

  test('token path: revoked / expired / cap-exhausted rejected without writing', async () => {
    const revoked = mkDeps({ 'groups/G1/name': 'F', 'groups/G1/invites/T': { revoked: true } });
    expect((await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }), revoked)).reason).toBe('revoked');
    const expired = mkDeps({ 'groups/G1/name': 'F', 'groups/G1/invites/T': { revoked: false, expiresAt: NOW - 1 } });
    expect((await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }), expired)).reason).toBe('expired');
    const capped = mkDeps({ 'groups/G1/name': 'F', 'groups/G1/invites/T': { revoked: false, redemptionsUsed: 5, redemptionCap: 5 } });
    expect((await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }), capped)).reason).toBe('cap');
    for (const d of [revoked, expired, capped]) expect(d.set).not.toHaveBeenCalled();
  });

  test('token path: unknown token / missing group → not-found', async () => {
    const noGroup = mkDeps({ 'groups/G1/invites/T': { revoked: false } }); // no name → group gone
    expect((await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }), noGroup)).reason).toBe('not-found');
    const noTok = mkDeps({ 'groups/G1/name': 'F' });
    expect((await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }), noTok)).reason).toBe('not-found');
  });

  test('pending-invite path (no token): caller with a pending invite → writes member, no redemption bump', async () => {
    const deps = mkDeps({
      'groups/G1/name': 'Family',
      'pendingInvites/joiner/G1': { from: 'owner', ts: 1 },
    });
    const res = await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo' }), deps);
    expect(res).toEqual({ ok: true, groupId: 'G1' });
    expect(deps._store['groups/G1/members/joiner']).toMatchObject({ role: 'member', displayName: 'Jo' });
    expect(deps.transaction).not.toHaveBeenCalled();
  });

  test('no token and no pending invite → no-entitlement (the #288 self-join, now blocked)', async () => {
    const deps = mkDeps({ 'groups/G1/name': 'Family' });
    const res = await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo' }), deps);
    expect(res).toEqual({ ok: false, reason: 'no-entitlement' });
    expect(deps.set).not.toHaveBeenCalled();
  });

  test('idempotent: already a member → ok with alreadyMember, no re-write', async () => {
    const deps = mkDeps({
      'groups/G1/name': 'Family',
      'groups/G1/invites/T': { revoked: false },
      'groups/G1/members/joiner': { role: 'member', displayName: 'Jo', joinedAt: 1 },
    });
    const res = await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'Jo', token: 'T' }), deps);
    expect(res).toEqual({ ok: true, groupId: 'G1', alreadyMember: true });
    expect(deps.set).not.toHaveBeenCalled();
  });

  test('rejects an over-long display name (server-authoritative validation)', async () => {
    const deps = mkDeps({ 'groups/G1/name': 'F', 'groups/G1/invites/T': { revoked: false } });
    const res = await joinGroupHandler(mkReq({ groupId: 'G1', displayName: 'x'.repeat(200), token: 'T' }), deps);
    expect(res.reason).toBe('invalid-argument');
    expect(deps.set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd functions && npm test -- group-join && cd /home/user/on`
Expected: FAIL — `Cannot find module '../group-join.js'`.

- [ ] **Step 3: Write the handler**

Create `functions/group-join.js`:

```js
// functions/group-join.js
// Server-authoritative group join (Fix 2, option A). The client no longer
// writes groups/{gid}/members/{uid} directly (the #288 self-join surface);
// it calls this callable, which validates a real entitlement — a live invite
// token OR a pending invite addressed to the caller — before writing the member
// node via the Admin SDK (deps.set, which bypasses rules). Mirrors the checks
// the client redeemGroupInvite/inbox-accept used to perform, now authoritative.
//
// Display-name cap mirrors userPrefs/groups member displayName usage (<= 64).
const MAX_DISPLAY_NAME = 64;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/**
 * @param {{ auth?: { uid: string }, data: { groupId?: unknown, displayName?: unknown, token?: unknown } }} request
 * @param {{ now: () => number, getVal: (p: string) => Promise<any>, set: (p: string, v: unknown) => Promise<void>, transaction: (p: string, fn: (c: any) => unknown) => Promise<{ committed: boolean }> }} deps
 */
export async function joinGroupHandler(request, deps) {
  const uid = request.auth?.uid;
  if (!uid) return { ok: false, reason: 'unauthenticated' };

  const { groupId, displayName, token } = request.data || {};
  if (typeof groupId !== 'string' || !groupId
    || typeof displayName !== 'string' || !displayName.trim()
    || displayName.length > MAX_DISPLAY_NAME) {
    return { ok: false, reason: 'invalid-argument' };
  }
  if (token !== undefined && typeof token !== 'string') {
    return { ok: false, reason: 'invalid-argument' };
  }

  // Group must exist (name leaf is the cheap existence probe the redeem flow uses).
  const name = await deps.getVal(`groups/${groupId}/name`);
  if (name == null) return { ok: false, reason: 'not-found' };

  // Validate entitlement.
  if (token) {
    const invite = await deps.getVal(`groups/${groupId}/invites/${token}`);
    if (!invite) return { ok: false, reason: 'not-found' };
    if (invite.revoked) return { ok: false, reason: 'revoked' };
    if (invite.expiresAt != null && invite.expiresAt < deps.now()) return { ok: false, reason: 'expired' };
    if (invite.redemptionCap != null && (invite.redemptionsUsed || 0) >= invite.redemptionCap) {
      return { ok: false, reason: 'cap' };
    }
  } else {
    const pending = await deps.getVal(`pendingInvites/${uid}/${groupId}`);
    if (!pending) return { ok: false, reason: 'no-entitlement' };
  }

  // Idempotent: an existing membership is a no-op (mirrors the client's
  // already-member guard; re-redeem must not reset role/joinedAt/override).
  const existing = await deps.getVal(`groups/${groupId}/members/${uid}`);
  if (existing) return { ok: true, groupId, alreadyMember: true };

  const now = deps.now();
  await deps.set(`groups/${groupId}/members/${uid}`, {
    role: 'member',
    displayName,
    joinedAt: now,
    statusOverride: { enabled: true, status: 'available', availableUntil: now + TWO_HOURS_MS },
  });

  // Token path: bump redemptions authoritatively (moved off the client).
  if (token) {
    await deps.transaction(`groups/${groupId}/invites/${token}/redemptionsUsed`, (c) => (c || 0) + 1);
  }

  return { ok: true, groupId };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd functions && npm test -- group-join && cd /home/user/on`
Expected: PASS (9 tests).

- [ ] **Step 5: Full functions suite + typecheck + commit**

Run: `cd functions && npm test && cd /home/user/on`
Expected: PASS.
Run: `npm run typecheck && npm run typecheck:scripts`
Expected: PASS.

```bash
git add functions/group-join.js functions/test/group-join.test.js
git commit -m "feat(functions): server-authoritative joinGroup handler (Fix 2a)

Pure handler validating a real join entitlement — a live invite token OR a
pending invite for the caller — before writing the member node via Admin SDK
and bumping redemptions. Re-implements the checks the client redeem flow did,
now authoritative. Not yet wired (Task 4) or enforced by rules (Task 5), so the
repo stays green: the client still writes members until the rule tightens."
```

---

### Task 4: Fix 2b — register the callable and rewire the client join path

Wire the callable into `functions/index.js`, add a client wrapper, and route the client's group-join through it instead of the direct member write. Both existing entry paths (link/token redeem and inbox pending-accept) funnel through the client `joinGroup`, so rewiring that one function covers both.

**Files:**
- Modify: `functions/index.js` — import + `export const joinGroup = httpsOnCall(...)` (near line 213)
- Modify: `js/firebase-config.ts` — `httpsCallable` wrapper `callJoinGroup`
- Modify: `js/groups.ts:115-152` — `joinGroup` calls the callable; drop the direct `writeMember`
- Modify: `js/invites.ts:458-461` — drop the now-redundant client `incrementGroupInviteRedemptions` (the callable bumps); pass `token` through to `joinGroup`
- Test: `tests/groupContext.test.js` or `tests/following.test.js` — whichever already exercises `joinGroup`/redeem (add the "routes through callable, no direct member write" assertion). If neither does, add `tests/group-join-client.test.js`.

**Interfaces:**
- Consumes: `joinGroupHandler` (Task 3) via the `joinGroup` callable; result shape `{ ok, groupId, alreadyMember?, reason? }`.
- Produces: client `joinGroup(groupId, joinerUid, displayNameRaw, opts)` unchanged in signature but now brokered; `opts` gains `token?: string` (the redeem path passes it; inbox-accept omits it).

- [ ] **Step 1: Register the callable**

In `functions/index.js`, add the import near the other handler imports:

```js
import { joinGroupHandler } from './group-join.js';
```

Register it near `resolveInvitePreview` (after line 213). The callable is authenticated, so pass `request` straight through (the handler reads `request.auth`):

```js
// Authenticated callable: server-authoritative group join (Fix 2, option A).
// Validates a real entitlement (invite token or pending invite) before writing
// the member node via Admin SDK, closing the #288 self-join surface once the
// members .write rule is tightened (see database.rules.json). See group-join.js.
export const joinGroup = httpsOnCall((request) =>
  joinGroupHandler(request, {
    now: () => Date.now(),
    getVal: (/** @type {string} */ path) => db.ref(path).get().then((snap) => snap.val()),
    set: (/** @type {string} */ path, /** @type {unknown} */ value) => db.ref(path).set(value),
    transaction: async (/** @type {string} */ path, /** @type {(c: any) => unknown} */ fn) => {
      const res = await db.ref(path).transaction(fn);
      return { committed: res.committed };
    },
  }));
```

- [ ] **Step 2: Add the client wrapper**

In `js/firebase-config.ts`, alongside the other `httpsCallable` wrappers (after line 24):

```ts
const _joinGroup = httpsCallable(_functions, 'joinGroup');

// Calls the joinGroup callable (Fix 2). Returns the handler result shape.
export async function callJoinGroup(
  args: { groupId: string; displayName: string; token?: string },
): Promise<{ ok: boolean; groupId?: string; alreadyMember?: boolean; reason?: string }> {
  const { data } = await _joinGroup(args);
  return data as { ok: boolean; groupId?: string; alreadyMember?: boolean; reason?: string };
}
```

- [ ] **Step 3: Write the failing client test**

Add to the suite that already mocks `js/db/*` (mirror its existing mock setup). Example new file `tests/group-join-client.test.js` if none fits:

```js
// Verifies the client join path brokers through the callable and NEVER writes
// the member node directly (the #288 close depends on this).
jest.mock('../js/firebase-config.js', () => ({
  ...jest.requireActual('../js/firebase-config.js'),
  callJoinGroup: jest.fn(() => Promise.resolve({ ok: true, groupId: 'G1' })),
}));
jest.mock('../js/db/groups.js'); // writeMember must NOT be called

const { callJoinGroup } = require('../js/firebase-config.js');
const dbGroups = require('../js/db/groups.js');
const { joinGroup } = require('../js/groups.js');

test('joinGroup routes through the callable, not a direct member write', async () => {
  await joinGroup('G1', 'joiner', 'Jo', { group: { name: 'Family' }, existing: null, token: 'T' });
  expect(callJoinGroup).toHaveBeenCalledWith({ groupId: 'G1', displayName: 'Jo', token: 'T' });
  expect(dbGroups.writeMember).not.toHaveBeenCalled();
});
```

> Match the repo's mock idioms (top-level `jest.mock`, not inside test bodies — see the landmine on mid-file `require` after `resetModules`). If an existing suite already imports `joinGroup`, add this test there instead of a new file.

Run: `npx jest --maxWorkers=2 group-join-client`
Expected: FAIL — `joinGroup` still calls `writeMember`.

- [ ] **Step 4: Rewire client `joinGroup`**

In `js/groups.ts`, replace the `writeMember` block in `joinGroup` (lines ~131-149) with a callable broker. Keep `validateName` (fast UX), `clearGroupPaletteState`, and `writeUserGroupsEntry` (self-writable, stay client-side). Add `token?: string` to the opts type.

```ts
export async function joinGroup(
  groupId: string,
  joinerUid: string,
  displayNameRaw: unknown,
  opts: { group?: unknown; existing?: unknown; token?: string } = {},
) {
  const displayName = validateName(displayNameRaw, 'Display name');
  const group = ('group' in opts) ? opts.group : await readGroup(groupId);
  if (!group) throw new Error('Group not found.');

  const existing = ('existing' in opts) ? opts.existing : await readMember(groupId, joinerUid);
  const now = Date.now();
  if (!existing) {
    // Fresh membership: drop any stale per-group palette selection (see note
    // below) BEFORE the brokered write so groupContext seeds a clean color.
    clearGroupPaletteState(groupId);
    // Server-authoritative join: the callable validates entitlement and writes
    // the member node (Admin SDK). The client can no longer self-write it once
    // the members .write rule is tightened (Task 5).
    const res = await callJoinGroup({ groupId, displayName, ...(opts.token ? { token: opts.token } : {}) });
    if (!res.ok) throw new Error(res.reason || 'join-failed');
  }
  await writeUserGroupsEntry(joinerUid, groupId, { lastVisited: now });
}
```

Add the import at the top of `js/groups.ts`:

```ts
import { callJoinGroup } from './firebase-config.js';
```

- [ ] **Step 5: Pass the token through and drop the client redemption bump**

In `js/invites.ts`, `redeemGroupInvite` (around line 458): pass `token` into `joinGroup` and remove the now-duplicate `incrementGroupInviteRedemptions` call (the callable bumps authoritatively):

```diff
   try {
-    await joinGroup(groupId, redeemerUid, displayName, { group, existing: existingMember });
+    await joinGroup(groupId, redeemerUid, displayName, { group, existing: existingMember, token });
   } catch (err) {
     if (/not found/i.test((err as Error).message || '')) return { ok: false, reason: 'group-missing' };
     return { ok: false, reason: 'invalid-display-name', message: (err as Error).message || 'Invalid display name.' };
   }
-  await incrementGroupInviteRedemptions(groupId, token);

   return { ok: true, groupId, groupName: group.name };
```

If `incrementGroupInviteRedemptions` now has no other caller, remove its import here (leave the `js/db/groups.ts` definition — verify with a repo search before deleting the definition).

- [ ] **Step 6: Run the client test to verify it passes**

Run: `npx jest --maxWorkers=2 group-join-client`
Expected: PASS.

- [ ] **Step 7: Full web suite + typecheck**

Run: `npx jest --maxWorkers=2`
Expected: PASS. Fix any redeem/inbox suite that asserted a direct member write or the client redemption bump — update those expectations to the brokered path (this is expected fallout, not a regression; the behavior moved server-side).
Run: `npm run typecheck && npm run typecheck:scripts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add functions/index.js js/firebase-config.ts js/groups.ts js/invites.ts tests/
git commit -m "feat: broker group joins through the joinGroup callable (Fix 2b)

Registers the joinGroup callable and routes the client join path through it
(both redeem-token and inbox pending-accept funnel through client joinGroup).
Drops the direct writeMember and the client-side redemptionsUsed bump — both
now server-authoritative. Client keeps only self-writable bits (palette reset,
user-groups entry). Member-rule tighten lands next (Task 5); deploy the callable
before/with that rule."
```

---

### Task 5: Fix 2c — tighten the member `.write` rule (block self-join)

The enforcing half of option A. Now that joins are brokered, forbid a client from *creating* its own member node while preserving self-*updates* (display-name, statusOverride) and self-*delete* (leave), plus owner writes.

**Files:**
- Modify: `database.rules.json` — `groups/$gid/members/$uid` `.write` (line 83)
- Test: `tests/rules/locations.test.js` (add a `describe('groups/{gid}/members — self-join guard')` block) or `tests/rules/groups.test.js` if one exists for group membership

**Interfaces:**
- Consumes: the `joinGroup` callable (Task 3/4) is now the only creator of member nodes (Admin SDK bypasses rules).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing rules tests**

Add to `tests/rules/locations.test.js` (reuses `dbAs`, `seed`, `assertSucceeds`, `assertFails`):

```js
describe('groups/{gid}/members — self-join guard (Fix 2c)', () => {
  async function seedG(db) {
    await db.ref('groups/G1/ownerId').set('alice');
    await db.ref('groups/G1/members/alice').set({ role: 'owner', displayName: 'Alice' });
    await db.ref('groups/G1/members/bob').set({ role: 'member', displayName: 'Bob' });
  }

  test('DENIES a client self-CREATE of a member node (the #288 self-join)', async () => {
    await seed(env, seedG);
    await assertFails(dbAs(env, 'mallory').ref('groups/G1/members/mallory')
      .set({ role: 'member', displayName: 'Mallory', joinedAt: 1 }));
  });

  test('ALLOWS a member to self-UPDATE display name (existing membership)', async () => {
    await seed(env, seedG);
    await assertSucceeds(dbAs(env, 'bob').ref('groups/G1/members/bob/displayName').set('Bobby'));
  });

  test('ALLOWS a member to self-write statusOverride (existing membership)', async () => {
    await seed(env, seedG);
    await assertSucceeds(dbAs(env, 'bob').ref('groups/G1/members/bob/statusOverride')
      .set({ enabled: true, status: 'available', availableUntil: 1752800000000 }));
  });

  test('ALLOWS a member to self-LEAVE (delete own node)', async () => {
    await seed(env, seedG);
    await assertSucceeds(dbAs(env, 'bob').ref('groups/G1/members/bob').remove());
  });

  test('ALLOWS the owner to add and remove members', async () => {
    await seed(env, seedG);
    await assertSucceeds(dbAs(env, 'alice').ref('groups/G1/members/carol')
      .set({ role: 'member', displayName: 'Carol', joinedAt: 1 }));
    await assertSucceeds(dbAs(env, 'alice').ref('groups/G1/members/bob').remove());
  });

  test('forged-member coarse-cell read is blocked end-to-end', async () => {
    await seed(env, seedG);
    // mallory cannot self-join, so she can never publish a cell → never reads.
    await assertFails(dbAs(env, 'mallory').ref('groups/G1/members/mallory')
      .set({ role: 'member', displayName: 'M', joinedAt: 1 }));
  });
});
```

- [ ] **Step 2: Run the tests to verify the self-create test fails**

Run: `npm run test:rules`
Expected: the `DENIES a client self-CREATE` and `forged-member` tests FAIL (current rule allows `auth.uid === $uid` to create); the ALLOW tests already pass.

- [ ] **Step 3: Tighten the rule**

In `database.rules.json`, `groups/$gid/members/$uid` `.write` (line 83):

```diff
-            ".write": "auth != null && (auth.uid === $uid || data.parent().parent().child('ownerId').val() === auth.uid)"
+            ".write": "auth != null && ((auth.uid === $uid && (data.exists() || !newData.exists())) || data.parent().parent().child('ownerId').val() === auth.uid)"
```

The self-branch now permits a write only when `data.exists()` (updating an existing membership) or `!newData.exists()` (deleting). The single blocked case is `!data.exists() && newData.exists()` — self-create from nothing.

- [ ] **Step 4: Run the rules tests to verify all pass**

Run: `npm run test:rules`
Expected: PASS — the new self-join guard block plus all pre-existing rules tests. In particular the two ALLOW cases for self-update confirm the `(data.exists() || !newData.exists())` form did not break member self-edits (the exact regression the earlier `!newData.exists()`-only sketch would have caused).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck && npm run typecheck:scripts`
Expected: PASS.

```bash
git add database.rules.json tests/rules/locations.test.js
git commit -m "fix(rules): block client self-join of group membership (Fix 2c)

Tightens groups/\$gid/members/\$uid .write to (data.exists() || !newData.exists())
on the self-branch: permits self-UPDATE (display name, statusOverride) and
self-LEAVE, forbids self-CREATE. Closes #288's location widening — a client can
no longer self-join to gain coarse-cell reads; joins go through the joinGroup
callable (Admin SDK). DEPLOY THE CALLABLE BEFORE/WITH THIS RULE."
```

---

## Self-Review

**Spec coverage:**
- Fix 1 (precise-location gate) → Task 1. ✓ Includes `followerNames` parallel narrowing and the bot-mirror regression the spec called for.
- Fix 2 option A (CF-brokered join) → Tasks 3 (callable), 4 (register + client rewire), 5 (member-rule tighten). ✓ Covers the corrected `(data.exists() || !newData.exists())` rule, the redemptions-bump move, idempotency, and the token-vs-pending entitlement split.
- Fix 3 (revoke cell on membership loss) → Task 2. ✓
- Cross-cutting gates (four green commands, sync-shared, deploy ordering) → Global Constraints + per-task run steps + commit-body deploy notes. ✓
- Deliberately out-of-scope persistence posture → not touched by any task. ✓

**Placeholder scan:** Two intentional "match the file's actual helper names" notes (Task 1 Step 5 bot-mirror test; Task 4 Step 3 client-mock idioms) — these are real conditionals about existing test-harness naming that the implementer must read off the file, not skipped work; each carries a concrete fallback. No `TODO`/`TBD`/"handle edge cases"/"similar to Task N" placeholders. All rule diffs and handler bodies are complete.

**Type consistency:** `joinGroupHandler(request, deps)` result shape `{ ok, groupId, alreadyMember?, reason? }` is identical across Task 3 (definition/tests), Task 4 (`callJoinGroup` wrapper + client consumption). `deps` quintet (`now`/`getVal`/`set`/`transaction`) matches `makeDbDeps()` in `functions/index.js`. Client `joinGroup` opts `{ group, existing, token? }` consistent between `js/groups.ts` (Task 4 Step 4) and `js/invites.ts` caller (Task 4 Step 5). `handleMemberRemoved(deps, groupId, memberUid, beforeVal, afterVal)` matches between Task 2 test and handler and trigger registration.

## Sequencing note

Task order = suggested implementation order: **1 → 2 → 3 → 4 → 5**. Task 1 (HIGH, rules-only) and Task 2 (isolated trigger) are independent and could go in either order. Tasks 3→4→5 are strictly ordered (handler before wiring before rule enforcement) so the repo stays green and deployable at each boundary. At deploy time, Task 3+4's callable must ship before or with Task 5's rule.
