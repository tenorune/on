import { jest } from '@jest/globals';
import { makeStoreDeps as makeCoreStoreDeps } from './store-deps.js';
import { buildNotificationKeyboard, handleUpdate, parseDurationMinutes, webhookAuthorized, resolveSourceMessage, pickPlayfulEmoji, HELP_TEXT, COMMANDS, botCommandsPayload } from '../telegram.js';
import { GROUP_ID_RE, UID_RE } from '../telegram-shared.js';

// B#11 (Spec 2 Task 6): COMMANDS is the single source of truth feeding both
// HELP_TEXT (chat reply) and botCommandsPayload (deploy-time setMyCommands) —
// replacing a hand-maintained BotFather list that could drift from /help.
describe('COMMANDS', () => {
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
  test('botCommandsPayload has one entry per COMMANDS entry, in order', () => {
    expect(botCommandsPayload().map((c) => c.command)).toEqual(COMMANDS.map((c) => c.command));
  });
});

// The id-format regexes are the callback trust boundary (Admin-SDK writes
// bypass DB rules) — functions/ keeps ONE copy, in telegram-shared.js.
describe('shared id-format regexes', () => {
  test('GROUP_ID_RE: 8 chars of A-Z0-9 exactly', () => {
    expect(GROUP_ID_RE.test('AAAA1111')).toBe(true);
    expect(GROUP_ID_RE.test('aaaa1111')).toBe(false);
    expect(GROUP_ID_RE.test('AAAA111')).toBe(false);
    expect(GROUP_ID_RE.test('AAAA11111')).toBe(false);
  });
  test('UID_RE: 32 lowercase hex exactly', () => {
    expect(UID_RE.test('f'.repeat(32))).toBe(true);
    expect(UID_RE.test('F'.repeat(32))).toBe(false);
    expect(UID_RE.test('f'.repeat(31))).toBe(false);
    expect(UID_RE.test('g'.repeat(32))).toBe(false);
  });
});

const APP = 'https://app.example.com';

describe('buildNotificationKeyboard', () => {
  test('knock → Knock back callback', () => {
    expect(buildNotificationKeyboard({ type: 'knock', targetUid: 'u9' }, APP))
      .toEqual([[{ text: 'Knock back', callback_data: 'knock:u9' }]]);
  });
  test('availability → Knock callback', () => {
    expect(buildNotificationKeyboard({ type: 'availability', targetUid: 'u9' }, APP))
      .toEqual([[{ text: 'Knock', callback_data: 'knock:u9' }]]);
  });
  test('call → web_app deep link', () => {
    expect(buildNotificationKeyboard({ type: 'call', targetUid: 'u9' }, APP))
      .toEqual([[{ text: 'Answer in KnockKnock', web_app: { url: APP } }]]);
  });
  test('call with no app url → null (plain text message)', () => {
    expect(buildNotificationKeyboard({ type: 'call', targetUid: 'u9' }, '')).toBeNull();
  });
  test('invite keyboard uses Join / Decline', () => {
    expect(buildNotificationKeyboard({ type: 'invite', targetUid: 'u9', groupId: 'G1' }, APP))
      .toEqual([[
        { text: 'Join', callback_data: 'invite_accept:G1' },
        { text: 'Decline', callback_data: 'invite_decline:G1' },
      ]]);
  });
  test('followRequest → approve/decline', () => {
    expect(buildNotificationKeyboard({ type: 'followRequest', targetUid: 'u9' }, APP))
      .toEqual([[
        { text: 'Approve', callback_data: 'fr_approve:u9' },
        { text: 'Decline', callback_data: 'fr_decline:u9' },
      ]]);
  });
  test('unknown type → null', () => {
    expect(buildNotificationKeyboard({ type: 'mystery' }, APP)).toBeNull();
  });
  test('knock with contextGroupId → 3-segment callback', () => {
    expect(buildNotificationKeyboard({ type: 'knock', targetUid: 'u9', contextGroupId: 'G1' }, APP))
      .toEqual([[{ text: 'Knock back', callback_data: 'knock:u9:G1' }]]);
  });
  test('availability with contextGroupId → 3-segment callback', () => {
    expect(buildNotificationKeyboard({ type: 'availability', targetUid: 'u9', contextGroupId: 'G1' }, APP))
      .toEqual([[{ text: 'Knock', callback_data: 'knock:u9:G1' }]]);
  });
});

function makeBotDeps(store = {}) {
  return {
    ...makeCoreStoreDeps(store),
    now: () => 1_000_000,
    appUrl: 'https://app.example.com',
    generateCode: () => 'AAAAAA',
    uidSecret: 'test-uid-secret', // F1 (#287): ensureTelegramUser derives via this

    tg: {
      sendMessage: jest.fn(async () => ({})),
      answerCallbackQuery: jest.fn(async () => ({})),
      editMessageText: jest.fn(async () => ({})),
    },
  };
}
const msgUpdate = (text, from = { id: 42, first_name: 'Ada' }) =>
  ({ message: { text, from, chat: { id: 42, type: 'private' } } });

// A registered user for command tests: mapping + presence exist.
function seedUser(store, uid = 'u-tg-42') {
  store['telegramUsers/42'] = { uid, chatId: '42' };
  store[`users/${uid}/presence`] = { code: 'AAAAAA', status: 'unavailable', availableUntil: null };
  return uid;
}

describe('parseDurationMinutes', () => {
  test.each([
    ['30m', 30], ['2h', 120], ['90', 90], ['1h30m', 90], ['45 min', 45], ['2 h', 120],
  ])('%s → %i', (raw, want) => expect(parseDurationMinutes(raw)).toBe(want));
  test('garbage → null; out of range clamps to 5..1440', () => {
    expect(parseDurationMinutes('soon')).toBeNull();
    expect(parseDurationMinutes('1')).toBe(5);
    expect(parseDurationMinutes('99h')).toBe(1440);
  });
});

// F#5 webhook-reply: a command's single terminal reply is RETURNED by
// handleUpdate as a sendMessage payload — the webhook answers the HTTP
// request with it instead of making a separate Bot API call. Callbacks are
// out of scope (they need two tg calls whose text depends on the DB result)
// and keep going through deps.tg.
describe('handleUpdate: webhook-reply payload (F#5)', () => {
  test('a command reply is returned as a sendMessage payload, not sent via tg', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    const reply = await handleUpdate(deps, msgUpdate('/help'));
    expect(deps.tg.sendMessage).not.toHaveBeenCalled();
    expect(reply.chat_id).toBe('42');
    expect(reply.text).toMatch(/KnockKnock commands/);
  });
  test('reply extras (inline keyboard) ride the payload top-level', async () => {
    const deps = makeBotDeps();
    const reply = await handleUpdate(deps, msgUpdate('/start'));
    expect(deps.tg.sendMessage).not.toHaveBeenCalled();
    expect(reply.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://app.example.com');
  });
  test('callbacks return no payload and keep their tg calls', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    const target = 'f'.repeat(32);
    const reply = await handleUpdate(deps, {
      callback_query: { id: 'cq1', from: { id: 42 }, data: `knock:${target}` },
    });
    expect(reply).toBeUndefined();
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', 'Knock sent.');
    expect(deps.store[`knocks/${target}/${uid}`]).toMatchObject({ count: 1 });
  });
  test('a non-actionable update (group chat) returns no payload', async () => {
    const deps = makeBotDeps();
    const reply = await handleUpdate(deps, { message: { text: '/help', from: { id: 42 }, chat: { id: 42, type: 'group' } } });
    expect(reply).toBeUndefined();
    expect(deps.tg.sendMessage).not.toHaveBeenCalled();
  });
});

// B#8: a non-text private message (sticker, photo, voice note, …) used to be
// silently ignored. Now it gets a playful one-liner nudging /help, so the
// sender knows the bot saw something rather than wondering if it's broken.
const PLAYFUL_EMOJI_SET = ['🐥', '🍑', '🍆', '💦', '🫦', '🌚'];

describe('pickPlayfulEmoji', () => {
  test('returns a member of the set at both ends of the rand() range', () => {
    expect(PLAYFUL_EMOJI_SET).toContain(pickPlayfulEmoji(() => 0));
    expect(PLAYFUL_EMOJI_SET).toContain(pickPlayfulEmoji(() => 0.999));
  });
});

describe('handleUpdate: non-text private messages get an easter-egg reply (B#8)', () => {
  test('a sticker in a private chat gets the playful nudge', async () => {
    const deps = makeBotDeps();
    const reply = await handleUpdate(deps, {
      message: { chat: { id: 5, type: 'private' }, from: { id: 9 }, sticker: {} },
    });
    expect(reply.chat_id).toBe('5');
    expect(reply.text).toMatch(/^Someone else might enjoy that .+ — try \/help\.$/);
    expect(PLAYFUL_EMOJI_SET.some((e) => reply.text.includes(e))).toBe(true);
  });
  test('group chats and no-from messages still get no reply', async () => {
    const deps = makeBotDeps();
    expect(await handleUpdate(deps, {
      message: { chat: { id: 5, type: 'group' }, from: { id: 9 }, text: '/who' },
    })).toBeUndefined();
    expect(await handleUpdate(deps, {
      message: { chat: { id: 5, type: 'private' }, sticker: {} },
    })).toBeUndefined();
    expect(deps.tg.sendMessage).not.toHaveBeenCalled();
  });
});

describe('handleUpdate: /start', () => {
  test('bootstraps the account and replies with an open-app button', async () => {
    const deps = makeBotDeps();
    const reply = await handleUpdate(deps, msgUpdate('/start'));
    expect(deps.store['telegramUsers/42']).toBeTruthy();
    expect(reply.chat_id).toBe('42');
    expect(reply.text).toMatch(/KnockKnock/);
    expect(reply.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://app.example.com');
  });
  test('updates chatId to the message chat id', async () => {
    const deps = makeBotDeps();
    deps.store['telegramUsers/42'] = { uid: 'u-tg-42', chatId: 'old' };
    deps.store['users/u-tg-42/presence'] = { code: 'AAAAAA', status: 'unavailable', availableUntil: null };
    const reply = await handleUpdate(deps, msgUpdate('/start'));
    expect(deps.store['telegramUsers/42/chatId']).toBe('42');
    expect(deps.store['telegramByUid/u-tg-42/chatId']).toBe('42');
  });
});

describe('/start first contact vs returning', () => {
  test('stranger: funnel message, no command list, Open button', async () => {
    const deps = makeBotDeps({});
    const reply = await handleUpdate(deps, msgUpdate('/start'));
    const text = reply.text;
    const extra = reply;
    expect(text).toMatch(/^Welcome to KnockKnock — for when you're around and open to company\./);
    expect(text).toContain('Everything starts in the app');
    expect(text).toContain('/help shows how');
    expect(text).not.toContain('/who');       // no command dump
    expect(text).not.toContain('/status [');
    expect(extra.reply_markup.inline_keyboard[0][0].web_app.url).toBe(deps.appUrl);
  });

  test('returning + available: compact status reply with remaining time', async () => {
    const deps = makeBotDeps({});
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/presence`] = { code: 'AAAAAA', status: 'available', availableUntil: deps.now() + 30 * 60000 };
    const reply = await handleUpdate(deps, msgUpdate('/start'));
    const text = reply.text;
    expect(text).toBe("You're 🟢 available for another 30m. /off to stop.");
  });

  // Spec 2 Task 10 (B#14d): the /start echo gets the status-color dot + a
  // PRECISE (not fuzzy) time remaining, same as the /status confirms below.
  test('/start echo: dot + precise remaining', async () => {
    const deps = makeBotDeps({});
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/presence`] = { code: 'AAAAAA', status: 'available', statusColor: '#3b82f6', availableUntil: deps.now() + 5_400_000 };
    const reply = await handleUpdate(deps, msgUpdate('/start'));
    expect(reply.text).toBe("You're 🔵 available for another 1h 30m. /off to stop.");
  });

  test('returning + unavailable: compact status reply', async () => {
    const deps = makeBotDeps({});
    seedUser(deps.store);
    const reply = await handleUpdate(deps, msgUpdate('/start'));
    const text = reply.text;
    expect(text).toBe("You're unavailable right now. /status to go available.");
  });

  test('stranger /start still bootstraps mapping + chat route', async () => {
    const deps = makeBotDeps({});
    const reply = await handleUpdate(deps, msgUpdate('/start'));
    expect(deps.store['telegramUsers/42']).toBeTruthy();
    expect(deps.store['telegramUsers/42/chatId']).toBe('42');
  });

  // F#4: /start used to read telegramUsers/{tgId} and users/{uid}/presence
  // twice each and write the chat route as two sequential updates.
  test('returning /start: mapping and presence each read ONCE, chat route one update', async () => {
    const deps = makeBotDeps({});
    const uid = seedUser(deps.store);
    const reply = await handleUpdate(deps, msgUpdate('/start'));
    const reads = deps.getVal.mock.calls.map(([p]) => p);
    expect(reads.filter((p) => p === 'telegramUsers/42')).toHaveLength(1);
    expect(reads.filter((p) => p === `users/${uid}/presence`)).toHaveLength(1);
    expect(deps.update).toHaveBeenCalledTimes(1);
    expect(deps.store['telegramUsers/42/chatId']).toBe('42');
    expect(deps.store[`telegramByUid/${uid}/chatId`]).toBe('42');
    expect(reply.text).toBe("You're unavailable right now. /status to go available.");
  });
});

describe('handleUpdate: /status confirm (B#14d dot + precise duration)', () => {
  test('/status confirm: dot + precise duration + /off hint', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/presence`] = { code: 'AAAAAA', status: 'unavailable', availableUntil: null, statusColor: '#3b82f6' };
    const reply = await handleUpdate(deps, msgUpdate('/status 2h'));
    expect(reply.text).toBe("You're 🔵 available for 2h. /off to stop.");
  });
});

describe('handleUpdate: /status and /off', () => {
  test('/status 30m → available with future availableUntil + lastSeen', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    const reply = await handleUpdate(deps, msgUpdate('/status 30m'));
    expect(deps.update).toHaveBeenCalledWith(`users/${uid}/presence`, {
      status: 'available', availableUntil: 1_000_000 + 30 * 60000, lastSeen: 1_000_000,
    });
    expect(reply.text).toBe("You're 🟢 available for 30m. /off to stop.");
  });
  test('/status with no arg defaults to 60m', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    const reply = await handleUpdate(deps, msgUpdate('/status'));
    expect(deps.update).toHaveBeenCalledWith(`users/${uid}/presence`,
      expect.objectContaining({ availableUntil: 1_000_000 + 60 * 60000 }));
  });
  test('/status <unknown word> → treated as group name, no write', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    const reply = await handleUpdate(deps, msgUpdate('/status whenever'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(reply.text).toBe('No group matching "whenever".');
  });
  // B#4 (issue #285): a mistyped duration (`/status 2 hours`) fails the duration
  // parse, is treated as a group query, matches nothing — the no-match reply now
  // carries a format hint. A plain unknown word (above) still gets NO hint.
  test('/status <duration typo> → no-match reply carries a duration format hint (B#4)', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    const reply = await handleUpdate(deps, msgUpdate('/status 2 hours'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(reply.text).toContain('No group matching "2 hours".');
    expect(reply.text).toMatch(/2h or 30m/);
  });
  // B#3 (issue #285, option B): a multi-group match spells out the full retry
  // command per candidate (carrying the duration) instead of "give me more
  // letters", which free text can't answer.
  test('/status <ambiguous group> → spells out the retry command per match, with the duration (B#3)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Family';
    deps.store['groups/G2/name'] = 'Fam club';
    const reply = await handleUpdate(deps, msgUpdate('/status fam 2h'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(reply.text).toBe('Which group? Try /status Family 2h or /status Fam club 2h.');
  });
  test('/off <ambiguous group> → spells out /off retry commands, no duration (B#3)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Family';
    deps.store['groups/G2/name'] = 'Fam club';
    const reply = await handleUpdate(deps, msgUpdate('/off fam'));
    expect(reply.text).toBe('Which group? Try /off Family or /off Fam club.');
  });
  test('/off → unavailable, cleared availableUntil', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    const reply = await handleUpdate(deps, msgUpdate('/off'));
    expect(deps.update).toHaveBeenCalledWith(`users/${uid}/presence`, {
      status: 'unavailable', availableUntil: null, lastSeen: 1_000_000,
    });
  });
  test('command from an unknown tg user → open-app prompt, no presence write', async () => {
    const deps = makeBotDeps();
    const reply = await handleUpdate(deps, msgUpdate('/status 30m'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(reply.text).toMatch(/open/i);
  });
});

// B#5 (issue #285): bare /who for a zero-follow newcomer distinguishes "you
// don't follow anyone yet" from "nobody's free", instead of the dead-end
// "No one is available right now."
describe('handleUpdate: bare /who newcomer (B#5)', () => {
  test('zero-follow user → "not following anyone yet", not "No one is available"', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store); // mapping + presence, no following
    const reply = await handleUpdate(deps, msgUpdate('/who'));
    expect(reply.text).toContain('not following anyone yet');
    expect(reply.text).not.toContain('No one is available');
  });
  test('user who follows someone (none available) still gets "No one is available"', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = { f1: { code: 'BBBBBB', label: 'Ana' } };
    deps.store['users/f1/presence'] = { status: 'unavailable', availableUntil: null };
    const reply = await handleUpdate(deps, msgUpdate('/who'));
    expect(reply.text).toBe('No one is available right now.');
  });
});

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
    const reply = await handleUpdate(deps, msgUpdate('/status divers 2h'));
    expect(deps.update).toHaveBeenCalledWith(`groups/G1/members/${uid}/statusOverride`, {
      status: 'available', availableUntil: 1_000_000 + 120 * 60000,
    });
    expect(deps.update).toHaveBeenCalledTimes(1); // no global presence write
    expect(reply.text).toBe("You're 🟢 available in Divers for 2h. /off Divers to stop.");
  });

  // Spec 2 Task 10 (B#14d): the group confirm's dot is the OVERRIDE's own
  // color (this command just wrote the override). A missing/invalid override
  // color falls through to statusCircle's 🟢 fallback — matching /who, /groups,
  // and the client roster — NOT the user's primary presence color.
  test('/status <group> confirm: dot + duration + /off <group> hint', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedStatusGroup(deps.store, uid, { enabled: true, status: 'unavailable', statusColor: '#8800ff' });
    const reply = await handleUpdate(deps, msgUpdate('/status divers 2h'));
    expect(reply.text).toBe("You're 🟣 available in Divers for 2h. /off Divers to stop.");
  });

  // Aligned with /who + /groups + the client roster: an enabled override with
  // no statusColor of its own shows 🟢, NOT the user's primary presence color.
  test('/status <group> confirm: enabled override without its own color → 🟢 (not primary)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    // primary presence carries a distinct color; the override carries none
    deps.store[`users/${uid}/presence`] = { code: 'AAAAAA', status: 'unavailable', availableUntil: null, statusColor: '#3b82f6' };
    seedStatusGroup(deps.store, uid, { enabled: true, status: 'unavailable' });
    const reply = await handleUpdate(deps, msgUpdate('/status divers 2h'));
    expect(reply.text).toBe("You're 🟢 available in Divers for 2h. /off Divers to stop.");
  });
  test('override ON, no duration → defaults to 60m', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedStatusGroup(deps.store, uid, { enabled: true, status: 'unavailable' });
    const reply = await handleUpdate(deps, msgUpdate('/status divers'));
    expect(deps.update).toHaveBeenCalledWith(`groups/G1/members/${uid}/statusOverride`,
      expect.objectContaining({ availableUntil: 1_000_000 + 60 * 60000 }));
  });
  test('multi-word group name with trailing duration', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G3: { lastVisited: 1 } };
    deps.store['groups/G3/name'] = 'My Family';
    deps.store[`groups/G3/members/${uid}/statusOverride`] = { enabled: true, status: 'unavailable' };
    const reply = await handleUpdate(deps, msgUpdate('/status my family 30m'));
    expect(deps.update).toHaveBeenCalledWith(`groups/G3/members/${uid}/statusOverride`,
      expect.objectContaining({ availableUntil: 1_000_000 + 30 * 60000 }));
  });
  test('override OFF + globally available → no write, already-available message', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedStatusGroup(deps.store, uid, { enabled: false });
    deps.store[`users/${uid}/presence`] = { code: 'AAAAAA', status: 'available', availableUntil: 2_000_000 };
    const reply = await handleUpdate(deps, msgUpdate('/status divers'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(reply.text).toBe("Divers follows your global status — you're already available there.");
  });
  test('override OFF + globally unavailable → no write, guidance message', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedStatusGroup(deps.store, uid, { enabled: false });
    const reply = await handleUpdate(deps, msgUpdate('/status divers 2h'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(reply.text).toBe('Divers follows your global status. /status goes available everywhere, or turn on a group status in the app.');
  });
  test('missing override node behaves as override OFF', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Divers';
    const reply = await handleUpdate(deps, msgUpdate('/status divers'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(reply.text).toMatch(/follows your global status/);
  });
  test('regression: /status 1h 30m stays a global duration', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    const reply = await handleUpdate(deps, msgUpdate('/status 1h 30m'));
    expect(deps.update).toHaveBeenCalledWith(`users/${uid}/presence`,
      expect.objectContaining({ availableUntil: 1_000_000 + 90 * 60000 }));
  });
});

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
    const reply = await handleUpdate(deps, msgUpdate('/off divers'));
    expect(deps.update).toHaveBeenCalledWith(`groups/G1/members/${uid}/statusOverride`, {
      status: 'unavailable', availableUntil: null,
    });
    expect(deps.update).toHaveBeenCalledTimes(1); // no global presence write
    expect(reply.text).toBe("You're unavailable in Divers.");
  });
  test('override OFF + globally available → no write, guidance message', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedOffGroup(deps.store, uid, { enabled: false });
    deps.store[`users/${uid}/presence`] = { code: 'AAAAAA', status: 'available', availableUntil: 2_000_000 };
    const reply = await handleUpdate(deps, msgUpdate('/off divers'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(reply.text).toBe('Divers follows your global status. /off goes unavailable everywhere, or turn on a group status in the app.');
  });
  test('override OFF + globally unavailable → no write, already-unavailable message', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedOffGroup(deps.store, uid, { enabled: false });
    const reply = await handleUpdate(deps, msgUpdate('/off divers'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(reply.text).toBe("You're already unavailable in Divers.");
  });
  test('no matching group → No group matching, no write', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedOffGroup(deps.store, uid, { enabled: true, status: 'available' });
    const reply = await handleUpdate(deps, msgUpdate('/off chess'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(reply.text).toBe('No group matching "chess".');
  });
});

describe('handleUpdate: /notifications and /help', () => {
  test('/notifications push and telegram set the channel; bad arg explains', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pushTokens/${uid}`] = { tok1: true };
    let reply = await handleUpdate(deps, msgUpdate('/notifications push'));
    expect(deps.store[`userPrefs/${uid}/notifyChannel`]).toBe('push');
    reply = await handleUpdate(deps, msgUpdate('/notifications telegram'));
    expect(deps.store[`userPrefs/${uid}/notifyChannel`]).toBe('telegram');
    reply = await handleUpdate(deps, msgUpdate('/notifications carrier-pigeon'));
    expect(reply.text).toMatch(/push|telegram/);
  });
  test('/help lists the commands', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    const reply = await handleUpdate(deps, msgUpdate('/help'));
    const text = reply.text;
    for (const cmd of ['/status', '/off', '/who', '/knock', '/groups', '/notifications']) {
      expect(text).toContain(cmd);
    }
    expect(text).toContain('/status [group] [30m|2h]');
    expect(text).toContain('/off [group]');
    expect(text).toContain('/who [group]');
    expect(text).toMatch(/groups/i);
  });
  test('non-private chats and non-message updates are ignored', async () => {
    const deps = makeBotDeps();
    let reply = await handleUpdate(deps, { message: { text: '/help', from: { id: 42 }, chat: { id: -9, type: 'group' } } });
    reply = await handleUpdate(deps, { edited_message: {} });
    reply = await handleUpdate(deps, null);
    expect(deps.tg.sendMessage).not.toHaveBeenCalled();
  });
});

describe('/notifications push without tokens (W1 J#3)', () => {
  test('refuses with guidance and writes nothing', async () => {
    const store = {};
    const uid = seedUser(store);
    const deps = makeBotDeps(store);
    const reply = await handleUpdate(deps, msgUpdate('/notifications push'));
    expect(reply.chat_id).toBe('42');
    expect(reply.text).toBe("Push isn't set up on any device yet — open KnockKnock in a browser first. You'll keep getting messages here.");
    expect(store[`userPrefs/${uid}/notifyChannel`]).toBeUndefined();
  });

  test('switches normally when a token exists', async () => {
    const store = {};
    const uid = seedUser(store);
    store[`pushTokens/${uid}`] = { tok1: true };
    const deps = makeBotDeps(store);
    const reply = await handleUpdate(deps, msgUpdate('/notifications push'));
    expect(store[`userPrefs/${uid}/notifyChannel`]).toBe('push');
  });

  // Migration window: an account not yet migrated still has its tokens under
  // the legacy path only — the dual-read fallback must still let it switch.
  test('legacy fallback: switches when only the legacy path has a token', async () => {
    const store = {};
    const uid = seedUser(store);
    store[`userPrefs/${uid}/pushTokens`] = { tok1: true };
    const deps = makeBotDeps(store);
    const reply = await handleUpdate(deps, msgUpdate('/notifications push'));
    expect(store[`userPrefs/${uid}/notifyChannel`]).toBe('push');
  });
});

describe('handleUpdate: /who', () => {
  test('lists available contacts, notes when nobody is', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = {
      f1: { code: 'CODE01', label: 'Bea' },
      f2: { code: 'CODE02', label: 'Cal' },
    };
    deps.store['users/f1/presence'] = { status: 'available', availableUntil: 2_000_000 };
    deps.store['users/f2/presence'] = { status: 'unavailable', availableUntil: null };
    let reply = await handleUpdate(deps, msgUpdate('/who'));
    const text = reply.text;
    expect(text).toContain('Bea');
    expect(text).not.toContain('Cal');

    deps.store['users/f1/presence'] = { status: 'available', availableUntil: 500 }; // expired
    reply = await handleUpdate(deps, msgUpdate('/who'));
    expect(reply.text).toMatch(/no one|nobody/i);
  });

  // Spec 2 Task 9 (B#14c): each available follower's line gets a status-color
  // circle (quantized from presence.statusColor) and a fuzzy time-remaining
  // tail, so /who conveys more than a flat name list.
  test('shows each person\'s status-color circle + fuzzy time remaining', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = {
      f1: { code: 'CODE01', label: 'Ana' },
      f2: { code: 'CODE02', label: 'Dee' },
    };
    // Ana: blue swatch, ~30m left ("about half an hour"). Dee: no color (default 🟢), ~4m left ("just a few minutes").
    deps.store['users/f1/presence'] = { status: 'available', statusColor: '#3b82f6', availableUntil: 2_800_000 };
    deps.store['users/f2/presence'] = { status: 'available', availableUntil: 1_240_000 };
    const reply = await handleUpdate(deps, msgUpdate('/who'));
    expect(reply.text).toBe('Available now:\n🔵 Ana — about half an hour left\n🟢 Dee — just a few minutes left');
  });
});

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
    const reply = await handleUpdate(deps, msgUpdate('/who div'));
    const text = reply.text;
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
    const reply = await handleUpdate(deps, msgUpdate('/who divers'));
    expect(reply.text).toBe('No one is available in Divers right now.');
  });
  test('no matching group → No group matching', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedGroup(deps.store, uid);
    const reply = await handleUpdate(deps, msgUpdate('/who chess'));
    expect(reply.text).toBe('No group matching "chess".');
  });
  test('ambiguous group name → spells out the /who retry command per candidate (B#3)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedGroup(deps.store, uid);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 2 } };
    deps.store['groups/G2/name'] = 'Dive Club';
    const reply = await handleUpdate(deps, msgUpdate('/who div'));
    const text = reply.text;
    expect(text).toContain('Divers');
    expect(text).toContain('Dive Club');
    expect(text).toBe('Which group? Try /who Divers or /who Dive Club.');
  });

  // Spec 2 Task 9 (B#14c): the group roster line uses the member's EFFECTIVE
  // color/time (enabled override wins over primary presence), same as the
  // effectiveAvailable predicate already gating the line.
  test('/who <group> uses effective (override) color + time', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G1/members'] = {
      [uid]: { displayName: 'Me' },
      m1: {
        displayName: 'Ivy',
        statusOverride: { enabled: true, status: 'available', statusColor: '#8800ff', availableUntil: 8_500_000 },
      },
    };
    // Primary presence is unavailable — the override must win, both for the
    // availability gate and for which color/time gets shown.
    deps.store['users/m1/presence'] = { status: 'unavailable', availableUntil: null };
    const reply = await handleUpdate(deps, msgUpdate('/who divers'));
    expect(reply.text).toContain('🟣 ');
    expect(reply.text).toContain('just over two hours left');
  });
});

// Task 11: the Admin SDK bypasses database rules, so /who's distance text
// re-implements every gate the rules enforce client-side, explicitly, here.
describe('handleUpdate: /who distance (Task 11)', () => {
  function seedDirect(store, uid) {
    store[`userPrefs/${uid}/following`] = { f1: { code: 'CODE01', label: 'Bea' } };
    store['users/f1/presence'] = { status: 'available', availableUntil: 2_000_000 };
  }
  test('precise fragment when requester + target both publish, are mutual, and the requester is available', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedDirect(deps.store, uid);
    deps.store[`users/${uid}/presence`].status = 'available';
    deps.store[`users/${uid}/presence`].availableUntil = 2_000_000;
    deps.store[`locations/${uid}`] = { lat: 52.5200, lng: 13.4050, updatedAt: 1 };
    deps.store['locations/f1'] = { lat: 52.5205, lng: 13.4055, updatedAt: 1 };
    deps.store[`users/${uid}/followers/f1`] = 'CODE01'; // f1 follows uid back…
    deps.store[`users/f1/followers/${uid}`] = 'MYCODE'; // …and uid is REGISTERED as f1's follower
    const reply = await handleUpdate(deps, msgUpdate('/who'));
    expect(reply.text).toBe('Available now:\n🟢 Bea — about 15 minutes left · 65 meters away');
  });
  test('requester unavailable → no distance fragment even with a persisted last-known node (de facto not sharing)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store); // seeds requester presence UNAVAILABLE
    seedDirect(deps.store, uid);
    deps.store[`locations/${uid}`] = { lat: 52.5200, lng: 13.4050, updatedAt: 1 };
    deps.store['locations/f1'] = { lat: 52.5205, lng: 13.4055, updatedAt: 1 };
    deps.store[`users/${uid}/followers/f1`] = 'CODE01';
    deps.store[`users/f1/followers/${uid}`] = 'MYCODE';
    const reply = await handleUpdate(deps, msgUpdate('/who'));
    expect(reply.text).not.toContain('·');
  });
  test('requester not publishing → no distance fragment', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedDirect(deps.store, uid);
    // No locations/{uid} — requester isn't publishing.
    deps.store['locations/f1'] = { lat: 52.5205, lng: 13.4055, updatedAt: 1 };
    deps.store[`users/${uid}/followers/f1`] = 'CODE01';
    const reply = await handleUpdate(deps, msgUpdate('/who'));
    expect(reply.text).not.toContain('·');
  });
  test('target publishing but NOT mutual → no distance fragment', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedDirect(deps.store, uid);
    deps.store[`locations/${uid}`] = { lat: 52.5200, lng: 13.4050, updatedAt: 1 };
    deps.store['locations/f1'] = { lat: 52.5205, lng: 13.4055, updatedAt: 1 };
    deps.store[`users/f1/followers/${uid}`] = 'MYCODE';
    // No users/{uid}/followers/f1 — f1 doesn't follow back.
    const reply = await handleUpdate(deps, msgUpdate('/who'));
    expect(reply.text).not.toContain('·');
  });
  test('revoked follow (requester\'s following entry stale, absent from target\'s followers) → no fragment (F5)', async () => {
    // The requester's own following list is mailbox-reconciled client-side
    // only — after f1 revokes, the bot may still see the stale entry. The
    // AUTHORITATIVE requester→target edge is users/f1/followers/{uid}; the
    // rules gate on it, so the bot must too.
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedDirect(deps.store, uid);
    deps.store[`locations/${uid}`] = { lat: 52.5200, lng: 13.4050, updatedAt: 1 };
    deps.store['locations/f1'] = { lat: 52.5205, lng: 13.4055, updatedAt: 1 };
    deps.store[`users/${uid}/followers/f1`] = 'CODE01'; // f1 follows me
    // users/f1/followers/{uid} ABSENT — my follower registration was revoked.
    const reply = await handleUpdate(deps, msgUpdate('/who'));
    expect(reply.text).not.toContain('·');
  });
  // Audit F10: users/{uid}/followers is the requester's OWN fixed followers
  // map — reading it once and indexing per member replaces a per-member
  // child read of the same map, with identical gating (myFollowers[mid]).
  test('reads the requester\'s own-followers map once, not per member (audit F10)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedDirect(deps.store, uid);
    deps.store[`users/${uid}/presence`].status = 'available';
    deps.store[`users/${uid}/presence`].availableUntil = 2_000_000;
    deps.store[`locations/${uid}`] = { lat: 52.5200, lng: 13.4050, updatedAt: 1 };
    deps.store['locations/f1'] = { lat: 52.5205, lng: 13.4055, updatedAt: 1 };
    deps.store[`users/${uid}/followers/f1`] = 'CODE01';
    deps.store[`users/f1/followers/${uid}`] = 'MYCODE';
    const reply = await handleUpdate(deps, msgUpdate('/who'));
    expect(reply.text).toBe('Available now:\n🟢 Bea — about 15 minutes left · 65 meters away');
    const paths = deps.getVal.mock.calls.map(([p]) => p);
    expect(paths).toContain(`users/${uid}/followers`);
    expect(paths.filter((p) => p.startsWith(`users/${uid}/followers/`))).toEqual([]);
  });
});

describe('handleUpdate: /who <group> distance (Task 11)', () => {
  function seedGroupOne(store, uid) {
    store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    store['groups/G1/name'] = 'Divers';
    store['groups/G1/members'] = {
      [uid]: { displayName: 'Me' },
      m1: { displayName: 'Bea', statusOverride: { enabled: false } },
    };
    store['users/m1/presence'] = { status: 'available', availableUntil: 2_000_000 };
  }
  test('coarse fragment when requester + target both have a cell and the requester is available in the group', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedGroupOne(deps.store, uid);
    deps.store[`users/${uid}/presence`].status = 'available';
    deps.store[`users/${uid}/presence`].availableUntil = 2_000_000;
    deps.store[`locationCells/G1/${uid}`] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    deps.store['locationCells/G1/m1'] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    const reply = await handleUpdate(deps, msgUpdate('/who divers'));
    expect(reply.text).toBe('Available in Divers:\n🟢 Bea — about 15 minutes left · <1 km away');
  });
  test('precise cascade: mutuals both broadcasting in Direct see the precise fragment in /who <group>, not the coarse cell', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedGroupOne(deps.store, uid);
    deps.store[`users/${uid}/presence`].status = 'available';
    deps.store[`users/${uid}/presence`].availableUntil = 2_000_000;
    // Both sides broadcasting in Direct (primary-available + raw point)…
    deps.store[`locations/${uid}`] = { lat: 52.5200, lng: 13.4050, updatedAt: 1 };
    deps.store['locations/m1'] = { lat: 52.5205, lng: 13.4055, updatedAt: 1 };
    // …mutual on BOTH authoritative follower edges…
    deps.store[`users/${uid}/followers/m1`] = 'CODE01';
    deps.store[`users/m1/followers/${uid}`] = 'MYCODE';
    // …and both have cells (the coarse tier the precise one must beat).
    deps.store[`locationCells/G1/${uid}`] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    deps.store['locationCells/G1/m1'] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    const reply = await handleUpdate(deps, msgUpdate('/who divers'));
    expect(reply.text).toContain('· 65 meters away');
    expect(reply.text).not.toContain('<1 km away');
  });
  test('precise cascade gate: target primary-unavailable (override-available in group) → coarse only, no precise leak', async () => {
    // The ANN/BOB scenario on the bot surface: the mutual's persisted raw
    // point must not render precise while their Direct side is off.
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedGroupOne(deps.store, uid);
    deps.store[`users/${uid}/presence`].status = 'available';
    deps.store[`users/${uid}/presence`].availableUntil = 2_000_000;
    deps.store['users/m1/presence'] = { status: 'unavailable', availableUntil: null };
    deps.store['groups/G1/members'].m1.statusOverride = { enabled: true, status: 'available', availableUntil: 2_000_000 };
    deps.store[`locations/${uid}`] = { lat: 52.5200, lng: 13.4050, updatedAt: 1 };
    deps.store['locations/m1'] = { lat: 52.5205, lng: 13.4055, updatedAt: 1 }; // persisted last-known
    deps.store[`users/${uid}/followers/m1`] = 'CODE01';
    deps.store[`users/m1/followers/${uid}`] = 'MYCODE';
    deps.store[`locationCells/G1/${uid}`] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    deps.store['locationCells/G1/m1'] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    const reply = await handleUpdate(deps, msgUpdate('/who divers'));
    expect(reply.text).toContain('· <1 km away');
    expect(reply.text).not.toContain(' m\n');
    expect(reply.text).not.toMatch(/· \d+ m/);
  });
  test('precise cascade gate: NOT mutual (one edge missing) → coarse only', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedGroupOne(deps.store, uid);
    deps.store[`users/${uid}/presence`].status = 'available';
    deps.store[`users/${uid}/presence`].availableUntil = 2_000_000;
    deps.store[`locations/${uid}`] = { lat: 52.5200, lng: 13.4050, updatedAt: 1 };
    deps.store['locations/m1'] = { lat: 52.5205, lng: 13.4055, updatedAt: 1 };
    deps.store[`users/${uid}/followers/m1`] = 'CODE01'; // m1 follows me…
    // …but users/m1/followers/{uid} is ABSENT — not mutual.
    deps.store[`locationCells/G1/${uid}`] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    deps.store['locationCells/G1/m1'] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    const reply = await handleUpdate(deps, msgUpdate('/who divers'));
    expect(reply.text).toContain('· <1 km away');
    expect(reply.text).not.toMatch(/· \d+ m/);
  });
  test('requester unavailable in the group → no distance fragment even with a persisted cell (de facto not sharing)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store); // seeds requester presence UNAVAILABLE
    seedGroupOne(deps.store, uid);
    deps.store[`locationCells/G1/${uid}`] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    deps.store['locationCells/G1/m1'] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    const reply = await handleUpdate(deps, msgUpdate('/who divers'));
    expect(reply.text).not.toContain('·');
  });
  test('requester gate is EFFECTIVE in-group availability: a group override re-enables the fragment (group location is independent of Direct)', async () => {
    // Group location is independent of the Direct context: the requester's
    // in-group sharing keys off their EFFECTIVE availability there — the
    // override wins when enabled — mirroring the client's per-context
    // publish gating. Primary-unavailable + override-available → sharing in
    // the group → sees coarse distances.
    const deps = makeBotDeps();
    const uid = seedUser(deps.store); // primary presence unavailable
    seedGroupOne(deps.store, uid);
    deps.store['groups/G1/members'][uid].statusOverride = {
      enabled: true, status: 'available', availableUntil: 2_000_000,
    };
    deps.store[`locationCells/G1/${uid}`] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    deps.store['locationCells/G1/m1'] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    const reply = await handleUpdate(deps, msgUpdate('/who divers'));
    expect(reply.text).toContain('· <1 km away');
  });
  test('requester override says UNAVAILABLE while primary is available → no fragment (override wins both ways)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/presence`].status = 'available';
    deps.store[`users/${uid}/presence`].availableUntil = 2_000_000;
    seedGroupOne(deps.store, uid);
    deps.store['groups/G1/members'][uid].statusOverride = { enabled: true, status: 'unavailable', availableUntil: null };
    deps.store[`locationCells/G1/${uid}`] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    deps.store['locationCells/G1/m1'] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    const reply = await handleUpdate(deps, msgUpdate('/who divers'));
    expect(reply.text).not.toContain('·');
  });
  test('requester cell missing → no distance fragment', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedGroupOne(deps.store, uid);
    // No locationCells/G1/{uid} — requester has no cell in this group.
    deps.store['locationCells/G1/m1'] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    const reply = await handleUpdate(deps, msgUpdate('/who divers'));
    expect(reply.text).not.toContain('·');
  });
  // Audit F10: users/{uid}/followers (the requester's own fixed followers
  // map) and locationCells/{gid} (this group's cell map) are each read ONCE
  // and indexed per co-member, replacing a per-member child read of both —
  // same gating (myFollowers[mid], groupCells[mid]), fewer round trips.
  test('reads own-followers and the group cell map once, not per member (audit F10)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    seedGroupOne(deps.store, uid);
    deps.store[`users/${uid}/presence`].status = 'available';
    deps.store[`users/${uid}/presence`].availableUntil = 2_000_000;
    // Both sides broadcasting in Direct (myLoc truthy) AND both have cells
    // (myCell truthy) exercises both prefetches in one pass.
    deps.store[`locations/${uid}`] = { lat: 52.5200, lng: 13.4050, updatedAt: 1 };
    deps.store['locations/m1'] = { lat: 52.5205, lng: 13.4055, updatedAt: 1 };
    deps.store[`users/${uid}/followers/m1`] = 'CODE01';
    deps.store['users/m1/followers/' + uid] = 'MYCODE';
    deps.store[`locationCells/G1/${uid}`] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    deps.store['locationCells/G1/m1'] = { lat: 52.52, lng: 13.40, updatedAt: 1 };
    const reply = await handleUpdate(deps, msgUpdate('/who divers'));
    expect(reply.text).toContain('· 65 meters away');
    const paths = deps.getVal.mock.calls.map(([p]) => p);
    expect(paths).toContain(`users/${uid}/followers`);
    expect(paths).toContain('locationCells/G1');
    expect(paths.filter((p) => p.startsWith(`users/${uid}/followers/`))).toEqual([]);
    // The requester's OWN cell (`locationCells/G1/{uid}`, resolving myCell) is
    // a single legitimate read, not a per-co-member one — only a read of a
    // CO-MEMBER's cell (m1's) would mean the prefetch didn't replace the loop.
    expect(paths.filter((p) => p.startsWith('locationCells/G1/') && p !== `locationCells/G1/${uid}`)).toEqual([]);
  });
});

describe('handleUpdate: /knock', () => {
  const following = { f1: { code: 'CODE01', label: 'Bea' }, f2: { code: 'CODE02', label: 'Beatrice' } };
  test('unique match → knock written with client shape', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = { f1: following.f1 };
    const reply = await handleUpdate(deps, msgUpdate('/knock bea'));
    expect(deps.store[`knocks/f1/${uid}`]).toEqual({ count: 1, ts: 1_000_000 });
  });
  test('knock caps at 5 like the client transaction', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = { f1: following.f1 };
    deps.store[`knocks/f1/${uid}`] = { count: 5, ts: 1 };
    const reply = await handleUpdate(deps, msgUpdate('/knock bea'));
    expect(deps.store[`knocks/f1/${uid}`].count).toBe(5);
  });
  test('ambiguous → inline keyboard of candidates', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = following;
    const reply = await handleUpdate(deps, msgUpdate('/knock bea'));
    const extra = reply;
    const buttons = extra.reply_markup.inline_keyboard.flat();
    expect(buttons).toEqual(expect.arrayContaining([
      { text: 'Bea', callback_data: 'knock:f1' },
      { text: 'Beatrice', callback_data: 'knock:f2' },
    ]));
  });
  test('/knock disambiguation appends a truncation hint past 8', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    const many = {};
    for (let i = 0; i < 10; i++) many[`f${i}`] = { code: `CODE${i}`, label: `Ann${i}` };
    deps.store[`userPrefs/${uid}/following`] = many;
    const reply = await handleUpdate(deps, msgUpdate('/knock ann'));
    expect(reply.text).toBe('Which one? …and 2 more — type more letters.');
    expect(reply.reply_markup.inline_keyboard).toHaveLength(8);
  });
  test('/knock disambiguation with 8 or fewer matches → no hint', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    const eight = {};
    for (let i = 0; i < 8; i++) eight[`f${i}`] = { code: `CODE${i}`, label: `Ann${i}` };
    deps.store[`userPrefs/${uid}/following`] = eight;
    const reply = await handleUpdate(deps, msgUpdate('/knock ann'));
    expect(reply.text).toBe('Which one?');
    expect(reply.reply_markup.inline_keyboard).toHaveLength(8);
  });
  test('no match / no arg → helpful reply', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = following;
    let reply = await handleUpdate(deps, msgUpdate('/knock zed'));
    expect(reply.text).toMatch(/find/i);
    reply = await handleUpdate(deps, msgUpdate('/knock'));
    expect(reply.text).toMatch(/knock <name>/i);
  });
  test('Direct match wins over a roster match — knock has no group context', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = { f1: { code: 'CODE01', label: 'Bea' } };
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G1/members'] = { g9: { displayName: 'Bea' } };
    const reply = await handleUpdate(deps, msgUpdate('/knock bea'));
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
    const reply = await handleUpdate(deps, msgUpdate('/knock cora'));
    expect(deps.store[`knocks/g9/${uid}`]).toEqual({ count: 1, ts: 1_000_000, contextGroupId: 'G1' });
    expect(reply.text).toBe('Knocked on Cora (Divers).');
  });
  test('own displayName never matches (self excluded from rosters)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G1/members'] = { [uid]: { displayName: 'Ada' } };
    const reply = await handleUpdate(deps, msgUpdate('/knock ada'));
    expect(Object.keys(deps.store).some((k) => k.startsWith('knocks/'))).toBe(false);
    expect(reply.text).toMatch(/find/i);
  });
  test('ambiguous roster matches → keyboard with uid:gid callbacks', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 2 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G2/name'] = 'Family';
    deps.store['groups/G1/members'] = { a1: { displayName: 'Cora' } };
    deps.store['groups/G2/members'] = { a2: { displayName: 'Coraline' } };
    const reply = await handleUpdate(deps, msgUpdate('/knock cora'));
    const buttons = reply.reply_markup.inline_keyboard.flat();
    expect(buttons).toEqual(expect.arrayContaining([
      { text: 'Cora (Divers)', callback_data: 'knock:a1:G1' },
      { text: 'Coraline (Family)', callback_data: 'knock:a2:G2' },
    ]));
  });
  test('knockGroupReach disambiguation appends a truncation hint past 8', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Divers';
    const members = {};
    for (let i = 0; i < 10; i++) members[`a${i}`] = { displayName: `Cora${i}` };
    deps.store['groups/G1/members'] = members;
    const reply = await handleUpdate(deps, msgUpdate('/knock cora'));
    expect(reply.text).toBe('Which one? …and 2 more — type more letters.');
    expect(reply.reply_markup.inline_keyboard).toHaveLength(8);
  });
  test('knockGroupReach disambiguation with 8 or fewer matches → no hint', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Divers';
    const members = {};
    for (let i = 0; i < 8; i++) members[`a${i}`] = { displayName: `Cora${i}` };
    deps.store['groups/G1/members'] = members;
    const reply = await handleUpdate(deps, msgUpdate('/knock cora'));
    expect(reply.text).toBe('Which one?');
    expect(reply.reply_markup.inline_keyboard).toHaveLength(8);
  });
  test('no match anywhere → mentions groups in the reply', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = { f1: { code: 'CODE01', label: 'Bea' } };
    const reply = await handleUpdate(deps, msgUpdate('/knock zed'));
    expect(reply.text).toBe('Couldn\'t find "zed" among the people you follow or your groups.');
  });
});

describe('handleUpdate: /groups', () => {
  test('lists groups with own effective in-group availability', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 2 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G2/name'] = 'Family';
    deps.store[`groups/G1/members/${uid}/statusOverride`] = { enabled: true, status: 'available', availableUntil: 2_000_000 };
    deps.store[`groups/G2/members/${uid}/statusOverride`] = { enabled: false };
    deps.store[`users/${uid}/presence`] = { code: 'AAAAAA', status: 'unavailable', availableUntil: null };
    const reply = await handleUpdate(deps, msgUpdate('/groups'));
    // Divers: enabled override, available, no statusColor → default 🟢 circle,
    // 16m left (2_000_000 - now=1_000_000). Family: disabled override → falls
    // back to primary presence (unavailable) → collapsed into the summary.
    expect(reply.text).toBe('🟢 Divers — 16m left\n\nUnavailable in Family');
  });
  test('no groups → pointer to the app', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    const reply = await handleUpdate(deps, msgUpdate('/groups'));
    expect(reply.text).toMatch(/app/i);
  });
  test('/groups: dotted available rows then one Unavailable summary', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = {
      G1: { lastVisited: 1 }, G2: { lastVisited: 2 }, G3: { lastVisited: 3 }, G4: { lastVisited: 4 },
    };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G2/name'] = 'Book Club';
    deps.store['groups/G3/name'] = 'Hiking';
    deps.store['groups/G4/name'] = 'Chess';
    deps.store[`groups/G1/members/${uid}/statusOverride`] = {
      enabled: true, status: 'available', statusColor: '#3b82f6', availableUntil: deps.now() + 5_700_000, // 1h35m
    };
    deps.store[`groups/G2/members/${uid}/statusOverride`] = {
      enabled: true, status: 'available', statusColor: '#f97316', availableUntil: deps.now() + 2_700_000, // 45m
    };
    // G3 (Hiking) and G4 (Chess) have no override → fall back to the seeded
    // unavailable primary presence.
    const reply = await handleUpdate(deps, msgUpdate('/groups'));
    expect(reply.text).toBe('🔵 Divers — 1h 35m left\n🟠 Book Club — 45m left\n\nUnavailable in Hiking, Chess');
  });
  test('/groups: all available → no summary line', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 2 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G2/name'] = 'Book Club';
    deps.store[`groups/G1/members/${uid}/statusOverride`] = {
      enabled: true, status: 'available', statusColor: '#3b82f6', availableUntil: deps.now() + 5_700_000,
    };
    deps.store[`groups/G2/members/${uid}/statusOverride`] = {
      enabled: true, status: 'available', statusColor: '#f97316', availableUntil: deps.now() + 2_700_000,
    };
    const reply = await handleUpdate(deps, msgUpdate('/groups'));
    expect(reply.text).not.toContain('Unavailable in');
  });
  test('/groups: all unavailable → only the summary line', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 2 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G2/name'] = 'Book Club';
    // No overrides; seeded primary presence is unavailable.
    const reply = await handleUpdate(deps, msgUpdate('/groups'));
    expect(reply.text).toBe('Unavailable in Divers, Book Club');
  });
});

describe('callback: knock', () => {
  const cbUpdate = (data, from = { id: 42, first_name: 'Ada' }) =>
    ({ callback_query: { id: 'cb1', data, from } });
  const F9 = 'f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9'; // format-valid 32-hex recipient
  test('writes the knock and confirms', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    const reply = await handleUpdate(deps, cbUpdate(`knock:${F9}`));
    expect(deps.store[`knocks/${F9}/${uid}`]).toEqual({ count: 1, ts: 1_000_000 });
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/knock/i));
  });
  test('unknown telegram user → prompted to open the app', async () => {
    const deps = makeBotDeps();
    const reply = await handleUpdate(deps, cbUpdate(`knock:${F9}`));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/open/i));
  });
  test('empty arg → Unknown action, no write', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    const reply = await handleUpdate(deps, cbUpdate(`knock:`));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', 'This button has expired — try /help.');
    expect(Object.keys(deps.store).some((k) => k.startsWith('knocks/'))).toBe(false);
  });
  // B#12: a stale or malformed callback (unrecognized action, or an arg that
  // fails the action's format check) must not say the generic "Unknown
  // action." — it should point the user at /help.
  test('unknown/malformed callback answers the expired-button copy', async () => {
    const deps = makeBotDeps();
    deps.store['telegramUsers/9'] = { uid: 'u-tg-9', chatId: '9' };
    const reply = await handleUpdate(deps, cbUpdate('bogus:zzz', { id: 9, first_name: 'Bea' }));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', 'This button has expired — try /help.');
  });
  test('knock:uid:gid writes contextGroupId on create', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    const reply = await handleUpdate(deps, cbUpdate(`knock:${F9}:AAAA1111`));
    expect(deps.store[`knocks/${F9}/${uid}`]).toEqual({ count: 1, ts: 1_000_000, contextGroupId: 'AAAA1111' });
  });
  test('knock:uid:gid overwrites contextGroupId on increment', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`knocks/${F9}/${uid}`] = { count: 1, ts: 1 };
    const reply = await handleUpdate(deps, cbUpdate(`knock:${F9}:BBBB2222`));
    expect(deps.store[`knocks/${F9}/${uid}`]).toEqual({ count: 2, ts: 1_000_000, contextGroupId: 'BBBB2222' });
  });
  test('malformed gid segment is dropped — knock still lands, no contextGroupId', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    const reply = await handleUpdate(deps, cbUpdate(`knock:${F9}:bad.gid`));
    expect(deps.store[`knocks/${F9}/${uid}`]).toEqual({ count: 1, ts: 1_000_000 });
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/knock/i));
  });
  test('plain knock:uid carries an existing contextGroupId on increment', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`knocks/${F9}/${uid}`] = { count: 1, ts: 1, contextGroupId: 'G1' };
    let reply = await handleUpdate(deps, cbUpdate(`knock:${F9}`));
    expect(deps.store[`knocks/${F9}/${uid}`]).toEqual({ count: 2, ts: 1_000_000, contextGroupId: 'G1' });
  });
  // callback_query.data is attacker-controllable and writeKnock is an Admin-SDK
  // write, so the recipient segment must be a well-formed 32-hex uid — anything
  // else (path material, wrong length, wrong alphabet) is refused before the write.
  test.each([
    ['victim/deeper', 'path segment'],
    ['abc', 'too short'],
    ['F'.repeat(32), 'uppercase hex'],
    ['g'.repeat(32), 'non-hex alphabet'],
    ['f'.repeat(33), 'too long'],
  ])('malformed recipient uid %s (%s) → Unknown action, no write', async (badUid) => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    reply = await handleUpdate(deps, cbUpdate(`knock:${badUid}`));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', 'This button has expired — try /help.');
    expect(deps.transaction).not.toHaveBeenCalled();
    expect(Object.keys(deps.store).some((k) => k.startsWith('knocks/'))).toBe(false);
  });
});

describe('inbox callbacks', () => {
  const cb = (data) => ({ callback_query: { id: 'cb1', data, from: { id: 42, first_name: 'Ada' } } });
  const GID = 'AAAA1111';                             // format-valid group id
  const REQ = 'ab12ab12ab12ab12ab12ab12ab12ab12';     // format-valid 32-hex requester

  test('invite_accept: joins with Telegram first_name, default override, dual-deletes pending', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/${GID}`] = { from: 'inviter', ts: 1 };
    deps.store[`groups/${GID}/name`] = 'Divers';
    const reply = await handleUpdate(deps, cb(`invite_accept:${GID}`));
    expect(deps.store[`groups/${GID}/members/${uid}`]).toEqual({
      role: 'member', displayName: 'Ada', joinedAt: 1_000_000,
      statusOverride: { enabled: true, status: 'available', availableUntil: 1_000_000 + 2 * 60 * 60 * 1000 },
    });
    expect(deps.store[`users/${uid}/groups/${GID}`]).toEqual({ lastVisited: 1_000_000 });
    expect(deps.store[`pendingInvites/${uid}/${GID}`]).toBeNull();
    expect(deps.store[`pendingInvitesByGroup/${GID}/${uid}`]).toBeNull();
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringContaining('Divers'));
  });
  // B#6 (issue #285): the bot join silently sets a 2h availability override —
  // the outcome message discloses it and points at /off. W4: it also names the
  // display name it published (U2.5) and keeps an Open KnockKnock button so the
  // join isn't a dead end (U1.6).
  test('invite_accept: joined message discloses name, 2h availability, /off hint + Open button (B#6/U1.6/U2.5)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/${GID}`] = { from: 'inviter', ts: 1 };
    deps.store[`groups/${GID}/name`] = 'Divers';
    const update = { callback_query: { id: 'cb1', data: `invite_accept:${GID}`,
      from: { id: 42, first_name: 'Ada' },
      message: { message_id: 7, chat: { id: 42 }, text: 'Someone invited you to Divers' } } };
    await handleUpdate(deps, update);
    expect(deps.tg.editMessageText).toHaveBeenCalledWith('42', 7,
      "Someone invited you to Divers\n\n✅ Joined Divers as Ada — you're shown available there for 2h. /off Divers to change; edit your name in the app.",
      { reply_markup: { inline_keyboard: [[{ text: 'Open KnockKnock', web_app: { url: deps.appUrl } }]] } });
  });
  test('invite_accept when already a member → just clears the pending invite', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/${GID}`] = { from: 'inviter', ts: 1 };
    deps.store[`groups/${GID}/name`] = 'Divers';
    deps.store[`groups/${GID}/members/${uid}`] = { role: 'member', displayName: 'Old' };
    const reply = await handleUpdate(deps, cb(`invite_accept:${GID}`));
    expect(deps.store[`groups/${GID}/members/${uid}`].displayName).toBe('Old');
    expect(deps.store[`pendingInvites/${uid}/${GID}`]).toBeNull();
  });
  test('invite_accept when group is gone → clears pending, says so', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/${GID}`] = { from: 'inviter', ts: 1 };
    const reply = await handleUpdate(deps, cb(`invite_accept:${GID}`));
    expect(deps.store[`pendingInvites/${uid}/${GID}`]).toBeNull();
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/no longer/i));
  });
  test('invite_decline → dual-delete only', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/${GID}`] = { from: 'inviter', ts: 1 };
    const reply = await handleUpdate(deps, cb(`invite_decline:${GID}`));
    expect(deps.store[`pendingInvites/${uid}/${GID}`]).toBeNull();
    expect(deps.store[`groups/${GID}/members/${uid}`]).toBeUndefined();
  });
  test('fr_approve: writes grant with code + group display name, deletes request', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`followRequests/${uid}/${REQ}`] = { from: REQ, groupId: GID, ts: 1 };
    deps.store[`groups/${GID}/members/${uid}/displayName`] = 'Captain Ada';
    const reply = await handleUpdate(deps, cb(`fr_approve:${REQ}`));
    expect(deps.store[`followGrants/${REQ}/${uid}`]).toEqual({
      from: uid, code: 'AAAAAA', name: 'Captain Ada', ts: 1_000_000,
    });
    expect(deps.store[`followRequests/${uid}/${REQ}`]).toBeNull();
  });
  // Sibling of the invite-accept F#14 fix: the grant write and the request
  // delete must be ONE atomic update, or a crash between them leaves the grant
  // written with the request still pending — re-approvable.
  test('fr_approve: grant write + request delete land as ONE atomic update', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`followRequests/${uid}/${REQ}`] = { from: REQ, groupId: GID, ts: 1 };
    const reply = await handleUpdate(deps, cb(`fr_approve:${REQ}`));
    expect(deps.set).not.toHaveBeenCalled();
    expect(deps.update).toHaveBeenCalledTimes(1);
    expect(Object.keys(deps.update.mock.calls[0][1]).sort()).toEqual([
      `followGrants/${REQ}/${uid}`,
      `followRequests/${uid}/${REQ}`,
    ]);
  });
  test('fr_approve on a vanished request → polite no-op', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    const reply = await handleUpdate(deps, cb(`fr_approve:${REQ}`));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/gone|expired/i));
  });
  test('fr_decline → deletes the request', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`followRequests/${uid}/${REQ}`] = { from: REQ, ts: 1 };
    const reply = await handleUpdate(deps, cb(`fr_decline:${REQ}`));
    expect(deps.store[`followRequests/${uid}/${REQ}`]).toBeNull();
  });
  // F#14: the join used to be three sequential writes (member node, nav entry,
  // then the pending dual-delete) — a crash could leave a member with the
  // invite still pending. All four paths must land in ONE update().
  test('invite_accept: join + nav entry + pending cleanup land as ONE atomic update (F#14)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/${GID}`] = { from: 'inviter', ts: 1 };
    deps.store[`groups/${GID}/name`] = 'Divers';
    const reply = await handleUpdate(deps, cb(`invite_accept:${GID}`));
    expect(deps.set).not.toHaveBeenCalled();
    expect(deps.update).toHaveBeenCalledTimes(1);
    expect(Object.keys(deps.update.mock.calls[0][1]).sort()).toEqual([
      `groups/${GID}/members/${uid}`,
      `pendingInvites/${uid}/${GID}`,
      `pendingInvitesByGroup/${GID}/${uid}`,
      `users/${uid}/groups/${GID}`,
    ]);
  });
  test('invite_decline: the pending dual-delete is ONE update (F#14)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/${GID}`] = { from: 'inviter', ts: 1 };
    deps.store[`pendingInvitesByGroup/${GID}/${uid}`] = true;
    const reply = await handleUpdate(deps, cb(`invite_decline:${GID}`));
    expect(deps.set).not.toHaveBeenCalled();
    expect(deps.update).toHaveBeenCalledTimes(1);
    expect(deps.store[`pendingInvites/${uid}/${GID}`]).toBeNull();
    expect(deps.store[`pendingInvitesByGroup/${GID}/${uid}`]).toBeNull();
  });

  // Same trust boundary as the knock callback: these args become Admin-SDK
  // path segments, so a malformed gid/uid is refused before any read or write.
  test('invite_accept with malformed gid → Unknown action, nothing written', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    const reply = await handleUpdate(deps, cb('invite_accept:bad/gid'));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', 'This button has expired — try /help.');
    expect(deps.set).not.toHaveBeenCalled();
  });
  test('invite_decline with malformed gid → Unknown action, no deletes', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    const reply = await handleUpdate(deps, cb('invite_decline:lowercase1'));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', 'This button has expired — try /help.');
    expect(deps.set).not.toHaveBeenCalled();
  });
  test('fr_approve with malformed requester uid → Unknown action, no grant', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    const reply = await handleUpdate(deps, cb('fr_approve:REQ/../x'));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', 'This button has expired — try /help.');
    expect(deps.set).not.toHaveBeenCalled();
  });
  test('fr_decline with malformed requester uid → Unknown action, request kept', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`followRequests/${uid}/${REQ}`] = { from: REQ, ts: 1 };
    const reply = await handleUpdate(deps, cb('fr_decline:short'));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', 'This button has expired — try /help.');
    expect(deps.store[`followRequests/${uid}/${REQ}`]).toEqual({ from: REQ, ts: 1 });
  });
});

// Round-trip hygiene (analysis F#3/F#7): list-shaped commands must issue their
// per-item reads concurrently, not one awaited read per loop turn. The probe
// defers every getVal by a macrotask, so a sequential loop peaks at 1 in-flight
// read while a Promise.all fan-out peaks at the fan-out width.
function withConcurrencyProbe(deps) {
  const probe = { inFlight: 0, max: 0 };
  deps.getVal = jest.fn(async (path) => {
    probe.inFlight += 1;
    probe.max = Math.max(probe.max, probe.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 0));
    probe.inFlight -= 1;
    return deps.store[path] ?? null;
  });
  return probe;
}

describe('webhook read parallelism (F#3, F#7)', () => {
  test('/who reads all followed presences concurrently', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = {
      f1: { code: 'C1', label: 'Bea' }, f2: { code: 'C2', label: 'Cal' }, f3: { code: 'C3', label: 'Dot' },
    };
    deps.store['users/f1/presence'] = { status: 'available', availableUntil: 2_000_000 };
    const probe = withConcurrencyProbe(deps);
    const reply = await handleUpdate(deps, msgUpdate('/who'));
    expect(probe.max).toBeGreaterThanOrEqual(3);
    expect(reply.text).toBe('Available now:\n🟢 Bea — about 15 minutes left');
  });

  test('/who <group> reads co-member presences concurrently', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G1/members'] = {
      [uid]: { displayName: 'Me' },
      m1: { displayName: 'Bea', statusOverride: { enabled: false } },
      m2: { displayName: 'Cal', statusOverride: { enabled: false } },
      m3: { displayName: 'Dot', statusOverride: { enabled: false } },
    };
    deps.store['users/m1/presence'] = { status: 'available', availableUntil: 2_000_000 };
    const probe = withConcurrencyProbe(deps);
    const reply = await handleUpdate(deps, msgUpdate('/who divers'));
    expect(probe.max).toBeGreaterThanOrEqual(3);
    expect(reply.text).toBe('Available in Divers:\n🟢 Bea — about 15 minutes left');
  });

  test('/groups reads every group\'s name+override concurrently', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 2 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G2/name'] = 'Family';
    const probe = withConcurrencyProbe(deps);
    const reply = await handleUpdate(deps, msgUpdate('/groups'));
    expect(probe.max).toBeGreaterThanOrEqual(4);
    const text = reply.text;
    expect(text).toBe('Unavailable in Divers, Family');
  });

  test('group-name matching reads all names concurrently (/status <group>)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 2 }, G3: { lastVisited: 3 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G2/name'] = 'Family';
    deps.store['groups/G3/name'] = 'Chess';
    const probe = withConcurrencyProbe(deps);
    const reply = await handleUpdate(deps, msgUpdate('/status chess 30m'));
    expect(probe.max).toBeGreaterThanOrEqual(3);
    expect(reply.text).toMatch(/follows your global status/);
  });

  test('/knock roster reach reads all group rosters concurrently; skips no-match group names (C3)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 2 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G2/name'] = 'Family';
    deps.store['groups/G1/members'] = { a1: { displayName: 'Cora' } };
    deps.store['groups/G2/members'] = { a2: { displayName: 'Zed' } };
    const probe = withConcurrencyProbe(deps);
    const reply = await handleUpdate(deps, msgUpdate('/knock cora'));
    expect(probe.max).toBeGreaterThanOrEqual(2); // both group rosters read in one parallel phase
    // Only the matched group's name is resolved — the no-match group's name is not read.
    expect(deps.getVal).toHaveBeenCalledWith('groups/G1/name');
    expect(deps.getVal).not.toHaveBeenCalledWith('groups/G2/name');
    expect(reply.text).toBe('Knocked on Cora (Divers).');
  });

  // availableUntil must be stamped from now() AT WRITE TIME (after the reads),
  // as the pre-refactor code did — not captured at command dispatch. The
  // ticking clock advances 1s per read: telegramUsers, groups, name,
  // override, presence = 5 reads before the write.
  test('group /status stamps availableUntil at write time, not dispatch time', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store[`groups/G1/members/${uid}/statusOverride`] = { enabled: true, status: 'unavailable' };
    let t = 1_000_000;
    deps.getVal = jest.fn(async (path) => { t += 1000; return deps.store[path] ?? null; });
    deps.now = () => t;
    const reply = await handleUpdate(deps, msgUpdate('/status divers 30m'));
    expect(deps.update).toHaveBeenCalledWith(`groups/G1/members/${uid}/statusOverride`, {
      status: 'available', availableUntil: 1_005_000 + 30 * 60000,
    });
  });

  test('group /status prefetches override + presence together (F#7)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store[`groups/G1/members/${uid}/statusOverride`] = { enabled: true, status: 'unavailable' };
    const probe = withConcurrencyProbe(deps);
    const reply = await handleUpdate(deps, msgUpdate('/status divers 30m'));
    expect(probe.max).toBeGreaterThanOrEqual(2);
    expect(deps.update).toHaveBeenCalledWith(`groups/G1/members/${uid}/statusOverride`, {
      status: 'available', availableUntil: 1_000_000 + 30 * 60000,
    });
  });
});

const cqUpdate = (data, message) => ({
  callback_query: {
    id: 'cq1',
    from: { id: 42, first_name: 'Ada' },
    data,
    ...(message ? { message } : {}),
  },
});

describe('invite callbacks are state-checked and self-recording (W1 B#1)', () => {
  const GID = 'ABCD1234';
  const inviteMsg = { message_id: 7, chat: { id: 42 }, text: 'Ada invited you to Divers' };

  function seedInvite(store, uid) {
    store[`pendingInvites/${uid}/${GID}`] = { from: 'f'.repeat(32) };
    store[`groups/${GID}/name`] = 'Divers';
  }

  test('fresh accept joins, edits the message to the outcome, and keeps an Open button (U1.6)', async () => {
    const store = {};
    const uid = seedUser(store);
    seedInvite(store, uid);
    const deps = makeBotDeps(store);
    const reply = await handleUpdate(deps, cqUpdate(`invite_accept:${GID}`, inviteMsg));
    expect(store[`groups/${GID}/members/${uid}`]).toMatchObject({ role: 'member' });
    expect(deps.tg.editMessageText).toHaveBeenCalledWith(
      '42', 7, "Ada invited you to Divers\n\n✅ Joined Divers as Ada — you're shown available there for 2h. /off Divers to change; edit your name in the app.",
      { reply_markup: { inline_keyboard: [[{ text: 'Open KnockKnock', web_app: { url: deps.appUrl } }]] } });
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', 'Joined Divers.');
  });

  test('decline after accept answers honestly instead of "Declined."', async () => {
    const store = {};
    const uid = seedUser(store);
    store[`groups/${GID}/name`] = 'Divers';
    store[`groups/${GID}/members/${uid}`] = { role: 'member', displayName: 'Ada' };
    const deps = makeBotDeps(store);
    const reply = await handleUpdate(deps, cqUpdate(`invite_decline:${GID}`, inviteMsg));
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
    const reply = await handleUpdate(deps, cqUpdate(`invite_decline:${GID}`, inviteMsg));
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
    const reply = await handleUpdate(deps, cqUpdate(`invite_accept:${GID}`, inviteMsg));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', 'Already handled.');
    expect(store[`groups/${GID}/members/u-tg-42`]).toBeUndefined(); // no write
  });

  // The client's deleteGroup sweeps invitee mailboxes BEFORE dropping the group,
  // so a deleted group reaches the bot as no-pending + no-name. The group being
  // gone is already in hand (the name read) and is the dominant truth — answer
  // it, not "Already handled." (which implies the user acted on it).
  test('tap after the owner deleted the group (no pending, no name) → "That group no longer exists."', async () => {
    const store = {};
    seedUser(store);
    const deps = makeBotDeps(store); // neither pending nor group name
    const reply = await handleUpdate(deps, cqUpdate(`invite_accept:${GID}`, inviteMsg));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', 'That group no longer exists.');
    expect(deps.tg.editMessageText).toHaveBeenCalledWith(
      '42', 7, 'Ada invited you to Divers\n\nThat group no longer exists.');
    expect(store[`groups/${GID}/members/u-tg-42`]).toBeUndefined(); // no write
  });
});

describe('follow-request callbacks are state-checked (W1 B#1)', () => {
  const REQ = 'b'.repeat(32);
  const frMsg = { message_id: 9, chat: { id: 42 }, text: 'Cara wants to follow you' };

  test('decline after approve answers "Already approved." and keeps the grant', async () => {
    const store = {};
    const uid = seedUser(store);
    store[`followGrants/${REQ}/${uid}`] = { from: uid, code: 'AAAAAA', ts: 1 };
    const deps = makeBotDeps(store);
    const reply = await handleUpdate(deps, cqUpdate(`fr_decline:${REQ}`, frMsg));
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
    const reply = await handleUpdate(deps, cqUpdate(`fr_approve:${REQ}`, frMsg));
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
    const reply = await handleUpdate(deps, cqUpdate(`fr_decline:${REQ}`, frMsg));
    expect(store[`followRequests/${uid}/${REQ}`]).toBeNull();
    expect(deps.tg.editMessageText).toHaveBeenCalledWith(
      '42', 9, 'Cara wants to follow you\n\nDeclined.');
  });

  test('tap on a vanished request answers "This request is gone."', async () => {
    const store = {};
    seedUser(store);
    const deps = makeBotDeps(store);
    const reply = await handleUpdate(deps, cqUpdate(`fr_approve:${REQ}`, frMsg));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', 'This request is gone.');
  });

  // followGrants is a CONSUMED mailbox — the requester's app completes the
  // follow and deletes the grant within seconds, so a late tap usually sees
  // neither request nor grant. The durable trace of an approval is the
  // follower entry registerAsFollower wrote: answer from that, so a late
  // Decline after a consumed approval doesn't collapse into "gone".
  test('late tap after the grant was CONSUMED (follower entry exists) → "Already approved."', async () => {
    const store = {};
    const uid = seedUser(store);
    store[`users/${uid}/followers/${REQ}`] = 'REQCODE'; // C completed the follow
    const deps = makeBotDeps(store);
    const reply = await handleUpdate(deps, cqUpdate(`fr_decline:${REQ}`, frMsg));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', 'Already approved.');
    expect(deps.tg.editMessageText).toHaveBeenCalledWith(
      '42', 9, 'Cara wants to follow you\n\n✅ Approved.');
    expect(store[`users/${uid}/followers/${REQ}`]).toBe('REQCODE'); // untouched
  });
});

describe('knock cap honesty (W1 B#2)', () => {
  const RECIP = 'a'.repeat(32); // format-valid uid for CALLBACK_ARG_RE

  test('capped knock via callback answers the cap message, not "Knock sent."', async () => {
    const store = {};
    seedUser(store);
    store[`knocks/${RECIP}/u-tg-42`] = { count: 5, ts: 999 };
    const deps = makeBotDeps(store);
    const reply = await handleUpdate(deps, cqUpdate(`knock:${RECIP}`));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith(
      'cq1', "You've already knocked a few times — give them a moment.");
    expect(store[`knocks/${RECIP}/u-tg-42`].count).toBe(5); // unchanged
  });

  test('uncapped knock via callback still answers "Knock sent."', async () => {
    const store = {};
    seedUser(store);
    const deps = makeBotDeps(store);
    const reply = await handleUpdate(deps, cqUpdate(`knock:${RECIP}`));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cq1', 'Knock sent.');
  });

  test('capped /knock command replies the cap message', async () => {
    const store = {};
    const uid = seedUser(store);
    store[`userPrefs/${uid}/following`] = { [RECIP]: { code: 'BBBBBB', label: 'Ana' } };
    store[`knocks/${RECIP}/${uid}`] = { count: 5, ts: 999 };
    const deps = makeBotDeps(store);
    const reply = await handleUpdate(deps, msgUpdate('/knock ana'));
    expect(reply.chat_id).toBe('42');
    expect(reply.text).toBe("You've already knocked a few times — give them a moment.");
  });
});

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

describe('webhookAuthorized', () => {
  test('exact secret match only; unset secret always refuses', () => {
    expect(webhookAuthorized('s3cret', 's3cret')).toBe(true);
    expect(webhookAuthorized('wrong', 's3cret')).toBe(false);
    expect(webhookAuthorized(undefined, 's3cret')).toBe(false);
    expect(webhookAuthorized('', '')).toBe(false);
    expect(webhookAuthorized('anything', undefined)).toBe(false);
  });
});
