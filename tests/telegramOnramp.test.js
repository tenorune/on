/** @jest-environment jsdom */
// TELEGRAM_ENABLED is already true in js/features.js on this branch, so the
// enabled=true cases need no features.js mock (matches inviteFlow.test.js's
// approach of relying on the real flag rather than mocking it).
const mockMint = jest.fn(async () => ({ token: 'tok_xyz' }));
jest.mock('../js/telegram.js', () => ({
  isTelegramContext: jest.fn(() => false),
}));
jest.mock('../js/firebase-config.js', () => ({
  callMintTelegramLinkToken: (...a) => mockMint(...a),
}));

describe('telegramOnramp', () => {
  beforeEach(() => { jest.resetModules(); mockMint.mockClear(); });

  test('enabled on web with a configured app link', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    const { telegramOnrampEnabled } = require('../js/telegramOnramp.js');
    expect(telegramOnrampEnabled()).toBe(true);
  });

  test('disabled when no app link is configured', () => {
    process.env.TELEGRAM_APP_LINK = '';
    const { telegramOnrampEnabled } = require('../js/telegramOnramp.js');
    expect(telegramOnrampEnabled()).toBe(false);
  });

  test('disabled inside Telegram (isTelegramContext true)', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    jest.resetModules();
    jest.doMock('../js/telegram.js', () => ({ isTelegramContext: jest.fn(() => true) }));
    const { telegramOnrampEnabled } = require('../js/telegramOnramp.js');
    expect(telegramOnrampEnabled()).toBe(false);
  });

  test('builds the lk_ deep link', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    const { buildLinkDeepLink } = require('../js/telegramOnramp.js');
    expect(buildLinkDeepLink('tok_xyz')).toBe('https://t.me/knockbot/app?startapp=lk_tok_xyz');
    expect(buildLinkDeepLink('')).toBeNull();
  });

  test('buildLinkDeepLink: null when unconfigured', () => {
    process.env.TELEGRAM_APP_LINK = '';
    const { buildLinkDeepLink } = require('../js/telegramOnramp.js');
    expect(buildLinkDeepLink('tok_xyz')).toBeNull();
  });

  test('startTelegramOnramp mints then opens the deep link', async () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    const { startTelegramOnramp } = require('../js/telegramOnramp.js');
    const open = jest.spyOn(window, 'open').mockReturnValue({});
    const ok = await startTelegramOnramp();
    expect(ok).toBe(true);
    expect(mockMint).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://t.me/knockbot/app?startapp=lk_tok_xyz', '_blank');
    open.mockRestore();
  });

  test('startTelegramOnramp mints a fresh token every call (no caching)', async () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    const { startTelegramOnramp } = require('../js/telegramOnramp.js');
    const open = jest.spyOn(window, 'open').mockReturnValue({});
    await startTelegramOnramp();
    await startTelegramOnramp();
    expect(mockMint).toHaveBeenCalledTimes(2);
    open.mockRestore();
  });

  test('startTelegramOnramp: returns false when the popup is blocked', async () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/knockbot/app';
    const { startTelegramOnramp } = require('../js/telegramOnramp.js');
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    expect(await startTelegramOnramp()).toBe(false);
    open.mockRestore();
  });

  test('startTelegramOnramp: returns false (no open) when unconfigured', async () => {
    process.env.TELEGRAM_APP_LINK = '';
    const { startTelegramOnramp } = require('../js/telegramOnramp.js');
    const open = jest.spyOn(window, 'open').mockReturnValue({});
    expect(await startTelegramOnramp()).toBe(false);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
