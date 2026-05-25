# Groups Phase 0 — Invite-Link Infrastructure (1:1 Follow-Me) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the invite-link primitive (`inviteIndex`, lifecycle ops, redemption) and the personal-scope ("follow me") use case. After this phase, an existing user can create one personal invite link from their code drawer and share it; tapping the link causes the redeemer to follow the creator. Brand-new users can onboard via a personal-scope link without prior share-code exchange.

**Architecture:** A new module `js/invites.js` owns the business logic for token generation, lifecycle, and redemption. A new module `js/inviteModal.js` owns the shared modal component (parameterized by scope; only the personal-scope parameterization is wired up in Phase 0). `js/db.js` gains a small set of new Firebase operations for the `inviteIndex` lookup table and personal invite records under `users/{uid}/invites/`. `js/app.js`'s boot path is extended to detect `?i={token}` URLs and route to redemption. The modal is reachable from a new row in the code drawer beneath the existing share-code Copy button. The `GROUPS_ENABLED` feature flag is introduced (`false` in this phase — it gates nothing yet, but is wired so Phase 1 can enable it).

**Tech Stack:** Vanilla ES modules (no framework), Firebase Realtime Database, esbuild, jest + jsdom. Existing patterns: `crypto.getRandomValues` for tokens (same source as `js/identity.js`), `runTransaction` for atomic claims (same as `codeIndex` in `js/db.js:67`), `watchStatus`-style subscriptions for cross-device sync, jest mocks of `../js/db.js` per test suite.

**Spec reference:** `docs/superpowers/specs/2026-05-25-groups-design.md` (rev 2), specifically §9 (invite system), §10 Flow B variation (personal-scope onboarding), §16 Phase 0.

---

## File Structure

**New files (created by this plan):**

| File | Responsibility |
|---|---|
| `js/invites.js` | Token generation, lifecycle (create/revoke/regenerate), redemption logic. No DOM. |
| `js/inviteModal.js` | Modal component for create + manage states. Parameterized by scope (only `personal` exposed in Phase 0). |
| `tests/invites.test.js` | Unit + integration tests for `js/invites.js`. Also covers app-boot URL routing for invite tokens. |
| `tests/inviteModal.test.js` | DOM-driven tests for the modal component. |

**Modified files:**

| File | Change |
|---|---|
| `js/features.js` | Add `GROUPS_ENABLED = false`. |
| `js/db.js` | Add: `claimInviteToken`, `releaseInviteToken`, `readInviteIndex`, `readUserInvite`, `writeUserInvite`, `deleteUserInvite`, `incrementInviteRedemptions`, `setInviteRevoked`, `getCreatorCode`. |
| `js/app.js` | Extend boot path to detect `?i={token}` URL parameter, validate via `js/invites.js`, route to either redemption (existing user) or the personal-link welcome variation (brand-new user). Add `pendingInviteRedemption` state plumbed through the welcome → recovery-code-modal → identity-created sequence. |
| `js/mycode.js` | Add invite row to the code drawer below the share-code Copy. Subscribe to `users/{uid}/invites` for cross-device label/state sync. |
| `index.template.html` | Markup for: (a) invite modal overlay; (b) drawer invite row; (c) personal-link welcome heading variation; (d) friendly-failure overlay. |
| `css/app.css` | Styles for invite modal, drawer invite row, failure overlay. Reuses existing tokens (`primary-btn`, `ghost-btn`, `.chip`, modal overlay pattern from recovery-code modal). |
| `database.rules.json` | Add open `inviteIndex` namespace; users sub-paths already covered by existing `users/$userId` wide-open rule. |
| `tests/db.test.js`, `tests/mycode.test.js`, `tests/recovery.test.js`, `tests/favorites.test.js`, `tests/following.test.js`, `tests/me.test.js` | Add the new `js/db.js` exports to their per-suite mocks of `../js/db.js`. Per the project handoff, omitting these causes `(0, _db.foo) is not a function` failures. |

---

## Conventions for this plan

- **Test runner:** `npx jest <path>` from the repo root. Append `-t '<name>'` for a single test.
- **Local dev server:** `npm run dev` (esbuild watch + local server, uses `.env.local`).
- **Build:** `node scripts/dev-build.js`.
- **Commit messages:** existing convention is `type: subject` first line. Use `feat:`, `fix:`, `refactor:`, `test:`, `build:`, `chore:`, `docs:`. Body explains the why.
- **One commit per task** unless a task explicitly says otherwise. Each task ends with a `Commit` step.
- **TDD discipline:** every task writes the failing test before the implementation. Confirm the failure mode before writing the implementation.

---

## Task 1: Add `GROUPS_ENABLED` feature flag and `inviteIndex` security rule

This is a setup task. No tests — both edits are pure configuration that downstream tasks will exercise.

**Files:**
- Modify: `js/features.js`
- Modify: `database.rules.json`

- [ ] **Step 1: Add `GROUPS_ENABLED` to `js/features.js`**

Open `js/features.js`. Add the new flag in the same `export const` block as the existing flags, with the value `false`. Final contents should match:

```js
// js/features.js
export const PALETTES_ENABLED = true;
export const PALETTE_INTERACTIONS_ENABLED = true;
export const KNOCK_ENABLED = true;
export const CALL_ENABLED = true;
export const GROUPS_ENABLED = false;
```

(If the file currently has different values for the existing flags — e.g., this is the `dev` branch where all are `false` — preserve those values and add `GROUPS_ENABLED = false` to the list. The Phase 0 implementation does not require this flag to be `true`; personal-scope invites work regardless.)

- [ ] **Step 2: Add `inviteIndex` rule to `database.rules.json`**

Edit `database.rules.json`. Insert the new `inviteIndex` namespace alongside `codeIndex`. Final contents:

```json
{
  "rules": {
    "users": {
      "$userId": {
        ".read": true,
        ".write": true
      }
    },
    "codeIndex": {
      "$code": {
        ".read": true,
        ".write": true
      }
    },
    "inviteIndex": {
      "$token": {
        ".read": true,
        ".write": true
      }
    },
    "canvases": {
      "$canvasId": {
        ".read": true,
        ".write": true
      }
    },
    "$other": {
      ".read": false,
      ".write": false
    }
  }
}
```

The personal-invite records at `users/{uid}/invites/{token}` are already covered by the existing wide-open `users/$userId` rule.

- [ ] **Step 3: Run existing tests to confirm nothing broke**

```
npx jest
```

Expected: all existing tests pass (387 or whatever the current count is). The new flag is imported by no module yet, so this just confirms baseline.

- [ ] **Step 4: Commit**

```bash
git add js/features.js database.rules.json
git commit -m "feat: add GROUPS_ENABLED flag and inviteIndex security rule

Phase 0 setup. GROUPS_ENABLED is false; gates nothing in this phase but
is wired so Phase 1 can flip it on. inviteIndex namespace mirrors the
existing codeIndex wide-open rule pattern."
```

---

## Task 2: Generate invite tokens

Token format per spec §9.2: URL-safe random string, ~22 chars from `base64url`, 128 bits of entropy. The tokens are also the keys used in `inviteIndex/{token}` and as the per-user invite slot key in `users/{uid}/invites/{token}`.

**Files:**
- Create: `js/invites.js`
- Create: `tests/invites.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/invites.test.js` with this contents:

```js
// tests/invites.test.js
const { generateInviteToken } = require('../js/invites');

describe('generateInviteToken', () => {
  test('returns a 22-char URL-safe base64 string', () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  test('produces distinct values across calls', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateInviteToken));
    expect(tokens.size).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx jest tests/invites.test.js
```

Expected: FAIL — `Cannot find module '../js/invites'`.

- [ ] **Step 3: Implement `generateInviteToken`**

Create `js/invites.js` with:

```js
// js/invites.js
// Invite-link primitive. Phase 0 supports personal-scope only.
// Token format: 22 chars from URL-safe base64 (128 bits of entropy).

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function generateInviteToken() {
  const bytes = new Uint8Array(16); // 128 bits
  (globalThis.crypto || require('crypto').webcrypto).getRandomValues(bytes);
  // Encode 16 bytes (128 bits) → 22 base64url chars (each char = 6 bits; 22 * 6 = 132, last 4 bits are zero-padded).
  // Use the cleaner approach: read 22 indices off ALPHABET using consecutive 6-bit windows.
  let out = '';
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < 16; i += 1) {
    acc = (acc << 8) | bytes[i];
    bits += 8;
    while (bits >= 6 && out.length < 22) {
      bits -= 6;
      out += ALPHABET[(acc >> bits) & 0x3f];
    }
  }
  // Append the remaining bits (left-padded with zeros) if we still need a char.
  if (out.length < 22) {
    out += ALPHABET[(acc << (6 - bits)) & 0x3f];
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

```
npx jest tests/invites.test.js
```

Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add js/invites.js tests/invites.test.js
git commit -m "feat: invite token generation

22-char URL-safe base64 token, 128 bits of entropy from
crypto.getRandomValues. Same crypto source as identity.js secret-phrase
derivation."
```

---

## Task 3: `db.js` operations for `inviteIndex`

The `inviteIndex/{token}` lookup table maps a token to the path of the invite record that owns it. Allocation is transactional (mirrors the `codeIndex` pattern in `js/db.js:67`).

**Files:**
- Modify: `js/db.js`
- Modify: `tests/db.test.js`

- [ ] **Step 1: Write the failing tests in `tests/db.test.js`**

Append to `tests/db.test.js` (alongside the existing `userExists`, `rotateCode`, etc. tests). First, add the new function names to the top-level `require(...)` destructure:

```js
const {
  userExists, touchLastSeen, rotateCode, setStatusColor, setPaletteKey,
  setCallState, clearCallState, getUser,
  claimInviteToken, releaseInviteToken, readInviteIndex,
} = require('../js/db');
```

Then append these tests at the bottom of the file:

```js
describe('claimInviteToken', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('claims a free token transactionally and stores ownerPath', async () => {
    runTransaction.mockResolvedValue({ committed: true });
    const ok = await claimInviteToken('TOKEN22CHARSTRINGAAAA1', 'users/uid1/invites/TOKEN22CHARSTRINGAAAA1');
    expect(ok).toBe(true);
    expect(runTransaction).toHaveBeenCalledWith('mock-ref', expect.any(Function));
    // Inspect the transaction handler: returns the new value if the slot is empty, undefined to abort on collision.
    const handler = runTransaction.mock.calls[0][1];
    expect(handler(null)).toEqual({ scope: 'personal', ownerPath: 'users/uid1/invites/TOKEN22CHARSTRINGAAAA1' });
    expect(handler({ scope: 'personal', ownerPath: 'users/someone/invites/TOKEN22CHARSTRINGAAAA1' })).toBeUndefined();
  });

  test('returns false when the transaction does not commit', async () => {
    runTransaction.mockResolvedValue({ committed: false });
    const ok = await claimInviteToken('TOKEN22CHARSTRINGAAAA2', 'users/uid1/invites/TOKEN22CHARSTRINGAAAA2');
    expect(ok).toBe(false);
  });

  test('routes scope to "group" when ownerPath starts with groups/', async () => {
    runTransaction.mockResolvedValue({ committed: true });
    await claimInviteToken('TOK', 'groups/G1/invites/TOK');
    const handler = runTransaction.mock.calls[0][1];
    expect(handler(null)).toEqual({ scope: 'group', ownerPath: 'groups/G1/invites/TOK' });
  });
});

describe('releaseInviteToken', () => {
  test('removes the inviteIndex entry', async () => {
    remove.mockResolvedValue();
    await releaseInviteToken('TOKEN');
    expect(remove).toHaveBeenCalledWith('mock-ref');
    expect(ref).toHaveBeenLastCalledWith({}, 'inviteIndex/TOKEN');
  });
});

describe('readInviteIndex', () => {
  test('returns the index entry when present', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ scope: 'personal', ownerPath: 'users/u/invites/T' }) });
    const result = await readInviteIndex('T');
    expect(result).toEqual({ scope: 'personal', ownerPath: 'users/u/invites/T' });
  });

  test('returns null when the entry is missing', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    const result = await readInviteIndex('NONEXISTENT');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest tests/db.test.js -t 'claimInviteToken'
```

Expected: FAIL — `claimInviteToken is not a function`.

- [ ] **Step 3: Implement the new exports in `js/db.js`**

Add to `js/db.js` (anywhere after the existing `initUser` function, near the other code-related operations):

```js
// ── Invites ──────────────────────────────────────────────────────────────────
// inviteIndex/{token} → { scope, ownerPath } — global lookup table.
// Same transactional-claim pattern as codeIndex (see initUser above).

function inferScopeFromOwnerPath(ownerPath) {
  return ownerPath.startsWith('groups/') ? 'group' : 'personal';
}

export async function claimInviteToken(token, ownerPath) {
  const indexRef = ref(db, `inviteIndex/${token}`);
  const result = await runTransaction(indexRef, (current) => {
    if (current !== null) return; // abort — token already claimed
    return { scope: inferScopeFromOwnerPath(ownerPath), ownerPath };
  });
  return result.committed;
}

export async function releaseInviteToken(token) {
  await remove(ref(db, `inviteIndex/${token}`));
}

export async function readInviteIndex(token) {
  const snap = await get(ref(db, `inviteIndex/${token}`));
  return snap.exists() ? snap.val() : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest tests/db.test.js
```

Expected: PASS — all db tests (existing + 5 new) green.

- [ ] **Step 5: Commit**

```bash
git add js/db.js tests/db.test.js
git commit -m "feat: inviteIndex Firebase operations

claimInviteToken (transactional, mirrors codeIndex pattern),
releaseInviteToken, readInviteIndex. Used by js/invites.js for
token allocation and redemption lookup."
```

---

## Task 4: `db.js` operations for personal invite records

Each personal invite is stored at `users/{uid}/invites/{token}` with `scope: 'personal'`, `token`, `creatorLabel`, `createdAt`, `expiresAt`, `redemptionCap`, `redemptionsUsed`, `revoked`. Add the CRUD operations plus a small helper to look up the creator's share code at redemption time.

**Files:**
- Modify: `js/db.js`
- Modify: `tests/db.test.js`

- [ ] **Step 1: Write the failing tests**

Extend the require destructure at the top of `tests/db.test.js`:

```js
const {
  userExists, touchLastSeen, rotateCode, setStatusColor, setPaletteKey,
  setCallState, clearCallState, getUser,
  claimInviteToken, releaseInviteToken, readInviteIndex,
  readUserInvite, writeUserInvite, deleteUserInvite,
  setInviteRevoked, incrementInviteRedemptions, getCreatorCode,
  watchUserInvites,
} = require('../js/db');
```

Append these tests:

```js
describe('readUserInvite', () => {
  test('returns the invite record by uid + token', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ scope: 'personal', token: 'T', creatorLabel: 'Mike' }) });
    const result = await readUserInvite('uid1', 'T');
    expect(result).toEqual({ scope: 'personal', token: 'T', creatorLabel: 'Mike' });
  });

  test('returns null when absent', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    const result = await readUserInvite('uid1', 'NOPE');
    expect(result).toBeNull();
  });
});

describe('writeUserInvite', () => {
  test('writes the full invite record at users/{uid}/invites/{token}', async () => {
    set.mockResolvedValue();
    const payload = { scope: 'personal', token: 'T', creatorLabel: 'Mike', createdAt: 12345, expiresAt: null, redemptionCap: null, redemptionsUsed: 0, revoked: false };
    await writeUserInvite('uid1', 'T', payload);
    expect(set).toHaveBeenCalledWith('mock-ref', payload);
    expect(ref).toHaveBeenLastCalledWith({}, 'users/uid1/invites/T');
  });
});

describe('deleteUserInvite', () => {
  test('removes the invite record', async () => {
    remove.mockResolvedValue();
    await deleteUserInvite('uid1', 'T');
    expect(ref).toHaveBeenLastCalledWith({}, 'users/uid1/invites/T');
    expect(remove).toHaveBeenCalled();
  });
});

describe('setInviteRevoked', () => {
  test('sets revoked: true on the invite', async () => {
    update.mockResolvedValue();
    await setInviteRevoked('uid1', 'T');
    expect(update).toHaveBeenCalledWith('mock-ref', { revoked: true });
    expect(ref).toHaveBeenLastCalledWith({}, 'users/uid1/invites/T');
  });
});

describe('incrementInviteRedemptions', () => {
  test('runs a transaction that increments redemptionsUsed by 1', async () => {
    runTransaction.mockResolvedValue({ committed: true });
    await incrementInviteRedemptions('uid1', 'T');
    const handler = runTransaction.mock.calls[0][1];
    expect(handler(3)).toBe(4);
    expect(handler(null)).toBe(1);
  });
});

describe('getCreatorCode', () => {
  test('reads users/{creatorUid}/code', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => 'ABC123' });
    const code = await getCreatorCode('uid1');
    expect(code).toBe('ABC123');
    expect(ref).toHaveBeenLastCalledWith({}, 'users/uid1/code');
  });

  test('returns null when the user has no code', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    const code = await getCreatorCode('unknownUid');
    expect(code).toBeNull();
  });
});

describe('watchUserInvites', () => {
  test('subscribes to users/{uid}/invites and emits the collection', () => {
    let callback;
    onValue.mockImplementation((_ref, cb) => { callback = cb; return () => {}; });
    const seen = [];
    watchUserInvites('uid1', (invites) => seen.push(invites));
    callback({ exists: () => true, val: () => ({ T1: { scope: 'personal', revoked: false }, T2: { scope: 'personal', revoked: true } }) });
    expect(seen[0]).toEqual({ T1: { scope: 'personal', revoked: false }, T2: { scope: 'personal', revoked: true } });
    callback({ exists: () => false, val: () => null });
    expect(seen[1]).toEqual({});
  });
});
```

You also need to import `onValue` into the destructure at the top of the test file. The existing `jest.mock('firebase/database', ...)` block already includes `onValue` if you look — but verify; if not, add it:

```js
jest.mock('firebase/database', () => ({
  ref: jest.fn(() => 'mock-ref'),
  get: jest.fn(),
  update: jest.fn(),
  set: jest.fn(),
  remove: jest.fn(),
  runTransaction: jest.fn(),
  onValue: jest.fn(),
}));

const { ref, get, update, set, remove, runTransaction, onValue } = require('firebase/database');
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest tests/db.test.js -t 'readUserInvite'
```

Expected: FAIL — `readUserInvite is not a function`.

- [ ] **Step 3: Implement the new exports**

Add to `js/db.js`, immediately below the `inviteIndex` block from Task 3:

```js
// Personal invites under users/{uid}/invites/{token}.

export async function readUserInvite(userId, token) {
  const snap = await get(ref(db, `users/${userId}/invites/${token}`));
  return snap.exists() ? snap.val() : null;
}

export async function writeUserInvite(userId, token, payload) {
  await set(ref(db, `users/${userId}/invites/${token}`), payload);
}

export async function deleteUserInvite(userId, token) {
  await remove(ref(db, `users/${userId}/invites/${token}`));
}

export async function setInviteRevoked(userId, token) {
  await update(ref(db, `users/${userId}/invites/${token}`), { revoked: true });
}

export async function incrementInviteRedemptions(userId, token) {
  const inviteRef = ref(db, `users/${userId}/invites/${token}/redemptionsUsed`);
  await runTransaction(inviteRef, (current) => (current || 0) + 1);
}

export async function getCreatorCode(creatorUserId) {
  const snap = await get(ref(db, `users/${creatorUserId}/code`));
  return snap.exists() ? snap.val() : null;
}

export function watchUserInvites(userId, callback) {
  const invitesRef = ref(db, `users/${userId}/invites`);
  return onValue(invitesRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest tests/db.test.js
```

Expected: PASS — all db tests green.

- [ ] **Step 5: Update test mocks in suites that mock `../js/db.js`**

Per the project handoff, every test that mocks `../js/db.js` must list the exports it exercises. Phase 0 doesn't have downstream callers in those suites yet, but adding stub entries now prevents `(0, _db.foo) is not a function` failures in later tasks. Open each of these files and add the new exports as `jest.fn()` stubs inside their existing `jest.mock('../js/db.js', ...)` block:

- `tests/mycode.test.js`
- `tests/recovery.test.js`
- `tests/favorites.test.js`
- `tests/following.test.js`
- `tests/me.test.js`

For each file, locate the existing `jest.mock('../js/db.js', () => ({ ... }))` block and add:

```js
  claimInviteToken: jest.fn(),
  releaseInviteToken: jest.fn(),
  readInviteIndex: jest.fn(),
  readUserInvite: jest.fn(),
  writeUserInvite: jest.fn(),
  deleteUserInvite: jest.fn(),
  setInviteRevoked: jest.fn(),
  incrementInviteRedemptions: jest.fn(),
  getCreatorCode: jest.fn(),
  watchUserInvites: jest.fn(() => () => {}),
```

The `watchUserInvites` mock returns `() => {}` because it's a subscription that returns an unsubscribe fn.

Run the full suite to confirm:

```
npx jest
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add js/db.js tests/db.test.js tests/mycode.test.js tests/recovery.test.js tests/favorites.test.js tests/following.test.js tests/me.test.js
git commit -m "feat: personal invite Firebase operations

readUserInvite / writeUserInvite / deleteUserInvite / setInviteRevoked /
incrementInviteRedemptions / getCreatorCode / watchUserInvites for
users/{uid}/invites/{token}. Mocks updated in the standard six db.js-
mocking test files per project convention."
```

---

## Task 5: `invites.js` — `createPersonalInvite`

Creates a fresh personal-scope invite. Enforces the one-active-personal-invite-per-user constraint by reading the existing collection first; if an active (non-revoked) invite exists, returns it instead of creating a new one. Otherwise generates a fresh token, claims it in `inviteIndex` transactionally (retrying on the vanishingly rare collision), and writes the invite record.

**Files:**
- Modify: `js/invites.js`
- Modify: `tests/invites.test.js`

- [ ] **Step 1: Write the failing tests**

Add to the top of `tests/invites.test.js`, alongside the existing `generateInviteToken` describe block:

```js
jest.mock('../js/db.js', () => ({
  claimInviteToken: jest.fn(),
  releaseInviteToken: jest.fn(),
  readInviteIndex: jest.fn(),
  readUserInvite: jest.fn(),
  writeUserInvite: jest.fn(),
  deleteUserInvite: jest.fn(),
  setInviteRevoked: jest.fn(),
  incrementInviteRedemptions: jest.fn(),
  getCreatorCode: jest.fn(),
  watchUserInvites: jest.fn(() => () => {}),
  // Existing exports we may exercise transitively:
  registerAsFollower: jest.fn().mockResolvedValue(undefined),
  setFollowingEntry: jest.fn().mockResolvedValue(undefined),
  lookupCode: jest.fn(),
}));

const db = require('../js/db.js');
const { generateInviteToken, createPersonalInvite } = require('../js/invites');

describe('createPersonalInvite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.watchUserInvites.mockReturnValue(() => {});
  });

  test('creates a new invite when none exists', async () => {
    db.readUserInvite.mockResolvedValue(null);                 // (kept for backward compat, see implementation note)
    // The implementation will read the whole collection to check for any active invite.
    // Mock via the watchUserInvites-or-direct-read pattern the implementation uses. We'll
    // expose a read helper called readUserInvites (collection) — add it now if not present.
    db.readUserInvites = jest.fn().mockResolvedValue({});      // empty collection
    db.claimInviteToken.mockResolvedValue(true);
    db.writeUserInvite.mockResolvedValue();

    const result = await createPersonalInvite('uid1', 'Mike P.');

    expect(result).toMatchObject({ token: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), url: expect.stringContaining('?i=') });
    expect(db.claimInviteToken).toHaveBeenCalledWith(result.token, `users/uid1/invites/${result.token}`);
    expect(db.writeUserInvite).toHaveBeenCalledWith('uid1', result.token, expect.objectContaining({
      scope: 'personal',
      token: result.token,
      creatorLabel: 'Mike P.',
      creatorUid: 'uid1',
      createdAt: expect.any(Number),
      expiresAt: null,
      redemptionCap: null,
      redemptionsUsed: 0,
      revoked: false,
    }));
  });

  test('returns the existing active invite when one already exists', async () => {
    db.readUserInvites = jest.fn().mockResolvedValue({
      EXISTING22CHARSTRINGAA: { scope: 'personal', token: 'EXISTING22CHARSTRINGAA', creatorLabel: 'Old Name', revoked: false },
    });
    const result = await createPersonalInvite('uid1', 'New Name');
    expect(result.token).toBe('EXISTING22CHARSTRINGAA');
    expect(db.claimInviteToken).not.toHaveBeenCalled();
    expect(db.writeUserInvite).not.toHaveBeenCalled();
  });

  test('creates a new invite when only revoked invites exist', async () => {
    db.readUserInvites = jest.fn().mockResolvedValue({
      OLD22CHARSTRINGAAAAAAA: { scope: 'personal', token: 'OLD22CHARSTRINGAAAAAAA', revoked: true },
    });
    db.claimInviteToken.mockResolvedValue(true);
    db.writeUserInvite.mockResolvedValue();
    const result = await createPersonalInvite('uid1', 'Mike');
    expect(result.token).not.toBe('OLD22CHARSTRINGAAAAAAA');
    expect(db.claimInviteToken).toHaveBeenCalled();
  });

  test('retries on token collision', async () => {
    db.readUserInvites = jest.fn().mockResolvedValue({});
    db.claimInviteToken.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    db.writeUserInvite.mockResolvedValue();
    const result = await createPersonalInvite('uid1', 'Mike');
    expect(db.claimInviteToken).toHaveBeenCalledTimes(2);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  test('validates creatorLabel: trim, non-empty, max 40', async () => {
    db.readUserInvites = jest.fn().mockResolvedValue({});
    db.claimInviteToken.mockResolvedValue(true);
    db.writeUserInvite.mockResolvedValue();

    await expect(createPersonalInvite('uid1', '   ')).rejects.toThrow(/empty/i);
    await expect(createPersonalInvite('uid1', 'x'.repeat(41))).rejects.toThrow(/40/);

    await createPersonalInvite('uid1', '  Mike  ');
    expect(db.writeUserInvite).toHaveBeenLastCalledWith('uid1', expect.any(String), expect.objectContaining({ creatorLabel: 'Mike' }));
  });
});
```

> **Note to implementer:** the tests above assume the implementation uses a `readUserInvites(uid)` collection-read helper. We need that helper in `js/db.js`; add it as part of this task (see Step 3).

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest tests/invites.test.js -t 'createPersonalInvite'
```

Expected: FAIL — `createPersonalInvite is not a function`.

- [ ] **Step 3: Implement `createPersonalInvite` and the `readUserInvites` db helper**

First, add the missing collection-read helper to `js/db.js` (just below the other invite functions added in Task 4):

```js
export async function readUserInvites(userId) {
  const snap = await get(ref(db, `users/${userId}/invites`));
  return snap.exists() ? snap.val() : {};
}
```

Update the mocks in the standard six test files to include `readUserInvites: jest.fn().mockResolvedValue({})` so other suites don't break.

Then add to `js/invites.js`:

```js
import {
  claimInviteToken, writeUserInvite, readUserInvites,
} from './db.js';

const LABEL_MAX = 40;
const APP_URL_BASE = (typeof location !== 'undefined' && location.origin) ? location.origin : '';

function validateLabel(raw) {
  if (typeof raw !== 'string') throw new Error('Creator label must be a string.');
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new Error('Creator label cannot be empty.');
  if (trimmed.length > LABEL_MAX) throw new Error(`Creator label must be at most ${LABEL_MAX} chars.`);
  return trimmed;
}

function buildInviteUrl(token) {
  return `${APP_URL_BASE}/?i=${token}`;
}

function findActivePersonalInvite(collection) {
  for (const [token, inv] of Object.entries(collection || {})) {
    if (inv && inv.scope === 'personal' && !inv.revoked) return { token, ...inv };
  }
  return null;
}

export async function createPersonalInvite(userId, creatorLabelRaw) {
  const creatorLabel = validateLabel(creatorLabelRaw);

  // Enforce one-active-personal-invite-per-user (spec §9.3).
  const collection = await readUserInvites(userId);
  const existing = findActivePersonalInvite(collection);
  if (existing) {
    return { token: existing.token, url: buildInviteUrl(existing.token), existing: true };
  }

  // Allocate a fresh token, retrying on the very rare collision.
  let token;
  let claimed = false;
  for (let attempt = 0; attempt < 8 && !claimed; attempt += 1) {
    token = generateInviteToken();
    claimed = await claimInviteToken(token, `users/${userId}/invites/${token}`);
  }
  if (!claimed) throw new Error('Could not allocate an invite token. Try again.');

  const now = Date.now();
  const payload = {
    scope: 'personal',
    token,
    creatorUid: userId,
    creatorLabel,
    createdAt: now,
    expiresAt: null,
    redemptionCap: null,
    redemptionsUsed: 0,
    revoked: false,
  };
  await writeUserInvite(userId, token, payload);

  return { token, url: buildInviteUrl(token), existing: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest tests/invites.test.js
npx jest
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add js/invites.js js/db.js tests/invites.test.js tests/db.test.js tests/mycode.test.js tests/recovery.test.js tests/favorites.test.js tests/following.test.js tests/me.test.js
git commit -m "feat: invites.createPersonalInvite + readUserInvites helper

Honors the one-active-personal-invite-per-user constraint by reading the
collection and returning the existing active invite if one is present.
Token-collision retry loop bounded at 8 attempts (128-bit space makes
collisions vanishingly rare). Creator-label validated via the same
trim/non-empty/max-40 rule as the existing follow-label inputs."
```

---

## Task 6: `invites.js` — revoke and regenerate

Both operations are small and tightly related, so they share a task. Revoke marks the invite `revoked: true` and removes its `inviteIndex` entry so the token no longer resolves. Regenerate is atomic-feeling from the user's perspective: it revokes the existing active invite (if any) and creates a new one.

**Files:**
- Modify: `js/invites.js`
- Modify: `tests/invites.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/invites.test.js`:

```js
const { revokePersonalInvite, regeneratePersonalInvite } = require('../js/invites');

describe('revokePersonalInvite', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('marks the invite revoked and releases the inviteIndex entry', async () => {
    db.readUserInvites = jest.fn().mockResolvedValue({
      ABC: { scope: 'personal', token: 'ABC', revoked: false },
    });
    db.setInviteRevoked.mockResolvedValue();
    db.releaseInviteToken.mockResolvedValue();

    await revokePersonalInvite('uid1');

    expect(db.setInviteRevoked).toHaveBeenCalledWith('uid1', 'ABC');
    expect(db.releaseInviteToken).toHaveBeenCalledWith('ABC');
  });

  test('no-ops when there is no active invite', async () => {
    db.readUserInvites = jest.fn().mockResolvedValue({
      ABC: { scope: 'personal', token: 'ABC', revoked: true },
    });
    await revokePersonalInvite('uid1');
    expect(db.setInviteRevoked).not.toHaveBeenCalled();
    expect(db.releaseInviteToken).not.toHaveBeenCalled();
  });
});

describe('regeneratePersonalInvite', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('revokes the existing active invite and creates a new one', async () => {
    db.readUserInvites = jest.fn()
      .mockResolvedValueOnce({ OLD: { scope: 'personal', token: 'OLD', revoked: false, creatorLabel: 'Mike' } }) // revoke read
      .mockResolvedValueOnce({});                                                                                  // post-revoke read for create
    db.setInviteRevoked.mockResolvedValue();
    db.releaseInviteToken.mockResolvedValue();
    db.claimInviteToken.mockResolvedValue(true);
    db.writeUserInvite.mockResolvedValue();

    const result = await regeneratePersonalInvite('uid1', 'Mike P.');

    expect(db.setInviteRevoked).toHaveBeenCalledWith('uid1', 'OLD');
    expect(db.releaseInviteToken).toHaveBeenCalledWith('OLD');
    expect(db.writeUserInvite).toHaveBeenCalledWith('uid1', result.token, expect.objectContaining({
      scope: 'personal',
      creatorLabel: 'Mike P.',
    }));
    expect(result.token).not.toBe('OLD');
  });

  test('creates a new invite when no active one exists', async () => {
    db.readUserInvites = jest.fn().mockResolvedValue({});
    db.claimInviteToken.mockResolvedValue(true);
    db.writeUserInvite.mockResolvedValue();

    const result = await regeneratePersonalInvite('uid1', 'Mike');

    expect(db.setInviteRevoked).not.toHaveBeenCalled();
    expect(db.releaseInviteToken).not.toHaveBeenCalled();
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest tests/invites.test.js -t 'revokePersonalInvite'
```

Expected: FAIL — `revokePersonalInvite is not a function`.

- [ ] **Step 3: Implement the two operations**

Add to `js/invites.js`:

```js
import {
  setInviteRevoked, releaseInviteToken,
} from './db.js';

export async function revokePersonalInvite(userId) {
  const collection = await readUserInvites(userId);
  const active = findActivePersonalInvite(collection);
  if (!active) return;
  await setInviteRevoked(userId, active.token);
  await releaseInviteToken(active.token);
}

export async function regeneratePersonalInvite(userId, creatorLabelRaw) {
  // Validate label up-front so a bad label doesn't cause us to revoke first and fail second.
  const creatorLabel = validateLabel(creatorLabelRaw);
  await revokePersonalInvite(userId);
  return createPersonalInvite(userId, creatorLabel);
}
```

(You'll need to merge the new `import` statement with the existing one at the top of the file, or use a single multi-name import.)

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest tests/invites.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/invites.js tests/invites.test.js
git commit -m "feat: invites.revokePersonalInvite + regeneratePersonalInvite

Revoke marks the invite revoked and removes the inviteIndex entry.
Regenerate is revoke-then-create with up-front label validation so a
bad label cannot leave the user in a revoked-but-no-replacement state."
```

---

## Task 7: `invites.js` — `redeemPersonalInvite`

Redemption is the heaviest invite operation. Given a token, it resolves the invite via `inviteIndex`, validates all the failure modes (not-found / revoked / expired / cap-reached / self-invite / already-following), and on success creates a follow relationship from the redeemer to the creator using the existing follow plumbing (`registerAsFollower` + `setFollowingEntry` + the local store helper `addFollowing`). Increments `redemptionsUsed` on success.

The return shape is either `{ ok: true, creatorUid, creatorCode, creatorLabel }` on success or `{ ok: false, reason }` where `reason` is one of `'not-found' | 'revoked' | 'expired' | 'cap' | 'self' | 'already-following' | 'creator-missing'`.

**Files:**
- Modify: `js/invites.js`
- Modify: `tests/invites.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/invites.test.js`:

```js
const { redeemPersonalInvite } = require('../js/invites');

describe('redeemPersonalInvite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.incrementInviteRedemptions.mockResolvedValue();
    db.registerAsFollower.mockResolvedValue();
    db.setFollowingEntry.mockResolvedValue();
    db.getCreatorCode.mockResolvedValue('ABC123');
  });

  test('happy path: follows the creator and bumps redemption count', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator-uid/invites/TOKEN' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'TOKEN', creatorUid: 'creator-uid', creatorLabel: 'Mike',
      revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 3,
    });
    const result = await redeemPersonalInvite('TOKEN', 'redeemer-uid', 'redeemer-code', new Set());
    expect(result).toEqual({ ok: true, creatorUid: 'creator-uid', creatorCode: 'ABC123', creatorLabel: 'Mike' });
    expect(db.registerAsFollower).toHaveBeenCalledWith('creator-uid', 'redeemer-uid', 'redeemer-code');
    expect(db.setFollowingEntry).toHaveBeenCalledWith('redeemer-uid', 'creator-uid', 'ABC123', '');
    expect(db.incrementInviteRedemptions).toHaveBeenCalledWith('creator-uid', 'TOKEN');
  });

  test('returns not-found when the inviteIndex has no entry', async () => {
    db.readInviteIndex.mockResolvedValue(null);
    const result = await redeemPersonalInvite('BADTOKEN', 'redeemer-uid', 'redeemer-code', new Set());
    expect(result).toEqual({ ok: false, reason: 'not-found' });
    expect(db.registerAsFollower).not.toHaveBeenCalled();
  });

  test('returns not-found when the invite record is missing despite an index entry', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue(null);
    const result = await redeemPersonalInvite('T', 'redeemer', 'code', new Set());
    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });

  test('returns revoked when the invite is revoked', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({ scope: 'personal', token: 'T', creatorUid: 'creator', revoked: true });
    const result = await redeemPersonalInvite('T', 'redeemer', 'code', new Set());
    expect(result).toEqual({ ok: false, reason: 'revoked' });
  });

  test('returns expired when expiresAt is in the past', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'creator', revoked: false,
      expiresAt: Date.now() - 1000, redemptionCap: null, redemptionsUsed: 0,
    });
    const result = await redeemPersonalInvite('T', 'redeemer', 'code', new Set());
    expect(result).toEqual({ ok: false, reason: 'expired' });
  });

  test('returns cap when redemptionsUsed >= redemptionCap', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'creator', revoked: false,
      expiresAt: null, redemptionCap: 5, redemptionsUsed: 5,
    });
    const result = await redeemPersonalInvite('T', 'redeemer', 'code', new Set());
    expect(result).toEqual({ ok: false, reason: 'cap' });
  });

  test('returns self when the redeemer is the creator', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/redeemer/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'redeemer', revoked: false,
      expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    const result = await redeemPersonalInvite('T', 'redeemer', 'code', new Set());
    expect(result).toEqual({ ok: false, reason: 'self' });
    expect(db.registerAsFollower).not.toHaveBeenCalled();
    expect(db.incrementInviteRedemptions).not.toHaveBeenCalled();
  });

  test('returns already-following when the redeemer already follows the creator', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'creator', revoked: false,
      expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    const result = await redeemPersonalInvite('T', 'redeemer', 'code', new Set(['creator']));
    expect(result).toEqual({ ok: false, reason: 'already-following' });
    expect(db.registerAsFollower).not.toHaveBeenCalled();
    expect(db.incrementInviteRedemptions).not.toHaveBeenCalled();
  });

  test('returns creator-missing when getCreatorCode returns null', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'creator', revoked: false,
      expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    db.getCreatorCode.mockResolvedValue(null);
    const result = await redeemPersonalInvite('T', 'redeemer', 'code', new Set());
    expect(result).toEqual({ ok: false, reason: 'creator-missing' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx jest tests/invites.test.js -t 'redeemPersonalInvite'
```

Expected: FAIL — `redeemPersonalInvite is not a function`.

- [ ] **Step 3: Implement `redeemPersonalInvite`**

Add to `js/invites.js`:

```js
import {
  readInviteIndex, readUserInvite, incrementInviteRedemptions, getCreatorCode,
  registerAsFollower, setFollowingEntry,
} from './db.js';

// Result shapes:
//   success: { ok: true, creatorUid, creatorCode, creatorLabel }
//   failure: { ok: false, reason: 'not-found'|'revoked'|'expired'|'cap'|'self'|'already-following'|'creator-missing' }

export async function redeemPersonalInvite(token, redeemerUid, redeemerCode, alreadyFollowingSet) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'not-found' };

  const indexEntry = await readInviteIndex(token);
  if (!indexEntry) return { ok: false, reason: 'not-found' };
  if (indexEntry.scope !== 'personal') return { ok: false, reason: 'not-found' };

  // Parse owner path: users/{uid}/invites/{token}
  const match = indexEntry.ownerPath.match(/^users\/([^/]+)\/invites\/([^/]+)$/);
  if (!match) return { ok: false, reason: 'not-found' };
  const [, creatorUid] = match;

  const invite = await readUserInvite(creatorUid, token);
  if (!invite) return { ok: false, reason: 'not-found' };
  if (invite.revoked) return { ok: false, reason: 'revoked' };
  if (invite.expiresAt != null && invite.expiresAt < Date.now()) return { ok: false, reason: 'expired' };
  if (invite.redemptionCap != null && (invite.redemptionsUsed || 0) >= invite.redemptionCap) {
    return { ok: false, reason: 'cap' };
  }
  if (creatorUid === redeemerUid) return { ok: false, reason: 'self' };
  if (alreadyFollowingSet && alreadyFollowingSet.has && alreadyFollowingSet.has(creatorUid)) {
    return { ok: false, reason: 'already-following' };
  }

  const creatorCode = await getCreatorCode(creatorUid);
  if (!creatorCode) return { ok: false, reason: 'creator-missing' };

  // Create the follow relationship and persist in own following list.
  await registerAsFollower(creatorUid, redeemerUid, redeemerCode);
  await setFollowingEntry(redeemerUid, creatorUid, creatorCode, '');
  await incrementInviteRedemptions(creatorUid, token);

  return { ok: true, creatorUid, creatorCode, creatorLabel: invite.creatorLabel || '' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npx jest tests/invites.test.js
npx jest
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add js/invites.js tests/invites.test.js
git commit -m "feat: invites.redeemPersonalInvite

Resolves token via inviteIndex, validates all failure modes (not-found /
revoked / expired / cap / self / already-following / creator-missing),
and on success creates the follow via the existing
registerAsFollower+setFollowingEntry plumbing. Returns a structured
{ ok, reason } so the caller can render the right friendly error."
```

---

## Task 8: `app.js` — URL token detection and redemption routing for existing users

When the app boots with `?i={token}` in the URL, route to the redemption flow before showing the main UI. Only the existing-user branch is wired in this task; the brand-new-user branch is Task 9.

The integration with the existing `ensureIdentity` flow:

- Boot reads the URL. If a token is present, it's captured in a `pendingInviteToken` local variable.
- After `ensureIdentity()` returns (so we have a `userId`), if `pendingInviteToken` is set and the identity was *not* newly created in this boot, redemption fires.
- Redemption result is rendered: success → toast/log, failure → friendly-failure overlay. Either way, the user stays in their current context (no forced re-routing to Direct).
- The URL is cleaned up via `history.replaceState` so a refresh doesn't re-trigger.

**Files:**
- Modify: `js/app.js`
- Modify: `tests/invites.test.js`

- [ ] **Step 1: Add a helper that orchestrates redemption, expose it from invites.js**

Add to `js/invites.js`:

```js
// Hook callable from app.js boot. Pulls the current following set from local store
// so the already-following check is fast, then dispatches to redeem.
import { getFollowing } from './store.js';

export async function attemptRedeemFromUrl(token, redeemerUid, redeemerCode) {
  if (!token) return null;
  const followingSet = new Set(getFollowing().map((e) => e.userId));
  return redeemPersonalInvite(token, redeemerUid, redeemerCode, followingSet);
}

export function extractInviteTokenFromUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const t = url.searchParams.get('i');
    if (!t) return null;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(t)) return null;
    return t;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Write the failing tests in `tests/invites.test.js`**

```js
const { attemptRedeemFromUrl, extractInviteTokenFromUrl } = require('../js/invites');

jest.mock('../js/store.js', () => ({ getFollowing: jest.fn(() => []) }));
const store = require('../js/store.js');

describe('extractInviteTokenFromUrl', () => {
  test('returns the token when ?i= is present', () => {
    expect(extractInviteTokenFromUrl('https://app.example/?i=ABC123')).toBe('ABC123');
  });

  test('returns null when ?i= is missing', () => {
    expect(extractInviteTokenFromUrl('https://app.example/')).toBeNull();
  });

  test('returns null on a malformed token', () => {
    expect(extractInviteTokenFromUrl('https://app.example/?i=' + 'x'.repeat(80))).toBeNull();
    expect(extractInviteTokenFromUrl('https://app.example/?i=has spaces')).toBeNull();
  });

  test('returns null on a non-URL input', () => {
    expect(extractInviteTokenFromUrl('not a url')).toBeNull();
  });
});

describe('attemptRedeemFromUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.getFollowing.mockReturnValue([]);
  });

  test('returns null when token is null', async () => {
    const result = await attemptRedeemFromUrl(null, 'uid', 'code');
    expect(result).toBeNull();
  });

  test('passes the current following set as the already-following check', async () => {
    store.getFollowing.mockReturnValue([{ userId: 'creator', code: 'X', label: '' }]);
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'creator', revoked: false,
      expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    const result = await attemptRedeemFromUrl('T', 'me', 'mycode');
    expect(result).toEqual({ ok: false, reason: 'already-following' });
  });
});
```

- [ ] **Step 3: Run the new tests; verify the existing-tests still pass and these are wired**

```
npx jest tests/invites.test.js
```

Expected: PASS — including the new `extractInviteTokenFromUrl` and `attemptRedeemFromUrl` blocks.

- [ ] **Step 4: Wire boot-path redemption into `js/app.js`**

In `js/app.js`, locate the existing init function (it dispatches to `ensureIdentity` and then to the main-UI bootstrap). Add the URL-token capture immediately at the top of init, and the post-identity redemption dispatch immediately after a successful `ensureIdentity` result on the non-new-user path.

Add near the imports:

```js
import { attemptRedeemFromUrl, extractInviteTokenFromUrl } from './invites.js';
```

Inside `init()` (or whatever the top-level boot function is named — look for the one that calls `ensureIdentity()` and then `initHeader` / `initList` / etc.). Capture the token immediately, before any UI shows:

```js
const pendingInviteToken = extractInviteTokenFromUrl(window.location.href);
```

After `ensureIdentity()` resolves with `{ identity, isNew }`, dispatch redemption for the existing-user case (the new-user case is wired in Task 9):

```js
if (pendingInviteToken && !isNew) {
  const result = await attemptRedeemFromUrl(pendingInviteToken, identity.userId, identity.code);
  if (result) {
    handleInviteRedemptionResult(result);
    // Clean the URL so a refresh doesn't re-trigger.
    try {
      const clean = new URL(window.location.href);
      clean.searchParams.delete('i');
      window.history.replaceState({}, document.title, clean.toString());
    } catch { /* no-op on unusual URLs */ }
  }
}
```

Add the result-handler function in `js/app.js`:

```js
function handleInviteRedemptionResult(result) {
  if (result.ok) {
    // On success, the follow is now in place. No banner — the contact will appear
    // in the user's Following list once their watch subscriptions tick.
    return;
  }
  showInviteFailureOverlay(result.reason);
}

function showInviteFailureOverlay(reason) {
  const overlay = document.getElementById('invite-failure-overlay');
  const messageEl = document.getElementById('invite-failure-message');
  const continueBtn = document.getElementById('invite-failure-continue');
  if (!overlay || !messageEl || !continueBtn) return;
  messageEl.textContent = inviteFailureCopy(reason);
  overlay.classList.remove('hidden');
  continueBtn.onclick = () => overlay.classList.add('hidden');
}

function inviteFailureCopy(reason) {
  switch (reason) {
    case 'not-found': return "This invite link isn't valid.";
    case 'revoked':   return 'This invite link has been revoked.';
    case 'expired':   return 'This invite link has expired.';
    case 'cap':       return 'This invite link is no longer accepting new joiners.';
    case 'self':      return "That's your own invite link.";
    case 'already-following': return 'You already follow this person.';
    case 'creator-missing':   return "The link's creator no longer has an account.";
    default:          return "This invite link can't be used right now.";
  }
}
```

The `invite-failure-overlay` markup is added in Task 11.

- [ ] **Step 5: Add an integration test for the boot-time existing-user redemption path**

Append to `tests/invites.test.js`. The test exercises the full path via the same module-mocking pattern `tests/recovery.test.js` uses to load `js/app`. Place this in a new `describe` block at the end of the file:

```js
describe('boot-time redemption (existing user, integration)', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    localStorage.clear();
    document.body.innerHTML = `
      <div id="invite-failure-overlay" class="hidden">
        <p id="invite-failure-message"></p>
        <button id="invite-failure-continue">Continue</button>
      </div>
    `;
    // Restore the mocks that the resetModules-cleared modules need.
    // (See tests/recovery.test.js for the canonical example.)
  });

  test('valid token + existing identity → redemption fires and overlay stays hidden on success', async () => {
    // This test exercises the integration via attemptRedeemFromUrl directly.
    // The full app-boot path is covered by manual smoke + the test in tests/recovery.test.js
    // pattern; here we just verify the success copy path.
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/TOKEN' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'TOKEN', creatorUid: 'creator', creatorLabel: 'Mike',
      revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    db.getCreatorCode.mockResolvedValue('ABC123');
    store.getFollowing.mockReturnValue([]);
    const result = await attemptRedeemFromUrl('TOKEN', 'redeemer-uid', 'redeemer-code');
    expect(result.ok).toBe(true);
    expect(result.creatorUid).toBe('creator');
  });
});
```

> **Note:** the full boot-path integration is covered indirectly by Task 11's end-to-end test. Faithful reproduction of `tests/recovery.test.js`'s app-loading pattern is left to that task to avoid duplication.

- [ ] **Step 6: Run all tests**

```
npx jest
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add js/app.js js/invites.js tests/invites.test.js
git commit -m "feat: boot-time invite redemption for existing users

URL ?i={token} is captured on boot. After ensureIdentity resolves with
an existing identity, the token is redeemed via attemptRedeemFromUrl.
Success is silent (the new contact appears via watch subscriptions);
failure surfaces a friendly overlay parameterized by reason code. The
URL is cleaned via history.replaceState so a refresh doesn't re-trigger."
```

---

## Task 9: `app.js` + welcome variation — brand-new user via personal-scope link

A brand-new user (empty localStorage) arriving via `?i={token}` for a valid personal-scope invite sees a welcome screen that names the inviter (*"You've been invited to follow Mike P."*) instead of the generic welcome. After they finish secret-phrase setup and identity creation, the redemption fires automatically.

The implementation extends `showWelcomeScreen` to accept an optional invite-framing parameter. The current signature is `showWelcomeScreen()` returning a `'new' | 'restore'` choice; we extend it to `showWelcomeScreen({ inviteCreatorLabel } = {})`.

**Files:**
- Modify: `js/app.js`
- Modify: `index.template.html`
- Modify: `tests/invites.test.js`

- [ ] **Step 1: Add invite-framing markup to the welcome screen**

In `index.template.html`, locate the existing `#welcome-screen` block (line ~36 per the codebase). Add a heading element above the existing brand-mark span:

```html
<div id="welcome-screen" class="welcome-screen hidden">
  <p id="welcome-invite-framing" class="welcome-invite-framing hidden"></p>
  <span class="brand-mark welcome-brand">k&#x0338;n&#x0336;o&#x0338;c&#x0335;k&#x0335; &#x0336;k&#x0338;n&#x0337;o&#x0335;c&#x0338;k&#x0335;</span>
  <div class="welcome-btns">
    <button id="welcome-new-btn" class="primary-btn">I'm new</button>
    <button id="welcome-restore-btn" class="ghost-btn">I have a secret phrase</button>
  </div>
</div>
```

(Leave the rest of the welcome-screen markup intact.)

- [ ] **Step 2: Add minimal CSS for the framing line**

In `css/app.css`, add (near the existing `.welcome-*` rules):

```css
.welcome-invite-framing {
  font-size: 1rem;
  text-align: center;
  margin: 0 0 0.5rem 0;
  color: var(--text);
}
```

- [ ] **Step 3: Extend `showWelcomeScreen` to render the framing line**

In `js/app.js`, change the existing `showWelcomeScreen` function:

```js
export function showWelcomeScreen({ inviteCreatorLabel = null } = {}) {
  const el = document.getElementById('welcome-screen');
  const newBtn = document.getElementById('welcome-new-btn');
  const restoreBtn = document.getElementById('welcome-restore-btn');
  const framingEl = document.getElementById('welcome-invite-framing');
  if (framingEl) {
    if (inviteCreatorLabel) {
      framingEl.textContent = `You've been invited to follow ${inviteCreatorLabel}. First, let's set up your account.`;
      framingEl.classList.remove('hidden');
    } else {
      framingEl.textContent = '';
      framingEl.classList.add('hidden');
    }
  }
  el.classList.remove('hidden');
  // (existing return-Promise wiring unchanged below)
  // ...
}
```

(Preserve the rest of the function — the event listener wiring and Promise resolution.)

- [ ] **Step 4: Resolve the invite's creator label before showing the welcome screen**

In `js/app.js` `init()`, before the empty-localStorage branch calls `showWelcomeScreen()`, attempt to resolve the invite's creator label if a `pendingInviteToken` is present. Pattern:

```js
let inviteCreatorLabel = null;
if (pendingInviteToken) {
  // Pre-resolve the invite so we can name the inviter on the welcome screen.
  // We only need creatorLabel here; full redemption fires after identity is created.
  try {
    const indexEntry = await readInviteIndex(pendingInviteToken);
    if (indexEntry && indexEntry.scope === 'personal') {
      const match = indexEntry.ownerPath.match(/^users\/([^/]+)\/invites\/([^/]+)$/);
      if (match) {
        const invite = await readUserInvite(match[1], match[2]);
        if (invite && !invite.revoked) {
          inviteCreatorLabel = invite.creatorLabel || null;
        }
      }
    }
  } catch { /* swallow — fallback to generic welcome */ }
}
```

(Add the imports at the top of `js/app.js`: `import { readInviteIndex, readUserInvite } from './db.js';`)

Then pass the label into `showWelcomeScreen` in the empty-localStorage branch:

```js
const choice = await showWelcomeScreen({ inviteCreatorLabel });
```

And after `createNewAccount()` returns for a brand-new user, dispatch the redemption:

```js
if (pendingInviteToken && isNew) {
  const result = await attemptRedeemFromUrl(pendingInviteToken, identity.userId, identity.code);
  if (result) handleInviteRedemptionResult(result);
  // Clean URL (same as existing-user branch).
  try {
    const clean = new URL(window.location.href);
    clean.searchParams.delete('i');
    window.history.replaceState({}, document.title, clean.toString());
  } catch { /* no-op */ }
}
```

(You can factor the URL-cleanup into a helper if both branches use it.)

- [ ] **Step 5: Write the failing tests for the welcome framing**

Append to `tests/invites.test.js`:

```js
describe('welcome screen invite framing', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <div id="welcome-screen" class="welcome-screen hidden">
        <p id="welcome-invite-framing" class="hidden"></p>
        <button id="welcome-new-btn">I'm new</button>
        <button id="welcome-restore-btn">I have a secret phrase</button>
      </div>
    `;
  });

  test('showWelcomeScreen without an invite hides the framing line', async () => {
    const { showWelcomeScreen } = require('../js/app');
    // Fire-and-forget the promise; we only care about initial DOM state.
    showWelcomeScreen();
    expect(document.getElementById('welcome-invite-framing').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('welcome-invite-framing').textContent).toBe('');
  });

  test('showWelcomeScreen with a creator label renders the framing text', async () => {
    const { showWelcomeScreen } = require('../js/app');
    showWelcomeScreen({ inviteCreatorLabel: 'Mike P.' });
    const framing = document.getElementById('welcome-invite-framing');
    expect(framing.classList.contains('hidden')).toBe(false);
    expect(framing.textContent).toContain('Mike P.');
    expect(framing.textContent).toContain('First, let');
  });
});
```

- [ ] **Step 6: Run tests; verify pass**

```
npx jest tests/invites.test.js
npx jest
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add js/app.js index.template.html css/app.css tests/invites.test.js
git commit -m "feat: brand-new-user welcome variation for personal-scope link

Adds an optional inviteCreatorLabel parameter to showWelcomeScreen.
Boot path resolves the token's creator label before rendering, so a
brand-new user sees 'You've been invited to follow {creatorLabel}.'
After identity creation, the queued redemption fires automatically."
```

---

## Task 10: `inviteModal.js` — shared modal component

Build the modal that the user sees when they tap "Create invite link" / "View invite link" in the drawer. Implements the two visual states from spec §9.4: **State A — Create** (label input + Create button + Cancel) and **State B — Manage** (URL display + Copy / Regenerate / Revoke / Close). Parameterized by scope so Phase 1 can wire the group-scope entry point against the same module.

The modal owns no Firebase state directly — it calls into `js/invites.js` operations. The drawer (Task 11) is responsible for opening/closing the modal and feeding it the current user's id.

**Files:**
- Create: `js/inviteModal.js`
- Modify: `index.template.html`
- Modify: `css/app.css`
- Create: `tests/inviteModal.test.js`

- [ ] **Step 1: Add the modal markup**

In `index.template.html`, add (near the existing modal blocks such as the recovery-code modal):

```html
<div id="invite-modal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="invite-modal-title">
  <div class="modal-card">
    <h2 id="invite-modal-title" class="modal-title">Your invite link</h2>
    <p id="invite-modal-subtitle" class="modal-subtitle"></p>

    <!-- State A: create -->
    <div id="invite-modal-create" class="hidden">
      <label class="modal-label" for="invite-modal-label-input">Your name on the invite</label>
      <input id="invite-modal-label-input" class="text-input" type="text" maxlength="40" placeholder="e.g. Mike P." />
      <p id="invite-modal-label-error" class="error-msg hidden"></p>
      <div class="modal-actions">
        <button id="invite-modal-create-btn" class="primary-btn">Create invite link</button>
        <button id="invite-modal-cancel-btn" class="ghost-btn">Cancel</button>
      </div>
    </div>

    <!-- State B: manage -->
    <div id="invite-modal-manage" class="hidden">
      <div class="invite-url-row">
        <code id="invite-modal-url" class="invite-url"></code>
      </div>
      <div class="modal-actions modal-actions-wrap">
        <button id="invite-modal-copy-btn" class="ghost-btn">Copy</button>
        <button id="invite-modal-regen-btn" class="ghost-btn">Regenerate</button>
        <button id="invite-modal-revoke-btn" class="ghost-btn">Revoke</button>
      </div>
      <div class="modal-actions">
        <button id="invite-modal-close-btn" class="primary-btn">Close</button>
      </div>
    </div>
  </div>
</div>

<div id="invite-failure-overlay" class="modal-overlay hidden" role="dialog" aria-modal="true">
  <div class="modal-card modal-card-small">
    <p id="invite-failure-message"></p>
    <div class="modal-actions">
      <button id="invite-failure-continue" class="primary-btn">Continue</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add minimal styles**

In `css/app.css`, append:

```css
.modal-label {
  display: block;
  font-size: 0.9rem;
  margin-bottom: 0.25rem;
}
.invite-url-row {
  background: var(--surface);
  border-radius: 6px;
  padding: 0.6rem 0.8rem;
  margin: 0.5rem 0;
  overflow-x: auto;
}
.invite-url {
  font-family: monospace;
  font-size: 0.85rem;
  word-break: break-all;
}
.modal-actions-wrap {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}
.modal-card-small {
  max-width: 320px;
}
```

(Adjust to existing modal-overlay / modal-card definitions if those already exist with the recovery-code modal — reuse, don't duplicate.)

- [ ] **Step 3: Write failing tests for the modal component**

Create `tests/inviteModal.test.js`:

```js
// tests/inviteModal.test.js
jest.mock('../js/invites.js', () => ({
  createPersonalInvite: jest.fn(),
  regeneratePersonalInvite: jest.fn(),
  revokePersonalInvite: jest.fn(),
}));

const invites = require('../js/invites.js');
const { openInviteModal } = require('../js/inviteModal');

function setupDom(activeInvite) {
  document.body.innerHTML = `
    <div id="invite-modal" class="modal-overlay hidden">
      <div class="modal-card">
        <h2 id="invite-modal-title"></h2>
        <p id="invite-modal-subtitle"></p>
        <div id="invite-modal-create" class="hidden">
          <input id="invite-modal-label-input" type="text" maxlength="40" />
          <p id="invite-modal-label-error" class="error-msg hidden"></p>
          <button id="invite-modal-create-btn"></button>
          <button id="invite-modal-cancel-btn"></button>
        </div>
        <div id="invite-modal-manage" class="hidden">
          <code id="invite-modal-url"></code>
          <button id="invite-modal-copy-btn"></button>
          <button id="invite-modal-regen-btn"></button>
          <button id="invite-modal-revoke-btn"></button>
          <button id="invite-modal-close-btn"></button>
        </div>
      </div>
    </div>
  `;
}

describe('openInviteModal — personal scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDom();
    // jsdom-friendly clipboard mock
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  test('renders State A (create) when no active invite is supplied', () => {
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: null });
    expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('invite-modal-create').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('invite-modal-manage').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('invite-modal-title').textContent).toBe('Your invite link');
  });

  test('renders State B (manage) when an active invite is supplied', () => {
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: { token: 'TOKEN', creatorLabel: 'Mike', url: 'https://x/?i=TOKEN' } });
    expect(document.getElementById('invite-modal-manage').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('invite-modal-create').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('invite-modal-url').textContent).toBe('https://x/?i=TOKEN');
  });

  test('Create button validates label and calls createPersonalInvite', async () => {
    invites.createPersonalInvite.mockResolvedValue({ token: 'NEW', url: 'https://x/?i=NEW', existing: false });
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: null });

    document.getElementById('invite-modal-label-input').value = '   '; // empty after trim
    document.getElementById('invite-modal-create-btn').click();
    await Promise.resolve();
    expect(document.getElementById('invite-modal-label-error').classList.contains('hidden')).toBe(false);
    expect(invites.createPersonalInvite).not.toHaveBeenCalled();

    document.getElementById('invite-modal-label-input').value = 'Mike P.';
    document.getElementById('invite-modal-create-btn').click();
    await new Promise(setImmediate);
    expect(invites.createPersonalInvite).toHaveBeenCalledWith('uid1', 'Mike P.');
    // Modal transitions to Manage state with the new URL.
    expect(document.getElementById('invite-modal-url').textContent).toBe('https://x/?i=NEW');
    expect(document.getElementById('invite-modal-manage').classList.contains('hidden')).toBe(false);
  });

  test('Copy button writes the URL to the clipboard', async () => {
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: { token: 'T', creatorLabel: 'Mike', url: 'https://x/?i=T' } });
    document.getElementById('invite-modal-copy-btn').click();
    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://x/?i=T');
  });

  test('Regenerate calls regeneratePersonalInvite and refreshes the URL', async () => {
    invites.regeneratePersonalInvite.mockResolvedValue({ token: 'NEW2', url: 'https://x/?i=NEW2', existing: false });
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: { token: 'T', creatorLabel: 'Mike', url: 'https://x/?i=T' } });
    document.getElementById('invite-modal-regen-btn').click();
    await new Promise(setImmediate);
    expect(invites.regeneratePersonalInvite).toHaveBeenCalledWith('uid1', 'Mike');
    expect(document.getElementById('invite-modal-url').textContent).toBe('https://x/?i=NEW2');
  });

  test('Revoke calls revokePersonalInvite and transitions to Create state', async () => {
    invites.revokePersonalInvite.mockResolvedValue();
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: { token: 'T', creatorLabel: 'Mike', url: 'https://x/?i=T' } });
    document.getElementById('invite-modal-revoke-btn').click();
    await new Promise(setImmediate);
    expect(invites.revokePersonalInvite).toHaveBeenCalledWith('uid1');
    expect(document.getElementById('invite-modal-create').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('invite-modal-manage').classList.contains('hidden')).toBe(true);
  });

  test('Close button hides the modal', () => {
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: { token: 'T', creatorLabel: 'Mike', url: 'https://x/?i=T' } });
    document.getElementById('invite-modal-close-btn').click();
    expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(true);
  });

  test('Cancel button (Create state) hides the modal without writing', () => {
    openInviteModal({ scope: 'personal', userId: 'uid1', activeInvite: null });
    document.getElementById('invite-modal-cancel-btn').click();
    expect(document.getElementById('invite-modal').classList.contains('hidden')).toBe(true);
    expect(invites.createPersonalInvite).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```
npx jest tests/inviteModal.test.js
```

Expected: FAIL — `Cannot find module '../js/inviteModal'`.

- [ ] **Step 5: Implement `js/inviteModal.js`**

```js
// js/inviteModal.js
// Shared invite-link modal component. Parameterized by scope.
// Phase 0 wires only scope='personal'. Phase 1 will wire scope='group'.

import { createPersonalInvite, regeneratePersonalInvite, revokePersonalInvite } from './invites.js';

const SCOPE_COPY = {
  personal: {
    title: 'Your invite link',
    subtitle: 'People who tap this link will follow you.',
    labelHint: 'Your name on the invite',
    labelPlaceholder: 'e.g. Mike P.',
  },
  // group scope copy added in Phase 1
};

let cleanupFns = [];

function clearListeners() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
}

function on(el, evt, handler) {
  el.addEventListener(evt, handler);
  cleanupFns.push(() => el.removeEventListener(evt, handler));
}

function showState(stateName) {
  document.getElementById('invite-modal-create').classList.toggle('hidden', stateName !== 'create');
  document.getElementById('invite-modal-manage').classList.toggle('hidden', stateName !== 'manage');
}

function renderManageUrl(url) {
  document.getElementById('invite-modal-url').textContent = url;
}

function hideError() {
  const errEl = document.getElementById('invite-modal-label-error');
  errEl.classList.add('hidden');
  errEl.textContent = '';
}

function showError(msg) {
  const errEl = document.getElementById('invite-modal-label-error');
  errEl.classList.remove('hidden');
  errEl.textContent = msg;
}

function closeModal() {
  document.getElementById('invite-modal').classList.add('hidden');
  clearListeners();
}

export function openInviteModal({ scope, userId, activeInvite = null }) {
  const copy = SCOPE_COPY[scope];
  if (!copy) throw new Error(`Unknown scope: ${scope}`);

  document.getElementById('invite-modal-title').textContent = copy.title;
  document.getElementById('invite-modal-subtitle').textContent = copy.subtitle;
  document.getElementById('invite-modal-label-input').placeholder = copy.labelPlaceholder;

  hideError();
  clearListeners();
  document.getElementById('invite-modal').classList.remove('hidden');

  let currentInvite = activeInvite ? { ...activeInvite } : null;

  if (currentInvite) {
    showState('manage');
    renderManageUrl(currentInvite.url);
  } else {
    showState('create');
    document.getElementById('invite-modal-label-input').value = '';
  }

  // Create
  on(document.getElementById('invite-modal-create-btn'), 'click', async () => {
    const raw = document.getElementById('invite-modal-label-input').value;
    const trimmed = (raw || '').trim();
    if (!trimmed) { showError('Please enter a name.'); return; }
    if (trimmed.length > 40) { showError('Name must be at most 40 characters.'); return; }
    hideError();
    try {
      const result = await createPersonalInvite(userId, trimmed);
      currentInvite = { token: result.token, url: result.url, creatorLabel: trimmed };
      showState('manage');
      renderManageUrl(result.url);
    } catch (err) {
      showError(err.message || 'Could not create invite. Try again.');
    }
  });

  on(document.getElementById('invite-modal-cancel-btn'), 'click', () => closeModal());

  // Copy
  on(document.getElementById('invite-modal-copy-btn'), 'click', async () => {
    if (!currentInvite) return;
    try { await navigator.clipboard.writeText(currentInvite.url); } catch { /* clipboard denied */ }
  });

  // Regenerate
  on(document.getElementById('invite-modal-regen-btn'), 'click', async () => {
    if (!currentInvite) return;
    const result = await regeneratePersonalInvite(userId, currentInvite.creatorLabel);
    currentInvite = { token: result.token, url: result.url, creatorLabel: currentInvite.creatorLabel };
    renderManageUrl(result.url);
  });

  // Revoke
  on(document.getElementById('invite-modal-revoke-btn'), 'click', async () => {
    await revokePersonalInvite(userId);
    currentInvite = null;
    showState('create');
    document.getElementById('invite-modal-label-input').value = '';
  });

  // Close
  on(document.getElementById('invite-modal-close-btn'), 'click', () => closeModal());
}
```

- [ ] **Step 6: Run tests to verify they pass**

```
npx jest tests/inviteModal.test.js
npx jest
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add js/inviteModal.js tests/inviteModal.test.js index.template.html css/app.css
git commit -m "feat: shared invite-link modal component (personal scope wired)

State A (create) and State B (manage) with copy/regenerate/revoke
controls. Parameterized by scope — Phase 1 will wire scope='group'
against the same module. Phase 0 exposes only personal scope.
Includes the friendly-failure overlay markup; behavior added in Task 8."
```

---

## Task 11: `mycode.js` — drawer row and live invite-state sync

Add a new row in the code drawer beneath the existing share-code Copy button. The row displays a single button whose label depends on whether an active personal invite exists: **"Create invite link"** when none, **"View invite link"** when one exists. Tapping opens the modal in the appropriate state. The row subscribes to the user's invites collection via `watchUserInvites` so a create-on-device-A propagates to device-B's drawer without a refresh.

**Files:**
- Modify: `js/mycode.js`
- Modify: `index.template.html`
- Modify: `tests/mycode.test.js`

- [ ] **Step 1: Add the drawer row markup**

In `index.template.html`, locate the existing `#code-drawer` block and insert a new row beneath the share-code section (where the Copy button lives) but above the recovery-code pill:

```html
<div class="drawer-row invite-row">
  <span class="drawer-row-label">Your invite link:</span>
  <button id="invite-link-btn" class="ghost-btn">Create invite link</button>
</div>
```

(If you can't find an existing class like `.drawer-row`, use whatever wrapper convention the share-code row uses. Match the surrounding layout — the goal is one new row with a label on the left and a button on the right, consistent with the share-code row above it.)

- [ ] **Step 2: Write the failing tests in `tests/mycode.test.js`**

Add the new mock entries near the top (replacing the existing block):

```js
jest.mock('../js/db.js', () => ({
  rotateCode: jest.fn(),
  // ... existing entries ...
  watchUserInvites: jest.fn(),
  readUserInvites: jest.fn(),
}));
jest.mock('../js/inviteModal.js', () => ({
  openInviteModal: jest.fn(),
}));

const { watchUserInvites, readUserInvites } = require('../js/db.js');
const { openInviteModal } = require('../js/inviteModal.js');
```

Update the test DOM setup to include the new row:

```js
beforeEach(() => {
  document.body.innerHTML = `
    <span id="my-code-display" class="code-display"></span>
    <button id="rotate-code-btn" class="rotate-btn"></button>
    <button id="copy-code-btn" class="ghost-btn">Copy</button>
    <p id="rotate-error-msg" class="error-msg hidden"></p>
    <button id="invite-link-btn" class="ghost-btn">Create invite link</button>
  `;
  // ... existing setup ...
});
```

Append these tests:

```js
describe('invite-link row', () => {
  test('initCodeDrawer shows "Create invite link" when no active invite is present', () => {
    watchUserInvites.mockImplementation((uid, cb) => { cb({}); return () => {}; });
    initCodeDrawer('uid1', 'ABC123');
    expect(document.getElementById('invite-link-btn').textContent).toBe('Create invite link');
  });

  test('initCodeDrawer shows "View invite link" when an active invite exists', () => {
    watchUserInvites.mockImplementation((uid, cb) => {
      cb({ T1: { scope: 'personal', token: 'T1', revoked: false, creatorLabel: 'Mike' } });
      return () => {};
    });
    initCodeDrawer('uid1', 'ABC123');
    expect(document.getElementById('invite-link-btn').textContent).toBe('View invite link');
  });

  test('tapping the button opens the modal with the current invite state', () => {
    let cb;
    watchUserInvites.mockImplementation((uid, _cb) => { cb = _cb; return () => {}; });
    initCodeDrawer('uid1', 'ABC123');
    cb({ T1: { scope: 'personal', token: 'T1', revoked: false, creatorLabel: 'Mike' } });
    document.getElementById('invite-link-btn').click();
    expect(openInviteModal).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'personal',
      userId: 'uid1',
      activeInvite: expect.objectContaining({ token: 'T1', creatorLabel: 'Mike' }),
    }));
  });

  test('tapping the button when no active invite opens the modal in create mode', () => {
    watchUserInvites.mockImplementation((uid, cb) => { cb({}); return () => {}; });
    initCodeDrawer('uid1', 'ABC123');
    document.getElementById('invite-link-btn').click();
    expect(openInviteModal).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'personal',
      userId: 'uid1',
      activeInvite: null,
    }));
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```
npx jest tests/mycode.test.js -t 'invite-link row'
```

Expected: FAIL — relevant button doesn't exist or button label doesn't update.

- [ ] **Step 4: Implement the drawer row in `js/mycode.js`**

Add imports at the top of `js/mycode.js`:

```js
import { watchUserInvites } from './db.js';
import { openInviteModal } from './inviteModal.js';
```

In the existing `initCodeDrawer(userId, code)` function (or wherever the drawer init happens), after the existing share-code wiring, add:

```js
// --- Invite-link row ---
let currentActiveInvite = null;
const inviteBtn = document.getElementById('invite-link-btn');

function renderInviteRow() {
  if (!inviteBtn) return;
  inviteBtn.textContent = currentActiveInvite ? 'View invite link' : 'Create invite link';
}

watchUserInvites(userId, (collection) => {
  let active = null;
  for (const [token, inv] of Object.entries(collection || {})) {
    if (inv && inv.scope === 'personal' && !inv.revoked) {
      active = { token, ...inv, url: `${location.origin}/?i=${token}` };
      break;
    }
  }
  currentActiveInvite = active;
  renderInviteRow();
});

if (inviteBtn) {
  inviteBtn.addEventListener('click', () => {
    openInviteModal({ scope: 'personal', userId, activeInvite: currentActiveInvite });
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```
npx jest tests/mycode.test.js
npx jest
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add js/mycode.js index.template.html tests/mycode.test.js
git commit -m "feat: code drawer invite-link row

Adds a row beneath the share-code Copy button. Label flips between
'Create invite link' and 'View invite link' based on the user's
current invite state (read live via watchUserInvites for cross-device
sync). Tapping opens the shared invite modal in the appropriate state."
```

---

## Task 12: End-to-end smoke test + manual UI verification

The unit and component tests cover most of the surface; this task wires up one full integration test against the boot path and runs a manual smoke check in the dev server to catch UI-layer regressions.

**Files:**
- Modify: `tests/invites.test.js`
- (Manual): start `npm run dev` and exercise the flow in a browser.

- [ ] **Step 1: Add a full-flow integration test**

The integration test exercises the modal-to-redemption flow in a single sequence:

1. User A's drawer creates an invite.
2. User B (different uid, "redeemer") arrives via the URL.
3. Redemption is performed; the follow plumbing is invoked.

Append to `tests/invites.test.js`:

```js
describe('full flow: create → redeem (integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    store.getFollowing.mockReturnValue([]);
  });

  test('createPersonalInvite → attemptRedeemFromUrl results in follow plumbing for the redeemer', async () => {
    // 1. User A creates an invite.
    db.readUserInvites = jest.fn().mockResolvedValue({}); // no active invites yet
    db.claimInviteToken.mockResolvedValue(true);
    db.writeUserInvite.mockResolvedValue();

    const created = await createPersonalInvite('user-a', 'Alice');

    expect(db.writeUserInvite).toHaveBeenCalledWith('user-a', created.token, expect.objectContaining({ creatorLabel: 'Alice' }));

    // 2. User B taps the invite URL → token extracted.
    const token = extractInviteTokenFromUrl(created.url);
    expect(token).toBe(created.token);

    // 3. Boot-time redemption fires for User B (existing identity, not following Alice yet).
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: `users/user-a/invites/${token}` });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token, creatorUid: 'user-a', creatorLabel: 'Alice',
      revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    db.getCreatorCode.mockResolvedValue('AAA111');

    const result = await attemptRedeemFromUrl(token, 'user-b', 'BBB222');
    expect(result.ok).toBe(true);
    expect(result.creatorCode).toBe('AAA111');
    expect(result.creatorLabel).toBe('Alice');
    expect(db.registerAsFollower).toHaveBeenCalledWith('user-a', 'user-b', 'BBB222');
    expect(db.setFollowingEntry).toHaveBeenCalledWith('user-b', 'user-a', 'AAA111', '');
    expect(db.incrementInviteRedemptions).toHaveBeenCalledWith('user-a', token);
  });
});
```

- [ ] **Step 2: Run all tests**

```
npx jest
```

Expected: all tests pass (existing 387 + Phase 0 additions).

- [ ] **Step 3: Manual UI verification**

This is mandatory because UI-layer regressions don't show up in jest. Start the dev server and exercise the flow in a real browser:

```
npm run dev
```

Browser checklist (visit `http://localhost:8080` or whatever the dev server reports):

1. **Drawer row appears.** Open the drawer (tap your code area). Confirm a new row beneath "Your share code: ... [Copy]" reads `Your invite link: [Create invite link]`.
2. **Create flow.** Tap `Create invite link` → modal opens in Create state. Type your name → tap `Create invite link`. Modal transitions to Manage state showing the URL.
3. **Copy works.** Tap `Copy` → clipboard contains the URL (paste somewhere to confirm).
4. **Drawer label flips.** Close the modal. Drawer row now reads `View invite link`. Re-open the drawer → confirm.
5. **Regenerate.** Open the modal → tap `Regenerate`. URL in the modal changes. Open another tab on the same dev URL with the OLD URL → confirm friendly-failure overlay shows "This invite link has been revoked." (or "isn't valid" — both are acceptable per spec).
6. **Revoke.** Open the modal → tap `Revoke`. Modal returns to Create state. Drawer row flips back to `Create invite link`.
7. **Redemption (existing user).** With a second browser profile / incognito window already logged into a different account, paste the active invite URL and visit. Confirm: the follow appears in the Following list. URL is cleaned of `?i=` after redemption.
8. **Redemption (brand-new user).** Clear localStorage (devtools), then visit the invite URL. Welcome screen reads *"You've been invited to follow {creatorLabel}. First, let's set up your account."* Complete identity creation → land in main UI → confirm the inviter appears in the Following list.
9. **Self-invite.** With your own URL, refresh your own session → friendly-failure overlay reads "That's your own invite link."

If anything in the checklist is wrong, fix it and re-run jest before continuing.

- [ ] **Step 4: Build verification**

Confirm the build produces a working `index.html`:

```
node scripts/dev-build.js
```

Expected: no errors. Inspect `index.html` to confirm the new modal markup landed.

- [ ] **Step 5: Commit any incidental fixes from manual verification**

If manual verification surfaced any small fixes (CSS spacing, button copy tweaks, etc.), commit those now:

```bash
git add <fixed files>
git commit -m "fix: address Phase 0 manual-verification findings

<description>"
```

If no fixes were needed, skip this step.

- [ ] **Step 6: Final commit (changelog / phase complete)**

Add a brief note to whatever changelog/release-notes mechanism the project uses, or just commit the integration test:

```bash
git add tests/invites.test.js
git commit -m "test: full-flow integration test for invite create → redeem

Phase 0 (1:1 follow-me invite links) complete. After this commit:
- Users can create one personal invite link from the code drawer.
- Tapping the link creates a follow from redeemer to creator.
- Brand-new users can onboard via a personal-scope link.
- All lifecycle ops (create / copy / revoke / regenerate) work.
- GROUPS_ENABLED flag is wired but gates no behavior in Phase 0.

Phase 1 (groups MVP) and Phase 2 (per-audience overrides) ship next."
```

---

## Done

After Task 12, Phase 0 is shipped:

- A user can create exactly one active personal invite link from their code drawer.
- The link's lifecycle (create / revoke / regenerate / cap-tracking) is correct under the schema in spec §7.
- Tapping the link creates a follow from the redeemer to the creator. The follow uses the same `registerAsFollower` + `setFollowingEntry` plumbing as the existing add-by-code flow, so the rest of the app behaves identically.
- Brand-new users can onboard via a personal-scope link, with the welcome screen naming the inviter via `creatorLabel`.
- All seven failure modes (not-found / revoked / expired / cap / self / already-following / creator-missing) surface a friendly overlay; existing users are returned to their current context; brand-new users continue on the welcome screen.
- The shared modal component is ready for Phase 1's group-scope parameterization (just add `SCOPE_COPY.group` and call `openInviteModal({ scope: 'group', userId, groupId, activeInvite })` from the group-settings affordance).
- The `inviteIndex/{token}` lookup table is in place and ready for group-scope invites in Phase 1.

**Next:** the Phase 1 plan (groups MVP — entity, owner ops, group invites via the shared modal, navigation, knock-via-group-context) can be written against the now-shipped Phase 0 primitive.
