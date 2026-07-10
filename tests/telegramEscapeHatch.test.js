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
  escapeHatchAvailable, escapeHatchTextHtml, syncEscapeHatchButton,
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

describe('escapeHatchTextHtml', () => {
  test('renders the shared message text (no button — that lives in the action row)', () => {
    const html = escapeHatchTextHtml();
    expect(html).toContain('You can also link Telegram to get notified there — no install or browser permission needed.');
    expect(html).toContain('tg-escape-hatch');
    expect(html).not.toContain('<button'); // the CTA is mounted separately
  });
  test('empty string when unavailable (callers append unconditionally)', () => {
    mockEnabled.mockReturnValue(false);
    expect(escapeHatchTextHtml()).toBe('');
  });
});

describe('syncEscapeHatchButton', () => {
  function actionsRow() {
    const row = document.createElement('div');
    row.className = 'notify-promo-actions';
    row.innerHTML = '<button class="ghost-btn">Close</button>';
    return row;
  }

  test('mounts the "Use in Telegram" CTA as the last (rightmost) child, wired to the starter', () => {
    const row = actionsRow();
    syncEscapeHatchButton(row, true);
    const btn = row.querySelector('.tg-escape-hatch-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('Use in Telegram');
    expect(row.lastElementChild).toBe(btn); // rightmost, after Close
    btn.click();
    expect(mockStartFromNudge).toHaveBeenCalledWith(btn);
  });

  test('idempotent: a second call does not add a duplicate', () => {
    const row = actionsRow();
    syncEscapeHatchButton(row, true);
    syncEscapeHatchButton(row, true);
    expect(row.querySelectorAll('.tg-escape-hatch-btn')).toHaveLength(1);
  });

  test('wanted=false removes a previously-mounted CTA (lane flip)', () => {
    const row = actionsRow();
    syncEscapeHatchButton(row, true);
    expect(row.querySelector('.tg-escape-hatch-btn')).not.toBeNull();
    syncEscapeHatchButton(row, false);
    expect(row.querySelector('.tg-escape-hatch-btn')).toBeNull();
  });

  test('unavailable → does not mount (and removes any existing)', () => {
    const row = actionsRow();
    mockEnabled.mockReturnValue(false);
    syncEscapeHatchButton(row, true);
    expect(row.querySelector('.tg-escape-hatch-btn')).toBeNull();
  });

  test('null container → no-op, no throw', () => {
    expect(() => syncEscapeHatchButton(null, true)).not.toThrow();
    expect(mockStartFromNudge).not.toHaveBeenCalled();
  });
});
