# Telegram W4 — bot delight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A batch of low-cost, high-delight bot improvements — consistent verb, non-silent replies, code-prefixed actors, a self-registered command menu, honest expired-button copy, truncation hints, status-color circles with app-parity time formatting, and a first-accept beat.

**Architecture:** Mostly `functions/` (bot). New pure logic lives in `functions/presence-core.js` (the dependency-free home): a `statusCircle` quantizer and byte-identical ports of the two `js/utils.js` time formatters, guarded by a shared test-vector fixture. A single `COMMANDS` list feeds both `HELP_TEXT` and a deploy-time `setMyCommands`. One client task (J#15).

**Tech Stack:** Node ES modules (`functions/`), Jest (`cd functions && npm test`, baseline **281**); vanilla ES modules + Jest root (`npx jest`, baseline **1461**) for J#15 and the client side of the shared time fixture.

## Global Constraints

- Do NOT touch the three-reader notify predicate `channel !== 'push'` (`functions/notifier.js:43`, `js/notifySuppression.js`, `js/notifyChannel.js`). B#10 edits `resolveName` only.
- Do NOT merge to `dev`/`main` or open a PR.
- TDD red-before-green; keep both suites green (functions 281, root 1461) after each task.
- Analysis line numbers have drifted — locate by symbol/string.
- Easter-egg emoji set (B#8), exact: `🐥 🍑 🍆 💦 🫦 🌚` (U+1F425, U+1F351, U+1F346, U+1F4A6, U+1FAE6, U+1F31A). Extensible via one array entry.
- The leading status dot means "this subject is available, in their status color," on every command. Unavailable = no dot. Fallback 🟢 when color missing/invalid.
- B#11 `setMyCommands` only takes effect after an **A5 redeploy** (`docs/telegram-setup.md`); not verifiable in-conversation.
- Green suites necessary, not sufficient: the operator's on-device bot walkthrough is the acceptance gate.

---

### Task 1: C#7 — group-invite keyboard "Accept" → "Join"

**Files:**
- Modify: `functions/telegram.js` (the `invite` case of `buildNotificationKeyboard`, ~:36-39)
- Test: `functions/test/telegram.test.js`

- [ ] **Step 1: Failing test.** Add/adjust a test asserting the invite keyboard's first button text:

```js
test('invite keyboard uses Join / Decline', () => {
  const kb = buildNotificationKeyboard('invite', { groupId: 'g1' });
  expect(kb[0][0].text).toBe('Join');
  expect(kb[0][1].text).toBe('Decline');
});
```

- [ ] **Step 2: Run → fail.** `cd functions && npx jest test/telegram.test.js -t "Join / Decline"` — FAIL (currently `Accept`).

- [ ] **Step 3: Implement.** In `functions/telegram.js`, the `invite` case: `{ text: 'Accept', callback_data: … }` → `{ text: 'Join', callback_data: `invite_accept:${data.groupId}` }`. Leave the `callback_data` action `invite_accept` unchanged (only the visible label changes). Update any other test asserting `'Accept'` for the invite keyboard.

- [ ] **Step 4: Run → pass.** `cd functions && npx jest test/telegram.test.js`

- [ ] **Step 5: Commit.**
```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "fix(bot): group-invite keyboard says Join (matches the web inbox)"
```

---

### Task 2: B#8 — easter-egg reply to non-text private messages

**Files:**
- Modify: `functions/telegram.js` (`pickPlayfulEmoji` new pure fn; the `handleMessage` guard ~:101)
- Test: `functions/test/telegram.test.js`

**Interfaces:**
- Produces: `export function pickPlayfulEmoji(rand = Math.random): string`.

- [ ] **Step 1: Failing test.**
```js
import { pickPlayfulEmoji } from '../telegram.js';
const SET = ['🐥','🍑','🍆','💦','🫦','🌚'];
test('pickPlayfulEmoji returns a member of the set', () => {
  expect(SET).toContain(pickPlayfulEmoji(() => 0));
  expect(SET).toContain(pickPlayfulEmoji(() => 0.999));
});
test('non-text private message gets the easter-egg reply', async () => {
  const reply = await runMessage({ chat: { id: 5, type: 'private' }, from: { id: 9 }, sticker: {} });
  expect(reply.text).toMatch(/^Someone else might enjoy that .+ — try \/help\.$/);
  expect(SET.some((e) => reply.text.includes(e))).toBe(true);
});
test('group / no-from messages still get no reply', async () => {
  expect(await runMessage({ chat: { id: 5, type: 'group' }, from: { id: 9 }, text: '/who' })).toBeUndefined();
});
```
(`runMessage` = the harness the existing telegram tests use to drive `handleMessage`/`handleUpdate` and capture the webhook-reply payload; reuse it.)

- [ ] **Step 2: Run → fail.** `cd functions && npx jest test/telegram.test.js -t "easter-egg"`

- [ ] **Step 3: Implement.** In `functions/telegram.js`:
```js
const PLAYFUL_EMOJI = ['🐥', '🍑', '🍆', '💦', '🫦', '🌚']; // extend here
export function pickPlayfulEmoji(rand = Math.random) {
  return PLAYFUL_EMOJI[Math.floor(rand() * PLAYFUL_EMOJI.length)];
}
```
Change the `handleMessage` guard so a **private** message that is missing `text` (but has `from`) replies instead of silently returning:
```js
async function handleMessage(deps, msg) {
  if (msg.chat?.type !== 'private' || !msg.from) return undefined;
  const chatId = String(msg.chat.id);
  if (typeof msg.text !== 'string') {
    return { chat_id: chatId, text: `Someone else might enjoy that ${pickPlayfulEmoji()} — try /help.` };
  }
  // …existing text-command path unchanged…
}
```
Keep the non-private / no-`from` early return exactly as today.

- [ ] **Step 4: Run → pass.** `cd functions && npx jest test/telegram.test.js`
- [ ] **Step 5: Commit.**
```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "feat(bot): playful one-liner reply to non-text private messages instead of silence"
```

---

### Task 3: B#10 — prefix bare share codes in actor names

**Files:**
- Modify: `functions/notifier.js` (`resolveName` ~:80-84)
- Test: `functions/test/notifier.test.js`

- [ ] **Step 1: Failing test.**
```js
test('resolveName prefixes a bare share-code fallback', async () => {
  const deps = fakeDeps({ [`users/u2/presence/code`]: 'K7Q2ZP' }); // no label anywhere
  expect(await resolveName(deps, 'u1', 'u2')).toBe('Your contact K7Q2ZP');
});
test('resolveName returns a real label unchanged', async () => {
  const deps = fakeDeps({ [`userPrefs/u1/following/u2`]: { label: 'Ana' } });
  expect(await resolveName(deps, 'u1', 'u2')).toBe('Ana');
});
```
(Match `fakeDeps`/getVal seeding to the existing notifier tests; use whatever label path `resolveName` reads first.)

- [ ] **Step 2: Run → fail.** `cd functions && npx jest test/notifier.test.js -t "share-code"`

- [ ] **Step 3: Implement.** In `functions/notifier.js` `resolveName`, change the code fallback:
```js
const code = await deps.getVal(`users/${targetUid}/presence/code`);
if (code) return `Your contact ${code}`; // B#10: a bare code reads like a glitch in chat
```
Only this fallback branch changes. Real labels (returned earlier in `resolveName`) are untouched. Follow-request/invite/availability names resolve via `resolveGroupMemberName` and are deliberately NOT prefixed (a follow-request actor is a stranger, not a contact).

- [ ] **Step 4: Run → pass.** `cd functions && npx jest test/notifier.test.js`
- [ ] **Step 5: Commit.**
```bash
git add functions/notifier.js functions/test/notifier.test.js
git commit -m "fix(bot): unlabeled knock/call actors read 'Your contact <code>' instead of a bare code"
```

---

### Task 4: B#12 — expired-button copy

**Files:**
- Modify: `functions/telegram.js` (the `answer('Unknown action.')` guard ~:422, and any twin site)
- Test: `functions/test/telegram.test.js`

- [ ] **Step 1: Failing test.**
```js
test('unknown/malformed callback answers the expired-button copy', async () => {
  const answers = [];
  await handleCallback(depsWith({ answerCallbackQuery: (_id, t) => answers.push(t) }),
    { id: 'c1', from: { id: 9 }, data: 'bogus:zzz' }); // mapped user, bad action
  expect(answers).toContain('This button has expired — try /help.');
});
```
(Seed a mapped `telegramUsers/9` so it passes the `Open KnockKnock first.` guard and reaches the action check.)

- [ ] **Step 2: Run → fail.** `cd functions && npx jest test/telegram.test.js -t "expired-button"`

- [ ] **Step 3: Implement.** Replace `await answer('Unknown action.')` with `await answer('This button has expired — try /help.')` at both occurrences. Leave `answer('Open KnockKnock first.')` (the unlinked guard) unchanged.

- [ ] **Step 4: Run → pass.** `cd functions && npx jest test/telegram.test.js`
- [ ] **Step 5: Commit.**
```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "fix(bot): stale/unknown callback buttons say 'This button has expired — try /help.'"
```

---

### Task 5: B#13 — truncation hints on the 8-item keyboards

**Files:**
- Modify: `functions/telegram.js` (`/knock` "Which one?" ~:376 and `knockGroupReach` "Which one?" ~:350; both `slice(0, 8)`)
- Test: `functions/test/telegram.test.js`

- [ ] **Step 1: Failing test.**
```js
test('/knock disambiguation appends a truncation hint past 8', async () => {
  // 10 followers whose labels all match the query
  const reply = await runKnock(/* 10 matches */);
  expect(reply.text).toBe('Which one? …and 2 more — type more letters.');
  expect(reply.reply_markup.inline_keyboard).toHaveLength(8);
});
test('8 or fewer matches → no hint', async () => {
  const reply = await runKnock(/* 8 matches */);
  expect(reply.text).toBe('Which one?');
});
```
(Adapt the message text expectation to how the "Which one?" reply is currently phrased; the assertion is: base text when ≤8, base + hint when >8.)

- [ ] **Step 2: Run → fail.** `cd functions && npx jest test/telegram.test.js -t "truncation"`

- [ ] **Step 3: Implement.** At each `slice(0, 8)` site, compute overflow and append a hint:
```js
const CAP = 8;
const overflow = matches.length - CAP;
const text = overflow > 0 ? `Which one? …and ${overflow} more — type more letters.` : 'Which one?';
await reply(text, { reply_markup: { inline_keyboard: matches.slice(0, CAP).map(/* … */) } });
```
Apply the same at `knockGroupReach`'s `found.slice(0, 8)`.

- [ ] **Step 4: Run → pass.** `cd functions && npx jest test/telegram.test.js`
- [ ] **Step 5: Commit.**
```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "feat(bot): 'Which one?' keyboards show '…and N more' when they overflow the 8-item cap"
```

---

### Task 6: B#11 — one `COMMANDS` source feeding `HELP_TEXT` + `setMyCommands`

**Files:**
- Modify: `functions/telegram.js` (introduce `COMMANDS`, derive `HELP_TEXT`, export `botCommandsPayload`)
- Modify: `functions/index.js` (new `setBotCommands` deploy-time function)
- Modify: `docs/telegram-setup.md` (replace the manual BotFather `/setcommands` paste)
- Test: `functions/test/telegram.test.js`

**Interfaces:**
- Produces: `export const COMMANDS` (`[{command, args, description}]`); `export function botCommandsPayload()` → `[{command, description}]` for `setMyCommands`.

- [ ] **Step 1: Failing test.**
```js
import { HELP_TEXT, COMMANDS, botCommandsPayload } from '../telegram.js';
test('HELP_TEXT derives from COMMANDS, byte-identical to today', () => {
  expect(HELP_TEXT).toBe([
    'KnockKnock commands:',
    '/status [group] [30m|2h] — go available (default 1h)',
    '/off [group] — go unavailable',
    "/who [group] — who's available now",
    '/knock <name> — send a knock (searches your people, then your groups)',
    '/groups — your groups',
    '/notifications push|telegram — where notifications go',
    '/help — this list',
  ].join('\n'));
});
test('botCommandsPayload → bare command + arg-hinted description', () => {
  expect(botCommandsPayload()).toContainEqual({ command: 'status', description: '[group] [30m|2h] — go available (default 1h)' });
  botCommandsPayload().forEach((c) => { expect(c.command).not.toMatch(/\//); expect(c.description.length).toBeLessThanOrEqual(256); });
});
```

- [ ] **Step 2: Run → fail.** `cd functions && npx jest test/telegram.test.js -t COMMANDS`

- [ ] **Step 3: Implement the source of truth.** In `functions/telegram.js`, replace the literal `HELP_TEXT` array with:
```js
export const COMMANDS = [
  { command: 'status',        args: '[group] [30m|2h]', description: 'go available (default 1h)' },
  { command: 'off',           args: '[group]',          description: 'go unavailable' },
  { command: 'who',           args: '[group]',          description: "who's available now" },
  { command: 'knock',         args: '<name>',           description: 'send a knock (searches your people, then your groups)' },
  { command: 'groups',        args: '',                 description: 'your groups' },
  { command: 'notifications', args: 'push|telegram',    description: 'where notifications go' },
  { command: 'help',          args: '',                 description: 'this list' },
];
const cmdLine = (c) => `/${c.command}${c.args ? ` ${c.args}` : ''} — ${c.description}`;
export const HELP_TEXT = ['KnockKnock commands:', ...COMMANDS.map(cmdLine)].join('\n');
export function botCommandsPayload() {
  return COMMANDS.map((c) => ({
    command: c.command,
    description: (c.args ? `${c.args} — ${c.description}` : c.description).slice(0, 256),
  }));
}
```

- [ ] **Step 4: Run → pass.** `cd functions && npx jest test/telegram.test.js -t COMMANDS`

- [ ] **Step 5: Add the deploy-time registration function.** In `functions/index.js`, export a callable/HTTP function that pushes the menu (reuse the existing `tgApi` helper):
```js
import { botCommandsPayload } from './telegram.js';
// Run once per deploy (A5 redeploy step) to register the "/" command menu from
// the single COMMANDS source of truth — replaces the manual BotFather paste.
export const setBotCommands = onRequest(async (_req, res) => {
  if (!process.env.TELEGRAM_BOT_TOKEN) { res.status(503).send('bot not configured'); return; }
  await tgApi('setMyCommands', { commands: botCommandsPayload() });
  res.status(200).send('ok');
});
```
(Match the file's existing `onRequest`/`tgApi` usage and auth conventions; if the repo prefers a guarded endpoint, mirror `telegramWebhook`'s secret check.)

- [ ] **Step 6: Update the runbook.** In `docs/telegram-setup.md`, replace the manual `/setcommands` BotFather paste (both the test-bot ~:65 and prod-bot ~:365 sections) with a note to hit the `setBotCommands` function after deploy, and remove the drift-prone hand-maintained list.

- [ ] **Step 7: Full functions suite.** `cd functions && npm test` — 281 + new.
- [ ] **Step 8: Commit.**
```bash
git add functions/telegram.js functions/index.js docs/telegram-setup.md functions/test/telegram.test.js
git commit -m "feat(bot): COMMANDS source of truth feeds HELP_TEXT and a deploy-time setMyCommands"
```

**Verification note:** menu change is only visible after the A5 redeploy + hitting `setBotCommands`.

---

### Task 7: B#14a — port the two time formatters into `presence-core.js` with a shared fixture

**Files:**
- Create: `test-fixtures/time-format-vectors.json` (repo root; imported by both test roots)
- Modify: `functions/presence-core.js` (add byte-identical `formatTimeRemaining`, `formatTimeRemainingFuzzy`, `HOUR_WORDS`, `hourWord`)
- Test: `functions/test/presence-core.test.js` (functions copy) and `tests/utils.test.js` (the `js/utils.js` originals)

**Interfaces:**
- Produces (in `functions/presence-core.js`): `export function formatTimeRemaining(ms)`, `export function formatTimeRemainingFuzzy(ms)` — identical behavior to `js/utils.js`.

- [ ] **Step 1: Create the shared fixture.** `test-fixtures/time-format-vectors.json`:
```json
[
  { "ms": 30000,    "precise": "< 1m",   "fuzzy": "just a few minutes" },
  { "ms": 240000,   "precise": "4m",     "fuzzy": "just a few minutes" },
  { "ms": 1800000,  "precise": "30m",    "fuzzy": "about half an hour" },
  { "ms": 3600000,  "precise": "1h",     "fuzzy": "about an hour" },
  { "ms": 5400000,  "precise": "1h 30m", "fuzzy": "one to two hours" },
  { "ms": 7200000,  "precise": "2h",     "fuzzy": "just over two hours" },
  { "ms": 9000000,  "precise": "2h 30m", "fuzzy": "about three hours" },
  { "ms": 10800000, "precise": "3h",     "fuzzy": "just over three hours" },
  { "ms": 13500000, "precise": "3h 45m", "fuzzy": "nearly four hours" }
]
```

- [ ] **Step 2: Pin the `js/utils.js` originals to the fixture (should already pass).** In `tests/utils.test.js`:
```js
import vectors from '../test-fixtures/time-format-vectors.json';
import { formatTimeRemaining, formatTimeRemainingFuzzy } from '../js/utils.js';
test.each(vectors)('js/utils time vectors: %j', ({ ms, precise, fuzzy }) => {
  expect(formatTimeRemaining(ms)).toBe(precise);
  expect(formatTimeRemainingFuzzy(ms)).toBe(fuzzy);
});
```
Run: `npx jest tests/utils.test.js` — PASS (proves the fixture matches the source of truth before copying).

- [ ] **Step 3: Failing test for the functions copy.** In `functions/test/presence-core.test.js`:
```js
import vectors from '../../test-fixtures/time-format-vectors.json';
import { formatTimeRemaining, formatTimeRemainingFuzzy } from '../presence-core.js';
test.each(vectors)('presence-core time vectors: %j', ({ ms, precise, fuzzy }) => {
  expect(formatTimeRemaining(ms)).toBe(precise);
  expect(formatTimeRemainingFuzzy(ms)).toBe(fuzzy);
});
```
Run: `cd functions && npx jest test/presence-core.test.js -t "time vectors"` — FAIL (not exported yet).

- [ ] **Step 4: Copy the formatters verbatim.** Paste `formatTimeRemaining`, `HOUR_WORDS`, `hourWord`, `formatTimeRemainingFuzzy` from `js/utils.js:87-115` into `functions/presence-core.js` unchanged. Add a cross-reference comment on BOTH copies: `// DUPLICATED in <other file> — keep byte-identical (shared fixture: test-fixtures/time-format-vectors.json).`

- [ ] **Step 5: Run both → pass.** `cd functions && npx jest test/presence-core.test.js` and `npx jest tests/utils.test.js`.
- [ ] **Step 6: Commit.**
```bash
git add test-fixtures/time-format-vectors.json functions/presence-core.js js/utils.js tests/utils.test.js functions/test/presence-core.test.js
git commit -m "refactor(bot): port app time formatters into presence-core with a shared drift-guard fixture"
```

---

### Task 8: B#14b — `statusCircle(hex)` quantizer

**Files:**
- Modify: `functions/presence-core.js`
- Test: `functions/test/presence-core.test.js`

**Interfaces:**
- Produces: `export function statusCircle(hex): string` (a single emoji). Missing/invalid → `🟢`.

- [ ] **Step 1: Failing test** (the 16 palette keys + fallbacks, values pinned to the approved mapping):
```js
import { statusCircle } from '../presence-core.js';
const cases = [
  ['#22c55e','🟢'],['#3b82f6','🔵'],['#818cf8','🔵'],['#f97316','🟠'],
  ['#f43f5e','🔴'],['#06b6d4','🔵'],['#eab308','🟡'],['#10b981','🟢'],
  ['#aaff00','🟢'],['#ff1aad','🔴'],['#0055ff','🔵'],['#00ff66','🟢'],
  ['#ff3300','🔴'],['#00e5ff','🔵'],['#ffdd00','🟡'],['#8800ff','🟣'],
  ['#fce7f3','⚪'],
];
test.each(cases)('statusCircle(%s) = %s', (hex, circle) => expect(statusCircle(hex)).toBe(circle));
test('missing/invalid → green fallback', () => {
  expect(statusCircle(null)).toBe('🟢');
  expect(statusCircle('nope')).toBe('🟢');
});
```

- [ ] **Step 2: Run → fail.** `cd functions && npx jest test/presence-core.test.js -t statusCircle`

- [ ] **Step 3: Implement** (the exact rule the operator reviewed against all 92 swatches):
```js
export function statusCircle(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '🟢';
  const r = parseInt(m[1].slice(0, 2), 16), g = parseInt(m[1].slice(2, 4), 16), b = parseInt(m[1].slice(4, 6), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2 / 255;
  if (d < 30) return l > 0.82 ? '⚪' : l < 0.18 ? '⚫' : '⚪';
  let h; if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  if (l < 0.28 && h >= 18 && h <= 45) return '🟤';
  if (h < 15 || h >= 340) return '🔴';
  if (h < 45) return '🟠';
  if (h < 68) return '🟡';
  if (h < 170) return '🟢';
  if (h < 250) return '🔵';
  if (h < 292) return '🟣';
  return '🔴'; // magenta folds to red
}
```

- [ ] **Step 4: Run → pass.** `cd functions && npx jest test/presence-core.test.js`
- [ ] **Step 5: Commit.**
```bash
git add functions/presence-core.js functions/test/presence-core.test.js
git commit -m "feat(bot): statusCircle quantizes a status-color hex to a Telegram circle emoji"
```

---

### Task 9: B#14c — `/who` and `/who <group>` show color + fuzzy time

**Files:**
- Modify: `functions/telegram.js` (`handleSocialCommand` `/who` ~:362-366; `handleWhoGroup` ~:316-324)
- Test: `functions/test/telegram.test.js`

**Interfaces:**
- Consumes: `statusCircle`, `formatTimeRemainingFuzzy` from `presence-core.js`; `effectiveAvailable`, `primaryAvailable` (already imported).

- [ ] **Step 1: Failing test.**
```js
test('/who shows each person color circle + fuzzy remaining', async () => {
  // Ana available with statusColor #3b82f6 and ~30m left; Dee available, no color, ~4m
  const reply = await runWho(/* seed */);
  expect(reply.text).toBe('Available now:\n🔵 Ana — about half an hour left\n🟢 Dee — just a few minutes left');
});
test('/who <group> uses effective (override) color + time', async () => {
  const reply = await runWhoGroup(/* member with enabled override statusColor #8800ff, ~2h left */);
  expect(reply.text).toContain('🟣 ');
  expect(reply.text).toContain('just over two hours left');
});
```

- [ ] **Step 2: Run → fail.** `cd functions && npx jest test/telegram.test.js -t "/who"`

- [ ] **Step 3: Implement `/who` (Direct).** In the `/who` branch, replace the `🟢 ${label}` line:
```js
const lines = (await Promise.all(following.map(async (entry) => {
  const presence = await deps.getVal(`users/${entry.userId}/presence`);
  if (!primaryAvailable(presence, deps.now())) return null;
  const remaining = formatTimeRemainingFuzzy(presence.availableUntil - deps.now());
  const tail = remaining ? ` — ${remaining} left` : '';
  return `${statusCircle(presence.statusColor)} ${entry.label || entry.code}${tail}`;
}))).filter(Boolean);
```

- [ ] **Step 4: Implement `/who <group>`.** In `handleWhoGroup`, compute the member's effective color + remaining:
```js
const lines = (await Promise.all(coMembers.map(async ([mid, m]) => {
  const presence = await deps.getVal(`users/${mid}/presence`);
  if (!effectiveAvailable(m?.statusOverride, presence?.status, presence?.availableUntil, deps.now())) return null;
  const ov = m?.statusOverride;
  const on = ov && ov.enabled === true;
  const color = on ? ov.statusColor : presence?.statusColor;
  const until = on ? ov.availableUntil : presence?.availableUntil;
  const remaining = formatTimeRemainingFuzzy(until - deps.now());
  const tail = remaining ? ` — ${remaining} left` : '';
  return `${statusCircle(color)} ${m?.displayName || 'Someone'}${tail}`;
}))).filter(Boolean);
```
Import `statusCircle` and `formatTimeRemainingFuzzy`. Leave the header and empty-state strings unchanged.

- [ ] **Step 5: Run → pass.** `cd functions && npx jest test/telegram.test.js`
- [ ] **Step 6: Commit.**
```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "feat(bot): /who shows each person's status-color circle and fuzzy time remaining"
```

---

### Task 10: B#14d — `/status`, `/status <group>`, `/start` echo (color + precise time + /off hint)

**Files:**
- Modify: `functions/telegram.js` (`/start` echo ~:139; `/status` global confirm ~:165; `handleGroupStatus` confirm ~:292)
- Test: `functions/test/telegram.test.js`

**Interfaces:**
- Consumes: `statusCircle`, `formatTimeRemaining`.

- [ ] **Step 1: Failing test.**
```js
test('/status confirm: dot + precise duration + /off hint', async () => {
  const reply = await runStatus('2h', { statusColor: '#3b82f6' });
  expect(reply.text).toBe("You're 🔵 available for 2h. /off to stop.");
});
test('/status <group> confirm: dot + duration + /off <group> hint', async () => {
  const reply = await runGroupStatus('Divers', 120, { overrideColor: '#8800ff' });
  expect(reply.text).toBe("You're 🟣 available in Divers for 2h. /off Divers to stop.");
});
test('/start echo: dot + precise remaining', async () => {
  const reply = await runStart({ available: true, statusColor: '#3b82f6', remainingMs: 5400000 });
  expect(reply.text).toBe("You're 🔵 available for another 1h 30m. /off to stop.");
});
```

- [ ] **Step 2: Run → fail.** `cd functions && npx jest test/telegram.test.js -t "confirm"`

- [ ] **Step 3: Implement.**
- `/start` echo (available branch): read the user's `presence.statusColor` (already have `presence`), and render:
```js
await reply(`You're ${statusCircle(presence.statusColor)} available for another ${formatTimeRemaining(presence.availableUntil - deps.now())}. /off to stop.`, openAppKeyboard(deps.appUrl));
```
- `/status` global confirm: read `presence.statusColor` (one extra `deps.getVal('users/${uid}/presence/statusColor')` on this path since the handler doesn't already hold presence), then:
```js
await reply(`You're ${statusCircle(color)} available for ${formatTimeRemaining(asDuration * 60000)}. /off to stop.`);
```
- `handleGroupStatus` confirm: the effective color for the group is the override's `statusColor` (this command just wrote the override). Pass it into the `confirm` message:
```js
confirm: (name) => `You're ${statusCircle(overrideColor)} available in ${name} for ${formatTimeRemaining(minutes * 60000)}. /off ${name} to stop.`,
```
Thread `overrideColor` from the override the command reads/writes (fall back to the user's primary `statusColor` if the override carries none). Leave `/off` replies (unavailable — no dot) unchanged.

- [ ] **Step 4: Run → pass.** `cd functions && npx jest test/telegram.test.js`
- [ ] **Step 5: Commit.**
```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "feat(bot): /status, /status <group>, /start echo show the status-color dot + precise time (+ /off <group> hint)"
```

---

### Task 11: B#14e — restructure `/groups`

**Files:**
- Modify: `functions/telegram.js` (`/groups` handler ~:383-396)
- Test: `functions/test/telegram.test.js`

**Interfaces:**
- Consumes: `statusCircle`, `formatTimeRemaining`, `effectiveAvailable`.

- [ ] **Step 1: Failing test.**
```js
test('/groups: dotted available rows then one Unavailable summary', async () => {
  // Divers available (override color #3b82f6, ~1h35m), Book Club available (#f97316, ~45m),
  // Hiking + Chess unavailable
  const reply = await runGroups(/* seed */);
  expect(reply.text).toBe('🔵 Divers — 1h 35m left\n🟠 Book Club — 45m left\nUnavailable in Hiking, Chess');
});
test('/groups: all available → no summary line', async () => {
  const reply = await runGroups(/* two available */);
  expect(reply.text).not.toContain('Unavailable in');
});
test('/groups: all unavailable → only the summary line', async () => {
  const reply = await runGroups(/* all off */);
  expect(reply.text).toBe('Unavailable in Divers, Book Club');
});
```

- [ ] **Step 2: Run → fail.** `cd functions && npx jest test/telegram.test.js -t "/groups"`

- [ ] **Step 3: Implement.** Replace the `/groups` line-builder:
```js
const rows = await Promise.all(groupIds.map(async (gid) => {
  const [name, override] = await Promise.all([
    deps.getVal(`groups/${gid}/name`),
    deps.getVal(`groups/${gid}/members/${uid}/statusOverride`),
  ]);
  const on = effectiveAvailable(override, presence?.status, presence?.availableUntil, deps.now());
  const enabled = override && override.enabled === true;
  const color = enabled ? override.statusColor : presence?.statusColor;
  const until = enabled ? override.availableUntil : presence?.availableUntil;
  return { name: name || gid, on, color, until };
}));
const availLines = rows.filter((r) => r.on)
  .map((r) => {
    const remaining = formatTimeRemaining(r.until - deps.now());
    return `${statusCircle(r.color)} ${r.name}${remaining ? ` — ${remaining} left` : ''}`;
  });
const offNames = rows.filter((r) => !r.on).map((r) => r.name);
const parts = [...availLines];
if (offNames.length) parts.push(`Unavailable in ${offNames.join(', ')}`);
await reply(parts.join('\n'));
```
Leave the `No groups yet — create one in the app.` early-return unchanged.

- [ ] **Step 4: Run → pass.** `cd functions && npx jest test/telegram.test.js`
- [ ] **Step 5: Full functions suite.** `cd functions && npm test` — 281 + new.
- [ ] **Step 6: Commit.**
```bash
git add functions/telegram.js functions/test/telegram.test.js
git commit -m "feat(bot): /groups lists available groups with color dot + time, unavailable ones in one summary line"
```

---

### Task 12: J#15 — first-accept "tap to knock" beat (client)

**Files:**
- Modify: `js/app.js` (`handleInviteRedemptionResult` success path ~:462-467; mirror the existing linked-redeem toast ~:633-637)
- Test: `tests/` (a new `tests/app-first-follow.test.js` or the existing redemption test)

**Interfaces:**
- Consumes: the existing toast helper used by the "You're now following …" linked-redeem path.

- [ ] **Step 1: Failing test.**
```js
test('first newcomer accept shows the tap-to-knock beat once', () => {
  sessionStorage.clear();
  handleInviteRedemptionResult({ ok: true, targetName: 'Ana', newcomer: true });
  expect(lastToast()).toBe("You're following Ana — tap their card to knock.");
  expect(sessionStorage.getItem('kk-first-follow')).toBeTruthy();
});
test('subsequent accept with the marker set shows no beat', () => {
  sessionStorage.setItem('kk-first-follow', '1');
  handleInviteRedemptionResult({ ok: true, targetName: 'Bo', newcomer: true });
  expect(lastToast()).toBeNull();
});
```
(Match the real `handleInviteRedemptionResult` signature and the toast-capture the existing app tests use.)

- [ ] **Step 2: Run → fail.** `npx jest tests/app-first-follow.test.js`

- [ ] **Step 3: Implement.** In the success branch of `handleInviteRedemptionResult` (the newcomer path that currently shows nothing), add a one-time beat gated by sessionStorage, reusing the same toast call the linked-redeem path uses:
```js
const FIRST_FOLLOW_KEY = 'kk-first-follow';
// … in the success/newcomer branch:
if (!sessionStorage.getItem(FIRST_FOLLOW_KEY)) {
  try { sessionStorage.setItem(FIRST_FOLLOW_KEY, '1'); } catch {}
  showToast(`You're following ${targetName} — tap their card to knock.`); // same helper as the linked-redeem toast
}
```
Use the exact toast helper name from the `app.js:633-637` "You're now following …" path.

- [ ] **Step 4: Run → pass.** `npx jest tests/app-first-follow.test.js`
- [ ] **Step 5: Full root suite.** `npx jest` — 1461 + new.
- [ ] **Step 6: Commit.**
```bash
git add js/app.js tests/app-first-follow.test.js
git commit -m "feat(web): first-accept beat points the newcomer at the knock loop, once"
```

---

## Self-Review

**Spec coverage:** C#7 (T1), B#8 (T2), B#10 (T3), B#12 (T4), B#13 (T5), B#11 COMMANDS+setMyCommands (T6), B#14 formatters (T7), statusCircle (T8), /who + /who <group> (T9), /status + group + /start (T10), /groups (T11), J#15 (T12). B#7 correctly absent (cut). Every spec item mapped.

**Placeholder scan:** Test harness helpers (`runMessage`, `runWho`, `fakeDeps`, `showToast`, `lastToast`) reference existing test/app utilities the implementer wires to the real names — flagged inline, not silent TBDs. No "TODO/handle edge cases".

**Type consistency:** `statusCircle(hex)→string`, `formatTimeRemaining(ms)/formatTimeRemainingFuzzy(ms)→string` used identically across T7–T11. `COMMANDS`/`botCommandsPayload`/`HELP_TEXT` names consistent T6. Effective-color/until derivation (`override.enabled === true ? override.* : presence.*`) identical in T9/T10/T11.

**Landmine check:** only `resolveName` touched in `notifier.js` (T3); the `channel !== 'push'` predicate at `notifier.js:43` is untouched.

**Ordering:** shared units (T7 formatters, T8 statusCircle) precede their consumers (T9–T11). Independent items (T1–T6, T12) can run in any order.
