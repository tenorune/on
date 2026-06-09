# Request-to-follow a Group Co-member — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user in a group send a 1:1 follow request to a co-member they don't already follow; the target approves/declines in the Inbox, and on approval the requester becomes a follower — a relationship independent of group membership (Groups §11).

**Architecture:** Two Phase-B-clean RTDB mailboxes mirroring `pendingInvites`: a **request** mailbox (`followRequests/{target}/{requester}`) conveys consent + a push to the target; a **grant** mailbox (`followGrants/{requester}/{target}`) hands the target's share code back so the **requester** completes the follow itself (using the same `setFollowingEntry` + `registerAsFollower` primitives as add-person). The roster row gains the existing ⋮ card-drawer affordance; the Inbox is extended to approve/decline; one Cloud Function notifies the target on request. "Requested" state is localStorage-only (per-device).

**Tech Stack:** Vanilla ES modules + Firebase RTDB (web SDK client; firebase-admin in `functions/`). Jest (jsdom) for `js/`; Jest (node, experimental-vm-modules) for `functions/`.

**Design spec:** `docs/superpowers/specs/2026-06-09-follow-a-group-member-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `js/db.js` | 6 mailbox primitives (`writeFollowRequest`, `watchFollowRequests`, `deleteFollowRequest`, `writeFollowGrant`, `watchFollowGrants`, `deleteFollowGrant`) | Modify |
| `js/followRequests.js` | Requester side: send request, `isRequested`/eligibility, the roster button, grant-watcher that completes the follow | **Create** |
| `js/inbox.js` | Target side: watch `followRequests`, render Approve/Decline rows, combined unseen-glow | Modify |
| `js/groupContext.js` | Roster rows: ⋮ card-drawer with bell + "Request to follow"; gesture guards for the drawer | Modify |
| `js/app.js` | Boot `initFollowGrants`; `initInbox(uid, code)`; route `followRequest` notification clicks | Modify |
| `js/features.js` | `FOLLOW_REQUESTS_ENABLED` flag | Modify |
| `functions/presence-core.js` | `followRequest` notification title | Modify |
| `functions/notifier.js` | `handleFollowRequest` | Modify |
| `functions/index.js` | `onFollowRequest` trigger | Modify |

**The "db-mock tax":** A suite that mocks `js/db.js` with an explicit factory breaks only if its **code-under-test calls** a new primitive (the missing export is `undefined` → "not a function"). That is `tests/inbox.test.js` (adds the new primitives) and the new `tests/followRequests.test.js` (mocks db itself). `tests/groupContext.test.js` mocks `followRequests.js`/`cardDrawer.js`, not new db exports. **Task 12 runs the full suite as the source of truth** for any straggler.

---

## Task 1: db.js mailbox primitives

**Files:**
- Modify: `js/db.js` (add after `deletePendingInvite`, ~line 354)
- Test: `tests/db.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `tests/db.test.js`. First extend the destructured `require('../js/db')` at the top of the file to include the six new names:

```js
  writeFollowRequest, watchFollowRequests, deleteFollowRequest,
  writeFollowGrant, watchFollowGrants, deleteFollowGrant,
```

Then append these tests:

```js
describe('follow request/grant mailboxes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('writeFollowRequest sets followRequests/{target}/{requester}', async () => {
    set.mockResolvedValueOnce();
    await writeFollowRequest('req', 'tgt', 'g1');
    expect(ref).toHaveBeenCalledWith({}, 'followRequests/tgt/req');
    expect(set).toHaveBeenCalledWith('mock-ref',
      expect.objectContaining({ from: 'req', groupId: 'g1', ts: expect.any(Number) }));
  });

  test('deleteFollowRequest removes followRequests/{target}/{requester}', async () => {
    remove.mockResolvedValueOnce();
    await deleteFollowRequest('tgt', 'req');
    expect(ref).toHaveBeenCalledWith({}, 'followRequests/tgt/req');
    expect(remove).toHaveBeenCalledWith('mock-ref');
  });

  test('watchFollowRequests subscribes to followRequests/{target} and maps empty', () => {
    let handler;
    onValue.mockImplementationOnce((_ref, cb) => { handler = cb; return () => {}; });
    const got = jest.fn();
    watchFollowRequests('tgt', got);
    expect(ref).toHaveBeenCalledWith({}, 'followRequests/tgt');
    handler({ exists: () => false, val: () => null });
    expect(got).toHaveBeenCalledWith({});
    handler({ exists: () => true, val: () => ({ req: { from: 'req', groupId: 'g1', ts: 1 } }) });
    expect(got).toHaveBeenCalledWith({ req: { from: 'req', groupId: 'g1', ts: 1 } });
  });

  test('writeFollowGrant sets followGrants/{requester}/{target} with target code', async () => {
    set.mockResolvedValueOnce();
    await writeFollowGrant('req', 'tgt', 'TGTCODE');
    expect(ref).toHaveBeenCalledWith({}, 'followGrants/req/tgt');
    expect(set).toHaveBeenCalledWith('mock-ref',
      expect.objectContaining({ from: 'tgt', code: 'TGTCODE', ts: expect.any(Number) }));
  });

  test('deleteFollowGrant removes followGrants/{requester}/{target}', async () => {
    remove.mockResolvedValueOnce();
    await deleteFollowGrant('req', 'tgt');
    expect(ref).toHaveBeenCalledWith({}, 'followGrants/req/tgt');
    expect(remove).toHaveBeenCalledWith('mock-ref');
  });

  test('watchFollowGrants subscribes to followGrants/{requester}', () => {
    let handler;
    onValue.mockImplementationOnce((_ref, cb) => { handler = cb; return () => {}; });
    const got = jest.fn();
    watchFollowGrants('req', got);
    expect(ref).toHaveBeenCalledWith({}, 'followGrants/req');
    handler({ exists: () => true, val: () => ({ tgt: { from: 'tgt', code: 'C', ts: 1 } }) });
    expect(got).toHaveBeenCalledWith({ tgt: { from: 'tgt', code: 'C', ts: 1 } });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/db.test.js -t "follow request/grant"`
Expected: FAIL — `writeFollowRequest is not a function` (and siblings).

- [ ] **Step 3: Implement the primitives**

In `js/db.js`, immediately after `deletePendingInvite` (the block ending ~line 354), add:

```js
// ── Follow requests (Groups §11) ─────────────────────────────────────────────
// Two Phase-B-clean mailboxes mirroring pendingInvites. The requester writes a
// request into the target's mailbox; on approve the target writes a grant (with
// THEIR share code) into the requester's mailbox; the requester completes the
// follow itself and clears the grant. Each party only ever writes its own data.

export async function writeFollowRequest(requesterUid, targetUid, groupId) {
  await set(ref(db, `followRequests/${targetUid}/${requesterUid}`), {
    from: requesterUid, groupId, ts: Date.now(),
  });
}

export function watchFollowRequests(targetUid, callback) {
  const reqRef = ref(db, `followRequests/${targetUid}`);
  return onValue(reqRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}

export async function deleteFollowRequest(targetUid, requesterUid) {
  await remove(ref(db, `followRequests/${targetUid}/${requesterUid}`));
}

export async function writeFollowGrant(requesterUid, targetUid, targetCode) {
  await set(ref(db, `followGrants/${requesterUid}/${targetUid}`), {
    from: targetUid, code: targetCode, ts: Date.now(),
  });
}

export function watchFollowGrants(requesterUid, callback) {
  const grantRef = ref(db, `followGrants/${requesterUid}`);
  return onValue(grantRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}

export async function deleteFollowGrant(requesterUid, targetUid) {
  await remove(ref(db, `followGrants/${requesterUid}/${targetUid}`));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/db.test.js -t "follow request/grant"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add js/db.js tests/db.test.js
git commit -m "feat(db): follow request/grant mailbox primitives"
```

---

## Task 2: followRequest notification title

**Files:**
- Modify: `functions/presence-core.js:39-44` (the `TITLES` map)
- Test: `functions/test/presence-core.test.js`

- [ ] **Step 1: Write the failing test**

In `functions/test/presence-core.test.js`, inside the existing `describe`/test that checks `buildMessage` (the block near line 50 with `buildMessage('knock', ...)`), add this assertion:

```js
    expect(buildMessage('followRequest', 'Cara')).toEqual({ title: 'Cara wants to follow you', body: '' });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd functions && npm test -- presence-core.test.js`
Expected: FAIL — `TITLES[type] is not a function` (followRequest missing).

- [ ] **Step 3: Implement the title**

In `functions/presence-core.js`, add one line to the `TITLES` map (no `GROUP_TITLES` entry — follow requests have no group variant):

```js
const TITLES = {
  knock: (name) => `${name} knocked`,
  call: (name) => `${name} is calling`,
  availability: (name) => `${name} is available`,
  invite: (name) => `${name} invited you to a group`,
  followRequest: (name) => `${name} wants to follow you`,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd functions && npm test -- presence-core.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/presence-core.js functions/test/presence-core.test.js
git commit -m "feat(functions): followRequest notification title"
```

---

## Task 3: handleFollowRequest + onFollowRequest trigger

**Files:**
- Modify: `functions/notifier.js` (add after `handleInvite`, ~line 66)
- Modify: `functions/index.js:7` (import) and end of file (trigger)
- Test: `functions/test/notifier.test.js`

- [ ] **Step 1: Write the failing tests**

In `functions/test/notifier.test.js`, add `handleFollowRequest` to the import on line 2, then append:

```js
describe('handleFollowRequest', () => {
  test('notifies the target using their own label for the requester', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/tgt/following/req': { label: 'Cara' },
      'userPrefs/tgt/pushTokens': { tokT: {} },
    }});
    await handleFollowRequest(deps, 'tgt', 'req', { from: 'req', groupId: 'g1', ts: 1 });
    expect(deps.send).toHaveBeenCalledWith(['tokT'],
      { title: 'Cara wants to follow you', body: '' },
      { type: 'followRequest', targetUid: 'req' });
  });

  test('falls back to the requester group displayName when not followed', async () => {
    const deps = makeDeps({ store: {
      'groups/g1/members/req/displayName': 'Req Name',
      'userPrefs/tgt/pushTokens': { tokT: {} },
    }});
    await handleFollowRequest(deps, 'tgt', 'req', { from: 'req', groupId: 'g1', ts: 1 });
    expect(deps.send).toHaveBeenCalledWith(['tokT'],
      { title: 'Req Name wants to follow you', body: '' },
      expect.objectContaining({ type: 'followRequest', targetUid: 'req' }));
  });

  test('no record / no from → no send', async () => {
    const deps = makeDeps();
    await handleFollowRequest(deps, 'tgt', 'req', null);
    await handleFollowRequest(deps, 'tgt', 'req', { ts: 1 });
    expect(deps.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd functions && npm test -- notifier.test.js`
Expected: FAIL — `handleFollowRequest is not a function`.

- [ ] **Step 3: Implement the handler + trigger**

In `functions/notifier.js`, after `handleInvite` (ends ~line 66), add:

```js
// A follow request landed in `followRequests/{targetUid}/{requesterUid}` (Groups
// §11). Notify the target unconditionally — like invites, this is directed and
// consensual, so there's no per-person opt-in gate. Name: the target's own label
// for the requester when they already follow them, else the requester's display
// name in the shared group the request came from. Payload carries type:'followRequest'
// and NO contextGroupId — the deep link opens the Inbox to approve/decline.
export async function handleFollowRequest(deps, targetUid, requesterUid, record) {
  if (!record || !record.from) return;
  const follow = await deps.getVal(`userPrefs/${targetUid}/following/${requesterUid}`);
  const name = (follow && follow.label)
    || await resolveGroupMemberName(deps, record.groupId, requesterUid);
  await sendToUser(deps, targetUid,
    buildMessage('followRequest', name),
    { type: 'followRequest', targetUid: requesterUid });
}
```

In `functions/index.js`, add `handleFollowRequest` to the import on line 7:

```js
import { handleKnock, handleCall, handleAvailability, handleGroupOverrideChange, handleInvite, handleFollowRequest } from './notifier.js';
```

And append at the end of the file (after `onInvite`):

```js
// A follow request was created in the target's mailbox. onValueCreated (not
// Written) so a re-request overwrite of the same {requesterUid} key doesn't
// re-fire; a re-request after a decline (key deleted, then recreated) does.
export const onFollowRequest = onValueCreated('/followRequests/{targetUid}/{requesterUid}', (event) => {
  return handleFollowRequest(makeDeps(), event.params.targetUid, event.params.requesterUid, event.data.val());
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd functions && npm test -- notifier.test.js`
Expected: PASS (3 new tests).

- [ ] **Step 5: Commit**

```bash
git add functions/notifier.js functions/index.js functions/test/notifier.test.js
git commit -m "feat(functions): notify target on follow request"
```

---

## Task 4: followRequests.js — send + requested state

**Files:**
- Create: `js/followRequests.js`
- Test: `tests/followRequests.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/followRequests.test.js`:

```js
// tests/followRequests.test.js
jest.mock('../js/db.js', () => ({
  writeFollowRequest: jest.fn().mockResolvedValue(undefined),
  watchFollowGrants: jest.fn(() => () => {}),
  deleteFollowGrant: jest.fn().mockResolvedValue(undefined),
  setFollowingEntry: jest.fn().mockResolvedValue(undefined),
  registerAsFollower: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/prefs.js', () => ({
  getFollowing: jest.fn(() => []),
}));

const db = require('../js/db.js');
const prefs = require('../js/prefs.js');
const {
  requestToFollow, isRequested, isFollowRequestEligible,
} = require('../js/followRequests.js');

beforeEach(() => {
  jest.clearAllMocks();
  try { localStorage.clear(); } catch { /* no-op */ }
  prefs.getFollowing.mockReturnValue([]);
});

describe('requestToFollow', () => {
  test('writes the request and marks it requested (persisted)', async () => {
    expect(isRequested('tgt')).toBe(false);
    await requestToFollow('me', 'tgt', 'g1');
    expect(db.writeFollowRequest).toHaveBeenCalledWith('me', 'tgt', 'g1');
    expect(isRequested('tgt')).toBe(true);
    expect(JSON.parse(localStorage.getItem('statusapp_follow_requested'))).toContain('tgt');
  });
});

describe('isFollowRequestEligible', () => {
  test('true when not already following', () => {
    prefs.getFollowing.mockReturnValue([{ userId: 'other' }]);
    expect(isFollowRequestEligible('tgt')).toBe(true);
  });
  test('false when already following', () => {
    prefs.getFollowing.mockReturnValue([{ userId: 'tgt' }]);
    expect(isFollowRequestEligible('tgt')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/followRequests.test.js`
Expected: FAIL — cannot find module `../js/followRequests.js`.

- [ ] **Step 3: Create the module (send + state + eligibility)**

Create `js/followRequests.js`:

```js
// js/followRequests.js
// Requester side of "request to follow a group co-member" (Groups §11).
// - requestToFollow: writes a consent request into the target's mailbox.
// - isFollowRequestEligible / createRequestFollowButton: the roster ⋮-drawer affordance.
// - initFollowGrants: watches the requester's grant mailbox and completes the follow.
//
// "Requested" is tracked per-device in localStorage only (MVP), so the button doesn't
// revert to "Request to follow" between asking and approval. A declined request leaves
// a stale local entry (the requester is never told of declines) until the follow
// eventually completes or storage clears — accepted for localStorage-only scope.

import {
  writeFollowRequest, watchFollowGrants, deleteFollowGrant,
  setFollowingEntry, registerAsFollower,
} from './db.js';
import { getFollowing } from './prefs.js';

const REQUESTED_KEY = 'statusapp_follow_requested';

// Read straight from localStorage every time so the state can't leak across the
// (single) module instance — and so it always reflects the current device state.
function readRequested() {
  try { return new Set(JSON.parse(localStorage.getItem(REQUESTED_KEY) || '[]')); }
  catch { return new Set(); }
}
function writeRequested(set) {
  try { localStorage.setItem(REQUESTED_KEY, JSON.stringify([...set])); } catch { /* quota */ }
}
function markRequested(uid) { const s = readRequested(); s.add(uid); writeRequested(s); }
function clearRequested(uid) { const s = readRequested(); if (s.delete(uid)) writeRequested(s); }

export function isRequested(targetUid) {
  return readRequested().has(targetUid);
}

// Offer the affordance only for co-members you don't already follow. (The roster
// already filters self out, so self is not re-checked here.)
export function isFollowRequestEligible(targetUid) {
  return !getFollowing().some((f) => f.userId === targetUid);
}

export async function requestToFollow(myUid, targetUid, groupId) {
  await writeFollowRequest(myUid, targetUid, groupId);
  markRequested(targetUid);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/followRequests.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add js/followRequests.js tests/followRequests.test.js
git commit -m "feat: followRequests send + requested-state + eligibility"
```

---

## Task 5: followRequests.js — the roster button

**Files:**
- Modify: `js/followRequests.js`
- Test: `tests/followRequests.test.js`

- [ ] **Step 1: Write the failing tests**

Add `createRequestFollowButton` to the `require(...)` destructure in `tests/followRequests.test.js`, then append:

```js
describe('createRequestFollowButton', () => {
  test('renders "Request to follow"; click sends and flips to disabled "Requested"', async () => {
    const btn = createRequestFollowButton('me', 'tgt', 'g1');
    expect(btn.textContent).toBe('Request to follow');
    expect(btn.disabled).toBe(false);
    btn.click();
    await Promise.resolve(); await Promise.resolve();
    expect(db.writeFollowRequest).toHaveBeenCalledWith('me', 'tgt', 'g1');
    expect(btn.textContent).toBe('Requested');
    expect(btn.disabled).toBe(true);
  });

  test('renders disabled "Requested" when already requested', () => {
    localStorage.setItem('statusapp_follow_requested', JSON.stringify(['tgt']));
    const btn = createRequestFollowButton('me', 'tgt', 'g1');
    expect(btn.textContent).toBe('Requested');
    expect(btn.disabled).toBe(true);
  });

  test('a click does not bubble to the row (knock guard)', () => {
    const btn = createRequestFollowButton('me', 'tgt', 'g1');
    const row = document.createElement('li');
    const onRow = jest.fn();
    row.addEventListener('click', onRow);
    row.appendChild(btn);
    btn.click();
    expect(onRow).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/followRequests.test.js -t "createRequestFollowButton"`
Expected: FAIL — `createRequestFollowButton is not a function`.

- [ ] **Step 3: Implement the button factory**

Append to `js/followRequests.js`:

```js
// The roster ⋮-drawer action. Shows "Request to follow", or a disabled "Requested"
// once asked (per-device). Stops its own pointer/click events so a tap never reaches
// the roster row's knock handler or long-press adoption.
export function createRequestFollowButton(myUid, targetUid, groupId) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'request-follow-btn';

  function paint() {
    const asked = isRequested(targetUid);
    btn.textContent = asked ? 'Requested' : 'Request to follow';
    btn.disabled = asked;
  }
  paint();

  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      await requestToFollow(myUid, targetUid, groupId);
    } catch {
      paint(); // write failed — re-enable so the user can retry
      return;
    }
    paint(); // now disabled "Requested"
  });

  return btn;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/followRequests.test.js`
Expected: PASS (6 tests total).

- [ ] **Step 5: Commit**

```bash
git add js/followRequests.js tests/followRequests.test.js
git commit -m "feat: roster request-to-follow button"
```

---

## Task 6: followRequests.js — grant-watcher completes the follow

**Files:**
- Modify: `js/followRequests.js`
- Test: `tests/followRequests.test.js`

- [ ] **Step 1: Write the failing tests**

Add `initFollowGrants` to the `require(...)` destructure in `tests/followRequests.test.js`, then append:

```js
describe('initFollowGrants', () => {
  test('on a grant: completes the follow (both primitives), deletes grant, clears requested', async () => {
    localStorage.setItem('statusapp_follow_requested', JSON.stringify(['tgt']));
    let cb;
    db.watchFollowGrants.mockImplementation((uid, fn) => { cb = fn; return () => {}; });

    initFollowGrants('me', 'MYCODE');
    expect(db.watchFollowGrants).toHaveBeenCalledWith('me', expect.any(Function));

    await cb({ tgt: { from: 'tgt', code: 'TGTCODE', ts: 1 } });

    expect(db.setFollowingEntry).toHaveBeenCalledWith('me', 'tgt', 'TGTCODE', '');
    expect(db.registerAsFollower).toHaveBeenCalledWith('tgt', 'me', 'MYCODE');
    expect(db.deleteFollowGrant).toHaveBeenCalledWith('me', 'tgt');
    expect(isRequested('tgt')).toBe(false);
  });

  test('ignores a grant with no code', async () => {
    let cb;
    db.watchFollowGrants.mockImplementation((uid, fn) => { cb = fn; return () => {}; });
    initFollowGrants('me', 'MYCODE');
    await cb({ tgt: { from: 'tgt', ts: 1 } });
    expect(db.setFollowingEntry).not.toHaveBeenCalled();
    expect(db.deleteFollowGrant).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/followRequests.test.js -t "initFollowGrants"`
Expected: FAIL — `initFollowGrants is not a function`.

- [ ] **Step 3: Implement the grant-watcher**

Append to `js/followRequests.js`:

```js
// Boot-time watcher (app.js) on the requester's own grant mailbox. When the target
// approves, they write a grant carrying their share code; here we complete the
// one-directional follow (requester → target) exactly as add-person does — their
// code into my following list + me into their followers list — then delete the grant
// and clear the local "Requested" marker. Idempotent if I already follow them.
// Durable: a grant left by an offline-at-approval requester is consumed on next load.
export function initFollowGrants(myUid, myCode) {
  return watchFollowGrants(myUid, async (grants) => {
    for (const [targetUid, grant] of Object.entries(grants || {})) {
      if (!grant || !grant.code) continue;
      try {
        await setFollowingEntry(myUid, targetUid, grant.code, '');
        await registerAsFollower(targetUid, myUid, myCode);
        await deleteFollowGrant(myUid, targetUid);
        clearRequested(targetUid);
      } catch {
        // Leave the grant in place; retried on the next tick / next load.
      }
    }
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/followRequests.test.js`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add js/followRequests.js tests/followRequests.test.js
git commit -m "feat: grant-watcher completes the follow on approval"
```

---

## Task 7: Inbox — watch follow requests + combined glow/count

**Files:**
- Modify: `js/inbox.js`
- Test: `tests/inbox.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/inbox.test.js`, extend the `jest.mock('../js/db.js', ...)` factory (top of file) to add:

```js
  watchFollowRequests: jest.fn(),
  deleteFollowRequest: jest.fn().mockResolvedValue(undefined),
  writeFollowGrant: jest.fn().mockResolvedValue(undefined),
```

Then append a describe block:

```js
describe('Inbox — follow requests', () => {
  // Drive both watchers: capture their callbacks so tests can push snapshots.
  function initWithCallbacks() {
    let inviteCb, frCb;
    db.watchPendingInvites.mockImplementation((uid, cb) => { inviteCb = cb; return () => {}; });
    db.watchFollowRequests.mockImplementation((uid, cb) => { frCb = cb; return () => {}; });
    initInbox('me', 'MYCODE');
    return { inviteCb, frCb };
  }

  test('subscribes via watchFollowRequests on init', () => {
    initWithCallbacks();
    expect(db.watchFollowRequests).toHaveBeenCalledWith('me', expect.any(Function));
  });

  test('a follow request alone makes the Inbox nav button appear and glow', () => {
    const { inviteCb, frCb } = initWithCallbacks();
    inviteCb({});
    frCb({ req: { from: 'req', groupId: 'g1', ts: 5 } });
    const btn = document.querySelector('#nav-row-inbox-slot .inbox-btn');
    expect(btn).not.toBeNull();
    expect(btn.classList.contains('unseen')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/inbox.test.js -t "follow requests"`
Expected: FAIL — `watchFollowRequests is not a function` / nav button null.

- [ ] **Step 3: Implement the subscription + combined keys/count**

In `js/inbox.js`:

(a) Extend the db import (line 6):

```js
import { watchPendingInvites, deletePendingInvite, readGroup, readMember,
  watchFollowRequests, deleteFollowRequest, writeFollowGrant } from './db.js';
```

(b) Add module state next to the existing `let _pending = {};` (line 13):

```js
let _myCode = null;
let _followRequests = {};        // requesterUid → { from, groupId, ts }
let _frUnsubscribe = null;
```

(c) Replace the seen/count helpers (lines 29–44) so they cover both mailboxes:

```js
function inviteKey(groupId, record) { return `${groupId}:${record?.ts ?? ''}`; }
function followRequestKey(reqUid, record) { return `fr:${reqUid}:${record?.ts ?? ''}`; }
function pendingKeys() { return Object.entries(_pending).map(([gid, r]) => inviteKey(gid, r)); }
function followRequestKeys() { return Object.entries(_followRequests).map(([uid, r]) => followRequestKey(uid, r)); }
function allKeys() { return pendingKeys().concat(followRequestKeys()); }
function totalCount() { return Object.keys(_pending).length + Object.keys(_followRequests).length; }
function hasUnseen() { return allKeys().some((k) => !_seen.has(k)); }
// Drop seen entries no longer live (declined/joined/approved) so the set can't grow
// unbounded and a future same-key item isn't pre-marked seen.
function pruneSeen() {
  const live = new Set(allKeys());
  let changed = false;
  for (const k of _seen) if (!live.has(k)) { _seen.delete(k); changed = true; }
  if (changed) persistSeen();
}
function markAllSeen() {
  let changed = false;
  for (const k of allKeys()) if (!_seen.has(k)) { _seen.add(k); changed = true; }
  if (changed) persistSeen();
}
```

(d) Replace `initInbox` (lines 46–58):

```js
export function initInbox(uid, code) {
  _myUid = uid;
  _myCode = code;
  loadSeen();
  const onChange = () => {
    pruneSeen();
    renderInboxNavSlot();
    refreshInboxModalIfOpen();
    if (totalCount() === 0) closeInboxModal();
  };
  if (_unsubscribe) _unsubscribe();
  _unsubscribe = watchPendingInvites(uid, (snap) => { _pending = snap || {}; onChange(); });
  if (_frUnsubscribe) _frUnsubscribe();
  _frUnsubscribe = watchFollowRequests(uid, (snap) => { _followRequests = snap || {}; onChange(); });
  installOverlayHandlerOnce();
}
```

(e) In `renderInboxNavSlot` (lines 64–77) swap the count + glow checks: replace `if (getPendingCount() === 0) return;` with `if (totalCount() === 0) return;`, and `if (hasUnseenInvite())` with `if (hasUnseen())`.

(f) `getPendingCount` stays as-is (invite-only; still used by existing tests).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/inbox.test.js -t "follow requests"`
Expected: PASS. Also run the whole file to confirm no regression: `npx jest tests/inbox.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add js/inbox.js tests/inbox.test.js
git commit -m "feat(inbox): watch follow requests + combined glow/count"
```

---

## Task 8: Inbox — render rows + Approve/Decline

**Files:**
- Modify: `js/inbox.js`
- Test: `tests/inbox.test.js`

- [ ] **Step 1: Write the failing tests**

Append to the `describe('Inbox — follow requests', ...)` block in `tests/inbox.test.js`:

```js
  test('renders a follow-request row and Approve writes a grant + deletes the request', async () => {
    db.readMember.mockResolvedValue({ displayName: 'Req Name' });
    const { inviteCb, frCb } = initWithCallbacks();
    inviteCb({});
    frCb({ req: { from: 'req', groupId: 'g1', ts: 5 } });

    await openInboxModal();
    const row = document.querySelector('.inbox-row[data-requester-id="req"]');
    expect(row).not.toBeNull();
    expect(row.querySelector('.inbox-row-text').textContent).toBe('Req Name wants to follow you.');

    row.querySelector('.inbox-approve-btn').click();
    await Promise.resolve(); await Promise.resolve();
    expect(db.writeFollowGrant).toHaveBeenCalledWith('req', 'me', 'MYCODE');
    expect(db.deleteFollowRequest).toHaveBeenCalledWith('me', 'req');
  });

  test('Decline deletes the request only (no grant)', async () => {
    db.readMember.mockResolvedValue({ displayName: 'Req Name' });
    const { inviteCb, frCb } = initWithCallbacks();
    inviteCb({});
    frCb({ req: { from: 'req', groupId: 'g1', ts: 5 } });

    await openInboxModal();
    document.querySelector('.inbox-row[data-requester-id="req"] .inbox-fr-decline-btn').click();
    await Promise.resolve();
    expect(db.deleteFollowRequest).toHaveBeenCalledWith('me', 'req');
    expect(db.writeFollowGrant).not.toHaveBeenCalled();
  });

  test('uses the viewer label for the requester when followed', async () => {
    // prefs.getFollowing mock returns uOwner1 labelled "Owner One"
    const { inviteCb, frCb } = initWithCallbacks();
    inviteCb({});
    frCb({ uOwner1: { from: 'uOwner1', groupId: 'g1', ts: 7 } });
    await openInboxModal();
    const row = document.querySelector('.inbox-row[data-requester-id="uOwner1"]');
    expect(row.querySelector('.inbox-row-text').textContent).toBe('Owner One wants to follow you.');
    expect(db.readMember).not.toHaveBeenCalledWith('g1', 'uOwner1');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/inbox.test.js -t "follow requests"`
Expected: FAIL — no `.inbox-row[data-requester-id]` is rendered.

- [ ] **Step 3: Implement row rendering + handlers**

In `js/inbox.js`, replace the body of `renderInboxModalRows` (lines 103–139) so it resolves and appends **both** kinds of rows:

```js
async function renderInboxModalRows() {
  const list = document.getElementById('inbox-modal-list');
  if (!list) return;
  const inviteEntries = Object.entries(_pending);
  const frEntries = Object.entries(_followRequests);

  // Lightweight in-flight state so the modal isn't blank while reads round-trip.
  list.innerHTML = '';
  if (inviteEntries.length + frEntries.length > 0) {
    const loading = document.createElement('li');
    loading.className = 'inbox-loading';
    loading.textContent = 'Loading…';
    list.appendChild(loading);
  }

  const following = getFollowing();
  const labelByUid = {};
  for (const f of following) labelByUid[f.userId] = f.label;

  // Invite rows. Inviter name: own label → their group displayName → fallback.
  const inviteRows = await Promise.all(inviteEntries.map(async ([groupId, record]) => {
    const needMember = !labelByUid[record.from];
    const [group, member] = await Promise.all([
      readGroup(groupId),
      needMember ? readMember(groupId, record.from) : Promise.resolve(null),
    ]);
    const inviterLabel = labelByUid[record.from] || member?.displayName || 'Someone';
    const groupName = group?.name || groupId;
    return buildInboxRow({ groupId, inviterLabel, groupName });
  }));

  // Follow-request rows. Requester name: own label → their shared-group displayName → fallback.
  const frRows = await Promise.all(frEntries.map(async ([requesterUid, record]) => {
    let requesterLabel = labelByUid[requesterUid];
    if (!requesterLabel && record.groupId) {
      const member = await readMember(record.groupId, requesterUid);
      requesterLabel = member?.displayName;
    }
    return buildFollowRequestRow({ requesterUid, requesterLabel: requesterLabel || 'Someone' });
  }));

  list.innerHTML = '';
  for (const row of inviteRows) list.appendChild(row);
  for (const row of frRows) list.appendChild(row);
}
```

Then add, after `buildInboxRow` (after line 170):

```js
function buildFollowRequestRow({ requesterUid, requesterLabel }) {
  const li = document.createElement('li');
  li.className = 'inbox-row';
  li.dataset.requesterId = requesterUid;

  const text = document.createElement('span');
  text.className = 'inbox-row-text';
  text.textContent = `${requesterLabel} wants to follow you.`;
  li.appendChild(text);

  const actions = document.createElement('div');
  actions.className = 'inbox-row-actions';

  const approveBtn = document.createElement('button');
  approveBtn.type = 'button';
  approveBtn.className = 'inbox-approve-btn primary-btn';
  approveBtn.textContent = 'Approve';
  approveBtn.addEventListener('click', () => handleApprove(requesterUid));
  actions.appendChild(approveBtn);

  const declineBtn = document.createElement('button');
  declineBtn.type = 'button';
  declineBtn.className = 'inbox-fr-decline-btn ghost-btn';
  declineBtn.textContent = 'Decline';
  declineBtn.addEventListener('click', () => handleFollowRequestDecline(requesterUid));
  actions.appendChild(declineBtn);

  li.appendChild(actions);
  return li;
}

async function handleApprove(requesterUid) {
  if (!_myUid || !_myCode) return;
  // Double-tap guard.
  const row = document.querySelector(`.inbox-row[data-requester-id="${requesterUid}"]`);
  const btn = row?.querySelector('.inbox-approve-btn');
  if (btn) { if (btn.disabled) return; btn.disabled = true; }
  // Hand the requester our code so their client completes the follow, then clear
  // the request. The requester's grant-watcher does the rest.
  await writeFollowGrant(requesterUid, _myUid, _myCode);
  await deleteFollowRequest(_myUid, requesterUid);
}

async function handleFollowRequestDecline(requesterUid) {
  if (!_myUid) return;
  await deleteFollowRequest(_myUid, requesterUid);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/inbox.test.js`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add js/inbox.js tests/inbox.test.js
git commit -m "feat(inbox): render follow-request rows with Approve/Decline"
```

---

## Task 9: app.js — boot grant-watcher, initInbox(code), route notification

**Files:**
- Modify: `js/app.js` (line 20 import, line 504 routing, line 530 init)
- Test: none (wiring; covered by module tests + Task 11 manual check). Verify via the full suite.

- [ ] **Step 1: Add the import**

In `js/app.js`, change line 20:

```js
import { initInbox, openInboxModal } from './inbox.js';
import { initFollowGrants } from './followRequests.js';
```

- [ ] **Step 2: Route followRequest notification clicks**

In `js/app.js`, in the `notification-click` handler (line 504), add a branch alongside the invite one:

```js
      if (e.data.data?.type === 'invite') { openInboxModal(); return; }
      if (e.data.data?.type === 'followRequest') { openInboxModal(); return; }
```

- [ ] **Step 3: Pass the code to initInbox and start the grant-watcher**

In `js/app.js`, replace line 530 (`initInbox(userId);`) with:

```js
  initInbox(userId, code);
  initFollowGrants(userId, code);
```

(`code` is destructured from `identity` at line 346: `const { userId, code } = identity;`.)

- [ ] **Step 4: Verify nothing is broken**

Run: `npx jest tests/inbox.test.js` — Expected: PASS (initInbox now always receives a code in app, tests already pass a code).
Run: `node --check js/app.js` — Expected: no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat(app): boot follow-grant watcher, pass code to inbox, route followRequest"
```

---

## Task 10: features flag

**Files:**
- Modify: `js/features.js`

- [ ] **Step 1: Add the flag**

Append to `js/features.js`:

```js
export const FOLLOW_REQUESTS_ENABLED = true; // Groups §11: request-to-follow a co-member.
```

- [ ] **Step 2: Commit**

```bash
git add js/features.js
git commit -m "feat: FOLLOW_REQUESTS_ENABLED flag"
```

---

## Task 11: groupContext — roster ⋮ drawer with Request to follow

**Files:**
- Modify: `js/groupContext.js` (imports near lines 25–27; roster row lines 186–222)
- Test: `tests/groupContext.test.js`

- [ ] **Step 1: Write the failing tests**

In `tests/groupContext.test.js`, add two mocks near the other `jest.mock` calls at the top. **`isFollowRequestEligible` defaults to `false`** so every existing roster test keeps its single-action bare-bell layout (bell appended directly, not collapsed into a drawer); only the new drawer test opts into `true`:

```js
jest.mock('../js/followRequests.js', () => ({
  isFollowRequestEligible: jest.fn(() => false),
  createRequestFollowButton: jest.fn(() => {
    const b = document.createElement('button');
    b.className = 'request-follow-btn';
    b.textContent = 'Request to follow';
    return b;
  }),
}));
jest.mock('../js/cardDrawer.js', () => ({
  createCardDrawer: jest.fn((actions) => {
    const t = document.createElement('button');
    t.className = 'card-drawer-toggle';
    t.dataset.actionCount = String(actions.length);
    return t;
  }),
  isCardDrawerOpen: jest.fn(() => false),
  closeCardDrawer: jest.fn(),
}));
```

Then add two tests inside the existing `describe('group roster render', …)` block (mirror its `enterGroupContext` + `membersCb` setup — see the bell test at ~line 321):

```js
  test('an eligible co-member gets a ⋮ drawer carrying the request-follow action', () => {
    const followRequests = require('../js/followRequests.js');
    followRequests.isFollowRequestEligible.mockReturnValue(true);
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });

    const row = document.querySelector('#group-roster [data-user-id="a"]');
    expect(row.querySelector('.card-drawer-toggle')).not.toBeNull();
    expect(followRequests.createRequestFollowButton).toHaveBeenCalledWith('me', 'a', 'G1');
  });

  test('a co-member you already follow keeps the bare bell (no drawer)', () => {
    const followRequests = require('../js/followRequests.js');
    followRequests.isFollowRequestEligible.mockReturnValue(false);
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ a: { role: 'member', displayName: 'Alice', joinedAt: 1 } });

    const row = document.querySelector('#group-roster [data-user-id="a"]');
    expect(row.querySelector('.card-drawer-toggle')).toBeNull();
    expect(row.querySelector('.notify-bell')).not.toBeNull();
  });
```

> The default `false` is what keeps the other roster tests green: with notifications on, an ineligible member has exactly one action (the bell), so the row appends it inline and `.notify-bell` stays directly queryable — unchanged from today.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/groupContext.test.js -t "request-follow"`
Expected: FAIL — no `.card-drawer-toggle` (drawer not wired yet).

- [ ] **Step 3: Implement the drawer assembly + gesture guards**

In `js/groupContext.js`:

(a) Add imports after line 27:

```js
import { createCardDrawer, isCardDrawerOpen } from './cardDrawer.js';
import { isFollowRequestEligible, createRequestFollowButton } from './followRequests.js';
import { FOLLOW_REQUESTS_ENABLED } from './features.js';
```

(`FOLLOW_REQUESTS_ENABLED` may be added to the existing `./features.js` import line instead.)

(b) Replace the bell block (lines 186–194) with an actions-array assembly:

```js
    const actions = [];
    if (NOTIFICATIONS_ENABLED && uid !== ownUserId) {
      // Group context has no Call feature; you can knock members and see their
      // availability — so no Call toggle.
      const bell = createNotifyBell(uid, {
        types: ['knock', 'availability'],
        onNeedPermission: () => { ensureNotificationsReady().catch(() => {}); },
      });
      actions.push({ el: bell, closesDrawer: false });
    }
    if (FOLLOW_REQUESTS_ENABLED && uid !== ownUserId && isFollowRequestEligible(uid)) {
      const reqBtn = createRequestFollowButton(ownUserId, uid, getCurrentGroupId());
      actions.push({ el: reqBtn, closesDrawer: true });
    }
    // >=2 right-side actions collapse behind the shared ⋮ drawer (like Direct);
    // exactly one is shown inline (an already-followed member keeps the bare bell).
    if (actions.length >= 2) {
      li.appendChild(createCardDrawer(actions));
    } else if (actions.length === 1) {
      li.appendChild(actions[0].el);
    }
```

(c) Extend the `knockBlocked` guard (lines 203–206) so a tap on the drawer toggle/slice, or any tap while a drawer is open, never drives a knock:

```js
      const knockBlocked = (e) =>
        e.target.closest('.notify-bell') ||
        e.target.closest('.notify-popover') ||
        e.target.closest('.card-drawer-toggle') ||
        e.target.closest('.card-drawer') ||
        isNotifyPopoverOpen() ||
        isCardDrawerOpen();
```

(d) Extend the long-press adoption `pointerdown` guard (after line 234's `.notify-bell` check) with the same drawer guards — add immediately after the `if (e.target.closest('.notify-bell')) return;` line:

```js
        // A press on the drawer toggle/slice, or while a drawer is open, belongs to
        // the drawer (or its dismissal) — not palette adoption.
        if (e.target.closest('.card-drawer-toggle') || e.target.closest('.card-drawer')) return;
        if (isCardDrawerOpen()) return;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/groupContext.test.js`
Expected: PASS (whole file, including the two new tests).

- [ ] **Step 5: Commit**

```bash
git add js/groupContext.js tests/groupContext.test.js
git commit -m "feat(groupContext): ⋮ drawer with request-to-follow on roster rows"
```

---

## Task 12: Full-suite verification + db-mock stragglers

**Files:**
- Possibly: any `tests/*.js` that mocks `js/db.js` and now breaks (per the db-mock tax).

- [ ] **Step 1: Run the entire web suite**

Run: `npx jest`
Expected: PASS. If a suite fails with `<newPrimitive> is not a function`, its code-under-test calls a new db export — add that export as a `jest.fn()` (sync watchers: `jest.fn(() => () => {})`; async writers: `jest.fn().mockResolvedValue(undefined)`) to that file's `jest.mock('../js/db.js', …)` factory. Re-run until green.

- [ ] **Step 2: Run the functions suite**

Run: `cd functions && npm test`
Expected: PASS.

- [ ] **Step 3: Lint (if configured)**

Run: `npm run lint --if-present`
Expected: clean (or no lint script).

- [ ] **Step 4: Commit any straggler fixes**

```bash
git add -A
git commit -m "test: db-mock stubs for follow request/grant primitives"
```

(Skip if Step 1 needed no changes.)

---

## Self-Review Notes (traceability to spec)

- **Data model** (`followRequests`, `followGrants`): Task 1.
- **Requester sends + Requested state**: Tasks 4–5.
- **Requester completes follow on grant (offline-durable)**: Task 6, wired in Task 9.
- **Target Inbox approve/decline + combined glow**: Tasks 7–8.
- **⋮ drawer affordance + eligibility + gesture guards**: Task 11 (flag in Task 10).
- **Notify target only (no group title), onValueCreated dedup**: Tasks 2–3.
- **Notification deep-link → Inbox**: Task 9 (SW already forwards `type` generically — no `sw.js` change).
- **localStorage-only Requested; declined-leaves-stale edge**: Task 4 (documented in module header).
- **Out of scope** (cross-device Requested, requester-notified-on-accept, grant pruning): not implemented, per spec.
