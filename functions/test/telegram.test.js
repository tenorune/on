import { jest } from '@jest/globals';
import { buildNotificationKeyboard, handleUpdate, parseDurationMinutes, webhookAuthorized } from '../telegram.js';
import { GROUP_ID_RE, UID_RE } from '../telegram-shared.js';

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
  test('invite → accept/decline', () => {
    expect(buildNotificationKeyboard({ type: 'invite', targetUid: 'u9', groupId: 'G1' }, APP))
      .toEqual([[
        { text: 'Accept', callback_data: 'invite_accept:G1' },
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
    store,
    getVal: jest.fn(async (path) => store[path] ?? null),
    set: jest.fn(async (path, value) => { store[path] = value; }),
    update: jest.fn(async (path, obj) => {
      for (const [k, v] of Object.entries(obj)) store[`${path}/${k}`] = v;
    }),
    transaction: jest.fn(async (path, fn) => {
      const next = fn(store[path] ?? null);
      if (next === undefined) return { committed: false };
      store[path] = next;
      return { committed: true };
    }),
    now: () => 1_000_000,
    appUrl: 'https://app.example.com',
    generateCode: () => 'AAAAAA',
    tg: {
      sendMessage: jest.fn(async () => ({})),
      answerCallbackQuery: jest.fn(async () => ({})),
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

describe('handleUpdate: /start', () => {
  test('bootstraps the account and replies with an open-app button', async () => {
    const deps = makeBotDeps();
    await handleUpdate(deps, msgUpdate('/start'));
    expect(deps.store['telegramUsers/42']).toBeTruthy();
    const [chatId, text, extra] = deps.tg.sendMessage.mock.calls[0];
    expect(chatId).toBe('42');
    expect(text).toMatch(/KnockKnock/);
    expect(extra.reply_markup.inline_keyboard[0][0].web_app.url).toBe('https://app.example.com');
  });
  test('updates chatId to the message chat id', async () => {
    const deps = makeBotDeps();
    deps.store['telegramUsers/42'] = { uid: 'u-tg-42', chatId: 'old' };
    deps.store['users/u-tg-42/presence'] = { code: 'AAAAAA', status: 'unavailable', availableUntil: null };
    await handleUpdate(deps, msgUpdate('/start'));
    expect(deps.store['telegramUsers/42/chatId']).toBe('42');
    expect(deps.store['telegramByUid/u-tg-42/chatId']).toBe('42');
  });
});

describe('/start first contact vs returning', () => {
  test('stranger: funnel message, no command list, Open button', async () => {
    const deps = makeBotDeps({});
    await handleUpdate(deps, msgUpdate('/start'));
    const [, text, extra] = deps.tg.sendMessage.mock.calls[0];
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
    await handleUpdate(deps, msgUpdate('/start'));
    const [, text] = deps.tg.sendMessage.mock.calls[0];
    expect(text).toBe("You're available for another 30m. /off to stop.");
  });

  test('returning + unavailable: compact status reply', async () => {
    const deps = makeBotDeps({});
    seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/start'));
    const [, text] = deps.tg.sendMessage.mock.calls[0];
    expect(text).toBe("You're unavailable right now. /status to go available.");
  });

  test('stranger /start still bootstraps mapping + chat route', async () => {
    const deps = makeBotDeps({});
    await handleUpdate(deps, msgUpdate('/start'));
    expect(deps.store['telegramUsers/42']).toBeTruthy();
    expect(deps.store['telegramUsers/42/chatId']).toBe('42');
  });
});

describe('handleUpdate: /status and /off', () => {
  test('/status 30m → available with future availableUntil + lastSeen', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/status 30m'));
    expect(deps.update).toHaveBeenCalledWith(`users/${uid}/presence`, {
      status: 'available', availableUntil: 1_000_000 + 30 * 60000, lastSeen: 1_000_000,
    });
    expect(deps.tg.sendMessage).toHaveBeenCalled();
  });
  test('/status with no arg defaults to 60m', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/status'));
    expect(deps.update).toHaveBeenCalledWith(`users/${uid}/presence`,
      expect.objectContaining({ availableUntil: 1_000_000 + 60 * 60000 }));
  });
  test('/status <unknown word> → treated as group name, no write', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/status whenever'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe('No group matching "whenever".');
  });
  test('/off → unavailable, cleared availableUntil', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/off'));
    expect(deps.update).toHaveBeenCalledWith(`users/${uid}/presence`, {
      status: 'unavailable', availableUntil: null, lastSeen: 1_000_000,
    });
  });
  test('command from an unknown tg user → open-app prompt, no presence write', async () => {
    const deps = makeBotDeps();
    await handleUpdate(deps, msgUpdate('/status 30m'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/open/i);
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

describe('handleUpdate: /notifications and /help', () => {
  test('/notifications push and telegram set the channel; bad arg explains', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/notifications push'));
    expect(deps.store[`userPrefs/${uid}/notifyChannel`]).toBe('push');
    await handleUpdate(deps, msgUpdate('/notifications telegram'));
    expect(deps.store[`userPrefs/${uid}/notifyChannel`]).toBe('telegram');
    deps.tg.sendMessage.mockClear();
    await handleUpdate(deps, msgUpdate('/notifications carrier-pigeon'));
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/push|telegram/);
  });
  test('/help lists the commands', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/help'));
    const text = deps.tg.sendMessage.mock.calls[0][1];
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
    await handleUpdate(deps, { message: { text: '/help', from: { id: 42 }, chat: { id: -9, type: 'group' } } });
    await handleUpdate(deps, { edited_message: {} });
    await handleUpdate(deps, null);
    expect(deps.tg.sendMessage).not.toHaveBeenCalled();
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
    await handleUpdate(deps, msgUpdate('/who'));
    const text = deps.tg.sendMessage.mock.calls[0][1];
    expect(text).toContain('Bea');
    expect(text).not.toContain('Cal');

    deps.tg.sendMessage.mockClear();
    deps.store['users/f1/presence'] = { status: 'available', availableUntil: 500 }; // expired
    await handleUpdate(deps, msgUpdate('/who'));
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/no one|nobody/i);
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

describe('handleUpdate: /knock', () => {
  const following = { f1: { code: 'CODE01', label: 'Bea' }, f2: { code: 'CODE02', label: 'Beatrice' } };
  test('unique match → knock written with client shape', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = { f1: following.f1 };
    await handleUpdate(deps, msgUpdate('/knock bea'));
    expect(deps.store[`knocks/f1/${uid}`]).toEqual({ count: 1, ts: 1_000_000 });
  });
  test('knock caps at 5 like the client transaction', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = { f1: following.f1 };
    deps.store[`knocks/f1/${uid}`] = { count: 5, ts: 1 };
    await handleUpdate(deps, msgUpdate('/knock bea'));
    expect(deps.store[`knocks/f1/${uid}`].count).toBe(5);
  });
  test('ambiguous → inline keyboard of candidates', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = following;
    await handleUpdate(deps, msgUpdate('/knock bea'));
    const extra = deps.tg.sendMessage.mock.calls[0][2];
    const buttons = extra.reply_markup.inline_keyboard.flat();
    expect(buttons).toEqual(expect.arrayContaining([
      { text: 'Bea', callback_data: 'knock:f1' },
      { text: 'Beatrice', callback_data: 'knock:f2' },
    ]));
  });
  test('no match / no arg → helpful reply', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`userPrefs/${uid}/following`] = following;
    await handleUpdate(deps, msgUpdate('/knock zed'));
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/find/i);
    deps.tg.sendMessage.mockClear();
    await handleUpdate(deps, msgUpdate('/knock'));
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/knock <name>/i);
  });
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
    await handleUpdate(deps, msgUpdate('/groups'));
    const text = deps.tg.sendMessage.mock.calls[0][1];
    expect(text).toMatch(/Divers — available/i);
    expect(text).toMatch(/Family — unavailable/i);
  });
  test('no groups → pointer to the app', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/groups'));
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/app/i);
  });
});

describe('callback: knock', () => {
  const cbUpdate = (data, from = { id: 42, first_name: 'Ada' }) =>
    ({ callback_query: { id: 'cb1', data, from } });
  const F9 = 'f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9'; // format-valid 32-hex recipient
  test('writes the knock and confirms', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    await handleUpdate(deps, cbUpdate(`knock:${F9}`));
    expect(deps.store[`knocks/${F9}/${uid}`]).toEqual({ count: 1, ts: 1_000_000 });
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/knock/i));
  });
  test('unknown telegram user → prompted to open the app', async () => {
    const deps = makeBotDeps();
    await handleUpdate(deps, cbUpdate(`knock:${F9}`));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/open/i));
  });
  test('empty arg → Unknown action, no write', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, cbUpdate(`knock:`));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', 'Unknown action.');
    expect(Object.keys(deps.store).some((k) => k.startsWith('knocks/'))).toBe(false);
  });
  test('knock:uid:gid writes contextGroupId on create', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    await handleUpdate(deps, cbUpdate(`knock:${F9}:AAAA1111`));
    expect(deps.store[`knocks/${F9}/${uid}`]).toEqual({ count: 1, ts: 1_000_000, contextGroupId: 'AAAA1111' });
  });
  test('knock:uid:gid overwrites contextGroupId on increment', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`knocks/${F9}/${uid}`] = { count: 1, ts: 1 };
    await handleUpdate(deps, cbUpdate(`knock:${F9}:BBBB2222`));
    expect(deps.store[`knocks/${F9}/${uid}`]).toEqual({ count: 2, ts: 1_000_000, contextGroupId: 'BBBB2222' });
  });
  test('malformed gid segment is dropped — knock still lands, no contextGroupId', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    await handleUpdate(deps, cbUpdate(`knock:${F9}:bad.gid`));
    expect(deps.store[`knocks/${F9}/${uid}`]).toEqual({ count: 1, ts: 1_000_000 });
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/knock/i));
  });
  test('plain knock:uid carries an existing contextGroupId on increment', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`knocks/${F9}/${uid}`] = { count: 1, ts: 1, contextGroupId: 'G1' };
    await handleUpdate(deps, cbUpdate(`knock:${F9}`));
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
    await handleUpdate(deps, cbUpdate(`knock:${badUid}`));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', 'Unknown action.');
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
    await handleUpdate(deps, cb(`invite_accept:${GID}`));
    expect(deps.store[`groups/${GID}/members/${uid}`]).toEqual({
      role: 'member', displayName: 'Ada', joinedAt: 1_000_000,
      statusOverride: { enabled: true, status: 'available', availableUntil: 1_000_000 + 2 * 60 * 60 * 1000 },
    });
    expect(deps.store[`users/${uid}/groups/${GID}`]).toEqual({ lastVisited: 1_000_000 });
    expect(deps.store[`pendingInvites/${uid}/${GID}`]).toBeNull();
    expect(deps.store[`pendingInvitesByGroup/${GID}/${uid}`]).toBeNull();
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringContaining('Divers'));
  });
  test('invite_accept when already a member → just clears the pending invite', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/${GID}`] = { from: 'inviter', ts: 1 };
    deps.store[`groups/${GID}/name`] = 'Divers';
    deps.store[`groups/${GID}/members/${uid}`] = { role: 'member', displayName: 'Old' };
    await handleUpdate(deps, cb(`invite_accept:${GID}`));
    expect(deps.store[`groups/${GID}/members/${uid}`].displayName).toBe('Old');
    expect(deps.store[`pendingInvites/${uid}/${GID}`]).toBeNull();
  });
  test('invite_accept when group is gone → clears pending, says so', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/${GID}`] = { from: 'inviter', ts: 1 };
    await handleUpdate(deps, cb(`invite_accept:${GID}`));
    expect(deps.store[`pendingInvites/${uid}/${GID}`]).toBeNull();
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/no longer/i));
  });
  test('invite_decline → dual-delete only', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/${GID}`] = { from: 'inviter', ts: 1 };
    await handleUpdate(deps, cb(`invite_decline:${GID}`));
    expect(deps.store[`pendingInvites/${uid}/${GID}`]).toBeNull();
    expect(deps.store[`groups/${GID}/members/${uid}`]).toBeUndefined();
  });
  test('fr_approve: writes grant with code + group display name, deletes request', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`followRequests/${uid}/${REQ}`] = { from: REQ, groupId: GID, ts: 1 };
    deps.store[`groups/${GID}/members/${uid}/displayName`] = 'Captain Ada';
    await handleUpdate(deps, cb(`fr_approve:${REQ}`));
    expect(deps.store[`followGrants/${REQ}/${uid}`]).toEqual({
      from: uid, code: 'AAAAAA', name: 'Captain Ada', ts: 1_000_000,
    });
    expect(deps.store[`followRequests/${uid}/${REQ}`]).toBeNull();
  });
  test('fr_approve on a vanished request → polite no-op', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, cb(`fr_approve:${REQ}`));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/gone|expired/i));
  });
  test('fr_decline → deletes the request', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`followRequests/${uid}/${REQ}`] = { from: REQ, ts: 1 };
    await handleUpdate(deps, cb(`fr_decline:${REQ}`));
    expect(deps.store[`followRequests/${uid}/${REQ}`]).toBeNull();
  });
  // Same trust boundary as the knock callback: these args become Admin-SDK
  // path segments, so a malformed gid/uid is refused before any read or write.
  test('invite_accept with malformed gid → Unknown action, nothing written', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, cb('invite_accept:bad/gid'));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', 'Unknown action.');
    expect(deps.set).not.toHaveBeenCalled();
  });
  test('invite_decline with malformed gid → Unknown action, no deletes', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, cb('invite_decline:lowercase1'));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', 'Unknown action.');
    expect(deps.set).not.toHaveBeenCalled();
  });
  test('fr_approve with malformed requester uid → Unknown action, no grant', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, cb('fr_approve:REQ/../x'));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', 'Unknown action.');
    expect(deps.set).not.toHaveBeenCalled();
  });
  test('fr_decline with malformed requester uid → Unknown action, request kept', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`followRequests/${uid}/${REQ}`] = { from: REQ, ts: 1 };
    await handleUpdate(deps, cb('fr_decline:short'));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', 'Unknown action.');
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
    await handleUpdate(deps, msgUpdate('/who'));
    expect(probe.max).toBeGreaterThanOrEqual(3);
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe('Available now:\n🟢 Bea');
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
    await handleUpdate(deps, msgUpdate('/who divers'));
    expect(probe.max).toBeGreaterThanOrEqual(3);
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe('Available in Divers:\n🟢 Bea');
  });

  test('/groups reads every group\'s name+override concurrently', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 2 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G2/name'] = 'Family';
    const probe = withConcurrencyProbe(deps);
    await handleUpdate(deps, msgUpdate('/groups'));
    expect(probe.max).toBeGreaterThanOrEqual(4);
    const text = deps.tg.sendMessage.mock.calls[0][1];
    expect(text).toBe('Divers — unavailable (you)\nFamily — unavailable (you)');
  });

  test('group-name matching reads all names concurrently (/status <group>)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 2 }, G3: { lastVisited: 3 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G2/name'] = 'Family';
    deps.store['groups/G3/name'] = 'Chess';
    const probe = withConcurrencyProbe(deps);
    await handleUpdate(deps, msgUpdate('/status chess 30m'));
    expect(probe.max).toBeGreaterThanOrEqual(3);
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/follows your global status/);
  });

  test('/knock roster reach reads all group rosters concurrently', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 }, G2: { lastVisited: 2 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store['groups/G2/name'] = 'Family';
    deps.store['groups/G1/members'] = { a1: { displayName: 'Cora' } };
    deps.store['groups/G2/members'] = { a2: { displayName: 'Zed' } };
    const probe = withConcurrencyProbe(deps);
    await handleUpdate(deps, msgUpdate('/knock cora'));
    expect(probe.max).toBeGreaterThanOrEqual(4);
    expect(deps.tg.sendMessage.mock.calls[0][1]).toBe('Knocked on Cora (Divers).');
  });

  test('group /status prefetches override + presence together (F#7)', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`users/${uid}/groups`] = { G1: { lastVisited: 1 } };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store[`groups/G1/members/${uid}/statusOverride`] = { enabled: true, status: 'unavailable' };
    const probe = withConcurrencyProbe(deps);
    await handleUpdate(deps, msgUpdate('/status divers 30m'));
    expect(probe.max).toBeGreaterThanOrEqual(2);
    expect(deps.update).toHaveBeenCalledWith(`groups/G1/members/${uid}/statusOverride`, {
      status: 'available', availableUntil: 1_000_000 + 30 * 60000,
    });
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
