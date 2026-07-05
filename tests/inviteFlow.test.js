/** @jest-environment jsdom */
const mockShare = jest.fn();
jest.mock('../js/telegram.js', () => ({
  isTelegramContext: jest.fn(() => true),
  openTelegramShare: (...a) => mockShare(...a),
}));

describe('inviteFlow', () => {
  beforeEach(() => { jest.resetModules(); mockShare.mockClear(); });

  test('buildTelegramInviteLink: configured → t.me deep link', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/kk_bot/app';
    const { buildTelegramInviteLink } = require('../js/inviteFlow.js');
    expect(buildTelegramInviteLink('AbC123def456ghi789jk22'))
      .toBe('https://t.me/kk_bot/app?startapp=AbC123def456ghi789jk22');
  });

  test('buildTelegramInviteLink: unconfigured or no token → null', () => {
    process.env.TELEGRAM_APP_LINK = '';
    const { buildTelegramInviteLink } = require('../js/inviteFlow.js');
    expect(buildTelegramInviteLink('AbC123def456ghi789jk22')).toBeNull();
    process.env.TELEGRAM_APP_LINK = 'https://t.me/kk_bot/app';
    jest.resetModules();
    const fresh = require('../js/inviteFlow.js');
    expect(fresh.buildTelegramInviteLink('')).toBeNull();
  });

  test('shareInviteLink: deep link when configured, web URL fallback when not', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/kk_bot/app';
    const { shareInviteLink } = require('../js/inviteFlow.js');
    shareInviteLink({ token: 'T'.repeat(22), url: 'https://app/?i=x' }, 'Join me');
    expect(mockShare).toHaveBeenCalledWith(`https://t.me/kk_bot/app?startapp=${'T'.repeat(22)}`, 'Join me');

    process.env.TELEGRAM_APP_LINK = '';
    jest.resetModules();
    const fresh = require('../js/inviteFlow.js');
    fresh.shareInviteLink({ token: 'T'.repeat(22), url: 'https://app/?i=x' });
    expect(mockShare).toHaveBeenLastCalledWith('https://app/?i=x', 'Follow me on KnockKnock');
  });
});
