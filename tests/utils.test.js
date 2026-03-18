// tests/utils.test.js
const { hexToRgb } = require('../js/utils.js');

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
