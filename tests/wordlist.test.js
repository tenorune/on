// tests/wordlist.test.js
const { WORDLIST, WORDSET } = require('../js/wordlist');

test('WORDLIST has exactly 7772 entries', () => {
  expect(WORDLIST).toHaveLength(7772);
});

test('WORDLIST entries are all lowercase ASCII', () => {
  for (const w of WORDLIST) {
    expect(w).toMatch(/^[a-z]+$/);
  }
});

test('WORDLIST entries are unique', () => {
  expect(WORDSET.size).toBe(WORDLIST.length);
});

test('WORDSET membership matches array', () => {
  expect(WORDSET.has(WORDLIST[0])).toBe(true);
  expect(WORDSET.has('definitely-not-in-list')).toBe(false);
});
