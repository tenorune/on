import { jest } from '@jest/globals';
import { buildNotificationKeyboard, handleUpdate, parseDurationMinutes, webhookAuthorized } from '../telegram.js';

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
  test('writes the knock and confirms', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    await handleUpdate(deps, cbUpdate('knock:f9'));
    expect(deps.store[`knocks/f9/${uid}`]).toEqual({ count: 1, ts: 1_000_000 });
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/knock/i));
  });
  test('unknown telegram user → prompted to open the app', async () => {
    const deps = makeBotDeps();
    await handleUpdate(deps, cbUpdate('knock:f9'));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/open/i));
  });
  test('empty arg → Unknown action, no write', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, cbUpdate('knock:'));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', 'Unknown action.');
    expect(Object.keys(deps.store).some((k) => k.startsWith('knocks/'))).toBe(false);
  });
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
});

describe('inbox callbacks', () => {
  const cb = (data) => ({ callback_query: { id: 'cb1', data, from: { id: 42, first_name: 'Ada' } } });

  test('invite_accept: joins with Telegram first_name, default override, dual-deletes pending', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/G1`] = { from: 'inviter', ts: 1 };
    deps.store['groups/G1/name'] = 'Divers';
    await handleUpdate(deps, cb('invite_accept:G1'));
    expect(deps.store[`groups/G1/members/${uid}`]).toEqual({
      role: 'member', displayName: 'Ada', joinedAt: 1_000_000,
      statusOverride: { enabled: true, status: 'available', availableUntil: 1_000_000 + 2 * 60 * 60 * 1000 },
    });
    expect(deps.store[`users/${uid}/groups/G1`]).toEqual({ lastVisited: 1_000_000 });
    expect(deps.store[`pendingInvites/${uid}/G1`]).toBeNull();
    expect(deps.store[`pendingInvitesByGroup/G1/${uid}`]).toBeNull();
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringContaining('Divers'));
  });
  test('invite_accept when already a member → just clears the pending invite', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/G1`] = { from: 'inviter', ts: 1 };
    deps.store['groups/G1/name'] = 'Divers';
    deps.store[`groups/G1/members/${uid}`] = { role: 'member', displayName: 'Old' };
    await handleUpdate(deps, cb('invite_accept:G1'));
    expect(deps.store[`groups/G1/members/${uid}`].displayName).toBe('Old');
    expect(deps.store[`pendingInvites/${uid}/G1`]).toBeNull();
  });
  test('invite_accept when group is gone → clears pending, says so', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/G1`] = { from: 'inviter', ts: 1 };
    await handleUpdate(deps, cb('invite_accept:G1'));
    expect(deps.store[`pendingInvites/${uid}/G1`]).toBeNull();
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/no longer/i));
  });
  test('invite_decline → dual-delete only', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`pendingInvites/${uid}/G1`] = { from: 'inviter', ts: 1 };
    await handleUpdate(deps, cb('invite_decline:G1'));
    expect(deps.store[`pendingInvites/${uid}/G1`]).toBeNull();
    expect(deps.store[`groups/G1/members/${uid}`]).toBeUndefined();
  });
  test('fr_approve: writes grant with code + group display name, deletes request', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`followRequests/${uid}/req1`] = { from: 'req1', groupId: 'G1', ts: 1 };
    deps.store[`groups/G1/members/${uid}/displayName`] = 'Captain Ada';
    await handleUpdate(deps, cb('fr_approve:req1'));
    expect(deps.store[`followGrants/req1/${uid}`]).toEqual({
      from: uid, code: 'AAAAAA', name: 'Captain Ada', ts: 1_000_000,
    });
    expect(deps.store[`followRequests/${uid}/req1`]).toBeNull();
  });
  test('fr_approve on a vanished request → polite no-op', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, cb('fr_approve:req1'));
    expect(deps.tg.answerCallbackQuery).toHaveBeenCalledWith('cb1', expect.stringMatching(/gone|expired/i));
  });
  test('fr_decline → deletes the request', async () => {
    const deps = makeBotDeps();
    const uid = seedUser(deps.store);
    deps.store[`followRequests/${uid}/req1`] = { from: 'req1', ts: 1 };
    await handleUpdate(deps, cb('fr_decline:req1'));
    expect(deps.store[`followRequests/${uid}/req1`]).toBeNull();
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
