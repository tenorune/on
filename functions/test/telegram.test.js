import { jest } from '@jest/globals';
import { buildNotificationKeyboard, handleUpdate, parseDurationMinutes } from '../telegram.js';

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
  test('/status garbage → help reply, no write', async () => {
    const deps = makeBotDeps();
    seedUser(deps.store);
    await handleUpdate(deps, msgUpdate('/status whenever'));
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.tg.sendMessage.mock.calls[0][1]).toMatch(/like/i);
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
