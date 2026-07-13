/** @jest-environment node */
// Pins the shared id-format regexes: sample vectors (the trust boundary for
// attacker-controllable callback args and notification payloads), the RTDB
// rules' copy of the gid pattern (rules can't import JS), and the two former
// definition sites now consuming shared/.
import { GROUP_ID_RE, UID_RE } from '../shared/idFormats.js';
const fs = require('fs');
const path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('GROUP_ID_RE accepts exactly 8 chars of A-Z0-9', () => {
  expect(GROUP_ID_RE.test('ABC12345')).toBe(true);
  expect(GROUP_ID_RE.test('ABCD1234X')).toBe(false); // 9 chars
  expect(GROUP_ID_RE.test('abc12345')).toBe(false);  // lowercase
  expect(GROUP_ID_RE.test('ABC1234')).toBe(false);   // 7 chars
  expect(GROUP_ID_RE.test('ABC1234!')).toBe(false);  // symbol
  expect(GROUP_ID_RE.test('')).toBe(false);
});

test('UID_RE accepts exactly 32 lowercase hex chars', () => {
  expect(UID_RE.test('0123456789abcdef0123456789abcdef')).toBe(true);
  expect(UID_RE.test('0123456789ABCDEF0123456789ABCDEF')).toBe(false); // uppercase
  expect(UID_RE.test('0123456789abcdef0123456789abcde')).toBe(false);  // 31
  expect(UID_RE.test('0123456789abcdef0123456789abcdef0')).toBe(false); // 33
});

test('the RTDB rules still spell the same gid pattern (rules cannot import JS)', () => {
  // database.rules.json:97 pins contextGroupId to /^[A-Z0-9]{8}$/ — keep the
  // literal in step with shared/idFormats.js GROUP_ID_RE.
  expect(read('database.rules.json')).toContain('matches(/^[A-Z0-9]{8}$/)');
  expect(GROUP_ID_RE.source).toBe('^[A-Z0-9]{8}$');
});

test('the former definition sites consume shared/ (no local redefinition)', () => {
  expect(read('js/notifyRouting.ts')).toContain("from '../shared/idFormats.js'");
  expect(read('js/notifyRouting.ts')).not.toMatch(/const GROUP_ID_RE\s*=/);
  expect(read('functions/telegram-shared.js')).toContain("'./_shared/idFormats.js'");
  expect(read('functions/telegram-shared.js')).not.toMatch(/const (GROUP_ID_RE|UID_RE)\s*=/);
});
