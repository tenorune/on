/** @jest-environment jsdom */
// tests/utils.test.js
const { hexToRgb, resolveDisplayName, distanceFragmentHtml, reconcileDistanceWrap } = require('../js/utils.js');
import vectors from '../test-fixtures/time-format-vectors.json';
import { formatTimeRemaining, formatTimeRemainingFuzzy } from '../js/utils.js';

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

// The distance suffix must wrap as a UNIT: same line with the ' · '
// separator, or the whole fragment on its own line with the separator
// omitted — never "<1 km" / "away" split across lines.
describe('distance fragment wrapping', () => {
  test('distanceFragmentHtml wraps the separator + text in the frag/sep/dist spans (textContent unchanged)', () => {
    const el = document.createElement('span');
    el.innerHTML = 'Available for an hour' + distanceFragmentHtml('120 m');
    expect(el.textContent).toBe('Available for an hour · 120 m');
    expect(el.querySelector('.loc-frag .loc-sep').textContent).toBe(' · ');
    expect(el.querySelector('.loc-frag .loc-dist').textContent).toBe('120 m');
  });

  function stubRect(el, top, height = 16) {
    el.getBoundingClientRect = () => ({ top, height, left: 0, right: 0, bottom: top + height, width: 40 });
  }

  test('reconcileDistanceWrap marks a fragment that landed on a later line (own line, separator hidden via class)', () => {
    const container = document.createElement('span');
    container.innerHTML = 'Available for an hour' + distanceFragmentHtml('<1 km away');
    document.body.appendChild(container);
    const frag = container.querySelector('.loc-frag');
    stubRect(container, 0);
    stubRect(frag, 18); // a full line below the container's first line
    reconcileDistanceWrap(container);
    expect(frag.classList.contains('loc-wrapped')).toBe(true);
    container.remove();
  });

  test('reconcileDistanceWrap clears a stale wrap mark when the fragment fits the first line again', () => {
    const container = document.createElement('span');
    container.innerHTML = 'Available' + distanceFragmentHtml('120 m');
    document.body.appendChild(container);
    const frag = container.querySelector('.loc-frag');
    frag.classList.add('loc-wrapped'); // stale from a longer previous paint
    stubRect(container, 0);
    stubRect(frag, 0); // same line once measured unwrapped
    reconcileDistanceWrap(container);
    expect(frag.classList.contains('loc-wrapped')).toBe(false);
    container.remove();
  });

  test('reconcileDistanceWrap is a no-op without a fragment', () => {
    const container = document.createElement('span');
    container.textContent = 'Available for an hour';
    expect(() => reconcileDistanceWrap(container)).not.toThrow();
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

describe('time formatters (fixture-pinned, shared with functions/presence-core.js)', () => {
  test.each(vectors)('js/utils time vectors: %j', ({ ms, precise, fuzzy }) => {
    expect(formatTimeRemaining(ms)).toBe(precise);
    expect(formatTimeRemainingFuzzy(ms)).toBe(fuzzy);
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
