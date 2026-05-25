// js/invites.js
// Invite-link primitive. Phase 0 supports personal-scope only.
// Token format: 22 chars from URL-safe base64 (128 bits of entropy).

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function generateInviteToken() {
  const bytes = new Uint8Array(16); // 128 bits
  (globalThis.crypto || require('crypto').webcrypto).getRandomValues(bytes);
  // Encode 16 bytes (128 bits) → 22 base64url chars (each char = 6 bits; 22 * 6 = 132, last 4 bits are zero-padded).
  // Use the cleaner approach: read 22 indices off ALPHABET using consecutive 6-bit windows.
  let out = '';
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < 16; i += 1) {
    acc = (acc << 8) | bytes[i];
    bits += 8;
    while (bits >= 6 && out.length < 22) {
      bits -= 6;
      out += ALPHABET[(acc >> bits) & 0x3f];
    }
  }
  // Flush the remaining bits: shift them to the high end of a 6-bit group (right-zero-pad per RFC 4648).
  if (out.length < 22) {
    out += ALPHABET[(acc << (6 - bits)) & 0x3f];
  }
  return out;
}
