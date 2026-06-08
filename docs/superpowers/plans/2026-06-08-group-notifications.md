# Group-context notifications (knock + availability) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make group-context knock notifications read "{name in group} knocked in {group}", and notify group co-members when a member becomes available in a group (effective in-group status).

**Architecture:** Entirely in the Cloud Functions package (`functions/`). Pure decision logic in `presence-core.js`, dependency-injected handlers in `notifier.js`, RTDB triggers in `index.js`. Group availability uses two triggers: a new `onMemberOverride` (override path) and the existing `onAvailability` extended (primary path, for override-off members). No client or service-worker changes.

**Tech Stack:** Node 22 ESM, firebase-admin, firebase-functions v2, Jest (`node --experimental-vm-modules`). Tests use injected `deps` (`now/getVal/update/send`) — no real Firebase.

**Spec:** `docs/superpowers/specs/2026-06-08-group-notifications-design.md`

**Working directory for all test commands:** `functions/` (run `cd functions` first; `npm test -- -t "<name>"` runs a single test by name).

**Branch:** `group-notifications` (already checked out). Commit after each task.

---

### Task 1: Effective-availability pure helpers

**Files:**
- Modify: `functions/presence-core.js`
- Test: `functions/test/presence-core.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `functions/test/presence-core.test.js` (and add the two names to the existing import from `'../presence-core.js'` at the top: `overrideAvailable, effectiveAvailable`):

```js
describe('overrideAvailable', () => {
  const NOW2 = 1000;
  test('true only when enabled + status available + future availableUntil', () => {
    expect(overrideAvailable({ enabled: true, status: 'available', availableUntil: 2000 }, NOW2)).toBe(true);
    expect(overrideAvailable({ enabled: true, status: 'available', availableUntil: 500 }, NOW2)).toBe(false); // expired
    expect(overrideAvailable({ enabled: true, status: 'unavailable', availableUntil: 2000 }, NOW2)).toBe(false);
    expect(overrideAvailable({ enabled: false, status: 'available', availableUntil: 2000 }, NOW2)).toBe(false);
    expect(overrideAvailable(null, NOW2)).toBe(false);
    expect(overrideAvailable(undefined, NOW2)).toBe(false);
  });
});

describe('effectiveAvailable', () => {
  const NOW2 = 1000;
  test('uses the override when enabled', () => {
    expect(effectiveAvailable({ enabled: true, status: 'available', availableUntil: 2000 }, 'unavailable', null, NOW2)).toBe(true);
    expect(effectiveAvailable({ enabled: true, status: 'unavailable', availableUntil: null }, 'available', 2000, NOW2)).toBe(false);
  });
  test('falls back to primary when override absent or disabled', () => {
    expect(effectiveAvailable(null, 'available', 2000, NOW2)).toBe(true);
    expect(effectiveAvailable({ enabled: false }, 'available', 2000, NOW2)).toBe(true);
    expect(effectiveAvailable({ enabled: false }, 'available', 500, NOW2)).toBe(false); // primary expired
    expect(effectiveAvailable(undefined, 'unavailable', 2000, NOW2)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd functions && npm test -- -t "overrideAvailable"`
Expected: FAIL — `overrideAvailable is not a function` (or import is `undefined`).

- [ ] **Step 3: Implement the helpers**

In `functions/presence-core.js`, after the existing `wantsAvailability` line, add:

```js
// Is the group override itself an "available" signal right now?
export function overrideAvailable(override, now) {
  return !!(override && override.enabled === true
    && override.status === 'available' && isFutureMs(override.availableUntil, now));
}

// A member's EFFECTIVE in-group availability: their override when enabled,
// otherwise their primary status. Mirrors what the group roster shows.
export function effectiveAvailable(override, primaryStatus, primaryAU, now) {
  if (override && override.enabled === true) return overrideAvailable(override, now);
  return primaryStatus === 'available' && isFutureMs(primaryAU, now);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd functions && npm test -- -t "overrideAvailable|effectiveAvailable"`
Expected: PASS (both describes green).

- [ ] **Step 5: Commit**

```bash
git add functions/presence-core.js functions/test/presence-core.test.js
git commit -m "feat(functions): overrideAvailable + effectiveAvailable presence helpers"
```

---

### Task 2: Group-aware message titles

**Files:**
- Modify: `functions/presence-core.js`
- Test: `functions/test/presence-core.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `functions/test/presence-core.test.js` (`buildMessage` is already imported):

```js
describe('buildMessage group titles', () => {
  test('no group → existing titles unchanged', () => {
    expect(buildMessage('knock', 'Bea')).toEqual({ title: 'Bea knocked', body: '' });
    expect(buildMessage('availability', 'Bea')).toEqual({ title: 'Bea is available', body: '' });
  });
  test('with group → "... in {group}"', () => {
    expect(buildMessage('knock', 'Bea', { group: 'Divers' })).toEqual({ title: 'Bea knocked in Divers', body: '' });
    expect(buildMessage('availability', 'Bea', { group: 'Divers' })).toEqual({ title: 'Bea is available in Divers', body: '' });
  });
  test('falsy group → no suffix', () => {
    expect(buildMessage('knock', 'Bea', { group: undefined })).toEqual({ title: 'Bea knocked', body: '' });
    expect(buildMessage('availability', 'Bea', { group: null })).toEqual({ title: 'Bea is available', body: '' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm test -- -t "buildMessage group titles"`
Expected: FAIL — `buildMessage('knock', 'Bea', { group: 'Divers' })` returns `{ title: 'Bea knocked', body: '' }` (third arg ignored).

- [ ] **Step 3: Implement group titles**

In `functions/presence-core.js`, replace the existing `TITLES` const and `buildMessage` function with:

```js
const TITLES = {
  knock: (name) => `${name} knocked`,
  call: (name) => `${name} is calling`,
  availability: (name) => `${name} is available`,
};

const GROUP_TITLES = {
  knock: (name, group) => `${name} knocked in ${group}`,
  call: (name, group) => `${name} is calling in ${group}`,
  availability: (name, group) => `${name} is available in ${group}`,
};

export function buildMessage(type, name, opts = {}) {
  const title = opts.group ? GROUP_TITLES[type](name, opts.group) : TITLES[type](name);
  return { title, body: '' };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm test -- -t "buildMessage"`
Expected: PASS (new group titles + any existing buildMessage tests).

- [ ] **Step 5: Commit**

```bash
git add functions/presence-core.js functions/test/presence-core.test.js
git commit -m "feat(functions): group-aware buildMessage titles"
```

---

### Task 3: resolveGroupMemberName

**Files:**
- Modify: `functions/notifier.js`
- Test: `functions/test/notifier.test.js`

- [ ] **Step 1: Write the failing test**

In `functions/test/notifier.test.js`, add `resolveGroupMemberName` to the import on line 2, then append:

```js
describe('resolveGroupMemberName', () => {
  test('prefers the group member displayName, then user code, then "Someone"', async () => {
    const deps1 = makeDeps({ store: { 'groups/g1/members/u/displayName': 'Bobby' } });
    expect(await resolveGroupMemberName(deps1, 'g1', 'u')).toBe('Bobby');

    const deps2 = makeDeps({ store: { 'users/u/code': 'ABC123' } });
    expect(await resolveGroupMemberName(deps2, 'g1', 'u')).toBe('ABC123');

    const deps3 = makeDeps({ store: {} });
    expect(await resolveGroupMemberName(deps3, 'g1', 'u')).toBe('Someone');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm test -- -t "resolveGroupMemberName"`
Expected: FAIL — `resolveGroupMemberName is not a function`.

- [ ] **Step 3: Implement it**

In `functions/notifier.js`, after the existing `resolveName` function, add:

```js
export async function resolveGroupMemberName(deps, groupId, uid) {
  const displayName = await deps.getVal(`groups/${groupId}/members/${uid}/displayName`);
  if (displayName) return displayName;
  const code = await deps.getVal(`users/${uid}/code`);
  if (code) return code;
  return 'Someone';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm test -- -t "resolveGroupMemberName"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/notifier.js functions/test/notifier.test.js
git commit -m "feat(functions): resolveGroupMemberName for group-scoped naming"
```

---

### Task 4: Group-aware handleKnock

**Files:**
- Modify: `functions/notifier.js`
- Test: `functions/test/notifier.test.js`

- [ ] **Step 1: Update the existing knock test + add a group knock test**

In `functions/test/notifier.test.js`, replace the **entire** existing `describe('handleKnock', ...)` block (the test named `'sends when recipient opted in for that sender'` plus the `'does nothing when not opted in'` test) with:

```js
describe('handleKnock', () => {
  test('Direct knock: uses the Direct name, no group suffix, no contextGroupId', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/rcpt/notify/sndr': { knock: true },
      'userPrefs/rcpt/following/sndr': { label: 'Bea' },
      'userPrefs/rcpt/pushTokens': { tokA: {} },
    }});
    await handleKnock(deps, 'rcpt', 'sndr', { count: 1, ts: 1 });
    expect(deps.send).toHaveBeenCalledWith(['tokA'],
      { title: 'Bea knocked', body: '' },
      { type: 'knock', targetUid: 'sndr' });
  });
  test('group knock: uses the group member displayName and names the group', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/rcpt/notify/sndr': { knock: true },
      'groups/g1/members/sndr/displayName': 'Bobby',
      'groups/g1/name': 'Divers',
      'userPrefs/rcpt/pushTokens': { tokA: {} },
    }});
    await handleKnock(deps, 'rcpt', 'sndr', { count: 1, ts: 1, contextGroupId: 'g1' });
    expect(deps.send).toHaveBeenCalledWith(['tokA'],
      { title: 'Bobby knocked in Divers', body: '' },
      { type: 'knock', targetUid: 'sndr', contextGroupId: 'g1' });
  });
  test('group knock with missing group name → no suffix, still group-scoped name', async () => {
    const deps = makeDeps({ store: {
      'userPrefs/rcpt/notify/sndr': { knock: true },
      'groups/g1/members/sndr/displayName': 'Bobby',
      'userPrefs/rcpt/pushTokens': { tokA: {} },
    }});
    await handleKnock(deps, 'rcpt', 'sndr', { count: 1, ts: 1, contextGroupId: 'g1' });
    expect(deps.send).toHaveBeenCalledWith(['tokA'],
      { title: 'Bobby knocked', body: '' },
      { type: 'knock', targetUid: 'sndr', contextGroupId: 'g1' });
  });
  test('does nothing when not opted in', async () => {
    const deps = makeDeps({ store: { 'userPrefs/rcpt/notify/sndr': { knock: false } } });
    await handleKnock(deps, 'rcpt', 'sndr', { count: 1, ts: 1 });
    expect(deps.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify the group tests fail**

Run: `cd functions && npm test -- -t "group knock"`
Expected: FAIL — title is `'Bea knocked'`/wrong because `handleKnock` still uses the Direct name and `buildMessage` without a group.

- [ ] **Step 3: Implement group-aware handleKnock**

In `functions/notifier.js`, replace the existing `handleKnock` function with:

```js
export async function handleKnock(deps, recipientId, senderId, record) {
  const prefs = await deps.getVal(`userPrefs/${recipientId}/notify/${senderId}`);
  if (!wantsKnock(prefs)) return;
  const groupId = record && record.contextGroupId;
  if (groupId) {
    const name = await resolveGroupMemberName(deps, groupId, senderId);
    const group = await deps.getVal(`groups/${groupId}/name`);
    await sendToUser(deps, recipientId,
      buildMessage('knock', name, { group: group || undefined }),
      { type: 'knock', targetUid: senderId, contextGroupId: groupId });
    return;
  }
  const name = await resolveName(deps, recipientId, senderId);
  await sendToUser(deps, recipientId, buildMessage('knock', name),
    { type: 'knock', targetUid: senderId });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm test -- -t "handleKnock"`
Expected: PASS (all four knock tests).

- [ ] **Step 5: Commit**

```bash
git add functions/notifier.js functions/test/notifier.test.js
git commit -m "feat(functions): group knocks name the sender in-group and the group"
```

---

### Task 5: notifyGroupAvailability fan-out

**Files:**
- Modify: `functions/notifier.js`
- Test: `functions/test/notifier.test.js`

- [ ] **Step 1: Write the failing tests**

In `functions/test/notifier.test.js`, add `notifyGroupAvailability` to the import on line 2, then append (`FUTURE` is already defined in the file; `now` is 1000):

```js
describe('notifyGroupAvailability', () => {
  function groupStore(extra = {}) {
    return {
      'groups/g1/name': 'Divers',
      'groups/g1/members/m/displayName': 'Bobby',
      'groups/g1/members': { m: {}, co1: {}, co2: {} },
      'userPrefs/co1/notify/m': { availability: true },
      'userPrefs/co2/notify/m': { availability: false },
      'userPrefs/co1/pushTokens': { tokCo1: {} },
      'notifierState/groupAvailability/g1/m': null,
      ...extra,
    };
  }
  test('notifies opted-in co-members (not the member, not opted-out), stamps cooldown', async () => {
    const deps = makeDeps({ store: groupStore() });
    await notifyGroupAvailability(deps, 'g1', 'm', 1000);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledWith(['tokCo1'],
      { title: 'Bobby is available in Divers', body: '' },
      { type: 'availability', targetUid: 'm', contextGroupId: 'g1' });
    expect(deps.update).toHaveBeenCalledWith('notifierState/groupAvailability/g1', { m: 1000 });
  });
  test('within cooldown → no send', async () => {
    const deps = makeDeps({ store: groupStore({ 'notifierState/groupAvailability/g1/m': 999 }) });
    await notifyGroupAvailability(deps, 'g1', 'm', 1000);
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('nothing delivered (no tokens) → does not stamp cooldown', async () => {
    const deps = makeDeps({ store: groupStore({ 'userPrefs/co1/pushTokens': null }) });
    await notifyGroupAvailability(deps, 'g1', 'm', 1000);
    expect(deps.update).not.toHaveBeenCalledWith('notifierState/groupAvailability/g1', expect.anything());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm test -- -t "notifyGroupAvailability"`
Expected: FAIL — `notifyGroupAvailability is not a function`.

- [ ] **Step 3: Implement the fan-out**

In `functions/notifier.js`, add, after `resolveGroupMemberName` (no import change needed — `withinCooldown`, `wantsAvailability`, and `buildMessage` are already imported from `'./presence-core.js'`):

```js
// Notify the OTHER members of a group that `memberUid` is available in it.
// Caller decides the "became available" transition; this just fans out with a
// per-(group, member) cooldown so availability in one group doesn't mute another.
export async function notifyGroupAvailability(deps, groupId, memberUid, now) {
  const lastTs = await deps.getVal(`notifierState/groupAvailability/${groupId}/${memberUid}`);
  if (withinCooldown(lastTs, now, AVAIL_COOLDOWN_MS)) return;
  const name = await resolveGroupMemberName(deps, groupId, memberUid);
  const group = await deps.getVal(`groups/${groupId}/name`);
  const members = await deps.getVal(`groups/${groupId}/members`);
  const memberIds = members ? Object.keys(members) : [];
  let delivered = 0;
  for (const coUid of memberIds) {
    if (coUid === memberUid) continue;
    const prefs = await deps.getVal(`userPrefs/${coUid}/notify/${memberUid}`);
    if (!wantsAvailability(prefs)) continue;
    try {
      if (await sendToUser(deps, coUid,
        buildMessage('availability', name, { group: group || undefined }),
        { type: 'availability', targetUid: memberUid, contextGroupId: groupId })) {
        delivered++;
      }
    } catch { /* one co-member's send failed — keep notifying the rest */ }
  }
  if (delivered > 0) await deps.update(`notifierState/groupAvailability/${groupId}`, { [memberUid]: now });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm test -- -t "notifyGroupAvailability"`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add functions/notifier.js functions/test/notifier.test.js
git commit -m "feat(functions): notifyGroupAvailability fan-out to opted-in co-members"
```

---

### Task 6: handleGroupOverrideChange (override path)

**Files:**
- Modify: `functions/notifier.js`
- Test: `functions/test/notifier.test.js`

- [ ] **Step 1: Write the failing tests**

In `functions/test/notifier.test.js`, add `handleGroupOverrideChange` to the import on line 2, then append:

```js
describe('handleGroupOverrideChange', () => {
  const AVAIL = { enabled: true, status: 'available', availableUntil: FUTURE };
  const UNAVAIL = { enabled: true, status: 'unavailable', availableUntil: null };
  function store(extra = {}) {
    return {
      'groups/g1/name': 'Divers',
      'groups/g1/members/m/displayName': 'Bobby',
      'groups/g1/members': { m: {}, co1: {} },
      'userPrefs/co1/notify/m': { availability: true },
      'userPrefs/co1/pushTokens': { tokCo1: {} },
      'notifierState/groupAvailability/g1/m': null,
      ...extra,
    };
  }
  test('override flips unavailable→available → notifies', async () => {
    const deps = makeDeps({ store: store() });
    await handleGroupOverrideChange(deps, 'g1', 'm', UNAVAIL, AVAIL);
    expect(deps.send).toHaveBeenCalledWith(['tokCo1'],
      { title: 'Bobby is available in Divers', body: '' },
      { type: 'availability', targetUid: 'm', contextGroupId: 'g1' });
  });
  test('appearance-only change (still available) → no send', async () => {
    const deps = makeDeps({ store: store() });
    await handleGroupOverrideChange(deps, 'g1', 'm',
      { ...AVAIL, statusColor: '#111' }, { ...AVAIL, statusColor: '#222' });
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('before == null (member just joined) → no send', async () => {
    const deps = makeDeps({ store: store() });
    await handleGroupOverrideChange(deps, 'g1', 'm', null, AVAIL);
    expect(deps.send).not.toHaveBeenCalled();
  });
  test('override turned OFF but primary is available → effective on → notifies', async () => {
    const deps = makeDeps({ store: store({
      'users/m/status': 'available',
      'users/m/availableUntil': FUTURE,
    }) });
    await handleGroupOverrideChange(deps, 'g1', 'm', UNAVAIL, { enabled: false });
    expect(deps.send).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm test -- -t "handleGroupOverrideChange"`
Expected: FAIL — `handleGroupOverrideChange is not a function`.

- [ ] **Step 3: Implement the handler**

In `functions/notifier.js`, add `effectiveAvailable` to the import from `'./presence-core.js'` at the top (the line currently imports `wantsKnock, wantsCall, wantsAvailability, availabilityTurnedOn, withinCooldown, buildMessage` — append `, effectiveAvailable`). Then add after `notifyGroupAvailability`:

```js
// Triggered on a write to groups/{g}/members/{uid}/statusOverride. Notifies when
// the member's EFFECTIVE in-group availability flips off→on. `before == null`
// means the member just joined (first override write) — not a "became available"
// event, so we skip it to avoid a blast on every new member.
export async function handleGroupOverrideChange(deps, groupId, memberUid, before, after) {
  if (before == null) return;
  const now = deps.now();
  const status = await deps.getVal(`users/${memberUid}/status`);
  const primaryAU = await deps.getVal(`users/${memberUid}/availableUntil`);
  const wasOn = effectiveAvailable(before, status, primaryAU, now);
  const isOn = effectiveAvailable(after, status, primaryAU, now);
  if (isOn && !wasOn) await notifyGroupAvailability(deps, groupId, memberUid, now);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd functions && npm test -- -t "handleGroupOverrideChange"`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add functions/notifier.js functions/test/notifier.test.js
git commit -m "feat(functions): handleGroupOverrideChange notifies on effective off→on"
```

---

### Task 7: Extend handleAvailability with the primary path for groups

**Files:**
- Modify: `functions/notifier.js`
- Test: `functions/test/notifier.test.js`

- [ ] **Step 1: Write the failing tests**

In `functions/test/notifier.test.js`, append (inside the existing top-level scope; `FUTURE` and `makeDeps` are in scope):

```js
describe('handleAvailability → group co-members (primary path)', () => {
  test('notifies co-members of override-OFF groups, skips override-ON groups', async () => {
    const deps = makeDeps({ store: {
      'users/star/status': 'available',
      'users/star/availableUntil': FUTURE,
      'users/star/followers': null,
      'users/star/groups': { gOff: true, gOn: true },
      // gOff: override disabled → group shows primary → notify
      'groups/gOff/members/star/statusOverride': { enabled: false },
      'groups/gOff/name': 'OffGroup',
      'groups/gOff/members/star/displayName': 'Star',
      'groups/gOff/members': { star: {}, a: {} },
      'userPrefs/a/notify/star': { availability: true },
      'userPrefs/a/pushTokens': { tokA: {} },
      'notifierState/groupAvailability/gOff/star': null,
      // gOn: override enabled → handled by onMemberOverride, not the primary path
      'groups/gOn/members/star/statusOverride': { enabled: true, status: 'available', availableUntil: FUTURE },
      'groups/gOn/members': { star: {}, b: {} },
      'userPrefs/b/notify/star': { availability: true },
      'userPrefs/b/pushTokens': { tokB: {} },
      'notifierState/availability/star': null,
    }});
    await handleAvailability(deps, 'star', null, FUTURE);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledWith(['tokA'],
      { title: 'Star is available in OffGroup', body: '' },
      { type: 'availability', targetUid: 'star', contextGroupId: 'gOff' });
  });
  test('group fan-out runs even when the Direct cooldown is active', async () => {
    const deps = makeDeps({ store: {
      'users/star/status': 'available',
      'users/star/availableUntil': FUTURE,
      'users/star/groups': { gOff: true },
      'groups/gOff/members/star/statusOverride': null, // absent → treated as off
      'groups/gOff/name': 'OffGroup',
      'groups/gOff/members/star/displayName': 'Star',
      'groups/gOff/members': { star: {}, a: {} },
      'userPrefs/a/notify/star': { availability: true },
      'userPrefs/a/pushTokens': { tokA: {} },
      'notifierState/availability/star': 999, // Direct within cooldown (now=1000)
      'notifierState/groupAvailability/gOff/star': null,
    }});
    await handleAvailability(deps, 'star', null, FUTURE);
    expect(deps.send).toHaveBeenCalledTimes(1); // group send, despite Direct cooldown
    expect(deps.send).toHaveBeenCalledWith(['tokA'],
      { title: 'Star is available in OffGroup', body: '' },
      { type: 'availability', targetUid: 'star', contextGroupId: 'gOff' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd functions && npm test -- -t "handleAvailability → group co-members"`
Expected: FAIL — only the Direct path runs; no group sends.

- [ ] **Step 3: Implement the extension**

In `functions/notifier.js`, replace the existing `handleAvailability` function with this restructured version (Direct cooldown now gates only the Direct fan-out, so the group path always runs):

```js
// Triggered on a write to users/{uid}/availableUntil (before/after are that value).
export async function handleAvailability(deps, uid, beforeAU, afterAU) {
  const now = deps.now();
  const status = await deps.getVal(`users/${uid}/status`);
  if (!availabilityTurnedOn(beforeAU, afterAU, status, now)) return;

  // Direct followers — own per-uid cooldown.
  const lastTs = await deps.getVal(`notifierState/availability/${uid}`);
  if (!withinCooldown(lastTs, now, AVAIL_COOLDOWN_MS)) {
    const followers = await deps.getVal(`users/${uid}/followers`);
    const followerIds = followers ? Object.keys(followers) : [];
    let delivered = 0;
    for (const fid of followerIds) {
      const prefs = await deps.getVal(`userPrefs/${fid}/notify/${uid}`);
      if (!wantsAvailability(prefs)) continue;
      const name = await resolveName(deps, fid, uid);
      try {
        if (await sendToUser(deps, fid, buildMessage('availability', name), { type: 'availability', targetUid: uid })) {
          delivered++;
        }
      } catch { /* this follower's send failed — keep notifying the rest */ }
    }
    if (delivered > 0) await deps.update('notifierState/availability', { [uid]: now });
  }

  // Group co-members — only for groups where this member's override is OFF, so the
  // group is showing their primary. Override-ON groups are driven by onMemberOverride.
  const groups = await deps.getVal(`users/${uid}/groups`);
  const groupIds = groups ? Object.keys(groups) : [];
  for (const groupId of groupIds) {
    const override = await deps.getVal(`groups/${groupId}/members/${uid}/statusOverride`);
    if (override && override.enabled === true) continue;
    await notifyGroupAvailability(deps, groupId, uid, now);
  }
}
```

- [ ] **Step 4: Run to verify the new + existing availability tests pass**

Run: `cd functions && npm test -- -t "handleAvailability"`
Expected: PASS — both the new "group co-members" tests and all five existing `handleAvailability (narrowed...)` tests (those have no `users/star/groups` entry, so the group loop is a no-op for them).

- [ ] **Step 5: Commit**

```bash
git add functions/notifier.js functions/test/notifier.test.js
git commit -m "feat(functions): primary availability also notifies override-off group co-members"
```

---

### Task 8: Wire the onMemberOverride trigger

**Files:**
- Modify: `functions/index.js`

- [ ] **Step 1: Add the trigger**

In `functions/index.js`, change the import on line 7 from:

```js
import { handleKnock, handleCall, handleAvailability } from './notifier.js';
```

to:

```js
import { handleKnock, handleCall, handleAvailability, handleGroupOverrideChange } from './notifier.js';
```

Then append after the existing `onAvailability` export:

```js
// A group member's per-group override changed. handleGroupOverrideChange computes
// whether their EFFECTIVE in-group availability flipped off→on (reading their primary
// for the override-off case) and notifies opted-in co-members. Same RTDB region as
// the others (setGlobalOptions above).
export const onMemberOverride = onValueWritten('/groups/{groupId}/members/{memberUid}/statusOverride', (event) => {
  return handleGroupOverrideChange(
    makeDeps(),
    event.params.groupId,
    event.params.memberUid,
    event.data.before.val(),
    event.data.after.val(),
  );
});
```

(`onValueWritten` and `makeDeps` are already imported/defined in this file.)

- [ ] **Step 2: Verify the module parses (syntax check)**

Run: `cd functions && node --check index.js`
Expected: no output, exit 0 (syntax OK). The trigger itself is exercised at deploy/integration time; the handler is covered by Task 6's unit tests.

- [ ] **Step 3: Commit**

```bash
git add functions/index.js
git commit -m "feat(functions): onMemberOverride RTDB trigger for group availability"
```

---

### Task 9: Full suite + lint + final commit

**Files:** none (verification only)

- [ ] **Step 1: Run the full functions test suite**

Run: `cd functions && npm test`
Expected: PASS — all `presence-core.test.js` and `notifier.test.js` tests green, zero failures.

- [ ] **Step 2: Run the root web test suite (must be untouched)**

Run: `cd .. && npx jest 2>&1 | tail -3`
Expected: same total as before this feature (no functions changes affect the web bundle), all passing.

- [ ] **Step 3: Confirm the spec is fully covered**

Re-read `docs/superpowers/specs/2026-06-08-group-notifications-design.md` against the diff. Confirm: group knock text (Task 4), resolveGroupMemberName (Task 3), effective helpers (Task 1), buildMessage group titles (Task 2), notifyGroupAvailability + cooldown + opt-in (Task 5), override path + join-suppression + appearance-only no-op (Task 6), primary path for override-off groups (Task 7), onMemberOverride trigger (Task 8).

- [ ] **Step 4: Final commit if anything was adjusted**

```bash
git add -A
git commit -m "chore(functions): group notifications — final verification" --allow-empty
```

---

## Deploy note (not a code step)

These are Cloud Functions changes; they take effect only after `firebase deploy --only functions` (the dev deploy workflow already deploys `hosting,database,functions`). The new `onMemberOverride` trigger and the extended handlers ship together. No client rebuild is required for this feature, but deploying via the normal dev pipeline is fine.
