# G9 + G10 — ghost-followee writes: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop two client code paths writing rows that name an account which no longer exists — `rotateCode`'s follower fan-out (G9) and invite redemption's follower registration (G10).

**Architecture:** Both fixes are client-side and local. G9 filters the cached followee list through `followeeExists` — the same predicate the G6 rules guard uses — before the fan-out payload is built, failing *open* on an inconclusive read. G10 swaps two adjacent `await`s so the G6 rules guard refuses the follow before anything is written into the creator's subtree. No `database.rules.json` change, no new module, no new exported function.

**Tech Stack:** Vanilla TypeScript (strict) compiled by `tsc`, Firebase Realtime Database Web SDK v9 modular API, Jest with jsdom, all client code under `js/`.

**Spec:** `docs/superpowers/specs/2026-08-03-g9-g10-ghost-followee-writes-design.md`. Read §2 before changing the approach — it records why the obvious rules-side mirror of G6 was rejected.

## Global Constraints

- **Zero TypeScript suppressions.** Sweep for all seven forms, not just the TS-syntax ones: `as any`, `@ts-ignore`, `@ts-expect-error`, `@type {any}`, `{any}`, `: any`, `<any>`. This plan requires none; if you reach for one, the design is wrong.
- **Run every command from the repo root** (`/home/user/on`). A `cd functions` in an earlier command lingers in the session shell, and from there `npx jest` silently runs the root config against the functions tree and `npm run typecheck` errors as an unknown script. Always `cd /home/user/on` first.
- **Web tests need `--maxWorkers=2`** — the container OOMs on default workers.
- **This repo's Jest flag is `--testPathPatterns` (PLURAL).** The singular form is rejected.
- **`jest.clearAllMocks()` does not clear `mockResolvedValue` implementations.** Set the implementation you need in the test that needs it.
- **Set committer identity before the first commit:** `git config user.email noreply@anthropic.com && git config user.name Claude`.
- **Per-task commits are sanctioned by this plan** — commit at each task boundary as the steps instruct. Do not push until Task 4.
- **Branch:** `claude/knockknock-g6-g9-fixes-lt02a8`. Do not merge to `dev` or `main`, and do not open a pull request.
- **Deploy surface:** hosting only. Nothing in this plan deploys from a session.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `js/db/social.ts` | RTDB access for the social graph; owns `rotateCode`, `followeeExists`, `registerAsFollower`, `setFollowingEntry` | Modify `rotateCode` (Task 1) |
| `tests/db.test.js` | Unit coverage for the `js/db` barrel, `firebase/database` fully mocked | Add 4 tests + 1 `beforeEach` line (Task 1) |
| `js/invites.ts` | Invite-link primitive; owns `redeemPersonalInvite` | Swap two lines (Task 2) |
| `tests/invites.test.js` | Unit coverage for `js/invites`, `js/db.js` fully mocked | Add 2 tests (Task 2) |
| `docs/operator-panel-followups.md` | The stable-ID item ledger | Close G9 and G10 (Task 3) |
| `docs/HANDOFF.md` | Session on-ramp and branch status | Reconcile (Task 3) |
| `docs/superpowers/specs/2026-08-03-g9-g10-ghost-followee-writes-design.md` | The design | Status line → IMPLEMENTED (Task 3) |

No new files. No file is split — both touched modules are the established homes for these functions.

---

### Task 1: G9 — filter the rotation fan-out

**Files:**
- Modify: `js/db/social.ts:343-370` (`rotateCode`)
- Test: `tests/db.test.js:63-127` (the existing `describe('rotateCode', …)` block)

**Interfaces:**
- Consumes: `followeeExists(userId: string): Promise<boolean>` — already exported from the same file at `js/db/social.ts:330-333`. It reads `users/{userId}/presence/code` and **throws** on network error. Also `getFollowing()` from `../store.js`, already imported by this module, returning `{ userId: string; code: string; label?: string }[]` read from `localStorage`.
- Produces: nothing new. `rotateCode`'s signature, return value and thrown-error behaviour are unchanged. Task 2 does not depend on this task; the two are independent.

**Background the implementer needs.** `rotateCode` runs when a user presses "regenerate" on their share code (`js/mycode.ts:87`). It reserves a fresh code, then publishes it in **one atomic root `update()`** that carries the user's own `presence/code` alongside a `users/{T}/followers/{me}` mirror for every followee in the local cache. A followee purged since that cache last synced gets a row written under a uid that no longer exists, and nothing in the codebase ever sweeps it. Filtering happens **before** the code reservation, not between the reservation and the publish: network reads inserted into that gap widen the window in which a crash leaves a reserved-but-unpublished code orphaned in `codeIndex`.

- [ ] **Step 1: Add the "all followees are live" default to the describe's `beforeEach`**

In `tests/db.test.js`, inside `describe('rotateCode', …)`, the `beforeEach` currently reads:

```js
  beforeEach(() => {
    jest.clearAllMocks();
    getFollowing.mockReturnValue([]);
  });
```

Make it:

```js
  beforeEach(() => {
    jest.clearAllMocks();
    getFollowing.mockReturnValue([]);
    // Default: every followee still exists. Without this the G9 filter's
    // fail-open catch would swallow an unmocked get() and the pre-existing
    // multi-path test would pass for the wrong reason — proving the catch
    // works, not that a live followee is carried.
    get.mockResolvedValue({ exists: () => true });
  });

  // jest.clearAllMocks() does NOT clear mockResolvedValue implementations, so
  // without this the default above leaks into every later describe in this file.
  afterEach(() => {
    get.mockReset();
  });
```

`get` is already destructured at the top of the file from the `firebase/database` mock. Add nothing else.

The `afterEach` is not optional: this file has many later describes (`getUser`, `readInviteIndex`, the group blocks) that drive `get`, and a leaked "always resolves to an existing snapshot" default is exactly the kind of cross-describe contamination that makes an unrelated suite pass for the wrong reason.

- [ ] **Step 2: Write the four failing tests**

Append these inside the same `describe('rotateCode', …)` block, after the existing `'failure in step 2 (update) rejects the promise; remove is not called'` test:

```js
  test('G9: a followee whose presence/code is gone is left out of the fan-out', async () => {
    getFollowing.mockReturnValue([
      { userId: 'live-A', code: 'CODEA1', label: 'Alice' },
      { userId: 'ghost-B', code: 'CODEB2', label: 'Bob' },
    ]);
    // One get() per followee, issued in getFollowing() order: .map runs its
    // callbacks in order, each calls followeeExists synchronously, and
    // followeeExists calls get() before its first await — so the queued
    // ...Once values line up with the array.
    get
      .mockResolvedValueOnce({ exists: () => true })
      .mockResolvedValueOnce({ exists: () => false });
    generateCode.mockReturnValue('NEW456');
    runTransaction.mockResolvedValue({ committed: true });
    update.mockResolvedValue();
    remove.mockResolvedValue();

    await rotateCode('user-1', 'OLD123');

    // ghost-B's mirror would be residue under a uid that no longer exists —
    // in that account's OWN subtree, so crossRefRenderers never enumerates it
    // and nothing ever sweeps it (G9).
    expect(update).toHaveBeenCalledWith('mock-ref', {
      'users/user-1/presence/code': 'NEW456',
      'users/live-A/followers/user-1': 'NEW456',
    });
    // The predicate is the G6 rules guard's own: presence/code, not users/{T}.
    expect(ref).toHaveBeenCalledWith(expect.anything(), 'users/ghost-B/presence/code');
  });

  test('G9: an inconclusive existence read keeps the followee in (fail open)', async () => {
    getFollowing.mockReturnValue([{ userId: 'followee-A', code: 'CODEA1', label: 'Alice' }]);
    get.mockRejectedValueOnce(new Error('network error'));
    generateCode.mockReturnValue('NEW456');
    runTransaction.mockResolvedValue({ committed: true });
    update.mockResolvedValue();
    remove.mockResolvedValue();

    // Dropping a LIVE followee strands their mirror on the old code and
    // silently breaks a real contact, with nothing to retry it. Writing one
    // ghost row is no worse than the behaviour before this filter existed.
    const result = await rotateCode('user-1', 'OLD123');

    expect(update).toHaveBeenCalledWith('mock-ref', {
      'users/user-1/presence/code': 'NEW456',
      'users/followee-A/followers/user-1': 'NEW456',
    });
    expect(result).toBe('NEW456');
  });

  test('G9: no followees issues no existence read', async () => {
    getFollowing.mockReturnValue([]);
    generateCode.mockReturnValue('NEW456');
    runTransaction.mockResolvedValue({ committed: true });
    update.mockResolvedValue();
    remove.mockResolvedValue();

    await rotateCode('user-1', 'OLD123');

    expect(get).not.toHaveBeenCalled();
  });

  test('G9: the existence reads run before the code reservation', async () => {
    getFollowing.mockReturnValue([{ userId: 'followee-A', code: 'CODEA1', label: 'Alice' }]);
    generateCode.mockReturnValue('NEW456');
    runTransaction.mockResolvedValue({ committed: true });
    update.mockResolvedValue();
    remove.mockResolvedValue();

    await rotateCode('user-1', 'OLD123');

    // Placement is load-bearing: reads between the codeIndex reservation and
    // the publish would widen the window in which a crash orphans a reserved
    // code.
    expect(get.mock.invocationCallOrder[0])
      .toBeLessThan(runTransaction.mock.invocationCallOrder[0]);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /home/user/on && npx jest --maxWorkers=2 --testPathPatterns db.test`

Expected: the three new G9 tests that assert filtering/ordering FAIL. Specifically `'a followee whose presence/code is gone is left out of the fan-out'` fails because the payload still contains `users/ghost-B/followers/user-1`; `'no followees issues no existence read'` PASSES already (there is nothing to read yet) and `'an inconclusive existence read keeps the followee in'` PASSES already (nothing reads, so nothing rejects); `'the existence reads run before the code reservation'` fails because `get` was never called and `invocationCallOrder[0]` is `undefined`.

Two of the four passing before the change is expected and fine — they are regression pins for behaviour the fix must not break, and Step 6 plants violations that prove they can go red.

- [ ] **Step 4: Write the implementation**

In `js/db/social.ts`, replace the body of `rotateCode` from its opening line through the fan-out loop. The function currently begins:

```ts
export async function rotateCode(userId: string, oldCode: string): Promise<string> {
  // Step 1: reserve new code (collision-safe)
  let newCode: string, committed: boolean;
```

Insert the filter ahead of that comment, and change the loop to read the filtered list:

```ts
export async function rotateCode(userId: string, oldCode: string): Promise<string> {
  // Step 0 (G9): drop followees that no longer exist before building the
  // fan-out. A cached entry for an account purged, merged or graduated since
  // the last sync would otherwise get users/{T}/followers/{me} rewritten under
  // a dead uid — residue in T's OWN subtree, which crossRefRenderers does not
  // enumerate and nothing ever sweeps. Same predicate as the G6 rules guard,
  // through the same function so the two cannot drift apart.
  //
  // Before the reservation on purpose: reads placed between reserving the new
  // code and publishing it would widen the window in which a crash leaves an
  // orphan in codeIndex.
  //
  // An inconclusive read keeps the entry. Dropping a LIVE followee strands
  // their mirror on the old code and silently breaks a working contact with
  // nothing to retry it; including a dead one writes a single row that would
  // have been written anyway before this filter existed.
  const checked = await Promise.all(getFollowing().map(async (entry) => ({
    entry,
    live: await followeeExists(entry.userId).catch(() => true),
  })));
  const liveFollowing = checked.filter((c) => c.live).map((c) => c.entry);

  // Step 1: reserve new code (collision-safe)
  let newCode: string, committed: boolean;
```

Then, further down, change the fan-out loop from `getFollowing()` to `liveFollowing`:

```ts
  const updates: Record<string, unknown> = { [`users/${userId}/presence/code`]: newCode };
  for (const entry of liveFollowing) {
    updates[`users/${entry.userId}/followers/${userId}`] = newCode;
  }
  await update(ref(db), updates);
```

Leave everything else — the reservation loop, the comment above the update, Step 4's `remove`, the return — untouched. `followeeExists` is declared later in the file than `rotateCode`; function declarations hoist, so no reordering is needed. The `{ entry, live }` pair shape is deliberate: it keeps the filter typed without a predicate cast, so no suppression is required.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /home/user/on && npx jest --maxWorkers=2 --testPathPatterns db.test`

Expected: PASS, including the four pre-existing `rotateCode` tests. If `'writes one atomic multi-path update: own code + each follower mirror'` fails, the `beforeEach` default from Step 1 is missing.

- [ ] **Step 6: Verify by planting violations**

Passing on the first run proves nothing — this is a guard, and the repo's standing rule is to plant the violation and watch it fail. Do both, one at a time, reverting each before the next:

1. Change `for (const entry of liveFollowing)` back to `for (const entry of getFollowing())`. Re-run. Expected: `'a followee whose presence/code is gone is left out of the fan-out'` goes RED. Revert.
2. Change `.catch(() => true)` to `.catch(() => false)`. Re-run. Expected: `'an inconclusive existence read keeps the followee in (fail open)'` goes RED. Revert.
3. Move the `checked`/`liveFollowing` block to sit immediately *after* the `do { … } while (!committed)` reservation loop. Re-run. Expected: `'the existence reads run before the code reservation'` goes RED. Revert.

If any planted violation stays GREEN, that is the finding — stop and report it rather than proceeding.

- [ ] **Step 7: Typecheck**

Run: `cd /home/user/on && npm run typecheck && npm run typecheck:scripts`

Expected: both clean, no output beyond the script banners. Then confirm no suppression was introduced:

Run: `cd /home/user/on && git diff -U0 js/ | grep -nE 'as any|@ts-ignore|@ts-expect-error|@type \{any\}|\{any\}|: any|<any>'`

Expected: no output.

- [ ] **Step 8: Commit**

```bash
cd /home/user/on
git add js/db/social.ts tests/db.test.js
git commit -m "fix(following): rotateCode no longer mirrors a code onto a dead followee (G9)"
```

Write the body from the spec's §3: name the residue class (T's own subtree, outside `crossRefRenderers`), the fail-open reasoning, the placement reasoning, and the three planted violations with which test each turned red.

---

### Task 2: G10 — order the redemption writes behind the guard

**Files:**
- Modify: `js/invites.ts:211-212` (inside `redeemPersonalInvite`)
- Test: `tests/invites.test.js:225` (the existing `describe('redeemPersonalInvite', …)` block)

**Interfaces:**
- Consumes: `registerAsFollower(targetUserId, myUserId, myCode, myName?)` and `setFollowingEntry(myUserId, followeeUserId, code, label?)`, both imported from `./db.js` at `js/invites.ts:9`. Signatures are unchanged by this task.
- Produces: nothing new. `redeemPersonalInvite`'s return contract is unchanged, including that a refused write **throws** rather than returning `{ ok: false }`.

**Background the implementer needs.** `redeemPersonalInvite` reads the creator's `presence/code` at `:201` and returns `{ ok: false, reason: 'creator-missing' }` when it is absent, so an already-purged creator never reaches the writes. The gap is narrower: the creator can be purged *between* that read and the write landing. In that window `registerAsFollower` succeeds — leaving `users/{creator}/followers/{redeemer}` and its `followerNames` sibling under an account that no longer exists — and only then does `setFollowingEntry` meet the G6 rules guard and get refused. Swapping the two puts the refusable write first, so the guard fires before anything lands in the creator's subtree.

Do **not** add a second existence check here. G6's rules guard is the authority; a client-side re-read can disagree with it. And do **not** convert the refusal into `{ ok: false, reason: 'creator-missing' }` — this module deliberately distinguishes "that invite is dead" from "couldn't check" (the W1 J#1 contract note above `resolveInvitePreview`), and a network failure reported as `creator-missing` would erase that distinction.

- [ ] **Step 1: Write the two failing tests**

Append inside `describe('redeemPersonalInvite', …)` in `tests/invites.test.js`. The block's `beforeEach` already sets `db.getCreatorCode.mockResolvedValue('ABC123')` and resolves all three write mocks, so only the index/invite records need seeding:

```js
  test('G10: the refusable follow write runs before the creator-side follower row', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator-uid/invites/TOKEN' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'TOKEN', creatorUid: 'creator-uid', creatorLabel: 'Alex',
      revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    const order = [];
    db.setFollowingEntry.mockImplementation(async () => { order.push('setFollowingEntry'); });
    db.registerAsFollower.mockImplementation(async () => { order.push('registerAsFollower'); });

    await redeemPersonalInvite('TOKEN', 'redeemer-uid', 'redeemer-code', new Set());

    // setFollowingEntry is the write the G6 rules guard can refuse. It has to
    // resolve first, or a creator purged after the :201 read keeps a follower
    // row for someone who is not, and can never become, following them (G10).
    expect(order).toEqual(['setFollowingEntry', 'registerAsFollower']);
  });

  test('G10: a refused follow writes nothing into the creator subtree and does not bump the counter', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator-uid/invites/TOKEN' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'TOKEN', creatorUid: 'creator-uid', creatorLabel: 'Alex',
      revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    db.setFollowingEntry.mockRejectedValue(new Error('PERMISSION_DENIED'));

    await expect(redeemPersonalInvite('TOKEN', 'redeemer-uid', 'redeemer-code', new Set()))
      .rejects.toThrow('PERMISSION_DENIED');

    expect(db.registerAsFollower).not.toHaveBeenCalled();
    // Settles the followups entry's claim that the counter still increments:
    // incrementInviteRedemptions sits behind the await that throws.
    expect(db.incrementInviteRedemptions).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/user/on && npx jest --maxWorkers=2 --testPathPatterns invites.test`

Expected: both FAIL. The first reports `['registerAsFollower', 'setFollowingEntry']` against the expected order. The second fails on `expect(db.registerAsFollower).not.toHaveBeenCalled()` — it was called once, which is the residue G10 describes.

- [ ] **Step 3: Write the implementation**

In `js/invites.ts`, the two lines at `:211-212` currently read:

```ts
  await registerAsFollower(creatorUid, redeemerUid, redeemerCode, redeemerName);
  await setFollowingEntry(redeemerUid, creatorUid, creatorCode, followLabel);
```

Swap them and record why:

```ts
  // G10: the refusable write goes FIRST. The creator's presence/code was read
  // at :201, but they can be purged between that read and these writes; in
  // that window the G6 rules guard refuses setFollowingEntry, and running it
  // first means registerAsFollower never writes users/{creator}/followers/{me}
  // (plus its followerNames sibling) for an account that is gone. The refusal
  // propagates as a throw rather than becoming reason: 'creator-missing' —
  // "that invite is dead" and "couldn't check" are different answers (W1 J#1).
  await setFollowingEntry(redeemerUid, creatorUid, creatorCode, followLabel);
  await registerAsFollower(creatorUid, redeemerUid, redeemerCode, redeemerName);
```

Leave the `followLabel` assignment above and the `incrementInviteRedemptions` call below exactly where they are. `registerAsFollower`'s own internal ordering — clear `revocations/{me}/{target}`, *then* set the followers entry (`js/db/social.ts:236-243`) — is load-bearing against a race in the target's revocation watcher and is untouched by this swap. The two comment blocks already above `:211` (about `creatorLabel` and about `redeemerName`) stay; place the new comment directly above the swapped pair.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /home/user/on && npx jest --maxWorkers=2 --testPathPatterns invites.test`

Expected: PASS, including the three pre-existing redemption tests (`'happy path…'`, `'forwards the redeemer name…'`, `'falls back to an empty follow label…'`) — none of them asserts an order, so all three should be unaffected.

- [ ] **Step 5: Verify by planting a violation**

Swap the two lines back. Re-run. Expected: BOTH new tests go RED. Revert the plant.

If either stays green, stop and report it.

- [ ] **Step 6: Typecheck**

Run: `cd /home/user/on && npm run typecheck && npm run typecheck:scripts`

Expected: both clean.

- [ ] **Step 7: Commit**

```bash
cd /home/user/on
git add js/invites.ts tests/invites.test.js
git commit -m "fix(invites): redemption no longer leaves a follower row for a vanished creator (G10)"
```

In the body, record the correction the second test settles: the followups entry says the redemption counter still increments, and it cannot — `incrementInviteRedemptions` sits behind the `await` that throws.

---

### Task 3: Reconcile the documentation

**Files:**
- Modify: `docs/operator-panel-followups.md` — the at-a-glance paragraph (`:18-41`), the table rows for G9 (`:53`) and G10 (`:54`), and the two entry sections (`:619`, `:663`)
- Modify: `docs/HANDOFF.md` — "What's next" (`:52-59`), the fourteen-open sentence (`:141-154`), the branch-status commit table (`:177-196`), the two-undeployed-surfaces note (`:205-223`), and the verification-state bar (`:312-317`)
- Modify: `docs/superpowers/specs/2026-08-03-g9-g10-ghost-followee-writes-design.md` — the `**Status:**` line

**Interfaces:**
- Consumes: the commit SHAs produced by Tasks 1 and 2. Get them with `git log --oneline -2`.
- Produces: nothing code-facing.

- [ ] **Step 1: Close G9 and G10 in the followups ledger**

In `docs/operator-panel-followups.md`:

- Table row G9 → strike the item text (`~~…~~`) and set Weight to `**CLOSED** (<task-1-sha>) — client filter; see below`. Same for G10 with the Task 2 SHA.
- In the G9 section, keep the whole existing entry (the ledger's convention is that *why it was deferred* stays readable) and append a **Closed** paragraph: the filter, the `followeeExists` predicate reuse, fail-open on an inconclusive read, the placement before the reservation, and the three planted violations. State plainly that it is **verified by jest only** — no session has ever held a service-account credential, and this has never run against a live project.
- In the G10 section, append the same shape, plus the §1.1 correction: the entry's claim that the redemption counter still increments is wrong, and the test that settles it.
- Update the counts. The at-a-glance heading currently reads `Fourteen open, seven closed.` → `Twelve open, nine closed.` Update the surrounding prose in the same paragraph that enumerates which items are newest-closed, and remove G9/G10 from any "open" enumeration.

- [ ] **Step 2: Reconcile the handoff**

In `docs/HANDOFF.md`:

- "What's next": the paragraph beginning `Everything else in that file (**G1**, **G4**, **G9**, **G10**, …)` claims G9 is a deferral that "passes that test on its face". Rewrite it — G9 and G10 are closed; the remaining deferrals are G1, G4, M1–M8 and M10.
- The `**Fourteen open, seven closed**` sentence and its "G9 is the one to read first" clause both go stale. Replace the count and drop the pointer.
- Add the two new commits to the branch-status table with one-line descriptions, and add the spec commit `b1d55ed` above them.
- The undeployed-surfaces note: add `js/db/social.ts` and `js/invites.ts` to the **hosting** list alongside `8620702`, `8a0ff62`, `94c9aa6`, `b595dcb`. The rules surface (`13cb18c`+`e2dde4e`) is **unchanged** — say so explicitly, because the natural assumption from a G6-adjacent fix is that rules moved.
- Verification state: record the new bar from Step 4 below, with the per-suite delta (+4 web tests in `tests/db.test.js`, +2 in `tests/invites.test.js`, suite count unchanged at 88; functions and rules unchanged).

- [ ] **Step 3: Update the spec's status line**

In the spec, change:

```markdown
**Status:** DESIGNED. No code written at the time of writing.
```

to name both implementing commits, and add that verification is jest-only against the emulator-free client suites — not a live project.

- [ ] **Step 4: Run all five gates**

Never hand off red. From the repo root, one at a time:

```bash
cd /home/user/on && npx jest --maxWorkers=2
cd /home/user/on/functions && npm test; cd /home/user/on
cd /home/user/on && npm run test:rules
cd /home/user/on && npm run typecheck && npm run typecheck:scripts
cd /home/user/on && node scripts/prod.js
```

Expected, against the `6c45ff5` baseline observed in this container (web 2132/2132 in 88 suites · functions 941/941 in 32 · rules 116/116 in 12 · typechecks clean · build OK): web **2138/2138** in 88 suites, functions and rules **unchanged**, typechecks clean, build OK. A moved functions or rules number means something outside this plan's scope changed — investigate before continuing.

Note the `cd functions` trap: the `; cd /home/user/on` is not optional. Piping a gate to `tail` returns tail's exit status, so an `&&` chain sails past a failure and prints its own success line — run them as separate commands and read each result.

- [ ] **Step 5: Commit**

```bash
cd /home/user/on
git add docs/
git commit -m "docs: close G9 and G10, reconcile the handoff"
```

---

### Task 4: Push

**Files:** none.

**Interfaces:** none.

- [ ] **Step 1: Confirm the tree is clean**

Run: `cd /home/user/on && git status --porcelain`

Expected: empty. `dist/`, `index.html` and `sw.js` are gitignored build artifacts produced by Task 3 Step 4 — if they appear here, something changed in `.gitignore` and it needs looking at, not `git add`.

- [ ] **Step 2: Push**

```bash
cd /home/user/on
git push -u origin claude/knockknock-g6-g9-fixes-lt02a8
```

On a network failure, retry up to four times with exponential backoff (2s, 4s, 8s, 16s). Do **not** open a pull request, and do not merge to `dev` — the maintainer does that.

- [ ] **Step 3: Report**

State what is OBSERVED (the gate numbers from Task 3 Step 4, the planted violations and which test each turned red) separately from what is UNKNOWN (nothing here ran against a live Firebase project; neither G9 nor G10 was ever device-observed; the fix binds only clients that have updated, and it is undeployed). Do not call either item done — that is the operator's call.

---

## Self-Review

**Spec coverage.** §3 (the filter, the predicate, placement, parallel reads, zero-followee case) → Task 1 Steps 4 and 2. §3.1 (fail open) → Task 1, test 2 and plant 2. §3.2 (no cleanup) → nothing to implement; the plan adds no prune, and Task 1's diff is confined to `rotateCode`. §4 (the swap, no second read, the throw preserved) → Task 2 Step 3 and its guidance block. §5 (all seven tests) → Task 1 tests 1-4 map to spec tests 1-4; Task 2 tests map to spec tests 5-6; spec test 7 ("the happy path is unchanged") is the three pre-existing redemption tests, asserted in Task 2 Step 4. §5's plant-a-violation rule → Task 1 Step 6, Task 2 Step 5. §6 (deploy surface) → Task 3 Step 2. §7 (what this does not close) → Task 4 Step 3's UNKNOWN list. §2's rejection of the rules mirror → Global Constraints plus Task 2's "do not add a second existence check".

**Placeholder scan.** No TBD/TODO. Every code step carries the actual code. The doc-editing steps in Task 3 name the exact file, the exact line ranges and the exact substitution, which is as concrete as prose edits get; they are the one place the implementer writes original sentences, and the required content of each is enumerated.

**Type consistency.** `followeeExists` is spelled identically in the spec, Task 1's interface block and Task 1's implementation. `liveFollowing` is introduced in Step 4 and used only there. `checked`'s element shape `{ entry, live }` is consistent between the interface note and the code. `getFollowing` is the store import in both the implementation and the test mock. `setFollowingEntry`/`registerAsFollower` argument orders in Task 2's tests match the pre-existing assertions at `tests/invites.test.js:245-246`.
