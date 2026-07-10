/** @jest-environment jsdom */
// Shared "link Telegram instead" block for dead-end web-push nudges.
const mockStartFromNudge = jest.fn(async () => {});
const mockEnabled = jest.fn(() => true);
const mockLinked = jest.fn(() => false);
jest.mock('../js/telegramOnramp.js', () => ({
  telegramOnrampEnabled: (...a) => mockEnabled(...a),
  startTelegramOnrampFromNudge: (...a) => mockStartFromNudge(...a),
}));
jest.mock('../js/notifySuppression.js', () => ({
  isTelegramLinkedWeb: (...a) => mockLinked(...a),
}));
const {
  escapeHatchAvailable, escapeHatchHtml, wireEscapeHatch,
} = require('../js/telegramEscapeHatch.js');

beforeEach(() => {
  mockStartFromNudge.mockClear();
  mockEnabled.mockReturnValue(true);
  mockLinked.mockReturnValue(false);
});

describe('escapeHatchAvailable', () => {
  test('true only when the onramp is enabled AND the account is unlinked', () => {
    expect(escapeHatchAvailable()).toBe(true);
    mockLinked.mockReturnValue(true);
    expect(escapeHatchAvailable()).toBe(false);   // linked (incl. linked+push) — excluded
    mockLinked.mockReturnValue(false);
    mockEnabled.mockReturnValue(false);
    expect(escapeHatchAvailable()).toBe(false);   // unconfigured / Telegram context
  });
});

describe('escapeHatchHtml', () => {
  test('renders the shared copy + Link Telegram button when available', () => {
    const html = escapeHatchHtml();
    expect(html).toContain('Or link Telegram to get notified there — no install or browser permission needed.');
    expect(html).toContain('Link Telegram');
    expect(html).toContain('tg-escape-hatch-btn');
  });
  test('empty string when unavailable (callers append unconditionally)', () => {
    mockEnabled.mockReturnValue(false);
    expect(escapeHatchHtml()).toBe('');
  });
});

describe('wireEscapeHatch', () => {
  test('click fires the shared nudge starter with the button', () => {
    const box = document.createElement('div');
    box.innerHTML = escapeHatchHtml();
    wireEscapeHatch(box);
    const btn = box.querySelector('.tg-escape-hatch-btn');
    btn.click();
    expect(mockStartFromNudge).toHaveBeenCalledWith(btn);
  });
  test('no-op when the block is absent', () => {
    const box = document.createElement('div');
    box.innerHTML = '<span>no hatch here</span>';
    expect(() => wireEscapeHatch(box)).not.toThrow();
    expect(mockStartFromNudge).not.toHaveBeenCalled();
  });
});
