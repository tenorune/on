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
