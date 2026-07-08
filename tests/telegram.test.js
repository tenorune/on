// tests/telegram.test.js — Telegram Mini App adapter (js/telegram.js).
jest.mock('../js/features.js', () => ({ TELEGRAM_ENABLED: true }));
jest.mock('../js/firebase-config.js', () => ({
  auth: { currentUser: { uid: 'tg-uid' } },
  callValidateTelegram: jest.fn(async () => ({ token: 'tok', uid: 'tg-uid', linked: false, created: true })),
}));
jest.mock('firebase/auth', () => ({ signInWithCustomToken: jest.fn(async () => {}) }));
jest.mock('../js/auth.js', () => ({ whenRtdbAuthReady: jest.fn(async () => {}) }));
jest.mock('../js/db.js', () => ({ getUser: jest.fn(async () => ({ code: 'AAAAAA' })) }));

function setTelegramGlobal(initData = 'query_id=1&hash=abc') {
  window.Telegram = {
    WebApp: {
      initData,
      ready: jest.fn(), expand: jest.fn(),
      setHeaderColor: jest.fn(), setBackgroundColor: jest.fn(),
    },
  };
}

beforeEach(() => { jest.resetModules(); delete window.Telegram; });

test('telegramFirstName: returns the Mini App user first name, empty when absent', () => {
  window.Telegram = { WebApp: { initData: 'x', initDataUnsafe: { user: { first_name: 'Ana' } } } };
  expect(require('../js/telegram.js').telegramFirstName()).toBe('Ana');
  jest.resetModules();
  setTelegramGlobal(); // no initDataUnsafe.user
  expect(require('../js/telegram.js').telegramFirstName()).toBe('');
  jest.resetModules();
  delete window.Telegram;
  expect(require('../js/telegram.js').telegramFirstName()).toBe('');
});

describe('openTelegramShare caption separator', () => {
  test('non-iOS clients (e.g. macOS) get a newline before the caption so it does not butt against the link', () => {
    const openTelegramLink = jest.fn();
    window.Telegram = { WebApp: { openTelegramLink, platform: 'macos' } };
    require('../js/telegram.js').openTelegramShare('https://t.me/b/app?startapp=T', 'Follow me on KnockKnock');
    const arg = openTelegramLink.mock.calls[0][0];
    expect(arg).toContain(`text=${encodeURIComponent('\nFollow me on KnockKnock')}`);
  });

  test('iOS is left exactly as-is (the client already inserts a separator)', () => {
    const openTelegramLink = jest.fn();
    window.Telegram = { WebApp: { openTelegramLink, platform: 'ios' } };
    require('../js/telegram.js').openTelegramShare('https://x', 'Follow me on KnockKnock');
    const arg = openTelegramLink.mock.calls[0][0];
    expect(arg).toContain(`text=${encodeURIComponent('Follow me on KnockKnock')}`);
    expect(arg).not.toContain(encodeURIComponent('\nFollow'));
  });
});

test('isTelegramLinked: false before boot and for an unlinked session; true for a linked one (W3-A CL#3)', async () => {
  setTelegramGlobal();
  let tg = require('../js/telegram.js');
  expect(tg.isTelegramLinked()).toBe(false); // no link state yet
  await tg.ensureTelegramIdentity(); // mock: linked: false
  expect(tg.isTelegramLinked()).toBe(false);

  jest.resetModules();
  setTelegramGlobal();
  require('../js/firebase-config.js').callValidateTelegram
    .mockResolvedValueOnce({ token: 'tok', uid: 'tg-uid', linked: true, created: false });
  tg = require('../js/telegram.js');
  await tg.ensureTelegramIdentity();
  expect(tg.isTelegramLinked()).toBe(true);
});

test('isTelegramContext: true only with flag AND non-empty initData', () => {
  setTelegramGlobal();
  expect(require('../js/telegram.js').isTelegramContext()).toBe(true);
  jest.resetModules();
  setTelegramGlobal('');
  expect(require('../js/telegram.js').isTelegramContext()).toBe(false);
  jest.resetModules();
  delete window.Telegram;
  expect(require('../js/telegram.js').isTelegramContext()).toBe(false);
});

test('flag off → never telegram context', () => {
  jest.doMock('../js/features.js', () => ({ TELEGRAM_ENABLED: false }));
  setTelegramGlobal();
  expect(require('../js/telegram.js').isTelegramContext()).toBe(false);
});

test('ensureTelegramIdentity: validates, signs in, returns identity with code and isNew', async () => {
  setTelegramGlobal();
  const tg = require('../js/telegram.js');
  // Captured per-test: jest.resetModules() in beforeEach invalidates top-level mock references.
  const { callValidateTelegram } = require('../js/firebase-config.js');
  const { signInWithCustomToken } = require('firebase/auth');
  const res = await tg.ensureTelegramIdentity();
  expect(callValidateTelegram).toHaveBeenCalledWith('query_id=1&hash=abc');
  expect(signInWithCustomToken).toHaveBeenCalled();
  expect(res).toEqual({ identity: { userId: 'tg-uid', code: 'AAAAAA', recoveryCode: null }, isNew: true });
  expect(tg.telegramLinkState()).toEqual({ linked: false });
});

test('openTelegramShare builds a t.me share link and opens it in Telegram', () => {
  setTelegramGlobal();
  window.Telegram.WebApp.openTelegramLink = jest.fn();
  window.Telegram.WebApp.platform = 'ios'; // base construction; separator behavior is covered separately
  const tg = require('../js/telegram.js');
  tg.openTelegramShare('https://app.example.com/?i=TOK123', 'Follow me');
  expect(window.Telegram.WebApp.openTelegramLink).toHaveBeenCalledWith(
    `https://t.me/share/url?url=${encodeURIComponent('https://app.example.com/?i=TOK123')}&text=${encodeURIComponent('Follow me')}`,
  );
  // Missing API → silent no-op.
  delete window.Telegram.WebApp.openTelegramLink;
  expect(() => tg.openTelegramShare('https://x.example')).not.toThrow();
});
