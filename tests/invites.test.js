// tests/invites.test.js
const { generateInviteToken } = require('../js/invites');

describe('generateInviteToken', () => {
  test('returns a 22-char URL-safe base64 string', () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  test('produces distinct values across calls', () => {
    const tokens = new Set(Array.from({ length: 100 }, generateInviteToken));
    expect(tokens.size).toBe(100);
  });
});
