/** @jest-environment jsdom */
const mockShare = jest.fn();
jest.mock('../js/telegram.js', () => ({
  isTelegramContext: jest.fn(() => true),
  openTelegramShare: (...a) => mockShare(...a),
  // Faithful stub of the shared builder (exactness is covered in telegram.test.js).
  buildTelegramShareUrl: (url, text = '', { platform } = {}) => {
    const caption = text && platform !== 'ios' ? `\n${text}` : text;
    return `https://t.me/share/url?url=${encodeURIComponent(url)}${caption ? `&text=${encodeURIComponent(caption)}` : ''}`;
  },
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

  test('telegramSharingEnabled: true only when TELEGRAM_ENABLED and a deep link is configured', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/kk_bot/app';
    let mod = require('../js/inviteFlow.js');
    expect(mod.telegramSharingEnabled()).toBe(true); // TELEGRAM_ENABLED is true on the branch
    process.env.TELEGRAM_APP_LINK = '';
    jest.resetModules();
    mod = require('../js/inviteFlow.js');
    expect(mod.telegramSharingEnabled()).toBe(false);
  });

  test('shareInviteToTelegramWeb: opens the share intent in a new tab, returns true', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/kk_bot/app';
    const { shareInviteToTelegramWeb } = require('../js/inviteFlow.js');
    const open = jest.spyOn(window, 'open').mockReturnValue({});
    const ok = shareInviteToTelegramWeb({ token: 'T'.repeat(22) }, 'Follow me');
    expect(ok).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    const [url, target] = open.mock.calls[0];
    // Caption gets a leading newline so the link and message are blank-lined apart.
    expect(url).toBe(`https://t.me/share/url?url=${encodeURIComponent(`https://t.me/kk_bot/app?startapp=${'T'.repeat(22)}`)}&text=${encodeURIComponent('\nFollow me')}`);
    expect(target).toBe('_blank');
    open.mockRestore();
  });

  test('shareInviteToTelegramWeb: returns false when the popup is blocked', () => {
    process.env.TELEGRAM_APP_LINK = 'https://t.me/kk_bot/app';
    const { shareInviteToTelegramWeb } = require('../js/inviteFlow.js');
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    expect(shareInviteToTelegramWeb({ token: 'T'.repeat(22) })).toBe(false);
    open.mockRestore();
  });

  test('shareInviteToTelegramWeb: returns false (no open) when unconfigured', () => {
    process.env.TELEGRAM_APP_LINK = '';
    jest.resetModules();
    const { shareInviteToTelegramWeb } = require('../js/inviteFlow.js');
    const open = jest.spyOn(window, 'open').mockReturnValue({});
    expect(shareInviteToTelegramWeb({ token: 'T'.repeat(22) })).toBe(false);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
