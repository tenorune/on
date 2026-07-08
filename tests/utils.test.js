/** @jest-environment jsdom */
// tests/utils.test.js
const { hexToRgb, resolveDisplayName } = require('../js/utils.js');

describe('resolveDisplayName', () => {
  test('prefers the label when set', () => {
    expect(resolveDisplayName({ label: 'Bea', code: 'AB12CD' })).toBe('Bea');
  });
  test('falls back to the code when the label is empty/absent', () => {
    expect(resolveDisplayName({ label: '', code: 'AB12CD' })).toBe('AB12CD');
    expect(resolveDisplayName({ code: 'AB12CD' })).toBe('AB12CD');
  });
  test('returns "" rather than undefined for a missing/empty entry', () => {
    expect(resolveDisplayName(null)).toBe('');
    expect(resolveDisplayName({})).toBe('');
  });
});

describe('hexToRgb', () => {
  test('converts 6-digit hex with # to "r, g, b" string', () => {
    expect(hexToRgb('#3b82f6')).toBe('59, 130, 246');
  });

  test('is case-insensitive', () => {
    expect(hexToRgb('#3B82F6')).toBe('59, 130, 246');
  });

  test('converts the default green fallback color', () => {
    expect(hexToRgb('#22c55e')).toBe('34, 197, 94');
  });

  test('returns "0, 0, 0" for invalid input', () => {
    expect(hexToRgb('not-a-color')).toBe('0, 0, 0');
  });
});

describe('copyWithFeedback (W3-B CL#10)', () => {
  const { copyWithFeedback } = require('../js/utils.js');
  let btn;
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '<button id="b">Copy</button>';
    btn = document.getElementById('b');
    Object.assign(navigator, { clipboard: { writeText: jest.fn(async () => {}) } });
  });
  afterEach(() => jest.useRealTimers());

  test('writes the text, swaps to done, reverts to idle after 1.5s', async () => {
    await copyWithFeedback(btn, 'the-text');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('the-text');
    expect(btn.textContent).toBe('Copied!');
    jest.advanceTimersByTime(1500);
    expect(btn.textContent).toBe('Copy');
  });

  test('custom labels', async () => {
    await copyWithFeedback(btn, 'x', { done: 'Link copied!', idle: 'Share to Telegram' });
    expect(btn.textContent).toBe('Link copied!');
    jest.advanceTimersByTime(1500);
    expect(btn.textContent).toBe('Share to Telegram');
  });

  test('clipboard failure: label untouched', async () => {
    navigator.clipboard.writeText.mockRejectedValue(new Error('denied'));
    await copyWithFeedback(btn, 'x');
    expect(btn.textContent).toBe('Copy');
  });

  test('missing clipboard API: label untouched, no throw', async () => {
    delete navigator.clipboard;
    await expect(copyWithFeedback(btn, 'x')).resolves.toBeUndefined();
    expect(btn.textContent).toBe('Copy');
  });
});
