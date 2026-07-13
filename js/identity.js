// @ts-check
// js/identity.js
const { WORDLIST, WORDSET } = require('./wordlist.js');

const STORAGE_KEY = 'statusapp_identity';

/** @typedef {{ userId: string, code: string, recoveryCode: string }} Identity */

/** @returns {string} */
function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** @returns {string} */
function generateRecoveryCode() {
  const words = [];
  const buf = new Uint32Array(4);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 4; i++) {
    // buf[i] is in [0, 2^32). Modulo by WORDLIST.length introduces negligible bias
    // (WORDLIST.length = 7772 ≪ 2^32, so the bias is ~7e-7 — irrelevant at this scale).
    words.push(WORDLIST[buf[i] % WORDLIST.length]);
  }
  return words.join('-');
}

/** @param {unknown} input @returns {string | null} */
function parseRecoveryCode(input) {
  if (typeof input !== 'string') return null;
  const normalized = input
    .toLowerCase()
    .replace(/[\s,\-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized) return null;
  const tokens = normalized.split('-');
  if (tokens.length !== 4) return null;
  for (const t of tokens) {
    if (!WORDSET.has(t)) return null;
  }
  return tokens.join('-');
}

/** @param {string} recoveryCode @returns {Promise<string>} */
async function deriveUserIdFromRecoveryCode(recoveryCode) {
  const encoded = new TextEncoder().encode(recoveryCode);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 32);
}

/** @returns {Identity | null} */
function loadIdentity() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed
        && typeof parsed.userId === 'string'
        && typeof parsed.code === 'string'
        && typeof parsed.recoveryCode === 'string') {
      return parsed;
    }
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return null;
}

/** @param {string} userId @param {string} code @param {string} recoveryCode */
function saveIdentity(userId, code, recoveryCode) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, code, recoveryCode }));
}

function clearIdentity() {
  localStorage.removeItem(STORAGE_KEY);
}

module.exports = {
  generateCode,
  generateRecoveryCode,
  parseRecoveryCode,
  deriveUserIdFromRecoveryCode,
  loadIdentity,
  saveIdentity,
  clearIdentity,
};
