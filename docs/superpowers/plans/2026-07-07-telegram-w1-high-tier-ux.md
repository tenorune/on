# Wave W1: HIGH-tier UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the ten operator-approved UX findings from the 2026-07-07 feature analysis: no reachable silent-notification state, no silently-dropped invites, no dead-end boot failures, honest bot callbacks, back-button coverage for the new overlays, and unlink failure feedback.

**Architecture:** Ten independent behavioral fixes across the web client (`js/`) and Cloud Functions (`functions/`), specified in `docs/superpowers/specs/2026-07-07-telegram-w1-high-tier-ux-design.md`. Functions changes land first (Tasks 1–6), then client (Tasks 7–14), then whole-suite verification (Task 15). No new subsystems: every fix reuses an existing primitive (overlay markup pattern, `setButtonBusy`, account-stamped localStorage, injected deps).

**Tech Stack:** Vanilla ES modules, jest + jsdom (web), jest (functions), Firebase RTDB via injected deps (functions are network-free and fully unit-tested).

## Global Constraints

- Branch: `claude/telegram-app-adaptation-t1r1jp`. NEVER merge to `dev`/`main`; never open PRs.
- Wave W2 (functions efficiency) runs in a PARALLEL session on its own branch and touches the same functions files. Do NOT restructure reads/writes for efficiency here (no `Promise.all` conversions of untouched code, no helper extraction beyond what a task specifies) — behavioral fixes only, minimal diff.
- TDD: every task writes its failing test first and shows it red before implementing.
- Commit identity: `git config user.email noreply@anthropic.com` must be set (commit hook).
- Test commands: web `npx jest <file>` from repo root (full: `npx jest`, 1408 baseline); functions `cd functions && npm test` (207 baseline). Async jest mocks that production code calls `.catch()`/`.then()` on MUST return promises (`jest.fn(async () => …)`), else the wrong branch is exercised silently (HANDOFF §35).
- Copy voice: contractions, straight apostrophes, "Try again." (never "Please try again.") in all new strings.
- The notify-channel default contract: `functions/notifier.js`, `js/notifySuppression.js`, `js/notifyChannel.js` are the ONLY three readers of "missing channel = telegram on a linked account" and must not drift. Task 5 adds a delivery-level fallback WITHOUT touching that predicate.
- The `CALLBACK_ARG_RE` table in `functions/telegram.js` gates every callback action; if a task adds/renames an action (none do), the table must be updated in the same commit.

---

### Task 1: Honest knock replies — `writeKnock` returns `committed`

**Files:**
- Modify: `functions/telegram.js:189-202` (writeKnock), `:323-324` + `:352-353` (/knock replies), `:385-387` (knock callback)
- Test: `functions/test/telegram.test.js`

**Interfaces:**
- Consumes: existing `deps.transaction(path, fn)` → `{ committed: boolean }` (both prod adapters at `functions/index.js:190-196` and `:239-242` already return this; the test mock at `functions/test/telegram.test.js:57-62` too).
- Produces: `writeKnock(deps, recipientUid, senderUid, contextGroupId)` → `Promise<boolean>` (committed). Tasks 2–4 do not depend on it.

- [ ] **Step 1: Write the failing tests**

Add to `functions/test/telegram.test.js` (inside the existing webhook describe block, after the existing knock tests; reuse `makeBotDeps`, `msgUpdate`, `seedUser`, and the existing callback-update helper if one exists — otherwise use the `cqUpdate` shape below):

```js
const cqUpdate = (data, message) => ({
  callback_query: {
    id: 'cq1',
    from: { id: 42, first_name: 'Ada' },
    data,
    ...(message ? { message } : {}),
  },
});

describe('knock cap honesty (W1 B#2)', () => {
  const RECIP = 'a'.repeat(32); // format-valid uid for CALLBACK_ARG_RE

  test('capped knock via callback answers the cap message, not "Knock sent."', async () => {
    const store = {};
    seedUser(store);
    store[`knocks/${RECIP}/u-tg-42`] = { count: 5, ts: 999 };
    const deps = makeBotDeps(store);
    await handleUpdate(deps, cqUpdate(`knock:${RECIP}`));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith(
      'cq1', "You've already knocked a few times — give them a moment.");
    expect(store[`knocks/${RECIP}/u-tg-42`].count).toBe(5); // unchanged
  });

  test('uncapped knock via callback still answers "Knock sent."', async () => {
    const store = {};
    seedUser(store);
    const deps = makeBotDeps(store);
    await handleUpdate(deps, cqUpdate(`knock:${RECIP}`));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', 'Knock sent.');
  });

  test('capped /knock command replies the cap message', async () => {
    const store = {};
    const uid = seedUser(store);
    store[`userPrefs/${uid}/following`] = { [RECIP]: { code: 'BBBBBB', label: 'Ana' } };
    store[`knocks/${RECIP}/${uid}`] = { count: 5, ts: 999 };
    const deps = makeBotDeps(store);
    await handleUpdate(deps, msgUpdate('/knock ana'));
    expect(deps.tg.sendMessage).toHaveBeenCalledWith('42',
      "You've already knocked a few times — give them a moment.", expect.anything());
  });
});
```

Note: if the existing `reply` plumbing calls `sendMessage(chatId, text)` with only two args in these paths, drop the `expect.anything()` third matcher to match the actual arity — check a neighboring passing test's assertion shape first and mirror it.

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/telegram.test.js -t "knock cap honesty"`
Expected: FAIL — answers/replies are `'Knock sent.'` / `'Knocked on Ana.'`.

- [ ] **Step 3: Implement**

In `functions/telegram.js`, make `writeKnock` return the commit outcome (only the first and last lines change):

```js
// Same shape + cap as the client's writeKnock transaction (js/db/social.js),
// including contextGroupId: set on create, overwrite on increment, else carry.
// Returns whether the transaction committed — an aborted (capped) knock must
// not be confirmed as sent (W1 B#2).
async function writeKnock(deps, recipientUid, senderUid, contextGroupId) {
  const res = await deps.transaction(`knocks/${recipientUid}/${senderUid}`, (current) => {
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
  return res.committed;
}
```

Add the shared cap string near `HELP_TEXT`:

```js
const KNOCK_CAP_TEXT = "You've already knocked a few times — give them a moment.";
```

Three reply sites:

`handleCallback` knock case (was `:385-387`):

```js
    case 'knock': {
      const committed = await writeKnock(deps, arg, me, GROUP_ID_RE.test(arg2 || '') ? arg2 : undefined);
      await answer(committed ? 'Knock sent.' : KNOCK_CAP_TEXT);
      return;
    }
```

`handleSocialCommand` /knock single-match (was `:352-353`):

```js
    const committed = await writeKnock(deps, matches[0].userId, uid);
    await reply(committed ? `Knocked on ${matches[0].label || matches[0].code}.` : KNOCK_CAP_TEXT);
    return;
```

`knockGroupReach` single-match (was `:323-324`):

```js
  const committed = await writeKnock(deps, found[0].uid, uid, found[0].gid);
  await reply(committed ? `Knocked on ${found[0].name} (${found[0].groupName}).` : KNOCK_CAP_TEXT);
```

- [ ] **Step 4: Run to verify pass, and the whole functions suite**

Run: `cd functions && npm test`
Expected: all green (207 + 3 new). If a pre-existing test asserted `'Knock sent.'` on a capped fixture, fix THAT fixture's count (it was asserting the bug).

- [ ] **Step 5: Commit**

```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "fix(bot): capped knocks answer honestly instead of 'Knock sent.'"
```

---

### Task 2: `editMessageText` dep + `resolveSourceMessage` helper

**Files:**
- Modify: `functions/index.js:246-249` (webhook tg deps), `functions/telegram.js` (new helper above `handleCallback`)
- Test: `functions/test/telegram.test.js`

**Interfaces:**
- Produces: `deps.tg.editMessageText(chatId, messageId, text)` → Promise (Telegram `editMessageText`; sending NO `reply_markup` removes the inline keyboard). Exported-for-test is NOT needed — exercise via `handleUpdate`.
- Produces: `resolveSourceMessage(deps, cq, outcome)` → Promise<void> — appends `\n\n${outcome}` to the source message's text (or uses `outcome` alone if the update carried no text) and strips its keyboard; swallows all edit failures. Tasks 3–4 call it.

- [ ] **Step 1: Write the failing test**

The helper is internal; test it through the knock callback? No — knock keyboards must stay live (spec). Test through Task 3's invite flow instead? Tasks must be independently landable, so give the helper a thin direct test by exporting it:

```js
// functions/test/telegram.test.js
import { resolveSourceMessage } from '../telegram.js';

describe('resolveSourceMessage (W1 B#1)', () => {
  const cqMsg = { message_id: 7, chat: { id: 42 }, text: 'Ada invited you to join Divers' };

  test('appends the outcome and strips the keyboard via editMessageText', async () => {
    const deps = makeBotDeps({});
    deps.tg.editMessageText = jest.fn(async () => ({}));
    await resolveSourceMessage(deps, { id: 'cq1', message: cqMsg }, '✅ Joined Divers.');
    expect(deps.tg.editMessageText).toHaveBeenCalledWith(
      '42', 7, 'Ada invited you to join Divers\n\n✅ Joined Divers.');
  });

  test('missing message (privacy mode / >48h) is a silent no-op', async () => {
    const deps = makeBotDeps({});
    deps.tg.editMessageText = jest.fn(async () => ({}));
    await resolveSourceMessage(deps, { id: 'cq1' }, 'x');
    expect(deps.tg.editMessageText).not.toHaveBeenCalled();
  });

  test('edit failure is swallowed', async () => {
    const deps = makeBotDeps({});
    deps.tg.editMessageText = jest.fn(async () => { throw new Error('message to edit not found'); });
    await expect(resolveSourceMessage(deps, { id: 'cq1', message: cqMsg }, 'x')).resolves.toBeUndefined();
  });
});
```

Also extend `makeBotDeps`'s `tg` object so every later test has the mock by default:

```js
    tg: {
      sendMessage: jest.fn(async () => ({})),
      answerCallbackQuery: jest.fn(async () => ({})),
      editMessageText: jest.fn(async () => ({})),
    },
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/telegram.test.js -t "resolveSourceMessage"`
Expected: FAIL — `resolveSourceMessage` is not exported.

- [ ] **Step 3: Implement**

`functions/telegram.js`, above `handleCallback`:

```js
// Rewrite a callback's source notification message to record its resolved
// outcome, and drop the inline keyboard (editMessageText with no reply_markup
// removes it) so stale buttons can't be tapped (W1 B#1/B#9). The original text
// is kept for context; the outcome is appended. Every failure is swallowed:
// the action itself already succeeded and the answerCallbackQuery toast fired —
// a >48h edit window, a user-deleted message, or a double-tap race must never
// fail the action.
export async function resolveSourceMessage(deps, cq, outcome) {
  const msg = cq?.message;
  if (!msg?.message_id || !msg.chat?.id || !deps.tg.editMessageText) return;
  const text = msg.text ? `${msg.text}\n\n${outcome}` : outcome;
  try { await deps.tg.editMessageText(String(msg.chat.id), msg.message_id, text); }
  catch { /* cosmetic — see above */ }
}
```

`functions/index.js` webhook `tg` deps (after `answerCallbackQuery` at `:248`):

```js
      answerCallbackQuery: (id, text) => tgApi('answerCallbackQuery', { callback_query_id: id, text }),
      editMessageText: (chatId, messageId, text, extra = {}) =>
        tgApi('editMessageText', { chat_id: chatId, message_id: messageId, text, ...extra }),
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add functions/telegram.js functions/index.js functions/test/telegram.test.js
git commit -m "feat(bot): editMessageText dep + resolveSourceMessage helper for honest callbacks"
```

---

### Task 3: State-checked group-invite callbacks with edit + strip

**Files:**
- Modify: `functions/telegram.js:400-432` (`handleInboxCallback`, invite branch)
- Test: `functions/test/telegram.test.js`

**Interfaces:**
- Consumes: `resolveSourceMessage(deps, cq, outcome)` from Task 2.
- Produces: nothing new for later tasks. Callback answers and message outcomes per the table in this step.

Behavior table (spec S4): with `pending`/`existing`/`name` read up front —

| State | accept answers | decline answers | message outcome |
|---|---|---|---|
| already a member | `You're already in that group.` | `Already handled — you joined this group.` | `✅ Joined ⟨name or 'the group'⟩.` (+ clearPending) |
| no pending, not member | `Already handled.` | `Already handled.` | `Already handled.` |
| pending, group gone | `That group no longer exists.` (+ clearPending) | — (decline path clears first) | `That group no longer exists.` |
| pending, fresh decline | — | `Declined.` (+ clearPending) | `Invite declined.` |
| pending, fresh accept | `Joined ⟨name⟩.` (+ join writes + clearPending) | — | `✅ Joined ⟨name⟩.` |

- [ ] **Step 1: Write the failing tests**

```js
describe('invite callbacks are state-checked and self-recording (W1 B#1)', () => {
  const GID = 'ABCD1234';
  const inviteMsg = { message_id: 7, chat: { id: 42 }, text: 'Ada invited you to Divers' };

  function seedInvite(store, uid) {
    store[`pendingInvites/${uid}/${GID}`] = { from: 'f'.repeat(32) };
    store[`groups/${GID}/name`] = 'Divers';
  }

  test('fresh accept joins, edits the message to the outcome, and strips the keyboard', async () => {
    const store = {};
    const uid = seedUser(store);
    seedInvite(store, uid);
    const deps = makeBotDeps(store);
    await handleUpdate(deps, cqUpdate(`invite_accept:${GID}`, inviteMsg));
    expect(store[`groups/${GID}/members/${uid}`]).toMatchObject({ role: 'member' });
    expect(deps.tg.editMessageText).toHaveBeenCalledWith(
      '42', 7, 'Ada invited you to Divers\n\n✅ Joined Divers.');
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', 'Joined Divers.');
  });

  test('decline after accept answers honestly instead of "Declined."', async () => {
    const store = {};
    const uid = seedUser(store);
    store[`groups/${GID}/name`] = 'Divers';
    store[`groups/${GID}/members/${uid}`] = { role: 'member', displayName: 'Ada' };
    const deps = makeBotDeps(store);
    await handleUpdate(deps, cqUpdate(`invite_decline:${GID}`, inviteMsg));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith(
      'cq1', 'Already handled — you joined this group.');
    expect(store[`groups/${GID}/members/${uid}`]).toBeTruthy(); // still a member
    expect(deps.tg.editMessageText).toHaveBeenCalledWith(
      '42', 7, 'Ada invited you to Divers\n\n✅ Joined Divers.');
  });

  test('fresh decline records "Invite declined." on the message', async () => {
    const store = {};
    const uid = seedUser(store);
    seedInvite(store, uid);
    const deps = makeBotDeps(store);
    await handleUpdate(deps, cqUpdate(`invite_decline:${GID}`, inviteMsg));
    expect(store[`pendingInvites/${uid}/${GID}`]).toBeNull();
    expect(deps.tg.editMessageText).toHaveBeenCalledWith(
      '42', 7, 'Ada invited you to Divers\n\nInvite declined.');
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', 'Declined.');
  });

  test('tap on a fully-handled invite (no pending, not member) answers "Already handled."', async () => {
    const store = {};
    seedUser(store);
    store[`groups/${GID}/name`] = 'Divers';
    const deps = makeBotDeps(store);
    await handleUpdate(deps, cqUpdate(`invite_accept:${GID}`, inviteMsg));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', 'Already handled.');
    expect(store[`groups/${GID}/members/u-tg-42`]).toBeUndefined(); // no write
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/telegram.test.js -t "state-checked"`
Expected: FAIL — decline-after-accept answers `'Declined.'`; no `editMessageText` calls.

- [ ] **Step 3: Implement**

Replace the invite branch of `handleInboxCallback` (`functions/telegram.js:401-432`):

```js
  if (action === 'invite_accept' || action === 'invite_decline') {
    const groupId = arg;
    const clearPending = () => Promise.all([
      deps.set(`pendingInvites/${me}/${groupId}`, null),
      deps.set(`pendingInvitesByGroup/${groupId}/${me}`, null),
    ]);
    // State FIRST (W1 B#1): a button on an old message answers from the current
    // state — decline-after-accept must not say "Declined." while membership stands.
    const [pending, existing, name] = await Promise.all([
      deps.getVal(`pendingInvites/${me}/${groupId}`),
      deps.getVal(`groups/${groupId}/members/${me}`),
      deps.getVal(`groups/${groupId}/name`),
    ]);
    if (existing) {
      await clearPending();
      await resolveSourceMessage(deps, cq, `✅ Joined ${name || 'the group'}.`);
      await answer(action === 'invite_accept'
        ? "You're already in that group."
        : 'Already handled — you joined this group.');
      return;
    }
    if (!pending) {
      await resolveSourceMessage(deps, cq, 'Already handled.');
      await answer('Already handled.');
      return;
    }
    if (action === 'invite_decline') {
      await clearPending();
      await resolveSourceMessage(deps, cq, 'Invite declined.');
      await answer('Declined.');
      return;
    }
    if (!name) {
      await clearPending();
      await resolveSourceMessage(deps, cq, 'That group no longer exists.');
      await answer('That group no longer exists.');
      return;
    }
    // Join mirrors js/groups.js joinGroup (fresh membership branch): the display
    // name is the Telegram first name (the bot has no prompt UI); editable later
    // in the app.
    const now = deps.now();
    await deps.set(`groups/${groupId}/members/${me}`, {
      role: 'member',
      displayName: clampName(cq.from.first_name) || 'Someone',
      joinedAt: now,
      statusOverride: { enabled: true, status: 'available', availableUntil: now + 2 * 60 * 60 * 1000 },
    });
    await deps.set(`users/${me}/groups/${groupId}`, { lastVisited: now });
    await clearPending();
    await resolveSourceMessage(deps, cq, `✅ Joined ${name}.`);
    await answer(`Joined ${name}.`);
    return;
  }
```

- [ ] **Step 4: Run to verify pass, whole suite**

Run: `cd functions && npm test`
Expected: green. Pre-existing invite-callback tests asserting the old `'This invite is gone.'` copy must be updated to `'Already handled.'` — that copy change is this task's deliverable, not a regression.

- [ ] **Step 5: Commit**

```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "fix(bot): invite callbacks answer from current state and resolve the source message"
```

---

### Task 4: State-checked follow-request callbacks with edit + strip

**Files:**
- Modify: `functions/telegram.js:433-453` (`handleInboxCallback`, follow-request branch)
- Test: `functions/test/telegram.test.js`

**Interfaces:**
- Consumes: `resolveSourceMessage` (Task 2).

Behavior table: with `request` and `grant` (`followGrants/{requester}/{me}`) read up front —

| State | approve answers | decline answers | message outcome |
|---|---|---|---|
| grant exists (approved earlier) | `Already approved.` | `Already approved.` | `✅ Approved.` (request node cleared) |
| no request, no grant | `This request is gone.` | `This request is gone.` | `This request is gone.` |
| fresh decline | — | `Declined.` | `Declined.` |
| fresh approve | `Approved.` | — | `✅ Approved.` |

- [ ] **Step 1: Write the failing tests**

```js
describe('follow-request callbacks are state-checked (W1 B#1)', () => {
  const REQ = 'b'.repeat(32);
  const frMsg = { message_id: 9, chat: { id: 42 }, text: 'Cara wants to follow you' };

  test('decline after approve answers "Already approved." and keeps the grant', async () => {
    const store = {};
    const uid = seedUser(store);
    store[`followGrants/${REQ}/${uid}`] = { from: uid, code: 'AAAAAA', ts: 1 };
    const deps = makeBotDeps(store);
    await handleUpdate(deps, cqUpdate(`fr_decline:${REQ}`, frMsg));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', 'Already approved.');
    expect(store[`followGrants/${REQ}/${uid}`]).toBeTruthy();
    expect(deps.tg.editMessageText).toHaveBeenCalledWith(
      '42', 9, 'Cara wants to follow you\n\n✅ Approved.');
  });

  test('fresh approve writes the grant and resolves the message', async () => {
    const store = {};
    const uid = seedUser(store);
    store[`followRequests/${uid}/${REQ}`] = { from: REQ };
    const deps = makeBotDeps(store);
    await handleUpdate(deps, cqUpdate(`fr_approve:${REQ}`, frMsg));
    expect(store[`followGrants/${REQ}/${uid}`]).toMatchObject({ from: uid });
    expect(deps.tg.editMessageText).toHaveBeenCalledWith(
      '42', 9, 'Cara wants to follow you\n\n✅ Approved.');
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', 'Approved.');
  });

  test('fresh decline resolves the message with "Declined."', async () => {
    const store = {};
    const uid = seedUser(store);
    store[`followRequests/${uid}/${REQ}`] = { from: REQ };
    const deps = makeBotDeps(store);
    await handleUpdate(deps, cqUpdate(`fr_decline:${REQ}`, frMsg));
    expect(store[`followRequests/${uid}/${REQ}`]).toBeNull();
    expect(deps.tg.editMessageText).toHaveBeenCalledWith(
      '42', 9, 'Cara wants to follow you\n\nDeclined.');
  });

  test('tap on a vanished request answers "This request is gone."', async () => {
    const store = {};
    seedUser(store);
    const deps = makeBotDeps(store);
    await handleUpdate(deps, cqUpdate(`fr_approve:${REQ}`, frMsg));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', 'This request is gone.');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/telegram.test.js -t "follow-request callbacks"`
Expected: FAIL — decline blindly answers `'Declined.'`; no edits.

- [ ] **Step 3: Implement**

Replace the follow-request branch (`functions/telegram.js:433-453`):

```js
  if (action === 'fr_approve' || action === 'fr_decline') {
    const requesterUid = arg;
    // State FIRST (W1 B#1): an existing grant means this was already approved
    // (here or in the app) — a late Decline must not claim otherwise.
    const [request, grant] = await Promise.all([
      deps.getVal(`followRequests/${me}/${requesterUid}`),
      deps.getVal(`followGrants/${requesterUid}/${me}`),
    ]);
    if (grant) {
      await deps.set(`followRequests/${me}/${requesterUid}`, null);
      await resolveSourceMessage(deps, cq, '✅ Approved.');
      await answer('Already approved.');
      return;
    }
    if (!request) {
      await resolveSourceMessage(deps, cq, 'This request is gone.');
      await answer('This request is gone.');
      return;
    }
    if (action === 'fr_decline') {
      await deps.set(`followRequests/${me}/${requesterUid}`, null);
      await resolveSourceMessage(deps, cq, 'Declined.');
      await answer('Declined.');
      return;
    }
    // Mirrors js/inbox.js handleApprove: grant carries my share code + my display
    // name in the shared group; the requester's grant-watcher completes the follow.
    const [presence, myName] = await Promise.all([
      deps.getVal(`users/${me}/presence`),
      request.groupId ? deps.getVal(`groups/${request.groupId}/members/${me}/displayName`) : Promise.resolve(null),
    ]);
    await deps.set(`followGrants/${requesterUid}/${me}`, {
      from: me, code: presence?.code || '', name: myName ?? null, ts: deps.now(),
    });
    await deps.set(`followRequests/${me}/${requesterUid}`, null);
    await resolveSourceMessage(deps, cq, '✅ Approved.');
    await answer('Approved.');
  }
```

- [ ] **Step 4: Run to verify pass, whole suite**

Run: `cd functions && npm test` — green; update any pre-existing assertion on the old blind-decline behavior.

- [ ] **Step 5: Commit**

```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "fix(bot): follow-request callbacks answer from current state and resolve the source message"
```

---

### Task 5: Notifier token-less-push fallback

**Files:**
- Modify: `functions/notifier.js:17-51` (`sendToUser`), cross-reference comments in `js/notifySuppression.js` + `js/notifyChannel.js`
- Test: `functions/test/notifier.test.js`

**Interfaces:**
- Consumes: existing `deps.sendTelegram(chatId, message, data)` → boolean | throws; existing read of `telegramByUid/{uid}` (already fetched when `deps.sendTelegram` exists).
- Produces: no signature change. New behavior: `channel === 'push'` + linked route + zero tokens → deliver via bot.

- [ ] **Step 1: Write the failing tests**

Mirror the existing `sendToUser` test setup in `functions/test/notifier.test.js` (a deps object with `getVal`/`send`/`sendTelegram` jest mocks — follow the file's existing helper):

```js
describe('token-less push fallback (W1 J#3)', () => {
  test('channel push + linked + zero tokens delivers via telegram instead of dropping', async () => {
    const store = {
      'userPrefs/u1/notifyChannel': 'push',
      'telegramByUid/u1': { chatId: '42' },
      // no userPrefs/u1/pushTokens
    };
    const deps = {
      getVal: jest.fn(async (p) => store[p] ?? null),
      update: jest.fn(async () => {}),
      send: jest.fn(async () => ({ failedTokens: [] })),
      sendTelegram: jest.fn(async () => true),
      now: () => 1_000_000,
    };
    const ok = await sendToUser(deps, 'u1', { title: 'Ana knocked' }, { type: 'knock', targetUid: 'a'.repeat(32) });
    expect(ok).toBe(true);
    expect(deps.sendTelegram).toHaveBeenCalledTimes(1);
    expect(deps.send).not.toHaveBeenCalled();
  });

  test('channel push + zero tokens + NOT linked still returns false', async () => {
    const store = { 'userPrefs/u1/notifyChannel': 'push' };
    const deps = {
      getVal: jest.fn(async (p) => store[p] ?? null),
      update: jest.fn(async () => {}),
      send: jest.fn(async () => ({ failedTokens: [] })),
      sendTelegram: jest.fn(async () => true),
      now: () => 1_000_000,
    };
    expect(await sendToUser(deps, 'u1', { title: 't' }, {})).toBe(false);
    expect(deps.sendTelegram).not.toHaveBeenCalled();
  });

  test('telegram-channel send failure does not retry telegram via the fallback', async () => {
    const store = {
      'userPrefs/u1/notifyChannel': 'telegram',
      'telegramByUid/u1': { chatId: '42' },
    };
    const deps = {
      getVal: jest.fn(async (p) => store[p] ?? null),
      update: jest.fn(async () => {}),
      send: jest.fn(async () => ({ failedTokens: [] })),
      sendTelegram: jest.fn(async () => { throw new Error('blocked'); }),
      now: () => 1_000_000,
    };
    expect(await sendToUser(deps, 'u1', { title: 't' }, {})).toBe(false);
    expect(deps.sendTelegram).toHaveBeenCalledTimes(1); // no second attempt
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/notifier.test.js -t "token-less"`
Expected: first test FAILS (returns false, `sendTelegram` not called).

- [ ] **Step 3: Implement**

Rework `sendToUser` (`functions/notifier.js:17-51`) — keep the channel predicate EXACTLY as-is; the fallback reuses the already-read route:

```js
export async function sendToUser(deps, uid, message, data) {
  // Experimental Telegram channel (spec 2026-07-02): a linked user whose
  // notifyChannel is 'telegram' gets a bot message instead of web push. The
  // uid→chat route lives in server-only telegramByUid (NOT userPrefs) so a
  // client can't point its notifications at someone else's chat. Any failure
  // (user blocked the bot, missing route, bot unconfigured) falls back to FCM.
  // channel !== 'push' (not === 'telegram'): a MISSING channel on a routed
  // account reads as telegram, matching the client predicates in
  // js/notifySuppression.js botDelivered and js/notifyChannel.js — this is the
  // third reader of that default, and the three must never disagree.
  let tgRoute = null;
  let triedTelegram = false;
  if (deps.sendTelegram) {
    const [channel, route] = await Promise.all([
      deps.getVal(`userPrefs/${uid}/notifyChannel`),
      deps.getVal(`telegramByUid/${uid}`),
    ]);
    tgRoute = route;
    if (channel !== 'push' && tgRoute && tgRoute.chatId) {
      triedTelegram = true;
      try {
        if (await deps.sendTelegram(tgRoute.chatId, message, data)) return true;
      } catch (e) {
        console.error(`[notify] telegram send failed for ${uid}: ${e?.message || e}`);
      }
    }
  }
  const tokensMap = await deps.getVal(`userPrefs/${uid}/pushTokens`);
  const tokens = tokensMap ? Object.keys(tokensMap) : [];
  if (tokens.length === 0) {
    // W1 J#3: a LINKED account that chose 'push' but has no registered device
    // must not go silent — deliver via the bot rather than dropping. This is a
    // DELIVERY-level fallback only; the channel-default predicate above (the
    // three-reader contract) is untouched. triedTelegram guards the
    // telegram-channel case: a failed bot send must not just retry itself.
    if (!triedTelegram && deps.sendTelegram && tgRoute && tgRoute.chatId) {
      try {
        return !!(await deps.sendTelegram(tgRoute.chatId, message, data));
      } catch (e) {
        console.error(`[notify] telegram fallback failed for ${uid}: ${e?.message || e}`);
        return false;
      }
    }
    return false;
  }
  const { failedTokens } = await deps.send(tokens, message, data);
  if (failedTokens && failedTokens.length) {
    const nulls = {};
    for (const t of failedTokens) nulls[t] = null;
    await deps.update(`userPrefs/${uid}/pushTokens`, nulls);
  }
  // Delivered if at least one token wasn't rejected.
  return (failedTokens?.length || 0) < tokens.length;
}
```

Then add one line to the three-reader comment blocks in the two client readers (comment-only edits):

`js/notifySuppression.js` — inside its `botDelivered` contract comment, append:
```js
// Note: the notifier additionally falls back to the bot when channel IS 'push'
// but the account has zero push tokens (W1 J#3) — delivery-level only; it does
// not change this predicate.
```

`js/notifyChannel.js` — same line appended to the `isLinked` comment block (after `:32`).

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm test` AND `npx jest tests/notifySuppression.test.js tests/notifyChannel.test.js`
Expected: green (client tests unaffected — comment-only).

- [ ] **Step 5: Commit**

```bash
git add functions/notifier.js functions/test/notifier.test.js js/notifySuppression.js js/notifyChannel.js
git commit -m "fix(notify): token-less push accounts fall back to the bot instead of going silent"
```

---

### Task 6: Bot `/notifications push` refusal without tokens

**Files:**
- Modify: `functions/telegram.js:167-176`
- Test: `functions/test/telegram.test.js`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

```js
describe('/notifications push without tokens (W1 J#3)', () => {
  test('refuses with guidance and writes nothing', async () => {
    const store = {};
    const uid = seedUser(store);
    const deps = makeBotDeps(store);
    await handleUpdate(deps, msgUpdate('/notifications push'));
    expect(deps.tg.sendMessage).toHaveBeenCalledWith('42',
      "Push isn't set up on any device yet — open KnockKnock in a browser first. You'll keep getting messages here.",
      expect.anything());
    expect(store[`userPrefs/${uid}/notifyChannel`]).toBeUndefined();
  });

  test('switches normally when a token exists', async () => {
    const store = {};
    const uid = seedUser(store);
    store[`userPrefs/${uid}/pushTokens`] = { tok1: true };
    const deps = makeBotDeps(store);
    await handleUpdate(deps, msgUpdate('/notifications push'));
    expect(store[`userPrefs/${uid}/notifyChannel`]).toBe('push');
  });
});
```

(Match the `reply` arity convention as in Task 1's note.)

- [ ] **Step 2: Run to verify failure**

Run: `cd functions && npx jest test/telegram.test.js -t "notifications push without tokens"`
Expected: first test FAILS (channel written, success copy sent).

- [ ] **Step 3: Implement**

Replace the `/notifications` case (`functions/telegram.js:167-176`):

```js
    case '/notifications': {
      const choice = (args[0] || '').toLowerCase();
      if (choice !== 'push' && choice !== 'telegram') {
        await reply('Use "/notifications telegram" or "/notifications push".');
        return;
      }
      if (choice === 'push') {
        // W1 J#3 (mirrors the app's channel pill): don't write a push channel
        // this account can't receive on — the notifier's token-less fallback
        // would mask it, but the shown state would lie.
        const tokensMap = await deps.getVal(`userPrefs/${uid}/pushTokens`);
        if (!tokensMap || Object.keys(tokensMap).length === 0) {
          await reply("Push isn't set up on any device yet — open KnockKnock in a browser first. You'll keep getting messages here.");
          return;
        }
      }
      await deps.update(`userPrefs/${uid}`, { notifyChannel: choice });
      await reply(choice === 'telegram' ? 'Notifications will arrive here.' : 'Notifications will use the app\'s push channel.');
      return;
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd functions && npm test` — green.

- [ ] **Step 5: Commit**

```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "fix(bot): /notifications push refuses when no device has push set up"
```

---

### Task 7: Channel pill refuses an unhonorable Push switch in Telegram

**Files:**
- Modify: `js/notifyChannel.js:55-73` (click handler)
- Test: `tests/notifyChannel.test.js`

**Interfaces:**
- Consumes: `showToast(message)` from `js/groups.js`; existing `isTelegramContext()` import; `lastPrefs` module state (whole `userPrefs/{uid}` node, so `lastPrefs.pushTokens` is available).
- Produces: no API change.

- [ ] **Step 1: Write the failing test**

Follow the file's existing setup (it mocks `./db.js`, `./telegram.js`, `./notifySuppression.js`, `./notifyPrompt.js` with promise-returning mocks per HANDOFF §35). Add `jest.unstable_mockModule('./groups.js', …)` for `showToast` if the file doesn't already mock it — mirror the import style at the top of the file exactly. New tests:

```js
test('Telegram context + no pushTokens: Push tap refuses — toast, no write, pill stays', async () => {
  // arrange: isTelegramContext → true; sync with prefs lacking pushTokens
  isTelegramContext.mockReturnValue(true);
  telegramLinkState.mockReturnValue({ linked: true });
  syncNotifyChannel('u1', { telegram: { id: 1 }, notifyChannel: 'telegram' });
  const pushBtn = document.querySelector('[data-channel="push"]');
  pushBtn.click();
  await Promise.resolve(); // flush microtasks
  expect(showToast).toHaveBeenCalledWith(
    "Push isn't set up on any device yet — open KnockKnock in a browser first. Messages keep arriving via Telegram.");
  expect(mergeUserPrefs).not.toHaveBeenCalled();
  expect(pushBtn.classList.contains('active')).toBe(false); // no optimistic flip
});

test('Telegram context WITH pushTokens: Push tap proceeds', async () => {
  isTelegramContext.mockReturnValue(true);
  telegramLinkState.mockReturnValue({ linked: true });
  syncNotifyChannel('u1', { telegram: { id: 1 }, notifyChannel: 'telegram', pushTokens: { t1: true } });
  document.querySelector('[data-channel="push"]').click();
  await Promise.resolve();
  expect(mergeUserPrefs).toHaveBeenCalledWith('u1', { notifyChannel: 'push' });
});
```

(Adjust arrange/mock names to the file's actual fixtures — the DOM ids `tg-notify-slot`/`drawer-section-notifications` and the mock handles already exist there; reuse them.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/notifyChannel.test.js`
Expected: first new test FAILS (write happens, no toast).

- [ ] **Step 3: Implement**

In `js/notifyChannel.js`: add the import and the guard at the top of the click handler, BEFORE the optimistic `setActive`:

```js
import { showToast } from './groups.js';
```

```js
    b.addEventListener('click', async () => {
      if (b.classList.contains('active')) return;
      const next = b.dataset.channel;
      // W1 J#3: inside Telegram the permission flow can't run, so a switch to
      // Push with no registered device would write a channel the account can't
      // receive on. Refuse (no write, no flip) and say why — the server-side
      // token-less fallback (functions/notifier.js) covers every other path.
      if (next === 'push' && isTelegramContext()) {
        const tokens = lastPrefs?.pushTokens ? Object.keys(lastPrefs.pushTokens) : [];
        if (tokens.length === 0) {
          showToast("Push isn't set up on any device yet — open KnockKnock in a browser first. Messages keep arriving via Telegram.");
          return;
        }
      }
      setActive(pill, next); // optimistic — instant feedback before the round-trip
      try {
        await mergeUserPrefs(userId, { notifyChannel: next });
        // (existing body unchanged)
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/notifyChannel.test.js` — green, including all pre-existing tests (web-context tests are unaffected: the guard requires `isTelegramContext()`).

- [ ] **Step 5: Commit**

```bash
git add js/notifyChannel.js tests/notifyChannel.test.js
git commit -m "fix(web): channel pill refuses a Push switch inside Telegram when no device has push"
```

---

### Task 8: `resolveInvitePreview` distinguishes invalid from unavailable

**Files:**
- Modify: `js/invites.js:232-239`, `js/app.js:190` (web welcome-framing call site)
- Test: `tests/invites.test.js`

**Interfaces:**
- Produces (new contract, consumed by Task 10): `resolveInvitePreview(token)` → preview object | `null` (callable succeeded and said invalid/revoked/expired) | **throws** `Error('invite-preview-unavailable')` after one internal retry (transport/server failure).

- [ ] **Step 1: Write the failing tests**

In `tests/invites.test.js`, following the file's existing mock of `./firebase-config.js` (`callResolveInvitePreview`):

```js
describe('resolveInvitePreview error contract (W1 J#1)', () => {
  test('invalid token (callable returns null) → null', async () => {
    callResolveInvitePreview.mockResolvedValue(null);
    await expect(resolveInvitePreview('tok')).resolves.toBeNull();
  });

  test('one transport failure then success → preview (internal retry)', async () => {
    callResolveInvitePreview
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ scope: 'personal', label: 'Ana' });
    await expect(resolveInvitePreview('tok')).resolves.toEqual({ scope: 'personal', label: 'Ana' });
    expect(callResolveInvitePreview).toHaveBeenCalledTimes(2);
  });

  test('two transport failures → throws invite-preview-unavailable', async () => {
    callResolveInvitePreview.mockRejectedValue(new Error('network'));
    await expect(resolveInvitePreview('tok')).rejects.toThrow('invite-preview-unavailable');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/invites.test.js -t "error contract"`
Expected: third test FAILS (resolves null instead of throwing).

- [ ] **Step 3: Implement**

`js/invites.js:232-239`:

```js
// Resolves invite metadata for the pre-redemption welcome-screen framing. …
// (keep the existing comment block, then replace the final paragraph with:)
//
// Outcome contract (W1 J#1): a resolved preview object; null when the callable
// SUCCEEDED and judged the token invalid/revoked/expired; a THROWN
// 'invite-preview-unavailable' when the callable itself failed (network,
// server) — after one internal retry. Callers must not blanket-catch back to
// null: "that invite is dead" and "couldn't check" are different answers.
export async function resolveInvitePreview(token) {
  if (!token) return null;
  try {
    return await callResolveInvitePreview(token);
  } catch {
    try {
      return await callResolveInvitePreview(token);
    } catch {
      throw new Error('invite-preview-unavailable');
    }
  }
}
```

`js/app.js:190` (web welcome framing keeps its existing null-tolerant behavior):

```js
  const invitePreview = await resolveInvitePreview(pendingInviteToken).catch(() => null);
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/invites.test.js` and `npx jest tests/onboardingFlow.test.js tests/app-boot-cacheOwner.test.js` (boot-path consumers) — green.

- [ ] **Step 5: Commit**

```bash
git add js/invites.js js/app.js tests/invites.test.js
git commit -m "fix(web): invite preview distinguishes invalid tokens from lookup failure"
```

---

### Task 9: Invite-token outcome stamps + `showLinkScreen` resolves on cancel

**Files:**
- Modify: `js/telegramFirstRun.js` (new stamp helpers), `js/cacheOwner.js:55-78` (new key), `js/telegramSettings.js:83-133` (`showLinkScreen` returns a promise)
- Test: `tests/telegramFirstRun.test.js`, `tests/telegramSettings.test.js`

**Interfaces:**
- Produces: `stampInviteOutcome(token, outcome)` and `stampedInviteOutcome(token)` → `'redeemed' | 'dismissed' | null`, exported from `js/telegramFirstRun.js`; localStorage key `statusapp_invite_outcomes` (account-scoped). Consumed by Task 10 (gate) and Task 11 (app.js).
- Produces: `showLinkScreen()` → `Promise<boolean>` — resolves `false` on cancel; on success it reloads (and resolves `true` for tests). Existing fire-and-forget callers (`tg-link-btn`) are unaffected.

- [ ] **Step 1: Write the failing tests**

`tests/telegramFirstRun.test.js` (follow the file's existing jsdom setup):

```js
describe('invite outcome stamps (W1 J#4/J#5)', () => {
  beforeEach(() => localStorage.clear());

  test('stamp + read round-trip', () => {
    stampInviteOutcome('tokA', 'dismissed');
    expect(stampedInviteOutcome('tokA')).toBe('dismissed');
    expect(stampedInviteOutcome('tokB')).toBeNull();
  });

  test('prunes to the 8 most recent tokens', () => {
    for (let i = 0; i < 10; i++) stampInviteOutcome(`tok${i}`, 'redeemed');
    expect(stampedInviteOutcome('tok0')).toBeNull();
    expect(stampedInviteOutcome('tok9')).toBe('redeemed');
  });

  test('corrupt storage reads as unstamped', () => {
    localStorage.setItem('statusapp_invite_outcomes', '{not json');
    expect(stampedInviteOutcome('tokA')).toBeNull();
  });
});
```

`tests/cacheOwner.test.js` — extend the existing wipe test's key list assertion with `statusapp_invite_outcomes` (set it before the owner switch, assert it's gone after).

`tests/telegramSettings.test.js`:

```js
test('showLinkScreen resolves false on cancel (W1 J#6)', async () => {
  const p = showLinkScreen();
  document.getElementById('restore-cancel-btn').click();
  await expect(p).resolves.toBe(false);
  expect(document.getElementById('restore-screen').classList.contains('hidden')).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/telegramFirstRun.test.js tests/telegramSettings.test.js tests/cacheOwner.test.js`
Expected: FAIL — exports missing; `showLinkScreen` returns undefined.

- [ ] **Step 3: Implement**

`js/telegramFirstRun.js` — add below `extractStartParamToken`:

```js
// Account-stamped record of invite-token outcomes (W1 J#4/J#5): a redeemed
// token never re-shows the interstitial on a re-tapped chat link; a dismissed
// ("Not now") token never auto-redeems later — following someone the user
// declined would be a consent surprise. Keyed per account via cacheOwner's
// wipe-on-switch (the key is in its ACCOUNT_SCOPED_KEYS). Pruned to the 8 most
// recent tokens: one entry per tapped invite link, not unbounded growth.
const OUTCOME_KEY = 'statusapp_invite_outcomes';
const OUTCOME_MAX = 8;

function readOutcomes() {
  try { return JSON.parse(localStorage.getItem(OUTCOME_KEY)) || {}; }
  catch { return {}; }
}

export function stampInviteOutcome(token, outcome) {
  if (!token) return;
  const map = readOutcomes();
  delete map[token]; // re-stamp moves it to newest position
  map[token] = outcome;
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length - OUTCOME_MAX; i++) delete map[keys[i]];
  try { localStorage.setItem(OUTCOME_KEY, JSON.stringify(map)); }
  catch { /* private mode / quota — stamping is best-effort */ }
}

export function stampedInviteOutcome(token) {
  return (token && readOutcomes()[token]) || null;
}
```

`js/cacheOwner.js` — add to `ACCOUNT_SCOPED_KEYS` (after `'statusapp_seen_notify_promo',`):

```js
  'statusapp_invite_outcomes',
```

`js/telegramSettings.js` — `showLinkScreen` returns a promise (only the wrapping and the two resolve points change; body otherwise identical):

```js
export function showLinkScreen() {
  const el = document.getElementById('restore-screen');
  const input = document.getElementById('restore-input');
  const error = document.getElementById('restore-error');
  const submit = document.getElementById('restore-submit-btn');
  const cancel = document.getElementById('restore-cancel-btn');
  const form = document.getElementById('restore-form');
  if (!el) return Promise.resolve(false);
  // (…existing setup lines unchanged…)

  return new Promise((resolve) => {
    const showError = (msg) => { error.textContent = msg; error.classList.remove('hidden'); };
    const onFormSubmit = (e) => e.preventDefault();
    async function onSubmit() {
      const normalized = parseRecoveryCode(input.value);
      if (!normalized) { showError("That doesn't look like a secret phrase."); return; }
      submit.disabled = true;
      submit.textContent = 'Linking…';
      try {
        await callLinkTelegram(tgWebApp().initData, normalized);
      } catch (e) {
        submit.disabled = false;
        submit.textContent = 'Link account';
        showError(/not-found/.test(e?.code || '') ? 'No account found with that phrase.' : "Couldn't link right now. Try again.");
        return;
      }
      teardown();
      resolve(true); // observable in tests; the reload ends the session
      window.location.reload(); // reboot via initData into the linked account
    }
    function onCancel() { teardown(); resolve(false); }
    function teardown() {
      submit.removeEventListener('click', onSubmit);
      cancel.removeEventListener('click', onCancel);
      if (form) form.removeEventListener('submit', onFormSubmit);
      if (subtext) subtext.classList.add('hidden');
      el.classList.add('hidden');
    }
    submit.addEventListener('click', onSubmit);
    cancel.addEventListener('click', onCancel);
    if (form) form.addEventListener('submit', onFormSubmit);
  });
}
```

(The `subtext` const stays where it is in the setup section, above the `return new Promise`.)

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/telegramFirstRun.test.js tests/telegramSettings.test.js tests/cacheOwner.test.js` — green.

- [ ] **Step 5: Commit**

```bash
git add js/telegramFirstRun.js js/cacheOwner.js js/telegramSettings.js tests/
git commit -m "feat(web): invite-token outcome stamps + showLinkScreen resolves on cancel"
```

---

### Task 10: Invite-gate rewrite — error overlay, expired toast, dismissal memory, phrase loop

**Files:**
- Modify: `js/telegramFirstRun.js:52-69` (`telegramInviteGate`), `index.template.html` (new `#tg-invite-error` overlay after the `#tg-invite-screen` block ending at line 68)
- Test: `tests/telegramFirstRun.test.js`

**Interfaces:**
- Consumes: Task 8's `resolveInvitePreview` contract (throws on unavailability); Task 9's stamps and promise-returning `showLinkScreen`; `showToast` from `js/groups.js`.
- Produces: `telegramInviteGate({ linked, isNew, dismissSplash })` — same signature and return shape (`{ token, preview, silent } | null`).

Gate outcome map (spec S1): stamped token → `null` silently · preview throws → error overlay with Try again (loops) / Not now (`null`) · preview `null` → expired toast, `null` · linked → silent redeem (unchanged) · interstitial: accept → redeem · Not now → stamp `dismissed`, `null` · phrase → await link; cancel loops back to the interstitial.

- [ ] **Step 1: Write the failing tests**

Extend `tests/telegramFirstRun.test.js` (reuse its existing DOM fixture for `#tg-invite-screen` and its mocks of `./telegram.js`, `./invites.js`, `./telegramSettings.js` — all promise-returning):

```js
describe('telegramInviteGate outcomes (W1 J#1/J#4/J#5/J#6)', () => {
  test('stamped-dismissed token shows nothing and does not resolve the preview', async () => {
    stampInviteOutcome(TOKEN, 'dismissed');
    const out = await telegramInviteGate({ linked: true, isNew: false, dismissSplash: jest.fn() });
    expect(out).toBeNull();
    expect(resolveInvitePreview).not.toHaveBeenCalled();
  });

  test('preview unavailable → error overlay; Try again re-resolves; success proceeds', async () => {
    resolveInvitePreview
      .mockRejectedValueOnce(new Error('invite-preview-unavailable'))
      .mockResolvedValueOnce({ scope: 'personal', label: 'Ana' });
    const gate = telegramInviteGate({ linked: true, isNew: false, dismissSplash: jest.fn() });
    await flush(); // helper: () => new Promise(r => setTimeout(r, 0))
    expect(document.getElementById('tg-invite-error').classList.contains('hidden')).toBe(false);
    document.getElementById('tg-invite-error-retry').click();
    await expect(gate).resolves.toEqual({ token: TOKEN, preview: { scope: 'personal', label: 'Ana' }, silent: true });
  });

  test('invalid token → expired toast, no interstitial', async () => {
    resolveInvitePreview.mockResolvedValue(null);
    const out = await telegramInviteGate({ linked: false, isNew: false, dismissSplash: jest.fn() });
    expect(out).toBeNull();
    expect(showToast).toHaveBeenCalledWith('That invite link has expired.');
  });

  test('Not now stamps dismissed', async () => {
    resolveInvitePreview.mockResolvedValue({ scope: 'personal', label: 'Ana' });
    const gate = telegramInviteGate({ linked: false, isNew: false, dismissSplash: jest.fn() });
    await flush();
    document.getElementById('tg-invite-dismiss-btn').click();
    await expect(gate).resolves.toBeNull();
    expect(stampedInviteOutcome(TOKEN)).toBe('dismissed');
  });

  test('phrase → cancel loops back to the interstitial with the invite intact', async () => {
    resolveInvitePreview.mockResolvedValue({ scope: 'personal', label: 'Ana' });
    showLinkScreen.mockResolvedValue(false); // user cancelled the link screen
    const gate = telegramInviteGate({ linked: false, isNew: false, dismissSplash: jest.fn() });
    await flush();
    document.getElementById('tg-invite-phrase-btn').click();
    await flush();
    // interstitial is showing again — accept now
    expect(document.getElementById('tg-invite-screen').classList.contains('hidden')).toBe(false);
    document.getElementById('tg-invite-accept-btn').click();
    await expect(gate).resolves.toMatchObject({ silent: false });
  });
});
```

(`TOKEN` = the fixture start_param the file already stubs into `tgWebApp().initDataUnsafe.start_param`; add the `#tg-invite-error` markup below to the test DOM fixture.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/telegramFirstRun.test.js`
Expected: new tests FAIL (no overlay, no stamps consulted, phrase falls through).

- [ ] **Step 3: Implement**

`index.template.html` — insert after line 68 (the `#tg-invite-screen` closing `</div>`), same overlay pattern as `#invite-failure-overlay` (lines 121-128):

```html
  <div id="tg-invite-error" class="modal-overlay hidden" role="dialog" aria-modal="true">
    <div class="modal-card modal-card-small">
      <p id="tg-invite-error-message">Couldn't open that invite. Check your connection and try again.</p>
      <div class="modal-actions">
        <button id="tg-invite-error-retry" class="primary-btn" type="button">Try again</button>
        <button id="tg-invite-error-dismiss" class="ghost-btn" type="button">Not now</button>
      </div>
    </div>
  </div>
```

`js/telegramFirstRun.js` — add imports and replace the gate:

```js
import { showToast } from './groups.js';
```

```js
// One-shot error overlay for a failed preview lookup (W1 J#1): a transient
// webview blip must not silently eat a VALID invite. Resolves true (retry) or
// false (Not now).
function showInviteError() {
  const el = document.getElementById('tg-invite-error');
  if (!el) return Promise.resolve(false);
  el.classList.remove('hidden');
  return new Promise((resolve) => {
    const retry = document.getElementById('tg-invite-error-retry');
    const dismiss = document.getElementById('tg-invite-error-dismiss');
    function pick(v) {
      retry.removeEventListener('click', onRetry);
      dismiss.removeEventListener('click', onDismiss);
      el.classList.add('hidden');
      resolve(v);
    }
    function onRetry() { pick(true); }
    function onDismiss() { pick(false); }
    retry.addEventListener('click', onRetry);
    dismiss.addEventListener('click', onDismiss);
  });
}

// Returns { token, preview, silent } to feed pendingInviteToken, or null.
//  - stamped token (redeemed or dismissed): show nothing — a re-tapped chat
//    link must not re-run the ceremony, and a declined invite must never
//    auto-redeem (W1 J#4/J#5).
//  - preview unavailable: error overlay with retry (W1 J#1).
//  - invalid/expired: one-line toast (was: total silence).
//  - linked account: silent redeem (caller toasts on success) — no interstitial.
//  - unlinked: interstitial; Accept → redeem; phrase → link flow (success
//    reloads and re-runs this gate with linked=true; CANCEL loops back to the
//    interstitial with the invite intact, W1 J#6); Not now → stamp dismissed.
export async function telegramInviteGate({ linked, isNew, dismissSplash }) {
  const token = extractStartParamToken();
  if (!token) return null;
  if (stampedInviteOutcome(token)) return null;
  while (true) {
    let preview;
    try {
      preview = await resolveInvitePreview(token);
    } catch {
      dismissSplash();
      if (await showInviteError()) continue; // retry the lookup
      return null;
    }
    if (!preview) { showToast('That invite link has expired.'); return null; }
    if (linked) return { token, preview, silent: true };
    dismissSplash();
    while (true) {
      const choice = await showInterstitial(preview, isNew);
      if (choice === 'accept') return { token, preview, silent: false };
      if (choice === 'dismiss') { stampInviteOutcome(token, 'dismissed'); return null; }
      // choice === 'phrase': success reloads (never returns); false = cancelled.
      await showLinkScreen();
    }
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/telegramFirstRun.test.js` — green. Then `npx jest` (whole web suite) — the template change may require regenerating any fixture that snapshots the template region; fix forward.

- [ ] **Step 5: Commit**

```bash
git add js/telegramFirstRun.js index.template.html tests/telegramFirstRun.test.js
git commit -m "fix(web): invite gate — error overlay, expired toast, dismissal memory, phrase-cancel loop"
```

---

### Task 11: Stamp redeemed outcomes at the redemption call site

**Files:**
- Modify: `js/app.js:628-639` (the `if (result)` block in `main()`)
- Test: `tests/app-boot-cacheOwner.test.js` if it covers this block, else `tests/telegramFirstRun.test.js` unit-level note below

**Interfaces:**
- Consumes: `stampInviteOutcome` (Task 9) — add to the existing `telegramFirstRun.js` import in `app.js:31`.

- [ ] **Step 1: Write the failing test**

The redemption block runs deep in `main()`; the boot harness in `tests/app-boot-cacheOwner.test.js` is the only suite that executes it. If wiring a full boot fixture there costs more than it verifies, test the extracted decision instead: add a pure helper to `js/telegramFirstRun.js` and unit-test it —

```js
// Which redemption results consume the token (W1 J#4): success, or the
// server telling us it was already consumed.
export function redemptionConsumedToken(result) {
  return !!result && (result.ok === true
    || result.reason === 'already-following'
    || result.reason === 'already-member');
}
```

```js
// tests/telegramFirstRun.test.js
describe('redemptionConsumedToken (W1 J#4)', () => {
  test.each([
    [{ ok: true }, true],
    [{ ok: false, reason: 'already-following' }, true],
    [{ ok: false, reason: 'already-member' }, true],
    [{ ok: false, reason: 'expired' }, false],
    [null, false],
  ])('%o → %s', (result, expected) => {
    expect(redemptionConsumedToken(result)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/telegramFirstRun.test.js -t redemptionConsumedToken` — FAIL (not exported).

- [ ] **Step 3: Implement**

Add the helper above to `js/telegramFirstRun.js`. In `js/app.js`, extend the import at line 31:

```js
import { telegramInviteGate, stampInviteOutcome, redemptionConsumedToken } from './telegramFirstRun.js';
```

In the `if (result)` block (after the `silentNoop` handling at `:631-637`, before `cleanInviteParamFromUrl()`):

```js
      // A consumed token never re-runs the ceremony on a re-tapped chat link
      // (W1 J#4) — stamp it (covers the silent-redeem path too).
      if (tgInvite && redemptionConsumedToken(result)) stampInviteOutcome(tgInvite.token, 'redeemed');
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/telegramFirstRun.test.js && npx jest tests/app-boot-cacheOwner.test.js` — green.

- [ ] **Step 5: Commit**

```bash
git add js/app.js js/telegramFirstRun.js tests/telegramFirstRun.test.js
git commit -m "fix(web): stamp consumed invite tokens so re-tapped links show nothing"
```

---

### Task 12: Boot-failure retry overlay

**Files:**
- Modify: `js/app.js:109-121` (Telegram boot catch), `index.template.html` (new `#boot-error-overlay` after `#invite-failure-overlay`, line 128)
- Test: `tests/app-boot-cacheOwner.test.js` (or the suite that exercises `ensureIdentity`'s Telegram branch — `tests/onboardingFlow.test.js` if that's where the fixture lives; match the existing test that asserts the current toast)

**Interfaces:** none for later tasks.

- [ ] **Step 1: Write the failing test**

Find the existing test asserting `showToast("Couldn't start KnockKnock. Please try again in a moment.")` on Telegram boot failure (grep `Couldn't start KnockKnock` in `tests/`). Replace/extend it:

```js
test('telegram boot failure shows the retry overlay, not just a toast (W1 J#2)', async () => {
  ensureTelegramIdentity.mockRejectedValue(new Error('boom'));
  await expect(bootUnderTest()).rejects.toThrow(); // rethrow preserved
  const overlay = document.getElementById('boot-error-overlay');
  expect(overlay.classList.contains('hidden')).toBe(false);
  // Try again reloads
  document.getElementById('boot-error-retry').click();
  expect(reloadSpy).toHaveBeenCalled(); // jsdom: spy on window.location.reload per the file's existing pattern
});
```

(Reuse the file's existing mechanism for stubbing `location.reload` — `tests/telegramSettings.test.js` already does this for the unlink reload.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest -t "boot failure"` — FAIL (no overlay in DOM fixture / not shown).

- [ ] **Step 3: Implement**

`index.template.html`, after `#invite-failure-overlay` (line 128):

```html
  <div id="boot-error-overlay" class="modal-overlay hidden" role="dialog" aria-modal="true">
    <div class="modal-card modal-card-small">
      <p>Couldn't start KnockKnock.</p>
      <div class="modal-actions">
        <button id="boot-error-retry" class="primary-btn" type="button">Try again</button>
      </div>
    </div>
  </div>
```

`js/app.js:109-121`:

```js
  if (isTelegramContext()) {
    try {
      return await ensureTelegramIdentity();
    } catch (e) {
      // Telegram boot failed (bot not configured server-side, or network).
      // A passive toast left a blank dead screen (W1 J#2) — show a retry
      // surface instead; reload re-runs boot (ensureTelegramIdentity is an
      // upsert, so retrying is safe). Still rethrow so main() doesn't continue
      // with no identity.
      console.error('telegram boot failed:', e);
      dismissSplash();
      const overlay = document.getElementById('boot-error-overlay');
      if (overlay) {
        overlay.classList.remove('hidden');
        document.getElementById('boot-error-retry')?.addEventListener('click', () => window.location.reload());
      } else {
        showToast("Couldn't start KnockKnock. Try again in a moment.");
      }
      throw e;
    }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest` (the touched suites at minimum: the boot suite + any template-coupled fixtures) — green.

- [ ] **Step 5: Commit**

```bash
git add js/app.js index.template.html tests/
git commit -m "fix(web): telegram boot failure gets a Try-again overlay instead of a dead toast"
```

---

### Task 13: Back-button coverage for the branch's overlays

**Files:**
- Modify: `js/telegramChrome.js:23-41` (`resolveBackAction`)
- Test: `tests/telegramChrome.test.js`

**Interfaces:**
- Consumes: existing cancel affordances — `#confirm-modal-cancel-btn` (`js/promptModal.js:66`), `#text-prompt-cancel-btn` (`:19`), `#tg-unlink-cancel-btn` (`js/telegramSettings.js:53`), `#graduation-info-close` (`js/graduation.js:32`), `#tg-invite-error-dismiss` (Task 10), plus `#boot-error-overlay` (Task 12; back = null, nothing behind it).

- [ ] **Step 1: Write the failing tests**

Follow `tests/telegramChrome.test.js`'s existing `resolveBackAction` fixture pattern (it builds a doc with ids and asserts which action wins):

```js
describe('back button covers the W1 overlays (C#1)', () => {
  test.each([
    ['confirm-modal', 'confirm-modal-cancel-btn'],
    ['text-prompt-modal', 'text-prompt-cancel-btn'],
    ['tg-unlink-confirm', 'tg-unlink-cancel-btn'],
    ['graduation-info-toast', 'graduation-info-close'],
    ['tg-invite-error', 'tg-invite-error-dismiss'],
  ])('%s open → back clicks %s', (overlayId, cancelId) => {
    const doc = makeDoc({ visible: [overlayId] }); // the file's existing fixture helper
    const clicked = jest.fn();
    doc.getElementById(cancelId).click = clicked;
    resolveBackAction(doc)();
    expect(clicked).toHaveBeenCalled();
  });

  test('confirm-modal wins over an open group context', () => {
    const doc = makeDoc({ visible: ['confirm-modal'], context: 'group' });
    const clicked = jest.fn();
    doc.getElementById('confirm-modal-cancel-btn').click = clicked;
    resolveBackAction(doc)();
    expect(clicked).toHaveBeenCalled(); // NOT navigateToDirect
  });

  test('boot-error-overlay open → back hidden (null)', () => {
    const doc = makeDoc({ visible: ['boot-error-overlay'] });
    expect(resolveBackAction(doc)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/telegramChrome.test.js` — FAIL (falls through to lower entries).

- [ ] **Step 3: Implement**

At the TOP of `resolveBackAction` (`js/telegramChrome.js:24`, before the `restore-screen` line):

```js
export function resolveBackAction(doc = document) {
  // Confirm/prompt overlays first (W1 C#1): back must dismiss the top-most
  // decision surface with CANCEL semantics — never act on what's underneath,
  // and never confirm. boot-error has nothing behind it → Telegram default.
  if (visible(doc, 'boot-error-overlay')) return null;
  if (visible(doc, 'confirm-modal')) return () => doc.getElementById('confirm-modal-cancel-btn')?.click();
  if (visible(doc, 'text-prompt-modal')) return () => doc.getElementById('text-prompt-cancel-btn')?.click();
  if (visible(doc, 'tg-unlink-confirm')) return () => doc.getElementById('tg-unlink-cancel-btn')?.click();
  if (visible(doc, 'graduation-info-toast')) return () => doc.getElementById('graduation-info-close')?.click();
  if (visible(doc, 'tg-invite-error')) return () => doc.getElementById('tg-invite-error-dismiss')?.click();
  if (visible(doc, 'restore-screen')) return () => doc.getElementById('restore-cancel-btn')?.click();
  // (…rest unchanged…)
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/telegramChrome.test.js` — green (existing ordering tests must still pass; the new entries only ADD higher-priority checks).

- [ ] **Step 5: Commit**

```bash
git add js/telegramChrome.js tests/telegramChrome.test.js
git commit -m "fix(web): Telegram back button dismisses confirm/prompt overlays with cancel semantics"
```

---

### Task 14: Unlink busy state + failure feedback

**Files:**
- Modify: `js/telegramSettings.js:43-76` (`ensureUnlinkConfirmModal` markup + `doUnlink`)
- Test: `tests/telegramSettings.test.js`

**Interfaces:**
- Consumes: `setButtonBusy`/`clearButtonBusy` from `js/utils.js:8-18`; existing `.error-msg` class (used by `#restore-error`, `index.template.html:210`).

- [ ] **Step 1: Write the failing test**

```js
test('unlink failure shows the inline error and re-enables the button (W1 J#7)', async () => {
  callUnlinkTelegram.mockRejectedValue(new Error('network'));
  initTelegramSettings('u1'); // builds the confirm modal
  document.getElementById('tg-unlink-btn').click(); // opens the sheet
  const confirmBtn = document.getElementById('tg-unlink-confirm-btn');
  confirmBtn.click();
  expect(confirmBtn.disabled).toBe(true);
  expect(confirmBtn.textContent).toBe('Unlinking…');
  await flush();
  expect(confirmBtn.disabled).toBe(false);
  expect(confirmBtn.textContent).toBe('Unlink');
  const err = document.getElementById('tg-unlink-error');
  expect(err.classList.contains('hidden')).toBe(false);
  expect(err.textContent).toBe("Couldn't unlink right now. Try again.");
  // sheet stays open for retry/cancel
  expect(document.getElementById('tg-unlink-confirm').classList.contains('hidden')).toBe(false);
});
```

(`callUnlinkTelegram` is already mocked promise-returning in this file per §35.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest tests/telegramSettings.test.js` — FAIL (no error element, no busy label).

- [ ] **Step 3: Implement**

`ensureUnlinkConfirmModal` markup — add the error line before `.confirm-btns`:

```js
  el.innerHTML = `
    <div class="confirm-sheet">
      <h4>Unlink this Telegram?</h4>
      <p>Your account stays yours — sign in with your secret phrase in any browser. This Telegram will start over with a fresh, empty account.</p>
      <p id="tg-unlink-error" class="error-msg hidden"></p>
      <div class="confirm-btns">
        <button class="confirm-btn-cancel" id="tg-unlink-cancel-btn" type="button">Cancel</button>
        <button class="confirm-btn-remove" id="tg-unlink-confirm-btn" type="button">Unlink</button>
      </div>
    </div>`;
```

Also clear the error whenever the sheet opens (in `initTelegramSettings`'s unlink-button click handler):

```js
  accountSlot.querySelector('#tg-unlink-btn').addEventListener('click', () => {
    const err = document.getElementById('tg-unlink-error');
    if (err) { err.textContent = ''; err.classList.add('hidden'); }
    document.getElementById('tg-unlink-confirm').classList.remove('hidden');
  });
```

`doUnlink` (imports: add `setButtonBusy, clearButtonBusy` from `./utils.js`):

```js
async function doUnlink(e) {
  const btn = e.currentTarget;
  const err = document.getElementById('tg-unlink-error');
  if (err) { err.textContent = ''; err.classList.add('hidden'); }
  setButtonBusy(btn, 'Unlinking…');
  try {
    await callUnlinkTelegram(tgWebApp().initData);
    window.location.reload(); // reboot as a fresh derived account
  } catch {
    // W1 J#7: a destructive confirm that visibly does nothing is the worst
    // outcome — restore the button and say what happened; the sheet stays
    // open so the user can retry or cancel.
    clearButtonBusy(btn);
    if (err) { err.textContent = "Couldn't unlink right now. Try again."; err.classList.remove('hidden'); }
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest tests/telegramSettings.test.js` — green.

- [ ] **Step 5: Commit**

```bash
git add js/telegramSettings.js tests/telegramSettings.test.js
git commit -m "fix(web): unlink shows busy state and an inline error instead of failing silently"
```

---

### Task 15: Whole-suite verification + docs

**Files:**
- Modify: `docs/HANDOFF.md` (top block + new rundown section), this plan's checkboxes

- [ ] **Step 1: Run both full suites**

Run: `npx jest` (expect 1408 baseline + all new tests green) and `cd functions && npm test` (207 baseline + new green). Fix any cross-suite fallout before proceeding — a template-fixture drift from Tasks 10/12 is the likely candidate.

- [ ] **Step 2: Reconcile the copy inventory**

Grep each spec copy-inventory string (`docs/superpowers/specs/2026-07-07-telegram-w1-high-tier-ux-design.md` §Copy inventory) and confirm it appears exactly once in source. Straight apostrophes everywhere (`Couldn't`, `isn't`).

- [ ] **Step 3: Update HANDOFF.md**

Top block + new §37: W1 implemented (list the 10 findings), tests counts, UNVERIFIED on-device — the operator's walkthrough is the acceptance gate. Note the A5 redeploy requirement: Tasks 1–6 change branch-only functions.

- [ ] **Step 4: Commit**

```bash
git add docs/HANDOFF.md docs/superpowers/plans/2026-07-07-telegram-w1-high-tier-ux.md
git commit -m "docs(handoff): wave W1 implemented — pending on-device verification"
```

---

## Self-Review (completed at authoring)

- **Spec coverage:** S1 → Tasks 8–11; S2 → Task 12; S3 → Tasks 5–7; S4 → Tasks 1–4; S5 → Task 13; S6 → Task 14; testing section → per-task steps + Task 15. No spec requirement without a task.
- **Placeholders:** none — every step carries code or an exact command. Two deliberate "match the file's existing fixture" notes (Tasks 7, 12, 13) point at named, existing patterns rather than inventing fixture code that would drift from the real harness.
- **Type consistency:** `writeKnock → boolean` (T1) used in T1 only; `resolveSourceMessage(deps, cq, outcome)` (T2) consumed by T3/T4 with matching signature; `stampInviteOutcome/stampedInviteOutcome/redemptionConsumedToken` (T9/T11) consumed by T10/T11 with matching names; `showLinkScreen → Promise<boolean>` (T9) awaited by T10's gate.
- **A5 note:** functions changes are branch-only — they take effect in prod only after the operator's A5 redeploy (docs/telegram-setup.md); on-device verification of Tasks 1–6 needs that redeploy first.
