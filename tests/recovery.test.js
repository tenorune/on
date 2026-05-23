// tests/recovery.test.js
const { generateRecoveryCode, parseRecoveryCode, deriveUserIdFromRecoveryCode } = require('../js/identity');
const { WORDSET } = require('../js/wordlist');

describe('generateRecoveryCode', () => {
  test('returns 4 dash-separated lowercase words', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[a-z]+(?:-[a-z]+){3}$/);
  });

  test('all 4 words are in the wordlist', () => {
    const code = generateRecoveryCode();
    for (const word of code.split('-')) {
      expect(WORDSET.has(word)).toBe(true);
    }
  });

  test('generates different codes on successive calls', () => {
    const codes = new Set(Array.from({ length: 50 }, generateRecoveryCode));
    expect(codes.size).toBeGreaterThan(40);
  });
});

describe('parseRecoveryCode', () => {
  test('accepts standard dash form', () => {
    const code = generateRecoveryCode();
    expect(parseRecoveryCode(code)).toBe(code);
  });

  test('accepts space-separated form', () => {
    const code = generateRecoveryCode();
    const spaced = code.replace(/-/g, ' ');
    expect(parseRecoveryCode(spaced)).toBe(code);
  });

  test('accepts comma-separated form', () => {
    const code = generateRecoveryCode();
    const commaed = code.split('-').join(', ');
    expect(parseRecoveryCode(commaed)).toBe(code);
  });

  test('normalizes case', () => {
    const code = generateRecoveryCode();
    expect(parseRecoveryCode(code.toUpperCase())).toBe(code);
  });

  test('rejects fewer than 4 tokens', () => {
    expect(parseRecoveryCode('one-two-three')).toBeNull();
  });

  test('rejects more than 4 tokens', () => {
    const code = generateRecoveryCode();
    expect(parseRecoveryCode(code + '-extra')).toBeNull();
  });

  test('rejects tokens not in wordlist', () => {
    expect(parseRecoveryCode('xyzzy-foo-bar-baz')).toBeNull();
  });

  test('rejects empty input', () => {
    expect(parseRecoveryCode('')).toBeNull();
    expect(parseRecoveryCode('   ')).toBeNull();
  });
});

describe('deriveUserIdFromRecoveryCode', () => {
  test('returns a 32-char lowercase hex string', async () => {
    const id = await deriveUserIdFromRecoveryCode('swift-river-amber-dust');
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  test('is deterministic for the same input', async () => {
    const a = await deriveUserIdFromRecoveryCode('swift-river-amber-dust');
    const b = await deriveUserIdFromRecoveryCode('swift-river-amber-dust');
    expect(a).toBe(b);
  });

  test('different inputs yield different userIds', async () => {
    const a = await deriveUserIdFromRecoveryCode('swift-river-amber-dust');
    const b = await deriveUserIdFromRecoveryCode('swift-river-amber-other');
    expect(a).not.toBe(b);
  });
});
