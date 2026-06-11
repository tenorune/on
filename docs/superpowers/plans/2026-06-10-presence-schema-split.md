# Presence Schema Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move knocks, calls, and revocations out of `users/{uid}` into top-level mailboxes and narrow the three `watchStatus` families to a `users/{uid}/presence/` subtree, so a knock/nav/social-graph write no longer re-fires presence watchers and each tick ships ~6 scalars instead of the whole node.

**Architecture:** Staged so every commit is green and the risky parts are isolated. Knocks (independent) → revocations mailbox → calls mailbox (the symmetric-mailbox call state machine) → presence-path narrowing (now safe, since callState/revokedFollowers no longer ride the watch) → Cloud Function path remaps → migration script. Flag-day rollout: no dual-write; functions+hosting+rules ship together; a one-shot admin script migrates live data.

**Tech Stack:** Vanilla ES modules + Firebase RTDB (web SDK client; firebase-admin in `functions/`). Jest (jsdom) for `js/`; Jest (node) for `functions/`.

**Spec:** `docs/superpowers/specs/2026-06-10-presence-schema-split-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `js/db.js` | All path remaps + new mailbox primitives (`watchPresence`, `watchRevocations`, `watchOwnCall`, `startCall`/`answerCall`/`endCall`, knock/revocation writers) | Modify |
| `js/knock.js` | `watchKnocksAdded`/`getKnocks`/`clearKnock` consume top-level path (no change — they call db.js); no edits expected | — |
| `js/following.js` | Auto-unfollow via `watchRevocations`; call state machine on `watchOwnCall`; followee watch → `watchPresence`; delete knock-skip + callState/revokedFollowers reads | Modify |
| `js/app.js` | Boot call-recovery + peer-ended via `watchOwnCall`; own-status via `watchPresence` (already `subscribeOwnStatus`) | Modify |
| `js/ownStatus.js` | `watchStatus` → `watchPresence` | Modify |
| `js/groupContext.js` | Roster member watch → `watchPresence` | Modify |
| `functions/index.js` | `onKnock`/`onCall`/`onAvailability` trigger paths | Modify |
| `functions/notifier.js` | `getVal` `status`/`code` → `presence/` | Modify |
| `database.rules.json` | Top-level `knocks`/`calls`/`revocations` entries | Modify |
| `scripts/migrate-presence.js` | One-shot admin migration | **Create** |
| Test suites for each | TDD + db-mock-tax stubs | Modify/Create |

**db-mock tax:** 18 suites mock `js/db.js`. A suite breaks only if its code-under-test calls a NEW primitive its factory doesn't stub — the final full-suite run (Task 7) is the source of truth. Add stubs only where a run reveals them.

---

## Task 1: Move knocks to a top-level mailbox

**Files:**
- Modify: `js/db.js` (`writeKnock` ~617, `getKnocks` ~638, `watchKnocksAdded` ~644, `clearKnock` ~652)
- Modify: `functions/index.js` (`onKnock` ~51); `database.rules.json`
- Modify: `js/following.js` (delete the dead knock-skip guard ~779-787)
- Test: `tests/db.test.js`, `functions/test/notifier.test.js` (no change—handler params identical; just confirm), `tests/following.test.js`

- [ ] **Step 1: Write the failing db tests.** In `tests/db.test.js`, add `onChildAdded` to the `firebase/database` mock factory and its destructure:

```js
// in the jest.mock('firebase/database', () => ({ ... })) factory, add:
  onChildAdded: jest.fn(),
// and in the require destructure add onChildAdded:
const { ref, get, update, set, remove, runTransaction, onValue, onChildAdded } = require('firebase/database');
```

Then append:

```js
describe('knocks moved to top-level mailbox', () => {
  beforeEach(() => jest.clearAllMocks());

  test('writeKnock targets knocks/{recipient}/{sender}', async () => {
    runTransaction.mockResolvedValueOnce({ committed: true });
    await writeKnock('rcpt', 'sndr', {});
    expect(ref).toHaveBeenCalledWith({}, 'knocks/rcpt/sndr');
  });

  test('getKnocks reads knocks/{recipient}', () => {
    get.mockReturnValueOnce(Promise.resolve({ exists: () => false }));
    getKnocks('me');
    expect(ref).toHaveBeenCalledWith({}, 'knocks/me');
  });

  test('watchKnocksAdded subscribes to knocks/{recipient}', () => {
    onChildAdded.mockImplementationOnce(() => () => {});
    watchKnocksAdded('me', jest.fn());
    expect(ref).toHaveBeenCalledWith({}, 'knocks/me');
  });

  test('clearKnock removes knocks/{recipient}/{sender}', () => {
    remove.mockReturnValueOnce(Promise.resolve());
    clearKnock('me', 'sndr');
    expect(ref).toHaveBeenCalledWith({}, 'knocks/me/sndr');
  });
});
```

Add `writeKnock, getKnocks, watchKnocksAdded, clearKnock` to the db require destructure if absent.

- [ ] **Step 2: Run** `npx jest tests/db.test.js -t "knocks moved"` — Expected: FAIL (paths still `users/...`).

- [ ] **Step 3: Implement** in `js/db.js` — change only the four paths:

```js
export async function writeKnock(recipientId, senderId, opts = {}) {
  const knockRef = ref(db, `knocks/${recipientId}/${senderId}`);
  await runTransaction(knockRef, (current) => {
    if (current === null) {
      const next = { count: 1, ts: Date.now() };
      if (opts.contextGroupId) next.contextGroupId = opts.contextGroupId;
      return next;
    }
    if (current.count >= 5) return; // abort
    const next = { count: current.count + 1, ts: Date.now() };
    if (opts.contextGroupId) next.contextGroupId = opts.contextGroupId;
    else if (current.contextGroupId) next.contextGroupId = current.contextGroupId;
    return next;
  });
}

export function getKnocks(myUserId) {
  return get(ref(db, `knocks/${myUserId}`));
}

export function watchKnocksAdded(myUserId, callback) {
  const knocksRef = ref(db, `knocks/${myUserId}`);
  return onChildAdded(knocksRef, (snap) => {
    callback(snap.key, snap.val());
  });
}

export function clearKnock(myUserId, senderId) {
  return remove(ref(db, `knocks/${myUserId}/${senderId}`));
}
```

- [ ] **Step 4: Update the onKnock trigger.** In `functions/index.js`, change `onKnock`:

```js
export const onKnock = onValueCreated('/knocks/{recipientId}/{senderId}', (event) => {
  return handleKnock(makeDeps(), event.params.recipientId, event.params.senderId, event.data.val());
});
```

(Handler params identical — no notifier.js change. The notifier test passes unchanged.)

- [ ] **Step 5: Delete the dead knock-skip guard.** In `js/following.js` `subscribeToFollowee`, remove the block (knocks no longer live under the watched node, so the only-knocks-changed case cannot occur):

```js
    const prevUserData = lastUserData.get(entry.userId);
    lastUserData.set(entry.userId, userData);
    if (editingSet.has(entry.userId)) return;
    updateFolloweeRow(entry, userData, myUserId);
```

(Removed: the `if (prevUserData && ... ) return;` comparison and its comment. `prevUserData` is now unused — delete the `const prevUserData` line too.)

- [ ] **Step 6: Rules.** In `database.rules.json`, add a top-level entry beside `pendingInvites`:

```json
    "knocks": {
      "$recipientUid": {
        ".read": true,
        ".write": true
      }
    },
```

- [ ] **Step 7: Run** `npx jest tests/db.test.js tests/knock.test.js tests/following.test.js` and `cd functions && npm test` — all PASS. `node -e "JSON.parse(require('fs').readFileSync('database.rules.json'))"` — valid.

- [ ] **Step 8: Commit**

```bash
git add js/db.js functions/index.js js/following.js database.rules.json tests/db.test.js
git commit -m "refactor: move knocks to top-level knocks/{recipient} mailbox"
```

---

## Task 2: Revocations mailbox

**Files:**
- Modify: `js/db.js` (`removeFollower` ~531, `registerAsFollower` ~482, new `watchRevocations`)
- Modify: `js/following.js` (auto-unfollow → mailbox watcher; drop the `revokedFollowers` read)
- Modify: `database.rules.json`
- Test: `tests/db.test.js`, `tests/following.test.js`

- [ ] **Step 1: Write failing db tests.** Append to `tests/db.test.js`:

```js
describe('revocations mailbox', () => {
  beforeEach(() => jest.clearAllMocks());

  test('removeFollower removes the follower and writes revocations/{follower}/{me}', async () => {
    remove.mockResolvedValue(); set.mockResolvedValue();
    await removeFollower('me', 'fol');
    expect(ref).toHaveBeenCalledWith({}, 'users/me/followers/fol');
    expect(ref).toHaveBeenCalledWith({}, 'revocations/fol/me');
    expect(set).toHaveBeenCalledWith('mock-ref', true);
  });

  test('registerAsFollower clears revocations/{me}/{target} before setting followers', async () => {
    remove.mockResolvedValue(); set.mockResolvedValue();
    await registerAsFollower('target', 'me', 'CODE');
    expect(ref).toHaveBeenCalledWith({}, 'revocations/me/target');
    expect(ref).toHaveBeenCalledWith({}, 'users/target/followers/me');
  });

  test('watchRevocations subscribes to revocations/{me}', () => {
    onValue.mockImplementationOnce(() => () => {});
    watchRevocations('me', jest.fn());
    expect(ref).toHaveBeenCalledWith({}, 'revocations/me');
  });
});
```

Add `removeFollower, registerAsFollower, watchRevocations` to the require destructure if absent.

- [ ] **Step 2: Run** `npx jest tests/db.test.js -t "revocations"` — FAIL.

- [ ] **Step 3: Implement** in `js/db.js`:

```js
export async function removeFollower(myUserId, followerUserId) {
  await remove(ref(db, `users/${myUserId}/followers/${followerUserId}`));
  await set(ref(db, `revocations/${followerUserId}/${myUserId}`), true);
}

export async function registerAsFollower(targetUserId, myUserId, myCode) {
  // Clear any prior revocation BEFORE writing the followers entry — not in
  // parallel. The receiver's revocation watcher can fire on either write
  // independently; if the followers set echoes before the revocation remove,
  // the auto-unfollow fires on the freshly-established relationship and the new
  // follow is silently undone. Sequential remove → set ensures the revocation
  // is gone by the time the followers update is observable.
  await remove(ref(db, `revocations/${myUserId}/${targetUserId}`));
  await set(ref(db, `users/${targetUserId}/followers/${myUserId}`), myCode);
}

// Subscribe to my own revocation mailbox: revocations/{me}/{revoker} = true
// means revoker removed me as a follower. Returns unsubscribe.
export function watchRevocations(myUserId, callback) {
  const revRef = ref(db, `revocations/${myUserId}`);
  return onValue(revRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}
```

- [ ] **Step 4: Flip the client.** In `js/following.js`:

(a) In `subscribeToFollowee`, DELETE the revocation block (the `if (userData.revokedFollowers && userData.revokedFollowers[myUserId]) { ... }`).

(b) In `initList` (where the followers/following watchers are set up — near the `watchFollowers`/`watchFollowing` subscriptions), add a single app-lifetime revocation watcher. Import `watchRevocations` from `./db.js`. Add module state `let unsubRevocations = null;` near the other unsubs, and:

```js
  if (unsubRevocations) unsubRevocations();
  unsubRevocations = watchRevocations(myUserId, (revokers) => {
    // A revoker key means that user removed me as a follower: drop them from my
    // following + tear down their presence watch (mirrors the old per-followee
    // revokedFollowers check, now once instead of N times).
    for (const revokerId of Object.keys(revokers || {})) {
      if (!getFollowing().some((f) => f.userId === revokerId)) continue;
      removeFollowing(revokerId);
      removeFollowingEntry(myUserId, revokerId).catch(() => {});
      const unsub = unsubscribers.get(revokerId);
      if (unsub) { unsub(); unsubscribers.delete(revokerId); }
      lastUserData.delete(revokerId);
    }
    renderList();
  });
```

(`removeFollowing`, `removeFollowingEntry`, `getFollowing`, `unsubscribers`, `lastUserData`, `renderList` are all already in scope in following.js.)

- [ ] **Step 5: Rules.** Add to `database.rules.json`:

```json
    "revocations": {
      "$revokedUid": {
        ".read": true,
        ".write": true
      }
    },
```

- [ ] **Step 6: Tests.** Update `tests/following.test.js`: add `watchRevocations: jest.fn(() => () => {})` to its db mock factory. Append a test:

```js
test('a revocation mailbox tick auto-unfollows the revoker', () => {
  let revCb;
  watchRevocations.mockImplementation((uid, cb) => { revCb = cb; return jest.fn(); });
  getFollowing.mockReturnValue([{ userId: 'u1', code: 'AAA111', label: 'A' }]);
  initList('me', 'MYCODE');
  revCb({ u1: true });
  expect(removeFollowing).toHaveBeenCalledWith('u1');
});
```

Add `watchRevocations` to the test's db require destructure, and `removeFollowing` to the store mock if not present (it is — store mock already has it).

- [ ] **Step 7: Run** `npx jest tests/db.test.js tests/following.test.js` — PASS. Validate rules JSON.

- [ ] **Step 8: Commit**

```bash
git add js/db.js js/following.js database.rules.json tests/db.test.js tests/following.test.js
git commit -m "refactor: revocations mailbox replaces revokedFollowers piggyback"
```

---

## Task 3: Call signaling — symmetric mailboxes (5b)

**Files:**
- Modify: `js/db.js` (replace `setCallState`/`clearCallState` with `startCall`/`answerCall`/`endCall`/`watchOwnCall`)
- Modify: `js/following.js` (the five call read-sites + gestures), `js/app.js` (boot recovery + peer-ended)
- Modify: `functions/index.js` (`onCall`), `database.rules.json`
- Test: `tests/db.test.js`, `tests/following.test.js`, `functions/test/notifier.test.js`

This is the highest-risk task — the call state machine. Implement the primitives + the read-site transforms below exactly.

- [ ] **Step 1: db primitives — failing tests.** Append to `tests/db.test.js`:

```js
describe('call mailboxes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('startCall writes both calls/{caller}.to and calls/{callee}.from atomically', async () => {
    update.mockResolvedValue();
    await startCall('caller', 'callee');
    // multi-path update on the root ref
    const arg = update.mock.calls[0][1];
    expect(arg['calls/caller']).toEqual(expect.objectContaining({ to: 'callee', ts: expect.any(Number) }));
    expect(arg['calls/callee']).toEqual(expect.objectContaining({ from: 'caller', ts: expect.any(Number) }));
  });

  test('answerCall sets answered on both records', async () => {
    update.mockResolvedValue();
    await answerCall('callee', 'caller');
    const arg = update.mock.calls[0][1];
    expect(arg['calls/callee/answered']).toBe(true);
    expect(arg['calls/caller/answered']).toBe(true);
  });

  test('endCall nulls both records', async () => {
    update.mockResolvedValue();
    await endCall('a', 'b');
    const arg = update.mock.calls[0][1];
    expect(arg['calls/a']).toBeNull();
    expect(arg['calls/b']).toBeNull();
  });

  test('watchOwnCall subscribes to calls/{uid}', () => {
    onValue.mockImplementationOnce(() => () => {});
    watchOwnCall('me', jest.fn());
    expect(ref).toHaveBeenCalledWith({}, 'calls/me');
  });
});
```

Add `startCall, answerCall, endCall, watchOwnCall` to the require destructure.

- [ ] **Step 2: Run** `npx jest tests/db.test.js -t "call mailboxes"` — FAIL.

- [ ] **Step 3: Implement primitives** in `js/db.js`, replacing `setCallState`/`clearCallState`:

```js
// ── Call signaling (symmetric mailboxes) ─────────────────────────────────────
// A live call between A and B writes BOTH calls/{A} and calls/{B}; each party
// watches only its own mailbox. `to` = I'm the caller, `from` = I'm the callee.
// `answered` flips true on both when the callee picks up (how the caller learns
// the call connected). Every transition is one atomic multi-path update.

export async function startCall(callerId, calleeId) {
  const ts = Date.now();
  await update(ref(db), {
    [`calls/${callerId}`]: { to: calleeId, ts },
    [`calls/${calleeId}`]: { from: callerId, ts },
  });
}

export async function answerCall(calleeId, callerId) {
  await update(ref(db), {
    [`calls/${calleeId}/answered`]: true,
    [`calls/${callerId}/answered`]: true,
  });
}

export async function endCall(aUid, bUid) {
  await update(ref(db), {
    [`calls/${aUid}`]: null,
    [`calls/${bUid}`]: null,
  });
}

// Subscribe to my own call mailbox. callback(record|null) where record is
// { to|from: peerId, ts, answered? }. Returns unsubscribe.
export function watchOwnCall(myUserId, callback) {
  const callRef = ref(db, `calls/${myUserId}`);
  return onValue(callRef, (snap) => {
    callback(snap.exists() ? snap.val() : null);
  });
}
```

- [ ] **Step 4: Run** `npx jest tests/db.test.js -t "call mailboxes"` — PASS.

- [ ] **Step 5: Rewrite the client call flow.** This replaces all five `callState` read-sites. In `js/following.js`:

(a) Imports: replace `setCallState, clearCallState` with `startCall, answerCall, endCall, watchOwnCall` from `./db.js`. Add module state near `callModeCalleeId`:

```js
let _incomingCall = null; // { from } when someone is ringing me; null otherwise
export function getIncomingCallFrom() { return _incomingCall?.from ?? null; }
```

(b) **Ring watcher** — in `initList`, add an app-lifetime own-call watcher (import `watchOwnCall`, `endCall`, etc.). Add `let unsubOwnCall = null;`:

```js
  if (unsubOwnCall) unsubOwnCall();
  unsubOwnCall = watchOwnCall(myUserId, (call) => {
    if (!CALL_ENABLED) return;
    // I am the caller and the callee just answered → enter the canvas.
    if (call && call.to && call.answered && callModeCalleeId === call.to) {
      const entry = getFollowing().find((f) => f.userId === call.to);
      const peerData = entry && lastUserData.get(call.to);
      if (entry) {
        const peerSurface = peerData?.paletteKey
          ? (getPaletteByKey(peerData.paletteKey)?.theme?.surface || '#1e293b') : '#1e293b';
        const myColor = getComputedStyle(document.documentElement).getPropertyValue('--my-status').trim() || '#22c55e';
        const peerColor = peerData?.statusColor || '#22c55e';
        enterCanvas(call.to, entry.label || entry.code, myUserId, myColor, peerColor, peerSurface, () => exitCallMode(myUserId))
          .catch((err) => console.error('enterCanvas (caller) failed:', err));
      }
      return;
    }
    // Someone is ringing me (I'm the callee, not yet in a call).
    const prevFrom = _incomingCall?.from ?? null;
    const nextFrom = (call && call.from && !call.answered && callModeCalleeId === null) ? call.from : null;
    if (prevFrom === nextFrom) {
      // Peer hung up / record cleared while I was in-call-or-canvas with them.
      if (!call && (callModeCalleeId !== null)) handlePeerEnded(myUserId);
      return;
    }
    _incomingCall = nextFrom ? { from: nextFrom } : null;
    // Repaint the ringer's row (and clear the old one if the ring moved).
    for (const uid of [prevFrom, nextFrom]) {
      if (!uid) continue;
      const entry = getFollowing().find((f) => f.userId === uid);
      const data = lastUserData.get(uid);
      if (entry && data) updateFolloweeRow(entry, data, myUserId);
    }
    if (!call && callModeCalleeId !== null) handlePeerEnded(myUserId);
  });
```

Add a `handlePeerEnded` helper (extracts the "partner left" logic that was in app.js's own-status watcher — see Step 6 for the body to move):

```js
function handlePeerEnded(myUserId) {
  const canvasScreen = document.getElementById('canvas-screen');
  if (canvasScreen && canvasScreen.classList.contains('active')) {
    import('./canvas.js').then(({ showPeerLeftDialog, exitCanvas }) => {
      showPeerLeftDialog(canvasScreen, 'Your partner', () => { exitCanvas(); exitCallMode(myUserId); });
    });
  } else {
    exitCallMode(myUserId);
  }
}
```

(c) **`enterCallMode`** — replace its peer-clear loop + `setCallState`:

```js
export function enterCallMode(calleeEntry, myUserId) {
  incrementMadeCallCount();
  // If someone was ringing me, end that incoming call first.
  if (_incomingCall?.from) { endCall(myUserId, _incomingCall.from).catch(() => {}); _incomingCall = null; }

  callModeCalleeId = calleeEntry.userId;
  startCall(myUserId, calleeEntry.userId).catch(() => {});
  // ...rest unchanged (callColor, glow on the callee card, renderList)...
```

(Keep the existing glow/renderList tail verbatim.)

(d) **`exitCallMode`** — replace `clearCallState` + peer-clear:

```js
export function exitCallMode(myUserId) {
  const prevCalleeId = callModeCalleeId;
  callModeCalleeId = null;
  if (prevCalleeId) {
    endCall(myUserId, prevCalleeId).catch(() => {});
    const li = document.querySelector(`[data-user-id="${prevCalleeId}"]`);
    if (li) { li.classList.remove('call-mode'); li.style.removeProperty('--call-color-rgb'); }
  }
  renderList();
}
```

(e) **`reEnterCallMode`** — unchanged (no Firebase write; state already persisted).

(f) **The ring affordance** in `updateFolloweeRow` (~lines 811-814) — replace the callState read with `_incomingCall`:

```js
  const isCallee = CALL_ENABLED && callModeCalleeId !== null && entry.userId === callModeCalleeId;
  const isCallModeReceiver = CALL_ENABLED && !isCallee
    && _incomingCall?.from === entry.userId
    && !isCardDrawerOpen();
```

(g) **The caller-detects-answer block** in `updateFolloweeRow` (~lines 887-898) — DELETE it entirely; the own-call watcher (Step 5b) now drives caller→canvas. (Remove the `if (isCallee && userData.callState?.calleeId === myUserIdRef) { ... enterCanvas ... }` block.)

(h) **The swipe-answer handler** (~lines 575-588) — replace `setCallState(myUserId, entry.userId)` with `answerCall(myUserId, entry.userId)`, and clear `_incomingCall`:

```js
        if (li.classList.contains('call-mode') && callModeCalleeId !== entry.userId) {
          incrementAnsweredCallCount();
          const peerData = lastUserData.get(entry.userId);
          const peerSurface = peerData?.paletteKey
            ? (getPaletteByKey(peerData.paletteKey)?.theme?.surface || '#1e293b') : '#1e293b';
          const myColor = getComputedStyle(document.documentElement).getPropertyValue('--my-status').trim() || '#22c55e';
          const peerColor = peerData?.statusColor || '#22c55e';
          callModeCalleeId = entry.userId;
          _incomingCall = null;
          answerCall(myUserId, entry.userId).catch(() => {});
          enterCanvas(entry.userId, entry.label || entry.code, myUserId, myColor, peerColor, peerSurface, () => exitCallMode(myUserId))
            .catch((err) => console.error('enterCanvas failed:', err));
        } else if (!li.classList.contains('call-mode')) {
          enterCallMode(entry, myUserId);
        }
```

NOTE: the swipe handler decides "glowing card" via `li.classList.contains('call-mode')`. The ring repaint (5b) must add the `call-mode` class to the ringer's row so swipe-right answers it. In `updateFolloweeRow`, where `isCallModeReceiver` is true, ensure the row gets `call-mode` + `--call-color-rgb` (it renders the "Calling you…" text today but verify the glow class is applied for the receiver — if not, add `li.classList.add('call-mode')` in the `isCallModeReceiver` branch and set `--call-color-rgb`). Report whether the receiver glow was already applied or you added it.

(i) **The receiver-decline swipe-left** (~lines 598-603) — replace `clearCallState(entry.userId)`:

```js
          } else {
            li.classList.remove('call-mode');
            li.style.removeProperty('--call-color-rgb');
            endCall(myUserIdRef, entry.userId).catch(() => {});
            _incomingCall = null;
          }
```

(j) **The card-drawer-close repaint hook** (~lines 978-986) — replace `data.callState?.calleeId !== myUserIdRef`:

```js
document.addEventListener('card-drawer-close', () => {
  if (getIncomingCallFrom() === null && callModeCalleeId === null) return;
  renderedFollowees.forEach((userId) => {
    if (editingSet.has(userId)) return;
    const data = lastUserData.get(userId);
    if (!data) return;
    if (getIncomingCallFrom() !== userId && callModeCalleeId !== userId) return;
    const entry = getFollowing().find((f) => f.userId === userId);
    if (entry) updateFolloweeRow(entry, data, myUserIdRef);
  });
});
```

- [ ] **Step 6: app.js boot recovery + remove the own-status call logic.** In `js/app.js`:

(a) DELETE the entire call logic from the `subscribeOwnStatus` callback — the `if (!callModeHandled) { ... }` / `else if (... !userData.callState)` blocks and the `callModeHandled` flag. The own-status (presence) watch no longer carries call state. Keep any non-call logic in that callback (theme/render).

(b) Add a boot-time own-call recovery via `watchOwnCall`. Where call-mode is initialized at boot (near `initList`), import `watchOwnCall`, `endCall`, `getUser`, `reEnterCallMode`, `getFollowing`. Add:

```js
  if (CALL_ENABLED) {
    let callRecoveryHandled = false;
    watchOwnCall(userId, async (call) => {
      if (callRecoveryHandled) return;   // one-shot: the live ring/answer flow in following.js owns subsequent ticks
      callRecoveryHandled = true;
      if (!call) return;
      const peerId = call.to || call.from;
      const entry = getFollowing().find((e) => e.userId === peerId);
      if (!entry) { endCall(userId, peerId).catch(() => {}); return; }
      // Validate the peer's mirror record still points at me; else self-clean.
      try {
        const peerData = await getUser(peerId); // presence read; existence check
        if (!peerData) { endCall(userId, peerId).catch(() => {}); return; }
        if (call.answered || call.from) {
          // Already-connected call (either role) or an unanswered incoming ring:
          // re-enter (reEnterCallMode for an active call; an unanswered ring will
          // render via following.js's own-call watcher on its first tick).
          if (call.answered) reEnterCallMode(entry, peerData, userId);
        }
      } catch { endCall(userId, peerId).catch(() => {}); }
    });
  }
```

NOTE: following.js's `unsubOwnCall` watcher and this app.js recovery watcher both subscribe `calls/{me}`. Two `onValue` listeners on one path is fine (Firebase dedups the network read). The app.js one is one-shot recovery; following.js owns the live flow. Confirm no double-enter: the app.js handler only `reEnterCallMode`s on `answered`; following.js's handler enters the canvas for the caller on the `answered` transition and renders the ring for the callee — on a fresh boot into an already-answered call, app.js re-enters call-mode (glow + state) and following.js's first tick sees `answered` + `callModeCalleeId` set by reEnterCallMode → caller path, OR for the callee re-enters via the canvas. Walk this in the tests; if double-enter occurs, gate following.js's caller-answer branch on a transition (only act when `answered` flips false→true, tracked via a `_lastOwnCall` snapshot). Report which guard you used.

- [ ] **Step 7: onCall trigger + guard.** In `functions/index.js`:

```js
export const onCall = onValueWritten('/calls/{uid}', (event) => {
  const after = event.data.after.val();
  const before = event.data.before.val();
  // Notify only on a fresh, unanswered INCOMING ring (the callee's mailbox).
  // The caller's own `to` record and any `answered` write are skipped.
  if (!after || !after.from || after.answered) return null;
  if (before && before.from === after.from) return null;
  return handleCall(makeDeps(), event.params.uid, after.from);
});
```

The handler signature changes: `handleCall(deps, calleeId, callerId)`. In `functions/notifier.js`, update `handleCall`:

```js
export async function handleCall(deps, calleeId, callerId) {
  const prefs = await deps.getVal(`userPrefs/${calleeId}/notify/${callerId}`);
  if (!wantsCall(prefs)) return;
  const name = await resolveName(deps, calleeId, callerId);
  await sendToUser(deps, calleeId, buildMessage('call', name), { type: 'call', targetUid: callerId });
}
```

Update `functions/test/notifier.test.js`'s `handleCall` describe to call `handleCall(deps, 'callee', 'caller')` and assert the same send (the existing tests pass `(deps, callerId, callState)` — rewrite to the new 2-arg signature; the store keys for prefs/name are unchanged: `userPrefs/callee/notify/caller`).

- [ ] **Step 8: Rules.** Add to `database.rules.json`:

```json
    "calls": {
      "$uid": {
        ".read": true,
        ".write": true
      }
    },
```

- [ ] **Step 9: following/app tests.** In `tests/following.test.js`: swap `setCallState`/`clearCallState` mocks for `startCall`/`answerCall`/`endCall`/`watchOwnCall` in the db factory (all `jest.fn().mockResolvedValue(undefined)`, watchOwnCall `jest.fn(() => () => {})`). Add tests:

```js
test('a ring (own-call from) marks incoming', () => {
  let ownCallCb;
  watchOwnCall.mockImplementation((uid, cb) => { ownCallCb = cb; return jest.fn(); });
  watchStatus.mockReturnValue && watchStatus.mockReturnValue(jest.fn()); // if still present
  getFollowing.mockReturnValue([{ userId: 'caller', code: 'C', label: 'Cara' }]);
  initList('me', 'MYCODE');
  ownCallCb({ from: 'caller', ts: 1 });
  expect(getIncomingCallFrom()).toBe('caller');
});

test('endCall fires when I exit call mode', () => {
  watchOwnCall.mockImplementation(() => jest.fn());
  initList('me', 'MYCODE');
  enterCallMode({ userId: 'callee' }, 'me');
  exitCallMode('me');
  expect(endCall).toHaveBeenCalledWith('me', 'callee');
});
```

(Import `getIncomingCallFrom`, `enterCallMode`, `exitCallMode`, `watchOwnCall`, `startCall`, `answerCall`, `endCall` in the test. The `watchStatus` line is only needed until Task 4 replaces it with `watchPresence` — drop it then.)

- [ ] **Step 10: Run** `npx jest tests/db.test.js tests/following.test.js` and `cd functions && npm test` — PASS. Validate rules JSON. Report any double-enter guard added.

- [ ] **Step 11: Commit**

```bash
git add js/db.js js/following.js js/app.js functions/index.js functions/notifier.js database.rules.json tests/db.test.js tests/following.test.js functions/test/notifier.test.js
git commit -m "refactor: symmetric call mailboxes; call detection off the presence watch"
```

---

## Task 4: Narrow the presence watch path

**Files:**
- Modify: `js/db.js` (presence writers; `watchStatus` → `watchPresence`; `initUser`; `getUser`; `setLastVisited` → userPrefs; delete legacy `setUserFavorites`/`setLastTimeoutMinutes` if unused)
- Modify: `js/ownStatus.js`, `js/following.js`, `js/groupContext.js` (repoint to `watchPresence`)
- Test: `tests/db.test.js` + the consumer suites

- [ ] **Step 1: Failing db tests.** Append to `tests/db.test.js`:

```js
describe('presence subtree', () => {
  beforeEach(() => jest.clearAllMocks());

  test('setStatus writes under users/{uid}/presence', async () => {
    update.mockResolvedValue();
    await setStatus('me', 'available', 123);
    expect(ref).toHaveBeenCalledWith({}, 'users/me/presence');
    expect(update).toHaveBeenCalledWith('mock-ref', expect.objectContaining({ status: 'available', availableUntil: 123 }));
  });

  test('setStatusColor / setPaletteKey / touchLastSeen write under presence', async () => {
    update.mockResolvedValue();
    await setStatusColor('me', '#fff');
    await setPaletteKey('me', 'iris');
    await touchLastSeen('me');
    expect(ref).toHaveBeenCalledWith({}, 'users/me/presence');
  });

  test('watchPresence subscribes to users/{uid}/presence and returns the subtree', () => {
    let handler;
    onValue.mockImplementationOnce((_r, cb) => { handler = cb; return () => {}; });
    const got = jest.fn();
    watchPresence('me', got);
    expect(ref).toHaveBeenCalledWith({}, 'users/me/presence');
    handler({ exists: () => true, val: () => ({ status: 'available' }) });
    expect(got).toHaveBeenCalledWith({ status: 'available' });
    handler({ exists: () => false, val: () => null });
    expect(got).toHaveBeenCalledWith(null);
  });

  test('setLastVisited writes to userPrefs/{uid}/perGroup/{gid}/lastVisited', async () => {
    update.mockResolvedValue();
    await setLastVisited('me', 'G1', 99);
    expect(ref).toHaveBeenCalledWith({}, 'userPrefs/me');
    expect(update).toHaveBeenCalledWith('mock-ref', { 'perGroup/G1/lastVisited': 99 });
  });
});
```

Add `setStatus, setStatusColor, setPaletteKey, touchLastSeen, watchPresence, setLastVisited` to the require destructure.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** in `js/db.js`:

```js
export function watchPresence(userId, callback) {
  const presRef = ref(db, `users/${userId}/presence`);
  return onValue(presRef, (snap) => {
    callback(snap.exists() ? snap.val() : null);
  });
}

export async function setStatus(userId, status, availableUntil) {
  await update(ref(db, `users/${userId}/presence`), {
    status,
    availableUntil: availableUntil ?? null,
    lastSeen: Date.now(),
  });
}

export async function writeBackExpired(userId) {
  await update(ref(db, `users/${userId}/presence`), {
    status: 'unavailable',
    availableUntil: null,
  });
}

export async function setStatusColor(userId, color) {
  await update(ref(db, `users/${userId}/presence`), { statusColor: color });
}

export async function setPaletteKey(userId, paletteKey) {
  await update(ref(db, `users/${userId}/presence`), { paletteKey: paletteKey ?? null });
}

export async function touchLastSeen(userId) {
  await update(ref(db, `users/${userId}/presence`), { lastSeen: Date.now() });
}

export async function setLastVisited(userId, groupId, ts) {
  await update(ref(db, `userPrefs/${userId}`), { [`perGroup/${groupId}/lastVisited`]: ts });
}
```

In `initUser` (~line 74), seed presence: `await set(ref(db, \`users/${userId}/presence\`), { status: 'unavailable', availableUntil: null, code });` — and keep `code` ALSO at the top level only if anything reads `users/{uid}/code` (the followers fan-out reads the follower entry, not this; functions read presence/code after Task 5). Put `code` in presence; the top-level `code` field is dropped.

In `rotateCode` (~line 573), change `update(ref(db, \`users/${userId}\`), { code: newCode })` → `update(ref(db, \`users/${userId}/presence\`), { code: newCode })`. The followers fan-out loop stays.

In `getUser` (~612), keep reading the whole node `users/{userId}` (callers use it for existence + presence fields; after migration the presence fields are nested — see consumer note). For app.js boot recovery `getUser(peerId)` is used as an existence + statusColor source: change it to read `users/{userId}/presence` so `calleeData.statusColor` resolves:

```js
export async function getUser(userId) {
  const snap = await get(ref(db, `users/${userId}/presence`));
  return snap.exists() ? snap.val() : null;
}
```

(`userExists` keeps reading `users/{userId}` — a user without presence still exists; verify no caller of `getUser` needs non-presence fields. The two callers are app.js call-recovery (presence ok) and following.js code-rotation paths via `entry` — grep to confirm.)

DELETE the now-unused legacy writers `setUserFavorites` and `setLastTimeoutMinutes` (favorites + lastTimeoutMinutes live in userPrefs via prefs.js; grep confirms nothing imports these db.js ones). If grep finds importers, KEEP them and report.

- [ ] **Step 4: Repoint consumers.** The presence fields keep their names, so consumer callbacks reading `data.status` etc. work once pointed at `watchPresence` (which returns the presence subtree).

(a) `js/ownStatus.js`: `import { watchPresence } from './db.js';` and `_unsub = watchPresence(uid, (data) => { ... })` (was `watchStatus`). Callback body unchanged.

(b) `js/groupContext.js` `syncStatusSubscriptions` (~882): `watchStatus(uid, ...)` → `watchPresence(uid, ...)`. Callback body unchanged (reads `data.status/availableUntil/statusColor/paletteKey`).

(c) `js/following.js` `subscribeToFollowee` (~750): `watchStatus(entry.userId, ...)` → `watchPresence(entry.userId, (userData) => { ... })`. The body already had its revocation + knock-skip + callState reads removed (Tasks 1-3). What remains (expiry write-back, code self-heal, render) reads only presence fields — unchanged.

Remove now-unused `watchStatus` imports from these three files. Keep `watchStatus` exported from db.js ONLY if something still uses it — grep; if nothing does, delete it.

- [ ] **Step 5: Repoint test seams.** In `tests/following.test.js`, `tests/groupContext.test.js`, `tests/ownStatus.test.js`: the suites mock `watchStatus`; add `watchPresence` to each db factory and repoint the capture sites (`watchStatus.mockImplementation` → `watchPresence.mockImplementation`). Member-roster vs own seams as before. Assertions unchanged (presence field names identical).

- [ ] **Step 6: Run** `npx jest` (full) — investigate every failure; most are seam repoints. PASS.

- [ ] **Step 7: Commit**

```bash
git add js/db.js js/ownStatus.js js/groupContext.js js/following.js tests/
git commit -m "refactor: narrow presence watch to users/{uid}/presence; lastVisited to userPrefs"
```

---

## Task 5: Cloud Function presence-path remaps

**Files:**
- Modify: `functions/notifier.js` (`getVal` status/code), `functions/index.js` (`onAvailability`)
- Test: `functions/test/notifier.test.js`, `functions/test/presence-core.test.js` (no change)

- [ ] **Step 1: Failing notifier tests.** In `functions/test/notifier.test.js`, the handlers read `users/{uid}/status` and `users/{uid}/code` from the `store`. Update the affected tests' store keys to `users/{uid}/presence/status` and `users/{uid}/presence/code` and run — they FAIL against current handler paths.

- [ ] **Step 2: Implement.** In `functions/notifier.js`, change the four reads:

```js
// resolveName: code lookup
const code = await deps.getVal(`users/${targetUid}/presence/code`);   // resolveName
const code = await deps.getVal(`users/${uid}/presence/code`);          // resolveGroupMemberName
// notifyGroupAvailability:
const status = await deps.getVal(`users/${memberUid}/presence/status`);
const primaryAU = await deps.getVal(`users/${memberUid}/presence/availableUntil`);
// handleAvailability:
const status = await deps.getVal(`users/${uid}/presence/status`);
```

`users/${uid}/followers` and `users/${uid}/groups` reads STAY.

- [ ] **Step 3: onAvailability trigger.** In `functions/index.js`:

```js
export const onAvailability = onValueWritten('/users/{uid}/presence/availableUntil', (event) => {
  return handleAvailability(makeDeps(), event.params.uid, event.data.before.val(), event.data.after.val());
});
```

- [ ] **Step 4: Run** `cd functions && npm test` — PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/notifier.js functions/index.js functions/test/notifier.test.js
git commit -m "refactor(functions): read presence subtree; onAvailability on presence path"
```

---

## Task 6: One-shot migration script

**Files:**
- Create: `scripts/migrate-presence.js`
- Test: manual (admin script; not unit-tested — it's run once per environment by the maintainer)

- [ ] **Step 1: Create** `scripts/migrate-presence.js`:

```js
#!/usr/bin/env node
// One-shot, idempotent migration to the presence schema split.
// Usage: node scripts/migrate-presence.js --project <firebase-project-id>
// Requires GOOGLE_APPLICATION_CREDENTIALS (service account) for the target env.
// Run ONCE per environment, immediately before the functions+hosting+rules deploy.
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const projectArg = process.argv.indexOf('--project');
const projectId = projectArg >= 0 ? process.argv[projectArg + 1] : process.env.GCLOUD_PROJECT;
if (!projectId) { console.error('Pass --project <id>'); process.exit(1); }

initializeApp({ credential: cert(JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '{}')), databaseURL: `https://${projectId}-default-rtdb.firebaseio.com` });
const db = getDatabase();

const PRESENCE_FIELDS = ['status', 'availableUntil', 'statusColor', 'paletteKey', 'code', 'lastSeen'];

async function main() {
  const usersSnap = await db.ref('users').get();
  if (!usersSnap.exists()) { console.log('no users'); return; }
  const users = usersSnap.val();
  let migrated = 0;
  for (const [uid, u] of Object.entries(users)) {
    const updates = {};
    // 1. presence/* from top-level fields
    for (const f of PRESENCE_FIELDS) {
      if (u[f] !== undefined && (u.presence?.[f] === undefined)) updates[`users/${uid}/presence/${f}`] = u[f];
    }
    // 2. revokedFollowers → revocations/{revoker}/{uid}
    for (const revoker of Object.keys(u.revokedFollowers || {})) {
      updates[`revocations/${revoker}/${uid}`] = true;
    }
    // 3. delete migrated-away + legacy + transient
    for (const dead of ['status', 'availableUntil', 'statusColor', 'paletteKey', 'code', 'lastSeen',
                        'knocks', 'callState', 'revokedFollowers', 'favorites', 'lastTimeoutMinutes', 'currentContext']) {
      if (u[dead] !== undefined) updates[`users/${uid}/${dead}`] = null;
    }
    // 4. drop groups/{*}/lastVisited (sort hint; rebuilds)
    for (const gid of Object.keys(u.groups || {})) {
      if (u.groups[gid]?.lastVisited !== undefined) updates[`users/${uid}/groups/${gid}/lastVisited`] = null;
    }
    if (Object.keys(updates).length) { await db.ref().update(updates); migrated++; }
  }
  console.log(`migrated ${migrated} user(s)`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Smoke-check it parses.** Run `node --check scripts/migrate-presence.js` — no syntax errors. (No live run in CI; the maintainer runs it against dev/prod at deploy with credentials.)

- [ ] **Step 3: Document the deploy order.** Append to the spec's migration section a one-line runbook reference, or add `scripts/README-migrate-presence.md` with: (1) export the env's service-account JSON, (2) `node scripts/migrate-presence.js --project <id>`, (3) merge to `dev` (CI deploys functions+hosting+rules), (4) bump `sw.js` CACHE in that deploy.

```bash
git add scripts/migrate-presence.js scripts/README-migrate-presence.md
git commit -m "chore: one-shot presence-schema migration script + runbook"
```

---

## Task 7: Full-suite verification + db-mock stragglers

- [ ] **Step 1:** `npx jest` — PASS. For any `X is not a function` from a db-mocking suite whose code-under-test now calls a new primitive (`watchPresence`/`watchOwnCall`/`watchRevocations`/`startCall`/`answerCall`/`endCall`), add the minimal `jest.fn()` stub to that factory. Re-run until green. Known pre-existing flake: `recovery.test.js` "no account" race — verify in isolation before treating as flake.
- [ ] **Step 2:** `cd functions && npm test` — PASS.
- [ ] **Step 3:** `npm run lint --if-present` — clean/absent. `node -e "JSON.parse(require('fs').readFileSync('database.rules.json'))"` — valid.
- [ ] **Step 4:** Commit stragglers if any: `git add -A && git commit -m "test: db-mock stubs for presence/call/revocation primitives"`.
- [ ] **Step 5 (manual, pre-merge — NOT automatable):** on dev after deploy, verify: a knock delivers a push + deep-links; a full call round-trip (offer → ring → answer → canvas → hangup, both roles); a status flip propagates to a follower; an availability push fires. These exercise the real RTDB paths the unit tests can only mock.

---

## Self-Review Notes (spec traceability)

- §1 schema: knocks (T1), revocations (T2), calls symmetric mailboxes (T3), presence subtree + lastVisited→userPrefs + legacy deletes (T4).
- §2 writers: every remap has a task (T1 knock, T2 follower/revocation, T3 call primitives, T4 presence/lastVisited).
- §3 consumers: knock-skip delete (T1), revocation watcher (T2), full call state machine across all 5 read-sites + app.js boot/peer-ended (T3), 3-watcher narrowing (T4).
- §4 functions: onKnock (T1), onCall+guard+handleCall sig (T3), onAvailability+getVal remaps (T5).
- §5 rules: knocks (T1), revocations (T2), calls (T3).
- §6 migration: T6.
- §7 testing: per-task TDD + T7 full-suite + the manual call/knock/availability checklist (spec explicitly requires manual call round-trip).
- **Deliberate behavior change:** last-ring-wins (single-occupancy call mailbox) — spec §3, accepted; covered by the call-flow tests in T3.
- **Ordering invariant preserved:** `registerAsFollower` sequential remove→set moves to `revocations/` (T2) with the comment intact.
