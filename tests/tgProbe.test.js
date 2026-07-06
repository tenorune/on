/** @jest-environment jsdom */
// Temporary on-device diagnostic — see js/tgProbe.js. Delete with the module.
jest.mock('../js/telegram.js', () => ({ tgWebApp: jest.fn() }));
jest.mock('../js/groups.js', () => ({ showToast: jest.fn() }));

const { tgWebApp } = require('../js/telegram.js');
const { showToast } = require('../js/groups.js');
const { showTelegramProbe } = require('../js/tgProbe.js');

beforeEach(() => jest.clearAllMocks());

test('surfaces platform and Bot API version through the toast (readable without a console)', () => {
  tgWebApp.mockReturnValue({ platform: 'macos', version: '7.0' });
  showTelegramProbe();
  expect(showToast).toHaveBeenCalledWith('Telegram: macos · Bot API 7.0');
});

test('tolerates missing platform/version fields', () => {
  tgWebApp.mockReturnValue({});
  showTelegramProbe();
  expect(showToast).toHaveBeenCalledWith('Telegram: ? · Bot API ?');
});

test('no-op outside Telegram (no WebApp)', () => {
  tgWebApp.mockReturnValue(null);
  showTelegramProbe();
  expect(showToast).not.toHaveBeenCalled();
});
