# Presence Notifications — Server Delivery (`/functions`) — Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the app's first Cloud Functions backend — RTDB-triggered notifiers that, on a knock / incoming call / availability transition, gate on the recipient's per-person prefs and deliver an FCM push to their registered devices.

**Architecture:** Pure decision logic in `functions/presence-core.js` (unit-tested directly). A `functions/notifier.js` dispatch layer takes **injected** `getVal` / `update` / `send` / `now` dependencies, so every handler is unit-testable with plain fakes — **no emulator required**. `functions/index.js` is the thin wiring that binds `firebase-functions` v2 RTDB triggers to the notifier with real `firebase-admin` handles.

**Tech Stack:** Node 20, `firebase-functions` v6 (2nd-gen RTDB triggers), `firebase-admin` v12, Jest (node env, local to `functions/`).

**Companion spec:** `docs/superpowers/specs/2026-06-05-presence-notifications-design.md`. Depends on Plan 1's data model (`userPrefs/{uid}/notify/{target}`, `userPrefs/{uid}/pushTokens/{token}`).

**Ground-truth paths (verified 2026-06-05):**
- Knock: `users/{recipientId}/knocks/{senderId}` = `{ count, ts, contextGroupId? }` (created on first knock).
- Call: `users/{callerId}/callState` = `{ calleeId, since }` (on the caller's record).
- Status: `users/{uid}` fields `status`, `availableUntil` (ms|null), `lastSeen`. No boolean available flag.
- Followers: `users/{uid}/followers/{followerUid}` = `<code string>`.
- Prefs (from Plan 1): `userPrefs/{uid}/notify/{target}` = `{knock,call,availability}`; `userPrefs/{uid}/pushTokens/{token}` = `{createdAt, ua}`.

> **Confirm during execution:** the exact `status` string for "available" (assumed `'available'`). Check `js/me.js` / the `setStatus` callers. If different, adjust `isAvailable` in Task 2.

---

## File structure

**Create:**
- `functions/package.json`, `functions/index.js`, `functions/presence-core.js`, `functions/notifier.js`, `functions/jest.config.js`
- `functions/test/presence-core.test.js`, `functions/test/notifier.test.js`

**Modify:**
- `firebase.json` — add a `functions` section + predeploy.
- `database.rules.json` — explicit `notifierState` deny.
- `.github/workflows/deploy-dev.yml`, `.github/workflows/deploy-prod.yml`, `package.json` — add `functions` to deploy targets.

---

## Task 1: Scaffold the `/functions` package

**Files:**
- Create: `functions/package.json`, `functions/index.js`, `functions/jest.config.js`
- Modify: `firebase.json`

- [ ] **Step 1: Create `functions/package.json`**

```json
{
  "name": "knockknock-functions",
  "description": "Presence-notification Cloud Functions",
  "type": "module",
  "main": "index.js",
  "engines": { "node": "20" },
  "scripts": {
    "test": "jest --config jest.config.js"
  },
  "dependencies": {
    "firebase-admin": "^12.7.0",
    "firebase-functions": "^6.1.0"
  },
  "devDependencies": {
    "jest": "^30.3.0"
  }
}
```

- [ ] **Step 2: Create `functions/jest.config.js` (node env, ESM via Node)**

```js
export default {
  testEnvironment: 'node',
  transform: {},
};
```

> `transform: {}` disables babel; Node 20 + `"type":"module"` runs the ESM directly. Run Jest with the experimental VM modules flag (Step 6).

- [ ] **Step 3: Create a stub `functions/index.js`**

```js
// functions/index.js — RTDB-triggered presence notifiers (wired in later tasks).
```

- [ ] **Step 4: Add the `functions` section to `firebase.json`**

Add this top-level key (sibling of `database` / `hosting`):

```json
  "functions": {
    "source": "functions",
    "predeploy": ["npm --prefix \"$RESOURCE_DIR\" ci"]
  }
```

- [ ] **Step 5: Install deps**

Run: `cd functions && npm install`
Expected: `node_modules` created; no errors.

- [ ] **Step 6: Verify the test runner works**

Add to `functions/package.json` scripts: `"test": "node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.js --passWithNoTests"`

Run: `cd functions && npm test`
Expected: `No tests found ... passWithNoTests` → exit 0.

- [ ] **Step 7: Commit**

```bash
git add functions/package.json functions/index.js functions/jest.config.js firebase.json functions/package-lock.json
git commit -m "chore(functions): scaffold Cloud Functions package + firebase.json wiring"
```

---

## Task 2: `presence-core.js` — pure decision logic

**Files:**
- Create: `functions/presence-core.js`
- Test: `functions/test/presence-core.test.js`

- [ ] **Step 1: Write the failing tests**

Create `functions/test/presence-core.test.js`:

```js
import {
  isExpired, isAvailable, becameAvailable, withinCooldown,
  wantsKnock, wantsCall, wantsAvailability, buildMessage,
} from '../presence-core.js';

const NOW = 1_000_000;

describe('availability', () => {
  test('isExpired: null is never expired; past ms is expired', () => {
    expect(isExpired(null, NOW)).toBe(false);
    expect(isExpired(NOW - 1, NOW)).toBe(true);
    expect(isExpired(NOW + 1, NOW)).toBe(false);
  });
  test('isAvailable requires status available and a non-expired window', () => {
    expect(isAvailable({ status: 'available', availableUntil: NOW + 5 }, NOW)).toBe(true);
    expect(isAvailable({ status: 'available', availableUntil: NOW - 5 }, NOW)).toBe(false);
    expect(isAvailable({ status: 'unavailable', availableUntil: NOW + 5 }, NOW)).toBe(false);
    expect(isAvailable(null, NOW)).toBe(false);
  });
  test('becameAvailable only on a false→true transition', () => {
    const off = { status: 'unavailable', availableUntil: null };
    const on = { status: 'available', availableUntil: NOW + 5 };
    expect(becameAvailable(off, on, NOW)).toBe(true);
    expect(becameAvailable(on, on, NOW)).toBe(false); // re-up
    expect(becameAvailable(on, off, NOW)).toBe(false); // going offline
  });
});

describe('cooldown', () => {
  test('withinCooldown true if last fire is recent', () => {
    expect(withinCooldown(NOW - 1000, NOW, 5000)).toBe(true);
    expect(withinCooldown(NOW - 6000, NOW, 5000)).toBe(false);
    expect(withinCooldown(null, NOW, 5000)).toBe(false);
  });
});

describe('gates', () => {
  test('per-type gates read the prefs object', () => {
    expect(wantsKnock({ knock: true })).toBe(true);
    expect(wantsKnock({ knock: false })).toBe(false);
    expect(wantsKnock(null)).toBe(false);
    expect(wantsCall({ call: true })).toBe(true);
    expect(wantsAvailability({ availability: true })).toBe(true);
  });
});

describe('messages', () => {
  test('buildMessage composes title/body per type', () => {
    expect(buildMessage('knock', 'Bea')).toEqual({ title: 'Bea knocked', body: '' });
    expect(buildMessage('call', 'Alex K.')).toEqual({ title: 'Alex K. is calling', body: '' });
    expect(buildMessage('availability', 'Bea')).toEqual({ title: 'Bea is available', body: '' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm test -- presence-core`
Expected: FAIL — cannot find module `../presence-core.js`.

- [ ] **Step 3: Implement `functions/presence-core.js`**

```js
// functions/presence-core.js — pure, dependency-free decision logic.

export function isExpired(availableUntil, now) {
  return availableUntil != null && availableUntil < now;
}

export function isAvailable(node, now) {
  return !!node && node.status === 'available' && !isExpired(node.availableUntil, now);
}

export function becameAvailable(before, after, now) {
  return !isAvailable(before, now) && isAvailable(after, now);
}

export function withinCooldown(lastTs, now, cooldownMs) {
  return lastTs != null && (now - lastTs) < cooldownMs;
}

export function wantsKnock(prefs) { return !!(prefs && prefs.knock); }
export function wantsCall(prefs) { return !!(prefs && prefs.call); }
export function wantsAvailability(prefs) { return !!(prefs && prefs.availability); }

const TITLES = {
  knock: (name) => `${name} knocked`,
  call: (name) => `${name} is calling`,
  availability: (name) => `${name} is available`,
};

export function buildMessage(type, name) {
  return { title: TITLES[type](name), body: '' };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm test -- presence-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/presence-core.js functions/test/presence-core.test.js
git commit -m "feat(functions): presence-core pure decision logic"
```

---

## Task 3: `notifier.js` — delivery helper + knock handler (injected deps)

**Files:**
- Create: `functions/notifier.js`
- Test: `functions/test/notifier.test.js`

The notifier takes a `deps` object: `{ getVal(path), update(path, obj), send(tokens, message, data), now() }`. Real implementations live in `index.js` (Task 7); tests pass fakes.

- [ ] **Step 1: Write the failing tests**

Create `functions/test/notifier.test.js`:

```js
import { sendToUser, resolveName, handleKnock } from '../notifier.js';

function makeDeps(overrides = {}) {
  const store = overrides.store || {};
  return {
    store,
    getVal: jest.fn(async (path) => store[path]),
    update: jest.fn(async () => {}),
    send: jest.fn(async () => ({ failedTokens: [] })),
    now: () => 1000,
    ...overrides,
  };
}

describe('sendToUser', () => {
  test('no tokens → no send', async () => {
    const deps = makeDeps({ store: { 'userPrefs/u1/pushTokens': null } });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('sends to all registered tokens', async () => {
    const deps = makeDeps({ store: { 'userPrefs/u1/pushTokens': { tokA: {}, tokB: {} } } });
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, { type: 'knock' });
    expect(deps.send).toHaveBeenCalledWith(['tokA', 'tokB'], { title: 'hi', body: '' }, { type: 'knock' });
  });
  test('prunes failed tokens', async () => {
    const deps = makeDeps({ store: { 'userPrefs/u1/pushTokens': { tokA: {}, tokBad: {} } } });
    deps.send = jest.fn(async () => ({ failedTokens: ['tokBad'] }));
    await sendToUser(deps, 'u1', { title: 'hi', body: '' }, {});
    expect(deps.update).toHaveBeenCalledWith('userPrefs/u1/pushTokens', { tokBad: null });
  });
});

describe('resolveName', () => {
  test('prefers the viewer\'s following label, falls back to target code, then "Someone"', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/v/following/t': { label: 'Bea', code: 'x' },
    }});
    expect(await resolveName(deps, 'v', 't')).toBe('Bea');

    const deps2 = makeDeps({ store: { 'users/t/code': 'cool-code' } });
    expect(await resolveName(deps2, 'v', 't')).toBe('cool-code');

    const deps3 = makeDeps({ store: {} });
    expect(await resolveName(deps3, 'v', 't')).toBe('Someone');
  });
});

describe('handleKnock', () => {
  test('sends when recipient opted in for that sender', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/rcpt/notify/sndr': { knock: true },
      'userPrefs/rcpt/following/sndr': { label: 'Bea' },
      'userPrefs/rcpt/pushTokens': { tokA: {} },
    }});
    await handleKnock(deps, 'rcpt', 'sndr', { count: 1, ts: 1, contextGroupId: 'g1' });
    expect(deps.send).toHaveBeenCalledWith(['tokA'],
      { title: 'Bea knocked', body: '' },
      { type: 'knock', targetUid: 'sndr', contextGroupId: 'g1' });
  });
  test('does nothing when not opted in', async () => {
    const deps = makeDeps({ store: { 'userPrefs/rcpt/notify/sndr': { knock: false } } });
    await handleKnock(deps, 'rcpt', 'sndr', { count: 1, ts: 1 });
    expect(deps.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm test -- notifier`
Expected: FAIL — cannot find module `../notifier.js`.

- [ ] **Step 3: Implement `functions/notifier.js`**

```js
// functions/notifier.js — delivery + per-event handlers. Deps are injected.
import { wantsKnock, wantsCall, wantsAvailability, becameAvailable, withinCooldown, buildMessage } from './presence-core.js';

const AVAIL_COOLDOWN_MS = 5 * 60 * 1000;

export async function sendToUser(deps, uid, message, data) {
  const tokensMap = await deps.getVal(`userPrefs/${uid}/pushTokens`);
  const tokens = tokensMap ? Object.keys(tokensMap) : [];
  if (tokens.length === 0) return;
  const { failedTokens } = await deps.send(tokens, message, data);
  if (failedTokens && failedTokens.length) {
    const nulls = {};
    for (const t of failedTokens) nulls[t] = null;
    await deps.update(`userPrefs/${uid}/pushTokens`, nulls);
  }
}

export async function resolveName(deps, viewerUid, targetUid) {
  const follow = await deps.getVal(`userPrefs/${viewerUid}/following/${targetUid}`);
  if (follow && follow.label) return follow.label;
  const code = await deps.getVal(`users/${targetUid}/code`);
  if (code) return code;
  return 'Someone';
}

export async function handleKnock(deps, recipientId, senderId, record) {
  const prefs = await deps.getVal(`userPrefs/${recipientId}/notify/${senderId}`);
  if (!wantsKnock(prefs)) return;
  const name = await resolveName(deps, recipientId, senderId);
  const data = { type: 'knock', targetUid: senderId };
  if (record && record.contextGroupId) data.contextGroupId = record.contextGroupId;
  await sendToUser(deps, recipientId, buildMessage('knock', name), data);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm test -- notifier`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/notifier.js functions/test/notifier.test.js
git commit -m "feat(functions): notifier delivery helper + knock handler"
```

---

## Task 4: `notifier.js` — incoming-call handler

**Files:**
- Modify: `functions/notifier.js`
- Test: `functions/test/notifier.test.js`

The call trigger fires on the **caller's** `callState`; the callee is `callState.calleeId`.

- [ ] **Step 1: Write the failing tests**

```js
import { handleCall } from '../notifier.js';

describe('handleCall', () => {
  test('notifies the callee when they opted in for the caller', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/callee/notify/caller': { call: true },
      'userPrefs/callee/following/caller': { label: 'Alex K.' },
      'userPrefs/callee/pushTokens': { tokA: {} },
    }});
    await handleCall(deps, 'caller', { calleeId: 'callee', since: 1 });
    expect(deps.send).toHaveBeenCalledWith(['tokA'],
      { title: 'Alex K. is calling', body: '' },
      { type: 'call', targetUid: 'caller' });
  });
  test('does nothing when callState cleared (null) or no calleeId', async () => {
    const deps = makeDeps();
    await handleCall(deps, 'caller', null);
    await handleCall(deps, 'caller', { since: 1 });
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('does nothing when callee did not opt in', async () => {
    const deps = makeDeps({ store: { 'userPrefs/callee/notify/caller': { call: false } } });
    await handleCall(deps, 'caller', { calleeId: 'callee', since: 1 });
    expect(deps.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm test -- notifier`
Expected: FAIL — `handleCall is not a function`.

- [ ] **Step 3: Implement (append to `functions/notifier.js`)**

```js
export async function handleCall(deps, callerId, callState) {
  if (!callState || !callState.calleeId) return;
  const calleeId = callState.calleeId;
  const prefs = await deps.getVal(`userPrefs/${calleeId}/notify/${callerId}`);
  if (!wantsCall(prefs)) return;
  const name = await resolveName(deps, calleeId, callerId);
  await sendToUser(deps, calleeId, buildMessage('call', name), { type: 'call', targetUid: callerId });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm test -- notifier`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/notifier.js functions/test/notifier.test.js
git commit -m "feat(functions): incoming-call handler"
```

---

## Task 5: `notifier.js` — availability fan-out + debounce

**Files:**
- Modify: `functions/notifier.js`
- Test: `functions/test/notifier.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { handleAvailability } from '../notifier.js';

const off = { status: 'unavailable', availableUntil: null };
const on = { status: 'available', availableUntil: 9_999_999_999 };

describe('handleAvailability', () => {
  test('on false→true, notifies opted-in followers and stamps cooldown', async () => {
    const deps = makeDeps({ store: {
      'users/star/followers': { f1: 'code1', f2: 'code2' },
      'userPrefs/f1/notify/star': { availability: true },
      'userPrefs/f2/notify/star': { availability: false },
      'userPrefs/f1/following/star': { label: 'Bea' },
      'userPrefs/f1/pushTokens': { tokF1: {} },
      'notifierState/availability/star': null,
    }});
    await handleAvailability(deps, 'star', off, on);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledWith(['tokF1'],
      { title: 'Bea is available', body: '' }, { type: 'availability', targetUid: 'star' });
    expect(deps.update).toHaveBeenCalledWith('notifierState/availability', { star: 1000 });
  });
  test('no notify when not a transition (re-up)', async () => {
    const deps = makeDeps();
    await handleAvailability(deps, 'star', on, on);
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('debounce: skip if within cooldown of last fire', async () => {
    const deps = makeDeps({ store: { 'notifierState/availability/star': 999 } }); // now=1000, cooldown 5min
    await handleAvailability(deps, 'star', off, on);
    expect(deps.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npm test -- notifier`
Expected: FAIL — `handleAvailability is not a function`.

- [ ] **Step 3: Implement (append to `functions/notifier.js`)**

```js
export async function handleAvailability(deps, uid, beforeNode, afterNode) {
  const now = deps.now();
  if (!becameAvailable(beforeNode, afterNode, now)) return;
  const lastTs = await deps.getVal(`notifierState/availability/${uid}`);
  if (withinCooldown(lastTs, now, AVAIL_COOLDOWN_MS)) return;
  await deps.update('notifierState/availability', { [uid]: now });

  const followers = await deps.getVal(`users/${uid}/followers`);
  const followerIds = followers ? Object.keys(followers) : [];
  for (const fid of followerIds) {
    const prefs = await deps.getVal(`userPrefs/${fid}/notify/${uid}`);
    if (!wantsAvailability(prefs)) continue;
    const name = await resolveName(deps, fid, uid);
    await sendToUser(deps, fid, buildMessage('availability', name), { type: 'availability', targetUid: uid });
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm test -- notifier`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add functions/notifier.js functions/test/notifier.test.js
git commit -m "feat(functions): availability fan-out with transition + cooldown debounce"
```

---

## Task 6: `index.js` — bind RTDB triggers to the notifier

**Files:**
- Modify: `functions/index.js`

No unit test (thin wiring over the unit-tested notifier; verified by the suite compiling + manual/emulator smoke). The real `deps` wrap `firebase-admin`.

- [ ] **Step 1: Implement `functions/index.js`**

```js
// functions/index.js — RTDB-triggered presence notifiers.
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';
import { onValueCreated, onValueWritten, onValueUpdated } from 'firebase-functions/v2/database';
import { handleKnock, handleCall, handleAvailability } from './notifier.js';

initializeApp();

function makeDeps() {
  const db = getDatabase();
  return {
    now: () => Date.now(),
    getVal: async (path) => (await db.ref(path).get()).val(),
    update: async (path, obj) => { await db.ref(path).update(obj); },
    send: async (tokens, message, data) => {
      const res = await getMessaging().sendEachForMulticast({
        tokens,
        notification: { title: message.title, body: message.body },
        data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      });
      const failedTokens = [];
      res.responses.forEach((r, i) => {
        if (!r.success && r.error &&
            /registration-token-not-registered|invalid-registration-token/.test(r.error.code || '')) {
          failedTokens.push(tokens[i]);
        }
      });
      return { failedTokens };
    },
  };
}

export const onKnock = onValueCreated('/users/{recipientId}/knocks/{senderId}', (event) => {
  return handleKnock(makeDeps(), event.params.recipientId, event.params.senderId, event.data.val());
});

export const onCall = onValueWritten('/users/{callerId}/callState', (event) => {
  const after = event.data.after.val();
  const before = event.data.before.val();
  // Only on a newly-started call (callState appears or changes callee).
  if (!after || !after.calleeId) return null;
  if (before && before.calleeId === after.calleeId) return null;
  return handleCall(makeDeps(), event.params.callerId, after);
});

export const onAvailability = onValueUpdated('/users/{uid}', (event) => {
  return handleAvailability(makeDeps(), event.params.uid, event.data.before.val(), event.data.after.val());
});
```

> **Cost note:** `onAvailability` triggers on any change under `users/{uid}` (including knocks/lastSeen), then cheaply no-ops unless availability flipped. Acceptable at 50–100 users; a follow-up could narrow the trigger to `availableUntil` + a `status` read.

- [ ] **Step 2: Verify it parses/loads**

Run: `cd functions && node --check index.js`
Expected: no syntax errors. (A full load needs admin credentials; `--check` validates syntax.)

- [ ] **Step 3: Verify the functions suite still passes**

Run: `cd functions && npm test`
Expected: PASS (presence-core + notifier).

- [ ] **Step 4: Commit**

```bash
git add functions/index.js
git commit -m "feat(functions): bind RTDB triggers (knock/call/availability) to notifier"
```

---

## Task 7: `database.rules.json` — lock `notifierState` to server-only

**Files:**
- Modify: `database.rules.json`

`$other:false` already denies it by default; this makes it explicit and self-documenting.

- [ ] **Step 1: Add the rule**

Insert before the `"$other"` block:

```json
    "notifierState": {
      ".read": false,
      ".write": false
    },
```

- [ ] **Step 2: Verify JSON validity**

Run: `node -e "JSON.parse(require('fs').readFileSync('database.rules.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add database.rules.json
git commit -m "feat(rules): explicit server-only notifierState deny"
```

---

## Task 8: CI + local deploy — add `functions` target

**Files:**
- Modify: `.github/workflows/deploy-dev.yml`, `.github/workflows/deploy-prod.yml`, `package.json`

- [ ] **Step 1: Update both workflows**

In `deploy-dev.yml` and `deploy-prod.yml`, change the deploy line `--only hosting,database` → `--only hosting,database,functions`.

- [ ] **Step 2: Update the local deploy script**

In `package.json`, change the `deploy` script's `--only hosting,database` → `--only hosting,database,functions`.

- [ ] **Step 3: Add a deploy-prerequisites note to the spec follow-ups**

Append to `docs/superpowers/specs/2026-06-05-presence-notifications-design.md` §11:

```md
- Deploying `functions` requires the CI service accounts (`FIREBASE_SERVICE_ACCOUNT_{DEV,PROD}`) to have **Cloud Functions Admin**, **Service Account User**, and **Cloud Build / Artifact Registry** IAM roles, plus the **FIREBASE_VAPID_KEY** present in `FIREBASE_CONFIG_{DEV,PROD}`. One-time setup outside this repo.
```

- [ ] **Step 4: Verify YAML + JSON validity**

Run: `node -e "require('js-yaml')" 2>/dev/null || echo 'no yaml lib (ok)'; node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json ok')"`
Expected: `package.json ok` (yaml lib optional).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy-dev.yml .github/workflows/deploy-prod.yml package.json docs/superpowers/specs/2026-06-05-presence-notifications-design.md
git commit -m "ci: deploy functions alongside hosting,database"
```

---

## Task 9: Full verification

- [ ] **Step 1: Functions suite**

Run: `cd functions && npm test`
Expected: PASS (presence-core + notifier suites).

- [ ] **Step 2: Root suite unaffected**

Run: `npx jest`
Expected: PASS (Plan 1 client suites; the `functions/` tests are not picked up by root jest — different config).

- [ ] **Step 3: Build still clean**

Run: `node scripts/dev-build.js`
Expected: clean.

- [ ] **Step 4: Final commit if needed, then stop for review.**

---

## Post-merge / deploy notes

- **End-to-end now works** with Plan 1: flip `NOTIFICATIONS_ENABLED = true` in `js/features.js`, ensure `FIREBASE_VAPID_KEY` is in the env/secret, and deploy. Notifications fire on knock/call/availability for opted-in recipients.
- **Optional emulator integration test** (`firebase-tools` is already a devDependency): run the RTDB + Functions emulators and assert a write to `users/.../knocks/...` invokes `onKnock`. Deferred — the DI unit tests cover the logic; this would cover the wiring.
- **CSP:** no change needed — `connect-src https://*.googleapis.com` already covers `fcm.googleapis.com` / `fcmregistrations.googleapis.com`.
- **SW `CACHE` bump** still recommended at the deploy that ships Plan 1's shell-asset changes.
- **Availability `status` string** assumption (`'available'`) must be confirmed against `js/me.js` during execution (Task 2 note).
