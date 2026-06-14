import { jest } from '@jest/globals';
import { normalizeRecoveryCode, deriveUid, validateRecoveryHandler } from '../auth.js';

describe('validateRecoveryHandler', () => {
  const mkReq = (data) => ({ data });

  test('mints a token for the derived uid when the attempt is allowed', async () => {
    const allowAttempt = jest.fn().mockResolvedValue(true);
    const mintToken = jest.fn().mockResolvedValue('TOKEN');
    const res = await validateRecoveryHandler(mkReq({ code: 'swift-river-amber-dust' }), { allowAttempt, mintToken });
    const uid = await deriveUid('swift-river-amber-dust');
    expect(allowAttempt).toHaveBeenCalledWith(uid); // keyed by account, not IP
    expect(mintToken).toHaveBeenCalledWith(uid);
    expect(res).toEqual({ token: 'TOKEN' });
  });

  test('rejects a malformed code without rate-checking or minting', async () => {
    const allowAttempt = jest.fn();
    const mintToken = jest.fn();
    await expect(validateRecoveryHandler(mkReq({ code: 'nope' }), { allowAttempt, mintToken }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(allowAttempt).not.toHaveBeenCalled();
    expect(mintToken).not.toHaveBeenCalled();
  });

  test('rejects with resource-exhausted when the rate limiter denies the attempt', async () => {
    const allowAttempt = jest.fn().mockResolvedValue(false);
    const mintToken = jest.fn();
    await expect(validateRecoveryHandler(mkReq({ code: 'swift-river-amber-dust' }), { allowAttempt, mintToken }))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(mintToken).not.toHaveBeenCalled();
  });
});

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
