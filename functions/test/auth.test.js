import { normalizeRecoveryCode, deriveUid } from '../auth.js';

describe('normalizeRecoveryCode', () => {
  test('lowercases, collapses separators to dashes, trims', () => {
    expect(normalizeRecoveryCode('Swift, River - amber  dust')).toBe('swift-river-amber-dust');
  });
  test('returns null for not-exactly-4 tokens', () => {
    expect(normalizeRecoveryCode('one-two-three')).toBeNull();
    expect(normalizeRecoveryCode('a-b-c-d-e')).toBeNull();
    expect(normalizeRecoveryCode('')).toBeNull();
  });
  test('rejects non-letter tokens', () => {
    expect(normalizeRecoveryCode('sw1ft-river-amber-dust')).toBeNull();
  });
});

describe('deriveUid', () => {
  test('is sha256(code) truncated to 32 hex chars, matching the client', async () => {
    expect(await deriveUid('swift-river-amber-dust')).toMatch(/^[0-9a-f]{32}$/);
  });
  test('is deterministic', async () => {
    expect(await deriveUid('swift-river-amber-dust')).toBe(await deriveUid('swift-river-amber-dust'));
  });
  test('deriveUid matches the client formula byte-for-byte', async () => {
    const { webcrypto } = await import('crypto');
    const enc = new TextEncoder().encode('swift-river-amber-dust');
    const buf = await webcrypto.subtle.digest('SHA-256', enc);
    const clientUid = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    expect(await deriveUid('swift-river-amber-dust')).toBe(clientUid);
  });
});
