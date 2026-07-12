# Telegram Bot Group-Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Telegram bot's commands and knock-back callback group-aware: knocks carry `contextGroupId`, `/knock` reaches group-only members, and `/who`, `/status`, `/off` gain group forms per `docs/superpowers/specs/2026-07-07-telegram-group-context-design.md`.

**Architecture:** All changes live in `functions/telegram.js` + `functions/test/telegram.test.js`. Group names are matched case-insensitively by substring over the user's own groups. `/status <group>` and `/off <group>` NEVER touch the override's `enabled` flag (or `statusColor`/`paletteKey`): override ON → merge `status`/`availableUntil` only; override OFF → write nothing, reply with guidance. Fan-out for an override-ON `/status <group>` rides the existing `onMemberOverride` RTDB trigger (Admin-SDK writes fire triggers) — telegram.js makes no notifier call.

**Tech Stack:** Node 22 ESM Cloud Functions, Jest 30 (`node --experimental-vm-modules`), injected-deps pattern (no firebase imports in telegram.js logic).

## Global Constraints

- Bot writes use the Admin SDK (bypass DB rules): every write shape must mirror the client exactly (`js/db/social.js` writeKnock, `js/db/groups.js` mergeStatusOverride contract). Invariants are pinned only by tests.
- TDD: write the failing test first, watch it fail, then implement.
- Test command: `cd /home/user/on/functions && npm test -- test/telegram.test.js` (full suite: `npm test`).
- Test idioms (see existing `functions/test/telegram.test.js`): flat path-keyed `store` seeded with whole objects; `deps.update(path, obj)` writes `store[`${path}/${k}`]` per key, so assert merges via `expect(deps.update).toHaveBeenCalledWith(path, {...})`, never by re-reading the store after a merge. `deps.now()` is fixed at `1_000_000`.
- Commit after each task. Commit messages end with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01ChMZjWY3kT1EUKs4fpRDhM`
- Never merge to dev/main; never create PRs; push only to `claude/telegram-group-context-jkiwxq`.

---

### Task 1: Knock context threading (keyboard → callback → writeKnock)

**Files:**
- Modify: `functions/telegram.js` (buildNotificationKeyboard ~:12–33, writeKnock ~:154–162, handleCallback ~:215–237)
- Test: `functions/test/telegram.test.js`

**Interfaces:**
- Produces: `writeKnock(deps, recipientUid, senderUid, contextGroupId)` — 4th param optional; when set, the knock record carries `contextGroupId` (set on create, overwrite on increment, else carry existing). Task 3 calls this with a group id.
- Produces: callback grammar `knock:<uid>[:<gid>]` — `handleCallback` splits into `[action, arg, arg2]` and passes `arg2 || undefined` through. Task 3's ambiguity keyboard emits the 3-segment form.

- [ ] **Step 1: Write the failing tests**

Add to the `buildNotificationKeyboard` describe block:

```js
  test('knock with contextGroupId → 3-segment callback', () => {
    expect(buildNotificationKeyboard({ type: 'knock', targetUid: 'u9', contextGroupId: 'G1' }, APP))
      .toEqual([[{ text: 'Knock back', callback_data: 'knock:u9:G1' }]]);
  });
  test('availability with contextGroupId → 3-segment callback', () => {
    expect(buildNotificationKeyboard({ type: 'availability', targetUid: 'u9', contextGroupId: 'G1' }, APP))
      .toEqual([[{ text: 'Knock', callback_data: 'knock:u9:G1' }]]);
  });
```

Add to the `callback: knock` describe block (its `cbUpdate` helper is already defined there):

```js
  test('knock:uid:gid writes contextGroupId on create', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    await handleUpdate(deps, cbUpdate('knock:f9:G1'));
    expect(deps.store[`knocks/f9/${uid}`]).toEqual({ count: 1, ts: 1_000_000, contextGroupId: 'G1' });
  });
  test('knock:uid:gid overwrites contextGroupId on increment', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`knocks/f9/${uid}`] = { count: 1, ts: 1 };
    await handleUpdate(deps, cbUpdate('knock:f9:G2'));
    expect(deps.store[`knocks/f9/${uid}`]).toEqual({ count: 2, ts: 1_000_000, contextGroupId: 'G2' });
  });
  test('plain knock:uid carries an existing contextGroupId on increment', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`knocks/f9/${uid}`] = { count: 1, ts: 1, contextGroupId: 'G1' };
    await handleUpdate(deps, cbUpdate('knock:f9'));
    expect(deps.store[`knocks/f9/${uid}`]).toEqual({ count: 2, ts: 1_000_000, contextGroupId: 'G1' });
  });
```

(Existing tests `knock → Knock back callback`, `writes the knock and confirms`, and `empty arg → Unknown action` are the 2-segment regressions — leave them untouched.)

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `cd /home/user/on/functions && npm test -- test/telegram.test.js`
Expected: the 5 new tests FAIL (`callback_data: 'knock:u9'` ≠ `'knock:u9:G1'`; knock records lack `contextGroupId`); all pre-existing tests PASS.

- [ ] **Step 3: Implement**

In `buildNotificationKeyboard`, replace the `knock` and `availability` cases and add the helper above the function:

```js
// contextGroupId rides the callback so a knock-back lands as a group knock.
// 64-byte callback_data cap: 'knock:' + 32-hex uid + ':' + 16-hex gid = 55.
const knockCallback = (data) =>
  data.contextGroupId ? `knock:${data.targetUid}:${data.contextGroupId}` : `knock:${data.targetUid}`;
```

```js
    case 'knock':
      return [[{ text: 'Knock back', callback_data: knockCallback(data) }]];
    case 'availability':
      return [[{ text: 'Knock', callback_data: knockCallback(data) }]];
```

Replace `writeKnock` (keep its comment, extend it):

```js
// Same shape + cap as the client's writeKnock transaction (js/db/social.js),
// including contextGroupId: set on create, overwrite on increment, else carry.
async function writeKnock(deps, recipientUid, senderUid, contextGroupId) {
  await deps.transaction(`knocks/${recipientUid}/${senderUid}`, (current) => {
    if (current === null) {
      const next = { count: 1, ts: deps.now() };
      if (contextGroupId) next.contextGroupId = contextGroupId;
      return next;
    }
    if (current.count >= 5) return undefined; // abort — capped
    const next = { count: current.count + 1, ts: deps.now() };
    if (contextGroupId) next.contextGroupId = contextGroupId;
    else if (current.contextGroupId) next.contextGroupId = current.contextGroupId;
    return next;
  });
}
```

In `handleCallback`, change the destructuring and the `knock` case:

```js
  const [action, arg, arg2] = String(cq.data || '').split(':');
```

```js
    case 'knock':
      await writeKnock(deps, arg, me, arg2 || undefined);
      await answer('Knock sent.');
      return;
```

The `/knock` command's existing call site `writeKnock(deps, matches[0].userId, uid)` needs no change (4th param undefined).

- [ ] **Step 4: Run tests, verify all pass**

Run: `cd /home/user/on/functions && npm test -- test/telegram.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Run the full functions suite**

Run: `cd /home/user/on/functions && npm test`
Expected: PASS (171 pre-existing + 5 new).

- [ ] **Step 6: Commit**

```bash
cd /home/user/on && git add functions/telegram.js functions/test/telegram.test.js && git commit -m "feat(telegram): thread contextGroupId through knock buttons and knock-back

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ChMZjWY3kT1EUKs4fpRDhM"
```

---

### Task 2: Group-name resolver + `/who <group>`

**Files:**
- Modify: `functions/telegram.js` (handleSocialCommand `/who` branch ~:170–181; new helpers near it)
- Test: `functions/test/telegram.test.js`

**Interfaces:**
- Consumes: `effectiveAvailable(override, primaryStatus, primaryAU, now)` — already imported at the top of telegram.js.
- Produces: `matchGroupsByName(deps, uid, query)` → `Promise<[{ gid, name }]>` (case-insensitive substring over the user's own groups).
- Produces: `resolveGroupArg(deps, uid, query, reply)` → `Promise<{ gid, name } | null>`; on 0 matches replies `No group matching "<query>".`, on 2+ replies `Which group? <names, comma-joined> — give me more letters.`, both returning null. Tasks 4 and 5 call this.

- [ ] **Step 1: Write the failing tests**

Add a new describe block after `handleUpdate: /who`:

```js
describe('handleUpdate: /who <group>', () => {
  function seedGroup(store, uid) {
    store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    store['groups/G1/name'] = 'Divers';
    store['groups/G1/members'] = {
      [uid]: { displayName: 'Me', statusOverride: { enabled: true, status: 'available', availableUntil: 2_000_000 } },
      m1: { displayName: 'Overridden On', statusOverride: { enabled: true, status: 'available', availableUntil: 2_000_000 } },
      m2: { displayName: 'Overridden Off-Status', statusOverride: { enabled: true, status: 'unavailable' } },
      m3: { displayName: 'Follows Global', statusOverride: { enabled: false } },
    };
    store['users/m1/presence'] = { status: 'unavailable', availableUntil: null };
    store['users/m2/presence'] = { status: 'available', availableUntil: 2_000_000 }; // masked by override
    store['users/m3/presence'] = { status: 'available', availableUntil: 2_000_000 };
  }
  test('lists effectively-available co-members, self excluded', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedGroup(deps.store, uid);
    await handleUpdate(deps, msgUpdate('/who div'));
    const text = deps.tg.sendMessage.mock.calls[0][1];
    expect(text).toContain('Available in Divers');
    expect(text).toContain('Overridden On');     // override ON + available
    expect(text).toContain('Follows Global');    // override OFF + globally available
    expect(text).not.toContain('Overridden Off-Status'); // override masks global availability
    expect(text).not.toContain('Me');            // self excluded
  });
  test('nobody available → says so with the group name', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedGroup(deps.store, uid);
    deps.store['groups/G1/members'] = { [uid]: { displayName: 'Me' }, m1: { displayName: 'Bea', statusOverride: { enabled: true, status: 'unavailable' } } };
    await handleUpdate(deps, msgUpdate('/who divers'));
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe('No one is available in Divers right now.');
  });
  test('no matching group → No group matching', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedGroup(deps.store, uid);
    await handleUpdate(deps, msgUpdate('/who chess'));
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe('No group matching "chess".');
  });
  test('ambiguous group name → lists candidates, asks for more letters', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedGroup(deps.store, uid);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 2 } };
    deps.store['groups/G2/name'] = 'Dive Club';
    await handleUpdate(deps, msgUpdate('/who div'));
    const text = deps.tg.sendMessage.mock.calls[0][1];
    expect(text).toContain('Divers');
    expect(text).toContain('Dive Club');
    expect(text).toMatch(/more letters/i);
  });
});
```

(The existing bare-`/who` test is the Direct regression — leave untouched.)

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `cd /home/user/on/functions && npm test -- test/telegram.test.js`
Expected: the 4 new tests FAIL — bare `/who` handler ignores args and lists Direct following (e.g. `/who div` replies `No one is available right now.`). Pre-existing tests PASS.

- [ ] **Step 3: Implement**

Add above `handleSocialCommand`:

```js
// Case-insensitive substring match over the user's own groups' names
// (spec 2026-07-07 naming decision — the /knock idiom applied to groups).
async function matchGroupsByName(deps, uid, query) {
  const groups = (await deps.getVal(`users/${uid}/groups`)) || {};
  const q = query.toLowerCase();
  const matches = [];
  for (const gid of Object.keys(groups)) {
    const name = (await deps.getVal(`groups/${gid}/name`)) || gid;
    if (name.toLowerCase().includes(q)) matches.push({ gid, name });
  }
  return matches;
}

// Shared arity guard for group-arg commands: replies and returns null unless
// exactly one group matches. No inline keyboard — /status//off carry extra
// args that don't fit a callback, so the retry is plain text for all three.
async function resolveGroupArg(deps, uid, query, reply) {
  const matches = await matchGroupsByName(deps, uid, query);
  if (matches.length === 0) { await reply(`No group matching "${query}".`); return null; }
  if (matches.length > 1) {
    await reply(`Which group? ${matches.map((m) => m.name).join(', ')} — give me more letters.`);
    return null;
  }
  return matches[0];
}

// /who <group>: co-members' effective in-group availability (the /groups idiom).
async function handleWhoGroup(deps, uid, query, reply) {
  const match = await resolveGroupArg(deps, uid, query, reply);
  if (!match) return;
  const members = (await deps.getVal(`groups/${match.gid}/members`)) || {};
  const lines = [];
  for (const [mid, m] of Object.entries(members)) {
    if (mid === uid) continue;
    const presence = await deps.getVal(`users/${mid}/presence`);
    if (effectiveAvailable(m?.statusOverride, presence?.status, presence?.availableUntil, deps.now())) {
      lines.push(`🟢 ${m?.displayName || 'Someone'}`);
    }
  }
  await reply(lines.length
    ? `Available in ${match.name}:\n${lines.join('\n')}`
    : `No one is available in ${match.name} right now.`);
}
```

In `handleSocialCommand`, route the group form at the top of the `/who` branch:

```js
  if (cmd === '/who') {
    const groupQuery = args.join(' ').trim();
    if (groupQuery) { await handleWhoGroup(deps, uid, groupQuery, reply); return; }
    // ... existing Direct listing unchanged ...
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `cd /home/user/on/functions && npm test -- test/telegram.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/user/on && git add functions/telegram.js functions/test/telegram.test.js && git commit -m "feat(telegram): /who <group> — effective in-group availability + group-name resolver

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ChMZjWY3kT1EUKs4fpRDhM"
```

---

### Task 3: `/knock` reaches group-only members

**Files:**
- Modify: `functions/telegram.js` (handleSocialCommand `/knock` branch ~:182–195; new helper)
- Test: `functions/test/telegram.test.js`

**Interfaces:**
- Consumes: `writeKnock(deps, recipientUid, senderUid, contextGroupId)` from Task 1.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing tests**

Add to the `handleUpdate: /knock` describe block:

```js
  test('Direct match wins over a roster match — knock has no group context', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = { f1: { code: 'CODE01', label: 'Bea' } };
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G1/members'] = { g9: { displayName: 'Bea' } };
    await handleUpdate(deps, msgUpdate('/knock bea'));
    expect(deps.store[`knocks/f1/${uid}`]).toEqual({ count: 1, ts: 1_000_000 });
    expect(deps.store[`knocks/g9/${uid}`]).toBeUndefined();
  });
  test('roster-only match → knock carries contextGroupId, reply names the group', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = {};
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G1/members'] = { [uid]: { displayName: 'Me' }, g9: { displayName: 'Cora' } };
    await handleUpdate(deps, msgUpdate('/knock cora'));
    expect(deps.store[`knocks/g9/${uid}`]).toEqual({ count: 1, ts: 1_000_000, contextGroupId: 'G1' });
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe('Knocked on Cora (Divers).');
  });
  test('own displayName never matches (self excluded from rosters)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G1/members'] = { [uid]: { displayName: 'Ada' } };
    await handleUpdate(deps, msgUpdate('/knock ada'));
    expect(Object.keys(deps.store).some((k) => k.startsWith('knocks/'))).toBe(false);
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/find/i);
  });
  test('ambiguous roster matches → keyboard with uid:gid callbacks', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 2 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G2/name'] = 'Family';
    deps.store['groups/G1/members'] = { a1: { displayName: 'Cora' } };
    deps.store['groups/G2/members'] = { a2: { displayName: 'Coraline' } };
    await handleUpdate(deps, msgUpdate('/knock cora'));
    const buttons = deps.tg.sendMessage.mock.calls[0][2].reply_markup.inline_keyboard.flat();
    expect(buttons).toEqual(expect.arrayContaining([
      { text: 'Cora (Divers)', callback_data: 'knock:a1:G1' },
      { text: 'Coraline (Family)', callback_data: 'knock:a2:G2' },
    ]));
  });
  test('no match anywhere → mentions groups in the reply', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = { f1: { code: 'CODE01', label: 'Bea' } };
    await handleUpdate(deps, msgUpdate('/knock zed'));
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe('Couldn\'t find "zed" among the people you follow or your groups.');
  });
```

Then UPDATE the existing test `no match / no arg → helpful reply`: its first assertion (`/find/i` after `/knock zed`) still passes — leave it as-is.

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `cd /home/user/on/functions && npm test -- test/telegram.test.js`
Expected: the 5 new tests FAIL (roster search doesn't exist; no-match text lacks "or your groups"). Pre-existing PASS.

- [ ] **Step 3: Implement**

Add near the other helpers:

```js
// No Direct match — search shared-group rosters (spec 2026-07-07 §2): anyone
// visible in a group you're in is knockable, with that group as context.
async function knockGroupReach(deps, uid, query, rawQuery, reply) {
  const groups = (await deps.getVal(`users/${uid}/groups`)) || {};
  const found = [];
  for (const gid of Object.keys(groups)) {
    const [members, groupName] = await Promise.all([
      deps.getVal(`groups/${gid}/members`),
      deps.getVal(`groups/${gid}/name`),
    ]);
    for (const [mid, m] of Object.entries(members || {})) {
      if (mid === uid) continue;
      const name = m?.displayName || '';
      if (name.toLowerCase().includes(query)) found.push({ uid: mid, gid, name, groupName: groupName || gid });
    }
  }
  if (found.length === 0) {
    await reply(`Couldn't find "${rawQuery}" among the people you follow or your groups.`);
    return;
  }
  if (found.length > 1) {
    await reply('Which one?', { reply_markup: { inline_keyboard: found.slice(0, 8).map((e) => [{ text: `${e.name} (${e.groupName})`, callback_data: `knock:${e.uid}:${e.gid}` }]) } });
    return;
  }
  await writeKnock(deps, found[0].uid, uid, found[0].gid);
  await reply(`Knocked on ${found[0].name} (${found[0].groupName}).`);
}
```

In the `/knock` branch, replace the zero-match line

```js
    if (matches.length === 0) { await reply(`Couldn't find "${args.join(' ')}" among the people you follow.`); return; }
```

with

```js
    if (matches.length === 0) { await knockGroupReach(deps, uid, query, args.join(' '), reply); return; }
```

(Direct matches — one or several — keep today's behavior: Direct owns the name.)

- [ ] **Step 4: Run tests, verify all pass**

Run: `cd /home/user/on/functions && npm test -- test/telegram.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/user/on && git add functions/telegram.js functions/test/telegram.test.js && git commit -m "feat(telegram): /knock falls back to shared-group rosters with group context

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ChMZjWY3kT1EUKs4fpRDhM"
```

---

### Task 4: `/status <group> [duration]`

**Files:**
- Modify: `functions/telegram.js` (`/status` case ~:113–127, `/start` duration formatting ~:93–94; new helpers)
- Test: `functions/test/telegram.test.js` (one existing test UPDATED — see Step 1)

**Interfaces:**
- Consumes: `resolveGroupArg(deps, uid, query, reply)` from Task 2; `isFutureMs` (already imported).
- Produces: `fmtMinutes(m)` → `'30m' | '1.5h'` (shared duration formatter); `handleGroupStatus(deps, uid, query, minutes, reply)`. Task 5 mirrors the same override-ON/OFF branching.

- [ ] **Step 1: Update one existing test, then write the failing tests**

The existing test `'/status garbage → help reply, no write'` asserts `'/status whenever'` replies with a duration hint. Under the new grammar an unparseable arg is a GROUP NAME (spec §4 rule 3). Replace that test with:

```js
  test('/status <unknown word> → treated as group name, no write', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/status whenever'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe('No group matching "whenever".');
  });
```

Add a new describe block:

```js
describe('handleUpdate: /status <group>', () => {
  function seedStatusGroup(store, uid, override) {
    store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    store['groups/G1/name'] = 'Divers';
    store[`groups/G1/members/${uid}/statusOverride`] = override;
  }
  test('override ON → merges status+availableUntil only, replies with duration', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedStatusGroup(deps.store, uid, { enabled: true, status: 'unavailable', statusColor: '#abc', paletteKey: 'p1' });
    await handleUpdate(deps, msgUpdate('/status divers 2h'));
    expect(deps.update).toHaveBeenCalledWith(`groups/G1/members/${uid}/statusOverride`, {
      status: 'available', availableUntil: 1_000_000 + 120 * 60000,
    });
    expect(deps.update).toHaveBeenCalledTimes(1); // no global presence write
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe("You're available in Divers for 2h.");
  });
  test('override ON, no duration → defaults to 60m', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedStatusGroup(deps.store, uid, { enabled: true, status: 'unavailable' });
    await handleUpdate(deps, msgUpdate('/status divers'));
    expect(deps.update).toHaveBeenCalledWith(`groups/G1/members/${uid}/statusOverride`,
      expect.objectContaining({ availableUntil: 1_000_000 + 60 * 60000 }));
  });
  test('multi-word group name with trailing duration', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G3: { lastVisited: 1 } };
    deps.store['groups/G3/name'] = 'My Family';
    deps.store[`groups/G3/members/${uid}/statusOverride`] = { enabled: true, status: 'unavailable' };
    await handleUpdate(deps, msgUpdate('/status my family 30m'));
    expect(deps.update).toHaveBeenCalledWith(`groups/G3/members/${uid}/statusOverride`,
      expect.objectContaining({ availableUntil: 1_000_000 + 30 * 60000 }));
  });
  test('override OFF + globally available → no write, already-available message', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedStatusGroup(deps.store, uid, { enabled: false });
    deps.store[`users/${uid}/presence`] = { code: 'AAAAAA', status: 'available', availableUntil: 2_000_000 };
    await handleUpdate(deps, msgUpdate('/status divers'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe("Divers follows your global status — you're already available there.");
  });
  test('override OFF + globally unavailable → no write, guidance message', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedStatusGroup(deps.store, uid, { enabled: false });
    await handleUpdate(deps, msgUpdate('/status divers 2h'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe('Divers follows your global status. /status goes available everywhere, or turn on a group status in the app.');
  });
  test('missing override node behaves as override OFF', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Divers';
    await handleUpdate(deps, msgUpdate('/status divers'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/follows your global status/);
  });
  test('regression: /status 1h 30m stays a global duration', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/status 1h 30m'));
    expect(deps.update).toHaveBeenCalledWith(`users/${uid}/presence`,
      expect.objectContaining({ availableUntil: 1_000_000 + 90 * 60000 }));
  });
});
```

(Existing `/status 30m`, bare `/status`, and unknown-user tests are the other global regressions — leave untouched.)

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `cd /home/user/on/functions && npm test -- test/telegram.test.js`
Expected: the updated test + 7 new tests FAIL (current code replies with the duration hint and never resolves groups). Pre-existing PASS.

- [ ] **Step 3: Implement**

Add the shared formatter near `parseDurationMinutes` and use it in the three places that inline the same expression (`/start` returning-user reply ~:94, global `/status` reply ~:125, and the new group reply):

```js
const fmtMinutes = (m) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${m}m`);
```

`/start` line ~93–94 becomes:

```js
      const mins = Math.max(1, Math.round((presence.availableUntil - deps.now()) / 60000));
      await reply(`You're available for another ${fmtMinutes(mins)}. /off to stop.`, openAppKeyboard(deps.appUrl));
```

Replace the whole `case '/status':` block:

```js
    case '/status': {
      const asDuration = args.length ? parseDurationMinutes(args.join(' ')) : 60;
      if (asDuration != null) {
        // Bare or pure-duration form — global presence, mirrors js/db/social.js setStatus.
        await deps.update(`users/${uid}/presence`, {
          status: 'available',
          availableUntil: deps.now() + asDuration * 60000,
          lastSeen: deps.now(),
        });
        await reply(`You're available for ${fmtMinutes(asDuration)}. /off to stop.`);
        return;
      }
      // Group form: a trailing duration token splits off; the rest names the group.
      const trailing = args.length > 1 ? parseDurationMinutes(args[args.length - 1]) : null;
      const minutes = trailing ?? 60;
      const query = (trailing != null ? args.slice(0, -1) : args).join(' ');
      await handleGroupStatus(deps, uid, query, minutes, reply);
      return;
    }
```

Add the handler near the other group helpers:

```js
// /status <group> and /off <group> respect the app-side `enabled` choice
// (spec 2026-07-07): the bot never flips it. Override ON → merge status fields
// only (enabled/statusColor/paletteKey untouched — the client's
// mergeStatusOverride contract); override OFF → the group mirrors global
// presence, so the bot only explains. Fan-out for the ON write rides the
// onMemberOverride RTDB trigger — Admin-SDK writes fire it too.
async function handleGroupStatus(deps, uid, query, minutes, reply) {
  const match = await resolveGroupArg(deps, uid, query, reply);
  if (!match) return;
  const override = await deps.getVal(`groups/${match.gid}/members/${uid}/statusOverride`);
  if (override && override.enabled === true) {
    await deps.update(`groups/${match.gid}/members/${uid}/statusOverride`, {
      status: 'available',
      availableUntil: deps.now() + minutes * 60000,
    });
    await reply(`You're available in ${match.name} for ${fmtMinutes(minutes)}.`);
    return;
  }
  const presence = await deps.getVal(`users/${uid}/presence`);
  const globallyOn = presence?.status === 'available' && isFutureMs(presence?.availableUntil, deps.now());
  await reply(globallyOn
    ? `${match.name} follows your global status — you're already available there.`
    : `${match.name} follows your global status. /status goes available everywhere, or turn on a group status in the app.`);
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `cd /home/user/on/functions && npm test -- test/telegram.test.js`
Expected: PASS (including the untouched `/start` remaining-time test — `fmtMinutes(30)` is `'30m'`, same output).

- [ ] **Step 5: Commit**

```bash
cd /home/user/on && git add functions/telegram.js functions/test/telegram.test.js && git commit -m "feat(telegram): /status <group> [dur] — per-group availability via statusOverride

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ChMZjWY3kT1EUKs4fpRDhM"
```

---

### Task 5: `/off <group>`

**Files:**
- Modify: `functions/telegram.js` (`/off` case ~:128–132; new helper)
- Test: `functions/test/telegram.test.js`

**Interfaces:**
- Consumes: `resolveGroupArg` (Task 2), `isFutureMs`.
- Produces: nothing consumed later.

- [ ] **Step 1: Write the failing tests**

Add a new describe block:

```js
describe('handleUpdate: /off <group>', () => {
  function seedOffGroup(store, uid, override) {
    store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    store['groups/G1/name'] = 'Divers';
    if (override) store[`groups/G1/members/${uid}/statusOverride`] = override;
  }
  test('override ON → merges unavailable, clears availableUntil, nothing else', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedOffGroup(deps.store, uid, { enabled: true, status: 'available', availableUntil: 2_000_000, statusColor: '#abc' });
    await handleUpdate(deps, msgUpdate('/off divers'));
    expect(deps.update).toHaveBeenCalledWith(`groups/G1/members/${uid}/statusOverride`, {
      status: 'unavailable', availableUntil: null,
    });
    expect(deps.update).toHaveBeenCalledTimes(1); // no global presence write
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe("You're unavailable in Divers.");
  });
  test('override OFF + globally available → no write, guidance message', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedOffGroup(deps.store, uid, { enabled: false });
    deps.store[`users/${uid}/presence`] = { code: 'AAAAAA', status: 'available', availableUntil: 2_000_000 };
    await handleUpdate(deps, msgUpdate('/off divers'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe('Divers follows your global status. /off goes unavailable everywhere, or turn on a group status in the app.');
  });
  test('override OFF + globally unavailable → no write, already-unavailable message', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedOffGroup(deps.store, uid, { enabled: false });
    await handleUpdate(deps, msgUpdate('/off divers'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe("You're already unavailable in Divers.");
  });
  test('no matching group → No group matching, no write', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedOffGroup(deps.store, uid, { enabled: true, status: 'available' });
    await handleUpdate(deps, msgUpdate('/off chess'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe('No group matching "chess".');
  });
});
```

(The existing bare-`/off` test is the global regression — leave untouched.)

- [ ] **Step 2: Run tests, verify the new ones fail**

Run: `cd /home/user/on/functions && npm test -- test/telegram.test.js`
Expected: the 4 new tests FAIL — current `/off` ignores args and writes global presence (`deps.update` called with `users/.../presence`). Pre-existing PASS.

- [ ] **Step 3: Implement**

Replace the `case '/off':` block:

```js
    case '/off': {
      if (args.length) { await handleGroupOff(deps, uid, args.join(' '), reply); return; }
      // Mirrors js/db/social.js writeBackExpired + a lastSeen touch.
      await deps.update(`users/${uid}/presence`, { status: 'unavailable', availableUntil: null, lastSeen: deps.now() });
      await reply("You're unavailable.");
      return;
    }
```

Add next to `handleGroupStatus` (same override-ON/OFF contract — see its comment):

```js
async function handleGroupOff(deps, uid, query, reply) {
  const match = await resolveGroupArg(deps, uid, query, reply);
  if (!match) return;
  const override = await deps.getVal(`groups/${match.gid}/members/${uid}/statusOverride`);
  if (override && override.enabled === true) {
    // null availableUntil deletes the key on RTDB — same shape the client's
    // setOverrideStatusUnavailable merge writes.
    await deps.update(`groups/${match.gid}/members/${uid}/statusOverride`, {
      status: 'unavailable',
      availableUntil: null,
    });
    await reply(`You're unavailable in ${match.name}.`);
    return;
  }
  const presence = await deps.getVal(`users/${uid}/presence`);
  const globallyOn = presence?.status === 'available' && isFutureMs(presence?.availableUntil, deps.now());
  await reply(globallyOn
    ? `${match.name} follows your global status. /off goes unavailable everywhere, or turn on a group status in the app.`
    : `You're already unavailable in ${match.name}.`);
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `cd /home/user/on/functions && npm test -- test/telegram.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/user/on && git add functions/telegram.js functions/test/telegram.test.js && git commit -m "feat(telegram): /off <group> — per-group unavailability via statusOverride

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ChMZjWY3kT1EUKs4fpRDhM"
```

---

### Task 6: `/help` group forms + full verification

**Files:**
- Modify: `functions/telegram.js` (HELP_TEXT ~:46–55)
- Test: `functions/test/telegram.test.js`

**Interfaces:** none.

- [ ] **Step 1: Write the failing test**

Extend the existing `'/help lists the commands'` test — after the `for` loop add:

```js
    expect(text).toContain('/status [group] [30m|2h]');
    expect(text).toContain('/off [group]');
    expect(text).toContain('/who [group]');
    expect(text).toMatch(/groups/i);
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd /home/user/on/functions && npm test -- test/telegram.test.js`
Expected: FAIL on `'/status [group] [30m|2h]'`.

- [ ] **Step 3: Implement**

Replace the four command lines in `HELP_TEXT`:

```js
const HELP_TEXT = [
  'KnockKnock commands:',
  '/status [group] [30m|2h] — go available (default 1h)',
  '/off [group] — go unavailable',
  '/who [group] — who\'s available now',
  '/knock <name> — send a knock (searches your people, then your groups)',
  '/groups — your groups',
  '/notifications push|telegram — where notifications go',
  '/help — this list',
].join('\n');
```

- [ ] **Step 4: Run the full functions suite, then the web suite**

Run: `cd /home/user/on/functions && npm test`
Expected: PASS, 0 failures (171 pre-existing + ~26 new).

Run: `cd /home/user/on && npx jest`
Expected: PASS, 1385 tests (no client files touched — regression sanity only).

- [ ] **Step 5: Commit**

```bash
cd /home/user/on && git add functions/telegram.js functions/test/telegram.test.js && git commit -m "feat(telegram): /help shows the group command forms

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01ChMZjWY3kT1EUKs4fpRDhM"
```
