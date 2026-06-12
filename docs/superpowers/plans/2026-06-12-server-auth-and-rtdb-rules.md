# R1 — Server-side auth + RTDB rules hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wide-open, no-auth RTDB with Firebase custom-token auth (`auth.uid == sha256(recoveryCode)`) and a per-path rules rewrite that enforces ownership, sender-identity, membership, and participant scoping.

**Architecture:** A new unauthenticated callable `validateRecovery` mints a Firebase custom token for the derived uid; the client signs in with it before any RTDB op (reusing the cached session on later loads); `database.rules.json` is rewritten per the design's per-collection table; rules are verified with `@firebase/rules-unit-testing` against the Firebase database emulator.

**Tech Stack:** firebase-functions v7 (`onCall`), firebase-admin v12 (`getAuth().createCustomToken`), firebase v12 modular client (`firebase/auth`, `firebase/functions`), Jest 30, `@firebase/rules-unit-testing` + the `firebase-tools` database emulator.

**Design:** `docs/superpowers/specs/2026-06-12-server-auth-and-rtdb-rules-design.md`

**Rollout note:** Deploy order is flag-day (function first; then client+rules together). Operational steps live in `docs/DEPLOY-PROD.md` (Task 18). Do **not** deploy mid-plan — the rules change locks out un-upgraded clients.

---

## File map

- Create `functions/auth.js` — `normalizeRecoveryCode`, `deriveUid`, `validateRecoveryHandler` (pure/testable) + rate-limit helper.
- Modify `functions/index.js` — export the `validateRecovery` onCall.
- Create `functions/test/auth.test.js` — handler unit tests.
- Modify `js/firebase-config.js` — export `auth` + `callValidateRecovery`.
- Create `js/auth.js` — `ensureSignedIn(recoveryCode?)`, `signOutLocal`.
- Create `tests/auth.test.js` — client auth unit tests.
- Modify `js/app.js` — weave `ensureSignedIn` into boot before any RTDB op.
- Rewrite `database.rules.json` — full per-collection rules.
- Modify `firebase.json` — add database emulator config.
- Modify root `package.json` — add `@firebase/rules-unit-testing`; add `test:rules` script.
- Create `tests/rules/helpers.js` + `tests/rules/*.test.js` — rules tests per category.
- Modify `.github/workflows/deploy-dev.yml` + `deploy-prod.yml` — run rules tests in CI.
- Modify `docs/DEPLOY-PROD.md` — auth-enable + IAM prereq + R1 deploy order.

---

# Phase 1 — `validateRecovery` Cloud Function

### Task 1: Pure helpers — normalize + derive uid

**Files:**
- Create: `functions/auth.js`
- Test: `functions/test/auth.test.js`

- [ ] **Step 1: Write the failing test**

```js
// functions/test/auth.test.js
import { normalizeRecoveryCode, deriveUid } from '../auth.js';

describe('normalizeRecoveryCode', () => {
  test('lowercases, collapses separators to dashes, trims', () => {
    expect(normalizeRecoveryCode('Swift, River - amber  dust')).toBe('swift-river-amber-dust');
  });
  test('returns null for not-exactly-4 tokens', () => {
    expect(normalizeRecoveryCode('one-two-three')).toBeNull();
    expect(normalizeRecoveryCode('a-b-c-d-e')).toBeNull();
    expect(normalizeRecoveryCode('')).toBeNull();
  });
  test('rejects non-letter tokens', () => {
    expect(normalizeRecoveryCode('sw1ft-river-amber-dust')).toBeNull();
  });
});

describe('deriveUid', () => {
  test('is sha256(code) truncated to 32 hex chars, matching the client', async () => {
    // Pin against a known value computed the same way the client does.
    expect(await deriveUid('swift-river-amber-dust')).toMatch(/^[0-9a-f]{32}$/);
  });
  test('is deterministic', async () => {
    expect(await deriveUid('swift-river-amber-dust')).toBe(await deriveUid('swift-river-amber-dust'));
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd functions && npx jest test/auth.test.js`
Expected: FAIL — `Cannot find module '../auth.js'`.

- [ ] **Step 3: Implement the helpers**

```js
// functions/auth.js
import { createHash } from 'crypto';

// Mirror js/identity.js parseRecoveryCode normalization EXACTLY (minus the
// wordlist check — server-side, format + normalization is all that's needed for
// a correct uid; a non-real code just derives a dead uid). The normalized form
// MUST match the client's so the derived uid matches.
export function normalizeRecoveryCode(input) {
  if (typeof input !== 'string') return null;
  const normalized = input.toLowerCase().replace(/[\s,\-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) return null;
  const tokens = normalized.split('-');
  if (tokens.length !== 4) return null;
  for (const t of tokens) if (!/^[a-z]+$/.test(t)) return null;
  return tokens.join('-');
}

// Mirror js/identity.js deriveUserIdFromRecoveryCode: sha256 hex, first 32 chars.
export async function deriveUid(normalizedCode) {
  return createHash('sha256').update(normalizedCode, 'utf8').digest('hex').slice(0, 32);
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd functions && npx jest test/auth.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify the uid matches the client's derivation (cross-check)**

Add to `functions/test/auth.test.js` and run:

```js
test('deriveUid matches the client formula byte-for-byte', async () => {
  // Reproduce js/identity.js using the same crypto the browser uses.
  const { webcrypto } = await import('crypto');
  const enc = new TextEncoder().encode('swift-river-amber-dust');
  const buf = await webcrypto.subtle.digest('SHA-256', enc);
  const clientUid = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  expect(await deriveUid('swift-river-amber-dust')).toBe(clientUid);
});
```

Run: `cd functions && npx jest test/auth.test.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/auth.js functions/test/auth.test.js
git commit -m "feat(auth): recovery-code normalization + uid derivation for validateRecovery"
```

---

### Task 2: `validateRecoveryHandler` (token mint + rate-limit), token-creator injected

**Files:**
- Modify: `functions/auth.js`
- Test: `functions/test/auth.test.js`

- [ ] **Step 1: Write the failing test**

```js
// add to functions/test/auth.test.js
import { validateRecoveryHandler, _resetRateLimit } from '../auth.js';

describe('validateRecoveryHandler', () => {
  beforeEach(() => _resetRateLimit());
  const mkReq = (data, ip = '1.1.1.1') => ({ data, rawRequest: { ip } });

  test('mints a token for the derived uid on a valid code', async () => {
    const mintToken = jest.fn().mockResolvedValue('TOKEN');
    const res = await validateRecoveryHandler(mkReq({ code: 'swift-river-amber-dust' }), { mintToken });
    expect(mintToken).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{32}$/));
    expect(res).toEqual({ token: 'TOKEN' });
  });

  test('rejects a malformed code without minting', async () => {
    const mintToken = jest.fn();
    await expect(validateRecoveryHandler(mkReq({ code: 'nope' }), { mintToken }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mintToken).not.toHaveBeenCalled();
  });

  test('rate-limits per IP after the cap', async () => {
    const mintToken = jest.fn().mockResolvedValue('T');
    for (let i = 0; i < 10; i++) await validateRecoveryHandler(mkReq({ code: 'swift-river-amber-dust' }), { mintToken });
    await expect(validateRecoveryHandler(mkReq({ code: 'swift-river-amber-dust' }), { mintToken }))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd functions && npx jest test/auth.test.js`
Expected: FAIL — `validateRecoveryHandler` not exported.

- [ ] **Step 3: Implement the handler**

```js
// add to functions/auth.js
import { HttpsError } from 'firebase-functions/v2/https';

const RATE_LIMIT = 10;          // per IP
const RATE_WINDOW_MS = 60_000;  // per minute
const _ipHits = new Map();      // ip -> [timestamps]

export function _resetRateLimit() { _ipHits.clear(); }

function rateLimit(ip, now = Date.now()) {
  const hits = (_ipHits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) return false;
  hits.push(now);
  _ipHits.set(ip, hits);
  return true;
}

// Dependency-injected (deps.mintToken) so it's testable without firebase-admin.
export async function validateRecoveryHandler(request, deps) {
  const ip = request.rawRequest?.ip || 'unknown';
  if (!rateLimit(ip)) throw new HttpsError('resource-exhausted', 'Too many attempts. Try again shortly.');
  const normalized = normalizeRecoveryCode(request.data?.code);
  if (!normalized) throw new HttpsError('invalid-argument', 'Invalid recovery code.');
  const uid = await deriveUid(normalized);
  const token = await deps.mintToken(uid);
  return { token };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `cd functions && npx jest test/auth.test.js`
Expected: PASS (all auth tests).

- [ ] **Step 5: Commit**

```bash
git add functions/auth.js functions/test/auth.test.js
git commit -m "feat(auth): validateRecoveryHandler — mint custom token, per-IP rate limit"
```

---

### Task 3: Wire `validateRecovery` into `functions/index.js`

**Files:**
- Modify: `functions/index.js`

- [ ] **Step 1: Add the export**

Add these imports near the top of `functions/index.js` (it already imports from `firebase-admin/app` and calls `initializeApp()`):

```js
import { onCall } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { validateRecoveryHandler } from './auth.js';
```

Add at the end of `functions/index.js`:

```js
// Unauthenticated callable: the user isn't signed in yet. Mints a Firebase
// custom token for uid = sha256(recoveryCode) so the client can sign in. Runs in
// the same region as the rest (setGlobalOptions above). See auth.js / R1 spec.
export const validateRecovery = onCall((request) =>
  validateRecoveryHandler(request, { mintToken: (uid) => getAuth().createCustomToken(uid) }));
```

- [ ] **Step 2: Verify the functions suite still passes**

Run: `cd functions && npm test`
Expected: PASS (existing + auth tests).

- [ ] **Step 3: Commit**

```bash
git add functions/index.js
git commit -m "feat(auth): export validateRecovery callable"
```

---

# Phase 2 — Client auth

### Task 4: Export `auth` + `callValidateRecovery` from firebase-config

**Files:**
- Modify: `js/firebase-config.js`

- [ ] **Step 1: Add the exports**

Add to the imports in `js/firebase-config.js`:

```js
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
```

Add after `export const db = getDatabase(app);`:

```js
export const auth = getAuth(app);

// Functions are pinned to europe-west1 (functions/index.js setGlobalOptions).
const _functions = getFunctions(app, 'europe-west1');
const _validateRecovery = httpsCallable(_functions, 'validateRecovery');

// Calls the validateRecovery callable; returns the Firebase custom token string.
export async function callValidateRecovery(code) {
  const { data } = await _validateRecovery({ code });
  return data.token;
}
```

- [ ] **Step 2: Verify nothing imports break**

Run: `npx jest tests/db.test.js`
Expected: PASS (firebase-config is mocked in tests; this just confirms no syntax error in the module graph). If a test imports the real firebase-config, ensure it still loads.

- [ ] **Step 3: Commit**

```bash
git add js/firebase-config.js
git commit -m "feat(auth): export auth instance + callValidateRecovery"
```

---

### Task 5: `js/auth.js` — `ensureSignedIn`

**Files:**
- Create: `js/auth.js`
- Test: `tests/auth.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/auth.test.js
jest.mock('../js/firebase-config.js', () => ({
  auth: { currentUser: null, authStateReady: jest.fn().mockResolvedValue(undefined) },
  callValidateRecovery: jest.fn(),
}));
jest.mock('firebase/auth', () => ({ signInWithCustomToken: jest.fn() }));

const { auth, callValidateRecovery } = require('../js/firebase-config.js');
const { signInWithCustomToken } = require('firebase/auth');
const { ensureSignedIn } = require('../js/auth.js');

beforeEach(() => { jest.clearAllMocks(); auth.currentUser = null; });

test('reuses a cached session — no validateRecovery call', async () => {
  auth.currentUser = { uid: 'abc' };
  await ensureSignedIn('swift-river-amber-dust');
  expect(callValidateRecovery).not.toHaveBeenCalled();
  expect(signInWithCustomToken).not.toHaveBeenCalled();
});

test('cold start signs in with a freshly minted token', async () => {
  auth.currentUser = null;
  callValidateRecovery.mockResolvedValue('TOKEN');
  signInWithCustomToken.mockResolvedValue({ user: { uid: 'abc' } });
  await ensureSignedIn('swift-river-amber-dust');
  expect(callValidateRecovery).toHaveBeenCalledWith('swift-river-amber-dust');
  expect(signInWithCustomToken).toHaveBeenCalledWith(auth, 'TOKEN');
});

test('throws when no cached session and no code is available', async () => {
  auth.currentUser = null;
  await expect(ensureSignedIn(null)).rejects.toThrow(/recovery code/i);
  expect(callValidateRecovery).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest tests/auth.test.js`
Expected: FAIL — `Cannot find module '../js/auth.js'`.

- [ ] **Step 3: Implement**

```js
// js/auth.js
import { signInWithCustomToken } from 'firebase/auth';
import { auth, callValidateRecovery } from './firebase-config.js';

// Ensures a Firebase Auth session exists before any RTDB op. Reuses a cached
// session (persistence is LOCAL by default) so this is a no-op on most loads;
// only a cold start / restored device / lost session mints a fresh token.
// `recoveryCode` is required only when there's no cached session.
export async function ensureSignedIn(recoveryCode) {
  await auth.authStateReady();           // wait for the SDK to restore any session
  if (auth.currentUser) return;
  if (!recoveryCode) throw new Error('No cached session and no recovery code to sign in with.');
  const token = await callValidateRecovery(recoveryCode);
  await signInWithCustomToken(auth, token);
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx jest tests/auth.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add js/auth.js tests/auth.test.js
git commit -m "feat(auth): ensureSignedIn — cached session reuse + custom-token sign-in"
```

---

### Task 6: Weave `ensureSignedIn` into the boot flow

**Files:**
- Modify: `js/app.js` (the `ensureIdentity`/`createNewAccount` block ~lines 74-150, and `main()` ~line 367)
- Test: `tests/app-call-recovery.test.js` (boot harness) — add an auth assertion

**Context:** `ensureIdentity` reads `userExists(uid)` and `createNewAccount` writes `initUser(uid)` — both RTDB ops. The session must exist before each. `identity` carries `recoveryCode` (from `loadIdentity`/`showRestoreScreen`/`generateRecoveryCode`).

- [ ] **Step 1: Write the failing test**

Add to `tests/app-call-recovery.test.js`. First add the mock (top, with the other `jest.mock`s):

```js
jest.mock('../js/auth.js', () => ({ ensureSignedIn: jest.fn().mockResolvedValue(undefined) }));
```

Add a test in the boot describe:

```js
test('boot signs in (ensureSignedIn) before wiring RTDB watchers', async () => {
  const { ensureSignedIn } = require('../js/auth.js');
  const db = require('../js/db.js');
  let signedInBeforeOwnStatus = false;
  // initOwnStatus is the first RTDB-touching call after identity; assert sign-in ran first.
  require('../js/ownStatus.js').initOwnStatus.mockImplementation(() => {
    signedInBeforeOwnStatus = ensureSignedIn.mock.calls.length > 0;
  });
  await bootApp();
  expect(ensureSignedIn).toHaveBeenCalled();
  expect(signedInBeforeOwnStatus).toBe(true);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx jest tests/app-call-recovery.test.js -t "signs in"`
Expected: FAIL — `ensureSignedIn` not called (not wired yet).

- [ ] **Step 3: Implement — sign in inside ensureIdentity and before main's RTDB work**

In `js/app.js`, add the import:

```js
import { ensureSignedIn } from './auth.js';
```

In `ensureIdentity`, before the `userExists(existing.userId)` read (the stale-identity check ~line 76), sign in with the stored recovery code:

```js
const existing = loadIdentity();
if (existing) {
  await ensureSignedIn(existing.recoveryCode); // session needed before the userExists read
  let valid = true;
  try { valid = await userExists(existing.userId); } catch { /* offline — assume valid */ }
  ...
```

In `createNewAccount` (~line 136), sign in after deriving identity, before `initUser`:

```js
async function createNewAccount() {
  // ...existing code that produces userId, code, recoveryCode...
  await ensureSignedIn(recoveryCode);  // must precede initUser's users/{uid} write
  let success = await initUser(userId, code);
  // ...
}
```

In the restore branch (where `showRestoreScreen()` returns `restored`), sign in before returning:

```js
const restored = await showRestoreScreen();
if (restored) {
  saveIdentity(restored.userId, restored.code, restored.recoveryCode);
  await ensureSignedIn(restored.recoveryCode);
  rearmSplash();
  return { identity: restored, isNew: false };
}
```

> If a path doesn't have `recoveryCode` in scope, read it from the same object `saveIdentity` was called with. Every identity object in this file carries `recoveryCode`.

- [ ] **Step 4: Run it, verify it passes**

Run: `npx jest tests/app-call-recovery.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full web suite**

Run: `npx jest`
Expected: PASS (other app-boot tests must mock `../js/auth.js` if they import `app.js` — add the same `jest.mock('../js/auth.js', …)` to `tests/recovery.test.js` if it fails on the new import).

- [ ] **Step 6: Commit**

```bash
git add js/app.js tests/app-call-recovery.test.js tests/recovery.test.js
git commit -m "feat(auth): sign in before any RTDB op in the boot flow"
```

---

# Phase 3 — Rules rewrite + emulator tests

### Task 7: Rules emulator test harness

**Files:**
- Modify: `firebase.json` (add emulator config)
- Modify: root `package.json` (dev dep + script)
- Create: `tests/rules/helpers.js`
- Create: `tests/rules/smoke.test.js`

- [ ] **Step 1: Add the database emulator to `firebase.json`**

Add a top-level `"emulators"` block:

```json
"emulators": {
  "database": { "port": 9000 },
  "ui": { "enabled": false },
  "singleProjectMode": true
}
```

- [ ] **Step 2: Add the dev dep + script**

```bash
npm install --save-dev @firebase/rules-unit-testing
```

Add to root `package.json` `"scripts"`:

```json
"test:rules": "firebase emulators:exec --only database --project demo-on \"jest --config jest.rules.config.js\""
```

Create `jest.rules.config.js` (rules tests are node, not jsdom, and live in `tests/rules`):

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/rules/**/*.test.js'],
};
```

Add to the root jest config (`jest.config.js`) so the default `npx jest` does NOT pick up the emulator tests:

```js
testPathIgnorePatterns: ['/node_modules/', '/functions/', '/tests/rules/'],
```

- [ ] **Step 3: Create the helper**

```js
// tests/rules/helpers.js
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');

async function makeTestEnv() {
  return initializeTestEnvironment({
    projectId: 'demo-on',
    database: {
      host: '127.0.0.1',
      port: 9000,
      rules: fs.readFileSync(path.resolve(__dirname, '../../database.rules.json'), 'utf8'),
    },
  });
}

// db handle authenticated as `uid` (or unauthenticated when uid is null).
function dbAs(env, uid) {
  return uid ? env.authenticatedContext(uid).database() : env.unauthenticatedContext().database();
}

// Seed data bypassing rules (admin context).
async function seed(env, fn) {
  await env.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.database()); });
}

module.exports = { makeTestEnv, dbAs, seed };
```

- [ ] **Step 4: Smoke test (no rules yet → everything still open, so this passes against current rules)**

```js
// tests/rules/smoke.test.js
const { assertSucceeds } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

test('emulator harness boots', async () => {
  await assertSucceeds(dbAs(env, 'u1').ref('users/u1/presence/status').set('available'));
});
```

- [ ] **Step 5: Run it, verify it passes**

Run: `npm run test:rules`
Expected: PASS (current open rules allow the write; this confirms the harness works).

- [ ] **Step 6: Commit**

```bash
git add firebase.json package.json package-lock.json jest.config.js jest.rules.config.js tests/rules/helpers.js tests/rules/smoke.test.js
git commit -m "test(rules): firebase database emulator harness for rules unit tests"
```

---

### Task 8: Rewrite the rules — owner-private + knowable-read + no-listing

**Files:**
- Modify: `database.rules.json`
- Create: `tests/rules/ownership.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// tests/rules/ownership.test.js
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

test('userPrefs: owner read/write only', async () => {
  await assertSucceeds(dbAs(env, 'u1').ref('userPrefs/u1/following/u2').set({ code: 'X' }));
  await assertFails(dbAs(env, 'u2').ref('userPrefs/u1/following/u2').get());
  await assertFails(dbAs(env, 'u2').ref('userPrefs/u1/following/u2').set({ code: 'Y' }));
});

test('users/{uid}: owner writes; any signed-in reads; unauth cannot', async () => {
  await assertSucceeds(dbAs(env, 'u1').ref('users/u1/presence/status').set('available'));
  await assertFails(dbAs(env, 'u2').ref('users/u1/presence/status').set('away'));
  await assertSucceeds(dbAs(env, 'u2').ref('users/u1/presence/status').get());
  await assertFails(dbAs(env, null).ref('users/u1/presence/status').get());
});

test('no listing: cannot read a whole collection root', async () => {
  await assertFails(dbAs(env, 'u1').ref('users').get());
  await assertFails(dbAs(env, 'u1').ref('userPrefs').get());
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npm run test:rules`
Expected: FAIL — current open rules allow `u2` to write `users/u1` and read the `users` root.

- [ ] **Step 3: Replace `database.rules.json`** with the full ruleset

```json
{
  "rules": {
    "userPrefs": {
      "$uid": { ".read": "auth != null && auth.uid === $uid", ".write": "auth != null && auth.uid === $uid" }
    },
    "users": {
      "$uid": {
        ".read": "auth != null",
        ".write": "auth != null && auth.uid === $uid",
        "followers": {
          "$follower": { ".write": "auth != null && (auth.uid === $follower || auth.uid === $uid)" }
        }
      }
    },
    "codeIndex": {
      "$code": {
        ".read": "auth != null",
        ".write": "auth != null && ((newData.exists() && newData.val() === auth.uid) || (!newData.exists() && data.val() === auth.uid))"
      }
    },
    "inviteIndex": {
      "$token": { ".read": "auth != null", ".write": "auth != null && (!data.exists() || data.child('uid').val() === auth.uid || data.child('inviter').val() === auth.uid)" }
    },
    "groupIdIndex": {
      "$gid": { ".read": "auth != null", ".write": "auth != null && !data.exists()" }
    },
    "groups": {
      "$gid": {
        ".read": "auth != null && data.child('members').child(auth.uid).exists()",
        ".write": "auth != null && (data.child('ownerId').val() === auth.uid || newData.child('ownerId').val() === auth.uid)",
        "members": {
          "$uid": { ".write": "auth != null && (auth.uid === $uid || data.parent().parent().child('ownerId').val() === auth.uid)" }
        }
      }
    },
    "knocks": {
      "$recipient": {
        ".read": "auth != null && auth.uid === $recipient",
        "$sender": { ".write": "auth != null && (auth.uid === $sender || auth.uid === $recipient)" }
      }
    },
    "revocations": {
      "$revoked": {
        ".read": "auth != null && auth.uid === $revoked",
        "$revoker": { ".write": "auth != null && (auth.uid === $revoker || auth.uid === $revoked)" }
      }
    },
    "followRequests": {
      "$target": {
        ".read": "auth != null && auth.uid === $target",
        "$requester": { ".write": "auth != null && (auth.uid === $requester || auth.uid === $target)" }
      }
    },
    "followGrants": {
      "$requester": {
        ".read": "auth != null && auth.uid === $requester",
        "$target": { ".write": "auth != null && (auth.uid === $target || auth.uid === $requester)" }
      }
    },
    "pendingInvites": {
      "$invitee": {
        ".read": "auth != null && auth.uid === $invitee",
        "$group": { ".write": "auth != null && ((newData.exists() && newData.child('from').val() === auth.uid && root.child('groups').child($group).child('members').child(auth.uid).exists()) || auth.uid === $invitee)" }
      }
    },
    "pendingInvitesByGroup": {
      "$group": {
        ".read": "auth != null && root.child('groups').child($group).child('members').child(auth.uid).exists()",
        "$invitee": { ".write": "auth != null && root.child('groups').child($group).child('members').child(auth.uid).exists()" }
      }
    },
    "calls": {
      "$uid": {
        ".read": "auth != null && auth.uid === $uid",
        ".write": "auth != null && (auth.uid === $uid || (newData.exists() && (newData.child('from').val() === auth.uid || newData.child('to').val() === auth.uid)) || (data.exists() && (data.child('from').val() === auth.uid || data.child('to').val() === auth.uid)))"
      }
    },
    "canvases": {
      "$canvasId": {
        ".read": "auth != null && ($canvasId.beginsWith(auth.uid + '_') || $canvasId.endsWith('_' + auth.uid))",
        ".write": "auth != null && ($canvasId.beginsWith(auth.uid + '_') || $canvasId.endsWith('_' + auth.uid))"
      }
    },
    "notifierState": { ".read": false, ".write": false },
    "$other": { ".read": false, ".write": false }
  }
}
```

- [ ] **Step 4: Run the ownership tests, verify they pass**

Run: `npm run test:rules`
Expected: PASS for `tests/rules/ownership.test.js`. (Later category tests are added in subsequent tasks; run will show those files absent or passing.)

- [ ] **Step 5: Commit**

```bash
git add database.rules.json tests/rules/ownership.test.js
git commit -m "feat(rules): per-path ownership rules + ownership tests"
```

---

### Task 9: Sender-identity mailbox tests (knocks, revocations, followRequests, followGrants)

**Files:**
- Create: `tests/rules/mailboxes.test.js`

- [ ] **Step 1: Write the tests** (rules already implemented in Task 8 — these verify them)

```js
// tests/rules/mailboxes.test.js
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

test('knock: sender can write own key, cannot forge another sender; recipient reads', async () => {
  await assertSucceeds(dbAs(env, 'me').ref('knocks/you/me').set({ ts: 1 }));
  await assertFails(dbAs(env, 'me').ref('knocks/you/attacker').set({ ts: 1 }));
  await assertSucceeds(dbAs(env, 'you').ref('knocks/you').get());
  await assertFails(dbAs(env, 'me').ref('knocks/you').get());
});

test('followRequest: requester writes own key; target reads', async () => {
  await assertSucceeds(dbAs(env, 'req').ref('followRequests/tgt/req').set({ ts: 1 }));
  await assertFails(dbAs(env, 'req').ref('followRequests/tgt/someoneelse').set({ ts: 1 }));
  await assertSucceeds(dbAs(env, 'tgt').ref('followRequests/tgt').get());
});

test('followGrant: target (grantor) writes own key; requester reads', async () => {
  await assertSucceeds(dbAs(env, 'tgt').ref('followGrants/req/tgt').set({ from: 'tgt', code: 'X' }));
  await assertFails(dbAs(env, 'evil').ref('followGrants/req/tgt').set({ from: 'tgt' }));
  await assertSucceeds(dbAs(env, 'req').ref('followGrants/req').get());
});

test('revocation: revoker writes own key; revoked reads', async () => {
  await assertSucceeds(dbAs(env, 'revoker').ref('revocations/revoked/revoker').set(true));
  await assertSucceeds(dbAs(env, 'revoked').ref('revocations/revoked').get());
  await assertFails(dbAs(env, 'revoker').ref('revocations/revoked').get());
});
```

- [ ] **Step 2: Run, verify pass**

Run: `npm run test:rules`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/rules/mailboxes.test.js
git commit -m "test(rules): sender-identity mailbox rules (knocks/revocations/follow*)"
```

---

### Task 10: Co-write tests — calls + followers

**Files:**
- Create: `tests/rules/cowrite.test.js`

- [ ] **Step 1: Write the tests**

```js
// tests/rules/cowrite.test.js
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs, seed } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

test('calls: caller can ring callee (from===self); stranger cannot', async () => {
  await assertSucceeds(dbAs(env, 'caller').ref('calls/callee').set({ from: 'caller', ts: 1 }));
  await assertFails(dbAs(env, 'stranger').ref('calls/callee').set({ from: 'caller', ts: 1 }));
});

test('calls: named peer can update/clear an existing call; owner can too', async () => {
  await seed(env, (db) => db.ref('calls/callee').set({ from: 'caller', ts: 1 }));
  await assertSucceeds(dbAs(env, 'caller').ref('calls/callee').remove());      // peer clears
  await seed(env, (db) => db.ref('calls/callee').set({ from: 'caller', ts: 1 }));
  await assertSucceeds(dbAs(env, 'callee').ref('calls/callee/answered').set(true)); // owner answers
  await seed(env, (db) => db.ref('calls/callee').set({ from: 'caller', ts: 1 }));
  await assertFails(dbAs(env, 'stranger').ref('calls/callee').remove());
});

test('followers: follower self-registers; owner removes; stranger cannot', async () => {
  await assertSucceeds(dbAs(env, 'follower').ref('users/owner/followers/follower').set(true));
  await assertSucceeds(dbAs(env, 'owner').ref('users/owner/followers/follower').remove());
  await assertFails(dbAs(env, 'stranger').ref('users/owner/followers/follower').set(true));
});
```

- [ ] **Step 2: Run, verify pass**

Run: `npm run test:rules`
Expected: PASS. (If "calls update by peer" fails, the `data.exists()` clause in the calls rule is doing its job for delete; confirm the rule matches Task 8.)

- [ ] **Step 3: Commit**

```bash
git add tests/rules/cowrite.test.js
git commit -m "test(rules): co-write rules for calls + users/{uid}/followers"
```

---

### Task 11: Membership + claim-lock + canvas + groups tests

**Files:**
- Create: `tests/rules/membership.test.js`

- [ ] **Step 1: Write the tests**

```js
// tests/rules/membership.test.js
const { assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { makeTestEnv, dbAs, seed } = require('./helpers');

let env;
beforeAll(async () => { env = await makeTestEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

test('pendingInvites: a member can invite (from===self); a non-member cannot', async () => {
  await seed(env, (db) => db.ref('groups/G1/members/inviter').set({ role: 'owner' }));
  await assertSucceeds(dbAs(env, 'inviter').ref('pendingInvites/invitee/G1').set({ from: 'inviter', ts: 1 }));
  await assertFails(dbAs(env, 'outsider').ref('pendingInvites/invitee/G1').set({ from: 'outsider', ts: 1 }));
  await assertFails(dbAs(env, 'inviter').ref('pendingInvites/invitee/G1').set({ from: 'someoneelse', ts: 1 }));
  await assertSucceeds(dbAs(env, 'invitee').ref('pendingInvites/invitee').get());
});

test('groups: only a member can read; self-join allowed (lighter)', async () => {
  await seed(env, (db) => db.ref('groups/G1').set({ ownerId: 'owner', members: { owner: { role: 'owner' } } }));
  await assertFails(dbAs(env, 'outsider').ref('groups/G1').get());
  await assertSucceeds(dbAs(env, 'owner').ref('groups/G1').get());
  await assertSucceeds(dbAs(env, 'joiner').ref('groups/G1/members/joiner').set({ role: 'member' })); // self-join
});

test('codeIndex: can point a code at your own uid only', async () => {
  await assertSucceeds(dbAs(env, 'u1').ref('codeIndex/ABC').set('u1'));
  await assertFails(dbAs(env, 'u1').ref('codeIndex/XYZ').set('u2'));
  await assertSucceeds(dbAs(env, 'u3').ref('codeIndex/QQQ').get());
});

test('groupIdIndex: first-writer-wins claim', async () => {
  await assertSucceeds(dbAs(env, 'u1').ref('groupIdIndex/G9').set(true));
  await assertFails(dbAs(env, 'u2').ref('groupIdIndex/G9').set(true)); // already claimed
});

test('canvases: only the two named participants can read/write', async () => {
  await assertSucceeds(dbAs(env, 'alice').ref('canvases/alice_bob/bg').set('#fff'));
  await assertSucceeds(dbAs(env, 'bob').ref('canvases/alice_bob/strokes/k1').set({ x: 1 }));
  await assertFails(dbAs(env, 'carol').ref('canvases/alice_bob/bg').get());
  await assertFails(dbAs(env, 'carol').ref('canvases/alice_bob/bg').set('#000'));
});

test('notifierState: locked to everyone (functions use admin SDK)', async () => {
  await assertFails(dbAs(env, 'u1').ref('notifierState/availability/u1').get());
  await assertFails(dbAs(env, 'u1').ref('notifierState/availability/u1').set(1));
});
```

- [ ] **Step 2: Run, verify pass**

Run: `npm run test:rules`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/rules/membership.test.js
git commit -m "test(rules): membership, claim-locks, canvases, notifierState"
```

---

### Task 12: Full rules-test sweep + fix any rule gaps

**Files:**
- Modify: `database.rules.json` (only if a test reveals a gap)

- [ ] **Step 1: Run the whole rules suite**

Run: `npm run test:rules`
Expected: PASS across `ownership`, `mailboxes`, `cowrite`, `membership`, `smoke`.

- [ ] **Step 2: Cross-check against the app's real write paths**

Confirm each `js/db.js` writer is permitted by the rules for the *correct* actor. Spot-check the non-obvious ones by reading `js/db.js`: `registerAsFollower` (writes `users/{target}/followers/{me}` as me — allowed), `removeFollower` (removes `users/{me}/followers/{x}` + writes `revocations/{x}/{me}` — allowed), `startCall` (writes both `calls/{caller}` as caller and `calls/{callee}` with `from:caller` — allowed), `writeFollowGrant` (writes `followGrants/{req}/{me}` as me/target — allowed), `claimGroupId` (transaction on `groupIdIndex/{gid}` — allowed when unclaimed), `setLastVisited`/`writeUserGroupsEntry` (write `users/{me}/groups/...` as me — allowed). If any real writer is blocked, adjust the rule and add a test mirroring that writer.

- [ ] **Step 3: Commit (only if rules changed)**

```bash
git add database.rules.json tests/rules/
git commit -m "fix(rules): close gaps found cross-checking db.js write paths"
```

---

# Phase 4 — CI + docs + final verification

### Task 13: Run rules tests in CI

**Files:**
- Modify: `.github/workflows/deploy-dev.yml`, `.github/workflows/deploy-prod.yml`

- [ ] **Step 1: Add a rules-test step to the `test` job in both workflows**

After the existing web + functions test steps, add:

```yaml
      - run: npx firebase emulators:exec --only database --project demo-on "jest --config jest.rules.config.js"
```

(The `firebase-tools` dev dep provides the emulator; the Java requirement is met by the GitHub-hosted runners, which include a JDK.)

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy-dev.yml .github/workflows/deploy-prod.yml
git commit -m "ci: run RTDB rules unit tests via the database emulator"
```

---

### Task 14: DEPLOY-PROD.md — auth prereqs + R1 deploy order

**Files:**
- Modify: `docs/DEPLOY-PROD.md`

- [ ] **Step 1: Add a Part 0 subsection (after 0.5 IAM)**

```markdown
### 0.5b — Auth for R1 (custom-token minting)

- Enable **Firebase Authentication** on the project (Console → Authentication →
  Get started). No sign-in providers are needed — custom tokens don't require one.
- Grant the functions runtime SA permission to mint custom tokens:
  ```bash
  gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/iam.serviceAccountTokenCreator" --project <prodId>
  ```
  Without this, `createCustomToken()` fails at runtime with a signBlob permission error.
```

- [ ] **Step 2: Add an R1 note to Part 2 (deploy)**

```markdown
> **R1 flag-day:** the rules require auth. CI deploys `hosting,database,functions`
> together, so the new client and new rules land in the same deploy — correct. The
> `validateRecovery` function is part of `functions` and deploys with them. Any
> client tab open on the *old* build (not signed in) is locked out until it
> reloads. Cached Firebase sessions mean only never-signed-in clients are affected.
```

- [ ] **Step 3: Commit**

```bash
git add docs/DEPLOY-PROD.md
git commit -m "docs(deploy): R1 auth prereqs (Firebase Auth, token-creator IAM) + flag-day note"
```

---

### Task 15: Full verification

- [ ] **Step 1: Web suite**

Run: `npx jest`
Expected: PASS (all suites), 3 clean runs for stability.

- [ ] **Step 2: Functions suite**

Run: `cd functions && npm test`
Expected: PASS.

- [ ] **Step 3: Rules suite**

Run: `npm run test:rules`
Expected: PASS.

- [ ] **Step 4: Local end-to-end against the dev project** (manual, not committed)

With dev config, in a throwaway browser profile: create a new account → confirm a `validateRecovery` call in the Network tab and that presence/groups still work; reload → confirm NO `validateRecovery` call (cached session); restore on a second profile via recovery code → confirm sign-in + data loads. Confirm a second account cannot read your `userPrefs`.

- [ ] **Step 5: Final commit (if any test tweaks)**

```bash
git add -A && git commit -m "test: stabilize R1 auth + rules suites"
```

---

## Notes for the executor

- **Do not deploy** until the whole plan is merged and you've coordinated the flag-day (un-upgraded clients lock out). The dev deploy is the shake-out; prod rides the `dev→main` cutover.
- The rules emulator needs **Java** locally (`firebase-tools` requirement). If absent, install a JDK before `npm run test:rules`.
- If an existing app-boot test breaks on the new `js/auth.js` import, add `jest.mock('../js/auth.js', () => ({ ensureSignedIn: jest.fn().mockResolvedValue(undefined) }))` to that test file.
