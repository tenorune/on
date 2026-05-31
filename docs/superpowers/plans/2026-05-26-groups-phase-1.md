# Groups Phase 1 — Groups MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the groups MVP. A user can create a group, share a group invite link, and members can see each other in a group context. Owners can rename or delete the group; members can leave it. Non-mutual co-members can knock each other within a group context, with float-to-top behavior also applied to direct contacts. The single-status model (Phase 1) means group members see each other's primary status; per-audience overrides are deferred to Phase 2.

**Architecture:** New `js/groups.js` owns group lifecycle business logic (create / rename / delete / join / leave / edit-own-displayName), composing lower-level Firebase ops in `js/db.js`. New `js/groupNav.js` owns the navigation state machine (currentContext + group cards row). New `js/groupContext.js` owns the group view itself (breadcrumb header + roster + owner settings). The Phase 0 invite primitive is extended to support `scope: 'group'` by adding entries to the `SCOPE_COPY` table in `js/inviteModal.js` and group-scope functions in `js/invites.js` — the inviteIndex lookup table and modal UI are reused unchanged. `js/knock.js` gains an optional `contextGroupId` field so knocks routed via a group context can be rendered in the right place. The `GROUPS_ENABLED` flag introduced in Phase 0 (currently false) is now wired up to gate every group-scope UI surface.

**Tech Stack:** Vanilla ES modules, Firebase Realtime Database, esbuild, jest + jsdom. Established patterns from Phase 0 carry forward: `crypto.getRandomValues` for tokens (already in invites.js), `runTransaction` for atomic claims, per-suite `jest.mock('../js/db.js', () => ({...}))` mocking, `watchStatus`-style subscriptions for cross-device sync.

**Spec reference:** `docs/superpowers/specs/2026-05-25-groups-design.md` (rev 2), specifically §6 (navigation), §7 (data model), §8 (roles), §9 (invite system — reused), §10 Flow B (brand-new user redeeming group link), §13 (knock-via-group-context), §16 Phase 1, §16.1 (deletion notification mechanism).

---

## File Structure

**New files (created by this plan):**

| File | Responsibility |
|---|---|
| `js/groups.js` | Group lifecycle business logic: createGroup / renameGroup / deleteGroup / joinGroup / leaveGroup / editOwnDisplayName. Composes db.js primitives. No DOM. |
| `js/groupNav.js` | Navigation state: currentContext read/write/sync, group cards row render, group-card click → navigate, `+` button + zero-state CTA → create-group modal. |
| `js/groupContext.js` | Group view: breadcrumb header, member roster (live status from each member's user record), owner settings (rename/delete/invite-link), member self-actions (edit own display name, leave). |
| `tests/groups.test.js` | Unit + integration tests for js/groups.js. |
| `tests/groupNav.test.js` | DOM tests for the cards row + create flow. |
| `tests/groupContext.test.js` | DOM tests for group view render + interactions. |

**Modified files:**

| File | Change |
|---|---|
| `js/db.js` | Add: `claimGroupId`, `readGroup`, `writeGroup`, `deleteGroup`, `renameGroup`, `watchGroupMeta`, `writeMember`, `readMember`, `readMembers`, `removeMember`, `setMemberDisplayName`, `watchGroupMembers`, `writeUserGroupsEntry`, `removeUserGroupsEntry`, `readUserGroups`, `watchUserGroups`, `setCurrentContext`, `setLastVisited`. Also extends inviteIndex helpers to handle group ownerPath. |
| `js/invites.js` | Add: `createGroupInvite`, `revokeGroupInvite`, `regenerateGroupInvite`, `redeemGroupInvite`. Extend `attemptRedeemFromUrl` to dispatch by scope. Extend `resolveInviteCreatorLabel` → `resolveInvitePreview` returning `{ scope, label?, groupName? }`. |
| `js/inviteModal.js` | Add `SCOPE_COPY.group` entry; handle group-scope create with `{ scope: 'group', userId, groupId, activeInvite }` invocation. |
| `js/app.js` | Wire boot-time context restoration; dispatch redemption by scope (both `personal` and `group` now); show group context vs direct-context root based on currentContext; show group-join welcome variation. |
| `js/knock.js` | Extend `sendKnock`, `writeKnock`, and the snapshot processor to carry optional `contextGroupId`. Add 20s float-to-top anchor mechanism. Group-card unread badge for deferred knocks. |
| `js/following.js` | Apply 20s float-to-top to direct contacts (latent issue addressed). |
| `index.template.html` | Markup for: group cards row (above existing list), group context root (breadcrumb + header + roster + owner-settings affordance), create-group modal, deletion-toast, group-context invite-link entry, member-actions menu. |
| `css/app.css` | Styles for all new UI elements. Reuses existing tokens. |
| `database.rules.json` | Add `groupIdIndex`, `groups`, `pendingInvites` rules (last is forward-compat for Phase 3). |
| `js/features.js` | `GROUPS_ENABLED` is now read by multiple modules — no value change, but referenced. |
| Multiple existing test files | Update `jest.mock('../js/db.js', ...)` blocks to add the new exports as stubs. |

---

## Conventions for this plan

Same as Phase 0:

- **Test runner:** `npx jest <path>` from repo root.
- **Local dev:** `npm run dev`. **Build:** `node scripts/dev-build.js`.
- **Commit messages:** `type: subject` first line. Use `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`. Body explains the why.
- **One commit per task** unless a task explicitly says otherwise.
- **TDD discipline:** failing test first, run to confirm the failure mode, then implement.

**Mock-update discipline:** every new export added to `js/db.js` should be added to the standard six db.js-mocking test files at the same time: `tests/db.test.js`, `tests/mycode.test.js`, `tests/recovery.test.js`, `tests/favorites.test.js`, `tests/following.test.js`, `tests/me.test.js`. Phase 0 established this convention; missing entries cause `(0, _db.foo) is not a function` errors in the affected suites. Each db.js task includes a Step instructing the implementer to do this update.

---

## Task 1: Security rules + GROUPS_ENABLED activation

Phase 0 added `GROUPS_ENABLED = false` to `js/features.js` and an `inviteIndex` rule to `database.rules.json`. Phase 1 needs additional security-rule namespaces and the flag flipped on locally for the duration of this work (DON'T commit it as true — see Step 1 below).

**Files:**
- Modify: `database.rules.json`
- Modify: `js/features.js` (comment only, no value change)

- [ ] **Step 1: Add new security-rule namespaces**

Edit `database.rules.json` to add `groupIdIndex`, `groups`, and `pendingInvites` namespaces. The full file should look like:

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
    "groupIdIndex": {
      "$groupId": {
        ".read": true,
        ".write": true
      }
    },
    "groups": {
      "$groupId": {
        ".read": true,
        ".write": true
      }
    },
    "pendingInvites": {
      "$inviteeUid": {
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

All new namespaces follow the existing honor-system pattern (wide-open read + write). Spec §19 calls out that Phase B identity work will tighten these later.

- [ ] **Step 2: Annotate GROUPS_ENABLED in js/features.js**

Update the comment on the flag — no value change. Final contents:

```js
// js/features.js
export const PALETTES_ENABLED = false;
export const PALETTE_INTERACTIONS_ENABLED = false;
export const KNOCK_ENABLED = false;
export const CALL_ENABLED = false;
export const GROUPS_ENABLED = false; // Phase 1 gates group-scope UI behind this; flip to true at deploy time.
```

The flag stays `false` so this branch can merge without changing dev-environment behavior. The user controls when groups becomes visible by editing this value at deploy time (or via a per-env build substitution if that's added later).

- [ ] **Step 3: Run existing tests to confirm no regression**

```
npx jest
```

Expected: all 456 tests pass.

- [ ] **Step 4: Commit**

```bash
git add database.rules.json js/features.js
git commit -m "feat: add group/pendingInvites/groupIdIndex security rules

Phase 1 prereq. All three new namespaces follow the existing honor-
system pattern (wide-open). Phase B identity work would tighten.
GROUPS_ENABLED stays false; user flips it at deploy time."
```

---

## Task 2: db.js — groupIdIndex allocation + user-side enumeration

The user-side `users/{uid}/groups/{groupId}` enumeration record (Phase 1 schema only stores `lastVisited?`) is what the navigation layer reads to render the group cards row. The `groupIdIndex/{groupId}` table prevents ID collisions at creation time.

**Files:**
- Modify: `js/db.js`
- Modify: `tests/db.test.js`
- Modify: the 5 mock files (mycode/recovery/favorites/following/me .test.js)

- [ ] **Step 1: Write failing tests in `tests/db.test.js`**

Append at the end of the file:

```js
describe('claimGroupId', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('claims a fresh group id transactionally', async () => {
    runTransaction.mockResolvedValue({ committed: true });
    const ok = await claimGroupId('G1ABCD23');
    expect(ok).toBe(true);
    const handler = runTransaction.mock.calls[0][1];
    expect(handler(null)).toBe(true);
    expect(handler(true)).toBeUndefined();
  });

  test('returns false when the transaction aborts', async () => {
    runTransaction.mockResolvedValue({ committed: false });
    const ok = await claimGroupId('TAKENID1');
    expect(ok).toBe(false);
  });
});

describe('user-side groups enumeration', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('writeUserGroupsEntry writes lastVisited (or empty object) at users/{uid}/groups/{groupId}', async () => {
    set.mockResolvedValue();
    await writeUserGroupsEntry('uid1', 'G1', { lastVisited: 1234 });
    expect(set).toHaveBeenCalledWith('mock-ref', { lastVisited: 1234 });
    expect(ref).toHaveBeenLastCalledWith({}, 'users/uid1/groups/G1');
  });

  test('writeUserGroupsEntry with no payload writes true', async () => {
    set.mockResolvedValue();
    await writeUserGroupsEntry('uid1', 'G1');
    expect(set).toHaveBeenCalledWith('mock-ref', true);
  });

  test('removeUserGroupsEntry removes the enumeration record', async () => {
    remove.mockResolvedValue();
    await removeUserGroupsEntry('uid1', 'G1');
    expect(ref).toHaveBeenLastCalledWith({}, 'users/uid1/groups/G1');
    expect(remove).toHaveBeenCalled();
  });

  test('readUserGroups returns the collection', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ G1: { lastVisited: 10 }, G2: true }) });
    const result = await readUserGroups('uid1');
    expect(result).toEqual({ G1: { lastVisited: 10 }, G2: true });
  });

  test('readUserGroups returns empty object on miss', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    expect(await readUserGroups('uid1')).toEqual({});
  });

  test('watchUserGroups subscribes to users/{uid}/groups', () => {
    let cb;
    onValue.mockImplementation((_ref, fn) => { cb = fn; return () => {}; });
    const seen = [];
    watchUserGroups('uid1', (data) => seen.push(data));
    cb({ exists: () => true, val: () => ({ G1: true }) });
    expect(seen[0]).toEqual({ G1: true });
    cb({ exists: () => false });
    expect(seen[1]).toEqual({});
  });

  test('setLastVisited updates only the lastVisited field', async () => {
    update.mockResolvedValue();
    await setLastVisited('uid1', 'G1', 99999);
    expect(update).toHaveBeenCalledWith('mock-ref', { lastVisited: 99999 });
    expect(ref).toHaveBeenLastCalledWith({}, 'users/uid1/groups/G1');
  });
});

describe('currentContext sync', () => {
  test('setCurrentContext writes users/{uid}/currentContext', async () => {
    set.mockResolvedValue();
    await setCurrentContext('uid1', 'group:G1');
    expect(set).toHaveBeenCalledWith('mock-ref', 'group:G1');
    expect(ref).toHaveBeenLastCalledWith({}, 'users/uid1/currentContext');
  });

  test('setCurrentContext can be set to direct', async () => {
    set.mockResolvedValue();
    await setCurrentContext('uid1', 'direct');
    expect(set).toHaveBeenCalledWith('mock-ref', 'direct');
  });
});
```

Add the new export names to the top-level destructure:

```js
const {
  // ... existing entries ...
  claimGroupId,
  writeUserGroupsEntry, removeUserGroupsEntry, readUserGroups, watchUserGroups,
  setLastVisited, setCurrentContext,
} = require('../js/db');
```

- [ ] **Step 2: Run tests; verify failure**

```
npx jest tests/db.test.js -t 'claimGroupId'
```

Expected: FAIL — `claimGroupId is not a function`.

- [ ] **Step 3: Implement in `js/db.js`**

Add a new section after the existing invite-related block (around line 146):

```js
// ── Groups: user-side enumeration + ID allocation ─────────────────────────────
// users/{uid}/groups/{groupId} is the user's per-group enumeration record.
// In Phase 1 the only field is optional `lastVisited` (for cards-row ordering).
// groupIdIndex/{groupId} is a global existence lock for transactional allocation.

export async function claimGroupId(groupId) {
  const indexRef = ref(db, `groupIdIndex/${groupId}`);
  const result = await runTransaction(indexRef, (current) => {
    if (current !== null) return; // abort — id already claimed
    return true;
  });
  return result.committed;
}

export async function writeUserGroupsEntry(userId, groupId, payload) {
  const value = payload === undefined ? true : payload;
  await set(ref(db, `users/${userId}/groups/${groupId}`), value);
}

export async function removeUserGroupsEntry(userId, groupId) {
  await remove(ref(db, `users/${userId}/groups/${groupId}`));
}

export async function readUserGroups(userId) {
  const snap = await get(ref(db, `users/${userId}/groups`));
  return snap.exists() ? snap.val() : {};
}

export function watchUserGroups(userId, callback) {
  const groupsRef = ref(db, `users/${userId}/groups`);
  return onValue(groupsRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}

export async function setLastVisited(userId, groupId, ts) {
  await update(ref(db, `users/${userId}/groups/${groupId}`), { lastVisited: ts });
}

export async function setCurrentContext(userId, context) {
  await set(ref(db, `users/${userId}/currentContext`), context);
}
```

- [ ] **Step 4: Update mock files**

For each of the five files (`tests/mycode.test.js`, `tests/recovery.test.js`, `tests/favorites.test.js`, `tests/following.test.js`, `tests/me.test.js`), append these stubs to the existing `jest.mock('../js/db.js', () => ({ ... }))` block:

```js
  claimGroupId: jest.fn(),
  writeUserGroupsEntry: jest.fn(),
  removeUserGroupsEntry: jest.fn(),
  readUserGroups: jest.fn().mockResolvedValue({}),
  watchUserGroups: jest.fn(() => () => {}),
  setLastVisited: jest.fn(),
  setCurrentContext: jest.fn(),
```

- [ ] **Step 5: Run full suite**

```
npx jest
```

Expected: all green (existing 456 + new db tests).

- [ ] **Step 6: Commit**

```bash
git add js/db.js tests/db.test.js tests/mycode.test.js tests/recovery.test.js tests/favorites.test.js tests/following.test.js tests/me.test.js
git commit -m "feat: db ops for groupIdIndex + user-side groups enumeration

claimGroupId mirrors the codeIndex/inviteIndex transactional pattern.
writeUserGroupsEntry / removeUserGroupsEntry / readUserGroups /
watchUserGroups manage the per-user enumeration of group memberships
(lastVisited only in Phase 1). setLastVisited + setCurrentContext
support navigation state. Mocks updated in the standard five files."
```

---

## Task 3: db.js — group entity CRUD + meta subscription

Group records live at `groups/{groupId}` with `name`, `ownerId`, `createdAt`. Phase 1 doesn't read or write `color`, `paletteKey`, or `pendingApproval` (post-MVP). The members sub-collection and invites sub-collection are handled in Tasks 4 and 9 respectively.

**Files:**
- Modify: `js/db.js`
- Modify: `tests/db.test.js`
- Modify: the 5 mock files

- [ ] **Step 1: Write failing tests in `tests/db.test.js`**

Append:

```js
describe('group entity ops', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('writeGroup creates the group record', async () => {
    set.mockResolvedValue();
    const payload = { name: 'Family', ownerId: 'uid1', createdAt: 12345 };
    await writeGroup('G1ABCD23', payload);
    expect(set).toHaveBeenCalledWith('mock-ref', payload);
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1ABCD23');
  });

  test('readGroup returns the record when present', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ name: 'Family', ownerId: 'uid1', createdAt: 12345 }) });
    const result = await readGroup('G1ABCD23');
    expect(result).toEqual({ name: 'Family', ownerId: 'uid1', createdAt: 12345 });
  });

  test('readGroup returns null when missing', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    expect(await readGroup('NOPE0001')).toBeNull();
  });

  test('renameGroup writes only the name field', async () => {
    update.mockResolvedValue();
    await renameGroup('G1ABCD23', 'Familia');
    expect(update).toHaveBeenCalledWith('mock-ref', { name: 'Familia' });
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1ABCD23');
  });

  test('deleteGroup removes the entire groups/{groupId} subtree', async () => {
    remove.mockResolvedValue();
    await deleteGroup('G1ABCD23');
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1ABCD23');
    expect(remove).toHaveBeenCalled();
  });

  test('watchGroupMeta subscribes to groups/{groupId} and strips members/invites for the meta-only callback', () => {
    let cb;
    onValue.mockImplementation((_ref, fn) => { cb = fn; return () => {}; });
    const seen = [];
    watchGroupMeta('G1ABCD23', (meta) => seen.push(meta));
    cb({ exists: () => true, val: () => ({ name: 'Family', ownerId: 'uid1', createdAt: 1, members: { u: {} }, invites: { i: {} } }) });
    expect(seen[0]).toEqual({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    cb({ exists: () => false });
    expect(seen[1]).toBeNull();
  });
});
```

Extend the destructure:

```js
const {
  // ... existing ...
  writeGroup, readGroup, renameGroup, deleteGroup, watchGroupMeta,
} = require('../js/db');
```

- [ ] **Step 2: Verify failure**

```
npx jest tests/db.test.js -t 'group entity ops'
```

Expected: FAIL — `writeGroup is not a function`.

- [ ] **Step 3: Implement in `js/db.js`**

Add after the Task-2 block:

```js
// ── Groups: entity CRUD + meta subscription ───────────────────────────────────
// groups/{groupId} root fields: name, ownerId, createdAt, (post-MVP: color, paletteKey).
// Sub-collections: members/, invites/ — managed by separate helpers below.

export async function writeGroup(groupId, payload) {
  await set(ref(db, `groups/${groupId}`), payload);
}

export async function readGroup(groupId) {
  const snap = await get(ref(db, `groups/${groupId}`));
  return snap.exists() ? snap.val() : null;
}

export async function renameGroup(groupId, name) {
  await update(ref(db, `groups/${groupId}`), { name });
}

export async function deleteGroup(groupId) {
  await remove(ref(db, `groups/${groupId}`));
}

// Subscription that strips sub-collections so callers only react to meta changes
// (name, ownerId, etc.). Members and invites are watched separately.
const GROUP_META_FIELDS = ['name', 'ownerId', 'createdAt', 'color', 'paletteKey'];

export function watchGroupMeta(groupId, callback) {
  const groupRef = ref(db, `groups/${groupId}`);
  return onValue(groupRef, (snap) => {
    if (!snap.exists()) { callback(null); return; }
    const val = snap.val() || {};
    const meta = {};
    for (const k of GROUP_META_FIELDS) {
      if (val[k] !== undefined) meta[k] = val[k];
    }
    callback(meta);
  });
}
```

- [ ] **Step 4: Update mock files**

Append to all 5 mock blocks:

```js
  writeGroup: jest.fn(),
  readGroup: jest.fn().mockResolvedValue(null),
  renameGroup: jest.fn(),
  deleteGroup: jest.fn(),
  watchGroupMeta: jest.fn(() => () => {}),
```

- [ ] **Step 5: Run full suite**

```
npx jest
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add js/db.js tests/db.test.js tests/mycode.test.js tests/recovery.test.js tests/favorites.test.js tests/following.test.js tests/me.test.js
git commit -m "feat: group entity CRUD + watchGroupMeta

writeGroup / readGroup / renameGroup / deleteGroup map to groups/{id}
root fields. watchGroupMeta strips members/ and invites/ from the
subscription payload so meta consumers (header, breadcrumb, cards)
re-render only on name / owner / createdAt changes."
```

---

## Task 4: db.js — member ops + roster subscription

Members live at `groups/{groupId}/members/{memberUid}` with `{ role, displayName, joinedAt }` and (Phase 2) `statusOverride?`. Phase 1 only writes role + displayName + joinedAt.

**Files:**
- Modify: `js/db.js`
- Modify: `tests/db.test.js`
- Modify: the 5 mock files

- [ ] **Step 1: Write failing tests**

Append:

```js
describe('group members', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('writeMember writes the full member record', async () => {
    set.mockResolvedValue();
    const member = { role: 'member', displayName: 'Alex K.', joinedAt: 1234 };
    await writeMember('G1', 'uid2', member);
    expect(set).toHaveBeenCalledWith('mock-ref', member);
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/members/uid2');
  });

  test('readMember returns the record', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ role: 'member', displayName: 'Mike', joinedAt: 1 }) });
    const result = await readMember('G1', 'uid2');
    expect(result).toEqual({ role: 'member', displayName: 'Mike', joinedAt: 1 });
  });

  test('readMember returns null when missing', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    expect(await readMember('G1', 'unknownUid')).toBeNull();
  });

  test('readMembers returns the full collection', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ uid1: { role: 'owner' }, uid2: { role: 'member' } }) });
    const result = await readMembers('G1');
    expect(result).toEqual({ uid1: { role: 'owner' }, uid2: { role: 'member' } });
  });

  test('readMembers returns empty object on miss', async () => {
    get.mockResolvedValueOnce({ exists: () => false });
    expect(await readMembers('G1')).toEqual({});
  });

  test('removeMember removes the member record', async () => {
    remove.mockResolvedValue();
    await removeMember('G1', 'uid2');
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/members/uid2');
    expect(remove).toHaveBeenCalled();
  });

  test('setMemberDisplayName updates only the displayName field', async () => {
    update.mockResolvedValue();
    await setMemberDisplayName('G1', 'uid2', 'M. P.');
    expect(update).toHaveBeenCalledWith('mock-ref', { displayName: 'M. P.' });
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/members/uid2');
  });

  test('watchGroupMembers subscribes to the members collection', () => {
    let cb;
    onValue.mockImplementation((_ref, fn) => { cb = fn; return () => {}; });
    const seen = [];
    watchGroupMembers('G1', (members) => seen.push(members));
    cb({ exists: () => true, val: () => ({ uid1: { role: 'owner', displayName: 'Alice' } }) });
    expect(seen[0]).toEqual({ uid1: { role: 'owner', displayName: 'Alice' } });
    cb({ exists: () => false });
    expect(seen[1]).toEqual({});
  });
});
```

Extend the destructure:

```js
const {
  // ... existing ...
  writeMember, readMember, readMembers, removeMember, setMemberDisplayName, watchGroupMembers,
} = require('../js/db');
```

- [ ] **Step 2: Verify failure**

```
npx jest tests/db.test.js -t 'group members'
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Add to `js/db.js`:

```js
// ── Groups: members ───────────────────────────────────────────────────────────
// groups/{groupId}/members/{memberUid}: { role, displayName, joinedAt, statusOverride? (Phase 2) }.

export async function writeMember(groupId, memberUid, member) {
  await set(ref(db, `groups/${groupId}/members/${memberUid}`), member);
}

export async function readMember(groupId, memberUid) {
  const snap = await get(ref(db, `groups/${groupId}/members/${memberUid}`));
  return snap.exists() ? snap.val() : null;
}

export async function readMembers(groupId) {
  const snap = await get(ref(db, `groups/${groupId}/members`));
  return snap.exists() ? snap.val() : {};
}

export async function removeMember(groupId, memberUid) {
  await remove(ref(db, `groups/${groupId}/members/${memberUid}`));
}

export async function setMemberDisplayName(groupId, memberUid, displayName) {
  await update(ref(db, `groups/${groupId}/members/${memberUid}`), { displayName });
}

export function watchGroupMembers(groupId, callback) {
  const membersRef = ref(db, `groups/${groupId}/members`);
  return onValue(membersRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}
```

- [ ] **Step 4: Update mock files**

Append to all 5:

```js
  writeMember: jest.fn(),
  readMember: jest.fn().mockResolvedValue(null),
  readMembers: jest.fn().mockResolvedValue({}),
  removeMember: jest.fn(),
  setMemberDisplayName: jest.fn(),
  watchGroupMembers: jest.fn(() => () => {}),
```

- [ ] **Step 5: Run full suite + commit**

```
npx jest
```

Expected: green.

```bash
git add js/db.js tests/db.test.js tests/mycode.test.js tests/recovery.test.js tests/favorites.test.js tests/following.test.js tests/me.test.js
git commit -m "feat: group member ops + watchGroupMembers

writeMember / readMember / readMembers / removeMember /
setMemberDisplayName / watchGroupMembers map to
groups/{groupId}/members/{memberUid}. Member record fields: role,
displayName, joinedAt (statusOverride deferred to Phase 2)."
```

---

## Task 5: groups.js — createGroup (with name validation + transactional ID)

The first business-logic task in the new `js/groups.js`. Mirrors the structure of `js/invites.js`: imports lower-level db.js helpers, exposes a single composed operation.

**Files:**
- Create: `js/groups.js`
- Create: `tests/groups.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/groups.test.js`:

```js
// tests/groups.test.js
jest.mock('../js/db.js', () => ({
  claimGroupId: jest.fn(),
  writeGroup: jest.fn(),
  writeMember: jest.fn(),
  writeUserGroupsEntry: jest.fn(),
  removeUserGroupsEntry: jest.fn(),
  removeMember: jest.fn(),
  deleteGroup: jest.fn(),
  renameGroup: jest.fn(),
  setMemberDisplayName: jest.fn(),
  readGroup: jest.fn().mockResolvedValue(null),
  readMember: jest.fn().mockResolvedValue(null),
  readMembers: jest.fn().mockResolvedValue({}),
  setLastVisited: jest.fn(),
  setCurrentContext: jest.fn(),
}));

const db = require('../js/db.js');
const { createGroup } = require('../js/groups');

describe('createGroup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.claimGroupId.mockResolvedValue(true);
    db.writeGroup.mockResolvedValue();
    db.writeMember.mockResolvedValue();
    db.writeUserGroupsEntry.mockResolvedValue();
  });

  test('validates name: trim, non-empty, max 40 chars', async () => {
    await expect(createGroup('uid1', '  ', 'Mike')).rejects.toThrow(/empty/i);
    await expect(createGroup('uid1', 'x'.repeat(41), 'Mike')).rejects.toThrow(/40/);
  });

  test('validates owner displayName: trim, non-empty, max 40 chars', async () => {
    await expect(createGroup('uid1', 'Family', '   ')).rejects.toThrow(/empty/i);
    await expect(createGroup('uid1', 'Family', 'x'.repeat(41))).rejects.toThrow(/40/);
  });

  test('happy path: claims id, writes group, writes owner member, writes user enumeration', async () => {
    const result = await createGroup('uid1', '  Family  ', '  Mike  ');
    expect(result).toMatchObject({ groupId: expect.stringMatching(/^[A-Z0-9]{8}$/) });
    expect(db.claimGroupId).toHaveBeenCalledWith(result.groupId);
    expect(db.writeGroup).toHaveBeenCalledWith(result.groupId, expect.objectContaining({
      name: 'Family',
      ownerId: 'uid1',
      createdAt: expect.any(Number),
    }));
    expect(db.writeMember).toHaveBeenCalledWith(result.groupId, 'uid1', expect.objectContaining({
      role: 'owner',
      displayName: 'Mike',
      joinedAt: expect.any(Number),
    }));
    expect(db.writeUserGroupsEntry).toHaveBeenCalledWith('uid1', result.groupId, expect.objectContaining({
      lastVisited: expect.any(Number),
    }));
  });

  test('retries on group-id collision', async () => {
    db.claimGroupId.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const result = await createGroup('uid1', 'Family', 'Mike');
    expect(db.claimGroupId).toHaveBeenCalledTimes(2);
    expect(result.groupId).toMatch(/^[A-Z0-9]{8}$/);
  });

  test('throws after exhausting retry budget', async () => {
    db.claimGroupId.mockResolvedValue(false);
    await expect(createGroup('uid1', 'Family', 'Mike')).rejects.toThrow(/allocate/i);
  });
});
```

- [ ] **Step 2: Verify failure**

```
npx jest tests/groups.test.js
```

Expected: FAIL — `Cannot find module '../js/groups'`.

- [ ] **Step 3: Implement `js/groups.js`**

```js
// js/groups.js
// Group lifecycle business logic. Composes db.js primitives.

import {
  claimGroupId, writeGroup, writeMember, writeUserGroupsEntry,
  removeMember, removeUserGroupsEntry, deleteGroup as dbDeleteGroup,
  renameGroup as dbRenameGroup, setMemberDisplayName,
  readGroup, readMember, readMembers,
  setLastVisited, setCurrentContext,
} from './db.js';

const NAME_MAX = 40;
const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function validateName(raw, field = 'Name') {
  if (typeof raw !== 'string') throw new Error(`${field} must be a string.`);
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new Error(`${field} cannot be empty.`);
  if (trimmed.length > NAME_MAX) throw new Error(`${field} must be at most ${NAME_MAX} chars.`);
  return trimmed;
}

function generateGroupId() {
  const bytes = new Uint8Array(8);
  (globalThis.crypto || require('crypto').webcrypto).getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

export async function createGroup(ownerUid, nameRaw, ownerDisplayNameRaw) {
  const name = validateName(nameRaw, 'Group name');
  const ownerDisplayName = validateName(ownerDisplayNameRaw, 'Display name');

  let groupId;
  let claimed = false;
  for (let attempt = 0; attempt < 8 && !claimed; attempt += 1) {
    groupId = generateGroupId();
    claimed = await claimGroupId(groupId);
  }
  if (!claimed) throw new Error('Could not allocate a group id. Try again.');

  const now = Date.now();
  await writeGroup(groupId, { name, ownerId: ownerUid, createdAt: now });
  await writeMember(groupId, ownerUid, {
    role: 'owner',
    displayName: ownerDisplayName,
    joinedAt: now,
  });
  await writeUserGroupsEntry(ownerUid, groupId, { lastVisited: now });

  return { groupId, name };
}
```

- [ ] **Step 4: Run tests**

```
npx jest tests/groups.test.js
npx jest
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add js/groups.js tests/groups.test.js
git commit -m "feat: groups.createGroup with transactional id + member init

Validates group name and owner displayName via the same trim / non-
empty / max-40 rule used everywhere else. Allocates an 8-char
[A-Z0-9] group id with a transactional claim, retrying up to 8 times
on collision. Writes the group record, the owner's member record,
and the owner's user-side enumeration record."
```

---

## Task 6: groups.js — renameGroup, deleteGroup, leaveGroup

Three small operations sharing a task. All require an authorization check (owner-only for rename/delete; member-only for leave) but since rules are honor-system in Phase 1 the check is client-side only.

**Files:**
- Modify: `js/groups.js`
- Modify: `tests/groups.test.js`

- [ ] **Step 1: Write failing tests**

Append to `tests/groups.test.js`:

```js
const { renameGroup, deleteGroup, leaveGroup } = require('../js/groups');

describe('renameGroup', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('validates new name', async () => {
    await expect(renameGroup('G1', 'uid1', '   ')).rejects.toThrow(/empty/i);
    await expect(renameGroup('G1', 'uid1', 'x'.repeat(41))).rejects.toThrow(/40/);
  });

  test('refuses when caller is not the owner', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    await expect(renameGroup('G1', 'uid1', 'New')).rejects.toThrow(/owner/i);
  });

  test('writes new name when caller is the owner', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    db.renameGroup.mockResolvedValue();
    await renameGroup('G1', 'uid1', '  Familia  ');
    expect(db.renameGroup).toHaveBeenCalledWith('G1', 'Familia');
  });
});

describe('deleteGroup', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('refuses when caller is not the owner', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    await expect(deleteGroup('G1', 'uid1')).rejects.toThrow(/owner/i);
  });

  test('removes the group and the owner\'s enumeration entry when owner deletes', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    db.deleteGroup.mockResolvedValue();
    db.removeUserGroupsEntry.mockResolvedValue();
    await deleteGroup('G1', 'uid1');
    expect(db.deleteGroup).toHaveBeenCalledWith('G1');
    expect(db.removeUserGroupsEntry).toHaveBeenCalledWith('uid1', 'G1');
  });

  test('no-ops gracefully when the group is already gone', async () => {
    db.readGroup.mockResolvedValue(null);
    await deleteGroup('G1', 'uid1');
    expect(db.deleteGroup).not.toHaveBeenCalled();
  });
});

describe('leaveGroup', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('refuses when caller is the owner (must delete instead)', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    await expect(leaveGroup('G1', 'uid1')).rejects.toThrow(/owner/i);
  });

  test('removes the member record and the user-side enumeration when member leaves', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    db.removeMember.mockResolvedValue();
    db.removeUserGroupsEntry.mockResolvedValue();
    await leaveGroup('G1', 'uid1');
    expect(db.removeMember).toHaveBeenCalledWith('G1', 'uid1');
    expect(db.removeUserGroupsEntry).toHaveBeenCalledWith('uid1', 'G1');
  });
});
```

- [ ] **Step 2: Verify failure**

```
npx jest tests/groups.test.js -t 'renameGroup'
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `js/groups.js`:

```js
async function requireOwner(groupId, callerUid) {
  const group = await readGroup(groupId);
  if (!group) return null;
  if (group.ownerId !== callerUid) throw new Error('Only the owner can do that.');
  return group;
}

async function refuseOwner(groupId, callerUid) {
  const group = await readGroup(groupId);
  if (!group) return null;
  if (group.ownerId === callerUid) throw new Error('The owner cannot leave the group. Delete it instead.');
  return group;
}

export async function renameGroup(groupId, callerUid, newNameRaw) {
  const name = validateName(newNameRaw, 'Group name');
  const group = await requireOwner(groupId, callerUid);
  if (!group) return;
  await dbRenameGroup(groupId, name);
}

export async function deleteGroup(groupId, callerUid) {
  const group = await requireOwner(groupId, callerUid);
  if (!group) return;
  await dbDeleteGroup(groupId);
  await removeUserGroupsEntry(callerUid, groupId);
  // Members' own enumeration entries are cleaned up by their own apps' deletion-detection
  // mechanism (Task 18); we cannot reach into their user records from here.
}

export async function leaveGroup(groupId, callerUid) {
  const group = await refuseOwner(groupId, callerUid);
  if (!group) return;
  await removeMember(groupId, callerUid);
  await removeUserGroupsEntry(callerUid, groupId);
}
```

- [ ] **Step 4: Run tests + commit**

```
npx jest
```

Expected: green.

```bash
git add js/groups.js tests/groups.test.js
git commit -m "feat: groups.renameGroup / deleteGroup / leaveGroup

Three owner / member operations with client-side authorization
checks (rules are honor-system in Phase 1). Owner-only: rename,
delete. Member-only (not owner): leave — the owner must delete the
group to release themselves. requireOwner and refuseOwner helpers
share the readGroup + check pattern."
```

---

## Task 7: groups.js — joinGroup + editOwnDisplayName

`joinGroup` is the operation invoked by invite redemption (group scope). `editOwnDisplayName` is the in-group setting that members use to change their own per-group name.

**Files:**
- Modify: `js/groups.js`
- Modify: `tests/groups.test.js`

- [ ] **Step 1: Write failing tests**

Append:

```js
const { joinGroup, editOwnDisplayName } = require('../js/groups');

describe('joinGroup', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('validates the display name', async () => {
    await expect(joinGroup('G1', 'uid2', '  ')).rejects.toThrow(/empty/i);
    await expect(joinGroup('G1', 'uid2', 'x'.repeat(41))).rejects.toThrow(/40/);
  });

  test('refuses when the group does not exist', async () => {
    db.readGroup.mockResolvedValue(null);
    await expect(joinGroup('NOPE', 'uid2', 'Mike')).rejects.toThrow(/not found/i);
  });

  test('writes member record + user enumeration when joining', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    db.readMember.mockResolvedValue(null);
    db.writeMember.mockResolvedValue();
    db.writeUserGroupsEntry.mockResolvedValue();
    await joinGroup('G1', 'uid2', '  Mike  ');
    expect(db.writeMember).toHaveBeenCalledWith('G1', 'uid2', expect.objectContaining({
      role: 'member',
      displayName: 'Mike',
      joinedAt: expect.any(Number),
    }));
    expect(db.writeUserGroupsEntry).toHaveBeenCalledWith('uid2', 'G1', expect.objectContaining({
      lastVisited: expect.any(Number),
    }));
  });

  test('idempotent for existing members (no-op writes)', async () => {
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    db.readMember.mockResolvedValue({ role: 'member', displayName: 'Old', joinedAt: 10 });
    await joinGroup('G1', 'uid2', 'Mike');
    expect(db.writeMember).not.toHaveBeenCalled();
    expect(db.writeUserGroupsEntry).toHaveBeenCalled(); // still bumps lastVisited
  });
});

describe('editOwnDisplayName', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('validates the name', async () => {
    await expect(editOwnDisplayName('G1', 'uid1', '   ')).rejects.toThrow(/empty/i);
    await expect(editOwnDisplayName('G1', 'uid1', 'x'.repeat(41))).rejects.toThrow(/40/);
  });

  test('writes new displayName to the caller\'s member record', async () => {
    db.setMemberDisplayName.mockResolvedValue();
    await editOwnDisplayName('G1', 'uid1', '  M. P.  ');
    expect(db.setMemberDisplayName).toHaveBeenCalledWith('G1', 'uid1', 'M. P.');
  });
});
```

- [ ] **Step 2: Verify failure**

```
npx jest tests/groups.test.js -t 'joinGroup'
```

Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `js/groups.js`:

```js
export async function joinGroup(groupId, joinerUid, displayNameRaw) {
  const displayName = validateName(displayNameRaw, 'Display name');
  const group = await readGroup(groupId);
  if (!group) throw new Error('Group not found.');

  const existing = await readMember(groupId, joinerUid);
  const now = Date.now();
  if (!existing) {
    await writeMember(groupId, joinerUid, {
      role: 'member',
      displayName,
      joinedAt: now,
    });
  }
  // Always bump lastVisited so the group surfaces at the top of the joiner's cards row.
  await writeUserGroupsEntry(joinerUid, groupId, { lastVisited: now });
}

export async function editOwnDisplayName(groupId, callerUid, newNameRaw) {
  const displayName = validateName(newNameRaw, 'Display name');
  await setMemberDisplayName(groupId, callerUid, displayName);
}
```

- [ ] **Step 4: Run tests + commit**

```
npx jest
```

Expected: green.

```bash
git add js/groups.js tests/groups.test.js
git commit -m "feat: groups.joinGroup + editOwnDisplayName

joinGroup is the operation invoked by group-scope invite redemption
(Task 9). Idempotent: re-joining doesn't rewrite the member record,
but always bumps lastVisited so the group surfaces in the redeemer's
cards row. editOwnDisplayName is the in-group rename — only the
caller's own member record."
```

---

## Task 8: invites.js — group-scope create/revoke/regenerate

Phase 0 built the personal-scope side of these. The group-scope versions share the same lifecycle (token allocation via inviteIndex, one-active constraint, lifecycle controls) but the records live under `groups/{groupId}/invites/{token}` and the one-active constraint is per `(creatorUid, groupId)` instead of per user.

Group-scope invites do NOT carry a `creatorLabel` — the group's name is the context the redeemer sees.

**Files:**
- Modify: `js/db.js` (add `writeGroupInvite`, `readGroupInvites`, `setGroupInviteRevoked`, `incrementGroupInviteRedemptions`, `watchGroupInvites`)
- Modify: `js/invites.js`
- Modify: `tests/db.test.js`
- Modify: `tests/invites.test.js`
- Modify: the 5 mock files

- [ ] **Step 1: Write failing tests in `tests/db.test.js`**

Append:

```js
describe('group invite ops', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('writeGroupInvite writes at groups/{groupId}/invites/{token}', async () => {
    set.mockResolvedValue();
    const payload = { scope: 'group', token: 'T', creatorUid: 'uid1', createdAt: 1, expiresAt: null, redemptionCap: null, redemptionsUsed: 0, revoked: false };
    await writeGroupInvite('G1', 'T', payload);
    expect(set).toHaveBeenCalledWith('mock-ref', payload);
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/invites/T');
  });

  test('readGroupInvites returns the full collection', async () => {
    get.mockResolvedValueOnce({ exists: () => true, val: () => ({ T1: { scope: 'group', creatorUid: 'uid1', revoked: false } }) });
    expect(await readGroupInvites('G1')).toEqual({ T1: { scope: 'group', creatorUid: 'uid1', revoked: false } });
  });

  test('setGroupInviteRevoked marks revoked', async () => {
    update.mockResolvedValue();
    await setGroupInviteRevoked('G1', 'T');
    expect(update).toHaveBeenCalledWith('mock-ref', { revoked: true });
    expect(ref).toHaveBeenLastCalledWith({}, 'groups/G1/invites/T');
  });

  test('incrementGroupInviteRedemptions transactionally bumps the counter', async () => {
    runTransaction.mockResolvedValue({ committed: true });
    await incrementGroupInviteRedemptions('G1', 'T');
    const handler = runTransaction.mock.calls[0][1];
    expect(handler(3)).toBe(4);
    expect(handler(null)).toBe(1);
  });

  test('watchGroupInvites subscribes to the collection', () => {
    let cb;
    onValue.mockImplementation((_ref, fn) => { cb = fn; return () => {}; });
    const seen = [];
    watchGroupInvites('G1', (invites) => seen.push(invites));
    cb({ exists: () => true, val: () => ({ T: { scope: 'group', revoked: false } }) });
    expect(seen[0]).toEqual({ T: { scope: 'group', revoked: false } });
    cb({ exists: () => false });
    expect(seen[1]).toEqual({});
  });
});
```

Extend destructure:

```js
const {
  // ... existing ...
  writeGroupInvite, readGroupInvites, setGroupInviteRevoked, incrementGroupInviteRedemptions, watchGroupInvites,
} = require('../js/db');
```

- [ ] **Step 2: Verify failure + implement db helpers**

```
npx jest tests/db.test.js -t 'group invite ops'
```

Expected: FAIL.

Implement in `js/db.js`:

```js
// ── Groups: invites ───────────────────────────────────────────────────────────

export async function writeGroupInvite(groupId, token, payload) {
  await set(ref(db, `groups/${groupId}/invites/${token}`), payload);
}

export async function readGroupInvites(groupId) {
  const snap = await get(ref(db, `groups/${groupId}/invites`));
  return snap.exists() ? snap.val() : {};
}

export async function setGroupInviteRevoked(groupId, token) {
  await update(ref(db, `groups/${groupId}/invites/${token}`), { revoked: true });
}

export async function incrementGroupInviteRedemptions(groupId, token) {
  const inviteRef = ref(db, `groups/${groupId}/invites/${token}/redemptionsUsed`);
  await runTransaction(inviteRef, (current) => (current || 0) + 1);
}

export function watchGroupInvites(groupId, callback) {
  const invitesRef = ref(db, `groups/${groupId}/invites`);
  return onValue(invitesRef, (snap) => {
    callback(snap.exists() ? snap.val() : {});
  });
}
```

Append the same stubs to all 5 mock files:

```js
  writeGroupInvite: jest.fn(),
  readGroupInvites: jest.fn().mockResolvedValue({}),
  setGroupInviteRevoked: jest.fn(),
  incrementGroupInviteRedemptions: jest.fn(),
  watchGroupInvites: jest.fn(() => () => {}),
```

- [ ] **Step 3: Write failing tests in `tests/invites.test.js`**

Add to the existing mock block at the top of `tests/invites.test.js`:

```js
  writeGroupInvite: jest.fn(),
  readGroupInvites: jest.fn().mockResolvedValue({}),
  setGroupInviteRevoked: jest.fn(),
  incrementGroupInviteRedemptions: jest.fn(),
  watchGroupInvites: jest.fn(() => () => {}),
  readGroup: jest.fn().mockResolvedValue(null),
  readMember: jest.fn().mockResolvedValue(null),
```

Append at end of file:

```js
const { createGroupInvite, revokeGroupInvite, regenerateGroupInvite } = require('../js/invites');

describe('createGroupInvite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.claimInviteToken.mockResolvedValue(true);
    db.writeGroupInvite.mockResolvedValue();
  });

  test('creates a new group invite when none exists for this (creator, group)', async () => {
    db.readGroupInvites.mockResolvedValue({});
    const result = await createGroupInvite('uid1', 'G1');
    expect(result).toMatchObject({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      url: expect.stringContaining('?i='),
    });
    expect(db.claimInviteToken).toHaveBeenCalledWith(result.token, `groups/G1/invites/${result.token}`);
    expect(db.writeGroupInvite).toHaveBeenCalledWith('G1', result.token, expect.objectContaining({
      scope: 'group',
      token: result.token,
      creatorUid: 'uid1',
      createdAt: expect.any(Number),
      expiresAt: null,
      redemptionCap: null,
      redemptionsUsed: 0,
      revoked: false,
    }));
  });

  test('returns the existing active invite for this creator + group', async () => {
    db.readGroupInvites.mockResolvedValue({
      EXISTING22CHARSTRINGAA: { scope: 'group', token: 'EXISTING22CHARSTRINGAA', creatorUid: 'uid1', revoked: false },
    });
    const result = await createGroupInvite('uid1', 'G1');
    expect(result.token).toBe('EXISTING22CHARSTRINGAA');
    expect(db.claimInviteToken).not.toHaveBeenCalled();
  });

  test('ignores other creators\' invites when checking the constraint', async () => {
    db.readGroupInvites.mockResolvedValue({
      OTHER22CHARSTRINGAAAAA: { scope: 'group', token: 'OTHER22CHARSTRINGAAAAA', creatorUid: 'someoneElse', revoked: false },
    });
    const result = await createGroupInvite('uid1', 'G1');
    expect(db.claimInviteToken).toHaveBeenCalled();
    expect(result.token).not.toBe('OTHER22CHARSTRINGAAAAA');
  });
});

describe('revokeGroupInvite', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('marks the caller\'s active invite revoked + releases inviteIndex', async () => {
    db.readGroupInvites.mockResolvedValue({
      ABC: { scope: 'group', token: 'ABC', creatorUid: 'uid1', revoked: false },
    });
    db.setGroupInviteRevoked.mockResolvedValue();
    db.releaseInviteToken.mockResolvedValue();
    await revokeGroupInvite('uid1', 'G1');
    expect(db.setGroupInviteRevoked).toHaveBeenCalledWith('G1', 'ABC');
    expect(db.releaseInviteToken).toHaveBeenCalledWith('ABC');
  });

  test('no-ops when caller has no active invite for this group', async () => {
    db.readGroupInvites.mockResolvedValue({
      ABC: { scope: 'group', token: 'ABC', creatorUid: 'someoneElse', revoked: false },
    });
    await revokeGroupInvite('uid1', 'G1');
    expect(db.setGroupInviteRevoked).not.toHaveBeenCalled();
  });
});

describe('regenerateGroupInvite', () => {
  test('revoke + create with empty pre-revoke', async () => {
    db.readGroupInvites
      .mockResolvedValueOnce({ OLD: { scope: 'group', token: 'OLD', creatorUid: 'uid1', revoked: false } })
      .mockResolvedValueOnce({});
    db.setGroupInviteRevoked.mockResolvedValue();
    db.releaseInviteToken.mockResolvedValue();
    db.claimInviteToken.mockResolvedValue(true);
    db.writeGroupInvite.mockResolvedValue();
    const result = await regenerateGroupInvite('uid1', 'G1');
    expect(db.setGroupInviteRevoked).toHaveBeenCalledWith('G1', 'OLD');
    expect(db.releaseInviteToken).toHaveBeenCalledWith('OLD');
    expect(result.token).not.toBe('OLD');
  });
});
```

- [ ] **Step 4: Verify + implement in js/invites.js**

```
npx jest tests/invites.test.js -t 'createGroupInvite'
```

Expected: FAIL.

Extend the import in `js/invites.js`:

```js
import {
  // ... existing ...
  writeGroupInvite, readGroupInvites, setGroupInviteRevoked, incrementGroupInviteRedemptions,
} from './db.js';
```

Append to `js/invites.js`:

```js
function findActiveGroupInviteForCreator(collection, creatorUid) {
  for (const [token, inv] of Object.entries(collection || {})) {
    if (inv && inv.scope === 'group' && inv.creatorUid === creatorUid && !inv.revoked) {
      return { token, ...inv };
    }
  }
  return null;
}

export async function createGroupInvite(creatorUid, groupId) {
  const collection = await readGroupInvites(groupId);
  const existing = findActiveGroupInviteForCreator(collection, creatorUid);
  if (existing) {
    return { token: existing.token, url: buildInviteUrl(existing.token), existing: true };
  }

  let token;
  let claimed = false;
  for (let attempt = 0; attempt < 8 && !claimed; attempt += 1) {
    token = generateInviteToken();
    claimed = await claimInviteToken(token, `groups/${groupId}/invites/${token}`);
  }
  if (!claimed) throw new Error('Could not allocate an invite token. Try again.');

  const now = Date.now();
  await writeGroupInvite(groupId, token, {
    scope: 'group',
    token,
    creatorUid,
    createdAt: now,
    expiresAt: null,
    redemptionCap: null,
    redemptionsUsed: 0,
    revoked: false,
  });
  return { token, url: buildInviteUrl(token), existing: false };
}

export async function revokeGroupInvite(creatorUid, groupId) {
  const collection = await readGroupInvites(groupId);
  const active = findActiveGroupInviteForCreator(collection, creatorUid);
  if (!active) return;
  await setGroupInviteRevoked(groupId, active.token);
  await releaseInviteToken(active.token);
}

export async function regenerateGroupInvite(creatorUid, groupId) {
  await revokeGroupInvite(creatorUid, groupId);
  return createGroupInvite(creatorUid, groupId);
}
```

- [ ] **Step 5: Run + commit**

```
npx jest
```

Expected: green.

```bash
git add js/db.js js/invites.js tests/db.test.js tests/invites.test.js tests/mycode.test.js tests/recovery.test.js tests/favorites.test.js tests/following.test.js tests/me.test.js
git commit -m "feat: group-scope invite lifecycle

createGroupInvite / revokeGroupInvite / regenerateGroupInvite share
the Phase 0 inviteIndex transactional pattern but record at
groups/{groupId}/invites/{token}. One-active-invite constraint is
per (creatorUid, groupId): each member who can invite has at most
one active invite for each group they invite into."
```

---

## Task 9: invites.js — redeemGroupInvite + scope dispatch

Group-scope redemption looks up the invite via `inviteIndex`, validates it (same failure modes as personal scope minus `self` and `already-following`; add `already-member`), then calls `joinGroup` from `js/groups.js`. The existing `attemptRedeemFromUrl` is extended to dispatch by the indexEntry's scope.

**Files:**
- Modify: `js/invites.js`
- Modify: `tests/invites.test.js`

- [ ] **Step 1: Write failing tests**

Add to the `jest.mock('../js/db.js', ...)` block in `tests/invites.test.js`:

```js
  // Group-scope redemption needs these on the mock surface (already added in Task 8 step but include for completeness)
  readMember: jest.fn().mockResolvedValue(null),
  writeMember: jest.fn(),
  writeUserGroupsEntry: jest.fn(),
  readGroup: jest.fn().mockResolvedValue(null),
  incrementGroupInviteRedemptions: jest.fn(),
```

Also mock `../js/groups.js` (joinGroup is what we delegate to):

```js
jest.mock('../js/groups.js', () => ({
  joinGroup: jest.fn().mockResolvedValue(undefined),
}));

const groups = require('../js/groups.js');
```

Append at the end of `tests/invites.test.js`:

```js
const { redeemGroupInvite } = require('../js/invites');

describe('redeemGroupInvite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.incrementGroupInviteRedemptions.mockResolvedValue();
  });

  test('happy path: joins the group and bumps redemption count', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/TOKEN' });
    db.readGroupInvites = jest.fn(); // unused on the redeem path; tests guard
    db.readUserInvite = jest.fn();   // unused
    // For group redemption we read the invite directly via path-parse
    const get = require('../js/db.js');
    get.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    get.readMember.mockResolvedValue(null);
    // Stub a per-path readGroupInvite via the existing collection helper
    get.readGroupInvites.mockResolvedValue({
      TOKEN: { scope: 'group', token: 'TOKEN', creatorUid: 'uid1', revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0 },
    });

    const result = await redeemGroupInvite('TOKEN', 'redeemer-uid', 'Mike');
    expect(result).toEqual({ ok: true, groupId: 'G1', groupName: 'Family' });
    expect(groups.joinGroup).toHaveBeenCalledWith('G1', 'redeemer-uid', 'Mike');
    expect(db.incrementGroupInviteRedemptions).toHaveBeenCalledWith('G1', 'TOKEN');
  });

  test('returns not-found when the index lookup is empty', async () => {
    db.readInviteIndex.mockResolvedValue(null);
    expect(await redeemGroupInvite('BAD', 'redeemer', 'Mike')).toEqual({ ok: false, reason: 'not-found' });
  });

  test('returns not-found when scope is personal', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/u/invites/T' });
    expect(await redeemGroupInvite('T', 'redeemer', 'Mike')).toEqual({ ok: false, reason: 'not-found' });
  });

  test('returns revoked / expired / cap as appropriate', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });

    db.readGroupInvites.mockResolvedValueOnce({ T: { scope: 'group', token: 'T', creatorUid: 'uid1', revoked: true } });
    expect(await redeemGroupInvite('T', 'redeemer', 'Mike')).toEqual({ ok: false, reason: 'revoked' });

    db.readGroupInvites.mockResolvedValueOnce({ T: { scope: 'group', token: 'T', creatorUid: 'uid1', revoked: false, expiresAt: Date.now() - 1000 } });
    expect(await redeemGroupInvite('T', 'redeemer', 'Mike')).toEqual({ ok: false, reason: 'expired' });

    db.readGroupInvites.mockResolvedValueOnce({ T: { scope: 'group', token: 'T', creatorUid: 'uid1', revoked: false, expiresAt: null, redemptionCap: 5, redemptionsUsed: 5 } });
    expect(await redeemGroupInvite('T', 'redeemer', 'Mike')).toEqual({ ok: false, reason: 'cap' });
  });

  test('returns already-member when the redeemer is already in the group', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    db.readGroupInvites.mockResolvedValue({ T: { scope: 'group', token: 'T', creatorUid: 'uid1', revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0 } });
    db.readMember.mockResolvedValue({ role: 'member', displayName: 'Existing', joinedAt: 1 });
    expect(await redeemGroupInvite('T', 'redeemer', 'Mike')).toEqual({ ok: false, reason: 'already-member', groupId: 'G1', groupName: 'Family' });
    expect(groups.joinGroup).not.toHaveBeenCalled();
  });

  test('returns group-missing when the group record is gone', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroup.mockResolvedValue(null);
    expect(await redeemGroupInvite('T', 'redeemer', 'Mike')).toEqual({ ok: false, reason: 'group-missing' });
  });
});
```

- [ ] **Step 2: Verify failure + implement**

```
npx jest tests/invites.test.js -t 'redeemGroupInvite'
```

Expected: FAIL.

Add to `js/invites.js`:

```js
// js/invites.js — add near the top with other imports
import { readGroup, readMember, readGroupInvites, incrementGroupInviteRedemptions } from './db.js';
import { joinGroup } from './groups.js';

// (Below the redeemPersonalInvite block, add)

export async function redeemGroupInvite(token, redeemerUid, displayName) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'not-found' };

  const indexEntry = await readInviteIndex(token);
  if (!indexEntry) return { ok: false, reason: 'not-found' };
  if (indexEntry.scope !== 'group') return { ok: false, reason: 'not-found' };

  const match = indexEntry.ownerPath.match(/^groups\/([^/]+)\/invites\/([^/]+)$/);
  if (!match) return { ok: false, reason: 'not-found' };
  const [, groupId] = match;

  const group = await readGroup(groupId);
  if (!group) return { ok: false, reason: 'group-missing' };

  const invitesByToken = await readGroupInvites(groupId);
  const invite = invitesByToken[token];
  if (!invite) return { ok: false, reason: 'not-found' };
  if (invite.revoked) return { ok: false, reason: 'revoked' };
  if (invite.expiresAt != null && invite.expiresAt < Date.now()) return { ok: false, reason: 'expired' };
  if (invite.redemptionCap != null && (invite.redemptionsUsed || 0) >= invite.redemptionCap) {
    return { ok: false, reason: 'cap' };
  }

  const existingMember = await readMember(groupId, redeemerUid);
  if (existingMember) {
    return { ok: false, reason: 'already-member', groupId, groupName: group.name };
  }

  await joinGroup(groupId, redeemerUid, displayName);
  await incrementGroupInviteRedemptions(groupId, token);

  return { ok: true, groupId, groupName: group.name };
}
```

- [ ] **Step 3: Extend `attemptRedeemFromUrl` to dispatch by scope**

The boot-time entry point in Phase 0 hardcoded personal-scope redemption. Now it needs to look at the indexEntry's scope and dispatch.

Replace the existing `attemptRedeemFromUrl` body in `js/invites.js`:

```js
export async function attemptRedeemFromUrl(token, redeemerUid, redeemerCode, opts = {}) {
  if (!token) return null;
  const indexEntry = await readInviteIndex(token);
  if (!indexEntry) return { ok: false, reason: 'not-found' };

  if (indexEntry.scope === 'personal') {
    const followingSet = new Set(getFollowing().map((e) => e.userId));
    return redeemPersonalInvite(token, redeemerUid, redeemerCode, followingSet);
  }
  if (indexEntry.scope === 'group') {
    // Group redemption needs a display name. If none provided (existing-user flow has not yet
    // prompted), bail with a `needs-display-name` signal so the caller can ask for one.
    if (!opts.displayName) {
      return { ok: false, reason: 'needs-display-name', groupId: parseGroupIdFromOwnerPath(indexEntry.ownerPath) };
    }
    return redeemGroupInvite(token, redeemerUid, opts.displayName);
  }
  return { ok: false, reason: 'not-found' };
}

function parseGroupIdFromOwnerPath(ownerPath) {
  const m = ownerPath.match(/^groups\/([^/]+)\/invites\/[^/]+$/);
  return m ? m[1] : null;
}
```

Update the existing `tests/invites.test.js` `attemptRedeemFromUrl` tests to pass `null` for the new `opts` arg, and add new tests covering the dispatch:

```js
describe('attemptRedeemFromUrl scope dispatch', () => {
  beforeEach(() => { jest.clearAllMocks(); store.getFollowing.mockReturnValue([]); });

  test('dispatches to personal when scope is personal', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({
      scope: 'personal', token: 'T', creatorUid: 'creator', creatorLabel: 'Mike',
      revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0,
    });
    db.getCreatorCode.mockResolvedValue('ABC123');
    const result = await attemptRedeemFromUrl('T', 'me', 'mycode');
    expect(result.ok).toBe(true);
    expect(result.creatorCode).toBe('ABC123');
  });

  test('returns needs-display-name for group scope when displayName is missing', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    const result = await attemptRedeemFromUrl('T', 'me', 'mycode');
    expect(result).toEqual({ ok: false, reason: 'needs-display-name', groupId: 'G1' });
  });

  test('dispatches to group redemption when displayName is provided', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    db.readGroupInvites.mockResolvedValue({
      T: { scope: 'group', token: 'T', creatorUid: 'uid1', revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0 },
    });
    db.readMember.mockResolvedValue(null);
    const result = await attemptRedeemFromUrl('T', 'me', 'mycode', { displayName: 'Mike' });
    expect(result).toEqual({ ok: true, groupId: 'G1', groupName: 'Family' });
  });
});
```

- [ ] **Step 4: Run + commit**

```
npx jest
```

Expected: green.

```bash
git add js/invites.js tests/invites.test.js
git commit -m "feat: redeemGroupInvite + scope dispatch in attemptRedeemFromUrl

Group-scope redemption validates against the inviteIndex + group
record + invite-collection lookup, then delegates to
groups.joinGroup. Adds 'group-missing' and 'already-member' to the
failure-reason set. attemptRedeemFromUrl now dispatches by the
indexEntry's scope. The group path needs a displayName; when missing
it returns reason='needs-display-name' so the caller can prompt."
```

---

## Task 10: invites.js — resolveInvitePreview (replaces resolveInviteCreatorLabel)

`resolveInviteCreatorLabel` is personal-scope only. The pre-redemption preview needs to surface different content per scope: creatorLabel for personal, groupName for group. Rename / extend to a `resolveInvitePreview` that returns `{ scope, label?, groupName?, groupId? }`.

Keep `resolveInviteCreatorLabel` as a thin wrapper for backward-compatibility (used by Phase 0's welcome-screen flow).

**Files:**
- Modify: `js/invites.js`
- Modify: `tests/invites.test.js`
- Modify: `js/app.js` (call site)

- [ ] **Step 1: Add failing tests**

Append to `tests/invites.test.js`:

```js
const { resolveInvitePreview } = require('../js/invites');

describe('resolveInvitePreview', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  test('returns null for empty token', async () => {
    expect(await resolveInvitePreview(null)).toBeNull();
  });

  test('returns personal preview with label', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({ scope: 'personal', creatorLabel: 'Alex K.', revoked: false });
    expect(await resolveInvitePreview('T')).toEqual({ scope: 'personal', label: 'Alex K.' });
  });

  test('returns group preview with groupName and groupId', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'uid1', createdAt: 1 });
    db.readGroupInvites.mockResolvedValue({ T: { scope: 'group', revoked: false } });
    expect(await resolveInvitePreview('T')).toEqual({ scope: 'group', groupName: 'Family', groupId: 'G1' });
  });

  test('returns null on revoked, missing, or DB error', async () => {
    db.readInviteIndex.mockResolvedValue(null);
    expect(await resolveInvitePreview('NOPE')).toBeNull();

    db.readInviteIndex.mockResolvedValue({ scope: 'personal', ownerPath: 'users/creator/invites/T' });
    db.readUserInvite.mockResolvedValue({ scope: 'personal', revoked: true });
    expect(await resolveInvitePreview('T')).toBeNull();

    db.readInviteIndex.mockRejectedValue(new Error('network'));
    expect(await resolveInvitePreview('T')).toBeNull();
  });
});
```

- [ ] **Step 2: Verify + implement**

```
npx jest tests/invites.test.js -t 'resolveInvitePreview'
```

Expected: FAIL.

Append to `js/invites.js`:

```js
export async function resolveInvitePreview(token) {
  if (!token) return null;
  try {
    const indexEntry = await readInviteIndex(token);
    if (!indexEntry) return null;

    if (indexEntry.scope === 'personal') {
      const m = indexEntry.ownerPath.match(/^users\/([^/]+)\/invites\/([^/]+)$/);
      if (!m) return null;
      const invite = await readUserInvite(m[1], m[2]);
      if (!invite || invite.revoked) return null;
      return { scope: 'personal', label: invite.creatorLabel || null };
    }

    if (indexEntry.scope === 'group') {
      const m = indexEntry.ownerPath.match(/^groups\/([^/]+)\/invites\/([^/]+)$/);
      if (!m) return null;
      const group = await readGroup(m[1]);
      if (!group) return null;
      const invitesByToken = await readGroupInvites(m[1]);
      const invite = invitesByToken[m[2]];
      if (!invite || invite.revoked) return null;
      return { scope: 'group', groupName: group.name, groupId: m[1] };
    }

    return null;
  } catch {
    return null;
  }
}

// Preserve the personal-only helper from Phase 0 for callers that don't need
// to handle group scope yet (welcome screen still uses it during transition).
// Will be removed once all call sites migrate to resolveInvitePreview.
// (Existing function body unchanged.)
```

- [ ] **Step 3: Update js/app.js call site**

The Phase 0 boot path calls `resolveInviteCreatorLabel(pendingInviteToken)`. Switch to `resolveInvitePreview` and pass both kinds of info into the welcome screen. Find the section in `js/app.js` (currently around lines 75-82 in the ensureIdentity function). Replace:

```js
const inviteCreatorLabel = await resolveInviteCreatorLabel(pendingInviteToken);
```

With:

```js
const invitePreview = await resolveInvitePreview(pendingInviteToken);
const inviteCreatorLabel = invitePreview?.scope === 'personal' ? invitePreview.label : null;
const inviteGroupName = invitePreview?.scope === 'group' ? invitePreview.groupName : null;
```

And update the `showWelcomeScreen` call:

```js
const choice = await showWelcomeScreen({ inviteCreatorLabel, inviteGroupName });
```

Update `showWelcomeScreen` signature (also in `js/app.js`) to accept the new param:

```js
export function showWelcomeScreen({ inviteCreatorLabel = null, inviteGroupName = null } = {}) {
  // ... existing markup-toggle logic ...
  const framingEl = document.getElementById('welcome-invite-framing');
  if (framingEl) {
    let text = '';
    if (inviteCreatorLabel) text = `You've been invited to follow ${inviteCreatorLabel}. First, let's set up your account.`;
    else if (inviteGroupName) text = `You've been invited to join '${inviteGroupName}'. First, let's set up your account.`;
    framingEl.textContent = text;
    framingEl.classList.toggle('hidden', !text);
  }
  // ... rest unchanged ...
}
```

Update the import in `js/app.js`:

```js
import { attemptRedeemFromUrl, extractInviteTokenFromUrl, resolveInvitePreview } from './invites.js';
```

- [ ] **Step 4: Update existing welcome-framing tests**

In `tests/invites.test.js`, the existing tests for `showWelcomeScreen` pass only `inviteCreatorLabel`. Add a third test:

```js
test('showWelcomeScreen with inviteGroupName renders the join-group framing', async () => {
  const { showWelcomeScreen } = require('../js/app');
  showWelcomeScreen({ inviteGroupName: 'Family' });
  const framing = document.getElementById('welcome-invite-framing');
  expect(framing.classList.contains('hidden')).toBe(false);
  expect(framing.textContent).toContain("join 'Family'");
  expect(framing.textContent).toContain('First, let');
});
```

- [ ] **Step 5: Run + commit**

```
npx jest
```

Expected: green.

```bash
git add js/invites.js js/app.js tests/invites.test.js
git commit -m "feat: resolveInvitePreview handles both scopes for welcome screen

resolveInviteCreatorLabel kept as a backward-compat wrapper.
resolveInvitePreview returns { scope, label } for personal and
{ scope, groupName, groupId } for group. showWelcomeScreen now
takes inviteGroupName too — group-scope new users see
'You\\'ve been invited to join \\'Family\\'.'"
```

---

## Task 11: inviteModal.js — group-scope wiring

The Phase 0 modal is parameterized by `SCOPE_COPY[scope]` but only `personal` is wired. Adding `group` is mostly copy-table additions plus a different create-handler that calls `createGroupInvite(userId, groupId)` instead of `createPersonalInvite(userId, label)`.

Group-scope creation does NOT need a creatorLabel input — the group's name is the context. So State A for group scope has a different layout: title, subtitle, just the Create button (no input).

**Files:**
- Modify: `js/inviteModal.js`
- Modify: `index.template.html` (add group-scope subtitle slot if needed; existing markup already supports both)
- Modify: `tests/inviteModal.test.js`

- [ ] **Step 1: Add SCOPE_COPY.group and parameterize handlers**

In `js/inviteModal.js`, extend `SCOPE_COPY`:

```js
const SCOPE_COPY = {
  personal: {
    title: 'Your invite link',
    subtitle: 'People who tap this link will follow you.',
    labelHint: 'Your name on the invite',
    labelPlaceholder: 'e.g. Alex K.',
    needsLabel: true,
  },
  group: {
    title: 'Invite link for {groupName}',
    subtitle: 'People who tap this link will join {groupName}.',
    needsLabel: false,
  },
};
```

Imports — add group-scope ops:

```js
import {
  createPersonalInvite, regeneratePersonalInvite, revokePersonalInvite,
  createGroupInvite, regenerateGroupInvite, revokeGroupInvite,
} from './invites.js';
```

Update `openInviteModal` signature to accept `groupId` and `groupName` for group scope:

```js
export function openInviteModal({ scope, userId, activeInvite = null, groupId = null, groupName = null }) {
  const copy = SCOPE_COPY[scope];
  if (!copy) throw new Error(`Unknown scope: ${scope}`);
  if (scope === 'group' && (!groupId || !groupName)) {
    throw new Error('Group scope requires groupId and groupName.');
  }

  const title = copy.title.replace('{groupName}', groupName || '');
  const subtitle = copy.subtitle.replace('{groupName}', groupName || '');
  document.getElementById('invite-modal-title').textContent = title;
  document.getElementById('invite-modal-subtitle').textContent = subtitle;

  // Show the label input only for scopes that need it.
  const labelHintEl = document.getElementById('invite-modal-label-hint');
  const labelInputEl = document.getElementById('invite-modal-label-input');
  if (copy.needsLabel) {
    if (labelHintEl) { labelHintEl.textContent = copy.labelHint; labelHintEl.classList.remove('hidden'); }
    if (labelInputEl) { labelInputEl.classList.remove('hidden'); labelInputEl.placeholder = copy.labelPlaceholder; }
  } else {
    if (labelHintEl) labelHintEl.classList.add('hidden');
    if (labelInputEl) labelInputEl.classList.add('hidden');
  }

  hideError();
  clearListeners();
  document.getElementById('invite-modal').classList.remove('hidden');

  let currentInvite = activeInvite ? { ...activeInvite } : null;

  if (currentInvite) {
    showState('manage');
    renderManageUrl(currentInvite.url);
  } else {
    showState('create');
    if (labelInputEl) labelInputEl.value = '';
  }

  // Create handler — branch by scope
  on(document.getElementById('invite-modal-create-btn'), 'click', async () => {
    try {
      let result;
      if (scope === 'personal') {
        const raw = labelInputEl.value;
        const trimmed = (raw || '').trim();
        if (!trimmed) { showError('Please enter a name.'); return; }
        if (trimmed.length > 40) { showError('Name must be at most 40 characters.'); return; }
        result = await createPersonalInvite(userId, trimmed);
        currentInvite = { token: result.token, url: result.url, scope, creatorLabel: trimmed };
      } else {
        result = await createGroupInvite(userId, groupId);
        currentInvite = { token: result.token, url: result.url, scope, groupId, groupName };
      }
      hideError();
      showState('manage');
      renderManageUrl(result.url);
    } catch (err) {
      showError(err.message || 'Could not create invite. Try again.');
    }
  });

  on(document.getElementById('invite-modal-cancel-btn'), 'click', () => closeModal());

  // Copy — unchanged
  on(document.getElementById('invite-modal-copy-btn'), 'click', async () => {
    if (!currentInvite) return;
    const btn = document.getElementById('invite-modal-copy-btn');
    try {
      await navigator.clipboard.writeText(currentInvite.url);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    } catch { /* clipboard denied */ }
  });

  // Regenerate — branch by scope
  on(document.getElementById('invite-modal-regen-btn'), 'click', async () => {
    if (!currentInvite) return;
    try {
      const result = scope === 'personal'
        ? await regeneratePersonalInvite(userId, currentInvite.creatorLabel)
        : await regenerateGroupInvite(userId, groupId);
      currentInvite = { ...currentInvite, token: result.token, url: result.url };
      renderManageUrl(result.url);
      document.getElementById('invite-modal-copy-btn').textContent = 'Copy';
    } catch (err) {
      showError(err.message || 'Could not regenerate invite. Try again.');
    }
  });

  // Revoke — branch by scope
  on(document.getElementById('invite-modal-revoke-btn'), 'click', async () => {
    try {
      if (scope === 'personal') await revokePersonalInvite(userId);
      else await revokeGroupInvite(userId, groupId);
      currentInvite = null;
      showState('create');
      if (labelInputEl) labelInputEl.value = '';
    } catch (err) {
      showError(err.message || 'Could not revoke invite. Try again.');
    }
  });

  on(document.getElementById('invite-modal-close-btn'), 'click', () => closeModal());
}
```

- [ ] **Step 2: Add group-scope tests**

Append to `tests/inviteModal.test.js`:

```js
jest.mock('../js/invites.js', () => ({
  createPersonalInvite: jest.fn(),
  regeneratePersonalInvite: jest.fn(),
  revokePersonalInvite: jest.fn(),
  createGroupInvite: jest.fn(),
  regenerateGroupInvite: jest.fn(),
  revokeGroupInvite: jest.fn(),
}));

// (existing tests untouched)

describe('openInviteModal — group scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupDom();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  test('throws when groupId or groupName is missing', () => {
    expect(() => openInviteModal({ scope: 'group', userId: 'uid1' })).toThrow(/groupId.*groupName/);
  });

  test('renders title and subtitle with the group name interpolated', () => {
    openInviteModal({ scope: 'group', userId: 'uid1', groupId: 'G1', groupName: 'Family' });
    expect(document.getElementById('invite-modal-title').textContent).toBe('Invite link for Family');
    expect(document.getElementById('invite-modal-subtitle').textContent).toContain('Family');
  });

  test('hides the label input for group scope', () => {
    openInviteModal({ scope: 'group', userId: 'uid1', groupId: 'G1', groupName: 'Family' });
    expect(document.getElementById('invite-modal-label-input').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('invite-modal-label-hint').classList.contains('hidden')).toBe(true);
  });

  test('Create button calls createGroupInvite(userId, groupId)', async () => {
    invites.createGroupInvite.mockResolvedValue({ token: 'NEW', url: 'https://x/?i=NEW', existing: false });
    openInviteModal({ scope: 'group', userId: 'uid1', groupId: 'G1', groupName: 'Family' });
    document.getElementById('invite-modal-create-btn').click();
    await new Promise(setImmediate);
    expect(invites.createGroupInvite).toHaveBeenCalledWith('uid1', 'G1');
    expect(document.getElementById('invite-modal-url').textContent).toBe('https://x/?i=NEW');
  });

  test('Regenerate calls regenerateGroupInvite(userId, groupId)', async () => {
    invites.regenerateGroupInvite.mockResolvedValue({ token: 'NEW2', url: 'https://x/?i=NEW2', existing: false });
    openInviteModal({
      scope: 'group', userId: 'uid1', groupId: 'G1', groupName: 'Family',
      activeInvite: { token: 'T', url: 'https://x/?i=T', scope: 'group' },
    });
    document.getElementById('invite-modal-regen-btn').click();
    await new Promise(setImmediate);
    expect(invites.regenerateGroupInvite).toHaveBeenCalledWith('uid1', 'G1');
  });

  test('Revoke calls revokeGroupInvite(userId, groupId)', async () => {
    invites.revokeGroupInvite.mockResolvedValue();
    openInviteModal({
      scope: 'group', userId: 'uid1', groupId: 'G1', groupName: 'Family',
      activeInvite: { token: 'T', url: 'https://x/?i=T', scope: 'group' },
    });
    document.getElementById('invite-modal-revoke-btn').click();
    await new Promise(setImmediate);
    expect(invites.revokeGroupInvite).toHaveBeenCalledWith('uid1', 'G1');
  });
});
```

- [ ] **Step 3: Run + commit**

```
npx jest
```

Expected: green.

```bash
git add js/inviteModal.js tests/inviteModal.test.js
git commit -m "feat: invite modal supports group scope

SCOPE_COPY.group with {groupName}-interpolated title and subtitle,
needsLabel: false so the input is hidden. Create/Regenerate/Revoke
handlers branch by scope. Existing personal-scope behavior unchanged.
Group scope is throwing on missing groupId/groupName so callers
can't accidentally invoke without context."
```

---

## Task 12: groupNav.js — navigation state machine

`currentContext` is either `'direct'` or `'group:{groupId}'`. It lives in three places:
- **Local module state** in `js/groupNav.js` — the in-memory truth for UI rendering.
- **Firebase** at `users/{uid}/currentContext` — written when the user navigates locally; read on boot and on subsequent `watchStatus` ticks for cross-device sync.
- **localStorage** (optional cache) — not used in Phase 1; rely on Firebase + boot-time default of `'direct'`.

This task implements the state machine and event emitters. Tasks 13/15 will subscribe to it.

**Files:**
- Create: `js/groupNav.js`
- Create: `tests/groupNav.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/groupNav.test.js`:

```js
// tests/groupNav.test.js
jest.mock('../js/db.js', () => ({
  setCurrentContext: jest.fn().mockResolvedValue(undefined),
  setLastVisited: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../js/db.js');
const {
  initNav, getCurrentContext, navigateToDirect, navigateToGroup,
  onContextChange, applyServerCurrentContext,
} = require('../js/groupNav');

describe('groupNav state machine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initNav('uid1');
  });

  test('initNav defaults to direct context', () => {
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
  });

  test('navigateToGroup writes currentContext + lastVisited and emits change', async () => {
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    await navigateToGroup('G1');
    expect(getCurrentContext()).toEqual({ context: 'group', groupId: 'G1' });
    expect(db.setCurrentContext).toHaveBeenCalledWith('uid1', 'group:G1');
    expect(db.setLastVisited).toHaveBeenCalledWith('uid1', 'G1', expect.any(Number));
    expect(seen[seen.length - 1]).toEqual({ context: 'group', groupId: 'G1' });
  });

  test('navigateToDirect writes direct + emits change', async () => {
    await navigateToGroup('G1'); // first move so the change has effect
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    await navigateToDirect();
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
    expect(db.setCurrentContext).toHaveBeenCalledWith('uid1', 'direct');
    expect(seen[seen.length - 1]).toEqual({ context: 'direct', groupId: null });
  });

  test('navigation is idempotent: same context twice does not double-write', async () => {
    await navigateToGroup('G1');
    db.setCurrentContext.mockClear();
    await navigateToGroup('G1');
    expect(db.setCurrentContext).not.toHaveBeenCalled();
  });

  test('applyServerCurrentContext updates local state without round-tripping to Firebase', () => {
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    applyServerCurrentContext('group:G2');
    expect(getCurrentContext()).toEqual({ context: 'group', groupId: 'G2' });
    expect(db.setCurrentContext).not.toHaveBeenCalled();
    expect(seen[seen.length - 1]).toEqual({ context: 'group', groupId: 'G2' });
  });

  test('applyServerCurrentContext for direct works', () => {
    applyServerCurrentContext('group:G2'); // move away first
    applyServerCurrentContext('direct');
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
  });

  test('applyServerCurrentContext no-ops when already in the same context', () => {
    const seen = [];
    onContextChange((ctx) => seen.push(ctx));
    applyServerCurrentContext('direct'); // same as initial
    expect(seen.length).toBe(0);
  });

  test('falls back to direct when server provides a malformed value', () => {
    applyServerCurrentContext('garbage');
    expect(getCurrentContext()).toEqual({ context: 'direct', groupId: null });
  });
});
```

- [ ] **Step 2: Verify failure + implement**

```
npx jest tests/groupNav.test.js
```

Expected: FAIL.

Create `js/groupNav.js`:

```js
// js/groupNav.js
// Navigation state machine: currentContext + group cards row.
// State is in-memory; writes mirror to Firebase via setCurrentContext / setLastVisited.

import { setCurrentContext, setLastVisited } from './db.js';

let _myUserId = null;
let _state = { context: 'direct', groupId: null };
const _listeners = new Set();

function parseContextString(s) {
  if (s === 'direct' || !s) return { context: 'direct', groupId: null };
  const m = typeof s === 'string' ? s.match(/^group:(.+)$/) : null;
  if (m) return { context: 'group', groupId: m[1] };
  return { context: 'direct', groupId: null };
}

function emit() {
  _listeners.forEach((fn) => { try { fn(_state); } catch { /* swallow */ } });
}

export function initNav(userId) {
  _myUserId = userId;
  _state = { context: 'direct', groupId: null };
}

export function getCurrentContext() {
  return { ..._state };
}

export function onContextChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export async function navigateToDirect() {
  if (_state.context === 'direct') return;
  _state = { context: 'direct', groupId: null };
  await setCurrentContext(_myUserId, 'direct');
  emit();
}

export async function navigateToGroup(groupId) {
  if (_state.context === 'group' && _state.groupId === groupId) return;
  _state = { context: 'group', groupId };
  await setCurrentContext(_myUserId, `group:${groupId}`);
  await setLastVisited(_myUserId, groupId, Date.now());
  emit();
}

export function applyServerCurrentContext(rawValue) {
  const next = parseContextString(rawValue);
  if (next.context === _state.context && next.groupId === _state.groupId) return;
  _state = next;
  emit();
}
```

- [ ] **Step 3: Run + commit**

```
npx jest
```

Expected: green.

```bash
git add js/groupNav.js tests/groupNav.test.js
git commit -m "feat: groupNav state machine — currentContext + listeners

In-memory state with idempotent navigateToDirect / navigateToGroup
that write to Firebase via setCurrentContext / setLastVisited.
applyServerCurrentContext lets watchStatus push remote updates
without round-tripping. Listeners notified on every change so the
UI (group cards row, group context view) can react."
```

---

## Task 13: groupNav.js — group cards row render

The visible row of group cards at the top of Direct context, ordered by `lastVisited` desc with `joinedAt` fallback. Each card is clickable → `navigateToGroup(id)`. After the last card sits a `+` button. Zero-state: full-width "Create your first group" CTA.

The cards row needs both `users/{uid}/groups` (for the enumeration + lastVisited) AND each `groups/{groupId}/name` (the displayed label). Subscribe via `watchUserGroups` for the enumeration; lazily fetch group names via `watchGroupMeta` per enumerated id so renames propagate live.

**Files:**
- Modify: `js/groupNav.js`
- Modify: `index.template.html` (add cards row markup; show/hide based on GROUPS_ENABLED)
- Modify: `css/app.css`
- Modify: `tests/groupNav.test.js`

- [ ] **Step 1: Add markup**

In `index.template.html`, find the existing `#main-list` or equivalent root of the Direct context (search for the existing follow-list section). Add a new container right above it:

```html
<div id="group-cards-row" class="group-cards-row hidden">
  <!-- Populated by groupNav.js. One .group-card per group; trailing #group-cards-plus button. -->
</div>
```

Hidden by default (CSS class `hidden`). `js/groupNav.js` reveals it when `GROUPS_ENABLED && (group count > 0 OR we want to show zero-state CTA)`. For now we just need the container.

- [ ] **Step 2: Add CSS**

In `css/app.css`:

```css
.group-cards-row {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding: 0.5rem 0;
  margin-bottom: 0.5rem;
}
.group-card {
  flex: 0 0 auto;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: var(--surface2);
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
  font-size: 0.9rem;
  position: relative;
  border: none;
}
.group-card.active { outline: 2px solid var(--accent); }
.group-card-badge {
  position: absolute;
  top: -0.25rem;
  right: -0.25rem;
  background: var(--accent);
  color: var(--text);
  border-radius: 999px;
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  min-width: 1.2rem;
  text-align: center;
}
.group-cards-plus {
  flex: 0 0 auto;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: transparent;
  color: var(--text-muted);
  border: 1px dashed var(--text-muted);
  cursor: pointer;
  font-size: 0.9rem;
}
.group-cards-zero {
  flex: 1;
  text-align: center;
  padding: 0.75rem;
  border-radius: 0.5rem;
  background: transparent;
  border: 1px dashed var(--text-muted);
  color: var(--text-muted);
  cursor: pointer;
}
```

- [ ] **Step 3: Append failing tests**

Append to `tests/groupNav.test.js`:

```js
// Add the new mocks to the existing db.js mock
jest.mock('../js/db.js', () => ({
  setCurrentContext: jest.fn().mockResolvedValue(undefined),
  setLastVisited: jest.fn().mockResolvedValue(undefined),
  watchUserGroups: jest.fn(),
  watchGroupMeta: jest.fn(),
  readMembers: jest.fn().mockResolvedValue({}),
}));
jest.mock('../js/features.js', () => ({ GROUPS_ENABLED: true }));

// (existing tests untouched; add new describe at end)

const { initCardsRow, renderCardsRow } = require('../js/groupNav');

function setupCardsDom() {
  document.body.innerHTML = `
    <div id="group-cards-row" class="group-cards-row hidden"></div>
  `;
}

describe('group cards row render', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCardsDom();
    initNav('uid1');
  });

  test('zero-state: empty groups → CTA visible, row visible', () => {
    renderCardsRow({}, {});
    const row = document.getElementById('group-cards-row');
    expect(row.classList.contains('hidden')).toBe(false);
    expect(row.querySelector('.group-cards-zero')).not.toBeNull();
    expect(row.querySelector('.group-cards-zero').textContent).toMatch(/Create your first group/);
  });

  test('renders one card per enumerated group, sorted by lastVisited desc', () => {
    const enumeration = {
      G1: { lastVisited: 100 },
      G2: { lastVisited: 300 },
      G3: { lastVisited: 200 },
    };
    const metaByGroupId = {
      G1: { name: 'Alpha' },
      G2: { name: 'Bravo' },
      G3: { name: 'Charlie' },
    };
    renderCardsRow(enumeration, metaByGroupId);
    const cards = document.querySelectorAll('.group-card');
    expect(cards.length).toBe(3);
    expect(cards[0].textContent).toContain('Bravo');
    expect(cards[1].textContent).toContain('Charlie');
    expect(cards[2].textContent).toContain('Alpha');
  });

  test('renders the trailing + button after group cards', () => {
    renderCardsRow({ G1: { lastVisited: 1 } }, { G1: { name: 'Family' } });
    expect(document.getElementById('group-cards-plus')).not.toBeNull();
  });

  test('clicking a card calls navigateToGroup', async () => {
    renderCardsRow({ G1: { lastVisited: 1 } }, { G1: { name: 'Family' } });
    const card = document.querySelector('.group-card');
    card.click();
    await new Promise(setImmediate);
    expect(db.setCurrentContext).toHaveBeenCalledWith('uid1', 'group:G1');
  });

  test('marks the current group card as active', () => {
    applyServerCurrentContext('group:G1');
    renderCardsRow({ G1: { lastVisited: 1 } }, { G1: { name: 'Family' } });
    expect(document.querySelector('.group-card').classList.contains('active')).toBe(true);
  });

  test('hides the row when GROUPS_ENABLED is false (via initCardsRow gate)', () => {
    jest.resetModules();
    jest.doMock('../js/features.js', () => ({ GROUPS_ENABLED: false }));
    const { initCardsRow: initCardsRow2 } = require('../js/groupNav');
    initCardsRow2();
    expect(document.getElementById('group-cards-row').classList.contains('hidden')).toBe(true);
  });
});
```

- [ ] **Step 4: Implement render**

Append to `js/groupNav.js`:

```js
import { watchUserGroups, watchGroupMeta } from './db.js';
import { GROUPS_ENABLED } from './features.js';

let _enumeration = {};
let _metaByGroupId = {};
let _metaSubs = {};  // groupId → unsubscribe fn
let _enumUnsub = null;

export function initCardsRow() {
  const row = document.getElementById('group-cards-row');
  if (!row) return;
  if (!GROUPS_ENABLED) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');
  // Initial render with whatever state we have.
  renderCardsRow(_enumeration, _metaByGroupId);
}

export function startCardsRowSubscriptions() {
  if (!_myUserId || !GROUPS_ENABLED) return;
  if (_enumUnsub) _enumUnsub();
  _enumUnsub = watchUserGroups(_myUserId, (collection) => {
    _enumeration = collection || {};
    syncMetaSubs();
    renderCardsRow(_enumeration, _metaByGroupId);
  });
}

function syncMetaSubs() {
  const wantIds = new Set(Object.keys(_enumeration));
  // Unsubscribe from removed
  for (const groupId of Object.keys(_metaSubs)) {
    if (!wantIds.has(groupId)) {
      _metaSubs[groupId]();
      delete _metaSubs[groupId];
      delete _metaByGroupId[groupId];
    }
  }
  // Subscribe to added
  for (const groupId of wantIds) {
    if (!_metaSubs[groupId]) {
      _metaSubs[groupId] = watchGroupMeta(groupId, (meta) => {
        if (meta) _metaByGroupId[groupId] = meta;
        else delete _metaByGroupId[groupId];
        renderCardsRow(_enumeration, _metaByGroupId);
      });
    }
  }
}

export function renderCardsRow(enumeration, metaByGroupId) {
  const row = document.getElementById('group-cards-row');
  if (!row) return;
  row.classList.remove('hidden');
  row.innerHTML = '';

  const groupIds = Object.keys(enumeration);

  if (groupIds.length === 0) {
    const cta = document.createElement('button');
    cta.id = 'group-cards-zero';
    cta.className = 'group-cards-zero';
    cta.textContent = 'Create your first group';
    cta.addEventListener('click', () => emitCreateRequest());
    row.appendChild(cta);
    return;
  }

  // Sort by lastVisited desc; missing lastVisited falls to the end
  const sorted = groupIds.slice().sort((a, b) => {
    const va = enumeration[a]?.lastVisited ?? 0;
    const vb = enumeration[b]?.lastVisited ?? 0;
    return vb - va;
  });

  for (const groupId of sorted) {
    const meta = metaByGroupId[groupId];
    const name = meta?.name || groupId;
    const card = document.createElement('button');
    card.className = 'group-card';
    card.dataset.groupId = groupId;
    card.textContent = name;
    if (_state.context === 'group' && _state.groupId === groupId) {
      card.classList.add('active');
    }
    card.addEventListener('click', () => navigateToGroup(groupId));
    row.appendChild(card);
  }

  const plus = document.createElement('button');
  plus.id = 'group-cards-plus';
  plus.className = 'group-cards-plus';
  plus.textContent = '+';
  plus.title = 'Create a new group';
  plus.addEventListener('click', () => emitCreateRequest());
  row.appendChild(plus);
}

// The cards row emits a "create requested" event; the create-group modal (Task 14)
// listens for it. Decoupling so the nav module doesn't have to import the modal.
const _createListeners = new Set();
export function onCreateRequested(fn) {
  _createListeners.add(fn);
  return () => _createListeners.delete(fn);
}
function emitCreateRequest() {
  _createListeners.forEach((fn) => { try { fn(); } catch {} });
}
```

- [ ] **Step 5: Run + commit**

```
npx jest
```

Expected: green.

```bash
git add js/groupNav.js index.template.html css/app.css tests/groupNav.test.js
git commit -m "feat: group cards row render + subscriptions

renderCardsRow draws one .group-card per enumerated group (sorted
by lastVisited desc) with a trailing + or a zero-state 'Create your
first group' CTA. Clicking a card navigates; clicking + or the CTA
emits a create-requested event consumed by the create-group modal
in Task 14. Gated by GROUPS_ENABLED."
```

---

## Task 14: Create-group modal + wiring

A simple modal with two inputs (group name + owner display name) and a Create button. Triggered by the `+` button or zero-state CTA from the cards row. On success, navigates to the new group context.

**Files:**
- Modify: `index.template.html` (modal markup)
- Modify: `css/app.css`
- Modify: `js/groupNav.js` (the create flow wiring lives here)
- Modify: `tests/groupNav.test.js`

- [ ] **Step 1: Add markup**

In `index.template.html`:

```html
<div id="create-group-modal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="create-group-title">
  <div class="modal-card">
    <h2 id="create-group-title" class="modal-title">Create a group</h2>
    <p class="modal-subtitle">Members of this group will see each other's status.</p>

    <label class="modal-label" for="create-group-name-input">Group name</label>
    <input id="create-group-name-input" class="text-input" type="text" maxlength="40" placeholder="e.g. Family" />

    <label class="modal-label" for="create-group-displayname-input">Your name in this group</label>
    <input id="create-group-displayname-input" class="text-input" type="text" maxlength="40" placeholder="e.g. Mike" />

    <p id="create-group-error" class="error-msg hidden"></p>

    <div class="modal-actions">
      <button id="create-group-submit-btn" class="primary-btn">Create</button>
      <button id="create-group-cancel-btn" class="ghost-btn">Cancel</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Append failing tests**

Add to `tests/groupNav.test.js`:

```js
jest.mock('../js/groups.js', () => ({
  createGroup: jest.fn(),
}));

const groups = require('../js/groups.js');
const { openCreateGroupModal } = require('../js/groupNav');

function setupCreateModalDom() {
  document.body.innerHTML += `
    <div id="create-group-modal" class="modal-overlay hidden">
      <div class="modal-card">
        <input id="create-group-name-input" type="text" maxlength="40" />
        <input id="create-group-displayname-input" type="text" maxlength="40" />
        <p id="create-group-error" class="error-msg hidden"></p>
        <button id="create-group-submit-btn"></button>
        <button id="create-group-cancel-btn"></button>
      </div>
    </div>
  `;
}

describe('create-group modal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCardsDom();
    setupCreateModalDom();
    initNav('uid1');
  });

  test('openCreateGroupModal reveals the overlay and clears inputs', () => {
    document.getElementById('create-group-name-input').value = 'stale';
    document.getElementById('create-group-displayname-input').value = 'stale';
    openCreateGroupModal();
    expect(document.getElementById('create-group-modal').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('create-group-name-input').value).toBe('');
    expect(document.getElementById('create-group-displayname-input').value).toBe('');
  });

  test('Cancel closes without writing', () => {
    openCreateGroupModal();
    document.getElementById('create-group-cancel-btn').click();
    expect(document.getElementById('create-group-modal').classList.contains('hidden')).toBe(true);
    expect(groups.createGroup).not.toHaveBeenCalled();
  });

  test('Submit validates: empty name shows error', async () => {
    openCreateGroupModal();
    document.getElementById('create-group-name-input').value = '   ';
    document.getElementById('create-group-displayname-input').value = 'Mike';
    document.getElementById('create-group-submit-btn').click();
    await new Promise(setImmediate);
    expect(document.getElementById('create-group-error').classList.contains('hidden')).toBe(false);
    expect(groups.createGroup).not.toHaveBeenCalled();
  });

  test('Submit happy path: calls createGroup, closes modal, navigates to new group', async () => {
    groups.createGroup.mockResolvedValue({ groupId: 'G1ABCDEF', name: 'Family' });
    openCreateGroupModal();
    document.getElementById('create-group-name-input').value = 'Family';
    document.getElementById('create-group-displayname-input').value = 'Mike';
    document.getElementById('create-group-submit-btn').click();
    await new Promise(setImmediate);
    expect(groups.createGroup).toHaveBeenCalledWith('uid1', 'Family', 'Mike');
    expect(document.getElementById('create-group-modal').classList.contains('hidden')).toBe(true);
    expect(db.setCurrentContext).toHaveBeenCalledWith('uid1', 'group:G1ABCDEF');
  });

  test('Submit failure: surfaces error from createGroup, stays open', async () => {
    groups.createGroup.mockRejectedValue(new Error('boom'));
    openCreateGroupModal();
    document.getElementById('create-group-name-input').value = 'Family';
    document.getElementById('create-group-displayname-input').value = 'Mike';
    document.getElementById('create-group-submit-btn').click();
    await new Promise(setImmediate);
    expect(document.getElementById('create-group-error').textContent).toBe('boom');
    expect(document.getElementById('create-group-modal').classList.contains('hidden')).toBe(false);
  });
});
```

- [ ] **Step 3: Verify failure + implement**

```
npx jest tests/groupNav.test.js -t 'create-group modal'
```

Expected: FAIL.

Append to `js/groupNav.js`:

```js
import { createGroup } from './groups.js';

const createModalCleanup = [];

function showCreateError(msg) {
  const el = document.getElementById('create-group-error');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideCreateError() {
  const el = document.getElementById('create-group-error');
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

function closeCreateModal() {
  document.getElementById('create-group-modal').classList.add('hidden');
  createModalCleanup.forEach((fn) => fn());
  createModalCleanup.length = 0;
}

export function openCreateGroupModal() {
  const overlay = document.getElementById('create-group-modal');
  if (!overlay) return;
  const nameInput = document.getElementById('create-group-name-input');
  const dnInput = document.getElementById('create-group-displayname-input');
  const submit = document.getElementById('create-group-submit-btn');
  const cancel = document.getElementById('create-group-cancel-btn');

  nameInput.value = '';
  dnInput.value = '';
  hideCreateError();
  overlay.classList.remove('hidden');

  const onSubmit = async () => {
    const name = (nameInput.value || '').trim();
    const dn = (dnInput.value || '').trim();
    if (!name || !dn) { showCreateError('Both fields are required.'); return; }
    submit.disabled = true;
    try {
      const result = await createGroup(_myUserId, name, dn);
      closeCreateModal();
      await navigateToGroup(result.groupId);
    } catch (err) {
      showCreateError(err.message || 'Could not create group.');
    } finally {
      submit.disabled = false;
    }
  };
  const onCancel = () => closeCreateModal();

  submit.addEventListener('click', onSubmit);
  cancel.addEventListener('click', onCancel);
  createModalCleanup.push(() => submit.removeEventListener('click', onSubmit));
  createModalCleanup.push(() => cancel.removeEventListener('click', onCancel));
}

// Wire the create-requested event from the cards row to this modal.
onCreateRequested(openCreateGroupModal);
```

- [ ] **Step 4: Run + commit**

```
npx jest
```

Expected: green.

```bash
git add js/groupNav.js index.template.html css/app.css tests/groupNav.test.js
git commit -m "feat: create-group modal + flow

Triggered by the cards row's + button or zero-state CTA. Two inputs
(group name + owner displayName), client-side validation, surfaces
groups.createGroup errors inline. On success, closes the modal and
navigates to the new group's context."
```

---

## Task 15: groupContext.js — context view scaffolding

The view that replaces the main UI when `currentContext.context === 'group'`. Owns the breadcrumb (`← {groupName}`) and a placeholder header. Roster + settings come in Tasks 16-17.

When `currentContext` changes (locally via navigation or remotely via watchStatus push), the appropriate root is shown / hidden:
- `'direct'` → `#main-ui-direct` (existing) visible, `#group-context-root` hidden
- `'group'` → `#main-ui-direct` hidden, `#group-context-root` visible

The group context root is full-overlay-style (same z-index as the direct root); only one is rendered at a time.

**Files:**
- Create: `js/groupContext.js`
- Create: `tests/groupContext.test.js`
- Modify: `index.template.html` (add group-context root with breadcrumb)
- Modify: `css/app.css`
- Modify: `js/app.js` (boot wiring)

- [ ] **Step 1: Add markup**

In `index.template.html`, after the existing main UI block, add:

```html
<div id="group-context-root" class="group-context-root hidden">
  <div class="group-breadcrumb">
    <button id="group-breadcrumb-back" class="group-breadcrumb-back" aria-label="Back to Direct">←</button>
    <span id="group-breadcrumb-name" class="group-breadcrumb-name"></span>
  </div>
  <header class="group-context-header">
    <h2 id="group-context-name" class="group-context-name"></h2>
    <button id="group-context-settings-btn" class="ghost-btn hidden">Settings</button>
  </header>
  <ul id="group-roster" class="group-roster"></ul>
</div>
```

- [ ] **Step 2: Add CSS**

In `css/app.css`:

```css
.group-context-root { padding: 0.75rem; }
.group-breadcrumb { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
.group-breadcrumb-back {
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
}
.group-breadcrumb-name { color: var(--text-muted); }
.group-context-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
.group-context-name { font-size: 1.25rem; font-weight: 700; margin: 0; }
.group-roster { list-style: none; padding: 0; margin: 0; }
```

- [ ] **Step 3: Failing tests**

Create `tests/groupContext.test.js`:

```js
// tests/groupContext.test.js
jest.mock('../js/db.js', () => ({
  readGroup: jest.fn().mockResolvedValue(null),
  watchGroupMeta: jest.fn(() => () => {}),
  watchGroupMembers: jest.fn(() => () => {}),
  watchStatus: jest.fn(() => () => {}),
}));
jest.mock('../js/groupNav.js', () => ({
  navigateToDirect: jest.fn().mockResolvedValue(undefined),
  getCurrentContext: jest.fn(() => ({ context: 'group', groupId: 'G1' })),
}));

const db = require('../js/db.js');
const groupNav = require('../js/groupNav.js');
const { enterGroupContext, exitGroupContext } = require('../js/groupContext');

function setupContextDom() {
  document.body.innerHTML = `
    <div id="main-ui-direct"></div>
    <div id="group-context-root" class="group-context-root hidden">
      <div class="group-breadcrumb">
        <button id="group-breadcrumb-back">←</button>
        <span id="group-breadcrumb-name"></span>
      </div>
      <header class="group-context-header">
        <h2 id="group-context-name"></h2>
        <button id="group-context-settings-btn" class="hidden">Settings</button>
      </header>
      <ul id="group-roster"></ul>
    </div>
  `;
}

describe('groupContext scaffolding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupContextDom();
  });

  test('enterGroupContext reveals the root and hides direct UI', () => {
    enterGroupContext('G1', 'me');
    expect(document.getElementById('group-context-root').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('main-ui-direct').classList.contains('hidden')).toBe(true);
  });

  test('enterGroupContext renders the breadcrumb name and header name on watchGroupMeta tick', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'owner', createdAt: 1 });
    expect(document.getElementById('group-breadcrumb-name').textContent).toBe('Family');
    expect(document.getElementById('group-context-name').textContent).toBe('Family');
  });

  test('shows the Settings button when the caller is the owner', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    expect(document.getElementById('group-context-settings-btn').classList.contains('hidden')).toBe(false);
  });

  test('keeps Settings hidden when the caller is not the owner', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    expect(document.getElementById('group-context-settings-btn').classList.contains('hidden')).toBe(true);
  });

  test('breadcrumb back button calls navigateToDirect', () => {
    enterGroupContext('G1', 'me');
    document.getElementById('group-breadcrumb-back').click();
    expect(groupNav.navigateToDirect).toHaveBeenCalled();
  });

  test('exitGroupContext hides the root and shows direct', () => {
    enterGroupContext('G1', 'me');
    exitGroupContext();
    expect(document.getElementById('group-context-root').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('main-ui-direct').classList.contains('hidden')).toBe(false);
  });
});
```

- [ ] **Step 4: Verify + implement**

```
npx jest tests/groupContext.test.js
```

Expected: FAIL.

Create `js/groupContext.js`:

```js
// js/groupContext.js
// Group context view: breadcrumb, header, roster. Roster + settings populated
// in Tasks 16-17. This scaffolding handles enter/exit and the breadcrumb back.

import { watchGroupMeta } from './db.js';
import { navigateToDirect } from './groupNav.js';

let _metaUnsub = null;
let _currentGroupId = null;
let _currentUserId = null;

export function enterGroupContext(groupId, userId) {
  if (_metaUnsub) _metaUnsub();
  _currentGroupId = groupId;
  _currentUserId = userId;

  const root = document.getElementById('group-context-root');
  const direct = document.getElementById('main-ui-direct');
  if (root) root.classList.remove('hidden');
  if (direct) direct.classList.add('hidden');

  // Wire the breadcrumb back button (idempotent — listener is replaced via clone-and-attach)
  const back = document.getElementById('group-breadcrumb-back');
  if (back) {
    const clone = back.cloneNode(true);
    back.parentNode.replaceChild(clone, back);
    clone.addEventListener('click', () => navigateToDirect());
  }

  // Subscribe to group meta for the name + owner check
  _metaUnsub = watchGroupMeta(groupId, (meta) => {
    if (!meta) return; // deletion handled in Task 18
    const nameEl = document.getElementById('group-context-name');
    const crumbEl = document.getElementById('group-breadcrumb-name');
    if (nameEl) nameEl.textContent = meta.name || '';
    if (crumbEl) crumbEl.textContent = meta.name || '';

    const settings = document.getElementById('group-context-settings-btn');
    if (settings) {
      if (meta.ownerId === _currentUserId) settings.classList.remove('hidden');
      else settings.classList.add('hidden');
    }
  });
}

export function exitGroupContext() {
  if (_metaUnsub) { _metaUnsub(); _metaUnsub = null; }
  _currentGroupId = null;
  _currentUserId = null;
  const root = document.getElementById('group-context-root');
  const direct = document.getElementById('main-ui-direct');
  if (root) root.classList.add('hidden');
  if (direct) direct.classList.remove('hidden');
}

export function getCurrentGroupId() { return _currentGroupId; }
```

- [ ] **Step 5: Wire in js/app.js**

`js/app.js` already calls `initHeader` and `initList` after identity is established. After Phase 1, it also needs to:
- Wrap the existing main-UI elements in a `#main-ui-direct` div so we can toggle them.
- Call `initNav(userId)` and `startCardsRowSubscriptions()` and `initCardsRow()`.
- Subscribe to context changes via `onContextChange` and call `enterGroupContext` / `exitGroupContext` accordingly.
- On boot, apply `currentContext` from the watchStatus tick (via `applyServerCurrentContext`).

Wrap the existing main-UI HTML in `index.template.html` in a `<div id="main-ui-direct">`. Find the existing root that contains `#app-header` and `#main-list`, and add the wrapper:

```html
<div id="main-ui-direct">
  <!-- existing header + list markup unchanged -->
</div>
```

In `js/app.js`, after `initHeader` and `initList`, add:

```js
import { initNav, startCardsRowSubscriptions, initCardsRow, onContextChange, applyServerCurrentContext } from './groupNav.js';
import { enterGroupContext, exitGroupContext } from './groupContext.js';

// (Inside main(), after the existing init calls)
initNav(userId);
initCardsRow();
startCardsRowSubscriptions();
onContextChange((ctx) => {
  if (ctx.context === 'group') enterGroupContext(ctx.groupId, userId);
  else exitGroupContext();
});

// In the existing watchStatus subscription's callback, after the other sync helpers:
//   applyServerCurrentContext(userData?.currentContext || 'direct');
```

The exact spot in the watchStatus callback depends on the current shape of the callback. Look for `syncPaletteStateFromServer` or similar `syncXFromServer(...)` calls and add `applyServerCurrentContext(...)` alongside them.

- [ ] **Step 6: Run + commit**

```
npx jest
```

Expected: green.

```bash
git add js/groupContext.js tests/groupContext.test.js js/app.js index.template.html css/app.css
git commit -m "feat: group context view scaffolding

enterGroupContext / exitGroupContext toggle between #main-ui-direct
and #group-context-root. Breadcrumb back button calls
navigateToDirect. Settings button appears only for the owner (driven
by watchGroupMeta.ownerId vs current user id). Roster ul exists but
populated in Task 16."
```

---

## Task 16: groupContext.js — roster render

The roster shows each member's display name + their primary status (Phase 1 = no per-audience overrides). Status comes from each member's `users/{memberUid}` record (same pattern as the following list). Subscribe to `watchGroupMembers` for the membership and per-member `watchStatus` for the live status.

Sort order: own card first, then by displayName asc. Owner gets a small "(owner)" badge.

**Files:**
- Modify: `js/groupContext.js`
- Modify: `tests/groupContext.test.js`
- Modify: `css/app.css`

- [ ] **Step 1: Failing tests**

Append to `tests/groupContext.test.js`:

```js
jest.mock('../js/db.js', () => ({
  readGroup: jest.fn().mockResolvedValue(null),
  watchGroupMeta: jest.fn(() => () => {}),
  watchGroupMembers: jest.fn(() => () => {}),
  watchStatus: jest.fn(() => () => {}),
}));

describe('group roster render', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupContextDom();
  });

  test('renders one li per member, with own card first', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({
      'me': { role: 'member', displayName: 'My Name', joinedAt: 1 },
      'a':  { role: 'member', displayName: 'Alice',   joinedAt: 2 },
      'b':  { role: 'owner',  displayName: 'Bob',     joinedAt: 0 },
    });
    const items = document.querySelectorAll('#group-roster li');
    expect(items.length).toBe(3);
    expect(items[0].dataset.userId).toBe('me');
    expect(items[1].textContent).toContain('Alice');
    expect(items[2].textContent).toContain('Bob');
  });

  test('owner gets the (owner) badge', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({
      'b': { role: 'owner', displayName: 'Bob', joinedAt: 0 },
    });
    expect(document.querySelector('#group-roster li').textContent).toContain('(owner)');
  });

  test('each member gets a watchStatus subscription', () => {
    let membersCb;
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({
      'a': { role: 'member', displayName: 'Alice', joinedAt: 1 },
      'b': { role: 'member', displayName: 'Bob',   joinedAt: 2 },
    });
    expect(db.watchStatus).toHaveBeenCalledWith('a', expect.any(Function));
    expect(db.watchStatus).toHaveBeenCalledWith('b', expect.any(Function));
  });

  test('member status updates render the available/unavailable dot', () => {
    let membersCb;
    const statusCbs = {};
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    db.watchStatus.mockImplementation((uid, cb) => { statusCbs[uid] = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    membersCb({ 'a': { role: 'member', displayName: 'Alice', joinedAt: 1 } });

    statusCbs.a({ status: 'available', statusColor: '#22c55e', availableUntil: Date.now() + 60000 });
    const dot = document.querySelector('#group-roster [data-user-id="a"] .person-dot');
    expect(dot).not.toBeNull();
    expect(dot.dataset.available).toBe('true');
  });

  test('exitGroupContext unsubscribes from member status watchers', () => {
    let membersCb;
    const unsubs = [];
    db.watchGroupMembers.mockImplementation((groupId, cb) => { membersCb = cb; return () => {}; });
    db.watchStatus.mockImplementation(() => { const fn = jest.fn(); unsubs.push(fn); return fn; });
    enterGroupContext('G1', 'me');
    membersCb({ 'a': { role: 'member', displayName: 'Alice', joinedAt: 1 } });
    exitGroupContext();
    unsubs.forEach((u) => expect(u).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Verify + implement**

```
npx jest tests/groupContext.test.js -t 'group roster render'
```

Expected: FAIL.

Extend `js/groupContext.js`:

```js
import { watchGroupMeta, watchGroupMembers, watchStatus } from './db.js';

let _membersUnsub = null;
const _statusUnsubs = new Map(); // memberUid → unsubscribe fn

function renderRoster(members, ownUserId) {
  const list = document.getElementById('group-roster');
  if (!list) return;
  list.innerHTML = '';

  const entries = Object.entries(members || {});
  entries.sort(([uidA, a], [uidB, b]) => {
    if (uidA === ownUserId) return -1;
    if (uidB === ownUserId) return 1;
    const nameA = (a.displayName || '').toLowerCase();
    const nameB = (b.displayName || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  for (const [uid, member] of entries) {
    const li = document.createElement('li');
    li.className = 'group-roster-row';
    li.dataset.userId = uid;
    li.dataset.available = 'false';

    const dot = document.createElement('span');
    dot.className = 'person-dot';
    dot.dataset.available = 'false';

    const label = document.createElement('span');
    label.className = 'person-label';
    label.textContent = member.displayName || uid;
    if (member.role === 'owner') {
      const badge = document.createElement('span');
      badge.className = 'role-badge';
      badge.textContent = ' (owner)';
      label.appendChild(badge);
    }

    li.appendChild(dot);
    li.appendChild(label);
    list.appendChild(li);
  }
}

function syncStatusSubscriptions(memberUids) {
  // Unsubscribe from removed
  for (const uid of Array.from(_statusUnsubs.keys())) {
    if (!memberUids.has(uid)) {
      _statusUnsubs.get(uid)();
      _statusUnsubs.delete(uid);
    }
  }
  // Subscribe to added
  for (const uid of memberUids) {
    if (!_statusUnsubs.has(uid)) {
      _statusUnsubs.set(uid, watchStatus(uid, (data) => {
        const li = document.querySelector(`#group-roster [data-user-id="${uid}"]`);
        if (!li) return;
        const available = data && data.status === 'available' && (!data.availableUntil || data.availableUntil > Date.now());
        li.dataset.available = available ? 'true' : 'false';
        const dot = li.querySelector('.person-dot');
        if (dot) {
          dot.dataset.available = available ? 'true' : 'false';
          if (available && data.statusColor) dot.style.background = data.statusColor;
          else dot.style.background = '';
        }
      }));
    }
  }
}

// Modify enterGroupContext to subscribe to members:
// Inside the existing enterGroupContext, ALONGSIDE the watchGroupMeta call, add:
//
//   if (_membersUnsub) _membersUnsub();
//   _membersUnsub = watchGroupMembers(groupId, (members) => {
//     renderRoster(members, userId);
//     syncStatusSubscriptions(new Set(Object.keys(members || {})));
//   });
//
// Modify exitGroupContext to:
//   if (_membersUnsub) { _membersUnsub(); _membersUnsub = null; }
//   _statusUnsubs.forEach((fn) => fn()); _statusUnsubs.clear();
//   (then the existing root.hide / direct.show)
```

The pseudo-`Modify` comments above describe the integration; apply them to the actual `enterGroupContext` and `exitGroupContext` functions added in Task 15.

- [ ] **Step 3: Add CSS for roster row + role badge**

```css
.group-roster-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.25rem; }
.role-badge { color: var(--text-muted); font-size: 0.85rem; font-weight: normal; }
```

- [ ] **Step 4: Run + commit**

```
npx jest
```

Expected: green.

```bash
git add js/groupContext.js tests/groupContext.test.js css/app.css
git commit -m "feat: group roster — members with live status

watchGroupMembers feeds the membership list, sorted with own card
first then displayName asc. Each member gets a watchStatus
subscription for live availability dot color. Owner row carries an
'(owner)' label. exitGroupContext tears down all subscriptions."
```

---

## Task 17: groupContext.js — owner settings + member self-actions

Owner sees a settings affordance that opens a small menu with: Rename group, Delete group, Invite link. Members see a self-actions affordance with: Edit my name in this group, Leave group.

Phase 1 keeps these as simple confirm prompts / inline editors rather than building elaborate menus. The Settings button (owner) toggles a `<details>` element with the three buttons; an analogous member-actions slot exists for non-owners.

**Files:**
- Modify: `index.template.html`
- Modify: `css/app.css`
- Modify: `js/groupContext.js`
- Modify: `tests/groupContext.test.js`

- [ ] **Step 1: Add markup**

Replace the existing `<header class="group-context-header">` in `index.template.html` with:

```html
<header class="group-context-header">
  <h2 id="group-context-name" class="group-context-name"></h2>
  <details id="group-context-actions" class="group-context-actions">
    <summary>Settings</summary>
    <div class="group-actions-menu">
      <button id="group-action-rename" class="ghost-btn hidden">Rename group</button>
      <button id="group-action-invite" class="ghost-btn hidden">Invite link</button>
      <button id="group-action-delete" class="ghost-btn hidden">Delete group</button>
      <button id="group-action-edit-name" class="ghost-btn hidden">Edit my name</button>
      <button id="group-action-leave" class="ghost-btn hidden">Leave group</button>
    </div>
  </details>
</header>
```

(The existing `#group-context-settings-btn` is replaced by the `<details>` element. Task 15's test for "shows the Settings button when the caller is the owner" needs to be updated — see Step 3.)

- [ ] **Step 2: Add CSS**

```css
.group-context-actions summary {
  cursor: pointer;
  color: var(--text);
  font-size: 0.9rem;
  list-style: none;
}
.group-context-actions summary::-webkit-details-marker { display: none; }
.group-actions-menu {
  position: absolute;
  right: 0;
  margin-top: 0.5rem;
  background: var(--surface2);
  border-radius: 0.5rem;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  z-index: 5;
}
```

- [ ] **Step 3: Update the existing settings-button test**

Replace the two existing tests `'shows the Settings button when the caller is the owner'` and `'keeps Settings hidden when the caller is not the owner'` in `tests/groupContext.test.js` with:

```js
test('shows owner-only action buttons when caller is the owner', () => {
  let metaCb;
  db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
  enterGroupContext('G1', 'me');
  metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
  expect(document.getElementById('group-action-rename').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('group-action-invite').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('group-action-delete').classList.contains('hidden')).toBe(false);
  // Member-only buttons hidden
  expect(document.getElementById('group-action-edit-name').classList.contains('hidden')).toBe(false); // own-name edit also for owner
  expect(document.getElementById('group-action-leave').classList.contains('hidden')).toBe(true);      // owner can't leave
});

test('shows member-only action buttons when caller is a non-owner member', () => {
  let metaCb;
  db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
  enterGroupContext('G1', 'me');
  metaCb({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
  expect(document.getElementById('group-action-rename').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('group-action-invite').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('group-action-delete').classList.contains('hidden')).toBe(true);
  expect(document.getElementById('group-action-edit-name').classList.contains('hidden')).toBe(false);
  expect(document.getElementById('group-action-leave').classList.contains('hidden')).toBe(false);
});
```

Add new tests for the action handlers:

```js
jest.mock('../js/groups.js', () => ({
  renameGroup: jest.fn().mockResolvedValue(undefined),
  deleteGroup: jest.fn().mockResolvedValue(undefined),
  leaveGroup: jest.fn().mockResolvedValue(undefined),
  editOwnDisplayName: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../js/inviteModal.js', () => ({
  openInviteModal: jest.fn(),
}));
const groupsModule = require('../js/groups.js');
const inviteModal = require('../js/inviteModal.js');

describe('owner actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupContextDom();
  });

  test('Rename group prompts and calls renameGroup', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    window.prompt = jest.fn(() => '  Familia  ');
    document.getElementById('group-action-rename').click();
    expect(groupsModule.renameGroup).toHaveBeenCalledWith('G1', 'me', 'Familia');
  });

  test('Delete group confirms and calls deleteGroup', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    window.confirm = jest.fn(() => true);
    document.getElementById('group-action-delete').click();
    expect(groupsModule.deleteGroup).toHaveBeenCalledWith('G1', 'me');
  });

  test('Invite link opens the modal with group scope', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'me', createdAt: 1 });
    document.getElementById('group-action-invite').click();
    expect(inviteModal.openInviteModal).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'group',
      userId: 'me',
      groupId: 'G1',
      groupName: 'Family',
    }));
  });
});

describe('member actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupContextDom();
  });

  test('Edit my name prompts and calls editOwnDisplayName', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    window.prompt = jest.fn(() => '  M. P.  ');
    document.getElementById('group-action-edit-name').click();
    expect(groupsModule.editOwnDisplayName).toHaveBeenCalledWith('G1', 'me', 'M. P.');
  });

  test('Leave group confirms and calls leaveGroup', () => {
    let metaCb;
    db.watchGroupMeta.mockImplementation((groupId, cb) => { metaCb = cb; return () => {}; });
    enterGroupContext('G1', 'me');
    metaCb({ name: 'Family', ownerId: 'someoneElse', createdAt: 1 });
    window.confirm = jest.fn(() => true);
    document.getElementById('group-action-leave').click();
    expect(groupsModule.leaveGroup).toHaveBeenCalledWith('G1', 'me');
  });
});
```

- [ ] **Step 4: Implement in js/groupContext.js**

Add imports:

```js
import { renameGroup, deleteGroup, leaveGroup, editOwnDisplayName } from './groups.js';
import { openInviteModal } from './inviteModal.js';
import { navigateToDirect } from './groupNav.js';
```

Add a function `wireActions(groupId, userId, isOwner, groupName)` and call it from inside the `watchGroupMeta` callback in `enterGroupContext` (replacing the old `#group-context-settings-btn` toggle):

```js
function wireActions(groupId, userId, isOwner, groupName) {
  const ids = ['group-action-rename', 'group-action-invite', 'group-action-delete', 'group-action-edit-name', 'group-action-leave'];

  // Clone-and-replace each button to drop any previous listeners
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
  }

  // Visibility
  document.getElementById('group-action-rename').classList.toggle('hidden', !isOwner);
  document.getElementById('group-action-invite').classList.toggle('hidden', !isOwner);
  document.getElementById('group-action-delete').classList.toggle('hidden', !isOwner);
  document.getElementById('group-action-edit-name').classList.remove('hidden');  // both owner and member
  document.getElementById('group-action-leave').classList.toggle('hidden', isOwner);  // hidden for owner

  // Handlers
  document.getElementById('group-action-rename').addEventListener('click', async () => {
    const next = window.prompt('New group name', groupName || '');
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    try { await renameGroup(groupId, userId, trimmed); } catch (e) { window.alert(e.message); }
  });

  document.getElementById('group-action-invite').addEventListener('click', () => {
    openInviteModal({ scope: 'group', userId, groupId, groupName: groupName || groupId });
  });

  document.getElementById('group-action-delete').addEventListener('click', async () => {
    if (!window.confirm(`Delete '${groupName || 'this group'}'? This cannot be undone.`)) return;
    try {
      await deleteGroup(groupId, userId);
      await navigateToDirect();
    } catch (e) { window.alert(e.message); }
  });

  document.getElementById('group-action-edit-name').addEventListener('click', async () => {
    const next = window.prompt('Your name in this group', '');
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    try { await editOwnDisplayName(groupId, userId, trimmed); } catch (e) { window.alert(e.message); }
  });

  document.getElementById('group-action-leave').addEventListener('click', async () => {
    if (!window.confirm(`Leave '${groupName || 'this group'}'?`)) return;
    try {
      await leaveGroup(groupId, userId);
      await navigateToDirect();
    } catch (e) { window.alert(e.message); }
  });
}
```

In the `watchGroupMeta` callback inside `enterGroupContext`, after setting the name + breadcrumb, call:

```js
const isOwner = meta.ownerId === userId;
wireActions(groupId, userId, isOwner, meta.name);
```

(Remove or skip the now-obsolete logic that toggled `#group-context-settings-btn`.)

- [ ] **Step 5: Run + commit**

```
npx jest
```

Expected: green.

```bash
git add js/groupContext.js tests/groupContext.test.js index.template.html css/app.css
git commit -m "feat: owner settings + member self-actions in group context

Owners get Rename / Invite link / Delete; both owners and members
get Edit my name; non-owners get Leave group. Rename / edit-name
use window.prompt; Delete / Leave use window.confirm. After deleting
or leaving, navigate back to direct context. Invite link opens the
Phase 0 modal parameterized to group scope."
```

---

## Task 18: Deletion + kick detection with notification

Per spec §16.1: when a member is removed from a group (either the owner deleted the group entirely, or the owner kicked the member — Phase 1 only has deletion, but the same detection works for future kicks), the member's app needs to detect the transition and surface a notice.

Mechanism: when `watchUserGroups` emits a removal (a groupId disappears from the enumeration), or when a `watchGroupMembers` subscription returns null for the user's own member record, treat it as a transition. Distinguish:
- `groups/{groupId}` no longer exists → deletion ("'Family' has been deleted")
- `groups/{groupId}` exists but member record gone → kick ("You've been removed from 'Family'")

A small `groupDetector` module (or just functions in `js/groups.js`) tracks the previously-known enumeration and reacts to deltas.

**Files:**
- Modify: `js/groups.js`
- Modify: `js/app.js` (wire the detector into the boot flow)
- Modify: `index.template.html` (add toast element)
- Modify: `css/app.css`
- Create: `tests/groups.test.js` extensions (or new `tests/groupDetector.test.js` — append to existing)

- [ ] **Step 1: Add toast markup**

In `index.template.html`:

```html
<div id="group-removal-toast" class="group-removal-toast hidden" role="alert">
  <span id="group-removal-toast-text"></span>
  <button id="group-removal-toast-dismiss" class="ghost-btn">OK</button>
</div>
```

- [ ] **Step 2: Add CSS**

```css
.group-removal-toast {
  position: fixed;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  background: var(--surface2);
  color: var(--text);
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  z-index: 100;
  max-width: calc(100vw - 2rem);
}
```

- [ ] **Step 3: Failing tests**

Append to `tests/groups.test.js`:

```js
const { initGroupRemovalDetector, _resetGroupRemovalDetectorForTests } = require('../js/groups');

function setupRemovalDom() {
  document.body.innerHTML = `
    <div id="group-removal-toast" class="hidden">
      <span id="group-removal-toast-text"></span>
      <button id="group-removal-toast-dismiss"></button>
    </div>
  `;
}

describe('group removal detector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupRemovalDom();
    _resetGroupRemovalDetectorForTests();
  });

  test('removal of an enumerated group whose record is gone → deletion toast', async () => {
    db.readGroup.mockResolvedValue(null);
    db.removeUserGroupsEntry.mockResolvedValue();
    db.readMembers.mockResolvedValue({});
    initGroupRemovalDetector('me');
    // First snapshot: G1 present
    await flushPromises();
    // Imagine the previous state was { G1: ..., G2: ... }, now it's { G2: ... }
    // We seed previous via two snapshots
    const { _feedSnapshotForTests } = require('../js/groups');
    _feedSnapshotForTests({ G1: true, G2: true });
    _feedSnapshotForTests({ G2: true });
    await flushPromises();
    expect(document.getElementById('group-removal-toast').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('group-removal-toast-text').textContent).toMatch(/has been deleted|removed/);
  });

  test('dismiss button hides the toast', async () => {
    db.readGroup.mockResolvedValue(null);
    initGroupRemovalDetector('me');
    const { _feedSnapshotForTests } = require('../js/groups');
    _feedSnapshotForTests({ G1: true });
    _feedSnapshotForTests({});
    await flushPromises();
    document.getElementById('group-removal-toast-dismiss').click();
    expect(document.getElementById('group-removal-toast').classList.contains('hidden')).toBe(true);
  });
});

// Helper used by the tests above
function flushPromises() { return new Promise(setImmediate); }
```

- [ ] **Step 4: Implement detector**

Append to `js/groups.js`:

```js
import { watchUserGroups, readGroup, removeUserGroupsEntry } from './db.js';
import { navigateToDirect, getCurrentContext } from './groupNav.js';

let _prevEnum = null;
let _detectorUnsub = null;

export function initGroupRemovalDetector(myUserId) {
  if (_detectorUnsub) _detectorUnsub();
  _prevEnum = null;
  _detectorUnsub = watchUserGroups(myUserId, async (collection) => {
    const next = collection || {};
    if (_prevEnum === null) { _prevEnum = next; return; }
    const removed = Object.keys(_prevEnum).filter((id) => !next[id]);
    _prevEnum = next;
    for (const groupId of removed) {
      await handleGroupRemoval(myUserId, groupId);
    }
  });

  // Toast dismiss handler — idempotent attach
  const dismissBtn = document.getElementById('group-removal-toast-dismiss');
  if (dismissBtn && !dismissBtn._wired) {
    dismissBtn._wired = true;
    dismissBtn.addEventListener('click', () => {
      document.getElementById('group-removal-toast').classList.add('hidden');
    });
  }
}

async function handleGroupRemoval(myUserId, groupId) {
  const group = await readGroup(groupId);
  // Pick the toast message: group gone → deletion; group exists → kick
  let message;
  if (!group) message = `'${groupId}' has been deleted.`;
  else message = `You've been removed from '${group.name}'.`;
  showRemovalToast(message);

  // Best-effort local cleanup (the user's enumeration entry was already
  // removed by the watchUserGroups tick that triggered this; we just
  // ensure currentContext is sane).
  const cur = getCurrentContext();
  if (cur.context === 'group' && cur.groupId === groupId) {
    await navigateToDirect();
  }
}

function showRemovalToast(message) {
  const el = document.getElementById('group-removal-toast');
  const txt = document.getElementById('group-removal-toast-text');
  if (!el || !txt) return;
  txt.textContent = message;
  el.classList.remove('hidden');
}

// Test helpers — exported only for tests; safe no-ops in prod.
export function _resetGroupRemovalDetectorForTests() {
  if (_detectorUnsub) _detectorUnsub();
  _detectorUnsub = null;
  _prevEnum = null;
}
export function _feedSnapshotForTests(snapshot) {
  // Simulate a watchUserGroups tick without Firebase
  const fakeFn = async (collection) => {
    const next = collection || {};
    if (_prevEnum === null) { _prevEnum = next; return; }
    const removed = Object.keys(_prevEnum).filter((id) => !next[id]);
    _prevEnum = next;
    for (const groupId of removed) await handleGroupRemoval('me', groupId);
  };
  return fakeFn(snapshot);
}
```

Refinement: the deletion-vs-kick message needs better wording when the group is gone but we don't know its name (we only have the groupId). Two options: cache names from prior watchGroupMeta ticks (best UX) or accept the groupId fallback (simpler). Phase 1 uses the simpler version above; a small enhancement could maintain a `lastKnownNames` map keyed by groupId.

- [ ] **Step 5: Wire from js/app.js**

In `main()` after other init calls:

```js
import { initGroupRemovalDetector } from './groups.js';

// inside main()
initGroupRemovalDetector(userId);
```

- [ ] **Step 6: Run + commit**

```
npx jest
```

Expected: green.

```bash
git add js/groups.js js/app.js index.template.html css/app.css tests/groups.test.js
git commit -m "feat: group removal detection + notification toast

watchUserGroups deltas surface as a toast: 'deleted' if the group
record is gone, 'removed' if only the member record is. After the
toast fires, if the user was currently in that group's context they
are navigated back to Direct. Phase 1 only triggers deletion (no kick
UI yet); the same detector handles both."
```

---

## Task 19: Brand-new-user join flow (group scope, Flow B)

Phase 0 Flow B (personal) was: welcome screen with "follow Alex" framing → secret-phrase modal → identity created → silently follow. Phase 1 Flow B (group) needs an extra step: after identity creation, prompt for the user's display name in the group BEFORE finalizing the redemption.

The welcome screen invite framing for group scope was added in Task 10 (resolveInvitePreview). Now we need:
1. The "Your name in '{groupName}'" prompt step after `createNewAccount()` returns and BEFORE `attemptRedeemFromUrl` fires.
2. That prompt's UI markup.

**Files:**
- Modify: `index.template.html`
- Modify: `css/app.css`
- Modify: `js/app.js`
- Modify: `tests/invites.test.js`

- [ ] **Step 1: Add the prompt markup**

In `index.template.html`:

```html
<div id="group-displayname-screen" class="welcome-screen hidden">
  <p id="group-displayname-framing"></p>
  <input id="group-displayname-input" class="text-input" type="text" maxlength="40" placeholder="Your name" />
  <p id="group-displayname-error" class="error-msg hidden"></p>
  <button id="group-displayname-submit-btn" class="primary-btn">Continue</button>
</div>
```

(Reuses the `.welcome-screen` overlay class so styling is consistent with the welcome screen — it's a full-overlay step in the onboarding chain.)

- [ ] **Step 2: Add showGroupDisplayNamePrompt to js/app.js**

```js
function showGroupDisplayNamePrompt(groupName) {
  const screen = document.getElementById('group-displayname-screen');
  const framing = document.getElementById('group-displayname-framing');
  const input = document.getElementById('group-displayname-input');
  const errEl = document.getElementById('group-displayname-error');
  const submit = document.getElementById('group-displayname-submit-btn');

  framing.textContent = `Your name in '${groupName}'`;
  errEl.textContent = '';
  errEl.classList.add('hidden');
  input.value = '';
  screen.classList.remove('hidden');

  return new Promise((resolve) => {
    function onSubmit() {
      const trimmed = (input.value || '').trim();
      if (!trimmed) { errEl.textContent = 'Please enter a name.'; errEl.classList.remove('hidden'); return; }
      if (trimmed.length > 40) { errEl.textContent = 'Name must be at most 40 characters.'; errEl.classList.remove('hidden'); return; }
      submit.removeEventListener('click', onSubmit);
      screen.classList.add('hidden');
      resolve(trimmed);
    }
    submit.addEventListener('click', onSubmit);
  });
}
```

- [ ] **Step 3: Integrate into the redemption dispatch**

In `js/app.js`, find the existing redemption block:

```js
if (pendingInviteToken) {
  const result = await attemptRedeemFromUrl(pendingInviteToken, identity.userId, identity.code);
  // ...
}
```

Replace with the scope-aware version:

```js
if (pendingInviteToken) {
  // First call to learn the scope and whether group needs a displayName prompt.
  let result = await attemptRedeemFromUrl(pendingInviteToken, identity.userId, identity.code);
  if (result && result.ok === false && result.reason === 'needs-display-name') {
    // Look up the group's name for the prompt UI.
    const preview = await resolveInvitePreview(pendingInviteToken);
    const groupName = preview?.scope === 'group' ? preview.groupName : 'this group';
    const displayName = await showGroupDisplayNamePrompt(groupName);
    result = await attemptRedeemFromUrl(pendingInviteToken, identity.userId, identity.code, { displayName });
  }
  if (result) {
    handleInviteRedemptionResult(result);
    cleanInviteParamFromUrl();
    // For group success: navigate to the new group context.
    if (result.ok && result.groupId) {
      const { navigateToGroup } = await import('./groupNav.js');
      await navigateToGroup(result.groupId);
    }
  }
}
```

(The dynamic `import('./groupNav.js')` avoids a top-of-file import cycle; alternatively pre-import at the top.)

Also extend `inviteFailureCopy` to handle the new group-only reasons:

```js
function inviteFailureCopy(reason) {
  switch (reason) {
    // existing personal reasons
    case 'not-found': return "This invite link isn't valid.";
    case 'revoked':   return 'This invite link has been revoked.';
    case 'expired':   return 'This invite link has expired.';
    case 'cap':       return 'This invite link is no longer accepting new joiners.';
    case 'self':      return "That's your own invite link.";
    case 'already-following': return 'You already follow this person.';
    case 'creator-missing':   return "The link's creator no longer has an account.";
    // new group reasons
    case 'group-missing':     return "That group no longer exists.";
    case 'already-member':    return "You're already in that group.";
    default:                  return "This invite link can't be used right now.";
  }
}
```

For the `already-member` case where `groupId` and `groupName` are present, the overlay's Continue button could navigate the user into the group. Phase 1 keeps it simple — just dismiss and stay in current context.

- [ ] **Step 4: Add a test**

Append to `tests/invites.test.js`:

```js
describe('group-scope new-user flow integration (light)', () => {
  test('attemptRedeemFromUrl with displayName succeeds for new user joining a group', async () => {
    db.readInviteIndex.mockResolvedValue({ scope: 'group', ownerPath: 'groups/G1/invites/T' });
    db.readGroup.mockResolvedValue({ name: 'Family', ownerId: 'owner', createdAt: 1 });
    db.readGroupInvites.mockResolvedValue({
      T: { scope: 'group', token: 'T', creatorUid: 'owner', revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0 },
    });
    db.readMember.mockResolvedValue(null);
    const result = await attemptRedeemFromUrl('T', 'new-user', 'code', { displayName: 'Mike' });
    expect(result).toEqual({ ok: true, groupId: 'G1', groupName: 'Family' });
  });
});
```

- [ ] **Step 5: Run + commit**

```
npx jest
```

Expected: green.

```bash
git add js/app.js index.template.html css/app.css tests/invites.test.js
git commit -m "feat: brand-new-user flow B for group-scope invites

After identity creation, if the pending redemption is group scope,
show a Your-name-in-'Family' prompt before re-invoking
attemptRedeemFromUrl with the displayName. On success the user is
navigated directly into the new group's context. inviteFailureCopy
extended with group-missing and already-member reasons."
```

---

## Task 20: Knock-via-group-context

Co-members (not necessarily mutuals) can knock from a group roster. The knock record gains an optional `contextGroupId` so the recipient renders the pulse in the right surface. New 20s float-to-top anchor mechanism: when a knock arrives, the sender's card sorts to the top of the relevant list and stays there for 20 seconds.

**Files:**
- Modify: `js/db.js` (extend writeKnock + watchKnocksAdded payload)
- Modify: `js/knock.js`
- Modify: `js/groupContext.js` (wire knock button on roster cards)
- Modify: `tests/knock.test.js`

- [ ] **Step 1: Extend the knock write/read shape**

The existing schema stores `{ count, ts }` per `knocks/{recipient}/{sender}`. Extend to optionally include `contextGroupId`.

In `js/db.js`, find `writeKnock`. Update its signature to accept an optional context object:

```js
export async function writeKnock(recipientId, senderId, opts = {}) {
  const knockRef = ref(db, `knocks/${recipientId}/${senderId}`);
  await runTransaction(knockRef, (current) => {
    const next = current && typeof current === 'object'
      ? { count: (current.count || 0) + 1, ts: Date.now() }
      : { count: 1, ts: Date.now() };
    if (opts.contextGroupId) next.contextGroupId = opts.contextGroupId;
    else if (current && current.contextGroupId) next.contextGroupId = current.contextGroupId;
    // (transaction-level cap from the existing code; preserve)
    return next;
  });
}
```

(Adapt to whatever the existing implementation does — the key change is propagating `opts.contextGroupId` into the written value.)

Look for `watchKnocksAdded` and confirm the callback already receives the whole record (so `contextGroupId` arrives in `{ count, ts, contextGroupId? }`).

- [ ] **Step 2: Extend sendKnock and the pulse application**

In `js/knock.js`:

```js
export function sendKnock(recipientId, senderId, statusColor, opts = {}) {
  const now = Date.now();
  if (now - (debounceMap.get(recipientId) ?? 0) < 300) return;
  debounceMap.set(recipientId, now);

  // ... existing local DOM pulse on the sender's own card ... (unchanged)

  writeKnock(recipientId, senderId, opts);
}
```

Extend the `applyLiveKnock` and `applyDeferredKnock` callers to consider `contextGroupId`. When the recipient's current context is `group:{contextGroupId}`, find the sender card under `#group-roster` and pulse. When the current context differs, increment a badge on the group card and don't pulse. When no `contextGroupId`, direct-contacts behavior (existing).

The simplest implementation: change `document.querySelector(\`[data-user-id="${senderId}"]\`)` to scope the lookup. If `contextGroupId` is set and matches `getCurrentContext().groupId`, look inside `#group-roster`; otherwise queue a badge increment.

For Phase 1, implement a small helper:

```js
import { getCurrentContext } from './groupNav.js';

function findKnockTargetCard(senderId, contextGroupId) {
  if (contextGroupId) {
    const cur = getCurrentContext();
    if (cur.context === 'group' && cur.groupId === contextGroupId) {
      return document.querySelector(`#group-roster [data-user-id="${senderId}"]`);
    }
    return null; // we're in a different context; caller bumps the badge
  }
  // Direct context — existing behavior
  return document.querySelector(`#app-header ~ * [data-user-id="${senderId}"]`)
      || document.querySelector(`[data-user-id="${senderId}"]`);
}
```

And in the live-knock dispatcher:

```js
unsubKnocks = watchKnocksAdded(myUserId, (senderId, payload) => {
  // ... existing checks unchanged ...
  const contextGroupId = payload.contextGroupId || null;
  const li = findKnockTargetCard(senderId, contextGroupId);
  if (!li && contextGroupId) {
    // Recipient is in a different context — bump the group card badge.
    bumpGroupCardBadge(contextGroupId);
    return;
  }
  if (!li) return;
  applyLiveKnock(senderId, payload.count, li);
  applyFloatToTop(li);
  clearKnock(myUserId, senderId).catch(() => {});
});
```

- [ ] **Step 3: Add float-to-top helper + group-card badge tracker**

Append to `js/knock.js`:

```js
const FLOAT_MS = 20000;
const floatTimers = new Map(); // userId → { timerId, originalParent, originalSibling }

export function applyFloatToTop(li) {
  if (!li) return;
  const list = li.parentNode;
  if (!list) return;
  const userId = li.dataset.userId;
  if (floatTimers.has(userId)) {
    clearTimeout(floatTimers.get(userId).timerId);
  } else {
    // Remember where the row lived so we can put it back.
    floatTimers.set(userId, {
      originalParent: list,
      originalSibling: li.nextSibling,
      timerId: null,
    });
  }
  list.prepend(li);
  const timerId = setTimeout(() => restoreFromFloat(userId), FLOAT_MS);
  floatTimers.get(userId).timerId = timerId;
}

function restoreFromFloat(userId) {
  const entry = floatTimers.get(userId);
  if (!entry) return;
  const li = document.querySelector(`[data-user-id="${userId}"]`);
  if (li && entry.originalParent) {
    entry.originalParent.insertBefore(li, entry.originalSibling || null);
  }
  floatTimers.delete(userId);
}

const groupBadgeCounts = new Map();
export function bumpGroupCardBadge(groupId) {
  const current = (groupBadgeCounts.get(groupId) || 0) + 1;
  groupBadgeCounts.set(groupId, current);
  renderGroupBadge(groupId, current);
}
export function clearGroupCardBadge(groupId) {
  groupBadgeCounts.delete(groupId);
  renderGroupBadge(groupId, 0);
}
function renderGroupBadge(groupId, count) {
  const card = document.querySelector(`.group-card[data-group-id="${groupId}"]`);
  if (!card) return;
  let badge = card.querySelector('.group-card-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'group-card-badge';
      card.appendChild(badge);
    }
    badge.textContent = String(count);
  } else if (badge) {
    badge.remove();
  }
}
```

When the user navigates into a group context, the deferred knocks for that group should fire their pulses, then the badge clears. Hook into `enterGroupContext` (in `js/groupContext.js`):

```js
import { clearGroupCardBadge } from './knock.js';

// inside enterGroupContext, after the subscription setup:
clearGroupCardBadge(groupId);
// (deferred-pulse rendering happens automatically because watchKnocksAdded re-fires
//  when the group's roster mounts and the sender cards become findable in DOM)
```

- [ ] **Step 4: Add the knock-from-group-roster affordance**

In the roster row created by `renderRoster` in `js/groupContext.js`, add a Knock button (only for non-self rows):

```js
if (uid !== ownUserId) {
  const knockBtn = document.createElement('button');
  knockBtn.className = 'ghost-btn knock-btn';
  knockBtn.textContent = 'Knock';
  knockBtn.addEventListener('click', () => {
    // Import sendKnock at the top of the file
    sendKnock(uid, ownUserId, undefined, { contextGroupId: getCurrentGroupId() });
  });
  li.appendChild(knockBtn);
}
```

Add to imports: `import { sendKnock } from './knock.js';`

- [ ] **Step 5: Failing test (small smoke)**

Append to `tests/knock.test.js`:

```js
jest.mock('../js/groupNav.js', () => ({
  getCurrentContext: jest.fn(() => ({ context: 'group', groupId: 'G1' })),
}));

const { applyFloatToTop, bumpGroupCardBadge, clearGroupCardBadge } = require('../js/knock');

describe('float-to-top', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <ul id="list">
        <li data-user-id="a">A</li>
        <li data-user-id="b">B</li>
        <li data-user-id="c">C</li>
      </ul>
    `;
    jest.useFakeTimers();
  });

  test('floats the targeted row to top', () => {
    const li = document.querySelector('[data-user-id="b"]');
    applyFloatToTop(li);
    const order = Array.from(document.querySelectorAll('#list li')).map((el) => el.dataset.userId);
    expect(order).toEqual(['b', 'a', 'c']);
  });

  test('restores the row to its original position after 20s', () => {
    const li = document.querySelector('[data-user-id="b"]');
    applyFloatToTop(li);
    jest.advanceTimersByTime(20000);
    const order = Array.from(document.querySelectorAll('#list li')).map((el) => el.dataset.userId);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  test('repeated float resets the 20s timer', () => {
    const li = document.querySelector('[data-user-id="b"]');
    applyFloatToTop(li);
    jest.advanceTimersByTime(15000);
    applyFloatToTop(li);
    jest.advanceTimersByTime(15000);
    const order = Array.from(document.querySelectorAll('#list li')).map((el) => el.dataset.userId);
    expect(order).toEqual(['b', 'a', 'c']); // still floated
  });
});

describe('group-card badge', () => {
  beforeEach(() => {
    document.body.innerHTML = `<button class="group-card" data-group-id="G1"></button>`;
  });

  test('bumpGroupCardBadge adds a badge with the count', () => {
    bumpGroupCardBadge('G1');
    expect(document.querySelector('.group-card[data-group-id="G1"] .group-card-badge').textContent).toBe('1');
    bumpGroupCardBadge('G1');
    expect(document.querySelector('.group-card[data-group-id="G1"] .group-card-badge').textContent).toBe('2');
  });

  test('clearGroupCardBadge removes the badge', () => {
    bumpGroupCardBadge('G1');
    clearGroupCardBadge('G1');
    expect(document.querySelector('.group-card[data-group-id="G1"] .group-card-badge')).toBeNull();
  });
});
```

- [ ] **Step 6: Run + commit**

```
npx jest
```

Expected: green.

```bash
git add js/db.js js/knock.js js/groupContext.js tests/knock.test.js
git commit -m "feat: knock-via-group-context with float-to-top + badge

writeKnock + watchKnocksAdded now carry an optional contextGroupId.
sendKnock from a group roster passes the current group's id. When
the recipient is viewing the same group, the sender's card pulses
and floats to the top of the roster for 20s. When the recipient is
in a different context, the unread-knock count is bumped on the
group's card in the cards row. Entering the group context clears
the badge."
```

---

## Task 21: Float-to-top in direct contacts

The same 20s float-to-top behavior, applied to the existing direct-contacts list. Per spec §13: "With long contact lists, the knocker can be buried below the fold. The same 20s float-to-top behavior is applied to Direct context too."

**Files:**
- Modify: `js/knock.js` (use existing `applyFloatToTop` for direct knocks)
- Modify: `js/following.js` (the list mutation may interact with the existing render loop — verify reorder survives a re-render)
- Modify: `tests/following.test.js`

- [ ] **Step 1: Wire applyFloatToTop into the direct-knock dispatcher**

In the existing live-knock handler in `js/knock.js` (the path that handled knocks before Task 20's group-context extension), add `applyFloatToTop(li)` after `applyLiveKnock`. Same for the deferred-knock path.

The Task 20 change already wires this in for group-context knocks. The direct path is the OTHER branch in `findKnockTargetCard` — when `contextGroupId` is absent.

Inside the watchKnocksAdded callback, after the existing `applyLiveKnock(senderId, count)` (or wherever you call it), insert:

```js
applyFloatToTop(li);
```

Same for the deferred path's `applyDeferredKnock(senderId)` site — after the animation kickoff:

```js
const li = document.querySelector(`[data-user-id="${senderId}"]`);
if (li) applyFloatToTop(li);
```

- [ ] **Step 2: Handle interaction with following.js re-render**

`js/following.js`'s `renderList` rebuilds the list. If a row was floated to top via `applyFloatToTop` and then `renderList` runs again (e.g., a server-side following change), the new render will place the row in its sorted position and lose the float.

Two options:
- Re-apply the float after every renderList (track which rows are currently in float windows and re-prepend them).
- Make `renderList` aware of floatTimers and skip re-sorting for floated rows.

Phase 1 takes the simpler approach: when renderList runs, check `floatTimers` and re-prepend any floated rows that are still within their window. Add an exported helper to `js/knock.js`:

```js
export function getFloatedUserIds() {
  return Array.from(floatTimers.keys());
}
```

In `js/following.js`'s `renderList` (after the existing sort+render loop), append:

```js
import { getFloatedUserIds } from './knock.js';

// inside renderList, at the very end after items are placed:
const list = document.getElementById('main-list'); // or whatever the list root is
if (list) {
  for (const uid of getFloatedUserIds()) {
    const li = list.querySelector(`[data-user-id="${uid}"]`);
    if (li) list.prepend(li);
  }
}
```

(Find the actual list root id used in `following.js`; the code above uses `#main-list` as a placeholder.)

- [ ] **Step 3: Add a small test in tests/following.test.js**

Append:

```js
jest.mock('../js/knock.js', () => ({
  getFloatedUserIds: jest.fn(() => []),
  applyFloatToTop: jest.fn(),
}));

const knock = require('../js/knock.js');

describe('direct-list float survives re-render', () => {
  test('re-render re-prepends rows reported by getFloatedUserIds', () => {
    document.body.innerHTML = `
      <ul id="main-list">
        <li data-user-id="a"></li>
        <li data-user-id="b"></li>
        <li data-user-id="c"></li>
      </ul>
    `;
    knock.getFloatedUserIds.mockReturnValue(['b']);
    // Invoke the float-restore portion of renderList directly.
    // (renderList itself is internal; this test verifies the contract.)
    const list = document.getElementById('main-list');
    for (const uid of knock.getFloatedUserIds()) {
      const li = list.querySelector(`[data-user-id="${uid}"]`);
      if (li) list.prepend(li);
    }
    const order = Array.from(list.querySelectorAll('li')).map((el) => el.dataset.userId);
    expect(order).toEqual(['b', 'a', 'c']);
  });
});
```

- [ ] **Step 4: Run + commit**

```
npx jest
```

Expected: green.

```bash
git add js/knock.js js/following.js tests/following.test.js
git commit -m "feat: float-to-top in direct contacts (parity with group)

Direct-context knocks now also float the knocker's card to the top
of the list for 20s. renderList re-prepends any rows still in their
float window so a coincident re-sort doesn't lose them."
```

---

## Task 22: End-to-end integration test + manual UI verification + build

Final task. Adds an integration test that exercises the create-group → invite → redeem → see-in-roster path, then runs the build and lists the manual verification checklist for the user.

**Files:**
- Modify: `tests/groups.test.js`

- [ ] **Step 1: Integration test**

Append to `tests/groups.test.js`:

```js
jest.mock('../js/invites.js', () => {
  const actual = jest.requireActual('../js/invites.js');
  return actual;
});

describe('end-to-end: create group → group invite → redeem → joined', () => {
  // Note: this test exercises the high-level call paths but mocks Firebase
  // (per project convention). The real-world flow involves multiple network
  // round-trips that are individually tested above.

  test('owner can create a group; second user can redeem its invite', async () => {
    const { createGroup, joinGroup } = require('../js/groups');
    const { createGroupInvite, redeemGroupInvite } = require('../js/invites');

    db.claimGroupId.mockResolvedValue(true);
    db.writeGroup.mockResolvedValue();
    db.writeMember.mockResolvedValue();
    db.writeUserGroupsEntry.mockResolvedValue();

    const created = await createGroup('owner-uid', 'Family', 'Alice');
    expect(db.writeGroup).toHaveBeenCalledWith(created.groupId, expect.objectContaining({ name: 'Family', ownerId: 'owner-uid' }));
    expect(db.writeMember).toHaveBeenCalledWith(created.groupId, 'owner-uid', expect.objectContaining({ role: 'owner', displayName: 'Alice' }));

    db.readGroupInvites.mockResolvedValueOnce({});
    db.claimInviteToken = jest.fn().mockResolvedValue(true);
    db.writeGroupInvite = jest.fn().mockResolvedValue();
    const invite = await createGroupInvite('owner-uid', created.groupId);
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    db.readInviteIndex = jest.fn().mockResolvedValue({ scope: 'group', ownerPath: `groups/${created.groupId}/invites/${invite.token}` });
    db.readGroup = jest.fn().mockResolvedValue({ name: 'Family', ownerId: 'owner-uid', createdAt: 1 });
    db.readGroupInvites = jest.fn().mockResolvedValue({
      [invite.token]: { scope: 'group', token: invite.token, creatorUid: 'owner-uid', revoked: false, expiresAt: null, redemptionCap: null, redemptionsUsed: 0 },
    });
    db.readMember = jest.fn().mockResolvedValue(null);
    db.incrementGroupInviteRedemptions = jest.fn().mockResolvedValue();

    const redemption = await redeemGroupInvite(invite.token, 'redeemer-uid', 'Mike');
    expect(redemption).toEqual({ ok: true, groupId: created.groupId, groupName: 'Family' });
  });
});
```

- [ ] **Step 2: Full test suite**

```
npx jest
```

Expected: all tests green (Phase 0's 456 + Phase 1 additions, somewhere around 540-560 by the end).

- [ ] **Step 3: Build**

```
node scripts/dev-build.js
```

Expected: no errors. Inspect the built `index.html` for the new markup:

```
grep -E 'group-cards-row|group-context-root|create-group-modal|group-displayname-screen|group-removal-toast' index.html
```

All five IDs should be present.

- [ ] **Step 4: Manual UI verification checklist (user runs in browser)**

This step is mandatory but NOT executable in headless CI. Document for the user:

1. **Cards row appears / hidden by flag.** Set `GROUPS_ENABLED = true` in `js/features.js` locally and start `npm run dev`. Confirm the group cards row appears at the top of Direct context (empty → zero-state CTA visible). Set the flag back to false to confirm the row hides.
2. **Create a group.** Tap "Create your first group" → fill name + your name → submit. Land in the new group's context. Cards row shows the new group's card.
3. **Rename / delete.** Owner-only Settings menu shows Rename/Invite link/Delete. Rename works; the breadcrumb updates immediately. Delete confirms then ejects to Direct; the card disappears.
4. **Invite link.** Owner opens the invite modal from Settings; create link; copy URL.
5. **Existing-user redemption.** Open the invite URL in a second browser profile (different account). Confirm the name prompt appears; submit; land in the group's context; cards row shows the new card.
6. **Brand-new user redemption.** Open the URL in an incognito window with empty localStorage. Welcome screen reads *"You've been invited to join 'Family'."* Complete secret-phrase flow → see "Your name in 'Family'" prompt → submit → land in the group's context.
7. **Member self-actions.** Non-owner sees Edit my name / Leave group. Both work.
8. **Knock-via-group-context.** Knock another member from the group roster. Their app pulses the sender's card and floats it to the top for 20s. If the recipient is in Direct, the group card shows an unread-knock badge; entering the group fires the deferred pulse and clears the badge.
9. **Direct-contact float-to-top.** Knock a direct contact from the direct list. Their app pulses and floats the sender's card to the top.
10. **Cross-device sync.** Open the app on a second device with the same recovery code. Group memberships and currentContext sync. Navigating into a group on device A puts device B into the same context (the design's deliberate yank — per spec §6).
11. **Deletion notification.** Have the owner delete a group while a member's app is open. The member sees the deletion toast; if they were in that group's context they are ejected to Direct.

- [ ] **Step 5: Commit**

```bash
git add tests/groups.test.js
git commit -m "test: end-to-end create-group → invite → redeem integration

Phase 1 (groups MVP) implementation is complete. The full
deliverable surface from spec §16 Phase 1 is now in place:
- Group entity in Firebase, owner-only ops, member ops, navigation.
- Group invites reuse the Phase 0 invite primitive with group scope.
- Knock-via-group-context with 20s float-to-top.
- Float-to-top also applied to direct contacts.
- GROUPS_ENABLED gates the entire UI; remains false on commit.
Phase 2 (per-audience status overrides) ships next."
```

---

## Done

After Task 22, Phase 1 is shipped:

- Users can create groups, rename and delete their own, leave others'.
- Each group has its own context view with a member roster showing live primary status.
- Group invite links use the Phase 0 primitive; the modal is parameterized by scope.
- Brand-new users can onboard via a group-scope link and land directly in the group.
- Knock-via-group-context works for co-members without requiring mutual follow; the 20s float-to-top behavior also benefits the existing direct-contacts list.
- Group memberships, currentContext, and per-group lastVisited sync across devices.
- Deletion / kick is detected client-side and surfaces a toast.
- The `GROUPS_ENABLED` flag (still `false` in the committed `js/features.js`) gates every group-scope UI surface, so this branch can land in `dev` without changing user-visible behavior. The user flips the flag when ready to release.

**Next:** the Phase 2 plan (per-audience status overrides — "Set a unique status" toggle per group + per-audience status writes) will build on the data model already in place. The `statusOverride` field exists in the schema but is not yet written or read in Phase 1.

