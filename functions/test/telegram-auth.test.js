import { createHmac } from 'crypto';
import { jest } from '@jest/globals';
import { verifyInitData, deriveTelegramUid, ensureTelegramUser } from '../telegram-auth.js';

const BOT_TOKEN = '12345:TEST_TOKEN';

// Build a validly-signed initData string the same way Telegram does:
// data_check_string = sorted key=value lines (excluding hash), secret =
// HMAC_SHA256(botToken, key="WebAppData"), hash = HMAC_SHA256(dcs, secret) hex.
function makeInitData(fields, botToken = BOT_TOKEN) {
  const params = new URLSearchParams(fields);
  const pairs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort();
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
  params.set('hash', hash);
  return params.toString();
}

const NOW = 1_750_000_000_000;
const FRESH = { auth_date: String(Math.floor(NOW / 1000) - 60), user: JSON.stringify({ id: 42, first_name: 'Ada' }) };

describe('verifyInitData', () => {
  test('valid signature + fresh auth_date → parsed user', () => {
    const user = verifyInitData(makeInitData(FRESH), BOT_TOKEN, NOW);
    expect(user).toEqual({ id: 42, first_name: 'Ada' });
  });
  test('tampered payload → null', () => {
    const good = makeInitData(FRESH);
    const bad = good.replace(encodeURIComponent('"id":42'), encodeURIComponent('"id":43'));
    expect(verifyInitData(bad, BOT_TOKEN, NOW)).toBeNull();
  });
  test('signed with a different bot token → null', () => {
    expect(verifyInitData(makeInitData(FRESH, 'other:TOKEN'), BOT_TOKEN, NOW)).toBeNull();
  });
  test('stale auth_date → null', () => {
    const stale = { ...FRESH, auth_date: String(Math.floor(NOW / 1000) - 25 * 60 * 60) };
    expect(verifyInitData(makeInitData(stale), BOT_TOKEN, NOW)).toBeNull();
  });
  test('missing hash / empty / missing token → null', () => {
    expect(verifyInitData('auth_date=1', BOT_TOKEN, NOW)).toBeNull();
    expect(verifyInitData('', BOT_TOKEN, NOW)).toBeNull();
    expect(verifyInitData(makeInitData(FRESH), '', NOW)).toBeNull();
  });
  test('missing user field → null', () => {
    const noUser = { auth_date: FRESH.auth_date };
    expect(verifyInitData(makeInitData(noUser), BOT_TOKEN, NOW)).toBeNull();
  });
});

describe('deriveTelegramUid', () => {
  test('32 hex chars, deterministic, differs by tgId', () => {
    const a = deriveTelegramUid(42);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(deriveTelegramUid('42')).toBe(a);   // string/number agnostic
    expect(deriveTelegramUid(43)).not.toBe(a);
  });
});

function makeStoreDeps(store = {}) {
  return {
    store,
    getVal: jest.fn(async (path) => store[path] ?? null),
    set: jest.fn(async (path, value) => { store[path] = value; }),
    update: jest.fn(async (path, obj) => {
      for (const [k, v] of Object.entries(obj)) store[`${path}/${k}`.replace(/\/+/g, '/')] = v;
    }),
    transaction: jest.fn(async (path, fn) => {
      const next = fn(store[path] ?? null);
      if (next === undefined) return { committed: false };
      store[path] = next;
      return { committed: true };
    }),
    now: () => 1000,
    generateCode: () => 'AAAAAA',
  };
}

describe('ensureTelegramUser', () => {
  test('first contact: creates mapping, reverse index, prefs, presence with claimed code', async () => {
    const deps = makeStoreDeps();
    const res = await ensureTelegramUser(deps, { id: 42, first_name: 'Ada' });
    expect(res.created).toBe(true);
    expect(res.linked).toBe(false);
    expect(res.uid).toMatch(/^[0-9a-f]{32}$/);
    expect(deps.store[`telegramUsers/42`]).toMatchObject({ uid: res.uid, chatId: '42' });
    expect(deps.store[`telegramByUid/${res.uid}`]).toEqual({ tgId: '42', chatId: '42' });
    expect(deps.store[`userPrefs/${res.uid}/notifyChannel`]).toBe('telegram');
    expect(deps.store[`users/${res.uid}/presence`]).toEqual({ code: 'AAAAAA', status: 'unavailable', availableUntil: null });
    expect(deps.store['codeIndex/AAAAAA']).toBe(res.uid);
  });
  test('returning user: no writes, created=false', async () => {
    const deps = makeStoreDeps();
    const first = await ensureTelegramUser(deps, { id: 42 });
    deps.set.mockClear(); deps.transaction.mockClear();
    const again = await ensureTelegramUser(deps, { id: 42 });
    expect(again).toEqual({ uid: first.uid, created: false, linked: false });
    expect(deps.set).not.toHaveBeenCalled();
    expect(deps.transaction).not.toHaveBeenCalled();
  });
  test('share-code collision retries with a fresh code', async () => {
    const deps = makeStoreDeps({ 'codeIndex/AAAAAA': 'someoneElse' });
    const codes = ['AAAAAA', 'BBBBBB'];
    deps.generateCode = () => codes.shift();
    const res = await ensureTelegramUser(deps, { id: 7 });
    expect(deps.store[`users/${res.uid}/presence`].code).toBe('BBBBBB');
  });
  test('linked mapping (phrase uid) is respected: linked=true, no presence bootstrap', async () => {
    const deps = makeStoreDeps({
      'telegramUsers/42': { uid: 'phraseuid00000000000000000000000', chatId: '42' },
      'users/phraseuid00000000000000000000000/presence': { code: 'ZZZZZZ', status: 'unavailable', availableUntil: null },
    });
    const res = await ensureTelegramUser(deps, { id: 42 });
    expect(res).toEqual({ uid: 'phraseuid00000000000000000000000', created: false, linked: true });
  });
});
