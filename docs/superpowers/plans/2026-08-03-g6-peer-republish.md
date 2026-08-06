# G6 — peer republish, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a peer's client from permanently re-creating
`userPrefs/{peer}/following/{T}` after account T is purged, merged or graduated
away.

**Architecture:** Two independent halves. The load-bearing one is a
`.validate` rule refusing any follow entry that names an account with no
presence record — it binds every client in the field the moment it deploys. The
second is a client gate that stops issuing the doomed write and prunes the ghost
row locally, keyed to whether this device has ever seen a server-side following
list for this account.

**Tech Stack:** Firebase RTDB security rules (`database.rules.json`), vanilla
TypeScript client (`js/`), Jest — jsdom for the client, `@firebase/rules-unit-testing`
against the RTDB emulator for the rules.

**Spec:** `docs/superpowers/specs/2026-08-03-g6-peer-republish-design.md`. Read
§5 (rules), §6 (client) and §7 (verification) before starting. The item is G6 in
`docs/operator-panel-followups.md:452`.

## Global Constraints

- `dev` is the integration branch; work happens on
  `claude/knockknock-g3-g6-revocation-cy2i0n`. **Do not merge to `dev`/`main`
  and do not open a PR.** The maintainer merges.
- **Zero new TS suppressions**, swept across all seven forms: `as any`,
  `@ts-ignore`, `@ts-expect-error`, `@type {any}`, `{any}`, `: any`, `<any>`.
- Jest's path flag in this repo is `--testPathPatterns` (**plural**).
- Web tests need `--maxWorkers=2`; the default worker count OOMs the container.
- Run every gate from `/home/user/on`. A `cd functions` lingers in the session
  shell and silently runs the ROOT jest config against the functions tree
  ("32 suites failed, 0 tests").
- Committer identity: `git config user.email noreply@anthropic.com &&
  git config user.name Claude`.
- Per-task commits are instructed here and are the exception to "commit at the
  stop hook, not mid-turn".
- Green bar to preserve, measured at `edb528c`: web **2123/2123** (88 suites),
  functions **941/941** (32 suites), `typecheck` + `typecheck:scripts` clean,
  `node scripts/prod.js` builds.

---

### Task 1: The rules guard

The half that closes G6. Everything else is defence in depth.

**Files:**
- Modify: `database.rules.json:3-9` (the `userPrefs/$uid` block)
- Test: `tests/rules/g6-following-referent.test.js` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: the invariant *a `userPrefs/$uid/following/$followee` entry may only
  name a uid with `users/{followee}/presence/code` present*. Task 3's client gate
  assumes this holds server-side and does not re-implement it.

- [ ] **Step 1: Install dependencies (fresh container)**

```bash
apt-get update; apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
cd /home/user/on && npm ci
```

Use `;` not `&&` on the apt line — the deadsnakes/ondrej PPAs return 403 behind
the proxy and would abort an `&&` chain. `npm ci` installs `firebase-tools`, which
`npm run test:rules` needs.

- [ ] **Step 2: Write the failing rules test**

Create `tests/rules/g6-following-referent.test.js`:

```js
// tests/rules/g6-following-referent.test.js — G6: a follow entry may only name
// an account that exists. Spec: docs/superpowers/specs/2026-08-03-g6-peer-republish-design.md §5.
// The write being refused here is a PEER's client replaying its localStorage
// cache into its OWN prefs after the followee was purged — a legitimate session
// writing an owner-only node, which is why no revocation-time check reaches it.
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs, seed } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const ENTRY = { code: 'XK7P2M', label: 'Bea' };

describe('userPrefs/$uid/following/$followee — the followee must exist', () => {
  test('accepts a follow entry naming a real account', async () => {
    await seed(env, (db) => db.ref('users/T/presence').set({ code: 'XK7P2M', status: 'unavailable', availableUntil: null }));
    await assertSucceeds(dbAs(env, 'M').ref('userPrefs/M/following/T').set(ENTRY));
  });

  test('rejects a follow entry naming a uid with no user record (the G6 republish)', async () => {
    await assertFails(dbAs(env, 'M').ref('userPrefs/M/following/T').set(ENTRY));
  });

  test('rejects it when users/T holds only a follower row — the forgeable shape', async () => {
    // users/$uid/followers/$follower is writable BY the follower, so a peer's own
    // follower row creates the users/T node. A bare users/T.exists() predicate
    // would pass here, and registerAsFollower runs immediately before
    // setFollowingEntry in js/following.ts:1508-1510, so it would pass every time.
    await seed(env, (db) => db.ref('users/T/followers/M').set('XK7P2M'));
    await assertFails(dbAs(env, 'M').ref('userPrefs/M/following/T').set(ENTRY));
  });

  test('allows deleting an entry that is already dangling', async () => {
    // .validate is skipped on delete, and it must be: the purge's own cross-ref
    // null and a user unfollowing a dead contact both go through here.
    await seed(env, (db) => db.ref('userPrefs/M/following/T').set(ENTRY));
    await assertSucceeds(dbAs(env, 'M').ref('userPrefs/M/following/T').remove());
  });

  test('rejects a write to a field UNDER the entry (validate does not run on ancestors)', async () => {
    await assertFails(dbAs(env, 'M').ref('userPrefs/M/following/T/label').set('Bea'));
  });

  test('leaves an unrelated prefs update alone while a dangling entry exists', async () => {
    // .validate covers the data being written, not the rest of the tree.
    await seed(env, (db) => db.ref('userPrefs/M/following/T').set(ENTRY));
    await assertSucceeds(dbAs(env, 'M').ref('userPrefs/M').update({ notifyChannel: 'push' }));
  });

  test('still refuses a non-owner, existing followee or not', async () => {
    await seed(env, (db) => db.ref('users/T/presence').set({ code: 'XK7P2M', status: 'unavailable', availableUntil: null }));
    await assertFails(dbAs(env, 'X').ref('userPrefs/M/following/T').set(ENTRY));
  });
});
```

- [ ] **Step 3: Run it and confirm the right ones fail**

```bash
cd /home/user/on && npm run test:rules -- --testPathPatterns g6-following-referent
```

Expected: the three `assertFails` cases for a missing/forged followee FAIL (the
write currently succeeds — nothing validates `following`), the rest PASS.

If the emulator cannot start because its jar cannot be downloaded through the
proxy, **stop and report that**. Do not stub the emulator, do not convert these
to unit tests, and do not proceed to Step 4 on unverified rules.

- [ ] **Step 4: Add the rule**

In `database.rules.json`, inside `"userPrefs"` → `"$uid"`, after the
`"notifyChannel"` line:

```json
        "following": {
          "$followee": {
            ".validate": "root.child('users').child($followee).child('presence').child('code').exists()",
            "$field": {
              ".validate": "root.child('users').child($followee).child('presence').child('code').exists()"
            }
          }
        }
```

Add a comma after the `"notifyChannel"` entry. `.validate` is the only tool
available here: `userPrefs/$uid` grants a blanket self `.write`, and a granted
ancestor `.write` cannot be revoked by a child `.write` — the same reason
`followers`/`followerNames` are guarded with `.validate`.

- [ ] **Step 5: Run the rules tests again**

```bash
cd /home/user/on && npm run test:rules -- --testPathPatterns g6-following-referent
```

Expected: all seven PASS.

- [ ] **Step 6: Run the whole rules suite for regressions**

```bash
cd /home/user/on && npm run test:rules
```

Expected: every pre-existing suite still passes. `mailboxes`, `r1security` and
`validation` touch neighbouring paths — if one goes red, the new rule is
over-reaching; fix the rule, not the test.

- [ ] **Step 7: Plant a violation and confirm it is caught**

Temporarily weaken the predicate in **both** places to
`root.child('users').child($followee).exists()`, then:

```bash
cd /home/user/on && npm run test:rules -- --testPathPatterns g6-following-referent
```

Expected: the "forgeable shape" test FAILS. That is the evidence the predicate
earns its length. Restore the `presence/code` predicate and re-run to green
before committing. A planted violation that stays green is the finding — if this
one does, say so rather than moving on.

- [ ] **Step 8: Commit**

```bash
cd /home/user/on
git add database.rules.json tests/rules/g6-following-referent.test.js
git commit -m "fix(rules): a follow entry may only name an account that exists — G6

A purge nulls userPrefs/{M}/following/{T} as cross-user residue and M's client
puts it straight back, byte-identical. M was never revoked, its token is valid,
and userPrefs/{M} is M's own node, so no revocation-time check reaches this
write. T is gone, so nothing will ever delete the entry again.

The predicate is users/{T}/presence/code, not users/{T}: the followers row is
writable BY the follower, so a peer's own registerAsFollower creates the
users/{T} node moments before setFollowingEntry runs. Verified by planting the
weak predicate and watching the forgeable-shape case go red.

.validate, not .write — the ancestor grant on userPrefs/\$uid cannot be revoked
by a child .write — and it is skipped on delete, which the purge's own null and
a user unfollowing a dead contact both depend on."
```

---

### Task 2: The device flag in the store

**Files:**
- Modify: `js/store.ts` (key block at `:2-8`, new helpers near `:175`, export list at `:193`)
- Test: `tests/store.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: two exports used by Task 3 —
  `hasSeenServerFollowing(userId: string): boolean` and
  `markServerFollowingSeen(userId: string): void`.

- [ ] **Step 1: Write the failing test**

Append to `tests/store.test.js` (and add the two names to the existing
`require('../js/store')` destructure at the top of the file):

```js
// --- G6: has this device ever seen a server-side following list? ---

test('hasSeenServerFollowing is false before any server list has been seen', () => {
  expect(hasSeenServerFollowing('me')).toBe(false);
});

test('markServerFollowingSeen makes it true for that uid only', () => {
  markServerFollowingSeen('me');
  expect(hasSeenServerFollowing('me')).toBe(true);
  expect(hasSeenServerFollowing('someone-else')).toBe(false);
});

test('a later uid replaces the stored one — an identity switch re-arms the push-up', () => {
  markServerFollowingSeen('me');
  markServerFollowingSeen('other');
  expect(hasSeenServerFollowing('other')).toBe(true);
  expect(hasSeenServerFollowing('me')).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /home/user/on && npx jest --maxWorkers=2 --testPathPatterns store.test
```

Expected: FAIL — `hasSeenServerFollowing is not a function`.

- [ ] **Step 3: Implement**

In `js/store.ts`, beside the other keys at the top:

```ts
const FOLLOWING_SERVER_SEEN_KEY = 'statusapp_following_server_seen';
```

Beside the other device-local helpers (near `getFollowerName`):

```ts
// G6: once this device has seen the server's following list hold at least one
// entry for this account, an EMPTY server list means the server deleted those
// entries — not that this device predates the migration. Stores the uid rather
// than a boolean so switching identities re-arms the one-shot push-up in
// js/following.ts's syncFollowingFromServer instead of suppressing it forever.
function hasSeenServerFollowing(userId: string): boolean {
  try { return localStorage.getItem(FOLLOWING_SERVER_SEEN_KEY) === userId; }
  catch { return false; }
}

function markServerFollowingSeen(userId: string) {
  try { localStorage.setItem(FOLLOWING_SERVER_SEEN_KEY, userId); }
  catch { /* quota / private mode — the rules guard is the backstop */ }
}
```

Add both to the export list at the end of the file.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /home/user/on && npx jest --maxWorkers=2 --testPathPatterns store.test
```

Expected: PASS, with no pre-existing store case changed.

- [ ] **Step 5: Typecheck**

```bash
cd /home/user/on && npm run typecheck && npm run typecheck:scripts
```

Expected: clean, and no new suppression in any of the seven forms.

- [ ] **Step 6: Commit**

```bash
cd /home/user/on
git add js/store.ts tests/store.test.js
git commit -m "feat(store): remember whether this device has seen a server following list

Keyed to the uid, not a boolean, so an identity switch re-arms rather than
suppresses. Read next by syncFollowingFromServer to tell 'this device never
migrated' apart from 'the server deleted these entries' — G6."
```

---

### Task 3: The client gate

**Files:**
- Modify: `js/following.ts:12-15` (the `./store.js` import) and `js/following.ts:1055-1063`
  (`syncFollowingFromServer`)
- Test: `tests/following.test.js` (store mock at `:123-140`, require at `:187`, new describe)

**Interfaces:**
- Consumes: `hasSeenServerFollowing(userId)` / `markServerFollowingSeen(userId)`
  from Task 2; the rules invariant from Task 1.
- Produces: no new exports. Behaviour only.

- [ ] **Step 1: Extend the store mock and write the failing tests**

In `tests/following.test.js`, add to the `jest.mock('../js/store.js', ...)`
factory at `:123`:

```js
  hasSeenServerFollowing: jest.fn(() => false),
  markServerFollowingSeen: jest.fn(),
```

and add both names to the `require('../js/store.js')` destructure at `:187`.

Then append a new describe beside the existing `syncFollowingFromServer event`
block:

```js
// --- syncFollowingFromServer: the G6 push-up gate ---

describe('syncFollowingFromServer push-up gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDom();
  });

  function initAndCaptureFollowingCallback() {
    let followingCb;
    watchFollowing.mockImplementation((_uid, cb) => { followingCb = cb; return jest.fn(); });
    watchFollowers.mockImplementation(() => jest.fn());
    watchPresence.mockReturnValue(jest.fn());
    initList('myUid', 'MYCODE');
    return (list) => followingCb(list);
  }

  test('pushes local entries up when this device has never seen a server list', () => {
    getFollowing.mockReturnValue([{ userId: 'tgt', code: 'C1', label: 'Bea' }]);
    hasSeenServerFollowing.mockReturnValue(false);
    const fireFollowing = initAndCaptureFollowingCallback();

    fireFollowing([]);

    expect(setFollowingEntry).toHaveBeenCalledWith('myUid', 'tgt', 'C1', 'Bea');
    expect(setFollowing).not.toHaveBeenCalled();
  });

  test('prunes instead of republishing once a server list has been seen (G6)', () => {
    getFollowing.mockReturnValue([{ userId: 'tgt', code: 'C1', label: 'Bea' }]);
    hasSeenServerFollowing.mockReturnValue(true);
    const fireFollowing = initAndCaptureFollowingCallback();

    fireFollowing([]);

    expect(setFollowingEntry).not.toHaveBeenCalled();
    expect(setFollowing).toHaveBeenCalledWith([]);
  });

  test('a non-empty server tick marks the device as having seen the list', () => {
    getFollowing.mockReturnValue([]);
    // Set explicitly: jest.clearAllMocks() clears calls, NOT implementations, so
    // the previous test's mockReturnValue(true) would otherwise leak in here.
    hasSeenServerFollowing.mockReturnValue(false);
    const fireFollowing = initAndCaptureFollowingCallback();

    fireFollowing([{ userId: 'tgt', code: 'C1', label: 'Bea' }]);

    expect(markServerFollowingSeen).toHaveBeenCalledWith('myUid');
  });

  test('an empty server tick with an empty local cache writes nothing', () => {
    getFollowing.mockReturnValue([]);
    hasSeenServerFollowing.mockReturnValue(false);
    const fireFollowing = initAndCaptureFollowingCallback();

    fireFollowing([]);

    expect(setFollowingEntry).not.toHaveBeenCalled();
    expect(markServerFollowingSeen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify the gate cases fail**

```bash
cd /home/user/on && npx jest --maxWorkers=2 --testPathPatterns following.test
```

Expected: "prunes instead of republishing" FAILS (the branch republishes today)
and "marks the device as having seen the list" FAILS (nothing calls it). The
other two PASS — they pin behaviour that must not change.

- [ ] **Step 3: Implement the gate**

In `js/following.ts`, add to the `./store.js` import block:

```ts
  hasSeenServerFollowing, markServerFollowingSeen,
```

Then replace the head of `syncFollowingFromServer` (`:1055-1063`):

```ts
function syncFollowingFromServer(myUserId: string, serverFollowing: { userId: string; code: string; label: string }[]) {
  const localFollowing = getFollowing();

  // Any server list with entries in it proves this device is past the migration.
  if (serverFollowing.length > 0) markServerFollowingSeen(myUserId);

  // The migration push-up, gated: an empty server list means "this device never
  // synced" only for a device that has never seen one. For any other device it
  // means the server deleted those entries — a purge, merge or graduation of the
  // last followee — and republishing them writes cross-user residue naming a uid
  // that no longer exists, which nothing will ever clean up (G6). The rules
  // refuse that write regardless; this stops issuing it and prunes the ghost row.
  if (serverFollowing.length === 0 && localFollowing.length > 0 && !hasSeenServerFollowing(myUserId)) {
    for (const entry of localFollowing) {
      setFollowingEntry(myUserId, entry.userId, entry.code, entry.label ?? '').catch(() => {});
    }
    return;
  }
```

Leave the rest of the function unchanged — the fall-through already prunes the
local cache, tears down the followee watchers and repaints.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd /home/user/on && npx jest --maxWorkers=2 --testPathPatterns following.test
```

Expected: all four new cases PASS and the whole `following` suite stays green,
including the two pre-existing `syncFollowingFromServer event` cases.

- [ ] **Step 5: Plant a violation**

Temporarily drop `&& !hasSeenServerFollowing(myUserId)` from the condition and
re-run the suite. Expected: "prunes instead of republishing" goes RED. Restore
it and re-run to green. Testing the condition without exercising the
`watchFollowing` callback would prove nothing about whether it is wired in.

- [ ] **Step 6: Typecheck**

```bash
cd /home/user/on && npm run typecheck && npm run typecheck:scripts
```

Expected: clean, zero new suppressions.

- [ ] **Step 7: Commit**

```bash
cd /home/user/on
git add js/following.ts tests/following.test.js
git commit -m "fix(following): stop republishing a following list the server emptied — G6

syncFollowingFromServer's 'push local up (migration)' branch fires whenever the
server list is empty and the device's is not — which is exactly what a purge of
the peer's last followee produces. It rewrites {code, label} straight from
localStorage, which is why the restore's dry run reported the resurrected path
as already-there.

Gated on whether this device has ever seen a server list with entries in it, so
it still fires for a device that never migrated and for the swallowed-first-write
repair, and prunes for every other. Deleting the branch outright would wipe a
pre-migration device's whole contact list; freezing it would leave two devices
disagreeing forever."
```

---

### Task 4: Correct the record and re-measure the bar

The spec's §9. G6 is filed as having no mitigation and as closing with G3; both
statements are now wrong in the repo's own docs.

**Files:**
- Modify: `docs/operator-panel-followups.md:452-513` (the G6 entry) and its
  at-a-glance table at `:16`
- Modify: `docs/HANDOFF.md` — "What's next" (`:22-42`), the branch-status block
  (`:134-150`), and the verification-state bar (`:240`)
- Modify: `docs/superpowers/specs/2026-08-03-g6-peer-republish-design.md` (status line)

- [ ] **Step 1: Run all four gates from the repo root**

```bash
cd /home/user/on && npx jest --maxWorkers=2
cd /home/user/on && npm run test:rules
cd /home/user/on/functions && npm test; cd /home/user/on
cd /home/user/on && npm run typecheck && npm run typecheck:scripts
cd /home/user/on && node scripts/prod.js
```

Record the actual suite/test counts. Web was 2123/2123 (88 suites) and functions
941/941 (32 suites) at `edb528c`; functions should be **unchanged** — nothing in
this plan touches `functions/`. If it moved, find out why before writing any
number down.

- [ ] **Step 2: Rewrite the G6 entry**

In `docs/operator-panel-followups.md`, the G6 section keeps its history and
changes its verdict. Replace the closing two paragraphs ("**The real fix is
G3's.** …" through the `PEER REPUBLISH` note) with, in this order:

1. **The author, named.** `js/following.ts`'s `syncFollowingFromServer`
   migration branch, the `{code, label}` shape matching the `already-there`
   verdict, and the three call sites ruled out (`:1130` returns early on a null
   `users/{T}`, `:1345` and `:1510` are user actions).
2. **The correction.** G6 does NOT close with G3: the author is a peer whose
   session was never revoked, whose token is valid and renewing, writing its own
   owner-only node. The two items share a sighting window and nothing else.
3. **The fix, both halves**, with the rules predicate quoted and the reason it is
   `presence/code` rather than `users/{T}`.
4. **What remains open**: the other peer-writable families from the spec's §4.1
   table, each needing a user action on a ghost row; and existing dangling
   entries in production, which the guard does not sweep.

Update the at-a-glance table row for G6 from a known gap with no mitigation to
CLOSED, with the commit refs, keeping it in the table like G2/G5/G7 because
*why the "closes with G3" reading survived* is the useful part.

- [ ] **Step 3: Update `docs/HANDOFF.md`**

- "What's next": G3 stands alone. Strike "Close G3 and G6 closes with it" and
  the "G6 has no mitigation" claim; point at the spec and this plan.
- Branch status: the new commit list and the ahead-count of
  `claude/knockknock-g3-g6-revocation-cy2i0n` against `origin/dev` (`22abc8a`).
- Verification state: the bar measured in Step 1, at the new tip.
- The landmines list: add the forgeable-predicate lesson — *an existence check is
  only as strong as who can create the node it checks*, with
  `users/$uid/followers/$follower` as the case that makes `users/{T}.exists()`
  worthless.
- ⚠️ Note that `database.rules.json` now carries an undeployed behaviour change,
  beside the three production behaviour changes `dev` already carries. Rules
  deploy independently of hosting and functions (`firebase deploy --only
  database`) and bind every client immediately, including ones nobody can update.
  Nothing deploys from sessions; `docs/DEPLOY-PROD.md` is the runbook.

- [ ] **Step 4: Mark the spec implemented**

Change the spec's status line to record that the design was implemented, with
the three commit refs, and keep the rest of the document as written — it is the
reasoning, not a checklist.

- [ ] **Step 5: Commit**

```bash
cd /home/user/on
git add docs/
git commit -m "docs: G6 closed — the author named, and it does not close with G3

Records the fix, the corrected relationship to G3, the green bar at this tip,
and the families the fix deliberately leaves open. Adds the landmine the
predicate cost: an existence check is only as strong as who can create the node
it checks."
```

- [ ] **Step 6: Push**

```bash
cd /home/user/on && git push -u origin claude/knockknock-g3-g6-revocation-cy2i0n
```

Retry up to four times with 2s/4s/8s/16s backoff on a network failure. Do not
open a PR and do not merge to `dev` — the maintainer merges.

---

## What this plan does not do

- **G3.** Untouched. No revocation-time storage, no `auth.token.auth_time`
  comparison, no decision about a mid-session client whose token is refused.
- **Sweep existing residue.** The guard refuses new writes; entries already
  dangling in production stay until something deletes them.
  `integrity.js`'s `follow-dangling` is how they are found.
- **Surface swallowed write failures.** Every `setFollowingEntry` call site
  discards its rejection, so a follow refused by the new rule looks to the user
  like one that worked and then vanished. Spec §8; its own item.
- **Prove anything live.** No session container has ever held a service-account
  credential. The emulator is the rules engine's stand-in; a live re-sighting of
  G6 is not reproducible on demand and is not attempted.
