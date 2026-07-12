/** @jest-environment node */
const { extractInviteTokenFromText } = require('../js/inviteText.js');

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv'; // 22 base64url chars

describe('extractInviteTokenFromText (spec N6)', () => {
  test.each([
    ['new shared link', `https://knock.example/invite?i=${TOKEN}`],
    ['legacy link', `https://knock.example/?i=${TOKEN}`],
    ['about link', `https://knock.example/about?i=${TOKEN}`],
    ['t.me deep link (C6)', `https://t.me/OnOnTestBot/OnOn?startapp=${TOKEN}`],
    ['raw 22-char token', TOKEN],
    ['padded with whitespace', `  ${TOKEN}\n`],
  ])('%s → token', (_name, input) => {
    expect(extractInviteTokenFromText(input)).toBe(TOKEN);
  });

  test.each([
    ['6-char share code', 'XK7P2M'],
    ['21 chars (not a token)', TOKEN.slice(0, 21)],
    ['23 chars', TOKEN + 'x'],
    ['URL without a token param', 'https://knock.example/about'],
    ['URL with malformed token', 'https://knock.example/?i=bad%20token!'],
    ['prose', 'hello there'],
    ['empty', ''],
  ])('%s → null', (_name, input) => {
    expect(extractInviteTokenFromText(input)).toBeNull();
  });

  test('non-string input → null', () => {
    expect(extractInviteTokenFromText(null)).toBeNull();
    expect(extractInviteTokenFromText(undefined)).toBeNull();
  });
});
